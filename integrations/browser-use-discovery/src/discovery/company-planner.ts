import {
  ATS_SOURCE_IDS,
  type AtsSourceId,
  type CareerSurfaceRecord,
  type CompanyRegistryRecord,
  type CompanyTarget,
  type DiscoveryIntent,
  type DiscoverySourceLane,
  type IntentCoverageRecord,
  type PlannedCompany,
  type SourcePreset,
} from "../contracts.ts";
import type { RoleFamilyRecord } from "../state/discovery-memory-store.ts";

const DEFAULT_SOURCE_PRESET: SourcePreset = "browser_plus_ats";
const DEFAULT_MAX_COMPANIES = 50;
const RECENT_COVERAGE_WINDOW_DAYS = 21;

type CandidateSource =
  | "configured_company"
  | "memory_registry"
  | "memory_surface"
  | "role_family_adjacent";

type MutablePlannerCandidate = {
  companyKey: string;
  displayName: string;
  normalizedName: string;
  aliases: Set<string>;
  domains: Set<string>;
  boardHints: Partial<Record<AtsSourceId, string>>;
  geoTags: Set<string>;
  roleTags: Set<string>;
  includeKeywords: Set<string>;
  excludeKeywords: Set<string>;
  candidateSources: Set<CandidateSource>;
  sourceLanes: Set<DiscoverySourceLane>;
  seedEvidence: Set<string>;
  freshnessAt: string;
  companyRecord: CompanyRegistryRecord | null;
};

export type CompanyPlannerIntentInput = {
  targetRoles?: readonly string[];
  includeKeywords?: readonly string[];
  excludeKeywords?: readonly string[];
  locations?: readonly string[];
  remotePolicy?: string;
  seniority?: string;
  sourcePreset?: SourcePreset;
};

export type CompanyPlannerCandidate = CompanyTarget & {
  sourceLane?: DiscoverySourceLane;
  evidence?: string[];
  freshnessAt?: string;
};

export type CompanyPlannerMemorySnapshot = {
  companyRegistry?: readonly CompanyRegistryRecord[];
  careerSurfaces?: readonly CareerSurfaceRecord[];
  intentCoverage?: readonly IntentCoverageRecord[];
  roleFamilies?: readonly RoleFamilyRecord[];
};

export type CompanyPlannerInput = CompanyPlannerIntentInput & {
  companies?: readonly CompanyPlannerCandidate[];
  memory?: CompanyPlannerMemorySnapshot;
  now?: Date;
  maxCompanies?: number;
  includeSuppressed?: boolean;
};

export type PlannedCompanyEvidence = {
  intentKey: string;
  candidateSources: CandidateSource[];
  sourceLanes: DiscoverySourceLane[];
  matchedRoleSignals: string[];
  matchedGeoSignals: string[];
  matchedExcludeSignals: string[];
  remoteFit: number;
  providerDiversity: number;
  providerCount: number;
  sourceLaneCount: number;
  verifiedSurfaceCount: number;
  activeVerifiedSurfaceCount: number;
  surfaceHealth: number;
  verifiedSurfaceBonus: number;
  presetAlignment: number;
  surfaceHosts: string[];
  surfaceProviders: AtsSourceId[];
  successCount: number;
  failureCount: number;
  confidence: number;
  recentCoverage: {
    recordCount: number;
    surfacesSeen: number;
    listingsSeen: number;
    listingsWritten: number;
    lastCompletedAt: string;
    penalty: number;
  };
  penalties: {
    recentCoverage: number;
    cooldown: number;
  };
  timestamps: {
    freshnessAt: string;
    lastSeenAt: string;
    lastSuccessAt: string;
    lastVerifiedAt: string;
    cooldownUntil: string;
  };
};

export type RankedPlannedCompany = PlannedCompany & {
  evidence: PlannedCompanyEvidence;
  suppressionReasons: string[];
};

export type CompanyPlanningResult = {
  intent: DiscoveryIntent;
  plannedCompanies: RankedPlannedCompany[];
  suppressedCompanies: RankedPlannedCompany[];
};

type SurfaceAggregate = {
  total: number;
  verified: number;
  activeVerified: number;
  employerSurfaceCount: number;
  providerSurfaceCount: number;
  dead: number;
  failureStreak: number;
  cooldownCount: number;
  lastVerifiedAt: string;
  lastSuccessAt: string;
  cooldownUntil: string;
  hosts: string[];
  providers: AtsSourceId[];
  sourceLanes: DiscoverySourceLane[];
  boardHints: Partial<Record<AtsSourceId, string>>;
};

type CoverageAggregate = {
  recordCount: number;
  surfacesSeen: number;
  listingsSeen: number;
  listingsWritten: number;
  lastCompletedAt: string;
  penalty: number;
};

export function buildDiscoveryIntent(
  input: CompanyPlannerIntentInput,
): DiscoveryIntent {
  const targetRoles = normalizeIntentList(input.targetRoles || []);
  const includeKeywords = normalizeIntentList(input.includeKeywords || []);
  const excludeKeywords = normalizeIntentList(input.excludeKeywords || []);
  const locations = normalizeIntentList(input.locations || []);
  const remotePolicy = normalizePhrase(input.remotePolicy);
  const seniority = normalizePhrase(input.seniority);
  const sourcePreset = input.sourcePreset || DEFAULT_SOURCE_PRESET;

  return {
    intentKey: buildIntentKey({
      targetRoles,
      includeKeywords,
      excludeKeywords,
      locations,
      remotePolicy,
      seniority,
      sourcePreset,
    }),
    targetRoles,
    includeKeywords,
    excludeKeywords,
    locations,
    remotePolicy,
    seniority,
    sourcePreset,
  };
}

