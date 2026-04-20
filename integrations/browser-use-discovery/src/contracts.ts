export const DISCOVERY_WEBHOOK_EVENT = "command-center.discovery";
export const DISCOVERY_WEBHOOK_SCHEMA_VERSION = 1;
export const DEFAULT_PIPELINE_SHEET_NAME = "Pipeline";
export const DEFAULT_STATUS = "New";
export const PIPELINE_DEDUPE_COLUMN = "E";
export const PIPELINE_DEDUPE_HEADER = "Link";
export const ATS_SOURCE_IDS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workday",
  "icims",
  "jobvite",
  "taleo",
  "successfactors",
  "workable",
  "breezy",
  "recruitee",
  "teamtailor",
  "personio",
] as const;
export const HINT_SOURCE_IDS = [
  "linkedin",
  "glassdoor",
  "indeed",
  "monster",
  "ziprecruiter",
  "careerbuilder",
  "simplyhired",
  "builtin",
  "wellfound",
  "otta",
  "google_jobs",
] as const;
export const SUPPORTED_SOURCE_IDS = [
  ...ATS_SOURCE_IDS,
  "grounded_web",
] as const;
export const DEFAULT_ENABLED_SOURCE_IDS = [
  ...ATS_SOURCE_IDS,
  "grounded_web",
] as const;
export const SOURCE_PRESET_VALUES = [
  "browser_only",
  "ats_only",
  "browser_plus_ats",
] as const;
export const PIPELINE_HEADER_ROW = [
  "Date Found",
  "Title",
  "Company",
  "Location",
  "Link",
  "Source",
  "Salary",
  "Fit Score",
  "Priority",
  "Tags",
  "Fit Assessment",
  "Contact",
  "Status",
  "Applied Date",
  "Notes",
  "Follow-up Date",
  "Talking Points",
  "Last contact",
  "Did they reply?",
  "Logo URL",
  // Appended so existing sheet layouts shift by zero columns. 0–10 AI match
  // score from the job-matcher's overallScore, letting users sort/filter in-
  // sheet rather than having the matcher silently drop marginal jobs.
  "Match Score",
] as const;

export type SupportedSourceId = (typeof SUPPORTED_SOURCE_IDS)[number];
export type AtsSourceId = (typeof ATS_SOURCE_IDS)[number];
export type HintSourceId = (typeof HINT_SOURCE_IDS)[number];
export type SourcePreset = (typeof SOURCE_PRESET_VALUES)[number];
export type DiscoverySourceLane =
  | "ats_provider"
  | "company_surface"
  | "hint_resolution"
  | "grounded_web";
export type CareerSurfaceType =
  | "provider_board"
  | "employer_careers"
  | "employer_jobs"
  | "job_posting"
  | "hint_candidate";
export type CareerSurfaceVerifiedStatus =
  | "verified"
  | "suspect"
  | "dead"
  | "pending";
export type RemoteBucket =
  | "remote"
  | "hybrid"
  | "onsite"
  | "unknown";

/**
 * UltraPlan control-plane tuning flags.
 * Each flag can be independently toggled to enable/disable specific agentic behaviors.
 */
export type UltraPlanTuning = {
  /** Enable multi-query fan-out from role/keyword/location modifiers. */
  multiQueryEnabled?: boolean;
  /** Enable deterministic retry broadening ladder on zero-candidate focused queries. */
  retryBroadeningEnabled?: boolean;
  /** Enable bounded parallel company processing with failure isolation. */
  parallelCompanyProcessingEnabled?: boolean;
};

/**
 * Grounded search tunable parameters.
 * These control results/pages/runtime/token budgets for the grounded_web source.
 */
export type GroundedSearchTuning = {
  /** Maximum candidate links to return from grounded search per company. */
  maxResultsPerCompany?: number;
  /** Maximum pages to visit per company for job extraction. */
  maxPagesPerCompany?: number;
  /** Maximum runtime in milliseconds for a single grounded search operation. */
  maxRuntimeMs?: number;
  /** Maximum tokens to spend per grounded search query. */
  maxTokensPerQuery?: number;
  /**
   * Maximum number of focused sub-queries to generate from modifiers for
   * multi-query fan-out. Only applies when ultraPlanTuning.multiQueryEnabled is true.
   */
  multiQueryCap?: number;
};

export type DiscoveryProfile = {
  sourcePreset?: SourcePreset;
  targetRoles?: string;
  locations?: string;
  remotePolicy?: string;
  seniority?: string;
  keywordsInclude?: string;
  keywordsExclude?: string;
  maxLeadsPerRun?: string;
  /** UltraPlan agentic behavior tuning flags. */
  ultraPlanTuning?: UltraPlanTuning;
  /** Grounded search tunable parameters. */
  groundedSearchTuning?: GroundedSearchTuning;
};

