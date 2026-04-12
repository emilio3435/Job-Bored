import type {
  BrowserUseExtractionResult,
  DiscoveryLifecycleState,
  DiscoveryRejectionSample,
  DiscoveryRejectionSummary,
  DiscoveryRunLifecycle,
  DiscoverySourceSummary,
  DiscoveryRun,
  DiscoveryWebhookRequestV1,
  NormalizedLead,
  PipelineWriteResult,
  RawListing,
  StoredWorkerConfig,
} from "../contracts.ts";
import type { ResolvedRunSettings, WorkerRuntimeConfig } from "../config.ts";
import type { BrowserUseSessionManager } from "../browser/session.ts";
import type { SourceAdapterRegistry } from "../browser/source-adapters.ts";
import { buildBoardContext } from "../browser/source-adapters.ts";
import {
  collectGroundedWebListings,
  type GroundedSearchClient,
} from "../grounding/grounded-search.ts";
import {
  normalizeLeadWithDiagnostics,
  type LeadNormalizationRejection,
} from "../normalize/lead-normalizer.ts";
import {
  scoreListingMatch,
  shouldUseAiMatcher,
  type DiscoveryMatchClient,
  type MatchDecision,
} from "../match/job-matcher.ts";
import type { PipelineWriter } from "../sheets/pipeline-writer.ts";

export type RunDiscoveryDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  sourceAdapterRegistry: SourceAdapterRegistry;
  browserSessionManager?: BrowserUseSessionManager;
  groundedSearchClient?: GroundedSearchClient | null;
  matchClient?: DiscoveryMatchClient | null;
  pipelineWriter: PipelineWriter;
  log?(event: string, details: Record<string, unknown>): void;
  runId?: string;
  loadStoredWorkerConfig(sheetId: string): Promise<StoredWorkerConfig>;
  mergeDiscoveryConfig(
    storedConfig: StoredWorkerConfig,
    request: DiscoveryWebhookRequestV1,
  ): ResolvedRunSettings;
  now(): Date;
  randomId(prefix: string): string;
};

export type RunDiscoveryResult = {
  run: DiscoveryRun;
  lifecycle: DiscoveryRunLifecycle;
  extractionResults: BrowserUseExtractionResult[];
  sourceSummary: DiscoverySourceSummary[];
  writeResult: PipelineWriteResult;
  warnings: string[];
};

type RejectionSummary = DiscoveryRejectionSummary;

