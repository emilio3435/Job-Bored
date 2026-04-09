export const DISCOVERY_WEBHOOK_EVENT = "command-center.discovery";
export const DISCOVERY_WEBHOOK_SCHEMA_VERSION = 1;
export const DEFAULT_PIPELINE_SHEET_NAME = "Pipeline";
export const DEFAULT_STATUS = "New";
export const PIPELINE_DEDUPE_COLUMN = "E";
export const PIPELINE_DEDUPE_HEADER = "Link";
export const SUPPORTED_SOURCE_IDS = ["greenhouse", "lever", "ashby"] as const;
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
] as const;

export type SupportedSourceId = (typeof SUPPORTED_SOURCE_IDS)[number];

export type DiscoveryProfile = {
  targetRoles?: string;
  locations?: string;
  remotePolicy?: string;
  seniority?: string;
  keywordsInclude?: string;
  keywordsExclude?: string;
  maxLeadsPerRun?: string;
};

export type DiscoveryWebhookRequestV1 = {
  event: typeof DISCOVERY_WEBHOOK_EVENT;
  schemaVersion: typeof DISCOVERY_WEBHOOK_SCHEMA_VERSION;
  sheetId: string;
  variationKey: string;
  requestedAt: string;
  discoveryProfile?: DiscoveryProfile;
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
  discoveredAt: string;
  metadata: {
    runId: string;
    variationKey: string;
    sourceQuery: string;
  };
};

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
};

export type PipelineWriteResult = {
  sheetId: string;
  appended: number;
  updated: number;
  skippedDuplicates: number;
  warnings: string[];
};

export type DiscoveryWebhookAck = {
  ok: true;
  kind: "accepted_async" | "completed_sync";
  runId: string;
  message: string;
};

export type TriggerKind = "manual" | "scheduled";

export type CompanyTarget = {
  name: string;
  includeKeywords?: string[];
  excludeKeywords?: string[];
  boardHints?: Partial<Record<SupportedSourceId, string>>;
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
};

export type EffectiveDiscoveryConfig = StoredWorkerConfig & {
  variationKey: string;
  requestedAt: string;
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
  sourceId: SupportedSourceId;
  sourceLabel: string;
  boardUrl: string;
  confidence: number;
  warnings: string[];
};

export type BoardContext = {
  sourceId: SupportedSourceId;
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
  sourceId: SupportedSourceId;
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
