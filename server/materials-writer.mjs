const GEMINI_GENERATE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 60_000;
const TEMPERATURE = 0.4;
const MAX_OUTPUT_TOKENS = 4096;

const WRITER_SYSTEM_PROMPT = [
  "Rewrite the candidate's materials for this JD.",
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
      summary: { opener: "", body: "" },
      roles: [{ id: "audacy-dsm", bullets: [""] }],
      capabilitiesOrder: ["..."],
      stackEmphasis: ["..."],
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
 * @property {string[]} bullets
 */

/**
 * @typedef {object} ResumeJson
 * @property {ResumeSummary} [summary]
 * @property {ResumeRole[]} [roles]
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
 * @property {string} resolvedModel
 * @property {string} apiKey
 * @property {string} [baseUrl]
 */

/**
 * @typedef {object} WriterInput
 * @property {WriterPin} pin
 * @property {string} jdText
 * @property {string} masterResumeHtml
 * @property {unknown} [voiceSamples]
 * @property {(input: string | URL, init?: RequestInit) => Promise<{ ok?: boolean, status?: number, json?: () => Promise<unknown> }>} fetchImpl
 * @property {number} [timeoutMs]
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
 * @param {string} extraUserText
 * @returns {string}
 */
function buildUserPrompt(input, extraUserText) {
  const parts = [
    `Job description:\n${input.jdText ?? ""}`,
    `Master resume HTML:\n${input.masterResumeHtml ?? ""}`,
  ];
  if (input.voiceSamples != null && !(Array.isArray(input.voiceSamples) && input.voiceSamples.length === 0)) {
    parts.push(`Voice samples:\n${JSON.stringify(input.voiceSamples)}`);
  }
  if (extraUserText) parts.push(extraUserText);
  return parts.join("\n\n");
}

/**
 * @param {unknown} data
 * @returns {string}
 */
function textFromGeminiResponse(data) {
  if (!isPlainObject(data)) return "";
  const candidates = data.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return "";
  const first = candidates[0];
  if (!isPlainObject(first)) return "";
  const content = first.content;
  if (!isPlainObject(content)) return "";
  const parts = content.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (isPlainObject(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/**
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @returns {Promise<string>}
 */
async function generateContent(input, extraUserText) {
  const fetchImpl = input.fetchImpl;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl is required");
  }
  const pin = isPlainObject(input.pin) ? input.pin : {};
  const resolvedModel = String(pin.resolvedModel || "").trim();
  const apiKey = String(pin.apiKey || "");
  if (!resolvedModel) {
    throw new Error("pin.resolvedModel is required");
  }
  const url = `${GEMINI_GENERATE_URL}/${encodeURIComponent(resolvedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: WRITER_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(input, extraUserText) }] }],
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };
  const resp = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  const data = await (resp && typeof resp.json === "function" ? resp.json() : Promise.resolve({})).catch(
    () => ({}),
  );
  if (!resp || resp.ok === false) {
    const status = resp && typeof resp.status === "number" ? resp.status : 0;
    throw new Error(`Gemini HTTP ${status}`);
  }
  return textFromGeminiResponse(data);
}

/**
 * @param {WriterInput} input
 * @param {string} extraUserText
 * @returns {Promise<WriterJson>}
 */
async function callWithRetry(input, extraUserText) {
  /** @type {unknown} */
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await generateContent(input, extraUserText);
    try {
      return parseWriterJson(text);
    } catch (err) {
      lastError = err;
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
 * Same Gemini client as `callWriter`, with the critic scorecard and current JSON
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
