import type { WorkerRuntimeConfig } from "../config.ts";
import type { DiscoveryRun, RawListing } from "../contracts.ts";
import { toPlainText } from "../browser/selectors/shared.ts";

type AnyRecord = Record<string, unknown>;
type FetchImpl = typeof fetch;

const AI_MATCH_PROMPT_VERSION = "job-match-v1";
const REMOTE_PATTERN =
  /\b(remote|remote-first|remote first|distributed|work from home|wfh|anywhere)\b/i;
const HYBRID_PATTERN = /\bhybrid\b/i;
const ONSITE_PATTERN =
  /\b(on[\s-]?site|onsite|in[\s-]?office|office-based)\b/i;
const US_STATE_TOKEN_PATTERN =
  /\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|ia|id|il|in|ks|ky|la|ma|md|me|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|dc)\b/i;

const ROLE_FAMILY_RULES = [
  {
    id: "growth_marketing",
    patterns: [
      "growth marketing",
      "performance marketing",
      "product marketing",
      "paid media",
      "demand generation",
      "lifecycle marketing",
      "partner marketing",
      "account based marketing",
      "marketing lead",
      "marketing manager",
      "marketing operations",
    ],
  },
  {
    id: "product_manager",
    patterns: [
      "product manager",
      "product management",
      "group product manager",
      "staff product manager",
      "principal product manager",
      "technical product manager",
      "product lead",
    ],
  },
  {
    id: "community",
    patterns: [
      "community",
      "creator",
      "events",
      "partnerships",
      "advocacy",
    ],
  },
  {
    id: "ai_strategy",
    patterns: [
      "ai strategy",
      "ai automation",
      "automation",
      "applied ai",
      "ai applications",
      "ai ops",
      "ai operations",
      "solutions architect",
      "deployment strategist",
    ],
  },
  {
    id: "backend_platform_engineering",
    patterns: [
      "backend",
      "backend engineer",
      "platform engineer",
      "platform engineering",
      "distributed systems",
      "infrastructure engineer",
      "site reliability",
      "sre",
      "devops",
      "api",
      "services",
    ],
  },
  {
    id: "mobile_engineering",
    patterns: [
      "android",
      "ios",
      "mobile engineer",
      "android engineer",
      "ios engineer",
    ],
  },
];

export type MatchDecision = {
  decision: "accept" | "reject" | "uncertain";
  overallScore: number;
  confidence: number;
  componentScores: {
    role: number;
    location: number;
    remote: number;
    seniority: number;
    negative: number;
  };
  reasons: string[];
  hardRejectReason: string;
  modelVersion: string;
  promptVersion: string;
};

export type DiscoveryMatchClient = {
  evaluate(input: {
    rawListing: RawListing;
    run: DiscoveryRun;
    baseline: MatchDecision;
  }): Promise<MatchDecision>;
};

type TargetProfile = {
  targetRoles: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  locations: string[];
  remotePolicy: string;
  seniority: string;
  roleFamilies: string[];
};

type JobProfile = {
  title: string;
  company: string;
  canonicalTitle: string;
  location: string;
  inferredLocation: string;
  descriptionText: string;
  headlineHaystack: string;
  detailHaystack: string;
  roleFamilies: string[];
  remoteMode: "remote" | "hybrid" | "onsite" | "unknown";
};

