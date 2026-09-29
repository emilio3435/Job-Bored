/**
 * Materials v3 — outline (plan slice 4, mechanism §6.3–6.4).
 *
 * Deterministic: selection + budgets become the drafting plan — which
 * employers are featured, which claims fill them, which become earlier
 * lines, the tools line (ledger-evidenced tools only), and the letter
 * beat assignment. No model call.
 */

import { termIndex, termMatches } from "./materials-claim-score.mjs";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { claimById } from "./materials-ledger.mjs";

/**
 * @typedef {object} Outline
 * @property {FeaturedEmployer[]} featured
 * @property {string[]} earlier
 * @property {string[]} toolsLine
 * @property {LetterBeats | null} letterBeats
 * @property {{ claimId: string, reason: "page_budget" }[]} dropped kept claims the page budget left out (P-15)
 * @property {{ selected: number, featured: number, earlier: number, pageBudgetExcluded: number }} [selectionSummary] count-only accounting for selected resume claims
 */

/**
 * A featured employer: its bullets in reading order and, when the company
 * held several dated roles, one sub-row per role with that role's bullets.
 * @typedef {object} FeaturedEmployer
 * @property {string} employerId
 * @property {string[]} claimIds
 * @property {{ roleId: string, title: string, start: string | null, end: string | null, claimIds: string[] }[]} [roles]
 */

/**
 * Role-typed letter beats (K4): hook, company insight, two proofs each
 * answering one job pain point, and a concrete ask. hook, companyInsight
 * and ask are written by the draft stage; the plan names what they draw on.
 * @typedef {object} LetterBeats
 * @property {string} hook          outcome id the hook ties the company to
 * @property {string} companyInsight outcome id the insight names
 * @property {string} proof1        kept claim id, biggest number first
 * @property {string} proof1Pain    outcome id proof1 answers
 * @property {string} proof2        kept claim id
 * @property {string} proof2Pain    outcome id proof2 answers
 * @property {string} ask           reserved: the concrete next step (drafted)
 */

/**
 * @param {object} input
 * @param {{ kept?: Array<{ claimId?: unknown }>, letter?: { proof1?: unknown, proof2?: unknown, proof1Pain?: unknown, proof2Pain?: unknown, analyticsProof?: unknown, aiOpsProof?: unknown }, budget?: { featuredEmployers?: unknown, bulletsPerFeatured?: unknown, earlierLines?: unknown, tokens?: unknown } }} input.selection
 * @param {{ claims?: Array<{ id?: unknown, employerId?: unknown, tools?: unknown[] }>, toolInventory?: Array<{ tool?: unknown, level?: unknown }> }} input.ledger
 * @param {string} input.feature
 * @param {{ nouns?: Array<{ term?: unknown, weight?: unknown }>, outcomes?: Array<{ id?: unknown, weight?: unknown }>, stack?: { required?: unknown[], preferred?: unknown[] } }} [input.extract]
 *   job nouns rank the skills line (K5); without it, kept-claim order
 * @returns {Outline}
 */
