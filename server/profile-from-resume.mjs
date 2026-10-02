/**
 * profile-from-resume.mjs
 *
 * Reads stored resume text, calls the configured profile AI provider,
 * returns a UserProfile JSON (does NOT save it — user reviews in the wizard).
 *
 * Wired into POST /profile/from-resume in server/index.mjs.
 *
 * Parsing is read-only (JOBQA). Request-body `resumeText` (browser-staged)
 * is analyzed as a preview and written nowhere: onboarding saves the resume
 * once, on its explicit commit (server/profile-commit.mjs), and the editors
 * save it through PUT /profile/resume. A garbled staged text is refused
 * rather than swapped for a stored resume, so a preview can never analyze
 * someone else's saved resume. The stored locations below are read only
 * when a request explicitly asks for `source: "saved"`.
 *
 * Storage locations checked (priority order — first hit wins):
 *   1. ~/.jobbored/resume.txt (F11: the canonical stored resume)
 *   2. The discovery worker's `worker-config.json` at
 *      `candidateProfile.resumeText`. Path resolved via:
 *        - BROWSER_USE_DISCOVERY_CONFIG_PATH
 *        - DISCOVERY_WORKER_CONFIG_PATH
 *        - DISCOVERY_CONFIG_PATH
 *        - default: <repo>/integrations/browser-use-discovery/state/worker-config.json
 *   3. ~/.hermes/job-hunt/profile/resume*.md (legacy)
 *
 * Provider config comes from the REQUEST BODY first (the provider the
 * browser verified on Beat 2 — SIXBEATS2-SPEC locked decision 3), then from
 * PROFILE_* env vars, then ATS_* aliases where those exist. Gemini remains
 * the default provider for compatibility, but it is no longer what a fresh
 * install falls into after connecting something else.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadLlmConfig,
  migrateLlmConfigFromEnv,
  resolveActivePin,
} from "./llm-config.mjs";
import { normalizeProvider as sharedNormalizeProvider, routeDeadlineSignal } from "./ai/provider.mjs";
import { normalizeGeminiFlashPreference } from "./model-family.mjs";
import { outputBudget, geminiThinkingConfig, outputLimitField } from "./llm-output-budget.mjs";
import { experiencesFromStructure } from "./materials-resume-structure.mjs";
import { structureResumeWithModel } from "./materials-resume-structure-model.mjs";
import { detectGarbledResume, readCanonicalResume, resumeGarbledError } from "./materials-resume-source.mjs";
import { buildResumeRead, resumeTextSha256, saveResumeRead } from "./resume-read.mjs";
import { isProviderUrlBlocked, providerFetch } from "./provider-url-guard.mjs";
import { redactSecrets } from "./security-boundaries.mjs";

// Drafting prompt, parser, and clamp live in the sibling shared module
// (./profile-draft-shared.js), consumed here AND by the browser for B3's
// serverless fallback — one source, no drift. The shared file publishes a
// global namespace (classic-script compatible), so this is a side-effect
// import; the destructure below binds the module-scope names the rest of
// this file (and __test) already uses. The module lives INSIDE server/
// deliberately: the Dockerfile context (and the E5 boot test) copies only
// server/, so a repo-root share would break the image.
import "./profile-draft-shared.js";

/**
 * @typedef {object} ProfileDraftShared
 * @property {string} SYSTEM_PROMPT
 * @property {number} MAX_RESUME_INPUT_CHARS
 * @property {(resumeText: string) => string} buildUserPrompt
 * @property {(text: unknown) => any} parseJsonSafe
 * @property {(raw: unknown) => NormalizedUserProfile} clampToUserProfile
 * @property {(raw: unknown) => Record<string, unknown> | null} resumeFactsOf
 */
/** @type {ProfileDraftShared} */
const profileDraftShared = /** @type {any} */ (globalThis).JobBoredProfileDraft;
const {
  SYSTEM_PROMPT,
  resumeFactsOf,
  MAX_RESUME_INPUT_CHARS,
  buildUserPrompt,
  parseJsonSafe,
  clampToUserProfile,
} = profileDraftShared;

const __dirname = dirname(fileURLToPath(import.meta.url));

// Repo-relative fallback that matches the discovery worker's own default.
const DEFAULT_WORKER_CONFIG_PATH = resolvePath(
  __dirname,
  "..",
  "integrations",
  "browser-use-discovery",
  "state",
  "worker-config.json",
);

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-120b:free";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_LOCAL_MODEL = "gemma4:e2b";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";
export const MAX_PROFILE_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PROFILE_DOCUMENT_BASE64_CHARS = Math.ceil(MAX_PROFILE_DOCUMENT_BYTES / 3) * 4;
// Covers a maximum extracted-text prompt (including JSON escaping) and the
// small provider/document envelope alongside the base64 file payload.
export const MAX_PROFILE_FROM_RESUME_BODY_BYTES =
  MAX_PROFILE_DOCUMENT_BASE64_CHARS + MAX_RESUME_INPUT_CHARS * 6 + 16 * 1024;
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PROFILE_DOCUMENT_TOO_LARGE_MESSAGE =
  "This file is over the 10 MB limit. Choose a smaller file or paste the text instead.";
const PROFILE_DOCUMENT_INVALID_MESSAGE = "Choose a readable PDF or DOCX file and try again.";

/** @typedef {"gemini" | "anthropic" | "openrouter" | "openai" | "openai_compatible" | "local"} ProfileProvider */
/**
 * `origin` says who supplied the config, and only the error copy cares:
 * a "server" config was set by the operator, who benefits from being told
 * which env var to set; a "request" config came from the browser, whose
 * user has never seen an env var in their life (SIXBEATS-2 NEW-2).
 * @typedef {{ provider: ProfileProvider, apiKey: string, model: string, baseUrl: string, origin?: "server" | "request" }} ProfileProviderConfig
 */
/** @typedef {{ model?: string, config?: ProfileProviderConfig, signal?: AbortSignal, retriedTruncation?: boolean, document?: { mimeType: string, filename?: string, data: string }, fetchImpl?: typeof globalThis.fetch, structureCallStage?: (input: Record<string, unknown>) => Promise<unknown> | unknown }} ProfileCallOptions */
/** @typedef {Error & { code: string, provider?: ProfileProvider, upstreamStatus?: number, rawSample?: string, cause?: unknown }} ProfileProviderError */
/** @typedef {{ name: string, rank: number, evidence?: string, keywords?: string[] }} ProfileStrength */
/**
 * @typedef {object} NormalizedUserProfile
 * @property {number} version
 * @property {string} starterTemplate
 * @property {{ targetRoles: string[], targetSeniority: string, primaryNarrative: string, yearsRelevantExperience?: number }} identity
 * @property {ProfileStrength[]} strengths
 * @property {{ workMode: string, salaryRequired?: boolean, workAuth?: string, acceptableLocations?: string[], skipTitles?: string[] }} hardConstraints
 * @property {string[]} [wants]
 * @property {string[]} [avoids]
 * @property {Array<Record<string, unknown>>} [experiences] employers, titles and dates interpreted from the resume
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/* ─── Storage lookup ───────────────────────────────────────────────────── */

