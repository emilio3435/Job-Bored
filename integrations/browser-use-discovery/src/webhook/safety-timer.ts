import type { DiscoveryRunStatusPayload } from "../contracts.ts";
import type { DiscoveryRunStatusStore } from "../state/run-status-store.ts";

/**
 * Shared async-run safety backstop.
 *
 * Guarantees that an async run STATUS row becomes terminal even if the
 * background `.then`/`.catch` never fires. Both `/webhook` (discovery runs)
 * and `/ingest-url` async paths use this so pollers never wedge waiting on a
 * stuck task.
 *
 * The timer only writes the run status. It does not cancel in-flight work —
 * downstream per-source timeouts and run-budget enforcement provide the real
 * cancellation. The status message and warning are intentionally worded to
 * avoid claiming a forcible kill.
 */
export type SafetyTimerMode = "async" | "ingest_url_async";

export type SafetyTimerOptions = {
  runId: string;
  runMode: SafetyTimerMode;
  maxRunDurationMs: number;
  runStatusStore?: DiscoveryRunStatusStore;
  acceptedStatus: DiscoveryRunStatusPayload;
  now(): Date;
  log?(event: string, details: Record<string, unknown>): void;
};

export type SafetyTimerHandle = {
  /** True after the timer has written a terminal status, OR after callers
   * mark the run terminal via `markTerminal()` from a real completion path.
   * Callers MUST check this before writing their own terminal status so they
   * do not race with (and overwrite) the safety-timer's "partial" row. */
  isTerminalStatusWritten(): boolean;
  /** Mark the status terminal so the safety timer becomes a no-op. Used by
   * real completion/failure paths after they write their own status. */
  markTerminal(): void;
  /** Schedule the safety timer. Idempotent: re-scheduling has no effect. */
  schedule(): void;
  /** Cancel a scheduled timer if it is still pending. */
  clear(): void;
};

export function createSafetyTimer(
  options: SafetyTimerOptions,
): SafetyTimerHandle {
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let terminalStatusWritten = false;

  const schedule = () => {
    if (safetyTimer !== null) return;
    safetyTimer = setTimeout(() => {
      if (terminalStatusWritten) return;
      terminalStatusWritten = true;
      const currentStatus =
        options.runStatusStore?.get(options.runId) ?? options.acceptedStatus;
      const nowIso = options.now().toISOString();
      options.runStatusStore?.put({
        ...currentStatus,
        status: "partial",
        terminal: true,
        message:
          "Discovery run exceeded its maximum duration; reporting partial results.",
        completedAt: nowIso,
        updatedAt: nowIso,
        warnings: [
          ...(currentStatus.warnings || []),
          `Run marked terminal after ${options.maxRunDurationMs}ms. Sources still finishing in the background are bounded by the run budget and per-source timeouts.`,
        ],
      });
      options.log?.("discovery.run.force_terminalized", {
        runId: options.runId,
        mode: options.runMode,
        maxRunDurationMs: options.maxRunDurationMs,
        reason: "safety_timeout",
      });
    }, options.maxRunDurationMs);
  };

  const clear = () => {
    if (safetyTimer !== null) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
  };

  return {
    isTerminalStatusWritten() {
      return terminalStatusWritten;
    },
    markTerminal() {
      terminalStatusWritten = true;
    },
    schedule,
    clear,
  };
}
