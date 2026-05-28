/**
 * profile-rescore-worker.mjs — Task #9 Caveat 1.
 *
 * Walks every row in the user's Pipeline sheet that has a non-empty URL,
 * re-scores it against the current canonical UserProfile, and writes the
 * results back into the three Fit columns (H = Fit Score, K = Fit Assessment,
 * Q = Talking Points) plus column U (Match Score, mirrored from fitScore).
 *
 * Auth model: mirrors integrations/browser-use-discovery/src/sheets/pipeline-writer.ts.
 *   - googleAccessToken (in-process override, useful for tests)
 *   - service-account JSON file at integrations/.../service-account-key.json
 *     (or BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE env)
 * The local server has no Sheets credential resolver of its own, so the
 * worker-config + service-account file shared with the discovery worker is
 * the single source of truth.
 *
 * Concurrency: capped at 3 in-flight Gemini calls. With Gemini 2.x flash
 * quotas in the free tier sitting around 15 RPM, three concurrent requests
 * leaves headroom for short delays + retries without manual rate limiting.
 *
 * SSE contract (consumed by fit-profile-backcompat.js):
 *   event: progress  data: { row, total, status, fitScore?, reason? }
 *   event: done      data: { rescored, skipped, failed, total }
 *   event: error     data: { message }
 */

import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { scrapeJobPosting } from "./shared/job-scraper-core.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PIPELINE_SHEET_NAME = "Pipeline";
const HEADER_ROW_COUNT = 1;
// Read range covers every Pipeline column we know about (24 columns through X).
const READ_RANGE = `${PIPELINE_SHEET_NAME}!A2:X`;
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const MAX_CONCURRENT_GEMINI = 3;
const GEMINI_MIN_GAP_MS = 250;
// Hard cap so a runaway sheet doesn't blow through the quota silently.
const MAX_ROWS = 500;

// Column indices (0-based within the row array, matching PIPELINE_HEADER_ROW).
const COL = {
  TITLE: 1,
  COMPANY: 2,
  LOCATION: 3,
  LINK: 4,
  SALARY: 6,
  FIT_SCORE: 7, // H
  FIT_ASSESSMENT: 10, // K
  TALKING_POINTS: 16, // Q
  MATCH_SCORE: 20, // U
};

const SHEET_COLUMN_LETTER = {
  FIT_SCORE: "H",
  FIT_ASSESSMENT: "K",
  TALKING_POINTS: "Q",
  MATCH_SCORE: "U",
};

/* ─── Worker-config + service-account discovery ─────────────────────────── */

function resolveWorkerConfigPath() {
  // Honor explicit override first.
  const env = String(process.env.JOBBORED_WORKER_CONFIG_PATH || "").trim();
  if (env) {
    if (!isAbsolute(env)) {
      throw new Error(`JOBBORED_WORKER_CONFIG_PATH must be absolute (got "${env}")`);
    }
    return env;
  }
  // Default: integrations/browser-use-discovery/state/worker-config.json,
  // resolved relative to this server file (repo root sits two dirs up).
  return resolvePath(
    __dirname,
    "..",
    "integrations",
    "browser-use-discovery",
    "state",
    "worker-config.json",
  );
}