export function buildOutline({ selection, ledger, feature, extract }) {
  const resumeRequested = feature !== "cover_letter";
  const kept = resumeRequested
    ? selectedResumeIds(selection, ledger)
    : (selection.kept || []).map((/** @type {{ claimId?: unknown }} */ k) => (k && typeof k.claimId === "string" ? k.claimId : "")).filter(Boolean);
  const budget = selection.budget || {};
  const featuredMax =
    typeof budget.featuredEmployers === "number"
      ? budget.featuredEmployers
      : MATERIALS_BUDGETS.resume.featuredEmployers;
  const perFeatured =
    typeof budget.bulletsPerFeatured === "number" ? budget.bulletsPerFeatured : MATERIALS_BUDGETS.resume.bulletsPerFeatured[1];
  const earlierMax =
    typeof budget.earlierLines === "number" ? budget.earlierLines : 2;
  const tokensMax =
    typeof budget.tokens === "number" ? budget.tokens : MATERIALS_BUDGETS.resume.tokens[1];

  /** @type {Outline} */
  const outline = { featured: [], earlier: [], toolsLine: [], letterBeats: null, dropped: [] };

  if (resumeRequested) {
    const plan = planResume({ ledger, kept, featuredMax, perFeaturedMax: perFeatured, earlierMax });
    outline.featured = plan.featured;
    outline.earlier = plan.earlier;
    outline.dropped = plan.dropped;
    outline.selectionSummary = summarizeSelectedResume(kept, plan);

    outline.toolsLine = skillsLine({ ledger, kept, extract, max: tokensMax });
  }

  if (feature !== "resume") {
    const letter = selection.letter || {};
    const id = (/** @type {unknown} */ v) => (typeof v === "string" ? v : "");
    const proof1 = id(letter.proof1) || id(letter.analyticsProof) || kept[0] || "";
    const proof2 = id(letter.proof2) || id(letter.aiOpsProof) || kept.find((k) => k !== proof1) || proof1;
    const proof1Pain = id(letter.proof1Pain);
    const proof2Pain = id(letter.proof2Pain);
    /* The hook ties the company to the heaviest outcome the proofs do
     * not already answer, else the heaviest outcome. */
    const outcomes = (extract?.outcomes || [])
      .filter((o) => o && typeof o.id === "string")
      .map((o, i) => ({ id: /** @type {string} */ (o.id), w: typeof o.weight === "number" ? o.weight : 0.5, i }))
      .sort((a, b) => b.w - a.w || a.i - b.i);
    const open = outcomes.find((o) => o.id !== proof1Pain && o.id !== proof2Pain);
    const hookPain = (open || outcomes[0])?.id || "";
    outline.letterBeats = {
      hook: hookPain,
      companyInsight: hookPain,
      proof1,
      proof1Pain,
      proof2,
      proof2Pain,
      ask: "",
    };
  }

  return outline;
}

/** Validate the selected claim IDs before planning can silently drop one. */
/** @param {{ kept?: Array<{ claimId?: unknown }> }} selection @param {{ claims?: Array<{ id?: unknown }> }} ledger @returns {string[]} */
function selectedResumeIds(selection, ledger) {
  if (!Array.isArray(selection.kept)) throw new Error("selected claim accounting requires a kept list");
  const known = new Set((ledger.claims || []).map((claim) => claim?.id).filter((id) => typeof id === "string" && id));
  const seen = new Set();
  return selection.kept.map((item) => {
    const id = item?.claimId;
    if (typeof id !== "string" || !id.trim() || !known.has(id) || seen.has(id)) {
      throw new Error("selected claim accounting found a missing, unknown, or duplicate claim ID");
    }
    seen.add(id);
    return id;
  });
}

/** Every selected ID must reach one resume slot or one page-budget exclusion. */
/** @param {string[]} kept @param {Pick<Outline, "featured" | "earlier" | "dropped">} plan */
function summarizeSelectedResume(kept, plan) {
  const selected = new Set(kept);
  const accounted = new Set();
  const summary = { selected: kept.length, featured: 0, earlier: 0, pageBudgetExcluded: 0 };
  /** @param {string} id @param {"featured" | "earlier" | "pageBudgetExcluded"} field */
  const mark = (id, field) => {
    if (!selected.has(id)) return; // Earlier may include an unselected ledger claim as context.
    if (accounted.has(id)) throw new Error("selected claim accounting assigned a claim more than once");
    accounted.add(id);
    summary[field] += 1;
  };
  for (const group of plan.featured) for (const id of group.claimIds) mark(id, "featured");
  for (const id of plan.earlier) mark(id, "earlier");
  for (const drop of plan.dropped) {
    if (drop.reason !== "page_budget") throw new Error("selected claim accounting found an unknown exclusion reason");
    mark(drop.claimId, "pageBudgetExcluded");
  }
  if (accounted.size !== selected.size) throw new Error("selected claim accounting left a claim unassigned");
  return summary;
}

