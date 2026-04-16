import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

type JsonObject = Record<string, unknown>;
type ProviderHints = Record<string, string[]>;

const SAFE_TRACKING_PARAM_PATTERN =
  /^(utm_.+|ref|source|src|gh_src|lever-source|fbclid|gclid|trk)$/i;

type CompanyRegistryRow = {
  company_key: string;
  display_name: string;
  normalized_name: string;
  aliases_json: string;
  domains_json: string;
  ats_hints_json: string;
  geo_tags_json: string;
  role_tags_json: string;
  first_seen_at: string;
  last_seen_at: string;
  last_success_at: string | null;
  success_count: number;
  failure_count: number;
  confidence: number;
  cooldown_until: string | null;
};

type CareerSurfaceRow = {
  surface_id: string;
  company_key: string;
  surface_type: string;
  provider_type: string | null;
  canonical_url: string;
  host: string | null;
  final_url: string | null;
  board_token: string | null;
  source_lane: string;
  verified_status: string;
  last_verified_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_reason: string | null;
  failure_streak: number;
  cooldown_until: string | null;
  metadata_json: string;
};

type DeadLinkRow = {
  url_key: string;
  final_url: string | null;
  host: string | null;
  reason_code: string;
  http_status: number | null;
  last_title: string | null;
  last_seen_at: string;
  failure_count: number;
  next_retry_at: string | null;
};

type HostSuppressionRow = {
  host_key: string;
  host: string;
  quality_score: number;
  junk_extraction_count: number;
  canonical_resolution_failure_count: number;
  suppression_count: number;
  last_seen_at: string;
  last_reason_code: string | null;
  next_retry_at: string | null;
  cooldown_until: string | null;
};

type ListingFingerprintRow = {
  fingerprint_key: string;
  company_key: string;
  title_key: string;
  location_key: string;
  canonical_url_key: string | null;
  external_job_id: string | null;
  remote_bucket: string;
  employment_type: string | null;
  semantic_key: string;
  content_hash: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_written_at: string | null;
  last_run_id: string | null;
  last_sheet_id: string | null;
  write_count: number;
  source_ids_json: string;
};

type IntentCoverageRow = {
  intent_key: string;
  company_key: string;
  run_id: string;
  source_lane: string;
  surfaces_seen: number;
  listings_seen: number;
  listings_written: number;
  started_at: string;
  completed_at: string | null;
};

type ScoutObservationRow = {
  observation_key: string;
  run_id: string;
  surface_id: string;
  company_key: string;
  source_id: string;
  source_lane: string;
  surface_type: string;
  canonical_url: string;
  provider_type: string;
  host: string;
  final_url: string;
  board_token: string;
  observed_at: string;
  listings_seen: number;
  success: number;
  failure_reason: string;
};

type ExploitOutcomeRow = {
  outcome_key: string;
  run_id: string;
  intent_key: string;
  surface_id: string;
  company_key: string;
  source_id: string;
  source_lane: string;
  surface_type: string;
  canonical_url: string;
  observed_at: string;
  listings_seen: number;
  listings_accepted: number;
  listings_rejected: number;
  listings_written: number;
  rejection_reasons_json: string;
  rejection_samples_json: string;
};

