/**
 * One Sheets client for every worker writer (BEAUDIT lane S, spec §7.4).
 *
 * - Token cache: one Google token exchange per credential per hour, keyed by
 *   the credential's content so a changed credential is a new key.
 * - Per-Sheet mutex: writers in this process run their read → write windows
 *   one at a time for a given spreadsheet id.
 * - Link re-resolution: a row number from a snapshot is re-checked against
 *   its Link right before a write, and re-found when the row moved.
 * - Column map maintained alongside schemas/pipeline-row.v1.json.
 * - Formula escaping: every USER_ENTERED text cell that starts with = + - @
 *   is written with a leading apostrophe, so it is stored as text.
 * - Retry: transient network errors and 429/5xx answers are retried with backoff.
 */
import { createHash, createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { WorkerRuntimeConfig } from "../config.ts";
import { PIPELINE_COLUMNS } from "./pipeline-columns.generated.ts";

export type FetchLike = typeof fetch;

export const DEFAULT_SHEET_NAME = "Pipeline";
export const DEFAULT_TOKEN_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

/* ------------------------------------------------------------------ */
/* Column map                                                          */
/* ------------------------------------------------------------------ */

export type PipelineColumnId =
  | "dateFound" | "title" | "company" | "location" | "link" | "source"
  | "salary" | "fitScore" | "priority" | "tags" | "fitAssessment" | "contact"
  | "status" | "appliedDate" | "notes" | "followUpDate" | "talkingPoints"
  | "lastHeardFrom" | "responseFlag" | "logoUrl" | "matchScore" | "favorite"
  | "dismissedAt" | "approvalStatus" | "editLock" | "workMode";

function buildColumnIndex(): Record<PipelineColumnId, number> {
  const out = {} as Record<PipelineColumnId, number>;
  for (const column of PIPELINE_COLUMNS) {
    out[column.id as PipelineColumnId] = column.sheetIndex;
  }
  return out;
}

/** 0-based Pipeline column index by schema column id. */
export const PIPELINE_COL: Readonly<Record<PipelineColumnId, number>> = Object.freeze(
  buildColumnIndex(),
);

export const PIPELINE_COLUMN_COUNT = PIPELINE_COLUMNS.length;

/** Pipeline columns 1..17 must be present for any writer to run. */
export const PIPELINE_REQUIRED_HEADER_COUNT = 17;

export function columnIndexToLetter(index: number): string {
  // 1 -> "A", 26 -> "Z", 27 -> "AA".
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

/** Column letter for a 0-based Pipeline index. */
export function pipelineLetter(index: number): string {
  return columnIndexToLetter(index + 1);
}

export const PIPELINE_LAST_COLUMN_LETTER = columnIndexToLetter(PIPELINE_COLUMN_COUNT);

/* ------------------------------------------------------------------ */
/* Header check                                                        */
/* ------------------------------------------------------------------ */

export class PipelineHeaderMismatchError extends Error {
  readonly code = "header_mismatch";
  readonly column: string;
  readonly expected: string;
  readonly found: string;

  constructor(params: { column: string; expected: string; found: string; sheetName: string }) {
    super(
      `${params.sheetName} header mismatch: column ${params.column} is ${params.found ? `'${params.found}'` : "empty"}; expected '${params.expected}'.`,
    );
    this.name = "PipelineHeaderMismatchError";
    this.column = params.column;
    this.expected = params.expected;
    this.found = params.found;
  }
}

/**
 * Check row 1 of the Pipeline tab against the schema. Columns A..Q must sit
 * at their schema positions; optional columns may be blank (a legacy Sheet)
 * but never carry another label. U accepts the legacy Match Score label and
 * leaves a foreign label untouched. Z follows the same foreign-header rule.
 */
export function checkPipelineHeader(
  headerRow: unknown[],
  sheetName = DEFAULT_SHEET_NAME,
): { needsUpgrade: boolean; workModeHeader: "missing" | "ready" | "foreign"; searchMatchHeader: "missing" | "legacy" | "ready" | "foreign" } {
  let needsUpgrade = false;
  let workModeHeader: "missing" | "ready" | "foreign" = "missing";
  let searchMatchHeader: "missing" | "legacy" | "ready" | "foreign" = "missing";
  for (const column of PIPELINE_COLUMNS) {
    const raw = headerRow[column.sheetIndex];
    const found = typeof raw === "string" ? raw.trim() : "";
    if (column.id === "workMode") {
      workModeHeader = found === column.headerLabel ? "ready" : found ? "foreign" : "missing";
      continue;
    }
    if (column.id === "matchScore") {
      searchMatchHeader = found === column.headerLabel ? "ready"
        : found === "Match Score" ? "legacy" : found ? "foreign" : "missing";
      continue;
    }
    if (found === column.headerLabel) continue;
    if (column.sheetIndex >= PIPELINE_REQUIRED_HEADER_COUNT && found === "") {
      needsUpgrade = true;
      continue;
    }
    throw new PipelineHeaderMismatchError({
      column: column.letter,
      expected: column.headerLabel,
      found,
      sheetName,
    });
  }
  return { needsUpgrade, workModeHeader, searchMatchHeader };
}

/* ------------------------------------------------------------------ */
/* Formula escaping                                                    */
/* ------------------------------------------------------------------ */

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Sheets evaluates a USER_ENTERED string that starts with = (and + - @ in
 * some locales) as a formula. A leading apostrophe stores it as text; the
 * apostrophe is not part of the stored value.
 */
export function escapeCellForUserEntered(value: unknown): string {
  const text = value == null ? "" : String(value);
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function escapeRows(rows: unknown[][]): string[][] {
  return rows.map((row) => row.map((cell) => escapeCellForUserEntered(cell)));
}

/* ------------------------------------------------------------------ */
/* Per-Sheet mutex                                                     */
/* ------------------------------------------------------------------ */

const sheetLocks = new Map<string, Promise<void>>();

/**
 * Run `fn` while holding this process's lock for `sheetId`. Writers use it
 * around each read → write window, so two runs, a cleanup pass and a
 * /pipeline-update never interleave on one Sheet. Not re-entrant.
 */
export async function withSheetLock<T>(sheetId: string, fn: () => Promise<T>): Promise<T> {
  const key = String(sheetId || "");
  const previous = sheetLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const tail = previous.then(() => held);
  sheetLocks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (sheetLocks.get(key) === tail) sheetLocks.delete(key);
  }
}

/* ------------------------------------------------------------------ */
/* Credentials and the token cache                                     */
/* ------------------------------------------------------------------ */

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type GoogleOAuthToken = {
  token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  token_uri: string;
  expiry: string;
};

type IssuedToken = { accessToken: string; expiresInSec: number };

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function googleErrorCode(body: string): string {
  try { return asText((JSON.parse(body) as { error?: unknown }).error); }
  catch { return ""; }
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseServiceAccount(rawJson: string): GoogleServiceAccount {
  const parsed = JSON.parse(rawJson) as Partial<GoogleServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service account JSON must include client_email and private_key");
  }
  return {
    client_email: String(parsed.client_email),
    private_key: String(parsed.private_key),
    token_uri: parsed.token_uri ? String(parsed.token_uri) : GOOGLE_TOKEN_URI,
  };
}

function parseOAuthToken(rawJson: string): GoogleOAuthToken {
  const parsed = JSON.parse(rawJson) as Partial<GoogleOAuthToken>;
  return {
    token: asText(parsed.token),
    refresh_token: asText(parsed.refresh_token),
    client_id: asText(parsed.client_id),
    client_secret: asText(parsed.client_secret),
    token_uri: asText(parsed.token_uri) || GOOGLE_TOKEN_URI,
    expiry: asText(parsed.expiry),
  };
}

async function readServiceAccountConfig(
  runtimeConfig: WorkerRuntimeConfig,
): Promise<GoogleServiceAccount | null> {
  const inline = asText(runtimeConfig.googleServiceAccountJson);
  if (inline) return parseServiceAccount(inline);
  const filePath = asText(runtimeConfig.googleServiceAccountFile);
  if (!filePath) return null;
  return parseServiceAccount(await readFile(filePath, "utf8"));
}

async function readOAuthTokenConfig(
  runtimeConfig: WorkerRuntimeConfig,
): Promise<GoogleOAuthToken | null> {
  const inline = asText(runtimeConfig.googleOAuthTokenJson);
  if (inline) return parseOAuthToken(inline);
  const filePath = asText(runtimeConfig.googleOAuthTokenFile);
  if (!filePath) return null;
  return parseOAuthToken(await readFile(filePath, "utf8"));
}

async function exchangeServiceAccountToken(
  serviceAccount: GoogleServiceAccount,
  tokenScope: string,
  fetchImpl: FetchLike,
  now: () => Date,
): Promise<IssuedToken> {
  const iat = Math.floor(now().getTime() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope: tokenScope,
    aud: serviceAccount.token_uri || GOOGLE_TOKEN_URI,
    iat,
    exp: iat + 3600,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${toBase64Url(signer.sign(serviceAccount.private_key))}`;

  const response = await sendWithRetry(fetchImpl, new URL(serviceAccount.token_uri || GOOGLE_TOKEN_URI), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  }, { retries: 2 });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const errorCode = googleErrorCode(body);
    if (errorCode === "invalid_grant") {
      throw new Error("Google service account credentials were rejected (invalid_grant). Check the configured key and system time, then retry the write.");
    }
    throw new Error(
      `Failed to exchange service account token: HTTP ${response.status}${errorCode ? ` (${errorCode})` : ""}`,
    );
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Service account token response missing access_token");
  }
  return { accessToken: data.access_token, expiresInSec: Number(data.expires_in) || 3600 };
}

export function hasFreshOAuthAccessToken(
  tokenConfig: { token: string; expiry: string },
  now: () => Date,
): boolean {
  if (!tokenConfig.token) return false;
  if (!tokenConfig.expiry) return true;
  const expiryMs = Date.parse(tokenConfig.expiry);
  if (!Number.isFinite(expiryMs)) return true;
  return expiryMs - now().getTime() > 60_000;
}

async function refreshOAuthAccessToken(
  tokenConfig: GoogleOAuthToken,
  fetchImpl: FetchLike,
): Promise<IssuedToken> {
  if (!tokenConfig.refresh_token || !tokenConfig.client_id || !tokenConfig.client_secret) {
    throw new Error(
      "Google OAuth token JSON must include refresh_token, client_id, and client_secret when the cached access token is expired.",
    );
  }
  const response = await sendWithRetry(fetchImpl, new URL(tokenConfig.token_uri || GOOGLE_TOKEN_URI), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenConfig.refresh_token,
      client_id: tokenConfig.client_id,
      client_secret: tokenConfig.client_secret,
    }).toString(),
  }, { retries: 2 });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const errorCode = googleErrorCode(body);
    if (errorCode === "invalid_grant") {
      throw new Error("Google authorization expired or was revoked. Reconnect Google in Settings, then retry the write.");
    }
    throw new Error(
      `Failed to refresh Google OAuth token: HTTP ${response.status}${errorCode ? ` (${errorCode})` : ""}`,
    );
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Google OAuth refresh response missing access_token");
  }
  return { accessToken: data.access_token, expiresInSec: Number(data.expires_in) || 3600 };
}

type CachedToken = { accessToken: string; expiresAtMs: number };

// Keyed by the fetch implementation first, so tests that inject their own
// fetch never share tokens, and production (one global fetch) shares one.
const tokenCache = new WeakMap<FetchLike, Map<string, CachedToken>>();
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60_000;

function credentialKey(kind: string, parts: string[], scope: string): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return `${kind}:${scope}:${hash.digest("hex")}`;
}

async function cachedToken(
  fetchImpl: FetchLike,
  key: string,
  now: () => Date,
  issue: () => Promise<IssuedToken>,
): Promise<string> {
  let byKey = tokenCache.get(fetchImpl);
  if (!byKey) {
    byKey = new Map();
    tokenCache.set(fetchImpl, byKey);
  }
  const hit = byKey.get(key);
  if (hit && hit.expiresAtMs > now().getTime()) return hit.accessToken;
  const issued = await issue();
  byKey.set(key, {
    accessToken: issued.accessToken,
    expiresAtMs:
      now().getTime() + Math.max(0, issued.expiresInSec * 1000 - TOKEN_EXPIRY_MARGIN_MS),
  });
  return issued.accessToken;
}

/**
 * Resolve a Google Sheets access token from the worker's runtime config:
 *   1. runtimeConfig.googleAccessToken (a per-request token from the dashboard)
 *   2. service account JSON/file (JWT exchange, cached until near expiry)
 *   3. OAuth token JSON/file (the stored token while fresh, else a cached refresh)
 */
export async function resolveAccessToken(
  runtimeConfig: WorkerRuntimeConfig,
  fetchImpl: FetchLike,
  now: () => Date,
  tokenScope: string,
): Promise<string> {
  if (asText(runtimeConfig.googleAccessToken)) {
    return asText(runtimeConfig.googleAccessToken);
  }
  const serviceAccount = await readServiceAccountConfig(runtimeConfig);
  if (serviceAccount) {
    const key = credentialKey(
      "sa",
      [serviceAccount.client_email, serviceAccount.private_key, serviceAccount.token_uri || ""],
      tokenScope,
    );
    return cachedToken(fetchImpl, key, now, () =>
      exchangeServiceAccountToken(serviceAccount, tokenScope, fetchImpl, now),
    );
  }
  const oauthToken = await readOAuthTokenConfig(runtimeConfig);
  if (oauthToken) {
    if (hasFreshOAuthAccessToken(oauthToken, now)) return oauthToken.token;
    const key = credentialKey(
      "oauth",
      [oauthToken.refresh_token, oauthToken.client_id, oauthToken.token_uri],
      tokenScope,
    );
    return cachedToken(fetchImpl, key, now, () =>
      refreshOAuthAccessToken(oauthToken, fetchImpl),
    );
  }
  throw new Error(
    "No Google Sheets credential available. Set googleAccessToken, service-account JSON/file, or Google OAuth token JSON/file.",
  );
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export type RetryOptions = {
  /** Attempts after the first (default 2). */
  retries?: number;
  /** First backoff delay; doubles per attempt (default 400 ms). */
  retryBaseMs?: number;
};

export class SheetsHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "SheetsHttpError";
    this.status = status;
    this.body = body;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class GoogleTransportError extends Error {
  readonly code: string;
  readonly host: string;

  constructor(host: string, code: string, cause: unknown) {
    const service = host === "sheets.googleapis.com" ? "Google Sheets" : "Google token service";
    super(`Couldn't reach ${service} (${code}) at ${host}.`, { cause });
    this.name = "GoogleTransportError";
    this.code = code;
    this.host = host;
  }
}

function transportCode(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const raw = cause && typeof cause === "object" && "code" in cause
    ? String(cause.code) : "NETWORK_ERROR";
  return /^[A-Z][A-Z0-9_]{1,40}$/.test(raw) ? raw : "NETWORK_ERROR";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a request, retrying transient failures with backoff. Append callers
 * set retries=0 and re-read links before their next attempt.
 */
export async function sendWithRetry(
  fetchImpl: FetchLike,
  url: URL,
  init: RequestInit,
  retry: RetryOptions = {},
): Promise<Response> {
  const retries = Math.max(0, retry.retries ?? 2);
  const base = Math.max(0, retry.retryBaseMs ?? 400);
  let attempt = 0;
  for (;;) {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      const isNetworkError = error instanceof TypeError ||
        (error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause);
      if (!isNetworkError) throw error;
      if (attempt < retries) {
        await sleep(base * 2 ** attempt);
        attempt += 1;
        continue;
      }
      const failure = new GoogleTransportError(url.hostname, transportCode(error), error);
      console.error("[browser-use-discovery]", JSON.stringify({
        event: "discovery.google_fetch.failed", host: failure.host, code: failure.code,
      }));
      throw failure;
    }
    if (response.ok || !isRetryableStatus(response.status) || attempt >= retries) {
      return response;
    }
    await response.text().catch(() => "");
    await sleep(base * 2 ** attempt);
    attempt += 1;
  }
}

function authHeaders(token: string, json: boolean): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function normalizeValues(values: unknown): string[][] {
  return Array.isArray(values)
    ? values.map((row) => (Array.isArray(row) ? row.map((cell) => asText(cell)) : []))
    : [];
}

export async function getSheetValues(
  sheetId: string,
  range: string,
  token: string,
  fetchImpl: FetchLike,
  retry?: RetryOptions,
): Promise<string[][]> {
  const url = new URL(
    `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  const response = await sendWithRetry(
    fetchImpl,
    url,
    { headers: authHeaders(token, false) },
    retry,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SheetsHttpError(
      `Failed to read ${range}: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
      response.status,
      body,
    );
  }
  const data = (await response.json()) as { values?: unknown[][] };
  return normalizeValues(data.values);
}

export async function batchGetSheetValues(
  sheetId: string,
  ranges: string[],
  token: string,
  fetchImpl: FetchLike,
  retry?: RetryOptions,
): Promise<string[][][]> {
  if (!ranges.length) return [];
  const url = new URL(`${SHEETS_API}/${encodeURIComponent(sheetId)}/values:batchGet`);
  for (const range of ranges) url.searchParams.append("ranges", range);
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");
  const response = await sendWithRetry(
    fetchImpl,
    url,
    { headers: authHeaders(token, false) },
    retry,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SheetsHttpError(
      `Failed to read ${ranges.join(",")}: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
      response.status,
      body,
    );
  }
  const data = (await response.json()) as { valueRanges?: Array<{ values?: unknown[][] }> };
  const valueRanges = Array.isArray(data.valueRanges) ? data.valueRanges : [];
  return ranges.map((_, index) => normalizeValues(valueRanges[index]?.values));
}

/** values:batchUpdate with USER_ENTERED; every text cell is formula-escaped. */
export async function batchUpdateSheetValues(
  sheetId: string,
  data: Array<{ range: string; values: unknown[][] }>,
  token: string,
  fetchImpl: FetchLike,
  retry?: RetryOptions,
): Promise<Response> {
  const url = new URL(`${SHEETS_API}/${encodeURIComponent(sheetId)}/values:batchUpdate`);
  return sendWithRetry(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: authHeaders(token, true),
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: data.map((entry) => ({
          range: entry.range,
          majorDimension: "ROWS",
          values: escapeRows(entry.values),
        })),
      }),
    },
    retry,
  );
}

/**
 * Grow a tab's grid to at least `minColumns` columns. Sheets rejects a write
 * to a column past the tab's grid (e.g. Z1 on a 25-column grid) with HTTP
 * 400, so header upgrades call this before writing their widest column.
 * Only grows, never shrinks. Failures throw SheetsHttpError with the
 * response status and body.
 */
export async function ensureSheetGridColumns(params: {
  sheetId: string;
  sheetName: string;
  token: string;
  fetchImpl: FetchLike;
  minColumns: number;
  retry?: RetryOptions;
}): Promise<void> {
  const { sheetId, sheetName, token, fetchImpl, minColumns, retry } = params;
  const url = new URL(`${SHEETS_API}/${encodeURIComponent(sheetId)}`);
  url.searchParams.set(
    "fields",
    "sheets.properties.title,sheets.properties.sheetId,sheets.properties.gridProperties.columnCount",
  );
  const response = await sendWithRetry(
    fetchImpl,
    url,
    { headers: authHeaders(token, false) },
    retry,
  );
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    throw new SheetsHttpError(
      `Failed to read grid properties for ${sheetName}: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
      response.status,
      body,
    );
  }
  let sheets: Array<{
    properties?: { title?: string; sheetId?: number; gridProperties?: { columnCount?: number } };
  }> = [];
  try {
    const data = JSON.parse(body || "{}") as { sheets?: typeof sheets };
    sheets = Array.isArray(data.sheets) ? data.sheets : [];
  } catch {
    sheets = [];
  }
  const match = sheets.find((entry) => entry?.properties?.title === sheetName);
  const tabId = match?.properties?.sheetId;
  if (typeof tabId !== "number") {
    throw new SheetsHttpError(
      `Tab "${sheetName}" not found while ensuring grid width: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
      response.status,
      body,
    );
  }
  const columnCount = Number(match?.properties?.gridProperties?.columnCount) || 0;
  if (columnCount >= minColumns) return;
  const updateUrl = new URL(`${SHEETS_API}/${encodeURIComponent(sheetId)}:batchUpdate`);
  const updateResponse = await sendWithRetry(
    fetchImpl,
    updateUrl,
    {
      method: "POST",
      headers: authHeaders(token, true),
      body: JSON.stringify({
        requests: [
          {
            appendDimension: {
              sheetId: tabId,
              dimension: "COLUMNS",
              length: minColumns - columnCount,
            },
          },
        ],
      }),
    },
    retry,
  );
  if (!updateResponse.ok) {
    const updateBody = await updateResponse.text().catch(() => "");
    throw new SheetsHttpError(
      `Failed to grow ${sheetName} grid to ${minColumns} columns: HTTP ${updateResponse.status}${updateBody ? ` - ${updateBody}` : ""}`,
      updateResponse.status,
      updateBody,
    );
  }
}

/** values:append (INSERT_ROWS, USER_ENTERED); every text cell is formula-escaped. */
export async function appendSheetValues(
  sheetId: string,
  range: string,
  rows: unknown[][],
  token: string,
  fetchImpl: FetchLike,
  retry?: RetryOptions,
): Promise<Response> {
  const url = new URL(
    `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}:append`,
  );
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  url.searchParams.set("includeValuesInResponse", "false");
  return sendWithRetry(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: authHeaders(token, true),
      body: JSON.stringify({ majorDimension: "ROWS", values: escapeRows(rows) }),
    },
    retry,
  );
}

/* ------------------------------------------------------------------ */
/* Cell diffs                                                          */
/* ------------------------------------------------------------------ */

/**
 * Turn the cells that differ between `current` and `next` into one A1 range
 * per changed cell, so a write never touches a cell it did not mean to change.
 */
export function changedCellRanges(
  sheetName: string,
  rowNumber: number,
  current: string[],
  next: string[],
): Array<{ range: string; values: string[][] }> {
  const out: Array<{ range: string; values: string[][] }> = [];
  const width = Math.max(current.length, next.length);
  for (let index = 0; index < width; index += 1) {
    if ((current[index] || "") === (next[index] || "")) continue;
    out.push({
      range: `${sheetName}!${pipelineLetter(index)}${rowNumber}`,
      values: [[next[index] || ""]],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Link re-resolution                                                  */
/* ------------------------------------------------------------------ */

export type RowTarget = { rowNumber: number; link: string };

export type ResolvedRow =
  | { status: "found"; rowNumber: number; row: string[] }
  | { status: "missing" }
  | { status: "ambiguous"; rowNumbers: number[] };

function padRow(row: string[] | undefined): string[] {
  const out = Array.isArray(row) ? row.slice(0, PIPELINE_COLUMN_COUNT) : [];
  while (out.length < PIPELINE_COLUMN_COUNT) out.push("");
  return out;
}

/**
 * Re-read each target row in full and confirm its Link still matches. A row
 * whose Link changed (a sort, insert or delete since the snapshot) is found
 * again by Link; a Link that is gone or now appears twice is reported, never
 * guessed. `normalizeLink` must be the same normalizer the snapshot used.
 */
export async function resolveRowsByLink(params: {
  sheetId: string;
  sheetName: string;
  token: string;
  fetchImpl: FetchLike;
  targets: RowTarget[];
  normalizeLink: (value: string) => string;
  retry?: RetryOptions;
}): Promise<ResolvedRow[]> {
  const { sheetId, sheetName, token, fetchImpl, targets, normalizeLink, retry } = params;
  if (!targets.length) return [];
  const last = PIPELINE_LAST_COLUMN_LETTER;
  const fresh = await batchGetSheetValues(
    sheetId,
    targets.map((t) => `${sheetName}!A${t.rowNumber}:${last}${t.rowNumber}`),
    token,
    fetchImpl,
    retry,
  );
  const results: ResolvedRow[] = new Array(targets.length);
  const moved: number[] = [];
  targets.forEach((target, index) => {
    const row = padRow(fresh[index]?.[0]);
    if (normalizeLink(row[PIPELINE_COL.link]) === target.link) {
      results[index] = { status: "found", rowNumber: target.rowNumber, row };
    } else {
      moved.push(index);
    }
  });
  if (!moved.length) return results;

  const linkColumn = pipelineLetter(PIPELINE_COL.link);
  const links = await getSheetValues(
    sheetId,
    `${sheetName}!${linkColumn}2:${linkColumn}`,
    token,
    fetchImpl,
    retry,
  );
  const rowsByLink = new Map<string, number[]>();
  links.forEach((cells, offset) => {
    const link = normalizeLink(cells[0] || "");
    if (!link) return;
    const list = rowsByLink.get(link) || [];
    list.push(offset + 2);
    rowsByLink.set(link, list);
  });
  const refetch: Array<{ index: number; rowNumber: number }> = [];
  for (const index of moved) {
    const candidates = rowsByLink.get(targets[index].link) || [];
    if (candidates.length === 0) results[index] = { status: "missing" };
    else if (candidates.length > 1) results[index] = { status: "ambiguous", rowNumbers: candidates };
    else refetch.push({ index, rowNumber: candidates[0] });
  }
  if (refetch.length) {
    const rows = await batchGetSheetValues(
      sheetId,
      refetch.map((r) => `${sheetName}!A${r.rowNumber}:${last}${r.rowNumber}`),
      token,
      fetchImpl,
      retry,
    );
    refetch.forEach((entry, i) => {
      const row = padRow(rows[i]?.[0]);
      results[entry.index] =
        normalizeLink(row[PIPELINE_COL.link]) === targets[entry.index].link
          ? { status: "found", rowNumber: entry.rowNumber, row }
          : { status: "missing" };
    });
  }
  return results;
}

/** Read the Link column and return the set of normalized Links present now. */
export async function readPipelineLinks(params: {
  sheetId: string;
  sheetName: string;
  token: string;
  fetchImpl: FetchLike;
  normalizeLink: (value: string) => string;
  retry?: RetryOptions;
}): Promise<Set<string>> {
  const linkColumn = pipelineLetter(PIPELINE_COL.link);
  const rows = await getSheetValues(
    params.sheetId,
    `${params.sheetName}!${linkColumn}2:${linkColumn}`,
    params.token,
    params.fetchImpl,
    params.retry,
  );
  const out = new Set<string>();
  for (const cells of rows) {
    const link = params.normalizeLink(cells[0] || "");
    if (link) out.add(link);
  }
  return out;
}
