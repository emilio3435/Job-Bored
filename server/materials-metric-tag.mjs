/**
 * Materials v3 — metric tagging (plan slice 5, mechanism §6.5).
 *
 * Every numeral in the draft must trace to a ledger metric token:
 * bullets cite their claim's metrics exactly, statement and letter
 * numerals must appear somewhere in the ledger. An untraced numeral is
 * an invented fact and fails QA. Emphasis (<strong>) is applied later
 * by the render-model adapter, never here.
 */

import { metricsForClaim } from "./materials-ledger.mjs";

const NUMERAL_RE = /((?:[$#]|top-)?\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*(?:\.\d+)?)?(?:%|x\b|[kKmMbB]\+?|\+)?)/g;
const YEAR_RE = /^(?:19|20)\d\d$/;
const YEAR_RANGE_RE = /^(?:19|20)\d\d[–-](?:19|20)\d\d$/;

/**
 * @param {string} text
 * @returns {string[]}
 */
function numerals(text) {
  /** @type {string[]} */
  const out = [];
  for (const match of String(text || "").matchAll(NUMERAL_RE)) {
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
 */
export function tagDraftMetrics({ draft, ledger }) {
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
      const ok = claimTokens ? claimTokens.includes(token) : ledgerTokens.has(token);
      if (ok) {
        matched += 1;
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
    check(`bullets.${bullet?.claimId || "?"}`, text, [...claimTokens, ...ledgerTokens]);
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
