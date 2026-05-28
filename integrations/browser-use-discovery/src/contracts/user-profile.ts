/**
 * user-profile.ts
 *
 * TypeScript mirror of user-profile.schema.json — the single source of truth
 * for who the user is, what they want, and what hard rules apply when scoring
 * a job listing.
 *
 * Read by:
 *   - The LLM scorer (integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts)
 *   - The keyword pre-filter (same file)
 *   - The discovery query builder (uses identity.targetRoles + hardConstraints as defaults)
 *   - The onboarding wizard + Settings editor (read/write)
 *
 * Storage:
 *   ~/.jobbored/profile.json (new canonical location)
 *   Legacy fallback: ~/.hermes/job-hunt/profile/job-preferences.md + profile.md
 *   (backcompat agent migrates legacy → new on first run; preserves .bak copy)
 *
 * Versioning:
 *   `version: 1` is the only supported version. Bump + add a migrator when
 *   shape changes. Never silently drop unknown fields — fail loud.
 */

export const USER_PROFILE_SCHEMA_VERSION = 1 as const;

export type StarterTemplateId =
  | "marketer"
  | "engineer"
  | "product_manager"
  | "data_scientist"
  | "designer"
  | "custom";

export type TargetSeniority =
  | "intern"
  | "entry"
  | "ic_mid"
  | "ic_senior"
  | "ic_staff"
  | "ic_principal"
  | "manager"
  | "director"
  | "head"
  | "vp"
  | "c_level"
  | "any";

export type WorkMode = "remote_only" | "hybrid_ok" | "onsite_ok" | "any";

export type WorkAuth =
  | "us_citizen"
  | "us_authorized"
  | "needs_sponsorship"
  | "any";

export type ImportanceLevel = "high" | "medium" | "low";

export type ProfileIdentity = {
  /** Free-text role titles the user wants next. Order matters — first is most-wanted. */
  targetRoles: string[];
  targetSeniority: TargetSeniority;
  yearsRelevantExperience?: number;
  /** 1–4 sentence first-person "who I am professionally" — embedded verbatim in LLM scoring prompt. */
  primaryNarrative: string;
};

export type ProfileStrength = {
  name: string;
  /** 1 = top strength. Lower number = higher weight in LLM scoring. */
  rank: number;
  /** Optional 1–2 sentence proof point the user provided. Goes into the LLM prompt. */
  evidence?: string;
  /** Optional seed terms the LLM treats as positive signal. Empty is fine. */
  keywords?: string[];
};

export type ProfileHardConstraints = {
  /** Annual USD floor. Null = no floor. Only applied when salaryRequired = true AND listing publishes a salary. */
  salaryFloor?: number | null;
  /** True = listings without published salary are hard-rejected. */
  salaryRequired?: boolean;
  workMode: WorkMode;
  /** City or metro names. Ignored when workMode = "remote_only". */
  acceptableLocations?: string[];
  workAuth?: WorkAuth;
  /** Case-insensitive title substrings that hard-reject before LLM scoring. */
  skipTitles?: string[];
};

export type ProfileTieBreakers = {
  salaryTransparencyImportance?: ImportanceLevel;
  companyCredibilityImportance?: ImportanceLevel;
  applicationComplexityAversion?: ImportanceLevel;
};

export type UserProfile = {
  version: typeof USER_PROFILE_SCHEMA_VERSION;
  createdAt?: string;
  updatedAt?: string;
  starterTemplate?: StarterTemplateId;
  identity: ProfileIdentity;
  strengths: ProfileStrength[];
  wants?: string[];
  avoids?: string[];
  hardConstraints: ProfileHardConstraints;
  tieBreakers?: ProfileTieBreakers;
};

// ─── Scoring API ─────────────────────────────────────────────────────────────

/**
 * Pre-filter result — runs before LLM scoring. Cheap, deterministic, no API cost.
 * Enforces hardConstraints. Rejects here never reach the LLM.
 */
export type PreFilterResult =
  | { pass: true }
  | {
      pass: false;
      reason:
        | "skip_title_match"
        | "work_mode_mismatch"
        | "location_outside_acceptable"
        | "work_auth_mismatch"
        | "salary_below_floor"
        | "salary_missing_but_required";
      /** Human-readable detail surfaced in the rejection summary. */
      detail: string;
    };

