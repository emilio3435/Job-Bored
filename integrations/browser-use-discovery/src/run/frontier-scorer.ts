/**
 * Shared frontier scoring model for ATS and browser opportunities.
 *
 * Provides unified scoring schema and deterministic exploit target selection
 * across both discovery lanes, enabling VAL-LOOP-SCORE-001..005 validation.
 *
 * ## Design Principles
 *
 * 1. **Single frontier**: Both ATS and browser candidates are scored on the same
 *    schema before exploit target selection (VAL-LOOP-SCORE-001).
 *
 * 2. **Deterministic ranking**: Given fixed inputs (intent, memory snapshot, frontier),
 *    the selected exploit target identities and order are identical across runs
 *    (VAL-LOOP-SCORE-004).
 *
 * 3. **Explicit score components**: Each dimension is independently computed and
 *    documented so ranking behavior can be audited (VAL-LOOP-SCORE-002).
 *
 * 4. **Budget enforcement**: Exploration budget controls (maxScoutSurfaces,
 *    maxExploitSurfaces, maxScoutListingsPerSurface) are enforced at selection
 *    time, not post-hoc truncated (VAL-LOOP-SCORE-003).
 *
 * 5. **Deep extraction gating**: Only selected exploit targets receive deep
 *    extraction work (VAL-LOOP-SCORE-005).
 */

import type {
  DiscoveryIntent,
  DiscoverySourceLane,
  NormalizedLead,
  PlannedCompany,
  SourcePreset,
} from "../contracts.ts";

// === Score Component Types ===

export type FrontierScoreComponents = {
  /** Role/title alignment score (0-100). */
  roleFit: number;
  /** Geographic/remote alignment score (0-100). */
  geoFit: number;
  /** Remote/hybrid/onsite policy alignment score (0-100). */
  remoteFit: number;
  /** Historical hiring evidence score (0-100). */
  recentHiringEvidence: number;
  /** Prior accepted yield score (0-100). */
  priorAcceptedYield: number;
  /** Surface health score (0-100). */
  surfaceHealth: number;
  /** Provider/source diversity score (0-100). */
  diversity: number;
  /** Freshness score (0-100). */
  freshness: number;
  /** Cooldown penalty score (0-100, higher = worse). */
  cooldownPenalty: number;
  /** Recent coverage penalty score (0-100, higher = worse). */
  recentCoveragePenalty: number;
};

export type FrontierScore = FrontierScoreComponents & {
  /** Weighted composite score (0-100). */
  composite: number;
  /** Attribution for debugging: which components drove the score. */
  attribution: string[];
};

// === Exploit Target Types ===

/**
 * A scored opportunity from any discovery lane awaiting exploit target selection.
 * Unifies ATS company planning output with browser/grounded listing scores.
 */
export type FrontierCandidate = {
  /** Unique identifier for this candidate within the frontier. */
  candidateId: string;
  /** Source lane that produced this candidate. */
  sourceLane: DiscoverySourceLane;
  /** Source adapter or search system that found this candidate. */
  sourceId: string;
  /** Company key for attribution. */
  companyKey: string;
  /** Human-readable display name. */
  displayName: string;
  /** Surface/listing URL if available. */
  url?: string;
  /** When this candidate was observed/created. */
  observedAt: string;
  /** Individual score components. */
  scores: FrontierScoreComponents;
  /** Weighted composite score. */
  compositeScore: number;
  /** True if this candidate passed initial screening. */
  isViable: boolean;
  /** Suppression reasons if not viable. */
  suppressionReasons: string[];
  /** Stable sort key for deterministic tiebreaking. */
  sortKey: string;
};

export type ExploitTarget = FrontierCandidate & {
  /** Position in the selected exploit target list (1-indexed). */
  exploitRank: number;
  /** Whether deep extraction is permitted for this target. */
  extractionPermitted: boolean;
};

// === Exploration Budget Types ===

export type ExplorationBudget = {
  /** Maximum surfaces to scout during the scout phase. */
  maxScoutSurfaces: number;
  /** Maximum surfaces to select for deep extraction (exploit phase). */
  maxExploitSurfaces: number;
  /** Maximum listings to collect per surface during scout. */
  maxScoutListingsPerSurface: number;
};

export type BudgetUsage = {
  /** Number of scout surfaces visited. */
  scoutSurfacesVisited: number;
  /** Number of exploit surfaces selected. */
  exploitSurfacesSelected: number;
  /** Number of listings collected during scouting. */
  scoutListingsCollected: number;
};

