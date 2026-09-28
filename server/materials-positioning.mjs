/**
 * Materials — per-role positioning and role cues (voice v6).
 *
 * Which of the candidate's identities leads the letter's hook and the
 * resume summary depends on the role:
 *
 *   consultant  agency, consulting and client-services roles
 *   performance in-house growth, performance and marketing roles
 *   ai          AI, product and strategy roles (the AI builder leads)
 *
 * The kind comes from the extracted role (title, family) plus posting
 * cues. The words come from the user's voice.md when it names them
 * ("digital marketing consultant", "performance marketer", "AI product
 * builder"); without a voice guide only the kind is stated.
 *
 * The AI-role and AI-claim cues also live here: an AI role's letter
 * proofs lead with the candidate's AI-builder claims.
 */

const AI_ROLE_RE = /\b(?:AI|A\.I\.|artificial intelligence|machine learning|ML|LLMs?|generative|agentic|automation)\b/;
const AI_TITLE_RE = /\b(?:AI|A\.I\.|artificial intelligence|machine learning|ML|product|strategy|strategist|innovation)\b/i;
/* An AI-builder claim: he built it, and it is an AI system. "Coached
 * sellers on AI-search" is not one. */
const BUILDER_RE = /\b(?:built|shipped|designed|deployed|architected|stood up|wrote|automated|engineered|coded|launched)\b/i;
const AI_CLAIM_RE = /\b(?:AI platform|multi-model|RAG|LLMs?|Gemini|Claude|GPT|agentic|forecast(?:s|er|ing)?|Vertex|Cloud Run|automation|AI agency|AI-assisted)\b/i;
const CONSULT_CUE_RE = /\b(?:agency|agencies|consult(?:ant|ants|ancy|ing)?|client services|client success|account management|our clients|client portfolio)\b/gi;
const CLIENT_RE = /\bclients?\b/gi;
const PERFORMANCE_TITLE_RE = /\b(?:growth|performance|acquisition|demand|paid|marketing|media)\b/i;

/**
 * Is this role about AI or automation? Then the candidate's AI-builder
 * claims lead the letter's proof (never invented, only reordered).
 * @param {{ role?: { title?: unknown }, outcomes?: Array<{ text?: unknown }> }} extract
 */
export function isAiRole(extract) {
  const title = typeof extract.role?.title === "string" ? extract.role.title : "";
  const outcomes = (extract.outcomes || []).map((o) => (typeof o.text === "string" ? o.text : "")).join(" ");
  return AI_ROLE_RE.test(`${title} ${outcomes}`);
}

/** @param {string} text */
export function isAiClaim(text) {
  const t = String(text || "");
  return BUILDER_RE.test(t) && AI_CLAIM_RE.test(t);
}

/**
 * @typedef {"consultant" | "performance" | "ai"} PositioningKind
 */

/**
 * The positioning kind for a role.
 * @param {{ role?: { title?: unknown, family?: unknown }, outcomes?: Array<{ text?: unknown }> }} extract
 * @param {string} [postingText]
 * @returns {{ kind: PositioningKind, why: string }}
 */
export function positioningKind(extract, postingText = "") {
  const role = extract.role || {};
  const title = typeof role.title === "string" ? role.title : "";
  const family = typeof role.family === "string" ? role.family : "general";
  if (AI_TITLE_RE.test(title) || family === "product" || family === "engineering") {
    return { kind: "ai", why: `AI, product or strategy role ("${title}", family ${family})` };
  }
  const text = String(postingText || "");
  const consultCues = (text.match(CONSULT_CUE_RE) || []).length;
  const clientCues = (text.match(CLIENT_RE) || []).length;
  if (consultCues > 0 || family === "sales" || family === "customer-success" || clientCues >= 3) {
    return { kind: "consultant", why: `client-facing role (family ${family}; ${consultCues} agency or consulting cue(s), ${clientCues} client mention(s))` };
  }
  if (family === "marketing" || family === "analytics" || PERFORMANCE_TITLE_RE.test(title)) {
    return { kind: "performance", why: `in-house growth or marketing role ("${title}", family ${family})` };
  }
  return { kind: "consultant", why: `no stronger cue (family ${family})` };
}

/**
 * The positioning phrase the hook and the summary lead with, in the
 * user's own words when their voice guide has them.
 * @param {PositioningKind} kind
 * @param {{ facts?: string[], guideText?: string } | null | undefined} profile
 * @returns {string}
 */
