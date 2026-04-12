import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSourcePath = join(
  repoRoot,
  "templates",
  "cloudflare-worker",
  "worker.js",
);

/**
 * Loads templates/cloudflare-worker/worker.js as a real ESM module so the
 * default export's fetch handler runs against captured fake Request/Response
 * objects. The Worker uses globals (fetch, Response, URL) that we provide via
 * the host runtime.
 */
async function loadWorker() {
  const source = readFileSync(workerSourcePath, "utf8");
  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  const mod = await import(dataUrl);
  return mod.default;
}

function createRequest({ method, url, headers = {}, body = "" }) {
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]),
  );
  return {
    method,
    url,
    headers: {
      get(name) {
        const v = headerMap.get(String(name).toLowerCase());
        return v == null ? null : v;
      },
    },
    text: async () => body,
  };
}

describe("Cloudflare worker DISCOVERY_SECRET injection", () => {
  let originalFetch;
  let captured;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    captured = { calls: [] };
    globalThis.fetch = async (url, init) => {
      captured.calls.push({ url, init });
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("injects DISCOVERY_SECRET as x-discovery-secret on the upstream POST", async () => {
    const worker = await loadWorker();
    const env = {
      TARGET_URL: "https://upstream.example/webhook",
      DISCOVERY_SECRET: "relay-injected-secret-abc",
    };
    const req = createRequest({
      method: "POST",
      url: "https://relay.example.workers.dev/",
      headers: { "Content-Type": "application/json" },
      body: '{"event":"command-center.discovery"}',
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    assert.equal(captured.calls.length, 1);
    assert.equal(captured.calls[0].url, env.TARGET_URL);
    assert.equal(
      captured.calls[0].init.headers["x-discovery-secret"],
      "relay-injected-secret-abc",
    );
  });

  it("does not leak DISCOVERY_SECRET to the browser response", async () => {
    const worker = await loadWorker();
    const env = {
      TARGET_URL: "https://upstream.example/webhook",
      DISCOVERY_SECRET: "should-stay-server-side",
    };
    const req = createRequest({
      method: "POST",
      url: "https://relay.example.workers.dev/",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await worker.fetch(req, env);
    const responseText = await res.text();
    assert.ok(
      !responseText.includes("should-stay-server-side"),
      "secret must not appear in the response body",
    );
    // Response headers must not echo the injected secret either.
    for (const [, value] of res.headers.entries()) {
      assert.ok(
        !String(value).includes("should-stay-server-side"),
        "secret must not appear in any response header",
      );
    }
  });

  it("forwards a browser-supplied x-discovery-secret when DISCOVERY_SECRET is unset", async () => {
    const worker = await loadWorker();
    const env = { TARGET_URL: "https://upstream.example/webhook" };
    const req = createRequest({
      method: "POST",
      url: "https://relay.example.workers.dev/",
      headers: {
        "Content-Type": "application/json",
        "x-discovery-secret": "from-browser-fallback",
      },
      body: "{}",
    });
    await worker.fetch(req, env);
    assert.equal(
      captured.calls[0].init.headers["x-discovery-secret"],
      "from-browser-fallback",
    );
  });

  it("omits x-discovery-secret entirely when neither side provides one", async () => {
    const worker = await loadWorker();
    const env = { TARGET_URL: "https://upstream.example/webhook" };
    const req = createRequest({
      method: "POST",
      url: "https://relay.example.workers.dev/",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await worker.fetch(req, env);
    const headers = captured.calls[0].init.headers;
    assert.equal(
      Object.prototype.hasOwnProperty.call(headers, "x-discovery-secret"),
      false,
    );
  });

  it("preserves the upstream response status code", async () => {
    globalThis.fetch = async () =>
      new Response('{"ok":false,"message":"upstream-401"}', {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    const worker = await loadWorker();
    const env = {
      TARGET_URL: "https://upstream.example/webhook",
      DISCOVERY_SECRET: "secret",
    };
    const req = createRequest({
      method: "POST",
      url: "https://relay.example.workers.dev/",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 401);
  });
});
