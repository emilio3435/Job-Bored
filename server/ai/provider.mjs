/**
 * The one AI-provider module (BEAUDIT E15).
 *
 * - One provider enum. `local`, `ollama` and the other historical spellings
 *   are aliases of `openai_compatible`.
 * - Keys come from the llm.json pin only; nothing here reads the environment.
 * - The Gemini key travels in the `x-goog-api-key` header, never the URL.
 * - Every call merges the caller's signal with a timeout (AbortSignal.any).
 * - Every failure is a ProviderApiError whose message never carries the
 *   upstream body.
 *
 * Features pass messages and an optional JSON schema; the transport per
 * provider lives here. The worker's chat-provider re-exports this module.
 */

/** @typedef {"gemini" | "openai" | "anthropic" | "openrouter" | "openai_compatible"} ProviderName */
/** @typedef {{ role: "system" | "user" | "assistant", content: string }} ChatMessage */
/**
 * @typedef {object} PinLike
 * @property {unknown} [provider]
 * @property {unknown} [model]
 * @property {unknown} [apiKey]
 * @property {unknown} [baseUrl]
 */
/**
 * @typedef {object} ResolvedProvider
 * @property {ProviderName | ""} provider
 * @property {string} alias
 * @property {string} model
 * @property {string} apiKey
 * @property {string} baseUrl
 * @property {string} endpoint
 * @property {boolean} configured
 * @property {string} reason
 */

/** @type {readonly ProviderName[]} */
export const PROVIDERS = Object.freeze([
  "gemini",
  "openai",
  "anthropic",
  "openrouter",
  "openai_compatible",
]);

/** @type {Readonly<Record<string, ProviderName>>} */
const ALIASES = Object.freeze({
  gemini: "gemini",
  google: "gemini",
  openai: "openai",
  open_ai: "openai",
  anthropic: "anthropic",
  openrouter: "openrouter",
  open_router: "openrouter",
  openai_compatible: "openai_compatible",
  openai_compat: "openai_compatible",
  compatible: "openai_compatible",
  local: "openai_compatible",
  local_openai: "openai_compatible",
  local_llm: "openai_compatible",
  ollama: "openai_compatible",
});

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
export const MAX_PROVIDER_TIMEOUT_MS = 120_000;
export const DEFAULT_ROUTE_DEADLINE_MS = 45_000;

/** @param {unknown} raw */
function canonicalToken(raw) {
  return String(raw == null ? "" : raw)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * Map any spelling a pin, env var or browser has used to the one enum.
 * Returns "" for anything this module cannot call (e.g. "webhook").
 * @param {unknown} raw
 * @returns {ProviderName | ""}
 */
export function normalizeProvider(raw) {
  return ALIASES[canonicalToken(raw)] || "";
}

/**
 * The user-facing alias a pin was saved under ("local", "ollama"), or "" when
 * the spelling is already canonical.
 * @param {unknown} raw
 */
export function providerAlias(raw) {
  const token = canonicalToken(raw);
  const provider = ALIASES[token];
  if (!provider || token === provider) return "";
  if (token === "local" || token === "ollama" || token === "local_openai" || token === "local_llm") {
    return token === "ollama" ? "ollama" : "local";
  }
  return "";
}

/** @param {ProviderName | ""} provider */
export function providerDisplayName(provider) {
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "openai_compatible") return "OpenAI-compatible";
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "gemini") return "Gemini";
  return "LLM provider";
}

/** @param {unknown} value */
function str(value) {
  return String(value == null ? "" : value).trim();
}

