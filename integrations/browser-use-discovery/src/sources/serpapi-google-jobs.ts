/**
 * Feature C / Layer 5 Tier 1 — SerpApi Google Jobs source collector.
 *
 * Queries the SerpApi Google Jobs endpoint and produces `RawListing[]` that
 * slot into the standard discovery pipeline (dedupe → matcher → normalize →
 * rank/write). Google has already indexed every ATS-shipped `JobPosting`
 * schema markup on the web, so SerpApi returns clean structured jobs with no
 * extraction step needed.
 *
 * The lane is feature-gated on `runtimeConfig.serpApiKey`. An unset key
 * short-circuits to an empty result + diagnostic log event (never throws).
 * Per-query HTTP failures are caught and surfaced as warnings so a single
 * bad query doesn't tank the lane.
 *
 * Privacy / security:
 *  - The API key is never serialized into a log event or warning. Only the
 *    query text + HTTP status are logged.
 *  - The collector never embeds the key in the `canonicalUrl` or `finalUrl`
 *    of any returned listing.
 */
import type {
  AtsSourceId,
  RawListing,
  SupportedSourceId,
} from "../contracts.ts";
import { ATS_SOURCE_IDS } from "../contracts.ts";
import type { WorkerRuntimeConfig } from "../config.ts";
import {
  AGGREGATOR_HOST_SIGNATURES,
  ATS_HOST_SIGNATURES,
} from "./host-signatures.ts";

type FetchImpl = typeof globalThis.fetch;

export const SERPAPI_GOOGLE_JOBS_SOURCE_ID =
  "serpapi_google_jobs" as const satisfies SupportedSourceId;
export const SERPAPI_GOOGLE_JOBS_SOURCE_LABEL = "Google Jobs (SerpApi)";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const DEFAULT_MAX_QUERIES_PER_RUN = 5;
const DEFAULT_QUERY_TIMEOUT_MS = 20_000;
const DEFAULT_RESULTS_PER_QUERY = 20;

export type SerpApiCollectorInput = {
  /**
   * Derived from the resolved run config. `targetRoles` drives the query
   * fan-out (one query per role). `locations` and `remotePolicy` are
   * appended to each query.
   */
  profile: {
    targetRoles: string[];
    locations: string[];
    remotePolicy: string;
  };
  runtimeConfig: WorkerRuntimeConfig;
  fetchImpl?: FetchImpl;
  log?: (event: string, details: Record<string, unknown>) => void;
  /** Cap on the number of SerpApi queries per run. Defaults to 5. */
  maxQueriesPerRun?: number;
  /** Per-query HTTP timeout. Defaults to 20 seconds. */
  queryTimeoutMs?: number;
  /** Results requested per query (SerpApi `num`). Defaults to 20. */
  resultsPerQuery?: number;
};

export type SerpApiListing = {
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  postedAt?: string;
  via?: string;
  providerType?: AtsSourceId;
  query: string;
};

export type SerpApiCollectorResult = {
  listings: SerpApiListing[];
  rawListings: RawListing[];
  warnings: string[];
  stats: {
    queryCount: number;
    httpFailureCount: number;
    listingCount: number;
    durationMs: number;
  };
};

