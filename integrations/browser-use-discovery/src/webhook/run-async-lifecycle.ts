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

/**
 * `cancelled` is false only when the run finished on its own before it saw the
 * abort; `status` is then its real (completed) terminal status.
 */
export type RunCancelOutcome =
  | { ok: true; cancelled: boolean; status: DiscoveryRunStatusPayload | null }
  | { ok: false; reason: "not_running" };

export type RunCancelHandler = (reason: string) => Promise<{
  cancelled: boolean;
  status: DiscoveryRunStatusPayload | null;
}>;

/**
 * BEAUDIT A21: live async runs that can be cancelled, keyed by runId. A run
 * registers itself when it starts and removes itself when its status turns
 * terminal, so the map only ever holds in-flight runs of this process.
 */
export interface RunCancelRegistry {
  register(runId: string, cancel: RunCancelHandler): void;
  unregister(runId: string): void;
  has(runId: string): boolean;
  /** Aborts the run and resolves once it has stopped and its status landed. */
  cancel(runId: string, reason?: string): Promise<RunCancelOutcome>;
  size(): number;
}

export function createRunCancelRegistry(): RunCancelRegistry {
  const entries = new Map<string, RunCancelHandler>();
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
    async cancel(runId, reason = "Cancelled by user.") {
      const cancel = entries.get(runId);
      if (!cancel) return { ok: false, reason: "not_running" };
      entries.delete(runId);
      const result = await cancel(reason);
      return { ok: true, ...result };
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
  /**
   * How long a cancel waits for work() to stop after the abort before it
   * writes the cancelled status anyway. Default 15 s.
   */
  cancelSettleTimeoutMs?: number;
}

export const DEFAULT_CANCEL_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Wraps a pipeline writer so that no write starts once `signal` has aborted.
 * A cancelled run that only notices the abort at its next checkpoint would
 * otherwise still reach the Sheet after its status says cancelled.
 */
export function guardWriterWithSignal<W extends { write(...args: never[]): Promise<unknown> }>(
  writer: W,
  signal: AbortSignal,
): W {
  return new Proxy(writer, {
    get(target, property, receiver) {
      if (property === "write") {
        return (...args: Parameters<W["write"]>) => {
          if (signal.aborted) {
            const reason: unknown = signal.reason;
            return Promise.reject(
              reason instanceof Error ? reason : new RunCancelledError(),
            );
          }
          return target.write(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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

  // Set once a cancel is requested. While it is set, the settle handlers leave
  // the terminal write to the cancel path, which runs after work() stopped.
  let cancelRequested = false;

  let work: Promise<T>;
  try {
    work = Promise.resolve(options.work(controller.signal));
  } catch (error) {
    work = Promise.reject(error);
  }

  if (options.cancelRegistry) {
    options.cancelRegistry.register(runId, async (reason) => {
      if (safety.isTerminalStatusWritten() || cancelRequested) {
        return { cancelled: false, status: null };
      }
      cancelRequested = true;
      // Abort first and wait for the run to stop, so no write of the run can
      // land after the cancelled status (BEAUDIT A21 repair).
      controller.abort(new RunCancelledError(reason));
      log?.(`${eventPrefix}.cancel_requested`, { runId, mode: runMode, reason });
      const timeoutMs =
        options.cancelSettleTimeoutMs ?? DEFAULT_CANCEL_SETTLE_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        work.then(
          (result) => ({ kind: "fulfilled" as const, result }),
          () => ({ kind: "rejected" as const }),
        ),
        new Promise<{ kind: "timeout" }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (safety.isTerminalStatusWritten()) {
        return { cancelled: false, status: options.runStatusStore?.get(runId) ?? null };
      }
      if (outcome.kind === "fulfilled") {
        // The run finished before it saw the abort: report what really happened.
        let status: DiscoveryRunStatusPayload | null = null;
        try {
          status = writeTerminal(options.buildTerminalStatus(outcome.result), "completed");
          if (status && status.status !== "failed") options.onCompleted?.(outcome.result, status);
        } catch (error) {
          status = writeTerminal(
            buildFailedRunStatus(options.runningStatus, error, options.now().toISOString()),
            "failed",
          );
        }
        log?.(`${eventPrefix}.cancel_too_late`, { runId, mode: runMode, reason });
        return { cancelled: false, status };
      }
      if (outcome.kind === "timeout") {
        log?.(`${eventPrefix}.cancel_settle_timeout`, { runId, mode: runMode, timeoutMs });
      }
      const current =
        options.runStatusStore?.get(runId) ?? options.runningStatus;
      const cancelled: DiscoveryRunStatusPayload = {
        ...buildFailedRunStatus(
          current,
          new RunCancelledError(reason),
          options.now().toISOString(),
        ),
        message: "Discovery run cancelled by user.",
      };
      const landed = writeTerminal(cancelled, "cancelled");
      log?.(`${eventPrefix}.cancelled`, { runId, mode: runMode, reason });
      return { cancelled: true, status: landed };
    });
  }

  const settled = work
    .then(
      (result) => {
        if (cancelRequested) return;
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
      if (cancelRequested) return;
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
