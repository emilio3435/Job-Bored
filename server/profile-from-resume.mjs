/**
 * profile-from-resume.mjs
 *
 * Reads stored resume text, calls the configured profile AI provider,
 * returns a UserProfile JSON (does NOT save it — user reviews in the wizard).
 *
 * Wired into POST /profile/from-resume in server/index.mjs.
 *
 * Request-body `resumeText` (browser-staged) wins over every stored
 * location AND is cached to ~/.jobbored/resume.txt. That cache is the
 * server half of the ONE-FLOW dual write (spec §5 B3): before it, a
 * resume dropped into the browser was analyzed once and thrown away, so
 * the next reader found nothing — the teardown's "resume uploaded in
 * wizard 1 is invisible to wizard 2" bug.
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

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadLlmConfig,
  migrateLlmConfigFromEnv,
  resolveActivePin,
} from "./llm-config.mjs";
import { normalizeProvider as sharedNormalizeProvider } from "./ai/provider.mjs";
import { normalizeGeminiFlashPreference } from "./model-family.mjs";
import { outputBudget, geminiThinkingConfig, outputLimitField } from "./llm-output-budget.mjs";
import { ALIAS_CLAUSE_RE, experiencesFromStructure } from "./materials-resume-structure.mjs";
import { structureResumeWithModel } from "./materials-resume-structure-model.mjs";
import { detectGarbledResume, resumeGarbledError } from "./materials-resume-source.mjs";
import { extractMetrics } from "./materials-ledger-build.mjs";
import { buildResumeRead } from "./resume-read.mjs";

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

/** @param {string} text */
function readAchievement(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim().slice(0, 600);
  return { text: value, metrics: extractMetrics(value).map((metric) => metric.token) };
}

/**
 * Keep the shared contact, skills, and summary projection, but use the
 * quote-grounded model structure for the employer and claim projection too.
 * @template { { counts: Record<string, number> } } T
 * @param {T} read
 * @param {import("./materials-resume-structure.mjs").ResumeStructure} structure
 * @returns {T & {
 *   employers: Array<{ name: string, formerly: string[], location: string, start: string | null, end: string | null, roles: Array<{ title: string, start: string | null, end: string | null, present: boolean }>, achievements: Array<{ text: string, metrics: string[] }> }>,
 *   highlights: Array<{ text: string, metrics: string[] }>,
 *   education: string[],
 *   counts: Record<string, number>
 * }}
 */
function applyModelStructureToResumeRead(read, structure) {
  const employers = structure.employers.map((employer) => {
    const formerly = [];
    for (const match of employer.name.matchAll(/\((?:formerly|previously|fka|f\/k\/a|aka|a\.k\.a\.)\s+([^)]+)\)/gi)) {
      formerly.push(String(match[1]).replace(/\s+/g, " ").trim());
    }
    let name = String(employer.name).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() || employer.name;
    const aliasClause = ALIAS_CLAUSE_RE.exec(name);
    if (aliasClause) {
      formerly.push(String(aliasClause[1]).replace(/\s+/g, " ").trim());
      name = name.slice(0, aliasClause.index).trim();
    }
    return {
      name,
      formerly,
      location: String(employer.location || ""),
      start: employer.start,
      end: employer.end,
      roles: employer.roles.map((role) => ({
        title: role.title,
        start: role.start,
        end: role.end,
        present: role.start !== null && role.end === null,
      })),
      achievements: employer.claims.map((claim) => readAchievement(claim.text)),
    };
  });
  const highlights = structure.looseClaims.map(readAchievement);
  const education = structure.education.map((item) => String(item).replace(/\s+/g, " ").trim());
  const achievements = employers.flatMap((employer) => employer.achievements).concat(highlights);
  return {
    ...read,
    employers,
    highlights,
    education,
    counts: {
      ...read.counts,
      employers: employers.length,
      roles: employers.reduce((count, employer) => count + employer.roles.length, 0),
      achievements: achievements.length,
      withNumbers: achievements.filter((achievement) => achievement.metrics.length > 0).length,
      education: education.length,
    },
  };
}

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

/** The one path both the reader and the staged-text cache use. */
function jobboredResumePath() {
  return join(homedir(), ".jobbored", "resume.txt");
}

