import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { WorkerRuntimeConfig } from "../config.ts";
import {
  PIPELINE_HEADER_ROW,
  type NormalizedLead,
  type PipelineWriteResult,
} from "../contracts.ts";
import { dedupeFingerprintListings } from "../discovery/listing-fingerprint.ts";
import { normalizeLeadUrl } from "../normalize/lead-normalizer.ts";

/**
 * Error thrown when a Sheet write operation fails.
 * Carries phase attribution so callers can distinguish update vs append failures.
 */
export class SheetWriteError extends Error {
  readonly phase: "update" | "append";
  readonly sheetId: string;
  readonly httpStatus?: number;
  readonly detail?: string;

  constructor(params: {
    phase: "update" | "append";
    message: string;
    sheetId: string;
    httpStatus?: number;
    detail?: string;
  }) {
    super(params.message);
    this.name = "SheetWriteError";
    this.phase = params.phase;
    this.sheetId = params.sheetId;
    this.httpStatus = params.httpStatus;
    this.detail = params.detail;
  }
}

type FetchLike = typeof fetch;

type SheetValuesResponse = {
  values?: unknown[][];
};

type PipelineWriterOptions = {
  fetchImpl?: FetchLike;
  now?: () => Date;
  sheetName?: string;
  tokenScope?: string;
};

export type PipelineWriter = {
  write(sheetId: string, leads: NormalizedLead[]): Promise<PipelineWriteResult>;
};

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

const DEFAULT_SHEET_NAME = "Pipeline";
const DEFAULT_TOKEN_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const COLUMN_COUNT = PIPELINE_HEADER_ROW.length;
const REQUIRED_HEADER_COUNT = 17;
// Last A1-notation column letter covering every column in PIPELINE_HEADER_ROW.
// Derived from COLUMN_COUNT so when the header row grows (Match Score added as
// the 21st column in commit b95e093), range strings A1:..., A2:..., and A:...
// automatically widen. Previously these were hard-coded to "T" (20 cols),
// which caused HTTP 400 "tried writing to column [U]" once Match Score leads
// started flowing through.
const LAST_COLUMN_LETTER = columnIndexToLetter(COLUMN_COUNT);

function columnIndexToLetter(index: number): string {
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

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRowCells(row: unknown[]): string[] {
  return Array.from({ length: COLUMN_COUNT }, (_, index) => asText(row[index]));
}

function inspectHeaderRow(values: unknown[][]): {
  header: string[];
  needsUpgrade: boolean;
} {
  const header = toRowCells(values[0] || []);
  const expected = PIPELINE_HEADER_ROW.map((value) => value.trim());
  const mismatchIndex = expected.findIndex((value, index) => {
    const found = header[index] || "";
    if (index < REQUIRED_HEADER_COUNT) {
      return found !== value;
    }
    return found !== "" && found !== value;
  });
  if (mismatchIndex !== -1) {
    const found = header.join(" | ");
    const want = expected.join(" | ");
    throw new Error(
      `Pipeline header mismatch. Expected ${want}; got ${found || "<empty>"}`,
    );
  }
  return {
    header,
    needsUpgrade: expected.some(
      (value, index) =>
        index >= REQUIRED_HEADER_COUNT && (header[index] || "") !== value,
    ),
  };
}

function normalizeRowLink(row: string[]): string {
  return normalizeLeadUrl(row[4] || "");
}

function clampScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return "";
  return String(Math.min(10, Math.max(1, Math.round(score))));
}

function buildLeadRow(lead: NormalizedLead, now: Date): string[] {
  const dateFound = lead.discoveredAt
    ? String(lead.discoveredAt).slice(0, 10)
    : now.toISOString().slice(0, 10);
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
  ];
}

function mergeExistingRow(existingRow: string[], leadRow: string[]): string[] {
  const merged = existingRow.slice(0, COLUMN_COUNT);
  while (merged.length < COLUMN_COUNT) merged.push("");

  for (let index = 0; index < COLUMN_COUNT; index += 1) {
    if (
      index === 11 ||
      index === 12 ||
      index === 13 ||
      index === 14 ||
      index === 15 ||
      index === 17 ||
      index === 18
    ) {
      continue;
    }
    if (leadRow[index]) merged[index] = leadRow[index];
  }

  if (!merged[11]) merged[11] = leadRow[11];
  if (!merged[12]) merged[12] = leadRow[12] || "New";
  if (!merged[16]) merged[16] = leadRow[16];
  return merged;
}

function buildHeaders(token: string, isJson = true): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(isJson ? { "Content-Type": "application/json" } : {}),
  };
}

function encodeRange(range: string): string {
  return encodeURIComponent(range);
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseServiceAccount(rawJson: string): GoogleServiceAccount {
  const parsed = JSON.parse(rawJson) as Partial<GoogleServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "Service account JSON must include client_email and private_key",
    );
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
  const fileText = await readFile(filePath, "utf8");
  return parseServiceAccount(fileText);
}

async function readOAuthTokenConfig(
  runtimeConfig: WorkerRuntimeConfig,
): Promise<GoogleOAuthToken | null> {
  const inline = asText(runtimeConfig.googleOAuthTokenJson);
  if (inline) return parseOAuthToken(inline);

  const filePath = asText(runtimeConfig.googleOAuthTokenFile);
  if (!filePath) return null;
  const fileText = await readFile(filePath, "utf8");
  return parseOAuthToken(fileText);
}

