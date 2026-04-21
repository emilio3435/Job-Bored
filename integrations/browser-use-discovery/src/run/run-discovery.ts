import type {
  AtsSourceId,
  BrowserUseExtractionResult,
  CareerSurfaceType,
  DiscoveryIntent,
  DiscoveryLifecycleState,
  DiscoveryMemorySnapshot,
  DiscoveryPhase,
  DiscoveryRejectionSample,
  DiscoveryRejectionSummary,
  DiscoveryRunLifecycle,
  DiscoverySourceLane,
  DiscoverySourceSummary,
  DiscoveryRun,
  DiscoveryWebhookRequestV1,
  DeadLinkRecord,
  ExtractionDiagnostic,
  LoopCounters,
  LoopFailureClass,
  LoopStageEvidence,
  NormalizedLead,
  PipelineWriteResult,
  RawListing,
  StoredWorkerConfig,
  SupportedSourceId,
} from "../contracts.ts";
import type { ResolvedRunSettings, WorkerRuntimeConfig } from "../config.ts";
import type { BrowserUseSessionManager } from "../browser/session.ts";
import type { DiscoveryMemoryStore } from "../contracts.ts";
import type { SourceAdapterRegistry } from "../browser/source-adapters.ts";
import { buildBoardContext } from "../browser/source-adapters.ts";
import {
  collectGroundedWebListings,
  describeGroundedSearchScope,
  type GroundedSearchClient,
} from "../grounding/grounded-search.ts";
import {
  collectSerpApiGoogleJobsListings,
  SERPAPI_GOOGLE_JOBS_SOURCE_ID,
} from "../sources/serpapi-google-jobs.ts";
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
import { SheetWriteError, type PipelineWriter } from "../sheets/pipeline-writer.ts";
import {
  createBudgetTracker,
  type BudgetTracker,
} from "./budget-tracker.ts";
import {
  companyToFrontierCandidate,
  leadToFrontierCandidate,
  selectExploitTargets,
  sortFrontierCandidates,
  isCandidateSelected,
  createExplorationBudgetTracker,
  DEFAULT_EXPLORATION_BUDGET,
  type ExplorationBudget,
  type ExploitTarget,
  type FrontierCandidate,
  type ExploitSelectionResult,
} from "./frontier-scorer.ts";

// Default maximum run duration: 5 minutes
const DEFAULT_MAX_RUN_DURATION_MS = 5 * 60 * 1000;
// Default per-source (adapter) timeout: 60 seconds
const DEFAULT_SOURCE_TIMEOUT_MS = 60 * 1000;
// Default per-matcher timeout: 30 seconds
const DEFAULT_MATCHER_TIMEOUT_MS = 30 * 1000;

export type RunDiscoveryDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  sourceAdapterRegistry: SourceAdapterRegistry;
  browserSessionManager?: BrowserUseSessionManager;
  groundedSearchClient?: GroundedSearchClient | null;
  matchClient?: DiscoveryMatchClient | null;
  pipelineWriter: PipelineWriter;
  discoveryMemoryStore?: DiscoveryMemoryStore | null;
  log?(event: string, details: Record<string, unknown>): void;
  runId?: string;
  loadStoredWorkerConfig(sheetId: string): Promise<StoredWorkerConfig>;
  mergeDiscoveryConfig(
    storedConfig: StoredWorkerConfig,
    request: DiscoveryWebhookRequestV1,
  ): ResolvedRunSettings;
  now(): Date;
  randomId(prefix: string): string;
  maxRunDurationMs?: number;
  sourceTimeoutMs?: number;
  matcherTimeoutMs?: number;
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

/**
 * Timeout error with attribution context for terminalization evidence.
 */
export class TimeoutError extends Error {
  readonly operation: string;
  readonly sourceId: string;
  readonly timeoutMs: number;

