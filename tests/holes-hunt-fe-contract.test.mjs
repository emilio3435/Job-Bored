// HOLES HUNT-FE: hunts-store.js against the merged HUNT-W worker
// (feat/holes-20261002 @ b2c354ea). The store's requests go through the
// worker's real router and /hunts handler, with in-memory SQLite stores, so a
// drift in a route, body or answer shape fails here (docs/INTERFACE-HUNTS.md).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const huntsStore = require("../hunts-store.js");
const hitlist = require("../hunts-hitlist.js");

const WORKER = "../integrations/browser-use-discovery/src/";
const { createHuntsRouteHandler } = await import(WORKER + "webhook/handle-hunts.ts");
const { openHuntStore, buildSearchKey } = await import(WORKER + "state/hunt-store.ts");
const { createDiscoveryRunStatusStore } = await import(WORKER + "state/run-status-store.ts");
const { createWorkerRequestListener } = await import(WORKER + "webhook/worker-router.ts");

const ORIGIN = "http://127.0.0.1:8644";
const SECRET = "example-discovery-secret";
const TOKEN = "ya29.example-google-token";

const PLAN = {
  planVersion: 1,
  generatedAt: "2026-10-01T13:00:00.000Z",
  seed: "seed",
  facets: { roles: ["Product Designer"], locations: ["Remote"] },
  query: { targetRoles: "Product Designer", locations: "Remote", keywordsInclude: "Figma" },
};
const OTHER_PLAN = {
  ...PLAN,
  facets: { roles: ["Data Analyst"], locations: ["Denver"] },
  query: { targetRoles: "Data Analyst", locations: "Denver" },
};

function runStatus(runId, day, plan, written, fit) {
  const at = `2026-10-0${day}T13:00:00.000Z`;
  return {
    runId,
    status: "completed",
    terminal: true,
    message: "done",
    trigger: "manual",
    request: { sheetId: "sheet_from_run", variationKey: runId, requestedAt: at },
    acceptedAt: at,
    startedAt: at,
    completedAt: at.replace("13:00", "13:20"),
    updatedAt: at.replace("13:00", "13:20"),
    warnings: [],
    sources: [],
    searchPlan: plan,
    writeResult: { appended: written, updated: 1 },
    runStats: { fit: { avg: fit } },
  };
}

function makeWorker() {
  const runStatusStore = createDiscoveryRunStatusStore(":memory:");
  const state = { busy: false };
  const dispatched = [];
  const hunts = createHuntsRouteHandler({
    store: openHuntStore(":memory:"),
    runStatusStore,
    now: () => new Date("2026-10-02T12:00:00.000Z"),
    isRunActive: () => state.busy,
    defaultExplorationShare: 0.3,
    defaultTimezone: "America/Chicago",
    async dispatch(hunt, trigger, options) {
      dispatched.push({ id: hunt.id, trigger, token: options?.googleAccessToken });
      return {
        ok: true,
        status: 202,
        runId: "run_now_1",
        body: { ok: true, kind: "accepted_async", runId: "run_now_1", statusPath: "/runs/run_now_1", pollAfterMs: 2000, message: "accepted" },
      };
    },
  });
  const reply = async () => ({ status: 200, headers: {}, body: "{}" });
  const listener = createWorkerRequestListener({
    runtimeConfig: { runMode: "local", allowedOrigins: [], allowedHosts: [], webhookSecret: SECRET },
    runStatusStore,
    buildHealthPayload: async () => ({ ok: true }),
    handlers: { discovery: reply, discoveryProfile: reply, pipelineUpdate: reply, ingestUrl: reply, cleanupExpired: reply },
    logEvent: () => {},
    readBody: async (request) => request.bodyText ?? "",
    hunts,
  });
  // A fetch that hands the dashboard's request to the worker's listener.
  const fetch = (url, init = {}) =>
    new Promise((resolve) => {
      const headers = {};
      for (const [key, value] of Object.entries(init.headers || {})) headers[key.toLowerCase()] = value;
      const request = { method: init.method || "GET", url: url.slice(ORIGIN.length), headers, bodyText: init.body || "" };
      const response = {
        statusCode: 200,
        headersSent: false,
        setHeader() {},
        end(text) {
          const body = JSON.parse(text);
          resolve({ ok: this.statusCode >= 200 && this.statusCode < 300, status: this.statusCode, json: async () => body });
        },
      };
      listener(request, response);
    });
  return { runStatusStore, state, dispatched, fetch };
}

