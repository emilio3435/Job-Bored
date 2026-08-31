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
  DISCOVERY_RUN_TRIGGERS,
  type DiscoveryRunLogRow,
  type DiscoveryRunStatusCell,
  type DiscoveryRunTrigger,
} from "../contracts.ts";
import type { DiscoveryRunStatusPayload } from "../contracts.ts";
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

export type TerminalHistoryFinalizer = {
  finalize(
    sheetId: string,
    row: DiscoveryRunLogRow,
  ): Promise<AppendDiscoveryRunRowResult>;
  finalized(): boolean;
};

/**
 * One durable DiscoveryRuns write per runId. Watchdog, catastrophic catch, and
 * the normal runDiscovery logger all share this so a run cannot append twice.
 */
export function createTerminalHistoryFinalizer(input: {
  runId: string;
  logger?: DiscoveryRunsLogger | null;
  log?(event: string, details: Record<string, unknown>): void;
}): TerminalHistoryFinalizer {
  const runId = String(input.runId || "").trim();
  const originalAppend = input.logger?.append?.bind(input.logger);
  let settled: Promise<AppendDiscoveryRunRowResult> | null = null;

  return {
    finalized() {
      return settled !== null;
    },
    async finalize(sheetId, row) {
      if (!runId) {
        return { ok: false, reason: "runId is required" };
      }
      if (settled) return settled;
      if (!originalAppend) {
        settled = Promise.resolve({
          ok: false as const,
          reason: "discovery runs logger is not configured",
        });
        return settled;
      }
      settled = Promise.resolve(originalAppend(sheetId, row)).catch((error) => {
        const reason = formatError(error);
        input.log?.("discovery.runs_log.finalize_crashed", { runId, reason });
        return { ok: false as const, reason };
      });
      return settled;
    },
  };
}

export function discoveryRunsRowToCells(row: DiscoveryRunLogRow): string[] {
  return rowToCells(row);
}

export function parseDiscoveryRunsCells(
  cells: unknown[],
  headers?: readonly string[],
): DiscoveryRunLogRow | null {
  if (!Array.isArray(cells)) return null;
  const runAt = String(cells[0] ?? "").trim();
  const trigger = String(cells[1] ?? "").trim();
  const status = String(cells[2] ?? "").trim();
  if (!runAt || !trigger || !status) return null;

  const headerList = Array.isArray(headers)
    ? headers.map((header) => String(header || "").trim())
    : [];
  const headerIndex = (name: string) => headerList.indexOf(name);
  const cellAt = (name: string, fallbackIndex: number): unknown => {
    const indexed = headerIndex(name);
    if (indexed >= 0) return cells[indexed];
    return cells[fallbackIndex];
  };

  if (headerList.includes("Leads Updated") || headerList.length >= 10) {
    return {
      runAt: String(cellAt("Run At", 0) ?? ""),
      trigger: String(cellAt("Trigger", 1) ?? "") as DiscoveryRunTrigger,
      status: String(cellAt("Status", 2) ?? "") as DiscoveryRunStatusCell,
      durationS: toInt(cellAt("Duration (s)", 3)),
      companiesSeen: toInt(cellAt("Companies Seen", 4)),
      leadsWritten: toInt(cellAt("Leads New", 5)),
      leadsUpdated: toInt(cellAt("Leads Updated", 6)),
      source: String(cellAt("Source", 7) ?? ""),
      variationKey: String(cellAt("Variation Key", 8) ?? ""),
      error: String(cellAt("Error", 9) ?? ""),
    };
  }

  if (cells.length >= 10) {
    return {
      runAt,
      trigger: trigger as DiscoveryRunTrigger,
      status: status as DiscoveryRunStatusCell,
      durationS: toInt(cells[3]),
      companiesSeen: toInt(cells[4]),
      leadsWritten: toInt(cells[5]),
      leadsUpdated: toInt(cells[6]),
      source: String(cells[7] ?? ""),
      variationKey: String(cells[8] ?? ""),
      error: String(cells[9] ?? ""),
    };
  }

  // Sheets omits trailing empty Error on canonical success rows, yielding 9
  // cells whose 7th value is Leads Updated (numeric) rather than Source.
  if (looksLikeNumber(cells[6])) {
    return {
      runAt,
      trigger: trigger as DiscoveryRunTrigger,
      status: status as DiscoveryRunStatusCell,
      durationS: toInt(cells[3]),
      companiesSeen: toInt(cells[4]),
      leadsWritten: toInt(cells[5]),
      leadsUpdated: toInt(cells[6]),
      source: String(cells[7] ?? ""),
      variationKey: String(cells[8] ?? ""),
      error: "",
    };
  }

  return {
    runAt,
    trigger: trigger as DiscoveryRunTrigger,
    status: status as DiscoveryRunStatusCell,
    durationS: toInt(cells[3]),
    companiesSeen: toInt(cells[4]),
    leadsWritten: toInt(cells[5]),
    leadsUpdated: 0,
    source: String(cells[6] ?? ""),
    variationKey: String(cells[7] ?? ""),
    error: String(cells[8] ?? ""),
  };
}

export function buildDiscoveryRunLogRowFromStatus(
  status: DiscoveryRunStatusPayload,
  extras: {
    source?: string;
    trigger?: string;
    durationS?: number;
  } = {},
): DiscoveryRunLogRow {
  const logStatus = mapStatusToLogCell(status.status);
  const startedMs = Date.parse(String(status.startedAt || status.acceptedAt || ""));
  const endedMs = Date.parse(
    String(status.completedAt || status.updatedAt || ""),
  );
  const durationS =
    extras.durationS ??
    (Number.isFinite(startedMs) && Number.isFinite(endedMs)
      ? Math.max(0, Math.round((endedMs - startedMs) / 1000))
      : 0);
  return {
    runAt: String(status.completedAt || status.updatedAt || ""),
    trigger: mapTriggerToLogCell(extras.trigger || status.trigger),
    status: logStatus,
    durationS,
    companiesSeen: Number(status.lifecycle?.companyCount) || 0,
    leadsWritten: Number(status.writeResult?.appended) || 0,
    leadsUpdated: Number(status.writeResult?.updated) || 0,
    source: extras.source || "worker",
    variationKey: String(status.request?.variationKey || ""),
    error: logStatus === "success" ? "" : String(status.error || ""),
  };
}

function mapStatusToLogCell(status: string): DiscoveryRunStatusCell {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed" || normalized === "empty" || normalized === "success") {
    return "success";
  }
  if (normalized === "partial") return "partial";
  return "failure";
}

function mapTriggerToLogCell(trigger: string): DiscoveryRunTrigger {
  const normalized = String(trigger || "").trim();
  if ((DISCOVERY_RUN_TRIGGERS as readonly string[]).includes(normalized)) {
    return normalized as DiscoveryRunTrigger;
  }
  if (normalized === "scheduled") return "scheduled-local";
  return "manual";
}

function toInt(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function looksLikeNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  return /^-?\d+(\.\d+)?$/.test(raw);
}

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
    Number.isFinite(row.leadsUpdated) ? String(Math.max(0, Math.round(row.leadsUpdated))) : "0",
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
