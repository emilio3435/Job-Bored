/* holes-score-grade.test.mjs — HOLES lane SCORE's one button, as GRADE
   re-scoped it (SPEC-GRADE D1, D7, A3).

   HOLES §0.8 turned a 0-100 score into a letter and capped a FAIL at D.
   GRADE retired the letter, the cap and every "N of 100": verdictView
   reads the verdict itself, and buttonHtml — still the only score surface
   a row, the Case or Scribe may show — says "<word> · <first reason>".
   A judge's old 0-100 score, the old rubric's score/max and the ATS
   overallScore never reach the button. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { V1_RESUME_FAIL, V2_LETTER_FAIL, V2_LETTER_JUDGE_DOWN, V2_RESUME_READY_SAME_MODEL } from "./fixtures/materials-qa-v2.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function load() {
  const window = {};
  vm.runInNewContext(readFileSync(join(repoRoot, "materials-score.js"), "utf8"), { window }, { filename: "materials-score.js" });
  return window.JobBoredMaterialsScore;
}

const ms = load();
const judged = (score, disposition = "READY") => ({ qa: { contract: "materials.qa.v2", disposition, quality: { score, ratings: [] }, gates: [] } });

describe("verdictView · the verdict, never the old score", () => {
  it("should read a v2 judge record's verdict and drop its 0-100 score", () => {
    assert.equal(ms.verdictView(judged(95, "FAIL")).word, "Fails");
    assert.equal(ms.verdictView(judged(40, "READY")).word, "Ready");
    assert.equal(ms.verdictView(V2_RESUME_READY_SAME_MODEL).word, "Ready");
    const fail = ms.verdictView(V2_LETTER_FAIL);
    assert.equal(fail.word, "Fails");
    assert.equal(fail.reason, "1 claim needs a source");
  });

  it("should read an old rubric record's verdict without its score over max", () => {
    const v = ms.verdictView(V1_RESUME_FAIL);
    assert.equal(v.word, "Fails");
    assert.equal(v.legacy, "old_checker");
    assert.doesNotMatch(v.reasonFull, /\d/);
  });

  it("should leave an ATS score out of the verdict: nothing graded is Not graded", () => {
    assert.equal(ms.verdictView(undefined).word, "Not graded");
    assert.equal(ms.verdictView(V2_LETTER_JUDGE_DOWN).word, "Needs review", "the stored REVIEW stands; the missing grade is the modal's to explain");
  });
});

describe("buttonHtml · the one score surface", () => {
  it("should show the verdict word and name the verdict and action", () => {
    const html = ms.buttonHtml(ms.verdictView(V2_RESUME_READY_SAME_MODEL), { feature: "resume" });
    assert.match(html, /^<button type="button"[^>]*class="jb-grade[^"]*"/);
    assert.match(html, /aria-label="Resume: Ready\. Open the quality check\."/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /data-score-open/);
    assert.match(html, /data-feature="resume"/);
    assert.match(html, /data-tone="ok"/);
    assert.equal(html.replace(/<[^>]*>/g, "").trim(), "Ready");
    assert.doesNotMatch(html, /data-grade|jb-grade__ring|of 100/);
  });

  it("should say Not graded when nothing graded it, and Out of date when stale", () => {
    assert.match(ms.buttonHtml(ms.verdictView(undefined), { feature: "cover_letter" }), />Not graded</);
    const stale = ms.buttonHtml(ms.verdictView(judged(88)), { feature: "resume", stale: true });
    assert.match(stale, /aria-label="Resume: Ready\. Out of date\. Open the quality check\."/);
    assert.match(stale, /data-stale="true"/);
  });

  it("should escape what it is given", () => {
    const html = ms.buttonHtml(ms.verdictView(judged(88)), { feature: 'resume" onclick="x' });
    assert.doesNotMatch(html, /onclick="x"/);
  });
});
