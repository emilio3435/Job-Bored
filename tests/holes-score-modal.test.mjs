/* holes-score-modal.test.mjs — HOLES lane SCORE, spec §0.3 and §2 SCORE.

   The score modal: everything the graders said, behind the grade button.
     header  grade, score, one-line verdict, who graded it and which
             version, a stale badge when the draft changed since
     steps   Blockers and gaps (each with Fix this), Dimensions, Evidence,
             Rewrite suggestions (each with Apply), Keyword coverage,
             History — revealed one step at a time
     footer  Repair, Rescore (with a busy state), Close
   It opens through JobBoredA11y.dialog (focus inside, background inert,
   Esc closes it, focus returns), wraps Tab, and announces a score that
   lands. Closes U6 (Fix this on gaps, rewrite suggestions shown), U16
   (every flag listed) and the dead-modal half of U3/U10.

   Harness: tests/fixtures/holes-score-dom.mjs — jb-dom plus a parsing
   innerHTML, with the shipped jb-a11y.js. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { V1_RESUME_FAIL, V2_LETTER_FAIL } from "./fixtures/materials-qa-v2.mjs";
import { click, keydown, load, makeScoreEnv, read, text } from "./fixtures/holes-score-dom.mjs";

const ATS = {
  schemaVersion: 1,
  overallScore: 72,
  dimensionScores: { requirementsCoverage: 70, experienceRelevance: 80, impactClarity: 64, atsParseability: 90, toneFit: 75 },
  topStrengths: ["Owns pricing from research to launch."],
  criticalGaps: [
    { gap: "No marketplace pricing work shown.", whyItMatters: "The role prices a two-sided marketplace.", severity: "high" },
    { gap: "Team size is unclear.", whyItMatters: "They want a lead for 10+.", severity: "low" },
  ],
  evidence: [{ claim: "Shipped usage-based pricing.", sourceSnippet: "lifted expansion revenue 18%", sourceType: "resume" }],
  rewriteSuggestions: [
    { targetSection: "Summary", before: "Product manager.", after: "Pricing product manager who ships usage-based plans.", rationale: "Leads with the role's core." },
    { targetSection: "Contoso", before: "", after: "Rebuilt the renewal pricing review.", rationale: "Specific and supported." },
  ],
  confidence: 0.8,
  model: "ats-model-1",
};

const RUNS = [
  { runId: "r3", date: "2026-09-28T09:00:00.000Z", documents: ["cover_letter"], verdicts: { cover_letter: { disposition: "FAIL", score: 64, max: 100 } }, active: ["cover_letter"], template: "signal", source: "draft" },
  { runId: "r2", date: "2026-09-27T09:00:00.000Z", documents: ["cover_letter"], verdicts: { cover_letter: { disposition: "READY", score: 88, max: 100 } }, active: [], template: "signal", source: "edit" },
];

const CAN = { fix: true, apply: true, repair: true, rescore: true, promote: true };

function boot() {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js"]);
  return win;
}

function letterData(over = {}) {
  return { feature: "cover_letter", role: "Senior PM · Meridian Labs", qualityDoc: V2_LETTER_FAIL, ats: { result: ATS, feature: "cover_letter", storedAt: "2026-09-28T10:00:00.000Z" }, coverage: { matched: ["pricing", "roadmap"], missing: ["marketplace"], total: 3 }, can: CAN, ...over };
}

/* Parse the markup with the harness parser so a step is a node, not a regex slice. */
function stepOf(win, html, id) {
  const box = win.document.createElement("div");
  box.innerHTML = html;
  const step = box.querySelector(`[data-step="${id}"]`);
  assert.ok(step, `step ${id} renders`);
  return step;
}

