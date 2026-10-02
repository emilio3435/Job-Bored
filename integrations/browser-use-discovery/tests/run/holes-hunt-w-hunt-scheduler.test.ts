// HOLES HUNT-W §0.9: the in-worker hunt scheduler (docs/INTERFACE-HUNTS.md §4).
// Every test drives a fake clock; nothing waits on wall time.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createHuntScheduler,
  DEFAULT_HUNT_TICK_MS,
  nextHuntSlotAfter,
  type HuntDispatchOutcome,
} from "../../src/scheduler/hunt-scheduler.ts";
import {
  openHuntStore,
  type HuntRecord,
  type HuntRunTrigger,
  type HuntStore,
} from "../../src/state/hunt-store.ts";

const CHICAGO = "America/Chicago";

function hunt(id: string, overrides: Partial<HuntRecord> = {}): HuntRecord {
  return {
    id,
    name: id,
    status: "active",
    searchPlan: { planVersion: 1, generatedAt: "", seed: "", query: { targetRoles: "Designer" } },
    tweaks: {},
    explorationShare: 0.3,
    schedule: { kind: "daily", hour: 8, minute: 0 },
    timezone: CHICAGO,
    sheetId: "sheet_hunt",
    sourceRunId: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    nextRunAt: "2026-10-02T13:00:00.000Z",
    queuedAt: null,
    queuedTrigger: null,
    lastRunAt: null,
    lastRunId: null,
    lastError: null,
    ...overrides,
  };
}

function harness(store: HuntStore, start: string) {
  const clock = { at: new Date(start) };
  const busy = { value: false };
  const dispatched: Array<{ id: string; trigger: HuntRunTrigger }> = [];
  const outcomes: HuntDispatchOutcome[] = [];
  let seq = 0;
  const scheduler = createHuntScheduler({
    store,
    now: () => clock.at,
    isRunActive: () => busy.value,
    async dispatch(record, trigger) {
      dispatched.push({ id: record.id, trigger });
      const next = outcomes.shift();
      if (next) return next;
      busy.value = true; // the run it starts makes the worker busy
      return { ok: true, status: 202, runId: `run_${(seq += 1)}` };
    },
  });
  return { clock, busy, dispatched, outcomes, scheduler };
}

test("HUNT-W: slots follow the hunt's schedule in its own timezone", () => {
  const daily = { kind: "daily" as const, hour: 8, minute: 0 };
  // 07:00 CDT → 08:00 CDT the same day.
  assert.equal(nextHuntSlotAfter(daily, CHICAGO, new Date("2026-10-02T12:00:00.000Z"))?.toISOString(), "2026-10-02T13:00:00.000Z");
  // Exactly on the slot → the next day's slot (strictly after).
  assert.equal(nextHuntSlotAfter(daily, CHICAGO, new Date("2026-10-02T13:00:00.000Z"))?.toISOString(), "2026-10-03T13:00:00.000Z");
  // Across the November DST change: 08:00 CST is 14:00Z.
  assert.equal(nextHuntSlotAfter(daily, CHICAGO, new Date("2026-10-31T14:00:00.000Z"))?.toISOString(), "2026-11-01T14:00:00.000Z");
  // Weekdays: Friday 09:00 CDT → Monday 08:00 CDT.
  const weekdays = { kind: "weekdays" as const, hour: 8, minute: 0 };
  assert.equal(nextHuntSlotAfter(weekdays, CHICAGO, new Date("2026-10-02T14:00:00.000Z"))?.toISOString(), "2026-10-05T13:00:00.000Z");
  // Every 6 h at 07:00 → 01:00, 07:00, 13:00, 19:00 local; 07:30 → 13:00 CDT.
  const every6 = { kind: "every_n_hours" as const, hour: 7, minute: 0, everyHours: 6 };
  assert.equal(nextHuntSlotAfter(every6, CHICAGO, new Date("2026-10-02T12:30:00.000Z"))?.toISOString(), "2026-10-02T18:00:00.000Z");
  // 19:30 CDT → 01:00 CDT next day.
  assert.equal(nextHuntSlotAfter(every6, CHICAGO, new Date("2026-10-03T00:30:00.000Z"))?.toISOString(), "2026-10-03T06:00:00.000Z");
  assert.equal(nextHuntSlotAfter({ kind: "off", hour: 8, minute: 0 }, CHICAGO, new Date()), null);
  assert.equal(nextHuntSlotAfter(daily, "UTC", new Date("2026-10-02T09:00:00.000Z"))?.toISOString(), "2026-10-03T08:00:00.000Z");
});

