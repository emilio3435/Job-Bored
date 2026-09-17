/**
 * Materials v3 — the single budget table plus the deterministic fit solver.
 *
 * Two jobs, deliberately in one module so they cannot disagree:
 *   1. `MATERIALS_BUDGETS` is the only copy of the length numbers. QA, repair,
 *      the prompts, and the fit solver all read it. The 325-word letter floor
 *      existed in three places with two different values; that is the drift
 *      this module exists to prevent.
 *   2. `solveFit` decides pagination by arithmetic and an ordered trim ladder.
 *      The model never controls layout, and type size is never reduced: a plan
 *      that does not fit loses a claim.
 *
 * The estimator avoids render loops. It is not the source of truth — the page
 * count of the rendered PDF is (see the mechanism spec, §6.5).
 *
 * Spec: docs/superpowers/specs/2026-09-17-materials-v3-mechanism-design.md
 */

/**
 * @typedef {object} ResumeBudgets
 * @property {number} pages
 * @property {number} pagesMax
 * @property {readonly number[]} visibleWords
 * @property {number} visibleWordsHardMax
 * @property {readonly number[]} statementWords
 * @property {number} statementWordsHardMax
 * @property {number} featuredEmployers
 * @property {number} featuredEmployersMax
 * @property {readonly number[]} bulletsPerFeatured
 * @property {readonly number[]} earlierLines
 * @property {readonly number[]} tokens
 */

/**
 * @typedef {object} LetterBudgets
 * @property {number} pages
 * @property {readonly number[]} bodyWords
 * @property {number} bodyWordsHardMin
 * @property {number} bodyWordsHardMax
 * @property {number} paragraphs
 */

/**
 * @typedef {object} RunBudgets
 * @property {number} llmCalls
 * @property {number} llmCallsMax
 * @property {number} outputTokensMax
 * @property {number} repairsMax
 */

/**
 * @typedef {object} MaterialsBudgets
 * @property {string} version
 * @property {ResumeBudgets} resume
 * @property {LetterBudgets} letter
 * @property {RunBudgets} run
 */

/**
 * @typedef {object} BlockMetrics
 * @property {number} charsPerLine
 * @property {number} leadingPt
 * @property {number} marginBottomPt
 * @property {number} [marginTopPt]
 */

/**
 * @typedef {object} TemplateMetrics
 * @property {number} usableHeightPt
 * @property {number} safetyBandPt
 * @property {number} mastheadPt
 * @property {number} rulePt
 * @property {number} sectionLabelPt
 * @property {number} entryHeadPt
 * @property {number} entryHeadNoSeatPt
 * @property {number} entryGapPt
 * @property {number} footPt
 * @property {BlockMetrics} statement
 * @property {BlockMetrics} bullet
 * @property {BlockMetrics} earlierLine
 * @property {BlockMetrics} tokenLine
 */

/**
 * @typedef {object} PlanBullet
 * @property {string} claimId
 * @property {string} text
 */

/**
 * @typedef {object} FeaturedEntry
 * @property {string} employerId
 * @property {number} rank
 * @property {boolean} [seat]
 * @property {PlanBullet[]} bullets
 */

/**
 * @typedef {object} EarlierEntry
 * @property {string} employerId
 * @property {string} [description]
 */

/**
 * @typedef {object} ResumePlan
 * @property {number} pageBudget
 * @property {string} [pageBudgetReason]
 * @property {string} statement
 * @property {FeaturedEntry[]} featured
 * @property {EarlierEntry[]} earlier
 * @property {string[]} tokens
 * @property {string} [education]
 */

/**
 * @typedef {object} FitResult
 * @property {boolean} fits
 * @property {ResumePlan} plan
 * @property {string[]} applied
 * @property {number} firstEstimatePt
 * @property {number} estimatePt
 * @property {number} capacityPt
 */