/**
 * Per-strength evaluation in the LLM scorer's structured output.
 * The LLM returns one entry per strength in the user's profile, in the same order.
 */
export type StrengthEvaluation = {
  /** Echo of profile.strengths[i].name so consumers can sort safely. */
  name: string;
  /** 0–10. The LLM's confidence that the listing exercises this strength. */
  score: number;
  /** 1 sentence why. Surfaced in the per-listing breakdown UI. */
  rationale: string;
};

export type FitBand = "Exceptional" | "Strong" | "Interesting" | "Low";

/**
 * The LLM scorer's structured output. This is what gets persisted alongside
 * the Pipeline row so the UI can render a transparent breakdown.
 *
 * `fitScore` writes to the existing "Fit Score" column (column H, index 7) —
 * wire-compatible with everything that reads `job.fitScore` today.
 */
export type LlmFitScoreResult = {
  /** 1–10, integer rounded. */
  fitScore: number;
  band: FitBand;
  /** One per profile.strengths[], in profile rank order. */
  perStrength: StrengthEvaluation[];
  /** Soft penalties surfaced to the user (e.g., "salary not published", "Workday application"). */
  concerns: string[];
  /** Positive signals surfaced to the user (e.g., "explicit LLM platform work"). */
  matches: string[];
  /** 1–2 sentence summary written for the user. Goes into "Fit Assessment" column. */
  rationale: string;
  /** Optional 1 sentence "lead with this" hint for talking points. */
  leadAngle?: string;
};

/**
 * Complete scoring output for one listing. The orchestrator (lead-normalizer)
 * unpacks `score` into the Pipeline row fields.
 */
export type ProfileScoringOutcome =
  | {
      ok: true;
      score: LlmFitScoreResult;
      /** True when the LLM was actually called. False when score came from cache. */
      llmCalled: boolean;
      modelId: string;
    }
  | {
      ok: false;
      filteredBy: "pre_filter";
      preFilter: Extract<PreFilterResult, { pass: false }>;
    }
  | {
      ok: false;
      filteredBy: "llm_error";
      message: string;
    };

// ─── Storage / discovery surface contract ────────────────────────────────────

/**
 * Locations the loader checks, in priority order. First hit wins.
 *
 * Resolved by the backcompat agent — it reads legacy locations once, migrates
 * into the new canonical path, then writes `.bak` files alongside the originals.
 */
export const PROFILE_STORAGE_PATHS = {
  canonical: "~/.jobbored/profile.json",
  legacyHermesPreferences: "~/.hermes/job-hunt/profile/job-preferences.md",
  legacyHermesProfile: "~/.hermes/job-hunt/profile/profile.md",
} as const;

/**
 * Discovery pane uses the master profile as defaults but per-run edits do NOT
 * write back. The merged preference set used for one discovery run.
 */
export type DiscoveryRunPreferences = {
  /** The committed profile read from disk at run start. */
  baseProfile: UserProfile;
  /**
   * Per-run overrides set in the discovery pane. Only fields present here
   * override the base profile for this run. Cleared when the user closes
   * the pane.
   */
  perRunOverrides?: Partial<{
    targetRoles: string[];
    targetSeniority: TargetSeniority;
    wants: string[];
    avoids: string[];
    workMode: WorkMode;
    acceptableLocations: string[];
  }>;
};

// ─── Bridge to existing types ────────────────────────────────────────────────

/**
 * Adapter contract — implemented by the scorer task. Derives the existing
 * CandidateProfile (used by company-discovery, see contracts.ts) from the new
 * UserProfile so the company-discovery endpoint keeps working unchanged.
 */
export type UserProfileAdapters = {
  /** Derive CandidateProfile (existing type in contracts.ts) for company discovery. */
  toCandidateProfile: (profile: UserProfile) => {
    targetRoles: string[];
    skills: string[];
    seniority: string;
    yearsOfExperience?: number;
    locations: string[];
    remotePolicy?: "remote" | "hybrid" | "onsite";
  };
  /** Derive DiscoveryProfile (existing type in contracts.ts) for query generation. */
  toDiscoveryProfileDefaults: (profile: UserProfile) => {
    targetRoles?: string;
    locations?: string;
    remotePolicy?: string;
    seniority?: string;
    keywordsInclude?: string;
    keywordsExclude?: string;
  };
};
