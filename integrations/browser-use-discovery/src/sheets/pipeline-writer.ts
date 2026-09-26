import type { WorkerRuntimeConfig } from "../config.ts";
import {
  DEFAULT_BLACKLIST_SHEET_NAME,
  PIPELINE_HEADER_ROW,
  type NormalizedLead,
  type PipelineWriteResult,
} from "../contracts.ts";
import { dedupeFingerprintListings } from "../discovery/listing-fingerprint.ts";
import {
  decideIntakeMergeReview,
  matchPipelineIdentity,
  reconstructIntakeIdentityFromRow,
  serializeIntakeIdentity,
} from "../normalize/intake-identity.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import { PIPELINE_COLUMNS } from "./pipeline-columns.generated.ts";
import {
  DEFAULT_SHEET_NAME,
  DEFAULT_TOKEN_SCOPE,
  PIPELINE_COL,
  PIPELINE_LAST_COLUMN_LETTER,
  SheetsHttpError,
  appendSheetValues,
  batchGetSheetValues,
  batchUpdateSheetValues,
  changedCellRanges,
  checkPipelineHeader,
  getSheetValues,
  isRetryableStatus,
  readPipelineLinks,
  resolveAccessToken,
  resolveRowsByLink,
  withSheetLock,
  type FetchLike,
  type RetryOptions,
} from "./sheets-client.ts";

export {
  DEFAULT_SHEET_NAME,
  DEFAULT_TOKEN_SCOPE,
  getSheetValues,
  resolveAccessToken,
  type FetchLike,
};

/**
 * Error thrown when a Sheet write operation fails.
 * Carries phase attribution so callers can distinguish update vs append failures.
 * `uncertain` is true when the request may have been applied (the response was
 * lost), so a caller must not assume nothing was written.
 */
export class SheetWriteError extends Error {
  readonly phase: "update" | "append";
  readonly sheetId: string;
  readonly httpStatus?: number;
  readonly detail?: string;
  readonly partialResult?: PipelineWriteResult;
  readonly uncertain: boolean;

  constructor(params: {
    phase: "update" | "append";
    message: string;
    sheetId: string;
    httpStatus?: number;
    detail?: string;
    partialResult?: PipelineWriteResult;
    uncertain?: boolean;
  }) {
    super(params.message);
    this.name = "SheetWriteError";
    this.phase = params.phase;
    this.sheetId = params.sheetId;
    this.httpStatus = params.httpStatus;
    this.detail = params.detail;
    this.partialResult = params.partialResult;
    this.uncertain = params.uncertain === true;
  }
}

type PipelineWriterOptions = {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sheetName?: string;
  tokenScope?: string;
  /** Attempts after the first for 429/5xx answers (default 3). */
  retries?: number;
  /** First retry delay in ms; doubles per attempt (default 400). */
  retryBaseMs?: number;
};

export type PipelineWriter = {
  write(sheetId: string, leads: NormalizedLead[]): Promise<PipelineWriteResult>;
};

const COLUMN_COUNT = PIPELINE_HEADER_ROW.length;
// Last A1-notation column letter covering every column in PIPELINE_HEADER_ROW.
export const LAST_COLUMN_LETTER = PIPELINE_LAST_COLUMN_LETTER;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRowCells(row: unknown[]): string[] {
  return Array.from({ length: COLUMN_COUNT }, (_, index) => asText(row[index]));
}

function normalizeRowLink(row: string[]): string {
  return normalizeLeadUrl(row[4] || "");
}

type ExistingPipelineRow = { rowNumber: number; row: string[] };

function listingFromRow(row: string[]) {
  return {
    title: row[1] || "",
    company: row[2] || "",
    location: row[3] || "",
    url: row[4] || "",
    sourceId: row[5] || "",
  };
}

function listingFromLead(lead: NormalizedLead) {
  return {
    title: lead.title || "",
    company: lead.company || "",
    location: lead.location || "",
    url: lead.url || "",
    sourceId: lead.sourceId || "",
    metadata: {
      ...(lead.metadata || {}),
      jobId: lead.metadata?.externalJobId,
      postingId: lead.metadata?.externalJobId,
    },
  };
}

