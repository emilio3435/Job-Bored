import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createSourceAdapterRegistry } from "./browser/source-adapters.ts";
import {
  formatBrowserRuntimeReadinessWarning,
  validateBrowserRuntimeReadiness,
} from "./browser/runtime-readiness.ts";
import {
  loadRuntimeConfig,
  loadStoredWorkerConfig,
  mergeDiscoveryConfig,
  upsertStoredWorkerConfig,
} from "./config.ts";
import {
  buildDiscoveryIntent as buildPlannerIntent,
  planCompanies as runCompanyPlanner,
} from "./discovery/company-planner.ts";
import { createGroundedSearchClient } from "./grounding/grounded-search.ts";
import { buildCorsHeaders, isOriginAllowed } from "./http/origin-guard.ts";
import { createGeminiMatchClient } from "./match/job-matcher.ts";
import { runDiscovery } from "./run/run-discovery.ts";
import {
  formatSheetsCredentialReadinessWarning,
  validateSheetsCredentialReadiness,
} from "./sheets/credential-readiness.ts";
import { createPipelineWriter } from "./sheets/pipeline-writer.ts";
import {
  buildRunStatusPath,
  createDiscoveryRunStatusStore,
} from "./state/run-status-store.ts";
import { createDiscoveryMemoryStore } from "./state/discovery-memory-store.ts";
import { createRunDiscoveryMemoryStore } from "./state/run-discovery-memory-store.ts";
import {
  handleDiscoveryWebhook,
  hasValidWebhookSecret,
} from "./webhook/handle-discovery-webhook.ts";
import { handleDiscoveryProfileWebhook } from "./webhook/handle-discovery-profile.ts";
import { createBrowserUseSessionManager } from "./browser/session.ts";

const runtimeConfig = loadRuntimeConfig(process.env);
const sessionManager = createBrowserUseSessionManager(runtimeConfig);
const groundedSearchClient = runtimeConfig.geminiApiKey
  ? createGroundedSearchClient(runtimeConfig, { log: logEvent })
  : null;
const matchClient = runtimeConfig.geminiApiKey
  ? createGeminiMatchClient(runtimeConfig)
  : null;