test("HUNT-W: a due hunt fires with trigger scheduled-hunt and moves to its next slot", async () => {
  const store = openHuntStore(":memory:");
  try {
    store.insert(hunt("hunt_due"));
    store.insert(hunt("hunt_later", { nextRunAt: "2026-10-02T20:00:00.000Z" }));
    const { scheduler, dispatched, clock } = harness(store, "2026-10-02T13:00:30.000Z");
    const result = await scheduler.tick();
    assert.equal(result.fired, "hunt_due");
    assert.deepEqual(dispatched, [{ id: "hunt_due", trigger: "scheduled-hunt" }]);
    const fired = store.get("hunt_due");
    assert.equal(fired?.lastRunId, "run_1");
    assert.equal(fired?.lastRunAt, clock.at.toISOString());
    assert.equal(fired?.nextRunAt, "2026-10-03T13:00:00.000Z");
    assert.deepEqual(store.listRuns("hunt_due").map((run) => [run.runId, run.trigger]), [["run_1", "scheduled-hunt"]]);
    assert.equal(store.get("hunt_later")?.lastRunId, null);
  } finally {
    store.close();
  }
});

test("HUNT-W: due hunts queue while a run is active and fire one per tick once idle, queued first", async () => {
  const store = openHuntStore(":memory:");
  try {
    store.insert(hunt("hunt_a", { nextRunAt: "2026-10-02T13:00:00.000Z" }));
    store.insert(hunt("hunt_b", { nextRunAt: "2026-10-02T12:00:00.000Z" }));
    const { scheduler, dispatched, busy, clock } = harness(store, "2026-10-02T13:00:30.000Z");
    busy.value = true;
    const first = await scheduler.tick();
    assert.equal(first.fired, null);
    assert.deepEqual([...first.queued].sort(), ["hunt_a", "hunt_b"]);
    assert.equal(dispatched.length, 0);
    assert.equal(store.get("hunt_a")?.queuedAt, clock.at.toISOString());

    // Still busy a minute later: nothing is dropped, nothing fires.
    clock.at = new Date("2026-10-02T13:01:30.000Z");
    await scheduler.tick();
    assert.equal(dispatched.length, 0);
    assert.equal(store.get("hunt_b")?.queuedAt, "2026-10-02T13:00:30.000Z");

    // Idle: the most overdue queued hunt fires; its run makes the worker busy.
    busy.value = false;
    clock.at = new Date("2026-10-02T13:02:30.000Z");
    assert.equal((await scheduler.tick()).fired, "hunt_b");
    assert.equal(store.get("hunt_b")?.queuedAt, null);
    assert.equal((await scheduler.tick()).fired, null);
    assert.ok(store.get("hunt_a")?.queuedAt);

    busy.value = false;
    clock.at = new Date("2026-10-02T13:30:00.000Z");
    assert.equal((await scheduler.tick()).fired, "hunt_a");
    assert.deepEqual(dispatched.map((entry) => entry.id), ["hunt_b", "hunt_a"]);
  } finally {
    store.close();
  }
});

test("HUNT-W: missed slots coalesce into one run", async () => {
  const store = openHuntStore(":memory:");
  try {
    store.insert(hunt("hunt_missed", { nextRunAt: "2026-09-29T13:00:00.000Z" }));
    const { scheduler, dispatched } = harness(store, "2026-10-02T15:00:00.000Z");
    await scheduler.tick();
    await scheduler.tick();
    assert.equal(dispatched.length, 1);
    assert.equal(store.get("hunt_missed")?.nextRunAt, "2026-10-03T13:00:00.000Z");
  } finally {
    store.close();
  }
});

