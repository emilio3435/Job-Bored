import {
  DEFAULT_STATUS,
  type DiscoveryRun,
  type NormalizedLead,
  type RawListing,
} from "../contracts.ts";
import {
  sanitizeCompensationText,
  toPlainText,
} from "../browser/selectors/shared.ts";

const SAFE_TRACKING_PARAM_PATTERN =
  /^(utm_.+|ref|source|src|gh_src|lever-source|fbclid|gclid|trk)$/i;

export type LeadNormalizationRejection = {
  reason:
    | "missing_required_fields"
    | "excluded_keyword"
    | "headline_mismatch"
    | "location_mismatch"
    | "remote_policy_mismatch";
  detail: string;
};

export type LeadNormalizationResult = {
  lead: NormalizedLead | null;
  rejection: LeadNormalizationRejection | null;
};

export type NormalizeLeadOptions = {
  enforceRelevanceFilters?: boolean;
};

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
  return normalizeLeadWithDiagnostics(rawListing, run).lead;
}

export function normalizeLeadWithDiagnostics(
  rawListing: RawListing,
  run: DiscoveryRun,
  options: NormalizeLeadOptions = {},
): LeadNormalizationResult {
  const enforceRelevanceFilters = options.enforceRelevanceFilters !== false;
  const title = toPlainText(rawListing.title);
  const company = toPlainText(rawListing.company);
  const url = normalizeLeadUrl(rawListing.url);
  const missingFields = [
    !title ? "title" : "",
    !company ? "company" : "",
    !url ? "url" : "",
  ].filter(Boolean);
  if (missingFields.length > 0) {
    return {
      lead: null,
      rejection: {
        reason: "missing_required_fields",
        detail: `Missing required fields: ${missingFields.join(", ")}.`,
      },
    };
  }

  const location = toPlainText(rawListing.location || "");
  const descriptionText = toPlainText(rawListing.descriptionText || "");
  const compensationText = sanitizeCompensationText(
    rawListing.compensationText || "",
  );
  const contact = toPlainText(rawListing.contact || "");
  const companyConfig = findCompanyConfig(run, company);
  const configuredIncludeKeywords = [
    ...run.config.includeKeywords,
    ...(companyConfig?.includeKeywords || []),
  ];
  const configuredExcludeKeywords = [
    ...run.config.excludeKeywords,
    ...(companyConfig?.excludeKeywords || []),
  ];
  const targetRoles = run.config.targetRoles || [];
  const normalizedLocation = normalizeLocationText(location);
  const headlineHaystack = [
    title,
    company,
    location,
    ...(rawListing.tags || []),
  ]
    .join(" ")
    .toLowerCase();
  const detailHaystack = descriptionText.toLowerCase();
  const haystack = [headlineHaystack, detailHaystack].filter(Boolean).join(" ");

  const matchedExcludeKeywords = findMatchedKeywords(
    haystack,
    configuredExcludeKeywords,
  );
  if (enforceRelevanceFilters && matchedExcludeKeywords.length > 0) {
    return {
      lead: null,
      rejection: {
        reason: "excluded_keyword",
        detail: `Matched exclude keywords: ${matchedExcludeKeywords.join(", ")}.`,
      },
    };
  }

  const matchedIncludeKeywords = findMatchedKeywords(
    headlineHaystack,
    configuredIncludeKeywords,
  );
  const matchedTargetRoles = findMatchedKeywords(headlineHaystack, targetRoles);
  if (
    enforceRelevanceFilters &&
    (configuredIncludeKeywords.length > 0 || targetRoles.length > 0) &&
    matchedIncludeKeywords.length === 0 &&
    matchedTargetRoles.length === 0
  ) {
    const filters = [
      configuredIncludeKeywords.length > 0
        ? `includeKeywords=[${configuredIncludeKeywords.join(", ")}]`
        : "",
      targetRoles.length > 0 ? `targetRoles=[${targetRoles.join(", ")}]` : "",
    ].filter(Boolean);
    return {
      lead: null,
      rejection: {
        reason: "headline_mismatch",
        detail: `No include keywords or target roles matched in title/company/location/tags${filters.length ? ` for ${filters.join(" ")}` : ""}.`,
      },
    };
  }
  const matchedLocationSignals = findMatchedLocationSignals(
    normalizedLocation,
    run.config.locations || [],
  );
  const remoteMatch = matchesRemotePolicy(
    normalizedLocation,
    descriptionText,
    run.config.remotePolicy || "",
  );
  if (
    enforceRelevanceFilters &&
    run.config.locations.length > 0 &&
    matchedLocationSignals.length === 0
  ) {
    return {
      lead: null,
      rejection: {
        reason: "location_mismatch",
        detail: `Location "${location || "<empty>"}" did not match configured locations [${run.config.locations.join(", ")}].`,
      },
    };
  }
  if (enforceRelevanceFilters && run.config.remotePolicy && !remoteMatch) {
    return {
      lead: null,
      rejection: {
        reason: "remote_policy_mismatch",
        detail: `Location "${location || "<empty>"}" did not satisfy remotePolicy="${run.config.remotePolicy}".`,
      },
    };
  }
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
    ...(rawListing.tags || []).map((entry) => toPlainText(entry)),
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

  const logoUrl = deriveLogoUrl(url, company);

  return {
    lead: {
      sourceId: rawListing.sourceId,
      sourceLabel: toPlainText(rawListing.sourceLabel) || rawListing.sourceId,
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
      logoUrl,
      discoveredAt,
      metadata: {
        runId: run.runId,
        variationKey: run.request.variationKey,
        sourceQuery: sourceQuery || `${rawListing.sourceLabel}:${url}`,
      },
    },
    rejection: null,
  };
}

