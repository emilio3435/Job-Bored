// G24 reproducer (BEAUDIT register row G24, FEATURE, evidence G1).
//
// The audit shipped no probe for G24 (LANE-REPORT-G §4 lists only
// g-relay-open-proxy.mjs, which is G1's). This file is the G24 reproducer.
// It walks the whole claim, one step per test, against real code and a
// capture server on 127.0.0.1:19012. No Cloudflare, no network.
//
//   "Authenticated relay handshake: deploy mints a per-dashboard relay token,
//    stores it in config, and shows "relay locked" in setup."
//
//   1. deploy mints a per-dashboard token   (scripts/deploy-cloudflare-relay.mjs)
//   2. the token is stored in config        (credential file + the guarded route body)
//   3. the dashboard loads it and sends it  (discovery-wizard-relay.js JobBoredRelayAuth)
//   4. the relay admits only that bearer    (templates/cloudflare-worker/worker.js)
//   5. setup shows "Relay locked"           (relay wizard model + deploy summary)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import * as deploy from "../scripts/deploy-cloudflare-relay.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_URL = "https://jobbored-relay.example.workers.dev";
const CAPTURE_PORT = 19012;
const DISCOVERY_SECRET = "g24-probe-discovery-secret";

async function loadRelayWorker() {
  const src = readFileSync(
    join(ROOT, "templates", "cloudflare-worker", "worker.js"),
    "utf8",
  );
  const url =
    "data:text/javascript;base64," + Buffer.from(src).toString("base64");
  return (await import(url)).default;
}

function loadDashboardRelay(routeBody) {
  const store = new Map();
  const window = {
    location: { hostname: "localhost", origin: "http://localhost:8080" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    // The dashboard's only source for the token is the guarded route; any
    // other URL is the relay itself, handled by the test's own fetch.
    fetch: async (url, init) => {
      if (String(url) === "/__proxy/discovery-relay-token") {
        return { ok: true, status: 200, json: async () => routeBody };
      }
      return window.__relayFetch(String(url), init);
    },
  };
  const ctx = { window, URL, console, setTimeout, Promise, Headers };
  ctx.fetch = window.fetch;
  ctx.localStorage = window.localStorage;
  vm.createContext(ctx);
  vm.runInContext(
    readFileSync(join(ROOT, "discovery-wizard-relay.js"), "utf8"),
    ctx,
  );
  return window;
}

describe("G24 authenticated relay handshake", () => {
  let capture;
  const seen = [];
  let tmpRoot;
  let token;
  let routeBody;

  before(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "g24-relay-"));
    capture = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({
          path: req.url,
          secret: req.headers["x-discovery-secret"] || null,
          authorization: req.headers.authorization || null,
        });
        res.writeHead(202, { "content-type": "application/json" });
        res.end('{"ok":true,"accepted":true}');
      });
    });
    await new Promise((r) => capture.listen(CAPTURE_PORT, "127.0.0.1", r));
  });

  after(async () => {
    await new Promise((r) => capture.close(() => r()));
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("1. deploy mints a fresh per-dashboard token, kept across a same-Worker redeploy", () => {
    assert.equal(typeof deploy.mintRelayToken, "function");
    const a = deploy.mintRelayToken();
    const b = deploy.mintRelayToken();
    assert.notEqual(a, b, "each dashboard gets its own token");
    assert.match(a, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
    token = deploy.resolveRelayToken({ workerName: "jobbored-relay" });
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const kept = deploy.resolveRelayToken({
      existingCredential: { workerName: "jobbored-relay", relayToken: token },
      workerName: "jobbored-relay",
    });
    assert.equal(kept, token, "a redeploy keeps the dashboard's token");
  });

  it("2. the token is stored in config, owner-only, and served by the guarded route", () => {
    const file = deploy.writeRelayCredential(
      {
        workerName: "jobbored-relay",
        workerUrl: WORKER_URL,
        relayToken: token,
        relayLocked: true,
      },
      tmpRoot,
    );
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const stored = deploy.readRelayCredential(tmpRoot);
    assert.equal(stored.relayToken, token);
    assert.equal(stored.relayLocked, true);
    routeBody = deploy.buildDashboardRelayTokenResponse({}, stored);
    assert.deepEqual(routeBody, {
      ok: true,
      relay: { workerUrl: WORKER_URL, relayToken: token, relayLocked: true },
    });
  });

  it("3-4. the dashboard sends the bearer and the relay admits only it", async () => {
    const worker = await loadRelayWorker();
    const env = {
      TARGET_URL: `http://127.0.0.1:${CAPTURE_PORT}/webhook`,
      DISCOVERY_SECRET,
      RELAY_TOKEN: token,
    };
    const toRelay = (url, init = {}) =>
      worker.fetch(new Request(url, { method: "POST", ...init }), env, {});
    const body = '{"event":"command-center.discovery","sheetId":"g24"}';

    // Anonymous caller: 401, upstream sees nothing.
    const anon = await toRelay(`${WORKER_URL}/webhook`, {
      headers: { "content-type": "text/plain" },
      body,
    });
    assert.equal(anon.status, 401);
    assert.equal(seen.length, 0, "an anonymous POST must not reach upstream");

    // A wrong token: 401 too.
    const wrong = await toRelay(`${WORKER_URL}/webhook`, {
      headers: { authorization: "Bearer not-the-token" },
      body,
    });
    assert.equal(wrong.status, 401);
    assert.equal(seen.length, 0);

    // The dashboard: it loads the token from the route and attaches it.
    const window = loadDashboardRelay(routeBody);
    window.__relayFetch = (url, init) =>
      toRelay(url, { headers: init && init.headers, body: init && init.body });
    const res = await window.JobBoredRelayAuth.fetch(`${WORKER_URL}/webhook`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
    });
    assert.equal(res.status, 202);
    assert.equal(seen.length, 1, "the dashboard's POST reaches upstream");
    assert.equal(seen[0].path, "/webhook");
    assert.equal(seen[0].secret, DISCOVERY_SECRET, "the relay injects the secret");
    assert.equal(seen[0].authorization, null, "the bearer stops at the relay");
    assert.equal(window.JobBoredRelayAuth.isLocked(), true);
  });

  it('5a. the setup wizard model says "Relay locked" once the dashboard holds the token', () => {
    const window = loadDashboardRelay(routeBody);
    const relayApi = window.JobBoredDiscoveryWizard.relay;
    const before = relayApi.buildRelayWizardModel({}, { workerUrl: WORKER_URL });
    assert.equal(before.relayLock.locked, false);
    assert.doesNotMatch(before.relayLock.label, /^Relay locked$/);

    assert.equal(window.JobBoredRelayAuth.hydrateFromBootstrap(routeBody), true);
    const model = relayApi.buildRelayWizardModel({}, { workerUrl: WORKER_URL });
    assert.equal(model.relayLock.locked, true);
    assert.equal(model.relayLock.label, "Relay locked");
    assert.match(model.relayLock.detail, /401/);
    assert.ok(
      !JSON.stringify(model).includes(token),
      "the wizard model never carries the token itself",
    );
  });

  it('5b. the deploy summary tells the user the relay is locked', () => {
    assert.equal(typeof deploy.formatRelayLockSummary, "function");
    const line = deploy.formatRelayLockSummary(true);
    assert.match(line, /^Relay: locked/);
    assert.match(line, /401/);
    assert.ok(!line.includes(token), "the summary never prints the token");
  });
});
