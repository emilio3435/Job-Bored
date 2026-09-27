export const RUN_PROGRESS_PHASES = [
  "initializing",
  "scout",
  "score",
  "exploit",
  "write",
  "learn",
] as const;

export type DiscoveryRunProgressPhase =
  (typeof RUN_PROGRESS_PHASES)[number];

export interface DiscoveryRunBudgetProgress {
  capturedAt?: string;
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
  heartbeatAt?: string;
  counters?: Partial<Record<"companiesTotal" | "companiesDone" | "boardsDetected" |
    "listingsSeen" | "listingsProcessed" | "leadsQualified" | "matcherCalls" |
    "queriesTotal" | "queriesDone" | "atsBoardDuplicatesSkipped" |
    "atsCompaniesCooledDown", number>>;
  current?: { kind: "company" | "source" | "query"; label: string };
  sources?: Array<{
    id: string;
    state: "pending" | "running" | "done" | "skipped";
    done?: number;
    total?: number;
  }>;
}
