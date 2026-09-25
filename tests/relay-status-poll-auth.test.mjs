// G24: the discovery run-status poll (GET /runs/<id>) goes through a locked
// relay too. discovery-status-handoff.js must send it through
// JobBoredRelayAuth.fetch so it carries the relay bearer and refreshes on 401;
// without it the poll gets 401 and the run never reports an outcome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELAY_SRC = readFileSync(join(ROOT, "discovery-wizard-relay.js"), "utf8");
const HANDOFF_SRC = readFileSync(join(ROOT, "discovery-status-handoff.js"), "utf8");

const WORKER = "https://jobbored-relay.example.workers.dev";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function load({ tokens, relayStatusFor }) {
  const store = new Map();
  const requests = [];
  const pollErrors = [];
  let tokenIndex = 0;
  const window = {
    location: { hostname: "localhost", origin: "http://localhost:8080" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch: async (url, init) => {
      const u = String(url);
      requests.push({ url: u, init });
      if (u === "/__proxy/discovery-relay-token") {
        const token = tokens[Math.min(tokenIndex, tokens.length - 1)];
        tokenIndex += 1;
        return jsonResponse(200, {
          ok: true,
          relay: { workerUrl: WORKER, relayToken: token, relayLocked: true },
        });
      }
      const auth = init && init.headers && init.headers.Authorization;
      return relayStatusFor(auth);
    },
  };
  window.JobBoredDiscovery = {
    runTracker: {
      discoveryRunTracker: {
        getState: () => ({ runId: "run_1", statusPath: "/runs/run_1" }),
        markPollError: (msg) => pollErrors.push(msg),
      },
    },
  };
  const ctx = { window, URL, console, setTimeout, clearTimeout, Promise };
  ctx.fetch = window.fetch;
  ctx.localStorage = window.localStorage;
  vm.createContext(ctx);
  vm.runInContext(RELAY_SRC, ctx, { filename: "discovery-wizard-relay.js" });
  vm.runInContext(HANDOFF_SRC, ctx, { filename: "discovery-status-handoff.js" });
  return { window, requests, pollErrors };
}

test("run-status poll through a locked relay sends the relay bearer", async () => {
  const { window, requests, pollErrors } = load({
    tokens: ["tok_live"],
    relayStatusFor: (auth) =>
      auth === "Bearer tok_live"
        ? jsonResponse(200, { runId: "run_1", status: "running" })
        : jsonResponse(401, { ok: false }),
  });
  const data = await window.JobBoredDiscovery.status.pollRunStatus(`${WORKER}/webhook`);
  assert.deepEqual(pollErrors, []);
  assert.equal(data && data.status, "running");
  const relayCalls = requests.filter((r) => r.url.startsWith(WORKER));
  assert.equal(relayCalls.length, 1);
  assert.equal(relayCalls[0].url, `${WORKER}/runs/run_1`);
  assert.equal(relayCalls[0].init.method, "GET");
  assert.equal(relayCalls[0].init.headers.Authorization, "Bearer tok_live");
  assert.equal(relayCalls[0].init.headers.Accept, "application/json");
});

test("run-status poll retries once with a rotated relay token after a 401", async () => {
  const { window, requests } = load({
    tokens: ["tok_old", "tok_new"],
    relayStatusFor: (auth) =>
      auth === "Bearer tok_new"
        ? jsonResponse(200, { runId: "run_1", status: "completed" })
        : jsonResponse(401, { ok: false }),
  });
  const data = await window.JobBoredDiscovery.status.pollRunStatus(`${WORKER}/webhook`);
  assert.equal(data && data.status, "completed");
  const relayCalls = requests.filter((r) => r.url.startsWith(WORKER));
  assert.deepEqual(
    relayCalls.map((r) => r.init.headers.Authorization),
    ["Bearer tok_old", "Bearer tok_new"],
  );
});

test("run-status poll to a local worker carries no relay bearer", async () => {
  const { window, requests } = load({
    tokens: ["tok_live"],
    relayStatusFor: () => jsonResponse(200, { runId: "run_1", status: "running" }),
  });
  await window.JobBoredDiscovery.status.pollRunStatus("http://127.0.0.1:8644/webhook");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://127.0.0.1:8644/runs/run_1");
  assert.equal(requests[0].init.headers.Authorization, undefined);
});
