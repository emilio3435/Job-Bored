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

/**
 * @param {string} text
 * @returns {string[]}
 */
export function numerals(text) {
  /** @type {string[]} */
  const out = [];
  for (const match of maskNonMetrics(String(text || "")).matchAll(NUMERAL_RE)) {
    const token = match[1];
    if (!token || YEAR_RE.test(token) || YEAR_RANGE_RE.test(token)) continue;
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * @param {object} input
 * @param {{ statement?: unknown, bullets?: Array<{ claimId?: unknown, text?: unknown }>, earlier?: Array<{ claimId?: unknown, text?: unknown }>, letter?: Record<string, unknown> }} input.draft
 * @param {{ claims?: Array<{ id?: unknown, metrics?: Array<{ token?: unknown }> }> }} input.ledger
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
  const ledgerTokens = new Set(
    (ledger.claims || []).flatMap((c) =>
      Array.isArray(c.metrics) ? c.metrics.map((m) => String(m.token || "")) : [],
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
  for (const line of draft.earlier || []) {
    check("earlier", line && typeof line.text === "string" ? line.text : "", null);
  }
  const letter = draft.letter && typeof draft.letter === "object" ? draft.letter : {};
  for (const [beat, text] of Object.entries(letter)) {
    check(`letter.${beat}`, typeof text === "string" ? text : "", null);
  }
  return { issues, matched, total };
}
