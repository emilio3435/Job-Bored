import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRuntimeConfig, type WorkerRuntimeConfig } from "../config.ts";
import {
  DEFAULT_PIPELINE_SHEET_NAME,
  PIPELINE_HEADER_ROW,
} from "../contracts.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import { resolveAccessToken } from "../sheets/pipeline-writer.ts";

type FetchLike = typeof fetch;

export type JobAvailabilityStatus =
  | "open"
  | "expired"
  | "unknown"
  | "temporarily_unreachable";

export type JobAvailabilityClassification = {
  status: JobAvailabilityStatus;
  reason: string;
  evidence: string;
  confidence: "high" | "medium" | "low" | "none";
  source:
    | "http_status"
    | "html_marker"
    | "open_marker"
    | "captcha_marker"
    | "network_error"
    | "timeout"
    | "invalid_url"
    | "ambiguous";
  httpStatus?: number;
  finalUrl?: string;
};

export type ExpiredCleanupRowResult = {
  rowNumber: number;
  link: string;
  normalizedLink: string;
  previousStatus: string;
  action:
    | "would_expire"
    | "expired"
    | "open"
    | "needs_review"
    | "skipped";
  classification?: JobAvailabilityClassification;
  reason: string;
  auditNote?: string;
};

export type ExpiredCleanupResult = {
  sheetId: string;
  sheetName: string;
  dryRun: boolean;
  checked: number;
  updated: number;
  wouldUpdate: number;
  wouldExpire: number;
  skipped: number;
  needsReview: number;
  open: number;
  results: ExpiredCleanupRowResult[];
};

type ExpiredCleanupOptions = {
  sheetName?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  dryRun?: boolean;
  maxRows?: number;
  timeoutMs?: number;
  tokenScope?: string;
};

type SheetCellUpdate = {
  range: string;
  values: string[][];
};

type SheetValuesResponse = {
  values?: unknown[][];
};

const DEFAULT_TOKEN_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_TIMEOUT_MS = 15_000;
const STATUS_COLUMN_INDEX = 12;
const NOTES_COLUMN_INDEX = 14;
const LINK_COLUMN_INDEX = 4;
const MIN_HEADER_COUNT = 17;
const LAST_COLUMN_LETTER = columnIndexToLetter(PIPELINE_HEADER_ROW.length);
const ELIGIBLE_STATUS_KEYS = new Set(["", "new", "researching"]);
const PROTECTED_STATUS_KEYS = new Set([
  "applied",
  "phone screen",
  "interviewing",
  "offer",
  "rejected",
  "passed",
  "expired",
]);

const CAPTCHA_MARKERS = [
  {
    id: "captcha",
    regex: /\b(captcha|recaptcha|hcaptcha)\b/i,
  },
  {
    id: "human_verification",
    regex: /\b(verify you are human|checking your browser|cloudflare ray id)\b/i,
  },
] as const;

const CLOSED_MARKERS = [
  {
    id: "greenhouse_no_longer_open",
    regex: /\bjob you are looking for is no longer open\b/i,
  },
  {
    id: "lever_expired",
    regex: /\bjob posting has expired\b/i,
  },
  {
    id: "job_has_expired",
    regex: /\b(this\s+)?job\s+has\s+expired\b/i,
  },
  {
    id: "closed_accepting_applications",
    regex: /\bno longer accepting applications\b/i,
  },
  {
    id: "position_filled",
    regex: /\b(position|role|opening|job)\s+(has been\s+)?filled\b/i,
  },
  {
    id: "posting_closed",
    regex: /\b(job|position|opening|role|posting)\s+(has been\s+)?closed\b/i,
  },
  {
    id: "posting_no_longer_available",
    regex:
      /\b(job|position|opening|role|posting)(?:\s+\w+){0,6}\s+no longer available\b/i,
  },
  {
    id: "not_found_job",
    regex: /\b(job|position|opening|role|posting)\s+(not found|could not be found)\b/i,
  },
  {
    id: "application_deadline_passed",
    regex: /\b(application deadline|posting deadline)\s+(has\s+)?passed\b/i,
  },
] as const;