export type DiscoveryIntent = {
  intentKey: string;
  targetRoles: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  locations: string[];
  remotePolicy: string;
  seniority: string;
  sourcePreset: SourcePreset;
};

export type DiscoveryWebhookRequestV1 = {
  event: typeof DISCOVERY_WEBHOOK_EVENT;
  schemaVersion: typeof DISCOVERY_WEBHOOK_SCHEMA_VERSION;
  sheetId: string;
  variationKey: string;
  requestedAt: string;
  discoveryProfile?: DiscoveryProfile;
  /**
   * Optional Google OAuth access token sent by the dashboard for *this run
   * only*. Lets a signed-in user trigger discovery without needing the worker
   * to hold a long-lived service account or OAuth refresh token. Takes
   * precedence over every credential in the worker's runtime env. The worker
   * MUST strip this field before persisting the request to the run-status
   * store so the secret never lands in SQLite.
   */
  googleAccessToken?: string;
};

/**
 * Feature B / Layer 5 — profile-driven company discovery.
 *
 * Shape of a user's job-seeking profile after extraction from resume text
 * or a form submission. Used as input to `discoverCompaniesForProfile`.
 */
export type CandidateProfile = {
  targetRoles: string[];
  skills: string[];
  seniority: string;
  yearsOfExperience?: number;
  locations: string[];
  remotePolicy?: "remote" | "hybrid" | "onsite";
  industries?: string[];
};

/**
 * Raw form input a client can POST to the discovery-profile endpoint.
 * All fields are strings (or a number for yearsOfExperience) so the endpoint
 * is tolerant of HTML-form submissions; extraction normalizes into
 * CandidateProfile.
 */
export type ProfileFormInput = {
  targetRoles?: string;
  skills?: string;
  seniority?: string;
  yearsOfExperience?: number | string;
  locations?: string;
  remotePolicy?: string;
  industries?: string;
};

export const DISCOVERY_PROFILE_EVENT = "discovery.profile.request" as const;
export const DISCOVERY_PROFILE_SCHEMA_VERSION = 1 as const;

export type DiscoveryProfileRequestV1 = {
  event: typeof DISCOVERY_PROFILE_EVENT;
  schemaVersion: typeof DISCOVERY_PROFILE_SCHEMA_VERSION;
  /**
   * Raw resume text (PDF/DOCX already extracted client-side via resume-ingest).
   * Ephemeral when mode is undefined; persisted to worker-config.json when
   * persist is true so a daily refresh can replay it.
   */
  resumeText?: string;
  /** Structured form input. At least one of resumeText or form must be non-blank. */
  form?: ProfileFormInput;
  /** If true, write the returned companies into worker-config.json. */
  persist?: boolean;
  /** Target sheet for persistence; falls back to configured default when omitted. */
  sheetId?: string;
  /**
   * Request mode. Default ("manual") treats resumeText/form as the input.
   * "refresh" ignores those fields, loads the stored candidateProfile from
   * worker-config, re-runs discovery, dedupes against negativeCompanyKeys,
   * and persists the new company list. Used by the Cloudflare Cron Trigger.
   * "skip_company" adds companyKey(s) to the negative list and returns the
   * current config without running Gemini.
   */
  mode?: "manual" | "refresh" | "skip_company";
  /** For mode="skip_company": CompanyTarget.companyKey values to blacklist. */
  skipCompanyKeys?: string[];
};

export type DiscoveryProfileResponseV1 =
  | {
      ok: true;
      profile: CandidateProfile;
      companies: CompanyTarget[];
      persisted: boolean;
    }
  | {
      ok: false;
      message: string;
      detail?: string;
    };

export type NormalizedLeadPriority = "🔥" | "⚡" | "—" | "↓" | "";

export type NormalizedLead = {
  sourceId: string;
  sourceLabel: string;
  title: string;
  company: string;
  location: string;
  url: string;
  compensationText: string;
  fitScore: number | null;
  /**
   * 0–10 score from the Gemini job-matcher's overallScore (0–1 multiplied by
   * 10 and rounded). Distinct from fitScore, which is the deterministic
   * keyword-overlap score. Populated by finalizeMatchDecision in
   * run-discovery.ts when a matcher decision is available; null when the run
   * skipped the AI matcher.
   */
  matchScore: number | null;
  priority: NormalizedLeadPriority;
  tags: string[];
  fitAssessment: string;
  contact: string;
  status: string;
  appliedDate: string;
  notes: string;
  followUpDate: string;
  talkingPoints: string;
  logoUrl: string;
  discoveredAt: string;
  metadata: {
    runId: string;
    variationKey: string;
    sourceQuery: string;
    providerType?: AtsSourceId;
    externalJobId?: string;
    canonicalUrl?: string;
    boardToken?: string;
    sourceLane?: DiscoverySourceLane;
    surfaceId?: string;
    fingerprintKey?: string;
    semanticKey?: string;
    remoteBucket?: RemoteBucket;
    employmentType?: string;
    companyKey?: string;
  };
};

