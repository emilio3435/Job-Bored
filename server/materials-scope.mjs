/**
 * Materials — scope and scale guard (review defect 5).
 *
 * A draft may reword a claim, but it may not upgrade it: "strategic Austin
 * accounts" must not become "enterprise accounts", and "an SEM forecast
 * tool on Gemini" must not become "engineering production forecasting
 * models on GCP". This module finds the upgrade words (scope, scale,
 * seniority, team size, tech depth, development framing) a sentence uses
 * that its source does not.
 *
 * A word is licensed only when one source states it next to what the
 * sentence says it about: the source must contain the word (or its family)
 * and the nearest content word on either side of it in the sentence. That is
 * what stops two true claims ("a production AI platform", "a forecast
 * tool") from licensing a merged false one ("production forecasting
 * models").
 *
 * Deterministic; no model call. The support check's prompt carries the
 * same rule for the meaning-level pass.
 */

import { stem } from "./materials-claim-score.mjs";

/**
 * @typedef {object} ScopeTerm
 * @property {string} id
 * @property {string} label what the reader is told
 * @property {RegExp} re the word in a draft sentence (global)
 * @property {RegExp} family the same word, or its family, in a source
 */

/** @type {ScopeTerm[]} */
export const SCOPE_TERMS = [
  { id: "enterprise", label: "scope", re: /\benterprise\b/gi, family: /\benterprise\b/i },
  { id: "global", label: "scope", re: /\b(?:global(?:ly)?|worldwide|international(?:ly)?|multinational)\b/gi, family: /\b(?:global|worldwide|international|multinational)/i },
  { id: "company-wide", label: "scope", re: /\b(?:company|org|organization|enterprise)-wide\b/gi, family: /\b(?:company|org|organization|enterprise)-wide\b/i },
  { id: "at-scale", label: "scale", re: /\b(?:at scale|large-scale|massive)\b/gi, family: /\b(?:at scale|large-scale|massive)\b/i },
  { id: "fortune", label: "scale", re: /\bfortune\s?(?:10|50|100|500|1000)\b/gi, family: /\bfortune\s?\d+/i },
  { id: "mass-count", label: "scale", re: /\b(?:thousands|millions|billions) of\b/gi, family: /\b(?:thousands|millions|billions)\b/i },
  { id: "seniority", label: "seniority", re: /\b(?:executive|c-suite|c-level|vice president|head of|chief)\b/gi, family: /\b(?:executive|c-suite|c-level|vice president|head of|chief)\b/i },
  { id: "team-size", label: "team size", re: /\b(?:team of \d+|\d+-person|headcount|direct reports?|department|division)\b/gi, family: /\b(?:team of \d+|\d+-person|headcount|direct reports?|department|division)\b/i },
  { id: "production", label: "tech depth", re: /\bproduction(?:-grade)?\b/gi, family: /\bproduction\b/i },
  { id: "engineering", label: "tech depth", re: /\bengineer(?:ing|ed|s)?\b/gi, family: /\bengineer/i },
  { id: "models", label: "tech depth", re: /\b(?:machine[- ]learning|deep[- ]learning|ML|neural|models?|modeling)\b/g, family: /\b(?:machine[- ]learning|deep[- ]learning|ML|neural|model|models|modeling)\b/i },
  { id: "development", label: "framing", re: /\b(?:seller|talent|people|team|leadership) development\b/gi, family: /\b(?:seller|talent|people|team|leadership) development\b|\bdevelop(?:ed|ing)? (?:sellers|talent|people|the team|leaders)\b/i },
];

const STOP = new Set(
  ("the,a,an,and,or,but,for,with,from,that,this,these,those,your,you,our,we,are,was,were,has,have,had,will,would,should,could," +
    "can,may,not,no,if,then,than,into,over,under,about,across,through,during,before,after,both,each,other,such,only,also,just," +
    "very,more,most,many,much,some,any,all,per,via,including,while,where,which,who,whom,whose,its,it,their,them,they,i,me,my," +
    "as,at,by,in,of,on,to,up,out,is,be,been,being,do,did,done,so,too,here,there,when,what,how,want,bring,like,help,use,used")
    .split(","),
);

/**
 * Content-word stems of a text, in order, with their character offsets.
 * @param {string} text
 * @returns {Array<{ stem: string, start: number, end: number }>}
 */
