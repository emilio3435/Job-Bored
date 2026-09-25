// G24: the dashboard picks up the per-dashboard relay token that
// scripts/deploy-cloudflare-relay.mjs writes into discovery-local-bootstrap.json,
// reports the relay as locked, and every browser call site that talks to the
// relay attaches `Authorization: Bearer <token>` for the relay origin only.
//
// Repair round: static-path-guard denies discovery-local-bootstrap.json (403
// denied_artifact), so the token arrives from the loopback-guarded route
// /__proxy/discovery-relay-token. A failed hydration is retried, and a relay
// 401 (a redeploy rotated the token) refreshes the cached token and retries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELAY_SRC = readFileSync(join(ROOT, "discovery-wizard-relay.js"), "utf8");

function loadRelayModule({
  bootstrap = null,
  hostname = "localhost",
  respond = null,
} = {}) {
  const store = new Map();
  const fetchCalls = [];
  const requests = [];
  const window = {
    location: { hostname, origin: `http://${hostname}:8080` },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch: async (url, init) => {
      fetchCalls.push(String(url));
      requests.push({ url: String(url), init });
      if (respond) return respond(String(url), init);
      if (!bootstrap) return { ok: false, status: 404, json: async () => null };
      return { ok: true, status: 200, json: async () => ({ ok: true, ...bootstrap }) };
    },
  };
  const ctx = { window, URL, console, setTimeout, Promise };
  ctx.fetch = window.fetch;
  ctx.localStorage = window.localStorage;
  vm.createContext(ctx);
  vm.runInContext(RELAY_SRC, ctx);
  return { window, store, fetchCalls, requests };
}

const WORKER = "https://jobbored-relay.example.workers.dev";
const BOOTSTRAP = {
  relay: { workerUrl: WORKER, relayToken: "tok_example_123", relayLocked: true },
};

test("exposes a relay auth API", () => {
  const { window } = loadRelayModule();
  assert.equal(typeof window.JobBoredRelayAuth, "object");
  assert.equal(typeof window.JobBoredRelayAuth.hydrateFromBootstrap, "function");
  assert.equal(typeof window.JobBoredRelayAuth.headersFor, "function");
  assert.equal(typeof window.JobBoredRelayAuth.isLocked, "function");
});

test("stores the bootstrap relay token and reports the relay locked", async () => {
  const { window, store, fetchCalls } = loadRelayModule({ bootstrap: BOOTSTRAP });
  const auth = window.JobBoredRelayAuth;
  await auth.hydrate();
  assert.deepEqual(fetchCalls, ["/__proxy/discovery-relay-token"]);
  assert.equal(auth.isLocked(), true);
  assert.deepEqual({ ...auth.headersFor(`${WORKER}/webhook`) }, {
    Authorization: "Bearer tok_example_123",
  });
  assert.deepEqual({ ...auth.headersFor(`${WORKER}/runs/abc`) }, {
    Authorization: "Bearer tok_example_123",
  });
  assert.ok([...store.values()].some((v) => v.includes("tok_example_123")));
});

test("never leaks the token to another origin", () => {
  const { window } = loadRelayModule();
  const auth = window.JobBoredRelayAuth;
  assert.equal(auth.hydrateFromBootstrap(BOOTSTRAP), true);
  assert.deepEqual({ ...auth.headersFor("https://evil.example.com/webhook") }, {});
  assert.deepEqual({ ...auth.headersFor("http://127.0.0.1:8644/webhook") }, {});
  assert.deepEqual({ ...auth.headersFor("not a url") }, {});
});

test("an unlocked or missing relay block leaves the relay unlocked", () => {
  const { window } = loadRelayModule();
  const auth = window.JobBoredRelayAuth;
  assert.equal(auth.hydrateFromBootstrap({ relay: { workerUrl: WORKER } }), false);
  assert.equal(auth.isLocked(), false);
  assert.deepEqual({ ...auth.headersFor(`${WORKER}/webhook`) }, {});
});

