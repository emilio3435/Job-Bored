export type ScrapeJobPostingOptions = {
  fetchImpl?: typeof globalThis.fetch;
  serpApiKey?: string;
  title?: string;
  company?: string;
};

export type ScrapeJobPostingResult = {
  url: string;
  sourceUrl?: string;
  title: string | null;
  company?: string;
  location?: string;
  description: string;
  requirements: string[];
  skills: string[];
  source: string;
  method: string;
  scraping: Record<string, unknown>;
  warnings: string[];
};

export function scrapeJobPosting(
  url: string,
  options?: ScrapeJobPostingOptions,
): Promise<ScrapeJobPostingResult>;
