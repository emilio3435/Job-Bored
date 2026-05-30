/**
 * profile-aware-scorer.ts
 *
 * Two scoring paths live in this file:
 *
 *   1. NEW — UserProfile-driven, two-stage:
 *      a. runPreFilter(rawListing, profile): cheap deterministic gate that
 *         rejects on hardConstraints before any LLM call.
 *      b. scoreListingWithLlm(rawListing, profile, ...): Gemini call that
 *         returns a structured LlmFitScoreResult per-strength.
 *      Orchestrator: scoreListingForProfile(...) handles caching + fallbacks.
 *
 *   2. LEGACY — heuristic dimension scorer, kept at the bottom of the file.
 *      Used as the fallback when no UserProfile is present, or when the LLM
 *      call errors out so we still surface a fit score on the row.
 *
 * Wired by lead-normalizer.ts.
 */

import { createHash } from "node:crypto";
import type { RawListing } from "../contracts.ts";
import { toPlainText } from "../browser/selectors/shared.ts";
import {
  type UserProfile,
  type PreFilterResult,
  type LlmFitScoreResult,
  type ProfileScoringOutcome,
  type StrengthEvaluation,
  type FitBand,
  USER_PROFILE_SCHEMA_VERSION,
} from "../contracts/user-profile.ts";
import type { ListingScoreCache } from "../state/listing-score-cache.ts";

// ═══════════════════════════════════════════════════════════════════════════
// NEW: Pre-filter (deterministic, no LLM cost)
// ═══════════════════════════════════════════════════════════════════════════

const SPONSORSHIP_DENY_PHRASES = [
  "no sponsorship",
  "us citizens only",
  "must be authorized to work in the us without sponsorship",
  "no visa sponsorship",
];

/**
 * Apply hardConstraints to a raw listing. Order matters: cheapest checks
 * first. Returns the first violation; never aggregates.
 */
export function runPreFilter(
  rawListing: RawListing,
  profile: UserProfile,
): PreFilterResult {
  const hc = profile.hardConstraints;

  // 1. skipTitles
  const titleLower = String(rawListing.title || "").toLowerCase();
  const skipTitles = hc.skipTitles || [];
  for (const phrase of skipTitles) {
    const needle = String(phrase || "").trim().toLowerCase();
    if (needle && titleLower.includes(needle)) {
      return {
        pass: false,
        reason: "skip_title_match",
        detail: `Title contains skip phrase "${phrase}".`,
      };
    }
  }

  // 2. workMode = remote_only AND remoteBucket !== "remote"
  if (hc.workMode === "remote_only" && rawListing.remoteBucket !== "remote") {
    return {
      pass: false,
      reason: "work_mode_mismatch",
      detail: `Profile requires remote_only; listing remoteBucket=${rawListing.remoteBucket || "unknown"}.`,
    };
  }

  // 3. workMode hybrid/onsite AND acceptableLocations set AND no match
  //    Skip when workMode = remote_only (remote listings ignore location).
  if (hc.workMode !== "remote_only") {
    const acceptable = (hc.acceptableLocations || [])
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean);
    if (acceptable.length > 0) {
      const locationLower = String(rawListing.location || "").toLowerCase();
      const matches = acceptable.some((loc) => locationLower.includes(loc));
      if (!matches) {
        return {
          pass: false,
          reason: "location_outside_acceptable",
          detail: `Location "${rawListing.location || ""}" outside acceptableLocations [${acceptable.join(", ")}].`,
        };
      }
    }
  }

  // 4. workAuth = needs_sponsorship AND description signals "no sponsorship"
  if (hc.workAuth === "needs_sponsorship") {
    const descLower = String(rawListing.descriptionText || "").toLowerCase();
    for (const phrase of SPONSORSHIP_DENY_PHRASES) {
      if (descLower.includes(phrase)) {
        return {
          pass: false,
          reason: "work_auth_mismatch",
          detail: `Listing description signals "${phrase}".`,
        };
      }
    }
  }

  // 5. salaryRequired
  if (hc.salaryRequired) {
    const parsedMax = parseSalaryMax(rawListing.compensationText || "");
    if (parsedMax === null) {
      return {
        pass: false,
        reason: "salary_missing_but_required",
        detail: "Profile requires published salary; listing has none.",
      };
    }
    if (typeof hc.salaryFloor === "number" && parsedMax < hc.salaryFloor) {
      return {
        pass: false,
        reason: "salary_below_floor",
        detail: `Parsed salary ${parsedMax} below floor ${hc.salaryFloor}.`,
      };
    }
  }

  return { pass: true };
}

