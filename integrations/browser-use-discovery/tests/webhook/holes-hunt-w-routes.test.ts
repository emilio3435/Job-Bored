// HOLES HUNT-W: the /hunts routes behind the /webhook secret
// (docs/INTERFACE-HUNTS.md §1, §3), driven through the real router.
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";

import type { DiscoverySearchPlan, NormalizedLead } from "../../src/contracts.ts";
import { buildSearchKey, openHuntStore, type HuntRunTrigger } from "../../src/state/hunt-store.ts";
import {
  createDiscoveryRunStatusStore,
  type DurableDiscoveryRunStatusPayload,
} from "../../src/state/run-status-store.ts";
import { createHuntsRouteHandler } from "../../src/webhook/handle-hunts.ts";
import { createWorkerRequestListener } from "../../src/webhook/worker-router.ts";

const SECRET = "hunts-route-secret";
const HUNT_ID = `hunt_${"a".repeat(32)}`;

const PLAN: DiscoverySearchPlan = {
  planVersion: 1,
  generatedAt: "2026-10-01T13:00:00.000Z",
  seed: "seed",
  facets: { roles: ["Product Designer"], locations: ["Remote"] },
  query: { targetRoles: "Product Designer", locations: "Remote", keywordsInclude: "Figma" },
};

function runStatus(runId: string, overrides: Partial<DurableDiscoveryRunStatusPayload> = {}): DurableDiscoveryRunStatusPayload {
  return {
    runId,
    status: "completed",
    terminal: true,
    message: "done",
    trigger: "manual",
    request: { sheetId: "sheet_from_run", variationKey: runId, requestedAt: "2026-10-01T13:00:00.000Z" },
    acceptedAt: "2026-10-01T13:00:00.000Z",
    startedAt: "2026-10-01T13:00:00.000Z",
    completedAt: "2026-10-01T13:20:00.000Z",
    updatedAt: "2026-10-01T13:20:00.000Z",
    warnings: [],
    sources: [],
    searchPlan: PLAN,
    ...overrides,
  };
}

function makeApp() {
  const clock = { at: new Date("2026-10-02T12:00:00.000Z") };
  const store = openHuntStore(":memory:");
  const runStatusStore = createDiscoveryRunStatusStore(":memory:");
  const state = { busy: false };
  const dispatched: Array<{ id: string; trigger: HuntRunTrigger; token?: string }> = [];
  let ids = 0;
  const hunts = createHuntsRouteHandler({
    store,
    runStatusStore,
    now: () => clock.at,
    isRunActive: () => state.busy,
    defaultExplorationShare: 0.3,
    defaultTimezone: "America/Chicago",
    randomId: () => `hunt_${String.fromCharCode(97 + ids++).repeat(32)}`,
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
    readBody: async (request) => (request as unknown as { bodyText?: string }).bodyText ?? "",
    hunts,
  });
  const send = (method: string, url: string, body?: unknown, secret: string | null = SECRET) =>
    new Promise<{ status: number; body: Record<string, any> }>((resolve) => {
      const request = {
        method,
        url,
        headers: secret ? { "x-discovery-secret": secret } : {},
        bodyText: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
      } as unknown as IncomingMessage;
      const response = {
        statusCode: 200,
        headersSent: false,
        setHeader() {},
        end(text: string) {
          resolve({ status: this.statusCode, body: JSON.parse(text) });
        },
      } as unknown as ServerResponse;
      listener(request, response);
    });
  return { clock, store, runStatusStore, state, dispatched, send };
}

test("HUNT-W: every /hunts route requires the webhook secret", async () => {
  const app = makeApp();
  for (const [method, url] of [
    ["GET", "/hunts"],
    ["POST", "/hunts"],
    ["GET", "/hunts/hitlist"],
    ["GET", `/hunts/${HUNT_ID}`],
    ["POST", `/hunts/${HUNT_ID}`],
    ["POST", `/hunts/${HUNT_ID}/run`],
    ["POST", `/hunts/${HUNT_ID}/delete`],
  ] as const) {
    const missing = await app.send(method, url, {}, null);
    assert.equal(missing.status, 401, `${method} ${url} without secret`);
    assert.equal(missing.body.code, "unauthorized");
    const wrong = await app.send(method, url, {}, "not-the-secret");
    assert.equal(wrong.status, 401, `${method} ${url} with a wrong secret`);
  }
});

