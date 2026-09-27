const GEMINI_GENERATE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const LOCAL_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 60_000;
const TEMPERATURE = 0.4;
// The writer emits a full cover letter plus a full tailored resume in one
// JSON blob. 4096 truncated that routinely once the resolved model spent
// part of the budget on thinking (the API counts thinking tokens toward
// max_output_tokens), so the base matches the profile drafter's 8192 and a
// single truncation retry may escalate once to the hard cap below.
const MAX_OUTPUT_TOKENS = 8192;
const MAX_OUTPUT_TOKENS_TRUNCATED_RETRY = 16384;

const WRITER_SYSTEM_PROMPT = [
  "Rewrite the candidate's materials for this JD.",
  "The candidate's resume below is the only source of facts: their name, contact details, employers, titles, dates, education, and metrics come from it and nowhere else.",
  "Freeze employers, titles, dates, and metrics — never invent a role or change those facts.",
  "Return JSON only matching the spec schema.",
  "No HTML/CSS in any field.",
  "Schema:",
  JSON.stringify({
    letter: {
      date: "",
      company: "",
      companyAddr: "",
      role: "",
      hiringManager: "",
      hook: "",
      whyThem: "",
      whyMe: "",
      whyNow: "",
      closing: "",
      flourish: "",
    },
    resume: {
      header: { name: "", headline: "", contact: [""] },
      summary: { opener: "", body: "" },
      roles: [{ id: "employer-slug", company: "", title: "", dates: "", location: "", bullets: [""] }],
      education: [""],
      skills: [""],
    },
  }),
].join(" ");

/**
 * @typedef {object} LetterJson
 * @property {string} [date]
 * @property {string} [company]
 * @property {string} [companyAddr]
 * @property {string} [role]
 * @property {string} [hiringManager]
 * @property {string} [hook]
 * @property {string} [whyThem]
 * @property {string} [whyMe]
 * @property {string} [whyNow]
 * @property {string} [closing]
 * @property {string} [flourish]
 */

/**
 * @typedef {object} ResumeSummary
 * @property {string} [opener]
 * @property {string} [body]
 */

/**
 * @typedef {object} ResumeRole
 * @property {string} id
 * @property {string} [company]
 * @property {string} [title]
 * @property {string} [dates]
 * @property {string} [location]
 * @property {string[]} bullets
 */

/**
 * @typedef {object} ResumeJson
 * @property {ResumeSummary} [summary]
 * @property {{ name?: string, headline?: string, contact?: string[] }} [header]
 * @property {ResumeRole[]} [roles]
 * @property {string[]} [education]
 * @property {string[]} [skills]
 * @property {string[]} [capabilitiesOrder]
 * @property {string[]} [stackEmphasis]
 */

/**
 * @typedef {object} WriterJson
 * @property {LetterJson} letter
 * @property {ResumeJson} resume
 */

/**
 * @typedef {object} WriterPin
 * @property {string} [provider]
 * @property {string} [model]
 * @property {string} resolvedModel
 * @property {string} apiKey
 * @property {string} [baseUrl]
 */

/**
 * @typedef {object} HttpResponseLike
 * @property {boolean} [ok]
 * @property {number} [status]
 * @property {() => Promise<unknown>} [json]
 * @property {() => Promise<string>} [text]
 */

/**
 * @typedef {object} WriterInput
 * @property {WriterPin} pin
 * @property {string} jdText
 * @property {string} masterResumeHtml TEST-ONLY sample layout; "" in production
 * @property {string} [resumeText] the user's own resume, plain text — the source of facts
 * @property {unknown} [voiceSamples]
 * @property {(input: string | URL, init?: RequestInit) => Promise<HttpResponseLike>} fetchImpl
 * @property {number} [timeoutMs]
 * @property {number[]} [letterWords] the template family's letter body band
 * @property {string} [systemPrompt] v3 narrow calls: replaces the wide writer prompt
 * @property {string} [userText] v3 narrow calls: replaces the assembled user prompt
 * @property {number} [maxOutputTokens] v3 narrow calls: per-stage output cap
 */

