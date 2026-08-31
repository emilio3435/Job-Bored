/**
 * Abortable timeout for discovery run work.
 *
 * RUN-11 / F4B-RUN11-CANCEL: a timeout or parent AbortSignal must abort the
 * underlying browser/fetch/provider work, not just ignore the wrapper promise.
 */

/**
 * Timeout error with attribution context for terminalization evidence.
 */
export class TimeoutError extends Error {
  readonly operation: string;
  readonly sourceId: string;
  readonly timeoutMs: number;

  constructor(operation: string, sourceId: string, timeoutMs: number) {
    super(`Timeout of ${timeoutMs}ms exceeded during ${operation} for ${sourceId}`);
    this.name = "TimeoutError";
    this.operation = operation;
    this.sourceId = sourceId;
    this.timeoutMs = timeoutMs;
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

export type AbortableWork<T> = Promise<T> | ((signal: AbortSignal) => Promise<T>);

/**
 * Runs work under a timeout AbortSignal linked to an optional parent signal.
 * Factory work receives the composed signal so fetch/session/provider calls
 * can cancel in-flight I/O.
 */
export async function withAbortableTimeout<T>(
  operation: string,
  sourceId: string,
  timeoutMs: number,
  work: AbortableWork<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new TimeoutError(operation, sourceId, timeoutMs);

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
    timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(timeoutError);
      }
    }, timeoutMs);
  }

  try {
    if (controller.signal.aborted) {
      throw abortReason(controller, timeoutError);
    }
    const promise =
      typeof work === "function" ? work(controller.signal) : work;
    const aborted = waitForAbort(controller.signal, timeoutError);
    try {
      return await Promise.race([promise, aborted]);
    } finally {
      promise.catch(() => {
        // Underlying work may reject after abort; the race already settled.
      });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw abortReason(controller, timeoutError, error);
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function waitForAbort(
  signal: AbortSignal,
  timeoutError: TimeoutError,
): Promise<never> {
  return new Promise((_, reject) => {
    const onAbort = () => {
      reject(abortReasonFromSignal(signal, timeoutError));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReasonFromSignal(
  signal: AbortSignal,
  timeoutError: TimeoutError,
): unknown {
  const reason = signal.reason;
  if (reason instanceof TimeoutError) {
    return reason;
  }
  if (reason instanceof Error) {
    return reason;
  }
  return timeoutError;
}

export function createRunAbortController(
  parentSignal: AbortSignal | undefined,
  maxRunDurationMs: number,
  onTimeout?: () => void,
): {
  controller: AbortController;
  signal: AbortSignal;
  clear(): void;
} {
  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };
  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      onTimeout?.();
      controller.abort(
        new TimeoutError("run", "discovery", maxRunDurationMs),
      );
    }
  }, maxRunDurationMs);
  timer.unref?.();

  return {
    controller,
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function abortReason(
  controller: AbortController,
  timeoutError: TimeoutError,
  fallback?: unknown,
): unknown {
  const reason = controller.signal.reason;
  if (reason instanceof TimeoutError) {
    return reason;
  }
  if (fallback instanceof TimeoutError) {
    return fallback;
  }
  if (reason instanceof Error) {
    return reason;
  }
  if (fallback instanceof Error) {
    return fallback;
  }
  return timeoutError;
}
