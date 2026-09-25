// G24: the dashboard picks up the per-dashboard relay token that
// scripts/deploy-cloudflare-relay.mjs writes into discovery-local-bootstrap.json,
// reports the relay as locked, and every browser call site that talks to the
// relay attaches `Authorization: Bearer <token>` for the relay origin only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELAY_SRC = readFileSync(join(ROOT, "discovery-wizard-relay.js"), "utf8");

function loadRelayModule({ bootstrap = null, hostname = "localhost" } = {}) {
  const store = new Map();
  const fetchCalls = [];
  const window = {
    location: { hostname, origin: `http://${hostname}:8080` },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (!bootstrap) return { ok: false, json: async () => null };
      return { ok: true, json: async () => bootstrap };
    },
  };
  const ctx = { window, URL, console, setTimeout, Promise };
  ctx.fetch = window.fetch;
  ctx.localStorage = window.localStorage;
  vm.createContext(ctx);
  vm.runInContext(RELAY_SRC, ctx);
  return { window, store, fetchCalls };
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
  const { window, store } = loadRelayModule({ bootstrap: BOOTSTRAP });
  const auth = window.JobBoredRelayAuth;
  await auth.hydrate();
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

const CALL_SITES = [
  "discovery-wizard-verify.js",
  "settings-profile-tab.js",
  "ingest-url-flow.js",
  "expired-review-ui.js",
  "discovery-status-handoff.js",
];
for (const file of CALL_SITES) {
  test(`${file} attaches the relay bearer`, () => {
    const src = readFileSync(join(ROOT, file), "utf8");
    assert.match(src, /JobBoredRelayAuth/);
    assert.match(src, /headersFor\(/);
  });
}