export function positioningPhrase(kind, profile) {
  const corpus = profile ? [profile.guideText || "", ...(profile.facts || [])].join("\n").toLowerCase() : "";
  const has = (/** @type {string} */ words) => corpus.includes(words);
  const builder = has("ai product builder") ? "AI product builder" : "";
  const consultant = has("digital marketing consultant") ? "digital marketing consultant" : "";
  const performance = has("performance marketer") ? "performance marketer" : "";
  const strategist = has("strategist") && consultant ? "digital marketing strategist" : performance;
  if (kind === "ai") return builder ? [builder, strategist].filter(Boolean).join(" and ") : "";
  if (kind === "performance") return performance ? [performance, builder].filter(Boolean).join(" and ") : "";
  return consultant ? [consultant, builder].filter(Boolean).join(" and ") : "";
}

/**
 * The per-role header headline (Wave 3): the same positioning as the
 * letter hook and the resume summary, as a two-part title line in the
 * user's own words ("Digital Marketing Consultant · AI Product Builder").
 * Empty when the voice guide does not name the lead identity; the caller
 * then falls back to the profile or resume headline.
 * @param {PositioningKind} kind
 * @param {{ facts?: string[], guideText?: string } | null | undefined} profile
 * @returns {string}
 */
export function positioningHeadline(kind, profile) {
  const corpus = profile ? [profile.guideText || "", ...(profile.facts || [])].join("\n").toLowerCase() : "";
  if (!corpus) return "";
  const has = (/** @type {string} */ words) => corpus.includes(words);
  const builder = has("ai product builder") ? "AI Product Builder" : "";
  const consultant = has("digital marketing consultant") ? "Digital Marketing Consultant" : "";
  const performance = has("performance marketer") ? "Performance Marketer" : "";
  const strategist = has("digital marketing strategist") || (has("strategist") && consultant)
    ? "Digital Marketing Strategist"
    : performance;
  /** @type {string[]} */
  const parts = kind === "ai"
    ? [builder, strategist]
    : kind === "performance"
      ? [performance, builder]
      : [consultant, builder];
  if (!parts[0]) return "";
  return parts.filter(Boolean).join(" · ");
}

/**
 * The header headline precedence (Wave 3, Jordan's decision):
 *
 *   1. a headline the user confirmed in "Your details"
 *      (`identity.headlineConfirmed === true` beside `identity.headline`);
 *   2. the per-role positioning headline (positioningHeadline);
 *   3. an unconfirmed profile headline (pre-filled from the resume);
 *   4. the caller's own fallbacks (writer header, resume line, seat).
 *
 * @param {unknown} identity the saved profile's `identity`
 * @param {string} roleHeadline
 * @returns {{ headline: string, source: "confirmed" | "role" | "profile" | "" }}
 */
export function headlineFor(identity, roleHeadline) {
  const id = identity && typeof identity === "object" ? /** @type {Record<string, unknown>} */ (identity) : {};
  const own = typeof id.headline === "string" ? id.headline.trim() : "";
  if (own && id.headlineConfirmed === true) return { headline: own, source: "confirmed" };
  const role = String(roleHeadline || "").trim();
  if (role) return { headline: role, source: "role" };
  if (own) return { headline: own, source: "profile" };
  return { headline: "", source: "" };
}

/**
 * The positioning for one role: kind, reason and phrase.
 * @param {{ role?: { title?: unknown, family?: unknown }, outcomes?: Array<{ text?: unknown }> }} extract
 * @param {string} [postingText]
 * @param {{ facts?: string[], guideText?: string } | null} [profile]
 * @returns {{ kind: PositioningKind, why: string, phrase: string }}
 */
export function positioningFor(extract, postingText = "", profile = null) {
  const { kind, why } = positioningKind(extract, postingText);
  return { kind, why, phrase: positioningPhrase(kind, profile) };
}

/**
 * The approved named-client proofs in a voice guide: facts that name a
 * listed client (from its "Clients include …" line) and carry a number,
 * e.g. "Western Dental, 200+ DSO locations."
 * @param {{ facts?: string[] } | null | undefined} profile
 * @returns {string[]}
 */
export function namedClientProofs(profile) {
  const facts = profile?.facts || [];
  const list = facts.find((f) => /^Clients include /.test(f));
  const names = list ? list.replace(/^Clients include /, "").replace(/\.$/, "").split(/,\s*/).map((n) => n.trim()).filter((n) => n.length >= 3) : [];
  /* A guide with no client list (the onboarding template's "Approved
   * facts") offers its facts that name clients and carry a number. */
  if (!names.length) return facts.filter((f) => /\bclients?\b/i.test(f) && /\d/.test(f) && /[A-Z][a-z]+/.test(f.replace(/^\S+\s*/, "")));
  return facts.filter((f) => f !== list && /\d/.test(f) && names.some((n) => f.includes(n.split(" ")[0])));
}

/**
 * Does the role reward scale, enterprise or client work (so the evidence
 * should carry a named-client proof)? Not for AI roles.
 * @param {PositioningKind} kind
 */
export function wantsNamedClient(kind) {
  return kind !== "ai";
}
