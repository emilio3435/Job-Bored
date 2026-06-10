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
 * Concurrency: capped at 3 in-flight LLM calls. Three concurrent requests
 * leaves headroom for short delays + retries without manual rate limiting on
 * common free-tier providers.
 *
 * SSE contract (consumed by fit-profile-backcompat.js):
 *   event: progress  data: { row, total, status, fitScore?, reason? }
 *   event: done      data: { rescored, skipped, failed, total }
 *   event: error     data: { message }
 */

import { createSign } from "node:crypto";
import { existsSync } from "node:fs";
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

const MAX_CONCURRENT_LLM = 3;
const LLM_MIN_GAP_MS = 250;
// Hard cap so a runaway sheet doesn't blow through the quota silently.
const MAX_ROWS = 500;

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-120b:free";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_LOCAL_MODEL = "gemma4:e2b";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

const PROVIDER_DEFINITIONS = Object.freeze({
  gemini: {
    displayName: "Gemini",
    defaultModel: DEFAULT_GEMINI_MODEL,
    requiresApiKey: true,
    apiKeyEnvVars: [
      "PROFILE_RESCORE_GEMINI_API_KEY",
      "ATS_GEMINI_API_KEY",
      "GEMINI_API_KEY",
      "BROWSER_USE_DISCOVERY_GEMINI_API_KEY",
    ],
    modelEnvVars: [
      "PROFILE_RESCORE_GEMINI_MODEL",
      "ATS_GEMINI_MODEL",
      "GEMINI_MODEL",
      "BROWSER_USE_DISCOVERY_GEMINI_MODEL",
    ],
  },
  openrouter: {
    displayName: "OpenRouter",
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    defaultBaseUrl: DEFAULT_OPENROUTER_BASE_URL,
    requiresApiKey: true,
    apiKeyEnvVars: [
      "PROFILE_RESCORE_OPENROUTER_API_KEY",
      "ATS_OPENROUTER_API_KEY",
      "OPENROUTER_API_KEY",
    ],
    modelEnvVars: [
      "PROFILE_RESCORE_OPENROUTER_MODEL",
      "ATS_OPENROUTER_MODEL",
      "OPENROUTER_MODEL",
    ],
    baseUrlEnvVars: [
      "PROFILE_RESCORE_OPENROUTER_BASE_URL",
      "ATS_OPENROUTER_BASE_URL",
      "OPENROUTER_BASE_URL",
    ],
  },
  local: {
    displayName: "local OpenAI-compatible",
    defaultModel: DEFAULT_LOCAL_MODEL,
    defaultBaseUrl: DEFAULT_LOCAL_BASE_URL,
    requiresApiKey: false,
    apiKeyEnvVars: [
      "PROFILE_RESCORE_LOCAL_API_KEY",
      "PROFILE_RESCORE_OPENAI_COMPATIBLE_API_KEY",
      "ATS_OPENAI_COMPATIBLE_API_KEY",
      "LOCAL_AI_API_KEY",
    ],
    modelEnvVars: [
      "PROFILE_RESCORE_LOCAL_MODEL",
      "PROFILE_RESCORE_OPENAI_COMPATIBLE_MODEL",
      "ATS_OPENAI_COMPATIBLE_MODEL",
      "LOCAL_AI_MODEL",
    ],
    baseUrlEnvVars: [
      "PROFILE_RESCORE_LOCAL_BASE_URL",
      "PROFILE_RESCORE_OPENAI_COMPATIBLE_BASE_URL",
      "ATS_OPENAI_COMPATIBLE_BASE_URL",
      "LOCAL_AI_BASE_URL",
    ],
  },
  openai_compatible: {
    displayName: "OpenAI-compatible",
    defaultModel: DEFAULT_LOCAL_MODEL,
    defaultBaseUrl: DEFAULT_LOCAL_BASE_URL,
    requiresApiKey: false,
    apiKeyEnvVars: [
      "PROFILE_RESCORE_LOCAL_API_KEY",
      "PROFILE_RESCORE_OPENAI_COMPATIBLE_API_KEY",
      "ATS_OPENAI_COMPATIBLE_API_KEY",
      "LOCAL_AI_API_KEY",
    ],
    modelEnvVars: [
      "PROFILE_RESCORE_LOCAL_MODEL",
      "PROFILE_RESCORE_OPENAI_COMPATIBLE_MODEL",
      "ATS_OPENAI_COMPATIBLE_MODEL",
      "LOCAL_AI_MODEL",
    ],
    baseUrlEnvVars: [
      "PROFILE_RESCORE_LOCAL_BASE_URL",
      "PROFILE_RESCORE_OPENAI_COMPATIBLE_BASE_URL",
      "ATS_OPENAI_COMPATIBLE_BASE_URL",
      "LOCAL_AI_BASE_URL",
    ],
  },
  openai: {
    displayName: "OpenAI",
    defaultModel: DEFAULT_OPENAI_MODEL,
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
    requiresApiKey: true,
    apiKeyEnvVars: [
      "PROFILE_RESCORE_OPENAI_API_KEY",
      "ATS_OPENAI_API_KEY",
      "OPENAI_API_KEY",
    ],
    modelEnvVars: [
      "PROFILE_RESCORE_OPENAI_MODEL",
      "ATS_OPENAI_MODEL",
      "OPENAI_MODEL",
    ],
    baseUrlEnvVars: [
      "PROFILE_RESCORE_OPENAI_BASE_URL",
      "ATS_OPENAI_BASE_URL",
      "OPENAI_BASE_URL",
    ],
  },
  anthropic: {
    displayName: "Anthropic",
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    defaultBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    requiresApiKey: true,
    apiKeyEnvVars: [
      "PROFILE_RESCORE_ANTHROPIC_API_KEY",
      "ATS_ANTHROPIC_API_KEY",
      "ANTHROPIC_API_KEY",
    ],
    modelEnvVars: [
      "PROFILE_RESCORE_ANTHROPIC_MODEL",
      "ATS_ANTHROPIC_MODEL",
      "ANTHROPIC_MODEL",
    ],
    baseUrlEnvVars: [
      "PROFILE_RESCORE_ANTHROPIC_BASE_URL",
      "ATS_ANTHROPIC_BASE_URL",
      "ANTHROPIC_BASE_URL",
    ],
  },
});