/**
 * Parse the max published salary out of a comp string. Handles formats like
 * "$150k", "$150,000", "$150K - $180K", "150-180k", "150000".
 * Returns raw dollars (e.g. 150000), or null when nothing recognizable.
 */
export function parseSalaryMax(text: string): number | null {
  const cleaned = String(text || "").replace(/\$/g, "").toLowerCase();
  if (!cleaned.trim()) return null;
  // Match numeric chunks, optionally with comma separators and a trailing k.
  const matches = cleaned.match(/[\d][\d,]*\.?\d*\s*k?/g);
  if (!matches || matches.length === 0) return null;

  const values: number[] = [];
  for (const raw of matches) {
    const hasK = /k$/.test(raw.trim());
    const numeric = raw.replace(/k$/, "").replace(/,/g, "").trim();
    if (!numeric) continue;
    const parsed = Number.parseFloat(numeric);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    const dollars = hasK ? parsed * 1000 : parsed;
    // Reject obviously-not-salary numbers (hours, years, etc.) by requiring
    // a plausible salary range. Keep small numbers when they have a k suffix.
    if (!hasK && dollars < 1000) continue;
    values.push(dollars);
  }
  if (values.length === 0) return null;
  return Math.max(...values);
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW: LLM scorer
// ═══════════════════════════════════════════════════════════════════════════

type FetchImpl = typeof fetch;

type LlmScorerRuntimeConfig = {
  geminiApiKey: string;
  geminiModel: string;
};

export type ScoreListingForProfileOptions = {
  runtimeConfig: LlmScorerRuntimeConfig;
  cache?: ListingScoreCache | null;
  signal?: AbortSignal;
  fetchImpl?: FetchImpl;
};

function buildSystemPrompt(profile: UserProfile): string {
  const lines: string[] = [];
  lines.push("You are scoring how well a job listing matches the user below.");
  lines.push("");
  lines.push("WHO THE USER IS:");
  lines.push(profile.identity.primaryNarrative.trim());
  lines.push("");
  lines.push("STRENGTHS (rank 1 = top, weighted highest):");
  const sortedStrengths = [...profile.strengths].sort(
    (a, b) => (a.rank ?? 99) - (b.rank ?? 99),
  );
  for (const s of sortedStrengths) {
    const kw = s.keywords?.length ? ` [keywords: ${s.keywords.join(", ")}]` : "";
    const evidence = s.evidence ? ` — ${s.evidence}` : "";
    lines.push(`  ${s.rank}. ${s.name}${kw}${evidence}`);
  }
  if (profile.wants?.length) {
    lines.push("");
    lines.push(`WANTS: ${profile.wants.join(" · ")}`);
  }
  if (profile.avoids?.length) {
    lines.push(`AVOIDS: ${profile.avoids.join(" · ")}`);
  }
  if (profile.tieBreakers) {
    const tb = profile.tieBreakers;
    const parts: string[] = [];
    if (tb.salaryTransparencyImportance) {
      parts.push(`salary transparency=${tb.salaryTransparencyImportance}`);
    }
    if (tb.companyCredibilityImportance) {
      parts.push(`company credibility=${tb.companyCredibilityImportance}`);
    }
    if (tb.applicationComplexityAversion) {
      parts.push(`application complexity aversion=${tb.applicationComplexityAversion}`);
    }
    if (parts.length) {
      lines.push(`TIE BREAKERS: ${parts.join(" · ")}`);
    }
  }
  lines.push("");
  lines.push(
    "Score the listing below. Return JSON matching the schema. Be honest — Low scores are valuable signal.",
  );
  return lines.join("\n");
}

function buildUserPrompt(rawListing: RawListing): string {
  const desc = String(rawListing.descriptionText || "").slice(0, 6000);
  return [
    `${rawListing.title} at ${rawListing.company}`,
    `Location: ${rawListing.location || "n/a"}`,
    `Comp: ${rawListing.compensationText || "n/a"}`,
    "",
    "Description:",
    desc,
  ].join("\n");
}

function buildResponseSchema(profile: UserProfile): Record<string, unknown> {
  const strengthNames = [...profile.strengths]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .map((s) => s.name);

  return {
    type: "object",
    required: ["fitScore", "band", "perStrength", "concerns", "matches", "rationale"],
    properties: {
      fitScore: { type: "integer", minimum: 1, maximum: 10 },
      band: { type: "string", enum: ["Exceptional", "Strong", "Interesting", "Low"] },
      perStrength: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "score", "rationale"],
          properties: {
            name: { type: "string", enum: strengthNames.length ? strengthNames : ["_"] },
            score: { type: "integer", minimum: 0, maximum: 10 },
            rationale: { type: "string" },
          },
        },
      },
      concerns: { type: "array", items: { type: "string" } },
      matches: { type: "array", items: { type: "string" } },
      rationale: { type: "string" },
      leadAngle: { type: "string" },
    },
  };
}