const sourceAdapterRegistry = createSourceAdapterRegistry(sessionManager);
const rawDiscoveryMemoryStore = createDiscoveryMemoryStore(
  runtimeConfig.stateDatabasePath,
);
const companyPlanner = {
  buildIntent(config: Parameters<typeof buildPlannerIntent>[0]) {
    return buildPlannerIntent(config);
  },
  planCompanies(input: {
    run: { request: { requestedAt?: string } };
    intent: ReturnType<typeof buildPlannerIntent>;
    companies: Array<Record<string, unknown>>;
      memory?: {
        companies: unknown[];
        careerSurfaces: unknown[];
        intentCoverage: unknown[];
      } | null;
  }) {
    const result = runCompanyPlanner({
      ...input.intent,
      companies: input.companies,
      memory: input.memory
        ? {
            companyRegistry: (input.memory.companies || []).map(
              toPlannerCompanyRecord,
            ),
            careerSurfaces: (input.memory.careerSurfaces || []).map(
              toPlannerCareerSurfaceRecord,
            ),
            intentCoverage: input.memory.intentCoverage,
          }
        : undefined,
      now: input.run.request.requestedAt
        ? new Date(input.run.request.requestedAt)
        : new Date(),
    });
    return {
      plannedCompanies: result.plannedCompanies.map(mapPlannerCompany),
      suppressedCompanies: result.suppressedCompanies.map(mapPlannerCompany),
    };
  },
};
const discoveryMemoryStore = {
  ...createRunDiscoveryMemoryStore(rawDiscoveryMemoryStore),
  upsertCompanyRecords(records: Array<Record<string, unknown>>) {
    for (const record of records) {
      rawDiscoveryMemoryStore.upsertCompany({
        companyKey: String(record.companyKey || ""),
        displayName: String(record.displayName || ""),
        normalizedName: String(record.normalizedName || ""),
        aliases: parseJsonArray(record.aliasesJson),
        domains: parseJsonArray(record.domainsJson),
        atsHints: flattenHintRecord(record.atsHintsJson),
        geoTags: parseJsonArray(record.geoTagsJson),
        roleTags: parseJsonArray(record.roleTagsJson),
        firstSeenAt: nullableString(record.firstSeenAt),
        lastSeenAt: nullableString(record.lastSeenAt),
        lastSuccessAt: nullableString(record.lastSuccessAt),
        successIncrement: Number(record.successCount || 0),
        failureIncrement: Number(record.failureCount || 0),
        confidence:
          typeof record.confidence === "number"
            ? record.confidence
            : Number(record.confidence || 0),
        cooldownUntil: nullableString(record.cooldownUntil),
      });
    }
  },
  upsertCareerSurfaces(records: Array<Record<string, unknown>>) {
    for (const record of records) {
      rawDiscoveryMemoryStore.upsertCareerSurface({
        surfaceId: nullableString(record.surfaceId),
        companyKey: String(record.companyKey || ""),
        surfaceType: String(record.surfaceType || ""),
        providerType: nullableString(record.providerType),
        canonicalUrl: String(record.canonicalUrl || ""),
        finalUrl: nullableString(record.finalUrl),
        boardToken: nullableString(record.boardToken),
        sourceLane: nullableString(record.sourceLane),
        verifiedStatus: nullableString(record.verifiedStatus),
        lastVerifiedAt: nullableString(record.lastVerifiedAt),
        lastSuccessAt: nullableString(record.lastSuccessAt),
        lastFailureAt: nullableString(record.lastFailureAt),
        failureReason: nullableString(record.failureReason),
        failureStreak: Number(record.failureStreak || 0),
        cooldownUntil: nullableString(record.cooldownUntil),
        metadata: parseJsonObject(record.metadataJson),
      });
    }
  },
  getHostSuppression(host: string) {
    const record = rawDiscoveryMemoryStore.getHostSuppression(host);
    return record ? toRunHostSuppressionRecord(record) : null;
  },
  isHostSuppressed(host: string, now?: string) {
    return rawDiscoveryMemoryStore.isHostSuppressed(host, now);
  },
  upsertHostSuppression(record: Record<string, unknown>) {
    rawDiscoveryMemoryStore.upsertHostSuppression({
      host: String(record.host || ""),
      qualityScore:
        typeof record.qualityScore === "number"
          ? record.qualityScore
          : Number.isFinite(Number(record.qualityScore))
            ? Number(record.qualityScore)
            : null,
      qualityDelta:
        typeof record.qualityDelta === "number"
          ? record.qualityDelta
          : Number.isFinite(Number(record.qualityDelta))
            ? Number(record.qualityDelta)
            : null,
      junkExtractionIncrement:
        typeof record.junkExtractionIncrement === "number"
          ? record.junkExtractionIncrement
          : Number.isFinite(Number(record.junkExtractionIncrement))
            ? Number(record.junkExtractionIncrement)
            : null,
      canonicalResolutionFailureIncrement:
        typeof record.canonicalResolutionFailureIncrement === "number"
          ? record.canonicalResolutionFailureIncrement
          : Number.isFinite(Number(record.canonicalResolutionFailureIncrement))
            ? Number(record.canonicalResolutionFailureIncrement)
            : null,
      suppressionIncrement:
        typeof record.suppressionIncrement === "number"
          ? record.suppressionIncrement
          : Number.isFinite(Number(record.suppressionIncrement))
            ? Number(record.suppressionIncrement)
            : null,
      lastSeenAt: nullableString(record.lastSeenAt),
      lastReasonCode: nullableString(record.lastReasonCode),
      nextRetryAt: nullableString(record.nextRetryAt),
      cooldownUntil: nullableString(record.cooldownUntil),
    });
  },
  getDeadLink(url: string) {
    const record = rawDiscoveryMemoryStore.getDeadLink(url);
    return record ? toRunDeadLinkRecord(record) : null;
  },
  isDeadLinkCoolingDown(url: string, now?: string) {
    return rawDiscoveryMemoryStore.isDeadLinkCoolingDown(url, now);
  },
  recordDeadLink(record: Record<string, unknown>) {
    // The grounded-search producer (maybeRecordGroundedDeadLink) emits
    //   { url, host, reason, firstSeenAt, cooldownUntil, reasonCode, httpStatus }
    // — NOT urlKey/finalUrl/nextRetryAt. The earlier adapter keyed on
    // urlKey/nextRetryAt, so upsertDeadLink either threw "url must be a
    // non-empty URL" or stored rows with nextRetryAt=null, defeating the
    // cooldown on every subsequent run. Accept both naming schemes.
    rawDiscoveryMemoryStore.upsertDeadLink({
      url: String(record.url || record.urlKey || record.finalUrl || ""),
      finalUrl: nullableString(record.finalUrl),
      host: nullableString(record.host),
      reasonCode: String(record.reasonCode || ""),
      httpStatus:
        typeof record.httpStatus === "number"
          ? record.httpStatus
          : Number.isFinite(Number(record.httpStatus))
            ? Number(record.httpStatus)
            : null,
      lastTitle: nullableString(record.lastTitle),
      lastSeenAt: nullableString(record.firstSeenAt || record.lastSeenAt),
      failureIncrement: Number(record.failureCount || 1),
      nextRetryAt: nullableString(record.cooldownUntil || record.nextRetryAt),
    });
  },
  findListingFingerprint(fingerprintKey: string) {
    const record = rawDiscoveryMemoryStore.findListingFingerprint({
      fingerprintKey,
    });
    return record ? toRunListingFingerprintRecord(record) : null;
  },
  upsertListingFingerprints(records: Array<Record<string, unknown>>) {
    for (const record of records) {
      rawDiscoveryMemoryStore.upsertListingFingerprint({
        companyKey: String(record.companyKey || ""),
        titleKey: String(record.titleKey || ""),
        locationKey: String(record.locationKey || ""),
        canonicalUrlKey: nullableString(record.canonicalUrlKey),
        externalJobId: nullableString(record.externalJobId),
        remoteBucket: String(record.remoteBucket || "unknown"),
        employmentType: nullableString(record.employmentType),
        contentHash: nullableString(record.contentHash),
        seenAt: nullableString(record.lastSeenAt),
        writtenAt: nullableString(record.lastWrittenAt),
        runId: nullableString(record.lastRunId),
        sheetId: nullableString(record.lastSheetId),
        sourceIds: parseJsonArray(record.sourceIdsJson),
      });
    }
  },
  recordIntentCoverage(record: Record<string, unknown>) {
    rawDiscoveryMemoryStore.writeIntentCoverage({
      intentKey: String(record.intentKey || ""),
      companyKey: String(record.companyKey || ""),
      runId: String(record.runId || ""),
      sourceLane: String(record.sourceLane || "grounded_web"),
      surfacesSeen: Number(record.surfacesSeen || 0),
      listingsSeen: Number(record.listingsSeen || 0),
      listingsWritten: Number(record.listingsWritten || 0),
      startedAt: nullableString(record.startedAt),
      completedAt: nullableString(record.completedAt),
    });
  },
};
const pipelineWriter = createPipelineWriter(runtimeConfig);
const runStatusStore = createDiscoveryRunStatusStore(
  runtimeConfig.stateDatabasePath,
);
const RUN_STATUS_TEMPLATE = "/runs/{runId}";

