// HOLES HUNT-W: GET /runs summaries carry the plan a run executed, its search
// key, its exploration yield and any leads awaiting a Sheet write
// (docs/INTERFACE-HUNTS.md §5–§6). Every field is optional.
import assert from "node:assert/strict";
import test from "node:test";

import type { DiscoveryRunExploration, DiscoverySearchPlan, NormalizedLead } from "../../src/contracts.ts";
import {
  createDiscoveryRunStatusStore,
  type DurableDiscoveryRunStatusPayload,
} from "../../src/state/run-status-store.ts";
import { buildSearchKey } from "../../src/state/hunt-store.ts";

const PLAN: DiscoverySearchPlan = {
  planVersion: 1,
  generatedAt: "2026-10-02T08:00:00.000Z",
  seed: "seed",
  query: { targetRoles: "Product Designer", locations: "Remote" },
};

const EXPLORATION: DiscoveryRunExploration = {
  share: 0.3,
  reservedSlots: 1,
  slotCount: 3,
  slots: [
    { index: 0, kind: "company", key: "newco", label: "NewCo", mode: "explore", listingsSeen: 4, leadsWritten: 1 },
    { index: 1, kind: "company", key: "acme", label: "Acme", mode: "exploit", listingsSeen: 9, leadsWritten: 2 },
  ],
  totals: {
    explore: { slots: 1, listingsSeen: 4, leadsWritten: 1 },
    exploit: { slots: 1, listingsSeen: 9, leadsWritten: 2 },
  },
};

function status(runId: string, overrides: Partial<DurableDiscoveryRunStatusPayload> = {}): DurableDiscoveryRunStatusPayload {
  return {
    runId,
    status: "completed",
    terminal: true,
    message: "done",
    trigger: "scheduled",
    request: { sheetId: "sheet_1", variationKey: `var_${runId}`, requestedAt: "2026-10-02T08:00:00.000Z" },
    acceptedAt: "2026-10-02T08:00:00.000Z",
    startedAt: `2026-10-02T08:0${runId.length % 10}:00.000Z`,
    completedAt: "2026-10-02T08:30:00.000Z",
    updatedAt: "2026-10-02T08:30:00.000Z",
    warnings: [],
    sources: [],
    ...overrides,
  };
}

const lead = { title: "Designer", company: "Acme", url: "https://example.com/jobs/1" } as unknown as NormalizedLead;

test("HUNT-W: a run summary carries the plan the run executed and its search key", () => {
  const store = createDiscoveryRunStatusStore(":memory:");
  store.put(status("run_plan", { searchPlan: PLAN }));
  store.put(status("run_noplan_x"));
  const runs = store.list()?.runs || [];
  const withPlan = runs.find((run) => run.runId === "run_plan");
  const without = runs.find((run) => run.runId === "run_noplan_x");
  assert.deepEqual(withPlan?.searchPlan, PLAN);
  assert.equal(withPlan?.searchKey, buildSearchKey(PLAN));
  assert.equal("searchPlan" in (without || {}), false);
  assert.equal("searchKey" in (without || {}), false);
});

test("HUNT-W: a run summary exposes the explore/exploit yield the run recorded", () => {
  const store = createDiscoveryRunStatusStore(":memory:");
  store.put(status("run_explored", {
    lifecycle: {
      runId: "run_explored",
      trigger: "scheduled",
      startedAt: "2026-10-02T08:00:00.000Z",
      completedAt: "2026-10-02T08:30:00.000Z",
      state: "completed",
      companyCount: 3,
      detectionCount: 2,
      listingCount: 13,
      normalizedLeadCount: 3,
      exploration: EXPLORATION,
    },
  }));
  store.put(status("run_plain_yy"));
  const runs = store.list()?.runs || [];
  assert.deepEqual(runs.find((run) => run.runId === "run_explored")?.yield, {
    explorationShare: 0.3,
    explore: { slots: 1, listingsSeen: 4, leadsWritten: 1 },
    exploit: { slots: 1, listingsSeen: 9, leadsWritten: 2 },
  });
  assert.equal("yield" in (runs.find((run) => run.runId === "run_plain_yy") || {}), false);
});

test("HUNT-W: a write_failed run that holds leads is awaiting a Sheet write until the flush lands", () => {
  const store = createDiscoveryRunStatusStore(":memory:");
  store.put(status("run_held", { status: "write_failed", selectedLeads: [lead, lead] }));
  store.put(status("run_written"));
  let runs = store.list()?.runs || [];
  assert.deepEqual(runs.find((run) => run.runId === "run_held")?.awaitingSheetWrite, { leads: 2 });
  assert.equal("awaitingSheetWrite" in (runs.find((run) => run.runId === "run_written") || {}), false);

  store.finishWriteRetry(status("run_held", { status: "completed" }));
  runs = store.list()?.runs || [];
  assert.equal("awaitingSheetWrite" in (runs.find((run) => run.runId === "run_held") || {}), false);
});