export function buildIntentKey(input: CompanyPlannerIntentInput): string {
  const normalized = {
    targetRoles: normalizeIntentList(input.targetRoles || []),
    includeKeywords: normalizeIntentList(input.includeKeywords || []),
    excludeKeywords: normalizeIntentList(input.excludeKeywords || []),
    locations: normalizeIntentList(input.locations || []),
    remotePolicy: normalizePhrase(input.remotePolicy) || "any",
    seniority: normalizePhrase(input.seniority) || "any",
    sourcePreset: input.sourcePreset || DEFAULT_SOURCE_PRESET,
  };

  return [
    `preset=${normalized.sourcePreset}`,
    `roles=${joinIntentPart(normalized.targetRoles)}`,
    `include=${joinIntentPart(normalized.includeKeywords)}`,
    `exclude=${joinIntentPart(normalized.excludeKeywords)}`,
    `locations=${joinIntentPart(normalized.locations)}`,
    `remote=${normalized.remotePolicy}`,
    `seniority=${normalized.seniority}`,
  ].join("|");
}

export function planCompanies(
  input: CompanyPlannerInput,
): CompanyPlanningResult {
  const now = input.now || new Date();
  const intent = buildDiscoveryIntent(input);
  const memory = input.memory || {};
  const surfaceGroups = groupSurfaces(memory.careerSurfaces || [], now);
  const coverageGroups = groupCoverage(
    memory.intentCoverage || [],
    intent.intentKey,
    now,
  );
  const candidates = buildPlannerCandidates(input.companies || [], memory, surfaceGroups);

  const ranked = candidates
    .map((candidate) => rankCandidate(candidate, intent, surfaceGroups, coverageGroups, now))
    .sort(compareRankedCompanies);

  const plannedCompanies: RankedPlannedCompany[] = [];
  const suppressedCompanies: RankedPlannedCompany[] = [];

  for (const company of ranked) {
    if (company.suppressionReasons.length > 0) {
      suppressedCompanies.push(company);
      if (!input.includeSuppressed) continue;
    }
    plannedCompanies.push(company);
  }

  const maxCompanies = Math.max(1, input.maxCompanies || DEFAULT_MAX_COMPANIES);
  return {
    intent,
    plannedCompanies: plannedCompanies.slice(0, maxCompanies),
    suppressedCompanies,
  };
}

