/**
 * profile-aware-scorer.ts
 *
 * Profile-aware scoring for the JHOS pipeline.
 * Wires the canonical job-preferences.md rubric (18-dimension weighted scoring)
 * into the discovery pipeline.
 *
 * Profile docs read at init (loaded once, reused across leads):
 *   ~/.hermes/job-hunt/profile/job-preferences.md  — scoring weights, lanes, thresholds
 *   ~/.hermes/job-hunt/profile/profile.md          — role-fit hierarchy, target titles
 *
 * Scoring rubric (from job-preferences.md §Scoring rubric):
 *
 *   Dimension              Weight  Full-credit signal
 *   ──────────────────────────────────────────────────────────────────
 *   Consulting/strategy/  18      Role is digital marketing consultant,
 *   AI-tooling lane fit            strategist, AI builder, AI tooling,
 *                                   or applied AI strategy
 *   AI / LLM relevance     15      Company or role involves LLMs, agents,
 *                                   RAG, AI workflows, AI search,
 *                                   or applied GenAI
 *   Performance marketing/ 12      Paid acquisition, CAC/LTV/ROAS, bidding,
 *   unit economics                 attribution, channel forecasting, growth
 *   Adtech/martech/media    8      Marketing technology, media, adtech,
 *                                   measurement, CTV/OTT, programmatic,
 *                                   CDP, retail media, audio
 *   Seniority fit          10      Senior manager, principal IC, staff,
 *                                   director, head-of, or strategic lead level
 *   Compensation            8      Salary or OTE band published.
 *   transparency                   Missing salary penalizes but does not
 *                                   auto-reject
 *   Remote / location fit  12      Remote or hybrid in Denver, Philadelphia,
 *                                   or Little Rock
 *   Company credibility    9       Credible product, customers, funding,
 *                                   brand, or serious GTM motion
 *   Application complexity  8      Direct ATS, Greenhouse, Lever, Ashby,
 *                                   or manageable company page.
 *                                   Heavy Workday/questionnaires score lower.
 *
 * Score thresholds:
 *   9.0–10  Exceptional → route to Pipeline / escalate for review
 *   8.0–8.9 Strong → write to Pipeline as New or Review
 *   7.0–7.9 Interesting but incomplete → hold for review
 *   6.0–6.9 Plausible adjacent → skip unless special reason
 *   <6.0   Ignore
 *
 * Salary policy: missing salary penalizes (−2) but does not auto-reject.
 * Exceptional roles (AI/LLM or consulting lane strong) can still score 8+ without salary.
 */

import type { RawListing } from "../contracts.ts";
import { toPlainText } from "../browser/selectors/shared.ts";

// ─── Lane detection ───────────────────────────────────────────────────────────

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

/** Match score thresholds by lane */
const LANE_SCORE_BANDS: Record<LaneId, string> = {
  consultant: "Exceptional",
  ai_builder: "Strong",
  ai_pmm: "Strong",
  performance_marketing: "Strong",
  adtech_martech: "Interesting",
};

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

// ─── Scoring helpers ───────────────────────────────────────────────────────────

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

/** Detect which lane a job title/description best fits */
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
  return "consultant"; // default fallback
}

/** Score 0–1 for lane fit */
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
  return 0.3; // weak lane match
}

/** Score 0–1 for AI/LLM relevance */
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

/** Score 0–1 for performance marketing / unit economics relevance */
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

/** Score 0–1 for adtech/martech/media relevance */
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

/** Score 0–1 for seniority fit */
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
  return 0.5; // mid-level / unspecified
}

/** Score 0–1 for compensation transparency */
function scoreCompensationTransparency(rawListing: RawListing): number {
  const hasText = Boolean(rawListing.compensationText?.trim());
  if (!hasText) return 0.4; // penalise missing salary
  return 1.0;
}

/** Score 0–1 for remote/location fit */
function scoreRemoteLocation(rawListing: RawListing): number {
  const location = rawListing.location || "";
  const normalized = textToLower(location);

  // Remote jobs are always fine
  if (REMOTE_PATTERN.test(normalized)) return 1.0;

  // Hybrid
  if (HYBRID_PATTERN.test(normalized)) {
    // Emilio accepts hybrid in Denver, Philadelphia, or Little Rock
    if (/denver|philadelphia|little rock|co\b|pa\b|ar\b/i.test(normalized)) {
      return 1.0;
    }
    return 0.6;
  }

  // Onsite — check if it's a preferred location
  if (US_STATE_TOKEN_PATTERN.test(normalized)) {
    if (/denver|philadelphia|little rock|co\b|pa\b|ar\b/i.test(normalized)) {
      return 0.7; // acceptable
    }
    return 0.0; // outside preferred locations
  }

  return 0.5; // no location specified — unknown
}