/**
 * Count selected claims in the model that survived the final one-page fit.
 * A fitter can retain a claimId on an entry after removing its line, so IDs
 * count only when their bullet or line still has rendered content.
 * @param {object} input
 * @param {{ kept?: Array<{ claimId?: unknown }> }} input.selection
 * @param {{ claims?: Array<{ id?: unknown }> }} input.ledger
 * @param {import("./materials-render.mjs").RenderModel | null | undefined} input.model
 */
export function summarizeRenderedResumeSelection({ selection, ledger, model }) {
  const kept = selectedResumeIds(selection, ledger);
  const resume = model?.documents.resume;
  if (!resume) throw new Error("selected claim accounting requires a fitted resume model");
  const selected = new Set(kept);
  const rendered = new Set();
  const summary = { selected: kept.length, featured: 0, earlier: 0, pageBudgetExcluded: 0 };
  /** @param {unknown} id @param {"featured" | "earlier"} field */
  const mark = (id, field) => {
    if (typeof id !== "string" || !selected.has(id)) return;
    if (rendered.has(id)) throw new Error("selected claim accounting rendered a claim more than once");
    rendered.add(id);
    summary[field] += 1;
  };
  for (const section of resume.sections || []) {
    const field = section.kind === "experience" ? "featured" : section.kind === "earlier" ? "earlier" : null;
    if (!field) continue;
    for (const entry of section.entries || []) {
      if (typeof entry.line === "string" && entry.line.trim()) mark(entry.claimId, field);
      for (const bullet of entry.bullets || []) {
        const hasContent = Array.isArray(bullet.runs) && bullet.runs.some((run) =>
          typeof run.t === "string" && run.t.trim() || typeof run.n === "string" && run.n.trim() || typeof run.hl === "string" && run.hl.trim());
        if (hasContent) mark(bullet.claimId, field);
      }
    }
  }
  summary.pageBudgetExcluded = kept.length - rendered.size;
  return summary;
}

/**
 * Skills line (K5 / P-13): owned tools and keywords first, ranked by how
 * many job nouns they match (stemmed, with synonyms: "OTT/CTV" meets
 * "CTV", "Programmatic Display" meets "ad tech"); then adjacent tools the
 * job names; then owned tools the kept claims use. A token is skipped
 * when an already-listed token covers it ("OTT" under "OTT/CTV").
 * @param {object} input
 * @param {{ claims?: Array<{ id?: unknown, tools?: unknown[] }>, toolInventory?: Array<{ tool?: unknown, level?: unknown }> }} input.ledger
 * @param {string[]} input.kept
 * @param {{ nouns?: Array<{ term?: unknown, weight?: unknown }>, stack?: { required?: unknown[], preferred?: unknown[] } } | undefined} input.extract
 * @param {number} input.max
 * @returns {string[]}
 */
