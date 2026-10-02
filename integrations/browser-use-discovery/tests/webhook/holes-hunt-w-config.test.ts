// HOLES HUNT-W: the worker's hunts config block (scheduler switch, tick, and
// the §0.10 default exploration share). A plain env object skips the .env file.
import assert from "node:assert/strict";
import test from "node:test";

import { loadRuntimeConfig } from "../../src/config.ts";

test("HUNT-W: hunts default to a running 60 s scheduler and a 0.3 exploration share", () => {
  assert.deepEqual(loadRuntimeConfig({}).hunts, {
    schedulerEnabled: true,
    tickMs: 60_000,
    explorationShare: 0.3,
  });
});

test("HUNT-W: env turns the scheduler off and sets the tick and the share", () => {
  assert.deepEqual(
    loadRuntimeConfig({
      BROWSER_USE_DISCOVERY_HUNT_SCHEDULER: "0",
      BROWSER_USE_DISCOVERY_HUNT_TICK_MS: "30000",
      BROWSER_USE_DISCOVERY_EXPLORATION_SHARE: "0.5",
    }).hunts,
    { schedulerEnabled: false, tickMs: 30_000, explorationShare: 0.5 },
  );
  assert.equal(loadRuntimeConfig({ BROWSER_USE_DISCOVERY_EXPLORATION_SHARE: "0" }).hunts?.explorationShare, 0);
  assert.equal(loadRuntimeConfig({ BROWSER_USE_DISCOVERY_EXPLORATION_SHARE: "1" }).hunts?.explorationShare, 1);
});

test("HUNT-W: a share outside 0–1 falls back to 0.3 rather than meaning 100%", () => {
  for (const raw of ["30", "1.7", "-0.1", "abc", ""]) {
    assert.equal(
      loadRuntimeConfig({ BROWSER_USE_DISCOVERY_EXPLORATION_SHARE: raw }).hunts?.explorationShare,
      0.3,
      raw,
    );
  }
});
