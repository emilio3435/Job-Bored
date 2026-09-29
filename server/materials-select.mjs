/**
 * Materials v3 — claims.select (plan slice 4, mechanism §6.3).
 *
 * Ranked claims are selected deterministically, then hard rules enforce
 * supported IDs, budgets, proof coverage and recorded omissions.
 */

import { isAiClaim, isAiRole } from "./materials-positioning.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { outcomeCoverage } from "./materials-claim-score.mjs";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { planResume, tenureFloorIds } from "./materials-outline.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolvePath(__dirname, "..", "schemas", "materials-selection.v1.schema.json");

export const SELECTION_CONTRACT = "materials.selection.v1";
/* Proof-run design call: up to 14 resume claims (5 for the lead
 * employer, 3-4 for the next two), at least 8 when the ledger has them. */
export const KEPT_MIN = 8;
export const KEPT_MAX = 14;
/* The resume shows at least this many bullets when the ledger has them:
 * kept claims that land in "Earlier" or past an employer's cap do not
 * count, so the floor is checked against the outline's own plan. */
export const BULLET_TARGET = 8;

/** @type {import("ajv").ValidateFunction<unknown> | null} */
let cachedValidator = null;

function loadValidator() {
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const Ajv2020Constructor = /** @type {typeof import("ajv/dist/2020.js").default} */ (
    /** @type {unknown} */ (Ajv2020)
  );
  const addFormatsPlugin = /** @type {typeof import("ajv-formats").default} */ (
    /** @type {unknown} */ (addFormats)
  );
  const ajv = new Ajv2020Constructor({ allErrors: true, strict: false });
  addFormatsPlugin(ajv);
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/** @param {unknown} candidate */
export function validateSelection(candidate) {
  const validate = loadValidator();
  const ok = validate(candidate);
  if (ok) return { ok: true, selection: candidate };
  return {
    ok: false,
    errors: (validate.errors || []).map((e) => ({
      instancePath: e.instancePath || "",
      message: e.message || "validation failed",
    })),
  };
}

/**
 * @param {number[]} letterWords
 */
function selectionBudget(letterWords) {
  return {
    pages: MATERIALS_BUDGETS.resume.pages,
    pagesReason: "one-page target",
    featuredEmployers: MATERIALS_BUDGETS.resume.featuredEmployersMax,
    bulletsPerFeatured: MATERIALS_BUDGETS.resume.bulletsPerFeatured[1],
    earlierLines: 2,
    tokens: MATERIALS_BUDGETS.resume.tokens[1],
    letterWords: [...letterWords],
  };
}

/** @param {string} text */
function factWords(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9$%+]+/)
      .filter((w) => w.length >= 4),
  );
}

/**
 * Two claims state the same fact: most of their words overlap, or they
 * share a metric token and a fair share of words.
 * @param {string} a
 * @param {string} b
 */