/**
 * Stable diagnostic codes for extraction observability.
 * Used in structured diagnostic entries paired with backward-compatible warning strings.
 */
export type ExtractionDiagnosticCode =
  /** Browser-use command failed; fell back to plain HTTP fetch. */
  | "fetch_fallback"
  /** Upstream search provider failed before candidate extraction could run. */
  | "upstream_error"
  /** Third-party board candidate was retained as a hint but not extracted directly. */
  | "hint_only_candidate"
  /** Third-party board candidate was explicitly blocked from direct extraction. */
  | "third_party_extraction_blocked"
  /** A hint-only candidate could not be resolved to a canonical employer or ATS page. */
  | "hint_resolution_failed"
  /** A canonical employer or ATS surface was resolved from a weaker hint or generic page. */
  | "canonical_surface_resolved"
  /** A canonical employer or ATS surface was selected for extraction. */
  | "canonical_surface_extracted"
  /** Candidate was rejected by strict preflight before browser extraction. */
  | "preflight_rejected"
  /** A terminal preflight rejection was recorded into dead-link memory for cooldown. */
  | "dead_link_recorded"
  /** Vertex AI grounding-api-redirect URL could not be resolved to a canonical target (stale token, 4xx, or missing Location header). */
  | "vertex_redirect_unresolved"
  /** Call 2 structured-extraction pass succeeded and its candidates were used as the primary result (Layer 4). */
  | "structured_extraction_used"
  /** Call 2 structured-extraction pass failed or was skipped; fell back to Call 1's prose/regex parse. */
  | "structured_extraction_failed"
  /** Call 1.5 prose-recovery pass re-extracted URLs from Call 1's conversational output (Layer 4.5). */
  | "prose_recovery_used"
  /** Call 1.5 prose-recovery pass produced no URLs from Call 1's prose; terminal for that company. */
  | "prose_recovery_failed"
  /** Candidate host was suppressed from memory due to prior junk or repeated failures. */
  | "junk_host_suppressed"
  /** Response appears to be an SPA loading state or skeleton HTML (very short, mostly whitespace/script). */
  | "low_content_spa"
  /** Response is mostly HTML with minimal extractable content (likely a broken/minimal page). */
  | "low_content_html"
  /** Extraction returned zero job listings despite successful page load. */
  | "zero_results"
  /** Operation timed out; fallback or partial result may be returned. */
  | "timeout"
  /** Run budget depletion triggered adaptive page-limit reduction before exhaustion. */
  | "reduced_page_limit"
  /** Company was skipped due to run budget exhaustion. */
  | "budget_skip";

/**
 * Structured diagnostic entry for extraction observability.
 * Provides machine-readable context paired with backward-compatible warning strings.
 */
export type ExtractionDiagnostic = {
  /** Stable diagnostic code identifying the event type. When omitted, the diagnostic
   * provides context without a specific machine-readable code (used for generic errors). */
  code?: ExtractionDiagnosticCode;
  /** Human-readable context explaining why this diagnostic was emitted. */
  context: string;
  /** Optional URL or source this diagnostic applies to. */
  url?: string;
};

/**
 * Extended extraction result with structured diagnostics for UltraPlan observability.
 * The `diagnostics` field provides machine-readable event context paired with
 * the `warnings` string array for backward compatibility.
 */
export type BrowserUseExtractionResult = {
  runId: string;
  sourceId: string;
  querySummary: string;
  leads: NormalizedLead[];
  warnings: string[];
  stats: {
    pagesVisited: number;
    leadsSeen: number;
    leadsAccepted: number;
  };
  /** Structured diagnostic entries for extraction observability (VAL-OBS-001, VAL-OBS-003). */
  diagnostics?: ExtractionDiagnostic[];
};

export type PipelineWriteResult = {
  sheetId: string;
  appended: number;
  updated: number;
  skippedDuplicates: number;
  warnings: string[];
  /**
   * Present when a write error occurred. Indicates the phase where the error
   * happened (update or append) and the error details.
   */
  writeError?: {
    phase: "update" | "append";
    message: string;
    httpStatus?: number;
    detail?: string;
  };
};