/**
 * @typedef {WriterInput & { current: WriterJson, scorecard: object }} EditorInput
 */

export class WriterJsonError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = "WriterJsonError";
    /** @type {string | undefined} machine-readable failure class (`writer_truncated` | `writer_blocked`) */
    this.code = undefined;
    /** @type {string | undefined} normalized provider that produced the failure */
    this.provider = undefined;
    /** @type {string | undefined} raw finish/stop signal when one was observed */
    this.finishReason = undefined;
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {string} text
 * @returns {string}
 */
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) {
    throw new WriterJsonError("WriterJsonError: no JSON object found");
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new WriterJsonError("WriterJsonError: unterminated JSON object");
}

/**
 * Extract the first `{...}` block, parse it, and require a plain object.
 * Each v3 stage validates the shape against its own schema after this.
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseStageJson(text) {
  const source = typeof text === "string" ? text : "";
  const block = extractFirstJsonObject(source);
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch (cause) {
    throw new WriterJsonError("WriterJsonError: JSON parse failed", { cause });
  }
  if (!isPlainObject(parsed)) {
    throw new WriterJsonError("WriterJsonError: expected a JSON object");
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * Extract the first `{...}` block, parse it, and require `letter` + `resume` objects.
 *
 * @param {string} text
 * @returns {WriterJson}
 */
export function parseWriterJson(text) {
  const source = typeof text === "string" ? text : "";
  const block = extractFirstJsonObject(source);
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch (cause) {
    throw new WriterJsonError("WriterJsonError: JSON parse failed", { cause });
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.letter) || !isPlainObject(parsed.resume)) {
    throw new WriterJsonError("WriterJsonError: expected letter and resume objects");
  }
  return /** @type {WriterJson} */ (parsed);
}

/**
 * @param {WriterInput} input
 * @returns {string}
 */
function systemText(input) {
  return typeof input.systemPrompt === "string" && input.systemPrompt
    ? input.systemPrompt
    : WRITER_SYSTEM_PROMPT;
}

/**
 * @param {WriterInput} input
 * @returns {number}
 */
function maxTokens(input) {
  return typeof input.maxOutputTokens === "number" &&
    Number.isFinite(input.maxOutputTokens) &&
    input.maxOutputTokens > 0
    ? Math.floor(input.maxOutputTokens)
    : MAX_OUTPUT_TOKENS;
}

/**
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @returns {string}
 */
function buildUserPrompt(input, extraUserText) {
  /* v3 narrow calls compose their own user text; the legacy assembly below
   * serves the wide writer/editor path only. */
  if (typeof input.userText === "string") {
    return extraUserText ? `${input.userText}\n\n${extraUserText}` : input.userText;
  }
  const parts = [`Job description:\n${input.jdText ?? ""}`];
  if (input.resumeText) {
    parts.push(`Candidate's resume (their own words; the only source of facts):\n${input.resumeText}`);
  }
  if (input.masterResumeHtml) {
    parts.push(`Resume layout HTML (fill its role ids):\n${input.masterResumeHtml}`);
  }
  if (input.voiceSamples != null && !(Array.isArray(input.voiceSamples) && input.voiceSamples.length === 0)) {
    parts.push(`Voice samples:\n${JSON.stringify(input.voiceSamples)}`);
  }
  if (Array.isArray(input.letterWords) && input.letterWords.length === 2) {
    parts.push(
      `Cover letter length: the letter's paragraph fields (hook, whyThem, whyMe, whyNow, closing, flourish) total ${input.letterWords[0]}–${input.letterWords[1]} words. Leave a field empty rather than pad.`,
    );
  }
  if (extraUserText) parts.push(extraUserText);
  return parts.join("\n\n");
}

/**
 * @param {"gemini" | "openai" | "openrouter" | "local" | "anthropic" | "webhook"} provider
 * @returns {string}
 */
function writerProviderLabel(provider) {
  if (provider === "openai") return "OpenAI";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "webhook") return "Webhook";
  if (provider === "local") return "Local";
  return "Gemini";
}

