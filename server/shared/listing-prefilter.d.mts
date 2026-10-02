export type RemoteBucket = "remote" | "hybrid" | "onsite" | "unknown";

export type PreFilterListing = {
  title?: string;
  location?: string;
  remoteBucket?: string;
  descriptionText?: string;
  compensationText?: string;
};

export type PreFilterHardConstraints = {
  salaryFloor?: unknown;
  salaryRequired?: unknown;
  workMode?: unknown;
  acceptableLocations?: unknown[];
  workAuth?: unknown;
  skipTitles?: unknown[];
};

export type PreFilterResult =
  | { pass: true }
  | {
      pass: false;
      reason:
        | "skip_title_match"
        | "work_mode_mismatch"
        | "location_outside_acceptable"
        | "work_auth_mismatch"
        | "salary_below_floor"
        | "salary_missing_but_required";
      detail: string;
      matchedPhrase?: string;
      remoteBucket?: string;
    };

export const REMOTE_LOCATION_PATTERN: RegExp;
export const HYBRID_LOCATION_PATTERN: RegExp;
export const ONSITE_LOCATION_PATTERN: RegExp;
export function normalizeLocationText(input: string): string;
export function normalizeRemoteBucket(input: string | undefined): RemoteBucket;
export function inferRemoteBucket(input: {
  remoteBucket?: string;
  location?: string;
  descriptionText?: string;
  fitAssessment?: string;
  title?: string;
}): RemoteBucket;
export function matchesPhrase(text: string, phrase: string, suffix?: string): boolean;
export function parseSalaryMax(text: string): number | null;
export function runPreFilter(
  rawListing: PreFilterListing,
  profile: { hardConstraints?: PreFilterHardConstraints },
): PreFilterResult;