function makeStore(worker) {
  const data = {};
  return huntsStore.createHuntsStore({
    storage: { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)), removeItem: (k) => delete data[k] },
    hitlist,
    now: () => Date.parse("2026-10-02T12:00:00.000Z"),
    getAccessToken: () => TOKEN,
    emit: () => {},
    resolveWorker: () => ({ url: (path) => ORIGIN + path, headers: () => ({ Accept: "application/json" }), secret: SECRET }),
    fetch: worker.fetch,
  });
}

function seedRuns(worker) {
  worker.runStatusStore.put(runStatus("run_a1", 1, PLAN, 2, 6));
  worker.runStatusStore.put(runStatus("run_a2", 2, PLAN, 5, 7.5));
  worker.runStatusStore.put(runStatus("run_b1", 1, OTHER_PLAN, 1, 5));
}

test("HUNT-FE-CONTRACT-1: refresh reads the live hunts, hitlist and runs, and the offline mirror ranks them the same", async () => {
  const worker = makeWorker();
  seedRuns(worker);
  const store = makeStore(worker);
  await store.refresh();
  const snap = store.snapshot();
  assert.equal(snap.offline, false);
  assert.equal(snap.unsupported, false);
  assert.deepEqual(snap.hunts, []);
  assert.equal(snap.clusters[0].key, buildSearchKey(PLAN));
  assert.equal(snap.clusters[0].repeating, true);

  assert.equal(await hitlist.searchKeyOf(PLAN), buildSearchKey(PLAN), "the mirror keys plans like the worker");
  const runs = (await (await worker.fetch(`${ORIGIN}/runs?limit=100`, { headers: { "x-discovery-secret": SECRET } })).json()).runs;
  const mirror = (await hitlist.deriveHitlist(runs, { now: Date.parse("2026-10-02T12:00:00.000Z") })).clusters;
  const pick = (c) => [c.key, c.runCount, c.repeating, c.leadsWritten, c.leadsUpdated, c.meanFit, c.score, c.lastRunId];
  assert.deepEqual(mirror.map(pick), snap.clusters.map(pick));
});

test("HUNT-FE-CONTRACT-2: save, edit, pause, run now (idle and busy) and delete round-trip through the real routes", async () => {
  const worker = makeWorker();
  seedRuns(worker);
  const store = makeStore(worker);
  await store.refresh();

  const saved = await store.saveHunt({
    fromRunId: "run_a2",
    schedule: { kind: "daily", hour: 8, minute: 0 },
    explorationShare: 0.3,
    timezone: "America/Chicago",
  });
  assert.equal(saved.ok, true, saved.message);
  const id = saved.hunt.id;
  assert.match(id, /^hunt_[0-9a-f]{32}$/);
  assert.equal(saved.hunt.nextRunAt, "2026-10-02T13:00:00.000Z");
  assert.ok(store.huntForRun("run_a2"), "the source run reads as saved");
  assert.ok(store.huntForRun("run_a1"), "a run with the same search key reads as saved");

  const duplicate = await store.saveHunt({ fromRunId: "run_a1", schedule: { kind: "off" } });
  assert.equal(duplicate.ok, false);

  const edited = await store.updateHunt(id, {
    tweaks: { locations: "Remote, Chicago", keywordsExclude: "agency" },
    schedule: { kind: "every_n_hours", everyHours: 6, hour: 9, minute: 30 },
    explorationShare: 0.5,
  });
  assert.equal(edited.ok, true, edited.message);
  assert.equal(edited.hunt.explorationShare, 0.5);
  assert.match(edited.hunt.effectivePlan.query.keywordsExclude, /agency/);

  const refused = await store.updateHunt(id, { schedule: { kind: "hourly" } });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /schedule/i, "the refused field is named");

  const paused = await store.updateHunt(id, { status: "paused" });
  assert.equal(paused.hunt.status, "paused");

  const now = await store.runHunt(id);
  assert.equal(now.ok, true, now.message);
  assert.equal(now.kind, "accepted_async");
  assert.equal(now.runId, "run_now_1");
  assert.deepEqual(worker.dispatched, [{ id, trigger: "hunt", token: TOKEN }]);

  worker.state.busy = true;
  const queued = await store.runHunt(id);
  assert.equal(queued.ok, true, queued.message);
  assert.equal(queued.kind, "queued");
  assert.ok(queued.queuedAt);
  assert.equal(worker.dispatched.length, 1, "busy worker queues instead of dispatching");

  const removed = await store.deleteHunt(id);
  assert.equal(removed.ok, true, removed.message);
  assert.equal(await store.loadHunts(), true);
  assert.deepEqual(store.snapshot().hunts, []);
});
