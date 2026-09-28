import { loadLlmConfig } from "./llm-config.mjs";

const XAI_MODELS_URL = "https://api.x.ai/v1/models";
const XAI_BASE_URL = "https://api.x.ai/v1";

/** @typedef {Record<string, unknown>} XaiModel */

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

/** @param {XaiModel} model @returns {string[]} */
function modalitiesOf(model) {
  const values = [model.input_modalities, model.output_modalities, model.modalities, model.capabilities]
    .flatMap((value) => Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .map((value) => string(value).toLowerCase())
    .filter(Boolean);
  return values;
}

/** @param {XaiModel} model @returns {boolean} */
function isTextCapableGrok(model) {
  const id = string(model && model.id);
  const nonTextFamily = /(imagine|image|video|voice|audio|stt|tts|embed)/i;
  if (!/^grok-/i.test(id) || nonTextFamily.test(id)) return false;
  const metadata = `${string(model.type)} ${string(model.model_type)} ${string(model.task)}`.toLowerCase();
  if (nonTextFamily.test(metadata)) return false;
  const modalities = modalitiesOf(model);
  return modalities.length === 0 || modalities.some((modality) => /(^|[^a-z])text([^a-z]|$)/i.test(modality));
}

/** @param {unknown} payload @returns {Array<{ id: string, label: string, created: number }>} */
function normalizeModels(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload)
    ? /** @type {Record<string, unknown>} */ (payload)
    : {};
  /** @type {unknown[]} */
  const rows = Array.isArray(source.data)
    ? source.data
    : Array.isArray(source.models)
      ? source.models
      : [];
  const seen = new Set();
  /** @type {Array<{ id: string, label: string, created: number }>} */
  const models = [];
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const model = /** @type {XaiModel} */ (value);
    if (!isTextCapableGrok(model)) continue;
    const id = string(model.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, label: string(model.label) || id, created: createdValue(model.created) });
  }
  return models.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
}

/** @param {NodeJS.ProcessEnv} [env] @returns {string} */
function savedXaiKey(env) {
  const judge = /** @type {{ provider?: string, baseUrl?: string, apiKey?: string } | undefined} */ (loadLlmConfig(env)?.judge);
  const baseUrl = string(judge && judge.baseUrl).replace(/\/+$/, "");
  if (!judge || judge.provider !== "openai_compatible" || baseUrl !== XAI_BASE_URL) return "";
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
    ? /** @type {{ provider?: unknown, apiKey?: unknown }} */ (req.body)
    : null;
  if (!body || typeof body !== "object" || Array.isArray(body) || body.provider !== "xai") {
    res.status(400).json({ error: "Choose xAI to load Grok models." });
    return;
  }
  const apiKey = string(body.apiKey) || savedXaiKey(env);
  if (!apiKey) {
    res.status(400).json({ error: "Add your xAI API key to load models." });
    return;
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let upstream;
  try {
    upstream = await fetchImpl(XAI_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    res.status(502).json({ error: "Couldn't reach xAI: try again." });
    return;
  }

  if (upstream.status === 401) {
    res.status(401).json({ error: "That key didn't work: check it on the xAI console." });
    return;
  }
  if (!upstream.ok) {
    res.status(502).json({ error: "Couldn't load xAI models: try again." });
    return;
  }

  let payload;
  try {
    payload = await upstream.json();
  } catch {
    res.status(502).json({ error: "Couldn't load xAI models: try again." });
    return;
  }
  const models = normalizeModels(payload);
  const recommended = models.find((model) => /^grok-\d/i.test(model.id) && !/mini/i.test(model.id))?.id || null;
  res.json({ models, recommended });
}