function buildPlannerCandidates(
  companies: readonly CompanyPlannerCandidate[],
  memory: CompanyPlannerMemorySnapshot,
  surfaceGroups: Map<string, SurfaceAggregate>,
): MutablePlannerCandidate[] {
  const byKey = new Map<string, MutablePlannerCandidate>();
  const registryByKey = new Map<string, CompanyRegistryRecord>();
  const registryByNormalizedName = new Map<string, CompanyRegistryRecord>();

  for (const record of memory.companyRegistry || []) {
    registryByKey.set(record.companyKey, record);
    if (record.normalizedName) {
      registryByNormalizedName.set(record.normalizedName, record);
    }
  }

  for (const company of companies) {
    upsertCandidate({
      byKey,
      companyKey: resolveCompanyKey(company, registryByNormalizedName),
      displayName: cleanString(company.name),
      normalizedName:
        cleanString(company.normalizedName) || normalizeCompanyName(company.name),
      aliases: company.aliases || [],
      domains: company.domains || [],
      geoTags: company.geoTags || [],
      roleTags: company.roleTags || [],
      includeKeywords: company.includeKeywords || [],
      excludeKeywords: company.excludeKeywords || [],
      boardHints: company.boardHints || {},
      evidence: company.evidence || [],
      sourceLane: company.sourceLane,
      candidateSource: "configured_company",
      companyRecord: registryByNormalizedName.get(
        cleanString(company.normalizedName) || normalizeCompanyName(company.name),
      ),
      freshnessAt: company.freshnessAt || "",
    });
  }

  for (const record of memory.companyRegistry || []) {
    upsertCandidate({
      byKey,
      companyKey: record.companyKey,
      displayName: record.displayName,
      normalizedName: record.normalizedName || normalizeCompanyName(record.displayName),
      aliases: parseStringArray(record.aliasesJson),
      domains: parseStringArray(record.domainsJson),
      geoTags: parseStringArray(record.geoTagsJson),
      roleTags: parseStringArray(record.roleTagsJson),
      includeKeywords: [],
      excludeKeywords: [],
      boardHints: parseBoardHints(record.atsHintsJson),
      evidence: [],
      candidateSource: "memory_registry",
      companyRecord: record,
      freshnessAt: mostRecentIso(record.lastSuccessAt, record.lastSeenAt),
    });
  }

  for (const [companyKey] of surfaceGroups) {
    if (byKey.has(companyKey)) continue;
    const record = registryByKey.get(companyKey) || null;
    upsertCandidate({
      byKey,
      companyKey,
      displayName: record?.displayName || humanizeCompanyKey(companyKey),
      normalizedName:
        record?.normalizedName ||
        normalizeCompanyName(record?.displayName || companyKey),
      aliases: record ? parseStringArray(record.aliasesJson) : [],
      domains: record ? parseStringArray(record.domainsJson) : [],
      geoTags: record ? parseStringArray(record.geoTagsJson) : [],
      roleTags: record ? parseStringArray(record.roleTagsJson) : [],
      includeKeywords: [],
      excludeKeywords: [],
      boardHints: record ? parseBoardHints(record.atsHintsJson) : {},
      evidence: [],
      candidateSource: "memory_surface",
      companyRecord: record,
      freshnessAt: mostRecentIso(
        record?.lastSuccessAt || "",
        record?.lastSeenAt || "",
      ),
    });
  }

  // VAL-LOOP-MEM-004: Add adjacent companies based on role-family memory
  // Deterministic role-family widening: find companies whose role tags match
  // learned role variants from successful/near-miss leads
  for (const family of memory.roleFamilies || []) {
    // Skip families with no confirmed or near-miss evidence
    if (family.confirmedCount === 0 && family.nearMissCount === 0) continue;

    // Build a set of role variant needles for matching
    const variantNeedles = family.roleVariants.map(normalizePhrase).filter(Boolean);
    if (!variantNeedles.length) continue;

    for (const record of memory.companyRegistry || []) {
      // Get company's role tags as signals
      const companyRoleTags = parseStringArray(record.roleTagsJson)
        .map(normalizePhrase)
        .filter(Boolean);

      // Check if any company role tag matches a family variant
      const matchedVariants = findMatchedSignals(variantNeedles, companyRoleTags);
      if (matchedVariants.length === 0) continue;

      const evidenceText = `role-family adjacent via ${family.baseRole}: ${matchedVariants.join(", ")}`;

      if (byKey.has(record.companyKey)) {
        // Company already exists in candidates (from registry or surfaces)
        // Add role_family_adjacent as an additional source and merge evidence
        const existing = byKey.get(record.companyKey)!;
        existing.candidateSources.add("role_family_adjacent");
        existing.seedEvidence.add(evidenceText);
      } else {
        // Add as new adjacent company candidate with role-family evidence
        upsertCandidate({
          byKey,
          companyKey: record.companyKey,
          displayName: record.displayName,
          normalizedName: record.normalizedName || normalizeCompanyName(record.displayName),
          aliases: parseStringArray(record.aliasesJson),
          domains: parseStringArray(record.domainsJson),
          geoTags: parseStringArray(record.geoTagsJson),
          roleTags: companyRoleTags,
          includeKeywords: [],
          excludeKeywords: [],
          boardHints: parseBoardHints(record.atsHintsJson),
          evidence: [evidenceText],
          candidateSource: "role_family_adjacent",
          companyRecord: record,
          freshnessAt: mostRecentIso(record.lastSuccessAt, record.lastSeenAt),
        });
      }
    }
  }

  for (const candidate of byKey.values()) {
    const surfaces = surfaceGroups.get(candidate.companyKey);
    if (!surfaces) continue;
    candidate.candidateSources.add("memory_surface");
    for (const host of surfaces.hosts) {
      candidate.domains.add(host);
    }
    for (const sourceLane of surfaces.sourceLanes) {
      candidate.sourceLanes.add(sourceLane);
    }
    for (const provider of ATS_SOURCE_IDS) {
      const boardToken = surfaces.boardHints[provider];
      if (boardToken && !candidate.boardHints[provider]) {
        candidate.boardHints[provider] = boardToken;
      }
    }
    if (!candidate.freshnessAt) {
      candidate.freshnessAt = mostRecentIso(
        surfaces.lastSuccessAt,
        surfaces.lastVerifiedAt,
      );
    }
  }

  return [...byKey.values()];
}

function upsertCandidate(input: {
  byKey: Map<string, MutablePlannerCandidate>;
  companyKey: string;
  displayName: string;
  normalizedName: string;
  aliases: readonly string[];
  domains: readonly string[];
  geoTags: readonly string[];
  roleTags: readonly string[];
  includeKeywords: readonly string[];
  excludeKeywords: readonly string[];
  boardHints: Partial<Record<AtsSourceId, string>>;
  evidence: readonly string[];
  sourceLane?: DiscoverySourceLane;
  candidateSource: CandidateSource;
  companyRecord?: CompanyRegistryRecord | null;
  freshnessAt?: string;
}) {
  const key = cleanString(input.companyKey) || normalizeCompanyKey(input.displayName);
  if (!key) return;

  const existing =
    input.byKey.get(key) ||
    createMutableCandidate(
      key,
      input.displayName,
      input.normalizedName,
    );

  if (!existing.displayName && input.displayName) {
    existing.displayName = input.displayName;
  }
  if (!existing.normalizedName && input.normalizedName) {
    existing.normalizedName = input.normalizedName;
  }
  mergeStringValues(existing.aliases, input.aliases);
  mergeStringValues(existing.domains, input.domains, normalizeDomain);
  mergeStringValues(existing.geoTags, input.geoTags, normalizePhrase);
  mergeStringValues(existing.roleTags, input.roleTags, normalizePhrase);
  mergeStringValues(existing.includeKeywords, input.includeKeywords, normalizePhrase);
  mergeStringValues(existing.excludeKeywords, input.excludeKeywords, normalizePhrase);
  mergeStringValues(existing.seedEvidence, input.evidence);
  if (input.sourceLane) existing.sourceLanes.add(input.sourceLane);
  existing.candidateSources.add(input.candidateSource);
  if (input.companyRecord) existing.companyRecord = input.companyRecord;

  for (const sourceId of ATS_SOURCE_IDS) {
    const boardToken = cleanString(input.boardHints[sourceId]);
    if (boardToken && !existing.boardHints[sourceId]) {
      existing.boardHints[sourceId] = boardToken;
    }
  }

  const freshest = mostRecentIso(existing.freshnessAt, input.freshnessAt || "");
  if (freshest) existing.freshnessAt = freshest;
  input.byKey.set(key, existing);
}

