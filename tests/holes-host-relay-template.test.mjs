/**
 * HOLES HOST S6: the standalone relay template
 * (integrations/cloudflare-relay-template) relayed anonymous traffic when no
 * SHARED_SECRET was set and answered every origin with
 * `access-control-allow-origin: *`, behind the deployed relay
 * (templates/cloudflare-worker), which already fails closed. It now fails
 * closed too, and only origins listed in ALLOWED_ORIGINS get CORS.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = join(repoRoot, "integrations", "cloudflare-relay-template");

async function loadWorker() {
  const source = readFileSync(join(templateDir, "src", "worker.js"), "utf8");
  const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  return mod.default;
}

const TARGET = "https://abc.ngrok-free.app";
const DASHBOARD = "https://dashboard.example";

describe("HOLES HOST S6 — relay template fails closed", () => {
  /** @type {typeof fetch} */
  let originalFetch;
  /** @type {string[]} */
  let upstreamCalls = [];
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    upstreamCalls = [];
    globalThis.fetch = /** @type {typeof fetch} */ (async (url) => {
      upstreamCalls.push(String(url));
      return new Response('{"ok":true}', { status: 202, headers: { "content-type": "application/json" } });
    });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses to relay when no SHARED_SECRET is configured", async () => {
    const worker = await loadWorker();
    for (const request of [
      new Request("https://relay.example/discovery", { method: "POST", body: "{}" }),
      new Request("https://relay.example/runs/run-1", { method: "GET" }),
    ]) {
      const res = await worker.fetch(request, { DISCOVERY_TARGET: TARGET });
      assert.equal(res.status, 401, `${request.method} ${new URL(request.url).pathname}`);
      assert.equal((await res.json()).reason, "relay_secret_not_configured");
    }
    assert.deepEqual(upstreamCalls, [], "nothing reached the tunnel");
  });

  it("never answers with a wildcard origin", async () => {
    const worker = await loadWorker();
    const env = { DISCOVERY_TARGET: TARGET, SHARED_SECRET: "s3cret", ALLOWED_ORIGINS: DASHBOARD };
    const responses = [
      await worker.fetch(new Request("https://relay.example/health", { headers: { origin: DASHBOARD } }), env),
      await worker.fetch(new Request("https://relay.example/discovery", { method: "OPTIONS", headers: { origin: DASHBOARD } }), env),
      await worker.fetch(
        new Request("https://relay.example/discovery", {
          method: "POST",
          headers: { origin: DASHBOARD, authorization: "Bearer s3cret", "content-type": "application/json" },
          body: "{}",
        }),
        env,
      ),
    ];
    for (const res of responses) {
      assert.equal(res.headers.get("access-control-allow-origin"), DASHBOARD);
      assert.match(res.headers.get("vary") || "", /origin/i);
    }
    assert.deepEqual(upstreamCalls, [`${TARGET}/discovery`]);
  });

  it("refuses a browser origin that is not listed, before any auth or relay", async () => {
    const worker = await loadWorker();
    const env = { DISCOVERY_TARGET: TARGET, SHARED_SECRET: "s3cret", ALLOWED_ORIGINS: DASHBOARD };
    for (const request of [
      new Request("https://relay.example/discovery", { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
      new Request("https://relay.example/discovery", {
        method: "POST",
        headers: { origin: "https://evil.example", authorization: "Bearer s3cret" },
        body: "{}",
      }),
    ]) {
      const res = await worker.fetch(request, env);
      assert.equal(res.status, 403, request.method);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    }
    assert.deepEqual(upstreamCalls, []);
  });

  it("documents the secret as required and names ALLOWED_ORIGINS", () => {
    const manifest = JSON.parse(readFileSync(join(templateDir, "manifest.json"), "utf8"));
    const vars = Object.fromEntries(manifest.vars.map((v) => [v.name, v]));
    assert.equal(vars.SHARED_SECRET.required, true);
    assert.ok(vars.ALLOWED_ORIGINS, "manifest lists ALLOWED_ORIGINS");
    assert.equal(manifest.auth.type, "required_bearer");
    assert.match(readFileSync(join(templateDir, "README.md"), "utf8"), /ALLOWED_ORIGINS/);
  });
});