export async function runDiscovery(
  request: DiscoveryWebhookRequestV1,
  trigger: "manual" | "scheduled",
  dependencies: RunDiscoveryDependencies,
): Promise<RunDiscoveryResult> {
  const startedAt = dependencies.now().toISOString();
  const storedConfig = await dependencies.loadStoredWorkerConfig(request.sheetId);
  const config = dependencies.mergeDiscoveryConfig(storedConfig, request);
  const runId = dependencies.runId || dependencies.randomId("run");
  const run: DiscoveryRun = {
    runId,
    trigger,
    request,
    config,
  };
  dependencies.log?.("discovery.run.config_resolved", {
    runId,
    trigger,
    requestedSheetId: request.sheetId,
    storedSheetId: storedConfig.sheetId,
    resolvedSheetId: config.sheetId,
    variationKey: request.variationKey,
    companies: config.companies.map((company) => company.name),
    enabledSources: config.enabledSources,
    sourcePreset: config.sourcePreset,
    effectiveSources: config.effectiveSources,
    maxLeadsPerRun: config.maxLeadsPerRun,
  });

  const warnings: string[] = [];
  if (!config.companies.length) {
    warnings.push("No companies are configured for this discovery run.");
  }

  const adapterMap = new Map(
    dependencies.sourceAdapterRegistry.adapters.map((adapter) => [
      adapter.sourceId,
      adapter,
    ]),
  );
  const extractionResultsBySource = new Map<string, BrowserUseExtractionResult>();
  const rejectionSummaryBySource = new Map<string, RejectionSummary>();
  const normalizedLeads: NormalizedLead[] = [];
  let detectionCount = 0;
  let listingCount = 0;
  const matchingState = {
    aiMatchCallsUsed: 0,
  };

  for (const company of config.companies) {
    try {
      const detections = await dependencies.sourceAdapterRegistry.detectBoards(
        { company, run },
        config.effectiveSources,
      );
      detectionCount += detections.length;

      for (const detection of detections) {
        const adapter = adapterMap.get(detection.sourceId);
        if (!adapter) {
          warnings.push(`No adapter registered for source ${detection.sourceId}.`);
          continue;
        }

        const boardContext = buildBoardContext({ company, run }, detection);
        const extractionResult =
          extractionResultsBySource.get(detection.sourceId) ||
          createExtractionResult(runId, detection.sourceId, boardContext.boardUrl);

        try {
          const rawListings = await adapter.listJobs(boardContext);
          listingCount += rawListings.length;
          extractionResult.querySummary = uniqueJoin([
            extractionResult.querySummary,
            boardContext.boardUrl,
          ]);
          extractionResult.stats.pagesVisited += 1;
          extractionResult.stats.leadsSeen += rawListings.length;

          for (const rawListing of rawListings) {
            const normalized = await normalizeRawListing(rawListing, run, {
              dependencies,
              matchingState,
            });
            if (normalized.matchUsedAi) {
              matchingState.aiMatchCallsUsed += 1;
            }
            if (!normalized.lead) {
              if (normalized.rejection) {
                recordRejection(
                  rejectionSummaryBySource,
                  detection.sourceId,
                  rawListing,
                  normalized.rejection,
                );
              }
              continue;
            }
            normalizedLeads.push(normalized.lead);
            extractionResult.leads.push(normalized.lead);
            extractionResult.stats.leadsAccepted += 1;
          }
        } catch (error) {
          const message = `Listing collection failed for ${detection.sourceId}: ${formatError(error)}`;
          extractionResult.warnings.push(message);
          warnings.push(message);
        }

        extractionResultsBySource.set(detection.sourceId, extractionResult);
      }
    } catch (error) {
      warnings.push(
        `Company detection failed for ${company.name}: ${formatError(error)}`,
      );
    }
  }

  if (config.effectiveSources.includes("grounded_web")) {
    const groundedResult = await runGroundedWebDiscovery(
      run,
      dependencies,
      rejectionSummaryBySource,
      matchingState,
    );
    listingCount += groundedResult.listingCount;
    if (groundedResult.extractionResult) {
      extractionResultsBySource.set(
        groundedResult.extractionResult.sourceId,
        groundedResult.extractionResult,
      );
    }
    normalizedLeads.push(...groundedResult.normalizedLeads);
  }

  // Add skip evidence for sources excluded by the preset (VAL-ROUTE-006)
  const excludedSources = config.enabledSources.filter(
    (sourceId) => !config.effectiveSources.includes(sourceId),
  );
  for (const excludedSourceId of excludedSources) {
    if (!extractionResultsBySource.has(excludedSourceId)) {
      const skipResult = createExtractionResult(runId, excludedSourceId, "");
      skipResult.warnings.push(
        `Source ${excludedSourceId} was excluded by preset '${config.sourcePreset}' and did not execute.`,
      );
      extractionResultsBySource.set(excludedSourceId, skipResult);
    }
  }

  const dedupedLeads = dedupeNormalizedLeads(normalizedLeads);
  let leadsToWrite = selectLeadsForWrite(dedupedLeads, config);
  if (config.maxLeadsPerRun > 0 && dedupedLeads.length > config.maxLeadsPerRun) {
    warnings.push(`Truncated leads to maxLeadsPerRun=${config.maxLeadsPerRun}.`);
  }
  dependencies.log?.("discovery.run.write_started", {
    runId,
    sheetId: config.sheetId,
    normalizedLeadCount: normalizedLeads.length,
    dedupedLeadCount: dedupedLeads.length,
    leadsToWriteCount: leadsToWrite.length,
  });

  const writeResult =
    leadsToWrite.length > 0
      ? await dependencies.pipelineWriter.write(config.sheetId, leadsToWrite)
      : {
          sheetId: config.sheetId,
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        };
  dependencies.log?.("discovery.run.write_completed", {
    runId,
    sheetId: config.sheetId,
    appended: writeResult.appended,
    updated: writeResult.updated,
    skippedDuplicates: writeResult.skippedDuplicates,
    warningCount: writeResult.warnings.length,
    sourceSummary: buildSourceSummary(
      extractionResultsBySource,
      rejectionSummaryBySource,
    ).map((entry) => ({
      sourceId: entry.sourceId,
      pagesVisited: entry.pagesVisited,
      leadsSeen: entry.leadsSeen,
      leadsAccepted: entry.leadsAccepted,
      leadsRejected: entry.leadsRejected,
      warningCount: entry.warnings.length,
      ...(entry.warnings.length ? { warnings: entry.warnings } : {}),
      ...(entry.rejectionSummary ? { rejectionSummary: entry.rejectionSummary } : {}),
    })),
  });

  warnings.push(...writeResult.warnings);
  for (const extractionResult of extractionResultsBySource.values()) {
    warnings.push(...extractionResult.warnings);
  }

  const completedAt = dependencies.now().toISOString();
  const sourceSummary = buildSourceSummary(
    extractionResultsBySource,
    rejectionSummaryBySource,
  );
  const lifecycleState = determineLifecycleState(leadsToWrite.length, warnings);

  return {
    run,
    lifecycle: {
      runId,
      trigger,
      startedAt,
      completedAt,
      state: lifecycleState,
      companyCount: config.companies.length,
      detectionCount,
      listingCount,
      normalizedLeadCount: leadsToWrite.length,
    },
    extractionResults: [...extractionResultsBySource.values()],
    sourceSummary,
    writeResult,
    warnings,
  };
}

