import { randomUUID } from "node:crypto";

import type {
  IngestUrlRequestV1,
  IngestUrlResponseV1,
  NormalizedLead,
  PipelineWriteResult,
  RawListing,
  StoredWorkerConfig,
} from "../contracts.ts";
import {
  INGEST_URL_EVENT,
  INGEST_URL_SCHEMA_VERSION,
} from "../contracts.ts";
import type { WorkerRuntimeConfig } from "../config.ts";
import { rawListingToSingleLead } from "../normalize/raw-to-single-lead.ts";
import { fetchAshbyJob, fetchGreenhouseJob, fetchLeverJob } from "../sources/ats-public-fetchers.ts";
import {
  extractJobWithBrowserUseCloud,
  type BrowserUseCloudExtractor,
} from "../sources/browser-use-cloud-extractor.ts";
import { classifyIngestUrl } from "../sources/ingest-url-router.ts";
import {
  hasValidWebhookSecret,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";

type ScrapeResult = {
  url: string;
  title: string | null;
  description: string;
  requirements?: string[];
  skills?: string[];
  method?: string;
  source?: string;
};

type PipelineWriterLike = {
  write(sheetId: string, leads: NormalizedLead[]): Promise<PipelineWriteResult>;
};

type IngestUrlStrategy =
  | "ats_api"
  | "jsonld"
  | "cheerio_dom"
  | "manual_fill"
  | "url_only"
  | "browser_use_cloud";

export type HandleIngestUrlDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  pipelineWriter: PipelineWriterLike;
  createPipelineWriterForRequest?(
    runtimeConfigOverride: WorkerRuntimeConfig,
  ): PipelineWriterLike;
  loadStoredWorkerConfig?(sheetId: string): Promise<StoredWorkerConfig | null>;
  fetchGreenhouseJob?: typeof fetchGreenhouseJob;
  fetchLeverJob?: typeof fetchLeverJob;
  fetchAshbyJob?: typeof fetchAshbyJob;
  scrapeJobPosting?: (url: string) => Promise<ScrapeResult>;
  extractWithBrowserUseCloud?: BrowserUseCloudExtractor;
  now?: () => Date;
  randomId?: (prefix: string) => string;
  log?(event: string, details: Record<string, unknown>): void;
};

type ParsedIngestUrlRequest =
  | { ok: true; request: IngestUrlRequestV1 }
  | { ok: false; message: string };

