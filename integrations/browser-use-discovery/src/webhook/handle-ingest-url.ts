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
import {
  buildAcceptedRunStatus,
  buildFailedRunStatus,
  buildRunningRunStatus,
  buildRunStatusPath,
  type DiscoveryRunStatusStore,
} from "../state/run-status-store.ts";
import { fetchAshbyJob, fetchGreenhouseJob, fetchLeverJob } from "../sources/ats-public-fetchers.ts";
import {
  extractJobWithBrowserUseCloud,
  type BrowserUseCloudExtractor,
} from "../sources/browser-use-cloud-extractor.ts";
import {
  extractJobWithGeminiUrlContext,
  type GeminiUrlContextExtractor,
} from "../sources/gemini-url-context-extractor.ts";
import { classifyIngestUrl } from "../sources/ingest-url-router.ts";
import {
  hasValidWebhookSecret,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";
import {
  appendRunStatusToken,
  createRunStatusToken,
} from "./run-status-auth.ts";
import { createSafetyTimer } from "./safety-timer.ts";

// Default maximum duration for an async /ingest-url run before the safety
// timer force-terminalizes its status row. /ingest-url runs are
// expected to finish in seconds (one URL, one extraction); a 5-minute
// backstop is generous enough to absorb slow Browser Use Cloud sessions
// while still preventing a wedged poll target.
const DEFAULT_INGEST_MAX_RUN_DURATION_MS = 5 * 60 * 1000;

// Per-field length caps for /ingest-url. The whole-body cap in server.ts
// (2 MiB) bounds the worst case; these per-field caps ensure no single
// free-form string can crowd out the rest of the payload or downstream
// prompts. Returning a precise 400 with the offending field name makes the
// failure surface debuggable from the dashboard.
const MAX_URL_LENGTH = 2048;
const MAX_MANUAL_TITLE_LENGTH = 300;
const MAX_MANUAL_COMPANY_LENGTH = 200;
const MAX_MANUAL_LOCATION_LENGTH = 200;
const MAX_MANUAL_DESCRIPTION_LENGTH = 20_000;

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
  | "gemini_url_context"
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
  extractWithGeminiUrlContext?: GeminiUrlContextExtractor;
  runStatusPathForRun?(runId: string): string;
  runStatusStore?: DiscoveryRunStatusStore;
  includeRunStatusToken?: boolean;
  asyncPollAfterMs?: number;
  /**
   * Maximum duration in milliseconds for an async /ingest-url run before its
   * status row is forcibly marked terminal. Defaults to 5 minutes. Mirrors
   * the safety backstop in handle-discovery-webhook.ts.
   */
  maxRunDurationMs?: number;
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
    async: ingestRequest.async === true,
  });

  if (
    ingestRequest.async === true &&
    !ingestRequest.manual &&
    dependencies.runStatusStore
  ) {
    return acceptAsyncIngestUrl({
      request,
      ingestRequest,
      runId,
      now,
      dependencies: effectiveDependencies,
    });
  }

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
      const manualLead = await rawListingToSingleLead(rawManual, {
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
      const publicLinkedInUrl = canonicalLinkedInJobDetailUrl(ingestRequest.url);
      if (publicLinkedInUrl) {
        const scraped = await scrapeToRawListing(
          publicLinkedInUrl,
          effectiveDependencies,
        );
        if (scraped.ok && !isWeakScrapedListing(scraped.rawListing)) {
          rawListing = scraped.rawListing;
          strategy = scraped.strategy;
        }
      }
      if (!rawListing) {
        const browserUseResult = await tryBrowserUseCloudExtraction({
          url: ingestRequest.url,
          runId,
          host: classified.host,
          dependencies: effectiveDependencies,
          trigger: "blocked_aggregator",
        });
        if (browserUseResult.ok) {
          rawListing = browserUseResult.rawListing;
          strategy = "browser_use_cloud";
        } else {
          const geminiResult = await tryGeminiUrlContextExtraction({
            url: ingestRequest.url,
            runId,
            host: classified.host,
            dependencies: effectiveDependencies,
          });
          if (geminiResult.ok) {
            rawListing = geminiResult.rawListing;
            strategy = "gemini_url_context";
          } else {
            return rejectBlockedAggregatorUrl({
              url: ingestRequest.url,
              host: classified.host,
              provider: classified.provider,
            });
          }
        }
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
        rawListing = preservePastedIngestUrl(
          atsResult.rawListing,
          ingestRequest.url,
        );
        strategy = "ats_api";
      }
    }

    // Tier 2: Gemini URL context. Runs after ATS public API and before the
    // Cheerio/JSON-LD scrape. Gemini reads the live page and returns structured
    // job fields, which handles JS-rendered or awkward employer HTML that the
    // Cheerio scraper struggles with. Weak/failed extraction falls through to
    // Cheerio; aggregators are handled by the Browser Use path above.
    if (!rawListing) {
      const geminiResult = await tryGeminiUrlContextExtraction({
        url: ingestRequest.url,
        runId,
        host: safeHost(ingestRequest.url),
        dependencies: effectiveDependencies,
      });
      if (geminiResult.ok) {
        rawListing = geminiResult.rawListing;
        strategy = "gemini_url_context";
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
          return rejectScrapeFailedUrl({
            httpStatus: scraped.httpStatus,
            message: scraped.message,
          });
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
          return rejectLowQualityExtraction({
            message: "The worker could not extract enough real job details from this URL.",
          });
        }
      } else {
        rawListing = scraped.rawListing;
        strategy = scraped.strategy;
      }
    }

    const quality = assessIngestListingQuality(rawListing, strategy);
    if (!quality.ok) {
      dependencies.log?.("discovery.run.ingest_url_quality_rejected", {
        runId,
        strategy,
        reason: quality.reason,
        title: rawListing.title,
        company: rawListing.company,
        sourceId: rawListing.sourceId,
      });
      return rejectLowQualityExtraction({
        message: quality.message,
      });
    }

    const lead = await rawListingToSingleLead(rawListing, {
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

function buildIngestStatusPath(
  runId: string,
  dependencies: HandleIngestUrlDependencies,
): string {
  const baseStatusPath = (dependencies.runStatusPathForRun || buildRunStatusPath)(
    runId,
  );
  if (!dependencies.includeRunStatusToken) return baseStatusPath;
  return appendRunStatusToken(
    baseStatusPath,
    createRunStatusToken(dependencies.runtimeConfig.webhookSecret, runId),
  );
}

async function acceptAsyncIngestUrl(input: {
  request: WebhookRequestLike;
  ingestRequest: IngestUrlRequestV1;
  runId: string;
  now: () => Date;
  dependencies: HandleIngestUrlDependencies;
}): Promise<WebhookResponseLike> {
  const acceptedAt = input.now().toISOString();
  const statusPath = buildIngestStatusPath(input.runId, input.dependencies);
  const pollAfterMs = Math.max(1000, input.dependencies.asyncPollAfterMs || 2500);
  const acceptedStatus = buildAcceptedRunStatus({
    runId: input.runId,
    trigger: "manual",
    request: {
      sheetId: String(input.ingestRequest.sheetId || "").trim(),
      variationKey: "ingest_url",
      requestedAt: acceptedAt,
    },
    acceptedAt,
  });
  const startedAt = input.now().toISOString();
  const runningStatus = buildRunningRunStatus(acceptedStatus, startedAt);
  input.dependencies.runStatusStore?.put(runningStatus);

  const maxRunDurationMs =
    input.dependencies.maxRunDurationMs ?? DEFAULT_INGEST_MAX_RUN_DURATION_MS;
  // Mirrors handle-discovery-webhook.ts: guarantee the /ingest-url run STATUS
  // becomes terminal even if the inner sync handler never resolves/rejects.
  const safety = createSafetyTimer({
    runId: input.runId,
    runMode: "ingest_url_async",
    maxRunDurationMs,
    runStatusStore: input.dependencies.runStatusStore,
    acceptedStatus,
    now: input.now,
    log: input.dependencies.log,
  });

  const {
    async: _asyncRequested,
    googleAccessToken: _requestGoogleAccessToken,
    ...syncRequest
  } = input.ingestRequest;
  void handleIngestUrlWebhook(
    {
      ...input.request,
      bodyText: JSON.stringify(syncRequest),
    },
    {
      ...input.dependencies,
      randomId: () => input.runId,
      runStatusStore: undefined,
    },
  )
    .then((response) => {
      if (safety.isTerminalStatusWritten()) {
        input.dependencies.log?.("discovery.run.ingest_url_async_completed_after_safety", {
          runId: input.runId,
          reason: "terminal_status_already_written",
          httpStatus: response.status,
        });
        return;
      }
      safety.markTerminal();
      safety.clear();
      const completedAt = input.now().toISOString();
      const ingestResult = parseIngestResponseBody(response.body);
      const failed = isFailedAsyncIngestResponse(response, ingestResult);
      const current =
        input.dependencies.runStatusStore?.get(input.runId) ?? runningStatus;
      input.dependencies.runStatusStore?.put({
        ...current,
        status: failed ? "failed" : "completed",
        terminal: true,
        message: buildAsyncIngestMessage(ingestResult, failed),
        completedAt,
        updatedAt: completedAt,
        warnings: current.warnings || [],
        sources: current.sources || [],
        ingestResult:
          ingestResult ||
          ({
            ok: false,
            reason: "worker_error",
            message: `Ingest worker returned HTTP ${response.status}.`,
          } satisfies IngestUrlResponseV1),
        ...(failed
          ? {
              error:
                (ingestResult && "message" in ingestResult
                  ? ingestResult.message
                  : "") || `Ingest worker returned HTTP ${response.status}.`,
            }
          : {}),
      });
      input.dependencies.log?.("discovery.run.ingest_url_async_completed", {
        runId: input.runId,
        status: failed ? "failed" : "completed",
        httpStatus: response.status,
        ok: ingestResult?.ok,
        ...(ingestResult && "strategy" in ingestResult
          ? { strategy: ingestResult.strategy }
          : {}),
        ...(ingestResult && "reason" in ingestResult
          ? { reason: ingestResult.reason }
          : {}),
      });
    })
    .catch((error) => {
      if (safety.isTerminalStatusWritten()) {
        input.dependencies.log?.("discovery.run.ingest_url_async_failed_after_safety", {
          runId: input.runId,
          reason: "terminal_status_already_written",
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      safety.markTerminal();
      safety.clear();
      input.dependencies.runStatusStore?.put(
        buildFailedRunStatus(runningStatus, error, input.now().toISOString()),
      );
      input.dependencies.log?.("discovery.run.ingest_url_async_failed", {
        runId: input.runId,
        message: error instanceof Error ? error.message : String(error),
      });
    });

  // Start the safety backstop AFTER the inner handler is dispatched so the
  // timer cannot race a synchronous completion.
  safety.schedule();

  input.dependencies.log?.("discovery.run.ingest_url_async_accepted", {
    runId: input.runId,
    statusPath,
    pollAfterMs,
  });

  return jsonResponse(
    202,
    {
      ok: true,
      kind: "accepted_async",
      runId: input.runId,
      message: "URL ingest accepted — worker is reading the posting.",
      statusPath,
      pollAfterMs,
    } satisfies IngestUrlResponseV1,
  );
}

function parseIngestResponseBody(body: string): IngestUrlResponseV1 | null {
  try {
    const parsed = JSON.parse(String(body || ""));
    if (parsed && typeof parsed === "object") {
      return parsed as IngestUrlResponseV1;
    }
  } catch {
    // Fall through to null.
  }
  return null;
}

function isFailedAsyncIngestResponse(
  response: WebhookResponseLike,
  result: IngestUrlResponseV1 | null,
): boolean {
  if (response.status >= 500) return true;
  if (!result) return true;
  if (result.ok === true) return false;
  return result.reason !== "duplicate";
}

function buildAsyncIngestMessage(
  result: IngestUrlResponseV1 | null,
  failed: boolean,
): string {
  if (!result) return "URL ingest finished without a readable response.";
  if (result.ok === true) {
    if ("strategy" in result) {
      return `URL ingest completed via ${result.strategy}.`;
    }
    return "message" in result
      ? result.message || "URL ingest accepted."
      : "URL ingest accepted.";
  }
  if (result.reason === "duplicate") {
    return result.message || "This job already exists in your Pipeline.";
  }
  return failed
    ? result.message || "URL ingest failed."
    : result.message || "URL ingest completed.";
}

function rejectBlockedAggregatorUrl(input: {
  url: string;
  host: string;
  provider: string;
}): WebhookResponseLike {
  const label = input.provider || input.host || "This site";
  return jsonResponse(200, {
    ok: false,
    reason: "blocked_aggregator",
    host: input.host,
    message:
      `${label} did not expose a complete posting that JobBored can safely add.`,
    hint: buildTryAnotherPostingLinkHint(input.url),
  } satisfies IngestUrlResponseV1);
}

function rejectScrapeFailedUrl(input: {
  httpStatus?: number;
  message: string;
}): WebhookResponseLike {
  return jsonResponse(200, {
    ok: false,
    reason: "scrape_failed",
    ...(input.httpStatus ? { httpStatus: input.httpStatus } : {}),
    message:
      "The worker could not read a complete job posting from this URL.",
    hint: buildTryAnotherPostingLinkHint(""),
  } satisfies IngestUrlResponseV1);
}

function rejectLowQualityExtraction(input: { message: string }): WebhookResponseLike {
  return jsonResponse(200, {
    ok: false,
    reason: "low_quality_extraction",
    message: input.message,
    hint: buildTryAnotherPostingLinkHint(""),
  } satisfies IngestUrlResponseV1);
}

function buildTryAnotherPostingLinkHint(url: string): string {
  const host = safeHost(url);
  const linkedInHint = host.includes("linkedin.com")
    ? " LinkedIn often hides the full posting behind search/login pages."
    : "";
  return (
    "Try the employer careers page or canonical ATS posting instead, such as Greenhouse, Lever, Ashby, Workday, or the company's own job-detail URL." +
    linkedInHint
  );
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
  if (url.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      message: `url must be ${MAX_URL_LENGTH} characters or fewer (received ${url.length}).`,
    };
  }
  const sheetId =
    typeof record.sheetId === "string" ? record.sheetId.trim() : "";
  const googleAccessToken =
    typeof record.googleAccessToken === "string"
      ? record.googleAccessToken.trim()
      : "";
  const asyncRequested = record.async === true;
  if (record.async != null && typeof record.async !== "boolean") {
    return {
      ok: false,
      message: "async must be a boolean when present.",
    };
  }
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
    if (title.length > MAX_MANUAL_TITLE_LENGTH) {
      return {
        ok: false,
        message: `manual.title must be ${MAX_MANUAL_TITLE_LENGTH} characters or fewer (received ${title.length}).`,
      };
    }
    if (company.length > MAX_MANUAL_COMPANY_LENGTH) {
      return {
        ok: false,
        message: `manual.company must be ${MAX_MANUAL_COMPANY_LENGTH} characters or fewer (received ${company.length}).`,
      };
    }
    const manualLocationRaw =
      typeof manualRecord.location === "string"
        ? manualRecord.location.trim()
        : "";
    if (manualLocationRaw.length > MAX_MANUAL_LOCATION_LENGTH) {
      return {
        ok: false,
        message: `manual.location must be ${MAX_MANUAL_LOCATION_LENGTH} characters or fewer (received ${manualLocationRaw.length}).`,
      };
    }
    const manualDescriptionRaw =
      typeof manualRecord.description === "string"
        ? manualRecord.description
        : "";
    if (manualDescriptionRaw.length > MAX_MANUAL_DESCRIPTION_LENGTH) {
      return {
        ok: false,
        message: `manual.description must be ${MAX_MANUAL_DESCRIPTION_LENGTH} characters or fewer (received ${manualDescriptionRaw.length}).`,
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
      location: manualLocationRaw || undefined,
      description: manualDescriptionRaw || undefined,
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
      ...(asyncRequested ? { async: true } : {}),
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

function preservePastedIngestUrl(rawListing: RawListing, url: string): RawListing {
  const pastedUrl = String(url || "").trim();
  if (!pastedUrl) return rawListing;
  return {
    ...rawListing,
    url: pastedUrl,
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
    const rawTitle = String(scraped.title || "").trim();
    const parsedTitle = parseScrapedJobApplicationTitle(rawTitle);
    const title = parsedTitle?.title || rawTitle;
    const scrapedTags = [
      ...deriveIngestTitleTags(title),
      ...((Array.isArray(scraped.skills) ? scraped.skills : []) as string[]),
      ...((Array.isArray(scraped.requirements)
        ? scraped.requirements
        : []) as string[]),
    ];

    return {
      ok: true,
      strategy,
      rawListing: {
        sourceId: "ingest_url_scrape" as RawListing["sourceId"],
        sourceLabel: host.endsWith("linkedin.com") ? "LinkedIn" : "Company page",
        sourceLane: "grounded_web",
        title,
        company: parsedTitle?.company || inferCompanyFromHost(host),
        location: undefined,
        url: resolvedUrl,
        canonicalUrl: resolvedUrl,
        finalUrl: resolvedUrl,
        descriptionText: String(scraped.description || "").trim() || undefined,
        tags: sanitizeIngestTags(scrapedTags),
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

async function tryGeminiUrlContextExtraction(input: {
  url: string;
  runId: string;
  host: string;
  dependencies: HandleIngestUrlDependencies;
}): Promise<
  | { ok: true; rawListing: RawListing }
  | { ok: false; reason: string; message: string }
> {
  if (!String(input.dependencies.runtimeConfig.geminiApiKey || "").trim()) {
    const message =
      "Gemini URL Context skipped: optional Gemini url_context tool is unavailable because BROWSER_USE_DISCOVERY_GEMINI_API_KEY is not configured.";
    input.dependencies.log?.("discovery.run.ingest_url_gemini_skipped", {
      runId: input.runId,
      host: input.host,
      reason: "missing_api_key",
      message,
      provider: "gemini",
      tool: "url_context",
      optional: true,
      hasApiKey: false,
    });
    return { ok: false, reason: "missing_api_key", message };
  }
  const extractor =
    input.dependencies.extractWithGeminiUrlContext ||
    extractJobWithGeminiUrlContext;
  try {
    const result = await extractor({
      url: input.url,
      runId: input.runId,
      runtimeConfig: input.dependencies.runtimeConfig,
    });
    if (result.ok) {
      input.dependencies.log?.("discovery.run.ingest_url_gemini_completed", {
        runId: input.runId,
        host: input.host,
        confidence: result.confidence,
      });
      return { ok: true, rawListing: result.rawListing };
    }
    input.dependencies.log?.("discovery.run.ingest_url_gemini_skipped", {
      runId: input.runId,
      host: input.host,
      reason: result.reason,
      message: result.message,
      hasApiKey: !!String(input.dependencies.runtimeConfig.geminiApiKey || "").trim(),
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.dependencies.log?.("discovery.run.ingest_url_gemini_failed", {
      runId: input.runId,
      host: input.host,
      message,
    });
    return { ok: false, reason: "extract_failed", message };
  }
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

function assessIngestListingQuality(
  rawListing: RawListing,
  strategy: IngestUrlStrategy,
):
  | { ok: true }
  | { ok: false; reason: string; message: string } {
  if (strategy === "manual_fill") return { ok: true };
  const title = String(rawListing.title || "").trim();
  const company = String(rawListing.company || "").trim();
  const description = String(rawListing.descriptionText || "").trim();
  const confidence = Number(rawListing.metadata?.browserUseConfidence);

  if (strategy === "url_only") {
    return {
      ok: false,
      reason: "url_only",
      message: "The worker only found the URL, not a complete job posting.",
    };
  }
  if (strategy === "browser_use_cloud" && Number.isFinite(confidence) && confidence < 0.5) {
    return {
      ok: false,
      reason: "low_browser_use_confidence",
      message:
        "Browser Use returned a low-confidence result instead of a complete job posting.",
    };
  }
  if (isPlaceholderIngestText(title) || isPlaceholderIngestText(company)) {
    return {
      ok: false,
      reason: "placeholder_fields",
      message:
        "The worker found placeholder job details instead of a real posting.",
    };
  }
  if (description.length < 20 || isPlaceholderIngestDescription(description)) {
    return {
      ok: false,
      reason: "weak_description",
      message:
        "The worker could not extract enough real job details from this URL.",
    };
  }
  return { ok: true };
}

function isPlaceholderIngestText(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "unavailable" ||
    normalized === "unknown" ||
    normalized === "unknown company" ||
    normalized === "job posting" ||
    normalized.includes("source gated") ||
    normalized.includes("login required")
  );
}

function isPlaceholderIngestDescription(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes("couldn't auto-extract") ||
    normalized.includes("source gated") ||
    normalized.includes("login wall") ||
    normalized.includes("sign in to view") ||
    normalized === "clean ats"
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function canonicalLinkedInJobDetailUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null;

  const currentJobId = String(parsed.searchParams.get("currentJobId") || "").trim();
  if (/^\d{5,}$/.test(currentJobId)) {
    return `https://www.linkedin.com/jobs/view/${currentJobId}`;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== "jobs" || segments[1] !== "view") return null;
  const detailToken = String(segments[2] || "").trim();
  const match = detailToken.match(/(\d{5,})(?:\D*)$/);
  if (!match) return null;
  return `https://www.linkedin.com/jobs/view/${match[1]}`;
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

function parseScrapedJobApplicationTitle(
  title: string,
): { title: string; company: string } | null {
  const clean = String(title || "").replace(/\s+/g, " ").trim();
  const match = clean.match(
    /^(?:Job Application for|Apply for)\s+(.+?)\s+at\s+(.+?)(?:\s+[|–-]\s+.*)?$/i,
  );
  if (match) {
    const parsedTitle = String(match[1] || "").trim();
    const company = String(match[2] || "").trim();
    if (parsedTitle && company) return { title: parsedTitle, company };
  }

  const linkedInMatch = clean.match(
    /^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+?)?\s+[|–-]\s+LinkedIn$/i,
  );
  if (!linkedInMatch) return null;
  const linkedInCompany = String(linkedInMatch[1] || "").trim();
  const linkedInTitle = String(linkedInMatch[2] || "").trim();
  return linkedInTitle && linkedInCompany
    ? { title: linkedInTitle, company: linkedInCompany }
    : null;
}

function deriveIngestTitleTags(title: string): string[] {
  const clean = String(title || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const tags: string[] = [];
  const commaParts = clean.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    tags.push(commaParts.slice(1).join(", "));
  }
  const seniority = clean.match(
    /\b(Intern|Junior|Associate|Senior|Staff|Principal|Lead|Director|Head|VP|Vice President)\b/i,
  )?.[0];
  if (seniority) tags.push(seniority);
  return tags;
}

function sanitizeIngestTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const value = String(tag || "").replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
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