export function skillsLine({ ledger, kept, extract, max }) {
  /** @type {Map<string, { tool: string, level: string, order: number }>} */
  const inventory = new Map();
  (ledger.toolInventory || []).forEach((t, order) => {
    if (!t || typeof t.tool !== "string" || !t.tool.trim()) return;
    const key = t.tool.toLowerCase();
    const level = typeof t.level === "string" ? t.level : "none";
    const prior = inventory.get(key);
    /* The same tool listed twice keeps its strongest level. */
    if (!prior || (prior.level !== "owned" && level === "owned")) {
      inventory.set(key, { tool: t.tool, level, order: prior ? prior.order : order });
    }
  });
  /** @type {Set<string>} */
  const inKept = new Set();
  for (const id of kept) {
    const claim = claimById(ledger, id);
    for (const tool of claim && Array.isArray(claim.tools) ? claim.tools : []) {
      if (typeof tool === "string") inKept.add(tool.toLowerCase());
    }
  }
  const jobTerms = [
    ...(extract?.nouns || []).map((n) => ({
      term: typeof n.term === "string" ? n.term : "",
      weight: typeof n.weight === "number" ? n.weight : 0.5,
      stack: false,
    })),
    ...[...(extract?.stack?.required || []), ...(extract?.stack?.preferred || [])].map((t) => ({
      term: typeof t === "string" ? t : "",
      weight: 1,
      stack: true,
    })),
  ].filter((t) => t.term);

  const ranked = [...inventory.values()]
    .filter((t) => t.level === "owned" || t.level === "adjacent")
    .map((t) => {
      const index = termIndex(t.tool);
      let match = 0;
      const toolWords = t.tool.trim().split(/\s+/).length;
      for (const { term, weight, stack } of jobTerms) {
        const termIdx = termIndex(term);
        /* A one-word noun inside a longer tool name ("managers" in
         * "Google Tag Manager") is not a match unless a synonym group
         * says so ("ctv" and "OTT/CTV"). */
        const partial = !stack && toolWords > 1 && !term.includes(" ") && ![...termIdx.groups].some((g) => index.groups.has(g));
        if (termMatches(t.tool, termIdx) || (!partial && termMatches(term, index))) match += weight;
      }
      return { ...t, match, used: inKept.has(t.tool.toLowerCase()) };
    });
  const tier = (/** @type {{ level: string, match: number, used: boolean }} */ t) => {
    if (t.match > 0 && t.level === "owned") return 0;
    if (t.match > 0) return 1;
    if (t.used && t.level === "owned") return 2;
    if (t.used) return 3;
    return 4;
  };
  ranked.sort((a, b) => tier(a) - tier(b) || b.match - a.match || a.order - b.order);
  /* Without job nouns, keep the old behaviour: only tools the kept claims
   * use. With them, unmatched unused tools never pad the line. */
  const pool = ranked.filter((t) => tier(t) <= 3);

  /** @type {string[]} */
  const out = [];
  /** @type {Array<Set<string>>} */
  const taken = [];
  for (const t of pool) {
    if (out.length >= max) break;
    const words = new Set(t.tool.toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean));
    if (taken.some((w) => [...words].every((x) => w.has(x)))) continue;
    out.push(t.tool);
    taken.push(words);
  }
  return out;
}

/**
 * Most recent first: a current role (no end, or "Present") outranks any
 * dated end; then the later end year; then the later start.
 * @param {unknown} value
 */
function dateNumber(value) {
  const text = String(value ?? "");
  const year = /(19|20)\d\d(?!.*(19|20)\d\d)/.exec(text);
  if (!year) return 0;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.findIndex((name) => new RegExp(`\\b${name}[a-z]*\\b`, "i").test(text));
  return Number(year[0]) * 12 + (month < 0 ? 1 : month + 1);
}

/** @param {{ start?: unknown, end?: unknown } | undefined} employer */
function recencyKey(employer) {
  const end = employer?.end;
  /* An end in the current year ("2017 – 2026", written in 2026) is as
   * current as "Present". */
  const thisYear = new Date().getUTCFullYear();
  const current =
    end === null || end === undefined || end === "" || /present|current|now/i.test(String(end)) || dateNumber(end) >= thisYear * 12;
  return { end: current ? 9999 * 12 : dateNumber(end), start: dateNumber(employer?.start) };
}

/** Top two non-retired employers by tenure; ties use recency and source order. */
/** @param {{employers?: Array<{id?:unknown,start?:unknown,end?:unknown,retired?:unknown}>}} ledger */
export function tenureFloorIds(ledger) {
  const entries = (ledger.employers || []).filter((entry) => entry && typeof entry.id === "string" && entry.retired !== true);
  const today = new Date();
  const current = today.getUTCFullYear() * 12 + today.getUTCMonth() + 1;
  const tenure = (/** @type {typeof entries[number]} */ entry) => {
    const start = dateNumber(entry.start);
    if (!start) return 0;
    const end = recencyKey(entry).end;
    return Math.max(0, (end >= 9999 * 12 ? current : end) - start);
  };
  return new Set(entries.map((entry, index) => ({ entry, index })).sort((a, b) =>
    tenure(b.entry) - tenure(a.entry) || recencyKey(b.entry).end - recencyKey(a.entry).end || a.index - b.index)
    .slice(0, 2).map(({ entry }) => /** @type {string} */ (entry.id)));
}

