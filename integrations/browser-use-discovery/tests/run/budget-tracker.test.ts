import assert from "node:assert/strict";
import test from "node:test";

import { createBudgetTracker } from "../../src/run/budget-tracker.ts";

test("healthy budget checks do not persist unchanged checkpoints", () => {
  let checkpointCount = 0;
  const tracker = createBudgetTracker({
    maxRunDurationMs: 60_000,
    onCheckpoint() {
      checkpointCount += 1;
    },
  });

  assert.equal(tracker.checkCompanySkip("Healthy Co"), null);
  assert.equal(tracker.checkPageLimitReduction(10).diagnostic, null);
  assert.equal(checkpointCount, 0);
});

test("budget checks still checkpoint an adaptive skip decision", () => {
  let checkpointCount = 0;
  const tracker = createBudgetTracker({
    maxRunDurationMs: 1,
    safetyBufferMs: 1,
    onCheckpoint() {
      checkpointCount += 1;
    },
  });

  assert.equal(tracker.checkCompanySkip("Skipped Co")?.code, "budget_skip");
  assert.equal(checkpointCount, 1);
});