/** @type {MaterialsBudgets} */
export const MATERIALS_BUDGETS = Object.freeze({
  version: "materials.budgets.v3.0",
  resume: Object.freeze({
    pages: 1,
    pagesMax: 2,
    visibleWords: Object.freeze([340, 480]),
    visibleWordsHardMax: 560,
    statementWords: Object.freeze([28, 48]),
    statementWordsHardMax: 55,
    featuredEmployers: 2,
    featuredEmployersMax: 3,
    bulletsPerFeatured: Object.freeze([2, 4]),
    earlierLines: Object.freeze([1, 3]),
    tokens: Object.freeze([8, 13]),
  }),
  letter: Object.freeze({
    pages: 1,
    bodyWords: Object.freeze([180, 260]),
    bodyWordsHardMin: 150,
    bodyWordsHardMax: 280,
    paragraphs: 4,
  }),
  run: Object.freeze({
    llmCalls: 3,
    llmCallsMax: 4,
    outputTokensMax: 6144,
    repairsMax: 2,
  }),
});

/**
 * Type metrics for the Volt sheet, in points. Derived from `volt.css`; they
 * live with the template package in production so a CSS change updates the
 * estimator in the same commit.
 *
 * @type {Readonly<TemplateMetrics>}
 */
export const VOLT_RESUME_METRICS = Object.freeze({
  usableHeightPt: 711.4,
  // The estimator can be a line off on either side, so a 0.2in band is held
  // back: a borderline plan gets trimmed instead of clipped by the sheet's
  // `overflow: hidden`, and the page never reads full to the edge.
  safetyBandPt: 14.4,
  mastheadPt: 62,
  rulePt: 13,
  sectionLabelPt: 23,
  entryHeadPt: 22,
  entryHeadNoSeatPt: 14,
  entryGapPt: 12,
  footPt: 24,
  statement: Object.freeze({ marginTopPt: 19, charsPerLine: 78, leadingPt: 17.7, marginBottomPt: 4 }),
  bullet: Object.freeze({ charsPerLine: 96, leadingPt: 13.5, marginBottomPt: 4.5 }),
  earlierLine: Object.freeze({ charsPerLine: 100, leadingPt: 13.5, marginBottomPt: 0 }),
  tokenLine: Object.freeze({ charsPerLine: 104, leadingPt: 15.75, marginBottomPt: 0 }),
});

/** Trim ladder, in the order the solver walks it. */
export const TRIM_LADDER = Object.freeze([
  "drop_earlier_description",
  "drop_weakest_bullet",
  "trim_tokens",
  "drop_weakest_earlier",
  "drop_weakest_featured",
  "escalate_page_budget",
]);

/**
 * @param {number} chars
 * @param {number} charsPerLine
 * @returns {number}
 */
function lineCount(chars, charsPerLine) {
  if (!(chars > 0)) return 0;
  return Math.max(1, Math.ceil(chars / charsPerLine));
}

/**
 * @param {number} chars
 * @param {{ charsPerLine: number, leadingPt: number, marginBottomPt: number, marginTopPt?: number }} block
 * @returns {number}
 */
function blockHeightPt(chars, block) {
  const lines = lineCount(chars, block.charsPerLine);
  if (!lines) return 0;
  return (block.marginTopPt || 0) + lines * block.leadingPt + block.marginBottomPt;
}

/**
 * @param {string} text
 * @returns {number}
 */
function charsOf(text) {
  return typeof text === "string" ? text.length : 0;
}

/**
 * Estimated rendered height of a resume plan, in points.
 *
 * @param {ResumePlan} plan
 * @param {TemplateMetrics} [metrics]
 * @returns {number}
 */
export function estimateResumeHeightPt(plan, metrics = VOLT_RESUME_METRICS) {
  let total = metrics.mastheadPt + metrics.rulePt + metrics.footPt;
  total += blockHeightPt(charsOf(plan.statement), metrics.statement);

  if (plan.featured.length) {
    total += metrics.sectionLabelPt;
    for (const [index, entry] of plan.featured.entries()) {
      total += entry.seat ? metrics.entryHeadPt : metrics.entryHeadNoSeatPt;
      for (const bullet of entry.bullets) {
        total += blockHeightPt(charsOf(bullet.text), metrics.bullet);
      }
      if (index < plan.featured.length - 1) total += metrics.entryGapPt;
    }
  }

  if (plan.earlier.length) {
    total += metrics.sectionLabelPt;
    for (const [index, entry] of plan.earlier.entries()) {
      total += metrics.entryHeadNoSeatPt;
      if (entry.description) {
        total += blockHeightPt(charsOf(entry.description), metrics.earlierLine);
      }
      if (index < plan.earlier.length - 1) total += metrics.entryGapPt;
    }
  }

  if (plan.tokens.length) {
    total += metrics.sectionLabelPt;
    total += blockHeightPt(plan.tokens.join(" / ").length, metrics.tokenLine);
  }

  if (plan.education) {
    total += metrics.sectionLabelPt;
    total += blockHeightPt(charsOf(plan.education), metrics.tokenLine);
  }

  return Math.round(total * 10) / 10;
}

