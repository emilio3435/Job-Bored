import type { WorkerRuntimeConfig } from "../config.ts";
import { PIPELINE_HEADER_ROW } from "../contracts.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";
import {
  DEFAULT_SHEET_NAME,
  DEFAULT_TOKEN_SCOPE,
  LAST_COLUMN_LETTER,
  getSheetValues,
  resolveAccessToken,
  type FetchLike,
} from "./pipeline-writer.ts";

// 0-based column indices in the Pipeline tab (mirror PIPELINE_HEADER_ROW).
const COL = {
  title: 1,
  company: 2,
  link: 4,
  contact: 11,
  status: 12,
  appliedDate: 13,
  notes: 14,
  lastContact: 17,
  didTheyReply: 18,
} as const;

export const PIPELINE_STATUS_VALUES = [
  "New", "Researching", "Applied", "Phone Screen",
  "Interviewing", "Offer", "Rejected", "Passed", "Expired",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUS_VALUES)[number];

export const DID_THEY_REPLY_VALUES = ["Yes", "No", "Unknown"] as const;
export type DidTheyReply = (typeof DID_THEY_REPLY_VALUES)[number];

export const PIPELINE_PATCH_FIELD_KEYS = [
  "stage",
  "contact",
  "note",
  "lastContact",
  "appliedDate",
  "didTheyReply",
] as const;
export type PipelinePatchFieldKey = (typeof PIPELINE_PATCH_FIELD_KEYS)[number];

const COL_LETTER = {
  contact: "L",
  status: "M",
  appliedDate: "N",
  notes: "O",
  lastContact: "R",
  didTheyReply: "S",
} as const;

export class PipelinePatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelinePatchValidationError";
  }
}

export type PipelinePatchFields = {
  stage?: PipelineStatus;
  contact?: string;
  note?: string;
  lastContact?: string;
  appliedDate?: string;
  didTheyReply?: DidTheyReply;
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

function isoDate(now: () => Date): string {
  return now().toISOString().slice(0, 10);
}

function appendNote(existing: string, note: string, date: string): string {
  const entry = `[${date}] ${note}`;
  if (!existing) return entry;
  const lines = existing.split("\n");
  if (lines.some((line) => line.trim() === entry)) return existing; // idempotent
  return `${entry}\n${existing}`;
}

function padRow(row: string[]): string[] {
  const out = row.slice();
  while (out.length < PIPELINE_HEADER_ROW.length) out.push("");
  return out;
}

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

async function batchUpdateCells(
  sheetId: string,
  cells: Array<{ range: string; value: string }>,
  token: string,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!cells.length) return;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`,
  );
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: cells.map((cell) => ({
        range: cell.range,
        majorDimension: "ROWS",
        values: [[cell.value]],
      })),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Sheet write failed during narrow update: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
    );
  }
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

  async function patch(sheetId: string, input: PipelinePatchInput): Promise<PipelinePatchResult> {
    assertKnownFields((input.fields || {}) as Record<string, unknown>);
    const token = await resolveAccessToken(runtimeConfig, fetchImpl, now, tokenScope);
    const rows = await getSheetValues(sheetId, `${sheetName}!A2:${LAST_COLUMN_LETTER}`, token, fetchImpl);

    const wantUrl = normalizeLeadUrl(input.job.url || "");
    const wantCompany = (input.job.company || "").trim().toLowerCase();
    const wantTitle = (input.job.title || "").trim().toLowerCase();

    let matchIndex = -1;
    let matchedBy: "url" | "company-title" | undefined;

    if (wantUrl) {
      matchIndex = rows.findIndex((row) => normalizeLeadUrl(row[COL.link] || "") === wantUrl);
      if (matchIndex >= 0) matchedBy = "url";
    }
    if (matchIndex < 0 && wantCompany && wantTitle) {
      matchIndex = rows.findIndex(
        (row) =>
          (row[COL.company] || "").trim().toLowerCase() === wantCompany &&
          (row[COL.title] || "").trim().toLowerCase() === wantTitle,
      );
      if (matchIndex >= 0) matchedBy = "company-title";
    }

    if (matchIndex < 0) return { matched: false };

    const rowNumber = matchIndex + 2; // +1 header, +1 for 1-based row numbers
    const patched = padRow(rows[matchIndex]);
    const { fields } = input;
    const cells: Array<{ range: string; value: string }> = [];

    function queue(letter: string, next: string, previous: string) {
      if (next === previous) return;
      cells.push({ range: `${sheetName}!${letter}${rowNumber}`, value: next });
    }

    if (fields.stage !== undefined) queue(COL_LETTER.status, fields.stage, patched[COL.status] || "");
    if (fields.contact !== undefined) queue(COL_LETTER.contact, fields.contact, patched[COL.contact] || "");
    if (fields.lastContact !== undefined) {
      queue(COL_LETTER.lastContact, fields.lastContact, patched[COL.lastContact] || "");
    }
    if (fields.appliedDate !== undefined) {
      queue(COL_LETTER.appliedDate, fields.appliedDate, patched[COL.appliedDate] || "");
    }
    if (fields.didTheyReply !== undefined) {
      queue(COL_LETTER.didTheyReply, fields.didTheyReply, patched[COL.didTheyReply] || "");
    }
    if (fields.note !== undefined && fields.note !== "") {
      const nextNotes = appendNote(patched[COL.notes] || "", fields.note, isoDate(now));
      queue(COL_LETTER.notes, nextNotes, patched[COL.notes] || "");
    }

    await batchUpdateCells(sheetId, cells, token, fetchImpl);

    return { matched: true, matchedBy, rowNumber };
  }

  return { patch };
}
