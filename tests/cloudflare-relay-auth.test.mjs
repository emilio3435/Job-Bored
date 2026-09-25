// G1 / BEAUDIT §0.7: the relay deploy-cloudflare-relay.mjs ships must not be an
// open proxy. Promoted from probes/G/g-relay-open-proxy.mjs: an anonymous caller
// gets 401 and never reaches upstream; a caller with the per-dashboard relay
// token reaches only /webhook and /runs/*.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSource = readFileSync(
  join(repoRoot, "templates", "cloudflare-worker", "worker.js"),
  "utf8",
);

async function loadWorker() {
  const url =
    "data:text/javascript;base64," +
    Buffer.from(workerSource).toString("base64");
  return (await import(url)).default;
}

const ENV = {
  TARGET_URL: "https://upstream.example/webhook",
  DISCOVERY_SECRET: "probe-secret",
  RELAY_TOKEN: "relay-token-123",
};

describe("Cloudflare relay caller authentication (G1)", () => {
  let originalFetch;
  let calls;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response('{"ok":true}', {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  for (const path of ["/", "/webhook", "/anything/else"]) {
    it(`answers 401 to an anonymous POST ${path} and never injects DISCOVERY_SECRET`, async () => {
      const worker = await loadWorker();
      const res = await worker.fetch(
        new Request("https://relay.example.workers.dev" + path, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: '{"event":"command-center.discovery","sheetId":"attacker"}',
        }),
        ENV,
      );
      assert.equal(res.status, 401);
      assert.equal(calls.length, 0);
    });
  }

  it("answers 401 when the relay has no token configured (fail closed)", async () => {
    const worker = await loadWorker();
    const env = { TARGET_URL: ENV.TARGET_URL, DISCOVERY_SECRET: "s" };
    const res = await worker.fetch(
      new Request("https://relay.example.workers.dev/webhook", {
        method: "POST",
        headers: { Authorization: "Bearer anything" },
        body: "{}",
      }),
      env,
    );
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });

  it("answers 401 to a wrong bearer token", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://relay.example.workers.dev/webhook", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
        body: "{}",
      }),
      ENV,
    );
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });

  it("forwards an authenticated POST /webhook with the secret injected", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://relay.example.workers.dev/webhook", {
        method: "POST",
        headers: {
          Authorization: "Bearer relay-token-123",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      ENV,
    );
    assert.equal(res.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://upstream.example/webhook");
    assert.equal(calls[0].init.headers["x-discovery-secret"], "probe-secret");
    assert.equal(calls[0].init.headers.Authorization, undefined);
  });

  it("accepts the token as X-Relay-Token and forwards GET /runs/<id>", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://relay.example.workers.dev/runs/run-1", {
        method: "GET",
        headers: { "X-Relay-Token": "relay-token-123" },
      }),
      ENV,
    );
    assert.equal(res.status, 202);
    assert.equal(calls[0].url, "https://upstream.example/runs/run-1");
    assert.equal(calls[0].init.method, "GET");
  });

  // Repair round: the dashboard also POSTs these worker routes through the
  // relay (settings-profile-tab.js /discovery-profile, ingest-url-flow.js
  // /ingest-url, expired-review-ui.js /cleanup-expired, discovery-wizard-verify.js
  // /discovery). An authenticated POST must still reach each of them.
  for (const path of [
    "/discovery",
    "/discovery-profile",
    "/ingest-url",
    "/cleanup-expired",
  ]) {
    it(`forwards an authenticated POST ${path} to the same upstream path`, async () => {
      const worker = await loadWorker();
      const res = await worker.fetch(
        new Request("https://relay.example.workers.dev" + path, {
          method: "POST",
          headers: {
            Authorization: "Bearer relay-token-123",
            "content-type": "application/json",
          },
          body: "{}",
        }),
        ENV,
      );
      assert.equal(res.status, 202, path);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://upstream.example" + path);
      assert.equal(calls[0].init.method, "POST");
      assert.equal(calls[0].init.headers["x-discovery-secret"], "probe-secret");
    });
  }

  it("rejects GET on the dashboard POST routes (read-only GET is /runs/* only)", async () => {
    const worker = await loadWorker();
    for (const path of ["/discovery-profile", "/ingest-url", "/webhook"]) {
      const res = await worker.fetch(
        new Request("https://relay.example.workers.dev" + path, {
          method: "GET",
          headers: { Authorization: "Bearer relay-token-123" },
        }),
        ENV,
      );
      assert.equal(res.status, 405, path);
    }
    assert.equal(calls.length, 0);
  });

  it("answers 404 to an authenticated caller on a path outside the dashboard routes", async () => {
    const worker = await loadWorker();
    for (const path of [
      "/anything/else",
      "/admin",
      "/pipeline-update",
      "/discovery-profile/x",
      "/health",
    ]) {
      const res = await worker.fetch(
        new Request("https://relay.example.workers.dev" + path, {
          method: "POST",
          headers: { Authorization: "Bearer relay-token-123" },
          body: "{}",
        }),
        ENV,
      );
      assert.equal(res.status, 404, path);
    }
    assert.equal(calls.length, 0);
  });

  it("CORS preflight allows the X-Relay-Token header", async () => {
    const worker = await loadWorker();
    const res = await worker.fetch(
      new Request("https://relay.example.workers.dev/webhook", {
        method: "OPTIONS",
      }),
      ENV,
    );
    assert.equal(res.status, 204);
    assert.match(
      res.headers.get("Access-Control-Allow-Headers"),
      /X-Relay-Token/,
    );
  });
});