/**
 * @param {ResumePlan} plan
 * @returns {ResumePlan}
 */
function clonePlan(plan) {
  return {
    pageBudget: plan.pageBudget,
    pageBudgetReason: plan.pageBudgetReason,
    statement: plan.statement,
    featured: plan.featured.map((entry) => ({
      employerId: entry.employerId,
      rank: entry.rank,
      seat: entry.seat,
      bullets: entry.bullets.map((bullet) => ({ ...bullet })),
    })),
    earlier: plan.earlier.map((entry) => ({ ...entry })),
    tokens: [...plan.tokens],
    education: plan.education,
  };
}

/**
 * Apply one ladder step. Returns false when the step has nothing left to do,
 * so the solver moves on instead of spinning.
 *
 * @param {string} step
 * @param {ResumePlan} plan
 * @param {MaterialsBudgets} budgets
 * @returns {boolean}
 */
function applyStep(step, plan, budgets) {
  if (step === "drop_earlier_description") {
    const target = plan.earlier.filter((entry) => entry.description).pop();
    if (!target) return false;
    delete target.description;
    return true;
  }

  if (step === "drop_weakest_bullet") {
    const minBullets = budgets.resume.bulletsPerFeatured[0];
    /** @type {FeaturedEntry | null} */
    let chosen = null;
    for (const entry of plan.featured) {
      if (entry.bullets.length <= minBullets) continue;
      if (!chosen || entry.rank > chosen.rank) chosen = entry;
    }
    if (!chosen) return false;
    chosen.bullets.pop();
    return true;
  }

  if (step === "trim_tokens") {
    const floor = budgets.resume.tokens[0];
    if (plan.tokens.length <= floor) return false;
    plan.tokens.pop();
    return true;
  }

  if (step === "drop_weakest_earlier") {
    if (!plan.earlier.length) return false;
    plan.earlier.pop();
    return true;
  }

  if (step === "drop_weakest_featured") {
    if (plan.featured.length <= 1) return false;
    plan.featured.pop();
    return true;
  }

  if (step === "escalate_page_budget") {
    if (plan.pageBudget >= budgets.resume.pagesMax) return false;
    if (!plan.pageBudgetReason) return false;
    plan.pageBudget += 1;
    return true;
  }

  return false;
}

/**
 * Walk the trim ladder until the plan fits its page budget.
 *
 * @param {ResumePlan} input
 * @param {{ metrics?: TemplateMetrics, budgets?: MaterialsBudgets }} [options]
 * @returns {FitResult}
 */
export function solveFit(input, options = {}) {
  const metrics = options.metrics || VOLT_RESUME_METRICS;
  const budgets = options.budgets || MATERIALS_BUDGETS;
  const plan = clonePlan(input);

  /** @type {string[]} */
  const applied = [];
  const capacityPt = () => metrics.usableHeightPt * plan.pageBudget - metrics.safetyBandPt;
  let estimatePt = estimateResumeHeightPt(plan, metrics);
  const firstEstimatePt = estimatePt;

  for (const step of TRIM_LADDER) {
    while (estimatePt > capacityPt()) {
      if (!applyStep(step, plan, budgets)) break;
      applied.push(step);
      estimatePt = estimateResumeHeightPt(plan, metrics);
    }
    if (estimatePt <= capacityPt()) break;
  }

  return {
    fits: estimatePt <= capacityPt(),
    plan,
    applied,
    firstEstimatePt,
    estimatePt,
    capacityPt: Math.round(capacityPt() * 10) / 10,
  };
}