function expandTilde(p) {
  if (typeof p !== "string") return "";
  const trimmed = p.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function resolveServiceAccountPath() {
  const envInline = process.env.JOBBORED_GOOGLE_SERVICE_ACCOUNT_JSON;
  if (envInline && envInline.trim()) return { inlineJson: envInline.trim() };

  const envFile =
    expandTilde(process.env.JOBBORED_GOOGLE_SERVICE_ACCOUNT_FILE) ||
    expandTilde(process.env.BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE);
  if (envFile) return { filePath: envFile };

  // Default location alongside the worker.
  const guess = resolvePath(
    __dirname,
    "..",
    "integrations",
    "browser-use-discovery",
    "service-account-key.json",
  );
  return { filePath: guess };
}

export async function loadWorkerConfig() {
  const path = resolveWorkerConfigPath();
  if (!existsSync(path)) {
    const err = new Error(`worker-config.json not found at ${path}`);
    err.code = "WORKER_CONFIG_MISSING";
    throw err;
  }
  const raw = await readFile(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = new Error(`worker-config.json is not valid JSON: ${e.message}`);
    err.code = "WORKER_CONFIG_INVALID";
    throw err;
  }
  const sheetId = String(parsed && parsed.sheetId ? parsed.sheetId : "").trim();
  if (!sheetId) {
    const err = new Error("worker-config.json has no sheetId");
    err.code = "WORKER_CONFIG_NO_SHEET";
    throw err;
  }
  return { sheetId, raw: parsed, path };
}

/* ─── Google auth ────────────────────────────────────────────────────────── */

function toBase64Url(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseServiceAccount(rawJson) {
  const parsed = JSON.parse(rawJson);
  if (!parsed || !parsed.client_email || !parsed.private_key) {
    throw new Error("Service account JSON missing client_email / private_key");
  }
  return {
    client_email: String(parsed.client_email),
    private_key: String(parsed.private_key),
    token_uri: parsed.token_uri ? String(parsed.token_uri) : GOOGLE_TOKEN_URI,
  };
}

async function exchangeServiceAccountToken(serviceAccount, scope = SHEETS_SCOPE) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    scope,
    aud: serviceAccount.token_uri,
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

  const resp = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `Service account token exchange failed (HTTP ${resp.status})${body ? `: ${body.slice(0, 240)}` : ""}`,
    );
  }
  const data = await resp.json();
  if (!data || !data.access_token) {
    throw new Error("Service account token response missing access_token");
  }
  return String(data.access_token);
}

export async function resolveSheetsAccessToken({ overrideToken } = {}) {
  // Highest precedence: explicit per-call override (used in tests).
  if (overrideToken && String(overrideToken).trim()) {
    return String(overrideToken).trim();
  }
  const env = String(process.env.GOOGLE_ACCESS_TOKEN || "").trim();
  if (env) return env;

  const { inlineJson, filePath } = resolveServiceAccountPath();
  if (inlineJson) {
    return exchangeServiceAccountToken(parseServiceAccount(inlineJson));
  }
  if (filePath && existsSync(filePath)) {
    const text = await readFile(filePath, "utf8");
    return exchangeServiceAccountToken(parseServiceAccount(text));
  }
  const err = new Error(
    "No Google Sheets credential found. Set JOBBORED_GOOGLE_SERVICE_ACCOUNT_FILE or place a service-account-key.json next to the discovery worker.",
  );
  err.code = "NO_SHEETS_CREDENTIAL";
  throw err;
}

/* ─── Sheets read + write ────────────────────────────────────────────────── */

async function readPipelineRows(sheetId, token) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(READ_RANGE)}`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  url.searchParams.set("dateTimeRenderOption", "FORMATTED_STRING");

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Pipeline read failed: HTTP ${resp.status}${body ? ` — ${body.slice(0, 240)}` : ""}`);
  }
  const json = await resp.json();
  const values = Array.isArray(json && json.values) ? json.values : [];
  return values;
}

async function writeRowScoreCells({
  sheetId,
  token,
  rowNumber,
  fitScore,
  fitAssessment,
  talkingPoints,
}) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`,
  );
  const ranges = [
    {
      range: `${PIPELINE_SHEET_NAME}!${SHEET_COLUMN_LETTER.FIT_SCORE}${rowNumber}`,
      majorDimension: "ROWS",
      values: [[String(fitScore)]],
    },
    {
      range: `${PIPELINE_SHEET_NAME}!${SHEET_COLUMN_LETTER.FIT_ASSESSMENT}${rowNumber}`,
      majorDimension: "ROWS",
      values: [[fitAssessment]],
    },
    {
      range: `${PIPELINE_SHEET_NAME}!${SHEET_COLUMN_LETTER.TALKING_POINTS}${rowNumber}`,
      majorDimension: "ROWS",
      values: [[talkingPoints]],
    },
    {
      range: `${PIPELINE_SHEET_NAME}!${SHEET_COLUMN_LETTER.MATCH_SCORE}${rowNumber}`,
      majorDimension: "ROWS",
      values: [[String(fitScore)]],
    },
  ];
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: ranges,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Sheet write failed: HTTP ${resp.status}${body ? ` — ${body.slice(0, 240)}` : ""}`);
  }
}