function resolveWorkerConfigPath() {
  const fromEnv =
    process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH ||
    process.env.DISCOVERY_WORKER_CONFIG_PATH ||
    process.env.DISCOVERY_CONFIG_PATH ||
    "";
  const raw = String(fromEnv || "").trim();
  if (raw) {
    return isAbsolute(raw) ? raw : resolvePath(process.cwd(), raw);
  }
  return DEFAULT_WORKER_CONFIG_PATH;
}

async function readResumeFromWorkerConfig() {
  const path = resolveWorkerConfigPath();
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // The worker may serialize config at top level OR nested under `config` /
  // `default` / `workerConfig` (see config.ts:1077). Cover all four.
  const root =
    (parsed && typeof parsed === "object" && (parsed.config || parsed.default || parsed.workerConfig || parsed)) ||
    {};
  const candidate =
    root && typeof root === "object" && root.candidateProfile
      ? root.candidateProfile
      : null;
  const text =
    candidate && typeof candidate.resumeText === "string"
      ? candidate.resumeText.trim()
      : "";
  if (!text) return null;
  return { text, source: "worker_config", path };
}

/** The stored resume the saved-source reader checks first. */
function jobboredResumePath() {
  return join(homedir(), ".jobbored", "resume.txt");
}

async function readResumeFromJobboredText() {
  const path = jobboredResumePath();
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const text = String(raw || "").trim();
  if (!text) return null;
  return { text, source: "jobbored_text", path };
}