function createMutableCandidate(
  companyKey: string,
  displayName: string,
  normalizedName: string,
): MutablePlannerCandidate {
  return {
    companyKey,
    displayName: cleanString(displayName) || humanizeCompanyKey(companyKey),
    normalizedName:
      cleanString(normalizedName) || normalizeCompanyName(displayName || companyKey),
    aliases: new Set<string>(),
    domains: new Set<string>(),
    boardHints: {},
    geoTags: new Set<string>(),
    roleTags: new Set<string>(),
    includeKeywords: new Set<string>(),
    excludeKeywords: new Set<string>(),
    candidateSources: new Set<CandidateSource>(),
    sourceLanes: new Set<DiscoverySourceLane>(),
    seedEvidence: new Set<string>(),
    freshnessAt: "",
    companyRecord: null,
  };
}

function resolveCompanyKey(
  company: CompanyPlannerCandidate,
  registryByNormalizedName: Map<string, CompanyRegistryRecord>,
): string {
  const explicitKey = cleanString(company.companyKey);
  if (explicitKey) return explicitKey;
  const normalizedName =
    cleanString(company.normalizedName) || normalizeCompanyName(company.name);
  const registryMatch = registryByNormalizedName.get(normalizedName);
  return registryMatch?.companyKey || normalizeCompanyKey(company.name);
}

