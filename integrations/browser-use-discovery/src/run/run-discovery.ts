import type {
  AtsSourceId,
  BrowserUseExtractionResult,
  DiscoveryIntent,
  DiscoveryLifecycleState,
  DiscoveryMemorySnapshot,
  DiscoveryRejectionSample,
  DiscoveryRejectionSummary,
  DiscoveryRunLifecycle,
  DiscoverySourceLane,
  DiscoverySourceSummary,
  DiscoveryRun,
  DiscoveryWebhookRequestV1,
  ExtractionDiagnostic,
  NormalizedLead,
  PipelineWriteResult,
  RawListing,
  StoredWorkerConfig,
} from "../contracts.ts";
import type { ResolvedRunSettings, WorkerRuntimeConfig } from "../config.ts";
import type { BrowserUseSessionManager } from "../browser/session.ts";
import type { DiscoveryMemoryStore } from "../contracts.ts";
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

  for (const company of atsCompaniesToSearch) {
    try {
      stageProgress.detectStarted = true;
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
    stageProgress.groundedStarted = true;

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

  // VAL-LOOP-SCORE-001/003/005: Apply frontier scoring and exploit target selection
  // before deep extraction. This ensures only selected exploit targets receive
  // deep extraction work, and exploration budgets are enforced.
  if (normalizedLeads.length > 0) {
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
    });

    const collectionResult = await withTimeout(
      `grounded_collection[${company.name}]`,
      "grounded_web",
      timeouts.sourceTimeoutMs,
      collectionPromise,
    ).catch((error) => {
      if (error instanceof TimeoutError) {
        const message = `Grounded collection timed out after ${error.timeoutMs}ms for ${company.name}`;
        result.companyWarnings.push(message);
        result.companyDiagnostics.push({
          code: "timeout",
          context: `Grounded collection timed out after ${error.timeoutMs}ms for ${company.name}: ${error.message}`,
        });
        dependencies.log?.("discovery.run.grounded_company_timeout", {
          runId: run.runId,
          company: company.name,
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
            context: `Grounded collection timed out after ${error.timeoutMs}ms for ${company.name}: ${error.message}`,
          }],
        };
      }
      throw error;
    });

    // Collect results from this company
    result.rawListings = collectionResult.rawListings;
    result.searchQueries = collectionResult.searchQueries;
    result.seedUrls = collectionResult.seedUrls;
    result.companyWarnings.push(...collectionResult.warnings);
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
      `Grounded discovery failed for ${company.name}: ${result.errorMessage}`,
    );
    // Emit a diagnostic with context but without an overly generic code.
    // The context contains the actual error message for debugging.
    result.companyDiagnostics.push({
      context: `Company "${company.name}" processing failed: ${result.errorMessage}`,
    });
    dependencies.log?.("discovery.run.company_failed", {
      runId: run.runId,
      company: company.name,
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

  const sourceTimeoutMs = timeouts?.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
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
 */
function dedupeNormalizedLeads(leads: NormalizedLead[]): NormalizedLead[] {
  // Identity key -> best lead for that identity
  const byIdentity = new Map<string, NormalizedLead>();

  for (const lead of leads) {
    if (!lead.url) continue;

    // Build identity key from normalized title + company
    const normalizedTitle = normalizeForDedup(lead.title || "");
    const normalizedCompany = normalizeForDedup(lead.company || "");
    if (!normalizedTitle || !normalizedCompany) continue;

    const identityKey = `${normalizedTitle}|${normalizedCompany}`;
    const existing = byIdentity.get(identityKey);

    // Choose the better lead: higher fitScore wins
    const better = !existing || (lead.fitScore || 0) > (existing.fitScore || 0);

    if (better) {
      byIdentity.set(identityKey, lead);
    }
  }

  return [...byIdentity.values()];
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

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
