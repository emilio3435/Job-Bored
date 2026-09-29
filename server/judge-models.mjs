import { loadStoredLlmConfig } from "./llm-config.mjs";
import { GEMINI_API_BASE, geminiHeaders, normalizeProvider } from "./ai/provider.mjs";

const XAI_MODELS_URL = "https://api.x.ai/v1/models";
const XAI_BASE_URL = "https://api.x.ai/v1";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
/** A runaway cursor never costs more than five upstream lists. */
const MAX_CATALOG_PAGES = 5;

/** @typedef {Record<string, unknown>} CatalogModel */

/** @param {unknown} value @returns {string} */
function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** @param {unknown} value @returns {number} */
function createdValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim()) return numeric;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** @param {CatalogModel} model @returns {string[]} */
function modalitiesOf(model) {
  const values = [model.input_modalities, model.output_modalities, model.modalities, model.capabilities]
    .flatMap((value) => Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .map((value) => string(value).toLowerCase())
    .filter(Boolean);
  return values;
}

/** @param {CatalogModel} model @returns {boolean} */
function isTextCapableGrok(model) {
  const id = string(model && model.id);
  const nonTextFamily = /(imagine|image|video|voice|audio|stt|tts|embed)/i;
  if (!/^grok-/i.test(id) || nonTextFamily.test(id)) return false;
  const metadata = `${string(model.type)} ${string(model.model_type)} ${string(model.task)}`.toLowerCase();
  if (nonTextFamily.test(metadata)) return false;
  const modalities = modalitiesOf(model);
  return modalities.length === 0 || modalities.some((modality) => /(^|[^a-z])text([^a-z]|$)/i.test(modality));
}

const NON_TEXT_OPENAI = /(audio|realtime|image|embed|tts|transcribe|whisper|moderation)/i;

/**
 * One row extractor per catalog: the upstream id, a display label, and a
 * created stamp for newest-first lists. Null drops the row.
 * @typedef {(model: CatalogModel) => { id: string, label: string, created: number } | null} TakeRow
 */

/** @type {TakeRow} */
function takeXai(model) {
  if (!isTextCapableGrok(model)) return null;
  const id = string(model.id);
  if (!id) return null;
  return { id, label: string(model.label) || id, created: createdValue(model.created) };
}

/** @type {TakeRow} */
function takeOpenRouter(model) {
  const id = string(model.id);
  if (!id.includes("/")) return null;
  return { id, label: string(model.name) || id, created: 0 };
}

/** @type {TakeRow} */
function takeOpenAI(model) {
  const id = string(model.id);
  if (!/^gpt-/i.test(id) || NON_TEXT_OPENAI.test(id)) return null;
  return { id, label: id, created: createdValue(model.created) };
}

/** @type {TakeRow} */
function takeAnthropic(model) {
  const id = string(model.id);
  if (!id) return null;
  return { id, label: string(model.display_name) || id, created: createdValue(model.created_at) };
}

/** @type {TakeRow} */
function takeGemini(model) {
  const name = string(model.name);
  const id = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
  if (!id || !methods.includes("generateContent")) return null;
  return { id, label: string(model.displayName) || id, created: 0 };
}

/** @type {TakeRow} */
function takeLocal(model) {
  const id = string(model.name);
  if (!id) return null;
  return { id, label: id, created: 0 };
}

/**
 * @typedef {object} CatalogSpec
 * @property {string} label words for errors ("OpenAI")
 * @property {string} keyWords where a rejected key gets checked ("check it on OpenAI")
 * @property {boolean} keyRequired false for keyless lists (OpenRouter, local)
 * @property {(baseUrl: string) => string} listUrl
 * @property {(apiKey: string) => Record<string, string>} headers
 * @property {TakeRow} take
 * @property {boolean} newestFirst
 * @property {(models: Array<{ id: string }>) => string | null} recommend
 * @property {(url: string, payload: unknown) => string} nextUrl the next page's URL, or "" when done
 */

/** @param {unknown} payload @returns {Record<string, unknown> | null} */
function pageObject(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? /** @type {Record<string, unknown>} */ (payload)
    : null;
}

/** @param {unknown} baseUrl @returns {string} */
function ollamaTagsUrl(baseUrl) {
  const raw = string(baseUrl).replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/+$/, "");
  return `${raw || DEFAULT_OLLAMA_HOST}/api/tags`;
}