function deriveBand(score: number): FitBand {
  if (score >= 9) return "Exceptional";
  if (score >= 8) return "Strong";
  if (score >= 7) return "Interesting";
  return "Low";
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const first = candidates[0];
  if (!first || typeof first !== "object") return "";
  const content = (first as { content?: unknown }).content;
  if (!content || typeof content !== "object") return "";
  const parts = (content as { parts?: unknown[] }).parts;
  if (!Array.isArray(parts)) return "";
  const buf: string[] = [];
  for (const part of parts) {
    if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      buf.push((part as { text: string }).text);
    }
  }
  return buf.join("");
}

/**
 * Call Gemini in JSON mode with the per-profile schema. Throws on any error
 * (HTTP, invalid JSON, unknown response shape). Callers handle.
 */
export async function scoreListingWithLlm(
  rawListing: RawListing,
  profile: UserProfile,
  opts: ScoreListingForProfileOptions,
): Promise<LlmFitScoreResult> {
  const { runtimeConfig, signal } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiKey = String(runtimeConfig.geminiApiKey || "").trim();
  if (!apiKey) {
    throw new Error("scoreListingWithLlm: missing geminiApiKey.");
  }
  const model = runtimeConfig.geminiModel || "gemini-3.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const systemPrompt = buildSystemPrompt(profile);
  const userPrompt = buildUserPrompt(rawListing);
  const responseSchema = buildResponseSchema(profile);

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(
      `scoreListingWithLlm: Gemini HTTP ${response.status} ${response.statusText} — ${errText.slice(0, 240)}`,
    );
  }

  const payload = await response.json().catch(() => null);
  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error("scoreListingWithLlm: empty Gemini response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`scoreListingWithLlm: invalid JSON — ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("scoreListingWithLlm: response is not an object.");
  }

  const rec = parsed as Record<string, unknown>;
  const rawScore = typeof rec.fitScore === "number" ? rec.fitScore : Number(rec.fitScore);
  if (!Number.isFinite(rawScore)) {
    throw new Error("scoreListingWithLlm: missing or non-numeric fitScore.");
  }
  const fitScore = Math.max(1, Math.min(10, Math.round(rawScore)));
  // Trust the LLM's own band when it returned a valid enum value; only fall
  // back to deriving from fitScore if it's missing or out-of-enum. The schema
  // requires `band`, so this fallback is purely defensive.
  const llmBandRaw = typeof rec.band === "string" ? rec.band : "";
  const band: FitBand =
    llmBandRaw === "Exceptional" ||
    llmBandRaw === "Strong" ||
    llmBandRaw === "Interesting" ||
    llmBandRaw === "Low"
      ? llmBandRaw
      : deriveBand(fitScore);

  const perStrengthRaw = Array.isArray(rec.perStrength) ? rec.perStrength : [];
  const perStrength: StrengthEvaluation[] = perStrengthRaw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name || ""),
      score: Math.max(
        0,
        Math.min(10, Math.round(Number(entry.score) || 0)),
      ),
      rationale: String(entry.rationale || ""),
    }));

  const concerns = Array.isArray(rec.concerns)
    ? rec.concerns.map((c) => String(c || "")).filter(Boolean)
    : [];
  const matches = Array.isArray(rec.matches)
    ? rec.matches.map((m) => String(m || "")).filter(Boolean)
    : [];
  const rationale = String(rec.rationale || "");
  const leadAngle =
    typeof rec.leadAngle === "string" && rec.leadAngle.trim()
      ? rec.leadAngle.trim()
      : undefined;

  return {
    fitScore,
    band,
    perStrength,
    concerns,
    matches,
    rationale,
    leadAngle,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW: Orchestrator — pre-filter → cache → LLM
// ═══════════════════════════════════════════════════════════════════════════

function buildCacheKey(canonicalUrl: string, profile: UserProfile): string {
  const seed = [
    canonicalUrl,
    profile.updatedAt || "",
    String(USER_PROFILE_SCHEMA_VERSION),
  ].join("|");
  return createHash("sha256").update(seed).digest("hex");
}

/**
 * Main entry point used by lead-normalizer.ts.
 * Order: pre-filter → cache lookup → LLM call → cache write.
 */
export async function scoreListingForProfile(
  rawListing: RawListing,
  profile: UserProfile,
  opts: ScoreListingForProfileOptions,
): Promise<ProfileScoringOutcome> {
  const preFilter = runPreFilter(rawListing, profile);
  if (!preFilter.pass) {
    return { ok: false, filteredBy: "pre_filter", preFilter };
  }

  const canonicalUrl = rawListing.canonicalUrl || rawListing.url || "";
  const cacheKey = buildCacheKey(canonicalUrl, profile);
  const modelId = opts.runtimeConfig.geminiModel || "gemini-3.5-flash";

  if (opts.cache) {
    const hit = opts.cache.get(cacheKey);
    if (hit) {
      return { ok: true, score: hit, llmCalled: false, modelId };
    }
  }

  try {
    const score = await scoreListingWithLlm(rawListing, profile, opts);
    if (opts.cache) {
      opts.cache.put(cacheKey, score);
      if (canonicalUrl) {
        opts.cache.putBreakdown(canonicalUrl, score);
      }
    }
    return { ok: true, score, llmCalled: true, modelId };
  } catch (err) {
    return {
      ok: false,
      filteredBy: "llm_error",
      message: (err as Error).message || "unknown LLM error",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY fallback (no UserProfile)
// ═══════════════════════════════════════════════════════════════════════════
// Heuristic dimension scorer used when scoreListingForProfile returns an
// LLM error, or when no profile is configured at all. Kept exactly as it
// shipped before the LLM scorer; @deprecated below tells future readers
// not to extend this — extend the new LLM path instead.

/** Emilio's primary role lanes (from job-preferences.md §Primary target roles) */
const LANE_KEYWORDS = {
  consultant: [
    "digital marketing consultant",
    "performance marketing consultant",
    "senior strategist",
    "director digital strategy",
    "director consulting",
    "principal consultant",
    "practice lead",
    "ai search strategist",
    "head of geo",
    "head of ai search",
    "generative search",
  ],
  ai_builder: [
    "ai solutions architect",
    "ai product builder",
    "ai engineer",
    "solutions consultant",
    "sales engineer",
    "forward deployed engineer",
    "gtm engineer",
    "technical account manager",
    "implementation lead",
  ],
  ai_pmm: [
    "product marketing manager",
    "senior product marketing manager",
    "staff product marketing manager",
    "principal product marketing manager",
    "director product marketing",
    "technical product marketing manager",
    "ai gtm lead",
    "gtm strategy lead",
  ],
  performance_marketing: [
    "performance marketing",
    "growth marketing",
    "director performance marketing",
    "director paid media",
    "director paid acquisition",
    "director growth marketing",
    "demand generation director",
    "adtech strategy",
    "martech strategy",
  ],
  adtech_martech: [
    "adtech",
    "martech",
    "channel director",
    "partnerships director",
  ],
} as const;

type LaneId = keyof typeof LANE_KEYWORDS;

/** Weights per dimension (must sum to 100 in final normalisation) */
const DIMENSION_WEIGHTS = {
  laneFit: 18,
  aiRelevance: 15,
  performanceMarketing: 12,
  adtechMartechMedia: 8,
  seniority: 10,
  compensationTransparency: 8,
  remoteLocation: 12,
  companyCredibility: 9,
  applicationComplexity: 8,
} as const;

type DimensionId = keyof typeof DIMENSION_WEIGHTS;

const US_STATE_TOKEN_PATTERN =
  /\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|ia|id|il|in|ks|ky|la|ma|md|me|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|dc)\b/i;

const REMOTE_PATTERN =
  /\b(remote|remote-first|remote first|distributed|work from home|wfh|anywhere)\b/i;
const HYBRID_PATTERN = /\bhybrid\b/i;

const ATS_HOSTS = new Set([
  "boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
]);

const WORKDAY_HOSTS = new Set(["myworkday.com", "workday.com", "workdayjobs.com"]);

function normalizeWhitespace(input: string): string {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim();
}

function textToLower(input: string): string {
  return normalizeWhitespace(input).toLowerCase();
}

function anySubstringMatch(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(textToLower(needle)));
}

function countSubstringMatches(haystack: string, needles: readonly string[]): number {
  return needles.filter((needle) => haystack.includes(textToLower(needle))).length;
}

function inferLane(rawListing: RawListing): LaneId {
  const haystack = textToLower(
    [rawListing.title, rawListing.company, rawListing.descriptionText]
      .filter(Boolean)
      .join(" "),
  );
  for (const [lane, keywords] of Object.entries(LANE_KEYWORDS)) {
    if (anySubstringMatch(haystack, keywords)) {
      return lane as LaneId;
    }
  }
  return "consultant";
}

function scoreLaneFit(rawListing: RawListing): number {
  const lane = inferLane(rawListing);
  const haystack = textToLower(
    [rawListing.title, rawListing.descriptionText].filter(Boolean).join(" "),
  );
  const laneKeywords = LANE_KEYWORDS[lane];
  const matchCount = countSubstringMatches(haystack, laneKeywords);
  if (matchCount >= 3) return 1.0;
  if (matchCount >= 2) return 0.85;
  if (matchCount >= 1) return 0.7;
  return 0.3;
}

function scoreAiRelevance(rawListing: RawListing): number {
  const haystack = textToLower(
    [rawListing.title, rawListing.descriptionText, rawListing.company]
      .filter(Boolean)
      .join(" "),
  );
  const aiTerms = [
    "ai", "artificial intelligence", "llm", "large language model",
    "genai", "generative ai", "rag", "retrieval augmented",
    "agent", "agentic", "multi-model", "multi-model routing",
    "vertex ai", "gemini", "claude", "gpt", "chatgpt",
    "ai search", "generative search", "aio", "geo", "llm citation",
    "prompt engineering", "ai workflow", "automation platform",
    "ai platform", "machine learning", "deep learning",
  ];
  const matchCount = countSubstringMatches(haystack, aiTerms);
  if (matchCount >= 4) return 1.0;
  if (matchCount >= 2) return 0.8;
  if (matchCount >= 1) return 0.6;
  return 0.0;
}

function scorePerformanceMarketing(rawListing: RawListing): number {
  const haystack = textToLower(
    [rawListing.title, rawListing.descriptionText].filter(Boolean).join(" "),
  );
  const terms = [
    "performance marketing", "paid media", "paid acquisition",
    "sem", "seo", "ppc", "search engine marketing",
    "google ads", "meta ads", "amazon dsp",
    "cac", "ltv", "roas", "troc", "contribution margin",
    "attribution", "bidding strategy", "tacos", " blended cac",
    "demand generation", "growth marketing", "channel forecasting",
    "cpl", "cpa", "cpm", "roi", "return on ad spend",
    "campaign optimization", "funnel", "conversion",
  ];
  const matchCount = countSubstringMatches(haystack, terms);
  if (matchCount >= 4) return 1.0;
  if (matchCount >= 2) return 0.75;
  if (matchCount >= 1) return 0.5;
  return 0.0;
}

function scoreAdtechMartech(rawListing: RawListing): number {
  const haystack = textToLower(
    [rawListing.title, rawListing.company, rawListing.descriptionText]
      .filter(Boolean)
      .join(" "),
  );
  const terms = [
    "adtech", "martech", "dsp", "ssp", "programmatic",
    "ctv", "ott", "connected tv", "trade desk",
    "dv360", "amazon advertising", "media buy",
    "cdp", "customer data platform", "identity",
    "retargeting", "lookalike", "audience segment",
    "attribution", "conversion api", "server-side tagging",
    "analytics", "measurement", "incrementality",
  ];
  const matchCount = countSubstringMatches(haystack, terms);
  if (matchCount >= 3) return 1.0;
  if (matchCount >= 2) return 0.75;
  if (matchCount >= 1) return 0.5;
  return 0.0;
}

function scoreSeniority(rawListing: RawListing): number {
  const haystack = textToLower(rawListing.title);
  const seniorTerms = [
    "senior", "sr", "staff", "principal", "lead", "head",
    "director", "manager", "chief", "vp", "vice president",
    "distinguished", "executive",
  ];
  const juniorTerms = ["junior", "jr", "associate", "entry", "intern", "trainee"];
  const hasSenior = anySubstringMatch(haystack, seniorTerms);
  const hasJunior = anySubstringMatch(haystack, juniorTerms);
  if (hasJunior && !hasSenior) return 0.0;
  if (hasSenior) return 1.0;
  return 0.5;
}

function scoreCompensationTransparency(rawListing: RawListing): number {
  const hasText = Boolean(rawListing.compensationText?.trim());
  if (!hasText) return 0.4;
  return 1.0;
}

function scoreRemoteLocation(rawListing: RawListing): number {
  const location = rawListing.location || "";
  const normalized = textToLower(location);
  if (REMOTE_PATTERN.test(normalized)) return 1.0;
  if (HYBRID_PATTERN.test(normalized)) {
    if (/denver|philadelphia|little rock|co\b|pa\b|ar\b/i.test(normalized)) {
      return 1.0;
    }
    return 0.6;
  }
  if (US_STATE_TOKEN_PATTERN.test(normalized)) {
    if (/denver|philadelphia|little rock|co\b|pa\b|ar\b/i.test(normalized)) {
      return 0.7;
    }
    return 0.0;
  }
  return 0.5;
}

function scoreCompanyCredibility(rawListing: RawListing): number {
  const url = rawListing.url || "";
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (ATS_HOSTS.has(hostname)) return 0.9;
    const aggregators = ["indeed.com", "linkedin.com", "glassdoor.com", "monster.com"];
    if (aggregators.some((h) => hostname.includes(h))) return 0.4;
    return 0.6;
  } catch {
    return 0.5;
  }
}

function scoreApplicationComplexity(rawListing: RawListing): number {
  const url = (rawListing.url || "").toLowerCase();
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (WORKDAY_HOSTS.has(hostname)) return 0.3;
    if (ATS_HOSTS.has(hostname)) return 1.0;
    return 0.7;
  } catch {
    return 0.5;
  }
}

