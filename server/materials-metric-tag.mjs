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

/* M4: number words, up to "nine hundred and ninety-nine", "fifteen hundred"
 * and "half a dozen". */
const WORD_VALUES = new Map(Object.entries({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}));
const UNIT_WORDS = "one|two|three|four|five|six|seven|eight|nine";
const SMALL_WORDS = `(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](?:${UNIT_WORDS}))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen`;
/* Digits with thousands grouped by threes, never re-entered mid-number, so a
 * long comma run reads in linear time. */
const DIGITS = "(?<![\\d,.])(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const NUMBER = `(?:(?:half\\s+a|a|${SMALL_WORDS})\\s+dozen|(?:a|${SMALL_WORDS})\\s+hundred(?:\\s+(?:and\\s+)?(?:${SMALL_WORDS}))?|${SMALL_WORDS})\\b|${DIGITS}`;
/* Nouns that make a spelled-out number a real count (as in materials-numerals). */
const COUNT_NOUNS = "people|persons?|reps?|sellers?|staff|employees?|hires?|engineers?|managers?|specialists?|directs?|reports?|members?|FTEs?|clients?|accounts?|advertisers?|customers?|brands?|partners?|agencies|agency|desks?|markets?|stations?|locations?|stores?|states?|countries|campaigns?|deals?|users?|subscribers?|leads?|sites?|teams?|properties|publishers?|verticals?|categories";
/* Words that end a count: "ten years leading teams" counts years, not teams. */
const NOT_A_COUNT_GAP = /\b(?:of|the|a|an|and|or|to|for|with|in|on|at|by|from|our|my|their|its|as|years?|months?|weeks?|days?|hours?|quarters?|decades?|times)\b/i;
const SENTENCE_START = /(?:^|[.!?:;•\n]\s*|\(\s*)$/u;
const SCALE = /** @type {Record<string, string>} */ ({ thousand: "K", million: "M", billion: "B" });
const MULTIPLE = /** @type {Record<string, string>} */ ({ doubled: "2x", tripled: "3x", quadrupled: "4x" });

/** @param {string} words digits, or number words matched by NUMBER */
function numberValue(words) {
  if (/^\d/.test(words)) return words.replace(/,/g, "");
  let value = 0;
  let lead = 0;
  for (const word of words.toLowerCase().split(/[-\s]+/)) {
    if (word === "half") lead = 0.5;
    else if (word === "a") lead = lead || 1;
    else if (word === "hundred" || word === "dozen") {
      value = (value || lead || 1) * (word === "hundred" ? 100 : 12);
      lead = 0;
    } else if (WORD_VALUES.has(word)) value += /** @type {number} */ (WORD_VALUES.get(word));
  }
  return String(value);
}

/**
 * M4: spelled-out figures as the digit tokens the ledger and the critic
 * compare: "forty percent" → "40%", "$3 million" / "three million dollars" →
 * "$3M", "doubled" → "2x", "half a dozen reps" → "6 reps". Prose stays prose:
 * "one of", "one team", "two years", "ten years leading teams", "Big Four
 * clients", "doubled as" and "doubled down" are not metrics.
 * @param {string} text
 */
export function spelledMetrics(text) {
  return String(text || "")
    .replace(new RegExp(`(\\$\\s?)?\\b(${NUMBER})\\s+(thousand|million|billion)\\b(\\s+dollars\\b)?`, "gi"),
      (_m, dollar, n, scale, dollars) => `${dollar || dollars ? "$" : ""}${numberValue(n)}${SCALE[scale.toLowerCase()]}`)
    .replace(new RegExp(`\\b(${NUMBER})\\s*(?:percent|per\\s+cent)\\b`, "gi"), (_m, n) => `${numberValue(n)}%`)
    .replace(new RegExp(`\\b(${NUMBER})\\s+dollars\\b`, "gi"), (_m, n) => `$${numberValue(n)}`)
    .replace(new RegExp(`\\b(${NUMBER})[-\\s]fold\\b`, "gi"), (_m, n) => `${numberValue(n)}x`)
    .replace(/\b(doubled|tripled|quadrupled)\b(?![-\s]+(?:down|as|up|back|over)\b)/gi, (m) => MULTIPLE[m.toLowerCase()])
    .replace(new RegExp(`\\b(${NUMBER})\\s+((?:[\\p{L}-]+\\s+){0,2}?)(?=(?:${COUNT_NOUNS})\\b)`, "giu"), (m, n, gap, offset, whole) => {
      if (/^\d/.test(n) || Number(numberValue(n)) < 2 || NOT_A_COUNT_GAP.test(gap) || /\p{Lu}/u.test(gap)) return m;
      if (/\b(?:top|bottom|first)[-\s]+$/i.test(whole.slice(0, offset))) return m;
      /* A capitalised number word mid-sentence names something ("Big Four"). */
      if (/^\p{Lu}/u.test(n) && !SENTENCE_START.test(whole.slice(0, offset))) return m;
      return `${numberValue(n)} ${gap}`;
    });
}

/**
 * M4: figures compare by value, so "5K" is "5,000" and "$3M" is
 * "$3,000,000"; a range or anything else compares as written.
 * @param {string} token
 */
function metricKey(token) {
  const match = String(token).trim().match(/^([$#]|top-)?(\d[\d,]*(?:\.\d+)?)([kKmMbB])?(\+|%|x)?$/i);
  if (!match) return String(token);
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[String(match[3] || "").toLowerCase()] || 1;
  const value = Number((Number(match[2].replace(/,/g, "")) * scale).toPrecision(12));
  return `${String(match[1] || "").toLowerCase()}${value}${String(match[4] || "").toLowerCase()}`;
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
  const postingTokens = new Set(numerals(postingText).map(metricKey));
  /** @type {Array<{ code: string, field: string, token: string, message: string }>} */
  const issues = [];
  let matched = 0;
  let total = 0;
  /* M3: unverified evidence (verified:false) never grounds a number. */
  const ledgerTokens = new Set(
    (ledger.claims || []).flatMap((c) =>
      Array.isArray(c.metrics) && c.verified !== false ? c.metrics.map((m) => metricKey(String(m.token || ""))) : [],
    ),
  );

  /** @param {string} field @param {string} text @param {string[] | null} claimTokens */
  const check = (field, text, claimTokens) => {
    const claimKeys = claimTokens ? claimTokens.map(metricKey) : null;
    for (const token of numerals(text)) {
      total += 1;
      const key = metricKey(token);
      const ok = claimKeys
        ? claimKeys.includes(key)
        : ledgerTokens.has(key) || (field.startsWith("letter.") && postingTokens.has(key));
      if (ok) {
        matched += 1;
      } else if (claimKeys && ledgerTokens.has(key)) {
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