export function scoreListingMatch(
  rawListing: RawListing,
  run: DiscoveryRun,
): MatchDecision {
  const target = buildTargetProfile(run);
  const job = buildJobProfile(rawListing);

  const titleExcludeMatches = findMatchedPhrases(
    job.headlineHaystack,
    target.excludeKeywords,
  );
  const detailExcludeMatches = findMatchedPhrases(
    job.detailHaystack,
    target.excludeKeywords,
  ).filter((entry) => !titleExcludeMatches.includes(entry));

  const hardRejectReason = titleExcludeMatches.length
    ? `Headline matched exclude keywords: ${titleExcludeMatches.join(", ")}.`
    : "";

  const matchedRolePhrases = findMatchedPhrases(job.headlineHaystack, [
    ...target.targetRoles,
    ...target.includeKeywords,
  ]);
  const matchedRoleFamilies = intersect(target.roleFamilies, job.roleFamilies);
  const matchedLocationSignals = findMatchedLocationSignals(
    job.inferredLocation,
    target.locations,
  );
  const remoteMatch = scoreRemoteAlignment(target.remotePolicy, job);
  const locationScore = scoreLocationAlignment(target.locations, job);
  const roleScore = scoreRoleAlignment(target, job, matchedRolePhrases, matchedRoleFamilies);
  const seniorityScore = scoreSeniorityAlignment(target.seniority, job);
  const negativeScore = titleExcludeMatches.length
    ? 0
    : detailExcludeMatches.length
      ? 0.45
      : 1;

  const overallScore = clamp(
    roleScore * 0.45 +
      locationScore * 0.2 +
      remoteMatch.score * 0.15 +
      seniorityScore * 0.05 +
      negativeScore * 0.15,
  );

  const reasons: string[] = [];
  if (matchedRoleFamilies.length > 0) {
    reasons.push(`Role families: ${matchedRoleFamilies.join(", ")}`);
  }
  if (matchedRolePhrases.length > 0) {
    reasons.push(`Matched role phrases: ${matchedRolePhrases.join(", ")}`);
  }
  if (matchedLocationSignals.length > 0) {
    reasons.push(`Matched locations: ${matchedLocationSignals.join(", ")}`);
  }
  if (remoteMatch.reason) {
    reasons.push(remoteMatch.reason);
  }
  if (detailExcludeMatches.length > 0) {
    reasons.push(
      `Soft exclude keywords only in description: ${detailExcludeMatches.join(", ")}`,
    );
  }
  if (!reasons.length) {
    reasons.push("No strong structured match signals were found.");
  }

  const decision = decideMatch({
    hardRejectReason,
    roleScore,
    locationScore,
    remoteScore: remoteMatch.score,
    seniorityScore,
    negativeScore,
    overallScore,
  });

  const evidenceCount =
    matchedRolePhrases.length +
    matchedRoleFamilies.length +
    matchedLocationSignals.length +
    (remoteMatch.score >= 0.8 ? 1 : 0) +
    (detailExcludeMatches.length > 0 ? 1 : 0);
  const confidence = clamp(
    decision === "uncertain"
      ? 0.45 + Math.min(0.2, evidenceCount * 0.04)
      : 0.62 + Math.min(0.3, evidenceCount * 0.05),
  );

  return {
    decision,
    overallScore,
    confidence,
    componentScores: {
      role: roleScore,
      location: locationScore,
      remote: remoteMatch.score,
      seniority: seniorityScore,
      negative: negativeScore,
    },
    reasons,
    hardRejectReason,
    modelVersion: "deterministic-structured-v1",
    promptVersion: AI_MATCH_PROMPT_VERSION,
  };
}

export function shouldUseAiMatcher(
  decision: MatchDecision,
  run: DiscoveryRun,
  aiCallsUsed: number,
): boolean {
  const maxCalls = Math.max(4, Math.min(12, run.config.maxLeadsPerRun));
  if (aiCallsUsed >= maxCalls) return false;
  if (decision.hardRejectReason) return false;
  if (decision.decision === "uncertain") return true;
  if (decision.decision === "accept") {
    return decision.confidence < 0.72;
  }
  return false;
}