async function exchangeServiceAccountToken(
  serviceAccount: GoogleServiceAccount,
  tokenScope: string,
  fetchImpl: FetchLike,
  now: () => Date,
): Promise<string> {
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
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${signature
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;

  const response = await fetchImpl(
    serviceAccount.token_uri || GOOGLE_TOKEN_URI,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to exchange service account token: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Service account token response missing access_token");
  }
  return data.access_token;
}

function hasFreshOAuthAccessToken(
  tokenConfig: GoogleOAuthToken,
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
): Promise<string> {
  if (
    !tokenConfig.refresh_token ||
    !tokenConfig.client_id ||
    !tokenConfig.client_secret
  ) {
    throw new Error(
      "Google OAuth token JSON must include refresh_token, client_id, and client_secret when the cached access token is expired.",
    );
  }

  const response = await fetchImpl(tokenConfig.token_uri || GOOGLE_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenConfig.refresh_token,
      client_id: tokenConfig.client_id,
      client_secret: tokenConfig.client_secret,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to refresh Google OAuth token: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google OAuth refresh response missing access_token");
  }
  return data.access_token;
}

async function resolveAccessToken(
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
    return exchangeServiceAccountToken(
      serviceAccount,
      tokenScope,
      fetchImpl,
      now,
    );
  }

  const oauthToken = await readOAuthTokenConfig(runtimeConfig);
  if (oauthToken) {
    if (hasFreshOAuthAccessToken(oauthToken, now)) {
      return oauthToken.token;
    }
    return refreshOAuthAccessToken(oauthToken, fetchImpl);
  }

  throw new Error(
    "No Google Sheets credential available. Set googleAccessToken, service-account JSON/file, or Google OAuth token JSON/file.",
  );
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

async function batchUpdateRows(
  sheetId: string,
  rowUpdates: Array<{ rowNumber: number; values: string[] }>,
  token: string,
  fetchImpl: FetchLike,
  sheetName: string,
): Promise<void> {
  if (!rowUpdates.length) return;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`,
  );
  const response = await fetchImpl(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: rowUpdates.map((entry) => ({
        range: `${sheetName}!A${entry.rowNumber}:${LAST_COLUMN_LETTER}${entry.rowNumber}`,
        majorDimension: "ROWS",
        values: [entry.values],
      })),
    }),
  });
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

async function appendRows(
  sheetId: string,
  rows: string[][],
  token: string,
  fetchImpl: FetchLike,
  sheetName: string,
): Promise<void> {
  if (!rows.length) return;
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeRange(`${sheetName}!A:${LAST_COLUMN_LETTER}`)}:append`,
  );
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  url.searchParams.set("includeValuesInResponse", "false");

  const response = await fetchImpl(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({
      majorDimension: "ROWS",
      values: rows,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SheetWriteError({
      phase: "append",
      message: `Sheet write failed during append phase: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
      sheetId,
      httpStatus: response.status,
      detail: body || undefined,
    });
  }
}

async function ensurePipelineHeaderRow(
  sheetId: string,
  token: string,
  fetchImpl: FetchLike,
  sheetName: string,
  values: unknown[][],
): Promise<void> {
  const headerState = inspectHeaderRow(values);
  if (!headerState.needsUpgrade) return;
  await batchUpdateRows(
    sheetId,
    [{ rowNumber: 1, values: [...PIPELINE_HEADER_ROW] }],
    token,
    fetchImpl,
    sheetName,
  );
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
    const headerValues = await getSheetValues(
      sheetId,
      `${sheetName}!A1:${LAST_COLUMN_LETTER}1`,
      accessToken,
      fetchImpl,
    );
    await ensurePipelineHeaderRow(
      sheetId,
      accessToken,
      fetchImpl,
      sheetName,
      headerValues,
    );

    const existingRows = await getSheetValues(
      sheetId,
      `${sheetName}!A2:${LAST_COLUMN_LETTER}`,
      accessToken,
      fetchImpl,
    );
    const existingByLink = new Map<
      string,
      { rowNumber: number; row: string[] }
    >();
    let existingDuplicateCount = 0;

    existingRows.forEach((row, index) => {
      const cells = toRowCells(row);
      const link = normalizeRowLink(cells);
      if (!link) return;
      const rowNumber = index + 2;
      if (existingByLink.has(link)) {
        existingDuplicateCount += 1;
        return;
      }
      existingByLink.set(link, { rowNumber, row: cells });
    });

    const deduped = dedupeIncomingLeads(leads);
    const uniqueLeads = deduped.leads;
    const updates: Array<{ rowNumber: number; values: string[] }> = [];
    const appends: string[][] = [];
    let updated = 0;
    let appended = 0;
    let skippedDuplicates = deduped.skippedDuplicates;

    for (const lead of uniqueLeads) {
      const leadRow = buildLeadRow(lead, now());
      const link = leadRow[4];
      if (!link) continue;
      const match = existingByLink.get(link);
      if (match) {
        updates.push({
          rowNumber: match.rowNumber,
          values: mergeExistingRow(match.row, leadRow),
        });
        updated += 1;
        continue;
      }
      appends.push(leadRow);
      appended += 1;
    }

    await batchUpdateRows(sheetId, updates, accessToken, fetchImpl, sheetName);
    await appendRows(sheetId, appends, accessToken, fetchImpl, sheetName);

    return {
      sheetId,
      appended,
      updated,
      skippedDuplicates: skippedDuplicates + existingDuplicateCount,
      skippedBlacklist: 0,
      warnings: existingDuplicateCount
        ? [
            `Found ${existingDuplicateCount} duplicate existing Pipeline rows for normalized Link values.`,
          ]
        : [],
    };
  }

  return { write };
}

export type { PipelineWriterOptions };