/* ─── Gemini prompt + response handling (mirrors profile-aware-scorer.ts) ─ */

function buildSystemPrompt(profile) {
  const lines = [];
  lines.push("You are scoring how well a job listing matches the user below.");
  lines.push("");
  lines.push("WHO THE USER IS:");
  lines.push(String((profile.identity && profile.identity.primaryNarrative) || "").trim());
  lines.push("");
  lines.push("STRENGTHS (rank 1 = top, weighted highest):");
  const sortedStrengths = [...(profile.strengths || [])].sort(
    (a, b) => (a.rank ?? 99) - (b.rank ?? 99),
  );
  for (const s of sortedStrengths) {
    const kw =
      Array.isArray(s.keywords) && s.keywords.length
        ? ` [keywords: ${s.keywords.join(", ")}]`
        : "";
    const evidence = s.evidence ? ` — ${s.evidence}` : "";
    lines.push(`  ${s.rank}. ${s.name}${kw}${evidence}`);
  }
  if (Array.isArray(profile.wants) && profile.wants.length) {
    lines.push("");
    lines.push(`WANTS: ${profile.wants.join(" · ")}`);
  }
  if (Array.isArray(profile.avoids) && profile.avoids.length) {
    lines.push(`AVOIDS: ${profile.avoids.join(" · ")}`);
  }
  if (profile.tieBreakers) {
    const tb = profile.tieBreakers;
    const parts = [];
    if (tb.salaryTransparencyImportance)
      parts.push(`salary transparency=${tb.salaryTransparencyImportance}`);
    if (tb.companyCredibilityImportance)
      parts.push(`company credibility=${tb.companyCredibilityImportance}`);
    if (tb.applicationComplexityAversion)
      parts.push(`application complexity aversion=${tb.applicationComplexityAversion}`);
    if (parts.length) lines.push(`TIE BREAKERS: ${parts.join(" · ")}`);
  }
  lines.push("");
  lines.push(
    "Score the listing below. Return JSON matching the schema. Be honest — Low scores are valuable signal.",
  );
  return lines.join("\n");
}

function buildUserPrompt(rawListing) {
  const desc = String(rawListing.descriptionText || "").slice(0, 6000);
  return [
    `${rawListing.title} at ${rawListing.company}`,
    `Location: ${rawListing.location || "n/a"}`,
    `Comp: ${rawListing.compensationText || "n/a"}`,
    "",
    "Description:",
    desc,
  ].join("\n");
}

function buildResponseSchema(profile) {
  const strengthNames = [...(profile.strengths || [])]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .map((s) => String(s.name || ""));
  return {
    type: "object",
    required: ["fitScore", "band", "perStrength", "concerns", "matches", "rationale"],
    properties: {
      fitScore: { type: "integer", minimum: 1, maximum: 10 },
      band: { type: "string", enum: ["Exceptional", "Strong", "Interesting", "Low"] },
      perStrength: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "score", "rationale"],
          properties: {
            name: {
              type: "string",
              enum: strengthNames.length ? strengthNames : ["_"],
            },
            score: { type: "integer", minimum: 0, maximum: 10 },
            rationale: { type: "string" },
          },
        },
      },
      concerns: { type: "array", items: { type: "string" } },
      matches: { type: "array", items: { type: "string" } },
      rationale: { type: "string" },
      leadAngle: { type: "string" },
    },
  };
}

function deriveBand(score) {
  if (score >= 9) return "Exceptional";
  if (score >= 8) return "Strong";
  if (score >= 7) return "Interesting";
  return "Low";
}

function extractGeminiText(payload) {
  if (!payload || typeof payload !== "object") return "";
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .join("");
}