/**
 * @param {"gemini" | "openai" | "openrouter" | "local" | "anthropic" | "webhook"} provider
 * @param {string} finish the raw finish/stop signal, or "" when none was sent
 * @returns {string} the truncation signal, or "" when the stop was not a budget cut
 */
function truncationSignal(provider, finish) {
  if (provider === "gemini") return finish === "MAX_TOKENS" ? finish : "";
  if (provider === "anthropic") return finish === "max_tokens" ? finish : "";
  if (provider === "webhook") return "";
  return finish === "length" ? finish : "";
}

/**
 * @param {"gemini" | "openai" | "openrouter" | "local" | "anthropic" | "webhook"} provider
 * @returns {string}
 */
function finishSignalName(provider) {
  if (provider === "gemini") return "finishReason";
  if (provider === "anthropic") return "stop_reason";
  return "finish_reason";
}

/**
 * Mirror of profile-from-resume's truncatedDraftError, keeping the writer's
 * error class stable for existing catchers.
 *
 * @param {"gemini" | "openai" | "openrouter" | "local" | "anthropic" | "webhook"} provider
 * @param {string} signalName
 * @param {string} signalValue
 * @returns {WriterJsonError}
 */
function truncatedWriterError(provider, signalName, signalValue) {
  const err = new WriterJsonError(
    `WriterJsonError: ${writerProviderLabel(provider)} cut the draft off at its output limit (${signalName} ${signalValue}). Try a shorter resume, or pick a larger model in Settings.`,
  );
  err.code = "writer_truncated";
  err.provider = provider;
  err.finishReason = signalValue;
  return err;
}

/**
 * Non-budget Gemini stops that fail fast: retrying a block is pointless.
 * Unknown or empty finishes still take the parse path so tolerant providers
 * and older doubles keep working.
 */
const GEMINI_BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "MALFORMED_RESPONSE",
]);

/**
 * @param {"gemini" | "openai" | "openrouter" | "local" | "anthropic" | "webhook"} provider
 * @param {string} finish the raw finish/stop signal, or "" when none was sent
 * @returns {string} the blocking signal, or "" when the stop was not a block
 */
function blockedSignal(provider, finish) {
  if (provider === "gemini") return GEMINI_BLOCKED_FINISH_REASONS.has(finish) ? finish : "";
  return "";
}

/**
 * @param {"gemini" | "openai" | "openrouter" | "local" | "anthropic" | "webhook"} provider
 * @param {string} signalName
 * @param {string} signalValue
 * @returns {WriterJsonError}
 */