/** @deprecated Used as fallback when no UserProfile is configured. */
export type ProfileAwareScoreResult = {
  fitScore: number;
  band: "Exceptional" | "Strong" | "Interesting" | "Low";
  dimensionScores: Record<DimensionId, number>;
  primaryLane: LaneId;
  salaryPenalised: boolean;
  exceptionalWithoutSalary: boolean;
  fitRationale: string;
};

/** @deprecated Used as fallback when no UserProfile is configured. */
export function computeProfileAwareFitScore(
  rawListing: RawListing,
): ProfileAwareScoreResult {
  const lane = inferLane(rawListing);
  const dimLane = scoreLaneFit(rawListing);
  const dimAi = scoreAiRelevance(rawListing);
  const dimPerf = scorePerformanceMarketing(rawListing);
  const dimAdtech = scoreAdtechMartech(rawListing);
  const dimSenior = scoreSeniority(rawListing);
  const dimComp = scoreCompensationTransparency(rawListing);
  const dimRemote = scoreRemoteLocation(rawListing);
  const dimCompany = scoreCompanyCredibility(rawListing);
  const dimApp = scoreApplicationComplexity(rawListing);

  const raw =
    dimLane * DIMENSION_WEIGHTS.laneFit +
    dimAi * DIMENSION_WEIGHTS.aiRelevance +
    dimPerf * DIMENSION_WEIGHTS.performanceMarketing +
    dimAdtech * DIMENSION_WEIGHTS.adtechMartechMedia +
    dimSenior * DIMENSION_WEIGHTS.seniority +
    dimComp * DIMENSION_WEIGHTS.compensationTransparency +
    dimRemote * DIMENSION_WEIGHTS.remoteLocation +
    dimCompany * DIMENSION_WEIGHTS.companyCredibility +
    dimApp * DIMENSION_WEIGHTS.applicationComplexity;
  const rawScore = (raw / 100) * 10;

  const salaryPenalised = !rawListing.compensationText?.trim();
  const scoreAfterPenalty = salaryPenalised ? rawScore - 2 : rawScore;
  const fitScore = Math.max(1, Math.min(10, scoreAfterPenalty));

  const exceptionalWithoutSalary =
    ((dimLane >= 0.85 && dimAi >= 0.6) || (dimLane >= 0.9 && dimPerf >= 0.5)) &&
    rawScore >= 8.0;

  const band =
    fitScore >= 9
      ? "Exceptional"
      : fitScore >= 8
        ? "Strong"
        : fitScore >= 7
          ? "Interesting"
          : "Low";

  const dimensionScores: Record<DimensionId, number> = {
    laneFit: dimLane,
    aiRelevance: dimAi,
    performanceMarketing: dimPerf,
    adtechMartechMedia: dimAdtech,
    seniority: dimSenior,
    compensationTransparency: dimComp,
    remoteLocation: dimRemote,
    companyCredibility: dimCompany,
    applicationComplexity: dimApp,
  };

  const topDimensions: Array<{ id: DimensionId; score: number }> = Object.entries(
    dimensionScores,
  )
    .map(([id, score]) => ({ id: id as DimensionId, score }))
    .sort((a, b) => b.score - a.score);

  const topSignals = topDimensions
    .filter((d) => d.score >= 0.7)
    .slice(0, 4)
    .map((d) => {
      switch (d.id) {
        case "laneFit":
          return "consultant/strategy lane";
        case "aiRelevance":
          return "AI/LLM relevance";
        case "performanceMarketing":
          return "performance marketing";
        case "adtechMartechMedia":
          return "adtech/martech";
        case "seniority":
          return "seniority-aligned";
        case "compensationTransparency":
          return "salary published";
        case "remoteLocation":
          return "remote OK";
        case "companyCredibility":
          return "strong company";
        case "applicationComplexity":
          return "clean ATS";
      }
    });

  const fitRationale = topSignals.length > 0 ? topSignals.join(" · ") : "General fit";

  return {
    fitScore: Math.round(fitScore * 10) / 10,
    band,
    dimensionScores,
    primaryLane: lane,
    salaryPenalised,
    exceptionalWithoutSalary,
    fitRationale,
  };
}

