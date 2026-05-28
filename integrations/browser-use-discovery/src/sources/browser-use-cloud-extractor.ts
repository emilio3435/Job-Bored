import { BrowserUse } from "browser-use-sdk/v3";
import { z } from "zod";

import type { WorkerRuntimeConfig } from "../config.ts";
import type { RawListing } from "../contracts.ts";

const BrowserUseJobSchema = z
  .object({
    title: z.string().trim().min(1),
    company: z.string().trim().min(1),
    location: z.string().trim().optional().default(""),
    description: z.string().trim().min(1),
    applyUrl: z.string().trim().optional().default(""),
    finalUrl: z.string().trim().optional().default(""),
    confidence: z.number().min(0).max(1),
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
      reason: "missing_api_key" | "extract_failed";
      message: string;
    };

export type BrowserUseCloudExtractor = (
  input: BrowserUseCloudExtractionInput,
) => Promise<BrowserUseCloudExtractionResult>;

const DEFAULT_BROWSER_USE_TIMEOUT_MS = 120_000;

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
    const finalUrl = firstValidUrl(
      [output.finalUrl, output.applyUrl, input.url],
      input.url,
    );

    return {
      ok: true,
      confidence: output.confidence,
      rawListing: {
        sourceId: "ingest_url_browser_use" as RawListing["sourceId"],
        sourceLabel: "URL paste (Browser Use Cloud)",
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
- location, applyUrl, finalUrl, and confidence reflect the best available page evidence.
- output matches the schema exactly.

Stop when: Return the schema object for this one job posting.

Open URL: ${safeUrl}
Read the job page and follow an Apply, View job, or canonical posting link when it reveals employer-hosted posting details.
Use the final inspected posting or apply page as finalUrl.
Use confidence from 0 to 1, where 1 means the role title, company, and description were visible together on the page.`;
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