/** Score 0–1 for company credibility (placeholder — uses hostname heuristics) */
function scoreCompanyCredibility(rawListing: RawListing): number {
  const url = rawListing.url || "";
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    // Known high-credibility ATS hosts
    if (ATS_HOSTS.has(hostname)) return 0.9;
    // Known low-credibility / aggregator hosts
    const aggregators = ["indeed.com", "linkedin.com", "glassdoor.com", "monster.com"];
    if (aggregators.some((h) => hostname.includes(h))) return 0.4;
    // Default: neutral
    return 0.6;
  } catch {
    return 0.5;
  }
}

/** Score 0–1 for application complexity (ATS type) */
function scoreApplicationComplexity(rawListing: RawListing): number {
  const url = (rawListing.url || "").toLowerCase();
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (WORKDAY_HOSTS.has(hostname)) return 0.3; // Workday = complex
    if (ATS_HOSTS.has(hostname)) return 1.0; // Greenhouse/Lever/Ashby = clean
    return 0.7; // other / unknown
  } catch {
    return 0.5;
  }
}

// ─── Main export ───────────────────────────────────────────────────────────────

export type ProfileAwareScoreResult = {
  /** Weighted score 1–10 */
  fitScore: number;
  /** Score band label */
  band: "Exceptional" | "Strong" | "Interesting" | "Low";
  /** Per-dimension scores for Fit Assessment construction */
  dimensionScores: Record<DimensionId, number>;
  /** Detected primary lane */
  primaryLane: LaneId;
  /** Salary penalty applied (true if missing) */
  salaryPenalised: boolean;
  /** Whether role is strong enough to write even without salary */
  exceptionalWithoutSalary: boolean;
  /** Fit rationale text for Fit Assessment */
  fitRationale: string;
};

/**
 * Compute a profile-aware fit score for a discovered job listing.
 * Returns a detailed result including per-dimension scores, band, and rationale.
 */
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

  // Weighted sum (each weight is out of 100, so we divide by 100 at the end)
  const raw = (dimLane * DIMENSION_WEIGHTS.laneFit)
    + (dimAi * DIMENSION_WEIGHTS.aiRelevance)
    + (dimPerf * DIMENSION_WEIGHTS.performanceMarketing)
    + (dimAdtech * DIMENSION_WEIGHTS.adtechMartechMedia)
    + (dimSenior * DIMENSION_WEIGHTS.seniority)
    + (dimComp * DIMENSION_WEIGHTS.compensationTransparency)
    + (dimRemote * DIMENSION_WEIGHTS.remoteLocation)
    + (dimCompany * DIMENSION_WEIGHTS.companyCredibility)
    + (dimApp * DIMENSION_WEIGHTS.applicationComplexity);

  // Divide by 100 to get a 0–10 score
  const rawScore = raw / 100 * 10;

  // Apply salary penalty (missing salary → −2 from rawScore before clamping)
  const salaryPenalised = !rawListing.compensationText?.trim();
  const scoreAfterPenalty = salaryPenalised ? rawScore - 2 : rawScore;

  // Clamp to 1–10
  const fitScore = Math.max(1, Math.min(10, scoreAfterPenalty));

  // Determine if role is strong enough to write even without salary
  // (AI/LLM lane or consulting lane strong + overall score >= 8 before penalty)
  const exceptionalWithoutSalary =
    ((dimLane >= 0.85 && dimAi >= 0.6) || (dimLane >= 0.9 && dimPerf >= 0.5))
    && rawScore >= 8.0;

  // Score band
  const band = fitScore >= 9 ? "Exceptional"
    : fitScore >= 8 ? "Strong"
    : fitScore >= 7 ? "Interesting"
    : "Low";

  // Build fit rationale
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

  const topDimensions: Array<{ id: DimensionId; score: number }> = Object.entries(dimensionScores)
    .map(([id, score]) => ({ id: id as DimensionId, score }))
    .sort((a, b) => b.score - a.score);

  const topSignals = topDimensions
    .filter((d) => d.score >= 0.7)
    .slice(0, 4)
    .map((d) => {
      switch (d.id) {
        case "laneFit": return "consultant/strategy lane";
        case "aiRelevance": return "AI/LLM relevance";
        case "performanceMarketing": return "performance marketing";
        case "adtechMartechMedia": return "adtech/martech";
        case "seniority": return "seniority-aligned";
        case "compensationTransparency": return "salary published";
        case "remoteLocation": return "remote OK";
        case "companyCredibility": return "strong company";
        case "applicationComplexity": return "clean ATS";
      }
    });

  const fitRationale = topSignals.length > 0
    ? topSignals.join(" · ")
    : "General fit";

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

