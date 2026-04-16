import { URL } from "node:url";

import type { BrowserUseSessionManager } from "../browser/session.ts";
import type { WorkerRuntimeConfig } from "../config.ts";
import type {
  AtsSourceId,
  CompanyTarget,
  DiscoveryRun,
  ExtractionDiagnostic,
  GroundedSearchTuning,
  RawListing,
} from "../contracts.ts";
import {
  canonicalizeCareerSurfaceUrl,
  classifyCareerSurfacePageType,
  classifyCareerSurfaceSourcePolicy,
  detectCareerSurfaceCandidatesFromHtml,
  isEmployerCareerSurface,
  isKnownAtsCareerSurface,
  isLikelyThirdPartyJobHost as isThirdPartyCareerSurface,
  mergeCareerSurfaceCandidates,
  normalizeCareerSurfaceCandidate,
  resolveCareerSurfaceCandidate,
  scoreCareerSurfaceCandidate,
  type CareerSurfaceCandidate,
  type CareerSurfaceSourcePolicy,
} from "../discovery/career-surface-resolver.ts";
import { dedupeFingerprintListings } from "../discovery/listing-fingerprint.ts";
import type { BudgetTracker } from "../run/budget-tracker.ts";

const SEARCH_SYSTEM_PROMPT = [
  "You source current live job postings from the public web.",
  "Use Google Search grounding to find candidate links.",
  "Return strict JSON only.",
  'Use this shape: {"results":[{"url":"https://...","title":"...","pageType":"job|listings|careers|other","reason":"..."}]}.',
  "Prefer direct employer job pages and active careers/listings pages that can be expanded into direct jobs.",
  "Use absolute HTTPS URLs.",
].join(" ");

const PAGE_EXTRACTION_PROMPT = [
  "Extract active job postings from this page.",
  "Return strict JSON only.",
  'Use this shape: {"pageType":"job|listings|careers|other","jobs":[{"title":"...","company":"...","location":"...","url":"https://...","descriptionText":"...","compensationText":"...","tags":["..."],"contact":"..."}],"warnings":["..."]}.',
  "If this page is a single job posting, return one job.",
  "If this page is a careers or listings page, return up to 8 relevant direct job links from the page.",
  "Only include active jobs that plausibly match the requested company and filters.",
  "Use absolute HTTPS URLs for each job.",
].join(" ");

const INFORMATIONAL_PAGE_SLUGS = new Set([
  "benefits",
  "how-we-work",
  "how-to-get-a-job-here",
  "how-we-hire",
  "why-work-here",
  "our-culture",
  "culture",
  "life-at",
  "about-us",
  "about",
  "our-story",
  "our-team",
  "team",
  "values",
  "mission",
  "faq",
]);

export type GroundedCandidateSourcePolicy = CareerSurfaceSourcePolicy;

const DEFAULT_HINT_RESOLUTION_LIMIT = 2;
const PRE_FLIGHT_TIMEOUT_MS = 12_000;

export type GroundedSearchCandidate = CareerSurfaceCandidate;

export type GroundedSearchResult = {
  searchQueries: string[];
  candidates: GroundedSearchCandidate[];
  warnings: string[];
  /**
   * Detailed query execution evidence for multi-query fan-out and retry ladder.
   * Each entry represents a single query attempt with its rung attribution.
   */
  queryEvidence?: GroundedQueryEvidence[];
  /**
   * Diagnostics for the overall search operation.
   */
  diagnostics?: GroundedSearchDiagnostics;
};

export type GroundedQueryRung = 0 | 1 | 2;

/**
 * Evidence for a single query attempt in the fan-out/retry ladder.
 */
export type GroundedQueryEvidence = {
  /** The query string that was executed. */
  query: string;
  /** Which rung this query represents (0=focused, 1=drop location, 2=broaden role/keywords). */
  rung: GroundedQueryRung;
  /** The source queries used to build this focused query (for focused rungs). */
  sourceQueries?: string[];
  /** Number of candidates returned by this query. */
  candidateCount: number;
  /** Whether this query was the final attempt (no more broadening after this). */
  terminal: boolean;
};

type GroundedSearchRequestFailure = {
  query: string;
  rung?: GroundedQueryRung;
  status?: number;
  message: string;
  retryable: boolean;
};

/**
 * Structured diagnostics for grounded search operations.
 */
export type GroundedSearchDiagnostics = {
  /** True if multi-query fan-out was enabled and executed. */
  multiQueryFanOutEnabled: boolean;
  /** The configured cap for multi-query fan-out. */
  multiQueryCap: number;
  /** Total number of focused sub-queries generated. */
  focusedQueryCount: number;
  /** True if retry broadening was enabled. */
  retryBroadeningEnabled: boolean;
  /** True if any sub-query exhausted all retry rungs without candidates. */
  ladderExhausted: boolean;
  /**
   * Rung attribution for exhausted sub-queries.
   * Present when ladderExhausted is true.
   */
  exhaustedRungs?: Array<{
    query: string;
    finalRung: GroundedQueryRung;
  }>;
  /** VAL-DATA-001: True if regex fallback was used for non-JSON/conversational output. */
  regexFallbackUsed?: boolean;
  /** Upstream Gemini request failures encountered while searching. */
  requestFailures?: GroundedSearchRequestFailure[];
  /** True when search stopped early because an upstream failure made more fan-out/rungs unproductive. */
  abortedDueToUpstreamError?: boolean;
};

export type GroundedSearchClient = {
  search(
    company: CompanyTarget,
    run: DiscoveryRun,
    options?: { signal?: AbortSignal },
  ): Promise<GroundedSearchResult>;
  searchAtsHosts?(input: {
    run: DiscoveryRun;
    sourceIds: AtsSourceId[];
    maxResults?: number;
    signal?: AbortSignal;
  }): Promise<GroundedSearchResult>;
  resolveHint?(input: {
    candidate: GroundedSearchCandidate;
    company: CompanyTarget;
    run: DiscoveryRun;
    maxResults?: number;
    signal?: AbortSignal;
  }): Promise<GroundedSearchCandidate[]>;
};

export type GroundedWebCollectionResult = {
  rawListings: RawListing[];
  searchQueries: string[];
  seedUrls: string[];
  warnings: string[];
  pagesVisited: number;
  /** Structured diagnostic entries for extraction observability (VAL-OBS-001, VAL-OBS-003). */
  diagnostics?: ExtractionDiagnostic[];
};

type FetchImpl = typeof fetch;
type AnyRecord = Record<string, unknown>;
type GroundedSearchLog = (
  event: string,
  details: Record<string, unknown>,
) => void;

const ATS_HOST_QUERY_HINTS: Record<AtsSourceId, string[]> = {
  greenhouse: [
    "boards.greenhouse.io",
    "boards.eu.greenhouse.io",
    "job-boards.greenhouse.io",
  ],
  lever: ["jobs.lever.co"],
  ashby: ["jobs.ashbyhq.com"],
  smartrecruiters: ["jobs.smartrecruiters.com"],
  workday: ["myworkdayjobs.com", "workdayjobs.com"],
  icims: ["icims.com"],
  jobvite: ["jobvite.com"],
  taleo: ["taleo.net"],
  successfactors: ["successfactors.com"],
  workable: ["apply.workable.com"],
  breezy: ["breezy.hr"],
  recruitee: ["recruitee.com"],
  teamtailor: ["teamtailor.com"],
  personio: ["jobs.personio.com", "jobs.personio.de"],
};

/**
 * Generates deterministic focused sub-queries from modifier intent.
 * Each sub-query focuses on a specific combination of role + keywords + location.
 * VAL-ROUTE-012: Focused queries are unique and capped for the same input intent.
 */
function generateFocusedSubQueries(run: DiscoveryRun, cap: number): string[] {
  const config = run.config;
  const targetRoles = (config.targetRoles || []).map((r) => r.trim()).filter(Boolean);
  const includeKeywords = (config.includeKeywords || []).map((k) => k.trim()).filter(Boolean);
  const locations = (config.locations || []).map((l) => l.trim()).filter(Boolean);
  const remotePolicy = config.remotePolicy?.trim() || "";
  const seniority = config.seniority?.trim() || "";

  const queries: string[] = [];

  // Generate focused queries covering different modifier combinations
  // Order: role-focused, keyword-focused, location-focused, broader combinations

  // 1. Role + Seniority + Remote combinations
  for (const role of targetRoles.slice(0, 2)) {
    const parts: string[] = [role];
    if (seniority) parts.push(seniority);
    if (remotePolicy === "remote") parts.push("remote");
    if (parts.length > 0) {
      queries.push(ensureEmploymentIntentQuery(parts.join(" ")));
    }
  }

  // 2. Role + Location combinations
  for (const role of targetRoles.slice(0, 2)) {
    for (const location of locations.slice(0, 2)) {
      queries.push(ensureEmploymentIntentQuery(`${role} ${location}`));
    }
  }

  // 3. Keywords + Location combinations
  for (const keyword of includeKeywords.slice(0, 2)) {
    for (const location of locations.slice(0, 2)) {
      queries.push(ensureEmploymentIntentQuery(`${keyword} ${location}`));
    }
  }

  // 4. Role + Keywords combinations (without location)
  for (const role of targetRoles.slice(0, 2)) {
    for (const keyword of includeKeywords.slice(0, 2)) {
      queries.push(ensureEmploymentIntentQuery(`${role} ${keyword}`));
    }
  }

  // 5. Keywords only (broader)
  for (const keyword of includeKeywords.slice(0, 3)) {
    queries.push(ensureEmploymentIntentQuery(keyword));
  }

  // Dedupe and cap
  const unique = [...new Set(queries)].slice(0, Math.max(1, cap));
  return unique;
}

/**
 * Executes a single focused query with optional retry broadening ladder.
 * VAL-ROUTE-013: Zero-candidate focused queries follow ordered broadening ladder.
 * VAL-ROUTE-014: First-rung success does not trigger unnecessary broadening retries.
 * VAL-ROUTE-017: Retry ladder exhaustion terminates finitely with explicit exhaustion attribution.
 *
 * Rung order:
 * - Rung 0 (focused): Original focused query
 * - Rung 1 (drop location): Remove location constraints
 * - Rung 2 (broaden): Remove role/keywords constraints, use only core terms
 */
async function executeQueryWithRetry(
  focusedQuery: string,
  company: CompanyTarget,
  run: DiscoveryRun,
  endpoint: string,
  apiKey: string,
  retryBroadeningEnabled: boolean,
  fetchImpl: FetchImpl,
  maxResultsPerCompany: number,
  log: GroundedSearchLog | undefined,
  companyLabel: string,
  signal?: AbortSignal,
): Promise<{
  candidates: GroundedSearchCandidate[];
  searchQueries: string[];
  evidence: GroundedQueryEvidence[];
  exhausted: boolean;
  regexFallbackUsed: boolean;
  regexFallbackAttempted: boolean;
  failures: GroundedSearchRequestFailure[];
  abortedDueToUpstreamError: boolean;
}> {
  const evidence: GroundedQueryEvidence[] = [];
  const searchQueries: string[] = [];
  const allCandidates: GroundedSearchCandidate[] = [];
  const failures: GroundedSearchRequestFailure[] = [];
  let exhausted = false;
  let regexFallbackUsed = false;
  let regexFallbackAttempted = false;
  let abortedDueToUpstreamError = false;

  // VAL-ROUTE-013: Build the retry ladder
  // Rung 0: focused query (original)
  // Rung 1: drop location
  // Rung 2: broaden role/keywords

  const ladder = buildRetryLadder(focusedQuery, run);

  // Execute each rung in order
  for (let i = 0; i < ladder.length; i++) {
    throwIfAborted(signal);
    const { query, rung, terminal } = ladder[i];
    const attemptStartedAt = Date.now();
    log?.("discovery.run.grounded_query_started", {
      runId: run.runId,
      company: company.name,
      companyScope: companyLabel,
      focusedQuery,
      query,
      rung,
      terminal,
      retryBroadeningEnabled,
    });

    const result = await executeSingleQuery(
      query,
      company,
      run,
      endpoint,
      apiKey,
      fetchImpl,
      maxResultsPerCompany,
      signal,
    );
    log?.("discovery.run.grounded_query_completed", {
      runId: run.runId,
      company: company.name,
      companyScope: companyLabel,
      focusedQuery,
      query,
      rung,
      terminal,
      durationMs: Date.now() - attemptStartedAt,
      candidateCount: result.candidates.length,
      searchQueryCount: result.searchQueries.length,
      failureStatus: result.failure?.status,
      failureRetryable: result.failure?.retryable,
      ...(result.failure ? { failureMessage: result.failure.message } : {}),
      regexFallbackUsed: result.regexFallbackUsed,
      regexFallbackAttempted: result.regexFallbackAttempted,
    });

    searchQueries.push(...result.searchQueries);
    allCandidates.push(...result.candidates);
    if (result.regexFallbackUsed) {
      regexFallbackUsed = true;
    }
    if (result.regexFallbackAttempted) {
      regexFallbackAttempted = true;
    }

    if (result.failure) {
      const failure = {
        query,
        rung,
        status: result.failure.status,
        message: result.failure.message,
        retryable: result.failure.retryable,
      } satisfies GroundedSearchRequestFailure;
      failures.push(failure);
      if (!result.failure.retryable) {
        abortedDueToUpstreamError = true;
      }
    }

    evidence.push({
      query,
      rung,
      sourceQueries: rung === 0 ? [focusedQuery] : undefined,
      candidateCount: result.candidates.length,
      terminal,
    });

    // VAL-ROUTE-014: First-rung success short-circuits the ladder
    if (result.candidates.length > 0) {
      // Candidates found, stop retrying
      break;
    }

    if (result.failure && !result.failure.retryable) {
      break;
    }

    // VAL-ROUTE-017: If this was the last rung (terminal) and still no candidates, mark exhausted
    if (terminal && !result.failure) {
      exhausted = true;
    }
  }

  return {
    candidates: allCandidates,
    searchQueries,
    evidence,
    exhausted,
    regexFallbackUsed,
    regexFallbackAttempted,
    failures,
    abortedDueToUpstreamError,
  };
}

