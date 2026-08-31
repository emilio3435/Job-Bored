export type DiscoveryRunProgressPhase =
  | "initializing"
  | "scout"
  | "score"
  | "exploit"
  | "write"
  | "learn";

export interface DiscoveryRunBudgetProgress {
  totalMs: number;
  remainingMs: number;
  remainingRatio: number;
  exhausted: boolean;
  shouldReducePageLimits: boolean;
  pageLimitMultiplier: number;
  skippedCompanies: string[];
}

export interface DiscoveryRunProgress {
  phase: DiscoveryRunProgressPhase;
  sequence: number;
  checkpointedAt: string;
  budget?: DiscoveryRunBudgetProgress;
}
