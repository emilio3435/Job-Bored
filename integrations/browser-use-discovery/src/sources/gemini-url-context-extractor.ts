/**
 * Add URL tier — Gemini URL context extraction.
 *
 * Sits between the ATS public API tier and the Cheerio/JSON-LD scrape tier in
 * the Add URL ingest strategy. Given a single pasted posting URL, this calls
 * Gemini with the `url_context` tool so the model reads the live page and
 * returns structured job fields (title, company, location, description, apply
 * URL). It is cheaper and more resilient than launching a full Browser Use
 * Cloud session for ordinary employer/ATS HTML pages that the Cheerio scraper
 * struggles with (JS-rendered content, unusual DOM, light anti-bot).
 *
 * Quality gate: like the Browser Use extractor, weak or placeholder output is
 * rejected (returns ok:false) so the caller falls through to Cheerio rather
 * than landing a junk Pipeline row.
 *
 * Privacy: the Gemini API key is never logged. Error messages are redacted.
 */

import type { WorkerRuntimeConfig } from "../config.ts";
import type { RawListing } from "../contracts.ts";

type FetchImpl = typeof globalThis.fetch;

export type GeminiUrlContextExtractionInput = {
  url: string;
  runId: string;
  runtimeConfig: WorkerRuntimeConfig;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
};

export type GeminiUrlContextExtractionResult =
  | {
      ok: true;
      rawListing: RawListing;
      confidence: number;
    }
  | {
      ok: false;
      reason: "missing_api_key" | "extract_failed" | "low_quality_extraction";
      message: string;
    };

export type GeminiUrlContextExtractor = (
  input: GeminiUrlContextExtractionInput,
) => Promise<GeminiUrlContextExtractionResult>;

const MIN_ACCEPTABLE_CONFIDENCE = 0.5;
const MIN_DESCRIPTION_CHARS = 20;

type ExtractedJobFields = {
  extractionStatus: "extracted" | "gated" | "not_job_posting";
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  finalUrl: string;
  confidence: number;
  gatedReason: string;
};

export async function extractJobWithGeminiUrlContext(
  input: GeminiUrlContextExtractionInput,
): Promise<GeminiUrlContextExtractionResult> {
  const apiKey = String(input.runtimeConfig.geminiApiKey || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "missing_api_key",
      message: "Gemini API key is not configured (BROWSER_USE_DISCOVERY_GEMINI_API_KEY).",
    };
  }

  const url = String(input.url || "").trim();
  if (!url) {
    return {
      ok: false,
      reason: "extract_failed",
      message: "No URL was provided to Gemini URL context extraction.",
    };
  }

  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const model = String(input.runtimeConfig.geminiModel || "").trim() || "gemini-3.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  try {
    const payload = await callGemini({
      endpoint,
      apiKey,
      fetchImpl,
      signal: input.signal,
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: buildUrlContextPrompt(url) }],
          },
        ],
        tools: [{ url_context: {} }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
      },
    });

    const text = extractGenerationText(payload);
    const parsed = parseFirstJsonBlock(text);
    const fields = normalizeExtractedFields(parsed);

    const quality = assessExtractionQuality(fields);
    if (!quality.ok) {
      return {
        ok: false,
        reason: "low_quality_extraction",
        message: quality.message,
      };
    }

    const finalUrl = firstValidUrl([fields.finalUrl, fields.applyUrl, url], url);

    return {
      ok: true,
      confidence: fields.confidence,
      rawListing: {
        sourceId: "ingest_url_gemini" as RawListing["sourceId"],
        sourceLabel: "Gemini URL context",
        sourceLane: "grounded_web",
        title: fields.title,
        company: fields.company,
        location: fields.location || undefined,
        url: finalUrl,
        canonicalUrl: finalUrl,
        finalUrl,
        descriptionText: fields.description,
        metadata: {
          sourceQuery: `gemini_url_context:${url}`,
          geminiRunId: input.runId,
          geminiModel: model,
          geminiConfidence: fields.confidence,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "extract_failed",
      message: redactSecrets(formatError(error)),
    };
  }
}