export function createGeminiMatchClient(
  runtimeConfig: WorkerRuntimeConfig,
  dependencies: { fetchImpl?: FetchImpl } = {},
): DiscoveryMatchClient {
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  return {
    async evaluate({ rawListing, run, baseline }) {
      const apiKey = String(runtimeConfig.geminiApiKey || "").trim();
      if (!apiKey) return baseline;

      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(runtimeConfig.geminiModel || "gemini-2.5-flash")}:generateContent`;
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: [
                    "You score job-posting relevance for a job discovery pipeline.",
                    "Be conservative and high precision.",
                    "Return strict JSON only.",
                    'Use this shape: {"decision":"accept|reject|uncertain","overallScore":0.0,"confidence":0.0,"hardRejectReason":"","reasons":["..."],"componentScores":{"role":0.0,"location":0.0,"remote":0.0,"seniority":0.0,"negative":0.0}}.',
                    "Reject obvious mismatches and explicit excluded roles.",
                    "Do not reject solely because a keyword appears in generic boilerplate unless the title itself conflicts.",
                  ].join(" "),
                },
              ],
            },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: buildAiMatchPrompt(rawListing, run, baseline),
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          return annotateFallbackDecision(
            baseline,
            `AI matcher HTTP ${response.status}: ${objectString(payload, "error", "message") || "request failed"}.`,
          );
        }

        const parsed = parseLooseJson(extractModelText(payload));
        const normalized = normalizeAiDecision(parsed, baseline, runtimeConfig.geminiModel);
        return normalized || annotateFallbackDecision(baseline, "AI matcher returned invalid JSON.");
      } catch (error) {
        return annotateFallbackDecision(
          baseline,
          `AI matcher failed: ${formatError(error)}`,
        );
      }
    },
  };
}

function buildTargetProfile(run: DiscoveryRun): TargetProfile {
  const companyKeywords = run.config.companies.flatMap((company) => [
    ...(company.includeKeywords || []),
    ...(company.excludeKeywords || []),
  ]);
  const includeKeywords = tokenizeKeywords([
    ...run.config.includeKeywords,
    ...run.config.companies.flatMap((company) => company.includeKeywords || []),
  ]);
  const excludeKeywords = tokenizeKeywords([
    ...run.config.excludeKeywords,
    ...run.config.companies.flatMap((company) => company.excludeKeywords || []),
  ]);
  return {
    targetRoles: tokenizeKeywords(run.config.targetRoles),
    includeKeywords,
    excludeKeywords,
    locations: tokenizeKeywords(run.config.locations),
    remotePolicy: cleanText(run.config.remotePolicy),
    seniority: cleanText(run.config.seniority),
    roleFamilies: inferRoleFamilies(
      [
        ...run.config.targetRoles,
        ...run.config.includeKeywords,
        ...companyKeywords,
      ].join(" "),
    ),
  };
}

function buildJobProfile(rawListing: RawListing): JobProfile {
  const title = cleanText(rawListing.title);
  const company = cleanText(rawListing.company);
  const location = cleanText(rawListing.location || "");
  const descriptionText = cleanText(rawListing.descriptionText || "");
  const titleLocation = extractLocationFromTitle(title);
  const inferredLocation = normalizeLocationText(location || titleLocation);
  const canonicalTitle = cleanTitleForMatching(title);
  const headlineHaystack = cleanText(
    [title, company, location, ...(rawListing.tags || [])].join(" "),
  ).toLowerCase();
  return {
    title,
    company,
    canonicalTitle,
    location,
    inferredLocation,
    descriptionText,
    headlineHaystack,
    detailHaystack: descriptionText.toLowerCase(),
    roleFamilies: inferRoleFamilies(
      [canonicalTitle, ...(rawListing.tags || []), descriptionText].join(" "),
    ),
    remoteMode: inferRemoteMode([location, title, descriptionText].join(" ")),
  };
}

function buildAiMatchPrompt(
  rawListing: RawListing,
  run: DiscoveryRun,
  baseline: MatchDecision,
): string {
  return [
    `Company target set: ${run.config.companies.map((company) => company.name).join(", ")}`,
    `Target roles: ${joinOrAny(run.config.targetRoles)}`,
    `Include keywords: ${joinOrAny(run.config.includeKeywords)}`,
    `Exclude keywords: ${joinOrAny(run.config.excludeKeywords)}`,
    `Locations: ${joinOrAny(run.config.locations)}`,
    `Remote policy: ${run.config.remotePolicy || "any"}`,
    `Seniority: ${run.config.seniority || "any"}`,
    "",
    `Job title: ${cleanText(rawListing.title)}`,
    `Job company: ${cleanText(rawListing.company)}`,
    `Job location: ${cleanText(rawListing.location || "") || "<empty>"}`,
    `Job tags: ${joinOrAny(rawListing.tags || [])}`,
    `Job url: ${cleanText(rawListing.url)}`,
    `Job description: ${cleanText(rawListing.descriptionText || "").slice(0, 1200) || "<empty>"}`,
    "",
    `Deterministic baseline decision: ${baseline.decision}`,
    `Deterministic baseline score: ${baseline.overallScore}`,
    `Deterministic baseline reasons: ${baseline.reasons.join(" | ")}`,
  ].join("\n");
}

function normalizeAiDecision(
  payload: unknown,
  fallback: MatchDecision,
  modelVersion: string,
): MatchDecision | null {
  if (!isPlainRecord(payload)) return null;
  const rawDecision = cleanText(payload.decision).toLowerCase();
  const decision =
    rawDecision === "accept" ||
    rawDecision === "reject" ||
    rawDecision === "uncertain"
      ? rawDecision
      : "";
  if (!decision) return null;

  const componentScores = isPlainRecord(payload.componentScores)
    ? {
        role: readNumber(payload.componentScores.role, fallback.componentScores.role),
        location: readNumber(
          payload.componentScores.location,
          fallback.componentScores.location,
        ),
        remote: readNumber(
          payload.componentScores.remote,
          fallback.componentScores.remote,
        ),
        seniority: readNumber(
          payload.componentScores.seniority,
          fallback.componentScores.seniority,
        ),
        negative: readNumber(
          payload.componentScores.negative,
          fallback.componentScores.negative,
        ),
      }
    : fallback.componentScores;

  const reasons = readStringArray(payload.reasons);
  return {
    decision,
    overallScore: clamp(readNumber(payload.overallScore, fallback.overallScore)),
    confidence: clamp(readNumber(payload.confidence, fallback.confidence)),
    componentScores: {
      role: clamp(componentScores.role),
      location: clamp(componentScores.location),
      remote: clamp(componentScores.remote),
      seniority: clamp(componentScores.seniority),
      negative: clamp(componentScores.negative),
    },
    reasons: reasons.length ? reasons : fallback.reasons,
    hardRejectReason: cleanText(payload.hardRejectReason),
    modelVersion,
    promptVersion: AI_MATCH_PROMPT_VERSION,
  };
}

function annotateFallbackDecision(
  decision: MatchDecision,
  note: string,
): MatchDecision {
  return {
    ...decision,
    reasons: [...decision.reasons, note].slice(-6),
  };
}

function decideMatch(input: {
  hardRejectReason: string;
  roleScore: number;
  locationScore: number;
  remoteScore: number;
  seniorityScore: number;
  negativeScore: number;
  overallScore: number;
}): MatchDecision["decision"] {
  // Hybrid gate — only hard garbage rejects. Anything plausible becomes either
  // "accept" (high-confidence good match) or "uncertain" (marginal but worth
  // surfacing). The downstream pipeline writes both to the sheet with the
  // overallScore in a "Match Score" column so the user can sort/filter in-
  // sheet instead of having the matcher silently discard borderline jobs.
  if (input.hardRejectReason) return "reject";
  // Extreme-negative content (explicit excluded keywords matched heavily)
  if (input.negativeScore <= 0.05) return "reject";
  // Completely-unrelated role. <= 0.1 catches the scoreRoleAlignment "no
  // match found" baseline (exactly 0.1) in addition to any weaker signal.
  if (input.roleScore <= 0.1) return "reject";
  // Absolute trash overall
  if (input.overallScore < 0.2) return "reject";
  // High-confidence accept (kept strict so "accept" means something)
  if (
    input.overallScore >= 0.6 &&
    input.roleScore >= 0.5 &&
    input.locationScore >= 0.35 &&
    input.remoteScore >= 0.35 &&
    input.negativeScore >= 0.35
  ) {
    return "accept";
  }
  // Everything else: uncertain → still surfaced to the sheet, with the score
  // for the user to triage.
  return "uncertain";
}

function scoreRoleAlignment(
  target: TargetProfile,
  job: JobProfile,
  matchedRolePhrases: string[],
  matchedRoleFamilies: string[],
): number {
  if (target.targetRoles.length === 0 && target.includeKeywords.length === 0) {
    return 1;
  }
  if (matchedRolePhrases.length > 0) return 1;
  if (matchedRoleFamilies.length > 0) return 0.85;
  if (findMatchedPhrases(job.detailHaystack, target.includeKeywords).length > 0) {
    return 0.42;
  }
  return 0.1;
}

function scoreLocationAlignment(
  targetLocations: string[],
  job: JobProfile,
): number {
  if (targetLocations.length === 0) return 1;
  const normalizedLocation = job.inferredLocation;
  if (!normalizedLocation) return 0.55;
  const matched = findMatchedLocationSignals(normalizedLocation, targetLocations);
  if (matched.length > 0) return 1;
  return 0.1;
}

function scoreRemoteAlignment(
  remotePolicy: string,
  job: JobProfile,
): { score: number; reason: string } {
  const normalizedPolicy = cleanText(remotePolicy).toLowerCase();
  if (!normalizedPolicy) {
    return { score: 1, reason: "" };
  }

  if (
    normalizedPolicy === "remote" ||
    normalizedPolicy === "remote-first" ||
    normalizedPolicy === "remote first" ||
    normalizedPolicy === "fully remote"
  ) {
    if (job.remoteMode === "remote") {
      return { score: 1, reason: "Remote policy aligned" };
    }
    if (job.remoteMode === "hybrid") {
      return { score: 0.2, reason: "Job appears hybrid while target policy is remote" };
    }
    if (job.remoteMode === "onsite") {
      return { score: 0, reason: "Job appears onsite while target policy is remote" };
    }
    return { score: 0.6, reason: "Remote policy unknown from structured fields" };
  }

  if (normalizedPolicy === "hybrid") {
    if (job.remoteMode === "hybrid") {
      return { score: 1, reason: "Hybrid policy aligned" };
    }
    if (job.remoteMode === "onsite") {
      return { score: 0.3, reason: "Job appears onsite while target policy is hybrid" };
    }
    return { score: 0.55, reason: "Hybrid policy not explicit in structured fields" };
  }

  if (
    normalizedPolicy === "on-site" ||
    normalizedPolicy === "on site" ||
    normalizedPolicy === "onsite" ||
    normalizedPolicy === "in-office"
  ) {
    if (job.remoteMode === "onsite") {
      return { score: 1, reason: "Onsite policy aligned" };
    }
    if (job.remoteMode === "remote") {
      return { score: 0.1, reason: "Job appears remote while target policy is onsite" };
    }
    return { score: 0.5, reason: "Onsite policy not explicit in structured fields" };
  }

  return {
    score: cleanText([job.location, job.descriptionText].join(" "))
      .toLowerCase()
      .includes(normalizedPolicy)
      ? 1
      : 0.55,
    reason: "",
  };
}

function scoreSeniorityAlignment(seniority: string, job: JobProfile): number {
  const wanted = cleanText(seniority).toLowerCase();
  if (!wanted) return 1;
  const haystack = `${job.canonicalTitle} ${job.descriptionText}`.toLowerCase();
  return haystack.includes(wanted) ? 1 : 0.55;
}

function inferRoleFamilies(input: string): string[] {
  const haystack = cleanText(input).toLowerCase();
  const out: string[] = [];
  for (const rule of ROLE_FAMILY_RULES) {
    if (rule.patterns.some((pattern) => haystack.includes(pattern))) {
      out.push(rule.id);
    }
  }
  return out;
}

function inferRemoteMode(input: string): JobProfile["remoteMode"] {
  const haystack = cleanText(input).toLowerCase();
  if (!haystack) return "unknown";
  if (REMOTE_PATTERN.test(haystack)) return "remote";
  if (HYBRID_PATTERN.test(haystack)) return "hybrid";
  if (ONSITE_PATTERN.test(haystack)) return "onsite";
  return "unknown";
}

function extractLocationFromTitle(title: string): string {
  const cleanTitle = cleanText(title);
  if (!cleanTitle) return "";
  const parenMatch = cleanTitle.match(/\(([^()]{2,80})\)\s*$/);
  if (parenMatch) return parenMatch[1];
  const dashMatch = cleanTitle.match(/\s[-|]\s([^-|]{2,80})$/);
  if (dashMatch) return dashMatch[1];
  return "";
}

function cleanTitleForMatching(title: string): string {
  return cleanText(title)
    .replace(/\(([^()]{2,80})\)\s*$/g, "")
    .replace(/\s[-|]\s([^-|]{2,80})$/g, "")
    .trim();
}

function findMatchedPhrases(haystack: string, phrases: string[]): string[] {
  const normalizedHaystack = cleanText(haystack).toLowerCase();
  return tokenizeKeywords(phrases).filter((phrase) =>
    phraseMatchesHaystack(normalizedHaystack, phrase),
  );
}

function phraseMatchesHaystack(haystack: string, phrase: string): boolean {
  const normalizedPhrase = cleanText(phrase).toLowerCase();
  if (!normalizedPhrase) return false;
  if (!/[a-z0-9]/.test(normalizedPhrase)) {
    return haystack.includes(normalizedPhrase);
  }
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegExp(normalizedPhrase).replace(/ /g, "\\s+")}(?=$|[^a-z0-9])`,
    "i",
  );
  return pattern.test(haystack);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    return REMOTE_PATTERN.test(normalizedLocation);
  }
  if (normalizedSignal === "united states" || normalizedSignal === "us") {
    return (
      normalizedLocation.includes("united states") ||
      /\busa\b/.test(normalizedLocation) ||
      /\bu\.s\.\b/.test(normalizedLocation) ||
      US_STATE_TOKEN_PATTERN.test(normalizedLocation)
    );
  }
  return normalizedLocation.includes(normalizedSignal);
}

