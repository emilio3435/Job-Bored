/* holes-score-grade.test.mjs — HOLES lane SCORE, spec §0.8.

   gradeOf(qualityDoc, ats) turns the grading model's 0-100 score into one
   letter: 90+ A, 80s B, 70s C, 60s D, below 60 F; inside a band the bottom
   three points are "-" and the top three "+". A failed hard check (verdict
   FAIL) caps the letter at D whatever the score. With no judge score it
   falls back to the old rubric's score/max scaled to 100, then to the ATS
   overallScore; with none of those the button says "Grade".

   buttonHtml is the only score surface a row, the Case or Scribe may show:
   the letter in a small ring, named for a screen reader. */

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
const judged = (score, disposition = "READY") => ({ qa: { contract: "materials.qa.v2", disposition, quality: { score, ratings: [] } } });
const letter = (score, disposition) => ms.gradeOf(judged(score, disposition), null).letter;

describe("gradeOf · §0.8 bands", () => {
  it("should put 59 in F and 60 at the bottom of D", () => {
    assert.equal(letter(59), "F");
    assert.equal(letter(60), "D-");
    assert.equal(letter(0), "F");
  });

  it("should mark the bottom three points of a band minus and the top three plus", () => {
    assert.deepEqual([62, 63, 66, 67, 69].map((s) => letter(s)), ["D-", "D", "D", "D+", "D+"]);
    assert.deepEqual([80, 82, 83, 86].map((s) => letter(s)), ["B-", "B-", "B", "B"]);
    /* 87, 88 and 89 are the B band's top three points, so both read B+. */
    assert.equal(letter(87), "B+");
    assert.equal(letter(88), "B+");
    assert.equal(letter(89), "B+");
  });

  it("should open A at 90 and keep 98 to 100 as A+", () => {
    assert.equal(letter(90), "A-");
    assert.deepEqual([92, 93, 97, 98, 100].map((s) => letter(s)), ["A-", "A", "A", "A+", "A+"]);
  });

  it("should cap a FAIL verdict at D however high the score", () => {
    const g = ms.gradeOf(judged(95, "FAIL"), null);
    assert.equal(g.letter, "D");
    assert.equal(g.score, 95, "the score itself is reported unchanged");
    assert.equal(g.capped, true);
    assert.equal(letter(68, "FAIL"), "D", "a D+ is above the cap");
    assert.equal(letter(61, "FAIL"), "D-", "the cap never raises a grade");
    assert.equal(letter(40, "FAIL"), "F");
    assert.equal(ms.gradeOf(judged(95, "READY"), null).capped, false);
  });

  it("should round a fractional score before banding it", () => {
    assert.equal(ms.gradeOf(judged(87.6), null).score, 88);
    assert.equal(letter(89.5), "A-");
  });
});

describe("gradeOf · sources and fallbacks", () => {
  it("should read the judge's score first", () => {
    const g = ms.gradeOf(V2_RESUME_READY_SAME_MODEL, { overallScore: 40 });
    assert.equal(g.source, "judge");
    assert.equal(g.score, 86);
    assert.equal(g.letter, "B");
  });

  it("should cap the fixture's FAIL letter (64, one unsupported sentence) at D", () => {
    const g = ms.gradeOf(V2_LETTER_FAIL, null);
    assert.equal(g.score, 64);
    assert.equal(g.letter, "D");
    assert.equal(g.verdict, "FAIL");
  });

  it("should fall back to the old rubric's score over max, scaled to 100", () => {
    const g = ms.gradeOf(V1_RESUME_FAIL, null);
    assert.equal(g.source, "rubric");
    assert.equal(g.score, Math.round((V1_RESUME_FAIL.qa.rubric.score / V1_RESUME_FAIL.qa.rubric.max) * 100));
    const ready = ms.gradeOf({ qa: { disposition: "READY", rubric: { score: 10, max: 12, rows: [] } } }, null);
    assert.equal(ready.score, 83);
    assert.equal(ready.letter, "B");
    const failed = ms.gradeOf({ qa: { disposition: "FAIL", rubric: { score: 11, max: 12, rows: [] } } }, null);
    assert.equal(failed.letter, "D", "the cap holds for a rubric grade too");
  });

  it("should fall back to the ATS overall score when nothing graded the writing", () => {
    const g = ms.gradeOf(V2_LETTER_JUDGE_DOWN, { overallScore: 77 });
    assert.equal(g.source, "ats");
    assert.equal(g.letter, "C+");
    /* The stored scorecard entry ({ result, feature, storedAt }) reads the same. */
    assert.equal(ms.gradeOf(undefined, { result: { overallScore: 91 }, feature: "resume_update" }).letter, "A-");
  });

  it("should say Grade, with no score, and explain why when nothing graded it", () => {
    const none = ms.gradeOf(undefined, null);
    assert.equal(none.letter, "Grade");
    assert.equal(none.score, null);
    assert.equal(none.source, "none");
    assert.match(none.why, /\S/, "the modal has a reason to show");
    const down = ms.gradeOf(V2_LETTER_JUDGE_DOWN, null);
    assert.equal(down.letter, "Grade");
    assert.match(down.why, /didn.t finish|didn.t answer/i, "a judge that failed says so");
  });
});

describe("buttonHtml · the one score surface", () => {
  it("should show the letter in a ring and name the grade, score and action", () => {
    const html = ms.buttonHtml(ms.gradeOf(judged(88), null), { feature: "resume" });
    assert.match(html, /^<button type="button"[^>]*class="jb-grade[^"]*"/);
    assert.match(html, /aria-label="Grade B\+, 88 of 100 — open score details"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /data-score-open/);
    assert.match(html, /data-feature="resume"/);
    assert.match(html, /<span class="jb-grade__ring"[^>]*aria-hidden="true"[^>]*>[\s\S]*B\+/);
    const visible = html.replace(/<[^>]*>/g, "").trim();
    assert.equal(visible, "B+", "the visible face is the letter alone, never the rubric or the number");
  });

  it("should say Grade when there is no score", () => {
    const html = ms.buttonHtml(ms.gradeOf(undefined, null), { feature: "cover_letter" });
    assert.match(html, />Grade</);
    assert.match(html, /aria-label="Grade: not graded yet — open score details"/);
  });

  it("should say a capped grade failed a hard check, and a stale one is out of date", () => {
    const capped = ms.buttonHtml(ms.gradeOf(judged(95, "FAIL"), null), { feature: "resume" });
    assert.match(capped, /aria-label="Grade D, 95 of 100, capped by a failed check — open score details"/);
    const stale = ms.buttonHtml(ms.gradeOf(judged(88), null), { feature: "resume", stale: true });
    assert.match(stale, /aria-label="Grade B\+, 88 of 100, out of date — open score details"/);
    assert.match(stale, /data-stale="true"/);
  });

  it("should escape what it is given", () => {
    const html = ms.buttonHtml(ms.gradeOf(judged(88), null), { feature: 'resume" onclick="x' });
    assert.doesNotMatch(html, /onclick="x"/);
  });
});