/** @deprecated Used as fallback when no UserProfile is configured. */
export function buildProfileFitAssessment(params: {
  role: string;
  company: string;
  result: ProfileAwareScoreResult;
  applicationComplexity: string;
  descriptionText?: string;
}): string {
  const { role, company, result, applicationComplexity, descriptionText } = params;
  const { band, fitScore, fitRationale, salaryPenalised, exceptionalWithoutSalary } =
    result;

  const parts: string[] = [];
  parts.push(`${band} fit for ${role} at ${company} (score: ${fitScore}/10).`);

  const rationale =
    fitRationale ||
    (descriptionText ? toPlainText(descriptionText).slice(0, 80) : "General fit");
  parts.push(`Fit rationale: ${rationale}.`);

  const locationOk = result.dimensionScores.remoteLocation >= 0.7;
  if (!locationOk) {
    parts.push("⚠️ Location may require attention — verify before applying.");
  } else {
    parts.push("✅ Remote/location aligned.");
  }

  if (salaryPenalised) {
    if (exceptionalWithoutSalary) {
      parts.push("⚠️ Salary not published — exceptional AI/consulting lane compensates.");
    } else {
      parts.push("⚠️ Salary not published.");
    }
  } else {
    parts.push("💰 Salary band published.");
  }

  parts.push(`Application: ${applicationComplexity}.`);
  return parts.join(" ");
}