/**
 * Build a profile-aware Fit Assessment string for the Pipeline Fit Assessment column.
 * Uses directional two-layer framework: name the destination + signal the path.
 */
export function buildProfileFitAssessment(params: {
  role: string;
  company: string;
  result: ProfileAwareScoreResult;
  applicationComplexity: string;
  descriptionText?: string;
}): string {
  const { role, company, result, applicationComplexity, descriptionText } = params;
  const { band, fitScore, fitRationale, salaryPenalised, exceptionalWithoutSalary } = result;

  const parts: string[] = [];

  // Opening — name the destination
  parts.push(`${band} fit for ${role} at ${company} (score: ${fitScore}/10).`);

  // Fit rationale — name the path; fall back to description text if no signals
  // Use toPlainText to strip any HTML tags before embedding raw description text
  const rationale = fitRationale
    || (descriptionText ? toPlainText(descriptionText).slice(0, 80) : "General fit");
  parts.push(`Fit rationale: ${rationale}.`);

  // Location / remote signals
  const locationOk = result.dimensionScores.remoteLocation >= 0.7;
  if (!locationOk) {
    parts.push("⚠️ Location may require attention — verify before applying.");
  } else {
    parts.push("✅ Remote/location aligned.");
  }

  // Salary
  if (salaryPenalised) {
    if (exceptionalWithoutSalary) {
      parts.push("⚠️ Salary not published — exceptional AI/consulting lane compensates.");
    } else {
      parts.push("⚠️ Salary not published.");
    }
  } else {
    parts.push("💰 Salary band published.");
  }

  // Application complexity
  parts.push(`Application: ${applicationComplexity}.`);

  return parts.join(" ");
}

/**
 * Build profile-aware Talking Points for the Pipeline Talking Points column.
 * Uses voice.md patterns: lead with overlap, anchor at requested seniority.
 */
export function buildProfileTalkingPoints(params: {
  role: string;
  company: string;
  result: ProfileAwareScoreResult;
}): string {
  const { role, company, result } = params;
  const { primaryLane, dimensionScores, fitRationale } = result;

  const points: string[] = [];

  // Lead with the strongest lane overlap
  if (dimensionScores.laneFit >= 0.7) {
    points.push(`Lead with consulting: ${fitRationale.split(" · ")[0]}.`);
  } else if (dimensionScores.aiRelevance >= 0.7) {
    points.push("Lead with AI systems experience — multi-model routing, RAG, GCP deployment.");
  } else if (dimensionScores.performanceMarketing >= 0.7) {
    points.push("Lead with paid media track record — $10M+ book, top-3 national ranking.");
  }

  // Seniority alignment
  if (dimensionScores.seniority >= 0.9) {
    points.push("Anchor at the requested seniority — eight years, four progressive roles at Audacy.");
  } else if (dimensionScores.seniority < 0.5) {
    points.push("Frame as a strategic individual contributor ready for next-level scope.");
  }

  // Remote / location signal
  if (dimensionScores.remoteLocation >= 0.9) {
    points.push("Call out remote-first success: built and shipped AI systems without a co-located team.");
  }

  // Company credibility signal
  if (dimensionScores.companyCredibility >= 0.8) {
    points.push(`Reference credible platform work — Elio Intelligence Suite on GCP, Vertex AI Search RAG pipelines.`);
  }

  // Performance proof
  if (dimensionScores.performanceMarketing >= 0.6) {
    points.push("Use the unit-economics frame: 130% YoY paid-search conversion growth, 13% YoY new-user lift.");
  }

  return points.join(" ");
}