/**
 * Builds the retry ladder for a focused query.
 * Returns queries for each rung in order.
 */
function buildRetryLadder(
  focusedQuery: string,
  run: DiscoveryRun,
): Array<{ query: string; rung: GroundedQueryRung; terminal: boolean }> {
  const config = run.config;
  const targetRoles = (config.targetRoles || []).map((r) => r.trim()).filter(Boolean);
  const includeKeywords = (config.includeKeywords || []).map((k) => k.trim()).filter(Boolean);
  const locations = (config.locations || []).map((l) => l.trim()).filter(Boolean);

  const ladder: Array<{ query: string; rung: GroundedQueryRung; terminal: boolean }> = [];

  // Rung 0: Focused query (original)
  ladder.push({
    query: focusedQuery,
    rung: 0,
    terminal: false,
  });

  // Rung 1: Drop location constraints
  // Remove location from the query but keep role + keywords
  // Handles both single-word (e.g., "Remote") and multi-word (e.g., "United States") locations
  if (locations.length > 0) {
    let queryWithoutLocation = focusedQuery;
    for (const location of locations) {
      // Case-insensitive phrase match: remove the location phrase wherever it appears
      // Use word boundary matching to avoid partial matches like "States" in "United Statesman"
      const escapedLocation = location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const locationPattern = new RegExp(`\\b${escapedLocation}\\b`, "gi");
      queryWithoutLocation = queryWithoutLocation.replace(locationPattern, "");
    }
    // Clean up extra whitespace
    const cleanedQuery = queryWithoutLocation.split(/\s+/).filter(Boolean).join(" ");
    if (cleanedQuery && cleanedQuery !== focusedQuery) {
      ladder.push({
        query: ensureEmploymentIntentQuery(cleanedQuery),
        rung: 1,
        terminal: false,
      });
    }
  }

  // Rung 2: Broaden - use core role/keywords only
  // This is the broadest query, terminal rung
  const coreTerms: string[] = [];
  for (const role of targetRoles.slice(0, 1)) {
    coreTerms.push(role);
  }
  for (const keyword of includeKeywords.slice(0, 2)) {
    coreTerms.push(keyword);
  }
  const broadenQuery = ensureEmploymentIntentQuery(coreTerms.join(" "));
  if (broadenQuery && broadenQuery !== focusedQuery) {
    ladder.push({
      query: broadenQuery,
      rung: 2,
      terminal: true,
    });
  } else {
    // If broaden query equals focused, mark the last rung as terminal
    if (ladder.length > 0) {
      ladder[ladder.length - 1].terminal = true;
    }
  }

  return ladder;
}

/**
 * Executes a single query against the Gemini API.
 */
async function executeSingleQuery(
  query: string,
  company: CompanyTarget,
  run: DiscoveryRun,
  endpoint: string,
  apiKey: string,
  fetchImpl: FetchImpl,
  maxResultsPerCompany: number,
  signal?: AbortSignal,
): Promise<{
  candidates: GroundedSearchCandidate[];
  searchQueries: string[];
  regexFallbackUsed: boolean;
  regexFallbackAttempted: boolean;
  failure?: {
    status?: number;
    message: string;
    retryable: boolean;
  };
}> {
  const prompt = buildSearchPromptForQuery(query, company, run, maxResultsPerCompany);
  return executeGroundedSearchRequest({
    prompt,
    company,
    run,
    endpoint,
    apiKey,
    fetchImpl,
    maxResultsPerCompany,
    signal,
  });
}

/**
 * Builds a search prompt for a specific query string.
 */
function buildSearchPromptForQuery(
  query: string,
  company: CompanyTarget,
  run: DiscoveryRun,
  maxResults: number,
): string {
  const isUnrestrictedScope = !company.name;

  const lines: string[] = [];

  if (isUnrestrictedScope) {
    lines.push("Search focus: Modifier-driven intent search (no fixed company target)");
  } else {
    lines.push(`Company: ${company.name}`);
  }

  // Use the pre-composed query directly
  lines.push(`Query: ${query}`);

  // Add context about the search
  const config = run.config;
  lines.push(
    `Target roles: ${joinOrAny(config.targetRoles)}`,
    `Include keywords: ${joinOrAny([
      ...config.includeKeywords,
      ...(company.includeKeywords || []),
    ])}`,
    `Exclude keywords: ${joinOrAny([
      ...config.excludeKeywords,
      ...(company.excludeKeywords || []),
    ])}`,
    `Locations: ${joinOrAny(config.locations)}`,
    `Remote policy: ${config.remotePolicy || "any"}`,
    `Seniority: ${config.seniority || "any"}`,
    `Return at most ${Math.max(1, maxResults)} candidate links.`,
    "Mix direct employer job pages with expandable careers/listings pages when useful.",
  );

  return lines.join("\n");
}

function ensureEmploymentIntentQuery(query: string): string {
  const cleaned = String(query || "").split(/\s+/).filter(Boolean).join(" ").trim();
  if (!cleaned) return "";
  if (/\b(job|jobs|career|careers|hiring|opening|openings)\b/i.test(cleaned)) {
    return cleaned;
  }
  return `${cleaned} jobs`;
}

function describeGroundedSearchScope(company: CompanyTarget): string {
  const name = String(company.name || "").trim();
  return name || "unrestricted scope";
}

/**
 * Deduplicates candidates across multiple query executions.
 */
function deduplicateCandidates(
  candidates: GroundedSearchCandidate[],
  company: CompanyTarget,
  limit: number,
): GroundedSearchCandidate[] {
  return mergeGroundedCandidates(candidates, [], company, limit);
}