/** @param {Array<{ id: string }>} models @param {RegExp} cheap @returns {string | null} */
function recommendCheapOrFirst(models, cheap) {
  return models.find((model) => cheap.test(model.id))?.id || models[0]?.id || null;
}

/** @type {Record<string, CatalogSpec>} */
const CATALOGS = {
  xai: {
    label: "xAI",
    keyWords: "check it on the xAI console",
    keyRequired: true,
    listUrl: () => XAI_MODELS_URL,
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    take: takeXai,
    newestFirst: true,
    recommend: (models) => models.find((model) => /^grok-\d/i.test(model.id) && !/mini/i.test(model.id))?.id || null,
    nextUrl: () => "",
  },
  openrouter: {
    label: "OpenRouter",
    keyWords: "check it on OpenRouter",
    keyRequired: false,
    listUrl: () => OPENROUTER_MODELS_URL,
    headers: (apiKey) => {
      /** @type {Record<string, string>} */
      const headers = {};
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      return headers;
    },
    take: takeOpenRouter,
    newestFirst: false,
    recommend: (models) => models.some((model) => model.id === "openai/gpt-4o-mini")
      ? "openai/gpt-4o-mini"
      : models[0]?.id || null,
    nextUrl: () => "",
  },
  openai: {
    label: "OpenAI",
    keyWords: "check it on OpenAI",
    keyRequired: true,
    listUrl: () => OPENAI_MODELS_URL,
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    take: takeOpenAI,
    newestFirst: true,
    recommend: (models) => recommendCheapOrFirst(models, /mini/i),
    nextUrl: () => "",
  },
  anthropic: {
    label: "Anthropic",
    keyWords: "check it on Anthropic",
    keyRequired: true,
    listUrl: () => `${ANTHROPIC_MODELS_URL}?limit=100`,
    headers: (apiKey) => ({ "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }),
    take: takeAnthropic,
    newestFirst: true,
    recommend: (models) => recommendCheapOrFirst(models, /haiku/i),
    nextUrl: (url, payload) => {
      const page = pageObject(payload);
      if (!page || page.has_more !== true) return "";
      const rows = Array.isArray(page.data) ? page.data : [];
      const tail = rows.length ? rows[rows.length - 1] : null;
      const last = tail && typeof tail === "object" && !Array.isArray(tail)
        ? string(/** @type {Record<string, unknown>} */ (tail).id)
        : "";
      if (!last) return "";
      const next = new URL(url);
      next.searchParams.set("after_id", last);
      return next.toString();
    },
  },
  gemini: {
    label: "Gemini",
    keyWords: "check it on Gemini",
    keyRequired: true,
    listUrl: () => `${GEMINI_API_BASE}/models?pageSize=100`,
    headers: (apiKey) => geminiHeaders(apiKey),
    take: takeGemini,
    newestFirst: false,
    recommend: (models) => recommendCheapOrFirst(models, /flash/i),
    nextUrl: (url, payload) => {
      const token = string(pageObject(payload)?.nextPageToken);
      if (!token) return "";
      const next = new URL(url);
      next.searchParams.set("pageToken", token);
      return next.toString();
    },
  },
  local: {
    label: "Ollama",
    keyWords: "check that Ollama is running",
    keyRequired: false,
    listUrl: (baseUrl) => ollamaTagsUrl(baseUrl),
    headers: () => ({}),
    take: takeLocal,
    newestFirst: false,
    recommend: (models) => models[0]?.id || null,
    nextUrl: () => "",
  },
};

/**
 * @param {CatalogSpec} spec
 * @param {unknown[]} pages every fetched page, in order
 * @returns {Array<{ id: string, label: string, created: number }>}
 */
function normalizeCatalog(spec, pages) {
  const seen = new Set();
  /** @type {Array<{ id: string, label: string, created: number }>} */
  const models = [];
  for (const payload of pages) {
    const source = pageObject(payload) || {};
    /** @type {unknown[]} */
    const rows = Array.isArray(source.data)
      ? source.data
      : Array.isArray(source.models)
        ? source.models
        : [];
    for (const value of rows) {
      if (!value || typeof value !== "object") continue;
      const taken = spec.take(/** @type {CatalogModel} */ (value));
      if (!taken || seen.has(taken.id)) continue;
      seen.add(taken.id);
      models.push(taken);
    }
  }
  if (spec.newestFirst) models.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  return models;
}

/**
 * The stored judge key when the saved judge grades with this catalog's
 * provider: the xAI shape needs its endpoint too, the rest match by provider.
 * @param {string} provider
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function savedJudgeKey(provider, env) {
  const judge = /** @type {{ provider?: string, baseUrl?: string, apiKey?: string } | undefined} */ (loadStoredLlmConfig(env)?.judge);
  if (!judge) return "";
  if (provider === "xai") {
    const baseUrl = string(judge.baseUrl).replace(/\/+$/, "");
    if (judge.provider !== "openai_compatible" || baseUrl !== XAI_BASE_URL) return "";
    return string(judge.apiKey);
  }
  if (normalizeProvider(judge.provider) !== provider) return "";
  return string(judge.apiKey);
}

/** POST /api/llm-config/judge-models. Keys are used for the upstream request only. */
/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<void>}
 */
