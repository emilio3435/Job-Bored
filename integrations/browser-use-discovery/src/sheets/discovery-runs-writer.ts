/**
 * DiscoveryRuns sheet-tab writer.
 *
 * Appends one row per completed discovery run to the user's Google Sheet. The
 * sheet tab is named DISCOVERY_RUNS_SHEET_NAME and its header row matches
 * DISCOVERY_RUNS_HEADER_ROW. See docs/INTERFACE-DISCOVERY-RUNS.md.
 *
 * Best-effort by design (contract §3): a failure to log must not fail the
 * discovery run itself. Callers receive a result object that reports success,
 * skipped (tab auto-created), or failure — but never throws.
 */

import type { WorkerRuntimeConfig } from "../config.ts";
import {
  DISCOVERY_RUNS_HEADER_ROW,
  DISCOVERY_RUNS_SHEET_NAME,
  type DiscoveryRunLogRow,
} from "../contracts.ts";
import { resolveAccessToken } from "./pipeline-writer.ts";

type FetchLike = typeof fetch;

const DEFAULT_TOKEN_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const HEADER_COLUMN_COUNT = DISCOVERY_RUNS_HEADER_ROW.length;
const LAST_COLUMN_LETTER = columnIndexToLetter(HEADER_COLUMN_COUNT);
const ERROR_MAX_LENGTH = 200;

export type AppendDiscoveryRunRowDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  fetchImpl?: FetchLike;
  now?: () => Date;
  tokenScope?: string;
  log?(event: string, details: Record<string, unknown>): void;
};

export type AppendDiscoveryRunRowResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: string };

export type DiscoveryRunsLogger = {
  append(
    sheetId: string,
    row: DiscoveryRunLogRow,
  ): Promise<AppendDiscoveryRunRowResult>;
};

/**
 * Build a reusable logger bound to a single runtimeConfig. Convenience wrapper
 * so callers (runDiscovery, profile-webhook) don't have to re-pass config on
 * every append.
 */
export function createDiscoveryRunsLogger(
  dependencies: AppendDiscoveryRunRowDependencies,
): DiscoveryRunsLogger {
  return {
    append(sheetId, row) {
      return appendDiscoveryRunRow(sheetId, row, dependencies);
    },
  };
}

/**
 * Append one DiscoveryRuns row. Creates the tab + header row on demand when
 * the sheet doesn't have it yet.
 */