test("does not fetch the bootstrap from a non-local origin", async () => {
  const { window, fetchCalls } = loadRelayModule({
    bootstrap: BOOTSTRAP,
    hostname: "jobbored.example.com",
  });
  await window.JobBoredRelayAuth.hydrate();
  assert.equal(fetchCalls.length, 0);
  assert.equal(window.JobBoredRelayAuth.isLocked(), false);
});

test("never fetches the static bootstrap file (static-path-guard denies it)", () => {
  assert.doesNotMatch(RELAY_SRC, /RELAY_BOOTSTRAP_PATH|fetch\([^)]*discovery-local-bootstrap/);
});

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("a failed hydration is not cached for the page lifetime", async () => {
  let deployed = false;
  const { window, fetchCalls } = loadRelayModule({
    respond: (url) => {
      if (url === "/__proxy/discovery-relay-token") {
        return deployed
          ? jsonResponse(200, { ok: true, ...BOOTSTRAP })
          : jsonResponse(200, { ok: false, reason: "relay_not_deployed" });
      }
      return jsonResponse(200, {});
    },
  });
  const auth = window.JobBoredRelayAuth;
  assert.equal(await auth.prepare(`${WORKER}/webhook`), false);
  deployed = true;
  assert.equal(await auth.prepare(`${WORKER}/webhook`), true);
  assert.equal(fetchCalls.length, 2);
  assert.deepEqual({ ...auth.headersFor(`${WORKER}/webhook`) }, {
    Authorization: "Bearer tok_example_123",
  });
});

test("a relay 401 after a redeploy refreshes the cached token and retries once", async () => {
  let current = "tok_old";
  const { window, requests } = loadRelayModule({
    respond: (url, init) => {
      if (url === "/__proxy/discovery-relay-token") {
        return jsonResponse(200, {
          ok: true,
          relay: { workerUrl: WORKER, relayToken: current, relayLocked: true },
        });
      }
      const sent = init && init.headers && init.headers.Authorization;
      return jsonResponse(sent === "Bearer tok_new" ? 202 : 401, {});
    },
  });
  const auth = window.JobBoredRelayAuth;
  assert.equal(typeof auth.fetch, "function");
  assert.equal(typeof auth.refresh, "function");
  await auth.prepare(`${WORKER}/webhook`);
  current = "tok_new"; // the relay was redeployed with a new token
  const res = await auth.fetch(`${WORKER}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 202);
  const relayCalls = requests.filter((r) => r.url.startsWith(WORKER));
  assert.equal(relayCalls.length, 2);
  assert.equal(relayCalls[0].init.headers.Authorization, "Bearer tok_old");
  assert.equal(relayCalls[1].init.headers.Authorization, "Bearer tok_new");
  assert.equal(relayCalls[1].init.headers["Content-Type"], "application/json");
});

test("a 401 whose refresh yields the same token is returned without a retry", async () => {
  const { window, requests } = loadRelayModule({
    respond: (url) =>
      url === "/__proxy/discovery-relay-token"
        ? jsonResponse(200, { ok: true, ...BOOTSTRAP })
        : jsonResponse(401, {}),
  });
  const res = await window.JobBoredRelayAuth.fetch(`${WORKER}/webhook`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(res.status, 401);
  assert.equal(requests.filter((r) => r.url.startsWith(WORKER)).length, 1);
});

test("relay fetch passes non-relay requests through untouched", async () => {
  const { window, requests } = loadRelayModule({ bootstrap: BOOTSTRAP });
  await window.JobBoredRelayAuth.fetch("http://127.0.0.1:8644/webhook", {
    method: "POST",
    headers: { "x-discovery-secret": "s" },
    body: "{}",
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.headers.Authorization, undefined);
});

// Browser call sites that POST to the relay. discovery-status-handoff.js
// (run-status GET poll headers) is outside lane R's fence; see the report.
const CALL_SITES = [
  "discovery-wizard-verify.js",
  "settings-profile-tab.js",
  "ingest-url-flow.js",
  "expired-review-ui.js",
];
for (const file of CALL_SITES) {
  test(`${file} sends its relay requests through JobBoredRelayAuth.fetch`, () => {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.match(src, /JobBoredRelayAuth\.fetch/);
  });
}
