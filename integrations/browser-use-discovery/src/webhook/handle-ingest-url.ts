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

export type HandleIngestUrlDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  pipelineWriter: PipelineWriterLike;
  loadStoredWorkerConfig?(sheetId: string): Promise<StoredWorkerConfig | null>;
  fetchGreenhouseJob?: typeof fetchGreenhouseJob;
  fetchLeverJob?: typeof fetchLeverJob;
  fetchAshbyJob?: typeof fetchAshbyJob;
  scrapeJobPosting?: (url: string) => Promise<ScrapeResult>;
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

  dependencies.log?.("discovery.run.ingest_url_request_accepted", {
    runId,
    hasManual: !!ingestRequest.manual,
    hasSheetId: !!String(ingestRequest.sheetId || "").trim(),
  });

  try {
    const resolvedSheetId = await resolveSheetId(
      ingestRequest.sheetId,
      dependencies,
    );
    if (!resolvedSheetId) {
      return jsonResponse(200, {
        ok: false,
        reason: "worker_error",
        message: "No sheetId was provided and no default sheetId is configured.",
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
        dependencies,
        sheetId: resolvedSheetId,
        lead: manualLead,
        strategy: "manual_fill",
        runId,
      });
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
    if (classified.kind === "blocked_aggregator") {
      dependencies.log?.("discovery.run.ingest_url_blocked_aggregator", {
        runId,
        host: classified.host,
        provider: classified.provider,
      });
      return jsonResponse(200, {
        ok: false,
        reason: "blocked_aggregator",
        host: classified.host,
        message:
          "This job board blocks automated extraction. Use manual fill for this listing.",
      } satisfies IngestUrlResponseV1);
    }

    let rawListing: RawListing | null = null;
    let strategy: "ats_api" | "jsonld" | "cheerio_dom" = "cheerio_dom";

    if (classified.kind === "ats_direct") {
      const atsResult = await fetchFromAts(classified, dependencies);
      if (!atsResult.ok) {
        // Workable ATS links currently have no public fetcher here; fallback
        // to battle-tested Cheerio extraction.
        if (classified.provider !== "workable") {
          return jsonResponse(200, {
            ok: false,
            reason: "scrape_failed",
            httpStatus: atsResult.httpStatus,
            message: atsResult.message,
            hint:
              "Try the listing URL in a browser and use manual fill if the posting is gated or gone.",
          } satisfies IngestUrlResponseV1);
        }
      } else {
        rawListing = atsResult.rawListing;
        strategy = "ats_api";
      }
    }

    if (!rawListing) {
      const scraped = await scrapeToRawListing(
        ingestRequest.url,
        dependencies,
      );
      if (!scraped.ok) {
        return jsonResponse(200, {
          ok: false,
          reason: "scrape_failed",
          httpStatus: scraped.httpStatus,
          message: scraped.message,
          hint:
            "The page may require login or block bots. Use manual fill if this keeps failing.",
        } satisfies IngestUrlResponseV1);
      }
      rawListing = scraped.rawListing;
      strategy = scraped.strategy;
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
      dependencies,
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
    if (
      manualRecord.fitScore !== undefined &&
      (typeof manualRecord.fitScore !== "number" ||
        !Number.isFinite(manualRecord.fitScore))
    ) {
      return {
        ok: false,
        message: "manual.fitScore must be a finite number between 0 and 10 when present.",
      };
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
      fitScore:
        typeof manualRecord.fitScore === "number"
          ? manualRecord.fitScore
          : undefined,
    };
  }

  return {
    ok: true,
    request: {
      event: INGEST_URL_EVENT,
      schemaVersion: INGEST_URL_SCHEMA_VERSION,
      url,
      ...(sheetId ? { sheetId } : {}),
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
  strategy: "ats_api" | "jsonld" | "cheerio_dom" | "manual_fill";
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
