import type { WorkerRuntimeConfig } from "../config.ts";
import {
  DEFAULT_BLACKLIST_SHEET_NAME,
  PIPELINE_HEADER_ROW,
  type NormalizedLead,
  type PipelineSkippedLink,
  type PipelineWriteResult,
} from "../contracts.ts";
import { dedupeFingerprintListings } from "../discovery/listing-fingerprint.ts";
import {
  decideIntakeMergeReview,
  matchPipelineIdentity,
  reconstructIntakeIdentityFromRow,
  serializeIntakeIdentity,
} from "../normalize/intake-identity.ts";
import { inferRemoteBucket, normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import { PIPELINE_COLUMNS } from "./pipeline-columns.generated.ts";
import {
  DEFAULT_SHEET_NAME,
  DEFAULT_TOKEN_SCOPE,
  PIPELINE_COL,
  PIPELINE_EXTENSION_COLUMN_IDS,
  PIPELINE_LAST_COLUMN_LETTER,
  GoogleTransportError,
  SheetsHttpError,
  appendSheetValues,
  batchGetSheetValues,
  batchUpdateSheetValues,
  changedCellRanges,
  checkPipelineHeader,
  ensureSheetGridColumns,
  getSheetValues,
  isRetryableStatus,
  pipelineLetter,
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
    cause?: unknown;
  }) {
    super(params.message.slice(0, 2048), { cause: params.cause });
    this.name = "SheetWriteError";
    this.phase = params.phase;
    this.sheetId = params.sheetId;
    this.httpStatus = params.httpStatus;
    this.detail = params.detail?.slice(0, 2048);
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
  /** The token came from this dashboard request, not worker configuration. */
  requestScopedGoogleAccessToken?: boolean;
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
  const fitScore = clampScore(lead.fitScore);
  // Search Match is already 0–10 from finalizeMatchDecision; clampScore treats
  // it the same way as fitScore.
  const matchScore =
    lead.matchScore == null || !Number.isFinite(lead.matchScore)
      ? ""
      : String(Math.min(10, Math.max(0, Math.round(lead.matchScore))));
  const remoteBucket = inferRemoteBucket({
    remoteBucket: lead.metadata?.remoteBucket,
    location: lead.location,
    fitAssessment: lead.fitAssessment,
    title: lead.title,
  });
  return [
    dateFound,
    lead.title || "",
    lead.company || "",
    lead.location || "",
    normalizeLeadUrl(lead.url || ""),
    lead.sourceLabel || lead.sourceId || "",
    lead.compensationText || "",
    fitScore,
    lead.priority || "",
    Array.isArray(lead.tags) ? lead.tags.filter(Boolean).join(", ") : "",
    fitScore ? lead.fitAssessment || "" : "",
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
    remoteBucket === "unknown" ? "" : remoteBucket,
    fitScore ? lead.scorer || "" : "",
    localCalendarDay(now),
    "",
  ];
}

