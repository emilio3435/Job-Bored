import {
  loadLlmConfig,
  migrateLlmConfigFromEnv,
  resolveActivePin,
} from "./llm-config.mjs";
import {
  chat,
  clampTimeoutMs,
  normalizeProvider,
  providerDisplayName,
} from "./ai/provider.mjs";

const ATS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { type: "integer" },
    overallScore: { type: "integer" },
    dimensionScores: {
      type: "object",
      properties: {
        requirementsCoverage: { type: "integer" },
        experienceRelevance: { type: "integer" },
        impactClarity: { type: "integer" },
        atsParseability: { type: "integer" },
        toneFit: { type: "integer" },
      },
      required: [
        "requirementsCoverage",
        "experienceRelevance",
        "impactClarity",
        "atsParseability",
        "toneFit",
      ],
      additionalProperties: false,
    },
    topStrengths: { type: "array", items: { type: "string" } },
    criticalGaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          gap: { type: "string" },
          whyItMatters: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["gap", "whyItMatters", "severity"],
        additionalProperties: false,
      },
    },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          sourceSnippet: { type: "string" },
          sourceType: { type: "string", enum: ["resume", "cover_letter", "job", "profile"] },
        },
        required: ["claim", "sourceSnippet", "sourceType"],
        additionalProperties: false,
      },
    },
    rewriteSuggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          targetSection: { type: "string" },
          before: { type: "string" },
          after: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["targetSection", "before", "after", "rationale"],
        additionalProperties: false,
      },
    },
    confidence: { type: "number" },
    model: { type: "string" },
  },
  required: [
    "schemaVersion",
    "overallScore",
    "dimensionScores",
    "topStrengths",
    "criticalGaps",
    "evidence",
    "rewriteSuggestions",
    "confidence",
    "model",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "You are an ATS and recruiter scorecard evaluator. Score ONLY from provided text, cite evidence snippets, and never fabricate claims. Output strict JSON matching the schema. Use concise, actionable rewrite suggestions.";

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL = "openai/gpt-oss-120b:free";
const DEFAULT_GEMINI_MODEL = "gemini-flash";
const NO_PIN_REASON = "No LLM pin configured. Save an AI provider in Settings.";
const PIN_MISSING_KEY_REASON = "Missing API key. Save a key in Settings.";

/** @typedef {"gemini" | "openai" | "anthropic" | "openrouter" | "openai_compatible"} AtsProvider */
/** @typedef {Record<string, unknown>} UnknownRecord */
/**
 * @typedef {object} AtsPayload
 * @property {string} feature
 * @property {string} docText
 * @property {UnknownRecord} job
 * @property {UnknownRecord} [profile]
 * @property {UnknownRecord} [instructions]
 */

/** @param {unknown} s */
function normalizeSpace(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {unknown} text
 * @param {number} max
 */
function clipText(text, max) {
  const s = normalizeSpace(text);
  return s.length > max ? `${s.slice(0, max)}\n… [truncated]` : s;
}

// E18: a posting description is mostly company blurb, benefits and EEO
// boilerplate. Keep only the sections under a requirements-like heading;
// when the posting has no such heading, fall back to a shorter clip.
const POSTING_KEEP_HEADING =
  /^(?:#+\s*)?(?:\*\*)?\s*(?:(?:basic|minimum|preferred|key|core|required)\s+)?(?:requirements?|qualifications?|responsibilities|what you(?:'|\u2019)?ll (?:do|need|bring)|what we(?:'|\u2019)?re looking for|who you are|about you|you (?:have|bring|will)|must[- ]haves?|nice[- ]to[- ]haves?|skills|experience|the role|your role|duties|tech(?:nical)? stack|tools)\b[^\n]{0,40}$/i;
const POSTING_DROP_HEADING =
  /^(?:#+\s*)?(?:\*\*)?\s*(?:about (?:us|the company|[A-Z][\w&.-]*)|benefits|perks|compensation|salary|pay (?:range|transparency)|what we offer|why (?:join|work)|equal (?:employment )?opportunity|eeo|our (?:values|mission|culture)|life at|how to apply|privacy)\b[^\n]{0,40}$/i;
const POSTING_TRIMMED_MAX = 4000;
const POSTING_FALLBACK_MAX = 3000;
/** E18: one budget for every optional profile excerpt in the ATS prompt. */
const PROFILE_EXCERPTS_MAX = 10000;

/**
 * @param {unknown} description
 * @returns {string}
 */
export function trimPostingToRequirements(description) {
  const text = normalizeSpace(description);
  if (!text) return "";
  const kept = [];
  let keeping = false;
  let sawHeading = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const short = line.length > 0 && line.length <= 80;
    if (short && POSTING_KEEP_HEADING.test(line)) {
      keeping = true;
      sawHeading = true;
    } else if (short && POSTING_DROP_HEADING.test(line)) {
      keeping = false;
    }
    if (keeping && line) kept.push(line);
  }
  if (!sawHeading || kept.length === 0) return clipText(text, POSTING_FALLBACK_MAX);
  return clipText(kept.join("\n"), POSTING_TRIMMED_MAX);
}

// Scan for the first balanced {…} / […] embedded in surrounding text and parse
// it. Lets a valid scorecard be recovered when the provider wraps its JSON in
// conversational prose (no code fence). Returns undefined if nothing parses.
/** @param {string} raw */
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
      const candidate = raw.slice(start, i + 1).trim();
      try {
        return JSON.parse(candidate);
      } catch {
        break;
      }
    }
  }
  return undefined;
}

