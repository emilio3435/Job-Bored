/* HOLES lane SCORE · the legacy draft modal (resume-generation.js).

   U5: typing in the draft never starts a paid score; the modal opening on
       a finished draft is the one automatic start.
   U10: the modal opens and closes through JobBoredA11y.dialog — focus
       moves in, the page behind goes inert, Esc closes, focus returns.
   U11: the ATS card is one grade button in the header; its scorecard opens
       in the score modal, whose Fix this fills Refine, and whose Esc closes
       only itself. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { click, keydown, load, makeScoreEnv, text } from "./fixtures/holes-score-dom.mjs";

const JOB = { title: "Senior PM", company: "Meridian Labs" };
const LETTER = "Dear Meridian Labs team,\nSix years turning pricing data into roadmaps.";

function boot() {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  const doc = win.document;
  const el = (tag, attrs = {}, parent = doc.body) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent.appendChild(n);
    return n;
  };
  const page = el("main", { id: "page" });
  const opener = el("button", { id: "opener" }, page);
  const modal = el("div", { id: "resumeGenerateModal", role: "dialog", "aria-modal": "true" });
  modal.style.display = "none";
  const head = el("header", {}, modal);
  el("h3", { id: "resumeGenerateTitle" }, head);
  const slot = el("p", { id: "resumeGenerateAtsCard", hidden: "" }, head);
  el("span", { id: "resumeGenerateAtsGrade" }, slot);
  el("span", { id: "resumeGenerateAtsStatus" }, slot);
  el("button", { id: "resumeGenerateClose" }, head);
  const output = el("textarea", { id: "resumeGenerateOutput" }, modal);
  const insights = el("div", { id: "resumeGenerateInsights", hidden: "" }, modal);
  el("section", { id: "resumeGenerateHistoryCard", hidden: "" }, insights);
  el("textarea", { id: "resumeGenerateFeedback" }, modal);

  let atsState = { cacheKey: "", status: "idle", result: null, error: "", payload: null };
  const starts = [];
  win.setTimeout = (fn) => { fn(); return 1; };
  win.clearTimeout = () => {};
  win.JobBoredApp = {
    core: {
      host: {
        escapeHtml: (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
        fillVisualThemeSelect() {},
        showToast() {},
      },
    },
    materialsState: {
      getUserContent: () => null,
      getAtsScorecardState: () => atsState,
      setAtsScorecardState: (s) => { atsState = s; },
      getDraftsForJob: () => [],
    },
    ats: {
      computeAtsScorecardCacheKey: (t, job, feature) => (job && job.title && job.company ? `${feature}|${job.company}|${t.length}` : ""),
      buildAtsScorecardRequestPayload: (t, job) => ({ docText: t, job: { title: job.title, company: job.company } }),
      startAtsScorecardAnalysis: (cacheKey, payload, job) => {
        starts.push({ cacheKey, job });
        atsState = { cacheKey, status: "loading", result: null, error: "", payload };
      },
    },
  };
  load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js", "resume-generation.js"]);
  const rg = win.JobBoredApp.resumeGeneration;
  rg.setLastResumeGenerationSession({ job: JOB, feature: "cover_letter", text: LETTER });
  const land = (result) => {
    atsState = { ...atsState, status: "success", result, error: "" };
    rg.renderResumeGenerateInsights(output.value, JOB);
  };
  return { win, doc, rg, modal, page, opener, output, slot, starts, land, state: () => atsState };
}

async function openDraft(env) {
  env.opener.focus();
  await env.rg.openResumeGenerateModal("Cover letter", "", LETTER, false, "cover_letter", null, JOB);
}

describe("U5 · typing never starts a paid score", () => {
  it("should score a finished draft once on open, and never from the editor's input", async () => {
    const env = boot();
    await openDraft(env);
    assert.equal(env.starts.length, 1, "the open is the one automatic start");
    env.output.value = LETTER + " I also mentor.";
    env.output.dispatchEvent({ type: "input", target: env.output, bubbles: true });
    env.rg.renderResumeGenerateInsights(env.output.value, JOB);
    assert.equal(env.starts.length, 1, "editing and re-rendering start nothing");
  });

  it("should start nothing while the draft is still generating", async () => {
    const env = boot();
    await env.rg.openResumeGenerateModal("Cover letter", "Writing…", "", true, "cover_letter", null, JOB);
    assert.equal(env.starts.length, 0);
  });
});

describe("U10 · the draft modal is a real dialog", () => {
  it("should move focus in, inert the page, close on Esc and give focus back", async () => {
    const env = boot();
    await openDraft(env);
    assert.equal(env.modal.style.display, "flex");
    assert.ok(env.modal.contains(env.doc.activeElement), "focus moved into the modal");
    assert.equal(env.page.inert, true, "the page behind is inert");
    env.doc.dispatchEvent(keydown(env.doc.body, "Escape"));
    assert.equal(env.modal.style.display, "none", "Esc closed it");
    assert.equal(env.doc.activeElement, env.opener, "focus went back to the opener");
    assert.equal(env.page.inert, false, "the page is live again");
  });

  it("should close through the same dialog from closeResumeGenerateModal", async () => {
    const env = boot();
    await openDraft(env);
    env.rg.closeResumeGenerateModal();
    assert.equal(env.modal.style.display, "none");
    assert.equal(env.doc.activeElement, env.opener);
  });
});

describe("U11 · the ATS card is a grade button in the header", () => {
  it("should show only the grade button once the score lands, and Scoring… before", async () => {
    const env = boot();
    await openDraft(env);
    assert.equal(env.slot.hidden, false);
    assert.match(text(env.slot), /Scoring…/);
    env.land({ overallScore: 88, criticalGaps: [{ gap: "No pricing work named", whyItMatters: "The role is pricing.", severity: "high" }] });
    const btn = env.slot.querySelector("[data-score-open]");
    assert.ok(btn, "the header holds the grade button");
    assert.equal(btn.getAttribute("aria-label"), "Grade B+, 88 of 100 — open score details");
    assert.doesNotMatch(text(env.slot), /No pricing work named|Priority fix|confidence/);
  });

  it("should mark the grade stale, not rescore, once the text moves on", async () => {
    const env = boot();
    await openDraft(env);
    env.land({ overallScore: 88 });
    env.output.value = LETTER + " More.";
    env.rg.renderResumeGenerateInsights(env.output.value, JOB);
    assert.equal(env.slot.querySelector("[data-score-open]").getAttribute("data-stale"), "true");
    assert.equal(env.starts.length, 1);
  });

  it("should open the score modal, and Fix this fills Refine", async () => {
    const env = boot();
    await openDraft(env);
    env.land({ overallScore: 70, criticalGaps: [{ gap: "No pricing work named", whyItMatters: "The role is pricing.", severity: "high" }] });
    const btn = env.slot.querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const score = env.doc.querySelector(".jb-score");
    assert.ok(score, "the score modal opened");
    const fix = score.querySelector("[data-score-fix]");
    assert.ok(fix, "the gap offers Fix this");
    fix.dispatchEvent(click(fix));
    const fb = env.doc.getElementById("resumeGenerateFeedback");
    assert.match(fb.value, /pricing/);
    assert.equal(env.doc.activeElement, fb, "focus lands in Refine");
    assert.equal(env.modal.style.display, "flex", "the draft modal stays open");
  });

  it("should let Esc in the score modal close only the score modal", async () => {
    const env = boot();
    await openDraft(env);
    /* materials-feature.js's page-wide Esc closes the draft modal. */
    env.doc.addEventListener("keydown", (e) => { if (e.key === "Escape") env.rg.closeResumeGenerateModal(); });
    env.land({ overallScore: 70 });
    const btn = env.slot.querySelector("[data-score-open]");
    btn.dispatchEvent(click(btn));
    const score = env.doc.querySelector(".jb-score");
    const inside = env.doc.activeElement && score.contains(env.doc.activeElement) ? env.doc.activeElement : score;
    inside.dispatchEvent(keydown(inside, "Escape"));
    assert.equal(env.doc.querySelector(".jb-score"), null, "the score modal closed");
    assert.equal(env.modal.style.display, "flex", "the draft modal stayed open");
  });
});