export type BudgetStatus = {
  /** Remaining scout surface budget. */
  scoutSurfaceBudgetRemaining: number;
  /** Remaining exploit surface budget. */
  exploitSurfaceBudgetRemaining: number;
  /** Remaining scout listings budget. */
  scoutListingBudgetRemaining: number;
  /** Whether scout phase should stop. */
  scoutBudgetExhausted: boolean;
  /** Whether exploit phase should stop. */
  exploitBudgetExhausted: boolean;
};

// === Selection Result Types ===

export type ExploitSelectionResult = {
  /** All candidates that were scored. */
  allCandidates: FrontierCandidate[];
  /** Candidates selected for deep extraction. */
  selectedTargets: ExploitTarget[];
  /** Candidates evaluated but not selected. */
  rejectedCandidates: FrontierCandidate[];
  /** Final budget state after selection. */
  finalBudgetUsage: BudgetUsage;
  /** Telemetry snapshot for loop observability. */
  telemetry: ExploitSelectionTelemetry;
};

export type ExploitSelectionTelemetry = {
  /** Total candidates in frontier. */
  totalCandidates: number;
  /** Candidates from ATS lane. */
  atsCandidates: number;
  /** Candidates from browser/grounded lane. */
  browserCandidates: number;
  /** Candidates selected for exploit. */
  selectedCount: number;
  /** Candidates rejected by budget. */
  budgetRejectedCount: number;
  /** Candidates suppressed by quality gate. */
  qualityRejectedCount: number;
  /** Whether selection was deterministic (no random tiebreaking). */
  deterministic: boolean;
};

// === Scoring Constants ===

/** Role/title fit weight in composite score. */
const ROLE_FIT_WEIGHT = 0.21;
/** Geographic fit weight in composite score. */
const GEO_FIT_WEIGHT = 0.08;
/** Remote policy fit weight in composite score. */
const REMOTE_FIT_WEIGHT = 0.05;
/** Recent hiring evidence weight in composite score. */
const RECENT_HIRING_WEIGHT = 0.18;
/** Prior accepted yield weight in composite score. */
const PRIOR_YIELD_WEIGHT = 0.14;
/** Diversity weight in composite score. */
const DIVERSITY_WEIGHT = 0.10;
/** Freshness weight in composite score. */
const FRESHNESS_WEIGHT = 0.10;
/** Verified surface bonus weight in composite score. */
const VERIFIED_SURFACE_WEIGHT = 0.08;
/** Surface health weight in composite score. */
const SURFACE_HEALTH_WEIGHT = 0.04;
/** Preset alignment weight in composite score. */
const PRESET_ALIGNMENT_WEIGHT = 0.04;
/** Recent coverage penalty weight (subtracted). */
const COVERAGE_PENALTY_WEIGHT = 0.08;
/** Cooldown penalty weight (subtracted). */
const COOLDOWN_PENALTY_WEIGHT = 0.12;

/** Minimum viable composite score for exploit consideration. */
const MIN_VIABLE_SCORE = 15;

/**
 * Default exploration budget for unrestricted runs.
 * Conservative defaults that can be overridden by run configuration.
 */
export const DEFAULT_EXPLORATION_BUDGET: ExplorationBudget = {
  maxScoutSurfaces: 50,
  maxExploitSurfaces: 12,
  maxScoutListingsPerSurface: 20,
};

// === Score Computation ===

/**
 * Computes the composite frontier score from individual components.
 * All inputs should be 0-100 scale.
 *
 * VAL-LOOP-SCORE-002: Ranking reflects required fit, quality, and penalty inputs.
 */
