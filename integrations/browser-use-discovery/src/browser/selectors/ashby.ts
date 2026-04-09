export const ASHBY_SELECTORS = {
  jobCard: 'a[href*="jobs.ashbyhq.com"]',
  jobTitle: "h1",
  jobDescription: '[data-testid="job-description"]',
} as const;

export function buildAshbyJobsUrl(
  boardToken: string,
  includeCompensation = true,
): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardToken)}?includeCompensation=${includeCompensation ? "true" : "false"}`;
}

export function buildAshbyBoardUrl(boardToken: string): string {
  return `https://jobs.ashbyhq.com/${encodeURIComponent(boardToken)}`;
}

export const ASHBY_BROWSER_INSTRUCTION =
  "Use Ashby's public posting API first. If the API is unavailable, inspect the job board page and extract the visible job cards with title, location, and URL.";