/**
 * Cache browser-staged resume text where the next reader will find it
 * (ONE-FLOW spec §5 B3). Best-effort by design: a machine that refuses
 * the write still gets its draft, because losing the draft over a failed
 * cache would be a worse bug than the one this fixes.
 *
 * @param {string} text
 * @returns {Promise<string|null>} the path written, or null
 */
async function cacheStagedResumeText(text) {
  const path = jobboredResumePath();
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
    return path;
  } catch {
    return null;
  }
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
 * Resolve resume text for POST /profile/from-resume.
 *
 * Browser-staged `resumeText` wins so IndexedDB-only resumes can prefill
 * Fit Profile, and it is cached to ~/.jobbored/resume.txt so the NEXT
 * reader — a rescore, a later draft, the discovery worker — sees the same
 * resume the browser has (ONE-FLOW spec §5 B3, the dual write). Only the
 * `resumeText` field is ever read: secret-looking body fields (apiKey,
 * tokens) are ignored and never written.
 *
 * RESJ K5: garbled staged text (a split-word PDF extraction) is never
 * analyzed. The clean saved resume is used instead, with
 * `requestGarbled: true` so the wizard can say so; with no clean saved
 * resume the call throws 422 resume_garbled.
 *
 * @param {unknown} body
 * @returns {Promise<{ text: string, source: string, path: string|null, requestGarbled?: boolean } | null>}
 */
export async function resolveResumeTextForAnalysis(body) {
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? /** @type {Record<string, unknown>} */ (body)
    : null;
  const staged =
    record && typeof record.resumeText === "string" ? record.resumeText.trim() : "";
  if (staged) {
    const text = staged.slice(0, MAX_RESUME_INPUT_CHARS);
    if (detectGarbledResume(text).garbled) {
      const stored = await getStoredResumeText();
      if (!stored || detectGarbledResume(stored.text).garbled) throw resumeGarbledError();
      return { ...stored, requestGarbled: true };
    }
    return {
      text,
      source: "staged_request",
      path: await cacheStagedResumeText(text),
      requestGarbled: false,
    };
  }
  return getStoredResumeText();
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
        skills: {
          type: "object",
          properties: {
            hard: { type: "array", items: { type: "string" } },
            tools: { type: "array", items: { type: "string" } },
            soft: { type: "array", items: { type: "string" } },
          },
        },
      },
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
  required: ["version", "identity", "strengths", "hardConstraints"],
};

/** @param {unknown} value */
function trimTrailingSlashes(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

/** @param {unknown} baseUrl */
function buildChatCompletionsUrl(baseUrl) {
  return `${trimTrailingSlashes(baseUrl)}/chat/completions`;
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
 * @param {string} resumeText
 * @param {ProfileProviderConfig} config
 * @param {ProfileCallOptions} [opts]
 */
async function callChatJsonForProfile(resumeText, config, opts = {}) {
  assertProfileProviderConfigured(config);
  const model = opts.model || config.model;
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(resumeText) },
    ],
    temperature: 0.2,
    ...outputLimitField(config.provider, model),
  };
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let resp;
  try {
    resp = await fetch(buildChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (cause) {
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
  let resp;
  try {
    resp = await fetch(`${trimTrailingSlashes(config.baseUrl)}/messages`, {
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
        messages: [{ role: "user", content: buildUserPrompt(resumeText) }],
      }),
      signal: opts.signal,
    });
  } catch (cause) {
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
  // BEAUDIT B17: the key travels in x-goog-api-key, never in the URL.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(resumeText) }] }],
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
    resp = await fetch(url, {
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
 * The profile draft plus "what JobBored read from the resume": model-grounded
 * employers and roles, with the profile model's `resumeFacts` folded in.
 *
 * @param {string} resumeText
 * @param {ProfileCallOptions} [opts]
 * @returns {Promise<{ profile: NormalizedUserProfile, read: import("./resume-read.mjs").ResumeRead }>}
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
    by: { provider: config.provider, model: String(opts.model || config.model || "") || config.provider },
  });
  const readWithIngest = {
    ...applyModelStructureToResumeRead(read, interpreted.structure),
    ingest: interpreted.ingest,
  };
  return { profile: experiences.length ? { ...profile, experiences } : profile, read: readWithIngest };
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