function rankCandidate(
  candidate: MutablePlannerCandidate,
  intent: DiscoveryIntent,
  surfaceGroups: Map<string, SurfaceAggregate>,
  coverageGroups: Map<string, CoverageAggregate>,
  now: Date,
): RankedPlannedCompany {
  const companyRecord = candidate.companyRecord;
  const surfaces = surfaceGroups.get(candidate.companyKey) || emptySurfaceAggregate();
  const coverage = coverageGroups.get(candidate.companyKey) || emptyCoverageAggregate();

  const roleSignals = [
    ...candidate.roleTags,
    ...candidate.includeKeywords,
    ...candidate.aliases,
  ].map(normalizePhrase).filter(Boolean);
  const geoSignals = [...candidate.geoTags].map(normalizePhrase).filter(Boolean);

  const roleNeedles = uniqueStrings([
    ...intent.targetRoles,
    ...intent.includeKeywords,
    intent.seniority,
  ]).filter(Boolean);
  const geoNeedles = uniqueStrings([
    ...intent.locations,
    intent.remotePolicy,
  ]).filter(Boolean);

  const matchedRoleSignals = findMatchedSignals(roleNeedles, roleSignals);
  const matchedGeoSignals = findMatchedSignals(geoNeedles, geoSignals);
  const matchedExcludeSignals = findMatchedSignals(
    intent.excludeKeywords,
    uniqueStrings([
      ...roleSignals,
      ...geoSignals,
      candidate.normalizedName,
      ...candidate.excludeKeywords,
    ]),
  );

  const roleFit = computeSignalFit({
    needles: roleNeedles,
    matches: matchedRoleSignals.length,
    signalCount: roleSignals.length,
    excludeMatches: matchedExcludeSignals.length,
    neutralScore: 60,
    fallbackScore: 35,
  });
  const geoFit = computeSignalFit({
    needles: geoNeedles,
    matches: matchedGeoSignals.length,
    signalCount: geoSignals.length,
    excludeMatches: 0,
    neutralScore: 60,
    fallbackScore: 32,
  });
  const remoteFit = computeRemoteFit(intent, geoSignals);

  const confidence = clampNumber(companyRecord?.confidence || 0, 0, 1);
  const priorAcceptedYield = computePriorAcceptedYield(
    companyRecord?.successCount || 0,
    companyRecord?.failureCount || 0,
    confidence,
  );
  const freshnessAt = mostRecentIso(
    coverage.lastCompletedAt,
    candidate.freshnessAt,
    companyRecord?.lastSuccessAt || "",
    companyRecord?.lastSeenAt || "",
    surfaces.lastSuccessAt,
    surfaces.lastVerifiedAt,
  );
  const freshness = computeFreshness(coverage, freshnessAt, now);
  const surfaceHealth = computeSurfaceHealth(surfaces);
  const verifiedSurfaceBonus = computeVerifiedSurfaceBonus(surfaces);
  const presetAlignment = computePresetAlignment(intent.sourcePreset, candidate, surfaces);
  const providerDiversity = computeProviderDiversity(candidate, surfaces);
  const diversity = computeCompanyDiversity(providerDiversity, coverage);
  const providerCount = uniqueStrings([
    ...surfaces.providers,
    ...(Object.keys(candidate.boardHints) as AtsSourceId[]),
  ]).length;
  const sourceLaneCount = uniqueStrings([
    ...candidate.sourceLanes,
    ...surfaces.sourceLanes,
  ]).length;
  const recentHiringEvidence = clampNumber(
    surfaceHealth * 0.35 +
      verifiedSurfaceBonus * 0.25 +
      scoreRecency(mostRecentIso(surfaces.lastSuccessAt, surfaces.lastVerifiedAt), now, 10) *
        0.25 +
      confidence * 100 * 0.15,
    0,
    100,
  );

  const cooldownUntil = mostRecentIso(
    companyRecord?.cooldownUntil || "",
    surfaces.cooldownUntil,
  );
  const cooldownPenalty = computeCooldownPenalty(companyRecord, surfaces, now);
  const recentCoveragePenalty = coverage.penalty;
  const suppressionReasons = computeSuppressionReasons(companyRecord, surfaces, now);

  const rank = roundScore(
    clampNumber(
      roleFit * 0.21 +
        geoFit * 0.08 +
        remoteFit * 0.05 +
        recentHiringEvidence * 0.18 +
        priorAcceptedYield * 0.14 +
        diversity * 0.1 +
        freshness * 0.1 +
        verifiedSurfaceBonus * 0.08 +
        surfaceHealth * 0.04 +
        presetAlignment * 0.04 -
        recentCoveragePenalty * 0.08 -
        cooldownPenalty * 0.12,
      0,
      100,
    ),
  );

  const evidence: PlannedCompanyEvidence = {
    intentKey: intent.intentKey,
    candidateSources: [...candidate.candidateSources].sort(),
    sourceLanes: [...candidate.sourceLanes].sort(),
    matchedRoleSignals: [...matchedRoleSignals].sort(),
    matchedGeoSignals: [...matchedGeoSignals].sort(),
    matchedExcludeSignals: [...matchedExcludeSignals].sort(),
    remoteFit,
    providerDiversity,
    providerCount,
    sourceLaneCount,
    verifiedSurfaceCount: surfaces.verified,
    activeVerifiedSurfaceCount: surfaces.activeVerified,
    surfaceHealth,
    verifiedSurfaceBonus,
    presetAlignment,
    surfaceHosts: [...surfaces.hosts].sort(),
    surfaceProviders: [...surfaces.providers].sort(),
    successCount: companyRecord?.successCount || 0,
    failureCount: companyRecord?.failureCount || 0,
    confidence,
    recentCoverage: {
      recordCount: coverage.recordCount,
      surfacesSeen: coverage.surfacesSeen,
      listingsSeen: coverage.listingsSeen,
      listingsWritten: coverage.listingsWritten,
      lastCompletedAt: coverage.lastCompletedAt,
      penalty: recentCoveragePenalty,
    },
    penalties: {
      recentCoverage: recentCoveragePenalty,
      cooldown: cooldownPenalty,
    },
    timestamps: {
      freshnessAt,
      lastSeenAt: companyRecord?.lastSeenAt || "",
      lastSuccessAt: companyRecord?.lastSuccessAt || "",
      lastVerifiedAt: surfaces.lastVerifiedAt,
      cooldownUntil,
    },
  };

  return {
    companyKey: candidate.companyKey,
    displayName: candidate.displayName,
    normalizedName: candidate.normalizedName,
    domains: [...candidate.domains].sort(),
    aliases: [...candidate.aliases].sort(),
    boardHints: { ...candidate.boardHints },
    geoTags: [...candidate.geoTags].sort(),
    roleTags: [...candidate.roleTags].sort(),
    rank,
    scores: {
      roleFit: roundScore(roleFit),
      geoFit: roundScore(geoFit),
      remoteFit: roundScore(remoteFit),
      recentHiringEvidence: roundScore(recentHiringEvidence),
      priorAcceptedYield: roundScore(priorAcceptedYield),
      surfaceHealth: roundScore(surfaceHealth),
      diversity: roundScore(diversity),
      freshness: roundScore(freshness),
      cooldownPenalty: roundScore(cooldownPenalty),
      recentCoveragePenalty: roundScore(recentCoveragePenalty),
    },
    reasons: buildReasons({
      candidate,
      surfaces,
      coverage,
      matchedRoleSignals,
      matchedGeoSignals,
      matchedExcludeSignals,
      remoteFit,
      providerDiversity,
      suppressionReasons,
    }),
    evidence,
    suppressionReasons,
  };
}