function normalizeWhitespace(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTimestamp(input: string): string {
  const value = String(input || "").trim();
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function normalizeCompanyKey(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findCompanyConfig(
  run: DiscoveryRun,
  companyName: string,
): DiscoveryRun["config"]["companies"][number] | null {
  const wanted = normalizeCompanyKey(companyName);
  if (!wanted) return null;
  return (
    run.config.companies.find(
      (company) => normalizeCompanyKey(company.name) === wanted,
    ) || null
  );
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

const REMOTE_LOCATION_PATTERN =
  /\b(remote|remote-first|distributed|work from home|wfh|anywhere)\b/i;
const HYBRID_LOCATION_PATTERN = /\bhybrid\b/i;
const ONSITE_LOCATION_PATTERN =
  /\b(on[\s-]?site|in[\s-]?office|office-based)\b/i;

function normalizeLocationText(input: string): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/\bu\.?s\.?a?\b/g, "united states")
    .replace(/\bu\.?k\.?\b/g, "united kingdom")
    .replace(/\bnyc\b/g, "new york")
    .replace(/[|/]+/g, " ");
}

function findMatchedLocationSignals(
  normalizedLocation: string,
  locationSignals: string[],
): string[] {
  return tokenizeKeywords(locationSignals).filter((signal) =>
    locationSignalMatches(normalizedLocation, signal),
  );
}

function locationSignalMatches(
  normalizedLocation: string,
  signal: string,
): boolean {
  const normalizedSignal = normalizeLocationText(signal);
  if (!normalizedLocation || !normalizedSignal) return false;
  if (normalizedSignal === "remote") {
    return REMOTE_LOCATION_PATTERN.test(normalizedLocation);
  }
  return normalizedLocation.includes(normalizedSignal);
}

function matchesRemotePolicy(
  normalizedLocation: string,
  descriptionText: string,
  remotePolicy: string,
): boolean {
  const normalizedPolicy = normalizeWhitespace(remotePolicy).toLowerCase();
  if (!normalizedPolicy) return false;
  const haystack = normalizedLocation || normalizeLocationText(descriptionText);
  if (!haystack) return false;

  if (
    normalizedPolicy === "remote" ||
    normalizedPolicy === "remote-first" ||
    normalizedPolicy === "remote first" ||
    normalizedPolicy === "fully remote"
  ) {
    return REMOTE_LOCATION_PATTERN.test(haystack);
  }
  if (normalizedPolicy === "hybrid") {
    return HYBRID_LOCATION_PATTERN.test(haystack);
  }
  if (
    normalizedPolicy === "on-site" ||
    normalizedPolicy === "on site" ||
    normalizedPolicy === "onsite" ||
    normalizedPolicy === "in-office"
  ) {
    return ONSITE_LOCATION_PATTERN.test(haystack);
  }

  return haystack.includes(normalizedPolicy);
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

const ATS_HOSTS = new Set([
  "boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
]);

const AGGREGATOR_KEYWORDS = [
  "builtin",
  "indeed",
  "linkedin",
  "glassdoor",
  "ziprecruiter",
  "monster",
  "dice",
  "wellfound",
  "angel.co",
  "workatastartup",
  "simplyhired",
  "careerbuilder",
  "ycombinator",
  "lever.co",
  "greenhouse.io",
  "workday",
  "myworkday",
  "icims",
  "jobvite",
  "smartrecruiters",
  "hired.com",
  "triplebyte",
  "otta.com",
  "remoteok",
  "weworkremotely",
  "flexjobs",
  "remotive",
  "startupmatcher",
];

const COMPANY_SUFFIXES =
  /\b(inc\.?|llc\.?|ltd\.?|co\.?|corp\.?|corporation|company|group|plc|gmbh|s\.?a\.?|technologies|technology|labs?|software|platform|ai)\s*$/i;

function slugifyCompanyName(name: string): string {
  return String(name || "")
    .replace(COMPANY_SUFFIXES, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 63);
}

/**
 * Derive the employer's own domain from a job URL + company name.
 * 1. Known ATS hosts -> extract company slug from path -> {slug}.com
 * 2. Known aggregator / job-board hosts -> skip URL, use company name
 * 3. Other hosts -> assume it's the company's own domain
 * 4. No URL -> slugify company name -> {slug}.com
 */
export function deriveCompanyDomain(jobUrl: string, company: string): string {
  const trimmed = String(jobUrl || "").trim();
  if (trimmed) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();

      if (ATS_HOSTS.has(host)) {
        const slug = (parsed.pathname.split("/")[1] || "")
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "");
        if (slug) return `${slug}.com`;
      }

      const isAggregator = AGGREGATOR_KEYWORDS.some((kw) => host.includes(kw));
      if (!isAggregator && host && host !== "localhost") {
        return host;
      }
    } catch {
      /* fall through */
    }
  }
  const slug = slugifyCompanyName(company);
  return slug ? `${slug}.com` : "";
}

/**
 * Persist a favicon URL for the employer domain (Google s2 service).
 * Clearbit logo CDN is unreliable; autocomplete no longer returns logo URLs.
 */
export function deriveLogoUrl(jobUrl: string, company: string): string {
  const domain = deriveCompanyDomain(jobUrl, company);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
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
    points.push(
      `Reference relevant skills: ${matchedIncludeKeywords.join(", ")}`,
    );
  }
  if (remoteMatch) {
    points.push("Call out success in remote-first collaboration");
  }
  if (seniorityMatch) {
    points.push("Anchor examples at the requested seniority level");
  }
  return points.join(". ");
}