function createExtractionResult(
  runId: string,
  sourceId: string,
  querySummary: string,
): BrowserUseExtractionResult {
  return {
    runId,
    sourceId,
    querySummary,
    leads: [],
    warnings: [],
    stats: {
      pagesVisited: 0,
      leadsSeen: 0,
      leadsAccepted: 0,
    },
  };
}

function normalizeRawListing(
  rawListing: RawListing,
  run: DiscoveryRun,
  input: {
    dependencies: RunDiscoveryDependencies;
    matchingState: {
      aiMatchCallsUsed: number;
    };
  },
): Promise<
  ReturnType<typeof normalizeLeadWithDiagnostics> & {
    matchUsedAi: boolean;
  }
> {
  const baseline = scoreListingMatch(rawListing, run);
  const canUseAi =
    !!input.dependencies.matchClient &&
    shouldUseAiMatcher(baseline, run, input.matchingState.aiMatchCallsUsed);

  if (!canUseAi) {
    return Promise.resolve(finalizeMatchDecision(rawListing, run, baseline, false));
  }

  return input.dependencies.matchClient!
    .evaluate({
      rawListing,
      run,
      baseline,
    })
    .then((decision) =>
      finalizeMatchDecision(rawListing, run, decision || baseline, true),
    )
    .catch(() => finalizeMatchDecision(rawListing, run, baseline, false));
}

function recordRejection(
  summaries: Map<string, RejectionSummary>,
  sourceId: string,
  rawListing: RawListing,
  rejection: LeadNormalizationRejection,
): void {
  const entry = summaries.get(sourceId) || {
    totalRejected: 0,
    rejectionReasons: {},
    rejectionSamples: [],
  };
  entry.totalRejected += 1;
  entry.rejectionReasons[rejection.reason] =
    (entry.rejectionReasons[rejection.reason] || 0) + 1;
  if (entry.rejectionSamples.length < 5) {
    entry.rejectionSamples.push({
      reason: rejection.reason,
      title: String(rawListing.title || "").trim(),
      company: String(rawListing.company || "").trim(),
      url: String(rawListing.url || "").trim(),
      detail: rejection.detail,
    });
  }
  summaries.set(sourceId, entry);
}

function finalizeMatchDecision(
  rawListing: RawListing,
  run: DiscoveryRun,
  decision: MatchDecision,
  matchUsedAi: boolean,
): ReturnType<typeof normalizeLeadWithDiagnostics> & { matchUsedAi: boolean } {
  if (decision.decision !== "accept") {
    return {
      lead: null,
      rejection: matchDecisionToRejection(decision, rawListing, run),
      matchUsedAi,
    };
  }

  const normalized = normalizeLeadWithDiagnostics(rawListing, run, {
    enforceRelevanceFilters: false,
  });
  if (!normalized.lead) {
    return {
      ...normalized,
      rejection:
        normalized.rejection ||
        {
          reason: "missing_required_fields",
          detail: "Accepted listing could not be normalized.",
        },
      matchUsedAi,
    };
  }

  return {
    ...normalized,
    matchUsedAi,
  };
}