export type DiscoveryRejectionSample = {
  reason: string;
  title: string;
  company: string;
  url: string;
  detail: string;
};

export type DiscoveryRejectionSummary = {
  totalRejected: number;
  rejectionReasons: Record<string, number>;
  rejectionSamples: DiscoveryRejectionSample[];
};

export type DiscoverySourceSummary = {
  sourceId: SupportedSourceId;
  querySummary: string;
  pagesVisited: number;
  leadsSeen: number;
  leadsAccepted: number;
  leadsRejected: number;
  companiesPlanned?: number;
  companiesSuppressed?: number;
  surfacesVerified?: number;
  canonicalSurfacesResolved?: number;
  canonicalSurfacesExtracted?: number;
  hintOnlyCandidatesSeen?: number;
  hintResolutionsSucceeded?: number;
  hintResolutionsDropped?: number;
  deadLinksSuppressed?: number;
  thirdPartyExtractionsBlocked?: number;
  junkHostsSuppressed?: number;
  duplicateListingsSuppressed?: number;
  warnings: string[];
  rejectionSummary?: DiscoveryRejectionSummary;
  /** Structured diagnostic entries for extraction observability (VAL-OBS-001, VAL-OBS-003). */
  diagnostics?: ExtractionDiagnostic[];
};

export type DiscoveryLifecycleState = "completed" | "partial" | "empty";

export type DiscoveryRunLifecycle = {
  runId: string;
  trigger: "manual" | "scheduled";
  startedAt: string;
  completedAt: string;
  state: DiscoveryLifecycleState;
  companyCount: number;
  detectionCount: number;
  listingCount: number;
  normalizedLeadCount: number;
  /**
   * Ordered stage evidence for the loop lifecycle.
   * Tracks the monotonic progression through scout -> score -> exploit -> learn.
   * Each entry records when the stage started and optionally completed.
   * Machine-readable evidence for VAL-LOOP-CORE-008.
   */
  stageOrder?: LoopStageEvidence[];
  /**
   * Run-level loop counters for terminal telemetry.
   * VAL-LOOP-OBS-001: Required loop counters exposed in terminal status.
   * VAL-LOOP-OBS-002: Counter invariants validated (non-negative, reconcilable).
   */
  loopCounters?: LoopCounters;
  /**
   * Machine-readable failure reason code for degraded/failure terminal states.
   * VAL-LOOP-OBS-003: Degraded/failure states include machine-readable reason.
   */
  reasonCode?: string;
  /**
   * Human-readable failure explanation for degraded/failure terminal states.
   * VAL-LOOP-OBS-003: Degraded/failure states include human-readable explanation.
   */
  reasonMessage?: string;
  /**
   * Failure class for terminal degraded/failure states.
   * VAL-LOOP-OBS-004: Reason attribution differentiates dominant failure classes.
   */
  failureClass?: LoopFailureClass;
};

/**
 * Loop stage names for the opportunity loop.
 * These represent the distinct phases in the scout -> score -> exploit -> learn cycle.
 */
export type DiscoveryPhase = "scout" | "score" | "exploit" | "learn";

/**
 * Failure reason classification for terminal degraded/failure states.
 * Used for VAL-LOOP-OBS-003/004: machine-readable reason attribution.
 */
export type LoopFailureClass =
  /**
   * No failure — run completed successfully or was empty.
   */
  | "none"
  /**
   * Weak surface discovery: insufficient scout yield from both ATS and browser lanes.
   */
  | "weak_surface_discovery"
  /**
   * Strict filtering rejection: candidates were found but filtered by relevance/matcher.
   */
  | "strict_filtering_rejection"
  /**
   * Canonical resolution loss: browser candidates could not be resolved to canonical surfaces.
   */
  | "canonical_resolution_loss"
  /**
   * Exploit budget exhaustion: selected targets were exhausted before reaching write threshold.
   */
  | "exploit_budget_exhaustion"
  /**
   * Weak browser seed quality: browser lane had insufficient or low-quality seeds.
   */
  | "weak_browser_seed_quality"
  /**
   * Weak ATS seed quality: ATS lane had insufficient or low-quality seeds.
   */
  | "weak_ats_seed_quality"
  /**
   * Write failure: sheet write operation failed after successful extraction.
   */
  | "write_failure"
  /**
   * Unknown/unclassified failure.
   */
  | "unknown";

/**
 * Machine-readable stage transition evidence.
 * Records the timestamp when each loop stage begins.
 * Monotonic sequence is enforced: later stages cannot complete before earlier stages start.
 */
