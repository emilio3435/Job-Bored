import type { DiscoveryRunStatusPayload } from "../contracts.ts";
import {
  buildFailedRunStatus,
  type DiscoveryRunStatusStore,
} from "../state/run-status-store.ts";
import { createSafetyTimer, type SafetyTimerMode } from "./safety-timer.ts";

/**
 * BEAUDIT A12: the one async run lifecycle shared by `/webhook` (discovery)
 * and `/ingest-url` (async Add URL). Before this, each handler carried its own
 * copy of the `.then`/`.catch` terminal bookkeeping, and both copies had the
 * A2 bug: they marked the safety timer terminal and cleared it BEFORE the
 * terminal status write, so a throwing write (EIO, disk full) left the run
 * `running` forever with nothing left to terminalize it.
 *
 * The order here is: write the terminal status, and only after the write
 * succeeds mark the run terminal and disarm the safety timer. When the write
 * throws, a `failed` status that names the lost outcome is written in its own
 * try. When that also throws, the safety timer stays armed so it gets one
 * more attempt at the deadline.
 */

export class RunCancelledError extends Error {
  readonly reason: string;
  constructor(reason = "Cancelled by user.") {
    super(reason);
    this.name = "RunCancelledError";
    this.reason = reason;
  }
}

export type RunCancelOutcome =
  | { ok: true; status: DiscoveryRunStatusPayload | null }
  | { ok: false; reason: "not_running" };

/**
 * BEAUDIT A21: live async runs that can be cancelled, keyed by runId. A run
 * registers itself when it starts and removes itself when its status turns
 * terminal, so the map only ever holds in-flight runs of this process.
 */
export interface RunCancelRegistry {
  register(runId: string, cancel: (reason: string) => DiscoveryRunStatusPayload | null): void;
  unregister(runId: string): void;
  has(runId: string): boolean;
  cancel(runId: string, reason?: string): RunCancelOutcome;
  size(): number;
}

export function createRunCancelRegistry(): RunCancelRegistry {
  const entries = new Map<
    string,
    (reason: string) => DiscoveryRunStatusPayload | null
  >();
  return {
    register(runId, cancel) {
      entries.set(runId, cancel);
    },
    unregister(runId) {
      entries.delete(runId);
    },
    has(runId) {
      return entries.has(runId);
    },
    cancel(runId, reason = "Cancelled by user.") {
      const cancel = entries.get(runId);
      if (!cancel) return { ok: false, reason: "not_running" };
      entries.delete(runId);
      return { ok: true, status: cancel(reason) };
    },
    size() {
      return entries.size;
    },
  };
}

/**
 * The safety timer is a backstop for the STATUS. The run itself carries a
 * run-wide AbortController at `maxRunDurationMs` (run-abort.ts), and that
 * real abort path writes a truthful terminal status. Firing the backstop at
 * exactly the same instant raced it; a grace window lets the real path land
 * first. 5% of the budget, at least 1 ms and at most 30 s.
 */
export function computeSafetyDelayMs(maxRunDurationMs: number): number {
  const base = Math.max(0, Number(maxRunDurationMs) || 0);
  const grace = Math.min(30_000, Math.max(1, Math.ceil(base * 0.05)));
  return base + grace;
}

export type TerminalSource = "completed" | "failed" | "fallback" | "cancelled";

export interface RunAsyncLifecycleOptions<T> {
  runId: string;
  runMode: SafetyTimerMode;
  maxRunDurationMs: number;
  runStatusStore?: DiscoveryRunStatusStore;
  /** The `running` status already persisted for this run. */
  runningStatus: DiscoveryRunStatusPayload;
  now(): Date;
  log?(event: string, details: Record<string, unknown>): void;
  /** Event-name prefix for this run family, e.g. `discovery.run`. */
  eventPrefix: string;
  work(signal: AbortSignal): Promise<T>;
  /** Terminal status for a settled `work()`. */
  buildTerminalStatus(result: T): DiscoveryRunStatusPayload;
  /** Called once, after a terminal status (of any source) is persisted. */
  onTerminal?(status: DiscoveryRunStatusPayload, source: TerminalSource): void;
  /** Called after a successful completion status is persisted. */
  onCompleted?(result: T, status: DiscoveryRunStatusPayload): void;
  /** Called after a failure status is persisted. */
  onFailed?(error: unknown, status: DiscoveryRunStatusPayload): void;
  cancelRegistry?: RunCancelRegistry;
}

export interface RunAsyncLifecycleHandle {
  /** Settles after work() settles and its terminal bookkeeping ran. */
  settled: Promise<void>;
  signal: AbortSignal;
}