function matchDecisionToRejection(
  decision: MatchDecision,
  rawListing: RawListing,
  run: DiscoveryRun,
): LeadNormalizationRejection {
  if (decision.hardRejectReason) {
    return {
      reason: "excluded_keyword",
      detail: `${decision.hardRejectReason} [matcher=${decision.modelVersion}]`,
    };
  }

  const strongestComponent = findStrongestFailedComponent(decision);
  const reasons = decision.reasons.join(" | ");
  const suffix = `score=${decision.overallScore.toFixed(2)} confidence=${decision.confidence.toFixed(2)} matcher=${decision.modelVersion}`;

  if (strongestComponent === "location") {
    return {
      reason: "location_mismatch",
      detail:
        `Location "${String(rawListing.location || "<empty>").trim() || "<empty>"}" did not align with configured locations [${run.config.locations.join(", ")}]. ${reasons} ${suffix}`.trim(),
    };
  }
  if (strongestComponent === "remote") {
    return {
      reason: "remote_policy_mismatch",
      detail:
        `Remote policy "${run.config.remotePolicy || "<any>"}" did not align with location "${String(rawListing.location || "<empty>").trim() || "<empty>"}". ${reasons} ${suffix}`.trim(),
    };
  }
  if (strongestComponent === "negative") {
    return {
      reason: "excluded_keyword",
      detail: `${reasons} ${suffix}`.trim(),
    };
  }

  return {
    reason: "headline_mismatch",
    detail:
      `Structured match rejected the role title "${String(rawListing.title || "").trim()}". ${reasons} ${suffix}`.trim(),
  };
}

function findStrongestFailedComponent(
  decision: MatchDecision,
): "role" | "location" | "remote" | "negative" {
  const entries = [
    ["role", decision.componentScores.role],
    ["location", decision.componentScores.location],
    ["remote", decision.componentScores.remote],
    ["negative", decision.componentScores.negative],
  ] as const;
  return [...entries].sort((left, right) => left[1] - right[1])[0][0];
}

async function runGroundedWebDiscovery(
  run: DiscoveryRun,
  dependencies: RunDiscoveryDependencies,
  rejectionSummaryBySource: Map<string, RejectionSummary>,
  matchingState: {
    aiMatchCallsUsed: number;
  },
): Promise<{
  extractionResult: BrowserUseExtractionResult | null;
  normalizedLeads: NormalizedLead[];
  listingCount: number;
}> {
  const extractionResult = createExtractionResult(
    run.runId,
    "grounded_web",
    "",
  );
  const warnings: string[] = [];
  const normalizedLeads: NormalizedLead[] = [];
  let listingCount = 0;

  if (!dependencies.groundedSearchClient) {
    const message = dependencies.runtimeConfig.geminiApiKey
      ? "Grounded web source is enabled but the grounded search client is unavailable."
      : "Grounded web source is enabled but BROWSER_USE_DISCOVERY_GEMINI_API_KEY is not configured.";
    extractionResult.warnings.push(message);
    warnings.push(message);
    return {
      extractionResult,
      normalizedLeads,
      listingCount,
    };
  }

  if (!dependencies.browserSessionManager) {
    const message =
      "Grounded web source is enabled but the Browser Use session manager is unavailable.";
    extractionResult.warnings.push(message);
    warnings.push(message);
    return {
      extractionResult,
      normalizedLeads,
      listingCount,
    };
  }

  for (const company of run.config.companies) {
    try {
      const result = await collectGroundedWebListings({
        company,
        run,
        runtimeConfig: dependencies.runtimeConfig,
        groundedSearchClient: dependencies.groundedSearchClient,
        sessionManager: dependencies.browserSessionManager,
      });
      listingCount += result.rawListings.length;
      extractionResult.querySummary = uniqueJoin([
        extractionResult.querySummary,
        ...result.searchQueries,
        ...result.seedUrls,
      ]);
      extractionResult.stats.pagesVisited += result.pagesVisited;
      extractionResult.stats.leadsSeen += result.rawListings.length;
      extractionResult.warnings.push(...result.warnings);

      for (const rawListing of result.rawListings) {
        const normalized = await normalizeRawListing(rawListing, run, {
          dependencies,
          matchingState,
        });
        if (normalized.matchUsedAi) {
          matchingState.aiMatchCallsUsed += 1;
        }
        if (!normalized.lead) {
          if (normalized.rejection) {
            recordRejection(
              rejectionSummaryBySource,
              "grounded_web",
              rawListing,
              normalized.rejection,
            );
          }
          continue;
        }
        normalizedLeads.push(normalized.lead);
        extractionResult.leads.push(normalized.lead);
        extractionResult.stats.leadsAccepted += 1;
      }
    } catch (error) {
      const message = `Grounded discovery failed for ${company.name}: ${formatError(error)}`;
      extractionResult.warnings.push(message);
      warnings.push(message);
    }
  }

  return {
    extractionResult,
    normalizedLeads,
    listingCount,
  };
}