/** @param {unknown} text */
function parseJsonSafe(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty JSON payload");
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(raw);
  const cleaned = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Provider sometimes returns the JSON wrapped in prose with no code fence.
    // Recover by extracting the first balanced JSON value so a valid scorecard
    // succeeds on the first attempt instead of burning a retry. Only attempt
    // this when the text isn't already a JSON root — a malformed object that
    // starts with {/[ should still throw and let the retry path handle it.
    if (!(cleaned.startsWith("{") || cleaned.startsWith("["))) {
      const embedded = tryParseEmbeddedJson(cleaned);
      if (embedded !== undefined) return embedded;
    }
    throw error;
  }
}

/** @param {unknown} error */
function isMalformedProviderJsonError(error) {
  if (error instanceof SyntaxError) return true;
  const errorLike = /** @type {{ message?: unknown } | null | undefined} */ (error);
  const msg = String(errorLike?.message || "").trim();
  return /empty json payload|returned empty content/i.test(msg);
}

/**
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
async function withMalformedJsonRetry(label, run) {
  /** @type {unknown} */
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isMalformedProviderJsonError(error) || attempt === 2) break;
      console.warn(
        `[ats-scorecard] ${label} returned malformed JSON on attempt ${attempt}; retrying once`,
      );
    }
  }
  if (isMalformedProviderJsonError(lastError)) {
    const errorLike = /** @type {{ message?: unknown } | null | undefined} */ (lastError);
    const detail = String(errorLike?.message || "Unknown JSON parse failure");
    throw new Error(
      `${label} returned malformed JSON after retry. Retry ATS analysis or try a different model. Last parser error: ${detail}`,
    );
  }
  throw lastError;
}

/**
 * @param {unknown} value
 * @returns {value is UnknownRecord}
 */
function isPlainRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * ATS provider timeout. ATS_PROVIDER_TIMEOUT_MS still tunes it (clamped to
 * the shared 120 s ceiling); the transport lives in server/ai/provider.mjs.
 */
export function providerFetchTimeoutMs() {
  return clampTimeoutMs(process.env.ATS_PROVIDER_TIMEOUT_MS);
}

/** @param {unknown} v */
function normalizeScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** @param {unknown} v */
function normalizeConfidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * @param {unknown} v
 * @param {number} [limit]
 * @param {number} [maxLen]
 */
function toStringArray(v, limit = 8, maxLen = 500) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((x) => (x.length > maxLen ? `${x.slice(0, maxLen - 1)}…` : x));
}

/** @param {unknown} v */
function normalizeSeverity(v) {
  const raw = String(v || "").toLowerCase().trim();
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "medium";
}

/** @param {unknown} v */
function normalizeSourceType(v) {
  const raw = String(v || "").toLowerCase().trim();
  if (["resume", "cover_letter", "job", "profile"].includes(raw)) return raw;
  return "profile";
}