test("HUNT-W: a past run saves as a hunt with its plan, Sheet and next slot; a duplicate is refused", async () => {
  const app = makeApp();
  app.runStatusStore.put(runStatus("run_source"));
  const created = await app.send("POST", "/hunts", {
    fromRunId: "run_source",
    schedule: { kind: "daily", hour: 8, minute: 0 },
    timezone: "America/Chicago",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const hunt = created.body.hunt;
  assert.equal(hunt.id, `hunt_${"a".repeat(32)}`);
  assert.equal(hunt.status, "active");
  assert.deepEqual(hunt.searchPlan, PLAN);
  assert.deepEqual(hunt.effectivePlan, PLAN);
  assert.equal(hunt.searchKey, buildSearchKey(PLAN));
  assert.equal(hunt.sheetId, "sheet_from_run");
  assert.equal(hunt.sourceRunId, "run_source");
  assert.equal(hunt.explorationShare, 0.3);
  assert.equal(hunt.nextRunAt, "2026-10-02T13:00:00.000Z");
  assert.equal(hunt.queuedAt, null);
  assert.equal(hunt.name, "product designer · remote");
  assert.deepEqual(hunt.runs, []);
  assert.equal("queuedTrigger" in hunt, false, "internal queue state stays off the wire");

  const listed = await app.send("GET", "/hunts");
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.hunts.map((entry: { id: string }) => entry.id), [hunt.id]);

  const duplicate = await app.send("POST", "/hunts", { searchPlan: PLAN });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "hunt_exists");
  assert.equal(duplicate.body.huntId, hunt.id);

  const missingRun = await app.send("POST", "/hunts", { fromRunId: "run_missing" });
  assert.equal(missingRun.status, 404);
  assert.equal(missingRun.body.code, "run_not_found");

  app.runStatusStore.put(runStatus("run_noplan", { searchPlan: undefined }));
  const noPlan = await app.send("POST", "/hunts", { fromRunId: "run_noplan" });
  assert.equal(noPlan.status, 409);
  assert.equal(noPlan.body.code, "run_has_no_search_plan");
});

test("HUNT-W: invalid hunt fields are refused with invalid_hunt", async () => {
  const app = makeApp();
  const cases: Array<[unknown, string]> = [
    [{ searchPlan: PLAN, explorationShare: 1.5 }, "explorationShare"],
    [{ searchPlan: PLAN, schedule: { kind: "every_n_hours", hour: 7, minute: 0 } }, "schedule"],
    [{ searchPlan: PLAN, timezone: "Mars/Olympus_Mons" }, "timezone"],
    [{ searchPlan: PLAN, tweaks: { color: "teal" } }, "tweaks"],
    [{ searchPlan: PLAN, status: "deleted" }, "status"],
    [{ searchPlan: PLAN, name: "x".repeat(121) }, "name"],
    [{ searchPlan: { planVersion: 1, generatedAt: "", seed: "", query: { locations: "Remote" } } }, "target roles"],
    [{ searchPlan: { planVersion: 2 } }, "searchPlan"],
    [{}, "fromRunId"],
  ];
  for (const [body, mention] of cases) {
    const response = await app.send("POST", "/hunts", body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.code, "invalid_hunt");
    assert.match(String(response.body.detail), new RegExp(mention, "i"));
  }
  const notJson = await app.send("POST", "/hunts", "{not json");
  assert.equal(notJson.status, 400);
  assert.equal(notJson.body.code, "invalid_json");
  assert.equal(app.store.count(), 0);
});

test("HUNT-W: edits apply to future runs, pausing clears the queue, and delete removes the hunt", async () => {
  const app = makeApp();
  const created = await app.send("POST", "/hunts", { searchPlan: PLAN, schedule: { kind: "daily", hour: 8, minute: 0 } });
  const id = created.body.hunt.id;

  const edited = await app.send("POST", `/hunts/${id}`, {
    tweaks: { locations: "Austin", keywordsExclude: "intern" },
    schedule: { kind: "every_n_hours", hour: 7, minute: 0, everyHours: 6 },
    explorationShare: 0.5,
    name: "Designer hunt",
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.hunt.effectivePlan.query.locations, "Austin");
  assert.equal(edited.body.hunt.searchPlan.query.locations, "Remote", "the saved plan is kept");
  assert.notEqual(edited.body.hunt.searchKey, created.body.hunt.searchKey);
  // 07:00 CDT now → the next every-6h slot is 13:00 CDT.
  assert.equal(edited.body.hunt.nextRunAt, "2026-10-02T18:00:00.000Z");
  assert.equal(edited.body.hunt.explorationShare, 0.5);
  assert.equal(edited.body.hunt.name, "Designer hunt");

  app.store.update({ ...app.store.get(id)!, queuedAt: "2026-10-02T11:59:00.000Z", queuedTrigger: "scheduled-hunt" });
  const paused = await app.send("POST", `/hunts/${id}`, { status: "paused" });
  assert.equal(paused.body.hunt.status, "paused");
  assert.equal(paused.body.hunt.nextRunAt, null);
  assert.equal(paused.body.hunt.queuedAt, null);

  const deleted = await app.send("POST", `/hunts/${id}/delete`);
  assert.deepEqual(
    { status: deleted.status, ok: deleted.body.ok, id: deleted.body.id, deleted: deleted.body.deleted },
    { status: 200, ok: true, id, deleted: true },
  );
  const gone = await app.send("GET", `/hunts/${id}`);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, "hunt_not_found");
});

