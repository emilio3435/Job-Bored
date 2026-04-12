export const DISCOVERY_WEBHOOK_EVENT = "command-center.discovery";
export const DISCOVERY_WEBHOOK_SCHEMA_VERSION = 1;
export const DEFAULT_PIPELINE_SHEET_NAME = "Pipeline";
export const DEFAULT_STATUS = "New";
export const PIPELINE_DEDUPE_COLUMN = "E";
export const PIPELINE_DEDUPE_HEADER = "Link";
export const ATS_SOURCE_IDS = ["greenhouse", "lever", "ashby"] as const;
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
] as const;

export type SupportedSourceId = (typeof SUPPORTED_SOURCE_IDS)[number];
export type AtsSourceId = (typeof ATS_SOURCE_IDS)[number];
export type SourcePreset = (typeof SOURCE_PRESET_VALUES)[number];

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
  };
};

/**
 * Stable diagnostic codes for extraction observability.
 * Used in structured diagnostic entries paired with backward-compatible warning strings.
 */
export type ExtractionDiagnosticCode =
  /** Browser-use command failed; fell back to plain HTTP fetch. */
  | "fetch_fallback"
  /** Response appears to be an SPA loading state or skeleton HTML (very short, mostly whitespace/script). */
  | "low_content_spa"
  /** Response is mostly HTML with minimal extractable content (likely a broken/minimal page). */
  | "low_content_html"
  /** Extraction returned zero job listings despite successful page load. */
  | "zero_results";

/**
 * Structured diagnostic entry for extraction observability.
 * Provides machine-readable context paired with backward-compatible warning strings.
 */
export type ExtractionDiagnostic = {
  /** Stable diagnostic code identifying the event type. */
  code: ExtractionDiagnosticCode;
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
  includeKeywords?: string[];
  excludeKeywords?: string[];
  boardHints?: Partial<Record<AtsSourceId, string>>;
};

export type StoredWorkerConfig = {
  sheetId: string;
  mode: "local" | "hosted";
  timezone: string;
  companies: CompanyTarget[];
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
};

export type BoardContext = {
  sourceId: AtsSourceId;
  sourceLabel: string;
  boardUrl: string;
  company: CompanyTarget;
  run: DiscoveryRun;
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
};

export type SourceAdapter = {
  sourceId: AtsSourceId;
  sourceLabel: string;
  detect(companyContext: CompanyContext): Promise<DetectionResult | null>;
  listJobs(boardContext: BoardContext): Promise<RawListing[]>;
  normalize(raw: RawListing, run: DiscoveryRun): Promise<NormalizedLead | null>;
};

export type BrowserUseSessionRequest = {
  url: string;
  instruction: string;
  timeoutMs?: number;
};

export type BrowserUseSessionResult = {
  url: string;
  text: string;
  metadata: Record<string, unknown>;
};