const sharedRunDependencies = {
  runtimeConfig,
  sourceAdapterRegistry,
  companyPlanner,
  discoveryMemoryStore,
  browserSessionManager: sessionManager,
  groundedSearchClient,
  matchClient,
  pipelineWriter,
  loadStoredWorkerConfig: (sheetId: string) =>
    loadStoredWorkerConfig(runtimeConfig, sheetId),
  mergeDiscoveryConfig,
  now: () => new Date(),
  randomId: (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`,
};

function mapPlannerCompany(company: Record<string, unknown>) {
  const evidence =
    company.evidence && typeof company.evidence === "object"
      ? (company.evidence as Record<string, unknown>)
      : {};
  const scores =
    company.scores && typeof company.scores === "object"
      ? (company.scores as Record<string, unknown>)
      : {};
  const reasons = parseJsonArray(company.reasons || []);
  const intendedLanes = parseJsonArray(evidence.sourceLanes || []);
  const candidateSources = parseJsonArray(evidence.candidateSources || []);
  return {
    companyKey: String(company.companyKey || ""),
    displayName: String(company.displayName || ""),
    normalizedName: String(company.normalizedName || ""),
    domains: parseJsonArray(company.domains || []),
    aliases: parseJsonArray(company.aliases || []),
    boardHints: flattenHintRecord(company.boardHints),
    geoTags: parseJsonArray(company.geoTags || []),
    roleTags: parseJsonArray(company.roleTags || []),
    rank: Number(company.rank || 0),
    intendedLanes: intendedLanes.length > 0 ? intendedLanes : [
      "ats_provider",
      "company_surface",
      "grounded_web",
    ],
    scores: {
      roleFit: Number(scores.roleFit || 0),
      geoFit: Number(scores.geoFit || 0),
      remoteFit: 0,
      recentHiringEvidence: Number(scores.recentHiringEvidence || 0),
      priorAcceptedYield: Number(scores.priorAcceptedYield || 0),
      surfaceHealth: Number(evidence.surfaceHealth || 0),
      diversity: Number(scores.diversity || 0),
      freshness: Number(scores.freshness || 0),
      cooldownPenalty: Number(scores.cooldownPenalty || 0),
      recentCoveragePenalty:
        Number(
          (evidence.recentCoverage &&
            typeof evidence.recentCoverage === "object" &&
            (evidence.recentCoverage as Record<string, unknown>).penalty) ||
            0,
        ) || 0,
    },
    reasons,
    evidence: [
      ...reasons,
      ...candidateSources.map((source) => `candidate:${source}`),
    ],
  };
}

function toPlannerCompanyRecord(company: Record<string, unknown>) {
  return {
    companyKey: String(company.companyKey || ""),
    displayName: String(company.displayName || ""),
    normalizedName: String(company.normalizedName || ""),
    aliasesJson: String(company.aliasesJson || "[]"),
    domainsJson: String(company.domainsJson || "[]"),
    atsHintsJson: String(company.atsHintsJson || "{}"),
    geoTagsJson: String(company.geoTagsJson || "[]"),
    roleTagsJson: String(company.roleTagsJson || "[]"),
    firstSeenAt: String(company.firstSeenAt || ""),
    lastSeenAt: String(company.lastSeenAt || ""),
    lastSuccessAt: String(company.lastSuccessAt || ""),
    successCount: Number(company.successCount || 0),
    failureCount: Number(company.failureCount || 0),
    confidence: Number(company.confidence || 0),
    cooldownUntil: String(company.cooldownUntil || ""),
  };
}

function toPlannerCareerSurfaceRecord(surface: Record<string, unknown>) {
  return {
    surfaceId: String(surface.surfaceId || ""),
    companyKey: String(surface.companyKey || ""),
    surfaceType: String(surface.surfaceType || ""),
    providerType: String(surface.providerType || ""),
    canonicalUrl: String(surface.canonicalUrl || ""),
    host: String(surface.host || ""),
    finalUrl: String(surface.finalUrl || ""),
    boardToken: String(surface.boardToken || ""),
    sourceLane: String(surface.sourceLane || "ats_provider"),
    verifiedStatus: String(surface.verifiedStatus || "pending"),
    lastVerifiedAt: String(surface.lastVerifiedAt || ""),
    lastSuccessAt: String(surface.lastSuccessAt || ""),
    lastFailureAt: String(surface.lastFailureAt || ""),
    failureReason: String(surface.failureReason || ""),
    failureStreak: Number(surface.failureStreak || 0),
    cooldownUntil: String(surface.cooldownUntil || ""),
    metadataJson: String(surface.metadataJson || "{}"),
  };
}

function toRunListingFingerprintRecord(record: Record<string, unknown>) {
  return {
    fingerprintKey: String(record.fingerprintKey || ""),
    companyKey: String(record.companyKey || ""),
    titleKey: String(record.titleKey || ""),
    locationKey: String(record.locationKey || ""),
    canonicalUrlKey: String(record.canonicalUrlKey || ""),
    externalJobId: String(record.externalJobId || ""),
    remoteBucket: String(record.remoteBucket || "unknown"),
    employmentType: String(record.employmentType || ""),
    semanticKey: String(record.semanticKey || ""),
    contentHash: String(record.contentHash || ""),
    firstSeenAt: String(record.firstSeenAt || ""),
    lastSeenAt: String(record.lastSeenAt || ""),
    lastWrittenAt: String(record.lastWrittenAt || ""),
    lastRunId: String(record.lastRunId || ""),
    lastSheetId: String(record.lastSheetId || ""),
    writeCount: Number(record.writeCount || 0),
    sourceIdsJson: JSON.stringify(record.sourceIds || []),
  };
}

function toRunHostSuppressionRecord(record: Record<string, unknown>) {
  return {
    hostKey: String(record.hostKey || ""),
    host: String(record.host || ""),
    qualityScore: Number(record.qualityScore || 0),
    junkExtractionCount: Number(record.junkExtractionCount || 0),
    canonicalResolutionFailureCount: Number(
      record.canonicalResolutionFailureCount || 0,
    ),
    suppressionCount: Number(record.suppressionCount || 0),
    lastSeenAt: String(record.lastSeenAt || ""),
    lastReasonCode: String(record.lastReasonCode || ""),
    nextRetryAt: String(record.nextRetryAt || ""),
    cooldownUntil: String(record.cooldownUntil || ""),
  };
}

function toRunDeadLinkRecord(record: Record<string, unknown>) {
  return {
    urlKey: String(record.urlKey || ""),
    finalUrl: String(record.finalUrl || ""),
    host: String(record.host || ""),
    reasonCode: String(record.reasonCode || ""),
    httpStatus:
      typeof record.httpStatus === "number"
        ? record.httpStatus
        : Number.isFinite(Number(record.httpStatus))
          ? Number(record.httpStatus)
          : null,
    lastTitle: String(record.lastTitle || ""),
    lastSeenAt: String(record.lastSeenAt || ""),
    failureCount: Number(record.failureCount || 0),
    nextRetryAt: String(record.nextRetryAt || ""),
  };
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed)
      ? parsed.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function flattenHintRecord(value: unknown): Record<string, string> {
  const parsed = parseJsonObject(value);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (Array.isArray(entry)) {
      const first = entry.map((item) => String(item || "").trim()).find(Boolean);
      if (first) out[key] = first;
      continue;
    }
    const normalized = String(entry || "").trim();
    if (normalized) out[key] = normalized;
  }
  return out;
}

function nullableString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

/**
 * Used by the request handler when a discovery request carries its own
 * `googleAccessToken`. The override config is the global runtimeConfig with
 * `googleAccessToken` populated, so the writer authenticates as the
 * dashboard's signed-in user instead of the worker's persistent credential.
 */
function createPipelineWriterForRequest(
  runtimeConfigOverride: typeof runtimeConfig,
) {
  return createPipelineWriter(runtimeConfigOverride);
}

function getHeaderValue(header: string | string[] | undefined): string {
  if (Array.isArray(header)) {
    return header[0] || "";
  }
  return String(header || "");
}

// 2 MiB is comfortably larger than the largest plausible resume payload
// (client-side extraction already truncates to a few tens of KB) while
// preventing an unauthenticated-or-authenticated client from forcing the
// worker to buffer arbitrary megabytes.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "BodyTooLargeError";
  }
}

async function readBody(
  request: import("node:http").IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      // Drain the remaining payload so the client gets a clean 413 instead of
      // an aborted connection that upstream proxies might retry.
      request.resume();
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.statusCode = status;
  setHeaders(response, {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function logEvent(event: string, details: Record<string, unknown>): void {
  console.log(
    `[browser-use-discovery] ${JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...details,
    })}`,
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function setHeaders(
  response: import("node:http").ServerResponse,
  headers: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value);
  }
}

async function buildHealthPayload() {
  let storedConfig = null;
  let configError = "";
  try {
    storedConfig = await loadStoredWorkerConfig(runtimeConfig, "");
  } catch (error) {
    configError = formatError(error);
  }

  const enabledSources = Array.isArray(storedConfig?.enabledSources)
    ? storedConfig.enabledSources
    : [];
  const groundedWebEnabled = enabledSources.includes("grounded_web");
  const memoryCounts = rawDiscoveryMemoryStore.getCounts();
  const companiesConfigured = Array.isArray(storedConfig?.companies)
    ? storedConfig.companies.length
    : 0;
  const atsCompaniesConfigured = Array.isArray(storedConfig?.atsCompanies)
    ? storedConfig.atsCompanies.length
    : 0;
  const modifierIntentConfigured = hasStoredModifierIntent(storedConfig);
  const plannerSeedReady =
    companiesConfigured > 0 ||
    modifierIntentConfigured ||
    memoryCounts.companyRegistry > 0 ||
    memoryCounts.careerSurfaces > 0;
  const atsSeedReady =
    atsCompaniesConfigured > 0 ||
    memoryCounts.companyRegistry > 0 ||
    memoryCounts.careerSurfaces > 0;
  const blockingWarnings: string[] = [];
  const advisoryWarnings: string[] = [];
  const sheetsCredentialReadiness =
    await validateSheetsCredentialReadiness(runtimeConfig);
  const localInteractiveSheetsReady =
    runtimeConfig.runMode === "local" &&
    !sheetsCredentialReadiness.configured;

  // VAL-OBS-001: Check browser runtime readiness
  const browserRuntimeReadiness =
    await validateBrowserRuntimeReadiness(runtimeConfig);

  if (configError) {
    blockingWarnings.push(`Worker config could not be loaded: ${configError}`);
  } else if (!plannerSeedReady) {
    advisoryWarnings.push(
      "Discovery worker has no fixed companies, no configured modifier intent, and no planner memory yet. Request-time targetRoles or keywordsInclude will be needed to bootstrap planning.",
    );
  }
  if (!sheetsCredentialReadiness.configured) {
    const warning = formatSheetsCredentialReadinessWarning(
      sheetsCredentialReadiness,
    );
    if (localInteractiveSheetsReady) {
      advisoryWarnings.push(
        `${warning} Local interactive runs can still authenticate with a per-request googleAccessToken from the dashboard.`,
      );
    } else {
      blockingWarnings.push(warning);
    }
  }

  // VAL-OBS-001: Browser runtime not ready
  if (!browserRuntimeReadiness.available) {
    blockingWarnings.push(
      formatBrowserRuntimeReadinessWarning(browserRuntimeReadiness),
    );
  }

  // VAL-OBS-002: Grounded-web readiness cause when enabled but not ready
  if (groundedWebEnabled && !groundedSearchClient) {
    const groundedWebCause = runtimeConfig.geminiApiKey
      ? "Grounded web source is enabled but the grounded search client is unavailable."
      : "Grounded web source is enabled but BROWSER_USE_DISCOVERY_GEMINI_API_KEY is not configured.";
    blockingWarnings.push(groundedWebCause);
  }

  return {
    status: "ok",
    service: "browser-use-discovery-worker",
    mode: runtimeConfig.runMode,
    asyncAckByDefault: runtimeConfig.asyncAckByDefault,
    routes: {
      health: "/health",
      webhook: "/webhook",
      discovery: "/discovery",
      discoveryProfile: "/discovery-profile",
      runStatus: RUN_STATUS_TEMPLATE,
    },
    readiness: {
      ready: blockingWarnings.length === 0,
      configLoaded: !configError,
      configuredSheetId: !!String(storedConfig?.sheetId || "").trim(),
      companiesConfigured,
      atsCompaniesConfigured,
      modifierIntentConfigured,
      plannerSeedReady,
      atsSeedReady,
      sheetsCredentialConfigured: sheetsCredentialReadiness.configured,
      sheetsCredentialReady:
        sheetsCredentialReadiness.configured || localInteractiveSheetsReady,
      enabledSources,
      memory: {
        companyRegistry: memoryCounts.companyRegistry,
        careerSurfaces: memoryCounts.careerSurfaces,
        deadLinkCache: memoryCounts.deadLinkCache,
        listingFingerprints: memoryCounts.listingFingerprints,
        intentCoverage: memoryCounts.intentCoverage,
      },
      planner: {
        companiesConfigured,
        modifierIntentConfigured,
        memorySeededCompanies: memoryCounts.companyRegistry,
        memorySeededSurfaces: memoryCounts.careerSurfaces,
        memorySeededIntentCoverage: memoryCounts.intentCoverage,
        ready: plannerSeedReady,
      },
      ats: {
        companiesConfigured: atsCompaniesConfigured,
        memorySeededCompanies: memoryCounts.companyRegistry,
        memorySeededSurfaces: memoryCounts.careerSurfaces,
        ready: atsSeedReady,
      },
      sheetsCredential: {
        configured: sheetsCredentialReadiness.configured,
        ready:
          sheetsCredentialReadiness.configured || localInteractiveSheetsReady,
        source: sheetsCredentialReadiness.source,
        requestScopedAuthSupported: runtimeConfig.runMode === "local",
        ...(localInteractiveSheetsReady
          ? {
              mode: "request_scoped",
              detail:
                "Local interactive runs can authenticate at request time with googleAccessToken from the dashboard.",
            }
          : {}),
        ...(!sheetsCredentialReadiness.configured &&
        sheetsCredentialReadiness.message
          ? { message: sheetsCredentialReadiness.message }
          : {}),
        ...(!sheetsCredentialReadiness.configured &&
        sheetsCredentialReadiness.detail
          ? { detail: sheetsCredentialReadiness.detail }
          : {}),
        ...(!sheetsCredentialReadiness.configured &&
        sheetsCredentialReadiness.remediation
          ? { remediation: sheetsCredentialReadiness.remediation }
          : {}),
      },
      browserRuntime: {
        configured: browserRuntimeReadiness.configured,
        available: browserRuntimeReadiness.available,
        ...(browserRuntimeReadiness.message
          ? { message: browserRuntimeReadiness.message }
          : {}),
        ...(browserRuntimeReadiness.detail
          ? { detail: browserRuntimeReadiness.detail }
          : {}),
        ...(browserRuntimeReadiness.remediation
          ? { remediation: browserRuntimeReadiness.remediation }
          : {}),
      },
      groundedWeb: {
        enabled: groundedWebEnabled,
        ready: !groundedWebEnabled || !!groundedSearchClient,
        ...(groundedWebEnabled && !groundedSearchClient
          ? {
              cause: runtimeConfig.geminiApiKey
                ? "Grounded search client unavailable despite API key configured."
                : "GEMINI_API_KEY not configured.",
              remediation: runtimeConfig.geminiApiKey
                ? "Check that the Gemini API key is valid and the service is accessible."
                : "Set BROWSER_USE_DISCOVERY_GEMINI_API_KEY to a valid API key.",
            }
          : {}),
      },
      warnings: [...blockingWarnings, ...advisoryWarnings],
      ...(blockingWarnings.length ? { blockingWarnings } : {}),
      ...(advisoryWarnings.length ? { advisoryWarnings } : {}),
    },
  };
}

function hasStoredModifierIntent(
  storedConfig: {
    targetRoles?: unknown;
    includeKeywords?: unknown;
    locations?: unknown;
    remotePolicy?: unknown;
    seniority?: unknown;
  } | null,
): boolean {
  if (!storedConfig) return false;
  return (
    hasNonBlankStringValue(storedConfig.targetRoles) ||
    hasNonBlankStringValue(storedConfig.includeKeywords) ||
    hasNonBlankStringValue(storedConfig.locations) ||
    Boolean(String(storedConfig.remotePolicy || "").trim()) ||
    Boolean(String(storedConfig.seniority || "").trim())
  );
}

function hasNonBlankStringValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonBlankStringValue(entry));
  }
  return Boolean(String(value || "").trim());
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const origin = getHeaderValue(request.headers.origin);
  const corsHeaders = buildCorsHeaders(runtimeConfig.allowedOrigins, origin);
  const requestPath = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const method = (request.method || "GET").toUpperCase();

  logEvent("http.request.received", {
    requestId,
    method,
    path: requestPath,
    origin: origin || undefined,
  });

  const finishJson = (
    status: number,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): void => {
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status,
      durationMs: Date.now() - startedAt,
    });
    sendJson(response, status, body, extraHeaders);
  };

  if (origin && !isOriginAllowed(runtimeConfig.allowedOrigins, origin)) {
    finishJson(
      403,
      {
        ok: false,
        message: "Origin not allowed for browser access.",
      },
      corsHeaders,
    );
    return;
  }

  if (method === "OPTIONS") {
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status: 204,
      durationMs: Date.now() - startedAt,
    });
    response.statusCode = 204;
    setHeaders(response, corsHeaders);
    response.end();
    return;
  }

  if (requestPath === "/health") {
    finishJson(200, await buildHealthPayload(), corsHeaders);
    return;
  }

  if (requestPath.startsWith("/runs/")) {
    if (method !== "GET") {
      finishJson(
        405,
        {
          ok: false,
          message: "Method not allowed",
        },
        {
          ...corsHeaders,
          allow: "GET,OPTIONS",
        },
      );
      return;
    }

    const runId = decodeURIComponent(requestPath.slice("/runs/".length));
    const payload = runStatusStore.get(runId);
    if (!payload) {
      finishJson(
        404,
        {
          ok: false,
          message: "Run not found",
        },
        corsHeaders,
      );
      return;
    }

    finishJson(
      200,
      {
        ok: true,
        ...payload,
      },
      corsHeaders,
    );
    return;
  }

  if (!["/", "/webhook", "/discovery", "/discovery-profile"].includes(requestPath)) {
    finishJson(
      404,
      {
        ok: false,
        message: "Not found",
      },
      corsHeaders,
    );
    return;
  }

  if (method !== "POST") {
    finishJson(
      405,
      {
        ok: false,
        message: "Method not allowed",
      },
      {
        ...corsHeaders,
        allow: "POST,OPTIONS",
      },
    );
    return;
  }

  // Feature B / Layer 5 — profile-driven company discovery endpoint. Uses the
  // same x-discovery-secret auth as the main webhook; never persists raw
  // resume text; optionally writes the inferred companies to worker-config.
  if (requestPath === "/discovery-profile") {
    // Pre-body auth gate: reject missing/invalid secrets BEFORE buffering the
    // request body. Without this, an unauthenticated client can force the
    // worker to buffer arbitrary-size payloads (100MB+) and then only get 401
    // back — a trivial memory/CPU DoS. Body-size cap in readBody is the
    // second layer of defense for authenticated-but-hostile clients.
    const preAuthHeaders = Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value : (value ?? undefined),
      ]),
    );
    const preAuth = hasValidWebhookSecret(
      runtimeConfig.webhookSecret,
      preAuthHeaders,
    );
    if (!preAuth.valid) {
      logEvent("http.request.unauthorized", {
        requestId,
        method,
        path: requestPath,
        category: preAuth.category,
      });
      finishJson(
        401,
        { ok: false, message: preAuth.detail || "Unauthorized" },
        corsHeaders,
      );
      return;
    }
    try {
      const bodyText = await readBody(request);
      logEvent("http.request.body", {
        requestId,
        method,
        path: requestPath,
        bytes: Buffer.byteLength(bodyText, "utf8"),
        contentType:
          getHeaderValue(request.headers["content-type"]) || undefined,
      });
      const result = await handleDiscoveryProfileWebhook(
        {
          method,
          headers: Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value : (value ?? undefined),
            ]),
          ),
          bodyText,
        },
        {
          runtimeConfig,
          upsertStoredWorkerConfig,
          loadStoredWorkerConfig: (sheetId: string) =>
            loadStoredWorkerConfig(runtimeConfig, sheetId),
          log: (event, details) =>
            logEvent(event, {
              requestId,
              method,
              path: requestPath,
              ...details,
            }),
        },
      );
      logEvent("http.request.completed", {
        requestId,
        method,
        path: requestPath,
        status: result.status,
        durationMs: Date.now() - startedAt,
      });
      response.statusCode = result.status;
      setHeaders(response, {
        ...corsHeaders,
        ...result.headers,
      });
      response.end(result.body);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        logEvent("http.request.rejected", {
          requestId,
          method,
          path: requestPath,
          reason: "body_too_large",
          limit: MAX_BODY_BYTES,
        });
        finishJson(
          413,
          { ok: false, message: "Request body exceeds the configured limit." },
          corsHeaders,
        );
        return;
      }
      logEvent("http.request.failed", {
        requestId,
        method,
        path: requestPath,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      finishJson(
        500,
        {
          ok: false,
          message: "Internal error handling discovery-profile request.",
          detail: error instanceof Error ? error.message : String(error),
        },
        corsHeaders,
      );
    }
    return;
  }

  try {
    const bodyText = await readBody(request);
    logEvent("http.request.body", {
      requestId,
      method,
      path: requestPath,
      bytes: Buffer.byteLength(bodyText, "utf8"),
      contentType: getHeaderValue(request.headers["content-type"]) || undefined,
    });
    const result = await handleDiscoveryWebhook(
      {
        method,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value : (value ?? undefined),
          ]),
        ),
        bodyText,
      },
      {
        runSynchronously: !runtimeConfig.asyncAckByDefault,
        runStatusPathForRun: buildRunStatusPath,
        runStatusStore,
        runDiscovery,
        runDependencies: sharedRunDependencies,
        createPipelineWriterForRequest,
        log: (event, details) =>
          logEvent(event, {
            requestId,
            method,
            path: requestPath,
            ...details,
          }),
        // Default max duration for async runs is 5 minutes
        // This guarantees terminalization even if the run stalls
        maxRunDurationMs: 5 * 60 * 1000,
      },
    );
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status: result.status,
      durationMs: Date.now() - startedAt,
    });
    response.statusCode = result.status;
    setHeaders(response, {
      ...corsHeaders,
      ...result.headers,
    });
    response.end(result.body);
  } catch (error) {
    logEvent("http.request.failed", {
      requestId,
      method,
      path: requestPath,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    finishJson(
      500,
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      corsHeaders,
    );
  }
});

server.listen(runtimeConfig.port, runtimeConfig.host, () => {
  const host =
    runtimeConfig.host === "0.0.0.0" ? "127.0.0.1" : runtimeConfig.host;
  console.log(
    `[browser-use-discovery] listening on http://${host}:${runtimeConfig.port}`,
  );
});
