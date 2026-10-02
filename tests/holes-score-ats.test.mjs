/* HOLES lane SCORE · ats-scorecard.js.

   U3: the dead ATS modal (jb:ats:modal:open) opens the score modal, for
   the document the stored scorecard rated. Rescore passes the role it
   scores, so the result lands on that role even when the last generation
   session was another's. MATQ's optional docHash / runId /
   overallScoreSource survive normalization when the server sends them. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const JOB_A = { link: "https://jobs.test/a", company: "Meridian", title: "PM" };
const JOB_B = { link: "https://jobs.test/b", company: "Northwind", title: "Director" };

function boot(result) {
  const listeners = {};
  const CE = class {
    constructor(t, o) {
      this.type = t;
      this.detail = o && o.detail;
    }
  };
  const win = {
    JobBoredApp: { core: { host: {} } },
    localStorage: memStorage(),
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(e) { (listeners[e.type] || []).forEach((fn) => fn(e)); return true; },
    CustomEvent: CE,
  };
  const document = {
    activeElement: { id: "opener" },
    body: { appendChild() { throw new Error("the legacy ATS dialog must not be built"); } },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    getElementById: () => null,
    querySelector: () => null,
    createElement() { throw new Error("the legacy ATS dialog must not be built"); },
  };
  const sandbox = {
    window: win,
    document,
    console,
    CustomEvent: CE,
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(result || {}) }),
  };
  vm.runInNewContext(read("materials-state.js"), sandbox);
  win.JobBoredApp.core.getLastResumeGenerationSession = () => ({ job: JOB_A, feature: "resume_update" });
  win.JobBoredApp.core.host = {
    escapeHtml: (v) => String(v == null ? "" : v),
    getAtsScoringConfig: () => ({ mode: "server" }),
    getAtsScorecardApiUrl: () => "https://ats.test/score",
    getJobOpportunityKey: (j) => win.JobBoredApp.materialsState.getJobOpportunityKey(j),
    renderResumeGenerateInsights() {},
  };
  vm.runInNewContext(read("ats-scorecard.js"), sandbox);
  return { win, state: win.JobBoredApp.materialsState, ats: win.JobBoredApp.ats };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("HOLES SCORE · Rescore scores the role it names", () => {
  it("should store the result on the job passed in, not the last session's", async () => {
    const { state, ats } = boot({ overallScore: 81 });
    ats.startAtsScorecardAnalysis("cover_letter|b", { feature: "cover_letter", docText: "letter" }, JOB_B);
    await settle();
    assert.equal(state.getScorecardForJob(JOB_B)?.result.overallScore, 81);
    assert.equal(state.getScorecardForJob(JOB_A), null, "the other role keeps no score it never got");
  });

  it("should still fall back to the last session's job when none is passed", async () => {
    const { state, ats } = boot({ overallScore: 70 });
    ats.startAtsScorecardAnalysis("resume_update|a", { feature: "resume_update", docText: "resume" });
    await settle();
    assert.equal(state.getScorecardForJob(JOB_A)?.result.overallScore, 70);
  });
});

describe("HOLES SCORE · MATQ's scorecard provenance", () => {
  it("should keep docHash, runId and overallScoreSource when the server sends them", () => {
    const { ats } = boot();
    const r = ats.normalizeAtsScorecardResult({ overallScore: 88, docHash: "h1", runId: "mr_1", overallScoreSource: "judge" });
    assert.equal(r.docHash, "h1");
    assert.equal(r.runId, "mr_1");
    assert.equal(r.overallScoreSource, "judge");
  });

  it("should add none of them when they are absent or empty", () => {
    const { ats } = boot();
    const r = ats.normalizeAtsScorecardResult({ overallScore: 88, docHash: "", runId: 7 });
    assert.equal("docHash" in r, false);
    assert.equal("runId" in r, false);
    assert.equal("overallScoreSource" in r, false);
  });
});

describe("U3 · the ATS modal routes to the score modal", () => {
  function withScore(win) {
    const calls = [];
    win.JobBoredRoleMaterials = { openScore: (feature, opener) => { calls.push({ feature, opener }); return {}; } };
    return calls;
  }

  it("should open the score modal for the letter the stored scorecard rated", () => {
    const { win, state } = boot();
    const calls = withScore(win);
    state.setAtsScorecardState({ cacheKey: "cover_letter|k", status: "success", result: { overallScore: 80 }, error: "", payload: null });
    win.dispatchEvent(new win.CustomEvent("jb:ats:modal:open", { detail: { jobKey: "cover_letter|k" } }));
    assert.deepEqual(calls.map((c) => c.feature), ["cover_letter"]);
    assert.equal(calls[0].opener.id, "opener", "focus returns where it came from");
  });

  it("should map resume_update to the resume, and an unknown document to ATS-only", () => {
    const { win, ats, state } = boot();
    const calls = withScore(win);
    state.setAtsScorecardState({ cacheKey: "resume_update|k", status: "success", result: {}, error: "", payload: null });
    ats.openDossierAtsModal();
    state.setAtsScorecardState({ cacheKey: "", status: "idle", result: null, error: "", payload: null });
    ats.openDossierAtsModal();
    assert.deepEqual(calls.map((c) => c.feature), ["resume", ""]);
  });

  it("should ignore an open for another role's key", () => {
    const { win, state } = boot();
    const calls = withScore(win);
    state.setAtsScorecardState({ cacheKey: "cover_letter|k", status: "success", result: {}, error: "", payload: null });
    win.dispatchEvent(new win.CustomEvent("jb:ats:modal:open", { detail: { jobKey: "cover_letter|other" } }));
    assert.equal(calls.length, 0);
  });
});
