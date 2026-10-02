/* grade-fe-verdict.test.mjs — GRADE lane W-FE: one verdict view.

   SPEC-GRADE A2/A3: every materials surface renders from ONE pure view of
   the v3 QA record — { disposition, word, reason, tone, runId, stale,
   held, legacy, reviews, coverage } — never a letter, "N of 100" or an
   ATS %. The modal (D7) carries Why, Coverage, Writing, Reviews and
   Versions; the version rows (G6/G7) list both passes of a repaired
   draft with their own verdicts, files and the Held gate.

   Harness: tests/fixtures/holes-score-dom.mjs; records and RunSummary
   lists from W-BE's frozen tests/fixtures/materials-qa-v3.mjs. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as V3 from "./fixtures/materials-qa-v3.mjs";
import { V2_LETTER_FAIL } from "./fixtures/materials-qa-v2.mjs";
import { load, makeScoreEnv, text } from "./fixtures/holes-score-dom.mjs";

function boot() {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js"]);
  return win;
}

const NUMBERS = /\/\s*100|\bof 100\b|\d+\s*%|\bGrade [A-F][+-]?\b/;
const qd = (qa, extra = {}) => ({ status: "pass", issues: [], qa, ...extra });
const ATS = { result: { overallScore: 91, dimensionScores: { requirementsCoverage: 88, experienceRelevance: 90 }, rewriteSuggestions: [], criticalGaps: [{ gap: "No Kubernetes", severity: "high" }], confidence: 0.8 }, feature: "cover_letter", storedAt: "2026-10-02T10:00:00.000Z" };

/* What a reader hears: the text and every aria-label (markup such as a
   meter's inline width is not read). */
function visible(win, html) {
  const box = nodeOf(win, html);
  const labels = [];
  const walk = (n) => { const v = n.getAttribute && n.getAttribute("aria-label"); if (v) labels.push(v); for (const c of n.childNodes || []) walk(c); };
  walk(box);
  return text(box) + " " + labels.join(" ");
}

function nodeOf(win, html) {
  const box = win.document.createElement("div");
  box.innerHTML = html;
  return box;
}