function groupSurfaces(
  records: readonly CareerSurfaceRecord[],
  now: Date,
): Map<string, SurfaceAggregate> {
  const grouped = new Map<string, SurfaceAggregate>();

  for (const record of records) {
    const companyKey = cleanString(record.companyKey);
    if (!companyKey) continue;
    const bucket = grouped.get(companyKey) || emptySurfaceAggregate();
    bucket.total += 1;
    if (record.verifiedStatus === "verified") bucket.verified += 1;
    if (record.verifiedStatus === "verified" && !isFutureIso(record.cooldownUntil, now)) {
      bucket.activeVerified += 1;
    }
    if (
      record.surfaceType === "employer_careers" ||
      record.surfaceType === "employer_jobs" ||
      record.surfaceType === "job_posting"
    ) {
      bucket.employerSurfaceCount += 1;
    }
    if (record.surfaceType === "provider_board") {
      bucket.providerSurfaceCount += 1;
    }
    if (record.verifiedStatus === "dead") bucket.dead += 1;
    bucket.failureStreak += Math.max(0, record.failureStreak || 0);
    if (record.cooldownUntil) {
      bucket.cooldownUntil = mostRecentIso(bucket.cooldownUntil, record.cooldownUntil);
      if (isFutureIso(record.cooldownUntil, now)) {
        bucket.cooldownCount += 1;
      }
    }
    bucket.lastVerifiedAt = mostRecentIso(bucket.lastVerifiedAt, record.lastVerifiedAt);
    bucket.lastSuccessAt = mostRecentIso(bucket.lastSuccessAt, record.lastSuccessAt);
    const normalizedHost = normalizeDomain(record.host || record.finalUrl || record.canonicalUrl);
    if (normalizedHost) bucket.hosts.push(normalizedHost);
    if (record.sourceLane) bucket.sourceLanes.push(record.sourceLane);
    if (record.providerType && ATS_SOURCE_IDS.includes(record.providerType)) {
      bucket.providers.push(record.providerType);
      const boardToken = cleanString(record.boardToken);
      if (boardToken && !bucket.boardHints[record.providerType]) {
        bucket.boardHints[record.providerType] = boardToken;
      }
    }
    grouped.set(companyKey, bucket);
  }

  for (const bucket of grouped.values()) {
    bucket.hosts = uniqueStrings(bucket.hosts).sort();
    bucket.providers = uniqueStrings(bucket.providers).sort() as AtsSourceId[];
    bucket.sourceLanes = uniqueStrings(bucket.sourceLanes).sort() as DiscoverySourceLane[];
  }

  return grouped;
}

function groupCoverage(
  records: readonly IntentCoverageRecord[],
  intentKey: string,
  now: Date,
): Map<string, CoverageAggregate> {
  const grouped = new Map<string, CoverageAggregate>();

  for (const record of records) {
    if (cleanString(record.intentKey) !== intentKey) continue;
    if (!withinDays(record.completedAt || record.startedAt, now, RECENT_COVERAGE_WINDOW_DAYS)) {
      continue;
    }
    const companyKey = cleanString(record.companyKey);
    if (!companyKey) continue;
    const bucket = grouped.get(companyKey) || emptyCoverageAggregate();
    bucket.recordCount += 1;
    bucket.surfacesSeen += Math.max(0, record.surfacesSeen || 0);
    bucket.listingsSeen += Math.max(0, record.listingsSeen || 0);
    bucket.listingsWritten += Math.max(0, record.listingsWritten || 0);
    bucket.lastCompletedAt = mostRecentIso(bucket.lastCompletedAt, record.completedAt);
    grouped.set(companyKey, bucket);
  }

  for (const bucket of grouped.values()) {
    const lastCompletedRecency = scoreRecency(bucket.lastCompletedAt, now, 0);
    bucket.penalty = roundScore(
      clampNumber(
        bucket.recordCount * 12 +
          bucket.surfacesSeen * 1.5 +
          bucket.listingsSeen * 1.25 +
          bucket.listingsWritten * 4 +
          lastCompletedRecency * 0.15,
        0,
        100,
      ),
    );
  }

  return grouped;
}

function computeSignalFit(input: {
  needles: readonly string[];
  matches: number;
  signalCount: number;
  excludeMatches: number;
  neutralScore: number;
  fallbackScore: number;
}): number {
  if (!input.needles.length) return input.neutralScore;
  if (!input.signalCount) {
    return clampNumber(input.fallbackScore - input.excludeMatches * 12, 0, 100);
  }
  const coverage = input.matches / input.needles.length;
  return clampNumber(
    22 + coverage * 78 - input.excludeMatches * 20,
    0,
    100,
  );
}

function computePriorAcceptedYield(
  successCount: number,
  failureCount: number,
  confidence: number,
): number {
  const total = successCount + failureCount;
  if (!total) {
    return clampNumber(25 + confidence * 20, 0, 100);
  }
  const successRate = successCount / total;
  return clampNumber(
    successRate * 70 +
      Math.min(successCount, 8) * 3 +
      confidence * 12 -
      Math.min(failureCount, 6) * 2,
    0,
    100,
  );
}

function computeSurfaceHealth(surfaces: SurfaceAggregate): number {
  if (!surfaces.total) return 25;
  return clampNumber(
    30 +
      surfaces.verified * 18 +
      surfaces.activeVerified * 8 +
      surfaces.employerSurfaceCount * 6 +
      surfaces.providerSurfaceCount * 4 -
      surfaces.dead * 14 -
      surfaces.cooldownCount * 8 -
      Math.min(surfaces.failureStreak, 10) * 3,
    0,
    100,
  );
}

function computeVerifiedSurfaceBonus(surfaces: SurfaceAggregate): number {
  if (!surfaces.total) return 0;
  return clampNumber(
    surfaces.activeVerified * 24 + Math.max(0, surfaces.verified - surfaces.activeVerified) * 10,
    0,
    100,
  );
}

function computePresetAlignment(
  sourcePreset: SourcePreset,
  candidate: MutablePlannerCandidate,
  surfaces: SurfaceAggregate,
): number {
  const boardHintCount = Object.keys(candidate.boardHints).length;
  if (sourcePreset === "ats_only") {
    return clampNumber(
      surfaces.providerSurfaceCount * 18 + boardHintCount * 12,
      0,
      100,
    );
  }
  if (sourcePreset === "browser_only") {
    return clampNumber(
      surfaces.employerSurfaceCount * 22 + candidate.domains.size * 8,
      0,
      100,
    );
  }
  return clampNumber(
    surfaces.providerSurfaceCount * 12 +
      surfaces.employerSurfaceCount * 12 +
      boardHintCount * 8 +
      candidate.domains.size * 4,
    0,
    100,
  );
}

