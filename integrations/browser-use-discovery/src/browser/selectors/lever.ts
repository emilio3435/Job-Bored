export const LEVER_SELECTORS = {
  jobCard: 'a[href*="jobs.lever.co"]',
  jobTitle: "h1",
  jobDescription: '[data-qa="posting-description"]',
} as const;

export function buildLeverJobsUrl(boardToken: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken)}?mode=json`;
}

export function buildLeverBoardUrl(boardToken: string): string {
  return `https://jobs.lever.co/${encodeURIComponent(boardToken)}`;
}

export const LEVER_BROWSER_INSTRUCTION =
  "Use Lever's public postings API first. If the API is unavailable, inspect the job site and extract the visible postings with title, location, and URL.";