describe("GRADE-F G1 · the verdict view", () => {
  const win = boot();
  const ms = win.JobBoredMaterialsScore;

  it("GRADE-F G1: a failed hard gate with perfect ratings reads Fails · <gate label>", () => {
    const v = ms.verdictView(qd(V3.V3_GATE_FAIL_PERFECT));
    assert.equal(v.disposition, "FAIL");
    assert.equal(v.word, "Fails");
    assert.equal(v.reason, "Tool support");
    assert.equal(v.tone, "err");
    assert.equal(v.runId, V3.V3_GATE_FAIL_PERFECT.runId);
    assert.deepEqual(JSON.parse(JSON.stringify(v.held)), { reason: "Tool support" });
  });

  it("GRADE-F G1: the five A3 states render their words and first reasons", () => {
    const cases = [
      [V3.V3_UNSUPPORTED, "Fails", "1 claim needs a source", "err"],
      [V3.V3_SECOND_DISAGREEMENT, "Needs review", "Reviewers disagree", "warn"],
      [V3.V3_SECOND_OUTAGE, "Ready", "", "ok"],
      [V3.V3_LOW_DIMENSION, "Needs review", "Evidence rated 2 of 4", "warn"],
      [V3.V3_NOT_RESCORED, "Not rescored", "", "none"],
      [V3.V3_READY, "Ready", "", "ok"],
      [V3.V3_REPAIR_STILL_FAILING, "Fails", "1 claim needs a source", "err"],
    ];
    for (const [rec, word, reason, tone] of cases) {
      const v = ms.verdictView(qd(rec));
      assert.equal(v.word, word, `${rec.reasons[0]?.text || rec.disposition} word`);
      assert.equal(v.reason, reason);
      assert.equal(v.tone, tone);
    }
    assert.equal(ms.verdictView(undefined).word, "Not graded");
    assert.equal(ms.verdictView(undefined).tone, "none");
  });

  it("GRADE-F G1: the button face is '<word> · <first reason>', 'Ready' alone, with a sentence aria-label and no number", () => {
    const html = ms.buttonHtml(ms.verdictView(qd(V3.V3_UNSUPPORTED)), { feature: "cover_letter", scope: "row" });
    const b = nodeOf(win, html).querySelector("button");
    assert.equal(b.getAttribute("data-tone"), "err");
    assert.equal(b.getAttribute("data-verdict"), "FAIL");
    assert.equal(b.hasAttribute("data-score-open"), true);
    assert.equal(b.getAttribute("data-grade"), null, "no letter attribute");
    assert.equal(text(b).replace(/\s+/g, " ").trim(), "Fails · 1 claim needs a source");
    assert.equal(b.getAttribute("aria-label"), "Cover letter: Fails — 1 claim needs a source. Open the quality check.");
    const ready = nodeOf(win, ms.buttonHtml(ms.verdictView(qd(V3.V3_READY)), { feature: "resume", stale: true })).querySelector("button");
    assert.equal(text(ready).trim(), "Ready");
    assert.equal(ready.getAttribute("data-stale"), "true");
    assert.equal(ready.getAttribute("aria-label"), "Resume: Ready. Out of date. Open the quality check.");
    const gate = nodeOf(win, ms.buttonHtml(ms.verdictView(qd(V3.V3_GATE_FAIL_PERFECT)), { feature: "cover_letter" })).querySelector("button");
    assert.equal(gate.getAttribute("aria-label"), "Cover letter: Fails — Tool support: Unknown tool. Open the quality check.");
  });

  it("GRADE-F G1: a legacy record shows its stored verdict, 'Graded by the old checker', and never its stored number", () => {
    for (const rec of [V3.LEGACY_V2, V3.V3_LEGACY_V2_VIEW]) {
      const v = ms.verdictView(qd(rec));
      assert.equal(v.word, "Fails");
      assert.equal(v.reason, "Tool support");
      assert.equal(v.legacy, "old_checker");
      const html = ms.modalHtml(ms.modelOf({ feature: "cover_letter", qualityDoc: qd(rec), can: { rescore: true } }));
      assert.match(html, /Graded by the old checker/);
      assert.doesNotMatch(html, /Quality score|\b100\b|\/ 100/);
    }
    const v1 = ms.verdictView(qd(V3.LEGACY_V1));
    assert.equal(v1.word, "Fails");
    assert.equal(v1.reason, "Resume experience missing", "a failed check leads with its name");
    assert.equal(v1.reasonFull, "Resume experience missing: Resume is missing experience");
    assert.doesNotMatch(ms.modalHtml(ms.modelOf({ feature: "resume", qualityDoc: qd(V3.LEGACY_V1) })), /6\/16|6 \/ 16|of 16/);
    const stub = ms.verdictView(qd({ contract: "materials.qa.v1", disposition: "FAIL", rubric: { score: 0, max: 1, rows: [{ id: "version_recheck", score: 0, max: 1 }] } }));
    assert.equal(stub.word, "Not rescored");
  });

  it("GRADE-F G1: an old v2 judge record reads its verdict, not dispositionReason's number", () => {
    const v = ms.verdictView(V2_LETTER_FAIL);
    assert.equal(v.word, "Fails");
    assert.doesNotMatch(v.reason, /\d+ \/ 100|Quality score/);
  });
});

