import { unlinkSync } from "node:fs";
import { join } from "node:path";

import type { DiscoveryRunLogRow } from "../contracts.ts";
import { buildDiscoveryRunLogRowFromStatus } from "../sheets/discovery-runs-writer.ts";
import {
  listRunStatusSnapshots,
  type DiscoveryRunStatusStore,
} from "../state/run-status-store.ts";

/**
 * Worker boot-time run-status housekeeping, side-effect free until called.
 *
 * BEAUDIT A5: a worker restart mid-run terminalized the status as `failed`
 * (markNonTerminalRunsAbandoned) but wrote no DiscoveryRuns row, so the run
 * vanished from Sheet history (RUN-05 residual). recoverAbandonedRuns writes
 * that row, best-effort, through the same builder the live paths use.
 *
 * BEAUDIT A17: run-status retention was unbounded; every run left a snapshot
 * that loaded at every boot. pruneRunStatusSnapshots drops terminal
 * snapshots past an age limit or beyond a newest-N cap. Live runs are never
 * pruned.
 */

export const DEFAULT_RUN_STATUS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_RUN_STATUS_KEEP = 200;

type RunsLogger = {
  append(sheetId: string, row: DiscoveryRunLogRow): Promise<unknown>;
};

// Mirrors run-status-store.ts's private filename encoding (base64url runId).
function snapshotFilename(runId: string): string {
  return `${Buffer.from(runId, "utf8").toString("base64url")}.json`;
}

/** An `/ingest-url` async run is not a discovery run and has no history row. */
function isIngestRun(status: { runId: string; request?: { variationKey?: string } }) {
  return (
    status.request?.variationKey === "ingest_url" ||
    String(status.runId || "").startsWith("ingest_")
  );
}

export async function recoverAbandonedRuns(input: {
  store: DiscoveryRunStatusStore;
  snapshotDirectory: string;
  now(): Date;
  source: string;
  discoveryRunsLogger?: RunsLogger | null;
  log?(event: string, details: Record<string, unknown>): void;
}): Promise<{ abandoned: number; historyWritten: number }> {
  const pendingRunIds = listRunStatusSnapshots(input.snapshotDirectory)
    .filter((snapshot) => !snapshot.status.terminal)
    .map((snapshot) => snapshot.runId);
  const abandoned =
    input.store.markNonTerminalRunsAbandoned?.(input.now().toISOString()) ?? 0;
  let historyWritten = 0;
  if (!input.discoveryRunsLogger) return { abandoned, historyWritten };
  for (const runId of pendingRunIds) {
    const status = input.store.get(runId);
    if (!status || !status.terminal || isIngestRun(status)) continue;
    const sheetId = String(status.request?.sheetId || "").trim();
    if (!sheetId) continue;
    try {
      await input.discoveryRunsLogger.append(
        sheetId,
        buildDiscoveryRunLogRowFromStatus(status, { source: input.source }),
      );
      historyWritten += 1;
    } catch (error) {
      input.log?.("discovery.run_status.abandoned_history_failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { abandoned, historyWritten };
}

export function pruneRunStatusSnapshots(
  snapshotDirectory: string,
  options: {
    now?: () => Date;
    maxAgeMs?: number;
    keep?: number;
    log?(event: string, details: Record<string, unknown>): void;
  } = {},
): number {
  const directory = String(snapshotDirectory || "").trim();
  if (!directory || directory === ":memory:") return 0;
  const nowMs = (options.now ? options.now() : new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_RUN_STATUS_MAX_AGE_MS;
  const keep = Math.max(0, options.keep ?? DEFAULT_RUN_STATUS_KEEP);
  const terminal = listRunStatusSnapshots(directory)
    .filter((snapshot) => snapshot.status.terminal)
    .map((snapshot) => ({
      runId: snapshot.runId,
      at: Date.parse(snapshot.status.updatedAt || snapshot.writtenAt) || 0,
    }))
    .sort((a, b) => b.at - a.at);
  let pruned = 0;
  terminal.forEach((entry, index) => {
    const tooOld = nowMs - entry.at > maxAgeMs;
    if (index < keep && !tooOld) return;
    try {
      unlinkSync(join(directory, snapshotFilename(entry.runId)));
      pruned += 1;
    } catch (error) {
      options.log?.("discovery.run_status.prune_failed", {
        runId: entry.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return pruned;
}