export function buildUrlContextPrompt(url: string): string {
  const safeUrl = JSON.stringify(String(url || "").trim());
  return `Goal: Read the single job posting at the provided URL and return its fields as strict JSON.

Open and read this URL: ${safeUrl}

Return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{
  "extractionStatus": "extracted" | "gated" | "not_job_posting",
  "title": string,
  "company": string,
  "location": string,
  "description": string,
  "applyUrl": string,
  "finalUrl": string,
  "confidence": number,
  "gatedReason": string
}

Rules:
- Set extractionStatus to "extracted" only when the role title, company, and a real job description are all visible on the page.
- If the page is a search/results listing, login wall, captcha, source-gated aggregator, or the posting body is not visible, set extractionStatus to "gated" or "not_job_posting", set confidence to 0, leave title/company/description empty, and briefly explain gatedReason.
- description must be the actual posting body text, not navigation or boilerplate.
- finalUrl should be the canonical employer/ATS posting URL; applyUrl the apply link if present; otherwise reuse the provided URL.
- confidence is 0 to 1, where 1 means title, company, and description were clearly visible together.
- Never invent placeholders such as "Unavailable", "Unknown", "Unknown company", or "Job posting".`;
}

function assessExtractionQuality(fields: ExtractedJobFields):
  | { ok: true }
  | { ok: false; message: string } {
  if (fields.extractionStatus !== "extracted") {
    return {
      ok: false,
      message:
        fields.gatedReason ||
        "Gemini could not read a complete job posting from this URL.",
    };
  }
  if (fields.confidence < MIN_ACCEPTABLE_CONFIDENCE) {
    return {
      ok: false,
      message:
        "Gemini returned a low-confidence result instead of a complete job posting.",
    };
  }
  if (
    isPlaceholderText(fields.title) ||
    isPlaceholderText(fields.company) ||
    fields.description.trim().length < MIN_DESCRIPTION_CHARS ||
    isPlaceholderDescription(fields.description)
  ) {
    return {
      ok: false,
      message:
        "Gemini could not extract enough real job details from this URL.",
    };
  }
  return { ok: true };
}

function normalizeExtractedFields(raw: unknown): ExtractedJobFields {
  const record = isPlainRecord(raw) ? raw : {};
  const status = String(record.extractionStatus || "extracted").trim().toLowerCase();
  const extractionStatus: ExtractedJobFields["extractionStatus"] =
    status === "gated" || status === "not_job_posting"
      ? (status as ExtractedJobFields["extractionStatus"])
      : "extracted";
  const confidenceRaw = record.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : typeof confidenceRaw === "string" && confidenceRaw.trim()
        ? clamp01(Number.parseFloat(confidenceRaw.trim()))
        : 0;
  return {
    extractionStatus,
    title: cleanString(record.title),
    company: cleanString(record.company),
    location: cleanString(record.location),
    description: cleanString(record.description),
    applyUrl: cleanString(record.applyUrl),
    finalUrl: cleanString(record.finalUrl),
    confidence,
    gatedReason: cleanString(record.gatedReason),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

async function callGemini(request: {
  endpoint: string;
  apiKey: string;
  fetchImpl: FetchImpl;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<unknown> {
  const response = await request.fetchImpl(request.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": request.apiKey,
    },
    signal: request.signal,
    body: JSON.stringify(request.body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Gemini HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 200)}` : ""}`,
    );
  }
  return response.json().catch(() => null);
}

function extractGenerationText(payload: unknown): string {
  if (!isPlainRecord(payload)) return "";
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    if (!isPlainRecord(candidate)) continue;
    const content = isPlainRecord(candidate.content) ? candidate.content : null;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .map((part) =>
        isPlainRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function parseFirstJsonBlock(raw: string): unknown {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to brace extraction (model may wrap JSON in prose/fences).
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isPlaceholderText(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "unavailable" ||
    normalized === "unknown" ||
    normalized === "unknown company" ||
    normalized === "job posting" ||
    normalized.includes("source gated") ||
    normalized.includes("login required")
  );
}

function isPlaceholderDescription(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes("source gated") ||
    normalized.includes("login wall") ||
    normalized.includes("sign in to view") ||
    normalized === "clean ats"
  );
}

function firstValidUrl(candidates: string[], fallback: string): string {
  for (const candidate of candidates) {
    const trimmed = String(candidate || "").trim();
    if (!trimmed) continue;
    try {
      return new URL(trimmed).toString();
    } catch {
      // Keep looking for a valid URL.
    }
  }
  return fallback;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function redactSecrets(message: string): string {
  return String(message || "")
    .replace(/\bAIza[0-9A-Za-z._-]+\b/g, "[redacted]")
    .replace(/("?x-goog-api-key"?\s*[:=]\s*)("?)[^"\s,}]+\2/gi, "$1$2[redacted]$2");
}