const OPEN_MARKERS = [
  {
    id: "apply_now",
    regex: /\bapply\s+(now|for this job|for this role|for this position)\b/i,
  },
  {
    id: "submit_application",
    regex: /\bsubmit\s+(your\s+)?application\b/i,
  },
  {
    id: "application_form",
    regex: /\b(application form|start application)\b/i,
  },
  {
    id: "jobposting_schema",
    regex: /"@type"\s*:\s*"JobPosting"/i,
  },
] as const;

function columnIndexToLetter(index: number): string {
  if (!Number.isFinite(index) || index < 1) return "A";
  let n = Math.floor(index);
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRowCells(row: unknown[]): string[] {
  return Array.from({ length: PIPELINE_HEADER_ROW.length }, (_, index) =>
    asText(row[index]),
  );
}

function encodeRange(range: string): string {
  return encodeURIComponent(range);
}

function buildHeaders(token: string, isJson = true): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(isJson ? { "Content-Type": "application/json" } : {}),
  };
}

async function getSheetValues(
  sheetId: string,
  range: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<string[][]> {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeRange(range)}`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");

  const response = await fetchImpl(url, {
    headers: buildHeaders(token, false),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to read ${range}: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
    );
  }
  const data = (await response.json()) as SheetValuesResponse;
  return Array.isArray(data.values)
    ? data.values.map((row) =>
        Array.isArray(row) ? row.map((cell) => asText(cell)) : [],
      )
    : [];
}

function validatePipelineHeader(values: string[][], sheetName: string): void {
  const header = toRowCells(values[0] || []);
  const expected = PIPELINE_HEADER_ROW.map((value) => value.trim());
  for (let index = 0; index < MIN_HEADER_COUNT; index += 1) {
    if ((header[index] || "") !== expected[index]) {
      throw new Error(
        `${sheetName} header mismatch at ${columnIndexToLetter(index + 1)}. Expected "${expected[index]}", got "${header[index] || "<empty>"}".`,
      );
    }
  }
}

async function batchUpdateCells(
  sheetId: string,
  updates: SheetCellUpdate[],
  token: string,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!updates.length) return;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`,
  );
  const response = await fetchImpl(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates.map((entry) => ({
        range: entry.range,
        majorDimension: "ROWS",
        values: entry.values,
      })),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Expired cleanup sheet update failed: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
    );
  }
}