function findExistingIdentityMatch(
  lead: NormalizedLead,
  existingByLink: Map<string, ExistingPipelineRow>,
  existingByProvider: Map<string, ExistingPipelineRow>,
  existingBySemantic: Map<string, ExistingPipelineRow>,
): { match: ExistingPipelineRow; decision: ReturnType<typeof decideIntakeMergeReview> } | null {
  const incoming = listingFromLead(lead);
  const identity = serializeIntakeIdentity(incoming);
  const canonical = identity.canonicalUrl || normalizeLeadUrl(lead.url || "");
  const candidates: ExistingPipelineRow[] = [];
  if (canonical && existingByLink.has(canonical)) {
    candidates.push(existingByLink.get(canonical)!);
  }
  if (identity.providerJobKey && existingByProvider.has(identity.providerJobKey)) {
    candidates.push(existingByProvider.get(identity.providerJobKey)!);
  }
  if (identity.semanticKey && existingBySemantic.has(identity.semanticKey)) {
    candidates.push(existingBySemantic.get(identity.semanticKey)!);
  }
  const seen = new Set<number>();
  for (const candidate of candidates) {
    if (seen.has(candidate.rowNumber)) continue;
    seen.add(candidate.rowNumber);
    const decision = decideIntakeMergeReview(
      matchPipelineIdentity(listingFromRow(candidate.row), incoming),
    );
    if (decision.action === "append") continue;
    return { match: candidate, decision };
  }
  return null;
}

function rememberExistingIdentity(
  existing: ExistingPipelineRow,
  existingByLink: Map<string, ExistingPipelineRow>,
  existingByProvider: Map<string, ExistingPipelineRow>,
  existingBySemantic: Map<string, ExistingPipelineRow>,
): void {
  const identity = reconstructIntakeIdentityFromRow(existing.row);
  if (identity.canonicalUrl && !existingByLink.has(identity.canonicalUrl)) {
    existingByLink.set(identity.canonicalUrl, existing);
  }
  if (identity.providerJobKey && !existingByProvider.has(identity.providerJobKey)) {
    existingByProvider.set(identity.providerJobKey, existing);
  }
  if (identity.semanticKey && !existingBySemantic.has(identity.semanticKey)) {
    existingBySemantic.set(identity.semanticKey, existing);
  }
}

function clampScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return "";
  return String(Math.min(10, Math.max(1, Math.round(score))));
}