/**
 * Proof-run design call 1: up to 3 featured employers, most recent first;
 * 5 bullets for the first and 4 for the next ones, with unused slots
 * passed on (never above 5 per employer). A company with several dated
 * roles gets one sub-row per role. Claims from a featured company never
 * land in "Earlier": Earlier holds other employers only, one line each.
 * @param {object} input
 * @param {{ claims?: Array<{ id?: unknown, employerId?: unknown, roleId?: unknown, kind?: unknown, metrics?: unknown[], attribution?:unknown, quarantined?:unknown }>, employers?: Array<{ id?: unknown, start?: unknown, end?: unknown, roles?: unknown, retired?:unknown }> }} input.ledger
 * @param {string[]} input.kept kept claim ids in rank order
 * @param {number} input.featuredMax
 * @param {number} input.perFeaturedMax
 * @param {number} input.earlierMax
 */
export function planResume({ ledger, kept, featuredMax, perFeaturedMax, earlierMax }) {
  /** @type {Map<string, { id?: unknown, start?: unknown, end?: unknown, roles?: unknown }>} */
  const employers = new Map();
  for (const e of ledger.employers || []) {
    if (e && typeof e.id === "string" && e.retired !== true) employers.set(e.id, e);
  }
  const order = new Map([...employers.keys()].map((id, i) => [id, i]));
  /** @type {Map<string, string[]>} */
  const byEmployer = new Map();
  /** @type {{ claimId: string, reason: "page_budget" }[]} */
  const dropped = [];
  for (const id of kept) {
    const claim = claimById(ledger, id);
    const employer = claim && typeof claim.employerId === "string" ? claim.employerId : "";
    if (!employer || claim?.kind === "education" || claim?.kind === "credential" || claim?.attribution === "inferred" || claim?.quarantined) {
      dropped.push({ claimId: id, reason: "page_budget" });
      continue;
    }
    if (!byEmployer.has(employer)) byEmployer.set(employer, []);
    byEmployer.get(employer)?.push(id);
  }
  const keptCount = (/** @type {string} */ id) => byEmployer.get(id)?.length || 0;
  /* Most recent first; between two current roles, the one this job kept
   * more claims from leads. */
  const byRecency = (/** @type {string} */ a, /** @type {string} */ b) => {
    const ka = recencyKey(employers.get(a));
    const kb = recencyKey(employers.get(b));
    return kb.end - ka.end || keptCount(b) - keptCount(a) || kb.start - ka.start || (order.get(a) ?? 0) - (order.get(b) ?? 0);
  };
  /* Which employers feature: those with 2+ kept claims, strongest first,
   * capped; a single-claim employer features only to reach two. Then
   * shown most recent first. */
  const byStrength = [...byEmployer.keys()].sort((a, b) => keptCount(b) - keptCount(a) || byRecency(a, b));
  const chosen = byStrength.filter((id) => keptCount(id) >= 2).slice(0, featuredMax);
  for (const id of byStrength) {
    if (chosen.length >= 2 || chosen.length >= featuredMax) break;
    if (!chosen.includes(id)) chosen.push(id);
  }
  chosen.sort(byRecency);
  /** @type {string[]} */
  const keptOthers = [];
  for (const id of [...byEmployer.keys()].sort(byRecency)) {
    if (chosen.includes(id)) continue;
    const [first, ...rest] = byEmployer.get(id) || [];
    if (first) keptOthers.push(first);
    for (const claimId of rest) dropped.push({ claimId, reason: "page_budget" });
  }
  /* Bullet slots: 5, then 4, 4; slots an employer cannot fill pass on. */
  const caps = chosen.map((_, i) => Math.min(perFeaturedMax, i === 0 ? 5 : 4));
  const have = chosen.map((id) => byEmployer.get(id)?.length || 0);
  let spare = caps.reduce((n, cap, i) => n + Math.max(0, cap - have[i]), 0);
  const take = caps.map((cap, i) => Math.min(cap, have[i]));
  for (let i = 0; i < chosen.length && spare > 0; i += 1) {
    const extra = Math.min(spare, Math.min(perFeaturedMax, 5) - take[i], have[i] - take[i]);
    if (extra > 0) {
      take[i] += extra;
      spare -= extra;
    }
  }
  /** @type {FeaturedEmployer[]} */
  const featured = chosen.map((employerId, i) => {
    /* Within the cap, claims with a number go first (rule 3); rank order
     * otherwise. */
    const withMetric = (/** @type {string} */ id) => {
      const c = claimById(ledger, id);
      return c && Array.isArray(c.metrics) && c.metrics.length ? 1 : 0;
    };
    const ranked = byEmployer.get(employerId) || [];
    const ids = [...ranked].sort((a, b) => withMetric(b) - withMetric(a) || ranked.indexOf(a) - ranked.indexOf(b));
    const inCap = new Set(ids.slice(0, take[i]));
    const claimIds = ranked.filter((id) => inCap.has(id));
    for (const claimId of ids.slice(take[i])) dropped.push({ claimId, reason: "page_budget" });
    const employer = employers.get(employerId);
    const roles = Array.isArray(employer?.roles)
      ? /** @type {Array<{ id?: unknown, title?: unknown, start?: unknown, end?: unknown }>} */ (employer.roles).filter(
        (r) => r && typeof r.id === "string",
      )
      : [];
    if (roles.length < 2) return { employerId, claimIds };
    /* One sub-row per role; a claim with no role joins the first role. */
    const roleOf = (/** @type {string} */ id) => {
      const claim = /** @type {{ roleId?: unknown } | null} */ (claimById(ledger, id));
      const roleId = claim && typeof claim.roleId === "string" ? claim.roleId : "";
      return roles.some((r) => r.id === roleId) ? roleId : String(roles[0].id);
    };
    const roleRows = roles.map((r) => ({
      roleId: String(r.id),
      title: typeof r.title === "string" ? r.title : "",
      start: typeof r.start === "string" ? r.start : null,
      end: typeof r.end === "string" ? r.end : null,
      claimIds: claimIds.filter((id) => roleOf(id) === r.id),
    }));
    return { employerId, claimIds: roleRows.flatMap((r) => r.claimIds), roles: roleRows };
  });
  /* Earlier: other employers only, most recent first, one line each —
   * a kept claim when there is one, else the employer's strongest claim. */
  const featuredSet = new Set(chosen);
  /** @type {string[]} */
  const earlier = keptOthers.slice(0, earlierMax);
  for (const claimId of keptOthers.slice(earlierMax)) dropped.push({ claimId, reason: "page_budget" });
  const usedEmployers = new Set(earlier.map((id) => String(claimById(ledger, id)?.employerId || "")));
  const others = [...employers.keys()].filter((id) => !featuredSet.has(id) && !usedEmployers.has(id)).sort(byRecency);
  for (const employerId of others) {
    if (earlier.length >= earlierMax) break;
    const own = (ledger.claims || []).filter(
      (c) => c && c.employerId === employerId && typeof c.id === "string" && c.kind !== "education" && c.kind !== "credential" && c.attribution !== "inferred" && !c.quarantined,
    );
    if (!own.length) continue;
    const pick = own.find((c) => Array.isArray(c.metrics) && c.metrics.length) || own[0];
    earlier.push(String(pick.id));
  }
  const shown = new Set([...chosen, ...earlier.map((id) => String(claimById(ledger, id)?.employerId || ""))]);
  for (const employerId of tenureFloorIds(ledger)) {
    if (shown.has(employerId)) continue;
    const own = (ledger.claims || []).filter((claim) => claim?.employerId === employerId && claim.kind !== "education" && claim.kind !== "credential" && claim.attribution !== "inferred" && !claim.quarantined);
    const role = own.find((claim) => claim.kind === "role") || own[0];
    if (!role || typeof role.id !== "string") continue;
    earlier.push(role.id);
    shown.add(employerId);
    const at = dropped.findIndex((item) => item.claimId === role.id);
    if (at >= 0) dropped.splice(at, 1);
  }
  return { featured, earlier, dropped };
}