describe("modalHtml · what the modal holds", () => {
  const win = boot();
  const ms = win.JobBoredMaterialsScore;

  it("should hold the header, the six steps in order and the footer", () => {
    const html = ms.modalHtml(ms.modelOf(letterData()));
    assert.match(html, /^<div class="jb-score"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="(jb-score-title-\d+)"/);
    const title = /aria-labelledby="(jb-score-title-\d+)"/.exec(html)[1];
    assert.match(html, new RegExp(`id="${title}"[^>]*>[\\s\\S]*?Cover letter grade`));
    assert.match(html, /class="jb-score__letter"[^>]*>D</, "64 with a FAIL verdict reads D");
    assert.match(html, /64 \/ 100/);
    assert.match(html, /One sentence claims a result your background doesn(?:'|&#39;|’)t support\./, "the verdict line is the grader's own");
    const steps = [...html.matchAll(/data-step="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(steps, ["blockers", "dimensions", "evidence", "rewrites", "keywords", "history"]);
    for (const title of ["Blockers and gaps", "Dimensions", "Evidence", "Rewrite suggestions", "Keyword coverage", "History"]) {
      assert.match(html, new RegExp(`class="jb-score__step-title">${title}<`), `${title} is a step`);
    }
    const foot = /<footer class="jb-score__foot"[\s\S]*<\/footer>/.exec(html)[0];
    assert.deepEqual([...foot.matchAll(/data-score-(repair|rescore|close)/g)].map((m) => m[1]), ["repair", "rescore", "close"]);
  });

  it("should name who graded it and which version", () => {
    const html = ms.modalHtml(ms.modelOf(letterData()));
    assert.match(html, /class="jb-score__judge"[^>]*>[^<]*Graded by grok-judge-1[^<]*judge\.v1/);
  });

  it("should give every blocker and gap a Fix this (U6)", () => {
    const step = stepOf(win, ms.modalHtml(ms.modelOf(letterData())), "blockers");
    /* three judge issues, two background gaps, two role-match gaps */
    assert.equal(step.querySelectorAll(".jb-score__item").length, 7);
    const fixes = step.querySelectorAll("[data-score-fix]");
    assert.equal(fixes.length, 7);
    assert.ok(fixes.every((b) => text(b) === "Fix this"));
    assert.match(text(step), /At Contoso I cut churn by 40% across the enterprise book\./, "the blocker quotes its sentence");
    assert.match(text(step), /No marketplace pricing work shown\./);
    assert.match(text(step), /No marketplace experience on file\./);
  });

  it("should show every rewrite suggestion with an Apply (U6)", () => {
    const step = stepOf(win, ms.modalHtml(ms.modelOf(letterData())), "rewrites");
    const applies = step.querySelectorAll("[data-score-apply]");
    assert.equal(applies.length, 2);
    assert.ok(applies.every((b) => text(b) === "Apply"));
    assert.match(text(step), /Pricing product manager who ships usage-based plans\./);
    assert.match(text(step), /Leads with the role's core\./);
  });

  it("should fill Dimensions, Evidence and Keyword coverage from the graders", () => {
    const html = ms.modalHtml(ms.modelOf(letterData()));
    const dims = stepOf(win, html, "dimensions");
    assert.equal(dims.querySelectorAll(".jb-score__dim").length, 10, "five judge dimensions and five role-match ones");
    assert.match(text(dims), /Fits this role/);
    const ev = stepOf(win, html, "evidence");
    assert.match(text(ev), /lifted expansion revenue 18%/);
    assert.match(text(ev), /Owns pricing from research to launch\./);
    const kw = stepOf(win, html, "keywords");
    assert.match(text(kw), /2 of 3/);
    assert.match(text(kw), /marketplace/);
  });

  it("should list every flag, never the first one and a count (U16)", () => {
    const flagged = { ...V1_RESUME_FAIL, issues: [
      { code: "resume_experience_missing", message: "Resume is missing an experience section.", severity: "fail" },
      { code: "underfill", message: "The page is 48% full.", severity: "review" },
      { code: "metric_dropped", message: "A number from your background was dropped.", severity: "review" },
    ] };
    const html = ms.modalHtml(ms.modelOf({ feature: "resume", qualityDoc: flagged, can: CAN }));
    const step = text(stepOf(win, html, "blockers"));
    for (const msg of ["Resume is missing an experience section.", "The page is 48% full.", "A number from your background was dropped."]) {
      assert.ok(step.includes(msg), `"${msg}" is listed`);
    }
    assert.doesNotMatch(html, /\+\d+ more/);
  });

  it("should badge a grade the draft has moved on from", () => {
    const fresh = ms.modalHtml(ms.modelOf(letterData()));
    assert.doesNotMatch(fresh, /jb-score__badge--stale/);
    const stale = ms.modalHtml(ms.modelOf(letterData({ stale: true })));
    assert.match(stale, /class="jb-score__badge jb-score__badge--stale"[^>]*>Changed since graded</);
  });

  it("should explain why when nothing graded it", () => {
    const html = ms.modalHtml(ms.modelOf({ feature: "resume", qualityDoc: undefined, ats: null, can: CAN }));
    assert.match(html, /class="jb-score__letter"[^>]*>Grade</);
    assert.match(html, /Not graded/);
    assert.match(html, /Nothing has graded this draft yet/);
  });

  it("should read a saved-but-unscored version as ungraded, never as an F", () => {
    const stub = { status: "review", issues: [], qa: { disposition: "REVIEW", dispositionReason: "This version was rendered from a stored model; draft evidence was not rescored.", rubric: { score: 0, max: 1, threshold: 1, rows: [{ id: "version_recheck", score: 0, max: 1 }] } } };
    const g = ms.gradeOf(stub, null);
    assert.equal(g.letter, "Grade");
    assert.equal(g.score, null);
    assert.match(g.why, /not rescored|without a grade/i);
  });

  it("should mark Rescore busy while a score is on its way", () => {
    const html = ms.modalHtml(ms.modelOf(letterData()), { busy: true });
    assert.match(html, /<button[^>]*data-score-rescore[^>]*aria-busy="true"[^>]*aria-disabled="true"[^>]*>[\s\S]*?Rescoring/);
  });

  it("should leave out the actions the host cannot take", () => {
    const html = ms.modalHtml(ms.modelOf(letterData({ can: {} })));
    assert.doesNotMatch(html, /data-score-(fix|apply|repair|rescore)/);
    assert.match(html, /data-score-close/);
  });

  it("should escape what the graders wrote", () => {
    const evil = { ...ATS, criticalGaps: [{ gap: '<img src=x onerror="boom">', whyItMatters: "x", severity: "high" }] };
    const html = ms.modalHtml(ms.modelOf(letterData({ ats: evil })));
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  });
});

describe("open() · the modal as a dialog", () => {
  function openFor(over = {}, actions = {}) {
    const win = boot();
    const doc = win.document;
    const main = doc.createElement("main");
    const opener = doc.createElement("button");
    opener.setAttribute("data-score-open", "");
    main.appendChild(opener);
    doc.body.appendChild(main);
    opener.focus();
    let data = letterData(over);
    const handle = win.JobBoredMaterialsScore.open({ opener, read: () => data, ...actions });
    const modal = () => doc.querySelector(".jb-score");
    return { win, doc, main, opener, handle, modal, setData: (d) => { data = d; } };
  }

  it("should open through JobBoredA11y.dialog: focus inside, background inert, Esc back to the opener", () => {
    const { doc, main, opener, modal } = openFor();
    const el = modal();
    assert.ok(el, "the modal is in the page");
    assert.equal(el.getAttribute("role"), "dialog");
    assert.ok(el.contains(doc.activeElement), "focus moved into the modal");
    assert.equal(main.inert, true, "the page behind is inert");
    doc.activeElement.dispatchEvent(keydown(doc.activeElement, "Escape"));
    assert.equal(modal(), null, "Esc closed it");
    assert.equal(main.inert, false, "the page is live again");
    assert.equal(doc.activeElement, opener, "focus went back to the grade button");
  });

  it("should keep Tab inside the modal", () => {
    const { doc, modal } = openFor();
    const buttons = modal().querySelectorAll("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last.focus();
    const ev = keydown(last, "Tab");
    last.dispatchEvent(ev);
    assert.equal(doc.activeElement, first, "Tab from the last control wraps to the first");
    first.dispatchEvent(keydown(first, "Tab", { shiftKey: true }));
    assert.equal(doc.activeElement, last, "Shift+Tab from the first wraps to the last");
  });

  it("should run Rescore once, show busy, and announce the score when it lands", async () => {
    let calls = 0;
    let finish;
    const env = openFor({}, { rescore: () => { calls += 1; return new Promise((r) => { finish = r; }); } });
    const btn = () => env.modal().querySelector("[data-score-rescore]");
    btn().dispatchEvent(click(btn()));
    assert.equal(calls, 1);
    assert.equal(btn().getAttribute("aria-busy"), "true");
    btn().dispatchEvent(click(btn()));
    assert.equal(calls, 1, "a second click while busy starts nothing");
    env.setData(letterData({ qualityDoc: { qa: { contract: "materials.qa.v2", disposition: "READY", quality: { score: 88, ratings: [] } } } }));
    finish();
    await new Promise((r) => setImmediate(r));
    assert.equal(btn().getAttribute("aria-busy"), "false");
    assert.match(text(env.modal().querySelector(".jb-score__letter")), /^B\+$/);
    const live = env.doc.querySelector('[data-jb-a11y-live="polite"]');
    assert.ok(live, "an announcement was made");
    assert.equal(live.textContent, "Rescored: grade B+, 88 of 100.");
  });

  it("should close first, then hand Fix this, Apply and Repair to the host", () => {
    const seen = [];
    const env = openFor({}, {
      fix: (item) => seen.push(["fix", item.instruction, item.issueId, !!env.modal()]),
      apply: (s) => seen.push(["apply", s.after, !!env.modal()]),
      repair: () => seen.push(["repair", !!env.modal()]),
    });
    const fix = env.modal().querySelector('[data-score-fix="0"]');
    fix.dispatchEvent(click(fix));
    assert.equal(seen[0][0], "fix");
    assert.match(seen[0][1], /40% churn cut/);
    assert.equal(seen[0][2], "i1", "the blocker's own issue id travels with it");
    assert.equal(seen[0][3], false, "the modal was gone before the host moved focus");

    env.win.JobBoredMaterialsScore.open({ opener: env.opener, read: () => letterData(), apply: (s) => seen.push(["apply", s.after, !!env.modal()]), repair: () => seen.push(["repair", !!env.modal()]) });
    const apply = env.modal().querySelector('[data-score-apply="0"]');
    apply.dispatchEvent(click(apply));
    assert.deepEqual(seen[1], ["apply", "Pricing product manager who ships usage-based plans.", false]);

    env.win.JobBoredMaterialsScore.open({ opener: env.opener, read: () => letterData(), repair: () => seen.push(["repair", !!env.modal()]) });
    const repair = env.modal().querySelector("[data-score-repair]");
    repair.dispatchEvent(click(repair));
    assert.deepEqual(seen[2], ["repair", false]);
  });

  it("should reveal one step at a time and read History when its step opens", async () => {
    let loads = 0;
    let land;
    const env = openFor({}, { loadHistory: () => { loads += 1; return new Promise((r) => { land = r; }); } });
    const step = (id) => env.modal().querySelector(`[data-step="${id}"]`);
    const toggle = (id) => step(id).querySelector("[data-score-step]");
    const panel = (id) => step(id).querySelector(".jb-score__panel");
    assert.equal(toggle("blockers").getAttribute("aria-expanded"), "true", "the first step with something in it starts open");
    assert.equal(panel("blockers").hidden, false);
    assert.equal(toggle("history").getAttribute("aria-expanded"), "false");
    assert.equal(panel("history").hidden, true);
    toggle("history").dispatchEvent(click(toggle("history")));
    assert.equal(toggle("history").getAttribute("aria-expanded"), "true");
    assert.equal(loads, 1);
    assert.match(text(panel("history")), /Loading/);
    land(RUNS);
    await new Promise((r) => setImmediate(r));
    assert.match(text(panel("history")), /In use/);
    assert.equal(env.modal().querySelectorAll(".jb-score__run").length, 2);
    assert.equal(toggle("blockers").getAttribute("aria-expanded"), "true", "a refresh keeps the open steps open");
  });
});

describe("css/materials-score.css · Scribe v2's language, tokens only", () => {
  const css = read("css/materials-score.css");

  it("should go full-screen below 600px", () => {
    const narrow = /@media \(max-width: 599px\) \{([\s\S]*?)\n\}/.exec(css);
    assert.ok(narrow, "a below-600px block exists");
    assert.match(narrow[1], /\.jb-score__card \{[^}]*inset: 0;[^}]*border-radius: 0;/);
    assert.match(narrow[1], /min-height: 44px/, "touch targets grow to 44px");
  });

  it("should still the motion for prefers-reduced-motion", () => {
    const calm = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
    assert.ok(calm, "a reduced-motion block exists");
    assert.match(calm[1], /animation: none/);
    assert.match(calm[1], /transition: none/);
  });

  it("should carry no colour literal", () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });
});