export async function handlePostJudgeModels(req, res, env = process.env, options = {}) {
  const body = req && req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? /** @type {{ provider?: unknown, apiKey?: unknown, baseUrl?: unknown }} */ (req.body)
    : null;
  const provider = body ? string(body.provider).toLowerCase() : "";
  const spec = CATALOGS[provider];
  if (!body || !spec) {
    res.status(400).json({ error: "That provider can't list models: type the model name instead." });
    return;
  }
  const baseUrl = string(body.baseUrl);
  if (provider === "local" && baseUrl) {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("non-http base URL");
    } catch {
      res.status(400).json({ error: "The base URL must start with http:// or https://." });
      return;
    }
  }
  const apiKey = provider === "local" ? "" : string(body.apiKey) || savedJudgeKey(provider, env);
  if (spec.keyRequired && !apiKey) {
    res.status(400).json({ error: `Add your ${spec.label} API key to load models.` });
    return;
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  // The first page failing is an error; a later page failing returns the
  // partial list — a shorter working list beats a dead dropdown.
  /** @type {unknown[]} */
  const pages = [];
  let url = spec.listUrl(baseUrl);
  for (let page = 0; page < MAX_CATALOG_PAGES && url; page += 1) {
    let upstream;
    try {
      upstream = await fetchImpl(url, {
        method: "GET",
        headers: spec.headers(apiKey),
      });
    } catch {
      if (page > 0) break;
      res.status(502).json({ error: `Couldn't reach ${spec.label}: try again.` });
      return;
    }

    if (upstream.status === 401 && page === 0) {
      res.status(401).json({ error: `That key didn't work: ${spec.keyWords}.` });
      return;
    }
    if (!upstream.ok) {
      if (page > 0) break;
      res.status(502).json({ error: `Couldn't load ${spec.label} models: try again.` });
      return;
    }

    let payload;
    try {
      payload = await upstream.json();
    } catch {
      if (page > 0) break;
      res.status(502).json({ error: `Couldn't load ${spec.label} models: try again.` });
      return;
    }
    pages.push(payload);
    url = spec.nextUrl(url, payload);
  }
  const models = normalizeCatalog(spec, pages);
  res.json({ models, recommended: spec.recommend(models) });
}
