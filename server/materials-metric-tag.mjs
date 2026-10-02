/**
 * Materials v3 — metric tagging (plan slice 5, mechanism §6.5).
 *
 * Every numeral in the draft must trace to a ledger metric token:
 * bullets cite their own claim's metrics exactly (P-9: a bullet that
 * borrows another claim's number is metric_borrowed), statement and
 * letter numerals must appear somewhere in the ledger. An untraced
 * numeral is an invented fact; both fail QA. Emphasis (<strong>) is applied later
 * by the render-model adapter, never here.
 */

import { metricsForClaim } from "./materials-ledger.mjs";
import { maskNonMetrics } from "./materials-numerals.mjs";

const NUMERAL_RE = /((?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?)/g;
const YEAR_RE = /^(?:19|20)\d\d$/;
const YEAR_RANGE_RE = /^(?:19|20)\d\d[–-](?:19|20)\d\d$/;

/* M4: number words, up to "nine hundred and ninety-nine" and "a dozen". */
const WORD_VALUES = new Map(Object.entries({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}));
const UNIT_WORDS = "one|two|three|four|five|six|seven|eight|nine";
const SMALL_WORDS = `(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](?:${UNIT_WORDS}))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen`;
const NUMBER = `(?:(?:a|${UNIT_WORDS})\\s+hundred(?:\\s+(?:and\\s+)?(?:${SMALL_WORDS}))?|a\\s+dozen|${SMALL_WORDS})\\b|\\d[\\d,]*(?:\\.\\d+)?`;
/* Nouns that make a spelled-out number a real count (as in materials-numerals). */
const COUNT_NOUNS = "people|persons?|reps?|sellers?|staff|employees?|hires?|engineers?|managers?|specialists?|directs?|reports?|members?|FTEs?|clients?|accounts?|advertisers?|customers?|brands?|partners?|agencies|agency|desks?|markets?|stations?|locations?|stores?|states?|countries|campaigns?|deals?|users?|subscribers?|leads?|sites?|teams?|properties|publishers?|verticals?|categories";
const NOT_A_COUNT_GAP = /\b(?:of|the|a|an|and|or|to|for|with|in|on|at|by|from|our|my|their|its|as)\b/i;
const SCALE = /** @type {Record<string, string>} */ ({ thousand: "K", million: "M", billion: "B" });
const MULTIPLE = /** @type {Record<string, string>} */ ({ doubled: "2x", tripled: "3x", quadrupled: "4x" });

/** @param {string} words digits, or number words matched by NUMBER */
function numberValue(words) {
  if (/^\d/.test(words)) return words.replace(/,/g, "");
  let value = 0;
  for (const word of words.toLowerCase().split(/[-\s]+/)) {
    if (word === "a") value = 1;
    else if (word === "hundred") value = (value || 1) * 100;
    else if (word === "dozen") value = (value || 1) * 12;
    else if (WORD_VALUES.has(word)) value += /** @type {number} */ (WORD_VALUES.get(word));
  }
  return String(value);
}

/**
 * M4: spelled-out figures as the digit tokens the ledger and the critic
 * compare: "forty percent" → "40%", "$3 million" / "three million dollars" →
 * "$3M", "doubled" → "2x", "a dozen reps" → "12 reps". Prose stays prose:
 * "one of", "one team" and "two years" are not metrics.
 * @param {string} text
 */
export function spelledMetrics(text) {
  return String(text || "")
    .replace(new RegExp(`(\\$\\s?)?\\b(${NUMBER})\\s+(thousand|million|billion)\\b(\\s+dollars\\b)?`, "gi"),
      (_m, dollar, n, scale, dollars) => `${dollar || dollars ? "$" : ""}${numberValue(n)}${SCALE[scale.toLowerCase()]}`)
    .replace(new RegExp(`\\b(${NUMBER})\\s*(?:percent|per\\s+cent)\\b`, "gi"), (_m, n) => `${numberValue(n)}%`)
    .replace(new RegExp(`\\b(${NUMBER})\\s+dollars\\b`, "gi"), (_m, n) => `$${numberValue(n)}`)
    .replace(new RegExp(`\\b(${NUMBER})[-\\s]fold\\b`, "gi"), (_m, n) => `${numberValue(n)}x`)
    .replace(/\b(doubled|tripled|quadrupled)\b(?!\s+down\b)/gi, (m) => MULTIPLE[m.toLowerCase()])
    .replace(new RegExp(`\\b(${NUMBER})\\s+((?:[\\p{L}-]+\\s+){0,2}?)(?=(?:${COUNT_NOUNS})\\b)`, "giu"), (m, n, gap) => {
      if (/^\d/.test(n) || Number(numberValue(n)) < 2 || NOT_A_COUNT_GAP.test(gap)) return m;
      return `${numberValue(n)} ${gap}`;
    });
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function numerals(text) {
  /** @type {string[]} */
  const out = [];
  for (const match of maskNonMetrics(spelledMetrics(String(text || ""))).matchAll(NUMERAL_RE)) {
    const token = match[1];
    if (!token || YEAR_RE.test(token) || YEAR_RANGE_RE.test(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * @param {object} input
 * @param {{ statement?: unknown, bullets?: Array<{ claimId?: unknown, text?: unknown }>, earlier?: Array<{ claimId?: unknown, text?: unknown }>, letter?: Record<string, unknown> }} input.draft
 * @param {{ claims?: Array<{ id?: unknown, verified?: unknown, metrics?: Array<{ token?: unknown }> }> }} input.ledger
 * @param {string} [input.postingText] the posting; its numbers are legal in the letter
 */
export function tagDraftMetrics({ draft, ledger, postingText = "" }) {
  /* Letter only: a posting fact may carry its own number (the hook's
   * company fact); resume slots never may. */
  const postingTokens = new Set(numerals(postingText));
  /** @type {Array<{ code: string, field: string, token: string, message: string }>} */
  const issues = [];
  let matched = 0;
  let total = 0;
  /* M3: unverified evidence (verified:false) never grounds a number. */
  const ledgerTokens = new Set(
    (ledger.claims || []).flatMap((c) =>
      Array.isArray(c.metrics) && c.verified !== false ? c.metrics.map((m) => String(m.token || "")) : [],
    ),
  );

  /** @param {string} field @param {string} text @param {string[] | null} claimTokens */
  const check = (field, text, claimTokens) => {
    for (const token of numerals(text)) {
      total += 1;
      const ok = claimTokens
        ? claimTokens.includes(token)
        : ledgerTokens.has(token) || (field.startsWith("letter.") && postingTokens.has(token));
      if (ok) {
        matched += 1;
      } else if (claimTokens && ledgerTokens.has(token)) {
        issues.push({
          code: "metric_borrowed",
          field,
          token,
          message: `${field}: ${token} belongs to a different claim; a bullet may only use its own claim's numbers.`,
        });
      } else {
        issues.push({
          code: "invented_fact",
          field,
          token,
          message: `${field}: ${token} does not trace to a ledger metric.`,
        });
      }
    }
  };

  check("statement", typeof draft.statement === "string" ? draft.statement : "", null);
  for (const bullet of draft.bullets || []) {
    const text = bullet && typeof bullet.text === "string" ? bullet.text : "";
    const claimTokens = bullet && typeof bullet.claimId === "string"
      ? metricsForClaim(ledger, bullet.claimId)
      : [];
    check(`bullets.${bullet?.claimId || "?"}`, text, claimTokens);
  }
  /* M4: an earlier line, like a bullet, may use only its own claim's numbers. */
  for (const line of draft.earlier || []) {
    const claimTokens = line && typeof line.claimId === "string" ? metricsForClaim(ledger, line.claimId) : null;
    check("earlier", line && typeof line.text === "string" ? line.text : "", claimTokens);
  }
  const letter = draft.letter && typeof draft.letter === "object" ? draft.letter : {};
  for (const [beat, text] of Object.entries(letter)) {
    check(`letter.${beat}`, typeof text === "string" ? text : "", null);
  }
  return { issues, matched, total };
}