export function createGroundedSearchClient(
  runtimeConfig: WorkerRuntimeConfig,
  dependencies: { fetchImpl?: FetchImpl; log?: GroundedSearchLog } = {},
): GroundedSearchClient {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const log = dependencies.log;
  return {
    async search(company, run, options) {
      const apiKey = String(runtimeConfig.geminiApiKey || "").trim();
      if (!apiKey) {
        throw new Error("Gemini API key is not configured for grounded search.");
      }
      throwIfAborted(options?.signal);

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(runtimeConfig.geminiModel || "gemini-2.5-flash")}:generateContent`;
      const tuning = run.config.groundedSearchTuning;
      const ultraPlanTuning = run.config.ultraPlanTuning;
      const multiQueryEnabled = ultraPlanTuning?.multiQueryEnabled ?? false;
      const retryBroadeningEnabled = ultraPlanTuning?.retryBroadeningEnabled ?? false;
      const multiQueryCap = tuning?.multiQueryCap ?? (multiQueryEnabled ? 4 : 3);
      const maxResultsPerCompany = tuning?.maxResultsPerCompany ?? runtimeConfig.groundedSearchMaxResultsPerCompany;
      const companyLabel = describeGroundedSearchScope(company);
      const searchStartedAt = Date.now();
      log?.("discovery.run.grounded_search_started", {
        runId: run.runId,
        company: company.name,
        companyScope: companyLabel,
        unrestrictedScope: !company.name,
        multiQueryEnabled,
        retryBroadeningEnabled,
        multiQueryCap,
        maxResultsPerCompany,
        maxRuntimeMs: tuning?.maxRuntimeMs ?? null,
        maxTokensPerQuery: tuning?.maxTokensPerQuery ?? null,
      });

      // VAL-ROUTE-012: Multi-query fan-out from modifiers
      // When multiQueryEnabled, decompose modifier intent into focused sub-queries
      const isUnrestrictedScope = !company.name;
      const focusedQueries: string[] = [];

      if (multiQueryEnabled && isUnrestrictedScope) {
        // Generate focused sub-queries from modifiers for unrestricted scope
        const generatedQueries = generateFocusedSubQueries(run, multiQueryCap);
        focusedQueries.push(...generatedQueries);
      }

      // If multi-query is disabled or we have a company target, use single broad query (legacy behavior)
      if (focusedQueries.length === 0) {
        const result = await executeGroundedSearchRequest({
          prompt: buildSearchPrompt(
            company,
            run,
            maxResultsPerCompany,
          ),
          company,
          run,
          endpoint,
          apiKey,
          fetchImpl,
          maxResultsPerCompany,
          signal: options?.signal,
        });
        const warnings: string[] = [];
        const diagnostics: GroundedSearchDiagnostics | undefined = result.failure
          ? {
              multiQueryFanOutEnabled: multiQueryEnabled,
              multiQueryCap,
              focusedQueryCount: 0,
              retryBroadeningEnabled,
              ladderExhausted: false,
              requestFailures: [
                {
                  query: "broad_query",
                  status: result.failure.status,
                  message: result.failure.message,
                  retryable: result.failure.retryable,
                },
              ],
              abortedDueToUpstreamError: !result.failure.retryable,
            }
          : undefined;

        // VAL-DATA-001: Emit explicit warning for regex fallback on non-JSON/conversational output
        // Use regexFallbackAttempted to emit warning whenever fallback was tried (regardless of outcome),
        // but differentiate the message based on whether candidates were recovered
        if (result.failure) {
          warnings.push(formatGroundedSearchFailureWarning({
            query: "broad_query",
            status: result.failure.status,
            message: result.failure.message,
            retryable: result.failure.retryable,
          }));
        } else if (result.candidates.length === 0) {
          warnings.push("Grounded search returned no usable candidate links.");
        }
        if (result.regexFallbackAttempted) {
          if (result.regexFallbackUsed) {
            warnings.push(
              "Regex URL fallback used: grounded output was non-JSON or conversational; URLs recovered via pattern matching.",
            );
          } else {
            warnings.push(
              "Regex URL fallback used: grounded output was non-JSON or conversational; no valid URLs recovered.",
            );
          }
        }
        log?.("discovery.run.grounded_search_completed", {
          runId: run.runId,
          company: company.name,
          companyScope: companyLabel,
          durationMs: Date.now() - searchStartedAt,
          candidateCount: result.candidates.length,
          searchQueryCount: result.searchQueries.length,
          warningCount: warnings.length,
          requestFailureCount: diagnostics?.requestFailures?.length || 0,
          focusedQueryCount: 0,
        });

        return {
          searchQueries: result.searchQueries,
          candidates: result.candidates,
          warnings,
          diagnostics,
        };
      }

      // VAL-ROUTE-012/013/014/017: Multi-query fan-out with retry ladder
      // Execute each focused query and apply retry broadening if needed
      const allCandidates: GroundedSearchCandidate[] = [];
      const allSearchQueries: string[] = [];
      const queryEvidence: GroundedQueryEvidence[] = [];
      const warnings: string[] = [];
      const exhaustedSubQueries: { query: string; finalRung: GroundedQueryRung }[] = [];
      const requestFailures: GroundedSearchRequestFailure[] = [];
      let ladderExhausted = false;
      let regexFallbackUsed = false;
      let regexFallbackAttempted = false;
      let abortedDueToUpstreamError = false;

      // Execute each focused query
      for (const focusedQuery of focusedQueries) {
        const { candidates, searchQueries, evidence, exhausted, regexFallbackUsed: queryRegexFallback, regexFallbackAttempted: queryRegexFallbackAttempted, failures, abortedDueToUpstreamError: queryAbortedDueToUpstreamError } = await executeQueryWithRetry(
          focusedQuery,
          company,
          run,
          endpoint,
          apiKey,
          retryBroadeningEnabled,
          fetchImpl,
            maxResultsPerCompany,
            log,
            companyLabel,
            options?.signal,
          );

        allCandidates.push(...candidates);
        allSearchQueries.push(...searchQueries);
        queryEvidence.push(...evidence);
        if (queryRegexFallback) {
          regexFallbackUsed = true;
        }
        if (queryRegexFallbackAttempted) {
          regexFallbackAttempted = true;
        }
        requestFailures.push(...failures);

        if (exhausted) {
          ladderExhausted = true;
          // Find the last evidence entry for this query to get final rung
          const lastEvidence = evidence[evidence.length - 1];
          if (lastEvidence) {
            exhaustedSubQueries.push({
              query: focusedQuery,
              finalRung: lastEvidence.rung,
            });
          }
        }
        if (queryAbortedDueToUpstreamError) {
          abortedDueToUpstreamError = true;
          break;
        }
      }

      // Dedupe candidates across all queries
      const uniqueCandidates = deduplicateCandidates(allCandidates, company, maxResultsPerCompany);

      // Build diagnostics
      const diagnostics: GroundedSearchDiagnostics = {
        multiQueryFanOutEnabled: multiQueryEnabled,
        multiQueryCap,
        focusedQueryCount: focusedQueries.length,
        retryBroadeningEnabled,
        ladderExhausted,
        ...(ladderExhausted && exhaustedSubQueries.length > 0
          ? { exhaustedRungs: exhaustedSubQueries }
          : {}),
        ...(regexFallbackUsed ? { regexFallbackUsed: true } : {}),
        ...(requestFailures.length > 0
          ? { requestFailures }
          : {}),
        ...(abortedDueToUpstreamError
          ? { abortedDueToUpstreamError: true }
          : {}),
      };

      // Add warnings if no candidates found or ladder exhausted
      if (requestFailures.length > 0) {
        warnings.push(
          ...uniqueStrings(
            requestFailures.map((failure) => formatGroundedSearchFailureWarning(failure)),
          ),
        );
      } else if (uniqueCandidates.length === 0) {
        warnings.push("Grounded search returned no usable candidate links.");
      }
      if (ladderExhausted && uniqueCandidates.length === 0 && requestFailures.length === 0) {
        warnings.push(
          `Query ladder exhausted: all ${focusedQueries.length} focused sub-queries returned zero candidates after retry broadening.`,
        );
      }
      // VAL-DATA-001: Emit explicit warning for regex fallback on non-JSON/conversational output
      // Use regexFallbackAttempted to emit warning whenever fallback was tried (regardless of outcome),
      // but differentiate the message based on whether candidates were recovered
      if (regexFallbackAttempted) {
        if (regexFallbackUsed) {
          warnings.push(
            "Regex URL fallback used: grounded output was non-JSON or conversational; URLs recovered via pattern matching.",
          );
        } else {
          warnings.push(
            "Regex URL fallback used: grounded output was non-JSON or conversational; no valid URLs recovered.",
          );
        }
      }
      log?.("discovery.run.grounded_search_completed", {
        runId: run.runId,
        company: company.name,
        companyScope: companyLabel,
        durationMs: Date.now() - searchStartedAt,
        candidateCount: uniqueCandidates.length,
        searchQueryCount: uniqueStrings(allSearchQueries).length,
        warningCount: warnings.length,
        requestFailureCount: requestFailures.length,
        focusedQueryCount: focusedQueries.length,
        ladderExhausted,
        abortedDueToUpstreamError,
      });

      return {
        searchQueries: uniqueStrings(allSearchQueries),
        candidates: uniqueCandidates,
        warnings,
        queryEvidence,
        diagnostics,
      };
    },
    async searchAtsHosts({ run, sourceIds, maxResults, signal }) {
      const apiKey = String(runtimeConfig.geminiApiKey || "").trim();
      if (!apiKey) {
        throw new Error("Gemini API key is not configured for ATS host search.");
      }
      throwIfAborted(signal);

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(runtimeConfig.geminiModel || "gemini-2.5-flash")}:generateContent`;
      const maxResultsPerCompany =
        maxResults ??
        run.config.groundedSearchTuning?.maxResultsPerCompany ??
        runtimeConfig.groundedSearchMaxResultsPerCompany;
      const result = await executeGroundedSearchRequest({
        prompt: buildAtsHostSearchPrompt(run, sourceIds, maxResultsPerCompany),
        company: { name: "" },
        run,
        endpoint,
        apiKey,
        fetchImpl,
        maxResultsPerCompany,
        signal,
      });

      const candidates = mergeGroundedCandidates(
        result.candidates
          .map((entry) => normalizeGroundedCandidate(entry, { name: "" }))
          .filter((entry) =>
            isKnownAtsCareerSurface(
              entry.finalUrl || entry.canonicalUrl || entry.url,
            ),
          ),
        [],
        { name: "" },
        maxResultsPerCompany,
      );
      const warnings: string[] = [];
      if (result.failure) {
        warnings.push(
          formatGroundedSearchFailureWarning({
            query: "ats_hosts",
            status: result.failure.status,
            message: result.failure.message,
            retryable: result.failure.retryable,
          }),
        );
      } else if (candidates.length === 0) {
        warnings.push("ATS host search returned no usable provider surfaces.");
      }
      if (result.regexFallbackAttempted) {
        warnings.push(
          result.regexFallbackUsed
            ? "Regex URL fallback used during ATS host search; URLs recovered via pattern matching."
            : "Regex URL fallback used during ATS host search; no valid ATS URLs recovered.",
        );
      }

      return {
        searchQueries: result.searchQueries,
        candidates,
        warnings,
        diagnostics: result.failure
          ? {
              multiQueryFanOutEnabled: false,
              multiQueryCap: 1,
              focusedQueryCount: 0,
              retryBroadeningEnabled: false,
              ladderExhausted: false,
              requestFailures: [
                {
                  query: "ats_hosts",
                  status: result.failure.status,
                  message: result.failure.message,
                  retryable: result.failure.retryable,
                },
              ],
              abortedDueToUpstreamError: !result.failure.retryable,
            }
          : undefined,
      };
    },
    async resolveHint({ candidate, company, run, maxResults, signal }) {
      const apiKey = String(runtimeConfig.geminiApiKey || "").trim();
      if (!apiKey) {
        return [];
      }
      throwIfAborted(signal);
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(runtimeConfig.geminiModel || "gemini-2.5-flash")}:generateContent`;
      const result = await executeGroundedSearchRequest({
        prompt: buildHintResolutionPrompt(candidate, company, run, maxResults ?? DEFAULT_HINT_RESOLUTION_LIMIT),
        company,
        run,
        endpoint,
        apiKey,
        fetchImpl,
        maxResultsPerCompany: maxResults ?? DEFAULT_HINT_RESOLUTION_LIMIT,
        signal,
      });
      if (result.failure) {
        return [];
      }
      return mergeGroundedCandidates(
        result.candidates
          .map((entry) => normalizeGroundedCandidate(entry, company))
          .filter((entry) => candidateSourcePolicy(entry) === "extractable"),
        [],
        company,
        maxResults ?? DEFAULT_HINT_RESOLUTION_LIMIT,
      );
    },
  };
}

function buildAtsHostSearchPrompt(
  run: DiscoveryRun,
  sourceIds: AtsSourceId[],
  maxResults: number,
): string {
  const hosts = uniqueStrings(
    sourceIds.flatMap((sourceId) => ATS_HOST_QUERY_HINTS[sourceId] || []),
  );
  const config = run.config;
  return [
    "Search focus: ATS-only discovery.",
    "Find live direct ATS job pages or ATS board/listings pages only.",
    `Allowed ATS hosts: ${hosts.join(", ") || "known ATS hosts only"}`,
    "Do not return employer about/culture/benefits pages or third-party job boards.",
    `Target roles: ${joinOrAny(config.targetRoles)}`,
    `Include keywords: ${joinOrAny(config.includeKeywords)}`,
    `Exclude keywords: ${joinOrAny(config.excludeKeywords)}`,
    `Locations: ${joinOrAny(config.locations)}`,
    `Remote policy: ${config.remotePolicy || "any"}`,
    `Seniority: ${config.seniority || "any"}`,
    `Return at most ${Math.max(1, maxResults)} candidate links.`,
  ].join("\n");
}

export async function collectGroundedWebListings(input: {
  company: CompanyTarget;
  run: DiscoveryRun;
  runtimeConfig: WorkerRuntimeConfig;
  groundedSearchClient: GroundedSearchClient;
  sessionManager: BrowserUseSessionManager;
  budgetTracker?: BudgetTracker;
  log?: GroundedSearchLog;
  fetchImpl?: FetchImpl;
  isHostSuppressed?: (url: string, now?: string) => Promise<boolean> | boolean;
  isDeadLinkCoolingDown?: (
    url: string,
    now?: string,
  ) => Promise<boolean> | boolean;
  now?: string;
  abortSignal?: AbortSignal;
}): Promise<GroundedWebCollectionResult> {
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const companyLabel = describeGroundedSearchScope(input.company);
  const searchStartedAt = Date.now();
  throwIfAborted(input.abortSignal);
  const searchResult = await input.groundedSearchClient.search(
    input.company,
    input.run,
    { signal: input.abortSignal },
  );
  input.log?.("discovery.run.grounded_collection_search_completed", {
    runId: input.run.runId,
    company: input.company.name,
    companyScope: companyLabel,
    durationMs: Date.now() - searchStartedAt,
    candidateCount: searchResult.candidates.length,
    searchQueryCount: searchResult.searchQueries.length,
    warningCount: searchResult.warnings.length,
    requestFailureCount: searchResult.diagnostics?.requestFailures?.length || 0,
    ladderExhausted: searchResult.diagnostics?.ladderExhausted || false,
  });
  const warnings = [...searchResult.warnings];
  const diagnostics: ExtractionDiagnostic[] = [];

  // VAL-OBS-002: Apply budget-based page limit reduction if tracker is provided
  let basePageLimit = resolveGroundedCollectionPageLimit(
    input.run,
    input.runtimeConfig.groundedSearchMaxPagesPerCompany,
  );
  let effectivePageLimit = basePageLimit;

  if (input.budgetTracker) {
    const reductionResult = input.budgetTracker.checkPageLimitReduction(basePageLimit);
    if (reductionResult.diagnostic) {
      diagnostics.push(reductionResult.diagnostic);
      warnings.push(`Budget adaptation: ${reductionResult.diagnostic.context}`);
    }
    effectivePageLimit = Math.max(1, Math.floor(basePageLimit * reductionResult.multiplier));
  }

  const searchFailures = searchResult.diagnostics?.requestFailures || [];
  if (searchFailures.length > 0) {
    for (const failure of searchFailures) {
      diagnostics.push({
        code: "upstream_error",
        context: buildGroundedSearchFailureContext(failure),
      });
    }
  }

  const seedCandidates = await prepareGroundedSeedCandidates({
    candidates: searchResult.candidates,
    company: input.company,
    run: input.run,
    pageLimit: effectivePageLimit,
    groundedSearchClient: input.groundedSearchClient,
    fetchImpl,
    diagnostics,
    log: input.log,
    isHostSuppressed: input.isHostSuppressed,
    isDeadLinkCoolingDown: input.isDeadLinkCoolingDown,
    now: input.now,
    abortSignal: input.abortSignal,
  });
  const rawListings: RawListing[] = [];
  let pagesVisited = 0;

  for (const candidate of seedCandidates) {
    try {
      throwIfAborted(input.abortSignal);
      if (isCanonicalExtractableCandidate(candidate, input.company)) {
        diagnostics.push({
          code: "canonical_surface_extracted",
          context: `Extracting canonical employer or ATS surface ${candidate.url}.`,
          url: candidate.url,
        });
      }
      const pageStartedAt = Date.now();
      input.log?.("discovery.run.grounded_page_started", {
        runId: input.run.runId,
        company: input.company.name,
        companyScope: companyLabel,
        url: candidate.url,
        pageType: candidate.pageType,
        sourceDomain: candidate.sourceDomain,
      });
      const sessionResult = await input.sessionManager.run({
        url: candidate.url,
        instruction: buildPagePrompt(input.company, input.run, candidate),
        timeoutMs: 25_000,
        abortSignal: input.abortSignal,
      });
      pagesVisited += 1;

      // VAL-OBS-001: Detect fetch_fallback mode and emit structured diagnostic
      const sessionMode = String(sessionResult.metadata?.mode || "");
      if (sessionMode === "fetch_fallback") {
        const errorMsg = String(sessionResult.metadata?.browserUseCommandError || "browser-use command unavailable");
        diagnostics.push({
          code: "fetch_fallback",
          context: `Browser-use command failed; fell back to plain HTTP fetch for ${candidate.url}. Error: ${errorMsg}`,
          url: candidate.url,
        });
        // Also emit a backward-compatible warning
        warnings.push(
          `Session fallback: browser-use command unavailable for ${candidate.url}; used plain fetch instead.`,
        );
      }

      const listings = extractListingsFromSessionResult({
        text: sessionResult.text,
        metadata: sessionResult.metadata,
        candidate,
        company: input.company,
        searchQueries: searchResult.searchQueries,
      });
      input.log?.("discovery.run.grounded_page_completed", {
        runId: input.run.runId,
        company: input.company.name,
        companyScope: companyLabel,
        url: candidate.url,
        durationMs: Date.now() - pageStartedAt,
        sessionMode,
        textLength: sessionResult.text.length,
        extractedListingCount: listings.length,
      });

      // VAL-OBS-001: Detect low-content SPA/skeleton responses and emit structured diagnostic
      if (listings.length === 0 && sessionResult.text.length > 0) {
        const lowContentReason = detectLowContent(sessionResult.text, candidate.url);
        if (lowContentReason) {
          diagnostics.push({
            code: lowContentReason.code,
            context: lowContentReason.context,
            url: candidate.url,
          });
        }
      }

      rawListings.push(...listings);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      input.log?.("discovery.run.grounded_page_failed", {
        runId: input.run.runId,
        company: input.company.name,
        companyScope: companyLabel,
        url: candidate.url,
        error: formatError(error),
      });
      warnings.push(
        `Grounded page extraction failed for ${candidate.url}: ${formatError(error)}`,
      );
    }
  }

  // VAL-OBS-003: If no listings were extracted after all pages, emit zero_results diagnostic
  // Covers both cases: (1) seedCandidates is empty (search returned no candidates),
  // and (2) seedCandidates had candidates but all extraction attempts failed
  const dedupedListings = dedupeRawListings(rawListings);
  if (dedupedListings.length === 0 && searchFailures.length === 0) {
    const context = seedCandidates.length > 0
      ? `Extracted zero job listings from ${seedCandidates.length} preflight-approved candidate pages. All pages either had no extractable content or failed to load.`
      : searchResult.candidates.length > 0
        ? "Grounded search found candidates, but none survived canonical hint resolution and strict preflight."
        : "Grounded search returned zero candidates (no candidate URLs to extract from).";
    diagnostics.push({
      code: "zero_results",
      context,
    });
    // Only emit warning when there were candidates to extract from
    // (when seedCandidates is empty, there's nothing to warn about - the search simply found nothing)
    if (seedCandidates.length > 0) {
      warnings.push(
        `Grounded web extraction returned zero job listings from ${seedCandidates.length} candidate pages.`,
      );
    }
  }

  return {
    rawListings: dedupedListings,
    searchQueries: searchResult.searchQueries,
    seedUrls: seedCandidates.map((entry) => entry.url),
    warnings,
    pagesVisited,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
  };
}

async function prepareGroundedSeedCandidates(input: {
  candidates: GroundedSearchCandidate[];
  company: CompanyTarget;
  run: DiscoveryRun;
  pageLimit: number;
  groundedSearchClient: GroundedSearchClient;
  fetchImpl: FetchImpl;
  diagnostics: ExtractionDiagnostic[];
  log?: GroundedSearchLog;
  isHostSuppressed?: (url: string, now?: string) => Promise<boolean> | boolean;
  isDeadLinkCoolingDown?: (
    url: string,
    now?: string,
  ) => Promise<boolean> | boolean;
  now?: string;
  abortSignal?: AbortSignal;
}): Promise<GroundedSearchCandidate[]> {
  const accepted: GroundedSearchCandidate[] = [];
  const maxHintResolutions = Math.max(4, input.pageLimit * 2);
  let hintResolutions = 0;
  const suppressionNow =
    input.now || input.run.request.requestedAt || new Date().toISOString();

  for (const rawCandidate of input.candidates) {
    throwIfAborted(input.abortSignal);
    if (accepted.length >= input.pageLimit) break;

    const candidate = normalizeGroundedCandidate(rawCandidate, input.company);
    if (
      input.isDeadLinkCoolingDown &&
      await input.isDeadLinkCoolingDown(candidate.finalUrl || candidate.url, suppressionNow)
    ) {
      input.diagnostics.push({
        code: "preflight_rejected",
        context: `Strict preflight rejected ${candidate.url}: dead-link cooldown is still active from memory.`,
        url: candidate.finalUrl || candidate.url,
      });
      continue;
    }
    if (
      input.isHostSuppressed &&
      await input.isHostSuppressed(candidate.finalUrl || candidate.url, suppressionNow)
    ) {
      input.diagnostics.push({
        code: "junk_host_suppressed",
        context: `Suppressed previously low-quality host before extraction: ${candidate.finalUrl || candidate.url}`,
        url: candidate.finalUrl || candidate.url,
      });
      continue;
    }
    const policy = candidateSourcePolicy(candidate);
    if (policy === "blocked") {
      continue;
    }

    if (policy === "hint_only") {
      input.diagnostics.push({
        code: "hint_only_candidate",
        context: `Third-party board kept as hint only: ${candidate.url}`,
        url: candidate.url,
      });
      input.diagnostics.push({
        code: "third_party_extraction_blocked",
        context: `Direct extraction blocked for third-party board candidate ${candidate.url}. Canonical resolution is required first.`,
        url: candidate.url,
      });
      if (hintResolutions >= maxHintResolutions) {
        input.diagnostics.push({
          code: "hint_resolution_failed",
          context: `Skipped hint resolution for ${candidate.url}: hint resolution budget exhausted.`,
          url: candidate.url,
        });
        continue;
      }

      hintResolutions += 1;
      const resolutionStartedAt = Date.now();
      input.log?.("discovery.run.grounded_hint_resolution_started", {
        runId: input.run.runId,
        company: input.company.name,
        hintUrl: candidate.url,
        hintTitle: candidate.title,
      });
      const resolvedCandidates = input.groundedSearchClient.resolveHint
        ? await input.groundedSearchClient.resolveHint({
            candidate,
            company: input.company,
            run: input.run,
            maxResults: Math.max(1, Math.min(DEFAULT_HINT_RESOLUTION_LIMIT, input.pageLimit - accepted.length)),
            signal: input.abortSignal,
          })
        : [];
      input.log?.("discovery.run.grounded_hint_resolution_completed", {
        runId: input.run.runId,
        company: input.company.name,
        hintUrl: candidate.url,
        durationMs: Date.now() - resolutionStartedAt,
        candidateCount: resolvedCandidates.length,
      });
      if (resolvedCandidates.length === 0) {
        input.diagnostics.push({
          code: "hint_resolution_failed",
          context: `Could not resolve canonical employer or ATS page from third-party hint ${candidate.url}.`,
          url: candidate.url,
        });
        continue;
      }

      let acceptedFromHint = false;
      for (const resolvedCandidate of resolvedCandidates) {
        if (accepted.length >= input.pageLimit) break;
        const approval = await approveGroundedCandidateSet({
          candidate: {
            ...normalizeGroundedCandidate(resolvedCandidate, input.company),
            resolvedFromUrl: candidate.url,
          },
          company: input.company,
          fetchImpl: input.fetchImpl,
          abortSignal: input.abortSignal,
        });
        for (const rejection of approval.rejected) {
          input.diagnostics.push({
            code: "preflight_rejected",
            context: rejection.reason,
            url: rejection.url,
          });
        }
        for (const resolved of approval.resolved) {
          if (!isCanonicalExtractableCandidate(resolved, input.company)) continue;
          input.diagnostics.push({
            code: "canonical_surface_resolved",
            context: `Resolved canonical employer or ATS surface ${resolved.url} from third-party hint ${candidate.url}.`,
            url: resolved.url,
          });
        }
        if (approval.accepted.length === 0) {
          continue;
        }
        accepted.push(
          ...approval.accepted.slice(0, Math.max(0, input.pageLimit - accepted.length)),
        );
        acceptedFromHint = true;
      }
      if (!acceptedFromHint) {
        input.diagnostics.push({
          code: "hint_resolution_failed",
          context: `Resolved hint candidates for ${candidate.url} were rejected by strict preflight.`,
          url: candidate.url,
        });
      }
      continue;
    }

    const approval = await approveGroundedCandidateSet({
      candidate,
      company: input.company,
      fetchImpl: input.fetchImpl,
      abortSignal: input.abortSignal,
    });
    for (const rejection of approval.rejected) {
      input.diagnostics.push({
        code: "preflight_rejected",
        context: rejection.reason,
        url: rejection.url,
      });
    }
    for (const resolved of approval.resolved) {
      if (!isCanonicalExtractableCandidate(resolved, input.company)) continue;
      input.diagnostics.push({
        code: "canonical_surface_resolved",
        context: `Resolved canonical employer or ATS surface ${resolved.url} from ${candidate.url}.`,
        url: resolved.url,
      });
    }
    if (approval.accepted.length === 0) {
      continue;
    }
    accepted.push(
      ...approval.accepted.slice(0, Math.max(0, input.pageLimit - accepted.length)),
    );
  }

  return mergeGroundedCandidates(accepted, [], input.company, input.pageLimit);
}

async function preflightGroundedCandidate(input: {
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  fetchImpl: FetchImpl;
  abortSignal?: AbortSignal;
}): Promise<
  | { ok: true; candidate: GroundedSearchCandidate; discoveredCandidates: GroundedSearchCandidate[] }
  | { ok: false; url: string; reason: string }
> {
  const candidate = normalizeGroundedCandidate(input.candidate, input.company);
  const requestedUrl = candidate.url;
  try {
    throwIfAborted(input.abortSignal);
    const { response, text } = await fetchTextWithTimeout(
      requestedUrl,
      input.fetchImpl,
      PRE_FLIGHT_TIMEOUT_MS,
      input.abortSignal,
    );
    const finalUrl = cleanAbsoluteUrl(response.url || requestedUrl) || requestedUrl;
    const finalPolicy = classifySeedSourcePolicy(finalUrl);
    if (!response.ok) {
      return {
        ok: false,
        url: finalUrl,
        reason: `Strict preflight rejected ${requestedUrl}: HTTP ${response.status} at ${finalUrl}.`,
      };
    }
    if (finalPolicy !== "extractable") {
      return {
        ok: false,
        url: finalUrl,
        reason: `Strict preflight rejected ${requestedUrl}: final URL ${finalUrl} resolved to ${finalPolicy}.`,
      };
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !/(html|text\/plain|json)/i.test(contentType)) {
      return {
        ok: false,
        url: finalUrl,
        reason: `Strict preflight rejected ${requestedUrl}: unsupported content-type "${contentType}" at ${finalUrl}.`,
      };
    }

    const title = extractTitle(text) || cleanText(candidate.title);
    const rejectionReason = detectPreflightFailure({
      requestedUrl,
      finalUrl,
      title,
      text,
      contentType,
    });
    if (rejectionReason) {
      return {
        ok: false,
        url: finalUrl,
        reason: rejectionReason,
      };
    }

    const approvedCandidate = normalizeGroundedCandidate(
      {
        ...candidate,
        url: finalUrl,
        finalUrl,
        sourceDomain: safeHostname(finalUrl),
        sourcePolicy: finalPolicy,
        preflightStatus: "passed",
        preflightReason: "",
      },
      input.company,
    );
    const shouldDiscoverCanonicalSurfaces =
      approvedCandidate.pageType === "other" ||
      !isCanonicalExtractableCandidate(approvedCandidate, input.company);
    const discoveredCandidates = !shouldDiscoverCanonicalSurfaces
      ? []
      : detectCareerSurfaceCandidatesFromHtml({
          url: requestedUrl,
          finalUrl,
          html: text,
          company: input.company,
          sourceLane: approvedCandidate.sourceLane || "grounded_web",
          title,
        }).candidates
          .map((entry) =>
            normalizeGroundedCandidate(
              {
                ...entry,
                resolvedFromUrl: entry.resolvedFromUrl || approvedCandidate.url,
              },
              input.company,
            ),
          )
          .filter((entry) => {
            const key = entry.finalUrl || entry.canonicalUrl || entry.url;
            const approvedKey =
              approvedCandidate.finalUrl ||
              approvedCandidate.canonicalUrl ||
              approvedCandidate.url;
            return key !== approvedKey;
          });

    return {
      ok: true,
      candidate: approvedCandidate,
      discoveredCandidates: mergeGroundedCandidates(
        discoveredCandidates,
        [],
        input.company,
        6,
      ),
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return {
      ok: false,
      url: requestedUrl,
      reason: `Strict preflight rejected ${requestedUrl}: ${formatError(error)}.`,
    };
  }
}

async function approveGroundedCandidateSet(input: {
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  fetchImpl: FetchImpl;
  abortSignal?: AbortSignal;
}): Promise<{
  accepted: GroundedSearchCandidate[];
  resolved: GroundedSearchCandidate[];
  rejected: Array<{ url: string; reason: string }>;
}> {
  const firstPass = await preflightGroundedCandidate(input);
  if (!firstPass.ok) {
    return {
      accepted: [],
      resolved: [],
      rejected: [{ url: firstPass.url, reason: firstPass.reason }],
    };
  }

  const accepted: GroundedSearchCandidate[] = [firstPass.candidate];
  const resolved: GroundedSearchCandidate[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];
  const seen = new Set<string>([
    firstPass.candidate.finalUrl ||
      firstPass.candidate.canonicalUrl ||
      firstPass.candidate.url,
  ]);

  for (const discoveredCandidate of firstPass.discoveredCandidates) {
    const key =
      discoveredCandidate.finalUrl ||
      discoveredCandidate.canonicalUrl ||
      discoveredCandidate.url;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const followUp = await preflightGroundedCandidate({
      candidate: discoveredCandidate,
      company: input.company,
      fetchImpl: input.fetchImpl,
      abortSignal: input.abortSignal,
    });
    if (!followUp.ok) {
      rejected.push({ url: followUp.url, reason: followUp.reason });
      continue;
    }
    accepted.push(followUp.candidate);
    resolved.push(followUp.candidate);
  }

  return {
    accepted: mergeGroundedCandidates(accepted, [], input.company, accepted.length || 1),
    resolved: mergeGroundedCandidates(resolved, [], input.company, resolved.length || 1),
    rejected,
  };
}

async function fetchTextWithTimeout(
  url: string,
  fetchImpl: FetchImpl,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<{ response: Response; text: string }> {
  throwIfAborted(abortSignal);
  const controller = new AbortController();
  const abortHandler = () => controller.abort(abortSignal?.reason);
  abortSignal?.addEventListener("abort", abortHandler, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", abortHandler);
  }
}

function detectPreflightFailure(input: {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text: string;
  contentType: string;
}): string | null {
  const title = cleanText(input.title);
  const plainText = normalizeWhitespace(stripHtml(htmlDecode(input.text))).slice(0, 6000);
  const haystack = `${title}\n${plainText}`.toLowerCase();
  const lowContentReason = detectLowContent(input.text, input.finalUrl);

  if (!input.text.trim()) {
    return `Strict preflight rejected ${input.requestedUrl}: empty response body at ${input.finalUrl}.`;
  }
  if (/(captcha|verify you are human|unusual traffic|access denied|forbidden|unauthorized)/i.test(haystack)) {
    return `Strict preflight rejected ${input.requestedUrl}: blocked or gated page at ${input.finalUrl}.`;
  }
  if (/(page not found|404|not found|job is no longer available|position has been filled|no longer accepting applications)/i.test(haystack)) {
    return `Strict preflight rejected ${input.requestedUrl}: broken or expired job page at ${input.finalUrl}.`;
  }
  if (/(sign in to continue|log in to continue|login required|please sign in)/i.test(haystack)) {
    return `Strict preflight rejected ${input.requestedUrl}: login wall at ${input.finalUrl}.`;
  }
  if (lowContentReason) {
    return `Strict preflight rejected ${input.requestedUrl}: ${lowContentReason.context}`;
  }
  if (isLikelyInformationalJobPage(input.finalUrl, title)) {
    return `Strict preflight rejected ${input.requestedUrl}: informational company content at ${input.finalUrl}.`;
  }

  const inferredPageType = classifyPageType(input.finalUrl, title);
  if (inferredPageType === "other" && !hasStrongPreflightSignals(input.finalUrl, title, plainText, input.contentType)) {
    return `Strict preflight rejected ${input.requestedUrl}: weak job signals at ${input.finalUrl}.`;
  }

  return null;
}

function hasStrongPreflightSignals(
  url: string,
  title: string,
  text: string,
  contentType: string,
): boolean {
  if (/application\/json/i.test(contentType) && /jobposting/i.test(text)) {
    return true;
  }
  if (isKnownAtsJobHost(url)) {
    return true;
  }
  const haystack = `${title}\n${text}`.toLowerCase();
  return (
    /jobposting/i.test(text) ||
    /\b(apply now|apply for this job|job description|responsibilities|qualifications|about the role|open roles|view all jobs|search jobs|career opportunities)\b/i.test(haystack)
  );
}

/**
 * Detects low-content SPA/skeleton responses and returns a diagnostic if detected.
 * VAL-OBS-001: Low-content diagnostics for likely SPA or skeleton HTML responses.
 */
function detectLowContent(
  text: string,
  url: string,
): { code: "low_content_spa" | "low_content_html"; context: string } | null {
  const trimmed = String(text || "").trim();
  const length = trimmed.length;

  // Very short responses are likely SPA loading states or empty shells
  if (length < 500) {
    return {
      code: "low_content_spa",
      context: `Response is only ${length} characters, likely an SPA loading state or skeleton HTML for ${url}.`,
    };
  }

  // Check for skeleton/loading patterns in the HTML
  const skeletonPatterns = [
    /class=".*skeleton.*"/i,
    /class=".*loading.*"/i,
    /class=".*placeholder.*"/i,
    /<div[^>]*>\s*<\/div>\s*<div[^>]*>\s*<\/div>\s*<div[^>]*>/i, // Empty div chains
    /text-align:\s*center.*loading/i,
    /spinner/i,
    /cargando/i, // Spanish "loading"
  ];

  for (const pattern of skeletonPatterns) {
    if (pattern.test(trimmed)) {
      return {
        code: "low_content_spa",
        context: `Response for ${url} contains skeleton/loading patterns suggesting an SPA or dynamic loading state.`,
      };
    }
  }

  // Check if it's mostly HTML with minimal extractable content
  // A response with lots of HTML tags but little actual text content
  const htmlTagCount = (trimmed.match(/<[^>]+>/g) || []).length;
  const textContentRatio = length > 0 ? (trimmed.replace(/<[^>]+>/g, "").length / length) : 0;

  // If more than 50% of characters are HTML tags and total length < 2000, likely a minimal/broken page
  if (htmlTagCount > 20 && textContentRatio < 0.3 && length < 2000) {
    return {
      code: "low_content_html",
      context: `Response for ${url} is mostly HTML markup (${htmlTagCount} tags, ${(textContentRatio * 100).toFixed(1)}% text content) with minimal extractable content.`,
    };
  }

  return null;
}

function buildSearchPrompt(
  company: CompanyTarget,
  run: DiscoveryRun,
  maxResults: number,
): string {
  const config = run.config;
  const isUnrestrictedScope = !company.name;

  // For unrestricted scope (empty company name), compose query from modifiers only
  // without placeholder company artifacts that could bias search toward irrelevant terms.
  // VAL-ROUTE-010: grounded query evidence is modifier-driven, not placeholder-company-driven.
  const lines: string[] = [];

  if (isUnrestrictedScope) {
    // Unrestricted: search is driven by modifier fields only
    // Do NOT include "Company:" with empty value - it creates misleading placeholder artifacts
    lines.push("Search focus: Modifier-driven intent search (no fixed company target)");
  } else {
    lines.push(`Company: ${company.name}`);
  }

  lines.push(
    `Target roles: ${joinOrAny(config.targetRoles)}`,
    `Include keywords: ${joinOrAny([
      ...config.includeKeywords,
      ...(company.includeKeywords || []),
    ])}`,
    `Exclude keywords: ${joinOrAny([
      ...config.excludeKeywords,
      ...(company.excludeKeywords || []),
    ])}`,
    `Locations: ${joinOrAny(config.locations)}`,
    `Remote policy: ${config.remotePolicy || "any"}`,
    `Seniority: ${config.seniority || "any"}`,
    `Return at most ${Math.max(1, maxResults)} candidate links.`,
    "Mix direct employer job pages with expandable careers/listings pages when useful.",
  );

  return lines.join("\n");
}

function buildPagePrompt(
  company: CompanyTarget,
  run: DiscoveryRun,
  candidate: GroundedSearchCandidate,
): string {
  const config = run.config;
  return [
    PAGE_EXTRACTION_PROMPT,
    `Target company: ${company.name}`,
    `Seed page type: ${candidate.pageType}`,
    `Seed link reason: ${candidate.reason || "search result"}`,
    `Target roles: ${joinOrAny(config.targetRoles)}`,
    `Include keywords: ${joinOrAny([
      ...config.includeKeywords,
      ...(company.includeKeywords || []),
    ])}`,
    `Exclude keywords: ${joinOrAny([
      ...config.excludeKeywords,
      ...(company.excludeKeywords || []),
    ])}`,
    `Locations: ${joinOrAny(config.locations)}`,
    `Remote policy: ${config.remotePolicy || "any"}`,
    `Seniority: ${config.seniority || "any"}`,
  ].join("\n");
}

function buildHintResolutionPrompt(
  candidate: GroundedSearchCandidate,
  company: CompanyTarget,
  run: DiscoveryRun,
  maxResults: number,
): string {
  const hintedTitle = inferHintJobTitle(candidate.title);
  const hintedCompany = uniqueStrings([
    cleanText(company.name),
    inferCompanyFromTitle(candidate.title),
  ])[0] || "";
  const hintedLocation = inferHintLocation(candidate.title);
  const config = run.config;

  return [
    "Resolve this third-party job hint to a canonical employer or ATS page.",
    "Return strict JSON only.",
    'Use this shape: {"results":[{"url":"https://...","title":"...","pageType":"job|listings|careers|other","reason":"..."}]}.',
    "Only return direct employer career sites or trusted ATS job pages.",
    "Do not return LinkedIn, Glassdoor, Indeed, WorkingNomads, RemoteOK, We Work Remotely, Remote.co, Remotive, Jobspresso, JobGether, Himalayas, FlexJobs, Adzuna, CareerJet, JobRapido, JobIsJob, Google, or other third-party aggregators.",
    `Hint URL: ${candidate.url}`,
    `Hint title: ${candidate.title}`,
    `Hinted job title: ${hintedTitle || "unknown"}`,
    `Hinted company: ${hintedCompany || "unknown"}`,
    `Hinted location: ${hintedLocation || "unknown"}`,
    `Target roles: ${joinOrAny(config.targetRoles)}`,
    `Include keywords: ${joinOrAny([
      ...config.includeKeywords,
      ...(company.includeKeywords || []),
    ])}`,
    `Locations: ${joinOrAny(config.locations)}`,
    `Remote policy: ${config.remotePolicy || "any"}`,
    `Return at most ${Math.max(1, maxResults)} candidate links.`,
    "Prefer ATS hosts like Greenhouse, Lever, Ashby, Workday, iCIMS, Jobvite, Taleo, and SuccessFactors.",
  ].join("\n");
}

function inferHintJobTitle(title: string): string {
  const cleaned = cleanText(title)
    .replace(
      /\b(linkedin|glassdoor|indeed|monster|ziprecruiter|careerbuilder|simplyhired|builtin|wellfound|angel\.co|otta|working\s+nomads|remote\s*ok|remote\.co|we\s*work\s*remotely|remotive|dynamite\s*jobs|jobspresso|jobgether|himalayas|flexjobs|power\s*to\s*fly|jooble|jobisjob|careerjet|jobrapido|adzuna|jobtoday)\b/gi,
      "",
    )
    .replace(/\s+[|:]\s+.*$/, "")
    .trim();
  const atMatch = cleaned.match(/^(.+?)\s+\bat\b\s+.+$/i);
  if (atMatch?.[1] && isLikelyJobTitle(atMatch[1])) {
    return cleanText(atMatch[1]);
  }
  const parts = cleaned
    .split(/\s+[|:–—-]\s+/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
  for (const part of parts) {
    if (isLikelyJobTitle(part)) return part;
  }
  return isLikelyJobTitle(cleaned) ? cleaned : "";
}

function inferHintLocation(title: string): string {
  const cleaned = cleanText(title);
  if (!cleaned) return "";
  if (/\bremote\b/i.test(cleaned)) {
    return "Remote";
  }
  const parts = cleaned
    .split(/\s+[|:–—-]\s+/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
  for (const part of parts) {
    if (/^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}$/i.test(part)) {
      return part;
    }
  }
  return "";
}

function resolveGroundedCollectionPageLimit(
  run: DiscoveryRun,
  fallbackPageLimit: number,
): number {
  const configuredPageLimit = run.config.groundedSearchTuning?.maxPagesPerCompany;
  if (
    typeof configuredPageLimit === "number" &&
    Number.isFinite(configuredPageLimit) &&
    configuredPageLimit > 0
  ) {
    return Math.max(1, Math.floor(configuredPageLimit));
  }
  if (typeof fallbackPageLimit === "number" && Number.isFinite(fallbackPageLimit) && fallbackPageLimit > 0) {
    return Math.max(1, Math.floor(fallbackPageLimit));
  }
  return 1;
}

function inferDirectPageTitle(input: {
  text: string;
  metadata: Record<string, unknown>;
  candidate: GroundedSearchCandidate;
}): string {
  const candidates = uniqueStrings([
    extractMetaContent(input.text, "property", "og:title"),
    extractMetaContent(input.text, "name", "twitter:title"),
    extractTagText(input.text, "title"),
    extractTagText(input.text, "h1"),
    cleanText(String(input.metadata?.title || "")),
    cleanText(input.candidate.title),
  ]);
  return candidates.find((entry) => isLikelyJobTitle(entry)) || "";
}

function inferCompanyFromPageSignals(input: {
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  metadata: Record<string, unknown>;
  pageText: string;
  title?: string;
}): string {
  const inferred = uniqueStrings([
    cleanText(input.company.name),
    extractCompanyFromTextSignals(input.pageText),
    inferCompanyFromTitle(cleanText(String(input.metadata?.title || ""))),
    inferCompanyFromTitle(input.title || ""),
    inferCompanyFromTitle(cleanText(input.candidate.title)),
    extractMetaContent(input.pageText, "property", "og:site_name"),
    inferCompanyFromJobHost(input.candidate.url),
  ]);
  return inferred.find(Boolean) || "";
}

function inferLocationFromPageSignals(text: string): string {
  const plainText = normalizeWhitespace(stripHtml(htmlDecode(text)));
  const labelMatch = plainText.match(
    /\b(?:location|locations|based in)\b[:\s-]+([A-Z][A-Za-z0-9 ,/&()-]{2,80})(?:\s{2,}|$)/i,
  );
  if (labelMatch?.[1]) {
    return cleanText(labelMatch[1]);
  }
  if (/\bremote\b/i.test(plainText)) {
    return "Remote";
  }
  return "";
}

function extractDescriptionSnippet(text: string, metadata: Record<string, unknown>): string {
  const snippets = uniqueStrings([
    extractMetaContent(text, "name", "description"),
    extractMetaContent(text, "property", "og:description"),
    extractTagText(text, "p"),
    cleanText(String(metadata?.description || "")),
  ]);
  return snippets.find((entry) => entry.length >= 24) || "";
}

function extractAnchorTitle(anchorHtml: string, innerHtml: string): string {
  const titleCandidates = uniqueStrings([
    readHtmlAttribute(anchorHtml, "data-job-title"),
    readHtmlAttribute(anchorHtml, "data-title"),
    readHtmlAttribute(anchorHtml, "aria-label"),
    cleanText(stripHtml(innerHtml)),
    readHtmlAttribute(anchorHtml, "title"),
  ]);
  return titleCandidates.find((entry) => isLikelyJobTitle(entry)) || "";
}

function readHtmlAttribute(fragment: string, attributeName: string): string {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(fragment || "").match(
    new RegExp(`${escapedName}\\s*=\\s*["']([^"']+)["']`, "i"),
  );
  return cleanText(htmlDecode(match?.[1] || ""));
}

function extractMetaContent(
  html: string,
  attributeName: "name" | "property",
  attributeValue: string,
): string {
  const escapedValue = attributeValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta\\b[^>]*${attributeName}\\s*=\\s*["']${escapedValue}["'][^>]*content\\s*=\\s*["']([^"']+)["'][^>]*>`,
    "i",
  );
  const reversedPattern = new RegExp(
    `<meta\\b[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*${attributeName}\\s*=\\s*["']${escapedValue}["'][^>]*>`,
    "i",
  );
  const match = String(html || "").match(pattern) || String(html || "").match(reversedPattern);
  return cleanText(htmlDecode(match?.[1] || ""));
}