async function readResumeFromLegacyHermes() {
  const dir = join(homedir(), ".hermes", "job-hunt", "profile");
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  // Prefer files literally named resume*.md. Falls back to resume-bullets.md
  // because that's what exists in legacy hermes installs.
  const candidates = entries
    .filter((name) => /^resume.*\.md$/i.test(name))
    .sort((a, b) => {
      // Prefer "resume.md" first, then "resume-something.md".
      if (/^resume\.md$/i.test(a)) return -1;
      if (/^resume\.md$/i.test(b)) return 1;
      return a.localeCompare(b);
    });
  for (const name of candidates) {
    const path = join(dir, name);
    try {
      const raw = await readFile(path, "utf8");
      const text = String(raw || "").trim();
      if (text) return { text, source: "legacy_hermes", path };
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Check known resume storage locations in priority order.
 * F11: ~/.jobbored/resume.txt is the canonical stored resume — a fresh
 * upload there wins over the worker-config snapshot, which is only a
 * fallback for machines that never staged one.
 * Returns { text, source, path } or null when nothing is found.
 */
export async function getStoredResumeText() {
  const fromJobbored = await readResumeFromJobboredText();
  if (fromJobbored) return fromJobbored;
  const fromWorker = await readResumeFromWorkerConfig();
  if (fromWorker) return fromWorker;
  const fromLegacy = await readResumeFromLegacyHermes();
  if (fromLegacy) return fromLegacy;
  return null;
}

/**
 * Resolve resume text for POST /profile/from-resume. Read-only (JOBQA).
 *
 * Browser-staged `resumeText` wins and is analyzed as a preview: nothing
 * is cached, so uploading a resume never replaces the saved one before the
 * user commits it. Only the `resumeText` field is ever read: secret-looking
 * body fields (apiKey, tokens) are ignored and never written.
 *
 * RESJ K5: garbled staged text (a split-word PDF extraction) is never
 * analyzed, and it is never swapped for a stored resume either — that
 * swap drafted another person's profile under the new upload. It throws
 * 422 resume_garbled. With no staged text, the stored resume is read only
 * when the request says `source: "saved"`; otherwise this returns null.
 *
 * @param {unknown} body
 * @param {{ readSaved?: () => Promise<{ text: string, source: string, path: string|null } | null> }} [deps]
 * @returns {Promise<{ text: string, source: string, path: string|null, requestGarbled?: boolean } | null>}
 */
export async function resolveResumeTextForAnalysis(body, deps = {}) {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? /** @type {Record<string, unknown>} */ (body)
    : null;
  const staged =
    record && typeof record.resumeText === "string" ? record.resumeText.trim() : "";
  if (staged) {
    const text = staged.slice(0, MAX_RESUME_INPUT_CHARS);
    if (detectGarbledResume(text).garbled) throw resumeGarbledError();
    return { text, source: "staged_request", path: null, requestGarbled: false };
  }
  if (record && record.source === "saved") {
    return (deps.readSaved || getStoredResumeText)();
  }
  return null;
}

/** Validate request-only original-file data. The base64 is consumed by the
 * model call and is never included in a saved profile or resume read.
 * @param {unknown} value
 * @returns {{ ok: true, document: { mimeType: string, filename?: string, data: string } | null } | { ok: false, status: 400 | 413, reason: string, message: string }}
 */
export function validateResumeDocument(value) {
  if (value == null) return { ok: true, document: null };
  if (!isRecord(value)) {
    return { ok: false, status: 400, reason: "resume_file_invalid", message: "Choose a PDF or DOCX file and try again." };
  }
  const data = typeof value.data === "string" ? value.data : "";
  if (data.length > MAX_PROFILE_DOCUMENT_BASE64_CHARS) {
    return { ok: false, status: 413, reason: "resume_file_too_large", message: PROFILE_DOCUMENT_TOO_LARGE_MESSAGE };
  }
  if (!data || data.length % 4 !== 0) {
    return { ok: false, status: 400, reason: "resume_file_invalid", message: PROFILE_DOCUMENT_INVALID_MESSAGE };
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const decodedLength = (data.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(decodedLength) || decodedLength > MAX_PROFILE_DOCUMENT_BYTES) {
    return { ok: false, status: 413, reason: "resume_file_too_large", message: PROFILE_DOCUMENT_TOO_LARGE_MESSAGE };
  }

  let lastDigit = -1;
  for (let index = 0; index < data.length - padding; index += 1) {
    const code = data.charCodeAt(index);
    let digit = -1;
    if (code >= 65 && code <= 90) digit = code - 65;
    else if (code >= 97 && code <= 122) digit = code - 71;
    else if (code >= 48 && code <= 57) digit = code + 4;
    else if (code === 43) digit = 62;
    else if (code === 47) digit = 63;
    if (digit < 0) {
      return { ok: false, status: 400, reason: "resume_file_invalid", message: PROFILE_DOCUMENT_INVALID_MESSAGE };
    }
    lastDigit = digit;
  }
  if ((padding === 2 && (lastDigit & 0x0f) !== 0) || (padding === 1 && (lastDigit & 0x03) !== 0)) {
    return { ok: false, status: 400, reason: "resume_file_invalid", message: PROFILE_DOCUMENT_INVALID_MESSAGE };
  }
  const decoded = Buffer.from(data, "base64");
  if (decoded.length !== decodedLength) {
    return { ok: false, status: 400, reason: "resume_file_invalid", message: PROFILE_DOCUMENT_INVALID_MESSAGE };
  }
  let mimeType = "";
  if (
    decoded.length >= 5 && decoded[0] === 0x25 && decoded[1] === 0x50 && decoded[2] === 0x44 &&
    decoded[3] === 0x46 && decoded[4] === 0x2d
  ) mimeType = PDF_MIME;
  else if (decoded.length >= 4 && decoded[0] === 0x50 && decoded[1] === 0x4b && decoded[2] === 0x03 && decoded[3] === 0x04) {
    mimeType = DOCX_MIME;
  }
  if (!mimeType) {
    return { ok: false, status: 400, reason: "resume_file_invalid", message: PROFILE_DOCUMENT_INVALID_MESSAGE };
  }
  const rawName = typeof value.filename === "string" ? value.filename : "";
  const basename = (rawName.replace(/\\/g, "/").split("/").pop() || "resume").replace(/[\r\n\0]/g, " ").slice(0, 180);
  const stem = basename.replace(/\.[^.]*$/, "") || "resume";
  const extension = mimeType === PDF_MIME ? ".pdf" : ".docx";
  const filename = `${stem}${extension}`;
  return {
    ok: true,
    document: { mimeType, ...(filename ? { filename } : {}), data },
  };
}

/**
 * Create the JSON parser used only by POST /profile/from-resume. Reject a
 * declared over-limit request before the parser reads it; the parser's own
 * byte limit also caps requests without Content-Length while streaming.
 * @param {(options: { limit: number }) => (req: any, res: any, next: (error?: unknown) => void) => unknown} jsonParserFactory
 * @returns {(req: { headers?: Record<string, unknown> }, res: { status(code: number): { json(body: unknown): unknown } }, next: (error?: unknown) => void) => unknown}
 */
export function createProfileFromResumeJsonParser(jsonParserFactory) {
  const parseJson = jsonParserFactory({ limit: MAX_PROFILE_FROM_RESUME_BODY_BYTES });
  return (req, res, next) => {
    const header = req.headers?.["content-length"];
    const contentLength = typeof header === "string" && /^\d+$/.test(header) ? Number(header) : null;
    if (contentLength !== null && contentLength > MAX_PROFILE_FROM_RESUME_BODY_BYTES) {
      return res.status(413).json({
        ok: false,
        reason: "resume_file_too_large",
        message: PROFILE_DOCUMENT_TOO_LARGE_MESSAGE,
      });
    }
    return parseJson(req, res, next);
  };
}

/* ─── Provider config ──────────────────────────────────────────────────── */

/**
 * @param {string[]} keys
 * @param {string} [fallback]
 */
function readFirstEnv(keys, fallback = "") {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return fallback;
}

/**
 * The provider ids this module can actually call. `anthropic` used to fall
 * through to "gemini" here, which meant an Anthropic-configured install
 * drafted against a Gemini endpoint with an Anthropic key (SIXBEATS-2
 * NEW-2's quieter half).
 *
 * @param {unknown} value
 * @returns {ProfileProvider | null}
 */
function matchProvider(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (raw === "gemini") return "gemini";
  if (raw === "anthropic") return "anthropic";
  if (raw === "openrouter") return "openrouter";
  if (raw === "openai") return "openai";
  if (raw === "openai_compatible" || raw === "compatible") {
    return "openai_compatible";
  }
  if (raw === "local" || raw === "local_openai" || raw === "local_llm") {
    return "local";
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {ProfileProvider}
 */
function normalizeProvider(value) {
  return matchProvider(value) || "gemini";
}

/** @param {ProfileProvider} provider */
function providerDisplayName(provider) {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "openai_compatible") return "OpenAI-compatible";
  if (provider === "local") return "local OpenAI-compatible";
  return "Gemini";
}

/** Providers whose call path is an API key; the rest need a base URL. */
const KEYED_PROVIDERS = new Set(["gemini", "anthropic", "openrouter", "openai"]);

/** @param {ProfileProvider} provider */
function defaultBaseUrlFor(provider) {
  if (provider === "openrouter") return DEFAULT_OPENROUTER_BASE_URL;
  if (provider === "openai") return DEFAULT_OPENAI_BASE_URL;
  if (provider === "anthropic") return DEFAULT_ANTHROPIC_BASE_URL;
  if (provider === "openai_compatible" || provider === "local") {
    return DEFAULT_LOCAL_BASE_URL;
  }
  return "";
}

/** @param {ProfileProvider} provider */
function defaultModelFor(provider) {
  if (provider === "openrouter") return DEFAULT_OPENROUTER_MODEL;
  if (provider === "openai") return DEFAULT_OPENAI_MODEL;
  if (provider === "anthropic") return DEFAULT_ANTHROPIC_MODEL;
  if (provider === "openai_compatible" || provider === "local") {
    return DEFAULT_LOCAL_MODEL;
  }
  return "";
}

/**
 * The provider the BROWSER verified, carried in the request body as
 * `{provider, apiKey, model, baseUrl}` (SIXBEATS2-SPEC locked decision 3).
 *
 * This is the fix for NEW-2: a fresh install that connected OpenRouter on
 * Beat 2 was told "Missing Gemini API key" on Beat 3, because the drafter
 * only ever looked at the server's own env. Returns null when the body
 * names no provider, or names one this module cannot call — either way the
 * env config still decides, so older clients keep working.
 *
 * The key is used for this one upstream call and is never persisted; the
 * resume cache (`resolveResumeTextForAnalysis`) still reads nothing but
 * `resumeText`.
 *
 * @param {unknown} body
 * @returns {ProfileProviderConfig | null}
 */
export function parseProfileProviderConfigFromBody(body) {
  if (!isRecord(body)) return null;
  const provider = matchProvider(body.provider);
  if (!provider) return null;
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const selectedModel = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : defaultModelFor(provider);
  const model = provider === "gemini"
    ? normalizeGeminiFlashPreference(selectedModel)
    : selectedModel;
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim()
    ? body.baseUrl.trim()
    : defaultBaseUrlFor(provider);
  return { provider, apiKey, model, baseUrl, origin: "request" };
}

function getGeminiConfig() {
  const apiKey = readFirstEnv([
    "PROFILE_GEMINI_API_KEY",
    "ATS_GEMINI_API_KEY",
    "GEMINI_API_KEY",
  ]);
  const model = readFirstEnv(
    ["PROFILE_GEMINI_MODEL", "ATS_GEMINI_MODEL", "GEMINI_MODEL"],
    "gemini-flash",
  );
  return { apiKey, model };
}

/** @returns {ProfileProviderConfig} */
export function getProfileProviderConfig() {
  migrateLlmConfigFromEnv(process.env);
  const loaded = loadLlmConfig(process.env);
  // The pinned LLM config is derived from the ATS scorecard's env (server/.env
  // ATS_*). It must not hijack the drafter when the drafter has its OWN
  // provider set (PROFILE_PROVIDER / PROFILE_LLM_PROVIDER), and a pin with no
  // key can never stand in for a configured provider — seen 2026-09-02 as
  // "Missing Gemini API key" while PROFILE_PROVIDER said openrouter.
  const explicitProfileProvider = readFirstEnv(["PROFILE_PROVIDER", "PROFILE_LLM_PROVIDER"], "");
  // A keyless pin is usable only for openai_compatible (Local/Ollama), in the
  // shared enum's spelling: POST /api/llm-config stores "local" as
  // openai_compatible (BEAUDIT E2).
  const pinUsable =
    loaded &&
    (String(loaded.apiKey || "").trim() ||
      sharedNormalizeProvider(loaded.provider) === "openai_compatible");
  if (loaded && pinUsable && !explicitProfileProvider) {
    return {
      provider: normalizeProvider(loaded.provider),
      apiKey: String(loaded.apiKey || "").trim(),
      model: String(loaded.model || "").trim(),
      baseUrl: String(loaded.baseUrl || "").trim(),
    };
  }
  const provider = normalizeProvider(
    readFirstEnv(["PROFILE_PROVIDER", "PROFILE_LLM_PROVIDER", "ATS_PROVIDER"], "gemini"),
  );
  if (provider === "openrouter") {
    return {
      provider,
      apiKey: readFirstEnv([
        "PROFILE_OPENROUTER_API_KEY",
        "ATS_OPENROUTER_API_KEY",
        "OPENROUTER_API_KEY",
      ]),
      baseUrl: readFirstEnv(
        ["PROFILE_OPENROUTER_BASE_URL", "ATS_OPENROUTER_BASE_URL", "OPENROUTER_BASE_URL"],
        DEFAULT_OPENROUTER_BASE_URL,
      ),
      model: readFirstEnv(
        ["PROFILE_OPENROUTER_MODEL", "ATS_OPENROUTER_MODEL", "OPENROUTER_MODEL"],
        DEFAULT_OPENROUTER_MODEL,
      ),
    };
  }
  if (provider === "openai") {
    return {
      provider,
      apiKey: readFirstEnv(["PROFILE_OPENAI_API_KEY", "ATS_OPENAI_API_KEY", "OPENAI_API_KEY"]),
      baseUrl: readFirstEnv(
        ["PROFILE_OPENAI_BASE_URL", "ATS_OPENAI_BASE_URL", "OPENAI_BASE_URL"],
        DEFAULT_OPENAI_BASE_URL,
      ),
      model: readFirstEnv(
        ["PROFILE_OPENAI_MODEL", "ATS_OPENAI_MODEL", "OPENAI_MODEL"],
        DEFAULT_OPENAI_MODEL,
      ),
    };
  }
  if (provider === "anthropic") {
    return {
      provider,
      apiKey: readFirstEnv([
        "PROFILE_ANTHROPIC_API_KEY",
        "ATS_ANTHROPIC_API_KEY",
        "ANTHROPIC_API_KEY",
      ]),
      baseUrl: readFirstEnv(
        ["PROFILE_ANTHROPIC_BASE_URL", "ATS_ANTHROPIC_BASE_URL", "ANTHROPIC_BASE_URL"],
        DEFAULT_ANTHROPIC_BASE_URL,
      ),
      model: readFirstEnv(
        ["PROFILE_ANTHROPIC_MODEL", "ATS_ANTHROPIC_MODEL", "ANTHROPIC_MODEL"],
        DEFAULT_ANTHROPIC_MODEL,
      ),
    };
  }
  if (provider === "openai_compatible" || provider === "local") {
    // Ambient OPENAI_API_KEY is openai-provider only and must not be forwarded
    // to arbitrary compatible endpoints.
    return {
      provider,
      apiKey: readFirstEnv([
        "PROFILE_OPENAI_COMPATIBLE_API_KEY",
        "PROFILE_LOCAL_API_KEY",
        "ATS_OPENAI_COMPATIBLE_API_KEY",
        "LOCAL_LLM_API_KEY",
      ]),
      baseUrl: readFirstEnv(
        [
          "PROFILE_OPENAI_COMPATIBLE_BASE_URL",
          "PROFILE_LOCAL_BASE_URL",
          "ATS_OPENAI_COMPATIBLE_BASE_URL",
          "LOCAL_LLM_BASE_URL",
        ],
        DEFAULT_LOCAL_BASE_URL,
      ),
      model: readFirstEnv(
        [
          "PROFILE_OPENAI_COMPATIBLE_MODEL",
          "PROFILE_LOCAL_MODEL",
          "ATS_OPENAI_COMPATIBLE_MODEL",
          "LOCAL_LLM_MODEL",
        ],
        DEFAULT_LOCAL_MODEL,
      ),
    };
  }
  const gemini = getGeminiConfig();
  return {
    provider: "gemini",
    apiKey: gemini.apiKey,
    model: gemini.model,
    baseUrl: "",
  };
}

/**
 * Why the config cannot be used, phrased for whoever supplied it.
 *
 * A "request" config was chosen in the browser, so its reason names the
 * provider and the next action; env-var names in that message are the
 * NEW-2 defect, not a hint (nobody walking Beat 3 has a shell open).
 *
 * @param {ProfileProviderConfig} [config]
 */
export function getProfileProviderConfigStatus(config = getProfileProviderConfig()) {
  const provider = config.provider;
  const display = providerDisplayName(provider);
  const fromRequest = config.origin === "request";
  if (KEYED_PROVIDERS.has(provider) && !config.apiKey) {
    if (fromRequest) {
      return {
        configured: false,
        provider,
        reason: `Missing ${display} API key. Go back and reconnect ${display}, then try drafting again.`,
      };
    }
    if (provider === "gemini") {
      return {
        configured: false,
        provider,
        reason: "Missing Gemini API key: set PROFILE_GEMINI_API_KEY, ATS_GEMINI_API_KEY, or GEMINI_API_KEY.",
      };
    }
    const prefix = provider.toUpperCase();
    return {
      configured: false,
      provider,
      reason:
        `Missing ${display} API key: set PROFILE_${prefix}_API_KEY` +
        ` or ATS_${prefix}_API_KEY when PROFILE_PROVIDER=${provider}.`,
    };
  }
  // Gemini addresses its model by URL path, so it alone needs no base URL.
  if (provider !== "gemini" && (!config.baseUrl || !config.model)) {
    return {
      configured: false,
      provider,
      reason: fromRequest
        ? `Missing ${display} model or server address. Go back and reconnect ${display}, then try drafting again.`
        : `Missing ${display} model/base URL: set PROFILE_OPENAI_COMPATIBLE_MODEL and PROFILE_OPENAI_COMPATIBLE_BASE_URL.`,
    };
  }
  if (provider === "gemini" && !config.model) {
    return {
      configured: false,
      provider,
      reason: fromRequest
        ? "Missing Gemini model. Go back and reconnect Gemini, then try drafting again."
        : "Missing Gemini model: set PROFILE_GEMINI_MODEL, ATS_GEMINI_MODEL, or GEMINI_MODEL.",
    };
  }
  return { configured: true, provider, reason: "" };
}

/** @param {ProfileProviderConfig} config */
function assertProfileProviderConfigured(config) {
  const status = getProfileProviderConfigStatus(config);
  if (status.configured) return;
  const err = /** @type {ProfileProviderError} */ (new Error(status.reason));
  err.code =
    status.provider === "gemini"
      ? "gemini_not_configured"
      : "profile_provider_not_configured";
  err.provider = status.provider;
  throw err;
}

/* ─── Provider calls ───────────────────────────────────────────────────── */

// SYSTEM_PROMPT + buildUserPrompt now live in profile-draft-shared.js
// (imported at the top) — the browser's serverless fallback uses them too.

// Gemini-flavored JSON schema (no $schema, no enums with descriptions in oneOf, etc.).
// Mirrors integrations/browser-use-discovery/src/contracts/user-profile.schema.json
// but trimmed to the subset Gemini's responseSchema accepts.
const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    version: { type: "integer" },
    starterTemplate: {
      type: "string",
      enum: ["marketer", "engineer", "product_manager", "data_scientist", "designer", "custom"],
    },
    identity: {
      type: "object",
      properties: {
        targetRoles: { type: "array", items: { type: "string" } },
        targetSeniority: {
          type: "string",
          enum: [
            "intern", "entry", "ic_mid", "ic_senior", "ic_staff", "ic_principal",
            "manager", "director", "head", "vp", "c_level", "any",
          ],
        },
        yearsRelevantExperience: { type: "integer" },
        primaryNarrative: { type: "string" },
      },
      required: ["targetRoles", "targetSeniority", "primaryNarrative"],
    },
    strengths: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          rank: { type: "integer" },
          evidence: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
        },
        required: ["name", "rank"],
      },
    },
    wants: { type: "array", items: { type: "string" } },
    avoids: { type: "array", items: { type: "string" } },
    resumeFacts: {
      type: "object",
      properties: {
        contact: {
          type: "object",
          properties: {
            name: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] },
            email: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] },
            phone: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] },
            location: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] },
            links: { type: "array", items: { type: "object", properties: { label: { type: "string" }, url: { type: "string" }, sourceQuote: { type: "string" } }, required: ["label", "url", "sourceQuote"] } },
          },
        },
        headline: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] },
        summary: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] },
        skills: { type: "array", items: { type: "object", properties: { text: { type: "string" }, kind: { type: "string", enum: ["hard", "tools", "soft"] }, sourceQuote: { type: "string" } }, required: ["text", "kind", "sourceQuote"] } },
        certifications: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] } },
        awards: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] } },
        projects: { type: "array", items: { type: "object", properties: { name: { type: "string" }, url: { type: "string" }, sourceQuote: { type: "string" } }, required: ["name", "url", "sourceQuote"] } },
        languages: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sourceQuote: { type: "string" } }, required: ["text", "sourceQuote"] } },
      },
      required: ["contact", "skills", "certifications", "awards", "projects", "languages"],
    },
    hardConstraints: {
      type: "object",
      properties: {
        workMode: {
          type: "string",
          enum: ["remote_only", "hybrid_ok", "onsite_ok", "any"],
        },
        salaryRequired: { type: "boolean" },
        acceptableLocations: { type: "array", items: { type: "string" } },
        workAuth: {
          type: "string",
          enum: ["us_citizen", "us_authorized", "needs_sponsorship", "any"],
        },
        skipTitles: { type: "array", items: { type: "string" } },
      },
      required: ["workMode"],
    },
  },
  required: ["version", "identity", "strengths", "hardConstraints", "resumeFacts"],
};

