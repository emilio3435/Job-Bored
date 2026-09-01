import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRetryBroadeningGate,
  shouldExecuteRetryRung,
} from "../../src/run/retry-broadening.ts";

test("F4B-RUN06-RETRY: applyRetryBroadeningGate keeps only the focused rung when disabled", () => {
  const ladder = [
    { query: "focused", rung: 0, terminal: false },
    { query: "drop-location", rung: 1, terminal: false },
    { query: "broaden", rung: 2, terminal: true },
  ];

  const gated = applyRetryBroadeningGate(ladder, false);

  assert.equal(gated.length, 1);
  assert.equal(gated[0].rung, 0);
  assert.equal(gated[0].query, "focused");
  assert.equal(gated[0].terminal, true);
});

test("F4B-RUN06-RETRY: applyRetryBroadeningGate preserves the full ladder when enabled", () => {
  const ladder = [
    { query: "focused", rung: 0, terminal: false },
    { query: "broaden", rung: 2, terminal: true },
  ];

  const gated = applyRetryBroadeningGate(ladder, true);

  assert.equal(gated.length, 2);
  assert.equal(gated[1].rung, 2);
});

test("F4B-RUN06-RETRY: shouldExecuteRetryRung forbids broadening rungs when disabled", () => {
  assert.equal(shouldExecuteRetryRung(0, false), true);
  assert.equal(shouldExecuteRetryRung(1, false), false);
  assert.equal(shouldExecuteRetryRung(2, false), false);
  assert.equal(shouldExecuteRetryRung(1, true), true);
});
