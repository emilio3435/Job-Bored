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
import {
  isHttpUrl,
  normalizeProvider,
  providerAlias,
} from "./ai/provider.mjs";
import { GEMINI_FLASH_FAMILY, normalizeGeminiFlashPreference, resolveGeminiFlashWireModel } from "./model-family.mjs";

/**
 * @typedef {object} LlmConfig
 * @property {string} provider
 * @property {string} model
 * @property {string} apiKey
 * @property {string} baseUrl
 * @property {string} updatedAt
 * @property {string} [alias] the spelling the user picked ("local", "ollama") when it differs from provider
 */

/**
 * @typedef {object} RedactedLlmConfig
 * @property {string} provider
 * @property {string} alias
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
  };
}

/**
 * @param {LlmConfig} config
 * @returns {Promise<ActivePin>}
 */
export async function resolveActivePin(config) {
  const provider = normalizeProvider(config && config.provider) || asString(config && config.provider);
  const model = asString(config && config.model);
  return {
    provider,
    model,
    apiKey: asString(config && config.apiKey),
    baseUrl: asString(config && config.baseUrl),
    resolvedModel: provider === "gemini" ? resolveGeminiFlashWireModel(model) : model,
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
  const saved = await writeLlmConfig({ provider: rawProvider, model, apiKey, baseUrl }, env);
  res.json(redactLlmConfig(saved));
}
