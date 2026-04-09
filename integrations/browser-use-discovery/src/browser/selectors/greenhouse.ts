export const GREENHOUSE_SELECTORS = {
  jobCard: 'a[href*="/jobs/"]',
  jobTitle: "h1",
  jobDescription: '[data-testid="job-description"]',
} as const;

export function buildGreenhouseBoardInfoUrl(boardToken: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}`;
}

export function buildGreenhouseJobsUrl(boardToken: string): string {
  return `${buildGreenhouseBoardInfoUrl(boardToken)}/jobs?content=true`;
}

export function buildGreenhouseBoardUrl(boardToken: string): string {
  return `https://boards.greenhouse.io/${encodeURIComponent(boardToken)}`;
}

export const GREENHOUSE_BROWSER_INSTRUCTION =
  "Use the public Greenhouse board API first. If the API is unavailable, inspect the careers page and extract the visible job cards with title, company, location, and URL.";
