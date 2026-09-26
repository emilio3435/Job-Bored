/**
 * Materials v3 — claims.score (plan slice 4, mechanism §6.3).
 *
 * Deterministic arithmetic over the extract + ledger: weighted noun
 * overlap, outcome coverage, differentiator hit, bar clearance, recency,
 * and proof strength. Produces a ranked shortlist (default 8–12);
 * the model selects from it by id and cannot invent a claim.
 */

/**
 * @typedef {object} ClaimScore
 * @property {number} noun
 * @property {number} outcome
 * @property {number} differentiator
 * @property {number} recency
 * @property {number} proof
 * @property {number} total
 */

/**
 * @typedef {object} ShortlistItem
 * @property {string} claimId
 * @property {ClaimScore} score
 * @property {string[]} mapsTo
 */

const WEIGHTS = { noun: 0.35, outcome: 0.25, differentiator: 0.15, recency: 0.1, proof: 0.15 };

/** @param {string} text */
function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 4);
}

/**
 * @param {Set<string>} claimTokens
 * @param {Array<{ term?: unknown, weight?: unknown }>} nouns
 */
function nounScore(claimTokens, nouns) {
  let hit = 0;
  let total = 0;
  for (const noun of nouns) {
    const term = String(noun.term || "").toLowerCase();
    if (!term) continue;
    const weight = typeof noun.weight === "number" ? noun.weight : 0.5;
    total += weight;
    if (claimTokens.has(term)) hit += weight;
  }
  return total ? hit / total : 0;
}

/**
 * Best token-overlap of the claim against any outcome/differentiator text.
 * @param {Set<string>} claimTokens
 * @param {Array<{ text?: unknown }>} items
 */
function coverageScore(claimTokens, items) {
  let best = 0;
  for (const item of items) {
    const words = tokens(typeof item.text === "string" ? item.text : "");
    if (!words.length) continue;
    const hits = words.filter((w) => claimTokens.has(w)).length;
    best = Math.max(best, hits / words.length);
  }
  return best;
}

/**
 * @param {{ end?: unknown } | null} employer
 */
function recencyScore(employer) {
  if (!employer) return 0.7;
  const end = employer.end;
  if (end === null || end === undefined || end === "") return 1.0;
  const year = Number.parseInt(String(end), 10);
  if (!Number.isFinite(year)) return 0.7;
  return year >= 2020 ? 0.8 : 0.6;
}

/**
 * @param {object} input
 * @param {{ nouns?: Array<{ term?: unknown, weight?: unknown }>, outcomes?: Array<{ id?: unknown, text?: unknown }>, differentiators?: Array<{ text?: unknown }> }} input.extract
 * @param {{ employers?: Array<{ id?: unknown, end?: unknown }>, claims?: Array<{ id?: unknown, text?: unknown, metrics?: unknown[], verified?: unknown, employerId?: unknown }> }} input.ledger
 * @param {number} [input.limit]
 * @returns {ShortlistItem[]}
 */
export function scoreClaims({ extract, ledger, limit = 10 }) {
  const employers = new Map(
    (ledger.employers || []).map((e) => [e && e.id, e]),
  );
  /** @type {ShortlistItem[]} */
  const scored = [];
  for (const claim of ledger.claims || []) {
    if (!claim || typeof claim.id !== "string" || !claim.id) continue;
    if (claim.verified !== true) continue;
    const claimTokens = new Set(tokens(typeof claim.text === "string" ? claim.text : ""));
    const noun = nounScore(claimTokens, extract.nouns || []);
    const outcome = coverageScore(claimTokens, extract.outcomes || []);
    const differentiator = coverageScore(claimTokens, extract.differentiators || []);
    const recency = recencyScore(employers.get(claim.employerId) || null);
    const proof = Array.isArray(claim.metrics) && claim.metrics.length ? 1.0 : 0.5;
    const total =
      WEIGHTS.noun * noun +
      WEIGHTS.outcome * outcome +
      WEIGHTS.differentiator * differentiator +
      WEIGHTS.recency * recency +
      WEIGHTS.proof * proof;
    const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;
    /** @type {string[]} */
    const mapsTo = [];
    for (const item of [...(extract.outcomes || [])]) {
      if (typeof item.id === "string" && coverageScore(claimTokens, [item]) > 0.2) {
        mapsTo.push(item.id);
      }
    }
    for (const nounEntry of extract.nouns || []) {
      if (mapsTo.length >= 3) break;
      if (typeof nounEntry.term === "string" && claimTokens.has(nounEntry.term.toLowerCase())) {
        mapsTo.push(nounEntry.term);
      }
    }
    scored.push({
      claimId: claim.id,
      score: {
        noun: round(noun),
        outcome: round(outcome),
        differentiator: round(differentiator),
        recency: round(recency),
        proof,
        total: round(total),
      },
      mapsTo,
    });
  }
  scored.sort((a, b) => b.score.total - a.score.total);
  return scored.slice(0, Math.max(1, limit));
}