function contentWords(text) {
  /** @type {Array<{ stem: string, start: number, end: number }>} */
  const out = [];
  for (const m of String(text || "").matchAll(/[A-Za-z0-9$#%+][A-Za-z0-9$#%+'’/-]*/g)) {
    const raw = m[0].toLowerCase().replace(/[’']s$/, "").replace(/[’']/g, "");
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.push({ stem: stem(raw), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/** @param {string} text */
function stemSet(text) {
  return new Set(contentWords(text).map((w) => w.stem));
}

/**
 * The upgrade words a sentence uses that no source states next to what
 * the sentence says it about.
 * @param {string} sentence a draft sentence, bullet or statement
 * @param {string[]} sources claim texts (and voice facts, employer lines)
 * @param {{ attributed?: boolean }} [options] attributed: the sentence
 *   restates exactly these sources (a bullet and its own claim), so the
 *   word only has to appear in them, not beside the same neighbor
 * @returns {Array<{ id: string, label: string, word: string }>}
 */
export function scopeUpgrades(sentence, sources, options = {}) {
  const text = String(sentence || "");
  const units = sources.filter((s) => typeof s === "string" && s.trim()).map((s) => ({ text: s, stems: stemSet(s) }));
  /** @type {Array<{ id: string, label: string, word: string, start: number, end: number }>} */
  const hits = [];
  for (const term of SCOPE_TERMS) {
    for (const m of text.matchAll(term.re)) {
      hits.push({ id: term.id, label: term.label, word: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
  }
  if (!hits.length) return [];
  const words = contentWords(text);
  const inHit = (/** @type {{ start: number, end: number }} */ w) => hits.some((h) => w.start < h.end && w.end > h.start);
  /** @type {Array<{ id: string, label: string, word: string }>} */
  const out = [];
  for (const hit of hits) {
    const term = /** @type {ScopeTerm} */ (SCOPE_TERMS.find((t) => t.id === hit.id));
    /* The nearest content word on each side of the upgrade word, skipping
     * other upgrade words: what the word is said about. */
    const at = words.findIndex((w) => w.end > hit.start);
    const before = words.slice(0, at < 0 ? words.length : at).filter((w) => !inHit(w)).slice(-1);
    const after = words.slice(at < 0 ? words.length : at).filter((w) => !inHit(w)).slice(0, 1);
    const neighbors = [...before, ...after].map((w) => w.stem);
    const licensed = units.some(
      (u) => term.family.test(u.text) && (options.attributed || !neighbors.length || neighbors.some((n) => u.stems.has(n))),
    );
    if (!licensed && !out.some((o) => o.id === hit.id)) out.push({ id: hit.id, label: hit.label, word: hit.word });
  }
  return out;
}

/**
 * Resume slots that upgrade their source: each bullet against its own
 * claim (and employer line), each earlier line against its claim, and the
 * statement against every claim and approved voice fact.
 * @param {object} input
 * @param {{ statement?: unknown, bullets?: Array<{ claimId?: unknown, text?: unknown }>, earlier?: Array<{ claimId?: unknown, text?: unknown }> }} input.draft
 * @param {{ claims?: Array<{ id?: unknown, text?: unknown, employerId?: unknown }>, employers?: Array<{ id?: unknown, name?: unknown, title?: unknown }> }} input.ledger
 * @returns {Array<{ field: string, text: string, upgrades: Array<{ id: string, label: string, word: string }> }>}
 */
export function resumeScopeUpgrades({ draft, ledger }) {
  const claims = new Map((ledger.claims || []).filter((c) => c && typeof c.id === "string").map((c) => [c.id, c]));
  const employers = new Map((ledger.employers || []).filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));
  const employerLine = (/** @type {unknown} */ id) => {
    const e = typeof id === "string" ? employers.get(id) : undefined;
    return e ? [e.name, e.title].filter((v) => typeof v === "string").join(" · ") : "";
  };
  const allSources = [
    ...[...claims.values()].map((c) => (typeof c.text === "string" ? c.text : "")),
    ...[...employers.values()].map((e) => [e.name, e.title].filter((v) => typeof v === "string").join(" · ")),
  ];
  /** @type {Array<{ field: string, text: string, upgrades: Array<{ id: string, label: string, word: string }> }>} */
  const out = [];
  const check = (/** @type {string} */ field, /** @type {unknown} */ text, /** @type {string[]} */ sources, attributed = false) => {
    if (typeof text !== "string" || !text.trim()) return;
    const upgrades = scopeUpgrades(text, sources, { attributed });
    if (upgrades.length) out.push({ field, text, upgrades });
  };
  check("statement", draft.statement, allSources);
  for (const [kind, list] of /** @type {Array<[string, unknown]>} */ ([["bullet", draft.bullets], ["earlier", draft.earlier]])) {
    for (const slot of Array.isArray(list) ? list : []) {
      if (!slot || typeof slot !== "object") continue;
      const claim = typeof slot.claimId === "string" ? claims.get(slot.claimId) : undefined;
      /* A slot with no claim (should not happen) is held to every source. */
      const sources = claim
        ? [typeof claim.text === "string" ? claim.text : "", employerLine(claim.employerId)]
        : allSources;
      check(`${kind}:${typeof slot.claimId === "string" ? slot.claimId : "?"}`, slot.text, sources, Boolean(claim));
    }
  }
  return out;
}

/**
 * One line naming the upgrade words, for QA notes and repair instructions.
 * @param {Array<{ label: string, word: string }>} upgrades
 */
export function describeUpgrades(upgrades) {
  return upgrades.map((u) => `"${u.word}" (${u.label})`).join(", ");
}