function dedupeNormalizedLeads(leads: NormalizedLead[]): NormalizedLead[] {
  const byUrl = new Map<string, NormalizedLead>();
  for (const lead of leads) {
    if (!lead.url) continue;
    const existing = byUrl.get(lead.url);
    if (!existing || (lead.fitScore || 0) > (existing.fitScore || 0)) {
      byUrl.set(lead.url, lead);
    }
  }
  return [...byUrl.values()];
}

function buildSourceSummary(
  extractionResultsBySource: Map<string, BrowserUseExtractionResult>,
  rejectionSummaryBySource: Map<string, RejectionSummary>,
): DiscoverySourceSummary[] {
  return [...extractionResultsBySource.values()].map((entry) => {
    const rejectionSummary = rejectionSummaryBySource.get(entry.sourceId);
    return {
      sourceId: entry.sourceId,
      querySummary: entry.querySummary,
      pagesVisited: entry.stats.pagesVisited,
      leadsSeen: entry.stats.leadsSeen,
      leadsAccepted: entry.stats.leadsAccepted,
      leadsRejected: rejectionSummary?.totalRejected || 0,
      warnings: [...entry.warnings],
      ...(rejectionSummary
        ? {
            rejectionSummary: {
              totalRejected: rejectionSummary.totalRejected,
              rejectionReasons: { ...rejectionSummary.rejectionReasons },
              rejectionSamples: rejectionSummary.rejectionSamples.map((sample) => ({
                ...sample,
              })),
            },
          }
        : {}),
    };
  });
}

function determineLifecycleState(
  normalizedLeadCount: number,
  warnings: string[],
): DiscoveryLifecycleState {
  if (warnings.length > 0) return "partial";
  if (normalizedLeadCount === 0) return "empty";
  return "completed";
}

function selectLeadsForWrite(
  leads: NormalizedLead[],
  config: ResolvedRunSettings,
): NormalizedLead[] {
  const ranked = [...leads].sort(compareNormalizedLeads);
  if (config.maxLeadsPerRun <= 0 || ranked.length <= config.maxLeadsPerRun) {
    return ranked;
  }
  const strictLimits = buildSelectionLimits(ranked, config.maxLeadsPerRun, 1);
  const selected = selectRankedLeads(
    ranked,
    config.maxLeadsPerRun,
    strictLimits,
  );
  if (selected.length >= config.maxLeadsPerRun) {
    return selected;
  }

  return selectRankedLeads(
    ranked,
    config.maxLeadsPerRun,
    buildSelectionLimits(ranked, config.maxLeadsPerRun, 2),
    selected,
  );
}

type LeadSelectionLimits = {
  maxLeads: number;
  maxPerCompany: number;
  maxPerSource: number;
  maxSimilarTitlesPerCompany: number;
};

const COMPANY_CONCENTRATION_RATIO = 0.25;
const COMPANY_CONCENTRATION_HARD_CAP = 5;
const SOURCE_CONCENTRATION_RATIO = 0.5;
const SOURCE_CONCENTRATION_HARD_CAP = 10;
const TITLE_SIMILARITY_THRESHOLD = 0.6;
const TITLE_SIMILARITY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "apac",
  "emea",
  "for",
  "global",
  "in",
  "of",
  "the",
  "to",
]);
const TITLE_SENIORITY_TOKENS = new Set([
  "associate",
  "intern",
  "jr",
  "junior",
  "lead",
  "principal",
  "senior",
  "sr",
  "staff",
  "ii",
  "iii",
  "iv",
]);

