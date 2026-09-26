import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRuntimeConfig, type WorkerRuntimeConfig } from "../config.ts";
import {
  DEFAULT_PIPELINE_SHEET_NAME,
  PIPELINE_HEADER_ROW,
} from "../contracts.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import { planStageMove } from "../sheets/pipeline-transitions.ts";
import {
  PIPELINE_COL,
  batchUpdateSheetValues,
  changedCellRanges,
  getSheetValues,
  resolveAccessToken,
  resolveRowsByLink,
  withSheetLock,
} from "../sheets/sheets-client.ts";
import { safeFetch, type SafeFetchOptions } from "../net/safe-fetch.ts";

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
  /** Posting checks in flight at once (default 4). */
  concurrency?: number;
  /** Rows per Sheet write; each flush persists on its own (default 25). */
  flushEvery?: number;
  /** Skip rows whose Notes carry a cleanup check this recent (default 7 days). */
  recheckAfterDays?: number;
};

const DEFAULT_TOKEN_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_FLUSH_EVERY = 25;
const DEFAULT_RECHECK_AFTER_DAYS = 7;
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
    lookupImpl?: SafeFetchOptions["lookupImpl"];
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
    // Sheet Links are untrusted: safeFetch refuses private-network targets on
    // every redirect hop, pins DNS at connect and caps the body.
    const response = await safeFetch(
      url.toString(),
      {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "JobBoredExpiredCleanup/1.0",
        },
      },
      {
        fetchImpl: options.fetchImpl,
        lookupImpl: options.lookupImpl,
        maxBytes: MAX_POSTING_BODY_BYTES,
      },
    );
    const body = await response.text().catch(() => "");
    return classifyJobPostingAvailability({
      url: url.toString(),
      httpStatus: response.status,
      body,
      finalUrl: response.url || url.toString(),
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      (err as { code?: unknown }).code === "SSRF_BLOCKED"
    ) {
      return {
        status: "unknown",
        reason: `Blocked unsafe job URL: ${err instanceof Error ? err.message : String(err)}`,
        evidence: url.toString().slice(0, 180),
        confidence: "none",
        source: "invalid_url",
        finalUrl: url.toString(),
      };
    }
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

const MAX_POSTING_BODY_BYTES = 4 * 1024 * 1024;

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

const CLEANUP_STAMP = /\[JobBored (\d{4}-\d{2}-\d{2})\]/g;

/** True when Notes carry a cleanup stamp within `days` of `now`. */
function notesCheckedRecently(notes: string, now: Date, days: number): boolean {
  if (days <= 0) return false;
  const cutoff = now.getTime() - days * 86_400_000;
  for (const match of String(notes || "").matchAll(CLEANUP_STAMP)) {
    const stamp = Date.parse(`${match[1]}T00:00:00Z`);
    if (Number.isFinite(stamp) && stamp >= cutoff && stamp <= now.getTime()) return true;
  }
  return false;
}

type PendingWrite = {
  index: number;
  rowNumber: number;
  normalizedLink: string;
  kind: "expire" | "review";
  auditNote: string;
};

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
  const concurrency = Math.max(1, Math.floor(options.concurrency || DEFAULT_CONCURRENCY));
  const flushEvery = Math.max(1, Math.floor(options.flushEvery || DEFAULT_FLUSH_EVERY));
  const recheckAfterDays = options.recheckAfterDays ?? DEFAULT_RECHECK_AFTER_DAYS;
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
  const results: ExpiredCleanupRowResult[] = new Array(rowLimit);
  const candidates: Array<{ index: number; cells: string[] }> = [];
  let checked = 0;

  for (let index = 0; index < rowLimit; index += 1) {
    const cells = toRowCells(dataRows[index] || []);
    const rowNumber = index + 2;
    const link = cells[LINK_COLUMN_INDEX] || "";
    const normalizedLink = normalizeLeadUrl(link);
    const previousStatus = cells[STATUS_COLUMN_INDEX] || "";
    const skip = (reason: string) => {
      results[index] = { rowNumber, link, normalizedLink, previousStatus, action: "skipped", reason };
    };
    if (!normalizedLink) {
      skip("missing_link");
      continue;
    }
    if (!isEligibleForCleanup(previousStatus)) {
      skip(isProtectedStatus(previousStatus) ? "protected_status" : "unknown_status");
      continue;
    }
    if (notesCheckedRecently(cells[NOTES_COLUMN_INDEX] || "", now(), recheckAfterDays)) {
      skip("recently_checked");
      continue;
    }
    candidates.push({ index, cells });
  }

  // Writes go out every `flushEvery` rows under the per-Sheet lock, each
  // against the row as the Sheet holds it then: re-found by Link, and left
  // alone when its status stopped being eligible (a user moved it).
  const pending: PendingWrite[] = [];
  let flushChain: Promise<void> = Promise.resolve();

  async function flush(batch: PendingWrite[]): Promise<void> {
    if (!batch.length) return;
    await withSheetLock(sheetId, async () => {
      const resolved = await resolveRowsByLink({
        sheetId,
        sheetName,
        token: accessToken,
        fetchImpl,
        targets: batch.map((w) => ({ rowNumber: w.rowNumber, link: w.normalizedLink })),
        normalizeLink: normalizeLeadUrl,
      });
      const data: Array<{ range: string; values: string[][] }> = [];
      resolved.forEach((found, i) => {
        const write = batch[i];
        const result = results[write.index];
        if (found.status !== "found") {
          results[write.index] = { ...result, action: "skipped", reason: "row_moved_or_removed" };
          return;
        }
        const row = found.row;
        const status = row[PIPELINE_COL.status] || "";
        if (!isEligibleForCleanup(status)) {
          results[write.index] = { ...result, action: "skipped", reason: "status_changed" };
          return;
        }
        let next: string[];
        if (write.kind === "expire") {
          next = planStageMove(row, {
            to: "Expired",
            now: now(),
            auditNote: write.auditNote,
          });
        } else {
          const notes = row[PIPELINE_COL.notes] || "";
          if (notesContainsRecentNeedsReview(notes)) return;
          next = row.slice();
          next[PIPELINE_COL.notes] = appendAuditNote(notes, write.auditNote);
        }
        results[write.index] = { ...result, rowNumber: found.rowNumber };
        data.push(...changedCellRanges(sheetName, found.rowNumber, row, next));
      });
      if (!data.length) return;
      const response = await batchUpdateSheetValues(sheetId, data, accessToken, fetchImpl);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Expired cleanup sheet update failed: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
        );
      }
    });
  }

  function queueWrite(write: PendingWrite): Promise<void> {
    pending.push(write);
    if (pending.length < flushEvery) return flushChain;
    const batch = pending.splice(0, pending.length);
    flushChain = flushChain.then(() => flush(batch));
    return flushChain;
  }

  async function checkRow(candidate: { index: number; cells: string[] }): Promise<void> {
    const { index, cells } = candidate;
    const rowNumber = index + 2;
    const link = cells[LINK_COLUMN_INDEX] || "";
    const normalizedLink = normalizeLeadUrl(link);
    const previousStatus = cells[STATUS_COLUMN_INDEX] || "";
    checked += 1;
    const classification = await checkJobPostingUrl(link, { fetchImpl, timeoutMs });

    if (classification.status === "expired") {
      const auditNote = buildAuditLine({ timestamp, previousStatus, classification });
      results[index] = {
        rowNumber,
        link,
        normalizedLink,
        previousStatus,
        action: dryRun ? "would_expire" : "expired",
        classification,
        reason: classification.reason,
        auditNote,
      };
      if (!dryRun) {
        await queueWrite({ index, rowNumber, normalizedLink, kind: "expire", auditNote });
      }
      return;
    }

    if (classification.status === "open") {
      results[index] = {
        rowNumber,
        link,
        normalizedLink,
        previousStatus,
        action: "open",
        classification,
        reason: classification.reason,
      };
      return;
    }

    const reviewAuditNote = buildNeedsReviewAuditLine({ timestamp, classification });
    results[index] = {
      rowNumber,
      link,
      normalizedLink,
      previousStatus,
      action: "needs_review",
      classification,
      reason: classification.reason,
      auditNote: reviewAuditNote,
    };
    if (!dryRun && !notesContainsRecentNeedsReview(cells[NOTES_COLUMN_INDEX] || "")) {
      await queueWrite({ index, rowNumber, normalizedLink, kind: "review", auditNote: reviewAuditNote });
    }
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor];
      cursor += 1;
      await checkRow(candidate);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()),
  );
  if (!dryRun) {
    const rest = pending.splice(0, pending.length);
    flushChain = flushChain.then(() => flush(rest));
    await flushChain;
  }

  const finalResults = results.filter(Boolean);
  const count = (action: ExpiredCleanupRowResult["action"]) =>
    finalResults.filter((r) => r.action === action).length;
  const wouldUpdate = count("would_expire");
  return {
    sheetId,
    sheetName,
    dryRun,
    checked,
    updated: count("expired"),
    wouldUpdate,
    wouldExpire: wouldUpdate,
    skipped: count("skipped"),
    needsReview: count("needs_review"),
    open: count("open"),
    results: finalResults,
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