export async function handleIngestUrlWebhook(
  request: WebhookRequestLike,
  dependencies: HandleIngestUrlDependencies,
): Promise<WebhookResponseLike> {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return jsonResponse(
      405,
      { ok: false, message: "Method not allowed" },
      { allow: "POST,OPTIONS" },
    );
  }

  const authCheck = hasValidWebhookSecret(
    dependencies.runtimeConfig.webhookSecret,
    request.headers,
  );
  if (!authCheck.valid) {
    return jsonResponse(401, {
      ok: false,
      message: "Unauthorized ingest-url request.",
      auth: {
        category: authCheck.category,
        detail: authCheck.detail,
        ...(authCheck.remediation ? { remediation: authCheck.remediation } : {}),
      },
    });
  }

  const parsed = parseRequest(request.bodyText);
  if (!parsed.ok) {
    return jsonResponse(400, {
      ok: false,
      message: parsed.message,
    });
  }

  const runId =
    dependencies.randomId?.("ingest") ||
    `ingest_${randomUUID().replace(/-/g, "")}`;
  const now = dependencies.now || (() => new Date());
  const ingestRequest = parsed.request;
  const requestGoogleAccessToken =
    typeof ingestRequest.googleAccessToken === "string"
      ? ingestRequest.googleAccessToken.trim()
      : "";
  const effectiveRuntimeConfig = requestGoogleAccessToken
    ? {
        ...dependencies.runtimeConfig,
        googleAccessToken: requestGoogleAccessToken,
      }
    : dependencies.runtimeConfig;
  const effectiveDependencies: HandleIngestUrlDependencies =
    requestGoogleAccessToken && dependencies.createPipelineWriterForRequest
      ? {
          ...dependencies,
          runtimeConfig: effectiveRuntimeConfig,
          pipelineWriter:
            dependencies.createPipelineWriterForRequest(effectiveRuntimeConfig),
        }
      : dependencies;

  dependencies.log?.("discovery.run.ingest_url_request_accepted", {
    runId,
    hasManual: !!ingestRequest.manual,
    hasSheetId: !!String(ingestRequest.sheetId || "").trim(),
    hasRequestGoogleAccessToken: !!requestGoogleAccessToken,
  });

  try {
    const resolvedSheetId = await resolveSheetId(
      ingestRequest.sheetId,
      effectiveDependencies,
    );
    if (!resolvedSheetId) {
      return jsonResponse(200, {
        ok: false,
        reason: "worker_error",
        message: "No sheetId was provided and no default sheetId is configured.",
      } satisfies IngestUrlResponseV1);
    }

    const classified = classifyIngestUrl(ingestRequest.url);
    dependencies.log?.("discovery.run.ingest_url_classified", {
      runId,
      kind: classified.kind,
      ...(classified.host ? { host: classified.host } : {}),
      ...(classified.kind === "blocked_aggregator"
        ? { provider: classified.provider }
        : {}),
      ...(classified.kind === "ats_direct"
        ? { provider: classified.provider }
        : {}),
    });

    if (classified.kind === "invalid") {
      return jsonResponse(400, {
        ok: false,
        reason: "invalid_url",
        message: classified.message,
      } satisfies IngestUrlResponseV1);
    }
    if (classified.kind === "private_network") {
      return jsonResponse(400, {
        ok: false,
        reason: "private_network",
        message: "Local and private-network URLs are not allowed.",
      } satisfies IngestUrlResponseV1);
    }

    if (ingestRequest.manual) {
      const rawManual: RawListing = {
        sourceId: "manual_fill" as RawListing["sourceId"],
        sourceLabel: "Manual fill",
        sourceLane: "grounded_web",
        title: ingestRequest.manual.title.trim(),
        company: ingestRequest.manual.company.trim(),
        location: String(ingestRequest.manual.location || "").trim() || undefined,
        url: ingestRequest.url,
        canonicalUrl: ingestRequest.url,
        finalUrl: ingestRequest.url,
        descriptionText:
          String(ingestRequest.manual.description || "").trim() || undefined,
      };
      const manualLead = rawListingToSingleLead(rawManual, {
        runId,
        sheetId: resolvedSheetId,
        now,
        fitScoreOverride: ingestRequest.manual.fitScore,
      });
      if (!manualLead) {
        return jsonResponse(200, {
          ok: false,
          reason: "worker_error",
          message: "Manual payload could not be normalized into a Pipeline lead.",
        } satisfies IngestUrlResponseV1);
      }
      return writeLeadAndRespond({
        dependencies: effectiveDependencies,
        sheetId: resolvedSheetId,
        lead: manualLead,
        strategy: "manual_fill",
        runId,
      });
    }

    let rawListing: RawListing | null = null;
    let strategy: IngestUrlStrategy = "cheerio_dom";

    if (classified.kind === "blocked_aggregator") {
      dependencies.log?.("discovery.run.ingest_url_blocked_aggregator", {
        runId,
        host: classified.host,
        provider: classified.provider,
      });
      const browserUseResult = await tryBrowserUseCloudExtraction({
        url: ingestRequest.url,
        runId,
        host: classified.host,
        trigger: "blocked_aggregator",
        dependencies: effectiveDependencies,
      });
      if (browserUseResult.ok) {
        rawListing = browserUseResult.rawListing;
        strategy = "browser_use_cloud";
      } else {
        rawListing = buildUrlOnlyRawListing(
          ingestRequest.url,
          classified.host,
          `Couldn't auto-extract — ${classified.provider} blocks direct scrapers. Open the row for drawer-based detail fetch.`,
        );
        strategy = "url_only";
      }
    } else if (classified.kind === "ats_direct") {
      const atsResult = await fetchFromAts(classified, effectiveDependencies);
      if (!atsResult.ok && classified.provider !== "workable") {
        // ATS JSON API failed (deleted posting, region-locked, network blip).
        // Fall back to the generic Cheerio scrape on the same URL — the
        // board's HTML detail page often still works.
        dependencies.log?.("discovery.run.ingest_url_ats_fetch_failed", {
          runId,
          provider: classified.provider,
          host: classified.host,
          message: atsResult.message,
        });
      } else if (atsResult.ok) {
        rawListing = atsResult.rawListing;
        strategy = "ats_api";
      }
    }

    if (!rawListing) {
      const scraped = await scrapeToRawListing(
        ingestRequest.url,
        effectiveDependencies,
      );
      if (!scraped.ok) {
        dependencies.log?.("discovery.run.ingest_url_scrape_fallback", {
          runId,
          host: safeHost(ingestRequest.url),
          httpStatus: scraped.httpStatus,
          message: scraped.message,
        });
        const browserUseResult = await tryBrowserUseCloudExtraction({
          url: ingestRequest.url,
          runId,
          host: safeHost(ingestRequest.url),
          trigger: "scrape_failed",
          dependencies: effectiveDependencies,
        });
        if (browserUseResult.ok) {
          rawListing = browserUseResult.rawListing;
          strategy = "browser_use_cloud";
        } else {
          rawListing = buildUrlOnlyRawListing(
            ingestRequest.url,
            safeHost(ingestRequest.url),
            `Couldn't auto-extract (${scraped.httpStatus ? `HTTP ${scraped.httpStatus}` : "scrape failed"}). Open the row for drawer-based detail fetch.`,
          );
          strategy = "url_only";
        }
      } else if (isWeakScrapedListing(scraped.rawListing)) {
        dependencies.log?.("discovery.run.ingest_url_weak_scrape", {
          runId,
          host: safeHost(ingestRequest.url),
          hasTitle: !!String(scraped.rawListing.title || "").trim(),
          hasDescription: !!String(scraped.rawListing.descriptionText || "").trim(),
        });
        const browserUseResult = await tryBrowserUseCloudExtraction({
          url: ingestRequest.url,
          runId,
          host: safeHost(ingestRequest.url),
          trigger: "weak_scrape",
          dependencies: effectiveDependencies,
        });
        if (browserUseResult.ok) {
          rawListing = browserUseResult.rawListing;
          strategy = "browser_use_cloud";
        } else {
          rawListing = buildUrlOnlyRawListing(
            ingestRequest.url,
            safeHost(ingestRequest.url),
            "Couldn't auto-extract enough job details. Open the row for drawer-based detail fetch.",
          );
          strategy = "url_only";
        }
      } else {
        rawListing = scraped.rawListing;
        strategy = scraped.strategy;
      }
    }

    const lead = rawListingToSingleLead(rawListing, {
      runId,
      sheetId: resolvedSheetId,
      now,
    });
    if (!lead) {
      return jsonResponse(200, {
        ok: false,
        reason: "worker_error",
        message: "The extracted listing could not be normalized into a Pipeline lead.",
      } satisfies IngestUrlResponseV1);
    }

    return writeLeadAndRespond({
      dependencies: effectiveDependencies,
      sheetId: resolvedSheetId,
      lead,
      strategy,
      runId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.log?.("discovery.run.ingest_url_failed", {
      runId,
      message,
    });
    return jsonResponse(500, {
      ok: false,
      reason: "worker_error",
      message,
    } satisfies IngestUrlResponseV1);
  }
}

function jsonResponse(
  status: number,
  body: IngestUrlResponseV1 | Record<string, unknown>,
  headers: Record<string, string> = {},
): WebhookResponseLike {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

function parseRequest(bodyText: string): ParsedIngestUrlRequest {
  let payload: unknown;
  try {
    payload = JSON.parse(String(bodyText || ""));
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const record = payload as Record<string, unknown>;
  if (record.event !== INGEST_URL_EVENT) {
    return { ok: false, message: `event must be ${INGEST_URL_EVENT}.` };
  }
  if (Number(record.schemaVersion) !== INGEST_URL_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `schemaVersion must be ${INGEST_URL_SCHEMA_VERSION}.`,
    };
  }
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!url) {
    return { ok: false, message: "url is required and must be non-empty." };
  }
  const sheetId =
    typeof record.sheetId === "string" ? record.sheetId.trim() : "";
  const googleAccessToken =
    typeof record.googleAccessToken === "string"
      ? record.googleAccessToken.trim()
      : "";
  if (
    record.googleAccessToken != null &&
    typeof record.googleAccessToken !== "string"
  ) {
    return {
      ok: false,
      message: "googleAccessToken must be a string when present.",
    };
  }

  const manualRaw = record.manual;
  let manual: IngestUrlRequestV1["manual"];
  if (manualRaw !== undefined) {
    if (!manualRaw || typeof manualRaw !== "object" || Array.isArray(manualRaw)) {
      return { ok: false, message: "manual must be an object when present." };
    }
    const manualRecord = manualRaw as Record<string, unknown>;
    const title =
      typeof manualRecord.title === "string" ? manualRecord.title.trim() : "";
    const company =
      typeof manualRecord.company === "string"
        ? manualRecord.company.trim()
        : "";
    if (!title || !company) {
      return {
        ok: false,
        message: "manual.title and manual.company are required when manual is present.",
      };
    }
    let fitScore: number | undefined;
    if (manualRecord.fitScore !== undefined) {
      if (
        typeof manualRecord.fitScore !== "number" ||
        !Number.isFinite(manualRecord.fitScore)
      ) {
        return {
          ok: false,
          message: "manual.fitScore must be a finite number between 0 and 10 when present.",
        };
      }
      fitScore = Math.min(10, Math.max(0, Math.round(manualRecord.fitScore)));
    }
    manual = {
      title,
      company,
      location:
        typeof manualRecord.location === "string"
          ? manualRecord.location.trim()
          : undefined,
      description:
        typeof manualRecord.description === "string"
          ? manualRecord.description
          : undefined,
      fitScore,
    };
  }

  return {
    ok: true,
    request: {
      event: INGEST_URL_EVENT,
      schemaVersion: INGEST_URL_SCHEMA_VERSION,
      url,
      ...(sheetId ? { sheetId } : {}),
      ...(googleAccessToken ? { googleAccessToken } : {}),
      ...(manual ? { manual } : {}),
    },
  };
}

async function resolveSheetId(
  requestedSheetId: string | undefined,
  dependencies: HandleIngestUrlDependencies,
): Promise<string> {
  const fromRequest = String(requestedSheetId || "").trim();
  if (fromRequest) return fromRequest;
  if (!dependencies.loadStoredWorkerConfig) return "";
  const stored = await dependencies.loadStoredWorkerConfig("");
  return String(stored?.sheetId || "").trim();
}

async function fetchFromAts(
  classified: {
    provider: string;
    slug: string;
    jobId: string;
  },
  dependencies: HandleIngestUrlDependencies,
) {
  const greenhouse = dependencies.fetchGreenhouseJob || fetchGreenhouseJob;
  const lever = dependencies.fetchLeverJob || fetchLeverJob;
  const ashby = dependencies.fetchAshbyJob || fetchAshbyJob;

  if (classified.provider === "greenhouse") {
    return greenhouse({ slug: classified.slug, jobId: classified.jobId });
  }
  if (classified.provider === "lever") {
    return lever({ slug: classified.slug, jobId: classified.jobId });
  }
  if (classified.provider === "ashby") {
    return ashby({ slug: classified.slug, jobId: classified.jobId });
  }
  return {
    ok: false as const,
    reason: "parse_error" as const,
    message: `No public ATS fetcher is configured for provider "${classified.provider}".`,
  };
}

async function scrapeToRawListing(
  url: string,
  dependencies: HandleIngestUrlDependencies,
): Promise<
  | {
      ok: true;
      rawListing: RawListing;
      strategy: "jsonld" | "cheerio_dom";
    }
  | {
      ok: false;
      message: string;
      httpStatus?: number;
    }
> {
  const scrape = dependencies.scrapeJobPosting || defaultScrapeJobPosting;
  try {
    const scraped = (await scrape(url)) as ScrapeResult;
    const resolvedUrl = String(scraped.url || url).trim();
    const host = safeHost(resolvedUrl);
    const sourceMethod = String(scraped.method || scraped.source || "").toLowerCase();
    const strategy = sourceMethod.includes("json-ld")
      ? "jsonld"
      : "cheerio_dom";

    return {
      ok: true,
      strategy,
      rawListing: {
        sourceId: "ingest_url_scrape" as RawListing["sourceId"],
        sourceLabel: "URL paste (scrape)",
        sourceLane: "grounded_web",
        title: String(scraped.title || "").trim(),
        company: inferCompanyFromHost(host),
        location: undefined,
        url: resolvedUrl,
        canonicalUrl: resolvedUrl,
        finalUrl: resolvedUrl,
        descriptionText: String(scraped.description || "").trim() || undefined,
        tags: [
          ...((Array.isArray(scraped.skills) ? scraped.skills : []) as string[]),
          ...((Array.isArray(scraped.requirements)
            ? scraped.requirements
            : []) as string[]),
        ].filter(Boolean),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message,
      ...(extractHttpStatus(message) ? { httpStatus: extractHttpStatus(message) } : {}),
    };
  }
}

async function writeLeadAndRespond(input: {
  dependencies: HandleIngestUrlDependencies;
  sheetId: string;
  lead: NormalizedLead;
  strategy: IngestUrlStrategy;
  runId: string;
}): Promise<WebhookResponseLike> {
  const writeResult = await input.dependencies.pipelineWriter.write(
    input.sheetId,
    [input.lead],
  );
  input.dependencies.log?.("discovery.run.ingest_url_write_completed", {
    runId: input.runId,
    sheetId: input.sheetId,
    strategy: input.strategy,
    appended: writeResult.appended,
    updated: writeResult.updated,
    skippedDuplicates: writeResult.skippedDuplicates,
  });

  if (writeResult.appended === 0 && writeResult.skippedDuplicates === 1) {
    return jsonResponse(200, {
      ok: false,
      reason: "duplicate",
      rowNumber: 0,
      message: "This job already exists in your Pipeline.",
    } satisfies IngestUrlResponseV1);
  }

  return jsonResponse(200, {
    ok: true,
    strategy: input.strategy,
    lead: input.lead,
    appended: writeResult.appended > 0,
  } satisfies IngestUrlResponseV1);
}

async function tryBrowserUseCloudExtraction(input: {
  url: string;
  runId: string;
  host: string;
  trigger: "blocked_aggregator" | "scrape_failed" | "weak_scrape";
  dependencies: HandleIngestUrlDependencies;
}): Promise<
  | { ok: true; rawListing: RawListing }
  | { ok: false; reason: string; message: string }
> {
  const extractor =
    input.dependencies.extractWithBrowserUseCloud || extractJobWithBrowserUseCloud;
  try {
    const result = await extractor({
      url: input.url,
      runId: input.runId,
      runtimeConfig: input.dependencies.runtimeConfig,
    });
    if (result.ok) {
      input.dependencies.log?.("discovery.run.ingest_url_browser_use_completed", {
        runId: input.runId,
        host: input.host,
        trigger: input.trigger,
        confidence: result.confidence,
      });
      return { ok: true, rawListing: result.rawListing };
    }
    input.dependencies.log?.("discovery.run.ingest_url_browser_use_skipped", {
      runId: input.runId,
      host: input.host,
      trigger: input.trigger,
      reason: result.reason,
      message: result.message,
      hasApiKey: !!String(input.dependencies.runtimeConfig.browserUseApiKey || "").trim(),
      hasProfileId: !!String(input.dependencies.runtimeConfig.browserUseProfileId || "").trim(),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.dependencies.log?.("discovery.run.ingest_url_browser_use_failed", {
      runId: input.runId,
      host: input.host,
      trigger: input.trigger,
      message,
    });
    return { ok: false, reason: "extract_failed", message };
  }
}

function isWeakScrapedListing(rawListing: RawListing): boolean {
  return (
    !String(rawListing.title || "").trim() ||
    !String(rawListing.descriptionText || "").trim()
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function inferCompanyFromHost(host: string): string {
  const primary = String(host || "")
    .replace(/^www\./i, "")
    .split(".")
    .filter(Boolean)[0] || "Unknown company";
  return primary
    .split(/[-_]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

// Derive a best-guess human-readable title from a URL slug. Strips numeric
// ids + job-request noise so `/jobs/4369653076` → "", but
// `/jobs/senior-product-manager-at-plaid` → "Senior Product Manager At Plaid".
// Returns empty string when nothing usable remains (normalizer will then
// substitute a placeholder upstream).
function inferTitleFromUrlPath(url: string): string {
  let pathname = "";
  try {
    pathname = new URL(url).pathname || "";
  } catch {
    return "";
  }
  const segments = pathname
    .split("/")
    .filter(Boolean)
    // Drop purely numeric ids and very short opaque segments.
    .filter((seg) => !/^\d+$/.test(seg) && seg.length > 2);
  if (segments.length === 0) return "";
  // Prefer the last segment (usually the title). Strip query-like noise
  // (utm_*, jk=, etc. would never be in a pathname, but defensively).
  const candidate = segments[segments.length - 1]
    .split(/[?#]/)[0]
    .replace(/\.(html|htm|aspx|php)$/i, "")
    .replace(/[-_+]+/g, " ")
    // Strip trailing numeric ids that commonly tag job URLs
    // ("senior-pm-at-plaid-4369653076" → "senior pm at plaid"). Also
    // drop long opaque hex tokens. Keep short numbers (e.g. "java 17")
    // by only stripping runs of 4+ digits.
    .replace(/\s+[0-9a-f]{8,}\s*$/i, "")
    .replace(/\s+\d{4,}\s*$/i, "")
    .trim();
  if (!candidate) return "";
  return candidate
    .split(/\s+/)
    .map((token) =>
      token.length > 0
        ? token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
        : "",
    )
    .join(" ")
    .trim();
}

// Build a minimal RawListing from just the URL. Used when classification
// hits a blocked aggregator OR when the Cheerio scrape fails outright.
// The row lands in the Pipeline with whatever we can derive (hostname as
// company, last URL path segment as title) and the dashboard's per-row
// enrichment (fetchJobPostingEnrichment in app.js) does a second scrape
// when the user opens the drawer — that path has LLM inference on top of
// Cheerio output and often extracts fields even for aggregators.
function buildUrlOnlyRawListing(
  url: string,
  host: string,
  noteForDescription: string,
): RawListing {
  const resolvedUrl = String(url || "").trim();
  const inferredTitle = inferTitleFromUrlPath(resolvedUrl);
  const company = inferCompanyFromHost(host) || "Unknown company";
  // Title must be non-empty for the normalizer to accept the listing;
  // fall back to a generic placeholder when URL slug is opaque.
  const title = inferredTitle || `Job at ${company}`;
  return {
    sourceId: "ingest_url_scrape" as RawListing["sourceId"],
    sourceLabel: "URL paste (link-only)",
    sourceLane: "grounded_web",
    title,
    company,
    location: undefined,
    url: resolvedUrl,
    canonicalUrl: resolvedUrl,
    finalUrl: resolvedUrl,
    descriptionText: noteForDescription,
    tags: [],
  };
}

function extractHttpStatus(message: string): number | undefined {
  const match = String(message || "").match(/\bHTTP\s+(\d{3})\b/i);
  if (!match) return undefined;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : undefined;
}

async function defaultScrapeJobPosting(url: string): Promise<ScrapeResult> {
  const module = await import("../../../../server/shared/job-scraper-core.mjs");
  if (!module || typeof module.scrapeJobPosting !== "function") {
    throw new Error("Shared job scraper module is unavailable.");
  }
  return (await module.scrapeJobPosting(url)) as ScrapeResult;
}