type RoleFamilyRow = {
  family_key: string;
  base_role: string;
  role_variants_json: string;
  company_key: string;
  source_lane: string;
  confirmed_count: number;
  near_miss_count: number;
  last_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyRegistryRecord = {
  companyKey: string;
  displayName: string;
  normalizedName: string;
  aliases: string[];
  domains: string[];
  atsHints: ProviderHints;
  geoTags: string[];
  roleTags: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  lastSuccessAt: string | null;
  successCount: number;
  failureCount: number;
  confidence: number;
  cooldownUntil: string | null;
};

export type CompanyRegistryUpsert = {
  companyKey: string;
  displayName: string;
  normalizedName?: string | null;
  aliases?: string[];
  domains?: string[];
  atsHints?: Record<string, string | string[] | null | undefined>;
  geoTags?: string[];
  roleTags?: string[];
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  lastSuccessAt?: string | null;
  successIncrement?: number;
  failureIncrement?: number;
  confidence?: number | null;
  cooldownUntil?: string | null;
};

export type CareerSurfaceRecord = {
  surfaceId: string;
  companyKey: string;
  surfaceType: string;
  providerType: string | null;
  canonicalUrl: string;
  host: string | null;
  finalUrl: string | null;
  boardToken: string | null;
  sourceLane: string;
  verifiedStatus: string;
  lastVerifiedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureReason: string | null;
  failureStreak: number;
  cooldownUntil: string | null;
  metadata: JsonObject;
};

export type CareerSurfaceUpsert = {
  surfaceId?: string | null;
  companyKey: string;
  surfaceType: string;
  providerType?: string | null;
  canonicalUrl: string;
  finalUrl?: string | null;
  boardToken?: string | null;
  sourceLane?: string | null;
  verifiedStatus?: string | null;
  lastVerifiedAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  failureReason?: string | null;
  failureStreak?: number | null;
  cooldownUntil?: string | null;
  metadata?: JsonObject | null;
};

export type CareerSurfaceQuery = {
  companyKey?: string | null;
  companyKeys?: string[] | null;
  providerType?: string | null;
  surfaceType?: string | null;
  verifiedStatuses?: string[] | null;
  verifiedOnly?: boolean;
  excludeCoolingDown?: boolean;
  now?: string | null;
};

export type CareerSurfaceOutcomeInput = {
  surfaceId?: string | null;
  companyKey: string;
  surfaceType: string;
  providerType?: string | null;
  canonicalUrl: string;
  finalUrl?: string | null;
  boardToken?: string | null;
  sourceLane?: string | null;
  checkedAt?: string | null;
  cooldownUntil?: string | null;
  failureReason?: string | null;
  metadata?: JsonObject | null;
};

export type DeadLinkRecord = {
  urlKey: string;
  finalUrl: string | null;
  host: string | null;
  reasonCode: string;
  httpStatus: number | null;
  lastTitle: string | null;
  lastSeenAt: string;
  failureCount: number;
  nextRetryAt: string | null;
};

export type DeadLinkUpsert = {
  url: string;
  finalUrl?: string | null;
  host?: string | null;
  reasonCode: string;
  httpStatus?: number | null;
  lastTitle?: string | null;
  lastSeenAt?: string | null;
  failureIncrement?: number;
  nextRetryAt?: string | null;
};

export type HostSuppressionRecord = {
  hostKey: string;
  host: string;
  qualityScore: number;
  junkExtractionCount: number;
  canonicalResolutionFailureCount: number;
  suppressionCount: number;
  lastSeenAt: string;
  lastReasonCode: string | null;
  nextRetryAt: string | null;
  cooldownUntil: string | null;
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

export type ListingFingerprintRecord = {
  fingerprintKey: string;
  companyKey: string;
  titleKey: string;
  locationKey: string;
  canonicalUrlKey: string | null;
  externalJobId: string | null;
  remoteBucket: string;
  employmentType: string | null;
  semanticKey: string;
  contentHash: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastWrittenAt: string | null;
  lastRunId: string | null;
  lastSheetId: string | null;
  writeCount: number;
  sourceIds: string[];
};

export type ListingFingerprintLookup = {
  fingerprintKey?: string | null;
  canonicalUrl?: string | null;
  canonicalUrlKey?: string | null;
  externalJobId?: string | null;
  companyKey?: string | null;
  titleKey?: string | null;
  locationKey?: string | null;
  remoteBucket?: string | null;
  contentHash?: string | null;
};

export type ListingFingerprintUpsert = {
  companyKey: string;
  titleKey: string;
  locationKey: string;
  canonicalUrl?: string | null;
  canonicalUrlKey?: string | null;
  externalJobId?: string | null;
  remoteBucket: string;
  employmentType?: string | null;
  contentHash?: string | null;
  seenAt?: string | null;
  writtenAt?: string | null;
  runId?: string | null;
  sheetId?: string | null;
  sourceIds?: string[];
};

export type IntentCoverageRecord = {
  intentKey: string;
  companyKey: string;
  runId: string;
  sourceLane: string;
  surfacesSeen: number;
  listingsSeen: number;
  listingsWritten: number;
  startedAt: string;
  completedAt: string | null;
};

export type IntentCoverageWrite = {
  intentKey: string;
  companyKey: string;
  runId: string;
  sourceLane: string;
  surfacesSeen?: number;
  listingsSeen?: number;
  listingsWritten?: number;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type IntentCoverageQuery = {
  intentKey?: string | null;
  companyKey?: string | null;
  runId?: string | null;
  sourceLane?: string | null;
  limit?: number | null;
};

export type ScoutObservationRecord = {
  observationRef: string;
  runId: string;
  surfaceId: string;
  companyRef: string;
  sourceId: string;
  sourceLane: string;
  surfaceType: string;
  canonicalUrl: string;
  providerType: string;
  host: string;
  finalUrl: string;
  boardToken: string;
  observedAt: string;
  listingsSeen: number;
  success: boolean;
  failureReason: string;
};

export type ScoutObservationQuery = {
  runId?: string | null;
  surfaceId?: string | null;
  companyRef?: string | null;
  sourceId?: string | null;
  sourceLane?: string | null;
  success?: boolean | null;
  limit?: number | null;
};

export type ExploitOutcomeRecord = {
  outcomeKey: string;
  runId: string;
  intentKey: string;
  surfaceId: string;
  companyKey: string;
  sourceId: string;
  sourceLane: string;
  surfaceType: string;
  canonicalUrl: string;
  observedAt: string;
  listingsSeen: number;
  listingsAccepted: number;
  listingsRejected: number;
  listingsWritten: number;
  rejectionReasons: Record<string, number>;
  rejectionSamples: Array<{
    reason: string;
    title: string;
    company: string;
    url: string;
    detail: string;
  }>;
};

export type ExploitOutcomeWrite = {
  runId: string;
  intentKey: string;
  surfaceId?: string | null;
  companyKey: string;
  sourceId: string;
  sourceLane: string;
  surfaceType: string;
  canonicalUrl: string;
  observedAt?: string | null;
  listingsSeen?: number;
  listingsAccepted?: number;
  listingsRejected?: number;
  listingsWritten?: number;
  rejectionReasons?: Record<string, number>;
  rejectionSamples?: Array<{
    reason: string;
    title: string;
    company: string;
    url: string;
    detail: string;
  }>;
};

export type ExploitOutcomeQuery = {
  runId?: string | null;
  intentKey?: string | null;
  surfaceId?: string | null;
  companyKey?: string | null;
  sourceId?: string | null;
  sourceLane?: string | null;
  limit?: number | null;
};

export type RoleFamilyRecord = {
  familyKey: string;
  baseRole: string;
  roleVariants: string[];
  companyKey: string;
  sourceLane: string;
  confirmedCount: number;
  nearMissCount: number;
  lastConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoleFamilyUpsert = {
  baseRole: string;
  roleVariant?: string | null;
  companyKey?: string | null;
  sourceLane?: string | null;
  confirmed?: boolean;
  nearMiss?: boolean;
};

export type RoleFamilyQuery = {
  baseRole?: string | null;
  companyKey?: string | null;
  sourceLane?: string | null;
  limit?: number | null;
};

export type PlannerMemoryQuery = {
  intentKey?: string | null;
  companyKeys?: string[] | null;
  now?: string | null;
  limitCompanies?: number | null;
  includeCoolingDownCompanies?: boolean;
  includeCoolingDownSurfaces?: boolean;
  includeUnverifiedSurfaces?: boolean;
};

export type PlannerMemorySnapshot = {
  generatedAt: string;
  companies: CompanyRegistryRecord[];
  careerSurfaces: CareerSurfaceRecord[];
  intentCoverage: IntentCoverageRecord[];
  roleFamilies: RoleFamilyRecord[];
};

export type DiscoveryMemoryCounts = {
  companyRegistry: number;
  careerSurfaces: number;
  hostSuppressions: number;
  deadLinkCache: number;
  listingFingerprints: number;
  intentCoverage: number;
  scoutObservations: number;
  exploitOutcomes: number;
  roleFamilies: number;
};

export type DiscoveryMemoryStore = {
  getCompany(companyKey: string): CompanyRegistryRecord | null;
  upsertCompany(input: CompanyRegistryUpsert): CompanyRegistryRecord;
  getCounts(): DiscoveryMemoryCounts;
  loadPlannerSnapshot(query?: PlannerMemoryQuery): PlannerMemorySnapshot;
  listCareerSurfaces(query?: CareerSurfaceQuery): CareerSurfaceRecord[];
  upsertCareerSurface(input: CareerSurfaceUpsert): CareerSurfaceRecord;
  markCareerSurfaceSuccess(
    input: CareerSurfaceOutcomeInput,
  ): CareerSurfaceRecord;
  markCareerSurfaceFailure(
    input: CareerSurfaceOutcomeInput,
  ): CareerSurfaceRecord;
  getHostSuppression(host: string): HostSuppressionRecord | null;
  isHostSuppressed(host: string, now?: string): boolean;
  upsertHostSuppression(input: HostSuppressionUpsert): HostSuppressionRecord;
  getDeadLink(url: string): DeadLinkRecord | null;
  isDeadLinkCoolingDown(url: string, now?: string): boolean;
  upsertDeadLink(input: DeadLinkUpsert): DeadLinkRecord;
  clearDeadLink(url: string): void;
  findListingFingerprint(
    lookup: ListingFingerprintLookup,
  ): ListingFingerprintRecord | null;
  upsertListingFingerprint(
    input: ListingFingerprintUpsert,
  ): ListingFingerprintRecord;
  writeIntentCoverage(input: IntentCoverageWrite): IntentCoverageRecord;
  listIntentCoverage(query?: IntentCoverageQuery): IntentCoverageRecord[];
  writeScoutObservation(input: ScoutObservationRecord): ScoutObservationRecord;
  listScoutObservations(query?: ScoutObservationQuery): ScoutObservationRecord[];
  writeExploitOutcome(input: ExploitOutcomeWrite): ExploitOutcomeRecord;
  listExploitOutcomes(query?: ExploitOutcomeQuery): ExploitOutcomeRecord[];
  upsertRoleFamily(input: RoleFamilyUpsert): RoleFamilyRecord;
  listRoleFamilies(query?: RoleFamilyQuery): RoleFamilyRecord[];
  learnRoleFamilyFromLead(input: {
    title: string;
    companyKey: string;
    sourceLane: string;
    accepted: boolean;
  }): RoleFamilyRecord | null;
  close(): void;
};

export function createDiscoveryMemoryStore(
  databasePath: string,
): DiscoveryMemoryStore {
  const resolvedPath = String(databasePath || "").trim() || ":memory:";
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath);
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS company_registry (
      company_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      domains_json TEXT NOT NULL,
      ats_hints_json TEXT NOT NULL,
      geo_tags_json TEXT NOT NULL,
      role_tags_json TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_success_at TEXT,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      cooldown_until TEXT
    );

    CREATE TABLE IF NOT EXISTS career_surfaces (
      surface_id TEXT PRIMARY KEY,
      company_key TEXT NOT NULL,
      surface_type TEXT NOT NULL,
      provider_type TEXT,
      canonical_url TEXT NOT NULL,
      host TEXT,
      final_url TEXT,
      board_token TEXT,
      source_lane TEXT NOT NULL,
      verified_status TEXT NOT NULL,
      last_verified_at TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      failure_reason TEXT,
      failure_streak INTEGER NOT NULL DEFAULT 0,
      cooldown_until TEXT,
      metadata_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS host_suppressions (
      host_key TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      quality_score REAL NOT NULL DEFAULT 0,
      junk_extraction_count INTEGER NOT NULL DEFAULT 0,
      canonical_resolution_failure_count INTEGER NOT NULL DEFAULT 0,
      suppression_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,
      last_reason_code TEXT,
      next_retry_at TEXT,
      cooldown_until TEXT
    );

    CREATE TABLE IF NOT EXISTS dead_link_cache (
      url_key TEXT PRIMARY KEY,
      final_url TEXT,
      host TEXT,
      reason_code TEXT NOT NULL,
      http_status INTEGER,
      last_title TEXT,
      last_seen_at TEXT NOT NULL,
      failure_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT
    );

    CREATE TABLE IF NOT EXISTS listing_fingerprints (
      fingerprint_key TEXT PRIMARY KEY,
      company_key TEXT NOT NULL,
      title_key TEXT NOT NULL,
      location_key TEXT NOT NULL,
      canonical_url_key TEXT,
      external_job_id TEXT,
      remote_bucket TEXT NOT NULL,
      employment_type TEXT,
      semantic_key TEXT NOT NULL,
      content_hash TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_written_at TEXT,
      last_run_id TEXT,
      last_sheet_id TEXT,
      write_count INTEGER NOT NULL DEFAULT 0,
      source_ids_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intent_coverage (
      intent_key TEXT NOT NULL,
      company_key TEXT NOT NULL,
      run_id TEXT NOT NULL,
      source_lane TEXT NOT NULL,
      surfaces_seen INTEGER NOT NULL DEFAULT 0,
      listings_seen INTEGER NOT NULL DEFAULT 0,
      listings_written INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (intent_key, company_key, run_id, source_lane)
    );

    CREATE TABLE IF NOT EXISTS scout_observations (
      observation_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      company_key TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_lane TEXT NOT NULL,
      surface_type TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '',
      final_url TEXT NOT NULL DEFAULT '',
      board_token TEXT NOT NULL DEFAULT '',
      observed_at TEXT NOT NULL,
      listings_seen INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS exploit_outcomes (
      outcome_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      intent_key TEXT NOT NULL,
      surface_id TEXT NOT NULL,
      company_key TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_lane TEXT NOT NULL,
      surface_type TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      listings_seen INTEGER NOT NULL DEFAULT 0,
      listings_accepted INTEGER NOT NULL DEFAULT 0,
      listings_rejected INTEGER NOT NULL DEFAULT 0,
      listings_written INTEGER NOT NULL DEFAULT 0,
      rejection_reasons_json TEXT NOT NULL,
      rejection_samples_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_families (
      family_key TEXT PRIMARY KEY,
      base_role TEXT NOT NULL,
      role_variants_json TEXT NOT NULL,
      company_key TEXT NOT NULL,
      source_lane TEXT NOT NULL,
      confirmed_count INTEGER NOT NULL DEFAULT 0,
      near_miss_count INTEGER NOT NULL DEFAULT 0,
      last_confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_company_registry_cooldown
      ON company_registry (cooldown_until, last_success_at);
    CREATE INDEX IF NOT EXISTS idx_company_registry_name
      ON company_registry (normalized_name);
    CREATE INDEX IF NOT EXISTS idx_career_surfaces_company
      ON career_surfaces (company_key, verified_status, cooldown_until);
    CREATE INDEX IF NOT EXISTS idx_career_surfaces_provider
      ON career_surfaces (provider_type, canonical_url);
    CREATE INDEX IF NOT EXISTS idx_host_suppressions_retry
      ON host_suppressions (next_retry_at, cooldown_until);
    CREATE INDEX IF NOT EXISTS idx_dead_link_retry
      ON dead_link_cache (next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_listing_fingerprints_primary
      ON listing_fingerprints (canonical_url_key, external_job_id);
    CREATE INDEX IF NOT EXISTS idx_listing_fingerprints_semantic
      ON listing_fingerprints (semantic_key);
    CREATE INDEX IF NOT EXISTS idx_listing_fingerprints_content
      ON listing_fingerprints (content_hash);
    CREATE INDEX IF NOT EXISTS idx_intent_coverage_lookup
      ON intent_coverage (intent_key, company_key, started_at);
    CREATE INDEX IF NOT EXISTS idx_scout_observations_run
      ON scout_observations (run_id);
    CREATE INDEX IF NOT EXISTS idx_scout_observations_surface
      ON scout_observations (surface_id);
    CREATE INDEX IF NOT EXISTS idx_scout_observations_run_surface
      ON scout_observations (run_id, surface_id);
    CREATE INDEX IF NOT EXISTS idx_exploit_outcomes_run
      ON exploit_outcomes (run_id);
    CREATE INDEX IF NOT EXISTS idx_exploit_outcomes_intent
      ON exploit_outcomes (intent_key);
    CREATE INDEX IF NOT EXISTS idx_exploit_outcomes_surface
      ON exploit_outcomes (surface_id);
    CREATE INDEX IF NOT EXISTS idx_exploit_outcomes_company
      ON exploit_outcomes (company_key);
    CREATE INDEX IF NOT EXISTS idx_role_families_base
      ON role_families (base_role);
    CREATE INDEX IF NOT EXISTS idx_role_families_company
      ON role_families (company_key);
  `);

  const getCompanyStatement = database.prepare(`
    SELECT *
    FROM company_registry
    WHERE company_key = ?
  `);
  const countCompanyRegistryStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM company_registry
  `);
  const countCareerSurfacesStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM career_surfaces
  `);
  const countHostSuppressionsStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM host_suppressions
  `);
  const countDeadLinkCacheStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM dead_link_cache
  `);
  const countListingFingerprintsStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM listing_fingerprints
  `);
  const countIntentCoverageStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM intent_coverage
  `);
  const countScoutObservationsStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM scout_observations
  `);
  const upsertScoutObservationStatement = database.prepare(`
    INSERT INTO scout_observations (
      observation_key,
      run_id,
      surface_id,
      company_key,
      source_id,
      source_lane,
      surface_type,
      canonical_url,
      provider_type,
      host,
      final_url,
      board_token,
      observed_at,
      listings_seen,
      success,
      failure_reason
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(observation_key) DO UPDATE SET
      run_id = excluded.run_id,
      surface_id = excluded.surface_id,
      company_key = excluded.company_key,
      source_id = excluded.source_id,
      source_lane = excluded.source_lane,
      surface_type = excluded.surface_type,
      canonical_url = excluded.canonical_url,
      provider_type = excluded.provider_type,
      host = excluded.host,
      final_url = excluded.final_url,
      board_token = excluded.board_token,
      observed_at = excluded.observed_at,
      listings_seen = excluded.listings_seen,
      success = excluded.success,
      failure_reason = excluded.failure_reason
  `);
  const listScoutObservationsStatement = database.prepare(`
    SELECT *
    FROM scout_observations
    WHERE 1=1
  `);
  const countExploitOutcomesStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM exploit_outcomes
  `);
  const countRoleFamiliesStatement = database.prepare(`
    SELECT COUNT(*) AS count
    FROM role_families
  `);
  const upsertExploitOutcomeStatement = database.prepare(`
    INSERT INTO exploit_outcomes (
      outcome_key,
      run_id,
      intent_key,
      surface_id,
      company_key,
      source_id,
      source_lane,
      surface_type,
      canonical_url,
      observed_at,
      listings_seen,
      listings_accepted,
      listings_rejected,
      listings_written,
      rejection_reasons_json,
      rejection_samples_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(outcome_key) DO UPDATE SET
      run_id = excluded.run_id,
      intent_key = excluded.intent_key,
      surface_id = excluded.surface_id,
      company_key = excluded.company_key,
      source_id = excluded.source_id,
      source_lane = excluded.source_lane,
      surface_type = excluded.surface_type,
      canonical_url = excluded.canonical_url,
      observed_at = excluded.observed_at,
      listings_seen = excluded.listings_seen,
      listings_accepted = excluded.listings_accepted,
      listings_rejected = excluded.listings_rejected,
      listings_written = excluded.listings_written,
      rejection_reasons_json = excluded.rejection_reasons_json,
      rejection_samples_json = excluded.rejection_samples_json
  `);
  const listExploitOutcomesStatement = database.prepare(`
    SELECT *
    FROM exploit_outcomes
    WHERE 1=1
  `);
  const upsertRoleFamilyStatement = database.prepare(`
    INSERT INTO role_families (
      family_key,
      base_role,
      role_variants_json,
      company_key,
      source_lane,
      confirmed_count,
      near_miss_count,
      last_confirmed_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(family_key) DO UPDATE SET
      role_variants_json = excluded.role_variants_json,
      company_key = excluded.company_key,
      source_lane = excluded.source_lane,
      confirmed_count = excluded.confirmed_count,
      near_miss_count = excluded.near_miss_count,
      last_confirmed_at = excluded.last_confirmed_at,
      updated_at = excluded.updated_at
  `);
  const getRoleFamilyByKeyStatement = database.prepare(`
    SELECT *
    FROM role_families
    WHERE family_key = ?
    LIMIT 1
  `);
  const listRoleFamiliesStatement = database.prepare(`
    SELECT *
    FROM role_families
    WHERE 1=1
  `);
  const upsertCompanyStatement = database.prepare(`
    INSERT INTO company_registry (
      company_key,
      display_name,
      normalized_name,
      aliases_json,
      domains_json,
      ats_hints_json,
      geo_tags_json,
      role_tags_json,
      first_seen_at,
      last_seen_at,
      last_success_at,
      success_count,
      failure_count,
      confidence,
      cooldown_until
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_key) DO UPDATE SET
      display_name = excluded.display_name,
      normalized_name = excluded.normalized_name,
      aliases_json = excluded.aliases_json,
      domains_json = excluded.domains_json,
      ats_hints_json = excluded.ats_hints_json,
      geo_tags_json = excluded.geo_tags_json,
      role_tags_json = excluded.role_tags_json,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      last_success_at = excluded.last_success_at,
      success_count = excluded.success_count,
      failure_count = excluded.failure_count,
      confidence = excluded.confidence,
      cooldown_until = excluded.cooldown_until
  `);
  const getCareerSurfaceByIdStatement = database.prepare(`
    SELECT *
    FROM career_surfaces
    WHERE surface_id = ?
  `);
  const getCareerSurfaceByNaturalKeyStatement = database.prepare(`
    SELECT *
    FROM career_surfaces
    WHERE company_key = ? AND surface_type = ? AND canonical_url = ? AND COALESCE(provider_type, '') = ?
    ORDER BY
      CASE verified_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      last_verified_at DESC,
      last_success_at DESC
    LIMIT 1
  `);
  const upsertCareerSurfaceStatement = database.prepare(`
    INSERT INTO career_surfaces (
      surface_id,
      company_key,
      surface_type,
      provider_type,
      canonical_url,
      host,
      final_url,
      board_token,
      source_lane,
      verified_status,
      last_verified_at,
      last_success_at,
      last_failure_at,
      failure_reason,
      failure_streak,
      cooldown_until,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(surface_id) DO UPDATE SET
      company_key = excluded.company_key,
      surface_type = excluded.surface_type,
      provider_type = excluded.provider_type,
      canonical_url = excluded.canonical_url,
      host = excluded.host,
      final_url = excluded.final_url,
      board_token = excluded.board_token,
      source_lane = excluded.source_lane,
      verified_status = excluded.verified_status,
      last_verified_at = excluded.last_verified_at,
      last_success_at = excluded.last_success_at,
      last_failure_at = excluded.last_failure_at,
      failure_reason = excluded.failure_reason,
      failure_streak = excluded.failure_streak,
      cooldown_until = excluded.cooldown_until,
      metadata_json = excluded.metadata_json
  `);
  const getHostSuppressionStatement = database.prepare(`
    SELECT *
    FROM host_suppressions
    WHERE host_key = ?
    LIMIT 1
  `);
  const upsertHostSuppressionStatement = database.prepare(`
    INSERT INTO host_suppressions (
      host_key,
      host,
      quality_score,
      junk_extraction_count,
      canonical_resolution_failure_count,
      suppression_count,
      last_seen_at,
      last_reason_code,
      next_retry_at,
      cooldown_until
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(host_key) DO UPDATE SET
      host = excluded.host,
      quality_score = excluded.quality_score,
      junk_extraction_count = excluded.junk_extraction_count,
      canonical_resolution_failure_count = excluded.canonical_resolution_failure_count,
      suppression_count = excluded.suppression_count,
      last_seen_at = excluded.last_seen_at,
      last_reason_code = excluded.last_reason_code,
      next_retry_at = excluded.next_retry_at,
      cooldown_until = excluded.cooldown_until
  `);
  const getDeadLinkStatement = database.prepare(`
    SELECT *
    FROM dead_link_cache
    WHERE url_key = ?
  `);
  const upsertDeadLinkStatement = database.prepare(`
    INSERT INTO dead_link_cache (
      url_key,
      final_url,
      host,
      reason_code,
      http_status,
      last_title,
      last_seen_at,
      failure_count,
      next_retry_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url_key) DO UPDATE SET
      final_url = excluded.final_url,
      host = excluded.host,
      reason_code = excluded.reason_code,
      http_status = excluded.http_status,
      last_title = excluded.last_title,
      last_seen_at = excluded.last_seen_at,
      failure_count = excluded.failure_count,
      next_retry_at = excluded.next_retry_at
  `);
  const clearDeadLinkStatement = database.prepare(`
    DELETE FROM dead_link_cache
    WHERE url_key = ?
  `);
  const getListingFingerprintByKeyStatement = database.prepare(`
    SELECT *
    FROM listing_fingerprints
    WHERE fingerprint_key = ?
    LIMIT 1
  `);
  const getListingFingerprintByPrimaryStatement = database.prepare(`
    SELECT *
    FROM listing_fingerprints
    WHERE canonical_url_key = ? AND external_job_id = ?
    ORDER BY last_seen_at DESC
    LIMIT 1
  `);
  const getListingFingerprintByUrlStatement = database.prepare(`
    SELECT *
    FROM listing_fingerprints
    WHERE canonical_url_key = ?
    ORDER BY
      CASE WHEN external_job_id IS NOT NULL AND external_job_id <> '' THEN 0 ELSE 1 END,
      last_seen_at DESC
    LIMIT 1
  `);
  const getListingFingerprintBySemanticStatement = database.prepare(`
    SELECT *
    FROM listing_fingerprints
    WHERE semantic_key = ?
    ORDER BY last_seen_at DESC
    LIMIT 1
  `);
  const getListingFingerprintByContentHashStatement = database.prepare(`
    SELECT *
    FROM listing_fingerprints
    WHERE content_hash = ?
    ORDER BY last_seen_at DESC
    LIMIT 1
  `);
  const upsertListingFingerprintStatement = database.prepare(`
    INSERT INTO listing_fingerprints (
      fingerprint_key,
      company_key,
      title_key,
      location_key,
      canonical_url_key,
      external_job_id,
      remote_bucket,
      employment_type,
      semantic_key,
      content_hash,
      first_seen_at,
      last_seen_at,
      last_written_at,
      last_run_id,
      last_sheet_id,
      write_count,
      source_ids_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fingerprint_key) DO UPDATE SET
      company_key = excluded.company_key,
      title_key = excluded.title_key,
      location_key = excluded.location_key,
      canonical_url_key = excluded.canonical_url_key,
      external_job_id = excluded.external_job_id,
      remote_bucket = excluded.remote_bucket,
      employment_type = excluded.employment_type,
      semantic_key = excluded.semantic_key,
      content_hash = excluded.content_hash,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      last_written_at = excluded.last_written_at,
      last_run_id = excluded.last_run_id,
      last_sheet_id = excluded.last_sheet_id,
      write_count = excluded.write_count,
      source_ids_json = excluded.source_ids_json
  `);
  const getIntentCoverageStatement = database.prepare(`
    SELECT *
    FROM intent_coverage
    WHERE intent_key = ? AND company_key = ? AND run_id = ? AND source_lane = ?
  `);
  const upsertIntentCoverageStatement = database.prepare(`
    INSERT INTO intent_coverage (
      intent_key,
      company_key,
      run_id,
      source_lane,
      surfaces_seen,
      listings_seen,
      listings_written,
      started_at,
      completed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(intent_key, company_key, run_id, source_lane) DO UPDATE SET
      surfaces_seen = excluded.surfaces_seen,
      listings_seen = excluded.listings_seen,
      listings_written = excluded.listings_written,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at
  `);

  return {
    getCompany(companyKey) {
      const key = normalizeRequiredString(companyKey, "companyKey");
      const row = getCompanyStatement.get(key) as CompanyRegistryRow | undefined;
      return row ? mapCompanyRegistryRow(row) : null;
    },

    getCounts() {
      return {
        companyRegistry: readCount(countCompanyRegistryStatement),
        careerSurfaces: readCount(countCareerSurfacesStatement),
        hostSuppressions: readCount(countHostSuppressionsStatement),
        deadLinkCache: readCount(countDeadLinkCacheStatement),
        listingFingerprints: readCount(countListingFingerprintsStatement),
        intentCoverage: readCount(countIntentCoverageStatement),
        scoutObservations: readCount(countScoutObservationsStatement),
        exploitOutcomes: readCount(countExploitOutcomesStatement),
        roleFamilies: readCount(countRoleFamiliesStatement),
      };
    },

    upsertCompany(input) {
      const now = normalizeTimestamp(input.lastSeenAt, new Date().toISOString());
      const key = normalizeRequiredString(input.companyKey, "companyKey");
      const displayName = normalizeRequiredString(input.displayName, "displayName");
      const existing = this.getCompany(key);
      const merged: CompanyRegistryRecord = {
        companyKey: key,
        displayName,
        normalizedName:
          normalizeNullableString(input.normalizedName) ||
          existing?.normalizedName ||
          normalizeTextKey(displayName),
        aliases: mergeStringArrays(
          existing?.aliases || [],
          input.aliases || [],
          normalizeNullableString,
        ),
        domains: mergeStringArrays(
          existing?.domains || [],
          input.domains || [],
          normalizeDomain,
        ),
        atsHints: mergeProviderHints(existing?.atsHints || {}, input.atsHints || {}),
        geoTags: mergeStringArrays(
          existing?.geoTags || [],
          input.geoTags || [],
          normalizeTextKey,
        ),
        roleTags: mergeStringArrays(
          existing?.roleTags || [],
          input.roleTags || [],
          normalizeTextKey,
        ),
        firstSeenAt:
          existing?.firstSeenAt ||
          normalizeTimestamp(input.firstSeenAt, now),
        lastSeenAt: now,
        lastSuccessAt:
          input.lastSuccessAt === undefined
            ? existing?.lastSuccessAt ||
              (normalizeNonNegativeInteger(input.successIncrement) > 0 ? now : null)
            : normalizeNullableTimestamp(input.lastSuccessAt),
        successCount:
          (existing?.successCount || 0) +
          normalizeNonNegativeInteger(input.successIncrement),
        failureCount:
          (existing?.failureCount || 0) +
          normalizeNonNegativeInteger(input.failureIncrement),
        confidence:
          typeof input.confidence === "number"
            ? input.confidence
            : existing?.confidence || 0,
        cooldownUntil:
          input.cooldownUntil === undefined
            ? existing?.cooldownUntil || null
            : normalizeNullableTimestamp(input.cooldownUntil),
      };

      upsertCompanyStatement.run(
        merged.companyKey,
        merged.displayName,
        merged.normalizedName,
        stringifyJson(merged.aliases),
        stringifyJson(merged.domains),
        stringifyJson(merged.atsHints),
        stringifyJson(merged.geoTags),
        stringifyJson(merged.roleTags),
        merged.firstSeenAt,
        merged.lastSeenAt,
        merged.lastSuccessAt,
        merged.successCount,
        merged.failureCount,
        merged.confidence,
        merged.cooldownUntil,
      );

      return merged;
    },

    loadPlannerSnapshot(query = {}) {
      const now = normalizeTimestamp(query.now, new Date().toISOString());
      const companySqlParts = [
        "SELECT *",
        "FROM company_registry",
      ];
      const companyWhere: string[] = [];
      const companyParams: unknown[] = [];

      if (query.companyKeys?.length) {
        companyWhere.push(
          buildInClause("company_key", query.companyKeys, companyParams),
        );
      }
      if (!query.includeCoolingDownCompanies) {
        companyWhere.push("(cooldown_until IS NULL OR cooldown_until <= ?)");
        companyParams.push(now);
      }
      if (companyWhere.length) {
        companySqlParts.push(`WHERE ${companyWhere.join(" AND ")}`);
      }
      companySqlParts.push(
        "ORDER BY",
        "  CASE WHEN last_success_at IS NULL THEN 1 ELSE 0 END,",
        "  last_success_at DESC,",
        "  success_count DESC,",
        "  last_seen_at DESC",
      );
      if (typeof query.limitCompanies === "number" && query.limitCompanies > 0) {
        companySqlParts.push("LIMIT ?");
        companyParams.push(Math.floor(query.limitCompanies));
      }

      const companyRows = database
        .prepare(companySqlParts.join("\n"))
        .all(...companyParams) as CompanyRegistryRow[];
      const companies = companyRows.map(mapCompanyRegistryRow);
      const companyKeys = companies.map((item) => item.companyKey);

      const careerSurfaces = this.listCareerSurfaces({
        ...(companyKeys.length ? { companyKeys } : {}),
        verifiedOnly: !query.includeUnverifiedSurfaces,
        excludeCoolingDown: !query.includeCoolingDownSurfaces,
        now,
      });
      const intentCoverage = this.listIntentCoverage({
        intentKey: query.intentKey,
      }).filter(
        (item) => !companyKeys.length || companyKeys.includes(item.companyKey),
      );

      // VAL-LOOP-MEM-004: Include role families for planner targeting
      const roleFamilies = this.listRoleFamilies();

      return {
        generatedAt: now,
        companies,
        careerSurfaces,
        intentCoverage,
        roleFamilies,
      };
    },

    listCareerSurfaces(query = {}) {
      const sqlParts = ["SELECT *", "FROM career_surfaces"];
      const where: string[] = [];
      const params: unknown[] = [];

      if (query.companyKey) {
        where.push("company_key = ?");
        params.push(normalizeRequiredString(query.companyKey, "companyKey"));
      }
      if (query.companyKeys?.length) {
        where.push(buildInClause("company_key", query.companyKeys, params));
      }
      if (query.providerType) {
        where.push("provider_type = ?");
        params.push(normalizeRequiredString(query.providerType, "providerType"));
      }
      if (query.surfaceType) {
        where.push("surface_type = ?");
        params.push(normalizeRequiredString(query.surfaceType, "surfaceType"));
      }
      if (query.verifiedOnly) {
        where.push("verified_status = 'verified'");
      } else if (query.verifiedStatuses?.length) {
        where.push(
          buildInClause("verified_status", query.verifiedStatuses, params),
        );
      }
      if (query.excludeCoolingDown) {
        const now = normalizeTimestamp(query.now, new Date().toISOString());
        where.push("(cooldown_until IS NULL OR cooldown_until <= ?)");
        params.push(now);
      }
      if (where.length) {
        sqlParts.push(`WHERE ${where.join(" AND ")}`);
      }
      sqlParts.push(
        "ORDER BY",
        "  company_key ASC,",
        "  CASE verified_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,",
        "  last_verified_at DESC,",
        "  last_success_at DESC,",
        "  canonical_url ASC",
      );

      const rows = database
        .prepare(sqlParts.join("\n"))
        .all(...params) as CareerSurfaceRow[];
      return rows.map(mapCareerSurfaceRow);
    },

    upsertCareerSurface(input) {
      const canonicalUrl = normalizeRequiredUrl(input.canonicalUrl, "canonicalUrl");
      const existing =
        (input.surfaceId
          ? ((getCareerSurfaceByIdStatement.get(
              normalizeRequiredString(input.surfaceId, "surfaceId"),
            ) as CareerSurfaceRow | undefined) || null)
          : null) ||
        ((getCareerSurfaceByNaturalKeyStatement.get(
          normalizeRequiredString(input.companyKey, "companyKey"),
          normalizeRequiredString(input.surfaceType, "surfaceType"),
          canonicalUrl,
          normalizeNullableString(input.providerType) || "",
        ) as CareerSurfaceRow | undefined) || null);
      const existingRecord = existing ? mapCareerSurfaceRow(existing) : null;
      const merged = mergeCareerSurface(existingRecord, input);

      upsertCareerSurfaceStatement.run(
        merged.surfaceId,
        merged.companyKey,
        merged.surfaceType,
        merged.providerType,
        merged.canonicalUrl,
        merged.host,
        merged.finalUrl,
        merged.boardToken,
        merged.sourceLane,
        merged.verifiedStatus,
        merged.lastVerifiedAt,
        merged.lastSuccessAt,
        merged.lastFailureAt,
        merged.failureReason,
        merged.failureStreak,
        merged.cooldownUntil,
        stringifyJson(merged.metadata),
      );

      return merged;
    },

    markCareerSurfaceSuccess(input) {
      const checkedAt = normalizeTimestamp(input.checkedAt, new Date().toISOString());
      return this.upsertCareerSurface({
        surfaceId: input.surfaceId,
        companyKey: input.companyKey,
        surfaceType: input.surfaceType,
        providerType: input.providerType,
        canonicalUrl: input.canonicalUrl,
        finalUrl: input.finalUrl,
        boardToken: input.boardToken,
        sourceLane: input.sourceLane,
        verifiedStatus: "verified",
        lastVerifiedAt: checkedAt,
        lastSuccessAt: checkedAt,
        lastFailureAt: null,
        failureReason: null,
        failureStreak: 0,
        cooldownUntil: null,
        metadata: input.metadata,
      });
    },

    markCareerSurfaceFailure(input) {
      const checkedAt = normalizeTimestamp(input.checkedAt, new Date().toISOString());
      const existing = this.upsertCareerSurface({
        surfaceId: input.surfaceId,
        companyKey: input.companyKey,
        surfaceType: input.surfaceType,
        providerType: input.providerType,
        canonicalUrl: input.canonicalUrl,
        finalUrl: input.finalUrl,
        boardToken: input.boardToken,
        sourceLane: input.sourceLane,
        metadata: input.metadata,
      });

      return this.upsertCareerSurface({
        surfaceId: existing.surfaceId,
        companyKey: existing.companyKey,
        surfaceType: existing.surfaceType,
        providerType: existing.providerType,
        canonicalUrl: existing.canonicalUrl,
        finalUrl: input.finalUrl ?? existing.finalUrl,
        boardToken: input.boardToken ?? existing.boardToken,
        sourceLane: input.sourceLane ?? existing.sourceLane,
        verifiedStatus: "failed",
        lastVerifiedAt: checkedAt,
        lastSuccessAt: existing.lastSuccessAt,
        lastFailureAt: checkedAt,
        failureReason: normalizeNullableString(input.failureReason),
        failureStreak: existing.failureStreak + 1,
        cooldownUntil:
          input.cooldownUntil === undefined
            ? existing.cooldownUntil
            : normalizeNullableTimestamp(input.cooldownUntil),
        metadata: mergeJsonObjects(existing.metadata, input.metadata || {}),
      });
    },

    getHostSuppression(host) {
      const hostKey = buildHostKey(host);
      if (!hostKey) return null;
      const row = getHostSuppressionStatement.get(hostKey) as HostSuppressionRow | undefined;
      return row ? mapHostSuppressionRow(row) : null;
    },

    isHostSuppressed(host, now = new Date().toISOString()) {
      const record = this.getHostSuppression(host);
      if (!record) return false;
      const checkpoint = normalizeTimestamp(now, new Date().toISOString());
      return Boolean(
        (record.nextRetryAt && record.nextRetryAt > checkpoint) ||
          (record.cooldownUntil && record.cooldownUntil > checkpoint),
      );
    },

    upsertHostSuppression(input) {
      const now = normalizeTimestamp(input.lastSeenAt, new Date().toISOString());
      const hostKey = buildHostKey(input.host);
      if (!hostKey) throw new Error("host is required.");
      const existing = this.getHostSuppression(hostKey);
      const explicitQualityScore = normalizeNullableNumber(input.qualityScore);
      const qualityDelta = normalizeNullableNumber(input.qualityDelta);
      const qualityScore =
        explicitQualityScore !== null
          ? explicitQualityScore
          : qualityDelta !== null
            ? normalizeQualityScore((existing?.qualityScore || 0) + qualityDelta)
            : existing?.qualityScore || 0;
      const record: HostSuppressionRecord = {
        hostKey,
        host: hostKey,
        qualityScore,
        junkExtractionCount:
          (existing?.junkExtractionCount || 0) +
          normalizeNonNegativeInteger(input.junkExtractionIncrement),
        canonicalResolutionFailureCount:
          (existing?.canonicalResolutionFailureCount || 0) +
          normalizeNonNegativeInteger(input.canonicalResolutionFailureIncrement),
        suppressionCount:
          (existing?.suppressionCount || 0) +
          normalizeNonNegativeInteger(input.suppressionIncrement),
        lastSeenAt: now,
        lastReasonCode:
          input.lastReasonCode === undefined
            ? existing?.lastReasonCode || null
            : normalizeNullableString(input.lastReasonCode),
        nextRetryAt:
          input.nextRetryAt === undefined
            ? existing?.nextRetryAt || null
            : normalizeNullableTimestamp(input.nextRetryAt),
        cooldownUntil:
          input.cooldownUntil === undefined
            ? existing?.cooldownUntil || null
            : normalizeNullableTimestamp(input.cooldownUntil),
      };

      upsertHostSuppressionStatement.run(
        record.hostKey,
        record.host,
        record.qualityScore,
        record.junkExtractionCount,
        record.canonicalResolutionFailureCount,
        record.suppressionCount,
        record.lastSeenAt,
        record.lastReasonCode,
        record.nextRetryAt,
        record.cooldownUntil,
      );

      return record;
    },

    getDeadLink(url) {
      const urlKey = buildUrlKey(url);
      if (!urlKey) return null;
      const row = getDeadLinkStatement.get(urlKey) as DeadLinkRow | undefined;
      return row ? mapDeadLinkRow(row) : null;
    },

    isDeadLinkCoolingDown(url, now = new Date().toISOString()) {
      const record = this.getDeadLink(url);
      if (!record?.nextRetryAt) return false;
      const checkpoint = normalizeTimestamp(now, new Date().toISOString());
      return record.nextRetryAt > checkpoint;
    },

    upsertDeadLink(input) {
      const now = normalizeTimestamp(input.lastSeenAt, new Date().toISOString());
      const urlKey = requiredUrlKey(input.url, "url");
      const existing = this.getDeadLink(urlKey);
      const finalUrl =
        input.finalUrl === undefined
          ? existing?.finalUrl || null
          : normalizeNullableUrl(input.finalUrl);
      const host =
        normalizeNullableString(input.host) ||
        existing?.host ||
        getUrlHost(finalUrl || input.url);
      const record: DeadLinkRecord = {
        urlKey,
        finalUrl,
        host,
        reasonCode: normalizeRequiredString(input.reasonCode, "reasonCode"),
        httpStatus:
          typeof input.httpStatus === "number"
            ? Math.floor(input.httpStatus)
            : existing?.httpStatus || null,
        lastTitle:
          input.lastTitle === undefined
            ? existing?.lastTitle || null
            : normalizeNullableString(input.lastTitle),
        lastSeenAt: now,
        failureCount:
          (existing?.failureCount || 0) +
          Math.max(1, normalizeNonNegativeInteger(input.failureIncrement || 1)),
        nextRetryAt:
          input.nextRetryAt === undefined
            ? existing?.nextRetryAt || null
            : normalizeNullableTimestamp(input.nextRetryAt),
      };

      upsertDeadLinkStatement.run(
        record.urlKey,
        record.finalUrl,
        record.host,
        record.reasonCode,
        record.httpStatus,
        record.lastTitle,
        record.lastSeenAt,
        record.failureCount,
        record.nextRetryAt,
      );

      return record;
    },

    clearDeadLink(url) {
      const urlKey = buildUrlKey(url);
      if (!urlKey) return;
      clearDeadLinkStatement.run(urlKey);
    },

    findListingFingerprint(lookup) {
      const fingerprintKey = normalizeNullableString(lookup.fingerprintKey);
      if (fingerprintKey) {
        const row = getListingFingerprintByKeyStatement.get(
          fingerprintKey,
        ) as ListingFingerprintRow | undefined;
        if (row) return mapListingFingerprintRow(row);
      }

      const canonicalUrlKey =
        normalizeNullableString(lookup.canonicalUrlKey) ||
        buildUrlKey(lookup.canonicalUrl);
      const externalJobId = normalizeNullableString(lookup.externalJobId);
      if (canonicalUrlKey && externalJobId) {
        const row = getListingFingerprintByPrimaryStatement.get(
          canonicalUrlKey,
          externalJobId,
        ) as ListingFingerprintRow | undefined;
        if (row) return mapListingFingerprintRow(row);
      }
      if (canonicalUrlKey) {
        const row = getListingFingerprintByUrlStatement.get(
          canonicalUrlKey,
        ) as ListingFingerprintRow | undefined;
        if (row) return mapListingFingerprintRow(row);
      }

      const semanticKey = buildSemanticKey({
        companyKey: lookup.companyKey,
        titleKey: lookup.titleKey,
        locationKey: lookup.locationKey,
        remoteBucket: lookup.remoteBucket,
      });
      if (semanticKey) {
        const row = getListingFingerprintBySemanticStatement.get(
          semanticKey,
        ) as ListingFingerprintRow | undefined;
        if (row) return mapListingFingerprintRow(row);
      }

      const contentHash = normalizeNullableString(lookup.contentHash);
      if (contentHash) {
        const row = getListingFingerprintByContentHashStatement.get(
          contentHash,
        ) as ListingFingerprintRow | undefined;
        if (row) return mapListingFingerprintRow(row);
      }

      return null;
    },

    upsertListingFingerprint(input) {
      const seenAt = normalizeTimestamp(input.seenAt, new Date().toISOString());
      const canonicalUrlKey =
        normalizeNullableString(input.canonicalUrlKey) ||
        buildUrlKey(input.canonicalUrl);
      const externalJobId = normalizeNullableString(input.externalJobId);
      const semanticKey = requiredSemanticKey(input);
      const existing = this.findListingFingerprint({
        canonicalUrlKey,
        externalJobId,
        companyKey: input.companyKey,
        titleKey: input.titleKey,
        locationKey: input.locationKey,
        remoteBucket: input.remoteBucket,
        contentHash: input.contentHash,
      });
      const fingerprintKey =
        existing?.fingerprintKey || buildFingerprintKey(canonicalUrlKey, externalJobId, semanticKey, input.contentHash);
      const writtenAt = normalizeNullableTimestamp(input.writtenAt);
      const merged: ListingFingerprintRecord = {
        fingerprintKey,
        companyKey: normalizeRequiredString(input.companyKey, "companyKey"),
        titleKey: normalizeRequiredString(input.titleKey, "titleKey"),
        locationKey: normalizeRequiredString(input.locationKey, "locationKey"),
        canonicalUrlKey: canonicalUrlKey || existing?.canonicalUrlKey || null,
        externalJobId: externalJobId || existing?.externalJobId || null,
        remoteBucket: normalizeRequiredString(input.remoteBucket, "remoteBucket"),
        employmentType:
          normalizeNullableString(input.employmentType) ||
          existing?.employmentType ||
          null,
        semanticKey,
        contentHash:
          normalizeNullableString(input.contentHash) ||
          existing?.contentHash ||
          null,
        firstSeenAt: existing?.firstSeenAt || seenAt,
        lastSeenAt: maxTimestamp(existing?.lastSeenAt, seenAt),
        lastWrittenAt: writtenAt || existing?.lastWrittenAt || null,
        lastRunId: normalizeNullableString(input.runId) || existing?.lastRunId || null,
        lastSheetId:
          normalizeNullableString(input.sheetId) || existing?.lastSheetId || null,
        writeCount:
          (existing?.writeCount || 0) + (writtenAt ? 1 : 0),
        sourceIds: mergeStringArrays(
          existing?.sourceIds || [],
          input.sourceIds || [],
          normalizeNullableString,
        ),
      };

      upsertListingFingerprintStatement.run(
        merged.fingerprintKey,
        merged.companyKey,
        merged.titleKey,
        merged.locationKey,
        merged.canonicalUrlKey,
        merged.externalJobId,
        merged.remoteBucket,
        merged.employmentType,
        merged.semanticKey,
        merged.contentHash,
        merged.firstSeenAt,
        merged.lastSeenAt,
        merged.lastWrittenAt,
        merged.lastRunId,
        merged.lastSheetId,
        merged.writeCount,
        stringifyJson(merged.sourceIds),
      );

      return merged;
    },

    writeIntentCoverage(input) {
      const existing = (getIntentCoverageStatement.get(
        normalizeRequiredString(input.intentKey, "intentKey"),
        normalizeRequiredString(input.companyKey, "companyKey"),
        normalizeRequiredString(input.runId, "runId"),
        normalizeRequiredString(input.sourceLane, "sourceLane"),
      ) as IntentCoverageRow | undefined) || null;
      const now = new Date().toISOString();
      const record: IntentCoverageRecord = {
        intentKey: normalizeRequiredString(input.intentKey, "intentKey"),
        companyKey: normalizeRequiredString(input.companyKey, "companyKey"),
        runId: normalizeRequiredString(input.runId, "runId"),
        sourceLane: normalizeRequiredString(input.sourceLane, "sourceLane"),
        surfacesSeen: Math.max(
          existing?.surfaces_seen || 0,
          normalizeNonNegativeInteger(input.surfacesSeen),
        ),
        listingsSeen: Math.max(
          existing?.listings_seen || 0,
          normalizeNonNegativeInteger(input.listingsSeen),
        ),
        listingsWritten: Math.max(
          existing?.listings_written || 0,
          normalizeNonNegativeInteger(input.listingsWritten),
        ),
        startedAt:
          existing?.started_at ||
          normalizeTimestamp(input.startedAt, now),
        completedAt:
          input.completedAt === undefined
            ? existing?.completed_at || null
            : normalizeNullableTimestamp(input.completedAt),
      };

      upsertIntentCoverageStatement.run(
        record.intentKey,
        record.companyKey,
        record.runId,
        record.sourceLane,
        record.surfacesSeen,
        record.listingsSeen,
        record.listingsWritten,
        record.startedAt,
        record.completedAt,
      );

      return record;
    },

    listIntentCoverage(query = {}) {
      const sqlParts = ["SELECT *", "FROM intent_coverage"];
      const where: string[] = [];
      const params: unknown[] = [];

      if (query.intentKey) {
        where.push("intent_key = ?");
        params.push(normalizeRequiredString(query.intentKey, "intentKey"));
      }
      if (query.companyKey) {
        where.push("company_key = ?");
        params.push(normalizeRequiredString(query.companyKey, "companyKey"));
      }
      if (query.runId) {
        where.push("run_id = ?");
        params.push(normalizeRequiredString(query.runId, "runId"));
      }
      if (query.sourceLane) {
        where.push("source_lane = ?");
        params.push(normalizeRequiredString(query.sourceLane, "sourceLane"));
      }
      if (where.length) {
        sqlParts.push(`WHERE ${where.join(" AND ")}`);
      }
      sqlParts.push(
        "ORDER BY started_at DESC, intent_key ASC, company_key ASC, source_lane ASC",
      );
      if (typeof query.limit === "number" && query.limit > 0) {
        sqlParts.push("LIMIT ?");
        params.push(Math.floor(query.limit));
      }

      const rows = database
        .prepare(sqlParts.join("\n"))
        .all(...params) as IntentCoverageRow[];
      return rows.map(mapIntentCoverageRow);
    },

    writeScoutObservation(input) {
      const observationRef = normalizeRequiredString(input.observationRef, "observationRef");
      const runId = normalizeRequiredString(input.runId, "runId");
      const surfaceId = normalizeRequiredString(input.surfaceId, "surfaceId");
      const companyRef = normalizeRequiredString(input.companyRef, "companyRef");
      const sourceId = normalizeRequiredString(input.sourceId, "sourceId");
      const sourceLane = normalizeRequiredString(input.sourceLane, "sourceLane");
      const surfaceType = normalizeRequiredString(input.surfaceType, "surfaceType");
      const canonicalUrl = normalizeRequiredUrl(input.canonicalUrl, "canonicalUrl");
      const now = normalizeTimestamp(input.observedAt, new Date().toISOString());

      const record: ScoutObservationRecord = {
        observationRef,
        runId,
        surfaceId,
        companyRef,
        sourceId,
        sourceLane,
        surfaceType,
        canonicalUrl,
        providerType: normalizeNullableString(input.providerType) || "",
        host: normalizeNullableString(input.host) || "",
        finalUrl: normalizeNullableString(input.finalUrl) || "",
        boardToken: normalizeNullableString(input.boardToken) || "",
        observedAt: now,
        listingsSeen: normalizeNonNegativeInteger(input.listingsSeen),
        success: input.success === true,
        failureReason: normalizeNullableString(input.failureReason) || "",
      };

      upsertScoutObservationStatement.run(
        record.observationRef,
        record.runId,
        record.surfaceId,
        record.companyRef,
        record.sourceId,
        record.sourceLane,
        record.surfaceType,
        record.canonicalUrl,
        record.providerType,
        record.host,
        record.finalUrl,
        record.boardToken,
        record.observedAt,
        record.listingsSeen,
        record.success ? 1 : 0,
        record.failureReason,
      );

      return record;
    },

    listScoutObservations(query = {}) {
      const sqlParts = ["SELECT *", "FROM scout_observations"];
      const where: string[] = [];
      const params: unknown[] = [];

      if (query.runId) {
        where.push("run_id = ?");
        params.push(normalizeRequiredString(query.runId, "runId"));
      }
      if (query.surfaceId) {
        where.push("surface_id = ?");
        params.push(normalizeRequiredString(query.surfaceId, "surfaceId"));
      }
      if (query.companyRef) {
        where.push("company_key = ?");
        params.push(normalizeRequiredString(query.companyRef, "companyRef"));
      }
      if (query.sourceId) {
        where.push("source_id = ?");
        params.push(normalizeRequiredString(query.sourceId, "sourceId"));
      }
      if (query.sourceLane) {
        where.push("source_lane = ?");
        params.push(normalizeRequiredString(query.sourceLane, "sourceLane"));
      }
      if (query.success !== null && query.success !== undefined) {
        where.push("success = ?");
        params.push(query.success ? 1 : 0);
      }
      if (where.length) {
        sqlParts.push(`WHERE ${where.join(" AND ")}`);
      }
      sqlParts.push("ORDER BY observed_at DESC");
      if (typeof query.limit === "number" && query.limit > 0) {
        sqlParts.push("LIMIT ?");
        params.push(Math.floor(query.limit));
      }

      const rows = database
        .prepare(sqlParts.join("\n"))
        .all(...params) as ScoutObservationRow[];
      return rows.map(mapScoutObservationRow);
    },

    writeExploitOutcome(input) {
      const now = normalizeTimestamp(input.observedAt, new Date().toISOString());
      const runId = normalizeRequiredString(input.runId, "runId");
      const intentKey = normalizeRequiredString(input.intentKey, "intentKey");
      const companyKey = normalizeRequiredString(input.companyKey, "companyKey");
      const sourceId = normalizeRequiredString(input.sourceId, "sourceId");
      const sourceLane = normalizeRequiredString(input.sourceLane, "sourceLane");
      const surfaceType = normalizeRequiredString(input.surfaceType, "surfaceType");
      const canonicalUrl = normalizeRequiredString(input.canonicalUrl, "canonicalUrl");
      const surfaceId = normalizeNullableString(input.surfaceId) || "";

      const outcomeKey = createDigest(
        [runId, intentKey, surfaceId, companyKey, sourceId, sourceLane, canonicalUrl].join("::"),
      );

      const record: ExploitOutcomeRecord = {
        outcomeKey,
        runId,
        intentKey,
        surfaceId,
        companyKey,
        sourceId,
        sourceLane,
        surfaceType,
        canonicalUrl,
        observedAt: now,
        listingsSeen: normalizeNonNegativeInteger(input.listingsSeen),
        listingsAccepted: normalizeNonNegativeInteger(input.listingsAccepted),
        listingsRejected: normalizeNonNegativeInteger(input.listingsRejected),
        listingsWritten: normalizeNonNegativeInteger(input.listingsWritten),
        rejectionReasons: input.rejectionReasons || {},
        rejectionSamples: input.rejectionSamples || [],
      };

      upsertExploitOutcomeStatement.run(
        record.outcomeKey,
        record.runId,
        record.intentKey,
        record.surfaceId,
        record.companyKey,
        record.sourceId,
        record.sourceLane,
        record.surfaceType,
        record.canonicalUrl,
        record.observedAt,
        record.listingsSeen,
        record.listingsAccepted,
        record.listingsRejected,
        record.listingsWritten,
        stringifyJson(record.rejectionReasons),
        stringifyJson(record.rejectionSamples),
      );

      return record;
    },

    listExploitOutcomes(query = {}) {
      const sqlParts = ["SELECT *", "FROM exploit_outcomes"];
      const where: string[] = [];
      const params: unknown[] = [];

      if (query.runId) {
        where.push("run_id = ?");
        params.push(normalizeRequiredString(query.runId, "runId"));
      }
      if (query.intentKey) {
        where.push("intent_key = ?");
        params.push(normalizeRequiredString(query.intentKey, "intentKey"));
      }
      if (query.surfaceId) {
        where.push("surface_id = ?");
        params.push(normalizeRequiredString(query.surfaceId, "surfaceId"));
      }
      if (query.companyKey) {
        where.push("company_key = ?");
        params.push(normalizeRequiredString(query.companyKey, "companyKey"));
      }
      if (query.sourceId) {
        where.push("source_id = ?");
        params.push(normalizeRequiredString(query.sourceId, "sourceId"));
      }
      if (query.sourceLane) {
        where.push("source_lane = ?");
        params.push(normalizeRequiredString(query.sourceLane, "sourceLane"));
      }
      if (where.length) {
        sqlParts.push(`WHERE ${where.join(" AND ")}`);
      }
      sqlParts.push("ORDER BY observed_at DESC");
      if (typeof query.limit === "number" && query.limit > 0) {
        sqlParts.push("LIMIT ?");
        params.push(Math.floor(query.limit));
      }

      const rows = database
        .prepare(sqlParts.join("\n"))
        .all(...params) as ExploitOutcomeRow[];
      return rows.map(mapExploitOutcomeRow);
    },

    upsertRoleFamily(input) {
      const baseRole = normalizeRequiredString(input.baseRole, "baseRole");
      const companyKey = normalizeNullableString(input.companyKey) || "global";
      const sourceLane = normalizeNullableString(input.sourceLane) || "unknown";
      const familyKey = createDigest([baseRole, companyKey, sourceLane].join("::"));

      const existing = getRoleFamilyByKeyStatement.get(familyKey) as RoleFamilyRow | undefined;
      const now = new Date().toISOString();

      const confirmedIncrement = input.confirmed === true ? 1 : 0;
      const nearMissIncrement = input.nearMiss === true ? 1 : 0;

      const existingVariants = existing ? parseStringArray(existing.role_variants_json) : [];
      const newVariant = normalizeNullableString(input.roleVariant);
      const mergedVariants = newVariant && !existingVariants.includes(newVariant)
        ? [...existingVariants, newVariant]
        : existingVariants;

      const record: RoleFamilyRecord = {
        familyKey,
        baseRole,
        roleVariants: mergedVariants,
        companyKey,
        sourceLane,
        confirmedCount: (existing?.confirmed_count || 0) + confirmedIncrement,
        nearMissCount: (existing?.near_miss_count || 0) + nearMissIncrement,
        lastConfirmedAt: input.confirmed === true ? now : (existing?.last_confirmed_at || null),
        createdAt: existing?.created_at || now,
        updatedAt: now,
      };

      upsertRoleFamilyStatement.run(
        record.familyKey,
        record.baseRole,
        stringifyJson(record.roleVariants),
        record.companyKey,
        record.sourceLane,
        record.confirmedCount,
        record.nearMissCount,
        record.lastConfirmedAt,
        record.createdAt,
        record.updatedAt,
      );

      return record;
    },

    listRoleFamilies(query = {}) {
      const sqlParts = ["SELECT *", "FROM role_families"];
      const where: string[] = [];
      const params: unknown[] = [];

      if (query.baseRole) {
        where.push("base_role = ?");
        params.push(normalizeRequiredString(query.baseRole, "baseRole"));
      }
      if (query.companyKey) {
        where.push("company_key = ?");
        params.push(normalizeRequiredString(query.companyKey, "companyKey"));
      }
      if (query.sourceLane) {
        where.push("source_lane = ?");
        params.push(normalizeRequiredString(query.sourceLane, "sourceLane"));
      }
      if (where.length) {
        sqlParts.push(`WHERE ${where.join(" AND ")}`);
      }
      sqlParts.push("ORDER BY confirmed_count DESC, last_confirmed_at DESC");
      if (typeof query.limit === "number" && query.limit > 0) {
        sqlParts.push("LIMIT ?");
        params.push(Math.floor(query.limit));
      }

      const rows = database
        .prepare(sqlParts.join("\n"))
        .all(...params) as RoleFamilyRow[];
      return rows.map(mapRoleFamilyRow);
    },

    learnRoleFamilyFromLead(input) {
      const title = normalizeRequiredString(input.title, "title");
      const baseRole = extractBaseRole(title);
      if (!baseRole) return null;

      return this.upsertRoleFamily({
        baseRole,
        roleVariant: title,
        companyKey: input.companyKey,
        sourceLane: input.sourceLane,
        confirmed: input.accepted,
        nearMiss: !input.accepted,
      });
    },

    close() {
      database.close();
    },
  };
}

export function buildUrlKey(url: string | null | undefined): string | null {
  const raw = normalizeNullableString(url);
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = "";
    }
    if (parsed.pathname && parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    const params = [...parsed.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
      return leftKey.localeCompare(rightKey);
    });
    parsed.search = "";
    for (const [key, value] of params) {
      if (SAFE_TRACKING_PARAM_PATTERN.test(key)) continue;
      parsed.searchParams.append(key, value);
    }
    return parsed.toString();
  } catch {
    return raw.replace(/#.*$/, "").toLowerCase();
  }
}

export function buildSemanticKey(input: {
  companyKey?: string | null;
  titleKey?: string | null;
  locationKey?: string | null;
  remoteBucket?: string | null;
}): string | null {
  const companyKey = normalizeNullableString(input.companyKey);
  const titleKey = normalizeNullableString(input.titleKey);
  const locationKey = normalizeNullableString(input.locationKey);
  const remoteBucket = normalizeNullableString(input.remoteBucket);
  if (!companyKey || !titleKey || !locationKey || !remoteBucket) {
    return null;
  }
  return `${companyKey}::${titleKey}::${locationKey}::${remoteBucket}`;
}

function requiredSemanticKey(input: {
  companyKey: string;
  titleKey: string;
  locationKey: string;
  remoteBucket: string;
}): string {
  const key = buildSemanticKey(input);
  if (!key) {
    throw new Error("Listing fingerprint requires companyKey, titleKey, locationKey, and remoteBucket.");
  }
  return key;
}

function mergeCareerSurface(
  existing: CareerSurfaceRecord | null,
  input: CareerSurfaceUpsert,
): CareerSurfaceRecord {
  const canonicalUrl = normalizeRequiredUrl(input.canonicalUrl, "canonicalUrl");
  const providerType = normalizeNullableString(input.providerType);
  const surfaceType = normalizeRequiredString(input.surfaceType, "surfaceType");
  const companyKey = normalizeRequiredString(input.companyKey, "companyKey");
  const finalUrl =
    input.finalUrl === undefined
      ? existing?.finalUrl || null
      : normalizeNullableUrl(input.finalUrl);
  const host = getUrlHost(finalUrl || canonicalUrl);

  return {
    surfaceId:
      normalizeNullableString(input.surfaceId) ||
      existing?.surfaceId ||
      buildSurfaceId({
        companyKey,
        surfaceType,
        providerType,
        canonicalUrl,
        boardToken: input.boardToken,
      }),
    companyKey,
    surfaceType,
    providerType: providerType || existing?.providerType || null,
    canonicalUrl,
    host,
    finalUrl,
    boardToken: normalizeNullableString(input.boardToken) || existing?.boardToken || null,
    sourceLane:
      normalizeNullableString(input.sourceLane) ||
      existing?.sourceLane ||
      "unknown",
    verifiedStatus:
      normalizeNullableString(input.verifiedStatus) ||
      existing?.verifiedStatus ||
      "pending",
    lastVerifiedAt:
      input.lastVerifiedAt === undefined
        ? existing?.lastVerifiedAt || null
        : normalizeNullableTimestamp(input.lastVerifiedAt),
    lastSuccessAt:
      input.lastSuccessAt === undefined
        ? existing?.lastSuccessAt || null
        : normalizeNullableTimestamp(input.lastSuccessAt),
    lastFailureAt:
      input.lastFailureAt === undefined
        ? existing?.lastFailureAt || null
        : normalizeNullableTimestamp(input.lastFailureAt),
    failureReason:
      input.failureReason === undefined
        ? existing?.failureReason || null
        : normalizeNullableString(input.failureReason),
    failureStreak:
      typeof input.failureStreak === "number"
        ? Math.max(0, Math.floor(input.failureStreak))
        : existing?.failureStreak || 0,
    cooldownUntil:
      input.cooldownUntil === undefined
        ? existing?.cooldownUntil || null
        : normalizeNullableTimestamp(input.cooldownUntil),
    metadata: mergeJsonObjects(existing?.metadata || {}, input.metadata || {}),
  };
}

function buildSurfaceId(input: {
  companyKey: string;
  surfaceType: string;
  providerType?: string | null;
  canonicalUrl: string;
  boardToken?: string | null;
}): string {
  return createDigest(
    [
      normalizeRequiredString(input.companyKey, "companyKey"),
      normalizeRequiredString(input.surfaceType, "surfaceType"),
      normalizeNullableString(input.providerType) || "",
      requiredUrlKey(input.canonicalUrl, "canonicalUrl"),
      normalizeNullableString(input.boardToken) || "",
    ].join("::"),
  );
}

function buildFingerprintKey(
  canonicalUrlKey: string | null,
  externalJobId: string | null,
  semanticKey: string,
  contentHash: string | null | undefined,
): string {
  if (canonicalUrlKey && externalJobId) {
    return createDigest(`primary::${canonicalUrlKey}::${externalJobId}`);
  }
  if (canonicalUrlKey) {
    return createDigest(`url::${canonicalUrlKey}`);
  }
  if (semanticKey) {
    return createDigest(`semantic::${semanticKey}`);
  }
  if (contentHash) {
    return createDigest(`content::${contentHash}`);
  }
  return createDigest(`fallback::${semanticKey}`);
}

function createDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mapCompanyRegistryRow(row: CompanyRegistryRow): CompanyRegistryRecord {
  return {
    companyKey: row.company_key,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    aliases: parseStringArray(row.aliases_json),
    domains: parseStringArray(row.domains_json),
    atsHints: parseProviderHints(row.ats_hints_json),
    geoTags: parseStringArray(row.geo_tags_json),
    roleTags: parseStringArray(row.role_tags_json),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSuccessAt: row.last_success_at,
    successCount: Number(row.success_count || 0),
    failureCount: Number(row.failure_count || 0),
    confidence: Number(row.confidence || 0),
    cooldownUntil: row.cooldown_until,
  };
}

function mapCareerSurfaceRow(row: CareerSurfaceRow): CareerSurfaceRecord {
  return {
    surfaceId: row.surface_id,
    companyKey: row.company_key,
    surfaceType: row.surface_type,
    providerType: row.provider_type,
    canonicalUrl: row.canonical_url,
    host: row.host,
    finalUrl: row.final_url,
    boardToken: row.board_token,
    sourceLane: row.source_lane,
    verifiedStatus: row.verified_status,
    lastVerifiedAt: row.last_verified_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    failureReason: row.failure_reason,
    failureStreak: Number(row.failure_streak || 0),
    cooldownUntil: row.cooldown_until,
    metadata: parseJsonObject(row.metadata_json),
  };
}

function mapHostSuppressionRow(row: HostSuppressionRow): HostSuppressionRecord {
  return {
    hostKey: row.host_key,
    host: row.host,
    qualityScore: Number(row.quality_score || 0),
    junkExtractionCount: Number(row.junk_extraction_count || 0),
    canonicalResolutionFailureCount: Number(
      row.canonical_resolution_failure_count || 0,
    ),
    suppressionCount: Number(row.suppression_count || 0),
    lastSeenAt: row.last_seen_at,
    lastReasonCode: row.last_reason_code,
    nextRetryAt: row.next_retry_at,
    cooldownUntil: row.cooldown_until,
  };
}

function mapDeadLinkRow(row: DeadLinkRow): DeadLinkRecord {
  return {
    urlKey: row.url_key,
    finalUrl: row.final_url,
    host: row.host,
    reasonCode: row.reason_code,
    httpStatus:
      typeof row.http_status === "number" ? Number(row.http_status) : null,
    lastTitle: row.last_title,
    lastSeenAt: row.last_seen_at,
    failureCount: Number(row.failure_count || 0),
    nextRetryAt: row.next_retry_at,
  };
}

function mapListingFingerprintRow(
  row: ListingFingerprintRow,
): ListingFingerprintRecord {
  return {
    fingerprintKey: row.fingerprint_key,
    companyKey: row.company_key,
    titleKey: row.title_key,
    locationKey: row.location_key,
    canonicalUrlKey: row.canonical_url_key,
    externalJobId: row.external_job_id,
    remoteBucket: row.remote_bucket,
    employmentType: row.employment_type,
    semanticKey: row.semantic_key,
    contentHash: row.content_hash,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastWrittenAt: row.last_written_at,
    lastRunId: row.last_run_id,
    lastSheetId: row.last_sheet_id,
    writeCount: Number(row.write_count || 0),
    sourceIds: parseStringArray(row.source_ids_json),
  };
}

function mapIntentCoverageRow(row: IntentCoverageRow): IntentCoverageRecord {
  return {
    intentKey: row.intent_key,
    companyKey: row.company_key,
    runId: row.run_id,
    sourceLane: row.source_lane,
    surfacesSeen: Number(row.surfaces_seen || 0),
    listingsSeen: Number(row.listings_seen || 0),
    listingsWritten: Number(row.listings_written || 0),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function mapScoutObservationRow(row: ScoutObservationRow): ScoutObservationRecord {
  return {
    observationRef: row.observation_key,
    runId: row.run_id,
    surfaceId: row.surface_id,
    companyRef: row.company_key,
    sourceId: row.source_id,
    sourceLane: row.source_lane,
    surfaceType: row.surface_type,
    canonicalUrl: row.canonical_url,
    providerType: row.provider_type,
    host: row.host,
    finalUrl: row.final_url,
    boardToken: row.board_token,
    observedAt: row.observed_at,
    listingsSeen: Number(row.listings_seen || 0),
    success: row.success === 1,
    failureReason: row.failure_reason,
  };
}

function mapExploitOutcomeRow(row: ExploitOutcomeRow): ExploitOutcomeRecord {
  return {
    outcomeKey: row.outcome_key,
    runId: row.run_id,
    intentKey: row.intent_key,
    surfaceId: row.surface_id,
    companyKey: row.company_key,
    sourceId: row.source_id,
    sourceLane: row.source_lane,
    surfaceType: row.surface_type,
    canonicalUrl: row.canonical_url,
    observedAt: row.observed_at,
    listingsSeen: Number(row.listings_seen || 0),
    listingsAccepted: Number(row.listings_accepted || 0),
    listingsRejected: Number(row.listings_rejected || 0),
    listingsWritten: Number(row.listings_written || 0),
    rejectionReasons: parseJsonObject(row.rejection_reasons_json) as Record<string, number>,
    rejectionSamples: parseJsonObject(row.rejection_samples_json) as Array<{
      reason: string;
      title: string;
      company: string;
      url: string;
      detail: string;
    }>,
  };
}

function mapRoleFamilyRow(row: RoleFamilyRow): RoleFamilyRecord {
  return {
    familyKey: row.family_key,
    baseRole: row.base_role,
    roleVariants: parseStringArray(row.role_variants_json),
    companyKey: row.company_key,
    sourceLane: row.source_lane,
    confirmedCount: Number(row.confirmed_count || 0),
    nearMissCount: Number(row.near_miss_count || 0),
    lastConfirmedAt: row.last_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Minimal string cleaner for normalizing user input fields.
 */
function cleanString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value == null ? "" : String(value).trim();
}

/**
 * Normalizes a phrase for comparison by lowercasing and collapsing punctuation
 * into spaces. Used for role titles, keywords, and intent signals.
 */
function normalizePhrase(value: unknown): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts the base role from a title by stripping seniority prefixes and common suffixes.
 * This is a deterministic transformation - same input always yields same output.
 * Examples:
 *   "Senior Platform Engineer" -> "platform engineer"
 *   "Lead Backend Developer" -> "backend developer"
 *   "Staff Software Engineer II" -> "software engineer"
 *   "Principal ML Engineer" -> "ml engineer"
 */
function extractBaseRole(title: string): string | null {
  const normalized = normalizePhrase(title);
  if (!normalized) return null;

  // Seniority prefixes to strip
  const seniorityPrefixes = [
    "intern",
    "junior",
    "jr",
    "associate",
    "senior",
    "sr",
    "staff",
    "principal",
    "lead",
    "manager",
    "director",
    "vp",
    "chief",
    "head of",
    "ii",
    "iii",
    "iv",
    "v",
  ];

  // Common suffixes to strip
  const suffixesToStrip = [
    " i$",
    " ii$",
    " iii$",
    " iv$",
    " v$",
    " (.*)$",
  ];

  let base = normalized;

  // Strip seniority prefixes
  for (const prefix of seniorityPrefixes) {
    const regex = new RegExp(`^${prefix}\\s+`, "i");
    base = base.replace(regex, "");
  }

  // Strip roman numeral suffixes
  base = base.replace(/\s+(i{1,3}|iv|v)$/i, "");

  // Strip parenthetical content
  base = base.replace(/\s*\([^)]*\)\s*/g, " ");

  // Clean up extra whitespace
  base = base.replace(/\s+/g, " ").trim();

  return base || null;
}

function mergeProviderHints(
  existing: ProviderHints,
  incoming: Record<string, string | string[] | null | undefined>,
): ProviderHints {
  const merged: ProviderHints = {};

  for (const [provider, hints] of Object.entries(existing)) {
    const key = normalizeTextKey(provider);
    if (!key) continue;
    merged[key] = mergeStringArrays([], hints || [], normalizeNullableString);
  }

  for (const [provider, hints] of Object.entries(incoming)) {
    const key = normalizeTextKey(provider);
    if (!key) continue;
    merged[key] = mergeStringArrays(
      merged[key] || [],
      Array.isArray(hints) ? hints : [hints],
      normalizeNullableString,
    );
  }

  return merged;
}

function parseProviderHints(raw: string): ProviderHints {
  const value = safeParseJson(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: ProviderHints = {};
  for (const [provider, hints] of Object.entries(value)) {
    const key = normalizeTextKey(provider);
    if (!key) continue;
    normalized[key] = mergeStringArrays(
      [],
      Array.isArray(hints) ? hints : [],
      normalizeNullableString,
    );
  }
  return normalized;
}

function parseStringArray(raw: string): string[] {
  const value = safeParseJson(raw);
  if (!Array.isArray(value)) return [];
  return mergeStringArrays([], value, normalizeNullableString);
}

function parseJsonObject(raw: string): JsonObject {
  const value = safeParseJson(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function mergeJsonObjects(left: JsonObject, right: JsonObject): JsonObject {
  return { ...left, ...right };
}

function mergeStringArrays<T>(
  left: Iterable<T>,
  right: Iterable<T>,
  normalize: (value: T) => string | null,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const item of [...left, ...right]) {
    const normalized = normalize(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }

  return merged;
}

function readCount(statement: ReturnType<DatabaseSync["prepare"]>): number {
  const row = statement.get() as { count?: number } | undefined;
  return Number(row?.count || 0);
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeQualityScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeRequiredUrl(value: unknown, label: string): string {
  const normalized = normalizeNullableUrl(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeNullableUrl(value: unknown): string | null {
  const normalized = buildUrlKey(normalizeNullableString(value));
  return normalized || null;
}

function requiredUrlKey(value: unknown, label: string): string {
  const normalized = buildUrlKey(normalizeNullableString(value));
  if (!normalized) throw new Error(`${label} must be a non-empty URL.`);
  return normalized;
}

function normalizeTextKey(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;
  return normalized.toLowerCase().replace(/\s+/g, " ");
}

function normalizeDomain(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;
  return normalized.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function buildHostKey(value: unknown): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;

  try {
    const candidate = normalized.includes("://")
      ? normalized
      : `https://${normalized}`;
    const parsed = new URL(candidate);
    return parsed.hostname.toLowerCase().replace(/\.+$/, "") || null;
  } catch {
    return normalized
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/[/?#].*$/, "")
      .replace(/:\d+$/, "")
      .replace(/\.+$/, "")
      || null;
  }
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  const normalized = normalizeNullableString(value);
  return normalized || fallback;
}

function normalizeNullableTimestamp(value: unknown): string | null {
  return normalizeNullableString(value);
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function getUrlHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function maxTimestamp(left: string | null | undefined, right: string): string {
  if (!left) return right;
  return left > right ? left : right;
}

function buildInClause(
  column: string,
  values: string[],
  params: unknown[],
): string {
  const normalized = values
    .map((value) => normalizeNullableString(value))
    .filter((value): value is string => Boolean(value));
  if (!normalized.length) {
    params.push("__never__");
    return `${column} IN (?)`;
  }
  for (const value of normalized) {
    params.push(value);
  }
  return `${column} IN (${normalized.map(() => "?").join(", ")})`;
}