export function computeFrontierCompositeScore(
  components: FrontierScoreComponents,
): FrontierScore {
  const {
    roleFit,
    geoFit,
    remoteFit,
    recentHiringEvidence,
    priorAcceptedYield,
    surfaceHealth,
    diversity,
    freshness,
    cooldownPenalty,
    recentCoveragePenalty,
  } = components;

  // Positive contributions
  const positive =
    roleFit * ROLE_FIT_WEIGHT +
    geoFit * GEO_FIT_WEIGHT +
    remoteFit * REMOTE_FIT_WEIGHT +
    recentHiringEvidence * RECENT_HIRING_WEIGHT +
    priorAcceptedYield * PRIOR_YIELD_WEIGHT +
    diversity * DIVERSITY_WEIGHT +
    freshness * FRESHNESS_WEIGHT +
    surfaceHealth * SURFACE_HEALTH_WEIGHT;

  // Penalties (subtracted)
  const penalties =
    recentCoveragePenalty * COVERAGE_PENALTY_WEIGHT +
    cooldownPenalty * COOLDOWN_PENALTY_WEIGHT;

  const composite = Math.max(0, Math.min(100, positive - penalties));

  // Build attribution string for debugging
  const attribution: string[] = [];
  if (roleFit >= 70) attribution.push(`role:${roleFit.toFixed(0)}`);
  if (geoFit >= 70) attribution.push(`geo:${geoFit.toFixed(0)}`);
  if (remoteFit >= 70) attribution.push(`remote:${remoteFit.toFixed(0)}`);
  if (recentHiringEvidence >= 60) attribution.push(`hiring:${recentHiringEvidence.toFixed(0)}`);
  if (priorAcceptedYield >= 60) attribution.push(`yield:${priorAcceptedYield.toFixed(0)}`);
  if (diversity >= 60) attribution.push(`diversity:${diversity.toFixed(0)}`);
  if (freshness >= 60) attribution.push(`fresh:${freshness.toFixed(0)}`);
  if (cooldownPenalty > 0) attribution.push(`cooldown:${cooldownPenalty.toFixed(0)}`);
  if (recentCoveragePenalty > 0) attribution.push(`coverage:${recentCoveragePenalty.toFixed(0)}`);

  return {
    ...components,
    composite: Math.round(composite * 100) / 100,
    attribution,
  };
}

// === Frontier Composition ===

/**
 * Converts a PlannedCompany from the company planner into a FrontierCandidate
 * for unified scoring.
 *
 * VAL-LOOP-SCORE-001: ATS and browser opportunities share one scoring frontier.
 */
export function companyToFrontierCandidate(
  company: PlannedCompany,
  sourceLane: DiscoverySourceLane,
  sourceId: string,
): FrontierCandidate {
  const scores: FrontierScoreComponents = {
    roleFit: company.scores.roleFit,
    geoFit: company.scores.geoFit,
    remoteFit: company.scores.remoteFit,
    recentHiringEvidence: company.scores.recentHiringEvidence,
    priorAcceptedYield: company.scores.priorAcceptedYield,
    surfaceHealth: company.scores.surfaceHealth,
    diversity: company.scores.diversity,
    freshness: company.scores.freshness,
    cooldownPenalty: company.scores.cooldownPenalty,
    recentCoveragePenalty: company.scores.recentCoveragePenalty,
  };

  const compositeResult = computeFrontierCompositeScore(scores);
  const isViable = compositeResult.composite >= MIN_VIABLE_SCORE && company.scores.cooldownPenalty < 100;
  const suppressionReasons: string[] = [];

  if (!isViable) {
    if (company.scores.cooldownPenalty >= 100) {
      suppressionReasons.push("company on cooldown");
    }
    if (compositeResult.composite < MIN_VIABLE_SCORE) {
      suppressionReasons.push(`score ${compositeResult.composite.toFixed(1)} below viability threshold ${MIN_VIABLE_SCORE}`);
    }
  }

  // Build deterministic sort key: composite desc, then cooldown asc, then coverage asc, then name asc
  const sortKey = [
    String(100 - compositeResult.composite).padStart(6, "0"),
    String(company.scores.cooldownPenalty).padStart(6, "0"),
    String(company.scores.recentCoveragePenalty).padStart(6, "0"),
    company.displayName.toLowerCase(),
  ].join("|");

  return {
    candidateId: `company:${company.companyKey}`,
    sourceLane,
    sourceId,
    companyKey: company.companyKey,
    displayName: company.displayName,
    observedAt: company.evidence?.timestamps?.freshnessAt || new Date().toISOString(),
    scores,
    compositeScore: compositeResult.composite,
    isViable,
    suppressionReasons,
    sortKey,
  };
}

/**
 * Converts a NormalizedLead into a FrontierCandidate for unified scoring.
 *
 * VAL-LOOP-SCORE-001: ATS and browser opportunities share one scoring frontier.
 */
