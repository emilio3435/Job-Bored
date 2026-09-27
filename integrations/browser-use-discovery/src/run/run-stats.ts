import type { DiscoveryRunStats } from "../contracts.ts";

type Funnel = NonNullable<DiscoveryRunStats["funnel"]>;
type Source = NonNullable<DiscoveryRunStats["sources"]>[number];
type TimelineStart = { phase: string; label?: string; startedAt: string };

export type RunStatsInput = {
  startedAt: string;
  completedAt: string;
  funnel?: Funnel;
  rejectionReasons?: Record<string, number>;
  candidateFitScores?: Array<number | null | undefined>;
  sources?: Source[];
  timeline?: TimelineStart[];
  matcherCalls?: number;
  searchedCompanies?: string[];
  searchedQueries?: string[];
  searchedTruncated?: boolean;
};

const MAX_LABELS = 50;
const MAX_LABEL_LENGTH = 120;
const MAX_SOURCES = 8;
const MAX_REASONS = 8;

function finiteCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function roundHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeLabels(values: string[]): { labels: string[]; truncated: boolean } {
  const labels: string[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const value of values) {
    const label = String(value || "").replace(/\s+/g, " ").trim();
    if (!label) continue;
    // Labels are deliberately not URLs or arbitrary diagnostics. A URL can
    // contain credentials in its authority or query string.
    if (label.length > MAX_LABEL_LENGTH ||
      /https?:\/\/|www\.|[?&#=@/\\]|\b(?:token|secret|password|api[_-]?key|bearer)\b|[A-Za-z0-9_-]{32,}/i.test(label)) {
      truncated = true;
      continue;
    }
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (labels.length === MAX_LABELS) {
      truncated = true;
      continue;
    }
    labels.push(label);
  }
  return { labels, truncated };
}

/** Pure, bounded projection of observations; callers catch any unexpected error. */
export function buildRunStats(input: RunStatsInput): DiscoveryRunStats {
  const startedMs = Date.parse(input.startedAt);
  const completedMs = Date.parse(input.completedAt);
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs)
    ? Math.max(0, completedMs - startedMs)
    : undefined;
  const funnel: Funnel = {};
  for (const key of [
    "companiesSearched", "boardsDetected", "queriesRun", "listingsSeen",
    "listingsProcessed", "duplicatesInRun", "duplicatesVsSheet", "rejected",
    "candidates", "written", "updated",
  ] as const) {
    const value = finiteCount(input.funnel?.[key]);
    if (value !== undefined) funnel[key] = value;
  }
  const rejectedTopReasons = Object.entries(input.rejectionReasons || {})
    .map(([reason, count]) => ({ reason, count: finiteCount(count) }))
    .filter((entry): entry is { reason: string; count: number } =>
      Boolean(entry.reason) && entry.count !== undefined && entry.count > 0)
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, MAX_REASONS);
  if (rejectedTopReasons.length) funnel.rejectedTopReasons = rejectedTopReasons;

  const scores = (input.candidateFitScores || [])
    .filter((score): score is number =>
      typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 10)
    .sort((a, b) => a - b);
  let fit: DiscoveryRunStats["fit"];
  if (scores.length) {
    const middle = Math.floor(scores.length / 2);
    const histogram = Array.from({ length: 11 }, () => 0);
    for (const score of scores) histogram[Math.round(score)] += 1;
    fit = {
      scored: scores.length,
      avg: roundHundredth(scores.reduce((sum, score) => sum + score, 0) / scores.length),
      median: roundHundredth(scores.length % 2 ? scores[middle] : (scores[middle - 1] + scores[middle]) / 2),
      min: scores[0],
      max: scores[scores.length - 1],
      scale: 10,
      histogram,
    };
  }

  const timeline = (input.timeline || []).map((entry, index, entries) => {
    const at = Date.parse(entry.startedAt);
    const next = Date.parse(entries[index + 1]?.startedAt || input.completedAt);
    return {
      phase: entry.phase,
      ...(entry.label ? { label: entry.label } : {}),
      startedAt: entry.startedAt,
      ...(Number.isFinite(at) && Number.isFinite(next)
        ? { durationMs: Math.max(0, next - at) }
        : {}),
    };
  });
  const companies = safeLabels(input.searchedCompanies || []);
  const queries = safeLabels(input.searchedQueries || []);
  const matcherCalls = finiteCount(input.matcherCalls);
  return {
    schemaVersion: 1,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(Object.keys(funnel).length ? { funnel } : {}),
    ...(fit ? { fit } : {}),
    ...(input.sources ? { sources: input.sources.slice(0, MAX_SOURCES) } : {}),
    ...(timeline.length ? { timeline } : {}),
    ...(matcherCalls !== undefined ? { matcherCalls } : {}),
    searched: {
      companies: companies.labels,
      queries: queries.labels,
      truncated: Boolean(input.searchedTruncated) || companies.truncated || queries.truncated,
    },
  };
}
