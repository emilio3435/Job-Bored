/**
 * Directional Prompting — Integration for JobBored Discovery
 *
 * Uses the two-layer directional-prompting framework to drive query
 * variation in discovery and to frame application materials (cover
 * letter, talking points) when the apply pipeline is wired up.
 *
 * Layer 1 — Outcome: defines the destination for each prompt type.
 * Layer 2 — Direction: every sentence names the path with positive verbs.
 *
 * Reference: ~/.hermes/job-hunt/ profile docs and
 * /Users/emiliong/GitHub/emilio3435/directional-prompting/
 */

import type { NormalizedLead } from "../contracts.ts";

/* -----------------------------------------------------------------------
 * Prompt-building utilities
 * ---------------------------------------------------------------------- */

// Query variation profiles that map to Emilio's target role lanes.
// Each lane has a primary variation strategy and a set of alternatives
// that can be rotated per run (variationKey in DiscoveryWebhookRequestV1).
export type QueryLane =
  | "consultant"
  | "ai_builder"
  | "pm_smme"
  | "gtm_growth"
  | "demand_gen";

export type QueryVariation = {
  lane: QueryLane;
  /** Core query template — role + location suffixes are appended. */
  baseQuery: string;
  /** Directional modifiers that name the path (positive framing). */
  modifiers: string[];
  /** Alternative query templates for variation. */
  alternatives?: string[];
};

/** Directional-prompting outcome block for discovery query generation. */
const QUERY_OUTCOME = `Goal: Generate a set of Google Jobs search queries that surface relevant job listings for Emilio Nunez-Garcia's target roles.

Success means:
  - Each query names the destination role and, when present, the location.
  - Each query follows positive framing — every sentence describes what we want, using clear action-oriented language.
  - Queries map to Emilio's confirmed lane priorities (Digital Marketing Consultant > AI Product Builder > PMM > Growth > Demand Gen).
  - Location and remote intent are correctly represented.
  - Each query is specific enough to return relevant results and broad enough to return results.
  - Variations cover seniority, keyword focus, and alternative phrasing for the same role.

Stop when: At least one query per target role has been generated, with location and remote variants.`;

/**
 * Directional query generation for discovery.
 *
 * Takes a role, location, and optional lane context, and returns a
 * directional-style query string suitable for the SerpApi Google Jobs lane.
 *
 * The output follows the two-layer framework:
 * - Layer 1: the query names the destination (role + context).
 * - Layer 2: the query uses positive framing throughout (no negations).
 */
export function buildDirectionalQuery(
  role: string,
  location: string,
  remote: string,
  lane: QueryLane = "consultant",
): string {
  const locationPart = location
    ? normalizeLocationQuery(location, remote)
    : remote === "remote"
      ? "remote"
      : "";

  const lanePhrases: Record<QueryLane, { primary: string; modifiers: string[] }> = {
    consultant: {
      primary: "Digital Marketing Consultant",
      modifiers: [
        "performance marketing strategy",
        "paid media consultant",
        "growth marketing advisor",
      ],
    },
    ai_builder: {
      primary: "AI Product Builder",
      modifiers: [
        "AI solutions architect",
        "applied AI engineer marketing",
        "GTM engineer AI workflows",
      ],
    },
    pm_smme: {
      primary: "Senior Product Marketing Manager",
      modifiers: [
        "technical PMM AI",
        "AI GTM lead",
        "growth marketing AI platform",
      ],
    },
    gtm_growth: {
      primary: "Performance Marketing Manager",
      modifiers: [
        "paid acquisition lead",
        "demand generation director",
        "growth marketing specialist",
      ],
    },
    demand_gen: {
      primary: "Demand Generation Manager",
      modifiers: [
        "marketing operations lead",
        "lifecycle marketing manager",
        "account based marketing",
      ],
    },
  };

  const { primary, modifiers } = lanePhrases[lane];

  // Use the primary phrase but allow modifiers to broaden or vary.
  // Directional rule: the correct behavior is described so clearly that
  // the wrong behavior has no room to exist.
  const core = roleIncludesPrimaryLike(role, primary)
    ? role
    : primary;

  if (locationPart) {
    return `${core} ${locationPart}`.trim();
  }
  return core;
}

/**
 * Build a set of variation queries from a canonical role.
 * Returns an array of directional queries — one primary, rest alternatives.
 * All queries use positive framing; no negations.
 */
export function buildQueryVariations(
  role: string,
  location: string,
  remote: string,
  lane: QueryLane = "consultant",
): string[] {
  const primary = buildDirectionalQuery(role, location, remote, lane);
  const alternatives = buildAlternativeQueries(role, location, remote, lane);
  return [primary, ...alternatives];
}

/**
 * Build a directional framing prompt for cover-letter / application materials.
 *
 * This is used when the apply pipeline wires up (T2.5 / T2.6 on the P2 graph).
 * The output is a directional prompt fragment — not a finished letter.
 *
 * Layer 1 — Outcome: names the destination (cover letter that earns the interview).
 * Layer 2 — Direction: every sentence names the path with positive verbs.
 *
 * Callers embed this in a larger prompt that provides job description, company,
 * and Emilio's profile context.
 */
