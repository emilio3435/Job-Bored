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

/**
 * Light stemmer: plural and -ing/-ed endings only, so "podcasts",
 * "podcasting" and "podcast" meet, and "streaming" meets "stream".
 * @param {string} word lower-case token
 */
export function stem(word) {
  let w = String(word || "").toLowerCase().replace(/'s$/, "");
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ch|sh|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && /[^su]s$/.test(w)) w = w.slice(0, -1);
  else if (w.length > 4 && w.endsWith("sses")) w = w.slice(0, -2);
  return w;
}

/**
 * Synonym groups: a job noun and a claim phrase that share a group match
 * even when their words differ ("OTT" vs "CTV", "enablement" vs "training").
 * Phrases are matched on stemmed words, so list them in plain form.
 */
export const SYNONYM_GROUPS = [
  ["ctv", "ott", "connected tv", "ott/ctv", "streaming tv"],
  ["programmatic", "dsp", "ad tech", "adtech", "audience targeting", "trade desk", "dv360", "programmatic display"],
  ["podcast", "podcasting"],
  ["streaming audio", "digital audio", "audio streaming"],
  ["paid social", "social ads", "social advertising", "meta ads"],
  ["sem", "paid search", "search engine marketing", "ppc", "google ads"],
  ["seo", "organic search"],
  ["training", "enablement", "coaching", "coached", "seller enablement", "team development"],
  ["account executive", "ae", "aes", "sellers", "sales reps"],
  ["revenue", "bookings", "quota", "annual book", "digital book"],
  ["analytics", "reporting", "dashboards", "measurement"],
  ["attribution", "attribution modeling", "multi-touch attribution"],
  ["ga4", "google analytics"],
  ["crm", "salesforce", "hubspot"],
  ["integrated campaigns", "multi-platform", "multi-channel", "cross-platform"],
];

/** @param {string} text */
function stemmedWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9+#/']+/)
    .flatMap((w) => (w.includes("/") ? [w, ...w.split("/")] : [w]))
    .map((w) => stem(w.replace(/^'+|'+$/g, "")))
    .filter(Boolean);
}

/** @param {string} phrase */
function phraseKey(phrase) {
  return ` ${stemmedWords(phrase).join(" ")} `;
}

const GROUP_KEYS = SYNONYM_GROUPS.map((group) => group.map(phraseKey));

/**
 * A text's stemmed, space-padded form plus the synonym groups it hits.
 * @param {string} text
 * @returns {{ key: string, groups: Set<number> }}
 */
export function termIndex(text) {
  const key = ` ${stemmedWords(text).join(" ")} `;
  /** @type {Set<number>} */
  const groups = new Set();
  GROUP_KEYS.forEach((keys, i) => {
    if (keys.some((k) => k.trim() && key.includes(k))) groups.add(i);
  });
  return { key, groups };
}

/**
 * True when `term` (a job noun, possibly two words) appears in the indexed
 * text by stemmed phrase or by a shared synonym group.
 * @param {string} term
 * @param {{ key: string, groups: Set<number> }} index
 */
export function termMatches(term, index) {
  const k = phraseKey(term);
  if (!k.trim()) return false;
  if (index.key.includes(k)) return true;
  const own = termIndex(term).groups;
  for (const g of own) if (index.groups.has(g)) return true;
  return false;
}

/** @param {string} text */
function tokens(text) {
  return stemmedWords(text).filter((t) => t.length >= 3 && !SCORE_STOP.has(t));
}

const SCORE_STOP = new Set(
  "the,and,for,with,from,that,this,your,our,are,was,has,have,will,all,its,into,across,over,who,you,can".split(","),
);

/**
 * @param {{ key: string, groups: Set<number> }} claimIndex
 * @param {Array<{ term?: unknown, weight?: unknown }>} nouns
 */
function nounScore(claimIndex, nouns) {
  let hit = 0;
  let total = 0;
  for (const noun of nouns) {
    const term = String(noun.term || "").toLowerCase();
    if (!term) continue;
    const weight = typeof noun.weight === "number" ? noun.weight : 0.5;
    total += weight;
    if (termMatches(term, claimIndex)) hit += weight;
  }
  return total ? hit / total : 0;
}