  constructor(operation: string, sourceId: string, timeoutMs: number) {
    super(`Timeout of ${timeoutMs}ms exceeded during ${operation} for ${sourceId}`);
    this.name = "TimeoutError";
    this.operation = operation;
    this.sourceId = sourceId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Wraps a promise with a timeout. If the timeout fires first, the returned
 * promise rejects with a TimeoutError that carries attribution context.
 */
function withTimeout<T>(
  operation: string,
  sourceId: string,
  timeoutMs: number,
  promise: Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(operation, sourceId, timeoutMs));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Returns true if the config has non-blank modifier intent fields that can
 * drive a grounded search in unrestricted scope (without company targets).
 * Used to determine whether a missing company list is actually problematic.
 */
function hasNonBlankModifierIntent(config: ResolvedRunSettings): boolean {
  return (
    (config.targetRoles || []).some((v) => v.trim()) ||
    (config.includeKeywords || []).some((v) => v.trim()) ||
    (config.locations || []).some((v) => v.trim()) ||
    Boolean(config.remotePolicy?.trim()) ||
    Boolean(config.seniority?.trim())
  );
}

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
    atsCompanies: (config.atsCompanies ?? []).map((company) => company.name),
    enabledSources: config.enabledSources,
    sourcePreset: config.sourcePreset,
    effectiveSources: config.effectiveSources,
    maxLeadsPerRun: config.maxLeadsPerRun,
  });

  const warnings: string[] = [];
  // VAL-API-010 / VAL-ROUTE-011: Only warn about missing companies when the run
  // cannot proceed without them. If grounded_web is in effectiveSources and we
  // have valid modifier intent (targetRoles, keywordsInclude, etc.), the run can
  // execute in unrestricted scope driven by modifiers alone - no misleading warning needed.
  if (!config.companies.length) {
    const hasModifierIntent = hasNonBlankModifierIntent(config);
    const canRunUnrestricted = config.effectiveSources.includes("grounded_web");
    if (!hasModifierIntent || !canRunUnrestricted) {
      warnings.push("No companies are configured for this discovery run.");
    }
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

  // Stage progress tracking for routing assertions evidence
  const stageProgress = {
    detectStarted: false,
    detectCompleted: false,
    listStarted: false,
    listCompleted: false,
    groundedStarted: false,
    groundedCompleted: false,
  };

  // VAL-LOOP-OBS-001 / VAL-LOOP-CORE-008: Stage sequence tracker for monotonic stageOrder emission
  let stageSequence = 0;
  function nextStage(phase: DiscoveryPhase): LoopStageEvidence {
    return { sequence: ++stageSequence, phase, startedAt: dependencies.now().toISOString() };
  }
  const stageOrder: LoopStageEvidence[] = [];

  // VAL-LOOP-OBS-001/002: Loop counters for terminal telemetry
  const loopCounters: LoopCounters = {
    atsScoutCount: 0,
    browserScoutCount: 0,
    scoredSurfaces: 0,
    selectedExploitTargets: 0,
    exploitSuppressions: 0,
    hintMetrics: 0,
    thirdPartyBlocks: 0,
    junkHostSuppressions: 0,
    duplicateSuppressions: 0,
    crossLaneDuplicates: 0,
  };

  // Use configured timeouts or defaults
  const sourceTimeoutMs = dependencies.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const matcherTimeoutMs = dependencies.matcherTimeoutMs ?? DEFAULT_MATCHER_TIMEOUT_MS;

  // VAL-ROUTE-008/009: When companies is empty but we have ATS lanes,
  // use an empty placeholder company to allow ATS detection to attempt
  // execution in unrestricted scope. This ensures ats_only and browser_plus_ats
  // presets execute ATS lanes even without configured company targets.
  const atsSourceIds = ["greenhouse", "lever", "ashby"] as const;
  const hasAtsLanes = config.effectiveSources.some((sid) =>
    atsSourceIds.includes(sid as (typeof atsSourceIds)[number]),
  );

  // VAL-LOOP-ATS-001/002: Load memory snapshot for ATS seed channels
  // Memory provides company registry and career surface records that can seed ATS detection
  // even when no companies are explicitly configured.
  let memorySnapshot: DiscoveryMemorySnapshot | null = null;
  if (hasAtsLanes && dependencies.discoveryMemoryStore) {
    const intentKey = `run:${runId}`;
    memorySnapshot = await Promise.resolve(
      dependencies.discoveryMemoryStore.loadSnapshot({ run, intentKey }),
    ).catch((error) => {
      dependencies.log?.("discovery.run.memory_load_failed", {
        runId,
        intentKey,
        error: formatError(error),
      });
      return null;
    }) || null;
  }

  // VAL-LOOP-ATS-002: Build ATS company list from configured + memory channels
  // Seed sufficiency is met when we have at least one company to search.
  // atsCompanies takes precedence over companies for ATS-specific seed channels.
  const configuredAtsCompanies = (config.atsCompanies ?? config.companies) || [];
  
  // Convert memory company registry records to CompanyTarget format for ATS detection
  const memoryAtsCompanies: CompanyTarget[] = [];
  if (memorySnapshot?.companies) {
    for (const companyRecord of memorySnapshot.companies) {
      // Only include companies that have ATS hints (boardHints)
      const atsHints: Partial<Record<AtsSourceId, string>> = {};
      try {
        const hints = JSON.parse(companyRecord.atsHintsJson || "{}");
        for (const [sourceId, hint] of Object.entries(hints)) {
          if (hint && typeof hint === "string") {
            atsHints[sourceId as AtsSourceId] = hint;
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
      
      // Only add if company has ATS hints
      if (Object.keys(atsHints).length > 0) {
        memoryAtsCompanies.push({
          name: companyRecord.displayName,
          companyKey: companyRecord.companyKey,
          normalizedName: companyRecord.normalizedName,
          aliases: JSON.parse(companyRecord.aliasesJson || "[]"),
          domains: JSON.parse(companyRecord.domainsJson || "[]"),
          geoTags: JSON.parse(companyRecord.geoTagsJson || "[]"),
          roleTags: JSON.parse(companyRecord.roleTagsJson || "[]"),
          boardHints: atsHints,
        });
      }
    }
  }

  // VAL-LOOP-ATS-002: Convert memory career surfaces to CompanyTarget format
  // Career surfaces provide direct ATS board URLs that can seed ATS detection
  if (memorySnapshot?.careerSurfaces) {
    for (const surface of memorySnapshot.careerSurfaces) {
      // Only include provider-type surfaces with valid ATS provider type
      if (surface.surfaceType !== "provider_board" || !surface.providerType) {
        continue;
      }
      
      // Build company name from companyKey (e.g., "career-surface-company" -> "Career Surface Company")
      const companyKey = surface.companyKey || "";
      const displayName = companyKey
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
      
      // Determine the board hint based on surface data
      const boardToken = surface.boardToken || surface.canonicalUrl || "";
      if (!boardToken) continue;
      
      memoryAtsCompanies.push({
        name: displayName || companyKey,
        companyKey,
        boardHints: {
          [surface.providerType as AtsSourceId]: boardToken,
        },
      });
    }
  }

  // VAL-LOOP-ATS-002/003: Determine seed sufficiency and build company list
  // Seed sufficiency is met when we have configured companies OR memory companies
  const hasConfiguredSeeds = configuredAtsCompanies.length > 0;
  const hasMemorySeeds = memoryAtsCompanies.length > 0;
  const hasSeedSufficiency = hasConfiguredSeeds || hasMemorySeeds;

  // Build the final ATS company list: configured first, then memory
  const atsCompaniesToSearch: CompanyTarget[] = [
    ...configuredAtsCompanies,
    ...memoryAtsCompanies,
  ];

  // VAL-LOOP-ATS-003: If seed sufficiency is NOT met (no configured, no memory),
  // use grounded search ATS host fallback to discover ATS boards
  // This is the "host search fallback" for ATS seeding
  let atsHostSearchCandidates: GroundedSearchCandidate[] = [];
  if (hasAtsLanes && !hasSeedSufficiency && dependencies.groundedSearchClient?.searchAtsHosts) {
    dependencies.log?.("discovery.run.ats_host_search_fallback_started", {
      runId,
      reason: "seed_sufficiency_not_met",
      configuredCompanies: configuredAtsCompanies.length,
      memoryCompanies: memoryAtsCompanies.length,
    });

    try {
      const atsHostSearchResult = await withTimeout(
        "ats_host_search",
        "ats_sources",
        sourceTimeoutMs,
        dependencies.groundedSearchClient.searchAtsHosts({
          run,
          sourceIds: config.effectiveSources.filter((sid): sid is AtsSourceId =>
            atsSourceIds.includes(sid as AtsSourceId),
          ),
          maxResults: 10,
        }),
      );
      atsHostSearchCandidates = atsHostSearchResult.candidates || [];
      
      dependencies.log?.("discovery.run.ats_host_search_fallback_completed", {
        runId,
        candidateCount: atsHostSearchCandidates.length,
        warnings: atsHostSearchResult.warnings?.length || 0,
      });

      // Build ATS companies from host search results
      for (const candidate of atsHostSearchCandidates) {
        const host = candidate.sourceDomain || new URL(candidate.url).hostname;
        // Determine ATS source ID from URL patterns
        let atsSourceId: AtsSourceId = "greenhouse";
        if (candidate.url.includes("boards.greenhouse.io") || candidate.url.includes("boards.eu.greenhouse.io")) {
          atsSourceId = "greenhouse";
        } else if (candidate.url.includes("jobs.lever.co")) {
          atsSourceId = "lever";
        } else if (candidate.url.includes("ashbyhq.com") || candidate.url.includes("ashby.io")) {
          atsSourceId = "ashby";
        }

        // Extract company name from "Role at Company" title pattern,
        // falling back to the host domain if no pattern matches.
        const atMatch = candidate.title?.match(/\bat\s+(.+)$/i);
        const companyName = atMatch?.[1]?.trim() || host;

        atsCompaniesToSearch.push({
          name: companyName,
          companyKey: host.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
          normalizedName: host.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
          aliases: [],
          domains: [host],
          geoTags: [],
          roleTags: [],
          boardHints: {
            [atsSourceId]: candidate.url,
          },
        });
      }
    } catch (error) {
      if (error instanceof TimeoutError) {
        const message = `ATS host search timed out after ${error.timeoutMs}ms: ${error.message}`;
        warnings.push(message);
        dependencies.log?.("discovery.run.ats_host_search_timeout", {
          runId,
          timeoutMs: error.timeoutMs,
        });
      } else {
        const message = `ATS host search failed: ${formatError(error)}`;
        warnings.push(message);
        dependencies.log?.("discovery.run.ats_host_search_failed", {
          runId,
          error: formatError(error),
        });
      }
    }
  }

  // Only iterate ATS detection when an ATS lane is actually active. Browser-only
  // runs (sourcePreset === "browser_only") exclude greenhouse/lever/ashby via
  // effectiveSources, so iterating here would waste a Browser Use call per company
  // and inflate loopCounters.atsScoutCount, which causes classifyFailureReason to
  // incorrectly tag zero-result browser_only runs as weak_ats_seed_quality.
  if (hasAtsLanes) {
  for (const company of atsCompaniesToSearch) {
    // VAL-LOOP-CORE-008: Emit scout stage start (first ATS company iteration)
    if (!stageProgress.detectStarted) {
      stageOrder.push(nextStage("scout"));
    }
    try {
      stageProgress.detectStarted = true;
      // VAL-LOOP-OBS-001: Increment ATS scout count for this company detection
      loopCounters.atsScoutCount += 1;
      const detections = await withTimeout(
        "board_detection",
        "ats_sources",
        sourceTimeoutMs,
        dependencies.sourceAdapterRegistry.detectBoards(
          { company, run },
          config.effectiveSources,
        ),
      ).catch((error) => {
        if (error instanceof TimeoutError) {
          const message = `Board detection timed out after ${error.timeoutMs}ms for ${company.name}: ${error.message}`;
          warnings.push(message);
          dependencies.log?.("discovery.run.detect_timeout", {
            runId,
            company: company.name,
            timeoutMs: error.timeoutMs,
          });
          return [];
        }
        throw error;
      });
      stageProgress.detectCompleted = true;
      detectionCount += detections.length;

      // Group detections by sourceId for efficient listing collection
      const detectionsBySource = new Map<string, typeof detections>();
      for (const detection of detections) {
        const existing = detectionsBySource.get(detection.sourceId);
        if (existing) {
          existing.push(detection);
        } else {
          detectionsBySource.set(detection.sourceId, [detection]);
        }
      }

      // Process each source's detections
      for (const [sourceId, sourceDetections] of detectionsBySource) {
        const adapter = adapterMap.get(sourceId);
        
        // Build board contexts for all detections from this source
        const boardContexts = sourceDetections.map((detection) =>
          buildBoardContext({ company, run }, detection)
        );
        
        const firstBoardUrl = boardContexts[0]?.boardUrl || `unknown:${sourceId}`;
        const extractionResult =
          extractionResultsBySource.get(sourceId) ||
          createExtractionResult(runId, sourceId, firstBoardUrl);

        try {
          stageProgress.listStarted = true;
          
          let rawListings: RawListing[] = [];
          
          if (adapter) {
            // Use adapter.listJobs for each board context (adapter-based implementation)
            const listingResults = await Promise.all(
              boardContexts.map((boardContext) =>
                withTimeout(
                  `listing_collection[${sourceId}]`,
                  sourceId,
                  sourceTimeoutMs,
                  adapter.listJobs(boardContext),
                ).catch((error) => {
                  if (error instanceof TimeoutError) {
                    return [];
                  }
                  throw error;
                }),
              ),
            );
            rawListings = listingResults.flat();
          } else if (dependencies.sourceAdapterRegistry.collectListings) {
            // Fall back to registry.collectListings (for test mocks and legacy support)
            rawListings = await withTimeout(
              `listing_collection[${sourceId}]`,
              sourceId,
              sourceTimeoutMs,
              dependencies.sourceAdapterRegistry.collectListings(run, sourceDetections),
            ).catch((error) => {
              if (error instanceof TimeoutError) {
                const message = `Listing collection timed out for ${sourceId} after ${error.timeoutMs}ms: ${error.message}`;
                extractionResult.warnings.push(message);
                warnings.push(message);
                dependencies.log?.("discovery.run.list_timeout", {
                  runId,
                  sourceId,
                  timeoutMs: error.timeoutMs,
                });
                return [];
              }
              throw error;
            });
          } else {
            warnings.push(`No adapter registered for source ${sourceId} and no collectListings fallback available.`);
          }

          stageProgress.listCompleted = true;
          listingCount += rawListings.length;
          extractionResult.querySummary = uniqueJoin(
            boardContexts.map((bc) => bc.boardUrl),
          );
          extractionResult.stats.pagesVisited += sourceDetections.length;
          extractionResult.stats.leadsSeen += rawListings.length;

          for (const rawListing of rawListings) {
            const normalized = await normalizeRawListing(rawListing, run, {
              dependencies,
              matchingState,
              matcherTimeoutMs,
            });
            if (normalized.matchUsedAi) {
              matchingState.aiMatchCallsUsed += 1;
            }
            if (!normalized.lead) {
              if (normalized.rejection) {
                recordRejection(
                  rejectionSummaryBySource,
                  sourceId,
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
          const message = `Listing collection failed for ${sourceId}: ${error}`;
          extractionResult.warnings.push(message);
          warnings.push(message);
        }

        extractionResultsBySource.set(sourceId, extractionResult);
      }
    } catch (error) {
      warnings.push(
        `Company detection failed for ${company.name}: ${formatError(error)}`,
      );
    }
  }
  }

  // VAL-ROUTE-008/009: For unrestricted scope (empty companies with ATS lanes),
  // ensure ATS sources that attempted execution appear in sourceSummary even when
  // no boards were found with the empty company placeholder. This provides evidence
  // that the ATS lane attempted execution rather than being skipped.
  if (
    config.companies.length === 0 &&
    config.effectiveSources.some((sid) =>
      atsSourceIds.includes(sid as (typeof atsSourceIds)[number]),
    )
  ) {
    for (const atsSourceId of atsSourceIds) {
      if (
        config.effectiveSources.includes(atsSourceId) &&
        !extractionResultsBySource.has(atsSourceId)
      ) {
        const emptyResult = createExtractionResult(runId, atsSourceId, "");
        emptyResult.warnings.push(
          `No boards detected for ${atsSourceId} in unrestricted scope (empty company target).`,
        );
        extractionResultsBySource.set(atsSourceId, emptyResult);
      }
    }
  }

  if (config.effectiveSources.includes("grounded_web")) {
    // Skip grounded_web dispatch when there is literally nothing to search for:
    // no seed companies AND no role/keyword/location/remote/seniority intent.
    // Without this guard the placeholder-company substitution at line 1620 still
    // triggers the source, which then spends up to the full grounded timeout on
    // empty queries. Matches the "excluded by preset" skip-with-evidence shape
    // at lines 607-617. reasonCode in classifyFailureReason will correctly land
    // on weak_surface_discovery (no scouts, no scoredSurfaces) for this case.
    if (
      config.companies.length === 0 &&
      !hasNonBlankModifierIntent(config)
    ) {
      const skipMessage =
        "grounded_web skipped: no companies and no role/keyword intent configured";
      warnings.push(skipMessage);
      dependencies.log?.("discovery.run.grounded_skipped_empty_intent", {
        runId,
      });
      const skipResult = createExtractionResult(runId, "grounded_web", "");
      skipResult.warnings.push(skipMessage);
      extractionResultsBySource.set("grounded_web", skipResult);
    } else {
      stageProgress.groundedStarted = true;
      // VAL-LOOP-CORE-008: Emit scout stage for browser discovery (if not already emitted)
      if (stageOrder.length === 0 || stageOrder[stageOrder.length - 1].phase !== "scout") {
        stageOrder.push(nextStage("scout"));
      }
      loopCounters.browserScoutCount += 1;

      // VAL-OBS-002: Create budget tracker for adaptive page-limit reduction and company skip decisions
      const maxRunDurationMs = dependencies.maxRunDurationMs ?? DEFAULT_MAX_RUN_DURATION_MS;
      const budgetTracker = createBudgetTracker({
        maxRunDurationMs,
        safetyBufferMs: Math.ceil(maxRunDurationMs * 0.05),
        reducePageLimitThreshold: 0.5,
        pageLimitReductionFactor: 0.5,
      });

      const groundedResult = await runGroundedWebDiscovery(
        run,
        dependencies,
        rejectionSummaryBySource,
        matchingState,
        { sourceTimeoutMs, matcherTimeoutMs },
        budgetTracker,
      ).catch((error) => {
        if (error instanceof TimeoutError) {
          const message = `Grounded web discovery timed out after ${error.timeoutMs}ms: ${error.message}`;
          warnings.push(message);
          dependencies.log?.("discovery.run.grounded_timeout", {
            runId,
            timeoutMs: error.timeoutMs,
          });
          return {
            extractionResult: createExtractionResult(run.runId, "grounded_web", ""),
            normalizedLeads: [],
            listingCount: 0,
          };
        }
        throw error;
      });
      stageProgress.groundedCompleted = true;
      listingCount += groundedResult.listingCount;
      if (groundedResult.extractionResult) {
        extractionResultsBySource.set(
          groundedResult.extractionResult.sourceId,
          groundedResult.extractionResult,
        );
      }
      normalizedLeads.push(...groundedResult.normalizedLeads);
    }
  }

  // Layer 5 Tier-1: SerpApi Google Jobs lane. Runs profile-wide (role +
  // location driven), not company-scoped. Bypasses Gemini extraction — the
  // SerpApi response is already structured JobPosting data. Listings flow
  // through the same normalize/matcher/rank pipeline as other lanes.
  if (config.effectiveSources.includes(SERPAPI_GOOGLE_JOBS_SOURCE_ID)) {
    const extractionResult = createExtractionResult(
      runId,
      SERPAPI_GOOGLE_JOBS_SOURCE_ID,
      "",
    );
    try {
      const serpResult = await collectSerpApiGoogleJobsListings({
        profile: {
          targetRoles: [...config.targetRoles],
          locations: [...config.locations],
          remotePolicy: config.remotePolicy,
        },
        runtimeConfig: dependencies.runtimeConfig,
        log: dependencies.log,
      });
      extractionResult.warnings.push(...serpResult.warnings);
      extractionResult.stats.leadsSeen = serpResult.rawListings.length;
      for (const rawListing of serpResult.rawListings) {
        const normalized = await normalizeRawListing(rawListing, run, {
          dependencies,
          matchingState,
          matcherTimeoutMs,
        });
        if (normalized.matchUsedAi) {
          matchingState.aiMatchCallsUsed += 1;
        }
        if (!normalized.lead) {
          if (normalized.rejection) {
            recordRejection(
              rejectionSummaryBySource,
              SERPAPI_GOOGLE_JOBS_SOURCE_ID,
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
      listingCount += serpResult.rawListings.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      extractionResult.warnings.push(
        `serpapi_google_jobs lane failed: ${message}`,
      );
      dependencies.log?.("discovery.run.serpapi_google_jobs_lane_failed", {
        runId,
        message,
      });
    }
    extractionResultsBySource.set(
      SERPAPI_GOOGLE_JOBS_SOURCE_ID,
      extractionResult,
    );
  }

  // VAL-LOOP-SCORE-001/003/005: Apply frontier scoring and exploit target selection
  // before deep extraction. This ensures only selected exploit targets receive
  // deep extraction work, and exploration budgets are enforced.
  if (normalizedLeads.length > 0) {
    // VAL-LOOP-CORE-008: Emit score stage (frontier scoring begins)
    stageOrder.push(nextStage("score"));

    // Build DiscoveryIntent from config for scoring
    const intent: DiscoveryIntent = {
      intentKey: `run:${run.runId}`,
      targetRoles: config.targetRoles || [],
      includeKeywords: config.includeKeywords || [],
      excludeKeywords: config.excludeKeywords || [],
      locations: config.locations || [],
      remotePolicy: config.remotePolicy || "",
      seniority: config.seniority || "",
      sourcePreset: config.sourcePreset,
    };

    // Build frontier candidates from normalized leads
    const frontierCandidates: FrontierCandidate[] = [];
    for (const lead of normalizedLeads) {
      const sourceLane = determineLeadSourceLane(lead);
      const candidate = leadToFrontierCandidate(lead, sourceLane);
      frontierCandidates.push(candidate);
    }

    // Apply exploit target selection with exploration budget
    const selectionResult = selectExploitTargets(
      frontierCandidates,
      DEFAULT_EXPLORATION_BUDGET,
      intent,
    );

    // VAL-LOOP-CORE-008: Emit exploit stage (deep extraction on selected targets)
    stageOrder.push(nextStage("exploit"));

    // VAL-LOOP-OBS-001: Populate loop counters from selection telemetry
    loopCounters.scoredSurfaces = selectionResult.telemetry.totalCandidates;
    loopCounters.selectedExploitTargets = selectionResult.telemetry.selectedCount;
    loopCounters.exploitSuppressions =
      selectionResult.telemetry.budgetRejectedCount +
      selectionResult.telemetry.qualityRejectedCount;

    // VAL-LOOP-SCORE-005: Filter leads to only selected exploit targets
    const selectedCandidateIds = new Set(
      selectionResult.selectedTargets.map((t) => t.candidateId),
    );
    const suppressedCandidateIds = new Set(
      selectionResult.rejectedCandidates.map((c) => c.candidateId),
    );

    // Build suppression diagnostics for rejected candidates
    for (const candidate of selectionResult.rejectedCandidates) {
      if (candidate.suppressionReasons.length > 0) {
        const diagnostic: ExtractionDiagnostic = {
          code: "threshold_suppressed",
          context: `Candidate ${candidate.candidateId} suppressed: ${candidate.suppressionReasons.join("; ")}`,
        };
        // Find the corresponding source and add diagnostic
        const sourceId = candidate.sourceId;
        const existingResult = extractionResultsBySource.get(sourceId);
        if (existingResult) {
          existingResult.diagnostics = [...(existingResult.diagnostics || []), diagnostic];
        }
      }
    }

    // Log selection telemetry
    dependencies.log?.("discovery.run.exploit_selection_completed", {
      runId,
      totalCandidates: selectionResult.telemetry.totalCandidates,
      atsCandidates: selectionResult.telemetry.atsCandidates,
      browserCandidates: selectionResult.telemetry.browserCandidates,
      selectedCount: selectionResult.telemetry.selectedCount,
      budgetRejectedCount: selectionResult.telemetry.budgetRejectedCount,
      qualityRejectedCount: selectionResult.telemetry.qualityRejectedCount,
      deterministic: selectionResult.telemetry.deterministic,
      finalBudgetUsage: selectionResult.finalBudgetUsage,
    });

    // Filter normalizedLeads to only those from selected candidates
    // VAL-LOOP-SCORE-005: No non-selected target receives deep extraction work
    // Note: leadToFrontierCandidate uses 'lead:' prefix for all candidates
    const filteredNormalizedLeads = normalizedLeads.filter((lead) => {
      const candidateId = `lead:${lead.url}`;
      return selectedCandidateIds.has(candidateId);
    });

    dependencies.log?.("discovery.run.frontier_filtering", {
      runId,
      originalLeadCount: normalizedLeads.length,
      selectedLeadCount: filteredNormalizedLeads.length,
      suppressedCount: normalizedLeads.length - filteredNormalizedLeads.length,
    });

    // Update normalizedLeads to only selected leads
    normalizedLeads.length = 0;
    normalizedLeads.push(...filteredNormalizedLeads);
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

  const [dedupedLeads, crossLaneDuplicates] = dedupeNormalizedLeads(normalizedLeads);
  loopCounters.crossLaneDuplicates = crossLaneDuplicates;
  loopCounters.duplicateSuppressions = normalizedLeads.length - dedupedLeads.length;
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

  let writeResult: PipelineWriteResult;
  if (leadsToWrite.length === 0) {
    writeResult = {
      sheetId: config.sheetId,
      appended: 0,
      updated: 0,
      skippedDuplicates: 0,
      warnings: [],
    };
  } else {
    try {
      writeResult = await dependencies.pipelineWriter.write(
        config.sheetId,
        leadsToWrite,
      );
    } catch (error) {
      if (error instanceof SheetWriteError) {
        dependencies.log?.("discovery.run.write_failed", {
          runId,
          sheetId: config.sheetId,
          phase: error.phase,
          httpStatus: error.httpStatus,
          message: error.message,
        });
        // Build a writeResult with the error info so it can be stored in status.
        // Also add a warning so the lifecycle state becomes "partial".
        writeResult = {
          sheetId: config.sheetId,
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [
            `Sheet write failed during ${error.phase} phase: ${error.message}`,
          ],
          writeError: {
            phase: error.phase,
            message: error.message,
            httpStatus: error.httpStatus,
            detail: error.detail,
          },
        };
      } else {
        throw error;
      }
    }
  }
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
  const lifecycleState = determineLifecycleState(leadsToWrite.length, warnings);

  // VAL-LOOP-CORE-008: Emit learn stage (memory persistence begins)
  stageOrder.push(nextStage("learn"));

  // VAL-LOOP-OBS-001: Aggregate hint/third-party/junk counters from sourceSummary diagnostics
  // and per-source telemetry fields.
  // NOTE: duplicateSuppressions is NOT aggregated here from per-source duplicateListingsSuppressed
  // because that field tracks intra-source dedup BEFORE normalization, which is a different
  // dimension from the cross-source dedup (loopCounters.duplicateSuppressions set above).
  // Per-source duplicate suppression is available in sourceSummary[].duplicateListingsSuppressed.
  for (const source of buildSourceSummary(extractionResultsBySource, rejectionSummaryBySource)) {
    loopCounters.hintMetrics += source.hintOnlyCandidatesSeen || 0;
    loopCounters.thirdPartyBlocks += source.thirdPartyExtractionsBlocked || 0;
    loopCounters.junkHostSuppressions += source.junkHostsSuppressed || 0;
    // duplicateListingsSuppressed per source is NOT added to loopCounters.duplicateSuppressions
    // to avoid conflating two different dedupe dimensions:
    // - loopCounters.duplicateSuppressions: cross-source duplicate suppression (post-normalization)
    // - source.duplicateListingsSuppressed: intra-source duplicate suppression (pre-normalization)
  }

  // VAL-LOOP-MEM-002: Persist exploit outcomes and rejection summaries after run completion
  // This captures per-surface, per-run outcome data for future ranking and selection
  if (dependencies.discoveryMemoryStore) {
    const intentKey = `run:${runId}`;
    let persistedOutcomeCount = 0;
    let skippedOutcomeCount = 0;

    // Persist exploit outcome for each source that produced results
    for (const [sourceId, extractionResult] of extractionResultsBySource) {
      const rejectionSummary = rejectionSummaryBySource.get(sourceId);
      const firstLead = extractionResult.leads[0];
      const companyKey = firstLead?.metadata?.companyKey || "unknown";
      const surfaceId = firstLead?.metadata?.surfaceId || sourceId;
      const sourceLane = firstLead?.metadata?.sourceLane || determineSourceLaneFromId(sourceId);
      const surfaceType = determineSurfaceTypeFromSourceId(sourceId);
      const canonicalUrl = String(firstLead?.url || "").trim();

      if (!canonicalUrl) {
        skippedOutcomeCount += 1;
        const warning =
          `Exploit outcome memory persistence skipped for ${sourceId}: canonicalUrl unavailable because the source produced zero accepted leads.`;
        extractionResult.warnings.push(warning);
        extractionResult.diagnostics = [
          ...(extractionResult.diagnostics || []),
          {
            context:
              `Exploit outcome memory persistence skipped because canonicalUrl was unavailable after zero accepted leads for ${sourceId}.`,
          },
        ];
        dependencies.log?.("discovery.run.memory_persistence_skipped", {
          runId,
          intentKey,
          sourceId,
          reason: "missing_canonical_url",
          listingsSeen: extractionResult.stats.leadsSeen,
          listingsAccepted: extractionResult.stats.leadsAccepted,
          listingsWritten: leadsToWrite.filter((lead) => lead.sourceId === sourceId).length,
        });
        continue;
      }

      try {
        dependencies.discoveryMemoryStore.writeExploitOutcome({
          runId,
          intentKey,
          surfaceId,
          companyKey,
          sourceId,
          sourceLane,
          surfaceType,
          canonicalUrl,
          observedAt: completedAt,
          listingsSeen: extractionResult.stats.leadsSeen,
          listingsAccepted: extractionResult.stats.leadsAccepted,
          listingsRejected: rejectionSummary?.totalRejected || 0,
          listingsWritten: leadsToWrite.filter((l) => l.sourceId === sourceId).length,
          rejectionReasons: rejectionSummary?.rejectionReasons || {},
          rejectionSamples: rejectionSummary?.rejectionSamples || [],
        });
        persistedOutcomeCount += 1;
      } catch (error) {
        skippedOutcomeCount += 1;
        const errorMessage = formatError(error);
        const warning =
          `Exploit outcome memory persistence skipped for ${sourceId}: ${errorMessage}`;
        extractionResult.warnings.push(warning);
        extractionResult.diagnostics = [
          ...(extractionResult.diagnostics || []),
          {
            context:
              `Exploit outcome memory persistence skipped for ${sourceId}: ${errorMessage}`,
            ...(canonicalUrl ? { url: canonicalUrl } : {}),
          },
        ];
        dependencies.log?.("discovery.run.memory_persistence_failed", {
          runId,
          intentKey,
          sourceId,
          canonicalUrl,
          error: errorMessage,
        });
      }
    }

    // VAL-LOOP-MEM-004: Learn role families from accepted leads
    // Deterministic role-family learning from confirmed opportunities
    for (const lead of leadsToWrite) {
      if (lead.title && lead.metadata?.companyKey) {
        dependencies.discoveryMemoryStore.learnRoleFamilyFromLead({
          title: lead.title,
          companyKey: lead.metadata.companyKey,
          sourceLane: (lead.metadata?.sourceLane as string) || "unknown",
          accepted: true,
        });
      }
    }

    dependencies.log?.("discovery.run.memory_persistence_completed", {
      runId,
      intentKey,
      outcomeCount: persistedOutcomeCount,
      skippedOutcomeCount,
      roleFamiliesLearned: leadsToWrite.length,
    });
  }

  const sourceSummary = buildSourceSummary(
    extractionResultsBySource,
    rejectionSummaryBySource,
  );

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
      // VAL-LOOP-CORE-008: Ordered stage evidence for the loop lifecycle
      stageOrder: stageOrder.length > 0 ? stageOrder : undefined,
      // VAL-LOOP-OBS-001/002: Run-level loop counters for terminal telemetry
      // Always present with safe zero-values for empty/degraded terminal runs
      // so telemetry consumers always have counter data regardless of run outcome.
      loopCounters,
      // VAL-LOOP-OBS-003/004: Failure reason attribution for degraded/failure states
      ...classifyFailureReason(
        lifecycleState,
        writeResult,
        loopCounters,
        warnings,
        config.effectiveSources,
      ),
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
    matcherTimeoutMs?: number;
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

  const matcherPromise = input.dependencies.matchClient!.evaluate({
    rawListing,
    run,
    baseline,
  });

  const timeoutMs = input.matcherTimeoutMs ?? DEFAULT_MATCHER_TIMEOUT_MS;
  return withTimeout(
    `ai_matching[${rawListing.sourceId}]`,
    rawListing.sourceId,
    timeoutMs,
    matcherPromise,
  )
    .then((decision) =>
      finalizeMatchDecision(rawListing, run, decision || baseline, true),
    )
    .catch((error) => {
      if (error instanceof TimeoutError) {
        // Fall back to baseline on timeout - don't fail the whole listing
        input.dependencies.log?.("discovery.run.matcher_timeout", {
          runId: run.runId,
          sourceId: rawListing.sourceId,
          timeoutMs: error.timeoutMs,
        });
        return finalizeMatchDecision(rawListing, run, baseline, false);
      }
      return finalizeMatchDecision(rawListing, run, baseline, false);
    });
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
  // Hybrid matcher gate: only "reject" drops the listing. "uncertain" flows
  // through to the sheet — the Match Score column lets the user sort and
  // triage marginal matches instead of the matcher silently discarding them.
  if (decision.decision === "reject") {
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

  // Inject the matcher's overallScore (0–1) as a 0–10 Match Score so the
  // sheet writer can surface it in its new column. Keeps the deterministic
  // fitScore untouched. Guarded by the `if (!normalized.lead)` check above so
  // we never spread a null lead into a truthy placeholder.
  const matchScore = Number.isFinite(decision.overallScore)
    ? Math.round(Math.max(0, Math.min(1, decision.overallScore)) * 10)
    : null;

  return {
    ...normalized,
    lead: { ...normalized.lead, matchScore },
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

/**
 * Result of processing a single company in bounded concurrent execution.
 */
type CompanyProcessingResult = {
  companyName: string;
  rawListings: RawListing[];
  searchQueries: string[];
  seedUrls: string[];
  companyWarnings: string[];
  companyDiagnostics: ExtractionDiagnostic[];
  pagesVisited: number;
  leadsSeen: number;
  leadsAccepted: number;
  /** True if this company's processing failed with an error. */
  failed: boolean;
  /** Error message if failed. */
  errorMessage?: string;
};

/**
 * Tracks peak in-flight company processing for bounded concurrency validation.
 * Used by tests to verify VAL-ROUTE-015: parallel company processing is bounded by configured concurrency.
 */
export type ConcurrencyTracker = {
  /** Record the start of a company processing task. */
  onStart(): void;
  /** Record the end of a company processing task. */
  onEnd(): void;
  /** Get the peak in-flight count observed. */
  getPeakInFlight(): number;
  /** Get the configured concurrency cap. */
  getCap(): number;
};

/**
 * Creates a concurrency tracker for monitoring in-flight company processing.
 */
export function createConcurrencyTracker(cap: number): ConcurrencyTracker {
  let inFlight = 0;
  let peakInFlight = 0;

  return {
    onStart() {
      inFlight++;
      if (inFlight > peakInFlight) {
        peakInFlight = inFlight;
      }
    },
    onEnd() {
      inFlight--;
    },
    getPeakInFlight() {
      return peakInFlight;
    },
    getCap() {
      return cap;
    },
  };
}

/**
 * Resolves the effective concurrency cap from configuration.
 * Handles edge cases: cap=1 (sequential), cap>=companyCount (all in parallel),
 * invalid cap (clamped to safe default).
 * 
 * VAL-ROUTE-015: Concurrency edge cases (cap=1, cap>=companyCount, invalid cap handling)
 * are bounded and explicit.
 */
function resolveConcurrencyCap(
  parallelEnabled: boolean,
  companyCount: number,
): number {
  if (!parallelEnabled) {
    // Parallel processing disabled: use sequential (1)
    return 1;
  }

  // Default to 3 concurrent companies when enabled and no explicit cap
  // This provides meaningful parallelism while avoiding overwhelming the system
  const defaultCap = 3;

  if (companyCount <= 0) {
    // No companies to process
    return 1;
  }

  if (companyCount === 1) {
    // Single company: no parallelism needed
    return 1;
  }

  // Return the default cap for multiple companies
  // If cap >= companyCount, all companies will run in parallel (no effective limit)
  return defaultCap;
}

/**
 * Processes companies with bounded concurrency, ensuring that in-flight
 * company execution never exceeds the effective concurrency cap.
 * 
 * VAL-ROUTE-015: In-flight company execution never exceeds effective concurrency cap.
 * VAL-ROUTE-016: Single-company failures remain isolated with company-attributed
 * failure evidence while successful companies complete.
 */
async function processCompaniesBounded(
  companies: CompanyTarget[],
  dependencies: RunDiscoveryDependencies,
  run: DiscoveryRun,
  timeouts: {
    sourceTimeoutMs: number;
    matcherTimeoutMs: number;
  },
  budgetTracker: BudgetTracker | undefined,
  concurrencyTracker: ConcurrencyTracker,
): Promise<CompanyProcessingResult[]> {
  const results: CompanyProcessingResult[] = [];

  // VAL-ROUTE-015: Resolve effective concurrency cap with explicit edge case handling
  const parallelEnabled = run.config.ultraPlanTuning?.parallelCompanyProcessingEnabled ?? false;
  const effectiveCap = resolveConcurrencyCap(parallelEnabled, companies.length);

  dependencies.log?.("discovery.run.concurrency_config", {
    runId: run.runId,
    companyCount: companies.length,
    parallelEnabled,
    effectiveCap,
    peakInFlight: concurrencyTracker.getPeakInFlight(),
  });

  if (effectiveCap === 1 || companies.length === 1) {
    // Sequential processing: process companies one at a time
    for (const company of companies) {
      const result = await processSingleCompany(
        company,
        dependencies,
        run,
        timeouts,
        budgetTracker,
      );
      results.push(result);
    }
  } else {
    // Bounded parallel processing: process companies in chunks to avoid busy-wait
    // VAL-ROUTE-015: In-flight count never exceeds effectiveCap
    for (let i = 0; i < companies.length; i += effectiveCap) {
      const chunk = companies.slice(i, i + effectiveCap);
      
      // Track starts for this chunk
      for (const _ of chunk) {
        concurrencyTracker.onStart();
      }
      
      const chunkResults = await Promise.all(
        chunk.map((company) =>
          processSingleCompany(company, dependencies, run, timeouts, budgetTracker),
        ),
      );
      
      // Track ends for this chunk
      for (const _ of chunk) {
        concurrencyTracker.onEnd();
      }
      
      results.push(...chunkResults);
    }
  }

  // Sort results by company name for deterministic output
  results.sort((a, b) => a.companyName.localeCompare(b.companyName));

  return results;
}

/**
 * Processes a single company, returning structured result with isolated failure handling.
 * 
 * VAL-ROUTE-016: Single-company failures remain isolated with company-attributed
 * failure evidence while successful companies complete.
 */
async function processSingleCompany(
  company: CompanyTarget,
  dependencies: RunDiscoveryDependencies,
  run: DiscoveryRun,
  timeouts: {
    sourceTimeoutMs: number;
    matcherTimeoutMs: number;
  },
  budgetTracker: BudgetTracker | undefined,
): Promise<CompanyProcessingResult> {
  const result: CompanyProcessingResult = {
    companyName: company.name,
    rawListings: [],
    searchQueries: [],
    seedUrls: [],
    companyWarnings: [],
    companyDiagnostics: [],
    pagesVisited: 0,
    leadsSeen: 0,
    leadsAccepted: 0,
    failed: false,
  };

  // Use describeGroundedSearchScope so log/warning/diagnostic strings read
  // "unrestricted scope" instead of an empty company name when grounded_web runs
  // broadcast mode (companies: [] → [{ name: "" }] placeholder).
  const companyLabel = describeGroundedSearchScope(company);

  // VAL-OBS-002: Check if company should be skipped due to budget exhaustion
  if (budgetTracker) {
    const skipDiagnostic = budgetTracker.checkCompanySkip(company.name);
    if (skipDiagnostic) {
      result.companyDiagnostics.push(skipDiagnostic);
      result.companyWarnings.push(`Budget skip: ${skipDiagnostic.context}`);
      dependencies.log?.("discovery.run.budget_company_skip", {
        runId: run.runId,
        company: company.name,
        context: skipDiagnostic.context,
      });
      return result; // Early return - company skipped due to budget
    }
  }

  try {
    const collectionPromise = collectGroundedWebListings({
      company,
      run,
      runtimeConfig: dependencies.runtimeConfig,
      groundedSearchClient: dependencies.groundedSearchClient!,
      sessionManager: dependencies.browserSessionManager!,
      budgetTracker,
      // Forward the lifecycle log so diagnostic events emitted from inside
      // collectGroundedWebListings (prose-recovery, structured-extraction,
      // preflight dead-link records, seed preparation) actually reach the
      // worker's stdout. Previously log was omitted, which silently swallowed
      // every grounded-web diagnostic.
      log: dependencies.log,
      isDeadLinkCoolingDown: dependencies.discoveryMemoryStore?.isDeadLinkCoolingDown
        ? (url, now) =>
            dependencies.discoveryMemoryStore!.isDeadLinkCoolingDown!(url, now)
        : undefined,
      recordDeadLink: dependencies.discoveryMemoryStore?.recordDeadLink
        ? (record) =>
            dependencies.discoveryMemoryStore!.recordDeadLink!({
              urlKey: record.url,
              finalUrl: record.url,
              host: record.host,
              reasonCode: record.reasonCode || record.reason,
              httpStatus: record.httpStatus ?? null,
              lastTitle: "",
              lastSeenAt: record.firstSeenAt,
              failureCount: 1,
              nextRetryAt: record.cooldownUntil,
            } as DeadLinkRecord)
        : undefined,
    });

    const collectionResult = await withTimeout(
      `grounded_collection[${companyLabel}]`,
      "grounded_web",
      timeouts.sourceTimeoutMs,
      collectionPromise,
    ).catch((error) => {
      if (error instanceof TimeoutError) {
        const message = `Grounded collection timed out after ${error.timeoutMs}ms for ${companyLabel}`;
        result.companyWarnings.push(message);
        result.companyDiagnostics.push({
          code: "timeout",
          context: `Grounded collection timed out after ${error.timeoutMs}ms for ${companyLabel}: ${error.message}`,
        });
        dependencies.log?.("discovery.run.grounded_company_timeout", {
          runId: run.runId,
          company: company.name,
          companyScope: companyLabel,
          timeoutMs: error.timeoutMs,
        });
        return {
          rawListings: [],
          searchQueries: [],
          seedUrls: [],
          warnings: [message],
          pagesVisited: 0,
          diagnostics: [{
            code: "timeout" as const,
            context: `Grounded collection timed out after ${error.timeoutMs}ms for ${companyLabel}: ${error.message}`,
          }],
        };
      }
      throw error;
    });

    // Collect results from this company
    result.rawListings = collectionResult.rawListings;
    result.searchQueries = collectionResult.searchQueries;
    result.seedUrls = collectionResult.seedUrls;
    // Dedup: the timeout catch above synthesizes a warning and also returns it
    // in collectionResult.warnings, so a naive spread-push would add the same
    // string twice to companyWarnings.
    for (const warning of collectionResult.warnings) {
      if (!result.companyWarnings.includes(warning)) {
        result.companyWarnings.push(warning);
      }
    }
    result.pagesVisited = collectionResult.pagesVisited;
    result.leadsSeen = collectionResult.rawListings.length;
    // leadsAccepted reflects the count of leads that passed normalization.
    // Since normalization happens after collection in runGroundedWebDiscovery,
    // we track rawListings as the provisional leadsSeen; leadsAccepted will be
    // updated after normalization when we know which listings were accepted.
    result.leadsAccepted = collectionResult.rawListings.length;

    // VAL-OBS-001: Propagate structured diagnostics from grounded collection
    if (collectionResult.diagnostics?.length) {
      result.companyDiagnostics.push(...collectionResult.diagnostics);
    }

    dependencies.log?.("discovery.run.company_processed", {
      runId: run.runId,
      company: company.name,
      rawListingsCount: result.rawListings.length,
      pagesVisited: result.pagesVisited,
      warnings: result.companyWarnings.length,
      failed: false,
    });
  } catch (error) {
    // VAL-ROUTE-016: Company failure is isolated with explicit attribution
    // The error does not propagate - we record it and continue
    result.failed = true;
    result.errorMessage = formatError(error);
    result.companyWarnings.push(
      `Grounded discovery failed for ${companyLabel}: ${result.errorMessage}`,
    );
    // Emit a diagnostic with context but without an overly generic code.
    // The context contains the actual error message for debugging.
    result.companyDiagnostics.push({
      context: `Company "${companyLabel}" processing failed: ${result.errorMessage}`,
    });
    dependencies.log?.("discovery.run.company_failed", {
      runId: run.runId,
      company: company.name,
      companyScope: companyLabel,
      error: result.errorMessage,
      failed: true,
    });
  }

  return result;
}

async function runGroundedWebDiscovery(
  run: DiscoveryRun,
  dependencies: RunDiscoveryDependencies,
  rejectionSummaryBySource: Map<string, RejectionSummary>,
  matchingState: {
    aiMatchCallsUsed: number;
  },
  timeouts?: {
    sourceTimeoutMs?: number;
    matcherTimeoutMs?: number;
  },
  budgetTracker?: BudgetTracker,
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

  // Honor groundedSearchTuning.maxRuntimeMs for grounded_web collection — the
  // browser_only preset resolves this to 300_000ms (see config.ts:199) to give
  // multi-query fan-out + per-page Browser Use calls room to finish. Fall back to
  // the shared sourceTimeoutMs (60_000ms) for other presets or when tuning is
  // absent. The outer run-budget at dependencies.maxRunDurationMs still bounds
  // the whole run if this grounded timeout exceeds it.
  const sourceTimeoutMs =
    run.config.groundedSearchTuning?.maxRuntimeMs
    ?? timeouts?.sourceTimeoutMs
    ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const matcherTimeoutMs = timeouts?.matcherTimeoutMs ?? DEFAULT_MATCHER_TIMEOUT_MS;

  // VAL-API-010 / VAL-ROUTE-007: When companies is empty but intent is non-blank,
  // run unrestricted grounded discovery using just the intent fields.
  // This supports browser_only and browser_plus_ats presets with empty company scope
  // without injecting legacy fixed-company defaults (Scale AI/Figma/Notion).
  const companiesToSearch =
    run.config.companies.length > 0
      ? run.config.companies
      : [{ name: "" }]; // Unrestricted search with empty company name

  // VAL-ROUTE-015: Create concurrency tracker to monitor in-flight processing
  const parallelEnabled = run.config.ultraPlanTuning?.parallelCompanyProcessingEnabled ?? false;
  const effectiveCap = resolveConcurrencyCap(parallelEnabled, companiesToSearch.length);
  const concurrencyTracker = createConcurrencyTracker(effectiveCap);

  // VAL-ROUTE-015/016: Process companies with bounded concurrency and isolated failure handling
  const companyResults = await processCompaniesBounded(
    companiesToSearch,
    dependencies,
    run,
    { sourceTimeoutMs, matcherTimeoutMs },
    budgetTracker,
    concurrencyTracker,
  );

  // Aggregate results from all companies
  let totalLeadsAccepted = 0;

  for (const companyResult of companyResults) {
    // VAL-ROUTE-016: Emit company-attributed failure evidence for failed companies
    if (companyResult.failed) {
      extractionResult.warnings.push(...companyResult.companyWarnings);
      // Add company-specific failure diagnostics
      extractionResult.diagnostics = [
        ...(extractionResult.diagnostics || []),
        ...companyResult.companyDiagnostics,
      ];
    } else {
      // Successful company processing - aggregate results
      for (const rawListing of companyResult.rawListings) {
        const normalized = await normalizeRawListing(rawListing, run, {
          dependencies,
          matchingState,
          matcherTimeoutMs,
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
        totalLeadsAccepted++;
      }

      // Aggregate successful company data
      extractionResult.querySummary = uniqueJoin([
        extractionResult.querySummary,
        ...companyResult.searchQueries,
        ...companyResult.seedUrls,
      ]);
      extractionResult.stats.pagesVisited += companyResult.pagesVisited;
      extractionResult.stats.leadsSeen += companyResult.leadsSeen;
      extractionResult.warnings.push(...companyResult.companyWarnings);

      // VAL-OBS-001: Propagate successful company diagnostics
      if (companyResult.companyDiagnostics.length > 0) {
        extractionResult.diagnostics = [
          ...(extractionResult.diagnostics || []),
          ...companyResult.companyDiagnostics,
        ];
      }

      listingCount += companyResult.rawListings.length;
    }
  }

  // VAL-ROUTE-015: Log peak in-flight for validation evidence
  dependencies.log?.("discovery.run.concurrency_summary", {
    runId: run.runId,
    companyCount: companiesToSearch.length,
    effectiveCap,
    peakInFlight: concurrencyTracker.getPeakInFlight(),
    successfulCompanies: companyResults.filter((r) => !r.failed).length,
    failedCompanies: companyResults.filter((r) => r.failed).length,
  });

  return {
    extractionResult,
    normalizedLeads,
    listingCount,
  };
}

/**
 * Multi-signal dedupe for normalized leads: uses normalized (title + company)
 * identity to collapse semantically duplicate opportunities that appear under
 * alternate URLs (e.g. short link vs long link, same job accessible via
 * different ATS paths, URL variants with tracking params).
 *
 * Strategy: First group by (title, company) identity. For each identity group,
 * pick the lead with the highest fitScore. This collapses alternate URLs for
 * the same job into a single entry.
 *
 * VAL-LOOP-CROSS-004: Cross-lane duplicates (same opportunity from ATS+browser)
 * are collapsed and counted in the returned crossLaneDuplicates value.
 *
 * @returns Tuple of [deduplicated leads, cross-lane duplicate count]
 */
function dedupeNormalizedLeads(
  leads: NormalizedLead[],
): [NormalizedLead[], number] {
  // Identity key -> best lead for that identity
  const byIdentity = new Map<string, NormalizedLead>();
  // Identity key -> source lanes seen for this identity (for cross-lane detection)
  const lanesByIdentity = new Map<string, Set<string>>();

  for (const lead of leads) {
    if (!lead.url) continue;

    // Build identity key from normalized title + company
    const normalizedTitle = normalizeForDedup(lead.title || "");
    const normalizedCompany = normalizeForDedup(lead.company || "");
    if (!normalizedTitle || !normalizedCompany) continue;

    const identityKey = `${normalizedTitle}|${normalizedCompany}`;
    const existing = byIdentity.get(identityKey);

    // Track source lanes for cross-lane duplicate detection
    const leadLane = lead.metadata?.sourceLane || "unknown";
    if (!lanesByIdentity.has(identityKey)) {
      lanesByIdentity.set(identityKey, new Set());
    }
    lanesByIdentity.get(identityKey)!.add(leadLane);

    // Choose the better lead: higher fitScore wins
    const better = !existing || (lead.fitScore || 0) > (existing.fitScore || 0);

    if (better) {
      byIdentity.set(identityKey, lead);
    }
  }

  // Count cross-lane duplicates: identity keys where both ATS and browser lanes were present
  let crossLaneDuplicates = 0;
  for (const [identityKey, lanes] of lanesByIdentity) {
    if (lanes.size > 1 && byIdentity.has(identityKey)) {
      // Multiple lanes competed for this identity and one won
      crossLaneDuplicates++;
    }
  }

  return [[...byIdentity.values()], crossLaneDuplicates];
}

/**
 * Normalizes a string for use as part of a dedupe identity key.
 * Strips punctuation, folds whitespace, and lowercases.
 */
function normalizeForDedup(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
      // VAL-OBS-001/003: Include structured diagnostics in source summary
      ...(entry.diagnostics?.length
        ? { diagnostics: entry.diagnostics }
        : {}),
    };
  });
}

/**
 * Determines the source lane for a normalized lead based on its sourceId.
 * Used for frontier candidate building and exploit target selection.
 */
function determineLeadSourceLane(lead: NormalizedLead): DiscoverySourceLane {
  // Check metadata.sourceLane first if available
  if (lead.metadata?.sourceLane) {
    return lead.metadata.sourceLane as DiscoverySourceLane;
  }

  // Infer from sourceId for ATS providers
  const atsSourceIds: readonly string[] = [
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
  ];

  if (atsSourceIds.includes(lead.sourceId)) {
    return "ats_provider";
  }

  // Default to grounded_web for browser-discovered leads
  return "grounded_web";
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

function determineSourceLaneFromId(sourceId: string): DiscoverySourceLane {
  const atsSourceIds: readonly string[] = [
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
  ];

  if (atsSourceIds.includes(sourceId)) {
    return "ats_provider";
  }

  if (sourceId === "grounded_web") {
    return "grounded_web";
  }

  return "company_surface";
}

function determineSurfaceTypeFromSourceId(sourceId: string): CareerSurfaceType {
  const atsSourceIds: readonly string[] = [
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
  ];

  if (atsSourceIds.includes(sourceId)) {
    return "provider_board";
  }

  if (sourceId === "grounded_web") {
    return "employer_jobs";
  }

  return "job_posting";
}

/**
 * Classifies the dominant failure reason for terminal degraded/failure states.
 * VAL-LOOP-OBS-003: Machine-readable reason code and human-readable explanation.
 * VAL-LOOP-OBS-004: Failure class differentiates dominant failure categories.
 *
 * Classification order (first match wins):
 * 1. write_failure — explicit write error
 * 2. weak_surface_discovery — no leads found at all
 * 3. strict_filtering_rejection — leads found but all rejected by matcher/normalizer
 * 4. canonical_resolution_loss — browser lane had canonical resolution failures
 * 5. exploit_budget_exhaustion — targets selected but no writes resulted
 * 6. weak_browser_seed_quality — browser-only lane had insufficient detections
 * 7. weak_ats_seed_quality — ATS lane had insufficient detections
 * 8. unknown — unclassified
 * 9. none — successful completion
 */
function classifyFailureReason(
  lifecycleState: DiscoveryLifecycleState,
  writeResult: PipelineWriteResult,
  loopCounters: LoopCounters,
  warnings: string[],
  effectiveSources: SupportedSourceId[],
): { reasonCode?: string; reasonMessage?: string; failureClass?: LoopFailureClass } {
  // Success: no failure attribution needed
  if (lifecycleState === "completed") {
    return { failureClass: "none" };
  }

  // Classification order (first match wins):
  // 1. write_failure — explicit write error (checked first — write failures are terminal and dominate)
  // 2. weak_surface_discovery — no listings seen at all
  // 3. strict_filtering_rejection — leads found but all rejected by matcher/normalizer
  // 4. canonical_resolution_loss — browser lane had canonical resolution failures
  // 5. exploit_budget_exhaustion — targets selected but no writes resulted
  // 6. weak_browser_seed_quality — browser-only lane had insufficient detections
  // 7. weak_ats_seed_quality — ATS lane had insufficient detections
  // 8. unknown — unclassified

  // 1. Write failure — takes highest priority since it is terminal and overrides any other signal
  if (writeResult.writeError) {
    return {
      reasonCode: "write_failure",
      reasonMessage: `Sheet write failed during ${writeResult.writeError.phase} phase: ${writeResult.writeError.message}`,
      failureClass: "write_failure",
    };
  }

  // 2. Weak surface discovery: no listings seen at all
  if (loopCounters.scoredSurfaces === 0 && loopCounters.atsScoutCount === 0 && loopCounters.browserScoutCount === 0) {
    return {
      reasonCode: "weak_surface_discovery",
      reasonMessage: "No surface discoveries were made by ATS or browser scouts. Check configured companies, intent keywords, and ATS board availability.",
      failureClass: "weak_surface_discovery",
    };
  }

  // 3. Strict filtering rejection: leads were seen but all were rejected
  if (loopCounters.scoredSurfaces > 0 && loopCounters.selectedExploitTargets === 0 && loopCounters.exploitSuppressions > 0) {
    return {
      reasonCode: "strict_filtering_rejection",
      reasonMessage: "Candidates were found but all were suppressed by exploit threshold. The matcher or relevance filters rejected all opportunities.",
      failureClass: "strict_filtering_rejection",
    };
  }

  // 4. Canonical resolution loss: browser lane had resolution failures
  const browserHadResolutionFailures = warnings.some(
    (w) => w.includes("hint_resolution_failed") || w.includes("canonical"),
  );
  if (browserHadResolutionFailures && loopCounters.browserScoutCount > 0) {
    return {
      reasonCode: "canonical_resolution_loss",
      reasonMessage: "Browser scout found candidates but canonical resolution failed. Candidates could not be upgraded to canonical employer or ATS surfaces.",
      failureClass: "canonical_resolution_loss",
    };
  }

  // 5. Exploit budget exhaustion: targets selected but no writes
  if (loopCounters.selectedExploitTargets > 0 && loopCounters.exploitSuppressions === 0) {
    return {
      reasonCode: "exploit_budget_exhaustion",
      reasonMessage: "Exploit targets were selected but the run reached budget limits before producing written leads.",
      failureClass: "exploit_budget_exhaustion",
    };
  }

  // 6. Weak browser seed quality: browser-only run had candidates but none became scorable
  //    Guard against operational failures — if the browser lane's upstream was
  //    unavailable (browser-use manager missing) or the grounded-search call
  //    itself errored, this is NOT a seed-quality problem. Let those runs fall
  //    through to `unknown` so the warning summary surfaces the real cause.
  const browserOperationalFailure = warnings.some(
    (w) =>
      w.includes("Grounded web source is enabled but the Browser Use session manager is unavailable") ||
      w.includes("Grounded search upstream failure") ||
      w.includes("Grounded web discovery timed out") ||
      w.includes("Gemini grounded search request failed") ||
      w.includes("Gemini grounded search HTTP"),
  );
  if (
    effectiveSources.length > 0 &&
    effectiveSources.every((sourceId) => sourceId === "grounded_web") &&
    loopCounters.browserScoutCount > 0 &&
    loopCounters.scoredSurfaces === 0 &&
    !browserOperationalFailure
  ) {
    return {
      reasonCode: "weak_browser_seed_quality",
      reasonMessage: "Browser scout attempted discovery but produced no scorable candidates. Gemini URL recall may be weak, or profile companies may not be hiring currently.",
      failureClass: "weak_browser_seed_quality",
    };
  }

  // 7. Weak ATS seed quality: ATS had detections but few/none succeeded
  if (loopCounters.atsScoutCount > 0 && loopCounters.scoredSurfaces === 0) {
    return {
      reasonCode: "weak_ats_seed_quality",
      reasonMessage: "ATS scout attempted detection but produced no scorable candidates. ATS seed quality may be insufficient.",
      failureClass: "weak_ats_seed_quality",
    };
  }

  // 8. Unknown failure
  const warningSummary = warnings.length > 0 ? ` Warnings: ${warnings.slice(0, 3).join("; ")}` : "";
  return {
    reasonCode: "unknown",
    reasonMessage: `Discovery completed with ${lifecycleState} state but reason could not be determined.${warningSummary}`,
    failureClass: "unknown",
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