/** @param {unknown} baseUrl */
export function chatCompletionsUrl(baseUrl) {
  const base = str(baseUrl).replace(/\/+$/, "");
  if (!base) return "";
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

/** @param {string} model */
export function geminiGenerateContentUrl(model) {
  return `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
}

/**
 * Headers for any Gemini REST call: the key goes in a header so it cannot
 * reach URL logs (B17, E14).
 * @param {string} apiKey
 */
export function geminiHeaders(apiKey) {
  return { "content-type": "application/json", "x-goog-api-key": str(apiKey) };
}

/** @param {unknown} value */
export function isHttpUrl(value) {
  try {
    const url = new URL(str(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Resolve a pin into a callable provider. The key comes from the pin only.
 * @param {PinLike | null | undefined} pin
 * @returns {ResolvedProvider}
 */
export function resolveProvider(pin) {
  const record = pin && typeof pin === "object" ? pin : {};
  const provider = normalizeProvider(record.provider);
  const alias = providerAlias(record.provider);
  const model = str(record.model);
  const apiKey = str(record.apiKey);
  let baseUrl = str(record.baseUrl);
  let endpoint = "";
  let reason = "";
  if (!provider) {
    reason = record.provider ? `Unsupported AI provider "${str(record.provider)}".` : "No AI provider configured.";
  } else if (provider === "gemini") {
    endpoint = model ? geminiGenerateContentUrl(model) : "";
    if (!apiKey) reason = "Missing API key. Save a key in Settings.";
  } else if (provider === "anthropic") {
    endpoint = ANTHROPIC_MESSAGES_URL;
    if (!apiKey) reason = "Missing API key. Save a key in Settings.";
  } else if (provider === "openai") {
    baseUrl = baseUrl || DEFAULT_OPENAI_BASE_URL;
    endpoint = chatCompletionsUrl(baseUrl);
    if (!apiKey) reason = "Missing API key. Save a key in Settings.";
  } else if (provider === "openrouter") {
    baseUrl = baseUrl || DEFAULT_OPENROUTER_BASE_URL;
    endpoint = chatCompletionsUrl(baseUrl);
    if (!apiKey) reason = "Missing API key. Save a key in Settings.";
  } else {
    endpoint = chatCompletionsUrl(baseUrl);
    if (!baseUrl || !model) {
      reason = "Missing OpenAI-compatible base URL or model. Save them in Settings.";
    }
  }
  if (!reason && !model) reason = "Missing model. Save a model in Settings.";
  return { provider, alias, model, apiKey, baseUrl, endpoint, configured: !reason, reason };
}

/**
 * True when a pin can drive a call on its own: keyed providers need a key,
 * openai_compatible (Local, Ollama) needs a base URL instead.
 * @param {PinLike | null | undefined} pin
 */
export function pinIsUsable(pin) {
  return resolveProvider(pin).configured;
}

/* ─── Signals ─────────────────────────────────────────────────────────── */

/** @param {unknown} ms */
export function clampTimeoutMs(ms) {
  const n = Number(ms);
  if (Number.isFinite(n) && n > 0) return Math.min(Math.trunc(n), MAX_PROVIDER_TIMEOUT_MS);
  return DEFAULT_PROVIDER_TIMEOUT_MS;
}

/**
 * @param {AbortSignal | undefined | null} signal
 * @param {number} [timeoutMs]
 */
export function composeSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(clampTimeoutMs(timeoutMs));
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/**
 * A route-scoped signal: aborts when the client goes away before the response
 * finishes, or when the route deadline passes (E11). Pass `Infinity` for a
 * long-running stream (the rescore SSE) that ends only when the client leaves.
 * @param {{ once?: Function } | null | undefined} req
 * @param {{ once?: Function, writableFinished?: boolean } | null | undefined} res
 * @param {number} [deadlineMs]
 */
export function routeDeadlineSignal(req, res, deadlineMs = DEFAULT_ROUTE_DEADLINE_MS) {
  const controller = new AbortController();
  const onClose = () => {
    if (res && res.writableFinished) return;
    if (!controller.signal.aborted) {
      const error = new Error("Client disconnected");
      error.name = "AbortError";
      controller.abort(error);
    }
  };
  if (res && typeof res.once === "function") res.once("close", onClose);
  else if (req && typeof req.once === "function") req.once("close", onClose);
  const ms = Number(deadlineMs);
  if (ms === Infinity) return controller.signal;
  const deadline = AbortSignal.timeout(Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_ROUTE_DEADLINE_MS);
  return AbortSignal.any([controller.signal, deadline]);
}

/* ─── Errors ──────────────────────────────────────────────────────────── */

const RATE_LIMIT_CODES = new Set([
  "resource_exhausted",
  "rate_limit",
  "rate_limit_exceeded",
  "too_many_requests",
]);

const RETRYABLE_CODES = new Set([
  ...RATE_LIMIT_CODES,
  "deadline_exceeded",
  "internal",
  "overloaded",
  "overloaded_error",
  "service_unavailable",
  "temporarily_unavailable",
  "timeout",
  "unavailable",
]);

/** @param {unknown} value */
function normalizeCode(value) {
  if (value == null) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** @param {unknown} status */
export function isRetryableStatus(status) {
  return (
    typeof status === "number" &&
    Number.isInteger(status) &&
    (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)
  );
}

/**
 * One error type for every provider failure. `message` never includes the
 * upstream body; only the status, the provider's error code and the class.
 */
export class ProviderApiError extends Error {
  /**
   * @param {string} message
   * @param {{ provider: ProviderName | "", upstreamStatus?: number, providerCode?: string, classification?: string, retryable?: boolean, cause?: unknown }} fields
   */
  constructor(message, fields) {
    super(message, fields.cause !== undefined ? { cause: fields.cause } : undefined);
    this.name = "ProviderApiError";
    /** @type {ProviderName | ""} */
    this.provider = fields.provider;
    /** @type {number | undefined} */
    this.upstreamStatus = fields.upstreamStatus;
    /** @type {string | undefined} */
    this.providerCode = fields.providerCode || undefined;
    /** @type {string} */
    this.classification = fields.classification || "upstream";
    /** @type {boolean} */
    this.retryable = Boolean(fields.retryable);
  }
}

/** @param {unknown} payload */
function extractProviderCode(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = /** @type {Record<string, unknown>} */ (payload);
  const root =
    record.error && typeof record.error === "object" && !Array.isArray(record.error)
      ? /** @type {Record<string, unknown>} */ (record.error)
      : record;
  return normalizeCode(root.status || root.code || root.type || "");
}

/**
 * @param {ProviderName | ""} provider
 * @param {number} upstreamStatus
 * @param {unknown} payload parsed upstream body (read for the error code only)
 */
export function providerHttpError(provider, upstreamStatus, payload) {
  const code = extractProviderCode(payload);
  const status = Number.isInteger(upstreamStatus) ? upstreamStatus : undefined;
  const rateLimited = status === 429 || (code ? RATE_LIMIT_CODES.has(code) : false);
  return new ProviderApiError(
    status ? `${providerDisplayName(provider)} HTTP ${status}` : `${providerDisplayName(provider)} request failed`,
    {
      provider,
      upstreamStatus: status,
      providerCode: code,
      classification: rateLimited ? "rate_limit" : "upstream",
      retryable: isRetryableStatus(status) || (code ? RETRYABLE_CODES.has(code) : false),
    },
  );
}

/** @param {unknown} cause */
function isTimeoutLike(cause) {
  return Boolean(cause && typeof cause === "object" && "name" in cause && cause.name === "TimeoutError");
}

/** @param {unknown} cause */
function isAbortLike(cause) {
  return Boolean(cause && typeof cause === "object" && "name" in cause && cause.name === "AbortError");
}

/**
 * @param {ProviderName | ""} provider
 * @param {unknown} cause
 * @param {AbortSignal} [callerSignal]
 */
export function providerRequestError(provider, cause, callerSignal) {
  const label = providerDisplayName(provider);
  const callerAborted = Boolean(callerSignal && callerSignal.aborted) && !isTimeoutLike(callerSignal && callerSignal.reason);
  if (callerAborted) {
    return new ProviderApiError(`${label} request cancelled`, {
      provider,
      providerCode: "aborted",
      classification: "cancelled",
      retryable: false,
      cause,
    });
  }
  const timedOut = isTimeoutLike(cause) || isAbortLike(cause);
  return new ProviderApiError(timedOut ? `${label} request timed out` : `${label} request failed`, {
    provider,
    providerCode: timedOut ? "timeout" : "network_error",
    classification: "upstream",
    retryable: true,
    cause,
  });
}

/* ─── Schema helpers ──────────────────────────────────────────────────── */

const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "$schema",
  "$id",
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
]);

/** @param {unknown} schema */
export function toGeminiSchema(schema) {
  /** @param {unknown} node @returns {unknown} */
  function clean(node) {
    if (Array.isArray(node)) return node.map(clean);
    if (!node || typeof node !== "object") return node;
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return clean(schema);
}

/** @param {unknown} model */
export function openAIUsesMaxCompletionTokens(model) {
  const m = str(model).toLowerCase();
  return m.startsWith("gpt-5") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

/** @param {unknown} model */
export function openAISupportsStrictSchema(model) {
  const m = str(model).toLowerCase();
  return (
    m.startsWith("gpt-5") ||
    m.includes("gpt-4o") ||
    m.includes("gpt-4-turbo") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4")
  );
}

/* ─── Text extraction ─────────────────────────────────────────────────── */

/** @param {unknown} v @returns {v is Record<string, any>} */
function isRecord(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** @param {unknown} payload */
export function extractGeminiText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return "";
  for (const candidate of payload.candidates) {
    const parts = isRecord(candidate) && isRecord(candidate.content) && Array.isArray(candidate.content.parts)
      ? candidate.content.parts
      : [];
    const text = parts
      .map((/** @type {unknown} */ p) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

/** @param {unknown} payload */
export function extractOpenAiText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";
  for (const choice of payload.choices) {
    const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : undefined;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .map((/** @type {unknown} */ p) => (typeof p === "string" ? p : isRecord(p) && typeof p.text === "string" ? p.text : ""))
        .join("");
      if (text.trim()) return text;
    }
  }
  return "";
}

/** @param {unknown} payload */
export function extractAnthropicText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.content)) return "";
  return payload.content
    .map((/** @type {unknown} */ p) =>
      isRecord(p) && (p.type === undefined || p.type === "text") && typeof p.text === "string" ? p.text : "",
    )
    .join("");
}

/* ─── chat() ──────────────────────────────────────────────────────────── */

/**
 * @param {ChatMessage[]} messages
 */
function splitSystem(messages) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => str(m.content))
    .filter(Boolean)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  return { system, rest };
}

/**
 * @typedef {object} ChatInput
 * @property {PinLike | ResolvedProvider} [pin] the llm.json pin (or an already resolved provider)
 * @property {ChatMessage[]} messages
 * @property {Record<string, unknown>} [schema] JSON schema for a structured reply
 * @property {string} [schemaName]
 * @property {AbortSignal} [signal] the caller's (request) signal
 * @property {number} [timeoutMs]
 * @property {number} [maxTokens]
 * @property {number} [temperature]
 * @property {typeof globalThis.fetch} [fetchImpl]
 * @property {string} [endpoint] overrides the resolved endpoint (worker configs carry their own)
 */

/**
 * @typedef {object} ChatResult
 * @property {string} text
 * @property {unknown} payload
 * @property {ProviderName} provider
 * @property {string} model
 */

/**
 * @param {ChatInput} input
 * @returns {Promise<ChatResult>}
 */
export async function chat(input) {
  const resolved =
    input.pin && "configured" in input.pin && "endpoint" in input.pin
      ? /** @type {ResolvedProvider} */ (input.pin)
      : resolveProvider(/** @type {PinLike} */ (input.pin));
  const provider = resolved.provider;
  if (!provider) {
    throw new ProviderApiError(resolved.reason || "No AI provider configured.", {
      provider: "",
      providerCode: "unconfigured",
      classification: "config",
      retryable: false,
    });
  }
  const model = resolved.model;
  const endpoint = str(input.endpoint) || resolved.endpoint;
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const maxTokens = Number.isFinite(Number(input.maxTokens)) && Number(input.maxTokens) > 0 ? Math.trunc(Number(input.maxTokens)) : 1024;
  const temperature = Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.1;
  const schema = input.schema;
  const { system, rest } = splitSystem(messages);

  /** @type {Record<string, string>} */
  let headers;
  /** @type {Record<string, unknown>} */
  let body;
  if (provider === "gemini") {
    headers = geminiHeaders(resolved.apiKey);
    body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: rest.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(schema ? { responseMimeType: "application/json", responseSchema: toGeminiSchema(schema) } : {}),
      },
    };
  } else if (provider === "anthropic") {
    headers = {
      "content-type": "application/json",
      "x-api-key": resolved.apiKey,
      "anthropic-version": "2023-06-01",
    };
    body = {
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: rest.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      ...(schema ? { output_config: { format: { type: "json_schema", schema } } } : {}),
    };
  } else {
    // Lowercase names: fetch treats them case-insensitively, and one spelling
    // keeps the server and worker wire identical.
    headers = { "content-type": "application/json" };
    if (resolved.apiKey) headers.authorization = `Bearer ${resolved.apiKey}`;
    const limitKey = provider === "openai" && openAIUsesMaxCompletionTokens(model) ? "max_completion_tokens" : "max_tokens";
    /** @type {Record<string, unknown> | undefined} */
    let responseFormat;
    if (schema && provider === "openai") {
      responseFormat = openAISupportsStrictSchema(model)
        ? { type: "json_schema", json_schema: { name: str(input.schemaName) || "response", strict: true, schema } }
        : { type: "json_object" };
    }
    body = {
      model,
      messages: [...(system ? [{ role: "system", content: system }] : []), ...rest],
      ...(responseFormat ? { response_format: responseFormat } : {}),
      temperature,
      [limitKey]: maxTokens,
    };
  }

  const fetchImpl = input.fetchImpl || globalThis.fetch;
  let resp;
  try {
    resp = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: composeSignal(input.signal, input.timeoutMs),
    });
  } catch (error) {
    throw providerRequestError(provider, error, input.signal);
  }
  /** @type {unknown} */
  let payload = null;
  try {
    // json() first: test doubles and some fetch shims implement only json().
    if (typeof resp.json === "function") {
      payload = await resp.json();
    } else if (typeof (/** @type {{ text?: unknown }} */ (resp)).text === "function") {
      const raw = await resp.text();
      payload = raw ? JSON.parse(raw) : null;
    }
  } catch {
    payload = null;
  }
  if (!resp.ok) throw providerHttpError(provider, resp.status, payload);
  const text =
    provider === "gemini"
      ? extractGeminiText(payload)
      : provider === "anthropic"
        ? extractAnthropicText(payload)
        : extractOpenAiText(payload);
  return { text, payload, provider, model };
}
