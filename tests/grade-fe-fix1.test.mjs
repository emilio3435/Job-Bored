/* grade-fe-fix1.test.mjs — GRADE W-FE fix round 1 (Astra round-1 review).

   F1  a manual repair is known by its repair metadata, not by `source`
   F2  pass siblings offer no "Use this version"; a failed promote says so
   F3  every version row lists its own checks, without promoting it
   F5  Writing names the review that supplied its ratings
   F7  coverage carried over from another run reads "From an earlier version"

   F4 (run-level Held on root downloads) is in grade-fe-dossier.test.mjs;
   F6 (number-free checklist stubs) is in the two e2e-visual specs. Run-list
   data here is local: it follows W-BE's additive RunSummary shape
   (verdicts[doc].checks) without editing the frozen fixture file. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as V3 from "./fixtures/materials-qa-v3.mjs";
import { click, load, makeScoreEnv, text } from "./fixtures/holes-score-dom.mjs";

function boot() {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js"]);
  return win;
}

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const qd = (qa) => ({ status: "pass", issues: [], qa });
const clone = (v) => JSON.parse(JSON.stringify(v));

function nodeOf(win, html) {
  const box = win.document.createElement("div");
  box.innerHTML = html;
  return box;
}

/* The pipeline writes the template's source on a manual repair (W-BE F7). */
const MANUAL = clone(V3.RUNS_MANUAL_REPAIR).map((r) => ({ ...r, source: "request" }));

/* W-BE's additive shape: each version's failed and review checks. */
const HELD_WITH_CHECKS = clone(V3.RUNS_REPAIR_HELD).map((r) => r.runId === "failing-repair-pass-2"
  ? { ...r, verdicts: { cover_letter: { ...r.verdicts.cover_letter, checks: [
    { id: "sentence:L1", kind: "sentence", status: "fail", label: "Claim needs a source" },
    { id: "dimension:voice", kind: "dimension", status: "review", label: "Sounds like you" },
  ] } } }
  : r);

describe("GRADE-F fix round 1 · version rows", () => {
  const win = boot();
  const ms = win.JobBoredMaterialsScore;
  const rows = (html) => nodeOf(win, html).querySelectorAll("li[data-run]");
  const byId = (html) => Object.fromEntries([...rows(html)].map((r) => [r.getAttribute("data-run"), r]));

  it("GRADE-F FIX1-F1: a manual repair shows before → after from its repair metadata, whatever its source", () => {
    const r = byId(ms.versionsHtml(MANUAL, "cover_letter", { base: "" }));
    assert.match(text(r["manual-repair"]), /Fails → Ready/);
    assert.doesNotMatch(text(r["manual-parent"]), /→/);
    const passRow = byId(ms.versionsHtml(clone(V3.RUNS_REPAIR_HELD), "cover_letter", { base: "" }))["failing-repair-pass-2"];
    assert.doesNotMatch(text(passRow), /→/, "a pass sibling is not a manual repair");
  });

  it("GRADE-F FIX1-F2: a pass sibling offers no Use this version, and keeps Preview and Download", () => {
    const r = byId(ms.versionsHtml(clone(V3.RUNS_REPAIR_HELD), "cover_letter", { base: "", promote: true }));
    const pass = r["failing-repair-pass-2"];
    assert.equal(pass.querySelector('[data-action="materials-promote"]'), null);
    assert.ok(pass.querySelector('[data-action="materials-preview"]'));
    assert.ok(pass.querySelector('[data-action="materials-download"]'));
    assert.ok(r["failing-repair"].querySelector('[data-action="materials-promote"]'), "a whole run can still be promoted");
  });

  it("GRADE-F FIX1-F2: a promote the server refuses says so in the modal", async () => {
    const env = boot();
    const doc = env.document;
    const opener = doc.createElement("button");
    doc.body.appendChild(opener);
    const err = Object.assign(new Error("this version can’t be used directly"), { code: "pass_not_promotable" });
    env.JobBoredMaterialsScore.open({
      opener,
      read: () => ({ feature: "cover_letter", qualityDoc: qd(V3.V3_READY), can: { promote: true } }),
      loadHistory: () => Promise.resolve(clone(V3.RUNS_REPAIR_HELD)),
      promote: () => Promise.reject(err),
    });
    const modal = () => doc.querySelector(".jb-score");
    const step = modal().querySelector('[data-score-step="versions"]');
    step.dispatchEvent(click(step));
    await settle();
    const use = modal().querySelector('[data-score-promote="failing-repair"]');
    use.dispatchEvent(click(use));
    await settle();
    const alert = modal().querySelector('[role="alert"]');
    assert.ok(alert, "the failure is shown");
    assert.match(text(alert), /Couldn’t switch versions: this version can’t be used directly/);
  });

  it("GRADE-F FIX1-F3: every version row lists its own checks in a disclosure, without promoting it", () => {
    for (const html of [ms.versionsHtml(HELD_WITH_CHECKS, "cover_letter", { base: "" }), win.JobBoredMaterialsInsights.historyHtml(HELD_WITH_CHECKS, "cover_letter", { base: "" })]) {
      const pass = byId(html)["failing-repair-pass-2"];
      const box = pass.querySelector("details.jb-ver__checks");
      assert.ok(box, "the row has a checks disclosure");
      assert.match(text(box.querySelector("summary")), /Checks/);
      const items = box.querySelectorAll("li").map((li) => text(li));
      assert.deepEqual(items, ["Claim needs a source — Fails", "Sounds like you — Needs review"]);
      assert.equal(byId(html)["previous-good"].querySelector("details.jb-ver__checks"), null, "no checks, no disclosure");
    }
  });
});

describe("GRADE-F fix round 1 · the modal's Writing and Coverage", () => {
  const win = boot();
  const ms = win.JobBoredMaterialsScore;
  const open = { why: true, coverage: true, writing: true, reviews: true };
  const panel = (rec, id) => nodeOf(win, ms.modalHtml(ms.modelOf({ feature: "cover_letter", qualityDoc: qd(rec), can: {} }), { open })).querySelector(`[data-step="${id}"]`);

  it("GRADE-F FIX1-F5: Writing names the second review when the first did not run", () => {
    const rec = { ...clone(V3.V3_READY), reviews: [
      { role: "first", provider: "openai_compatible", model: "writer-example", promptVersion: "materials-judge-v3", status: "unavailable", disposition: null, flagged: [], errorCode: "timeout" },
      { role: "second", provider: "openai_compatible", model: "judge-example", promptVersion: "materials-judge-v3", status: "ok", disposition: "READY", flagged: [] },
    ] };
    assert.match(text(panel(rec, "writing")), /from the second review \(judge-example\)/);
    assert.doesNotMatch(text(panel(rec, "writing")), /from the first review/);
    assert.match(text(panel(V3.V3_READY, "writing")), /from the first review \(writer-example\)/);
  });

  it("GRADE-F FIX1-F7: coverage carried over from another run says so, with no injected staleness", () => {
    const carried = { ...clone(V3.V3_COVERAGE_MISSES), runId: "edit-run", state: "carried_over", carriedFrom: { runId: "earlier-run", date: "2026-10-02T09:00:00.000Z" } };
    const v = ms.verdictView(qd(carried));
    assert.equal(v.coverage.stale, true);
    assert.match(text(panel(carried, "coverage")), /From an earlier version/);
    assert.doesNotMatch(text(panel(V3.V3_COVERAGE_MISSES, "coverage")), /From an earlier version/, "a run's own coverage is current");
  });
});
