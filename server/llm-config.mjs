import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  chat,
  isHttpUrl,
  normalizeProvider,
  providerAlias,
  resolveProvider,
  routeDeadlineSignal,
} from "./ai/provider.mjs";
import { GEMINI_FLASH_FAMILY, normalizeGeminiFlashPreference, resolveGeminiFlashWireModel } from "./model-family.mjs";

const JUDGE_PROBE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["grade"],
  properties: { grade: { type: "integer", minimum: 0, maximum: 4 } },
};
const Ajv = /** @type {typeof import("ajv/dist/2020.js").default} */ (/** @type {unknown} */ (Ajv2020));
const validJudgeProbe = new Ajv({ allErrors: true, strict: false }).compile(JUDGE_PROBE_SCHEMA);

/**
 * @typedef {object} LlmConfig
 * @property {string} provider
 * @property {string} model
 * @property {string} apiKey
 * @property {string} baseUrl
 * @property {string} updatedAt
 * @property {string} [alias] the spelling the user picked ("local", "ollama") when it differs from provider
 * @property {LlmFallbackConfig} [fallback] Decision 5: per-stage backup model, off unless enabled
 * @property {LlmFallbackTarget} [judge] independent materials judge pin
 */

/**
 * @typedef {object} LlmFallbackTarget
 * @property {string} provider
 * @property {string} model
 * @property {string} [apiKey] omitted: reuse the primary key when the provider matches
 * @property {string} [baseUrl]
 * @property {string} [alias] the spelling the user picked ("local", "ollama") when it differs from provider
 */

/**
 * Decision 5: a backup model per materials stage. A stage switches to its
 * target after the primary fails twice; "*" covers every stage without its
 * own entry. Ships absent; `enabled: false` keeps the shape but turns it off.
 * @typedef {object} LlmFallbackConfig
 * @property {boolean} enabled
 * @property {Record<string, LlmFallbackTarget>} stages keyed "jd.extract" | "claims.select" | "draft" | "*"
 */

/**
 * @typedef {object} RedactedLlmConfig
 * @property {string} provider
 * @property {string} alias
 * @property {string} model
 * @property {string} baseUrl
 * @property {boolean} keyPresent
 * @property {string} updatedAt
 * @property {{ provider: string, alias: string, model: string, baseUrl: string, keyPresent: boolean } | null} judge
 */

/**
 * @typedef {object} ActivePin
 * @property {string} provider
 * @property {string} model
 * @property {string} apiKey
 * @property {string} baseUrl
 * @property {string} resolvedModel
 * @property {{ stages: Record<string, Omit<ActivePin, "fallback">> }} [fallback] present only when enabled
 * @property {Omit<ActivePin, "fallback" | "judge">} [judge]
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
function resolveEnv(env) {
  return env || process.env;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function llmConfigPath(env) {
  const override = String(resolveEnv(env).JOBBORED_LLM_CONFIG_PATH || "").trim();
  if (override) return override;
  return join(homedir(), ".jobbored", "llm.json");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return String(value || "").trim();
}

/** Stages that may name a fallback target ("*" = every stage). */
export const LLM_FALLBACK_STAGES = Object.freeze(["jd.extract", "claims.select", "draft", "*"]);

/**
 * @param {unknown} value
 * @returns {LlmFallbackConfig | undefined}
 */
function asFallbackConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = /** @type {Record<string, unknown>} */ (value);
  const rawStages = record.stages && typeof record.stages === "object" && !Array.isArray(record.stages)
    ? /** @type {Record<string, unknown>} */ (record.stages)
    : {};
  /** @type {Record<string, LlmFallbackTarget>} */
  const stages = {};
  for (const stage of LLM_FALLBACK_STAGES) {
    const entry = rawStages[stage];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const target = /** @type {Record<string, unknown>} */ (entry);
    const provider = normalizeProvider(asString(target.provider));
    const model = asString(target.model);
    if (!provider || !model) continue;
    /** @type {LlmFallbackTarget} */
    const out = { provider, model };
    if (asString(target.apiKey)) out.apiKey = asString(target.apiKey);
    if (asString(target.baseUrl)) out.baseUrl = asString(target.baseUrl);
    stages[stage] = out;
  }
  return { enabled: record.enabled === true, stages };
}

