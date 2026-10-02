/* HOLES lane SCORE · scribe-score-adapter.js.

   The adapter's own renderer is gone: the score modal shows the grade.
   What stays is the bus view, and it now says when a score is stale (U12):
   the same role's score of text the draft has since moved on from. The
   cache key's third segment is the scored text's hash. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import { makeEnv } from "./fixtures/jb-dom.mjs";
import { read } from "./fixtures/holes-score-dom.mjs";

const JOB = { title: "Staff Platform Engineer", company: "Northwind" };

function load(text) {
  const win = makeEnv({ bodyClass: "jb-v2" });
  win.window = win;
  win.JobBoredApp = {
    ats: {
      /* feature | role | hash(text): the text's length stands in for its hash. */
      computeAtsScorecardCacheKey: (t, job, feature) => `${feature}|${job.company}|${t.length}`,
    },
    materialsState: { getAtsScorecardState: () => null },
    resumeGeneration: { getLastResumeGenerationSession: () => ({ feature: "cover_letter", job: JOB }) },
  };
  vm.runInNewContext(read("scribe-score-adapter.js"), win);
  const score = win.JobBoredScribeScore;
  const doc = { text };
  score.mount(null, { getText: () => doc.text });
  const emit = (detail) => win.dispatchEvent(new win.CustomEvent("jb:ats:state", { detail }));
  return { score, doc, emit };
}

describe("U12 · the adapter's view says when a score is stale", () => {
  it("should be fresh while the draft is the text that was scored", () => {
    const env = load("Dear Northwind,");
    env.emit({ status: "success", result: { overallScore: 78 }, jobKey: `cover_letter|Northwind|${"Dear Northwind,".length}` });
    const v = env.score.getView();
    assert.equal(v.status, "success");
    assert.equal(v.stale, false);
    assert.equal(v.note, "");
  });

  it("should be stale, with the score kept and a rescore note, once the text changes", () => {
    const env = load("Dear Northwind,");
    env.emit({ status: "success", result: { overallScore: 78 }, jobKey: `cover_letter|Northwind|${"Dear Northwind,".length}` });
    env.doc.text = "Dear Northwind team, I build platforms.";
    const v = env.score.getView();
    assert.equal(v.status, "success");
    assert.equal(v.result.overallScore, 78, "a stale score is still the last score");
    assert.equal(v.stale, true);
    assert.match(v.note, /changed after it was scored/);
  });

  it("should not call an opaque key stale: no proof, no verdict", () => {
    const env = load("Dear Northwind,");
    env.emit({ status: "success", result: { overallScore: 78 }, jobKey: "opaque" });
    assert.equal(env.score.getView().stale, false);
  });
});

describe("HOLES SCORE · the adapter no longer paints", () => {
  it("should export no render(), and mount() returns no refresh", () => {
    const env = load("x");
    assert.equal(env.score.render, undefined);
    assert.equal(env.score.refresh, undefined);
    assert.equal(typeof env.score.buildView, "function");
    assert.equal(typeof env.score.keywordCoverage, "function");
  });
});