const SUPPORTED_CHAT_PROVIDERS = new Set(Object.keys(PROVIDER_DEFINITIONS));

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

/* ─── Chat provider config ─────────────────────────────────────────────── */

function firstNonEmpty(values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function firstEnv(env, names) {
  return firstNonEmpty(names.map((name) => env[name]));
}

function normalizeProviderName(value) {
  const raw = String(value || "gemini")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (raw === "openai_compatible" || raw === "openai_compat") {
    return "openai_compatible";
  }
  if (raw === "ollama") return "local";
  return raw || "gemini";
}

function getProviderDefinition(provider) {
  return PROVIDER_DEFINITIONS[provider] || null;
}

function providerDisplayName(provider) {
  const definition = getProviderDefinition(provider);
  if (definition) return definition.displayName;
  return provider || "LLM provider";
}

function stripTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function defaultModelForProvider(provider) {
  return getProviderDefinition(provider)?.defaultModel || "";
}

function defaultBaseUrlForProvider(provider) {
  return getProviderDefinition(provider)?.defaultBaseUrl || "";
}

function normalizeProfileRescoreProviderConfig(input = {}) {
  const provider = normalizeProviderName(input.provider);
  const apiKey = firstNonEmpty([
    input.apiKey,
    input.geminiApiKey,
    input.openRouterApiKey,
    input.openAIApiKey,
    input.anthropicApiKey,
  ]);
  const model =
    firstNonEmpty([input.model, input.geminiModel]) ||
    defaultModelForProvider(provider);
  const baseUrl = stripTrailingSlash(
    input.baseUrl || defaultBaseUrlForProvider(provider),
  );
  return {
    provider,
    apiKey,
    model,
    baseUrl,
    requiredEnvVars: Array.isArray(input.requiredEnvVars)
      ? input.requiredEnvVars.map(String)
      : [],
  };
}

export function getProfileRescoreProviderConfigFromEnv(env = process.env) {
  const provider = normalizeProviderName(
    firstEnv(env, [
      "PROFILE_RESCORE_PROVIDER",
      "JOBBORED_PROFILE_RESCORE_PROVIDER",
      "ATS_PROFILE_RESCORE_PROVIDER",
      "ATS_PROVIDER",
    ]) || "gemini",
  );
  const definition = getProviderDefinition(provider);
  if (!definition) return normalizeProfileRescoreProviderConfig({ provider });
  const requiredEnvVars = definition.requiresApiKey
    ? definition.apiKeyEnvVars
    : definition.baseUrlEnvVars || [];
  return normalizeProfileRescoreProviderConfig({
    provider,
    apiKey: firstEnv(env, definition.apiKeyEnvVars || []),
    model: firstEnv(env, definition.modelEnvVars || []) || definition.defaultModel,
    baseUrl:
      firstEnv(env, definition.baseUrlEnvVars || []) || definition.defaultBaseUrl,
    requiredEnvVars,
  });
}

export function getProfileRescoreProviderStatus(
  config = getProfileRescoreProviderConfigFromEnv(),
) {
  const cfg = normalizeProfileRescoreProviderConfig(config);
  const definition = getProviderDefinition(cfg.provider);
  if (!definition) {
    return {
      configured: false,
      provider: cfg.provider,
      reason: "unsupported_provider",
      detail: `Unsupported profile rescore provider "${cfg.provider}". Supported providers: ${[
        ...SUPPORTED_CHAT_PROVIDERS,
      ].join(", ")}.`,
    };
  }
  if (!cfg.model) {
    return {
      configured: false,
      provider: cfg.provider,
      reason: "missing_model",
      detail: `Missing ${providerDisplayName(cfg.provider)} model for profile rescore.`,
    };
  }
  if (
    (cfg.provider === "local" ||
      cfg.provider === "openai_compatible" ||
      cfg.provider === "openrouter" ||
      cfg.provider === "openai") &&
    !cfg.baseUrl
  ) {
    return {
      configured: false,
      provider: cfg.provider,
      reason: "missing_base_url",
      detail: `Missing ${providerDisplayName(cfg.provider)} base URL for profile rescore.`,
      requiredEnvVars: cfg.requiredEnvVars,
    };
  }
  if (definition.requiresApiKey && !cfg.apiKey) {
    const requiredEnvVars = cfg.requiredEnvVars.length
      ? cfg.requiredEnvVars
      : definition.apiKeyEnvVars;
    return {
      configured: false,
      provider: cfg.provider,
      reason: "missing_api_key",
      detail: `Missing ${providerDisplayName(
        cfg.provider,
      )} API key for profile rescore. Set one of: ${requiredEnvVars.join(", ")}.`,
      requiredEnvVars,
    };
  }
  return {
    configured: true,
    provider: cfg.provider,
    reason: "",
    detail: "",
  };
}

/* ─── Prompt + response handling (mirrors profile-aware-scorer.ts) ─────── */

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

function tryParseEmbeddedJson(raw) {
  for (let start = 0; start < raw.length; start += 1) {
    const opener = raw[start];
    if (opener !== "{" && opener !== "[") continue;
    const stack = [opener];
    let inString = false;
    let escaped = false;
    for (let i = start + 1; i < raw.length; i += 1) {
      const ch = raw[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{" || ch === "[") {
        stack.push(ch);
        continue;
      }
      if (ch !== "}" && ch !== "]") continue;
      const expected = stack[stack.length - 1];
      const matches =
        (expected === "{" && ch === "}") || (expected === "[" && ch === "]");
      if (!matches) break;
      stack.pop();
      if (stack.length) continue;
      try {
        return JSON.parse(raw.slice(start, i + 1).trim());
      } catch {
        break;
      }
    }
  }
  return undefined;
}

function parseJsonFromProviderText(text, providerLabel) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error(`${providerLabel} returned empty content`);
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(raw);
  const cleaned = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    if (!(cleaned.startsWith("{") || cleaned.startsWith("["))) {
      const embedded = tryParseEmbeddedJson(cleaned);
      if (embedded !== undefined) return embedded;
    }
    throw new Error(`${providerLabel} returned invalid JSON: ${err.message}`);
  }
}

function normalizeScoreResponse(parsed, providerLabel) {
  const rawScore =
    typeof parsed.fitScore === "number" ? parsed.fitScore : Number(parsed.fitScore);
  if (!Number.isFinite(rawScore)) {
    throw new Error(`${providerLabel} response missing numeric fitScore`);
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

function buildChatJsonSystemPrompt(profile) {
  return [
    buildSystemPrompt(profile),
    "",
    "Return ONLY a JSON object. Do not wrap it in markdown.",
    "JSON schema:",
    JSON.stringify(buildResponseSchema(profile)),
  ].join("\n");
}

async function scoreOneWithGemini({ profile, rawListing, geminiApiKey, geminiModel }) {
  const model = geminiModel || DEFAULT_GEMINI_MODEL;
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
  return normalizeScoreResponse(parseJsonFromProviderText(text, "Gemini"), "Gemini");
}

async function scoreOneWithChatCompletions({ profile, rawListing, providerConfig }) {
  const cfg = normalizeProfileRescoreProviderConfig(providerConfig);
  const label = providerDisplayName(cfg.provider);
  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: buildChatJsonSystemPrompt(profile) },
      { role: "user", content: buildUserPrompt(rawListing) },
    ],
    temperature: 0.2,
    max_tokens: 2048,
  };
  const headers = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`${label} HTTP ${resp.status}: ${errBody.slice(0, 240)}`);
  }
  const json = await resp.json().catch(() => null);
  const text = String(json?.choices?.[0]?.message?.content || "");
  return normalizeScoreResponse(parseJsonFromProviderText(text, label), label);
}