describe("GRADE-F D7 · the modal", () => {
  const win = boot();
  const ms = win.JobBoredMaterialsScore;
  const data = (rec, over = {}) => ({ feature: "cover_letter", role: "Dispatch analyst · Acme Robotics", qualityDoc: qd(rec), ats: ATS, can: { fix: true, repair: true, rescore: true, promote: true, retry: true }, ...over });
  const allOpen = { why: true, coverage: true, writing: true, reviews: true, versions: true };

  it("GRADE-F D7: the head is the verdict word, its first reason and the provenance — no dial, letter or cap note", () => {
    const html = ms.modalHtml(ms.modelOf(data(V3.V3_SECOND_DISAGREEMENT)));
    const el = nodeOf(win, html).querySelector(".jb-score");
    const title = el.querySelector(`#${el.getAttribute("aria-labelledby")}`);
    assert.match(text(title), /Cover letter[\s\S]*Needs review/);
    assert.equal(text(el.querySelector(`#${el.getAttribute("aria-describedby")}`)), "Reviewers disagree");
    assert.match(text(el.querySelector(".jb-score__prov")), /First review: writer-example/);
    assert.match(text(el.querySelector(".jb-score__prov")), /Second review: judge-example/);
    assert.equal(el.querySelector(".jb-score__dial"), null);
    assert.equal(el.querySelector(".jb-score__letter"), null);
    assert.equal(el.querySelector(".jb-score__cap"), null);
    assert.doesNotMatch(visible(win, html), NUMBERS);
  });

  it("GRADE-F D7: the steps are Why, Coverage, Writing, Reviews, Versions in that order, and no Role match meters", () => {
    const html = ms.modalHtml(ms.modelOf(data(V3.V3_GATE_FAIL_PERFECT)), { open: allOpen });
    const steps = [...html.matchAll(/data-step="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(steps.slice(0, 5), ["why", "coverage", "writing", "reviews", "versions"]);
    assert.doesNotMatch(html, /Role match|Requirements covered|No Kubernetes/);
    assert.doesNotMatch(visible(win, html), NUMBERS);
  });

  it("GRADE-F D7: Why lists the deciding checks, grouped, with the flagged sentence and Fix this", () => {
    const box = nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_UNSUPPORTED)), { open: allOpen }));
    const why = box.querySelector('[data-step="why"]');
    assert.match(text(why), /Claims/);
    assert.match(text(why), /Claim needs a source/);
    assert.match(text(why), /No source for this result\./);
    assert.equal(text(why.querySelector(".jb-score__quote")), "I built a dispatch forecast at Acme Robotics.");
    assert.ok(why.querySelector("[data-score-fix]"), "Fix this");
    const gate = nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_GATE_FAIL_PERFECT)), { open: allOpen })).querySelector('[data-step="why"]');
    assert.match(text(gate), /Hard checks[\s\S]*Tool support[\s\S]*Unknown tool\./);
  });

  it("GRADE-F D7: Writing shows the n/4 rows as advisory detail, never a total", () => {
    const box = nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_LOW_DIMENSION)), { open: allOpen }));
    const rows = box.querySelectorAll('[data-step="writing"] .jb-score__dim');
    assert.equal(rows.length, 5);
    assert.match(text(box.querySelector('[data-step="writing"]')), /Evidence[\s\S]*2 \/ 4/);
    assert.match(text(box.querySelector('[data-step="writing"]')), /[Aa]dvisory/);
  });

  it("GRADE-F D7: Reviews names both verdicts on a disagreement", () => {
    const reviews = nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_SECOND_DISAGREEMENT)), { open: allOpen })).querySelector('[data-step="reviews"]');
    assert.match(text(reviews), /Reviewers disagree/);
    assert.match(text(reviews), /First review: writer-example — Fails/);
    assert.match(text(reviews), /Second review: judge-example — Ready/);
  });

  it("GRADE-F D7: a second review that didn't run says why, with Try again and Change grading model", () => {
    const reviews = nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_SECOND_OUTAGE)), { open: allOpen })).querySelector('[data-step="reviews"]');
    assert.match(text(reviews), /Second review didn’t run — it timed out\./);
    assert.ok(reviews.querySelector("[data-score-rescore]"), "Try again re-runs the quality check");
    assert.match(text(reviews.querySelector("[data-score-rescore]")), /Try again/);
    assert.ok(reviews.querySelector('[data-action="settings-open-grading"]'), "Change grading model");
  });

  it("GRADE-F G3: Coverage reads 'Covers N of M requirements; missing: …' from the shown run", () => {
    const cov = nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_COVERAGE_MISSES)), { open: allOpen })).querySelector('[data-step="coverage"]');
    assert.match(text(cov), /Covers 1 of 3 requirements; missing: Team mentoring/);
    assert.doesNotMatch(text(cov), /From an earlier version/);
    const v = ms.verdictView(qd(V3.V3_COVERAGE_MISSES));
    assert.deepEqual({ covered: v.coverage.covered, total: v.coverage.total, missing: v.coverage.missing }, { covered: 1, total: 3, missing: ["Team mentoring"] });
  });

  it("GRADE-F G3: stale coverage says so; a legacy record shows nothing numeric", () => {
    const stale = nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_COVERAGE_MISSES, { stale: true })), { open: allOpen })).querySelector('[data-step="coverage"]');
    assert.match(text(stale), /From an earlier version/);
    const legacy = nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_LEGACY_V2_VIEW)), { open: allOpen })).querySelector('[data-step="coverage"]');
    assert.doesNotMatch(text(legacy), /\d/);
  });

  it("GRADE-F G8: a not-rescored version says 'Not rescored — Rescore'; a carried-over one says the verdict carried over", () => {
    const nr = ms.modalHtml(ms.modelOf(data(V3.V3_NOT_RESCORED)));
    assert.match(text(nodeOf(win, nr)), /Not rescored — Rescore/);
    assert.match(nr, /data-score-rescore/);
    const co = text(nodeOf(win, ms.modalHtml(ms.modelOf(data(V3.V3_CARRIED_OVER)))));
    assert.match(co, /Same text as Oct 2, \d+:\d\d [ap]m — verdict carried over/);
  });
});

