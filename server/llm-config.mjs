import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  GEMINI_FLASH_FALLBACK,
  isGeminiFlashFamily,
  pickStableGeminiFlash,
} from "./model-family.mjs";

/**
 * @typedef {object} LlmConfig
 * @property {string} provider
 * @property {string} model
 * @property {string} apiKey
 * @property {string} baseUrl
 * @property {string} updatedAt
 */

/**
 * @typedef {object} RedactedLlmConfig
 * @property {string} provider
 * @property {string} model
 * @property {string} baseUrl
 * @property {boolean} keyPresent
 * @property {string} updatedAt
 */

/**
 * @typedef {object} ActivePin
 * @property {string} provider
 * @property {string} model
 * @property {string} apiKey
 * @property {string} baseUrl
 * @property {string} resolvedModel
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

/**
 * @param {unknown} value
 * @returns {LlmConfig | null}
 */
function asLlmConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  return {
    provider: asString(record.provider),
    model: asString(record.model),
    apiKey: asString(record.apiKey),
    baseUrl: asString(record.baseUrl),
    updatedAt: asString(record.updatedAt),
  };
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
  return {
    ...parsed,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * @param {LlmConfig} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {LlmConfig}
 */
function persistLlmConfig(config, env) {
  const path = llmConfigPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  chmodSync(path, 0o600);
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
    return asLlmConfig(JSON.parse(raw));
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
    provider: parsed.provider,
    model: parsed.model,
    baseUrl: parsed.baseUrl,
    keyPresent: Boolean(parsed.apiKey),
    updatedAt: parsed.updatedAt,
  };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {LlmConfig} config
 * @param {unknown} fetchImpl
 * @returns {Promise<string[]>}
 */
async function defaultListGeminiModels(config, fetchImpl) {
  const doFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (typeof doFetch !== "function") return [];
  const apiKey = asString(config && config.apiKey);
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const resp = await doFetch(url);
  const data =
    resp && typeof resp.json === "function"
      ? await resp.json().catch(() => ({}))
      : {};
  const list = isPlainObject(data) && Array.isArray(data.models) ? data.models : [];
  /** @type {string[]} */
  const ids = [];
  for (const entry of list) {
    const name = isPlainObject(entry) ? asString(entry.name).replace(/^models\//, "") : "";
    if (name) ids.push(name);
  }
  return ids;
}

/**
 * @param {LlmConfig} config
 * @param {{ fetchImpl?: unknown, listGeminiModels?: () => Promise<unknown> }} [options]
 * @returns {Promise<ActivePin>}
 */
export async function resolveActivePin(config, options) {
  let resolvedModel = asString(config && config.model);
  if (isGeminiFlashFamily(resolvedModel)) {
    const provider = asString(config && config.provider).toLowerCase();
    const listGeminiModels =
      options && typeof options.listGeminiModels === "function"
        ? options.listGeminiModels
        : provider === "gemini"
          ? () => defaultListGeminiModels(config, options && options.fetchImpl)
          : null;
    /** @type {unknown} */
    let ids = [];
    try {
      ids = listGeminiModels ? await listGeminiModels() : [];
    } catch {
      ids = [];
    }
    resolvedModel = pickStableGeminiFlash(ids) || GEMINI_FLASH_FALLBACK;
  }
  return {
    provider: asString(config && config.provider),
    model: asString(config && config.model),
    apiKey: asString(config && config.apiKey),
    baseUrl: asString(config && config.baseUrl),
    resolvedModel,
  };
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function handleGetLlmConfig(req, res, env = process.env) {
  const loaded = loadLlmConfig(env);
  if (!loaded) {
    res.status(404).json({ error: "No LLM pin configured.", code: "llm_unconfigured" });
    return;
  }
  res.json(redactLlmConfig(loaded));
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function handlePostLlmConfig(req, res, env = process.env) {
  const body = req.body || {};
  const provider = String(body.provider || "").trim();
  const model = String(body.model || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const baseUrl = String(body.baseUrl || "").trim();
  if (!provider || !model) {
    res.status(400).json({ error: "provider and model are required.", code: "llm_invalid" });
    return;
  }
  const saved = await writeLlmConfig({ provider, model, apiKey, baseUrl }, env);
  res.json(redactLlmConfig(saved));
}