test("HUNT-W: run now dispatches with trigger hunt and the caller's token, and the hunt shows the run", async () => {
  const app = makeApp();
  const created = await app.send("POST", "/hunts", { searchPlan: PLAN });
  const id = created.body.hunt.id;
  const ran = await app.send("POST", `/hunts/${id}/run`, { googleAccessToken: "ya29.example" });
  assert.equal(ran.status, 202);
  assert.equal(ran.body.kind, "accepted_async");
  assert.equal(ran.body.runId, "run_now_1");
  assert.equal(ran.body.huntId, id);
  assert.deepEqual(app.dispatched, [{ id, trigger: "hunt", token: "ya29.example" }]);

  // The run later ends write_failed holding two leads: awaiting a Sheet write.
  const lead = { title: "Designer", company: "Acme", url: "https://example.com/1" } as unknown as NormalizedLead;
  app.runStatusStore.put(runStatus("run_now_1", { status: "write_failed", selectedLeads: [lead, lead], headline: undefined } as never));
  const read = await app.send("GET", `/hunts/${id}`);
  assert.equal(read.body.hunt.lastRunId, "run_now_1");
  assert.equal(read.body.hunt.lastRunAt, "2026-10-02T12:00:00.000Z");
  assert.deepEqual(read.body.hunt.runs, [{
    runId: "run_now_1",
    trigger: "hunt",
    dispatchedAt: "2026-10-02T12:00:00.000Z",
    status: "write_failed",
    completedAt: "2026-10-01T13:20:00.000Z",
    awaitingSheetWrite: 2,
  }]);
});

test("HUNT-W: run now while another run is active queues the hunt instead of overlapping", async () => {
  const app = makeApp();
  const created = await app.send("POST", "/hunts", { searchPlan: PLAN, status: "paused" });
  app.state.busy = true;
  const queued = await app.send("POST", `/hunts/${created.body.hunt.id}/run`, {});
  assert.equal(queued.status, 202);
  assert.equal(queued.body.kind, "queued");
  assert.equal(queued.body.queuedAt, "2026-10-02T12:00:00.000Z");
  assert.equal(app.dispatched.length, 0);
  const stored = app.store.get(created.body.hunt.id);
  assert.equal(stored?.queuedTrigger, "hunt");
});

test("HUNT-W: the hitlist route ranks past runs and checks its limit", async () => {
  const app = makeApp();
  app.runStatusStore.put(runStatus("run_1", { completedAt: "2026-10-01T13:20:00.000Z" }));
  app.runStatusStore.put(runStatus("run_2", { startedAt: "2026-09-30T13:00:00.000Z", completedAt: "2026-09-30T13:20:00.000Z" }));
  app.runStatusStore.put(runStatus("run_3", {
    startedAt: "2026-09-29T13:00:00.000Z",
    searchPlan: { ...PLAN, facets: { roles: ["Writer"] }, query: { targetRoles: "Writer" } },
  }));
  const hitlist = await app.send("GET", "/hunts/hitlist?limit=5");
  assert.equal(hitlist.status, 200);
  assert.equal(hitlist.body.runsConsidered, 3);
  assert.equal(hitlist.body.generatedAt, "2026-10-02T12:00:00.000Z");
  assert.deepEqual(hitlist.body.clusters.map((cluster: { runCount: number; repeating: boolean }) => [cluster.runCount, cluster.repeating]), [[2, true], [1, false]]);
  for (const limit of ["0", "51", "two"]) {
    const bad = await app.send("GET", `/hunts/hitlist?limit=${limit}`);
    assert.equal(bad.status, 400, limit);
    assert.equal(bad.body.code, "invalid_limit");
  }
});

test("HUNT-W: wrong methods are 405 and unknown hunt paths are 404", async () => {
  const app = makeApp();
  assert.equal((await app.send("DELETE", "/hunts")).status, 405);
  assert.equal((await app.send("POST", "/hunts/hitlist")).status, 405);
  assert.equal((await app.send("GET", `/hunts/${HUNT_ID}/run`)).status, 405);
  assert.equal((await app.send("GET", "/hunts/not-a-hunt-id")).status, 404);
  assert.equal((await app.send("POST", `/hunts/${HUNT_ID}/run`, {})).status, 404);
});