/** @param {unknown} value @returns {LlmFallbackTarget | undefined} */
function asJudgeConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = /** @type {Record<string, unknown>} */ (value);
  const provider = normalizeProvider(asString(raw.provider));
  const model = asString(raw.model);
  const baseUrl = asString(raw.baseUrl);
  if (!provider || !model || model.length > 200 || baseUrl.length > 2048 || (baseUrl && !isHttpUrl(baseUrl))) return undefined;
  // One enum on disk, like the writer (E2): a fresh "local"/"ollama" spelling
  // is kept as `alias`, and a stored alias survives reloads only when it
  // still agrees with the provider — a mismatched one is dropped.
  const storedAlias = asString(raw.alias);
  const alias = providerAlias(raw.provider)
    || (storedAlias && normalizeProvider(storedAlias) === provider ? storedAlias : "");
  /** @type {LlmFallbackTarget} */
  const out = { provider, model, apiKey: asString(raw.apiKey), baseUrl };
  if (alias) out.alias = alias;
  return out;
}

/**
 * @param {unknown} value
 * @returns {LlmConfig | null}
 */
function asLlmConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  /** @type {LlmConfig} */
  const config = {
    provider: asString(record.provider),
    model: asString(record.model),
    apiKey: asString(record.apiKey),
    baseUrl: asString(record.baseUrl),
    updatedAt: asString(record.updatedAt),
  };
  const alias = asString(record.alias);
  if (alias) config.alias = alias;
  const fallback = asFallbackConfig(record.fallback);
  if (fallback) config.fallback = fallback;
  const judge = asJudgeConfig(record.judge);
  if (judge) config.judge = judge;
  return config;
}

/**
 * @param {unknown} config
 * @returns {LlmConfig}
 */
function normalizeLlmConfig(config) {
  const parsed = asLlmConfig(config) || {
    provider: "",
    model: "",
    apiKey: "",
    baseUrl: "",
    updatedAt: "",
  };
  // One enum on disk: "local"/"ollama" are stored as openai_compatible, and
  // the user's spelling is kept as `alias` so Settings can show it (E2).
  const canonical = normalizeProvider(parsed.provider);
  const alias = providerAlias(parsed.provider) || (canonical ? asString(parsed.alias) : "");
  /** @type {LlmConfig} */
  const out = {
    provider: canonical || parsed.provider,
    model: canonical === "gemini" ? normalizeGeminiFlashPreference(parsed.model) : parsed.model,
    apiKey: parsed.apiKey,
    baseUrl: parsed.baseUrl,
    updatedAt: new Date().toISOString(),
  };
  if (alias) out.alias = alias;
  if (parsed.fallback) out.fallback = parsed.fallback;
  if (parsed.judge) out.judge = parsed.judge;
  return out;
}

/**
 * Atomic write (E14): the temp file is created 0600 in the same directory and
 * renamed over llm.json, so there is no 0644 window and no torn file on crash.
 * @param {LlmConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {LlmConfig}
 */