async function scoreOneWithAnthropic({ profile, rawListing, providerConfig }) {
  const cfg = normalizeProfileRescoreProviderConfig(providerConfig);
  const body = {
    model: cfg.model,
    max_tokens: 2048,
    temperature: 0.2,
    system: buildChatJsonSystemPrompt(profile),
    messages: [{ role: "user", content: buildUserPrompt(rawListing) }],
  };
  const resp = await fetch(`${cfg.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${resp.status}: ${errBody.slice(0, 240)}`);
  }
  const json = await resp.json().catch(() => null);
  const text = Array.isArray(json?.content)
    ? json.content
        .filter((part) => part && part.type === "text")
        .map((part) => part.text || "")
        .join("")
    : "";
  return normalizeScoreResponse(parseJsonFromProviderText(text, "Anthropic"), "Anthropic");
}

async function scoreOneWithProvider({ profile, rawListing, providerConfig }) {
  const cfg = normalizeProfileRescoreProviderConfig(providerConfig);
  if (cfg.provider === "gemini") {
    return scoreOneWithGemini({
      profile,
      rawListing,
      geminiApiKey: cfg.apiKey,
      geminiModel: cfg.model,
    });
  }
  if (cfg.provider === "anthropic") {
    return scoreOneWithAnthropic({ profile, rawListing, providerConfig: cfg });
  }
  return scoreOneWithChatCompletions({ profile, rawListing, providerConfig: cfg });
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
 * @param {object} [args.providerConfig] - selected chat provider config
 * @param {string} [args.geminiApiKey] - legacy Gemini API key
 * @param {string} [args.geminiModel] - legacy Gemini model
 * @param {string} [args.overrideToken] - explicit Sheets access token (for tests)
 * @param {boolean} [args.dryRun] - if true, returns the rescorable row count
 *                                  without calling an LLM or writing anything.
 * @param {(evt: object) => void} [args.onProgress] - per-row + terminal events
 * @param {AbortSignal} [args.signal] - early abort
 * @returns {Promise<{rescored:number, skipped:number, failed:number, total:number}>}
 */
export async function rescoreAllPipelineRows({
  profile,
  sheetId,
  providerConfig,
  geminiApiKey,
  geminiModel,
  overrideToken,
  dryRun = false,
  onProgress,
  signal,
  maxRows,
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

  const effectiveMax =
    Number.isInteger(maxRows) && maxRows > 0 ? Math.min(maxRows, MAX_ROWS) : MAX_ROWS;
  const counted = rows.slice(0, effectiveMax);
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

  const chatProviderConfig = normalizeProfileRescoreProviderConfig(
    providerConfig || {
      provider: "gemini",
      apiKey: geminiApiKey,
      model: geminiModel,
    },
  );
  const providerStatus = getProfileRescoreProviderStatus(chatProviderConfig);
  if (!providerStatus.configured) {
    throw new Error(`rescoreAllPipelineRows: ${providerStatus.detail}`);
  }

  let rescored = 0;
  let failed = 0;
  let lastCallEnd = 0;

  await runWithConcurrency(candidates, MAX_CONCURRENT_LLM, async ({ rowNumber, row }) => {
    if (signal && signal.aborted) {
      failed += 1;
      emit({ kind: "progress", row: rowNumber, status: "failed", reason: "aborted" });
      return;
    }
    // Soft global gap so we don't fire three calls in the same millisecond.
    const gap = Date.now() - lastCallEnd;
    if (gap < LLM_MIN_GAP_MS) {
      await new Promise((r) => setTimeout(r, LLM_MIN_GAP_MS - gap));
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
      const score = await scoreOneWithProvider({
        profile,
        rawListing,
        providerConfig: chatProviderConfig,
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