export async function collectSerpApiGoogleJobsListings(
  input: SerpApiCollectorInput,
): Promise<SerpApiCollectorResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const stats = {
    queryCount: 0,
    httpFailureCount: 0,
    listingCount: 0,
    durationMs: 0,
  };

  const apiKey = String(input.runtimeConfig.serpApiKey || "").trim();
  if (!apiKey) {
    input.log?.("discovery.run.serpapi_google_jobs_skipped", {
      reason: "missing_api_key",
    });
    warnings.push("missing_api_key");
    stats.durationMs = Date.now() - startedAt;
    return { listings: [], rawListings: [], warnings, stats };
  }

  const queries = buildQueries(input.profile, {
    maxQueriesPerRun: input.maxQueriesPerRun ?? DEFAULT_MAX_QUERIES_PER_RUN,
  });
  if (queries.length === 0) {
    input.log?.("discovery.run.serpapi_google_jobs_skipped", {
      reason: "no_queries",
    });
    warnings.push("no_queries");
    stats.durationMs = Date.now() - startedAt;
    return { listings: [], rawListings: [], warnings, stats };
  }

  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const timeoutMs = input.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const resultsPerQuery = input.resultsPerQuery ?? DEFAULT_RESULTS_PER_QUERY;

  const listingsByUrl = new Map<string, SerpApiListing>();

  for (const query of queries) {
    stats.queryCount += 1;
    input.log?.("discovery.run.serpapi_google_jobs_query_started", {
      query,
      resultsPerQuery,
    });
    const queryStartedAt = Date.now();
    try {
      const jobs = await runSerpApiQuery({
        query,
        apiKey,
        fetchImpl,
        timeoutMs,
        resultsPerQuery,
      });
      let addedFromThisQuery = 0;
      for (const rawJob of jobs) {
        const listing = mapJobsResult(rawJob, query);
        if (!listing) continue;
        if (listingsByUrl.has(listing.url)) continue;
        listingsByUrl.set(listing.url, listing);
        addedFromThisQuery += 1;
      }
      input.log?.("discovery.run.serpapi_google_jobs_query_completed", {
        query,
        durationMs: Date.now() - queryStartedAt,
        fetchedCount: jobs.length,
        addedCount: addedFromThisQuery,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = extractHttpCode(message);
      const warning = code ? `http_${code}` : "query_failed";
      stats.httpFailureCount += 1;
      warnings.push(warning);
      input.log?.("discovery.run.serpapi_google_jobs_query_failed", {
        query,
        durationMs: Date.now() - queryStartedAt,
        warning,
        message,
      });
    }
  }

  const listings = [...listingsByUrl.values()];
  stats.listingCount = listings.length;
  stats.durationMs = Date.now() - startedAt;

  const rawListings = listings.map(toRawListing);

  input.log?.("discovery.run.serpapi_google_jobs_lane_completed", {
    queryCount: stats.queryCount,
    httpFailureCount: stats.httpFailureCount,
    listingCount: stats.listingCount,
    durationMs: stats.durationMs,
  });

  return { listings, rawListings, warnings, stats };
}

function buildQueries(
  profile: SerpApiCollectorInput["profile"],
  options: { maxQueriesPerRun: number },
): string[] {
  const locationSuffix = buildLocationSuffix(profile);
  const roles = (profile.targetRoles || [])
    .map((role) => String(role || "").trim())
    .filter(Boolean)
    .slice(0, Math.max(0, options.maxQueriesPerRun));
  if (roles.length === 0) return [];
  return roles.map((role) =>
    locationSuffix ? `${role} ${locationSuffix}` : role,
  );
}

function buildLocationSuffix(
  profile: SerpApiCollectorInput["profile"],
): string {
  const remote = String(profile.remotePolicy || "").toLowerCase();
  if (remote === "remote") return "remote";
  const locations = (profile.locations || [])
    .map((loc) => String(loc || "").trim())
    .filter(Boolean);
  if (locations.length === 0) return "";
  if (locations.length === 1) return locations[0];
  return locations.join(" OR ");
}

type SerpApiJobsResult = {
  title?: unknown;
  company_name?: unknown;
  location?: unknown;
  description?: unknown;
  via?: unknown;
  job_id?: unknown;
  share_link?: unknown;
  related_links?: unknown;
  apply_options?: unknown;
  detected_extensions?: unknown;
  extensions?: unknown;
};

async function runSerpApiQuery(input: {
  query: string;
  apiKey: string;
  fetchImpl: FetchImpl;
  timeoutMs: number;
  resultsPerQuery: number;
}): Promise<SerpApiJobsResult[]> {
  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_jobs");
  url.searchParams.set("q", input.query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("google_domain", "google.com");
  url.searchParams.set("num", String(input.resultsPerQuery));
  // api_key goes on last so it doesn't end up logged if a caller stringifies
  // the URL before us. We never log the full URL anyway — only the query.
  url.searchParams.set("api_key", input.apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`SerpApi HTTP ${response.status}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    const jobs = body.jobs_results;
    if (!Array.isArray(jobs)) return [];
    return jobs as SerpApiJobsResult[];
  } finally {
    clearTimeout(timer);
  }
}

function mapJobsResult(
  raw: SerpApiJobsResult,
  query: string,
): SerpApiListing | null {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const company =
    typeof raw.company_name === "string" ? raw.company_name.trim() : "";
  if (!title || !company) return null;

  const url = resolveApplyUrl(raw);
  if (!url) return null;

  const location =
    typeof raw.location === "string" ? raw.location.trim() : "";
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  const via = typeof raw.via === "string" ? raw.via.trim() : undefined;
  const postedAt = extractPostedAt(raw);
  const providerType = inferProviderType(via, url);

  return {
    url,
    title,
    company,
    location,
    description,
    via,
    postedAt,
    providerType,
    query,
  };
}

function resolveApplyUrl(raw: SerpApiJobsResult): string {
  // Collect candidate URLs from apply_options, related_links, share_link in
  // a single array, then re-rank. SerpApi's apply_options often puts an
  // aggregator (LinkedIn / Indeed / Glassdoor) as entry 0 and the actual
  // ATS link as entry 1+. Aggregators block the local Cheerio scraper with
  // HTTP 403, so the downstream "load posting details" UI fails. Ranking
  // direct ATS hosts first, company careers pages second, and known
  // aggregators last fixes the dominant enrichment-403 failure mode.
  const candidates: string[] = [];
  const applyOptions = Array.isArray(raw.apply_options) ? raw.apply_options : [];
  for (const option of applyOptions) {
    if (option && typeof option === "object") {
      const link = (option as Record<string, unknown>).link;
      if (typeof link === "string" && link.startsWith("http")) {
        candidates.push(link);
      }
    }
  }
  const relatedLinks = Array.isArray(raw.related_links) ? raw.related_links : [];
  for (const link of relatedLinks) {
    if (link && typeof link === "object") {
      const href = (link as Record<string, unknown>).link;
      if (typeof href === "string" && href.startsWith("http")) {
        candidates.push(href);
      }
    }
  }
  if (typeof raw.share_link === "string" && raw.share_link.startsWith("http")) {
    candidates.push(raw.share_link);
  }
  if (candidates.length === 0) return "";
  // Pick the one with the lowest priority number (best).
  const ranked = candidates
    .map((url) => ({ url, priority: applyUrlPriority(url) }))
    .sort((a, b) => a.priority - b.priority);
  return ranked[0].url;
}

function applyUrlPriority(url: string): number {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 99;
  }
  // Known ATS hosts from our shared inference table — reuse the same regexes
  // we already use for providerType so there's one source of truth.
  for (const signature of ATS_HOST_SIGNATURES) {
    if (signature.match.test(host)) return 10;
  }
  for (const signature of AGGREGATOR_HOST_SIGNATURES) {
    if (signature.match.test(host)) return 90;
  }
  // Generic HTTPS (likely a company careers page). Preferred over aggregators,
  // worse than a known ATS slug.
  return 50;
}

function extractPostedAt(raw: SerpApiJobsResult): string | undefined {
  const detected = raw.detected_extensions;
  if (detected && typeof detected === "object") {
    const posted = (detected as Record<string, unknown>).posted_at;
    if (typeof posted === "string" && posted.trim()) return posted.trim();
  }
  const extensions = Array.isArray(raw.extensions) ? raw.extensions : [];
  for (const ext of extensions) {
    if (typeof ext === "string" && /ago|day|hour|week|month/i.test(ext)) {
      return ext;
    }
  }
  return undefined;
}

function inferProviderType(
  via: string | undefined,
  applyUrl: string,
): AtsSourceId | undefined {
  const haystack = `${via || ""} ${applyUrl || ""}`;
  for (const signature of ATS_HOST_SIGNATURES) {
    if (signature.match.test(haystack)) {
      if ((ATS_SOURCE_IDS as readonly string[]).includes(signature.provider)) {
        return signature.provider;
      }
    }
  }
  return undefined;
}

function extractHttpCode(message: string): string | null {
  const match = message.match(/HTTP\s+(\d{3})/i);
  return match ? match[1] : null;
}

function toRawListing(listing: SerpApiListing): RawListing {
  return {
    sourceId: SERPAPI_GOOGLE_JOBS_SOURCE_ID,
    sourceLabel: SERPAPI_GOOGLE_JOBS_SOURCE_LABEL,
    title: listing.title,
    company: listing.company,
    location: listing.location || undefined,
    url: listing.url,
    canonicalUrl: listing.url,
    finalUrl: listing.url,
    descriptionText: listing.description || undefined,
    providerType: listing.providerType,
    sourceLane: "grounded_web",
    metadata: {
      serpapiQuery: listing.query,
      serpapiVia: listing.via,
      serpapiPostedAt: listing.postedAt,
    },
  };
}