/** HOLES R7: an "llm:<model>" Scorer outranks every other scorer. */
function isLlmScorer(value: string | undefined): boolean {
  return /^llm:/i.test(String(value || "").trim());
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
function mergeExistingRow(
  existingRow: string[],
  leadRow: string[],
  skipIndexes: ReadonlySet<number> = new Set(),
): string[] {
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

  // HOLES R7: a score that is not from an LLM never replaces one that is;
  // H, K and AA stay together.
  const keepScore =
    !skipIndexes.has(PIPELINE_COL.scorer) &&
    isLlmScorer(existingRow[PIPELINE_COL.scorer]) && !isLlmScorer(leadRow[PIPELINE_COL.scorer]);
  for (const column of PIPELINE_COLUMNS) {
    const index = column.sheetIndex;
    // A user's own label (or a column this run could not add) is never written.
    if (skipIndexes.has(index)) continue;
    const incoming = leadRow[index] || "";
    if (keepScore && (column.id === "fitScore" || column.id === "fitAssessment" || column.id === "scorer")) {
      continue;
    }
    // A fresh H must carry the assessment and scorer from that same scoring
    // pass. An absent one clears stale text rather than contradicting H.
    if ((column.id === "fitAssessment" || column.id === "scorer") && leadRow[PIPELINE_COL.fitScore]) {
      merged[index] = incoming;
      continue;
    }
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
  // A fresh sighting offers an Expired row for reopening without changing
  // its status or erasing notes. The browser already reads Notes (O).
  if (String(existingRow[PIPELINE_COL.status] || "").trim().toLowerCase() === "expired") {
    const day = leadRow[PIPELINE_COL.lastSeen];
    if (day) {
      const note = `[JobBored ${day}] Rediscovered expired posting — review to reopen.`;
      const notes = String(existingRow[PIPELINE_COL.notes] || "")
        .split("\n")
        .filter((line) => !/^\[JobBored \d{4}-\d{2}-\d{2}\] Rediscovered expired posting/.test(line))
        .join("\n").trim();
      merged[PIPELINE_COL.notes] = [notes, note].filter(Boolean).join("\n");
    }
  }
  return merged;
}

function dedupeIncomingLeads(leads: NormalizedLead[]): {
  leads: NormalizedLead[];
  skippedDuplicates: number;
  /** Normalized links of in-batch duplicates folded into a kept twin. */
  droppedLinks: string[];
} {
  const cleaned = leads
    .map((lead) => {
      const url = normalizeLeadUrl(lead.url || "");
      return url ? { ...lead, url } : null;
    })
    .filter((lead): lead is NormalizedLead => !!lead);
  const deduped = dedupeFingerprintListings(cleaned);
  const kept = new Set(deduped.uniqueItems);
  const keptLinks = new Set(deduped.uniqueItems.map((lead) => lead.url));
  return {
    leads: deduped.uniqueItems,
    skippedDuplicates:
      deduped.duplicateCount + Math.max(0, leads.length - cleaned.length),
    droppedLinks: [
      ...new Set(
        cleaned
          .filter((lead) => !kept.has(lead) && !keptLinks.has(lead.url))
          .map((lead) => lead.url),
      ),
    ],
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
    const body = (await response.text().catch(() => "")).slice(0, 2048);
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
    retries: options.retries ?? 2,
    retryBaseMs: options.retryBaseMs ?? 400,
  };

  async function readIdentitySnapshot(
    sheetId: string,
    token: string,
    rowWidth: number = COLUMN_COUNT,
  ): Promise<string[][]> {
    // Identity columns only (Title..Source, Dismissed At..Edit Lock). Full
    // rows are fetched later for the matched row numbers alone.
    const [identity, tail] = await batchGetSheetValues(
      sheetId,
      [`${sheetName}!B2:F`, `${sheetName}!W2:${pipelineLetter(rowWidth - 1)}`],
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
      `${sheetName}!A1:Z1`,
      accessToken,
      fetchImpl,
      retry,
    );
    // A legacy grid may end at Z. Read extensions separately so a missing
    // grid can be grown below without making the initial header read fail.
    try {
      const extensions = await getSheetValues(
        sheetId, `${sheetName}!AA1:AC1`, accessToken, fetchImpl, retry,
      );
      const core = (headerValues[0] || []).slice(0, 26);
      while (core.length < 26) core.push("");
      headerValues[0] = [...core, ...(extensions[0] || [])];
    } catch (error) {
      if (!(error instanceof SheetsHttpError) || error.status !== 400 ||
          !/grid limits|exceeds|out of bounds/i.test(error.body || error.message)) throw error;
    }
    const headerState = checkPipelineHeader(headerValues[0] || [], sheetName);
    const coreHeaderUpgrade = headerState.needsUpgrade || headerState.searchMatchHeader === "legacy" ||
      headerState.searchMatchHeader === "missing" || headerState.workModeHeader === "missing";
    const missingExtensions = PIPELINE_EXTENSION_COLUMN_IDS.filter(
      (id) => headerState.extensionHeaders[id] === "missing",
    );
    // Columns the writer leaves blank: a user's own label there (never
    // written under) or an AA–AC header that could not be added this run.
    const blankedColumns = new Set<number>();
    if (headerState.workModeHeader === "foreign") blankedColumns.add(PIPELINE_COL.workMode);
    if (headerState.searchMatchHeader === "foreign") blankedColumns.add(PIPELINE_COL.matchScore);
    for (const id of PIPELINE_EXTENSION_COLUMN_IDS) {
      if (headerState.extensionHeaders[id] === "foreign") blankedColumns.add(PIPELINE_COL[id]);
    }
    // Appended rows stop at the grid's last writable column.
    let rowWidth: number = COLUMN_COUNT;
    const headerWarnings: string[] = [];
    const skipMissingExtensions = (why: string) => {
      for (const id of missingExtensions) blankedColumns.add(PIPELINE_COL[id]);
      rowWidth = Math.min(...missingExtensions.map((id) => PIPELINE_COL[id]));
      const labels = missingExtensions
        .map((id) => `${pipelineLetter(PIPELINE_COL[id])} ${PIPELINE_HEADER_ROW[PIPELINE_COL[id]]}`)
        .join(", ");
      headerWarnings.push(`Could not add Pipeline columns ${labels} (${why}); leads were written without them.`);
    };
    let gridReady = false;
    if (missingExtensions.length) {
      // AA–AC are optional: a grid that cannot grow never blocks the leads.
      try {
        await ensureSheetGridColumns({
          sheetId,
          sheetName,
          token: accessToken,
          fetchImpl,
          minColumns: PIPELINE_HEADER_ROW.length,
          retry,
        });
        gridReady = true;
      } catch (error) {
        skipMissingExtensions(formatError(error).slice(0, 300));
      }
    }
    if (coreHeaderUpgrade && !gridReady) {
      // Core header writes require only A–Z; optional extensions must not
      // turn a successful legacy write into a grid-growth failure.
      try {
        await ensureSheetGridColumns({
          sheetId,
          sheetName,
          token: accessToken,
          fetchImpl,
          minColumns: PIPELINE_COL.workMode + 1,
          retry,
        });
      } catch (error) {
        throw new SheetWriteError({
          phase: "update",
          message: `Sheet write failed during header grid upgrade: ${formatError(error)}`,
          sheetId,
          httpStatus: error instanceof SheetsHttpError ? error.status : undefined,
          detail:
            (error instanceof SheetsHttpError && error.body) || formatError(error),
        });
      }
    }
    if (headerState.needsUpgrade) {
      const upgraded: string[] = PIPELINE_HEADER_ROW.slice(0, 25);
      upgraded[PIPELINE_COL.matchScore] = (headerValues[0] || [])[PIPELINE_COL.matchScore] || "";
      const response = await batchUpdateSheetValues(
        sheetId,
        [{ range: `${sheetName}!A1:Y1`, values: [upgraded] }],
        accessToken,
        fetchImpl,
        retry,
      );
      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 2048);
        throw new SheetWriteError({
          phase: "update",
          message: `Sheet write failed during header upgrade: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
          sheetId,
          httpStatus: response.status,
          detail: body || undefined,
        });
      }
    }
    if (headerState.searchMatchHeader === "legacy" || headerState.searchMatchHeader === "missing") {
      const response = await batchUpdateSheetValues(
        sheetId,
        [{ range: `${sheetName}!U1`, values: [["Search Match"]] }],
        accessToken,
        fetchImpl,
        retry,
      );
      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 2048);
        throw new SheetWriteError({
          phase: "update",
          message: `Sheet write failed during Search Match header upgrade: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
          sheetId,
          httpStatus: response.status,
          detail: body || undefined,
        });
      }
    }
    if (headerState.workModeHeader === "missing") {
      const response = await batchUpdateSheetValues(
        sheetId,
        [{ range: `${sheetName}!Z1`, values: [["Work Mode"]] }],
        accessToken,
        fetchImpl,
        retry,
      );
      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 2048);
        throw new SheetWriteError({
          phase: "update",
          message: `Sheet write failed during Work Mode header upgrade: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
          sheetId,
          httpStatus: response.status,
          detail: body || undefined,
        });
      }
    }
    if (missingExtensions.length && rowWidth === COLUMN_COUNT) {
      // Re-read AA1:AC1 right before writing: a cell someone filled since the
      // header read is theirs now, and is left alone like any custom label.
      let fresh: string[] | null = null;
      try {
        const values = await getSheetValues(
          sheetId,
          `${sheetName}!${pipelineLetter(PIPELINE_COL.scorer)}1:${pipelineLetter(PIPELINE_COL.possibleDuplicate)}1`,
          accessToken,
          fetchImpl,
          retry,
        );
        fresh = (values[0] || []).map(asText);
      } catch (error) {
        skipMissingExtensions(formatError(error).slice(0, 300));
      }
      const writable = fresh
        ? missingExtensions.filter((id) => !fresh[PIPELINE_COL[id] - PIPELINE_COL.scorer])
        : [];
      for (const id of missingExtensions) {
        if (fresh && !writable.includes(id)) blankedColumns.add(PIPELINE_COL[id]);
      }
      if (writable.length) {
        const response = await batchUpdateSheetValues(
          sheetId,
          writable.map((id) => ({
            range: `${sheetName}!${pipelineLetter(PIPELINE_COL[id])}1`,
            values: [[PIPELINE_HEADER_ROW[PIPELINE_COL[id]]]],
          })),
          accessToken,
          fetchImpl,
          retry,
        );
        if (!response.ok) {
          const body = (await response.text().catch(() => "")).slice(0, 300);
          skipMissingExtensions(`HTTP ${response.status}${body ? ` - ${body}` : ""}`);
        }
      }
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

    const existingRows = await readIdentitySnapshot(sheetId, accessToken, rowWidth);
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
    // DISCAT C1: per-lead fate, by normalized link.
    const skippedLinks: PipelineSkippedLink[] = deduped.droppedLinks.map((url) => ({
      url,
      reason: "duplicate",
    }));
    let updatedLinks: string[] = [];
    let appendedLinks: string[] = [];
    let skippedDuplicates = deduped.skippedDuplicates;
    const warnings: string[] = existingDuplicateCount
      ? [
          `Found ${existingDuplicateCount} duplicate existing Pipeline rows for normalized Link values.`,
        ]
      : [];
    warnings.push(...headerWarnings);

    for (const lead of uniqueLeads) {
      const leadRow = buildLeadRow(lead, now());
      for (const index of blankedColumns) {
        if (index !== PIPELINE_COL.lastSeen) leadRow[index] = "";
      }
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
        if (identityHit.decision.action === "review") {
          // Similar text is a hint, never authority to suppress a new URL,
          // including when the similar older posting was dismissed.
          if (!blankedColumns.has(PIPELINE_COL.possibleDuplicate)) {
            leadRow[PIPELINE_COL.possibleDuplicate] = normalizeRowLink(match.row);
          }
          warnings.push(`Possible duplicate: ${link} resembles Pipeline row ${match.rowNumber}.`);
        } else {
          if (match.row[PIPELINE_COL.dismissedAt]) {
            skippedBlacklist.push({ url: link, title: lead.title || "" });
            skippedLinks.push({ url: link, reason: "blacklisted" });
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
            { rowNumber: match.rowNumber, row: mergeExistingRow(match.row, leadRow, blankedColumns) },
            existingByLink,
            existingByProvider,
            existingBySemantic,
          );
          continue;
        }
      }
      if (blacklistedUrls.has(link)) {
        skippedBlacklist.push({ url: link, title: lead.title || "" });
        skippedLinks.push({ url: link, reason: "blacklisted" });
        continue;
      }
      appends.push(leadRow.slice(0, rowWidth).map((value, index) => blankedColumns.has(index) ? "" : value));
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
          lastColumn: pipelineLetter(rowWidth - 1),
          normalizeLink: normalizeLeadUrl,
          retry,
        });
        const data: Array<{ range: string; values: string[][] }> = [];
        let matched = 0;
        const matchedLinks: string[] = [];
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
            for (const leadRow of entry.leadRows) {
              skippedLinks.push({ url: leadRow[PIPELINE_COL.link], reason: "blacklisted" });
            }
            return;
          }
          let merged = result.row;
          for (const leadRow of entry.leadRows) merged = mergeExistingRow(merged, leadRow, blankedColumns);
          data.push(...changedCellRanges(sheetName, result.rowNumber, result.row, merged));
          matched += entry.leadRows.length;
          for (const leadRow of entry.leadRows) matchedLinks.push(leadRow[PIPELINE_COL.link]);
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
            const body = (await response.text().catch(() => "")).slice(0, 2048);
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
        updatedLinks = matchedLinks;
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
                cause: error,
              });
      }
    }

    // Append phase runs even when the update phase failed: the two are
    // independent, and new leads must not wait on a transient update error.
    if (appends.length) {
      const attempts = (retry.retries ?? 2) + 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const partial = (): PipelineWriteResult => ({
          sheetId,
          appended: 0,
          updated,
          skippedDuplicates: skippedDuplicates + existingDuplicateCount,
          skippedBlacklist: skippedBlacklist.length,
          warnings: [...warnings],
          writtenLinks: [...updatedLinks],
          skippedLinks: [...skippedLinks],
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
            cause: error,
          });
        }
        const fresh = appends.filter((row) => !present.has(row[PIPELINE_COL.link]));
        const already = appends.length - fresh.length;
        for (const row of appends) {
          if (present.has(row[PIPELINE_COL.link])) {
            skippedLinks.push({ url: row[PIPELINE_COL.link], reason: "duplicate" });
          }
        }
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
            `${sheetName}!A:${pipelineLetter(rowWidth - 1)}`,
            appends,
            accessToken,
            fetchImpl,
            { retries: 0 },
          );
        } catch (error) {
          // The request may have reached Google: the rows may be in the Sheet.
          // Re-read links before retrying, so an applied append is not repeated.
          if (error instanceof GoogleTransportError && attempt < attempts - 1) {
            await sleep((retry.retryBaseMs ?? 400) * 2 ** attempt);
            continue;
          }
          throw new SheetWriteError({
            phase: "append",
            message: `Sheet write failed during append phase: ${formatError(error)}`,
            sheetId,
            uncertain: true,
            cause: error,
            partialResult: partial(),
          });
        }
        if (response.ok) {
          appended = appends.length;
          appendedLinks = appends.map((row) => row[PIPELINE_COL.link]);
          break;
        }
        const body = (await response.text().catch(() => "")).slice(0, 2048);
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
      writtenLinks: [...updatedLinks, ...appendedLinks],
      skippedLinks,
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
        cause: updateError,
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
    try {
      return await withSheetLock(sheetId, () => writeLocked(sheetId, leads, accessToken));
    } catch (error) {
      const status = error instanceof SheetsHttpError ? error.status
        : error instanceof SheetWriteError ? error.httpStatus : undefined;
      if (options.requestScopedGoogleAccessToken && runtimeConfig.googleAccessToken &&
          (status === 401 || status === 403)) {
        throw new Error("The Google sign-in from the dashboard expired during the run; reopen the dashboard and press Retry write.");
      }
      throw error;
    }
  }

  return { write };
}

export type { PipelineWriterOptions };
