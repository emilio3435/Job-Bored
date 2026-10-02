import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStorage, loadDiscoveryTab, runStatusBody } from "./holes-disco-harness.mjs";

/* HOLES DISCO — what a finished run says about itself. */

function finish(tab, writeResult, overrides = {}) {
  tab.tracker.beginTracking({ runId: "run_f", statusPath: "/runs/run_f", webhookUrl: tab.webhookUrl });
  tab.tracker.updateFromStatusResponse(
    runStatusBody("run_f", {
      status: "completed",
      terminal: true,
      startedAt: "2026-10-02T12:00:05.000Z",
      completedAt: "2026-10-02T12:03:05.000Z",
      writeResult,
      ...overrides,
    }),
  );
}

describe("D15 · the completion toast counts new roles, not updates", () => {
  const cases = [
    [{ appended: 3, updated: 2 }, "Found 3 new roles · 2 updated."],
    [{ appended: 1, updated: 0 }, "Found 1 new role."],
    [{ appended: 0, updated: 2 }, "No new roles this run · 2 updated."],
    [{ appended: 0, updated: 0 }, "Discovery finished — no new roles this run."],
  ];
  for (const [writeResult, expected] of cases) {
    it(`appended ${writeResult.appended}, updated ${writeResult.updated} → "${expected}"`, () => {
      const tab = loadDiscoveryTab();
      finish(tab, writeResult);
      tab.status.renderDiscoveryRunStatus();
      assert.equal(tab.toasts.at(-1).message, expected);
    });
  }

  it("a stored outcome after a reload makes no claim the counts don't back", () => {
    const storage = createStorage();
    const first = loadDiscoveryTab({ storage });
    finish(first, { appended: 0, updated: 2 });
    const reload = loadDiscoveryTab({ storage, clock: first.clock });
    reload.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.equal(reload.toasts.length, 1);
    assert.equal(reload.toasts[0].message, "Last discovery run finished — no new roles · 2 updated.");
  });

  it("a stored outcome with new roles counts them", () => {
    const storage = createStorage();
    const first = loadDiscoveryTab({ storage });
    finish(first, { appended: 3, updated: 1 });
    const reload = loadDiscoveryTab({ storage, clock: first.clock });
    reload.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.equal(reload.toasts[0].message, "Last discovery run finished — 3 new roles · 1 updated.");
  });
});

describe("D18 · the local history row carries the run's real duration", () => {
  it("measures startedAt → completedAt instead of 0 s", () => {
    const tab = loadDiscoveryTab();
    finish(tab, { appended: 1, updated: 0 });
    assert.equal(tab.tracker.toHistoryRow().durationS, 180);
  });

  it("falls back to when the browser started tracking", () => {
    const tab = loadDiscoveryTab();
    tab.tracker.beginTracking({ runId: "run_g", statusPath: "/runs/run_g", webhookUrl: tab.webhookUrl });
    tab.tracker.updateFromStatusResponse(
      runStatusBody("run_g", {
        status: "failed",
        terminal: true,
        startedAt: "",
        completedAt: new tab.ctx.Date(tab.clock.now() + 42000).toISOString(),
        error: "Worker restarted",
      }),
    );
    assert.equal(tab.tracker.toHistoryRow().durationS, 42);
  });
});