export function leadToFrontierCandidate(
  lead: NormalizedLead,
  sourceLane: DiscoverySourceLane,
): FrontierCandidate {
  // Extract role/geo fit from lead metadata where available
  const fitScore = lead.fitScore ?? 50;
  const roleFit = fitScore * 100;
  const geoFit = lead.metadata?.sourceLane === "ats_provider" ? 70 : 60;

  // Infer remote fit from lead's remoteBucket metadata
  let remoteFit = 60;
  if (lead.metadata?.remoteBucket === "remote") remoteFit = 100;
  else if (lead.metadata?.remoteBucket === "hybrid") remoteFit = 72;

  // Quality signals from tags and priority
  const tagCount = lead.tags?.length || 0;
  const hasPriority = lead.priority === "🔥" || lead.priority === "⚡";
  const recentHiringEvidence = Math.min(100, 40 + tagCount * 10 + (hasPriority ? 30 : 0));
  const priorAcceptedYield = hasPriority ? 70 : 50;
  const surfaceHealth = 60 + tagCount * 5;
  const diversity = 50;
  const freshness = 70;
  const cooldownPenalty = 0;
  const recentCoveragePenalty = 0;

  const scores: FrontierScoreComponents = {
    roleFit,
    geoFit,
    remoteFit,
    recentHiringEvidence,
    priorAcceptedYield,
    surfaceHealth,
    diversity,
    freshness,
    cooldownPenalty,
    recentCoveragePenalty,
  };

  const compositeResult = computeFrontierCompositeScore(scores);
  const isViable = compositeResult.composite >= MIN_VIABLE_SCORE;

  if (!isViable) {
    // Use fitScore-based suppression reason
  }

  // Build deterministic sort key
  const sortKey = [
    String(100 - compositeResult.composite).padStart(6, "0"),
    String(0).padStart(6, "0"),
    String(0).padStart(6, "0"),
    (lead.company || "").toLowerCase(),
    (lead.title || "").toLowerCase(),
  ].join("|");

  return {
    candidateId: `lead:${lead.url}`,
    sourceLane,
    sourceId: lead.sourceId,
    companyKey: lead.metadata?.companyKey || lead.company.toLowerCase().replace(/\s+/g, "-"),
    displayName: `${lead.company} / ${lead.title}`,
    url: lead.url,
    observedAt: lead.discoveredAt || new Date().toISOString(),
    scores,
    compositeScore: compositeResult.composite,
    isViable,
    suppressionReasons: isViable ? [] : [`score ${compositeResult.composite.toFixed(1)} below viability threshold ${MIN_VIABLE_SCORE}`],
    sortKey,
  };
}

// === Budget Operations ===

/**
 * Creates an exploration budget tracker that enforces surface and listing limits.
 *
 * VAL-LOOP-SCORE-003: Shared exploration budget controls are enforced.
 */
export function createExplorationBudgetTracker(
  budget: ExplorationBudget,
): ExplorationBudgetTracker {
  let scoutSurfacesVisited = 0;
  let exploitSurfacesSelected = 0;
  let scoutListingsCollected = 0;

  return {
    getStatus(): BudgetStatus {
      return {
        scoutSurfaceBudgetRemaining: Math.max(0, budget.maxScoutSurfaces - scoutSurfacesVisited),
        exploitSurfaceBudgetRemaining: Math.max(0, budget.maxExploitSurfaces - exploitSurfacesSelected),
        scoutListingBudgetRemaining: Math.max(0, budget.maxScoutListingsPerSurface - (scoutListingsCollected % budget.maxScoutListingsPerSurface)),
        scoutBudgetExhausted: scoutSurfacesVisited >= budget.maxScoutSurfaces,
        exploitBudgetExhausted: exploitSurfacesSelected >= budget.maxExploitSurfaces,
      };
    },

    recordScoutSurface(): boolean {
      if (scoutSurfacesVisited >= budget.maxScoutSurfaces) return false;
      scoutSurfacesVisited++;
      return true;
    },

    recordScoutListings(count: number): void {
      scoutListingsCollected += count;
    },

    recordExploitSelection(): boolean {
      if (exploitSurfacesSelected >= budget.maxExploitSurfaces) return false;
      exploitSurfacesSelected++;
      return true;
    },

    getUsage(): BudgetUsage {
      return {
        scoutSurfacesVisited,
        exploitSurfacesSelected,
        scoutListingsCollected,
      };
    },

    getMaxScoutSurfaces(): number {
      return budget.maxScoutSurfaces;
    },

    getMaxExploitSurfaces(): number {
      return budget.maxExploitSurfaces;
    },

    getMaxScoutListingsPerSurface(): number {
      return budget.maxScoutListingsPerSurface;
    },
  };
}

export type ExplorationBudgetTracker = ReturnType<typeof createExplorationBudgetTracker>;