test("HUNT-W: the schedule survives a worker restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hunt-scheduler-"));
  const path = join(dir, "worker-state.sqlite");
  try {
    const before = openHuntStore(path);
    before.insert(hunt("hunt_overdue"));
    before.insert(hunt("hunt_queued", { nextRunAt: "2026-10-02T20:00:00.000Z", queuedAt: "2026-10-02T12:30:00.000Z", queuedTrigger: "hunt" }));
    before.close();

    const after = openHuntStore(path);
    try {
      const { scheduler, dispatched, busy } = harness(after, "2026-10-02T13:05:00.000Z");
      // Boot tick: the queued run-now goes first, with its own trigger.
      assert.equal((await scheduler.tick()).fired, "hunt_queued");
      busy.value = false;
      assert.equal((await scheduler.tick()).fired, "hunt_overdue");
      assert.deepEqual(dispatched, [
        { id: "hunt_queued", trigger: "hunt" },
        { id: "hunt_overdue", trigger: "scheduled-hunt" },
      ]);
      // A queued run-now on an active hunt keeps the hunt's future slot.
      assert.equal(after.get("hunt_queued")?.nextRunAt, "2026-10-02T20:00:00.000Z");
    } finally {
      after.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HUNT-W: a refused dispatch records the reason and waits for the next slot", async () => {
  const store = openHuntStore(":memory:");
  try {
    store.insert(hunt("hunt_refused", { queuedAt: "2026-10-02T12:59:00.000Z", queuedTrigger: "scheduled-hunt" }));
    const { scheduler, dispatched, outcomes } = harness(store, "2026-10-02T13:00:30.000Z");
    outcomes.push({ ok: false, status: 400, message: "Discovery intent cannot be blank." });
    const result = await scheduler.tick();
    assert.equal(result.fired, null);
    const refused = store.get("hunt_refused");
    assert.equal(refused?.lastError, "Discovery intent cannot be blank.");
    assert.equal(refused?.queuedAt, null);
    assert.equal(refused?.nextRunAt, "2026-10-03T13:00:00.000Z");
    // No retry storm: the next tick does nothing.
    await scheduler.tick();
    assert.equal(dispatched.length, 1);
    assert.deepEqual(store.listRuns("hunt_refused"), []);
  } finally {
    store.close();
  }
});

test("HUNT-W: a dispatch that finds the worker busy keeps the hunt queued", async () => {
  const store = openHuntStore(":memory:");
  try {
    store.insert(hunt("hunt_race"));
    const { scheduler, outcomes, clock } = harness(store, "2026-10-02T13:00:30.000Z");
    outcomes.push({ ok: false, status: 409, busy: true, message: "A discovery run is active." });
    await scheduler.tick();
    const raced = store.get("hunt_race");
    assert.equal(raced?.queuedAt, clock.at.toISOString());
    assert.equal(raced?.queuedTrigger, "scheduled-hunt");
    assert.equal(raced?.lastError, null);
  } finally {
    store.close();
  }
});

test("HUNT-W: paused hunts and schedule off never fire on their own", async () => {
  const store = openHuntStore(":memory:");
  try {
    store.insert(hunt("hunt_paused", { status: "paused" }));
    store.insert(hunt("hunt_off", { schedule: { kind: "off", hour: 8, minute: 0 } }));
    const { scheduler, dispatched } = harness(store, "2026-10-02T13:00:30.000Z");
    await scheduler.tick();
    assert.deepEqual(dispatched, []);
  } finally {
    store.close();
  }
});

test("HUNT-W: start ticks at boot and every 60 s; stop clears the timer", async () => {
  const store = openHuntStore(":memory:");
  try {
    store.insert(hunt("hunt_timer", { nextRunAt: "2026-10-02T13:01:00.000Z" }));
    const clock = { at: new Date("2026-10-02T13:00:30.000Z") };
    const timers: Array<{ handler: () => void; ms: number; cleared: boolean }> = [];
    const dispatched: string[] = [];
    const scheduler = createHuntScheduler({
      store,
      now: () => clock.at,
      isRunActive: () => false,
      async dispatch(record) {
        dispatched.push(record.id);
        return { ok: true, status: 202, runId: "run_timer" };
      },
      setInterval(handler, ms) {
        const timer = { handler, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearInterval(handle) {
        (handle as { cleared: boolean }).cleared = true;
      },
    });
    scheduler.start();
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, DEFAULT_HUNT_TICK_MS);
    assert.equal(DEFAULT_HUNT_TICK_MS, 60_000);
    await scheduler.tick(); // the boot tick already ran; nothing was due
    assert.deepEqual(dispatched, []);

    clock.at = new Date("2026-10-02T13:01:30.000Z");
    timers[0].handler();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(dispatched, ["hunt_timer"]);

    scheduler.stop();
    assert.equal(timers[0].cleared, true);
  } finally {
    store.close();
  }
});