function normalizeLocationText(input: string): string {
  return cleanText(input)
    .toLowerCase()
    .replace(/\bu\.?s\.?a?\b/g, "united states")
    .replace(/\bu\.?k\.?\b/g, "united kingdom")
    .replace(/\bnyc\b/g, "new york")
    .replace(/[|/]+/g, " ");
}

function tokenizeKeywords(values: string[]): string[] {
  return dedupeStrings(
    values.flatMap((value) =>
      String(value || "")
        .split(/[,\n;]+/)
        .map((entry) => cleanText(entry)),
    ),
  );
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = cleanText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((entry) => rightSet.has(entry));
}

function readStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map((entry) => cleanText(entry)).filter(Boolean)
    : [];
}

function parseLooseJson(text: string): unknown {
  const body = cleanText(text);
  if (!body) return null;
  for (const candidate of [body, extractJsonObject(body), extractJsonArray(body)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function extractJsonObject(input: string): string {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  return start !== -1 && end > start ? input.slice(start, end + 1) : "";
}

function extractJsonArray(input: string): string {
  const start = input.indexOf("[");
  const end = input.lastIndexOf("]");
  return start !== -1 && end > start ? input.slice(start, end + 1) : "";
}

function extractModelText(payload: unknown): string {
  if (!isPlainRecord(payload) || !Array.isArray(payload.candidates)) return "";
  const candidate = payload.candidates.find((entry) => isPlainRecord(entry));
  if (!isPlainRecord(candidate) || !isPlainRecord(candidate.content)) return "";
  const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  return parts
    .map((entry) => (isPlainRecord(entry) ? cleanText(entry.text) : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function objectString(
  input: unknown,
  ...path: string[]
): string {
  let cursor = input;
  for (const key of path) {
    if (!isPlainRecord(cursor)) return "";
    cursor = cursor[key];
  }
  return cleanText(cursor);
}

function readNumber(input: unknown, fallback = 0): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function joinOrAny(values: string[]): string {
  const normalized = values.map((entry) => cleanText(entry)).filter(Boolean);
  return normalized.length ? normalized.join(", ") : "any";
}

function cleanText(input: unknown): string {
  return toPlainText(String(input || "")).replace(/\s+/g, " ").trim();
}

function clamp(input: number): number {
  return Math.max(0, Math.min(1, Number(input) || 0));
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isPlainRecord(input: unknown): input is AnyRecord {
  return !!input && typeof input === "object" && !Array.isArray(input);
}
