import type { WorkerRuntimeConfig } from "../config.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import {
  PIPELINE_STATUS_VALUES,
  isoDay,
  planStageMove,
  prependDatedNote,
  type PipelineStatus,
} from "./pipeline-transitions.ts";
import {
  DEFAULT_SHEET_NAME,
  DEFAULT_TOKEN_SCOPE,
  PIPELINE_COL,
  PIPELINE_LAST_COLUMN_LETTER,
  batchUpdateSheetValues,
  changedCellRanges,
  checkPipelineHeader,
  getSheetValues,
  resolveAccessToken,
  resolveRowsByLink,
  withSheetLock,
  type FetchLike,
} from "./sheets-client.ts";

export { PIPELINE_STATUS_VALUES, type PipelineStatus };

export const DID_THEY_REPLY_VALUES = ["Yes", "No", "Unknown"] as const;
export type DidTheyReply = (typeof DID_THEY_REPLY_VALUES)[number];

export const PIPELINE_PATCH_FIELD_KEYS = [
  "stage",
  "contact",
  "note",
  "lastContact",
  "appliedDate",
  "didTheyReply",
  "source",
] as const;
export type PipelinePatchFieldKey = (typeof PIPELINE_PATCH_FIELD_KEYS)[number];

export class PipelinePatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelinePatchValidationError";
  }
}

/** The job matched more than one Pipeline row; nothing was written. */
export class PipelineAmbiguousMatchError extends Error {
  readonly code = "ambiguous_match";
  readonly rowNumbers: number[];
  readonly matchedBy: "url" | "company-title";

  constructor(rowNumbers: number[], matchedBy: "url" | "company-title") {
    super(
      `The job matches Pipeline rows ${rowNumbers.join(", ")} by ${matchedBy === "url" ? "Link" : "company and title"}.`,
    );
    this.name = "PipelineAmbiguousMatchError";
    this.rowNumbers = rowNumbers;
    this.matchedBy = matchedBy;
  }
}

export type PipelinePatchFields = {
  stage?: PipelineStatus;
  contact?: string;
  note?: string;
  lastContact?: string;
  appliedDate?: string;
  didTheyReply?: DidTheyReply;
  /** Where an application went in; used with stage Applied (v2). */
  source?: string;
};

export type PipelinePatchInput = {
  job: { url?: string; company?: string; title?: string };
  fields: PipelinePatchFields;
};

export type PipelinePatchResult = {
  matched: boolean;
  matchedBy?: "url" | "company-title";
  rowNumber?: number;
};

export type PipelinePatcherOptions = {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sheetName?: string;
  tokenScope?: string;
};

export type PipelinePatcher = {
  patch(sheetId: string, input: PipelinePatchInput): Promise<PipelinePatchResult>;
};

function assertKnownFields(fields: Record<string, unknown>): void {
  const unknown = Object.keys(fields).filter(
    (key) => !PIPELINE_PATCH_FIELD_KEYS.includes(key as PipelinePatchFieldKey),
  );
  if (unknown.length) {
    throw new PipelinePatchValidationError(
      `Unknown pipeline-update field(s): ${unknown.join(", ")}.`,
    );
  }
}

type Match = { rowNumber: number; link: string; matchedBy: "url" | "company-title" };

/**
 * Find the row for a job in an identity snapshot of B:E (Title, Company,
 * Location, Link). More than one hit is ambiguous, never "the first".
 */
function findRow(
  identityRows: string[][],
  job: PipelinePatchInput["job"],
): Match | null {
  const wantUrl = normalizeLeadUrl(job.url || "");
  const wantCompany = (job.company || "").trim().toLowerCase();
  const wantTitle = (job.title || "").trim().toLowerCase();
  const linkOf = (row: string[]) => normalizeLeadUrl(row[3] || "");

  if (wantUrl) {
    const hits: number[] = [];
    identityRows.forEach((row, index) => {
      if (linkOf(row) === wantUrl) hits.push(index + 2);
    });
    if (hits.length > 1) throw new PipelineAmbiguousMatchError(hits, "url");
    if (hits.length === 1) return { rowNumber: hits[0], link: wantUrl, matchedBy: "url" };
  }
  if (wantCompany && wantTitle) {
    const hits: number[] = [];
    identityRows.forEach((row, index) => {
      if (
        (row[1] || "").trim().toLowerCase() === wantCompany &&
        (row[0] || "").trim().toLowerCase() === wantTitle
      ) {
        hits.push(index + 2);
      }
    });
    if (hits.length > 1) throw new PipelineAmbiguousMatchError(hits, "company-title");
    if (hits.length === 1) {
      return {
        rowNumber: hits[0],
        link: linkOf(identityRows[hits[0] - 2]),
        matchedBy: "company-title",
      };
    }
  }
  return null;
}