function blockedWriterError(provider, signalName, signalValue) {
  const err = new WriterJsonError(
    `WriterJsonError: ${writerProviderLabel(provider)} stopped the draft before completion (${signalName} ${signalValue}). Rephrase the inputs and retry, or pick another model in Settings.`,
  );
  err.code = "writer_blocked";
  err.provider = provider;
  err.finishReason = signalValue;
  return err;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isUnterminatedJsonError(err) {
  return err instanceof WriterJsonError && /unterminated JSON object/.test(err.message);
}

/**
 * @param {unknown} value
 * @returns {"gemini" | "openai" | "openrouter" | "local" | "anthropic" | "webhook"}
 */
function normalizeWriterProvider(value) {
  const raw = String(value || "gemini")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (raw === "openai") return "openai";
  if (raw === "openrouter") return "openrouter";
  if (raw === "anthropic") return "anthropic";
  if (raw === "webhook") return "webhook";
  if (raw === "local" || raw === "openai_compatible" || raw === "openai_compat") {
    return "local";
  }
  return "gemini";
}

/**
 * @param {unknown} baseUrl
 * @returns {string}
 */
function buildChatCompletionsUrl(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

/**
 * @param {"openai" | "openrouter" | "local"} provider
 * @param {string} baseUrl
 * @returns {string}
 */
function chatBaseUrlFor(provider, baseUrl) {
  if (baseUrl) return baseUrl;
  if (provider === "openai") return OPENAI_DEFAULT_BASE_URL;
  if (provider === "openrouter") return OPENROUTER_DEFAULT_BASE_URL;
  return LOCAL_DEFAULT_BASE_URL;
}

/**
 * @param {unknown} data
 * @returns {{ text: string, finish: string }}
 */
function textFromGeminiResponse(data) {
  if (!isPlainObject(data)) return { text: "", finish: "" };
  const candidates = data.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return { text: "", finish: "" };
  const first = candidates[0];
  if (!isPlainObject(first)) return { text: "", finish: "" };
  const finish = typeof first.finishReason === "string" ? first.finishReason : "";
  const content = first.content;
  if (!isPlainObject(content)) return { text: "", finish };
  const parts = content.parts;
  if (!Array.isArray(parts)) return { text: "", finish };
  // Ignore thought-marked parts so only answer text reaches the draft parser.
  const text = parts
    .map((part) =>
      isPlainObject(part) && part.thought !== true && typeof part.text === "string" ? part.text : "",
    )
    .join("");
  return { text, finish };
}

/**
 * @param {unknown} data
 * @returns {{ text: string, finish: string }}
 */
function textFromChatCompletions(data) {
  if (!isPlainObject(data)) return { text: "", finish: "" };
  const choices = data.choices;
  if (!Array.isArray(choices) || !choices.length) return { text: "", finish: "" };
  const first = choices[0];
  if (!isPlainObject(first)) return { text: "", finish: "" };
  const finish = typeof first.finish_reason === "string" ? first.finish_reason : "";
  const message = first.message;
  if (!isPlainObject(message)) return { text: "", finish };
  const text = typeof message.content === "string" ? message.content : "";
  return { text, finish };
}

/**
 * @param {unknown} data
 * @returns {{ text: string, finish: string }}
 */
function textFromAnthropic(data) {
  if (!isPlainObject(data)) return { text: "", finish: "" };
  const finish = typeof data.stop_reason === "string" ? data.stop_reason : "";
  if (!Array.isArray(data.content)) return { text: "", finish };
  const text = data.content
    .map((block) =>
      isPlainObject(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("");
  return { text, finish };
}

/**
 * Webhooks carry no standard stop signal, so finish is always "".
 *
 * @param {unknown} data
 * @returns {{ text: string, finish: string }}
 */
function textFromWebhook(data) {
  if (typeof data === "string") return { text: data, finish: "" };
  if (!isPlainObject(data)) return { text: "", finish: "" };
  if (typeof data.text === "string") return { text: data.text, finish: "" };
  if (isPlainObject(data.letter) && isPlainObject(data.resume)) {
    return { text: JSON.stringify(data), finish: "" };
  }
  return { text: "", finish: "" };
}

/**
 * @param {HttpResponseLike | null | undefined} resp
 * @returns {Promise<unknown>}
 */
async function readJsonBody(resp) {
  if (resp && typeof resp.json === "function") {
    return resp.json().catch(() => ({}));
  }
  if (resp && typeof resp.text === "function") {
    const raw = await resp.text().catch(() => "");
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return {};
}

/**
 * @param {HttpResponseLike | null | undefined} resp
 * @param {string} label
 */
function throwIfHttpError(resp, label) {
  if (!resp || resp.ok === false) {
    const status = resp && typeof resp.status === "number" ? resp.status : 0;
    throw new Error(`${label} HTTP ${status}`);
  }
}

/**
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @param {number} maxTokens
 * @returns {Promise<{ text: string, finish: string }>}
 */
async function generateGemini(input, extraUserText, maxTokens) {
  const pin = input.pin;
  const resolvedModel = String(pin.resolvedModel || "").trim();
  const apiKey = String(pin.apiKey || "");
  if (!resolvedModel) {
    throw new Error("pin.resolvedModel is required");
  }
  // B17: the key travels in x-goog-api-key, never in the URL, where proxies
  // and access logs would record it.
  const url = `${GEMINI_GENERATE_URL}/${encodeURIComponent(resolvedModel)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemText(input) }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(input, extraUserText) }] }],
    // responseMimeType without responseSchema: property-less OBJECT nodes
    // are rejected by the generateContent validator, and an open object
    // cannot be expressed on that field — JSON syntax comes from the mime
    // type, shape from the prompt plus the parser.
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  };
  const resp = await input.fetchImpl(url, {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json", "x-goog-api-key": apiKey }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  const data = await readJsonBody(resp);
  throwIfHttpError(resp, "Gemini");
  return textFromGeminiResponse(data);
}

/**
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @param {"openai" | "openrouter" | "local"} provider
 * @param {number} maxTokens
 * @returns {Promise<{ text: string, finish: string }>}
 */
async function generateOpenAICompatible(input, extraUserText, provider, maxTokens) {
  const pin = input.pin;
  const resolvedModel = String(pin.resolvedModel || "").trim();
  const apiKey = String(pin.apiKey || "");
  if (!resolvedModel) {
    throw new Error("pin.resolvedModel is required");
  }
  const url = buildChatCompletionsUrl(chatBaseUrlFor(provider, String(pin.baseUrl || "").trim()));
  if (!url) {
    throw new Error(`${provider} baseUrl is required`);
  }
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = {
    model: resolvedModel,
    messages: [
      { role: "system", content: systemText(input) },
      { role: "user", content: buildUserPrompt(input, extraUserText) },
    ],
    // Structured JSON for first-party OpenAI only; OpenRouter and local
    // servers stay plain JSON (same policy as server/ai/provider.mjs). Plain
    // json_object rather than a strict schema: the writer schema is
    // intentionally loose so resume facts pass through unfiltered.
    ...(provider === "openai" || typeof input.userText === "string"
      ? { response_format: { type: "json_object" } }
      : {}),
    temperature: TEMPERATURE,
    max_tokens: maxTokens,
  };
  const resp = await input.fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  const data = await readJsonBody(resp);
  const label = provider === "openai" ? "OpenAI" : provider === "openrouter" ? "OpenRouter" : "Local";
  throwIfHttpError(resp, label);
  return textFromChatCompletions(data);
}

/**
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @param {number} maxTokens
 * @returns {Promise<{ text: string, finish: string }>}
 */
async function generateAnthropic(input, extraUserText, maxTokens) {
  const pin = input.pin;
  const resolvedModel = String(pin.resolvedModel || "").trim();
  const apiKey = String(pin.apiKey || "");
  if (!resolvedModel) {
    throw new Error("pin.resolvedModel is required");
  }
  const url = String(pin.baseUrl || "").trim() || ANTHROPIC_MESSAGES_URL;
  // Prompt-only JSON: no output_config, since the writer schema is
  // intentionally loose and structured output for it is unverified.
  // Truncation is still surfaced through stop_reason.
  const body = {
    model: resolvedModel,
    max_tokens: maxTokens,
    system: systemText(input),
    messages: [{ role: "user", content: buildUserPrompt(input, extraUserText) }],
  };
  const resp = await input.fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  const data = await readJsonBody(resp);
  throwIfHttpError(resp, "Anthropic");
  return textFromAnthropic(data);
}

/**
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @returns {Promise<{ text: string, finish: string }>}
 */
async function generateWebhook(input, extraUserText) {
  const pin = input.pin;
  const url = String(pin.baseUrl || "").trim();
  if (!url) {
    throw new Error("webhook pin.baseUrl is required");
  }
  const body = {
    system: systemText(input),
    user: buildUserPrompt(input, extraUserText),
    model: String(pin.resolvedModel || pin.model || "").trim(),
  };
  const resp = await input.fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  const data = await readJsonBody(resp);
  throwIfHttpError(resp, "Webhook");
  return textFromWebhook(data);
}

/**
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @param {number} maxTokens output budget for this attempt (webhooks ignore it)
 * @returns {Promise<{ text: string, finish: string }>}
 */
async function generateContent(input, extraUserText, maxTokens) {
  const fetchImpl = input.fetchImpl;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl is required");
  }
  const pin = input.pin;
  const provider = normalizeWriterProvider(pin.provider);
  if (provider === "gemini") return generateGemini(input, extraUserText, maxTokens);
  if (provider === "anthropic") return generateAnthropic(input, extraUserText, maxTokens);
  if (provider === "webhook") return generateWebhook(input, extraUserText);
  return generateOpenAICompatible(input, extraUserText, provider, maxTokens);
}

/**
 * Two attempts, bounded: a truncation signal — or unterminated JSON with no
 * signal, the probable-truncation case — escalates the second attempt to the
 * hard cap, since an identical retry would re-truncate deterministically.
 * A blocking stop throws on the first attempt without retry. Anything else
 * retries identically, as before.
 *
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @returns {Promise<WriterJson>}
 */
async function callWithRetry(input, extraUserText) {
  /** @type {unknown} */
  let lastError;
  let budget = MAX_OUTPUT_TOKENS;
  const provider = normalizeWriterProvider(input.pin.provider);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text, finish } = await generateContent(input, extraUserText, budget);
    const blocked = blockedSignal(provider, finish);
    if (blocked) {
      throw blockedWriterError(provider, finishSignalName(provider), blocked);
    }
    const signal = truncationSignal(provider, finish);
    if (signal) {
      lastError = truncatedWriterError(provider, finishSignalName(provider), signal);
    } else {
      try {
        return parseWriterJson(text);
      } catch (err) {
        lastError = err;
      }
    }
    if (
      budget < MAX_OUTPUT_TOKENS_TRUNCATED_RETRY &&
      (signal !== "" || (isUnterminatedJsonError(lastError) && finish === ""))
    ) {
      budget = MAX_OUTPUT_TOKENS_TRUNCATED_RETRY;
    }
  }
  throw lastError;
}

/**
 * @param {WriterInput} input
 * @returns {Promise<WriterJson>}
 */
export async function callWriter(input) {
  return callWithRetry(input, "");
}

/**
 * One v3 narrow stage call: a small system prompt, a composed user text,
 * a stage output cap, and structured JSON out. Retries once on invalid
 * JSON, then throws (the stage degrades deterministically).
 *
 * @param {object} input
 * @param {WriterPin} input.pin
 * @param {string} input.systemPrompt
 * @param {string} input.userText
 * @param {number} [input.maxOutputTokens]
 * @param {(input: string | URL, init?: RequestInit) => Promise<HttpResponseLike>} input.fetchImpl
 * @param {number} [input.timeoutMs]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function callJsonStage(input) {
  const stageInput = /** @type {WriterInput} */ ({
    pin: input.pin,
    jdText: "",
    masterResumeHtml: "",
    systemPrompt: input.systemPrompt,
    userText: input.userText,
    maxOutputTokens: input.maxOutputTokens,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  /** @type {unknown} */
  let lastError;
  let budget = maxTokens(stageInput);
  const provider = normalizeWriterProvider(stageInput.pin.provider);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { text, finish } = await generateContent(stageInput, "", budget);
    const blocked = blockedSignal(provider, finish);
    if (blocked) {
      throw blockedWriterError(provider, finishSignalName(provider), blocked);
    }
    const signal = truncationSignal(provider, finish);
    if (signal) {
      lastError = truncatedWriterError(provider, finishSignalName(provider), signal);
    } else {
      try {
        return parseStageJson(text);
      } catch (err) {
        lastError = err;
      }
    }
    if (
      budget < MAX_OUTPUT_TOKENS_TRUNCATED_RETRY &&
      (signal !== "" || (isUnterminatedJsonError(lastError) && finish === ""))
    ) {
      budget = Math.min(MAX_OUTPUT_TOKENS_TRUNCATED_RETRY, budget * 2);
    }
  }
  throw lastError;
}

/**
 * Same provider client as `callWriter`, with the critic scorecard and current JSON
 * appended so the model can rewrite to the same schema.
 *
 * @param {EditorInput} input
 * @returns {Promise<WriterJson>}
 */
export async function callEditor(input) {
  const extraUserText = [
    JSON.stringify(input.scorecard),
    JSON.stringify(input.current),
    "Rewrite to hit the scorecard. Same schema.",
  ].join("\n");
  return callWithRetry(input, extraUserText);
}