async function scoreOneWithGemini({ profile, rawListing, geminiApiKey, geminiModel }) {
  const model = geminiModel || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: buildSystemPrompt(profile) }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(rawListing) }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(profile),
    },
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Gemini HTTP ${resp.status}: ${errBody.slice(0, 240)}`);
  }
  const json = await resp.json().catch(() => null);
  const text = extractGeminiText(json);
  if (!text) throw new Error("Gemini returned empty content");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Gemini returned invalid JSON: ${e.message}`);
  }
  const rawScore =
    typeof parsed.fitScore === "number" ? parsed.fitScore : Number(parsed.fitScore);
  if (!Number.isFinite(rawScore)) {
    throw new Error("Gemini response missing numeric fitScore");
  }
  const fitScore = Math.max(1, Math.min(10, Math.round(rawScore)));
  const band = deriveBand(fitScore);
  return {
    fitScore,
    band,
    perStrength: Array.isArray(parsed.perStrength) ? parsed.perStrength : [],
    concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter(Boolean) : [],
    matches: Array.isArray(parsed.matches) ? parsed.matches.filter(Boolean) : [],
    rationale: String(parsed.rationale || ""),
    leadAngle:
      typeof parsed.leadAngle === "string" && parsed.leadAngle.trim()
        ? parsed.leadAngle.trim()
        : "",
  };
}

/* ─── Per-row pipeline: build RawListing → score → format cells ──────────── */

function buildRawListingFromRow(row) {
  return {
    sourceId: "rescore",
    sourceLabel: "Rescore",
    title: String(row[COL.TITLE] || "").trim(),
    company: String(row[COL.COMPANY] || "").trim(),
    location: String(row[COL.LOCATION] || "").trim(),
    url: String(row[COL.LINK] || "").trim(),
    compensationText: String(row[COL.SALARY] || "").trim(),
    descriptionText: "",
  };
}

async function maybeFetchDescription(rawListing) {
  // Many Pipeline rows arrive from extraction without description text stashed
  // back in the sheet. For rescore we try a best-effort re-scrape; failure is
  // not fatal — we just score with what we have (title + company + comp).
  if (rawListing.descriptionText && rawListing.descriptionText.length > 200) {
    return rawListing.descriptionText;
  }
  try {
    const scraped = await scrapeJobPosting(rawListing.url, {
      title: rawListing.title,
      company: rawListing.company,
    });
    const text = String((scraped && (scraped.description || scraped.bodyText)) || "").trim();
    return text;
  } catch (_err) {
    return "";
  }
}

function buildFitAssessment(score, applicationComplexity) {
  const lines = [
    `${score.band} fit (${score.fitScore}/10) · ${applicationComplexity || "single"}-step apply`,
  ];
  if (score.matches && score.matches.length) {
    lines.push(`Matches: ${score.matches.slice(0, 4).join(" · ")}`);
  }
  if (score.concerns && score.concerns.length) {
    lines.push(`Concerns: ${score.concerns.slice(0, 3).join(" · ")}`);
  }
  if (score.rationale) lines.push(score.rationale);
  return lines.join("\n");
}

function buildTalkingPoints(score) {
  if (score.leadAngle) return score.leadAngle;
  if (Array.isArray(score.perStrength) && score.perStrength.length) {
    return score.perStrength
      .filter((p) => p && p.rationale)
      .slice(0, 3)
      .map((p) => `• ${p.name}: ${p.rationale}`)
      .join("\n");
  }
  return "";
}

/* ─── Concurrency + worker loop ─────────────────────────────────────────── */

async function runWithConcurrency(items, concurrency, onItem) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.max(1, concurrency) }, () =>
    (async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) return;
        await onItem(item);
      }
    })(),
  );
  await Promise.all(workers);
}

function classifyRowForRescore(row) {
  const url = String(row[COL.LINK] || "").trim();
  if (!url) return { kind: "skip", reason: "no_url" };
  const title = String(row[COL.TITLE] || "").trim();
  const company = String(row[COL.COMPANY] || "").trim();
  if (!title && !company) return { kind: "skip", reason: "blank_row" };
  return { kind: "rescore", url };
}

/* ─── Public entry point ───────────────────────────────────────────────── */

/**
 * Walk the Pipeline sheet and rescore every row with a URL.
 *
 * @param {object} args
 * @param {object} args.profile - the canonical UserProfile JSON
 * @param {string} args.sheetId - target Google Sheet ID
 * @param {string} args.geminiApiKey - Gemini API key
 * @param {string} [args.geminiModel] - Gemini model (default gemini-3.5-flash)
 * @param {string} [args.overrideToken] - explicit Sheets access token (for tests)
 * @param {boolean} [args.dryRun] - if true, returns the rescorable row count
 *                                  without calling Gemini or writing anything.
 * @param {(evt: object) => void} [args.onProgress] - per-row + terminal events
 * @param {AbortSignal} [args.signal] - early abort
 * @returns {Promise<{rescored:number, skipped:number, failed:number, total:number}>}
 */