describe("GRADE-F G6/G7 · the version rows", () => {
  const win = boot();
  const ms = win.JobBoredMaterialsScore;
  const mi = win.JobBoredMaterialsInsights;
  const rowsOf = (html) => nodeOf(win, html).querySelectorAll("li[data-run]");
  const BASE = "http://127.0.0.1:3847";

  it("GRADE-F G6: a repaired draft lists 'Original draft' and 'Repaired', each with its verdict, Preview and Download", () => {
    const rows = rowsOf(ms.versionsHtml(V3.RUNS_REPAIR_PASSED, "cover_letter", { base: BASE, promote: true }));
    assert.equal(rows.length, 2);
    const [orig, rep] = rows;
    assert.match(text(orig), /Original draft[\s\S]*Fails[\s\S]*1 claim needs a source/);
    assert.match(text(rep), /Repaired[\s\S]*Ready/);
    for (const [row, id] of [[orig, "passing-repair-pass-1"], [rep, "passing-repair"]]) {
      const preview = row.querySelector('[data-action="materials-preview"]');
      const dl = row.querySelector('[data-action="materials-download"]');
      assert.equal(preview.getAttribute("href"), `${BASE}/api/applications/acme/runs/${id}/files/cover-letter.html`);
      assert.equal(dl.getAttribute("href"), `${BASE}/api/applications/acme/runs/${id}/files/cover-letter.pdf?download=1`);
    }
    assert.match(text(rep), /Default/);
    assert.doesNotMatch(text(orig), /Default/);
  });

  it("GRADE-F G7: a held run says 'Held — <reason>' and its Download asks first; the previous good run stays the default", () => {
    const rows = rowsOf(ms.versionsHtml(V3.RUNS_REPAIR_HELD, "cover_letter", { base: BASE, promote: true }));
    const byId = Object.fromEntries([...rows].map((r) => [r.getAttribute("data-run"), r]));
    for (const id of ["failing-repair", "failing-repair-pass-2"]) {
      assert.match(text(byId[id]), /Held — 1 claim needs a source/);
      const dl = byId[id].querySelector('[data-action="materials-download"]');
      assert.equal(dl.getAttribute("data-gate"), "held");
      assert.equal(dl.getAttribute("data-held"), "1 claim needs a source");
      assert.ok(byId[id].querySelector('[data-action="materials-promote"]'), "Use this version");
    }
    assert.match(text(byId["previous-good"]), /Default/);
    assert.equal(byId["previous-good"].querySelector('[data-action="materials-download"]').getAttribute("data-gate"), null);
  });

  it("GRADE-F G6: a manual repair shows its parent's verdict as before → after", () => {
    const rows = rowsOf(ms.versionsHtml(V3.RUNS_MANUAL_REPAIR, "cover_letter", { base: BASE }));
    const repair = [...rows].find((r) => r.getAttribute("data-run") === "manual-repair");
    assert.match(text(repair), /Fails → Ready/);
  });

  it("GRADE-F G8: edited versions say carried over or 'Not rescored — Rescore', with no verdict until rescored", () => {
    const rows = rowsOf(ms.versionsHtml(V3.RUNS_EDITS, "cover_letter", { base: BASE, rescore: true }));
    const byId = Object.fromEntries([...rows].map((r) => [r.getAttribute("data-run"), r]));
    assert.match(text(byId["edit-carried"]), /verdict carried over/);
    assert.match(text(byId["edit-not-rescored"]), /Not rescored — Rescore/);
    assert.doesNotMatch(text(byId["edit-not-rescored"]), /Ready|Fails|Needs review/);
    assert.ok(byId["edit-not-rescored"].querySelector('[data-score-rescore-run="edit-not-rescored"]'), "a Rescore for that version");
  });

  it("GRADE-F G6: legacy runs show the old checker's verdict word and no number; the inline list renders the same rows", () => {
    const html = ms.versionsHtml(V3.RUN_SUMMARIES, "cover_letter", { base: BASE });
    assert.match(text(nodeOf(win, html)), /Graded by the old checker/);
    assert.doesNotMatch(visible(win, html), NUMBERS);
    const inline = mi.historyHtml(V3.RUNS_REPAIR_PASSED, "cover_letter", { base: BASE });
    const ids = [...rowsOf(inline)].map((r) => r.getAttribute("data-run"));
    assert.deepEqual(ids, ["passing-repair-pass-1", "passing-repair"]);
    assert.match(text(nodeOf(win, inline)), /Original draft[\s\S]*Repaired/);
  });

  it("GRADE-F G7: the in-page confirm carries the held copy and data-gate=\"held\"", () => {
    const box = nodeOf(win, mi.failConfirmHtml("cover_letter", { kind: "link", href: "/x.pdf", filename: "cover-letter.pdf" }, { repair: false, held: "1 claim needs a source" })).querySelector(".mat-confirm");
    assert.equal(box.getAttribute("role"), "alertdialog");
    assert.equal(box.getAttribute("data-gate"), "held");
    assert.equal(text(box.querySelector(".mat-confirm__q")), "This version is held — 1 claim needs a source. Download anyway?");
  });

  it("GRADE-F G1: both qaVersion copies know v3", () => {
    assert.equal(mi.qaVersion(V3.V3_READY), 3);
    assert.equal(mi.qaVersion(V3.V3_LEGACY_V2_VIEW), 3);
    assert.equal(mi.qaVersion(V3.LEGACY_V2), 2);
    assert.equal(mi.qaVersion(V3.LEGACY_V1), 1);
    assert.equal(ms.qaVersion(V3.V3_READY), 3);
    assert.equal(mi.isFail(qd(V3.V3_UNSUPPORTED)), true);
    assert.equal(mi.isFail(qd(V3.V3_NOT_RESCORED)), false);
    assert.deepEqual(JSON.parse(JSON.stringify(mi.repairTargets(qd(V3.V3_UNSUPPORTED)).map((t) => t.id))), ["i1"]);
  });

  it("GRADE-F G1: plainDisposition never prints a legacy number", () => {
    for (const reason of ["rubric 9/12 below 10", "Quality score 64 is below 80.", "evidence_quality scored 2/4."]) {
      assert.doesNotMatch(mi.plainDisposition({ dispositionReason: reason }), /\d/);
    }
  });
});