function localCalendarDay(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function buildLeadRow(lead: NormalizedLead, now: Date): string[] {
  const dateFound = localCalendarDay(lead.discoveredAt || now);
  // Match Score is already 0–10 from finalizeMatchDecision; clampScore treats
  // it the same way as fitScore.
  const matchScore =
    lead.matchScore == null || !Number.isFinite(lead.matchScore)
      ? ""
      : String(Math.min(10, Math.max(0, Math.round(lead.matchScore))));
  return [
    dateFound,
    lead.title || "",
    lead.company || "",
    lead.location || "",
    normalizeLeadUrl(lead.url || ""),
    lead.sourceLabel || lead.sourceId || "",
    lead.compensationText || "",
    clampScore(lead.fitScore),
    lead.priority || "",
    Array.isArray(lead.tags) ? lead.tags.filter(Boolean).join(", ") : "",
    lead.fitAssessment || "",
    lead.contact || "",
    "New",
    "",
    "",
    "",
    lead.talkingPoints || "",
    "",
    "",
    lead.logoUrl || "",
    matchScore,
    lead.favorite ? "★" : "",
    lead.dismissedAt ?? "",
    lead.approvalStatus ?? "",
    "",
  ];
}

// Per-row Edit Lock ids (column Y) and the column each one protects.
const LOCKABLE_INDEX: Record<string, number> = {
  title: PIPELINE_COL.title,
  company: PIPELINE_COL.company,
  location: PIPELINE_COL.location,
  salary: PIPELINE_COL.salary,
};

/**
 * Merge a re-discovered lead into the row the Sheet holds now. Column
 * ownership comes from schemas/pipeline-row.v1.json (`discoveryMerge`):
 * discovery replaces the cells it owns, fills user columns only while they are
 * empty, honours the row's Edit Lock for identity columns, and never touches
 * the CRM columns.
 */
function mergeExistingRow(existingRow: string[], leadRow: string[]): string[] {
  const merged = existingRow.slice(0, COLUMN_COUNT);
  while (merged.length < COLUMN_COUNT) merged.push("");

  const lockedRaw = (existingRow[PIPELINE_COL.editLock] || "").trim();
  const lockedIndexes = new Set<number>();
  if (lockedRaw) {
    for (const id of lockedRaw.split(",")) {
      const idx = LOCKABLE_INDEX[id.trim()];
      if (idx !== undefined) lockedIndexes.add(idx);
    }
  }

  for (const column of PIPELINE_COLUMNS) {
    const index = column.sheetIndex;
    const incoming = leadRow[index] || "";
    if (!incoming) continue;
    switch (column.discoveryMerge) {
      case "overwrite":
        merged[index] = incoming;
        break;
      case "lockable":
        if (!lockedIndexes.has(index)) merged[index] = incoming;
        break;
      case "fillIfEmpty":
        if (!merged[index]) merged[index] = incoming;
        break;
      case "preserve":
        break;
      default: {
        const unknownMerge: never = column.discoveryMerge;
        throw new Error(`Unknown discoveryMerge: ${String(unknownMerge)}`);
      }
    }
  }
  return merged;
}

function dedupeIncomingLeads(leads: NormalizedLead[]): {
  leads: NormalizedLead[];
  skippedDuplicates: number;
} {
  const cleaned = leads
    .map((lead) => {
      const url = normalizeLeadUrl(lead.url || "");
      return url ? { ...lead, url } : null;
    })
    .filter((lead): lead is NormalizedLead => !!lead);
  const deduped = dedupeFingerprintListings(cleaned);
  return {
    leads: deduped.uniqueItems,
    skippedDuplicates:
      deduped.duplicateCount + Math.max(0, leads.length - cleaned.length),
  };
}

/**
 * Write a full-row update by row number (the header upgrade and callers that
 * already hold a fresh row). Every text cell is formula-escaped.
 */
export async function batchUpdateRows(
  sheetId: string,
  rowUpdates: Array<{ rowNumber: number; values: string[] }>,
  token: string,
  fetchImpl: FetchLike,
  sheetName: string,
  retry?: RetryOptions,
): Promise<void> {
  if (!rowUpdates.length) return;
  const response = await batchUpdateSheetValues(
    sheetId,
    rowUpdates.map((entry) => ({
      range: `${sheetName}!A${entry.rowNumber}:${LAST_COLUMN_LETTER}${entry.rowNumber}`,
      values: [entry.values],
    })),
    token,
    fetchImpl,
    retry,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SheetWriteError({
      phase: "update",
      message: `Sheet write failed during update phase: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
      sheetId,
      httpStatus: response.status,
      detail: body || undefined,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type PendingUpdate = {
  rowNumber: number;
  link: string;
  leadRows: string[][];
};

export function createPipelineWriter(
  runtimeConfig: WorkerRuntimeConfig,
  options: PipelineWriterOptions = {},
): PipelineWriter {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this runtime");
  }
  const now = options.now || (() => new Date());
  const sheetName = options.sheetName || DEFAULT_SHEET_NAME;
  const tokenScope = options.tokenScope || DEFAULT_TOKEN_SCOPE;
  const retry: RetryOptions = {
    retries: options.retries ?? 3,
    retryBaseMs: options.retryBaseMs ?? 400,
  };

  async function readIdentitySnapshot(
    sheetId: string,
    token: string,
  ): Promise<string[][]> {
    // Identity columns only (Title..Source, Dismissed At..Edit Lock). Full
    // rows are fetched later for the matched row numbers alone.
    const [identity, tail] = await batchGetSheetValues(
      sheetId,
      [`${sheetName}!B2:F`, `${sheetName}!W2:${LAST_COLUMN_LETTER}`],
      token,
      fetchImpl,
      retry,
    );
    const count = Math.max(identity.length, tail.length);
    const rows: string[][] = [];
    for (let index = 0; index < count; index += 1) {
      const cells = new Array<string>(COLUMN_COUNT).fill("");
      const front = identity[index] || [];
      for (let offset = 0; offset < 5; offset += 1) cells[1 + offset] = asText(front[offset]);
      const back = tail[index] || [];
      for (let offset = 0; offset < COLUMN_COUNT - PIPELINE_COL.dismissedAt; offset += 1) {
        cells[PIPELINE_COL.dismissedAt + offset] = asText(back[offset]);
      }
      rows.push(cells);
    }
    return rows;
  }

  async function writeLocked(
    sheetId: string,
    leads: NormalizedLead[],
    accessToken: string,
  ): Promise<PipelineWriteResult> {
    const headerValues = await getSheetValues(
      sheetId,
      `${sheetName}!A1:${LAST_COLUMN_LETTER}1`,
      accessToken,
      fetchImpl,
      retry,
    );
    const headerState = checkPipelineHeader(headerValues[0] || [], sheetName);
    if (headerState.needsUpgrade) {
      await batchUpdateRows(
        sheetId,
        [{ rowNumber: 1, values: [...PIPELINE_HEADER_ROW] }],
        accessToken,
        fetchImpl,
        sheetName,
        retry,
      );
    }
    // A missing blacklist tab is normal (HTTP 400 "Unable to parse range") and
    // means "no blacklist". Any other error (429/5xx/network) is transient and
    // must NOT silently disable blacklist filtering — fail loud so suppressed
    // URLs are never written just because a read blipped.
    const blacklistRows = await getSheetValues(
      sheetId,
      `${DEFAULT_BLACKLIST_SHEET_NAME}!A2:A`,
      accessToken,
      fetchImpl,
      retry,
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP 400\b/.test(message) || /Unable to parse range/i.test(message)) {
        return [] as string[][];
      }
      throw error;
    });
    const blacklistedUrls = new Set<string>(
      blacklistRows
        .map((row) => normalizeLeadUrl(row[0] || ""))
        .filter((value) => Boolean(value)),
    );

    const existingRows = await readIdentitySnapshot(sheetId, accessToken);
    const existingByLink = new Map<string, ExistingPipelineRow>();
    const existingByProvider = new Map<string, ExistingPipelineRow>();
    const existingBySemantic = new Map<string, ExistingPipelineRow>();
    let existingDuplicateCount = 0;

    existingRows.forEach((row, index) => {
      const cells = toRowCells(row);
      const link = normalizeRowLink(cells);
      const rowNumber = index + 2;
      const existing = { rowNumber, row: cells };
      if (link) {
        if (existingByLink.has(link)) {
          existingDuplicateCount += 1;
        } else {
          existingByLink.set(link, existing);
        }
      }
      rememberExistingIdentity(
        existing,
        existingByLink,
        existingByProvider,
        existingBySemantic,
      );
    });

    const deduped = dedupeIncomingLeads(leads);
    const uniqueLeads = deduped.leads;
    const pendingByRow = new Map<number, PendingUpdate>();
    const appends: string[][] = [];
    const skippedBlacklist: Array<{ url: string; title: string }> = [];
    let skippedDuplicates = deduped.skippedDuplicates;
    const warnings: string[] = existingDuplicateCount
      ? [
          `Found ${existingDuplicateCount} duplicate existing Pipeline rows for normalized Link values.`,
        ]
      : [];

    for (const lead of uniqueLeads) {
      const leadRow = buildLeadRow(lead, now());
      const link = leadRow[PIPELINE_COL.link];
      if (!link) continue;
      const identityHit = findExistingIdentityMatch(
        lead,
        existingByLink,
        existingByProvider,
        existingBySemantic,
      );
      if (identityHit) {
        const match = identityHit.match;
        if (match.row[PIPELINE_COL.dismissedAt]) {
          skippedBlacklist.push({ url: link, title: lead.title || "" });
          continue;
        }
        if (identityHit.decision.action === "review") {
          skippedDuplicates += 1;
          warnings.push(
            `Merge review: semantic identity collision for ${link} with Pipeline row ${match.rowNumber}.`,
          );
          continue;
        }
        const pending = pendingByRow.get(match.rowNumber) || {
          rowNumber: match.rowNumber,
          link: normalizeRowLink(match.row),
          leadRows: [],
        };
        pending.leadRows.push(leadRow);
        pendingByRow.set(match.rowNumber, pending);
        rememberExistingIdentity(
          { rowNumber: match.rowNumber, row: mergeExistingRow(match.row, leadRow) },
          existingByLink,
          existingByProvider,
          existingBySemantic,
        );
        continue;
      }
      if (blacklistedUrls.has(link)) {
        skippedBlacklist.push({ url: link, title: lead.title || "" });
        continue;
      }
      appends.push(leadRow);
      rememberExistingIdentity(
        { rowNumber: existingRows.length + appends.length + 1, row: leadRow },
        existingByLink,
        existingByProvider,
        existingBySemantic,
      );
    }

    const pending = [...pendingByRow.values()];
    let updated = 0;
    let appended = 0;
    let updateError: SheetWriteError | null = null;

    // Update phase: re-read each matched row by Link right before writing,
    // merge into what the Sheet holds now, and write only changed cells.
    if (pending.length) {
      try {
        const resolved = await resolveRowsByLink({
          sheetId,
          sheetName,
          token: accessToken,
          fetchImpl,
          targets: pending.map((p) => ({ rowNumber: p.rowNumber, link: p.link })),
          normalizeLink: normalizeLeadUrl,
          retry,
        });
        const data: Array<{ range: string; values: string[][] }> = [];
        let matched = 0;
        resolved.forEach((result, index) => {
          const entry = pending[index];
          if (result.status !== "found") {
            warnings.push(
              result.status === "ambiguous"
                ? `Skipped update for ${entry.link}: the Link now appears on rows ${result.rowNumbers.join(", ")}.`
                : `Skipped update for ${entry.link}: its Pipeline row moved or was removed during the write.`,
            );
            return;
          }
          if (result.row[PIPELINE_COL.dismissedAt]) {
            skippedBlacklist.push({ url: entry.link, title: result.row[PIPELINE_COL.title] || "" });
            return;
          }
          let merged = result.row;
          for (const leadRow of entry.leadRows) merged = mergeExistingRow(merged, leadRow);
          data.push(...changedCellRanges(sheetName, result.rowNumber, result.row, merged));
          matched += entry.leadRows.length;
        });
        if (data.length) {
          const response = await batchUpdateSheetValues(
            sheetId,
            data,
            accessToken,
            fetchImpl,
            retry,
          );
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new SheetWriteError({
              phase: "update",
              message: `Sheet write failed during update phase: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
              sheetId,
              httpStatus: response.status,
              detail: body || undefined,
            });
          }
        }
        updated = matched;
      } catch (error) {
        updateError =
          error instanceof SheetWriteError
            ? error
            : new SheetWriteError({
                phase: "update",
                message: `Sheet write failed during update phase: ${formatError(error)}`,
                sheetId,
                httpStatus: error instanceof SheetsHttpError ? error.status : undefined,
                uncertain: !(error instanceof SheetsHttpError),
              });
      }
    }

    // Append phase runs even when the update phase failed: the two are
    // independent, and new leads must not wait on a transient update error.
    if (appends.length) {
      const attempts = (retry.retries ?? 3) + 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const partial = (): PipelineWriteResult => ({
          sheetId,
          appended: 0,
          updated,
          skippedDuplicates: skippedDuplicates + existingDuplicateCount,
          skippedBlacklist: skippedBlacklist.length,
          warnings: [...warnings],
        });
        let present: Set<string>;
        try {
          // Links another writer added since the snapshot are not appended again.
          present = await readPipelineLinks({
            sheetId,
            sheetName,
            token: accessToken,
            fetchImpl,
            normalizeLink: normalizeLeadUrl,
            retry,
          });
        } catch (error) {
          throw new SheetWriteError({
            phase: "append",
            message: `Sheet write failed during append phase: ${formatError(error)}`,
            sheetId,
            httpStatus: error instanceof SheetsHttpError ? error.status : undefined,
            partialResult: partial(),
          });
        }
        const fresh = appends.filter((row) => !present.has(row[PIPELINE_COL.link]));
        const already = appends.length - fresh.length;
        if (already) {
          skippedDuplicates += already;
          warnings.push(
            `${already} lead(s) were already in the Pipeline when the append ran; they were not appended again.`,
          );
          appends.splice(0, appends.length, ...fresh);
        }
        if (!appends.length) break;

        let response: Response;
        try {
          response = await appendSheetValues(
            sheetId,
            `${sheetName}!A:${LAST_COLUMN_LETTER}`,
            appends,
            accessToken,
            fetchImpl,
            { retries: 0 },
          );
        } catch (error) {
          // The request may have reached Google: the rows may be in the Sheet.
          throw new SheetWriteError({
            phase: "append",
            message: `Sheet write failed during append phase: ${formatError(error)}`,
            sheetId,
            uncertain: true,
            partialResult: partial(),
          });
        }
        if (response.ok) {
          appended = appends.length;
          break;
        }
        const body = await response.text().catch(() => "");
        if (isRetryableStatus(response.status) && attempt < attempts - 1) {
          await sleep((retry.retryBaseMs ?? 400) * 2 ** attempt);
          continue;
        }
        throw new SheetWriteError({
          phase: "append",
          message: `Sheet write failed during append phase: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
          sheetId,
          httpStatus: response.status,
          detail: body || undefined,
          partialResult: partial(),
        });
      }
    }

    const result: PipelineWriteResult = {
      sheetId,
      appended,
      updated,
      skippedDuplicates: skippedDuplicates + existingDuplicateCount,
      skippedBlacklist: skippedBlacklist.length,
      warnings,
    };
    if (updateError) {
      throw new SheetWriteError({
        phase: "update",
        message: updateError.message,
        sheetId,
        httpStatus: updateError.httpStatus,
        detail: updateError.detail,
        uncertain: updateError.uncertain,
        partialResult: { ...result, updated: 0 },
      });
    }
    return result;
  }

  async function write(
    sheetId: string,
    leads: NormalizedLead[],
  ): Promise<PipelineWriteResult> {
    const accessToken = await resolveAccessToken(
      runtimeConfig,
      fetchImpl,
      now,
      tokenScope,
    );
    return withSheetLock(sheetId, () => writeLocked(sheetId, leads, accessToken));
  }

  return { write };
}

export type { PipelineWriterOptions };
