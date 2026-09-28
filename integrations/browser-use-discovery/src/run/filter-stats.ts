import type {
  DiscoveryRejectionSummary,
  DiscoveryRunFilterStats,
  RawListing,
} from "../contracts.ts";
import { normalizeCompanyKey } from "../discovery/company-keys.ts";
import { inferRoleFamilies } from "../match/job-matcher.ts";
import type { LeadNormalizationRejection } from "../normalize/lead-normalizer.ts";

/**
 * DISCAT D8/D9: what the filters removed in one run, and which rejected
 * titles were near misses of the target roles. Nothing here changes a filter.
 */

export type RejectedListingRef = {
  title: string;
  companyKey: string;
  sourceLane: string;
};

type FilterSignalSummary = DiscoveryRejectionSummary & {
  excludeKeywordCounts?: Record<string, number>;
  headlineMismatches?: RejectedListingRef[];
};

/** Keep the payload small: the hint needs the top keyword, not all of them. */
export const FILTER_STATS_MAX_KEYWORDS = 20;

export function normalizeFilterKeyword(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Called once per rejected listing, beside the reason counter. */
export function recordFilterSignals(
  entry: FilterSignalSummary,
  rawListing: RawListing,
  rejection: LeadNormalizationRejection,
): void {
  if (rejection.reason === "excluded_keyword" && rejection.matchedKeywords?.length) {
    const counts = entry.excludeKeywordCounts || (entry.excludeKeywordCounts = {});
    // One listing counts once per keyword it matched.
    const keywords = new Set(
      rejection.matchedKeywords.map(normalizeFilterKeyword).filter(Boolean),
    );
    for (const keyword of keywords) {
      counts[keyword] = (counts[keyword] || 0) + 1;
    }
  }
  if (rejection.reason === "headline_mismatch") {
    const title = String(rawListing.title || "").trim();
    if (!title) return;
    (entry.headlineMismatches || (entry.headlineMismatches = [])).push({
      title,
      companyKey: normalizeCompanyKey(rawListing.company || ""),
      sourceLane: String(rawListing.sourceLane || "").trim(),
    });
  }
}

export function buildRunFilterStats(
  summaries: Iterable<FilterSignalSummary>,
  listingsSeen: number,
): DiscoveryRunFilterStats {
  const byReason: Record<string, number> = {};
  const keywordCounts = new Map<string, number>();
  let listingsRejected = 0;
  for (const summary of summaries) {
    listingsRejected += summary.totalRejected || 0;
    for (const [reason, count] of Object.entries(summary.rejectionReasons || {})) {
      byReason[reason] = (byReason[reason] || 0) + count;
    }
    for (const [keyword, count] of Object.entries(summary.excludeKeywordCounts || {})) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + count);
    }
  }
  const byExcludeKeyword = [...keywordCounts.entries()]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, FILTER_STATS_MAX_KEYWORDS);
  return {
    listingsSeen: Math.max(0, Math.floor(listingsSeen) || 0, listingsRejected),
    listingsRejected,
    byReason,
    byExcludeKeyword,
  };
}

/**
 * D8: a headline_mismatch whose title shares a role family with the target
 * roles is a near miss. Titles outside every target family are ignored.
 */
export function selectNearMissListings(
  summaries: Iterable<FilterSignalSummary>,
  targetRoles: string[],
): RejectedListingRef[] {
  const targetFamilies = new Set(inferRoleFamilies((targetRoles || []).join(" ")));
  if (targetFamilies.size === 0) return [];
  const out: RejectedListingRef[] = [];
  for (const summary of summaries) {
    for (const ref of summary.headlineMismatches || []) {
      if (inferRoleFamilies(ref.title).some((family) => targetFamilies.has(family))) {
        out.push(ref);
      }
    }
  }
  return out;
}