function buildSelectionLimits(
  ranked: NormalizedLead[],
  maxLeads: number,
  maxSimilarTitlesPerCompany: number,
): LeadSelectionLimits {
  const companyCount = new Set(
    ranked.map((lead) => normalizeCompanyKey(lead.company)).filter(Boolean),
  ).size;
  const sourceCount = new Set(
    ranked.map((lead) => String(lead.sourceId || "").trim()).filter(Boolean),
  ).size;

  return {
    maxLeads,
    maxPerCompany:
      companyCount <= 1
        ? maxLeads
        : Math.max(
            1,
            Math.min(
              COMPANY_CONCENTRATION_HARD_CAP,
              Math.ceil(maxLeads * COMPANY_CONCENTRATION_RATIO),
            ),
          ),
    maxPerSource:
      sourceCount <= 1
        ? maxLeads
        : Math.max(
            1,
            Math.min(
              SOURCE_CONCENTRATION_HARD_CAP,
              Math.ceil(maxLeads * SOURCE_CONCENTRATION_RATIO),
            ),
          ),
    maxSimilarTitlesPerCompany,
  };
}

function selectRankedLeads(
  ranked: NormalizedLead[],
  maxLeads: number,
  limits: LeadSelectionLimits,
  initialSelected: NormalizedLead[] = [],
): NormalizedLead[] {
  const selected = [...initialSelected];
  const selectedUrls = new Set(selected.map((lead) => lead.url));
  const countsByCompany = new Map<string, number>();
  const countsBySource = new Map<string, number>();
  const selectedByCompany = new Map<string, NormalizedLead[]>();

  for (const lead of selected) {
    const companyKey = normalizeCompanyKey(lead.company);
    const sourceKey = String(lead.sourceId || "").trim();
    countsByCompany.set(companyKey, (countsByCompany.get(companyKey) || 0) + 1);
    countsBySource.set(sourceKey, (countsBySource.get(sourceKey) || 0) + 1);
    const existing = selectedByCompany.get(companyKey) || [];
    existing.push(lead);
    selectedByCompany.set(companyKey, existing);
  }

  for (const lead of ranked) {
    if (selected.length >= maxLeads) break;
    if (!lead.url || selectedUrls.has(lead.url)) continue;

    const companyKey = normalizeCompanyKey(lead.company);
    const sourceKey = String(lead.sourceId || "").trim();
    const companyCount = countsByCompany.get(companyKey) || 0;
    if (companyCount >= limits.maxPerCompany) continue;

    const sourceCount = countsBySource.get(sourceKey) || 0;
    if (sourceCount >= limits.maxPerSource) continue;

    const selectedForCompany = selectedByCompany.get(companyKey) || [];
    const similarTitleCount = selectedForCompany.filter((candidate) =>
      titlesAreSimilar(candidate.title, lead.title),
    ).length;
    if (similarTitleCount >= limits.maxSimilarTitlesPerCompany) continue;

    selected.push(lead);
    selectedUrls.add(lead.url);
    countsByCompany.set(companyKey, companyCount + 1);
    countsBySource.set(sourceKey, sourceCount + 1);
    selectedForCompany.push(lead);
    selectedByCompany.set(companyKey, selectedForCompany);
  }

  return selected;
}

function titlesAreSimilar(leftTitle: string, rightTitle: string): boolean {
  const leftTokens = tokenizeTitleForSimilarity(leftTitle);
  const rightTokens = tokenizeTitleForSimilarity(rightTitle);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;

  const leftKey = leftTokens.join(" ");
  const rightKey = rightTokens.join(" ");
  if (leftKey === rightKey) return true;
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let shared = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) shared += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  if (union === 0) return false;
  return shared / union >= TITLE_SIMILARITY_THRESHOLD;
}

function tokenizeTitleForSimilarity(title: string): string[] {
  return String(title || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token &&
        !TITLE_SIMILARITY_STOPWORDS.has(token) &&
        !TITLE_SENIORITY_TOKENS.has(token),
    );
}

function compareNormalizedLeads(
  left: NormalizedLead,
  right: NormalizedLead,
): number {
  const fitDelta = (right.fitScore ?? -1) - (left.fitScore ?? -1);
  if (fitDelta !== 0) return fitDelta;

  const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDelta !== 0) return priorityDelta;

  const tagDelta = (right.tags?.length || 0) - (left.tags?.length || 0);
  if (tagDelta !== 0) return tagDelta;

  const companyDelta = (left.company || "").localeCompare(right.company || "");
  if (companyDelta !== 0) return companyDelta;

  return (left.title || "").localeCompare(right.title || "");
}

function priorityRank(priority: NormalizedLead["priority"]): number {
  return { "🔥": 0, "⚡": 1, "—": 2, "↓": 3, "": 4 }[priority] ?? 4;
}

function normalizeCompanyKey(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function uniqueJoin(values: string[]): string {
  return [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ].join(" | ");
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