/**
 * @param {unknown} parsed
 * @param {string} model
 */
function normalizeScorecard(parsed, model) {
  const root = /** @type {UnknownRecord | null | undefined} */ (parsed);
  const dimensionScores = root?.dimensionScores;
  const ds = isPlainRecord(dimensionScores) ? dimensionScores : {};
  const criticalGaps = Array.isArray(root?.criticalGaps) ? root.criticalGaps : [];
  const evidence = Array.isArray(root?.evidence) ? root.evidence : [];
  const rewriteSuggestions = Array.isArray(root?.rewriteSuggestions)
    ? root.rewriteSuggestions
    : [];
  return {
    schemaVersion: 1,
    overallScore: normalizeScore(root?.overallScore),
    dimensionScores: {
      requirementsCoverage: normalizeScore(ds.requirementsCoverage),
      experienceRelevance: normalizeScore(ds.experienceRelevance),
      impactClarity: normalizeScore(ds.impactClarity),
      atsParseability: normalizeScore(ds.atsParseability),
      toneFit: normalizeScore(ds.toneFit),
    },
    topStrengths: toStringArray(root?.topStrengths, 8, 300),
    criticalGaps: criticalGaps.slice(0, 10).map((item) => {
      const value = /** @type {UnknownRecord | null | undefined} */ (item);
      return {
        gap: String(value?.gap || "").slice(0, 500),
        whyItMatters: String(value?.whyItMatters || "").slice(0, 600),
        severity: normalizeSeverity(value?.severity),
      };
    }).filter((item) => item.gap && item.whyItMatters),
    evidence: evidence.slice(0, 10).map((item) => {
      const value = /** @type {UnknownRecord | null | undefined} */ (item);
      return {
        claim: String(value?.claim || "").slice(0, 400),
        sourceSnippet: String(value?.sourceSnippet || "").slice(0, 700),
        sourceType: normalizeSourceType(value?.sourceType),
      };
    }).filter((item) => item.claim && item.sourceSnippet),
    rewriteSuggestions: rewriteSuggestions.slice(0, 8).map((item) => {
      const value = /** @type {UnknownRecord | null | undefined} */ (item);
      return {
        targetSection: String(value?.targetSection || "").slice(0, 120),
        before: String(value?.before || "").slice(0, 700),
        after: String(value?.after || "").slice(0, 700),
        rationale: String(value?.rationale || "").slice(0, 500),
      };
    }).filter((item) => item.targetSection && item.after),
    confidence: normalizeConfidence(root?.confidence),
    model: String(model || "unknown"),
  };
}

/**
 * E18: the optional profile excerpts share one character budget, in priority
 * order, instead of up to 30000 characters on top of the draft and posting.
 * @param {UnknownRecord} profile
 * @returns {string[]}
 */
function profileExcerptLines(profile) {
  /** @type {[string, unknown, number][]} */
  const fields = [
    ["Candidate profile", profile.candidateProfileText, 6000],
    ["Resume source", profile.resumeSourceText, 6000],
    ["LinkedIn source", profile.linkedinProfileText, 3000],
    ["Additional context", profile.additionalContextText, 3000],
  ];
  let remaining = PROFILE_EXCERPTS_MAX;
  /** @type {string[]} */
  const lines = [];
  for (const [label, value, cap] of fields) {
    const text = normalizeSpace(value);
    if (!text || remaining <= 0) continue;
    const clipped = clipText(text, Math.min(cap, remaining));
    remaining -= Math.min(text.length, cap, remaining);
    lines.push(`${label}:\n${clipped}`);
  }
  if (!normalizeSpace(profile.candidateProfileText)) lines.unshift("Candidate profile: (none)");
  return lines;
}