export type LoopStageEvidence = {
  /**
   * Monotonically increasing sequence number for the stage transition.
   * A higher sequence indicates a later stage in the loop progression.
   */
  sequence: number;
  /**
   * The name of the stage that started.
   */
  phase: DiscoveryPhase;
  /**
   * ISO timestamp when this stage began.
   */
  startedAt: string;
};

/**
 * Run-level loop counters for terminal telemetry.
 * Used for VAL-LOOP-OBS-001/002: required loop counters and reconciliation invariants.
 */
export type LoopCounters = {
  /** Number of ATS scout detections performed. */
  atsScoutCount: number;
  /** Number of browser scout surface visits performed. */
  browserScoutCount: number;
  /** Number of candidate surfaces that entered scoring. */
  scoredSurfaces: number;
  /** Number of candidates selected for deep exploit extraction. */
  selectedExploitTargets: number;
  /** Number of candidates suppressed by exploit threshold or budget. */
  exploitSuppressions: number;
  /** Number of hint-only candidates seen (third-party board candidates retained as hints). */
  hintMetrics: number;
  /** Number of third-party board candidates explicitly blocked from direct extraction. */
  thirdPartyBlocks: number;
  /** Number of junk-host candidates suppressed from extraction. */
  junkHostSuppressions: number;
  /** Number of duplicate listings suppressed by cross-lane dedupe. */
  duplicateSuppressions: number;
  /** Number of cross-lane duplicate collapses (same opportunity from ATS+browser). */
  crossLaneDuplicates: number;
};

export type DiscoveryRunStatus =
  | "accepted"
  | "running"
  | "completed"
  | "partial"
  | "empty"
  | "failed";

export type DiscoveryRunStatusPayload = {
  runId: string;
  status: DiscoveryRunStatus;
  terminal: boolean;
  message: string;
  trigger: TriggerKind;
  request: Pick<
    DiscoveryWebhookRequestV1,
    "sheetId" | "variationKey" | "requestedAt"
  >;
  acceptedAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lifecycle?: DiscoveryRunLifecycle;
  writeResult?: PipelineWriteResult;
  warnings: string[];
  sources: DiscoverySourceSummary[];
  error?: string;
  /**
   * Resolved UltraPlan tuning flags at terminal state.
   * Only present when the run has completed and config was resolved.
   * Exposes the machine-readable control-plane snapshot for VAL-API-001..005 validation.
   */
  ultraPlanTuning?: UltraPlanTuning;
  /**
   * Resolved grounded search tuning parameters at terminal state.
   * Only present when the run has completed and config was resolved.
   * Exposes the machine-readable control-plane snapshot for VAL-API-001..005 validation.
   */
  groundedSearchTuning?: GroundedSearchTuning;
};

export type DiscoveryWebhookAck = {
  ok: true;
  kind: "accepted_async" | "completed_sync";
  runId: string;
  message: string;
  statusPath?: string;
  pollAfterMs?: number;
  outcome?: DiscoveryRunStatusPayload;
};

export type TriggerKind = "manual" | "scheduled";

export type CompanyTarget = {
  name: string;
  companyKey?: string;
  normalizedName?: string;
  aliases?: string[];
  domains?: string[];
  geoTags?: string[];
  roleTags?: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
  boardHints?: Partial<Record<AtsSourceId, string>>;
};

export type StoredWorkerConfig = {
  sheetId: string;
  mode: "local" | "hosted";
  timezone: string;
  companies: CompanyTarget[];
  atsCompanies?: CompanyTarget[];
  includeKeywords: string[];
  excludeKeywords: string[];
  targetRoles: string[];
  locations: string[];
  remotePolicy: string;
  seniority: string;
  maxLeadsPerRun: number;
  enabledSources: SupportedSourceId[];
  schedule: {
    enabled: boolean;
    cron: string;
  };
  discoveryProfile?: {
    sourcePreset?: SourcePreset;
  };
  /**
   * Last-used resume/form inputs to /discovery-profile, persisted so a
   * scheduled daily refresh (Cloudflare Cron → POST /discovery-profile
   * {mode:"refresh"}) can re-run company discovery without the dashboard
   * being open. Populated when POST /discovery-profile is called with
   * `persist: true`. Local-only; never pushed to a remote sheet.
   */
  candidateProfile?: {
    resumeText?: string;
    form?: ProfileFormInput;
    updatedAt?: string;
  };
  /**
   * Companies the user has explicitly skipped from the Profile tab. Keys are
   * CompanyTarget.companyKey values. Refresh runs dedupe discovered
   * companies against this list so skipped employers never re-appear.
   */
  negativeCompanyKeys?: string[];
};

