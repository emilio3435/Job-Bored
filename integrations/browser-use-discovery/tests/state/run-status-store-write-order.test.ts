// BEAUDIT A2 (store half): a terminal status whose snapshot write fails must
// not become terminal in memory, or the retry is swallowed as
// "terminal_immutable_ignored" and the next boot flips the run to failed.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildAcceptedRunStatus,
  buildRunningRunStatus,
  createDiscoveryRunStatusStore,
} from "../../src/state/run-status-store.ts";

test("A2: a failed disk write leaves the in-memory status unchanged, so a retry lands", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-status-order-"));
  try {
    const store = createDiscoveryRunStatusStore(dir);
    const accepted = buildAcceptedRunStatus({
      runId: "run_order",
      trigger: "manual",
      request: { sheetId: "sheet", variationKey: "var", requestedAt: "2026-09-25T10:00:00.000Z" },
      acceptedAt: "2026-09-25T10:00:00.000Z",
    });
    const running = buildRunningRunStatus(accepted, "2026-09-25T10:00:01.000Z");
    store.put(running as never);
    const completed = {
      ...running,
      status: "completed",
      terminal: true,
      message: "done",
      completedAt: "2026-09-25T10:00:02.000Z",
      updatedAt: "2026-09-25T10:00:02.000Z",
    };

    chmodSync(dir, 0o500);
    assert.throws(() => store.put(completed as never));
    chmodSync(dir, 0o700);

    assert.equal(store.get("run_order")?.status, "running", "memory must not run ahead of disk");
    store.put(completed as never);
    assert.equal(store.get("run_order")?.status, "completed");
    const reloaded = createDiscoveryRunStatusStore(dir);
    assert.equal(reloaded.get("run_order")?.status, "completed");
  } finally {
    try {
      chmodSync(dir, 0o700);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