function computeRemoteFit(
  intent: DiscoveryIntent,
  geoSignals: readonly string[],
): number {
  const remoteIntent = normalizePhrase(intent.remotePolicy);
  const normalizedLocations = intent.locations.map(normalizePhrase);
  const wantsRemote =
    remoteIntent.includes("remote") ||
    normalizedLocations.some((location) => location.includes("remote"));
  const wantsHybrid = remoteIntent.includes("hybrid");
  const wantsOnsite =
    remoteIntent.includes("onsite") ||
    remoteIntent.includes("on site") ||
    remoteIntent.includes("office");

  if (!wantsRemote && !wantsHybrid && !wantsOnsite) return 60;
  if (!geoSignals.length) return 35;

  const hasRemote = geoSignals.some((signal) => signal.includes("remote"));
  const hasHybrid = geoSignals.some((signal) => signal.includes("hybrid"));
  const hasOnsite = geoSignals.some(
    (signal) =>
      signal.includes("onsite") ||
      signal.includes("on site") ||
      signal.includes("office"),
  );

  if (wantsRemote) {
    if (hasRemote) return 100;
    if (hasHybrid) return 72;
    return 18;
  }
  if (wantsHybrid) {
    if (hasHybrid) return 100;
    if (hasRemote) return 62;
    if (hasOnsite) return 46;
    return 30;
  }
  if (wantsOnsite) {
    if (hasOnsite) return 100;
    if (hasHybrid) return 68;
    if (hasRemote) return 20;
    return 40;
  }
  return 60;
}

function computeProviderDiversity(
  candidate: MutablePlannerCandidate,
  surfaces: SurfaceAggregate,
): number {
  const providerCount = uniqueStrings([
    ...surfaces.providers,
    ...(Object.keys(candidate.boardHints) as AtsSourceId[]),
  ]).length;
  const laneCount = uniqueStrings([
    ...candidate.sourceLanes,
    ...surfaces.sourceLanes,
  ]).length;
  const mixedSurfaceFamilies =
    surfaces.employerSurfaceCount > 0 && surfaces.providerSurfaceCount > 0 ? 1 : 0;

  return clampNumber(
    providerCount * 22 +
      laneCount * 16 +
      mixedSurfaceFamilies * 18 +
      Math.min(candidate.domains.size, 3) * 4,
    0,
    100,
  );
}

function computeFreshness(
  coverage: CoverageAggregate,
  freshnessAt: string,
  now: Date,
): number {
  if (!coverage.recordCount) {
    return clampNumber(scoreRecency(freshnessAt, now, 55), 18, 100);
  }
  const coverageAgeDays = ageInDays(coverage.lastCompletedAt, now);
  if (coverageAgeDays == null) {
    return clampNumber(scoreRecency(freshnessAt, now, 60), 25, 85);
  }
  if (coverageAgeDays <= 1) return 12;
  if (coverageAgeDays <= 3) return 20;
  if (coverageAgeDays <= 7) return 36;
  if (coverageAgeDays <= 14) return 58;
  if (coverageAgeDays <= 21) return 72;
  return 84;
}

function computeCompanyDiversity(
  providerDiversity: number,
  coverage: CoverageAggregate,
): number {
  const coverageDiversity = clampNumber(100 - coverage.penalty, 0, 100);
  return clampNumber(
    providerDiversity * 0.45 + coverageDiversity * 0.55,
    0,
    100,
  );
}

function computeCooldownPenalty(
  companyRecord: CompanyRegistryRecord | null,
  surfaces: SurfaceAggregate,
  now: Date,
): number {
  if (companyRecord && isFutureIso(companyRecord.cooldownUntil, now)) {
    return 100;
  }
  if (!surfaces.cooldownCount) return 0;
  return clampNumber(24 + surfaces.cooldownCount * 18, 0, 100);
}

function computeSuppressionReasons(
  companyRecord: CompanyRegistryRecord | null,
  surfaces: SurfaceAggregate,
  now: Date,
): string[] {
  const reasons: string[] = [];
  if (companyRecord && isFutureIso(companyRecord.cooldownUntil, now)) {
    reasons.push(`company cooldown active until ${companyRecord.cooldownUntil}`);
  }
  if (surfaces.cooldownCount > 0 && surfaces.cooldownCount >= surfaces.total && surfaces.total > 0) {
    reasons.push("all known career surfaces are cooling down");
  }
  return reasons;
}