export type EffectiveDiscoveryConfig = StoredWorkerConfig & {
  variationKey: string;
  requestedAt: string;
  sourcePreset: SourcePreset;
  /** Resolved UltraPlan tuning flags (with preset-specific defaults). */
  ultraPlanTuning: UltraPlanTuning;
  /** Resolved grounded search tuning parameters (with preset-specific defaults). */
  groundedSearchTuning: GroundedSearchTuning;
};

export type DiscoveryRun = {
  runId: string;
  trigger: TriggerKind;
  request: DiscoveryWebhookRequestV1;
  config: EffectiveDiscoveryConfig;
};

export type CompanyContext = {
  company: CompanyTarget;
  run: DiscoveryRun;
};

export type DetectionResult = {
  matched: boolean;
  sourceId: AtsSourceId;
  sourceLabel: string;
  boardUrl: string;
  confidence: number;
  warnings: string[];
  providerType?: AtsSourceId;
  surfaceType?: CareerSurfaceType;
  canonicalUrl?: string;
  finalUrl?: string;
  boardToken?: string;
  sourceLane?: DiscoverySourceLane;
  metadata?: Record<string, unknown>;
};

export type BoardContext = {
  sourceId: AtsSourceId;
  sourceLabel: string;
  boardUrl: string;
  company: CompanyTarget;
  run: DiscoveryRun;
  providerType?: AtsSourceId;
  boardToken?: string;
  canonicalUrl?: string;
  surfaceId?: string;
};

export type RawListing = {
  sourceId: SupportedSourceId;
  sourceLabel: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  compensationText?: string;
  contact?: string;
  descriptionText?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  providerType?: AtsSourceId;
  externalJobId?: string;
  canonicalUrl?: string;
  finalUrl?: string;
  sourceLane?: DiscoverySourceLane;
  surfaceId?: string;
  remoteBucket?: RemoteBucket;
  employmentType?: string;
};

export type SourceAdapter = {
  sourceId: AtsSourceId;
  sourceLabel: string;
  detect(companyContext: CompanyContext): Promise<DetectionResult | null>;
  listJobs(boardContext: BoardContext): Promise<RawListing[]>;
  normalize(raw: RawListing, run: DiscoveryRun): Promise<NormalizedLead | null>;
};

export type PlannedCompany = {
  companyKey: string;
  displayName: string;
  normalizedName: string;
  domains: string[];
  aliases: string[];
  boardHints: Partial<Record<AtsSourceId, string>>;
  geoTags: string[];
  roleTags: string[];
  rank: number;
  intendedLanes: DiscoverySourceLane[];
  scores: {
    roleFit: number;
    geoFit: number;
    remoteFit: number;
    recentHiringEvidence: number;
    priorAcceptedYield: number;
    surfaceHealth: number;
    diversity: number;
    freshness: number;
    cooldownPenalty: number;
    recentCoveragePenalty: number;
  };
  reasons: string[];
  evidence: string[];
  sourceCompany?: CompanyTarget;
};

export type CareerSurface = {
  surfaceId: string;
  companyKey: string;
  surfaceType: CareerSurfaceType;
  providerType?: AtsSourceId;
  canonicalUrl: string;
  host: string;
  finalUrl: string;
  boardToken: string;
  sourceLane: DiscoverySourceLane;
  verifiedStatus: CareerSurfaceVerifiedStatus;
  confidence: number;
  score: number;
  lastVerifiedAt: string;
  lastSuccessAt: string;
  lastFailureAt: string;
  failureReason: string;
  failureStreak: number;
  cooldownUntil: string;
  metadata: Record<string, unknown>;
};

export type ProviderDiscoveryResult = {
  sourceId: AtsSourceId;
  sourceLabel: string;
  companyKey: string;
  companyName: string;
  surfaces: CareerSurface[];
  warnings: string[];
  metadata?: Record<string, unknown>;
};

export type CareerSurfaceRecord = {
  surfaceId: string;
  companyKey: string;
  surfaceType: CareerSurfaceType;
  providerType: AtsSourceId | "";
  canonicalUrl: string;
  host: string;
  finalUrl: string;
  boardToken: string;
  sourceLane: DiscoverySourceLane;
  verifiedStatus: CareerSurfaceVerifiedStatus;
  lastVerifiedAt: string;
  lastSuccessAt: string;
  lastFailureAt: string;
  failureReason: string;
  failureStreak: number;
  cooldownUntil: string;
  metadataJson: string;
};

export type CompanyRegistryRecord = {
  companyKey: string;
  displayName: string;
  normalizedName: string;
  aliasesJson: string;
  domainsJson: string;
  atsHintsJson: string;
  geoTagsJson: string;
  roleTagsJson: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSuccessAt: string;
  successCount: number;
  failureCount: number;
  confidence: number;
  cooldownUntil: string;
};

