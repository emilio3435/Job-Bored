import { BrowserUse } from "browser-use-sdk/v3";
import { z } from "zod";

import type { WorkerRuntimeConfig } from "../config.ts";
import type { RawListing } from "../contracts.ts";

const BrowserUseJobSchema = z
  .object({
    extractionStatus: z
      .enum(["extracted", "gated", "not_job_posting"])
      .optional()
      .default("extracted"),
    title: z.string().trim().optional().default(""),
    company: z.string().trim().optional().default(""),
    location: z.string().trim().optional().default(""),
    description: z.string().trim().optional().default(""),
    applyUrl: z.string().trim().optional().default(""),
    finalUrl: z.string().trim().optional().default(""),
    confidence: z.number().min(0).max(1),
    gatedReason: z.string().trim().optional().default(""),
  })
  .strict();

export type BrowserUseCloudExtractionInput = {
  url: string;
  runtimeConfig: WorkerRuntimeConfig;
  runId: string;
  timeoutMs?: number;
};

export type BrowserUseCloudExtractionResult =
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

export type BrowserUseCloudExtractor = (
  input: BrowserUseCloudExtractionInput,
) => Promise<BrowserUseCloudExtractionResult>;

const DEFAULT_BROWSER_USE_TIMEOUT_MS = 300_000;

export async function extractJobWithBrowserUseCloud(
  input: BrowserUseCloudExtractionInput,
): Promise<BrowserUseCloudExtractionResult> {
  const apiKey = String(input.runtimeConfig.browserUseApiKey || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "missing_api_key",
      message: "BROWSER_USE_API_KEY is not configured.",
    };
  }

  try {
    const client = new BrowserUse({ apiKey });
    const profileId = String(input.runtimeConfig.browserUseProfileId || "").trim();
    const result = await client.run(buildJobExtractionTask(input.url), {
      schema: BrowserUseJobSchema,
      timeout: input.timeoutMs || DEFAULT_BROWSER_USE_TIMEOUT_MS,
      ...(profileId ? { profileId } : {}),
    });
    const output = BrowserUseJobSchema.parse(result.output);
    const quality = assessBrowserUseOutputQuality(output);
    if (!quality.ok) {
      return {
        ok: false,
        reason: "low_quality_extraction",
        message: quality.message,
      };
    }
    const finalUrl = firstValidUrl(
      [output.finalUrl, output.applyUrl, input.url],
      input.url,
    );

    return {
      ok: true,
      confidence: output.confidence,
      rawListing: {
        sourceId: "ingest_url_browser_use" as RawListing["sourceId"],
        sourceLabel: "Browser Use",
        sourceLane: "grounded_web",
        title: output.title,
        company: output.company,
        location: output.location || undefined,
        url: finalUrl,
        canonicalUrl: finalUrl,
        finalUrl,
        descriptionText: output.description,
        metadata: {
          sourceQuery: `browser_use_cloud:${input.url}`,
          browserUseRunId: input.runId,
          browserUseConfidence: output.confidence,
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

export function buildJobExtractionTask(url: string): string {
  const safeUrl = JSON.stringify(String(url || "").trim());
  return `Goal: Extract one job posting from the provided URL into the structured schema.

Success means:
- title, company, and description are populated from the posting page or canonical apply page.
- extractionStatus is "extracted" only when the role title, company, and job description are visible together.
- location, applyUrl, finalUrl, and confidence reflect the best available page evidence.
- output matches the schema exactly.

Stop when: Return the schema object for this one job posting.

Open URL: ${safeUrl}
Read the job page and follow an Apply, View job, or canonical posting link when it reveals employer-hosted posting details.
Use the final inspected posting or apply page as finalUrl.
If the URL is a search/results page, login wall, source-gated aggregator, captcha, or page where the actual posting body is not visible, set extractionStatus to "gated" or "not_job_posting", explain gatedReason briefly, leave title/company/description blank when they are not visible, and use confidence 0.
Do not invent placeholders such as "Unavailable", "Unknown", "LinkedIn (source gated)", or "Job posting".
Use confidence from 0 to 1, where 1 means the role title, company, and description were visible together on the page.`;
}

function assessBrowserUseOutputQuality(output: z.infer<typeof BrowserUseJobSchema>):
  | { ok: true }
  | { ok: false; message: string } {
  if (output.extractionStatus !== "extracted") {
    return {
      ok: false,
      message:
        output.gatedReason ||
        "Browser Use could not access a complete job posting from this URL.",
    };
  }
  if (output.confidence < 0.5) {
    return {
      ok: false,
      message:
        "Browser Use returned a low-confidence result instead of a complete job posting.",
    };
  }
  if (
    isPlaceholderText(output.title) ||
    isPlaceholderText(output.company) ||
    output.description.trim().length < 20 ||
    isPlaceholderDescription(output.description)
  ) {
    return {
      ok: false,
      message:
        "Browser Use could not extract enough real job details from this URL.",
    };
  }
  return { ok: true };
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

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function redactSecrets(message: string): string {
  return String(message || "").replace(/\bbu_[A-Za-z0-9._-]+\b/g, "[redacted]");
}