function buildReasons(input: {
  candidate: MutablePlannerCandidate;
  surfaces: SurfaceAggregate;
  coverage: CoverageAggregate;
  matchedRoleSignals: string[];
  matchedGeoSignals: string[];
  matchedExcludeSignals: string[];
  remoteFit: number;
  providerDiversity: number;
  suppressionReasons: string[];
}): string[] {
  const reasons: string[] = [];

  if (input.surfaces.activeVerified > 0) {
    reasons.push(
      `${input.surfaces.activeVerified} active verified surface${input.surfaces.activeVerified === 1 ? "" : "s"}`,
    );
  } else if (input.surfaces.verified > 0) {
    reasons.push(
      `${input.surfaces.verified} verified surface${input.surfaces.verified === 1 ? "" : "s"}`,
    );
  }
  if (input.matchedRoleSignals.length > 0) {
    reasons.push(`role match: ${input.matchedRoleSignals.slice(0, 3).join(", ")}`);
  }
  if (input.matchedGeoSignals.length > 0) {
    reasons.push(`geo match: ${input.matchedGeoSignals.slice(0, 3).join(", ")}`);
  }
  if (input.remoteFit >= 70) {
    reasons.push("remote policy aligned");
  }
  if (input.providerDiversity >= 55) {
    reasons.push("strong provider/source diversity");
  }
  if (!input.coverage.recordCount) {
    reasons.push("under-covered for this intent");
  } else if (input.coverage.penalty >= 40) {
    reasons.push(
      `recently covered ${input.coverage.recordCount} time${input.coverage.recordCount === 1 ? "" : "s"} for this intent`,
    );
  }
  if (input.matchedExcludeSignals.length > 0) {
    reasons.push(`exclude overlap: ${input.matchedExcludeSignals.slice(0, 2).join(", ")}`);
  }
  reasons.push(...input.suppressionReasons);
  return uniqueStrings([...input.candidate.seedEvidence, ...reasons]).slice(0, 8);
}

function compareRankedCompanies(
  left: RankedPlannedCompany,
  right: RankedPlannedCompany,
): number {
  return (
    right.rank - left.rank ||
    left.evidence.penalties.cooldown - right.evidence.penalties.cooldown ||
    left.evidence.penalties.recentCoverage - right.evidence.penalties.recentCoverage ||
    right.scores.diversity - left.scores.diversity ||
    right.scores.recentHiringEvidence - left.scores.recentHiringEvidence ||
    left.displayName.localeCompare(right.displayName)
  );
}

function emptySurfaceAggregate(): SurfaceAggregate {
  return {
    total: 0,
    verified: 0,
    activeVerified: 0,
    employerSurfaceCount: 0,
    providerSurfaceCount: 0,
    dead: 0,
    failureStreak: 0,
    cooldownCount: 0,
    lastVerifiedAt: "",
    lastSuccessAt: "",
    cooldownUntil: "",
    hosts: [],
    providers: [],
    sourceLanes: [],
    boardHints: {},
  };
}

function emptyCoverageAggregate(): CoverageAggregate {
  return {
    recordCount: 0,
    surfacesSeen: 0,
    listingsSeen: 0,
    listingsWritten: 0,
    lastCompletedAt: "",
    penalty: 0,
  };
}

function normalizeIntentList(values: readonly string[]): string[] {
  return uniqueStrings(values.map(normalizePhrase).filter(Boolean)).sort();
}

function joinIntentPart(values: readonly string[]): string {
  return values.length ? values.join("~") : "any";
}

function normalizePhrase(value: unknown): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompanyName(value: unknown): string {
  return normalizePhrase(value);
}

function normalizeCompanyKey(value: unknown): string {
  return normalizeCompanyName(value).replace(/\s+/g, "-");
}

function normalizeDomain(value: unknown): string {
  return cleanString(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .trim();
}

function cleanString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value == null ? "" : String(value).trim();
}

function parseStringArray(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanString).filter(Boolean);
  } catch {
    return [];
  }
}

function parseBoardHints(raw: string): Partial<Record<AtsSourceId, string>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const hints: Partial<Record<AtsSourceId, string>> = {};
    for (const sourceId of ATS_SOURCE_IDS) {
      const value = cleanString((parsed as Record<string, unknown>)[sourceId]);
      if (value) hints[sourceId] = value;
    }
    return hints;
  } catch {
    return {};
  }
}

function uniqueStrings<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values.filter(Boolean))];
}

function mergeStringValues(
  target: Set<string>,
  values: Iterable<string>,
  normalize: (value: string) => string = cleanString,
) {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) target.add(normalized);
  }
}

function findMatchedSignals(
  needles: readonly string[],
  signals: readonly string[],
): string[] {
  const matches = new Set<string>();
  for (const needle of needles) {
    for (const signal of signals) {
      if (!needle || !signal) continue;
      if (signal === needle || signal.includes(needle) || needle.includes(signal)) {
        matches.add(signal);
      }
    }
  }
  return [...matches];
}

function scoreRecency(value: string, now: Date, fallback: number): number {
  const ageDays = ageInDays(value, now);
  if (ageDays == null) return fallback;
  if (ageDays <= 3) return 100;
  if (ageDays <= 7) return 92;
  if (ageDays <= 14) return 80;
  if (ageDays <= 30) return 62;
  if (ageDays <= 60) return 38;
  if (ageDays <= 90) return 20;
  return 8;
}

function ageInDays(value: string, now: Date): number | null {
  const timestamp = Date.parse(cleanString(value));
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 86_400_000);
}

function withinDays(value: string, now: Date, days: number): boolean {
  const ageDays = ageInDays(value, now);
  return ageDays != null && ageDays <= days;
}

function isFutureIso(value: string, now: Date): boolean {
  const timestamp = Date.parse(cleanString(value));
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function mostRecentIso(...values: string[]): string {
  let winner = "";
  let winnerTimestamp = -Infinity;
  for (const value of values) {
    const normalized = cleanString(value);
    const timestamp = Date.parse(normalized);
    if (!Number.isFinite(timestamp)) continue;
    if (timestamp > winnerTimestamp) {
      winner = normalized;
      winnerTimestamp = timestamp;
    }
  }
  return winner;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function humanizeCompanyKey(value: string): string {
  const cleaned = cleanString(value).replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
