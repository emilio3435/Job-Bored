/**
 * Fit (server/materials-fit.mjs): family soft budgets, the trim ladder, and
 * the measured-fit loop. The measurement is a stub here; the real browser
 * measurement runs in tests/e2e-visual/materials-templates.spec.mjs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFamilyBudgets, applyStep, fitDocument, FINAL_RESUME_STEP, ladderFor, SHARED_RESUME_STEPS } from "../server/materials-fit.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { fullRenderModel } from "./fixtures/materials-render-fixture.mjs";

/** @param {string} html */
function sheetTag(html) {
  return (html.match(/<article\b[^>]*>/) || [""])[0];
}

/**
 * A measurement stub: fits once `fitsAfter` renders have been measured.
 * @param {number} fitsAfter
 */
function measureStub(fitsAfter) {
  const calls = [];
  const measure = async (html) => {
    calls.push(sheetTag(html));
    const fits = calls.length > fitsAfter;
    return { fits, scrollHeight: fits ? 1056 : 1200, clientHeight: 1056, lastTextBottom: 0, limit: 0, blockedRequests: 0 };
  };
  return { measure, calls };
}

describe("family budgets", () => {
  it("should cap bullets per featured employer and move employers past the featured count into Earlier", () => {
    const model = fullRenderModel("signal");
    const experience = model.documents.resume.sections.find((s) => s.kind === "experience");
    experience.entries[0].bullets.push({ claimId: "elio-platform", runs: [{ t: "A fifth bullet." }] }, { claimId: "elio-ops", runs: [{ t: "A sixth." }] });
    experience.entries.push({ employerId: "prmi", meta: ["2015"], org: "Primary Residential Mortgage", bullets: [{ claimId: "prmi-sem", runs: [{ t: "One." }] }, { claimId: "prmi-sem", runs: [{ t: "Two." }] }] });
    const family = { ...resolveFamily("signal"), budgets: { featuredEmployers: 2, bulletsPerFeatured: [2, 3] } };
    const out = applyFamilyBudgets(model, family);
    const outExperience = out.documents.resume.sections.find((s) => s.kind === "experience");
    assert.equal(outExperience.entries.length, 2);
    assert.ok(outExperience.entries.every((e) => e.bullets.length <= 3));
    const earlier = out.documents.resume.sections.find((s) => s.kind === "earlier");
    assert.equal(earlier.entries[0].org, "Primary Residential Mortgage");
    assert.equal(earlier.entries[0].line, "One.");
    assert.equal(experience.entries.length, 3, "the input model is not mutated");
  });
});

describe("the trim ladder", () => {
  it("should walk the shared steps, then the family's tail, then drop a featured employer", () => {
    const signal = resolveFamily("signal");
    assert.deepEqual(ladderFor(signal, "resume"), [...SHARED_RESUME_STEPS, ...signal.fit.resumeLadderTail, FINAL_RESUME_STEP]);
    assert.deepEqual(ladderFor(signal, "coverLetter"), signal.fit.letterLadder);
    assert.deepEqual(signal.fit.resumeLadderTail.slice(0, 2), ["drop_section:ventures", "drop_toolkit_group:Ramping"]);
  });

  it("should apply each step once per call and report a no-op", () => {
    const model = fullRenderModel("signal");
    const tokens = [];
    assert.equal(applyStep(model, "drop_section:ventures", tokens), true);
    assert.equal(applyStep(model, "drop_section:ventures", tokens), false);
    assert.equal(applyStep(model, "drop_toolkit_group:Ramping", tokens), true);
    assert.ok(!model.documents.resume.sections.find((s) => s.kind === "toolkit").groups.some((g) => g.label === "Ramping"));
    assert.equal(applyStep(model, "css:tight-1", tokens), true);
    assert.equal(applyStep(model, "css:tight-1", tokens), false);
    assert.deepEqual(tokens, ["tight-1"]);
    assert.equal(applyStep(model, "drop_pull_quote", tokens), true);
    assert.equal(model.documents.coverLetter.pullQuote, undefined);
    assert.equal(applyStep(model, "drop_intro", tokens), true);
    assert.equal(applyStep(model, "drop_readouts", tokens), true);
    assert.ok(!model.documents.resume.sections.some((s) => s.kind === "readouts"));
  });
});

describe("fitDocument", () => {
  it("should verify a page that fits on the first measurement", async () => {
    const { measure, calls } = measureStub(0);
    const result = await fitDocument(fullRenderModel("signal"), "resume", { measure });
    assert.equal(result.fits, true);
    assert.equal(result.measured, true);
    assert.deepEqual(result.applied, []);
    assert.equal(calls.length, 1);
    assert.match(sheetTag(result.html), /data-fit-verified/);
  });

  it("should walk the ladder in order until the measurement fits", async () => {
    const { measure } = measureStub(3);
    const result = await fitDocument(fullRenderModel("signal"), "coverLetter", { measure });
    assert.equal(result.fits, true);
    assert.deepEqual(result.applied, ["css:tight-1", "css:tight-2", "drop_letter_readouts"]);
    assert.match(sheetTag(result.html), /data-fit="tight-1 tight-2"/);
    assert.doesNotMatch(result.html, /class="letter-readout"/);
  });

  it("should fail loudly and never clip when the ladder runs out", async () => {
    const { measure } = measureStub(Number.POSITIVE_INFINITY);
    const result = await fitDocument(fullRenderModel("editorial"), "coverLetter", { measure });
    assert.equal(result.fits, false);
    assert.equal(result.overflow, true);
    const tag = sheetTag(result.html);
    assert.match(tag, /data-overflow/);
    assert.doesNotMatch(tag, /data-fit-verified/, "an overflowing sheet grows instead of clipping");
    assert.deepEqual(result.applied, resolveFamily("editorial").fit.letterLadder);
  });

  it("should trim a resume content-first, ending with the family's tail before losing an employer", async () => {
    const { measure } = measureStub(Number.POSITIVE_INFINITY);
    const result = await fitDocument(fullRenderModel("signal"), "resume", { measure });
    const tailAt = result.applied.indexOf("drop_section:ventures");
    const finalAt = result.applied.indexOf(FINAL_RESUME_STEP);
    assert.ok(tailAt > result.applied.indexOf("drop_earlier_line"));
    assert.ok(finalAt === -1 || finalAt > tailAt);
    assert.equal(result.overflow, true);
  });

  it("should render unclipped and say so when nothing measured it", async () => {
    const result = await fitDocument(fullRenderModel("dossier"), "resume", {});
    assert.equal(result.measured, false);
    assert.equal(result.fits, false);
    assert.doesNotMatch(sheetTag(result.html), /data-fit-verified/);
  });

  it("should keep the resume inside the family's soft visible-word budget", async () => {
    const model = fullRenderModel("signal");
    const experience = model.documents.resume.sections.find((s) => s.kind === "experience");
    const long = "Wrote the bidding and attribution framework used in QBRs across every market and every channel we sold. ".repeat(6);
    for (const entry of experience.entries) {
      entry.bullets = [0, 1, 2, 3].map(() => ({ claimId: entry.bullets[0].claimId, runs: [{ t: long }] }));
    }
    const result = await fitDocument(model, "resume", {});
    assert.ok(result.applied.includes("drop_weakest_bullet"));
  });
});
