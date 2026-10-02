/* grade-fe-fix2.test.mjs — GRADE W-FE fix round 2 (Fable round-2 review).

   N3  "before → after" only on a manual repair (repair.parentRunId), and
       only from the row's own document
   N8  the per-version checks list groups identical labels with a count
   N4  the Apply checklist renders a held gate as held, a FAIL gate as before

   N4's in-page held copy and N1's refused Rescore are driven through the
   rows in grade-fe-dossier.test.mjs. Run-list data here is local and
   follows the pipeline's real shapes (server/materials-pipeline.mjs: an
   automatic two-pass run's repair record has parentRunId null). */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

import * as V3 from "./fixtures/materials-qa-v3.mjs";
import { load, makeScoreEnv, repoRoot, text } from "./fixtures/holes-score-dom.mjs";

const clone = (v) => JSON.parse(JSON.stringify(v));

function boot() {
  const win = makeScoreEnv({ bodyClass: "jb-v2" });
  load(win, ["jb-a11y.js", "materials-insights.js", "materials-score.js"]);
  return win;
}

describe("GRADE-F fix round 2 · version rows", () => {
  const win = boot();
  const ms = win.JobBoredMaterialsScore;
  const byId = (html) => {
    const box = win.document.createElement("div");
    box.innerHTML = html;
    return Object.fromEntries(box.querySelectorAll("li[data-run]").map((r) => [r.getAttribute("data-run"), r]));
  };

  it("GRADE-F FIX2-N3: an automatic two-pass run's main row shows no before → after", () => {
    /* The pipeline writes repair.before on the chosen run of every two-pass
       draft, with parentRunId null (no manual repair asked for it). */
    const runs = clone(V3.RUNS_REPAIR_HELD).map((r) => r.runId === "failing-repair"
      ? { ...r, repair: { parentRunId: null, changed: true, adopted: false, reason: "Held — previous version remains default", before: { runId: "failing-repair", disposition: "FAIL", failedCheckIds: ["sentence:L1"] } } }
      : r);
    assert.doesNotMatch(text(byId(ms.versionsHtml(runs, "cover_letter", { base: "" }))["failing-repair"]), /→/);
    assert.match(text(byId(ms.versionsHtml(clone(V3.RUNS_MANUAL_REPAIR), "cover_letter", { base: "" }))["manual-repair"]), /Fails → Ready/, "a manual repair still shows it");
  });

  it("GRADE-F FIX2-N3: a manual repair's before belongs to the row's own document", () => {
    const run = {
      ...clone(V3.RUNS_MANUAL_REPAIR[1]), documents: ["resume", "cover_letter"],
      verdicts: { resume: { disposition: "READY", state: "graded", reason: "", failedChecks: [] }, cover_letter: { disposition: "READY", state: "graded", reason: "", failedChecks: [] } },
    };
    const perDoc = { ...run, repair: { ...run.repair, before: { resume: { runId: "manual-parent", disposition: "REVIEW", failedCheckIds: [] }, cover_letter: { runId: "manual-parent", disposition: "FAIL", failedCheckIds: ["sentence:L1"] } } } };
    assert.match(text(byId(ms.versionsHtml([perDoc], "cover_letter", { base: "" }))["manual-repair"]), /Fails → Ready/);
    assert.match(text(byId(ms.versionsHtml([perDoc], "resume", { base: "" }))["manual-repair"]), /Needs review → Ready/);
    const letterOnly = { ...run, repair: { ...run.repair, feature: "cover_letter" } };
    assert.doesNotMatch(text(byId(ms.versionsHtml([letterOnly], "resume", { base: "" }))["manual-repair"]), /→/, "a letter repair's before is not the resume's");
    assert.match(text(byId(ms.versionsHtml([letterOnly], "cover_letter", { base: "" }))["manual-repair"]), /Fails → Ready/);
  });

  it("GRADE-F FIX2-N8: identical check labels are grouped with a count", () => {
    const runs = clone(V3.RUNS_REPAIR_HELD).map((r) => r.runId === "failing-repair-pass-2"
      ? { ...r, verdicts: { cover_letter: { ...r.verdicts.cover_letter, checks: [
        { id: "sentence:L1", kind: "sentence", status: "fail", label: "Claim needs a source" },
        { id: "sentence:L2", kind: "sentence", status: "fail", label: "Claim needs a source" },
        { id: "sentence:L3", kind: "sentence", status: "fail", label: "Claim needs a source" },
        { id: "sentence:L4", kind: "sentence", status: "review", label: "Claim to confirm" },
      ] } } }
      : r);
    for (const html of [ms.versionsHtml(runs, "cover_letter", { base: "" }), win.JobBoredMaterialsInsights.historyHtml(runs, "cover_letter", { base: "" })]) {
      const items = byId(html)["failing-repair-pass-2"].querySelectorAll("details.jb-ver__checks li").map((li) => text(li));
      assert.deepEqual(items, ["Claim needs a source ×3 — Fails", "Claim to confirm — Needs review"]);
    }
  });
});

describe("GRADE-F fix round 2 · the Apply checklist's held gate", () => {
  function loadChecklist() {
    const defined = new Map();
    const root = { HTMLElement: class {}, CustomEvent: class {}, customElements: { get: (t) => defined.get(t), define: (t, c) => defined.set(t, c) } };
    vm.runInNewContext(readFileSync(join(repoRoot, "apply-checklist.js"), "utf8"), { window: root });
    return root.JobBoredApplyChecklist;
  }
  const CL = loadChecklist();
  const OPTS = { base: "http://127.0.0.1:3847", slug: "acme", uid: 1 };
  const step = (gate) => ({ items: [{ id: "resume", label: "Download your tailored resume (PDF)", detail: "", done: false, tone: "warn", action: { kind: "download", doc: "resume", filename: "resume.pdf", gate, label: "Download" } }] });

  it("GRADE-F FIX2-N4: a held gate renders data-gate=\"held\"; a FAIL gate stays data-gate=\"fail\"", () => {
    assert.match(CL.stripHtml(step("held"), OPTS), /data-action="materials-download"[^>]*data-gate="held"/);
    assert.doesNotMatch(CL.stripHtml(step("held"), OPTS), /data-gate="fail"/);
    assert.match(CL.stripHtml(step(true), OPTS), /data-action="materials-download"[^>]*data-gate="fail"/);
    assert.doesNotMatch(CL.stripHtml(step(undefined), OPTS), /data-gate/);
  });
});
