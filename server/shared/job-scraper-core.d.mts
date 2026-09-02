export type ScrapeJobPostingOptions = {
  fetchImpl?: typeof globalThis.fetch;
  serpApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  title?: string;
  company?: string;
};

export type ScrapeJobPostingResult = {
  url: string;
  sourceUrl?: string;
  title: string | null;
  company?: string;
  location?: string;
  postedAt: string;
  closesAt: string;
  postingSalary: string;
  description: string;
  requirements: string[];
  skills: string[];
  source: string;
  method: string;
  scraping: Record<string, unknown>;
  warnings: string[];
};

export type ScrapeFallbackDiagnostics = {
  attempted: boolean;
  reason: string;
};

export type ScrapeFailureBody = {
  error: string;
  code: string;
  detail: string;
  nextStep: string;
  retryable: boolean;
  sourceHost?: string;
  upstreamStatus?: number;
  fallback?: ScrapeFallbackDiagnostics;
};

export class ScrapeJobError extends Error {
  code: string;
  userMessage: string;
  statusCode: number;
  detail: string;
  nextStep: string;
  retryable: boolean;
  sourceHost: string;
  upstreamStatus: number | null;
  fallback: ScrapeFallbackDiagnostics | null;
  constructor(
    message: string,
    fields: {
      code: string;
      statusCode: number;
      detail: string;
      nextStep: string;
      userMessage?: string;
      retryable?: boolean;
      sourceHost?: string;
      upstreamStatus?: number | null;
      fallback?: ScrapeFallbackDiagnostics | null;
    },
  );
}

export function toScrapeFailureResponse(
  error: unknown,
  url: string,
): { status: number; body: ScrapeFailureBody };

export function scrapeJobPosting(
  url: string,
  options?: ScrapeJobPostingOptions,
): Promise<ScrapeJobPostingResult>;