function htmlToSearchText(body: string): string {
  return String(body || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function matchMarker(
  text: string,
  markers: readonly { id: string; regex: RegExp }[],
): { id: string; evidence: string } | null {
  for (const marker of markers) {
    const match = marker.regex.exec(text);
    if (match) {
      return {
        id: marker.id,
        evidence: String(match[0] || "").replace(/\s+/g, " ").slice(0, 180),
      };
    }
  }
  return null;
}

export function classifyJobPostingAvailability(input: {
  url: string;
  httpStatus?: number;
  body?: string;
  finalUrl?: string;
}): JobAvailabilityClassification {
  const httpStatus = Number(input.httpStatus || 0);
  if (httpStatus === 404 || httpStatus === 410) {
    return {
      status: "expired",
      reason: `HTTP ${httpStatus} from posting URL`,
      evidence: `HTTP ${httpStatus}`,
      confidence: "high",
      source: "http_status",
      httpStatus,
      finalUrl: input.finalUrl,
    };
  }

  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return {
      status: "unknown",
      reason: `HTTP ${httpStatus} requires review`,
      evidence: `HTTP ${httpStatus}`,
      confidence: "none",
      source: "http_status",
      httpStatus,
      finalUrl: input.finalUrl,
    };
  }

  if (httpStatus >= 500) {
    return {
      status: "temporarily_unreachable",
      reason: `HTTP ${httpStatus} from posting URL`,
      evidence: `HTTP ${httpStatus}`,
      confidence: "none",
      source: "http_status",
      httpStatus,
      finalUrl: input.finalUrl,
    };
  }

  const text = htmlToSearchText(input.body || "");
  if (!text) {
    return {
      status: "unknown",
      reason: "No readable page text",
      evidence: "",
      confidence: "none",
      source: "ambiguous",
      httpStatus: httpStatus || undefined,
      finalUrl: input.finalUrl,
    };
  }

  const captcha = matchMarker(text, CAPTCHA_MARKERS);
  if (captcha) {
    return {
      status: "unknown",
      reason: `Review blocked by ${captcha.id}`,
      evidence: captcha.evidence,
      confidence: "none",
      source: "captcha_marker",
      httpStatus: httpStatus || undefined,
      finalUrl: input.finalUrl,
    };
  }

  const closed = matchMarker(text, CLOSED_MARKERS);
  if (closed) {
    return {
      status: "expired",
      reason: `Matched closed-posting marker: ${closed.id}`,
      evidence: closed.evidence,
      confidence: "high",
      source: "html_marker",
      httpStatus: httpStatus || undefined,
      finalUrl: input.finalUrl,
    };
  }

  const open = matchMarker(text, OPEN_MARKERS);
  if (open) {
    return {
      status: "open",
      reason: `Matched open-posting marker: ${open.id}`,
      evidence: open.evidence,
      confidence: open.id === "jobposting_schema" ? "medium" : "high",
      source: "open_marker",
      httpStatus: httpStatus || undefined,
      finalUrl: input.finalUrl,
    };
  }

  return {
    status: "unknown",
    reason: "No strong open or closed marker found",
    evidence: text.slice(0, 180),
    confidence: "none",
    source: "ambiguous",
    httpStatus: httpStatus || undefined,
    finalUrl: input.finalUrl,
  };
}

export async function checkJobPostingUrl(
  rawUrl: string,
  options: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<JobAvailabilityClassification> {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this runtime");
  }

  let url: URL;
  try {
    url = new URL(String(rawUrl || "").trim());
  } catch (_) {
    return {
      status: "unknown",
      reason: "Invalid job URL",
      evidence: String(rawUrl || "").slice(0, 180),
      confidence: "none",
      source: "invalid_url",
    };
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "JobBoredExpiredCleanup/1.0",
      },
    });
    const body = await response.text().catch(() => "");
    return classifyJobPostingAvailability({
      url: url.toString(),
      httpStatus: response.status,
      body,
      finalUrl: response.url || url.toString(),
    });
  } catch (err) {
    const isTimeout =
      err &&
      typeof err === "object" &&
      "name" in err &&
      String((err as { name?: unknown }).name) === "AbortError";
    return {
      status: "temporarily_unreachable",
      reason: isTimeout
        ? `Timed out after ${timeoutMs}ms`
        : `Network error: ${err instanceof Error ? err.message : String(err)}`,
      evidence: "",
      confidence: "none",
      source: isTimeout ? "timeout" : "network_error",
      finalUrl: url.toString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function statusKey(status: string): string {
  return String(status || "").trim().toLowerCase();
}

function isEligibleForCleanup(status: string): boolean {
  return ELIGIBLE_STATUS_KEYS.has(statusKey(status));
}

function isProtectedStatus(status: string): boolean {
  return PROTECTED_STATUS_KEYS.has(statusKey(status));
}

function appendAuditNote(existingNotes: string, auditLine: string): string {
  const current = String(existingNotes || "").trim();
  return current ? `${current}\n${auditLine}` : auditLine;
}

function shortDate(timestamp: string): string {
  // ISO timestamps look like 2026-05-26T04:45:12.383Z. The cleanup notes need
  // a human-readable date stamp rather than a full ISO with milliseconds, so
  // keep just the YYYY-MM-DD prefix.
  const trimmed = String(timestamp || "").slice(0, 10);
  return trimmed || timestamp;
}

function plainStatus(status: string): string {
  return status && status.trim() ? status.trim() : "no status";
}

/** Human-friendly reason text the dashboard and Sheet notes share. */
export function describeAvailabilityReason(
  classification: JobAvailabilityClassification,
): string {
  switch (classification.source) {
    case "http_status": {
      const code = Number(classification.httpStatus || 0);
      if (code === 404) return "the job page is gone (HTTP 404)";
      if (code === 410) return "the company took the job page down (HTTP 410)";
      if (code === 401)
        return "the job page asked us to sign in before showing it (HTTP 401)";
      if (code === 403)
        return "the site blocked us before we could read the page (HTTP 403)";
      if (code === 429)
        return "the site rate-limited us before we could read the page (HTTP 429)";
      if (code >= 500) return `the site is down right now (HTTP ${code})`;
      if (code) return `the site answered with HTTP ${code}`;
      return "the site answered with an unexpected status";
    }
    case "html_marker":
      return "the job page says the role is closed";
    case "open_marker":
      return "the job page is still accepting applications";
    case "captcha_marker":
      return "the page asked us to prove we are human before showing the job";
    case "network_error":
      return "we could not reach the site (network error)";
    case "timeout":
      return "the page took too long to load";
    case "invalid_url":
      return "the link in the row is not a valid URL";
    case "ambiguous":
    default:
      return "the page loaded but it did not clearly say the job is open or closed";
  }
}

function buildAuditLine(params: {
  timestamp: string;
  previousStatus: string;
  classification: JobAvailabilityClassification;
}): string {
  return `[JobBored ${shortDate(params.timestamp)}] Marked Expired because ${describeAvailabilityReason(params.classification)}. Was: ${plainStatus(params.previousStatus)}.`;
}

function buildNeedsReviewAuditLine(params: {
  timestamp: string;
  classification: JobAvailabilityClassification;
}): string {
  return `[JobBored ${shortDate(params.timestamp)}] Please review this job — ${describeAvailabilityReason(params.classification)}.`;
}

function notesContainsRecentNeedsReview(notes: string): boolean {
  // Match both the new "Please review this job" phrasing and the older
  // "Availability review:" phrasing, so reruns on rows that were tagged by an
  // earlier build of the cleanup are still treated as already-flagged and we
  // do not append a duplicate line.
  return /\b(Please review this job|Availability review:)/i.test(
    String(notes || ""),
  );
}

export async function runExpiredJobCleanup(params: {
  sheetId: string;
  runtimeConfig: WorkerRuntimeConfig;
  options?: ExpiredCleanupOptions;
}): Promise<ExpiredCleanupResult> {
  const sheetId = String(params.sheetId || "").trim();
  if (!sheetId) throw new Error("sheetId is required");

  const options = params.options || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this runtime");
  }
  const now = options.now || (() => new Date());
  const sheetName = options.sheetName || DEFAULT_PIPELINE_SHEET_NAME;
  const dryRun = options.dryRun !== false;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const accessToken = await resolveAccessToken(
    params.runtimeConfig,
    fetchImpl,
    now,
    options.tokenScope || DEFAULT_TOKEN_SCOPE,
  );

  const headerRows = await getSheetValues(
    sheetId,
    `${sheetName}!A1:${LAST_COLUMN_LETTER}1`,
    accessToken,
    fetchImpl,
  );
  validatePipelineHeader(headerRows, sheetName);

  const dataRows = await getSheetValues(
    sheetId,
    `${sheetName}!A2:${LAST_COLUMN_LETTER}`,
    accessToken,
    fetchImpl,
  );
  const rowLimit =
    options.maxRows && options.maxRows > 0
      ? Math.min(dataRows.length, Math.floor(options.maxRows))
      : dataRows.length;

  const timestamp = now().toISOString();
  const results: ExpiredCleanupRowResult[] = [];
  const updates: SheetCellUpdate[] = [];
  let checked = 0;
  let updated = 0;
  let wouldUpdate = 0;
  let skipped = 0;
  let needsReview = 0;
  let open = 0;

  for (let index = 0; index < rowLimit; index += 1) {
    const cells = toRowCells(dataRows[index] || []);
    const rowNumber = index + 2;
    const link = cells[LINK_COLUMN_INDEX] || "";
    const normalizedLink = normalizeLeadUrl(link);
    const previousStatus = cells[STATUS_COLUMN_INDEX] || "";
    if (!normalizedLink) {
      skipped += 1;
      results.push({
        rowNumber,
        link,
        normalizedLink: "",
        previousStatus,
        action: "skipped",
        reason: "missing_link",
      });
      continue;
    }

    if (!isEligibleForCleanup(previousStatus)) {
      skipped += 1;
      results.push({
        rowNumber,
        link,
        normalizedLink,
        previousStatus,
        action: "skipped",
        reason: isProtectedStatus(previousStatus)
          ? "protected_status"
          : "unknown_status",
      });
      continue;
    }

    checked += 1;
    const classification = await checkJobPostingUrl(link, {
      fetchImpl,
      timeoutMs,
    });

    if (classification.status === "expired") {
      const auditNote = buildAuditLine({
        timestamp,
        previousStatus,
        classification,
      });
      const notes = appendAuditNote(cells[NOTES_COLUMN_INDEX] || "", auditNote);
      const action = dryRun ? "would_expire" : "expired";
      if (dryRun) {
        wouldUpdate += 1;
      } else {
        updated += 1;
        updates.push(
          {
            range: `${sheetName}!M${rowNumber}`,
            values: [["Expired"]],
          },
          {
            range: `${sheetName}!O${rowNumber}`,
            values: [[notes]],
          },
        );
      }
      results.push({
        rowNumber,
        link,
        normalizedLink,
        previousStatus,
        action,
        classification,
        reason: classification.reason,
        auditNote,
      });
      continue;
    }

    if (classification.status === "open") {
      open += 1;
      results.push({
        rowNumber,
        link,
        normalizedLink,
        previousStatus,
        action: "open",
        classification,
        reason: classification.reason,
      });
      continue;
    }

    needsReview += 1;
    const existingNotes = cells[NOTES_COLUMN_INDEX] || "";
    const reviewAuditNote = buildNeedsReviewAuditLine({
      timestamp,
      classification,
    });
    const shouldAppendReviewNote =
      !dryRun && !notesContainsRecentNeedsReview(existingNotes);
    if (shouldAppendReviewNote) {
      const updatedNotes = appendAuditNote(existingNotes, reviewAuditNote);
      updates.push({
        range: `${sheetName}!O${rowNumber}`,
        values: [[updatedNotes]],
      });
    }
    results.push({
      rowNumber,
      link,
      normalizedLink,
      previousStatus,
      action: "needs_review",
      classification,
      reason: classification.reason,
      auditNote: reviewAuditNote,
    });
  }

  if (!dryRun) {
    await batchUpdateCells(sheetId, updates, accessToken, fetchImpl);
  }

  return {
    sheetId,
    sheetName,
    dryRun,
    checked,
    updated,
    wouldUpdate,
    wouldExpire: wouldUpdate,
    skipped,
    needsReview,
    open,
    results,
  };
}

function parseCliArgs(argv: string[]): {
  sheetId: string;
  dryRun: boolean;
  maxRows?: number;
  timeoutMs?: number;
} {
  const out = {
    sheetId: "",
    dryRun: true,
    maxRows: undefined as number | undefined,
    timeoutMs: undefined as number | undefined,
  };
  for (const arg of argv) {
    if (arg === "--write") {
      out.dryRun = false;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg.startsWith("--sheet-id=")) {
      out.sheetId = arg.slice("--sheet-id=".length);
    } else if (arg.startsWith("--max-rows=")) {
      const n = Number(arg.slice("--max-rows=".length));
      if (Number.isFinite(n) && n > 0) out.maxRows = Math.floor(n);
    } else if (arg.startsWith("--timeout-ms=")) {
      const n = Number(arg.slice("--timeout-ms=".length));
      if (Number.isFinite(n) && n > 0) out.timeoutMs = Math.floor(n);
    } else if (!arg.startsWith("--") && !out.sheetId) {
      out.sheetId = arg;
    }
  }
  out.sheetId =
    out.sheetId ||
    process.env.BROWSER_USE_DISCOVERY_SHEET_ID ||
    process.env.JOBBORED_SHEET_ID ||
    "";
  return out;
}

export async function runExpiredJobCleanupCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (!args.sheetId) {
    throw new Error(
      "Missing sheet id. Pass --sheet-id=<id> or set BROWSER_USE_DISCOVERY_SHEET_ID.",
    );
  }
  const runtimeConfig = loadRuntimeConfig(process.env);
  const result = await runExpiredJobCleanup({
    sheetId: args.sheetId,
    runtimeConfig,
    options: {
      dryRun: args.dryRun,
      maxRows: args.maxRows,
      timeoutMs: args.timeoutMs,
    },
  });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  runExpiredJobCleanupCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
