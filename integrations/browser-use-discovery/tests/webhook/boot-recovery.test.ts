// BEAUDIT A5: a worker restart mid-run must leave a DiscoveryRuns history row
// for the abandoned run (probes/A/lifecycle.mts `[restart] historyRowsWritten=0`).
// BEAUDIT A17: terminal run-status snapshots are pruned at boot.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildAcceptedRunStatus,
  buildRunningRunStatus,
  createDiscoveryRunStatusStore,
} from "../../src/state/run-status-store.ts";
import {
  pruneRunStatusSnapshots,
  recoverAbandonedRuns,
} from "../../src/webhook/boot-recovery.ts";

function running(runId: string, variationKey = "var-boot", sheetId = "sheet-boot") {
  const accepted = buildAcceptedRunStatus({
    runId,
    trigger: "manual",
    request: { sheetId, variationKey, requestedAt: "2026-09-25T10:00:00.000Z" },
    acceptedAt: "2026-09-25T10:00:00.000Z",
  });
  return buildRunningRunStatus(accepted, "2026-09-25T10:00:01.000Z");
}

function terminal(runId: string, updatedAt: string) {
  return {
    ...running(runId),
    status: "completed",
    terminal: true,
    message: "done",
    completedAt: updatedAt,
    updatedAt,
  };
}

test("A5: boot recovery terminalizes abandoned runs and writes one history row each", async () => {
  const dir = mkdtempSync(join(tmpdir(), "boot-recovery-"));
  try {
    const before = createDiscoveryRunStatusStore(dir);
    before.put(running("run_mid") as never);
    before.put(running("ingest_mid", "ingest_url") as never);
    before.put(terminal("run_done", "2026-09-25T10:05:00.000Z") as never);

    // Simulated restart.
    const store = createDiscoveryRunStatusStore(dir);
    const rows: Array<{ sheetId: string; row: Record<string, unknown> }> = [];
    const result = await recoverAbandonedRuns({
      store,
      snapshotDirectory: dir,
      now: () => new Date("2026-09-25T11:00:00.000Z"),
      source: "worker@boot",
      discoveryRunsLogger: {
        append: async (sheetId: string, row: unknown) => {
          rows.push({ sheetId, row: row as Record<string, unknown> });
          return { ok: true } as never;
        },
      },
    });

    assert.equal(result.abandoned, 2);
    assert.equal(store.get("run_mid")?.status, "failed");
    assert.equal(store.get("ingest_mid")?.status, "failed");
    assert.equal(rows.length, 1, "only the discovery run gets a DiscoveryRuns row");
    assert.equal(rows[0].sheetId, "sheet-boot");
    assert.equal(rows[0].row.status, "failure");
    assert.match(String(rows[0].row.error), /restarted/i);
    assert.equal(result.historyWritten, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A5: a failing history logger never blocks boot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "boot-recovery-"));
  try {
    createDiscoveryRunStatusStore(dir).put(running("run_mid") as never);
    const store = createDiscoveryRunStatusStore(dir);
    const events: string[] = [];
    const result = await recoverAbandonedRuns({
      store,
      snapshotDirectory: dir,
      now: () => new Date(),
      source: "worker@boot",
      log: (event) => events.push(event),
      discoveryRunsLogger: {
        append: async () => {
          throw new Error("Sheets 401");
        },
      },
    });
    assert.equal(result.abandoned, 1);
    assert.equal(result.historyWritten, 0);
    assert.ok(events.includes("discovery.run_status.abandoned_history_failed"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A17: boot prune drops terminal snapshots past the age limit and beyond the keep cap, never live runs", () => {
  const dir = mkdtempSync(join(tmpdir(), "boot-prune-"));
  try {
    const store = createDiscoveryRunStatusStore(dir);
    store.put(terminal("run_old", "2026-06-01T00:00:00.000Z") as never);
    for (let i = 0; i < 5; i += 1) {
      store.put(terminal(`run_recent_${i}`, `2026-09-2${i}T00:00:00.000Z`) as never);
    }
    store.put(running("run_live") as never);
    assert.equal(readdirSync(dir).length, 7);

    const pruned = pruneRunStatusSnapshots(dir, {
      now: () => new Date("2026-09-25T12:00:00.000Z"),
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      keep: 3,
    });
    assert.equal(pruned, 3, "one aged out, two beyond the newest three");

    const reloaded = createDiscoveryRunStatusStore(dir);
    assert.equal(reloaded.get("run_old"), null);
    assert.equal(reloaded.get("run_recent_0"), null);
    assert.equal(reloaded.get("run_recent_1"), null);
    assert.ok(reloaded.get("run_recent_4"));
    assert.ok(reloaded.get("run_live"), "a non-terminal run is never pruned");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
