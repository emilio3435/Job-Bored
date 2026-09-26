/**
 * Fit: make each document one page in its family, proven by measuring the
 * laid-out page (visual spec §9.2 rule 4, mechanism spec §6.5).
 *
 *   1. Budgets. The family's soft budgets (family.json `budgets`) cap the
 *      featured employers and bullets per employer, and the shared ladder
 *      trims until the resume is inside the family's visible-word budget.
 *      All of this stays inside MATERIALS_BUDGETS' hard limits.
 *   2. Measure. The renderer's browser lays the page out; a sheet whose
 *      scrollHeight exceeds its clientHeight, or whose last text box ends
 *      inside the bottom margin, does not fit.
 *   3. Ladder. Resume: the shared content steps, then the family's tail,
 *      then dropping the weakest featured employer. Letter: the family's
 *      letter ladder (tighter settings, then optional chrome). Re-measure
 *      after every step.
 *   4. Fail loudly. If the ladder runs out, the document renders unclipped
 *      (the sheet grows, the PDF gets a second page) and the result says
 *      `overflow`, which QA turns into a `layout_overflow` fail. Text is
 *      never clipped silently.
 *
 * With no browser (Playwright missing), nothing is measured: the document
 * renders unclipped and the result says `measured: false`.
 */

import { resumeWordCount } from "./materials-ats-text.mjs";
import { MATERIALS_BUDGETS } from "./materials-fit-budget.mjs";
import { renderDocument } from "./materials-render.mjs";
import { resolveFamily } from "./materials-templates.mjs";

/** Shared resume content steps, walked before the family's tail. */
export const SHARED_RESUME_STEPS = Object.freeze([
  "drop_earlier_line",
  "drop_weakest_bullet",
  "trim_tokens",
  "drop_weakest_earlier",
]);

/** The last resort, after the family's tail: it removes a whole employer. */
export const FINAL_RESUME_STEP = "drop_weakest_featured";

/**
 * @typedef {import("./materials-render.mjs").RenderModel} RenderModel
 * @typedef {import("./materials-render.mjs").DocKind} DocKind
 */

/**
 * @typedef {object} FitResult
 * @property {string} html the rendered document
 * @property {RenderModel} model the model as rendered (after budgets and trims)
 * @property {string[]} applied ladder steps applied, in order
 * @property {string[]} fitTokens data-fit tokens on the sheet
 * @property {boolean} measured a browser measured the layout
 * @property {boolean} fits
 * @property {boolean} overflow measured, and the ladder could not make it fit
 * @property {import("./materials-pdf.mjs").LayoutMeasurement | null} measurement
 */

/** @param {RenderModel} model @returns {RenderModel} */
function clone(model) {
  return JSON.parse(JSON.stringify(model));
}

/**
 * @param {RenderModel} model
 * @param {string} kind
 */
function sectionOf(model, kind) {
  return (model.documents.resume?.sections || []).find((s) => s.kind === kind) || null;
}

/**
 * Move experience entries past the family's featured count into `earlier`,
 * as one-line entries, and cap bullets per featured employer.
 *
 * @param {RenderModel} model
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 */
export function applyFamilyBudgets(model, family) {
  const out = clone(model);
  const resume = out.documents.resume;
  if (!resume) return out;
  const hard = MATERIALS_BUDGETS.resume;
  const featuredMax = Math.min(family.budgets.featuredEmployers ?? hard.featuredEmployers, hard.featuredEmployersMax);
  const bulletsMax = Math.min((family.budgets.bulletsPerFeatured ?? hard.bulletsPerFeatured)[1], hard.bulletsPerFeatured[1]);
  const experience = sectionOf(out, "experience");
  if (experience && experience.entries) {
    for (const entry of experience.entries) {
      if (entry.bullets && entry.bullets.length > bulletsMax) entry.bullets = entry.bullets.slice(0, bulletsMax);
    }
    if (experience.entries.length > featuredMax) {
      const moved = experience.entries.splice(featuredMax);
      let earlier = sectionOf(out, "earlier");
      if (!earlier) {
        earlier = { kind: "earlier", label: "Earlier", entries: [] };
        const at = resume.sections.indexOf(experience) + 1;
        resume.sections.splice(at, 0, earlier);
      }
      earlier.entries = [
        ...moved.map((entry) => {
          const firstBullet = entry.bullets && entry.bullets[0];
          const { bullets: _bullets, ...rest } = entry;
          return firstBullet
            ? { ...rest, claimId: firstBullet.claimId, line: firstBullet.runs.map((r) => r.t ?? r.n ?? r.hl ?? "").join("") }
            : rest;
        }),
        ...(earlier.entries || []),
      ];
    }
  }
  return out;
}

/**
 * Apply one resume or letter step. Returns false when the step has nothing
 * left to do, so the ladder moves on instead of spinning.
 *
 * @param {RenderModel} model mutated
 * @param {string} step
 * @param {string[]} fitTokens mutated
 * @returns {boolean}
 */
