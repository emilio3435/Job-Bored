/**
 * Shared numeral hygiene for the materials pipeline.
 *
 * Ratios and schedules ("1:1 coaching", "24/7 support", "3/4 time") are
 * not metrics: their digits must never become a metric token, a readout
 * or an "untraced numeral". Every metric scanner masks them first.
 */

/* A digit run joined to another by ":" or "/" (1:1, 24/7, 9:30). */
const RATIO_RE = /(?<![\w$#.])\d+(?:\.\d+)?\s?[:/]\s?\d+(?:\.\d+)?(?![\w%])/g;

/**
 * The text with every ratio replaced by spaces of the same length, so
 * match indices still line up with the original string.
 * @param {string} text
 */
export function maskRatios(text) {
  return String(text || "").replace(RATIO_RE, (m) => " ".repeat(m.length));
}

/* Nouns that make a bare number a real count (people, accounts, desks …). */
const COUNT_NOUN_RE = /^(?!(?:[\p{L}-]+\s){0,2}?(?:service|api|gcp|aws|azure|cloud|iam|test|dev|admin|bot|email|e-mail|social)\s+(?:accounts?|users?|keys?))(?:[\p{L}-]+\s){0,2}?(?:people|persons?|reps?|sellers?|staff|employees?|hires?|engineers?|managers?|specialists?|directs?|reports?|members?|heads?|FTEs?|clients?|accounts?|advertisers?|customers?|brands?|partners?|agencies|agency|desks?|markets?|stations?|locations?|stores?|states?|countries|campaigns?|deals?|users?|subscribers?|leads?|sites?|teams?|properties|publishers?|verticals?|categories)\b/iu;

/* Words that head a figure without naming a product ("Top 3", "No. 1"). */
const NOT_PRODUCT_HEADS = new Set([
  "top", "no", "tier", "over", "nearly", "about", "almost", "roughly", "up", "the", "a", "an", "and", "or", "with", "by", "of", "in", "to", "for", "from", "at", "across", "managed", "led", "grew", "drove", "built", "hired", "ran", "owned", "delivered", "shipped", "cut", "added", "won", "closed", "launched", "scaled", "increased", "reduced",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december", "q",
]);
/* A modifier that closes a product or model name ("Chirp 3 HD", "Gemini 2.5 Pro"). */
const PRODUCT_TAIL_RE = /^(?:HD|UHD|4K|Pro|Max|Mini|Ultra|Plus|Turbo|Flash|Lite|Nano|Sonnet|Opus|Haiku|Series|Edition|Gen|Beta|Alpha|SE|XL|LTS|API|TTS)\b/;

/**
 * Spans of numerals that are part of a product or model name, not a
 * metric: "GPT-4", "Llama-3.1", "Chirp 3 HD", "Web 3", "Gemini 2.5 Pro".
 * A figure with a unit ($, %, x, K/M/B, +) is always a metric.
 * @param {string} text
 * @returns {Array<[number, number]>}
 */
export function productNumeralSpans(text) {
  const t = String(text || "");
  /** @type {Array<[number, number]>} */
  const spans = [];
  /* Name-hyphen-number: GPT-4, GPT-4o, Llama-3.1, COVID-19 (not top-4). */
  for (const m of t.matchAll(/(?<![\p{L}\p{N}$#])(\p{L}[\p{L}\p{N}]*)-(\d+(?:\.\d+)*[a-z]?)(?![\p{L}\p{N}%+])/gu)) {
    if (NOT_PRODUCT_HEADS.has(m[1].toLowerCase())) continue;
    if (!/\p{Lu}/u.test(m[1])) continue;
    const start = /** @type {number} */ (m.index) + m[1].length + 1;
    spans.push([start, start + m[2].length]);
  }
  /* Name-space-number: a capitalised or all-caps word, then a bare number
   * with no unit, that is a product when the name sits mid-sentence or a
   * product modifier follows ("Chirp 3 HD", "Web 3", "GPT 4"). */
  for (const m of t.matchAll(/(?<![\p{L}\p{N}$#])(\p{Lu}[\p{L}\p{N}]*) (\d+(?:\.\d+)?)(?![,.]?\d)(?![\p{L}\p{N}%+$]|\s?[KMBkmb]\b|x\b)/gu)) {
    const head = m[1];
    if (NOT_PRODUCT_HEADS.has(head.toLowerCase())) continue;
    const start = /** @type {number} */ (m.index);
    const numStart = start + head.length + 1;
    const numEnd = numStart + m[2].length;
    const after = t.slice(numEnd).replace(/^\s+/, "");
    const before = t.slice(0, start);
    const sentenceStart = /(^|[.!?:;•\n]\s*|\(\s*)$/.test(before);
    const allCaps = /^\p{Lu}{2,}$/u.test(head);
    if (COUNT_NOUN_RE.test(after) && !PRODUCT_TAIL_RE.test(after)) continue;
    if (PRODUCT_TAIL_RE.test(after) || allCaps || !sentenceStart) spans.push([numStart, numEnd]);
  }
  return spans;
}

/**
 * The text with ratios and product-name numerals blanked out (same length,
 * so indices line up). Every metric scanner reads this, never raw text.
 * @param {string} text
 */
export function maskNonMetrics(text) {
  const masked = maskRatios(text).split("");
  for (const [a, b] of productNumeralSpans(String(text || ""))) {
    for (let i = a; i < b; i += 1) masked[i] = " ";
  }
  return masked.join("");
}

/* A "#N" followed by a place or market word is a size rank of the market
 * (context), not a result: "#17 market", "#17 U.S. market", "#5 DMA". */
const CONTEXT_RANK_FOLLOWING_RE = /^(?:[-–]?\s*(?:sized|size)\b|(?:largest\s+|biggest\s+)?(?:u\.?s\.?\s+)?(?:market|markets|metro|dma|city|cities|region|state|country)\b)/i;

/**
 * True for a context rank: "#N" that sizes a market or place.
 * @param {string} token
 * @param {string} [following] the words after it
 */
export function isContextRank(token, following = "") {
  return /^#\d+$/.test(String(token || "").trim()) && CONTEXT_RANK_FOLLOWING_RE.test(String(following || "").trim());
}

/**
 * A readout (header ticker, "Verified figures") needs a real metric: money,
 * a percentage, a multiplier, a rank, or a count of people, accounts,
 * desks and the like. Never a bare numeral ("3" from "Chirp 3 HD").
 * @param {string} token the figure as printed ("$12M+", "125%", "top-4", "12")
 * @param {string} [following] the words after it, for a bare count
 */
export function isReadoutMetric(token, following = "") {
  const t = String(token || "").trim();
  if (!/\d/.test(t)) return false;
  /* Review defect 3: "#17 market" sizes the market, it is not something
   * the candidate achieved; the ticker shows achievements only. */
  if (isContextRank(t, following)) return false;
  if (/^[$€£]/.test(t) || /%$/.test(t) || /\dx$/i.test(t) || /[kmb]\+?$/i.test(t)) return true;
  if (/^(?:top-|#)\d/i.test(t)) return true;
  return COUNT_NOUN_RE.test(String(following || "").trim());
}
