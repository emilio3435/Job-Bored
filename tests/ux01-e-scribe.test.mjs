/* ============================================================
   ux01-e-scribe.test.mjs — UX01 lane E, C14.
   Scribe binds to the role's own document (TA-08), measures keyword
   coverage for free as you type (MP-03), builds its chips from what the
   draft is missing (TA-24), and an unscored ring reads "—" (TA-23, AX-21).
   Harness: tests/fixtures/scribe/scribe-dom.mjs (no jsdom in this repo).
   ============================================================ */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadScribe } from "./fixtures/scribe/scribe-dom.mjs";

const MODULES = ["scribe-state.js", "scribe-score-adapter.js", "scribe.js"];

describe("C14 · a free, live keyword meter", () => {
  it("should count which of the posting's terms the text covers", () => {
    const env = loadScribe({ modules: MODULES });
    const cov = env.window.JobBoredScribeScore.keywordCoverage(
      "Led the design systems migration in React; cut first paint under a second.",
      ["Design systems", "React", "Mentoring", "Performance budgets", "react"],
    );
    assert.deepEqual([...cov.matched], ["Design systems", "React"]);
    assert.deepEqual([...cov.missing], ["Mentoring", "Performance budgets"]);
    assert.equal(cov.total, 4, "a repeated term counts once");
  });

  it("should not match a term inside a longer word", () => {
    const env = loadScribe({ modules: MODULES });
    const cov = env.window.JobBoredScribeScore.keywordCoverage("Reactive programming", ["React"]);
    assert.deepEqual([...cov.missing], ["React"]);
  });
});

describe("C14 · Scribe opens the role's own document", () => {
  const DOC = {
    jobKey: "7",
    feature: "cover_letter",
    company: "Kestrel",
    title: "Staff Frontend Engineer",
    filename: "cover-letter.html",
    text: "Dear Kestrel team,\n\nI led the design systems migration in React.",
    terms: ["Design systems", "React", "Mentoring", "Performance budgets"],
  };

  it("should bind to the role and load the document text", () => {
    const env = loadScribe({ modules: MODULES });
    env.JB.openDocument(DOC);
    assert.equal(env.rq("[data-scribe-target]").textContent, "Staff Frontend Engineer · Kestrel");
    assert.equal(env.rq("[data-scribe-target]").getAttribute("data-bound"), "true");
    assert.match(env.byId("scribeEditor").textContent, /design systems migration in React/);
  });

  it("should show coverage and missing terms, free and without a network call", () => {
    const env = loadScribe({ modules: MODULES });
    env.JB.openDocument(DOC);
    const meter = env.rq("[data-scribe-coverage]").textContent;
    assert.match(meter, /Covers 2 of 4 skills the posting names/);
    assert.match(meter, /missing: Mentoring, Performance budgets/);
    assert.match(meter, /free, updates as you type/);
  });

  it("should build refine chips from the missing terms, never a hard-coded skill", () => {
    const env = loadScribe({ modules: MODULES });
    env.JB.openDocument(DOC);
    const chips = env.rqa("[data-scribe-chip]").map((c) => c.getAttribute("data-scribe-chip"));
    assert.ok(chips.includes("emphasize Mentoring"), JSON.stringify(chips));
    assert.ok(!chips.includes("emphasize Python"), JSON.stringify(chips));
  });
});

describe("C14 · the unscored ring", () => {
  it("should draw an em dash, not a sentence, inside the ring", () => {
    const env = loadScribe({ modules: MODULES });
    assert.equal(env.byId("scribeFitRing").getAttribute("label"), "—");
  });
});
