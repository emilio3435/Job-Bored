/**
 * Last-lane job scrape via Gemini URL Context.
 * Google fetches the posting; this module asks for a plain-text extract.
 * url_context cannot be combined with responseSchema.
 */
import { validateScrapeTarget, safeFetch } from "../security-boundaries.mjs";
import {
  GEMINI_FLASH_FAMILY,
  GEMINI_FLASH_FALLBACK,
} from "../model-family.mjs";
import { loadLlmConfig } from "../llm-config.mjs";
import {
  geminiGenerateContentUrl,
  geminiHeaders,
  normalizeProvider,
} from "../ai/provider.mjs";
import { normalizeInlineField, normalizeJobText } from "./text-normalize.mjs";

const GEMINI_TIMEOUT_MS = 25000;
const MIN_DESCRIPTION_CHARS = 80;

/**
 * @param {string} rawUrl
 * @param {{ fetchImpl?: typeof globalThis.fetch, geminiApiKey?: string, geminiModel?: string, title?: string, company?: string, signal?: AbortSignal }} [options]
 *   `geminiApiKey`/`geminiModel` override the pin (tests, explicit callers);
 *   otherwise the llm.json pin decides. `signal` cancels the billed call
 *   when the request goes away (E11).
 * @returns {Promise<{ title: string | null, company: string, location: string, description: string, provider: string, apiUrl: string } | null>}
 */
export async function scrapeViaGeminiUrlContext(rawUrl, options = {}) {
  const credentials = resolveGeminiCredentials(options);
  if (!credentials) return null;
  const target = validateScrapeTarget(rawUrl);
  if (!target.ok) return null;
  if (options.signal && options.signal.aborted) return null;

  const model = resolveGeminiModel(credentials.model);
  const apiUrl = geminiGenerateContentUrl(model);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeout = AbortSignal.timeout(GEMINI_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  try {
    const response = await safeFetch(
      apiUrl,
      {
        method: "POST",
        signal,
        headers: geminiHeaders(credentials.apiKey),
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: buildExtractPrompt(target.url, options) }],
            },
          ],
          tools: [{ url_context: {} }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4500,
          },
        }),
      },
      { fetchImpl },
    );
    if (!response || !response.ok || typeof response.json !== "function") return null;
    const payload = await response.json();
    if (!payload || typeof payload !== "object") return null;
    if (!urlContextSucceeded(payload)) return null;
    const text = extractCandidateText(payload);
    if (text.length < MIN_DESCRIPTION_CHARS) return null;
    return {
      title: normalizeInlineField(options.title) || null,
      company: normalizeInlineField(options.company),
      location: normalizeInlineField(""),
      description: normalizeJobText(text),
      provider: "gemini-url-context",
      apiUrl,
    };
  } catch {
    return null;
  }
}

/**
 * The key and model come from the llm.json pin (E10): the posting URL, title
 * and company go to Google only when the user chose Gemini. No env fallback.
 * @param {{ geminiApiKey?: string, geminiModel?: string }} [options]
 * @returns {{ apiKey: string, model: string } | null}
 */
function resolveGeminiCredentials(options = {}) {
  const explicitKey = String(options.geminiApiKey || "").trim();
  if (explicitKey) return { apiKey: explicitKey, model: String(options.geminiModel || "").trim() };
  const pin = loadLlmConfig(process.env);
  if (!pin || normalizeProvider(pin.provider) !== "gemini") return null;
  const apiKey = String(pin.apiKey || "").trim();
  if (!apiKey) return null;
  return { apiKey, model: String(options.geminiModel || pin.model || "").trim() };
}

/** @param {string | undefined} raw */
function resolveGeminiModel(raw) {
  const configured = String(raw || "").trim() || GEMINI_FLASH_FALLBACK;
  // Upgrade legacy 1.x to a modern Flash snapshot
  if (/^gemini-1\.|^models\/gemini-1\./i.test(configured)) return GEMINI_FLASH_FALLBACK;
  // Family alias is fine for config, but HTTP should use a pinned snapshot
  if (configured === GEMINI_FLASH_FAMILY) return GEMINI_FLASH_FALLBACK;
  return configured;
}

/**
 * @param {string} url
 * @param {{ title?: string, company?: string }} [options]
 */
function buildExtractPrompt(url, options = {}) {
  const title = String(options.title || "").trim();
  const company = String(options.company || "").trim();
  const hint =
    title || company
      ? ` The posting is expected to be ${[title, company].filter(Boolean).join(" at ")}.`
      : "";
  return (
    "Read the job posting at the URL below and return a clean, plain-text extract " +
    "of the posting's content. Include the role title, company, location, full " +
    "job description, all responsibilities, all requirements/qualifications, " +
    "preferred/nice-to-haves, compensation/benefits if listed, and any tools or " +
    "technologies mentioned. Use simple section headings like 'About the role', " +
    "'Responsibilities', 'Requirements', 'Nice to have', 'Tools and stack', " +
    "'Compensation'. Do not paraphrase — preserve the posting's wording. " +
    "Do not add commentary or evaluation. If a section is missing, omit it." +
    `${hint}\n\nURL: ${url}`
  );
}

/**
 * The REST API answers in lowerCamelCase (`urlContextMetadata.urlMetadata[]
 * .urlRetrievalStatus`); older fixtures and SDK dumps use snake_case. Accept
 * both (E9).
 * @param {unknown} payload
 */
function urlContextSucceeded(payload) {
  const candidate = firstCandidate(payload);
  const metaRaw = candidate
    ? candidate.urlContextMetadata ?? candidate.url_context_metadata
    : null;
  const meta =
    metaRaw && typeof metaRaw === "object" && !Array.isArray(metaRaw)
      ? /** @type {Record<string, unknown>} */ (metaRaw)
      : null;
  const rowsRaw = meta ? meta.urlMetadata ?? meta.url_metadata : null;
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  if (!rows.length) return false;
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const record = /** @type {Record<string, unknown>} */ (row);
    return String(record.urlRetrievalStatus ?? record.url_retrieval_status ?? "")
      .toUpperCase()
      .includes("SUCCESS");
  });
}

/** @param {unknown} payload */
function extractCandidateText(payload) {
  const candidate = firstCandidate(payload);
  const contentRaw = candidate ? candidate.content : null;
  const content =
    contentRaw && typeof contentRaw === "object" && !Array.isArray(contentRaw)
      ? /** @type {Record<string, unknown>} */ (contentRaw)
      : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = /** @type {Record<string, unknown>} */ (part);
      return typeof record.text === "string" ? record.text : "";
    })
    .join("")
    .trim();
}

/** @param {unknown} payload */
function firstCandidate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = /** @type {Record<string, unknown>} */ (payload);
  const candidates = record.candidates;
  if (!Array.isArray(candidates) || !candidates[0] || typeof candidates[0] !== "object") {
    return null;
  }
  return /** @type {Record<string, unknown>} */ (candidates[0]);
}
