/**
 * Run-budget tracker for adaptive page-limit reduction and budget-driven company skips.
 *
 * Tracks remaining runtime budget across the run and emits structured diagnostics
 * when budget depletion triggers adaptive decisions (reduced page limits or company skips).
 *
 * VAL-OBS-002: Budget adaptation emits reduced-page and budget-skip diagnostics.
 */

import type { ExtractionDiagnostic } from "../contracts.ts";

export interface BudgetTrackerConfig {
  /** Maximum run duration in milliseconds. */
  maxRunDurationMs: number;
  /** Conservative safety buffer to reserve for run completion (ms). */
  safetyBufferMs?: number;
  /** Threshold (0-1) of remaining budget ratio below which page limits are reduced. */
  reducePageLimitThreshold?: number;
  /** Factor (0-1) to multiply page limits by when reducing due to budget pressure. */
  pageLimitReductionFactor?: number;
  /** Persist the current budget whenever an adaptive decision point is reached. */
  onCheckpoint?(checkpoint: BudgetCheckpoint): void;
}

export type BudgetStatus = {
  /** Remaining budget as a ratio of total (0-1). */
  remainingRatio: number;
  /** Remaining time in milliseconds. */
  remainingMs: number;
  /** Total budget in milliseconds. */
  totalMs: number;
  /** Whether the budget is considered exhausted (below safety buffer). */
  exhausted: boolean;
  /** Whether page limits should be adaptively reduced. */
  shouldReducePageLimits: boolean;
  /** The effective page limit multiplier to apply (1.0 = no reduction). */
  pageLimitMultiplier: number;
};

export interface BudgetCheckpoint extends BudgetStatus {
  skippedCompanies: string[];
}

export type BudgetDiagnosticEvent = {
  /** The type of budget event. */
  type: "reduced_page_limit" | "budget_skip";
  /** Context about the decision. */
  context: string;
  /** Company name if applicable. */
  companyName?: string;
  /** The effective page/candidate limit after adaptation. */
  effectiveLimit?: number;
  /** The previous limit before adaptation. */
  previousLimit?: number;
};

export type BudgetTracker = {
  getStatus(): BudgetStatus;
  checkCompanySkip(companyName: string): ExtractionDiagnostic | null;
  checkPageLimitReduction(baseLimit: number): {
    multiplier: number;
    diagnostic: ExtractionDiagnostic | null;
  };
  reset(): void;
  getSkippedCompanies(): string[];
};

/**
 * Creates a run-budget tracker that monitors remaining time and provides
 * adaptive page-limit reduction and company skip decisions.
 */
export function createBudgetTracker(config: BudgetTrackerConfig): BudgetTracker {
  const totalMs = Math.max(1, config.maxRunDurationMs);
  const safetyBufferMs = config.safetyBufferMs ?? Math.ceil(totalMs * 0.05); // 5% safety buffer default
  const reducePageLimitThreshold = config.reducePageLimitThreshold ?? 0.5; // 50% remaining
  const pageLimitReductionFactor = config.pageLimitReductionFactor ?? 0.5; // halve limits

  let startTimeMs = Date.now();
  let pageLimitReductionEmitted = false;
  let skippedCompanies: string[] = [];

  function getStatus(): BudgetStatus {
    const elapsedMs = Date.now() - startTimeMs;
    const remainingMs = Math.max(0, totalMs - elapsedMs - safetyBufferMs);
    const remainingRatio = remainingMs / totalMs;

    return {
      remainingRatio: Math.max(0, remainingRatio),
      remainingMs,
      totalMs,
      exhausted: remainingMs <= 0,
      shouldReducePageLimits:
        remainingRatio < reducePageLimitThreshold &&
        !pageLimitReductionEmitted,
      pageLimitMultiplier:
        remainingRatio < reducePageLimitThreshold
          ? pageLimitReductionFactor
          : 1.0,
    };
  }

  function checkpoint(): void {
    config.onCheckpoint?.({
      ...getStatus(),
      skippedCompanies: [...skippedCompanies],
    });
  }

  return {
    getStatus,

    /**
     * Checks if a company should be skipped due to budget exhaustion.
     * Returns null if company can proceed, or a diagnostic if it should be skipped.
     */
    checkCompanySkip(companyName: string): ExtractionDiagnostic | null {
      const status = getStatus();

      if (status.exhausted) {
        if (!skippedCompanies.includes(companyName)) {
          skippedCompanies.push(companyName);
        }
        checkpoint();
        return {
          code: "budget_skip",
          context: `Company "${companyName}" skipped: run budget exhausted (${Math.round(status.remainingMs)}ms remaining, ${Math.round(status.remainingRatio * 100)}% of ${Math.round(status.totalMs)}ms total).`,
        };
      }

      // Also skip if we're below threshold and already reduced limits
      if (status.remainingRatio < reducePageLimitThreshold && pageLimitReductionEmitted) {
        // Only skip if we have very little budget left
        if (status.remainingRatio < (reducePageLimitThreshold * 0.5)) {
          if (!skippedCompanies.includes(companyName)) {
            skippedCompanies.push(companyName);
          }
          checkpoint();
          return {
            code: "budget_skip",
            context: `Company "${companyName}" skipped: run budget critically low (${Math.round(status.remainingMs)}ms remaining, ${Math.round(status.remainingRatio * 100)}% of ${Math.round(status.totalMs)}ms total).`,
          };
        }
      }

      checkpoint();
      return null;
    },

    /**
     * Checks if page limits should be reduced and emits a diagnostic if so.
     * Returns the effective limit multiplier.
     */
    checkPageLimitReduction(baseLimit: number): {
      multiplier: number;
      diagnostic: ExtractionDiagnostic | null;
    } {
      const status = getStatus();

      if (status.shouldReducePageLimits && !pageLimitReductionEmitted) {
        pageLimitReductionEmitted = true;
        const effectiveLimit = Math.max(1, Math.floor(baseLimit * status.pageLimitMultiplier));
        checkpoint();
        return {
          multiplier: status.pageLimitMultiplier,
          diagnostic: {
            code: "reduced_page_limit",
            context: `Run budget at ${Math.round(status.remainingRatio * 100)}% (${Math.round(status.remainingMs)}ms remaining of ${Math.round(status.totalMs)}ms total). Reduced page limit from ${baseLimit} to ${effectiveLimit} to conserve budget.`,
          },
        };
      }

      checkpoint();
      return {
        multiplier: status.pageLimitMultiplier,
        diagnostic: null,
      };
    },

    /**
     * Resets the tracker (for testing or reuse).
     */
    reset(): void {
      startTimeMs = Date.now();
      pageLimitReductionEmitted = false;
      skippedCompanies = [];
      checkpoint();
    },

    /**
     * Returns the list of companies that were skipped due to budget.
     */
    getSkippedCompanies(): string[] {
      return [...skippedCompanies];
    },
  };
}