export async function rescoreAllPipelineRows({
  profile,
  sheetId,
  geminiApiKey,
  geminiModel,
  overrideToken,
  dryRun = false,
  onProgress,
  signal,
}) {
  if (!profile || typeof profile !== "object") {
    throw new Error("rescoreAllPipelineRows: profile is required");
  }
  if (!sheetId) {
    throw new Error("rescoreAllPipelineRows: sheetId is required");
  }
  const emit = (evt) => {
    if (typeof onProgress === "function") {
      try {
        onProgress(evt);
      } catch (_e) {
        /* swallow consumer errors so SSE keeps flowing */
      }
    }
  };

  const token = await resolveSheetsAccessToken({ overrideToken });
  const rows = await readPipelineRows(sheetId, token);

  const counted = rows.slice(0, MAX_ROWS);
  const candidates = [];
  let skipped = 0;
  for (let i = 0; i < counted.length; i += 1) {
    const cls = classifyRowForRescore(counted[i]);
    const rowNumber = i + HEADER_ROW_COUNT + 1; // header is row 1; data starts row 2
    if (cls.kind === "rescore") {
      candidates.push({ rowNumber, row: counted[i] });
    } else {
      skipped += 1;
      emit({
        kind: "progress",
        row: rowNumber,
        status: "skipped",
        reason: cls.reason,
      });
    }
  }

  if (dryRun) {
    const result = {
      rescored: 0,
      skipped,
      failed: 0,
      total: candidates.length,
      dryRun: true,
    };
    emit({ kind: "done", ...result });
    return result;
  }

  if (!geminiApiKey || !String(geminiApiKey).trim()) {
    throw new Error("rescoreAllPipelineRows: geminiApiKey is required for non-dryRun");
  }

  let rescored = 0;
  let failed = 0;
  let lastCallEnd = 0;

  await runWithConcurrency(candidates, MAX_CONCURRENT_GEMINI, async ({ rowNumber, row }) => {
    if (signal && signal.aborted) {
      failed += 1;
      emit({ kind: "progress", row: rowNumber, status: "failed", reason: "aborted" });
      return;
    }
    // Soft global gap so we don't fire three calls in the same millisecond.
    const gap = Date.now() - lastCallEnd;
    if (gap < GEMINI_MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, GEMINI_MIN_GAP_MS - gap));
    }

    try {
      const rawListing = buildRawListingFromRow(row);
      rawListing.descriptionText = await maybeFetchDescription(rawListing);
      if (!rawListing.descriptionText) {
        // Score with what we have. Title + company alone yields signal but
        // typically a "Low" band — that's still useful + honest.
        emit({
          kind: "progress",
          row: rowNumber,
          status: "no_description",
        });
      }
      const score = await scoreOneWithGemini({
        profile,
        rawListing,
        geminiApiKey,
        geminiModel,
      });
      await writeRowScoreCells({
        sheetId,
        token,
        rowNumber,
        fitScore: score.fitScore,
        fitAssessment: buildFitAssessment(score, ""),
        talkingPoints: buildTalkingPoints(score),
      });
      rescored += 1;
      emit({
        kind: "progress",
        row: rowNumber,
        status: "rescored",
        fitScore: score.fitScore,
        band: score.band,
      });
    } catch (err) {
      failed += 1;
      emit({
        kind: "progress",
        row: rowNumber,
        status: "failed",
        reason: String(err && err.message ? err.message : err),
      });
    } finally {
      lastCallEnd = Date.now();
    }
  });

  const result = { rescored, skipped, failed, total: candidates.length };
  emit({ kind: "done", ...result });
  return result;
}

/* ─── Exported helpers (for tests) ─────────────────────────────────────── */

export const _internal = {
  classifyRowForRescore,
  buildSystemPrompt,
  buildUserPrompt,
  buildResponseSchema,
  deriveBand,
  buildFitAssessment,
  buildTalkingPoints,
  COL,
};