// === Deterministic Selection ===

/**
 * Sorts frontier candidates deterministically using composite score and sort key.
 * This function is pure and deterministic: same input always produces same order.
 *
 * VAL-LOOP-SCORE-004: Exploit target selection is deterministic for fixed inputs.
 */
export function sortFrontierCandidates(candidates: FrontierCandidate[]): FrontierCandidate[] {
  return [...candidates].sort(compareFrontierCandidates);
}

function compareFrontierCandidates(
  left: FrontierCandidate,
  right: FrontierCandidate,
): number {
  // Primary: composite score descending
  const scoreDelta = right.compositeScore - left.compositeScore;
  if (Math.abs(scoreDelta) > 0.001) return scoreDelta;

  // Secondary: sort key ascending (lexicographic deterministic tiebreak)
  const keyDelta = left.sortKey.localeCompare(right.sortKey);
  if (keyDelta !== 0) return keyDelta;

  // Final fallback: candidateId string comparison
  return left.candidateId.localeCompare(right.candidateId);
}

/**
 * Selects exploit targets from scored frontier candidates using deterministic
 * ordering and budget constraints.
 *
 * VAL-LOOP-SCORE-003: Shared exploration budget controls are enforced.
 * VAL-LOOP-SCORE-004: Exploit target selection is deterministic for fixed inputs.
 * VAL-LOOP-SCORE-005: Deep extraction is restricted to selected exploit targets.
 *
 * @param candidates - All candidates in the frontier (from all lanes)
 * @param budget - Exploration budget constraints
 * @param intent - Discovery intent for preset-specific behavior
 * @returns Selection result with selected and rejected candidates
 */
export function selectExploitTargets(
  candidates: FrontierCandidate[],
  budget: ExplorationBudget,
  intent: DiscoveryIntent,
): ExploitSelectionResult {
  const budgetTracker = createExplorationBudgetTracker(budget);

  // Filter to viable candidates only
  const viableCandidates = candidates.filter((c) => c.isViable);

  // Sort deterministically
  const sorted = sortFrontierCandidates(viableCandidates);

  // Track telemetry
  const atsCandidates = candidates.filter((c) =>
    c.sourceLane === "ats_provider" || c.sourceLane === "company_surface"
  ).length;
  const browserCandidates = candidates.filter((c) =>
    c.sourceLane === "grounded_web" || c.sourceLane === "hint_resolution"
  ).length;

  // Select up to maxExploitSurfaces
  const selectedTargets: ExploitTarget[] = [];
  const rejectedCandidates: FrontierCandidate[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    const canSelect = budgetTracker.recordExploitSelection();

    if (canSelect) {
      selectedTargets.push({
        ...candidate,
        exploitRank: selectedTargets.length + 1,
        extractionPermitted: true,
      });
    } else {
      rejectedCandidates.push(candidate);
    }
  }

  const selectedCount = selectedTargets.length;
  const budgetRejectedCount = rejectedCandidates.length;
  const qualityRejectedCount = candidates.filter((c) => !c.isViable).length;

  const telemetry: ExploitSelectionTelemetry = {
    totalCandidates: candidates.length,
    atsCandidates,
    browserCandidates,
    selectedCount,
    budgetRejectedCount,
    qualityRejectedCount,
    deterministic: true, // Always true: no random operations used
  };

  return {
    allCandidates: candidates,
    selectedTargets,
    rejectedCandidates,
    finalBudgetUsage: budgetTracker.getUsage(),
    telemetry,
  };
}

// === Validation Helper ===

/**
 * Checks if a specific candidate is in the selected exploit targets set.
 * Used for VAL-LOOP-SCORE-005: Deep extraction is restricted to selected exploit targets.
 */
export function isCandidateSelected(
  candidateId: string,
  selectedTargets: ExploitTarget[],
): boolean {
  return selectedTargets.some((target) => target.candidateId === candidateId);
}

/**
 * Filters leads to only those whose candidates are in the selected exploit targets.
 * Used for VAL-LOOP-SCORE-005 enforcement.
 */
export function filterToSelectedTargets(
  leads: NormalizedLead[],
  selectedTargets: ExploitTarget[],
): NormalizedLead[] {
  const selectedIds = new Set(selectedTargets.map((t) => t.candidateId));
  return leads.filter((lead) => {
    const candidateId = `lead:${lead.url}`;
    return selectedIds.has(candidateId);
  });
}