export type DeadLinkRecord = {
  urlKey: string;
  finalUrl: string;
  host: string;
  reasonCode: string;
  httpStatus: number | null;
  lastTitle: string;
  lastSeenAt: string;
  failureCount: number;
  nextRetryAt: string;
};

export type ListingFingerprintRecord = {
  fingerprintKey: string;
  companyKey: string;
  titleKey: string;
  locationKey: string;
  canonicalUrlKey: string;
  externalJobId: string;
  remoteBucket: RemoteBucket;
  employmentType: string;
  semanticKey: string;
  contentHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastWrittenAt: string;
  lastRunId: string;
  lastSheetId: string;
  writeCount: number;
  sourceIdsJson: string;
};

export type ListingFingerprint = {
  fingerprintKey: string;
  companyKey: string;
  titleKey: string;
  locationKey: string;
  canonicalUrlKey: string;
  externalJobId: string;
  remoteBucket: RemoteBucket;
  employmentType: string;
  semanticKey: string;
  contentHash: string;
};

export type HostSuppressionRecord = {
  hostKey: string;
  host: string;
  qualityScore: number;
  junkExtractionCount: number;
  canonicalResolutionFailureCount: number;
  suppressionCount: number;
  lastSeenAt: string;
  lastReasonCode: string;
  nextRetryAt: string;
  cooldownUntil: string;
};

export type HostSuppressionUpsert = {
  host: string;
  qualityScore?: number | null;
  qualityDelta?: number | null;
  junkExtractionIncrement?: number | null;
  canonicalResolutionFailureIncrement?: number | null;
  suppressionIncrement?: number | null;
  lastSeenAt?: string | null;
  lastReasonCode?: string | null;
  nextRetryAt?: string | null;
  cooldownUntil?: string | null;
};

export type IntentCoverageRecord = {
  intentKey: string;
  companyKey: string;
  runId: string;
  sourceLane: DiscoverySourceLane;
  surfacesSeen: number;
  listingsSeen: number;
  listingsWritten: number;
  startedAt: string;
  completedAt: string;
};

export type DiscoveryExploitOutcomeWrite = {
  runId: string;
  intentKey: string;
  surfaceId: string;
  companyKey: string;
  sourceId: SupportedSourceId;
  sourceLane: DiscoverySourceLane;
  surfaceType: CareerSurfaceType;
  canonicalUrl: string;
  observedAt?: string | null;
  listingsSeen?: number;
  listingsAccepted?: number;
  listingsRejected?: number;
  listingsWritten?: number;
  rejectionReasons?: Record<string, number>;
  rejectionSamples?: DiscoveryRejectionSample[];
};

export type DiscoveryExploitOutcomeRecord = {
  outcomeKey: string;
  runId: string;
  intentKey: string;
  surfaceId: string;
  companyKey: string;
  sourceId: SupportedSourceId;
  sourceLane: DiscoverySourceLane;
  surfaceType: CareerSurfaceType;
  canonicalUrl: string;
  observedAt: string;
  listingsSeen: number;
  listingsAccepted: number;
  listingsRejected: number;
  listingsWritten: number;
  rejectionReasonsJson: string;
  rejectionSamplesJson: string;
};

/**
 * Role-family pattern record learned from accepted/near-miss leads.
 * Used by planner to find adjacent companies with matching role signals (VAL-LOOP-MEM-004).
 */