function applyFields(row: string[], fields: PipelinePatchFields, now: Date): string[] {
  let next = row.slice();
  const currentStatus = (row[PIPELINE_COL.status] || "").trim();
  const note = fields.note !== undefined && fields.note !== "" ? fields.note : "";
  let noteHandled = false;

  if (fields.stage !== undefined && fields.stage !== currentStatus) {
    next = planStageMove(next, {
      to: fields.stage,
      now,
      appliedDate: fields.appliedDate,
      source: fields.source,
      note,
    });
    noteHandled = true;
  } else if (fields.appliedDate !== undefined) {
    next[PIPELINE_COL.appliedDate] = fields.appliedDate;
  }
  if (fields.contact !== undefined) next[PIPELINE_COL.contact] = fields.contact;
  if (fields.lastContact !== undefined) next[PIPELINE_COL.lastHeardFrom] = fields.lastContact;
  if (fields.didTheyReply !== undefined) next[PIPELINE_COL.responseFlag] = fields.didTheyReply;
  if (note && !noteHandled) {
    next[PIPELINE_COL.notes] = prependDatedNote(next[PIPELINE_COL.notes] || "", note, isoDay(now));
  }
  return next;
}

export function createPipelinePatcher(
  runtimeConfig: WorkerRuntimeConfig,
  options: PipelinePatcherOptions = {},
): PipelinePatcher {
  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike);
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this runtime");
  }
  const now = options.now || (() => new Date());
  const sheetName = options.sheetName || DEFAULT_SHEET_NAME;
  const tokenScope = options.tokenScope || DEFAULT_TOKEN_SCOPE;

  async function patchLocked(
    sheetId: string,
    input: PipelinePatchInput,
    token: string,
  ): Promise<PipelinePatchResult> {
    const header = await getSheetValues(
      sheetId,
      `${sheetName}!A1:${PIPELINE_LAST_COLUMN_LETTER}1`,
      token,
      fetchImpl,
    );
    // A Sheet whose columns moved would take the stage in the wrong cell.
    checkPipelineHeader(header[0] || [], sheetName);

    const identityRows = await getSheetValues(sheetId, `${sheetName}!B2:E`, token, fetchImpl);
    const match = findRow(identityRows, input.job);
    if (!match) return { matched: false };

    let rowNumber = match.rowNumber;
    let fresh: string[];
    if (match.link) {
      const [resolved] = await resolveRowsByLink({
        sheetId,
        sheetName,
        token,
        fetchImpl,
        targets: [{ rowNumber: match.rowNumber, link: match.link }],
        normalizeLink: normalizeLeadUrl,
      });
      if (resolved.status === "missing") return { matched: false };
      if (resolved.status === "ambiguous") {
        throw new PipelineAmbiguousMatchError(resolved.rowNumbers, match.matchedBy);
      }
      rowNumber = resolved.rowNumber;
      fresh = resolved.row;
    } else {
      const rows = await getSheetValues(
        sheetId,
        `${sheetName}!A${rowNumber}:${PIPELINE_LAST_COLUMN_LETTER}${rowNumber}`,
        token,
        fetchImpl,
      );
      fresh = rows[0] || [];
      while (fresh.length < header[0].length) fresh.push("");
    }

    const next = applyFields(fresh, input.fields, now());
    const data = changedCellRanges(sheetName, rowNumber, fresh, next);
    if (data.length) {
      const response = await batchUpdateSheetValues(sheetId, data, token, fetchImpl);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Sheet write failed during narrow update: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
        );
      }
    }
    return { matched: true, matchedBy: match.matchedBy, rowNumber };
  }

  async function patch(sheetId: string, input: PipelinePatchInput): Promise<PipelinePatchResult> {
    assertKnownFields((input.fields || {}) as Record<string, unknown>);
    const token = await resolveAccessToken(runtimeConfig, fetchImpl, now, tokenScope);
    return withSheetLock(sheetId, () => patchLocked(sheetId, input, token));
  }

  return { patch };
}