export async function appendDiscoveryRunRow(
  sheetId: string,
  row: DiscoveryRunLogRow,
  dependencies: AppendDiscoveryRunRowDependencies,
): Promise<AppendDiscoveryRunRowResult> {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, reason: "fetch is not available in this runtime" };
  }
  if (!sheetId || typeof sheetId !== "string") {
    return { ok: false, reason: "sheetId is required" };
  }

  const now = dependencies.now || (() => new Date());
  const tokenScope = dependencies.tokenScope || DEFAULT_TOKEN_SCOPE;

  let token: string;
  try {
    token = await resolveAccessToken(
      dependencies.runtimeConfig,
      fetchImpl,
      now,
      tokenScope,
    );
  } catch (error) {
    const message = formatError(error);
    dependencies.log?.("discovery.runs_log.token_failed", { message });
    return { ok: false, reason: `token resolution failed: ${message}` };
  }

  const values = [rowToCells(row)];
  const created = await ensureTabExists(
    sheetId,
    token,
    fetchImpl,
    dependencies.log,
  );
  if (!created.ok) return { ok: false, reason: created.reason };

  const appendUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      sheetId,
    )}/values/${encodeURIComponent(
      `${DISCOVERY_RUNS_SHEET_NAME}!A:${LAST_COLUMN_LETTER}`,
    )}:append`,
  );
  appendUrl.searchParams.set("valueInputOption", "USER_ENTERED");
  appendUrl.searchParams.set("insertDataOption", "INSERT_ROWS");
  appendUrl.searchParams.set("includeValuesInResponse", "false");

  let appendResponse: Response;
  try {
    appendResponse = await fetchImpl(appendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ majorDimension: "ROWS", values }),
    });
  } catch (error) {
    const message = formatError(error);
    dependencies.log?.("discovery.runs_log.append_failed", { message });
    return { ok: false, reason: `append request failed: ${message}` };
  }

  if (!appendResponse.ok) {
    const detail = await appendResponse.text().catch(() => "");
    const message = `HTTP ${appendResponse.status}${detail ? ` - ${detail}` : ""}`;
    dependencies.log?.("discovery.runs_log.append_failed", { message });
    return { ok: false, reason: message };
  }

  return { ok: true, created: created.created };
}

function rowToCells(row: DiscoveryRunLogRow): string[] {
  const error = truncate(row.error || "", ERROR_MAX_LENGTH);
  return [
    String(row.runAt || ""),
    String(row.trigger || ""),
    String(row.status || ""),
    Number.isFinite(row.durationS) ? String(Math.max(0, Math.round(row.durationS))) : "0",
    Number.isFinite(row.companiesSeen) ? String(Math.max(0, Math.round(row.companiesSeen))) : "0",
    Number.isFinite(row.leadsWritten) ? String(Math.max(0, Math.round(row.leadsWritten))) : "0",
    String(row.source || ""),
    String(row.variationKey || ""),
    row.status === "success" ? "" : error,
  ];
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Ensure the DiscoveryRuns tab exists with the correct header row. Creates the
 * tab via batchUpdate + writes the header when missing. Idempotent — safe to
 * call before every append.
 */
async function ensureTabExists(
  sheetId: string,
  token: string,
  fetchImpl: FetchLike,
  log?: (event: string, details: Record<string, unknown>) => void,
): Promise<{ ok: true; created: boolean } | { ok: false; reason: string }> {
  const headerRange = `${DISCOVERY_RUNS_SHEET_NAME}!A1:${LAST_COLUMN_LETTER}1`;
  const headerUrl = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      sheetId,
    )}/values/${encodeURIComponent(headerRange)}`,
  );

  let headerResponse: Response;
  try {
    headerResponse = await fetchImpl(headerUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    return { ok: false, reason: `header read failed: ${formatError(error)}` };
  }

  if (headerResponse.ok) {
    const body = (await headerResponse.json().catch(() => null)) as
      | { values?: unknown[][] }
      | null;
    const existingRow = Array.isArray(body?.values?.[0]) ? body!.values![0] : [];
    const headerMatches =
      existingRow.length >= HEADER_COLUMN_COUNT &&
      DISCOVERY_RUNS_HEADER_ROW.every(
        (cell, index) => String(existingRow[index] || "").trim() === cell,
      );
    if (headerMatches) return { ok: true, created: false };
    // Tab exists but header is missing or wrong — (re)write the header row.
    const writeHeader = await writeHeaderRow(sheetId, token, fetchImpl);
    if (!writeHeader.ok) return writeHeader;
    return { ok: true, created: false };
  }

  // 4xx typically means the tab doesn't exist yet — create it then write header.
  if (headerResponse.status >= 400 && headerResponse.status < 500) {
    const created = await addSheetTab(sheetId, token, fetchImpl);
    if (!created.ok) return created;
    log?.("discovery.runs_log.tab_created", {
      sheetId,
      tabName: DISCOVERY_RUNS_SHEET_NAME,
    });
    const writeHeader = await writeHeaderRow(sheetId, token, fetchImpl);
    if (!writeHeader.ok) return writeHeader;
    return { ok: true, created: true };
  }

  const detail = await headerResponse.text().catch(() => "");
  return {
    ok: false,
    reason: `header read HTTP ${headerResponse.status}${detail ? ` - ${detail}` : ""}`,
  };
}

async function addSheetTab(
  sheetId: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}:batchUpdate`,
  );
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: { title: DISCOVERY_RUNS_SHEET_NAME },
            },
          },
        ],
      }),
    });
  } catch (error) {
    return { ok: false, reason: `addSheet failed: ${formatError(error)}` };
  }
  if (response.ok) return { ok: true };
  // If the tab already exists (race with a concurrent writer), Sheets returns
  // 400 — treat as success since the subsequent header write will correct state.
  if (response.status === 400) {
    const detail = await response.text().catch(() => "");
    if (detail.toLowerCase().includes("already exists")) return { ok: true };
    return { ok: false, reason: `addSheet HTTP 400 - ${detail}` };
  }
  const detail = await response.text().catch(() => "");
  return {
    ok: false,
    reason: `addSheet HTTP ${response.status}${detail ? ` - ${detail}` : ""}`,
  };
}

async function writeHeaderRow(
  sheetId: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const range = `${DISCOVERY_RUNS_SHEET_NAME}!A1:${LAST_COLUMN_LETTER}1`;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      sheetId,
    )}/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set("valueInputOption", "USER_ENTERED");

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: [[...DISCOVERY_RUNS_HEADER_ROW]],
      }),
    });
  } catch (error) {
    return { ok: false, reason: `header write failed: ${formatError(error)}` };
  }
  if (response.ok) return { ok: true };
  const detail = await response.text().catch(() => "");
  return {
    ok: false,
    reason: `header write HTTP ${response.status}${detail ? ` - ${detail}` : ""}`,
  };
}

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

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "unknown error");
}