export type DiscoveryRoleFamilyRecord = {
  familyKey: string;
  baseRole: string;
  roleVariantsJson: string;
  companyKey: string;
  sourceLane: string;
  confirmedCount: number;
  nearMissCount: number;
  lastConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DiscoveryRoleFamilyLearnInput = {
  title: string;
  companyKey: string;
  sourceLane: DiscoverySourceLane | string;
  accepted: boolean;
};

/**
 * A scout-phase observation record capturing what was discovered during surface scouting.
 * Persisted after scout completion for later ranking and selection consumption.
 */
export type ScoutObservationRecord = {
  /** Unique observation reference (run_id + surface_id or generated). */
  observationRef: string;
  /** The run this observation belongs to. */
  runId: string;
  /** The surface that was observed. */
  surfaceId: string;
  /** The company being scouted. */
  companyRef: string;
  /** Source adapter that performed the scout (e.g., greenhouse, lever, grounded_web). */
  sourceId: SupportedSourceId;
  /** Discovery lane where the surface was found (ats_provider, company_surface, grounded_web). */
  sourceLane: DiscoverySourceLane;
  /** Type of surface observed (provider_board, employer_careers, employer_jobs, job_posting, hint_candidate). */
  surfaceType: CareerSurfaceType;
  /** Canonical URL of the observed surface. */
  canonicalUrl: string;
  /** ATS provider type if applicable. */
  providerType: AtsSourceId | "";
  /** Hostname of the surface URL. */
  host: string;
  /** Final URL after redirects. */
  finalUrl: string;
  /** Board token extracted from URL. */
  boardToken: string;
  /** When the observation was made. */
  observedAt: string;
  /** Number of listings seen during this scout observation. */
  listingsSeen: number;
  /** Whether the scout succeeded (surface was detected and accessible). */
  success: boolean;
  /** Error/reason if success is false. */
  failureReason: string;
};

export type ScoutObservationQuery = {
  /** Filter by run ID. */
  runId?: string | null;
  /** Filter by surface ID. */
  surfaceId?: string | null;
  /** Filter by company reference. */
  companyRef?: string | null;
  /** Filter by source ID. */
  sourceId?: string | null;
  /** Filter by source lane. */
  sourceLane?: string | null;
  /** Filter by success status. */
  success?: boolean | null;
  /** Limit results. */
  limit?: number | null;
};

export type DiscoveryMemorySnapshot = {
  intentKey: string;
  companies: CompanyRegistryRecord[];
  careerSurfaces: CareerSurfaceRecord[];
  deadLinks: DeadLinkRecord[];
  listingFingerprints: ListingFingerprintRecord[];
  intentCoverage: IntentCoverageRecord[];
  /** Role-family patterns learned from accepted/near-miss leads for adjacent company targeting (VAL-LOOP-MEM-004) */
  roleFamilies: DiscoveryRoleFamilyRecord[];
};

export type PlannedCompanySelectionResult = {
  plannedCompanies: PlannedCompany[];
  suppressedCompanies?: PlannedCompany[];
};

export type CompanyPlanner = {
  buildIntent(config: EffectiveDiscoveryConfig): DiscoveryIntent;
  planCompanies(input: {
    run: DiscoveryRun;
    intent: DiscoveryIntent;
    companies: CompanyTarget[];
    memory?: DiscoveryMemorySnapshot | null;
  }):
    | Promise<PlannedCompany[] | PlannedCompanySelectionResult>
    | PlannedCompany[]
    | PlannedCompanySelectionResult;
};

export type DiscoveryMemoryStore = {
  loadSnapshot(input: {
    run: DiscoveryRun;
    intentKey: string;
  }): Promise<DiscoveryMemorySnapshot> | DiscoveryMemorySnapshot;
  upsertCompanyRecords?(
    records: CompanyRegistryRecord[],
  ): Promise<void> | void;
  upsertCareerSurfaces?(
    records: CareerSurfaceRecord[],
  ): Promise<void> | void;
  getHostSuppression?(
    host: string,
  ): Promise<HostSuppressionRecord | null> | HostSuppressionRecord | null;
  isHostSuppressed?(
    host: string,
    now?: string,
  ): Promise<boolean> | boolean;
  upsertHostSuppression?(
    input: HostSuppressionUpsert,
  ): Promise<void> | void;
  getDeadLink?(
    url: string,
  ): Promise<DeadLinkRecord | null> | DeadLinkRecord | null;
  isDeadLinkCoolingDown?(
    url: string,
    now?: string,
  ): Promise<boolean> | boolean;
  recordDeadLink?(record: DeadLinkRecord): Promise<void> | void;
  findListingFingerprint?(
    fingerprintKey: string,
  ): Promise<ListingFingerprintRecord | null> | ListingFingerprintRecord | null;
  upsertListingFingerprints?(
    records: ListingFingerprintRecord[],
  ): Promise<void> | void;
  recordIntentCoverage?(
    record: IntentCoverageRecord,
  ): Promise<void> | void;
  writeScoutObservation?(
    record: ScoutObservationRecord,
  ): Promise<void> | void;
  listScoutObservations?(
    query?: ScoutObservationQuery,
  ): Promise<ScoutObservationRecord[]> | ScoutObservationRecord[];
  writeExploitOutcome?(
    record: DiscoveryExploitOutcomeWrite,
  ):
    | Promise<DiscoveryExploitOutcomeRecord>
    | DiscoveryExploitOutcomeRecord;
  learnRoleFamilyFromLead?(
    input: DiscoveryRoleFamilyLearnInput,
  ):
    | Promise<DiscoveryRoleFamilyRecord | null>
    | DiscoveryRoleFamilyRecord
    | null;
};

export type BrowserUseSessionRequest = {
  url: string;
  instruction: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
};

export type BrowserUseSessionResult = {
  url: string;
  text: string;
  metadata: Record<string, unknown>;
};