export function buildApplicationFramingPrompt(params: {
  company: string;
  role: string;
  fitSummary: string;
  keyAchievements: string[];
}): string {
  const { company, role, fitSummary, keyAchievements } = params;

  return `Goal: Write a cover letter fragment for ${role} at ${company} that earns an interview.

Success means:
  - Opening names the specific role and company (no generic "I am writing to apply")
  - First body paragraph connects ${role} fit to ${company}'s mission or recent moves, named specifically
  - Second body paragraph cites 2–3 quantified achievements from the candidate's profile that map directly to the role
  - Tone is confident and direct — not deferential or wordy
  - Closing names the next concrete step from the candidate's perspective

Stop when: A complete 3-paragraph cover letter draft has been written.

Focus on:
  Trace the role's core requirement from the job description and lead with that.
  Build the fit story from specific outcomes (conversion growth, revenue, ROAS, budget managed), not generic adjectives.
  Name the company and the role exactly once in the first paragraph.
  Keep the letter to 300–400 words.
  Use active verbs throughout. Describe what the candidate did, not what they "helped with" or "supported."

Fit summary: ${fitSummary}

Key achievements to draw from:
${keyAchievements.map((a) => `  - ${a}`).join("\n")}`;
}

/**
 * Determine which query lane to use based on role title keywords.
 * Maps from role title → QueryLane using the best-fit titles from job-preferences.md.
 */
export function inferQueryLane(role: string): QueryLane {
  const lower = role.toLowerCase();

  // Check more specific composites before their sub-strings to avoid
  // "director of X" getting caught by the bare "director" clause.
  if (
    lower.includes("director of product marketing") ||
    lower.includes("director of performance marketing") ||
    lower.includes("director of paid") ||
    lower.includes("director of digital")
  ) {
    return lower.includes("product marketing") || lower.includes("performance marketing")
      ? lower.includes("product marketing")
        ? "pm_smme"
        : "gtm_growth"
      : "consultant";
  }

  if (
    lower.includes("consultant") ||
    lower.includes("strategist") ||
    lower.includes("practice lead") ||
    lower.includes("ai search") ||
    lower.includes("geo strateg") ||
    (lower.includes("director") &&
      !lower.includes("product marketing") &&
      !lower.includes("performance marketing") &&
      !lower.includes("paid") &&
      !lower.includes("demand generation") &&
      !lower.includes("account based")) ||
    (lower.includes("principal") &&
      !lower.includes("product marketing") &&
      !lower.includes("product manager") &&
      !lower.includes("pm ") &&
      !lower.includes("pmm") &&
      !lower.includes("pm,"))
  ) {
    return "consultant";
  }

  if (
    lower.includes("ai product") ||
    lower.includes("ai builder") ||
    lower.includes("solutions architect") ||
    lower.includes("forward deployed") ||
    lower.includes("gtm engineer") ||
    lower.includes("technical account") ||
    lower.includes("ai platform")
  ) {
    return "ai_builder";
  }

  if (
    lower.includes("product marketing") ||
    lower.includes("technical pm") ||
    lower.includes("pm ") ||
    (lower.includes("pm") && lower.includes("ai")) ||
    lower.includes("staff pm") ||
    lower.includes("principal pm")
  ) {
    return "pm_smme";
  }

  if (
    lower.includes("growth marketing") ||
    lower.includes("paid media") ||
    lower.includes("performance marketing") ||
    lower.includes("senior paid acquisition") ||
    lower.includes("paid acquisition")
  ) {
    return "gtm_growth";
  }

  if (
    lower.includes("demand generation") ||
    lower.includes("lifecycle marketing") ||
    lower.includes("marketing operations") ||
    lower.includes("account based marketing") ||
    lower.includes("abm ")
  ) {
    return "demand_gen";
  }

  // Default to consultant lane — Emilio's highest-priority lane.
  return "consultant";
}

/* -----------------------------------------------------------------------
 * Internal helpers
 * ---------------------------------------------------------------------- */

function roleIncludesPrimaryLike(role: string, primary: string): boolean {
  const roleLower = role.toLowerCase();
  const primaryLower = primary.toLowerCase();
  // If the role appears verbatim within the primary, use the role.
  // This prevents "Engineer" from being replaced by "Digital Marketing Consultant"
  // when the lane defaults to "consultant" but the role is unrelated.
  if (primaryLower.includes(roleLower)) return true;
  const primaryWords = primary.toLowerCase().split(/\s+/);
  // If at least half the primary words appear in the role, use the role itself.
  const matchCount = primaryWords.filter((w) => roleLower.includes(w)).length;
  return matchCount >= Math.ceil(primaryWords.length / 2);
}

function normalizeLocationQuery(location: string, remote: string): string {
  const loc = location.trim();
  if (!loc) return "";

  // When the location is literally "Remote" (or "Remote, US" etc.) and
  // remote policy is "remote", skip the location to avoid "remote in Remote".
  if (remote === "remote" && /\bremote\b/i.test(loc)) {
    return "remote";
  }

  // When remote is "remote" and location is a US city, prefer "remote" alone.
  // When remote is not set, use the location as-is.
  if (remote === "remote") {
    // Only keep location if it's not just a city name (avoids redundancy).
    if (/^\w+( \w+){0,2}$/.test(loc)) {
      return `remote in ${loc}`;
    }
    return `remote ${loc}`;
  }
  return loc;
}

