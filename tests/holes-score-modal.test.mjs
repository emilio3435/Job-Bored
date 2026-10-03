/* holes-score-modal.test.mjs — HOLES lane SCORE's modal, spec §0.3 and
   §2 SCORE, as GRADE re-scoped it (SPEC-GRADE D7).

   The quality-check modal: everything the reviews said, behind the
   verdict button.
     header  the verdict word, its first reason and who reviewed it
             (no letter, no dial, no "N of 100"); a stale badge
     steps   Why (each deciding check with Fix this), Coverage, Writing,
             Reviews, Versions — then the ATS check's rewrite suggestions
             (each with Apply) and keyword coverage when there are some —
             revealed one step at a time
     footer  Repair, Rescore (with a busy state), Close
   It opens through JobBoredA11y.dialog (focus inside, background inert,
   Esc closes it, focus returns), wraps Tab, and announces a verdict that
   lands — in words, never a number. Closes U6 (Fix this, rewrite
   suggestions shown), U16 (every flag listed) and the dead-modal half of
   U3/U10.

   Harness: tests/fixtures/holes-score-dom.mjs — jb-dom plus a parsing
   innerHTML, with the shipped jb-a11y.js. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { V1_RESUME_FAIL } from "./fixtures/materials-qa-v2.mjs";
import { RUNS_REPAIR_PASSED, V3_READY, V3_UNSUPPORTED } from "./fixtures/materials-qa-v3.mjs";
import { click, keydown, load, makeScoreEnv, read, text } from "./fixtures/holes-score-dom.mjs";

const ATS = {
  schemaVersion: 1,
  overallScore: 72,
  dimensionScores: { requirementsCoverage: 70, experienceRelevance: 80, impactClarity: 64, atsParseability: 90, toneFit: 75 },
  topStrengths: ["Owns pricing from research to launch."],
  criticalGaps: [{ gap: "No marketplace pricing work shown.", whyItMatters: "The role prices a two-sided marketplace.", severity: "high" }],
  evidence: [],
  rewriteSuggestions: [
    { targetSection: "Summary", before: "Product manager.", after: "Pricing product manager who ships usage-based plans.", rationale: "Leads with the role's core." },
    { targetSection: "Contoso", before: "", after: "Rebuilt the renewal pricing review.", rationale: "Specific and supported." },
  ],
  confidence: 0.8,
  model: "ats-model-1",
};

const CAN = { fix: true, apply: true, repair: true, rescore: true, promote: true };
const LETTER = { status: "fail", issues: [], qa: { ...V3_UNSUPPORTED, qualificationGaps: ["No marketplace experience on file."] } };

function boot() {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js"]);
  return win;
}

function letterData(over = {}) {
  return { feature: "cover_letter", role: "Dispatch analyst · Acme Robotics", qualityDoc: LETTER, ats: { result: ATS, feature: "cover_letter", storedAt: "2026-10-02T10:00:00.000Z" }, keywords: { matched: ["dispatch", "forecast"], missing: ["mentoring"], total: 3 }, can: CAN, ...over };
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

  it("should hold the verdict header, the steps in order and the footer", () => {
    const html = ms.modalHtml(ms.modelOf(letterData()));
    assert.match(html, /^<div class="jb-score"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="(jb-score-title-\d+)"/);
    const title = /aria-labelledby="(jb-score-title-\d+)"/.exec(html)[1];
    assert.match(html, new RegExp(`id="${title}"[\\s\\S]*?Cover letter[\\s\\S]*?Fails`));
    assert.match(html, /class="jb-score__verdict"[^>]*>1 claim needs a source</);
    assert.doesNotMatch(html, /jb-score__letter|jb-score__dial|\/ 100|of 100/);
    const steps = [...html.matchAll(/data-step="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(steps, ["why", "coverage", "writing", "reviews", "versions", "rewrites", "keywords"]);
    for (const title of ["Why", "Coverage", "Writing", "Reviews", "Versions", "Rewrite suggestions", "Keyword coverage"]) {
      assert.match(html, new RegExp(`class="jb-score__step-title">${title}<`), `${title} is a step`);
    }
    const foot = /<footer class="jb-score__foot"[\s\S]*<\/footer>/.exec(html)[0];
    assert.deepEqual([...foot.matchAll(/data-score-(repair|rescore|close)/g)].map((m) => m[1]), ["repair", "rescore", "close"]);
  });

  it("should leave out the ATS steps when the ATS check suggested nothing", () => {
    const html = ms.modalHtml(ms.modelOf(letterData({ ats: null, keywords: null })));
    const steps = [...html.matchAll(/data-step="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(steps, ["why", "coverage", "writing", "reviews", "versions"]);
  });

  it("should name who reviewed it, never 'judge'", () => {
    const html = ms.modalHtml(ms.modelOf(letterData()));
    const line = /class="jb-score__prov"[^>]*>([^<]*)/.exec(html)[1];
    assert.equal(line, "First review: writer-example");
    assert.doesNotMatch(html.replace(/judge-example/g, ""), />[^<]*\bjudge\b/i, "our own words never say judge");
  });

  it("should give every deciding check and background gap a Fix this (U6)", () => {
    const step = stepOf(win, ms.modalHtml(ms.modelOf(letterData())), "why");
    /* the unsupported claim and one background gap */
    assert.equal(step.querySelectorAll(".jb-score__item").length, 2);
    const fixes = step.querySelectorAll("[data-score-fix]");
    assert.equal(fixes.length, 2);
    assert.ok(fixes.every((b) => text(b) === "Fix this"));
    assert.match(text(step), /I built a dispatch forecast at Acme Robotics\./, "the check quotes its sentence");
    assert.match(text(step), /No marketplace experience on file\./);
    assert.doesNotMatch(text(step), /No marketplace pricing work shown/, "the ATS check's gaps are not the verdict's");
  });

  it("should show every rewrite suggestion with an Apply (U6)", () => {
    const step = stepOf(win, ms.modalHtml(ms.modelOf(letterData())), "rewrites");
    const applies = step.querySelectorAll("[data-score-apply]");
    assert.equal(applies.length, 2);
    assert.ok(applies.every((b) => text(b) === "Apply"));
    assert.match(text(step), /Pricing product manager who ships usage-based plans\./);
    assert.match(text(step), /Leads with the role's core\./);
  });

  it("should fill Writing from the first review and Keyword coverage from the posting, with no Role match meters", () => {
    const html = ms.modalHtml(ms.modelOf(letterData()));
    const writing = stepOf(win, html, "writing");
    assert.equal(writing.querySelectorAll(".jb-score__dim").length, 5, "the five dimensions, 0–4 each");
    assert.match(text(writing), /Fits this role/);
    const kw = stepOf(win, html, "keywords");
    assert.match(text(kw), /2 of 3/);
    assert.match(text(kw), /mentoring/);
    assert.doesNotMatch(html, /Role match|Requirements covered|Reads cleanly for screeners/);
  });

  it("should list every flag, never the first one and a count (U16)", () => {
    const flagged = { ...V1_RESUME_FAIL, issues: [
      { code: "resume_experience_missing", message: "Resume is missing an experience section.", severity: "fail" },
      { code: "underfill", message: "The page is half full.", severity: "review" },
      { code: "metric_dropped", message: "A number from your background was dropped.", severity: "review" },
    ] };
    const html = ms.modalHtml(ms.modelOf({ feature: "resume", qualityDoc: flagged, can: CAN }));
    const step = text(stepOf(win, html, "why"));
    for (const msg of ["Resume is missing an experience section.", "The page is half full.", "A number from your background was dropped."]) {
      assert.ok(step.includes(msg), `"${msg}" is listed`);
    }
    assert.doesNotMatch(html, /\+\d+ more/);
  });

  it("should badge a verdict the draft has moved on from", () => {
    const fresh = ms.modalHtml(ms.modelOf(letterData()));
    assert.doesNotMatch(fresh, /jb-score__badge--stale/);
    const stale = ms.modalHtml(ms.modelOf(letterData({ stale: true })));
    assert.match(stale, /class="jb-score__badge jb-score__badge--stale"[^>]*>Changed since graded</);
  });

  it("should explain why when nothing graded it", () => {
    const html = ms.modalHtml(ms.modelOf({ feature: "resume", qualityDoc: undefined, ats: null, can: CAN }));
    assert.match(html, /class="jb-score__word"[^>]*>Not graded</);
    assert.match(html, /Nothing has checked this draft yet/);
  });

  it("should read a saved-but-unscored version as Not rescored, never as a Fail", () => {
    const stub = { status: "review", issues: [], qa: { disposition: "REVIEW", dispositionReason: "This version was rendered from a stored model; draft evidence was not rescored.", rubric: { score: 0, max: 1, threshold: 1, rows: [{ id: "version_recheck", score: 0, max: 1 }] } } };
    const v = ms.verdictView(stub);
    assert.equal(v.word, "Not rescored");
    assert.equal(v.disposition, null);
    assert.match(ms.modalHtml(ms.modelOf({ feature: "resume", qualityDoc: stub, can: CAN })), /Not rescored — Rescore/);
  });

  it("should mark Rescore busy while a verdict is on its way", () => {
    const html = ms.modalHtml(ms.modelOf(letterData()), { busy: true });
    assert.match(html, /<button[^>]*data-score-rescore[^>]*aria-busy="true"[^>]*aria-disabled="true"[^>]*>[\s\S]*?Rescoring/);
  });

  it("should leave out the actions the host cannot take", () => {
    const html = ms.modalHtml(ms.modelOf(letterData({ can: {} })));
    assert.doesNotMatch(html, /data-score-(fix|apply|repair|rescore)/);
    assert.match(html, /data-score-close/);
  });

  it("should escape what the reviews and the ATS check wrote", () => {
    const evil = { ...LETTER, qa: { ...LETTER.qa, checks: [{ ...LETTER.qa.checks[0], detail: '<img src=x onerror="boom">' }] } };
    const html = ms.modalHtml(ms.modelOf(letterData({ qualityDoc: evil, ats: { result: { ...ATS, rewriteSuggestions: [{ after: "<b>x</b>" }] } } })));
    assert.doesNotMatch(html, /<img src=x|<b>x<\/b>/);
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
    assert.ok(modal() === null, "Esc closed it");
    assert.equal(main.inert, false, "the page is live again");
    assert.ok(doc.activeElement === opener, "focus went back to the verdict button");
  });

  it("should keep Tab inside the modal", () => {
    const { doc, modal } = openFor();
    const buttons = modal().querySelectorAll("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last.focus();
    last.dispatchEvent(keydown(last, "Tab"));
    assert.ok(doc.activeElement === first, "Tab from the last control wraps to the first");
    first.dispatchEvent(keydown(first, "Tab", { shiftKey: true }));
    assert.ok(doc.activeElement === last, "Shift+Tab from the first wraps to the last");
  });

  it("should run Rescore once, show busy, and announce the verdict in words when it lands", async () => {
    let calls = 0;
    let finish;
    const env = openFor({}, { rescore: () => { calls += 1; return new Promise((r) => { finish = r; }); } });
    const btn = () => env.modal().querySelector("footer [data-score-rescore]");
    btn().dispatchEvent(click(btn()));
    assert.equal(calls, 1);
    assert.equal(btn().getAttribute("aria-busy"), "true");
    btn().dispatchEvent(click(btn()));
    assert.equal(calls, 1, "a second click while busy starts nothing");
    env.setData(letterData({ qualityDoc: { status: "pass", issues: [], qa: V3_READY } }));
    finish();
    await new Promise((r) => setImmediate(r));
    assert.equal(btn().getAttribute("aria-busy"), "false");
    assert.equal(text(env.modal().querySelector(".jb-score__word")), "Ready");
    const live = env.doc.querySelector('[data-jb-a11y-live="polite"]');
    assert.ok(live, "an announcement was made");
    assert.equal(live.textContent, "Rescored: Ready.");
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
    assert.match(seen[0][1], /No source for this result/);
    assert.equal(seen[0][2], "i1", "the check's own issue id travels with it");
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

  it("should reveal one step at a time and read Versions when its step opens", async () => {
    let loads = 0;
    let land;
    const env = openFor({}, { loadHistory: () => { loads += 1; return new Promise((r) => { land = r; }); } });
    const step = (id) => env.modal().querySelector(`[data-step="${id}"]`);
    const toggle = (id) => step(id).querySelector("[data-score-step]");
    const panel = (id) => step(id).querySelector(".jb-score__panel");
    assert.equal(toggle("why").getAttribute("aria-expanded"), "true", "the first step with something in it starts open");
    assert.equal(panel("why").hidden, false);
    assert.equal(toggle("versions").getAttribute("aria-expanded"), "false");
    assert.equal(panel("versions").hidden, true);
    toggle("versions").dispatchEvent(click(toggle("versions")));
    assert.equal(toggle("versions").getAttribute("aria-expanded"), "true");
    assert.equal(loads, 1);
    assert.match(text(panel("versions")), /Loading/);
    land(RUNS_REPAIR_PASSED);
    await new Promise((r) => setImmediate(r));
    assert.match(text(panel("versions")), /Default/);
    assert.equal(env.modal().querySelectorAll(".jb-ver__run").length, 2);
    assert.equal(toggle("why").getAttribute("aria-expanded"), "true", "a refresh keeps the open steps open");
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

  it("GRADE-F D7: the verdict button is a text chip whose reason truncates, not a ring", () => {
    assert.doesNotMatch(css, /jb-grade__ring|jb-score__dial|jb-score__letter/);
    assert.match(css, /\.jb-grade\[data-tone\] \.jb-grade__reason \{[^}]*text-overflow: ellipsis/);
  });
});