export function runAsyncLifecycle<T>(
  options: RunAsyncLifecycleOptions<T>,
): RunAsyncLifecycleHandle {
  const { runId, runMode, log, eventPrefix } = options;
  const controller = new AbortController();
  const safety = createSafetyTimer({
    runId,
    runMode,
    maxRunDurationMs: computeSafetyDelayMs(options.maxRunDurationMs),
    runStatusStore: options.runStatusStore,
    acceptedStatus: options.runningStatus,
    now: options.now,
    log,
    onForceTerminal: (status) => {
      options.cancelRegistry?.unregister(runId);
      options.onTerminal?.(status, "fallback");
    },
  });

  const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  /**
   * Persist a terminal status, then disarm the backstop. Returns the status
   * that actually landed, or null when nothing could be written.
   */
  const writeTerminal = (
    status: DiscoveryRunStatusPayload,
    source: TerminalSource,
  ): DiscoveryRunStatusPayload | null => {
    let landed = status;
    let landedSource = source;
    try {
      options.runStatusStore?.put(status);
    } catch (writeError) {
      log?.(`discovery.run_status.terminal_write_failed`, {
        runId,
        mode: runMode,
        status: status.status,
        error: errorMessage(writeError),
      });
      if (status.status === "failed") {
        // The failed status itself did not land; a second identical write
        // would fail the same way. Leave the backstop armed.
        return null;
      }
      const fallback = buildFailedRunStatus(
        options.runningStatus,
        new Error(
          `The run finished as "${status.status}" but that status could not be saved: ${errorMessage(writeError)}`,
        ),
        options.now().toISOString(),
      );
      try {
        options.runStatusStore?.put(fallback);
      } catch (fallbackError) {
        log?.(`discovery.run_status.terminal_write_failed`, {
          runId,
          mode: runMode,
          status: "failed",
          fallback: true,
          error: errorMessage(fallbackError),
        });
        return null;
      }
      landed = fallback;
      landedSource = "fallback";
    }
    safety.markTerminal();
    safety.clear();
    options.cancelRegistry?.unregister(runId);
    try {
      options.onTerminal?.(landed, landedSource);
    } catch (hookError) {
      log?.(`discovery.run_status.history_finalize_failed`, {
        runId,
        mode: runMode,
        error: errorMessage(hookError),
      });
    }
    return landed;
  };

  const ignoreLate = (kind: "completion" | "failure", error?: unknown) => {
    log?.(`${eventPrefix}.late_${kind}_ignored`, {
      runId,
      mode: runMode,
      reason: "terminal_status_already_written",
      ...(error !== undefined ? { error: errorMessage(error) } : {}),
    });
  };

  if (options.cancelRegistry) {
    options.cancelRegistry.register(runId, (reason) => {
      if (safety.isTerminalStatusWritten()) return null;
      const current =
        options.runStatusStore?.get(runId) ?? options.runningStatus;
      const failedAt = options.now().toISOString();
      const cancelled: DiscoveryRunStatusPayload = {
        ...buildFailedRunStatus(current, new RunCancelledError(reason), failedAt),
        message: "Discovery run cancelled by user.",
      };
      const landed = writeTerminal(cancelled, "cancelled");
      controller.abort(new RunCancelledError(reason));
      log?.(`${eventPrefix}.cancelled`, { runId, mode: runMode, reason });
      return landed;
    });
  }

  let work: Promise<T>;
  try {
    work = Promise.resolve(options.work(controller.signal));
  } catch (error) {
    work = Promise.reject(error);
  }

  const settled = work
    .then(
      (result) => {
        if (safety.isTerminalStatusWritten()) {
          ignoreLate("completion");
          return;
        }
        // A throw here (malformed result) falls through to the failure path.
        const status = options.buildTerminalStatus(result);
        const landed = writeTerminal(status, "completed");
        if (landed && landed.status !== "failed") {
          options.onCompleted?.(result, landed);
        }
      },
    )
    .catch((error) => {
      if (safety.isTerminalStatusWritten()) {
        ignoreLate("failure", error);
        return;
      }
      const failedStatus = buildFailedRunStatus(
        options.runningStatus,
        error,
        options.now().toISOString(),
      );
      const landed = writeTerminal(failedStatus, "failed");
      if (landed) options.onFailed?.(error, landed);
      else options.onFailed?.(error, failedStatus);
    })
    .catch((hookError) => {
      log?.(`${eventPrefix}.lifecycle_hook_failed`, {
        runId,
        mode: runMode,
        error: errorMessage(hookError),
      });
    });

  safety.schedule();

  return { settled, signal: controller.signal };
}