export function sameFact(a, b) {
  if (!a || !b) return false;
  const wa = factWords(a);
  const wb = factWords(b);
  if (!wa.size || !wb.size) return false;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  const jaccard = inter / (wa.size + wb.size - inter);
  const nums = (/** @type {string} */ t) => new Set((t.match(/[$#]?\d[\d,.]*[%+MKBmkb]?/g) || []).filter((n) => /\d/.test(n)));
  const na = nums(a);
  const sharedNumber = [...nums(b)].some((n) => na.has(n) && n.replace(/\D/g, "").length >= 2);
  return jaccard >= 0.45 || (sharedNumber && jaccard >= 0.2);
}

/* ------------------------------------------------------------------ *
 * Letter proofs per pain point (K4 / Decision 3)
 * ------------------------------------------------------------------ */

/* What a strong proof sounds like per role family. */
const FAMILY_PROOF_LEXICON = /** @type {Record<string, RegExp>} */ ({
  sales: /\b(revenue|book|quota|bookings|pipeline|clients?|accounts?|ae|aes|desks?|coach\w*|team|pitch\w*|rank\w*|top-?\d|market|sales|sellers?|growth|grew|won|wins|retain\w*|enablement|trained|training)\b|\$\d/gi,
  "customer-success": /\b(retention|renewals?|churn|nps|csat|accounts?|clients?|expansion|onboard\w*|adoption)\b/gi,
  analytics: /\b(analytics|analysis|dashboards?|reporting|sql|models?|modeling|forecast\w*|attribution|data|insights?|measurement|experiments?|looker|tableau|ga4|kpis?|conversion|lift|yoy|roas|cpa|performance)\b/gi,
  engineering: /\b(built|shipped|deployed|platform|systems?|pipelines?|apis?|services?|infrastructure|architect\w*|latency|scale|production|code)\b/gi,
  marketing: /\b(campaigns?|conversion|roas|cpa|brand|audience|seo|sem|paid|leads?|acquisition|funnel|content|engagement)\b/gi,
  product: /\b(launched|shipped|roadmap|users?|adoption|product|features?|retention|discovery)\b/gi,
  design: /\b(design\w*|prototype\w*|research|usability|users?|interface|brand)\b/gi,
  operations: /\b(process\w*|operations|efficiency|cost|workflow\w*|automat\w*|sla|throughput|vendors?)\b/gi,
});

/**
 * 0..1: how much the claim sounds like the family's proof.
 * @param {string} text
 * @param {string} family
 */
function familyFit(text, family) {
  const re = FAMILY_PROOF_LEXICON[family];
  if (!re) return 0;
  const hits = new Set((String(text || "").match(re) || []).map((h) => h.toLowerCase()));
  return Math.min(1, hits.size / 3);
}

/**
 * 0..1: how big the claim's biggest number is. Dollar millions beat a
 * national rank, which beats a percentage, which beats a count.
 * @param {string} text
 */
export function metricStrength(text) {
  const t = String(text || "");
  if (/\$\s?\d[\d,.]*\s?(m|mm|b|bn|million|billion)\b\+?/i.test(t)) return 1;
  if (/\btop[- ]?\d+\b|#\s?\d+\b|\bno\.\s?\d\b|\bnumber one\b/i.test(t)) return 0.8;
  if (/\$\s?\d/.test(t)) return 0.75;
  if (/\d+(\.\d+)?\s?%/.test(t)) return 0.6;
  if (/\b\d[\d,]*\+?\b/.test(t)) return 0.35;
  return 0;
}

/**
 * Pick two letter proofs from the kept claims, each answering a different
 * job pain point (outcome). proof1 leans to the biggest number (writing
 * rule 2); both lean to the role family's kind of evidence.
 * @param {object} input
 * @param {{ outcomes?: Array<{ id?: unknown, text?: unknown, weight?: unknown }>, role?: { family?: unknown } }} input.extract
 * @param {string[]} input.keptIds kept claim ids in rank order
 * @param {(id: string) => string} input.textOf
 * @returns {{ proof1: string, proof2: string, proof1Pain: string, proof2Pain: string }}
 */
export function pickLetterProofs({ extract, keptIds, textOf }) {
  const family = typeof extract.role?.family === "string" ? extract.role.family : "general";
  const pains = (extract.outcomes || [])
    .filter((o) => o && typeof o.id === "string" && typeof o.text === "string")
    .map((o, i) => ({ id: /** @type {string} */ (o.id), text: /** @type {string} */ (o.text), weight: typeof o.weight === "number" ? o.weight : 0.5, i }))
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .slice(0, 3);
  /** @param {string} id @param {{ text: string, weight: number } | null} pain */
  const score = (id, pain) => {
    const text = textOf(id);
    const coverage = pain ? outcomeCoverage(text, pain.text) : 0;
    return coverage * (pain ? 0.6 + 0.4 * pain.weight : 1) + 0.6 * familyFit(text, family) + 0.1 * (1 - keptIds.indexOf(id) / Math.max(1, keptIds.length));
  };
  /* Writing rule 4: each proof carries a metric. When at least two kept
   * claims have a number, only those may be proofs. */
  const withMetric = keptIds.filter((id) => metricStrength(textOf(id)) > 0);
  const candidates = withMetric.length >= 2 ? withMetric : keptIds;
  /** @type {{ id: string, pain: string, s: number } | null} */
  let first = null;
  /* Rule 2: proof1 is the single biggest number; score breaks ties and
   * picks the pain point it answers best. */
  const biggest = Math.max(0, ...candidates.map((id) => metricStrength(textOf(id))));
  for (const id of candidates) {
    if (metricStrength(textOf(id)) < biggest) continue;
    for (const pain of pains.length ? pains : [null]) {
      const s = score(id, pain);
      if (!first || s > first.s) first = { id, pain: pain ? pain.id : "", s };
    }
  }
  /** @type {{ id: string, pain: string, s: number } | null} */
  let second = null;
  for (const id of candidates) {
    if (first && id === first.id && candidates.length > 1) continue;
    const otherPains = pains.filter((p) => !first || p.id !== first.pain);
    for (const pain of otherPains.length ? otherPains : pains.length ? pains : [null]) {
      const s = score(id, pain) + 0.25 * metricStrength(textOf(id));
      if (!second || s > second.s) second = { id, pain: pain ? pain.id : "", s };
    }
  }
  const proof1 = first ? first.id : "";
  const proof2 = second ? second.id : proof1;
  /* Assign the pain points jointly: the two distinct outcomes the two
   * proofs answer best together. */
  let proof1Pain = first ? first.pain : "";
  let proof2Pain = second ? second.pain : "";
  if (proof1 && proof2 && pains.length >= 2) {
    let best = -Infinity;
    for (const a of pains) {
      for (const b of pains) {
        if (a.id === b.id) continue;
        const total = outcomeCoverage(textOf(proof1), a.text) + outcomeCoverage(textOf(proof2), b.text);
        if (total > best) {
          best = total;
          proof1Pain = a.id;
          proof2Pain = b.id;
        }
      }
    }
  }
  return { proof1, proof1Pain, proof2, proof2Pain };
}

/**
 * @param {object} input
 * @param {{ jdHash?: unknown, role?: { title?: unknown, company?: unknown, family?: unknown, seniority?: unknown }, outcomes?: Array<{ id?: unknown, text?: unknown, weight?: unknown }>, differentiators?: Array<{ text?: unknown }>, nouns?: Array<{ term?: unknown }> }} input.extract
 * @param {Array<{ claimId: string, score?: { total?: number }, mapsTo?: string[] }>} input.shortlist
 * @param {{ ledgerHash?: unknown, employers?: Array<{ id?: unknown }>, claims?: Array<{ id?: unknown, employerId?: unknown, text?: unknown }> }} input.ledger
 * @param {number[]} [input.letterWords]
 */
export async function selectClaims({ extract, shortlist, ledger, letterWords = [120, 200] }) {
  return { selection: selectRankedClaims({ extract, shortlist, ledger, letterWords }), degraded: false };
}

/**
 * Post-call hard rules: unknown ids out, budgets enforced, proofs from
 * kept, every omission recorded.
 * @param {object} input
 * @param {{ jdHash?: unknown, role?: { title?: unknown, company?: unknown, family?: unknown, seniority?: unknown }, outcomes?: Array<{ id?: unknown, text?: unknown, weight?: unknown }>, differentiators?: Array<{ text?: unknown }>, nouns?: Array<{ term?: unknown }> }} input.extract
 * @param {Array<{ claimId: string, score?: { total?: number }, mapsTo?: string[] }>} input.shortlist
 * @param {{ ledgerHash?: unknown, employers?: Array<{ id?: unknown }>, claims?: Array<{ id?: unknown, employerId?: unknown, text?: unknown }> }} input.ledger
 * @param {number[]} input.letterWords
 * @param {Record<string, unknown>} input.picked
 * @param {Set<string>} input.shortIds
 * @param {(id: string) => string} input.employerOf
 */
function enforceRules({ extract, shortlist, ledger, letterWords, picked, shortIds, employerOf }) {
  const rankOf = new Map(shortlist.map((s, i) => [s.claimId, i]));
  /** @type {Array<{ claimId: string, slot: string, reason: string }>} */
  const wanted = Array.isArray(picked.kept) ? picked.kept : [];
  /** @type {Array<{ claimId: string, slot: string, reason: string, rank: number }>} */
  const kept = [];
  /** @type {Array<{ claimId: string, code: string, reason: string }>} */
  const dropped = [];
  const seen = new Set();
  for (const entry of wanted) {
    const id = entry && typeof entry === "object" ? entry.claimId : "";
    if (typeof id !== "string" || !shortIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push({
      claimId: id,
      slot: typeof entry.slot === "string" && entry.slot ? entry.slot : `resume.featured.pick.b${kept.length + 1}`,
      reason: typeof entry.reason === "string" && entry.reason ? entry.reason.slice(0, 300) : "selected from shortlist",
      rank: rankOf.get(id) ?? shortlist.length,
    });
  }
  kept.sort((a, b) => a.rank - b.rank);

  const claimsById = new Map((ledger.claims || []).map((c) => [c && c.id, c]));
  const textOfClaim = (/** @type {string} */ id) => {
    const claim = claimsById.get(id);
    return claim && typeof claim.text === "string" ? claim.text : "";
  };
  const hasRole = (/** @type {string} */ id) => {
    const claim = /** @type {{ roleId?: unknown } | undefined} */ (claimsById.get(id));
    return Boolean(claim && typeof claim.roleId === "string" && claim.roleId);
  };

  /* Near-duplicates (a profile strength restating a resume line) keep
   * one copy: the resume line, which knows its role, else the higher rank. */
  /** @type {typeof kept} */
  const deduped = [];
  for (const k of kept) {
    const twin = deduped.findIndex((d) => sameFact(textOfClaim(d.claimId), textOfClaim(k.claimId)));
    if (twin === -1) {
      deduped.push(k);
      continue;
    }
    const other = deduped[twin];
    if (!hasRole(other.claimId) && hasRole(k.claimId)) {
      dropped.push({ claimId: other.claimId, code: "duplicate_signal", reason: `restates ${k.claimId}` });
      deduped[twin] = { ...k, rank: Math.min(k.rank, other.rank) };
    } else {
      dropped.push({ claimId: k.claimId, code: "duplicate_signal", reason: `restates ${other.claimId}` });
    }
  }
  deduped.sort((a, b) => a.rank - b.rank);
  const isDuplicateOfKept = (/** @type {string} */ id, /** @type {typeof kept} */ list) =>
    list.some((k) => sameFact(textOfClaim(k.claimId), textOfClaim(id)));

  /* Cap employers at 3: drop the lowest-ranked employer's claims. */
  /** @type {string[]} */
  const employersInOrder = [];
  for (const k of deduped) {
    const employer = employerOf(k.claimId);
    if (employer && !employersInOrder.includes(employer)) employersInOrder.push(employer);
  }
  const allowedEmployers = new Set(employersInOrder.slice(0, MATERIALS_BUDGETS.resume.featuredEmployersMax));
  const overEmployers = deduped.filter((k) => employerOf(k.claimId) && !allowedEmployers.has(employerOf(k.claimId)));
  for (const k of overEmployers) {
    dropped.push({ claimId: k.claimId, code: "budget", reason: "fourth featured employer does not fit one page" });
  }
  let finalKept = deduped.filter((k) => !overEmployers.includes(k));

  /** @param {{ claimId: string }} s @param {string} reason */
  const backfill = (s, reason) => {
    finalKept.push({
      claimId: s.claimId,
      slot: `resume.featured.pick.b${finalKept.length + 1}`,
      reason,
      rank: rankOf.get(s.claimId) ?? shortlist.length,
    });
  };
  const usable = (/** @type {{ claimId: string }} */ s) =>
    !finalKept.some((k) => k.claimId === s.claimId) &&
    !dropped.some((d) => d.claimId === s.claimId && d.code === "duplicate_signal") &&
    !isDuplicateOfKept(s.claimId, finalKept) &&
    (!employerOf(s.claimId) || allowedEmployers.size < MATERIALS_BUDGETS.resume.featuredEmployersMax || allowedEmployers.has(employerOf(s.claimId)));

  /* Two employers at least when the shortlist has a second one: the most
   * recent other employer that scored joins with up to 3 claims. */
  const keptEmployers = () => new Set(finalKept.map((k) => employerOf(k.claimId)).filter(Boolean));
  if (keptEmployers().size < 2) {
    const current = keptEmployers();
    const candidates = shortlist.filter((s) => employerOf(s.claimId) && !current.has(employerOf(s.claimId)));
    const second = candidates.length ? employerOf(candidates[0].claimId) : "";
    if (second) {
      allowedEmployers.add(second);
      for (const s of candidates.filter((c) => employerOf(c.claimId) === second).slice(0, 3)) {
        if (!usable(s)) continue;
        if (finalKept.length >= KEPT_MAX) {
          const weakest = [...finalKept].reverse().find((k) => employerOf(k.claimId) !== second);
          if (!weakest) break;
          finalKept = finalKept.filter((k) => k !== weakest);
          dropped.push({ claimId: weakest.claimId, code: "budget", reason: "made room for a second featured employer" });
        }
        backfill(s, "second featured employer");
      }
    }
  }

  /* Cap kept at KEPT_MAX (lowest rank goes), floor at KEPT_MIN from the shortlist. */
  finalKept.sort((a, b) => a.rank - b.rank);
  if (finalKept.length > KEPT_MAX) {
    const cut = finalKept.slice(KEPT_MAX);
    for (const k of cut) {
      dropped.push({ claimId: k.claimId, code: "budget", reason: `over the ${KEPT_MAX}-bullet page budget` });
    }
    finalKept = finalKept.slice(0, KEPT_MAX);
  }
  if (finalKept.length < KEPT_MIN) {
    for (const s of shortlist) {
      if (finalKept.length >= KEPT_MIN) break;
      if (!usable(s)) continue;
      if (employerOf(s.claimId)) allowedEmployers.add(employerOf(s.claimId));
      backfill(s, `shortlist backfill to the ${KEPT_MIN}-bullet floor`);
    }
    finalKept.sort((a, b) => a.rank - b.rank);
  }

  /* Bullet floor: plan the page the way the outline will, and while it
   * shows fewer than BULLET_TARGET bullets, add the best unused shortlist
   * claim (numbers first) that actually adds a bullet. A claim the model
   * dropped for budget is fair game; a duplicate never is. */
  const planned = (/** @type {typeof finalKept} */ list) =>
    planResume({
      ledger,
      kept: list.map((k) => k.claimId),
      featuredMax: MATERIALS_BUDGETS.resume.featuredEmployersMax,
      perFeaturedMax: MATERIALS_BUDGETS.resume.bulletsPerFeatured[1],
      earlierMax: 2,
    }).featured.reduce((n, f) => n + f.claimIds.length, 0);
  let bullets = planned(finalKept);
  if (bullets < BULLET_TARGET) {
    const metricOf = (/** @type {string} */ id) => {
      const claim = /** @type {{ metrics?: unknown } | undefined} */ (claimsById.get(id));
      return claim && Array.isArray(claim.metrics) && claim.metrics.length ? 1 : 0;
    };
    const candidates = [...shortlist].sort(
      (a, b) => metricOf(b.claimId) - metricOf(a.claimId) || (rankOf.get(a.claimId) ?? 0) - (rankOf.get(b.claimId) ?? 0),
    );
    for (const s of candidates) {
      if (bullets >= BULLET_TARGET || finalKept.length >= KEPT_MAX) break;
      if (!usable(s)) continue;
      const trial = [...finalKept, { claimId: s.claimId, slot: "", reason: "", rank: rankOf.get(s.claimId) ?? shortlist.length }]
        .sort((a, b) => a.rank - b.rank);
      const next = planned(trial);
      if (next <= bullets) continue;
      if (employerOf(s.claimId)) allowedEmployers.add(employerOf(s.claimId));
      backfill(s, `backfill to the ${BULLET_TARGET}-bullet floor`);
      finalKept.sort((a, b) => a.rank - b.rank);
      bullets = next;
    }
    /* A claim now kept is no longer an omission. */
    const nowKept = new Set(finalKept.map((k) => k.claimId));
    for (let i = dropped.length - 1; i >= 0; i -= 1) if (nowKept.has(dropped[i].claimId)) dropped.splice(i, 1);
  }

  /* Record every shortlist omission the model did not already record. */
  const keptIds = new Set(finalKept.map((k) => k.claimId));
  const recordedDrops = new Set(dropped.map((d) => d.claimId));
  if (Array.isArray(picked.dropped)) {
    for (const entry of picked.dropped) {
      if (!entry || typeof entry !== "object") continue;
      const id = entry.claimId;
      if (typeof id !== "string" || keptIds.has(id) || recordedDrops.has(id)) continue;
      const code = ["no_jd_mapping", "low_signal", "duplicate_signal", "budget", "unverified"].includes(entry.code)
        ? entry.code
        : "low_signal";
      dropped.push({
        claimId: id,
        code,
        reason: typeof entry.reason === "string" && entry.reason ? entry.reason.slice(0, 300) : "not selected",
      });
      recordedDrops.add(id);
    }
  }
  for (const s of shortlist) {
    if (keptIds.has(s.claimId) || recordedDrops.has(s.claimId)) continue;
    dropped.push({ claimId: s.claimId, code: "budget", reason: "outside the kept set" });
  }

  /* Letter proofs must be kept ids answering known outcomes; anything
   * missing or invalid is repaired by the deterministic pain-point pick. */
  const letter = /** @type {Record<string, unknown>} */ (
    picked.letter && typeof picked.letter === "object" ? picked.letter : {}
  );
  const textOf = textOfClaim;
  const keptList = finalKept.map((k) => k.claimId);
  const auto = pickLetterProofs({ extract, keptIds: keptList, textOf });
  /* The three heaviest outcomes are the letter's pain points. */
  const top3 = (extract.outcomes || [])
    .filter((o) => o && typeof o.id === "string" && typeof o.text === "string")
    .map((o, i) => ({ id: /** @type {string} */ (o.id), text: /** @type {string} */ (o.text), weight: typeof o.weight === "number" ? o.weight : 0.5, i }))
    .sort((x, y) => y.weight - x.weight || x.i - y.i)
    .slice(0, 3);
  const painIds = new Set(top3.map((o) => o.id));
  const family = typeof extract.role?.family === "string" ? extract.role.family : "general";
  const withNumber = keptList.filter((id) => metricStrength(textOf(id)) > 0);
  /* Design call 3: a proof carries a metric whenever two kept claims do. */
  const metricRule = withNumber.length >= 2;
  const proofOk = (/** @type {string} */ id) => keptIds.has(id) && (!metricRule || metricStrength(textOf(id)) > 0);
  /** @param {string} painId @param {string[]} exclude */
  const bestFor = (painId, exclude) => {
    const pain = top3.find((o) => o.id === painId);
    let best = "";
    let bestScore = -Infinity;
    for (const id of metricRule ? withNumber : keptList) {
      if (exclude.includes(id)) continue;
      const text = textOf(id);
      const score = (pain ? outcomeCoverage(text, pain.text) : 0) + 0.6 * familyFit(text, family) + 0.5 * metricStrength(text);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  };
  /** @param {unknown} entry */
  const proofOf = (entry) => {
    if (typeof entry === "string") return { claimId: entry, painId: "" };
    if (entry && typeof entry === "object") {
      const e = /** @type {Record<string, unknown>} */ (entry);
      return {
        claimId: typeof e.claimId === "string" ? e.claimId : "",
        painId: typeof e.painId === "string" ? e.painId : "",
      };
    }
    return { claimId: "", painId: "" };
  };
  const m1 = proofOf(letter.proof1 ?? letter.analyticsProof);
  const m2 = proofOf(letter.proof2 ?? letter.aiOpsProof);
  const proof1Pain = painIds.has(m1.painId) ? m1.painId : auto.proof1Pain;
  let proof1 = proofOk(m1.claimId) ? m1.claimId : proofOk(auto.proof1) && auto.proof1Pain === proof1Pain ? auto.proof1 : bestFor(proof1Pain, []) || auto.proof1;
  let proof2Pain = painIds.has(m2.painId) && m2.painId !== proof1Pain ? m2.painId : auto.proof2Pain !== proof1Pain ? auto.proof2Pain : "";
  if (!proof2Pain) proof2Pain = top3.find((o) => o.id !== proof1Pain)?.id || "";
  const proof2 = proofOk(m2.claimId) && m2.claimId !== proof1
    ? m2.claimId
    : bestFor(proof2Pain, [proof1]) || finalKept.find((k) => k.claimId !== proof1)?.claimId || proof1;
  /* Voice v4.1: an AI role leads with an AI-builder claim when the
   * ledger has one (with a number, when proofs need numbers). */
  if (isAiRole(extract) && !isAiClaim(textOf(proof1)) && !isAiClaim(textOf(proof2))) {
    const aiKept = (metricRule ? withNumber : keptList).filter((id) => isAiClaim(textOf(id)) && id !== proof2);
    const pain = top3.find((o) => o.id === proof1Pain);
    const best = aiKept
      .map((id) => ({ id, s: (pain ? outcomeCoverage(textOf(id), pain.text) : 0) + 0.5 * metricStrength(textOf(id)) }))
      .sort((a, b) => b.s - a.s)[0];
    if (best) proof1 = best.id;
  }
  const letterOut = { proof1, proof2, proof1Pain, proof2Pain };

  const rawTransfers = /** @type {Array<Record<string, unknown>>} */ (
    Array.isArray(picked.transfers) ? picked.transfers : []
  );
  const transfers = rawTransfers
    .filter((t) => t && typeof t === "object" && typeof t.to === "string" && t.to)
    .map((t, i) => ({
      id: typeof t.id === "string" && t.id ? t.id : `t${i + 1}`,
      from: Array.isArray(t.from) ? t.from.filter((/** @type {unknown} */ f) => typeof f === "string") : [],
      to: String(t.to).slice(0, 120),
      allowed: "prose-only",
      ...(typeof t.note === "string" && t.note ? { note: t.note.slice(0, 300) } : {}),
    }));

  /* RESJ Q4: which kept claims prove each outcome, and why the rest went. */
  const keptMaps = finalKept.map((k) => ({
    claimId: k.claimId,
    mapsTo: shortlist.find((s) => s.claimId === k.claimId)?.mapsTo || [],
  }));
  const coverage = (extract.outcomes || [])
    .filter((o) => o && typeof o.id === "string")
    .map((o) => {
      const id = /** @type {string} */ (o.id);
      const claimIds = keptMaps.filter((k) => k.mapsTo.includes(id)).map((k) => k.claimId);
      const letterProofs = [letterOut.proof1Pain === id ? letterOut.proof1 : "", letterOut.proof2Pain === id ? letterOut.proof2 : ""].filter(Boolean);
      return { outcomeId: id, claimIds, ...(letterProofs.length ? { letterProofs } : {}) };
    });
  /** @type {Record<string, number>} */
  const dropTally = {};
  for (const d of dropped) dropTally[d.code] = (dropTally[d.code] || 0) + 1;

  return {
    contract: SELECTION_CONTRACT,
    jdHash: typeof extract.jdHash === "string" ? extract.jdHash : "sha256:0",
    ledgerHash: typeof ledger.ledgerHash === "string" ? ledger.ledgerHash : "sha256:0",
    budget: selectionBudget(letterWords),
    coverage,
    dropTally,
    kept: finalKept.map(({ claimId, slot, reason }, i) => {
      const short = shortlist.find((s) => s.claimId === claimId);
      return {
        claimId,
        rank: i + 1,
        slot,
        score: short?.score || { noun: 0, outcome: 0, differentiator: 0, recency: 0, proof: 0, total: 0 },
        mapsTo: short?.mapsTo || [],
        reason,
      };
    }),
    dropped,
    omittedEmployers: omittedEmployers({ ledger, finalKept, employerOf }),
    transfers,
    letter: letterOut,
  };
}

/**
 * Employers with ledger claims that this run does not feature. Every one
 * is recorded with a reason, which is what makes omission legal.
 * @param {object} input
 * @param {{ employers?: Array<{ id?: unknown, retired?:unknown, start?:unknown, end?:unknown }> }} input.ledger
 * @param {Array<{ claimId: string }>} input.finalKept
 * @param {(id: string) => string} input.employerOf
 */
function omittedEmployers({ ledger, finalKept, employerOf }) {
  const featured = new Set(finalKept.map((k) => employerOf(k.claimId)).filter(Boolean));
  const floor = tenureFloorIds(ledger);
  return (ledger.employers || [])
    .filter((e) => e && typeof e.id === "string" && !featured.has(e.id) && !floor.has(e.id))
    .map((e) => ({
      employerId: e.id,
      reason: e.retired ? "user_retired" : "low_relevance",
      justified: true,
    }));
}

/**
 * Deterministic fallback: top shortlist ranks with recorded reasons.
 * @param {object} input
 * @param {{ jdHash?: unknown, role?: { title?: unknown, company?: unknown, family?: unknown, seniority?: unknown }, outcomes?: Array<{ id?: unknown, text?: unknown, weight?: unknown }>, differentiators?: Array<{ text?: unknown }>, nouns?: Array<{ term?: unknown }> }} input.extract
 * @param {Array<{ claimId: string, score?: { total?: number }, mapsTo?: string[] }>} input.shortlist
 * @param {{ ledgerHash?: unknown, claims?: Array<{ id?: unknown, employerId?: unknown }> }} input.ledger
 * @param {number[]} input.letterWords
 */
export function selectRankedClaims({ extract, shortlist, ledger, letterWords = [120, 200] }) {
  const picked = {
    kept: shortlist.slice(0, KEPT_MAX).map((s, i) => ({
      claimId: s.claimId,
      slot: `resume.featured.pick.b${i + 1}`,
      reason: `relevance rank ${i + 1}`,
    })),
    dropped: [],
    transfers: [],
    /* Empty: enforceRules picks the proofs per pain point. */
    letter: {},
  };
  const shortIds = new Set(shortlist.map((s) => s.claimId));
  const claims = new Map((ledger.claims || []).map((c) => [c && c.id, c]));
  const employerOf = (/** @type {string} */ id) => {
    const claim = claims.get(id);
    return claim && typeof claim.employerId === "string" ? claim.employerId : "";
  };
  return enforceRules({ extract, shortlist, ledger, letterWords, picked, shortIds, employerOf });
}