function extractTagText(html: string, tagName: string): string {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(
    new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"),
  );
  return cleanText(stripHtml(htmlDecode(match?.[1] || "")));
}

function extractTitle(html: string): string {
  return extractTagText(html, "title");
}

function extractCompanyFromTextSignals(text: string): string {
  const plainText = normalizeWhitespace(stripHtml(htmlDecode(text)));
  const match = plainText.match(
    /\b(?:company|organization|employer|team)\b[:\s-]+([A-Z][A-Za-z0-9 '&.-]{1,80})(?:\s{2,}|$)/i,
  );
  if (!match?.[1]) return "";
  const candidate = cleanText(match[1]);
  return isLikelyCompanyName(candidate) ? candidate : "";
}

function inferCompanyFromTitle(title: string): string {
  const cleaned = cleanText(title);
  if (!cleaned) return "";

  const atMatch = cleaned.match(/\bat\s+(.+)$/i);
  if (atMatch?.[1]) {
    const company = cleanText(atMatch[1]);
    if (isLikelyCompanyName(company)) {
      return company;
    }
  }

  const parts = cleaned
    .split(/\s+[|:–—-]\s+/)
    .map((entry) => cleanText(entry))
    .filter(Boolean);
  if (parts.length < 2) {
    return "";
  }

  for (const part of parts) {
    if (isLikelyCompanyName(part) && !isLikelyJobTitle(part)) {
      return part;
    }
  }

  return "";
}

function inferCompanyFromJobHost(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathSegments = parsed.pathname.split("/").map((entry) => entry.trim()).filter(Boolean);

    if (/(\.|^)lever\.co$/i.test(hostname) && pathSegments[0]) {
      return humanizeCompanySlug(pathSegments[0]);
    }
    if (/greenhouse\.io$/i.test(hostname) && pathSegments[0]) {
      return humanizeCompanySlug(pathSegments[0]);
    }
    if (hostname === "jobs.ashbyhq.com" && pathSegments[0]) {
      return humanizeCompanySlug(pathSegments[0]);
    }
    if (hostname === "apply.workable.com" && pathSegments[0]) {
      return humanizeCompanySlug(pathSegments[0]);
    }
    if (hostname === "jobs.smartrecruiters.com" && pathSegments[0]) {
      return humanizeCompanySlug(pathSegments[0]);
    }
    if (!isLikelyThirdPartyJobHost(url)) {
      const hostParts = hostname.split(".");
      const bestToken = /^(careers|jobs|join|apply|work|career)$/i.test(hostParts[0] || "")
        ? hostParts[1] || hostParts[0] || ""
        : hostParts.length >= 2
          ? hostParts[hostParts.length - 2]
          : hostParts[0] || "";
      return humanizeCompanySlug(bestToken);
    }
  } catch {
    return "";
  }

  return "";
}

function humanizeCompanySlug(input: string): string {
  const cleaned = String(input || "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isLikelyCompanyName(input: string): boolean {
  const cleaned = cleanText(input);
  if (!cleaned || cleaned.length < 2) return false;
  if (isLikelyJobTitle(cleaned)) return false;
  if (/\b(careers?|jobs?|remote|united states|apply|view all)\b/i.test(cleaned)) return false;
  if (/\b(built in|wellfound|otta|linkedin|indeed|glassdoor|remoteok|we work remotely)\b/i.test(cleaned)) {
    return false;
  }
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) {
    return false;
  }
  return /[a-z]/i.test(cleaned);
}

function extractListingsFromSessionResult(input: {
  text: string;
  metadata: Record<string, unknown>;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing[] {
  const structured = extractListingsFromStructuredText(input);
  if (structured.length) return structured;

  if (looksLikeHtml(input.text)) {
    const jsonLdListings = extractListingsFromJsonLd(input);
    if (jsonLdListings.length) return jsonLdListings;
  }

  const directPageListing = extractListingFromDirectPageSignals(input);
  if (directPageListing) {
    return [directPageListing];
  }

  if (looksLikeHtml(input.text)) {
    return extractListingsFromHtmlLinks(input);
  }

  return [];
}

function extractListingsFromStructuredText(input: {
  text: string;
  metadata: Record<string, unknown>;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing[] {
  const parsed = parseJsonLoose(input.text);
  const items = extractStructuredListingItems(parsed);
  return items
    .map((item) =>
      toRawListing(item, {
        candidate: input.candidate,
        company: input.company,
        searchQueries: input.searchQueries,
        extractionMode: "structured",
      }),
    )
    .filter((item): item is RawListing => !!item);
}

function extractListingsFromJsonLd(input: {
  text: string;
  metadata: Record<string, unknown>;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing[] {
  const listings: RawListing[] = [];
  const pattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(String(input.text || "")))) {
    const parsed = parseJsonLoose(htmlDecode(match[1] || ""));
    for (const entry of flattenJsonLdNodes(parsed)) {
      if (!isJobPostingNode(entry)) continue;
      const listing = toRawListing(entry, {
        candidate: input.candidate,
        company: input.company,
        searchQueries: input.searchQueries,
        extractionMode: "json_ld",
      });
      if (listing) listings.push(listing);
    }
  }
  return dedupeRawListings(listings);
}

function extractListingsFromHtmlLinks(input: {
  text: string;
  metadata: Record<string, unknown>;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing[] {
  const listings: RawListing[] = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkPattern.exec(String(input.text || "")))) {
    const url = resolveUrl(input.candidate.url, match[1] || "");
    if (!url || !isLikelyJobLink(url)) continue;
    const title = extractAnchorTitle(match[0] || "", match[2] || "");
    if (!isLikelyJobTitle(title)) continue;
    const listing = toRawListing(
      {
        title,
        url,
        company: inferCompanyFromPageSignals({
          candidate: input.candidate,
          company: input.company,
          metadata: input.metadata,
          pageText: input.text,
        }),
      },
      {
        candidate: input.candidate,
        company: input.company,
        searchQueries: input.searchQueries,
        extractionMode: "html_link",
      },
    );
    if (listing) listings.push(listing);
  }
  return dedupeRawListings(listings).slice(0, 8);
}

function extractListingFromDirectPageSignals(input: {
  text: string;
  metadata: Record<string, unknown>;
  candidate: GroundedSearchCandidate;
  company: CompanyTarget;
  searchQueries: string[];
}): RawListing | null {
  const isDirectPage =
    input.candidate.pageType === "job" || isLikelyJobLink(input.candidate.url);
  if (!isDirectPage) {
    return null;
  }

  const title = inferDirectPageTitle(input);
  if (!title || !isLikelyJobTitle(title)) {
    return null;
  }

  const company = inferCompanyFromPageSignals({
    candidate: input.candidate,
    company: input.company,
    metadata: input.metadata,
    pageText: input.text,
    title,
  });
  if (!company) {
    return null;
  }

  if (!hasStrongDirectPageEvidence(input, title, company)) {
    return null;
  }

  return toRawListing(
    {
      title,
      company,
      location: inferLocationFromPageSignals(input.text),
      url: input.candidate.url,
      descriptionText: extractDescriptionSnippet(input.text, input.metadata),
    },
    {
      candidate: input.candidate,
      company: input.company,
      searchQueries: input.searchQueries,
      extractionMode: "page_signals",
    },
  );
}

function toRawListing(
  source: unknown,
  context: {
    candidate: GroundedSearchCandidate;
    company: CompanyTarget;
    searchQueries: string[];
    extractionMode: string;
  },
): RawListing | null {
  const record = isPlainRecord(source) ? source : {};
  const title = readFirstStringValue(record, [
    "title",
    "jobTitle",
    "role",
    "position",
    "name",
    "text",
  ]);
  if (!isLikelyJobTitle(title)) return null;

  const url = resolveUrl(
    context.candidate.url,
    readFirstStringValue(record, [
      "url",
      "jobUrl",
      "applyUrl",
      "link",
      "hostedUrl",
    ]) || context.candidate.url,
  );
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (classifySeedSourcePolicy(url) !== "extractable") return null;

  const companyName =
    readFirstStringValue(record, [
      "company",
      "employer",
      "organization",
      "organizationName",
    ]) ||
    objectString(record, "company", "name") ||
    objectString(record, "hiringOrganization", "name") ||
    context.company.name;

  if (!companiesLikelyMatch(companyName, context.company.name)) {
    return null;
  }
  if (!hasStrongExtractionEvidence(record, context, url, companyName)) {
    return null;
  }

  return {
    sourceId: "grounded_web",
    sourceLabel: "Grounded Search",
    title,
    company: companyName,
    location: cleanText(
      readFirstStringValue(record, [
        "location",
        "applicantLocationRequirements",
      ]) ||
        objectString(record, "jobLocation", "address", "addressLocality") ||
        objectString(record, "jobLocation", "name"),
    ),
    url,
    compensationText: cleanText(
      readFirstStringValue(record, [
        "compensationText",
        "compensation",
        "salary",
        "salaryRange",
      ]) ||
        objectString(record, "baseSalary", "value", "value") ||
        objectString(record, "baseSalary", "value", "minValue"),
    ),
    contact: readFirstStringValue(record, [
      "contact",
      "recruiter",
      "hiringManager",
    ]),
    descriptionText: cleanText(
      readFirstStringValue(record, [
        "descriptionText",
        "description",
        "summary",
        "excerpt",
      ]),
    ),
    tags: uniqueStrings([
      ...readStringArray(record.tags),
      ...readStringArray(record.keywords),
      ...readStringArray(record.departments),
      ...readStringArray(record.teams),
    ]),
    providerType: context.candidate.providerType,
    canonicalUrl: context.candidate.canonicalUrl,
    finalUrl: context.candidate.finalUrl,
    sourceLane: context.candidate.sourceLane || "grounded_web",
    metadata: {
      sourceQuery: uniqueStrings([
        ...context.searchQueries,
        context.candidate.url,
      ]).join(" | "),
      extractionMode: context.extractionMode,
      seedPageType: context.candidate.pageType,
      seedReason: context.candidate.reason,
      seedTitle: context.candidate.title,
      seedDomain: context.candidate.sourceDomain,
      seedPolicy: candidateSourcePolicy(context.candidate),
      preflightStatus: context.candidate.preflightStatus || "",
      resolvedFromUrl: context.candidate.resolvedFromUrl || "",
      canonicalUrl: context.candidate.canonicalUrl || "",
      providerType: context.candidate.providerType || "",
      boardToken: context.candidate.boardToken || "",
      surfaceType: context.candidate.surfaceType || "",
      sourceLane: context.candidate.sourceLane || "grounded_web",
    },
  };
}

function hasStrongDirectPageEvidence(
  input: {
    text: string;
    metadata: Record<string, unknown>;
    candidate: GroundedSearchCandidate;
    company: CompanyTarget;
    searchQueries: string[];
  },
  title: string,
  company: string,
): boolean {
  if (isLikelyInformationalJobPage(input.candidate.url, title)) {
    return false;
  }
  const haystack = `${title}\n${cleanText(String(input.metadata?.title || ""))}\n${input.text}`.toLowerCase();
  return (
    /jobposting/i.test(input.text) ||
    isKnownAtsJobHost(input.candidate.url) ||
    /\b(apply now|apply for this job|job description|responsibilities|qualifications|about the role)\b/i.test(haystack) ||
    (candidateSourcePolicy(input.candidate) === "extractable" &&
      cleanText(company).length > 1 &&
      cleanText(title).length > 3 &&
      cleanText(extractDescriptionSnippet(input.text, input.metadata)).length >= 24)
  );
}

function hasStrongExtractionEvidence(
  record: AnyRecord,
  context: {
    candidate: GroundedSearchCandidate;
    company: CompanyTarget;
    searchQueries: string[];
    extractionMode: string;
  },
  url: string,
  companyName: string,
): boolean {
  const description = cleanText(
    readFirstStringValue(record, ["descriptionText", "description", "summary", "excerpt"]),
  );
  if (context.extractionMode === "json_ld") {
    return true;
  }
  if (isKnownAtsJobHost(url)) {
    return true;
  }
  if (context.candidate.preflightStatus === "passed" && context.candidate.pageType === "job") {
    return true;
  }
  if (objectString(record, "hiringOrganization", "name")) {
    return true;
  }
  if (readFirstStringValue(record, ["applyUrl", "jobUrl", "hostedUrl"])) {
    return true;
  }
  if (
    context.extractionMode === "structured" &&
    isLikelyJobLink(url) &&
    cleanText(companyName).length > 1 &&
    description.length >= 24
  ) {
    return true;
  }
  if (
    context.extractionMode === "page_signals" &&
    cleanText(companyName).length > 1 &&
    description.length >= 24
  ) {
    return true;
  }
  return context.extractionMode === "html_link" && isLikelyJobLink(url);
}

/**
 * Result of URL extraction from text, including whether regex fallback was used.
 */
type ExtractCandidatesResult = {
  candidates: GroundedSearchCandidate[];
  /** True if JSON parsing failed/empty and regex fallback recovered candidates. */
  regexFallbackUsed: boolean;
  /** True if JSON parsing failed/empty and regex fallback was attempted (regardless of outcome). */
  regexFallbackAttempted: boolean;
};

/**
 * Extracts HTTPS URLs from conversational/non-JSON text using regex fallback.
 * VAL-DATA-001: Regex fallback recovers exact supported canonical URL set.
 */
function extractUrlsViaRegex(text: string, company: CompanyTarget): GroundedSearchCandidate[] {
  // Match HTTPS URLs that look like job/careers links
  const urlPattern = /https:\/\/[^\s<>"')\]]+/gi;
  const matches = String(text).match(urlPattern) || [];

  // Dedupe and normalize URLs
  const uniqueUrls = [...new Set(matches.map((url) => {
    try {
      return new URL(url).toString();
    } catch {
      return url;
    }
  }))];

  // Convert to candidates, filtering by supported URLs only
  const candidates: GroundedSearchCandidate[] = [];
  for (const url of uniqueUrls) {
    const candidate = toGroundedCandidate(
      {
        url,
        title: url, // Use URL as title since we don't have structured data
        pageType: classifyPageType(url, ""),
        reason: "Regex fallback extraction from conversational output",
      },
      company,
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

/**
 * Extracts grounded candidates from text, with regex fallback for non-JSON output.
 * VAL-DATA-001: Handles zero-supported case explicitly with fallback attribution.
 */
function extractGroundedCandidatesFromText(
  text: string,
  company: CompanyTarget,
): ExtractCandidatesResult {
  const parsed = parseJsonLoose(text);
  const rows = isPlainRecord(parsed)
    ? Array.isArray(parsed.results)
      ? parsed.results
      : Array.isArray(parsed.candidates)
        ? parsed.candidates
        : Array.isArray(parsed.links)
          ? parsed.links
          : []
    : Array.isArray(parsed)
      ? parsed
      : [];

  const candidates = rows
    .map((entry) => toGroundedCandidate(entry, company))
    .filter((entry): entry is GroundedSearchCandidate => !!entry);

  // VAL-DATA-001: If JSON parsing yielded no candidates, fall back to regex URL extraction
  // This handles conversational/non-JSON grounded output
  if (candidates.length === 0 && text.trim().length > 0) {
    const regexCandidates = extractUrlsViaRegex(text, company);
    // regexFallbackUsed signals that candidates were recovered via regex fallback
    // (only set to true when regex actually recovered candidates)
    // regexFallbackAttempted tracks that fallback was used regardless of outcome
    return {
      candidates: regexCandidates,
      regexFallbackUsed: regexCandidates.length > 0,
      regexFallbackAttempted: true,
    };
  }

  return {
    candidates,
    regexFallbackUsed: false,
    regexFallbackAttempted: false,
  };
}

function extractGroundedCandidatesFromMetadata(
  groundingMetadata: AnyRecord | null,
  company: CompanyTarget,
): GroundedSearchCandidate[] {
  const chunks = Array.isArray(groundingMetadata?.groundingChunks)
    ? groundingMetadata.groundingChunks
    : [];
  return chunks
    .map((chunk) => {
      const record = isPlainRecord(chunk) ? chunk : {};
      const web = isPlainRecord(record.web) ? record.web : {};
      return toGroundedCandidate(
        {
          url: cleanText(web.uri),
          title: cleanText(web.title),
          pageType: classifyPageType(cleanText(web.uri), cleanText(web.title)),
          reason: "Grounded Google Search citation",
        },
        company,
      );
    })
    .filter((entry): entry is GroundedSearchCandidate => !!entry);
}

function toGroundedCandidate(
  source: unknown,
  company: CompanyTarget,
): GroundedSearchCandidate | null {
  const record = isPlainRecord(source) ? source : {};
  return resolveCareerSurfaceCandidate(
    {
      url: readFirstStringValue(record, ["url", "uri", "link", "href"]),
      title: readFirstStringValue(record, ["title", "name"]),
      pageType:
        readFirstStringValue(record, ["pageType", "type"]) ||
        classifyPageType(
          readFirstStringValue(record, ["url", "uri", "link", "href"]),
          readFirstStringValue(record, ["title", "name"]),
        ),
      reason:
        readFirstStringValue(record, ["reason", "why"]) ||
        `Grounded search result for ${company.name}`,
    },
    company,
    {
      sourceLane: "grounded_web",
    },
  );
}

function mergeGroundedCandidates(
  explicit: GroundedSearchCandidate[],
  cited: GroundedSearchCandidate[],
  company: CompanyTarget,
  limit: number,
): GroundedSearchCandidate[] {
  return mergeCareerSurfaceCandidates([...explicit, ...cited], company, limit);
}

/**
 * Checks if a URL appears to be a first-party employer domain.
 * First-party means the URL is on the employer's own domain (e.g., careers.acme.com, acme.com/careers).
 * VAL-DATA-003: Employer-domain bonus prioritizes first-party career pages.
 */
function isEmployerDomain(url: string, companyName: string): boolean {
  return isEmployerCareerSurface(url, { name: companyName });
}

function candidateScore(
  candidate: GroundedSearchCandidate,
  company: CompanyTarget,
): number {
  return scoreCareerSurfaceCandidate(normalizeGroundedCandidate(candidate, company), company);
}

function isKnownAtsJobHost(url: string): boolean {
  return isKnownAtsCareerSurface(url);
}

function isLikelyThirdPartyJobHost(url: string): boolean {
  return isThirdPartyCareerSurface(url);
}

function classifyPageType(url: string, title: string): GroundedSearchCandidate["pageType"] {
  return classifyCareerSurfacePageType(url, title);
}

function normalizePageType(value: string): GroundedSearchCandidate["pageType"] {
  const text = String(value || "").toLowerCase();
  if (text === "job" || text === "jobs" || text === "posting") return "job";
  if (text === "listings" || text === "listing" || text === "board") return "listings";
  if (text === "careers" || text === "career") return "careers";
  return "other";
}

function classifySeedSourcePolicy(url: string): GroundedCandidateSourcePolicy {
  return classifyCareerSurfaceSourcePolicy(url);
}

/**
 * Checks if a URL is a supported seed URL.
 * Blocked URLs are still rejected, while hint-only URLs remain available for
 * canonical resolution.
 */
function isSupportedSeedUrl(url: string): boolean {
  return !!canonicalizeCareerSurfaceUrl(url) && classifySeedSourcePolicy(url) !== "blocked";
}

function candidateSourcePolicy(candidate: GroundedSearchCandidate): GroundedCandidateSourcePolicy {
  return candidate.sourcePolicy || classifySeedSourcePolicy(candidate.finalUrl || candidate.url);
}

function isCanonicalExtractableCandidate(
  candidate: GroundedSearchCandidate,
  company: CompanyTarget,
): boolean {
  const normalized = normalizeGroundedCandidate(candidate, company);
  if (normalized.sourcePolicy !== "extractable") return false;
  if (normalized.providerType) return true;
  if (isEmployerCareerSurface(normalized.finalUrl || normalized.url, company)) {
    return true;
  }
  return !isLikelyThirdPartyJobHost(normalized.finalUrl || normalized.url);
}

function normalizeGroundedCandidate(
  candidate: GroundedSearchCandidate,
  company: CompanyTarget = { name: "" },
): GroundedSearchCandidate {
  return normalizeCareerSurfaceCandidate(
    {
      ...candidate,
      sourcePolicy: candidateSourcePolicy(candidate),
    },
    company,
  );
}

function cleanAbsoluteUrl(input: string): string {
  return canonicalizeCareerSurfaceUrl(input);
}

function resolveUrl(baseUrl: string, maybeRelative: string): string {
  const raw = String(maybeRelative || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractStructuredListingItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isPlainRecord(value)) return [];
  for (const key of ["jobs", "listings", "results", "leads", "items"]) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  if (value.url || value.jobUrl || value.applyUrl) return [value];
  return [];
}

function flattenJsonLdNodes(value: unknown): AnyRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenJsonLdNodes(entry));
  }
  if (!isPlainRecord(value)) return [];
  if (Array.isArray(value["@graph"])) {
    return flattenJsonLdNodes(value["@graph"]);
  }
  return [value];
}

function isJobPostingNode(value: AnyRecord): boolean {
  const type = value["@type"];
  if (typeof type === "string") return type.toLowerCase() === "jobposting";
  if (Array.isArray(type)) {
    return type.some(
      (entry) => typeof entry === "string" && entry.toLowerCase() === "jobposting",
    );
  }
  return false;
}

function parseJsonLoose(input: string): unknown | null {
  const text = String(input || "").trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : text;
  for (const candidate of [body, extractJsonObject(body), extractJsonArray(body)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function extractJsonObject(input: string): string {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  return start !== -1 && end > start ? input.slice(start, end + 1) : "";
}

function extractJsonArray(input: string): string {
  const start = input.indexOf("[");
  const end = input.lastIndexOf("]");
  return start !== -1 && end > start ? input.slice(start, end + 1) : "";
}

function executeGroundedSearchRequest(input: {
  prompt: string;
  company: CompanyTarget;
  run: DiscoveryRun;
  endpoint: string;
  apiKey: string;
  fetchImpl: FetchImpl;
  maxResultsPerCompany: number;
  signal?: AbortSignal;
}): Promise<{
  candidates: GroundedSearchCandidate[];
  searchQueries: string[];
  regexFallbackUsed: boolean;
  regexFallbackAttempted: boolean;
  failure?: {
    status?: number;
    message: string;
    retryable: boolean;
  };
}> {
  const maxOutputTokens = input.run.config.groundedSearchTuning?.maxTokensPerQuery ?? 2048;
  throwIfAborted(input.signal);
  return input.fetchImpl(input.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": input.apiKey,
    },
    signal: input.signal,
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SEARCH_SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: input.prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens,
      },
      tools: [{ google_search: {} }],
    }),
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          candidates: [],
          searchQueries: [],
          regexFallbackUsed: false,
          regexFallbackAttempted: false,
          failure: {
            status: response.status,
            message:
              objectString(payload, "error", "message") ||
              `Gemini grounded search HTTP ${response.status}`,
            retryable: isRetryableGroundedSearchStatus(response.status),
          },
        };
      }
      return parseGroundedSearchResponsePayload(
        payload,
        input.company,
        input.maxResultsPerCompany,
      );
    })
    .catch((error) => {
      if (isAbortError(error)) {
        throw error;
      }
      return {
        candidates: [],
        searchQueries: [],
        regexFallbackUsed: false,
        regexFallbackAttempted: false,
        failure: {
          message: `Gemini grounded search request failed: ${formatError(error)}`,
          retryable: true,
        },
      };
    });
}

function candidatePayloads(payload: unknown): AnyRecord[] {
  if (!isPlainRecord(payload) || !Array.isArray(payload.candidates)) return [];
  return payload.candidates.filter((entry) => isPlainRecord(entry)) as AnyRecord[];
}

function parseGroundedSearchResponsePayload(
  payload: unknown,
  company: CompanyTarget,
  maxResultsPerCompany: number,
): {
  candidates: GroundedSearchCandidate[];
  searchQueries: string[];
  regexFallbackUsed: boolean;
  regexFallbackAttempted: boolean;
} {
  const explicitCandidates: GroundedSearchCandidate[] = [];
  const citedCandidates: GroundedSearchCandidate[] = [];
  const searchQueries: string[] = [];
  let regexFallbackUsed = false;
  let regexFallbackAttempted = false;

  for (const candidate of candidatePayloads(payload)) {
    const text = extractCandidateText(candidate);
    if (text) {
      const explicitResult = extractGroundedCandidatesFromText(text, company);
      explicitCandidates.push(...explicitResult.candidates);
      if (explicitResult.regexFallbackUsed) {
        regexFallbackUsed = true;
      }
      if (explicitResult.regexFallbackAttempted) {
        regexFallbackAttempted = true;
      }
    }

    const groundingMetadata = extractGroundingMetadata(candidate);
    if (groundingMetadata) {
      searchQueries.push(...readStringArray(groundingMetadata.webSearchQueries));
      citedCandidates.push(
        ...extractGroundedCandidatesFromMetadata(groundingMetadata, company),
      );
    }
  }

  return {
    candidates: mergeGroundedCandidates(
      explicitCandidates,
      citedCandidates,
      company,
      maxResultsPerCompany,
    ),
    searchQueries: uniqueStrings(searchQueries),
    regexFallbackUsed,
    regexFallbackAttempted,
  };
}

function extractGroundingMetadata(candidate: AnyRecord): AnyRecord | null {
  if (!isPlainRecord(candidate.groundingMetadata)) return null;
  return candidate.groundingMetadata as AnyRecord;
}

function extractCandidateText(candidate: AnyRecord): string {
  if (!isPlainRecord(candidate.content)) return "";
  const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  return parts
    .map((entry) => (isPlainRecord(entry) ? cleanText(entry.text) : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isRetryableGroundedSearchStatus(status: number): boolean {
  return status >= 500 || status === 408;
}

function buildGroundedSearchFailureContext(
  failure: GroundedSearchRequestFailure,
): string {
  const scope = typeof failure.rung === "number"
    ? `query "${failure.query}" (rung ${failure.rung})`
    : `query "${failure.query}"`;
  const status = failure.status ? `HTTP ${failure.status}: ` : "";
  return `Grounded search request failed for ${scope}. ${status}${failure.message}`;
}

function formatGroundedSearchFailureWarning(
  failure: GroundedSearchRequestFailure,
): string {
  const retryability = failure.retryable ? "retryable upstream failure" : "upstream failure";
  const status = failure.status ? `HTTP ${failure.status}: ` : "";
  return `Grounded search ${retryability}: ${status}${failure.message}`;
}

function companiesLikelyMatch(left: string, right: string): boolean {
  const a = normalizeCompanyKey(left);
  const b = normalizeCompanyKey(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

function mentionsCompany(url: string, title: string, companyName: string): boolean {
  const haystack = `${url} ${title}`.toLowerCase();
  return companyName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((entry) => entry.length >= 3)
    .some((token) => haystack.includes(token));
}

function normalizeCompanyKey(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isLikelyJobLink(url: string): boolean {
  if (isLikelyInformationalJobPage(url, "")) {
    return false;
  }
  return /(\/job\/|\/jobs\/|\/careers\/[^/?#]+|\/positions\/|gh_jid=|lever\.co\/[^/]+\/[^/?#]+|ashbyhq\.com\/[^/]+\/[^/?#]+)/i.test(
    String(url || ""),
  );
}

/**
 * Denylist of obvious navigation/junk anchor titles that should never be
 * promoted as job opportunity titles, even if they link to a job URL.
 */
const NAVIGATION_TITLE_DENYLIST = new Set([
  // Generic navigation
  "skip to content",
  "skip to main content",
  "skip navigation",
  "read more",
  "read more →",
  "read more »",
  "learn more",
  "learn more →",
  "learn more »",
  "click here",
  "click here →",
  "click here »",
  "view all",
  "view all jobs",
  "view all →",
  "see all",
  "see all jobs",
  "see more",
  "see more →",
  "show more",
  "show more →",
  "more info",
  "more information",
  "get more info",
  // Navigation labels
  "menu",
  "home",
  "about",
  "contact",
  "blog",
  "search",
  "jobs",
  "careers",
  "open roles",
  "apply",
  "search jobs",
  "sign in",
  "log in",
  "signup",
  "register",
  // Social/actions
  "share",
  "tweet",
  "email",
  "print",
  "download",
  "apply now",
  "apply now →",
  "submit",
  "submit →",
  "next",
  "previous",
  "back",
  "continue",
  "continue →",
  "learn more about",
  "find out more",
  "explore",
  "discover",
  "get started",
  "start now",
]);

/**
 * Returns true if the title looks like a real job title (not a navigation
 * label or junk anchor text) and is long enough to be plausible.
 */
function isLikelyJobTitle(input: string): boolean {
  const text = cleanText(input).toLowerCase();
  if (!text || text.length < 4) return false;
  if (
    /(page not found|not found|404|403|forbidden|access denied|sign in|log in|login required|www\.[a-z0-9-]+\.[a-z]{2,})/i.test(
      text,
    )
  ) {
    return false;
  }
  // Reject exact denylist matches
  if (NAVIGATION_TITLE_DENYLIST.has(text)) return false;
  // Reject titles that are prefixes of denylist entries (e.g. "read more about" -> "read more")
  for (const junk of NAVIGATION_TITLE_DENYLIST) {
    if (text.startsWith(junk + " ") || text.startsWith(junk + " –") || text.startsWith(junk + " —")) {
      return false;
    }
  }
  if (
    [
      "careers",
      "jobs",
      "open roles",
      "apply",
      "search jobs",
      "view all jobs",
    ].includes(text)
  ) {
    return false;
  }
  return /[a-z]/i.test(text);
}

function isLikelyInformationalJobPage(url: string, title: string): boolean {
  try {
    const parsed = new URL(String(url || "").trim());
    const segments = parsed.pathname
      .toLowerCase()
      .split("/")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const finalSlug = segments[segments.length - 1] || "";
    if (INFORMATIONAL_PAGE_SLUGS.has(finalSlug)) {
      return true;
    }
  } catch {
    // Ignore malformed URLs and fall back to title-based checks.
  }

  const normalizedTitle = cleanText(title).toLowerCase();
  return [
    "benefits",
    "how we work",
    "how to get a job here",
    "how we hire",
    "why work here",
    "our culture",
    "life at",
    "about us",
    "our story",
    "our team",
    "values",
    "mission",
    "faq",
  ].includes(normalizedTitle);
}

function createAbortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    String(error).toLowerCase().includes("aborted")
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function dedupeRawListings(listings: RawListing[]): RawListing[] {
  const cleaned = listings
    .map((listing) => {
      const url = cleanAbsoluteUrl(listing.url);
      return url ? { ...listing, url } : null;
    })
    .filter((listing): listing is RawListing => !!listing);
  return dedupeFingerprintListings(cleaned).uniqueItems;
}

function joinOrAny(values: readonly string[]): string {
  const cleaned = uniqueStrings((values || []).map((entry) => cleanText(entry)));
  return cleaned.length ? cleaned.join(", ") : "any";
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) =>
        Array.isArray(entry) ? readStringArray(entry) : [cleanText(entry)],
      )
      .filter(Boolean);
  }
  if (isPlainRecord(value)) {
    const text = objectString(value, "name") || objectString(value, "title");
    return text ? [text] : [];
  }
  const text = cleanText(value);
  return text ? [text] : [];
}

function readFirstStringValue(record: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = cleanText(value);
      if (text) return text;
    }
  }
  return "";
}

function objectString(value: unknown, ...path: string[]): string {
  let current = value;
  for (const segment of path) {
    if (!isPlainRecord(current)) return "";
    current = current[segment];
  }
  return cleanText(current);
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function cleanText(value: unknown): string {
  if (typeof value === "string") return normalizeWhitespace(stripHtml(htmlDecode(value)));
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return value == null ? "" : normalizeWhitespace(String(value));
}

function normalizeWhitespace(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(input: string): string {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlDecode(input: string): string {
  return String(input || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function looksLikeHtml(input: string): boolean {
  return /<html\b|<body\b|<a\b|<script\b|<title>/i.test(String(input || ""));
}

function isPlainRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