/** @param {AtsPayload} payload */
function buildUserPrompt(payload) {
  const featureLabel =
    payload.feature === "resume_update" ? "resume_update" : "cover_letter";
  const job = payload.job || {};
  const posting = /** @type {UnknownRecord} */ (job.postingEnrichment || {});
  const profile = payload.profile || {};
  const instructions = payload.instructions || {};
  return [
    `Feature: ${featureLabel}`,
    `Job title: ${String(job.title || "").trim() || "(unknown)"}`,
    `Company: ${String(job.company || "").trim() || "(unknown)"}`,
    job.url ? `Job URL: ${String(job.url).trim()}` : "",
    "",
    "--- Candidate draft text to evaluate ---",
    clipText(payload.docText, 18000),
    "",
    "--- Job context ---",
    `Fit assessment: ${clipText(job.fitAssessment || "", 1600) || "(none)"}`,
    `Talking points: ${clipText(job.talkingPoints || "", 1600) || "(none)"}`,
    `Notes: ${clipText(job.notes || "", 1800) || "(none)"}`,
    "",
    "--- Posting enrichment ---",
    posting.description ? `Description (requirement sections):\n${trimPostingToRequirements(posting.description)}` : "Description: (none)",
    `Requirements: ${(Array.isArray(posting.requirements) ? posting.requirements.slice(0, 35) : []).join("; ") || "(none)"}`,
    `Must-haves: ${(Array.isArray(posting.mustHaves) ? posting.mustHaves.slice(0, 20) : []).join("; ") || "(none)"}`,
    `Responsibilities: ${(Array.isArray(posting.responsibilities) ? posting.responsibilities.slice(0, 20) : []).join("; ") || "(none)"}`,
    `Tools and stack: ${(Array.isArray(posting.toolsAndStack) ? posting.toolsAndStack.slice(0, 24) : []).join("; ") || "(none)"}`,
    "",
    "--- Candidate profile excerpts (optional) ---",
    ...profileExcerptLines(profile),
    "",
    instructions.userNotes
      ? `User notes: ${clipText(instructions.userNotes, 1200)}`
      : "",
    instructions.refinementFeedback
      ? `Refinement feedback: ${clipText(instructions.refinementFeedback, 1200)}`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

/**
 * One ATS call through the shared provider module (E15). The schema drives
 * Gemini's responseSchema, OpenAI's strict json_schema and Anthropic's
 * output_config; OpenRouter and OpenAI-compatible servers get plain JSON.
 * @param {{ provider: AtsProvider, apiKey: string, model: string, baseUrl: string }} target
 * @param {string} userPrompt
 * @param {AbortSignal} [signal] the request signal (E11)
 */
async function callProviderJson(target, userPrompt, signal) {
  const label = providerDisplayName(target.provider);
  return withMalformedJsonRetry(label, async () => {
    const { text } = await chat({
      pin: target,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      schema: ATS_RESPONSE_SCHEMA,
      schemaName: "ats_scorecard",
      signal,
      timeoutMs: providerFetchTimeoutMs(),
      maxTokens: 3500,
      temperature: 0.15,
    });
    if (!text.trim()) throw new Error(`${label} returned empty content`);
    return parseJsonSafe(text);
  });
}

/**
 * The shared enum: "local" and "ollama" are openai_compatible (E2). Anything
 * unknown stays gemini, as before, so an old env-only install keeps working.
 * @param {unknown} value
 * @returns {AtsProvider}
 */
function normalizeAtsProvider(value) {
  return normalizeProvider(value || "gemini") || "gemini";
}

/**
 * @typedef {object} AtsProviderConfig
 * @property {AtsProvider} provider
 * @property {string} geminiApiKey
 * @property {string} openAIApiKey
 * @property {string} anthropicApiKey
 * @property {string} openRouterApiKey
 * @property {string} openAICompatibleApiKey
 * @property {string} geminiModel
 * @property {string} openAIModel
 * @property {string} anthropicModel
 * @property {string} openRouterModel
 * @property {string} openRouterBaseUrl
 * @property {string} openAICompatibleModel
 * @property {string} openAICompatibleBaseUrl
 */

/** @returns {import("./llm-config.mjs").LlmConfig | null} */
function loadAtsPin() {
  migrateLlmConfigFromEnv(process.env);
  return loadLlmConfig(process.env);
}

/** @returns {AtsProviderConfig} */
function readProviderConfigFromEnv() {
  const provider = normalizeAtsProvider(process.env.ATS_PROVIDER || "gemini");
  return {
    provider,
    geminiApiKey: String(
      process.env.ATS_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
    ).trim(),
    openAIApiKey: String(
      process.env.ATS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
    ).trim(),
    anthropicApiKey: String(
      process.env.ATS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "",
    ).trim(),
    openRouterApiKey: String(
      process.env.ATS_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || "",
    ).trim(),
    openAICompatibleApiKey: String(
      process.env.ATS_OPENAI_COMPATIBLE_API_KEY ||
        process.env.ATS_OPENAI_COMPAT_API_KEY ||
        process.env.OPENAI_COMPATIBLE_API_KEY ||
        "",
    ).trim(),
    geminiModel: String(process.env.ATS_GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim(),
    openAIModel: String(process.env.ATS_OPENAI_MODEL || "gpt-5.4-mini").trim(),
    anthropicModel: String(process.env.ATS_ANTHROPIC_MODEL || "claude-sonnet-4-6").trim(),
    openRouterModel: String(
      process.env.ATS_OPENROUTER_MODEL ||
        process.env.OPENROUTER_MODEL ||
        OPENROUTER_DEFAULT_MODEL,
    ).trim(),
    openRouterBaseUrl: String(
      process.env.ATS_OPENROUTER_BASE_URL ||
        process.env.OPENROUTER_BASE_URL ||
        OPENROUTER_DEFAULT_BASE_URL,
    ).trim(),
    openAICompatibleModel: String(
      process.env.ATS_OPENAI_COMPATIBLE_MODEL ||
        process.env.ATS_OPENAI_COMPAT_MODEL ||
        process.env.OPENAI_COMPATIBLE_MODEL ||
        "",
    ).trim(),
    openAICompatibleBaseUrl: String(
      process.env.ATS_OPENAI_COMPATIBLE_BASE_URL ||
        process.env.ATS_OPENAI_COMPAT_BASE_URL ||
        process.env.OPENAI_COMPATIBLE_BASE_URL ||
        process.env.OPENAI_BASE_URL ||
        "",
    ).trim(),
  };
}

/**
 * @param {AtsProviderConfig} cfg
 * @param {{ provider?: unknown, model?: unknown, apiKey?: unknown, baseUrl?: unknown }} pin
 * @returns {AtsProviderConfig}
 */
function applyLlmPinToConfig(cfg, pin) {
  const provider = normalizeAtsProvider(pin.provider);
  const model = String(pin.model || "").trim();
  const apiKey = String(pin.apiKey || "").trim();
  const baseUrl = String(pin.baseUrl || "").trim();
  cfg.provider = provider;
  if (provider === "openai") {
    cfg.openAIApiKey = apiKey;
    if (model) cfg.openAIModel = model;
  } else if (provider === "anthropic") {
    cfg.anthropicApiKey = apiKey;
    if (model) cfg.anthropicModel = model;
  } else if (provider === "openrouter") {
    cfg.openRouterApiKey = apiKey;
    if (model) cfg.openRouterModel = model;
    if (baseUrl) cfg.openRouterBaseUrl = baseUrl;
  } else if (provider === "openai_compatible") {
    cfg.openAICompatibleApiKey = apiKey;
    if (model) cfg.openAICompatibleModel = model;
    if (baseUrl) cfg.openAICompatibleBaseUrl = baseUrl;
  } else {
    cfg.geminiApiKey = apiKey;
    cfg.geminiModel = model || DEFAULT_GEMINI_MODEL;
  }
  return cfg;
}

/** @param {AtsProviderConfig} cfg */
function activeModelFromCfg(cfg) {
  if (cfg.provider === "openai") return cfg.openAIModel;
  if (cfg.provider === "anthropic") return cfg.anthropicModel;
  if (cfg.provider === "openrouter") return cfg.openRouterModel;
  if (cfg.provider === "openai_compatible") return cfg.openAICompatibleModel;
  return cfg.geminiModel;
}

export function getProviderConfigFromEnv() {
  const loaded = loadAtsPin();
  const cfg = readProviderConfigFromEnv();
  if (loaded) {
    // Pin wins. Do not keep ATS_GEMINI_MODEL when llm.json is present.
    cfg.geminiModel = DEFAULT_GEMINI_MODEL;
    return applyLlmPinToConfig(cfg, loaded);
  }
  return cfg;
}

export function getAtsConfigStatus() {
  const loaded = loadAtsPin();
  const cfg = getProviderConfigFromEnv();
  const model = loaded ? loaded.model : activeModelFromCfg(cfg);
  if (!loaded) {
    return {
      configured: false,
      provider: cfg.provider,
      model,
      reason: NO_PIN_REASON,
    };
  }
  if (cfg.provider === "openai") {
    if (!cfg.openAIApiKey) {
      return {
        configured: false,
        provider: cfg.provider,
        model,
        reason: PIN_MISSING_KEY_REASON,
      };
    }
    return { configured: true, provider: cfg.provider, model, reason: "" };
  }
  if (cfg.provider === "anthropic") {
    if (!cfg.anthropicApiKey) {
      return {
        configured: false,
        provider: cfg.provider,
        model,
        reason: PIN_MISSING_KEY_REASON,
      };
    }
    return { configured: true, provider: cfg.provider, model, reason: "" };
  }
  if (cfg.provider === "openrouter") {
    if (!cfg.openRouterApiKey) {
      return {
        configured: false,
        provider: cfg.provider,
        model,
        reason: PIN_MISSING_KEY_REASON,
      };
    }
    return { configured: true, provider: cfg.provider, model, reason: "" };
  }
  if (cfg.provider === "openai_compatible") {
    if (
      !cfg.openAICompatibleBaseUrl ||
      !cfg.openAICompatibleModel
    ) {
      return {
        configured: false,
        provider: cfg.provider,
        model,
        reason:
          "Missing OpenAI-compatible ATS config: set ATS_OPENAI_COMPATIBLE_BASE_URL and ATS_OPENAI_COMPATIBLE_MODEL when ATS_PROVIDER=openai_compatible. ATS_OPENAI_COMPATIBLE_API_KEY is optional for local servers.",
      };
    }
    return { configured: true, provider: cfg.provider, model, reason: "" };
  }
  if (!cfg.geminiApiKey) {
    return {
      configured: false,
      provider: cfg.provider,
      model,
      reason: PIN_MISSING_KEY_REASON,
    };
  }
  return { configured: true, provider: cfg.provider, model, reason: "" };
}

/**
 * @param {AtsPayload} payload
 * @param {{ signal?: AbortSignal }} [options] `signal` is the request's
 *   disconnect/deadline signal; aborting it cancels the billed call (E11).
 */
export async function analyzeAtsScorecard(payload, options = {}) {
  const cfg = getProviderConfigFromEnv();
  const status = getAtsConfigStatus();
  if (!status.configured) {
    throw new Error(status.reason);
  }
  const loaded = loadLlmConfig(process.env);
  if (loaded) {
    const pin = await resolveActivePin(loaded);
    applyLlmPinToConfig(cfg, {
      provider: pin.provider,
      model: pin.resolvedModel,
      apiKey: pin.apiKey,
      baseUrl: pin.baseUrl,
    });
  }

  const userPrompt = buildUserPrompt(payload);
  const target = activeTargetFromCfg(cfg);
  const parsed = await callProviderJson(target, userPrompt, options.signal);
  return normalizeScorecard(parsed, target.model);
}

/**
 * @param {AtsProviderConfig} cfg
 * @returns {{ provider: AtsProvider, apiKey: string, model: string, baseUrl: string }}
 */
function activeTargetFromCfg(cfg) {
  if (cfg.provider === "openai") {
    return { provider: "openai", apiKey: cfg.openAIApiKey, model: cfg.openAIModel, baseUrl: "" };
  }
  if (cfg.provider === "anthropic") {
    return { provider: "anthropic", apiKey: cfg.anthropicApiKey, model: cfg.anthropicModel, baseUrl: "" };
  }
  if (cfg.provider === "openrouter") {
    return {
      provider: "openrouter",
      apiKey: cfg.openRouterApiKey,
      model: cfg.openRouterModel,
      baseUrl: cfg.openRouterBaseUrl,
    };
  }
  if (cfg.provider === "openai_compatible") {
    return {
      provider: "openai_compatible",
      apiKey: cfg.openAICompatibleApiKey,
      model: cfg.openAICompatibleModel,
      baseUrl: cfg.openAICompatibleBaseUrl,
    };
  }
  return { provider: "gemini", apiKey: cfg.geminiApiKey, model: cfg.geminiModel, baseUrl: "" };
}