/**
 * Best token-overlap of the claim against any outcome/differentiator text.
 * @param {Set<string>} claimTokens
 * @param {Array<{ text?: unknown }>} items
 * @param {{ key: string, groups: Set<number> }} [claimIndex]
 */
function coverageScore(claimTokens, items, claimIndex) {
  let best = 0;
  for (const item of items) {
    best = Math.max(best, textCoverage(claimTokens, typeof item.text === "string" ? item.text : "", claimIndex));
  }
  return best;
}

/**
 * Share of an outcome's words the claim carries, plus a bonus per synonym
 * group both texts hit ("AE training" meets "coached 12 AE desks").
 * @param {Set<string>} claimTokens
 * @param {string} text
 * @param {{ key: string, groups: Set<number> }} [claimIndex]
 */
function textCoverage(claimTokens, text, claimIndex) {
  const words = tokens(text);
  if (!words.length) return 0;
  const hits = words.filter((w) => claimTokens.has(w)).length;
  let score = hits / words.length;
  if (claimIndex) {
    const shared = [...termIndex(text).groups].filter((g) => claimIndex.groups.has(g)).length;
    score += 0.25 * shared;
  }
  return Math.min(1, score);
}

/**
 * How well a claim answers one job outcome, 0..1 (used to pick letter
 * proofs per pain point).
 * @param {string} claimText
 * @param {string} outcomeText
 */
export function outcomeCoverage(claimText, outcomeText) {
  return textCoverage(new Set(tokens(claimText)), outcomeText, termIndex(claimText));
}

/**
 * @param {{ end?: unknown } | null} employer
 */
function recencyScore(employer) {
  if (!employer) return 0.7;
  const end = employer.end;
  if (end === null || end === undefined || end === "") return 1.0;
  const year = Number(/(?:19|20)\d\d/.exec(String(end))?.[0]);
  if (!Number.isFinite(year)) return 0.7;
  return year >= 2020 ? 0.8 : 0.6;
}

/**
 * @param {object} input
 * @param {{ nouns?: Array<{ term?: unknown, weight?: unknown }>, outcomes?: Array<{ id?: unknown, text?: unknown }>, differentiators?: Array<{ text?: unknown }> }} input.extract
 * @param {{ employers?: Array<{ id?: unknown, end?: unknown, retired?: unknown }>, claims?: Array<{ id?: unknown, text?: unknown, metrics?: unknown[], verified?: unknown, employerId?: unknown, attribution?: unknown, quarantined?: unknown }> }} input.ledger
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
    if (claim.attribution === "inferred" || claim.quarantined === true) continue;
    if (employers.get(claim.employerId)?.retired === true) continue;
    const claimText = typeof claim.text === "string" ? claim.text : "";
    const claimTokens = new Set(tokens(claimText));
    const claimIndex = termIndex(claimText);
    const noun = nounScore(claimIndex, extract.nouns || []);
    const outcome = coverageScore(claimTokens, extract.outcomes || [], claimIndex);
    const differentiator = coverageScore(claimTokens, extract.differentiators || [], claimIndex);
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
      if (typeof item.id === "string" && coverageScore(claimTokens, [item], claimIndex) > 0.2) {
        mapsTo.push(item.id);
      }
    }
    for (const nounEntry of extract.nouns || []) {
      if (mapsTo.length >= 3) break;
      if (typeof nounEntry.term === "string" && termMatches(nounEntry.term, claimIndex)) {
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
  const selected = scored.slice(0, Math.max(1, limit));
  const represented = new Set(selected.map((item) => (ledger.claims || []).find((claim) => claim.id === item.claimId)?.employerId));
  for (const employer of ledger.employers || []) {
    if (!employer || typeof employer.id !== "string" || employer.retired === true || represented.has(employer.id)) continue;
    const best = scored.find((item) => (ledger.claims || []).find((claim) => claim.id === item.claimId)?.employerId === employer.id);
    if (best) { selected.push(best); represented.add(employer.id); }
  }
  return selected;
}