/** @deprecated Used as fallback when no UserProfile is configured. */
export function buildProfileTalkingPoints(params: {
  role: string;
  company: string;
  result: ProfileAwareScoreResult;
}): string {
  const { result } = params;
  const { dimensionScores, fitRationale } = result;

  const points: string[] = [];

  if (dimensionScores.laneFit >= 0.7) {
    points.push(`Lead with consulting: ${fitRationale.split(" · ")[0]}.`);
  } else if (dimensionScores.aiRelevance >= 0.7) {
    points.push("Lead with AI systems experience — multi-model routing, RAG, GCP deployment.");
  } else if (dimensionScores.performanceMarketing >= 0.7) {
    points.push("Lead with paid media track record — $10M+ book, top-3 national ranking.");
  }

  if (dimensionScores.seniority >= 0.9) {
    points.push("Anchor at the requested seniority — eight years, four progressive roles at Audacy.");
  } else if (dimensionScores.seniority < 0.5) {
    points.push("Frame as a strategic individual contributor ready for next-level scope.");
  }

  if (dimensionScores.remoteLocation >= 0.9) {
    points.push("Call out remote-first success: built and shipped AI systems without a co-located team.");
  }

  if (dimensionScores.companyCredibility >= 0.8) {
    points.push(`Reference credible platform work — Elio Intelligence Suite on GCP, Vertex AI Search RAG pipelines.`);
  }

  if (dimensionScores.performanceMarketing >= 0.6) {
    points.push("Use the unit-economics frame: 130% YoY paid-search conversion growth, 13% YoY new-user lift.");
  }

  return points.join(" ");
}