function persistLlmConfig(config, env) {
  const path = llmConfigPath(env);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  return config;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {LlmConfig | null}
 */
export function loadLlmConfig(env) {
  const path = llmConfigPath(env);
  try {
    const raw = readFileSync(path, "utf8");
    const config = asLlmConfig(JSON.parse(raw));
    if (!config) return null;
    // Exact 3.7 was the old generated Flash default. Preserve other pins.
    const bare = config.model.replace(/^models\//i, "").toLowerCase();
    if (normalizeProvider(config.provider) !== "gemini" || bare !== "gemini-3.7-flash") {
      return config;
    }
    return { ...config, model: GEMINI_FLASH_FAMILY };
  } catch {
    return null;
  }
}

/**
 * @param {unknown} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<LlmConfig>}
 */
export async function writeLlmConfig(config, env) {
  return persistLlmConfig(normalizeLlmConfig(config), env);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {LlmConfig}
 */
function pinFromAtsEnv(env) {
  const provider = asString(env.ATS_PROVIDER).toLowerCase() || "gemini";
  if (provider === "openai") {
    return {
      provider,
      model: asString(env.ATS_OPENAI_MODEL),
      apiKey: asString(env.ATS_OPENAI_API_KEY),
      baseUrl: asString(env.ATS_OPENAI_BASE_URL),
      updatedAt: "",
    };
  }
  if (provider === "anthropic") {
    return {
      provider,
      model: asString(env.ATS_ANTHROPIC_MODEL),
      apiKey: asString(env.ATS_ANTHROPIC_API_KEY),
      baseUrl: asString(env.ATS_ANTHROPIC_BASE_URL),
      updatedAt: "",
    };
  }
  if (provider === "openrouter") {
    return {
      provider,
      model: asString(env.ATS_OPENROUTER_MODEL),
      apiKey: asString(env.ATS_OPENROUTER_API_KEY),
      baseUrl: asString(env.ATS_OPENROUTER_BASE_URL),
      updatedAt: "",
    };
  }
  if (provider === "openai_compatible") {
    return {
      provider,
      model: asString(env.ATS_OPENAI_COMPATIBLE_MODEL || env.ATS_OPENAI_COMPAT_MODEL),
      apiKey: asString(env.ATS_OPENAI_COMPATIBLE_API_KEY || env.ATS_OPENAI_COMPAT_API_KEY),
      baseUrl: asString(env.ATS_OPENAI_COMPATIBLE_BASE_URL || env.ATS_OPENAI_COMPAT_BASE_URL),
      updatedAt: "",
    };
  }
  return {
    provider: "gemini",
    model: asString(env.ATS_GEMINI_MODEL),
    apiKey: asString(env.ATS_GEMINI_API_KEY),
    baseUrl: asString(env.ATS_GEMINI_BASE_URL),
    updatedAt: "",
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {LlmConfig | null}
 */
export function migrateLlmConfigFromEnv(env) {
  const resolved = resolveEnv(env);
  const existing = loadLlmConfig(resolved);
  if (existing) return existing;
  if (existsSync(llmConfigPath(resolved))) return null;

  const pin = pinFromAtsEnv(resolved);
  if (!pin.apiKey && !pin.model && !pin.baseUrl) return null;
  return persistLlmConfig(normalizeLlmConfig(pin), resolved);
}

/**
 * @param {LlmConfig | null | undefined} config
 * @returns {RedactedLlmConfig}
 */
export function redactLlmConfig(config) {
  const parsed = asLlmConfig(config) || {
    provider: "",
    model: "",
    apiKey: "",
    baseUrl: "",
    updatedAt: "",
  };
  return {
    provider: normalizeProvider(parsed.provider) || parsed.provider,
    alias: providerAlias(parsed.provider) || asString(parsed.alias),
    model: parsed.model,
    baseUrl: parsed.baseUrl,
    keyPresent: Boolean(parsed.apiKey),
    updatedAt: parsed.updatedAt,
    judge: parsed.judge ? {
      provider: parsed.judge.provider,
      alias: asString(parsed.judge.alias),
      model: parsed.judge.model,
      baseUrl: parsed.judge.baseUrl || "",
      keyPresent: Boolean(parsed.judge.apiKey),
    } : null,
  };
}

/**
 * @param {LlmConfig} config
 * @returns {Promise<ActivePin>}
 */
export async function resolveActivePin(config) {
  const provider = normalizeProvider(config && config.provider) || asString(config && config.provider);
  const model = asString(config && config.model);
  /** @type {ActivePin} */
  const pin = {
    provider,
    model,
    apiKey: asString(config && config.apiKey),
    baseUrl: asString(config && config.baseUrl),
    resolvedModel: provider === "gemini" ? resolveGeminiFlashWireModel(model) : model,
  };
  const judge = asJudgeConfig(config && config.judge);
  if (judge) pin.judge = {
    provider: judge.provider,
    model: judge.model,
    apiKey: judge.apiKey || "",
    baseUrl: judge.baseUrl || "",
    resolvedModel: judge.provider === "gemini" ? resolveGeminiFlashWireModel(judge.model) : judge.model,
  };
  const fallback = asFallbackConfig(config && config.fallback);
  if (fallback && fallback.enabled && Object.keys(fallback.stages).length) {
    /** @type {Record<string, Omit<ActivePin, "fallback">>} */
    const stages = {};
    for (const [stage, target] of Object.entries(fallback.stages)) {
      stages[stage] = {
        provider: target.provider,
        model: target.model,
        apiKey: target.apiKey || (target.provider === provider ? pin.apiKey : ""),
        baseUrl: target.baseUrl || "",
        resolvedModel: target.provider === "gemini" ? resolveGeminiFlashWireModel(target.model) : target.model,
      };
    }
    pin.fallback = { stages };
  }
  return pin;
}

/**
 * `readLastDraft` (optional, CDESK MODELUI) adds `lastDraft`: the model the
 * newest drafted package actually used, so Settings can show it. A failing
 * reader never fails the GET.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ readLastDraft?: () => Promise<unknown> }} [options]
 */
export async function handleGetLlmConfig(req, res, env = process.env, options = {}) {
  let lastDraft = null;
  if (options && typeof options.readLastDraft === "function") {
    try {
      lastDraft = await options.readLastDraft();
    } catch {
      lastDraft = null;
    }
  }
  const extra = lastDraft ? { lastDraft } : {};
  const loaded = loadLlmConfig(env);
  if (!loaded) {
    res.status(404).json({ error: "No LLM pin configured.", code: "llm_unconfigured", ...extra });
    return;
  }
  res.json({ ...redactLlmConfig(loaded), ...extra });
}

/**
 * POST /api/llm-config (E12).
 * - `provider` must be one of the shared enum or an alias of it.
 * - `baseUrl`, when given, must be http(s).
 * - An omitted `apiKey` keeps the stored key, but only while the provider
 *   and base URL are unchanged, so a key never follows the pin to a different
 *   endpoint. A present `apiKey` replaces it: `""` (Settings' emptied field)
 *   and `null` both clear it.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function handlePostLlmConfig(req, res, env = process.env) {
  const rawBody = req.body;
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    res.status(400).json({ error: "Body must be a JSON object.", code: "llm_invalid" });
    return;
  }
  const body = /** @type {Record<string, unknown>} */ (rawBody);
  const rawProvider = asString(body.provider);
  const model = asString(body.model);
  const baseUrl = asString(body.baseUrl);
  if (!rawProvider || !model) {
    res.status(400).json({ error: "provider and model are required.", code: "llm_invalid" });
    return;
  }
  const provider = normalizeProvider(rawProvider);
  if (!provider) {
    res.status(400).json({
      error: "Unsupported provider. Use gemini, openai, anthropic, openrouter, openai_compatible or local.",
      code: "llm_invalid",
    });
    return;
  }
  if (baseUrl && !isHttpUrl(baseUrl)) {
    res.status(400).json({ error: "baseUrl must be an http(s) URL.", code: "llm_invalid" });
    return;
  }
  if (model.length > 200 || baseUrl.length > 2048) {
    res.status(400).json({ error: "model or baseUrl is too long.", code: "llm_invalid" });
    return;
  }
  // Omitted apiKey keeps the stored key (same provider and base URL). A
  // present apiKey is the caller's answer: Settings sends "" when the user
  // empties the key box, and null also clears.
  let apiKey = "";
  if (body.apiKey !== undefined) {
    apiKey = asString(body.apiKey);
  } else {
    const existing = loadLlmConfig(env);
    const sameTarget =
      existing &&
      normalizeProvider(existing.provider) === provider &&
      asString(existing.baseUrl).replace(/\/+$/, "") === baseUrl.replace(/\/+$/, "");
    apiKey = sameTarget && existing ? existing.apiKey : "";
  }
  // Settings does not edit the fallback block (Decision 5: Jordan sets it by
  // hand), so a Settings save keeps whatever llm.json already holds.
  const stored = loadLlmConfig(env);
  /** @type {LlmFallbackTarget | undefined} */
  let judge;
  if (body.judge === undefined) {
    judge = stored?.judge;
  } else if (body.judge !== null) {
    judge = asJudgeConfig(body.judge);
    if (!judge) {
      res.status(400).json({ error: "judge needs a supported provider, model and valid baseUrl.", code: "llm_invalid" });
      return;
    }
    const sameJudge = stored?.judge
      && stored.judge.provider === judge.provider
      && asString(stored.judge.baseUrl).replace(/\/+$/, "") === asString(judge.baseUrl).replace(/\/+$/, "");
    if (body.judge && typeof body.judge === "object" && !("apiKey" in body.judge)) {
      judge.apiKey = sameJudge && stored?.judge ? stored.judge.apiKey : "";
    }
  }
  const saved = await writeLlmConfig(
    { provider: rawProvider, model, apiKey, baseUrl, ...(stored?.fallback ? { fallback: stored.fallback } : {}), ...(judge ? { judge } : {}) },
    env,
  );
  res.json(redactLlmConfig(saved));
}

/**
 * POST /api/llm-config/judge-test.
 *
 * Asks a judge candidate to answer once, without saving anything. The
 * onboarding AI beat uses it for its Test button; Settings may reuse it.
 *
 * - The body is a judge pin: { provider, model, baseUrl?, apiKey? }.
 * - A malformed body is a 400. A well-formed body whose provider does not
 *   answer is a 200 with { ok: false, ... }: the test ran, the key failed.
 * - An omitted apiKey falls back to the stored judge key under the POST's
 *   same-target rule, so re-testing a saved judge needs no re-typing.
 * - The reply never carries the key: ProviderApiError's message holds only
 *   the status, the provider code and the class.
 * - baseUrl is caller-supplied by design (Local, xAI, self-hosted). This
 *   route calls exactly what the grader would call later; it takes no
 *   read of the stored pin beyond the key fallback, and writes nothing.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ fetchImpl?: typeof globalThis.fetch }} [options]
 */
export async function handleJudgeTest(req, res, env = process.env, options = {}) {
  const rawBody = req && req.body;
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    res.status(400).json({ error: "Body must be a JSON object.", code: "llm_invalid" });
    return;
  }
  const body = /** @type {Record<string, unknown>} */ (rawBody);
  const provider = normalizeProvider(asString(body.provider));
  const model = asString(body.model);
  const baseUrl = asString(body.baseUrl);
  if (!provider) {
    res.status(400).json({ error: "judge test needs a supported provider.", code: "llm_invalid" });
    return;
  }
  if (!model || model.length > 200) {
    res.status(400).json({ error: "judge test needs a model.", code: "llm_invalid" });
    return;
  }
  if (baseUrl && (!isHttpUrl(baseUrl) || baseUrl.length > 2048)) {
    res.status(400).json({ error: "baseUrl must be an http(s) URL.", code: "llm_invalid" });
    return;
  }
  let apiKey = asString(body.apiKey);
  if (!apiKey) {
    const stored = loadLlmConfig(env);
    const sameTarget =
      stored?.judge
      && stored.judge.provider === provider
      && asString(stored.judge.baseUrl).replace(/\/+$/, "") === baseUrl.replace(/\/+$/, "");
    apiKey = sameTarget && stored?.judge ? asString(stored.judge.apiKey) : "";
  }
  const pin = {
    provider,
    model: provider === "gemini" ? resolveGeminiFlashWireModel(model) : model,
    apiKey,
    baseUrl,
  };
  const startedAt = Date.now();
  const resolved = resolveProvider(pin);
  if (!resolved.configured) {
    res.json({ ok: false, ms: Date.now() - startedAt, structured: false, error: resolved.reason, code: "judge_unconfigured", retryable: false });
    return;
  }
  try {
    const answer = await chat({
      pin,
      messages: [{ role: "user", content: "Grade this fictional sentence for clarity from 0 to 4: I built the dispatch forecast. Return only a JSON object with the integer field grade." }],
      schema: JUDGE_PROBE_SCHEMA,
      schemaName: "materials_grade_probe",
      signal: routeDeadlineSignal(req, res, 60_000),
      timeoutMs: 60_000,
      ...(options && typeof options.fetchImpl === "function" ? { fetchImpl: options.fetchImpl } : {}),
    });
    let probe;
    try { probe = JSON.parse(answer.text); } catch { /* free text is not a structured grade */ }
    if (!validJudgeProbe(probe)) {
      res.json({ ok: false, ms: Date.now() - startedAt, structured: false, code: "judge_no_structured_output", retryable: false });
      return;
    }
    res.json({ ok: true, structured: true, provider, model: answer && answer.model ? answer.model : model, ms: Date.now() - startedAt });
  } catch (error) {
    const fields = error && typeof error === "object" ? /** @type {Record<string, unknown>} */ (error) : {};
    const retryable = fields.retryable !== false;
    const code = typeof fields.providerCode === "string" && fields.providerCode ? fields.providerCode : "judge_unavailable";
    const upstreamStatus = typeof fields.upstreamStatus === "number" ? fields.upstreamStatus : undefined;
    res.json({
      ok: false,
      ms: Date.now() - startedAt,
      structured: false,
      error: error instanceof Error && error.message ? error.message : "The judge test failed.",
      code,
      retryable,
      ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
    });
  }
}