/** @param {unknown} value */
function trimTrailingSlashes(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

/** @param {unknown} baseUrl */
function buildChatCompletionsUrl(baseUrl) {
  return `${trimTrailingSlashes(baseUrl)}/chat/completions`;
}

/**
 * Profile fact providers currently accept native PDF input for Gemini,
 * Anthropic, and OpenAI. DOCX and other compatible endpoints use extracted
 * text, matching the structure model's document support.
 * @param {unknown} value
 * @param {unknown} provider
 * @returns {{ mimeType: string, filename: string, data: string } | null}
 */
function profileDocumentForProvider(value, provider) {
  const family = sharedNormalizeProvider(provider);
  if (
    !isRecord(value) ||
    value.mimeType !== PDF_MIME ||
    typeof value.data !== "string" ||
    !["gemini", "anthropic", "openai"].includes(family)
  ) return null;
  const filename = typeof value.filename === "string" ? value.filename : "resume.pdf";
  return {
    mimeType: PDF_MIME,
    filename: (filename.replace(/\\/g, "/").split("/").pop() || "resume.pdf").slice(0, 200),
    data: value.data,
  };
}

// Scan for the first balanced JSON object embedded in surrounding text and
// parse it. This recovers valid provider output wrapped in short prose.
/** @param {string} raw */
// tryParseEmbeddedJson + parseJsonSafe now live in profile-draft-shared.js
// (imported at the top) — the browser's serverless fallback uses them too.

/** @param {string} providerLabel @param {string} code @param {ProfileProvider} provider @param {string} model */
function truncatedDraftError(providerLabel, code, provider, model) {
  const err = /** @type {ProfileProviderError} */ (
    new Error(
      `${providerLabel} model ${model} hit its maximum output limit after a retry.`,
    )
  );
  err.code = code;
  err.provider = provider;
  return err;
}

/**
 * The URL guard refused the base URL (S1): the provider's configuration must
 * change, so it answers like a missing one (409 → the AI step).
 * @param {unknown} cause @param {ProfileProvider} provider
 */
function blockedProviderError(cause, provider) {
  const err = /** @type {ProfileProviderError} */ (new Error(messageOf(cause, "That provider address is not allowed.")));
  err.code = "profile_provider_not_configured";
  err.provider = provider;
  err.cause = cause;
  return err;
}

/**
 * @param {string} resumeText
 * @param {ProfileProviderConfig} config
 * @param {ProfileCallOptions} [opts]
 */
async function callChatJsonForProfile(resumeText, config, opts = {}) {
  assertProfileProviderConfigured(config);
  const model = opts.model || config.model;
  const document = profileDocumentForProvider(opts.document, config.provider);
  const prompt = buildUserPrompt(resumeText);
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: document && config.provider === "openai"
          ? [
              {
                type: "file",
                file: {
                  filename: document.filename,
                  file_data: `data:${document.mimeType};base64,${document.data}`,
                },
              },
              { type: "text", text: prompt },
            ]
          : prompt,
      },
    ],
    temperature: 0.2,
    ...outputLimitField(config.provider, model),
  };
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let resp;
  try {
    resp = await providerFetch(buildChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (cause) {
    if (isProviderUrlBlocked(cause)) throw blockedProviderError(cause, config.provider);
    const error = /** @type {{ message?: unknown } | null | undefined} */ (cause);
    const detail =
      error && error.message
        ? error.message
        : cause;
    const err = /** @type {ProfileProviderError} */ (new Error(
      `${providerDisplayName(config.provider)} request failed: ${/** @type {string} */ (detail)}`,
    ));
    err.code = "profile_provider_request_failed";
    err.provider = config.provider;
    err.cause = cause;
    throw err;
  }
  const data = /** @type {{ error?: { message?: string }, choices?: Array<{ finish_reason?: string, message?: { content?: string } }> }} */ (
    await resp.json().catch(() => ({}))
  );
  if (!resp.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      `${providerDisplayName(config.provider)} HTTP ${resp.status}`;
    const err = /** @type {ProfileProviderError} */ (new Error(msg));
    err.code = "profile_provider_http_error";
    err.provider = config.provider;
    err.upstreamStatus = resp.status;
    throw err;
  }
  const finishReason = String(data.choices?.[0]?.finish_reason || "");
  if (finishReason === "length") {
    if (!opts.retriedTruncation) return callChatJsonForProfile(resumeText, config, { ...opts, retriedTruncation: true });
    throw truncatedDraftError(providerDisplayName(config.provider), "profile_provider_truncated", config.provider, model);
  }
  const raw = data.choices?.[0]?.message?.content || "";
  if (!String(raw || "").trim()) {
    const err = /** @type {ProfileProviderError} */ (
      new Error(`${providerDisplayName(config.provider)} returned empty content`)
    );
    err.code = "profile_provider_empty_response";
    err.provider = config.provider;
    throw err;
  }
  try {
    return parseJsonSafe(raw);
  } catch (cause) {
    const error = /** @type {{ message: unknown }} */ (cause);
    const err = /** @type {ProfileProviderError} */ (new Error(
      `${providerDisplayName(config.provider)} returned non-JSON content: ${error.message}`,
    ));
    err.code = "profile_provider_parse_error";
    err.provider = config.provider;
    err.rawSample = String(raw || "").slice(0, 400);
    throw err;
  }
}

/**
 * Anthropic's Messages API. It is neither OpenAI-compatible nor Gemini, so
 * it needs its own path — without one, an Anthropic key normalized to
 * "gemini" and was posted to Google (SIXBEATS-2 NEW-2).
 *
 * @param {string} resumeText
 * @param {ProfileProviderConfig} config
 * @param {ProfileCallOptions} [opts]
 */
async function callAnthropicForProfile(resumeText, config, opts = {}) {
  assertProfileProviderConfigured(config);
  const model = opts.model || config.model;
  const document = profileDocumentForProvider(opts.document, config.provider);
  const prompt = buildUserPrompt(resumeText);
  let resp;
  try {
    resp = await providerFetch(`${trimTrailingSlashes(config.baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        ...(outputBudget("anthropic", model) === undefined ? {} : { max_tokens: outputBudget("anthropic", model) }),
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: document
            ? [
                {
                  type: "document",
                  source: { type: "base64", media_type: document.mimeType, data: document.data },
                },
                { type: "text", text: prompt },
              ]
            : prompt,
        }],
      }),
      signal: opts.signal,
    });
  } catch (cause) {
    if (isProviderUrlBlocked(cause)) throw blockedProviderError(cause, "anthropic");
    const error = /** @type {{ message?: unknown } | null | undefined} */ (cause);
    const detail = error && error.message ? error.message : cause;
    const err = /** @type {ProfileProviderError} */ (new Error(
      `Anthropic request failed: ${/** @type {string} */ (detail)}`,
    ));
    err.code = "profile_provider_request_failed";
    err.provider = "anthropic";
    err.cause = cause;
    throw err;
  }
  const data = /** @type {{ error?: { message?: string }, content?: Array<{ type?: string, text?: string }> }} */ (
    await resp.json().catch(() => ({}))
  );
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) || `Anthropic HTTP ${resp.status}`;
    const err = /** @type {ProfileProviderError} */ (new Error(msg));
    err.code = "profile_provider_http_error";
    err.provider = "anthropic";
    err.upstreamStatus = resp.status;
    throw err;
  }
  if (String(/** @type {{ stop_reason?: string }} */ (data).stop_reason || "") === "max_tokens") {
    if (!opts.retriedTruncation) return callAnthropicForProfile(resumeText, config, { ...opts, retriedTruncation: true });
    throw truncatedDraftError("Anthropic", "profile_provider_truncated", config.provider, model);
  }
  const raw = Array.isArray(data.content)
    ? data.content
        .filter((block) => block && block.type === "text")
        .map((block) => block.text || "")
        .join("")
    : "";
  if (!String(raw || "").trim()) {
    const err = /** @type {ProfileProviderError} */ (
      new Error("Anthropic returned empty content")
    );
    err.code = "profile_provider_empty_response";
    err.provider = "anthropic";
    throw err;
  }
  try {
    return parseJsonSafe(raw);
  } catch (cause) {
    const error = /** @type {{ message: unknown }} */ (cause);
    const err = /** @type {ProfileProviderError} */ (new Error(
      `Anthropic returned non-JSON content: ${error.message}`,
    ));
    err.code = "profile_provider_parse_error";
    err.provider = "anthropic";
    err.rawSample = String(raw || "").slice(0, 400);
    throw err;
  }
}

/**
 * @param {string} resumeText
 * @param {ProfileCallOptions} [opts]
 */
async function callGeminiForProfile(resumeText, opts = {}) {
  const cfg = opts.config || getProfileProviderConfig();
  assertProfileProviderConfigured(cfg);
  const model = opts.model || cfg.model;
  const document = profileDocumentForProvider(opts.document, cfg.provider);
  const prompt = buildUserPrompt(resumeText);
  // BEAUDIT B17: the key travels in x-goog-api-key, never in the URL.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: "user",
      parts: [
        ...(document ? [{ inline_data: { mime_type: document.mimeType, data: document.data } }] : []),
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      ...(outputBudget("gemini", model) === undefined ? {} : { maxOutputTokens: outputBudget("gemini", model) }),
      ...(Object.keys(geminiThinkingConfig(model)).length ? { thinkingConfig: geminiThinkingConfig(model) } : {}),
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  };
  let resp;
  try {
    resp = await providerFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": String(cfg.apiKey) },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (cause) {
    const error = /** @type {{ message?: unknown } | null | undefined} */ (cause);
    const detail =
      error && error.message
        ? error.message
        : cause;
    const err = /** @type {ProfileProviderError} */ (
      new Error(`Gemini request failed: ${/** @type {string} */ (detail)}`)
    );
    err.code = "gemini_request_failed";
    err.provider = "gemini";
    err.cause = cause;
    throw err;
  }
  const data = /** @type {{ error?: { message?: string }, candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }} */ (
    await resp.json().catch(() => ({}))
  );
  if (!resp.ok) {
    const msg =
      (data && data.error && data.error.message) ||
      `Gemini HTTP ${resp.status}`;
    const err = /** @type {ProfileProviderError} */ (new Error(msg));
    err.code = "gemini_http_error";
    err.provider = "gemini";
    err.upstreamStatus = resp.status;
    throw err;
  }
  const candidate = /** @type {{ finishReason?: string, content?: { parts?: Array<{ text?: string }> } } | undefined} */ (
    data.candidates?.[0]
  );
  if (String(candidate?.finishReason || "") === "MAX_TOKENS") {
    if (!opts.retriedTruncation) return callGeminiForProfile(resumeText, { ...opts, retriedTruncation: true });
    throw truncatedDraftError("Gemini", "gemini_truncated", "gemini", model);
  }
  const raw =
    candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!raw.trim()) {
    const err = /** @type {ProfileProviderError} */ (
      new Error("Gemini returned empty content")
    );
    err.code = "gemini_empty_response";
    err.provider = "gemini";
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    const error = /** @type {{ message: unknown }} */ (cause);
    const err = /** @type {ProfileProviderError} */ (
      new Error(`Gemini returned non-JSON content: ${error.message}`)
    );
    err.code = "gemini_parse_error";
    err.provider = "gemini";
    err.rawSample = raw.slice(0, 400);
    throw err;
  }
  return parsed;
}

/* ─── Safe-default normalization ──────────────────────────────────────── */

// Allowed-value sets + clamp helpers now live in profile-draft-shared.js
// (imported at the top) — the browser's serverless fallback uses them too.

// clampToUserProfile now lives in profile-draft-shared.js (imported at the
// top) — the browser's serverless fallback uses it too. __test below keeps
// re-exporting the same binding, so server-side probes are untouched.

/* ─── Public API ──────────────────────────────────────────────────────── */

/**
 * Call the configured profile provider with the resume text and return a valid
 * v1 UserProfile object. Does NOT save the result — the wizard renders it and
 * the user confirms.
 *
 * @param {string} resumeText
 * @param {ProfileCallOptions} [opts]
 * @returns {Promise<NormalizedUserProfile>} UserProfile
 */
export async function analyzeResumeToProfile(resumeText, opts = {}) {
  return (await analyzeResume(resumeText, opts)).profile;
}

/**
 * The profile draft plus "what JobBored read from the resume": quote-grounded
 * profile facts and the independently validated model structure.
 *
 * @param {string} resumeText
 * @param {ProfileCallOptions} [opts]
 * @returns {Promise<{ profile: NormalizedUserProfile, read: ReturnType<typeof buildResumeRead> & { ingest?: unknown } }>}
 */
export async function analyzeResume(resumeText, opts = {}) {
  const text = String(resumeText || "").trim();
  if (!text) {
    const err = /** @type {ProfileProviderError} */ (
      new Error("analyzeResumeToProfile: resumeText is empty")
    );
    err.code = "empty_resume";
    throw err;
  }
  const rawConfig = opts.config || getProfileProviderConfig();
  const pin = await resolveActivePin({
    provider: rawConfig.provider,
    model: rawConfig.model,
    apiKey: rawConfig.apiKey,
    baseUrl: rawConfig.baseUrl,
    updatedAt: "",
  });
  /** @type {ProfileProviderConfig} */
  const config = {
    provider: normalizeProvider(pin.provider || rawConfig.provider),
    apiKey: pin.apiKey,
    model: pin.resolvedModel || rawConfig.model,
    baseUrl: pin.baseUrl,
    origin: rawConfig.origin || "server",
  };
  let raw;
  if (config.provider === "gemini") {
    raw = await callGeminiForProfile(text, { ...opts, config });
  } else if (config.provider === "anthropic") {
    raw = await callAnthropicForProfile(text, config, opts);
  } else {
    raw = await callChatJsonForProfile(text, config, opts);
  }
  const profile = clampToUserProfile(raw);
  const structurePin = {
    provider: config.provider,
    model: config.model,
    resolvedModel: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  };
  const interpreted = await structureResumeWithModel({
    resumeText: text,
    document: opts.document,
    pin: structurePin,
    fetchImpl: opts.fetchImpl || globalThis.fetch,
    callStage: opts.structureCallStage,
    signal: opts.signal,
  });
  if (interpreted.ingest.status !== "ready" || !interpreted.structure) {
    const error = /** @type {ProfileProviderError & { ingest?: unknown }} */ (
      new Error(interpreted.ingest.reason || "The resume could not be grounded in its source text.")
    );
    error.code = "profile_resume_ingest_failed";
    error.provider = config.provider;
    error.ingest = interpreted.ingest;
    throw error;
  }
  const experiences = experiencesFromStructure(interpreted.structure);
  const read = buildResumeRead(text, {
    facts: resumeFactsOf(raw),
    structure: interpreted.structure,
    by: { provider: config.provider, model: String(opts.model || config.model || "") || config.provider },
  });
  const readWithIngest = {
    ...read,
    ingest: interpreted.ingest,
  };
  return { profile: experiences.length ? { ...profile, experiences } : profile, read: readWithIngest };
}

/** E11: route deadline for drafting a profile (local models can be slow). */
const PROFILE_ROUTE_DEADLINE_MS = 180_000;

/** @param {unknown} error @param {string} fallback */
function messageOf(error, fallback) {
  const errorLike = /** @type {{ message?: unknown } | null | undefined} */ (error);
  return String(errorLike && errorLike.message ? errorLike.message : fallback);
}

/** The key a read is stored under: the CR-free, trimmed text's sha256. @param {string} text */
function readKeyOf(text) {
  return resumeTextSha256(String(text || "").replace(/\r/g, "").trim());
}

/**
 * POST /profile/from-resume: draft a profile from a resume, read-only.
 *
 * Browser-staged `resumeText` is analyzed as a preview and nothing is
 * written (resolveResumeTextForAnalysis). One narrow exception keeps the
 * "What JobBored read" panel working: an editor that has already saved the
 * resume may send `persistRead: true`, and the read is cached only when
 * the analyzed text IS the saved canonical resume, so a preview of any
 * other resume never touches the cache. The profile itself is saved by the
 * caller's own save route or by onboarding's commit.
 *
 * 200 { ok: true, profile, read, source, requestGarbled: false }
 * 400 { ok: false, reason: "resume_empty" } no text and no source: "saved"
 * 404 { ok: false, reason: "no_resume_stored" } source: "saved" found none
 * 422 { ok: false, reason: "resume_garbled" }
 * 409 { ok: false, reason: "gemini_not_configured" | "profile_provider_not_configured" }
 * 500 { ok: false, reason: "profile_provider_error" | "gemini_error" | "resume_lookup_failed" }
 *
 * @param {{
 *   analyze?: typeof analyzeResume,
 *   readSaved?: () => Promise<{ text: string, source: string, path: string|null } | null>,
 *   readCanonicalText?: () => Promise<string>,
 *   saveRead?: (read: unknown) => Promise<unknown>,
 *   signalFor?: (req: import("express").Request, res: import("express").Response) => AbortSignal | undefined,
 * }} [deps] injected by tests and the JOBQA fixture; production uses the defaults
 */
export function createProfileFromResumeHandler(deps = {}) {
  const analyze = deps.analyze || analyzeResume;
  const readCanonicalText =
    deps.readCanonicalText || (async () => ((await readCanonicalResume()) || { text: "" }).text);
  const saveRead = deps.saveRead || ((/** @type {any} */ read) => saveResumeRead(read));
  const signalFor =
    deps.signalFor ||
    ((/** @type {import("express").Request} */ req, /** @type {import("express").Response} */ res) =>
      routeDeadlineSignal(req, res, PROFILE_ROUTE_DEADLINE_MS));
  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   */
  return async function profileFromResume(req, res) {
    const requestBody = /** @type {Record<string, unknown> | undefined} */ (req.body);
    const checkedDocument = validateResumeDocument(requestBody?.document);
    if (!checkedDocument.ok) {
      return res.status(checkedDocument.status).json({
        ok: false,
        reason: checkedDocument.reason,
        message: checkedDocument.message,
      });
    }
    let stored;
    try {
      stored = await resolveResumeTextForAnalysis(req.body, { readSaved: deps.readSaved });
    } catch (err) {
      const lookupError = /** @type {{ code?: unknown, message?: unknown } | null | undefined} */ (err);
      if (lookupError && lookupError.code === "resume_garbled") {
        return res.status(422).json({ ok: false, reason: "resume_garbled", message: String(lookupError.message || "") });
      }
      return res.status(500).json({
        ok: false,
        reason: "resume_lookup_failed",
        message: messageOf(err, "lookup failed"),
      });
    }
    if (!stored) {
      return requestBody && requestBody.source === "saved"
        ? res.status(404).json({ ok: false, reason: "no_resume_stored" })
        : res.status(400).json({ ok: false, reason: "resume_empty", message: "Send the resume text to read." });
    }
    // The provider the browser verified on Beat 2 wins over the server's env
    // (SIXBEATS2-SPEC locked decision 3). Without this a fresh install that
    // connected OpenRouter was answered "Missing Gemini API key" — NEW-2.
    const requestedConfig = parseProfileProviderConfigFromBody(req.body);
    try {
      // E11: a closed tab aborts the provider call. Drafting a profile from a
      // long resume on a local model can take minutes, hence the long deadline.
      const signal = signalFor(req, res);
      const { profile, read } = await analyze(stored.text, {
        ...(requestedConfig ? { config: requestedConfig } : {}),
        ...(checkedDocument.document ? { document: checkedDocument.document } : {}),
        signal,
      });
      if (requestBody?.persistRead === true) {
        const saved = await readCanonicalText().catch(() => "");
        if (saved && readKeyOf(saved) === readKeyOf(stored.text)) await saveRead(read);
      }
      return res.json({ ok: true, profile, read, source: stored.source, requestGarbled: stored.requestGarbled === true });
    } catch (err) {
      const error = /** @type {Record<string, unknown> | null | undefined} */ (err);
      const code = error && error.code ? String(error.code) : "";
      console.warn("[profile-from-resume] provider analysis failed:", redactSecrets(err instanceof Error ? err.stack || err.message : messageOf(err, "profile provider failed")));
      // A provider with no key is the CLIENT's configuration state, not a
      // server fault: 409, so the dashboard can route the user to the AI step
      // instead of reporting an internal error (walkthrough 2026-09-02, step 12).
      if (code === "gemini_not_configured") {
        return res.status(409).json({
          ok: false,
          reason: "gemini_not_configured",
          message: "Configure an AI provider in Settings → AI.",
        });
      }
      if (code === "profile_provider_not_configured") {
        return res.status(409).json({
          ok: false,
          reason: "profile_provider_not_configured",
          provider: error && typeof error.provider === "string" ? error.provider : undefined,
          message: "Configure an AI provider in Settings → AI.",
        });
      }
      const provider = error && typeof error.provider === "string" ? error.provider : "";
      const isGeminiError = provider === "gemini" || code.startsWith("gemini_");
      return res.status(500).json({
        ok: false,
        reason: isGeminiError ? "gemini_error" : "profile_provider_error",
        provider: provider || undefined,
        message: "The AI provider could not read the resume. Try again or check Settings → AI.",
      });
    }
  };
}

// Expose for tests/scratch only — not part of the documented surface.
export const __test = {
  SYSTEM_PROMPT,
  buildChatCompletionsUrl,
  clampToUserProfile,
  getProfileProviderConfig,
  getProfileProviderConfigStatus,
  parseProfileProviderConfigFromBody,
  parseJsonSafe,
  resolveWorkerConfigPath,
};
