/**
 * Retry-broadening gate for the grounded-search outbound query ladder.
 *
 * RUN-06 / F4B-RUN06-RETRY: when retryBroadeningEnabled is false, only the
 * focused rung (rung 0) may execute. Broader rungs must not become outbound
 * calls even if the focused query returned zero candidates.
 */

export interface RetryLadderRung {
  /** 0 = focused query; 1+ = broadening rungs. */
  rung: number;
  /** True when this is the last rung the caller should attempt. */
  terminal?: boolean;
}

/**
 * Restricts a retry ladder to the focused query when broadening is disabled.
 * Marks the remaining rung terminal so exhaustion attribution stays truthful.
 */
export function applyRetryBroadeningGate<T extends RetryLadderRung>(
  ladder: T[],
  retryBroadeningEnabled: boolean,
): T[] {
  if (retryBroadeningEnabled || ladder.length <= 1) {
    return ladder;
  }
  const focused = ladder[0];
  if (!focused) {
    return [];
  }
  return [{ ...focused, terminal: true }];
}

/**
 * True when the next outbound rung may execute.
 * Rung 0 always may; later rungs require the flag.
 */
export function shouldExecuteRetryRung(
  rung: number,
  retryBroadeningEnabled: boolean,
): boolean {
  if (rung <= 0) {
    return true;
  }
  return retryBroadeningEnabled === true;
}
