// HOLES HUNT-FE: hunts-store.js is the dashboard's client for the worker's
// /hunts routes (docs/INTERFACE-HUNTS.md). These pin the wire contract, the
// offline fallback to the local cache, spec §0.7 (no Google token in
// localStorage) and the §0.9 "awaiting sheet write" flush.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const huntsStore = require("../hunts-store.js");
const hitlist = require("../hunts-hitlist.js");

const ORIGIN = "http://127.0.0.1:8644";
const SECRET = "example-discovery-secret";
const TOKEN = "ya29.example-google-token";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const PLAN = {
  planVersion: 1,
  generatedAt: "2026-10-01T08:00:00.000Z",
  seed: "a1",
  selected: { skill: "Figma", industry: "SaaS", companyType: "startup" },
  facets: { roles: ["Product designer"], locations: ["Remote"], seniority: ["Senior"] },
  query: {
    targetRoles: "Product designer",
    locations: "Remote",
    seniority: "Senior",
    keywordsInclude: "Figma, SaaS, startup, design systems",
    keywordsExclude: "agency",
  },
};

const HUNT = {
  id: "hunt_0123456789abcdef0123456789abcdef",
  name: "Product designer · remote",
  status: "active",
  searchKey: "sk_22819704278edfea",
  sourceRunId: "run_saved",
  explorationShare: 0.3,
  schedule: { kind: "daily", hour: 8, minute: 0 },
  timezone: "America/Chicago",
  runs: [],
};

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// routes: { "GET /hunts": (call) => response | Error }
function makeStore({ routes = {}, storage = memoryStorage(), token = TOKEN, events = [] } = {}) {
  const calls = [];
  const store = huntsStore.createHuntsStore({
    storage,
    hitlist,
    now: () => Date.parse("2026-10-02T12:00:00.000Z"),
    getAccessToken: () => token,
    emit: (detail) => events.push(detail),
    resolveWorker: () => ({
      url: (path) => ORIGIN + path,
      headers: () => ({ Accept: "application/json" }),
      secret: SECRET,
    }),
    fetch: async (url, init) => {
      const path = url.slice(ORIGIN.length);
      const call = {
        method: init.method,
        path,
        headers: init.headers,
        body: init.body ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const handler = routes[`${init.method} ${path}`];
      if (!handler) throw new TypeError("Failed to fetch");
      const result = typeof handler === "function" ? await handler(call) : handler;
      if (result instanceof Error) throw result;
      return result;
    },
  });
  return { store, calls, storage, events };
}

const ONLINE = {
  "GET /hunts": json(200, { ok: true, hunts: [HUNT] }),
  "GET /hunts/hitlist?limit=20": json(200, {
    ok: true,
    clusters: [{ key: "sk_22819704278edfea", label: "product designer · remote · senior", runCount: 2, repeating: true, huntId: HUNT.id }],
  }),
  "GET /runs?limit=100": json(200, {
    ok: true,
    runs: [
      { runId: "run_saved", status: "completed", completedAt: "2026-10-01T09:00:00.000Z", searchPlan: PLAN, searchKey: "sk_22819704278edfea", headline: { written: 3 } },
    ],
  }),
};

test("HUNT-FE-STORE-1: every /hunts route goes out with the webhook secret, the documented method and body", async () => {
  const { store, calls } = makeStore({
    routes: {
      ...ONLINE,
      "POST /hunts": json(201, { ok: true, hunt: HUNT }),
      [`POST /hunts/${HUNT.id}`]: json(200, { ok: true, hunt: { ...HUNT, status: "paused" } }),
      [`POST /hunts/${HUNT.id}/delete`]: json(200, { ok: true, id: HUNT.id, deleted: true }),
      [`POST /hunts/${HUNT.id}/run`]: json(202, { ok: true, kind: "queued", huntId: HUNT.id, queuedAt: "2026-10-02T12:00:00.000Z", message: "Queued" }),
    },
  });
  const snap = await store.refresh();
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`).sort(),
    ["GET /hunts", "GET /hunts/hitlist?limit=20", "GET /runs?limit=100"],
  );
  assert.equal(snap.offline, false);
  assert.equal(snap.hunts.length, 1);
  assert.equal(snap.clusters[0].huntId, HUNT.id);

  const saved = await store.saveHunt({
    fromRunId: "run_saved",
    searchPlan: PLAN,
    schedule: { kind: "weekdays", hour: 7, minute: 30 },
    explorationShare: 0.45,
    timezone: "America/Chicago",
  });
  assert.equal(saved.ok, true);
  const post = calls.find((c) => c.method === "POST" && c.path === "/hunts");
  assert.equal(post.headers["x-discovery-secret"], SECRET);
  assert.equal(post.headers["Content-Type"], "application/json");
  assert.deepEqual(post.body, {
    fromRunId: "run_saved",
    timezone: "America/Chicago",
    searchPlan: PLAN,
    schedule: { kind: "weekdays", hour: 7, minute: 30 },
    explorationShare: 0.45,
  });

  const paused = await store.updateHunt(HUNT.id, { status: "paused" });
  assert.equal(paused.hunt.status, "paused");
  assert.equal(store.snapshot().hunts[0].status, "paused");

  const run = await store.runHunt(HUNT.id);
  assert.equal(run.kind, "queued");
  const runCall = calls.find((c) => c.path === `/hunts/${HUNT.id}/run`);
  assert.deepEqual(runCall.body, { googleAccessToken: TOKEN });

  const removed = await store.deleteHunt(HUNT.id);
  assert.equal(removed.ok, true);
  assert.equal(store.snapshot().hunts.length, 0);
  assert.equal(store.snapshot().clusters[0].huntId, null, "the cluster is unsaved again");
  for (const call of calls) {
    assert.equal(call.headers["x-discovery-secret"], SECRET, `${call.method} ${call.path}`);
  }
});

test("HUNT-FE-STORE-2: when the worker is unreachable the panel keeps the cached copy and refuses changes", async () => {
  const storage = memoryStorage();
  const online = makeStore({ routes: ONLINE, storage });
  await online.store.refresh();

  const offline = makeStore({ routes: {}, storage });
  const cold = offline.store.snapshot();
  assert.equal(cold.hunts[0].id, HUNT.id, "a fresh page shows the cache before any fetch");
  assert.ok(cold.cachedAt);
  const snap = await offline.store.refresh();
  assert.equal(snap.offline, true);
  assert.equal(snap.reason, "unreachable");
  assert.equal(snap.hunts[0].id, HUNT.id);
  assert.equal(snap.clusters[0].key, "sk_22819704278edfea");
  const refused = await offline.store.saveHunt({ fromRunId: "run_x" });
  assert.equal(refused.ok, false);
  assert.equal(refused.offline, true);
  const stillCached = JSON.parse(storage.getItem(huntsStore.CACHE_KEY));
  assert.equal(stillCached.hunts[0].id, HUNT.id, "an offline refresh never wipes the cache");
});

test("HUNT-FE-STORE-3: offline with no cached hitlist, the hitlist is rebuilt from cached run history", async () => {
  const storage = memoryStorage({
    [huntsStore.CACHE_KEY]: JSON.stringify({
      v: 1,
      savedAt: "2026-10-01T00:00:00.000Z",
      hunts: [],
      clusters: [],
      runs: [
        { runId: "r1", status: "completed", completedAt: "2026-09-30T08:00:00.000Z", searchPlan: PLAN, headline: { written: 2 } },
        { runId: "r2", status: "completed", completedAt: "2026-10-01T08:00:00.000Z", searchPlan: PLAN, headline: { written: 4 } },
      ],
    }),
  });
  const { store } = makeStore({ routes: {}, storage });
  const snap = await store.refresh();
  assert.equal(snap.offline, true);
  assert.equal(snap.clusters.length, 1);
  assert.equal(snap.clusters[0].runCount, 2);
  assert.equal(snap.clusters[0].repeating, true);
  assert.equal(snap.clusters[0].leadsWritten, 6);
});

test("HUNT-FE-STORE-4: a worker without /hunts reads as unsupported, and its run history still feeds the hitlist", async () => {
  const { store } = makeStore({
    routes: {
      "GET /hunts": json(404, { ok: false, message: "Not found" }),
      "GET /hunts/hitlist?limit=20": json(404, { ok: false, message: "Not found" }),
      "GET /runs?limit=100": json(200, {
        ok: true,
        runs: [
          { runId: "r1", status: "completed", completedAt: "2026-09-30T08:00:00.000Z", searchPlan: PLAN, headline: { written: 1 } },
          { runId: "r2", status: "partial", completedAt: "2026-10-01T08:00:00.000Z", searchPlan: PLAN, headline: { written: 1 } },
        ],
      }),
    },
  });
  const snap = await store.refresh();
  assert.equal(snap.offline, false);
  assert.equal(snap.unsupported, true);
  assert.equal(snap.clusters.length, 1);
  assert.equal(snap.clusters[0].runCount, 2);
});

test("HUNT-FE-STORE-5: a duplicate save surfaces the existing hunt id; a 401 is not 'offline'", async () => {
  const { store } = makeStore({
    routes: {
      "POST /hunts": json(409, { ok: false, code: "hunt_exists", message: "Already saved", huntId: HUNT.id }),
      [`POST /hunts/${HUNT.id}`]: json(401, { ok: false, code: "unauthorized", message: "Bad secret" }),
    },
  });
  const dup = await store.saveHunt({ fromRunId: "run_saved" });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, "hunt_exists");
  assert.equal(dup.huntId, HUNT.id);
  const denied = await store.updateHunt(HUNT.id, { status: "paused" });
  assert.equal(denied.ok, false);
  assert.equal(denied.offline, undefined);
  assert.equal(denied.status, 401);
  assert.equal(store.snapshot().offline, false);
});

test("HUNT-FE-STORE-6 (§0.7): no Google token or webhook secret is ever written to localStorage", async () => {
  const storage = memoryStorage();
  const leaky = { ...HUNT, googleAccessToken: TOKEN, nested: { accessToken: TOKEN, secret: SECRET } };
  const { store } = makeStore({
    storage,
    routes: {
      ...ONLINE,
      "GET /hunts": json(200, { ok: true, hunts: [leaky] }),
      [`POST /hunts/${HUNT.id}/run`]: json(202, { ok: true, kind: "accepted_async", runId: "run_now", statusPath: "/runs/run_now", huntId: HUNT.id }),
    },
  });
  await store.refresh();
  await store.runHunt(HUNT.id);
  const written = Object.values(storage.data).join("\n");
  assert.ok(written.length > 0, "the cache was written");
  assert.equal(written.includes(TOKEN), false, "no Google token in storage");
  assert.equal(written.includes(SECRET), false, "no webhook secret in storage");
});

test("HUNT-FE-STORE-7 (§0.9): the flush retries the sheet write for awaiting runs only, skips a running flush, and is single-flight", async () => {
  let runsCalls = 0;
  const { store, calls } = makeStore({
    routes: {
      "GET /runs?limit=100": () => {
        runsCalls += 1;
        return json(200, {
          ok: true,
          runs: [
            { runId: "run_a", status: "write_failed", awaitingSheetWrite: { leads: 4 } },
            { runId: "run_b", status: "write_failed", awaitingSheetWrite: { leads: 2 } },
            { runId: "run_c", status: "completed" },
            { runId: "run_d", status: "write_failed", awaitingSheetWrite: { leads: 0 } },
          ],
        });
      },
      "POST /runs/run_a/retry-write": json(200, { ok: true, run: { runId: "run_a", status: "completed" } }),
      "POST /runs/run_b/retry-write": json(409, { ok: false, code: "write_retry_running" }),
    },
  });
  const [first, second] = await Promise.all([
    store.flushAwaitingSheetWrites(),
    store.flushAwaitingSheetWrites(),
  ]);
  assert.equal(first, second, "concurrent callers share one flush");
  assert.equal(runsCalls, 1);
  assert.deepEqual(first.flushed, ["run_a"]);
  assert.deepEqual(first.skipped, ["run_b"]);
  assert.deepEqual(first.failed, []);
  const writes = calls.filter((c) => c.path.endsWith("/retry-write"));
  assert.deepEqual(writes.map((c) => c.path), ["/runs/run_a/retry-write", "/runs/run_b/retry-write"]);
  assert.deepEqual(writes[0].body, { googleAccessToken: TOKEN });

  const signedOut = makeStore({ routes: {}, token: "" });
  const none = await signedOut.store.flushAwaitingSheetWrites();
  assert.equal(none.reason, "signed_out");
  assert.equal(signedOut.calls.length, 0, "no token, no requests");
});

test("HUNT-FE-STORE-8: a run counts as saved when a hunt came from it or shares its search key (INTERFACE-HUNTS §8)", async () => {
  const { store } = makeStore({ routes: ONLINE });
  await store.refresh();
  assert.equal(store.huntForRun("run_saved").id, HUNT.id);
  assert.equal(store.huntForRun("run_other", "sk_22819704278edfea").id, HUNT.id);
  assert.equal(store.huntForRun("run_other"), null);
  assert.equal(store.huntForRun("", ""), null);
});

test("HUNT-FE-STORE-9: noveltyContext hands buildSearchPlan the cached plans' rotation picks", async () => {
  const { store } = makeStore({ routes: ONLINE });
  assert.deepEqual(store.noveltyContext(), { history: [] });
  await store.refresh();
  assert.deepEqual(store.noveltyContext(), { history: [{ selected: PLAN.selected }] });
});

test("HUNT-FE-STORE-10: loadHunts() refreshes only the saved list, so Runs rows know what is saved", async () => {
  const events = [];
  const { store, calls } = makeStore({ routes: ONLINE, events });
  assert.equal(await store.loadHunts(), true);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /hunts"]);
  assert.equal(store.huntForRun("run_saved").id, HUNT.id);
  assert.equal(events.length, 1, "listeners hear about the new list");
  const offline = makeStore({ routes: {} });
  assert.equal(await offline.store.loadHunts(), false);
});

test("HUNT-FE-STORE-11: a 400 invalid_hunt shows the field the worker names in `detail`", async () => {
  const { store } = makeStore({
    routes: {
      "POST /hunts": json(400, {
        ok: false,
        code: "invalid_hunt",
        message: "The hunt is not valid.",
        detail: "explorationShare must be a number from 0 to 1.",
      }),
    },
  });
  const res = await store.saveHunt({ fromRunId: "run_x", explorationShare: 3 });
  assert.equal(res.code, "invalid_hunt");
  assert.equal(res.message, "The hunt is not valid. explorationShare must be a number from 0 to 1.");
});