function buildAlternativeQueries(
  role: string,
  location: string,
  remote: string,
  lane: QueryLane,
): string[] {
  const results: string[] = [];
  const locationPart = location
    ? normalizeLocationQuery(location, remote)
    : remote === "remote"
      ? "remote"
      : "";

  // Build alternative queries per lane — broaden, vary seniority, add keyword focus.
  const alternatives: string[] = [];

  if (lane === "consultant") {
    alternatives.push(
      ...buildConsultantAlternatives(role, locationPart),
    );
  } else if (lane === "ai_builder") {
    alternatives.push(...buildAiBuilderAlternatives(role, locationPart));
  } else if (lane === "pm_smme") {
    alternatives.push(...buildPmAlternatives(role, locationPart));
  } else if (lane === "gtm_growth") {
    alternatives.push(...buildGtmAlternatives(role, locationPart));
  } else {
    alternatives.push(...buildDemandGenAlternatives(role, locationPart));
  }

  // Deduplicate and cap at 3 alternatives.
  const seen = new Set<string>();
  for (const alt of alternatives) {
    const normalized = alt.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      results.push(alt);
    }
    if (results.length >= 3) break;
  }

  return results;
}

function buildConsultantAlternatives(
  role: string,
  locationPart: string,
): string[] {
  const suffix = locationPart ? ` ${locationPart}` : "";
  return [
    `Senior Digital Marketing Strategist${suffix}`,
    `Performance Marketing Director${suffix}`,
    `Growth Marketing Consultant${suffix}`,
  ];
}

function buildAiBuilderAlternatives(
  role: string,
  locationPart: string,
): string[] {
  const suffix = locationPart ? ` ${locationPart}` : "";
  return [
    `AI Solutions Architect${suffix}`,
    `Forward Deployed AI Engineer${suffix}`,
    `GTM Engineer AI${suffix}`,
  ];
}

function buildPmAlternatives(role: string, locationPart: string): string[] {
  const suffix = locationPart ? ` ${locationPart}` : "";
  return [
    `Senior Product Marketing Manager AI${suffix}`,
    `Staff Product Marketing Manager${suffix}`,
    `AI GTM Lead${suffix}`,
  ];
}

function buildGtmAlternatives(role: string, locationPart: string): string[] {
  const suffix = locationPart ? ` ${locationPart}` : "";
  return [
    `Director Performance Marketing${suffix}`,
    `Growth Marketing Lead${suffix}`,
    `Senior Paid Acquisition Manager${suffix}`,
  ];
}

function buildDemandGenAlternatives(
  role: string,
  locationPart: string,
): string[] {
  const suffix = locationPart ? ` ${locationPart}` : "";
  return [
    `Marketing Operations Manager${suffix}`,
    `Lifecycle Marketing Manager${suffix}`,
    `Account Based Marketing Director${suffix}`,
  ];
}

/* -----------------------------------------------------------------------
 * Fit-assessment builder (for Pipeline Fit Assessment column)
 * ---------------------------------------------------------------------- */

/**
 * Build a directional fit-assessment summary for a discovered job.
 * Written to the Pipeline "Fit Assessment" column.
 *
 * Uses the two-layer framework:
 * - Layer 1: names the destination (a concise, actionable fit summary).
 * - Layer 2: each sentence names the path with positive verbs.
 */
export function buildFitAssessment(params: {
  role: string;
  company: string;
  fitScore: number;
  fitSummary: string;
  locationOk: boolean;
  remoteOk: boolean;
  salaryPublished: boolean;
  applicationComplexity: string;
}): string {
  const {
    role,
    company,
    fitScore,
    fitSummary,
    locationOk,
    remoteOk,
    salaryPublished,
    applicationComplexity,
  } = params;

  const scoreBand = fitScore >= 9 ? "Exceptional" : fitScore >= 8 ? "Strong" : fitScore >= 7 ? "Interesting" : "Low";

  const parts: string[] = [];

  // Opening — name the destination.
  parts.push(`${scoreBand} fit for ${role} at ${company}.`);

  // Fit rationale — name the path.
  parts.push(`Fit rationale: ${fitSummary}`);

  // Location / remote signals.
  if (!locationOk && !remoteOk) {
    parts.push("⚠️ Location may require attention — verify before applying.");
  } else if (remoteOk) {
    parts.push("✅ Remote OK.");
  } else {
    parts.push("✅ Location acceptable.");
  }

  // Salary.
  if (salaryPublished) {
    parts.push("💰 Salary band published.");
  } else {
    parts.push("⚠️ Salary not published.");
  }

  // Application complexity.
  parts.push(`Application: ${applicationComplexity}.`);

  return parts.join(" ");
}

/* -----------------------------------------------------------------------
 * Export query outcome constant for use in other modules
 * ---------------------------------------------------------------------- */
export { QUERY_OUTCOME };