export function applyStep(model, step, fitTokens) {
  const resume = model.documents.resume;
  const letter = model.documents.coverLetter;
  if (step.startsWith("css:")) {
    const token = step.slice(4);
    if (fitTokens.includes(token)) return false;
    fitTokens.push(token);
    return true;
  }
  if (step === "drop_letter_readouts") {
    if (!letter || !letter.readouts) return false;
    delete letter.readouts;
    return true;
  }
  if (step === "drop_pull_quote") {
    if (!letter || !letter.pullQuote) return false;
    delete letter.pullQuote;
    return true;
  }
  if (!resume) return false;
  const sections = resume.sections;
  if (step === "drop_intro") {
    if (!resume.intro) return false;
    delete resume.intro;
    return true;
  }
  if (step === "drop_readouts") step = "drop_section:readouts";
  if (step.startsWith("drop_section:")) {
    const kind = step.slice("drop_section:".length);
    const index = sections.findIndex((s) => s.kind === kind);
    if (index < 0) return false;
    sections.splice(index, 1);
    return true;
  }
  if (step.startsWith("drop_toolkit_group:")) {
    const label = step.slice("drop_toolkit_group:".length).toLowerCase();
    const toolkit = sectionOf(model, "toolkit");
    const at = toolkit && toolkit.groups ? toolkit.groups.findIndex((g) => g.label.toLowerCase() === label) : -1;
    if (!toolkit || !toolkit.groups || at < 0) return false;
    toolkit.groups.splice(at, 1);
    return true;
  }
  if (step === "drop_earlier_line") {
    const earlier = sectionOf(model, "earlier");
    const target = earlier?.entries ? [...earlier.entries].reverse().find((e) => e.line) : null;
    if (!target) return false;
    delete target.line;
    return true;
  }
  if (step === "drop_weakest_bullet") {
    const experience = sectionOf(model, "experience");
    const minBullets = MATERIALS_BUDGETS.resume.bulletsPerFeatured[0];
    const entries = experience?.entries || [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const bullets = entries[i].bullets || [];
      if (bullets.length > minBullets) {
        bullets.pop();
        return true;
      }
    }
    return false;
  }
  if (step === "trim_tokens") {
    const floor = MATERIALS_BUDGETS.resume.tokens[0];
    const tokens = sections.find((s) => s.kind === "tokens" && !/educat/i.test(s.label) && (s.tokens?.length || 0) > floor);
    if (!tokens || !tokens.tokens) return false;
    tokens.tokens.pop();
    return true;
  }
  if (step === "drop_weakest_earlier") {
    const earlier = sectionOf(model, "earlier");
    if (!earlier || !earlier.entries || !earlier.entries.length) return false;
    earlier.entries.pop();
    if (!earlier.entries.length) sections.splice(sections.indexOf(earlier), 1);
    return true;
  }
  if (step === FINAL_RESUME_STEP) {
    const experience = sectionOf(model, "experience");
    if (!experience || !experience.entries || experience.entries.length <= 1) return false;
    experience.entries.pop();
    return true;
  }
  return false;
}

/**
 * The ordered steps for one document in one family.
 *
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 * @param {DocKind} doc
 */
export function ladderFor(family, doc) {
  if (doc === "coverLetter") return [...family.fit.letterLadder];
  return [...SHARED_RESUME_STEPS, ...family.fit.resumeLadderTail, FINAL_RESUME_STEP];
}

/**
 * Trim the resume until it is inside the family's soft visible-word budget.
 * @param {RenderModel} model mutated
 * @param {import("./materials-templates.mjs").TemplateFamily} family
 * @returns {string[]} steps applied
 */
function trimToWordBudget(model, family) {
  const max = family.budgets.visibleWords?.[1] ?? MATERIALS_BUDGETS.resume.visibleWords[1];
  /** @type {string[]} */
  const applied = [];
  const scratch = /** @type {string[]} */ ([]);
  for (const step of SHARED_RESUME_STEPS) {
    while (resumeWordCount(model) > max) {
      if (!applyStep(model, step, scratch)) break;
      applied.push(step);
    }
    if (resumeWordCount(model) <= max) break;
  }
  return applied;
}

/**
 * Fit and render one document.
 *
 * @param {RenderModel} input the family-independent render model; its
 *   template block names the family to render in
 * @param {DocKind} doc
 * @param {{ measure?: import("./materials-pdf.mjs").PdfSession["measure"] | null }} [options]
 * @returns {Promise<FitResult>}
 */
export async function fitDocument(input, doc, options = {}) {
  const family = resolveFamily(input.template.family);
  const model = applyFamilyBudgets(input, family);
  /** @type {string[]} */
  const applied = doc === "resume" ? trimToWordBudget(model, family) : [];
  /** @type {string[]} */
  const fitTokens = [];
  const measure = options.measure || null;

  if (!measure) {
    return {
      html: renderDocument(model, doc, { fitTokens }),
      model,
      applied,
      fitTokens,
      measured: false,
      fits: false,
      overflow: false,
      measurement: null,
    };
  }

  const opts = { bottomMarginIn: family.fit.bottomMarginIn };
  let html = renderDocument(model, doc, { fitTokens, fitVerified: true });
  let measurement = await measure(html, opts);
  for (const step of ladderFor(family, doc)) {
    if (measurement.fits) break;
    while (!measurement.fits) {
      if (!applyStep(model, step, fitTokens)) break;
      applied.push(step);
      html = renderDocument(model, doc, { fitTokens, fitVerified: true });
      measurement = await measure(html, opts);
      if (step.startsWith("css:")) break;
    }
  }
  if (measurement.fits) {
    return { html, model, applied, fitTokens, measured: true, fits: true, overflow: false, measurement };
  }
  return {
    html: renderDocument(model, doc, { fitTokens, overflow: true }),
    model,
    applied,
    fitTokens,
    measured: true,
    fits: false,
    overflow: true,
    measurement,
  };
}
