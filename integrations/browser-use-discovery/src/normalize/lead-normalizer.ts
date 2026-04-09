import {
  DEFAULT_STATUS,
  type DiscoveryRun,
  type NormalizedLead,
  type RawListing,
} from "../contracts.ts";

const SAFE_TRACKING_PARAM_PATTERN =
  /^(utm_.+|ref|source|src|gh_src|lever-source|fbclid|gclid|trk)$/i;

export function normalizeLeadUrl(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = "";
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (SAFE_TRACKING_PARAM_PATTERN.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.search = parsed.searchParams.toString()
      ? `?${parsed.searchParams.toString()}`
      : "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString();
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

export function normalizeLead(
  rawListing: RawListing,
  run: DiscoveryRun,
): NormalizedLead | null {
  const title = normalizeWhitespace(rawListing.title);
  const company = normalizeWhitespace(rawListing.company);
  const url = normalizeLeadUrl(rawListing.url);
  if (!title || !company || !url) return null;

  const location = normalizeWhitespace(rawListing.location || "");
  const descriptionText = normalizeWhitespace(rawListing.descriptionText || "");
  const compensationText = normalizeWhitespace(rawListing.compensationText || "");
  const contact = normalizeWhitespace(rawListing.contact || "");
  const configuredIncludeKeywords = [
    ...run.config.includeKeywords,
    ...(run.config.companies[0]?.includeKeywords || []),
  ];
  const configuredExcludeKeywords = [
    ...run.config.excludeKeywords,
    ...(run.config.companies[0]?.excludeKeywords || []),
  ];
  const targetRoles = run.config.targetRoles || [];
  const haystack = [
    title,
    company,
    location,
    descriptionText,
    ...rawListing.tags || [],
  ]
    .join(" ")
    .toLowerCase();

  if (matchesAnyKeyword(haystack, configuredExcludeKeywords)) {
    return null;
  }

  const matchedIncludeKeywords = findMatchedKeywords(
    haystack,
    configuredIncludeKeywords,
  );
  const matchedTargetRoles = findMatchedKeywords(haystack, targetRoles);
  const matchedLocationSignals = findMatchedKeywords(
    haystack,
    run.config.locations || [],
  );
  const remoteMatch = run.config.remotePolicy
    ? haystack.includes(run.config.remotePolicy.toLowerCase())
    : false;
  const seniorityMatch = run.config.seniority
    ? haystack.includes(run.config.seniority.toLowerCase())
    : false;

  const fitScore = scoreLead({
    matchedIncludeKeywords,
    matchedTargetRoles,
    matchedLocationSignals,
    remoteMatch,
    seniorityMatch,
  });
  const priority = scoreToPriority(fitScore);
  const tags = dedupeStrings([
    ...(rawListing.tags || []).map((entry) => normalizeWhitespace(entry)),
    ...matchedIncludeKeywords,
    ...matchedTargetRoles,
    ...matchedLocationSignals,
  ]);
  const fitAssessment = buildFitAssessment({
    matchedIncludeKeywords,
    matchedTargetRoles,
    matchedLocationSignals,
    remoteMatch,
    seniorityMatch,
    descriptionText,
  });
  const talkingPoints = buildTalkingPoints({
    matchedIncludeKeywords,
    matchedTargetRoles,
    remoteMatch,
    seniorityMatch,
  });
  const discoveredAt = normalizeTimestamp(run.request.requestedAt);
  const sourceQuery =
    rawListing.metadata &&
    typeof rawListing.metadata === "object" &&
    typeof rawListing.metadata.sourceQuery === "string"
      ? normalizeWhitespace(rawListing.metadata.sourceQuery)
      : "";

  return {
    sourceId: rawListing.sourceId,
    sourceLabel:
      normalizeWhitespace(rawListing.sourceLabel) || rawListing.sourceId,
    title,
    company,
    location,
    url,
    compensationText,
    fitScore,
    priority,
    tags,
    fitAssessment,
    contact,
    status: DEFAULT_STATUS,
    appliedDate: "",
    notes: "",
    followUpDate: "",
    talkingPoints,
    discoveredAt,
    metadata: {
      runId: run.runId,
      variationKey: run.request.variationKey,
      sourceQuery: sourceQuery || `${rawListing.sourceLabel}:${url}`,
    },
  };
}

function normalizeWhitespace(input: string): string {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function normalizeTimestamp(input: string): string {
  const value = String(input || "").trim();
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function tokenizeKeywords(values: string[]): string[] {
  return dedupeStrings(
    values.flatMap((value) =>
      String(value || "")
        .split(/[,\n;]+/)
        .map((entry) => normalizeWhitespace(entry)),
    ),
  );
}

function findMatchedKeywords(haystack: string, keywords: string[]): string[] {
  const normalizedHaystack = haystack.toLowerCase();
  return tokenizeKeywords(keywords).filter((keyword) =>
    normalizedHaystack.includes(keyword.toLowerCase()),
  );
}

function matchesAnyKeyword(haystack: string, keywords: string[]): boolean {
  return findMatchedKeywords(haystack, keywords).length > 0;
}

function scoreLead({
  matchedIncludeKeywords,
  matchedTargetRoles,
  matchedLocationSignals,
  remoteMatch,
  seniorityMatch,
}: {
  matchedIncludeKeywords: string[];
  matchedTargetRoles: string[];
  matchedLocationSignals: string[];
  remoteMatch: boolean;
  seniorityMatch: boolean;
}): number {
  const score =
    4 +
    Math.min(3, matchedIncludeKeywords.length) +
    Math.min(2, matchedTargetRoles.length) +
    (matchedLocationSignals.length ? 1 : 0) +
    (remoteMatch ? 1 : 0) +
    (seniorityMatch ? 1 : 0);
  return Math.max(1, Math.min(10, score));
}

function scoreToPriority(score: number): NormalizedLead["priority"] {
  if (score >= 9) return "🔥";
  if (score >= 7) return "⚡";
  if (score <= 3) return "↓";
  return "—";
}

function buildFitAssessment({
  matchedIncludeKeywords,
  matchedTargetRoles,
  matchedLocationSignals,
  remoteMatch,
  seniorityMatch,
  descriptionText,
}: {
  matchedIncludeKeywords: string[];
  matchedTargetRoles: string[];
  matchedLocationSignals: string[];
  remoteMatch: boolean;
  seniorityMatch: boolean;
  descriptionText: string;
}): string {
  const parts: string[] = [];
  if (matchedTargetRoles.length) {
    parts.push(`Role match: ${matchedTargetRoles.join(", ")}`);
  }
  if (matchedIncludeKeywords.length) {
    parts.push(`Keyword match: ${matchedIncludeKeywords.join(", ")}`);
  }
  if (matchedLocationSignals.length) {
    parts.push(`Location signal: ${matchedLocationSignals.join(", ")}`);
  }
  if (remoteMatch) {
    parts.push("Remote policy aligned");
  }
  if (seniorityMatch) {
    parts.push("Seniority aligned");
  }
  if (!parts.length && descriptionText) {
    parts.push(descriptionText.slice(0, 180));
  }
  return parts.join(". ").trim();
}

function buildTalkingPoints({
  matchedIncludeKeywords,
  matchedTargetRoles,
  remoteMatch,
  seniorityMatch,
}: {
  matchedIncludeKeywords: string[];
  matchedTargetRoles: string[];
  remoteMatch: boolean;
  seniorityMatch: boolean;
}): string {
  const points: string[] = [];
  if (matchedTargetRoles.length) {
    points.push(`Lead with role overlap: ${matchedTargetRoles.join(", ")}`);
  }
  if (matchedIncludeKeywords.length) {
    points.push(`Reference relevant skills: ${matchedIncludeKeywords.join(", ")}`);
  }
  if (remoteMatch) {
    points.push("Call out success in remote-first collaboration");
  }
  if (seniorityMatch) {
    points.push("Anchor examples at the requested seniority level");
  }
  return points.join(". ");
}
