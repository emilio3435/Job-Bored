#!/usr/bin/env node
/**
 * Probe every judge provider's live model catalog (npm run probe:judge-providers).
 *
 * Keys come from the environment (XAI_API_KEY, OPENROUTER_API_KEY,
 * OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY) with the saved judge
 * key standing in server-side, exactly as the app loads its lists — so a
 * PASS here means the onboarding dropdown and the Settings list work for
 * that provider. OLLAMA_BASE_URL overrides the local server address.
 * List endpoints only: the probe spends no completions.
 *
 * Exit 0 unless a provider FAILs; SKIP means no key (or no Ollama), not
 * breakage.
 */

import { pathToFileURL } from "node:url";
import { handlePostJudgeModels } from "../server/judge-models.mjs";

const PROVIDERS = [
  { token: "xai", envKey: "XAI_API_KEY" },
  { token: "openrouter", envKey: "OPENROUTER_API_KEY" },
  { token: "openai", envKey: "OPENAI_API_KEY" },
  { token: "anthropic", envKey: "ANTHROPIC_API_KEY" },
  { token: "gemini", envKey: "GEMINI_API_KEY" },
  { token: "local", envKey: "" },
];

/** @param {unknown} baseUrl @returns {string} */
function tagsUrl(baseUrl) {
  const raw = String(baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/+$/, "");
  return `${raw || "http://127.0.0.1:11434"}/api/tags`;
}

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/**
 * @param {{ token: string, envKey: string }} spec
 * @param {{ env: NodeJS.ProcessEnv, fetchImpl: typeof fetch, handlerEnv: NodeJS.ProcessEnv }} deps
 */
export async function probeOne(spec, { env, fetchImpl, handlerEnv }) {
  const started = Date.now();
  const apiKey = spec.envKey ? String(env[spec.envKey] || "").trim() : "";
  const baseUrl = spec.token === "local" ? String(env.OLLAMA_BASE_URL || "").trim() : "";
  // A silent Ollama is "not installed", not breakage: check directly so a
  // 502 from a RUNNING server still fails honestly below.
  if (spec.token === "local") {
    try {
      await fetchImpl(tagsUrl(baseUrl), { method: "GET", headers: {} });
    } catch {
      return {
        provider: spec.token, status: "SKIP", models: 0, recommended: "",
        ms: Date.now() - started, detail: `nothing listening at ${tagsUrl(baseUrl)}`,
      };
    }
  }
  const body = { provider: spec.token };
  if (apiKey) body.apiKey = apiKey;
  if (baseUrl) body.baseUrl = baseUrl;
  const res = mockRes();
  await handlePostJudgeModels({ body }, res, handlerEnv, { fetchImpl });
  const ms = Date.now() - started;
  if (res.statusCode === 200) {
    const models = res.body && Array.isArray(res.body.models) ? res.body.models : [];
    if (models.length === 0) {
      return { provider: spec.token, status: "FAIL", models: 0, recommended: "", ms, detail: "empty list" };
    }
    const recommended = res.body && typeof res.body.recommended === "string" ? res.body.recommended : "";
    return {
      provider: spec.token, status: "PASS", models: models.length, recommended, ms,
      detail: `${models.length} model${models.length === 1 ? "" : "s"}${recommended ? `, recommends ${recommended}` : ""} (${ms}ms)`,
    };
  }
  const error = res.body && typeof res.body.error === "string" ? res.body.error : `HTTP ${res.statusCode}`;
  if (res.statusCode === 400 && /API key to load models/.test(error)) {
    return {
      provider: spec.token, status: "SKIP", models: 0, recommended: "", ms,
      detail: `no key saved or set (${spec.envKey})`,
    };
  }
  return { provider: spec.token, status: "FAIL", models: 0, recommended: "", ms, detail: error };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, configPath?: string }} [options]
 * @returns {Promise<Array<{ provider: string, status: string, models: number, recommended: string, ms: number, detail: string }>>}
 */
export async function runProbe({ env = process.env, fetchImpl = globalThis.fetch, configPath = "" } = {}) {
  const handlerEnv = { ...env };
  if (configPath) handlerEnv.JOBBORED_LLM_CONFIG_PATH = configPath;
  const rows = [];
  for (const spec of PROVIDERS) {
    rows.push(await probeOne(spec, { env, fetchImpl, handlerEnv }));
  }
  return rows;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  const rows = await runProbe({});
  for (const row of rows) {
    console.log(`${row.provider.padEnd(10)} ${row.status.padEnd(4)} ${row.detail}`);
  }
  if (rows.every((row) => row.status !== "PASS")) {
    console.log("Set <PROVIDER>_API_KEY env vars or save keys in Settings to probe more.");
  }
  if (rows.some((row) => row.status === "FAIL")) process.exitCode = 1;
}
