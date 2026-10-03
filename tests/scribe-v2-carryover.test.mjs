/* scribe-v2-carryover.test.mjs — EDITOR lane X1.

   X1 deleted the old Scribe (scribe.js, scribe-state.js, scribe.css) and
   its tests. The assertions below are the ones that still describe live
   behaviour, ported off the old Scribe DOM so they outlive it:

   - keyword coverage and the score adapter's truth rules
     (from ux01-e-scribe C14 and scribe-real-score SCRIBE-02). The adapter
     is on the PLAN keep list, to be rebound to Scribe v2 by slug; its
     markup targets were old-Scribe ids, so only its logic is pinned here.
   - jb:draft:saved (from scribe-boot-binding and scribe-refine-async-truth,
     which consumed it): resume-generation.js is the producer and stays, so
     the event must still mean "the save landed".
   - save truth (from scribe-state-autosave): the v2 rail says "loading"
     while it loads and "no saved versions" only for an empty history.

   Harness: tests/fixtures/jb-dom.mjs under node:vm. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { makeEnv } from "./fixtures/jb-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

/* ---------------- the score adapter ---------------- */

const REAL_RESULT = {
  schemaVersion: 1,
  overallScore: 78,
  dimensionScores: {
    requirementsCoverage: 82,
    experienceRelevance: 74,
    impactClarity: 61,
    atsParseability: 93,
    toneFit: 55,
  },
  criticalGaps: [{ gap: "No Kubernetes experience named", whyItMatters: "Listed as a must-have", severity: "high" }],
  evidence: [{ claim: "Cut deploy latency by 38%", sourceSnippet: "reduced p95 deploy time", sourceType: "resume" }],
  confidence: 0.82,
  model: "claude-opus-5",
};

const BOUND_SESSION = {
  feature: "cover_letter",
  job: { title: "Staff Platform Engineer", company: "Northwind" },
};

function makeAtsHost({ state = null, session = null } = {}) {
  const analyses = [];
  return {
    analyses,
    app: {
      ats: {
        startAtsScorecardAnalysis: (cacheKey, payload) => analyses.push({ cacheKey, payload }),
        computeAtsScorecardCacheKey: (text, job, feature) =>
          job && job.title && job.company ? `${feature}|${job.company}|${text.length}` : "",
        buildAtsScorecardRequestPayload: (text, job) => ({
          docText: text,
          job: { title: (job && job.title) || "", company: (job && job.company) || "" },
        }),
      },
      materialsState: {
        getAtsScorecardState: () =>
          state || { cacheKey: "", status: "idle", result: null, error: "", payload: null },
      },
      resumeGeneration: {
        getLastResumeGenerationSession: () => session,
      },
    },
  };
}

/** Load scribe-score-adapter.js alone and mount it with no region, so only
 *  its logic runs. `text` is what the bound document holds. */
function loadAdapter({ host = makeAtsHost(), text = "" } = {}) {
  const win = makeEnv({ bodyClass: "jb-v2" });
  win.window = win;
  win.JobBoredApp = host.app;
  vm.runInNewContext(read("scribe-score-adapter.js"), win);
  const score = win.JobBoredScribeScore;
  const doc = { text };
  const handle = score.mount(null, { getText: () => doc.text });
  const emit = (detail) => win.dispatchEvent(new win.CustomEvent("jb:ats:state", { detail }));
  return { win, score, handle, host, doc, emit };
}

describe("keyword coverage is free, whole-word and case-folded (C14)", () => {
  it("should count which of the posting's terms the text covers", () => {
    const { score } = loadAdapter();
    const cov = score.keywordCoverage(
      "Led the design systems migration in React; cut first paint under a second.",
      ["Design systems", "React", "Mentoring", "Performance budgets", "react"],
    );
    assert.deepEqual([...cov.matched], ["Design systems", "React"]);
    assert.deepEqual([...cov.missing], ["Mentoring", "Performance budgets"]);
    assert.equal(cov.total, 4, "a repeated term counts once");
  });

  it("should not match a term inside a longer word", () => {
    const { score } = loadAdapter();
    const cov = score.keywordCoverage("Reactive programming", ["React"]);
    assert.deepEqual([...cov.missing], ["React"]);
  });
});

describe("the score adapter never shows a number it does not have (SCRIBE-02)", () => {
  it("should call an empty document empty, not scored", () => {
    const { score } = loadAdapter({ host: makeAtsHost({ session: BOUND_SESSION }), text: "" });
    const view = score.getView();
    assert.equal(view.status, "empty");
    assert.equal(view.result, null);
    assert.match(view.note, /nothing to score/i);
  });

  it("should call a document with text but no score 'not scored', which is not a zero", () => {
    const { score } = loadAdapter({ host: makeAtsHost({ session: BOUND_SESSION }), text: "A draft." });
    const view = score.getView();
    assert.equal(view.status, "idle");
    assert.equal(view.result, null);
    assert.match(view.note, /not scored yet/i);
  });

  it("should keep loading and error apart, and never give an error a result", () => {
    const { score, emit } = loadAdapter({ host: makeAtsHost({ session: BOUND_SESSION }), text: "A draft." });
    emit({ jobKey: "k", status: "loading", result: null, error: null });
    assert.equal(score.getView().status, "loading");
    emit({ jobKey: "k", status: "error", result: null, error: "ATS provider returned 503" });
    const view = score.getView();
    assert.equal(view.status, "error");
    assert.equal(view.result, null);
    assert.match(view.note, /ATS provider returned 503/);
  });

  it("should drop a finished score as soon as a newer run starts loading", () => {
    const { score, emit } = loadAdapter({ host: makeAtsHost({ session: BOUND_SESSION }), text: "A draft." });
    emit({ jobKey: "k", status: "success", result: REAL_RESULT, error: null });
    emit({ jobKey: "k", status: "loading", result: null, error: null });
    assert.equal(score.getView().result, null);
  });

  it("should hydrate from the state the bus already holds at mount", () => {
    const host = makeAtsHost({
      session: BOUND_SESSION,
      state: { cacheKey: "k", status: "success", result: REAL_RESULT, error: "", payload: null },
    });
    const { score } = loadAdapter({ host, text: "A draft." });
    const view = score.getView();
    assert.equal(view.status, "success");
    assert.equal(view.result.overallScore, 78);
  });
});

describe("the score adapter only spends on an explicit Rescore (SCRIBE-02)", () => {
  it("should ask the bus to re-broadcast and start no analysis", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const { win, score } = loadAdapter({ host, text: "A draft." });
    const requests = [];
    win.addEventListener("jb:ats:state:request", (e) => requests.push(e.detail));
    score.requestState();
    assert.equal(requests.length, 1, "the re-broadcast request is a pure event, not a fetch");
    assert.equal(host.analyses.length, 0, "mount never reaches the scoring provider");
  });

  it("should start exactly one analysis with the payload the real pipeline builds", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const { handle } = loadAdapter({ host, text: "A draft." });
    assert.equal(handle.requestRescore().started, true);
    assert.equal(host.analyses.length, 1);
    assert.equal(host.analyses[0].cacheKey, "cover_letter|Northwind|8");
    assert.equal(host.analyses[0].payload.docText, "A draft.");
    assert.equal(host.analyses[0].payload.job.company, "Northwind");
  });

  it("should not fire a second paid call while the first is loading", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const { handle, emit } = loadAdapter({ host, text: "A draft." });
    handle.requestRescore();
    emit({ jobKey: "k", status: "loading", result: null, error: null });
    assert.deepEqual({ ...handle.requestRescore() }, { started: false, reason: "in-flight" });
    assert.equal(host.analyses.length, 1);
  });

  it("should refuse an empty document with a reason", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const { handle, score } = loadAdapter({ host, text: "" });
    assert.equal(handle.requestRescore().reason, "empty");
    assert.equal(host.analyses.length, 0);
    assert.match(score.getView().note, /nothing to score/i);
  });

  it("should refuse without a bound role, since a score needs a job", () => {
    const host = makeAtsHost({ session: null });
    const { handle, score } = loadAdapter({ host, text: "A draft." });
    assert.equal(handle.requestRescore().reason, "unbound");
    assert.equal(host.analyses.length, 0);
    assert.match(score.getView().note, /no role/i);
  });
});

describe("the score adapter refuses another role's score (SCRIBE-02b)", () => {
  it("should not show a score measured against a different role", () => {
    const { score, emit } = loadAdapter({ host: makeAtsHost({ session: BOUND_SESSION }), text: "A draft." });
    emit({ jobKey: "cover_letter|Southwind|11", status: "success", result: REAL_RESULT, error: null });
    const view = score.getView();
    assert.notEqual(view.status, "success");
    assert.equal(view.result, null);
    assert.match(view.note, /different role/i, "it says why it is blank");
  });

  it("should show the score again once the same role is scored", () => {
    const { score, emit } = loadAdapter({ host: makeAtsHost({ session: BOUND_SESSION }), text: "A draft." });
    emit({ jobKey: "cover_letter|Southwind|11", status: "success", result: REAL_RESULT, error: null });
    emit({ jobKey: "cover_letter|Northwind|8", status: "success", result: REAL_RESULT, error: null });
    assert.equal(score.getView().status, "success");
  });

  it("should ignore the text hash, so an edit does not make its own score foreign", () => {
    const { score, emit } = loadAdapter({ host: makeAtsHost({ session: BOUND_SESSION }), text: "A draft." });
    emit({ jobKey: "cover_letter|Northwind|999", status: "success", result: REAL_RESULT, error: null });
    assert.equal(score.getView().status, "success");
  });

  it("should never refuse when no role is bound to contradict the score", () => {
    const { score, emit } = loadAdapter({ host: makeAtsHost({ session: null }), text: "A draft." });
    emit({ jobKey: "cover_letter|Northwind|8", status: "success", result: REAL_RESULT, error: null });
    assert.equal(score.getView().status, "success");
  });
});

/* ---------------- jb:draft:saved ---------------- */

describe("jb:draft:saved means the save landed", () => {
  const src = read("resume-generation.js");
  const dispatches = [...src.matchAll(/new CustomEvent\("jb:draft:saved"/g)].map((m) => m.index);

  it("should be dispatched on the initial draft and both refine paths", () => {
    assert.equal(dispatches.length, 3, "initial, letter refine and resume refine");
  });

  it("should fire only after saveGeneratedDraft resolved, inside the same try", () => {
    for (const at of dispatches) {
      const before = src.slice(0, at);
      const save = before.lastIndexOf("saveGeneratedDraft(");
      assert.ok(save > 0, "a save precedes every jb:draft:saved");
      const between = src.slice(save, at);
      assert.doesNotMatch(between, /\bcatch\s*\(/, "never from a failure branch");
      assert.match(src.slice(save - 40, save), /await\s+\w+\.$/, "the save is awaited first");
    }
  });

  it("should carry the role, the document and the saved draft id", () => {
    for (const at of dispatches) {
      const detail = src.slice(at, at + 400);
      assert.match(detail, /jobKey:/);
      assert.match(detail, /feature/);
      assert.match(detail, /draftId: savedDraft \? savedDraft\.id : null/);
      assert.match(detail, /mode: "(initial|refine)"/);
    }
  });
});

/* ---------------- save truth in the v2 rail ---------------- */

function bootDesk(listVersions) {
  const win = makeEnv({ bodyClass: "jb-v2" });
  win.Date = Date;
  win.JBScribeApi = { MAX_INSTRUCTION: 2000, create: () => { throw new Error("tests pass their own api"); } };
  vm.runInNewContext(read("scribe-v2.js"), win);
  const api = {
    mode: "stub",
    listVersions,
    preview: () => Promise.resolve({ html: "<html><body><main data-page=\"1\">render</main></body></html>", words: 1, pageBudget: 1 }),
    propose: () => new Promise(() => {}),
    stream: () => new Promise(() => {}),
    stopEdit: () => Promise.resolve({ status: "partial", ops: [] }),
    rejectEdit: () => Promise.resolve(null),
    star: () => Promise.resolve({ ok: true }),
  };
  win.JB_SCRIBE_V2.open({ slug: "acme-platform-engineer", doc: "resume", api, title: "Platform Engineer", company: "Acme" });
  return win.document.body.querySelectorAll("jb-scribe")[0];
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("the v2 rail tells the truth about what is saved (from scribe-state)", () => {
  it("should say it is loading rather than claim the role has no versions", () => {
    const host = bootDesk(() => new Promise(() => {}));
    assert.equal(host.querySelector(".scribe__ver-empty").textContent, "Loading versions…");
  });

  it("should say so plainly when the document has no saved versions", async () => {
    const host = bootDesk(() => Promise.resolve({ currentRunId: null, versions: [] }));
    await settle();
    assert.equal(host.querySelector(".scribe__ver-empty").textContent, "No saved versions yet.");
    assert.equal(host.querySelectorAll(".scribe__ver").length, 0);
  });
});

for (const which of ['resume', 'cover_letter']) {
  it(`SCRP-F14 ASTRA-04 ${which} installs the exact rebase before streaming and marking`, async () => {
    const { FakeDocument } = await import('./fixtures/jb-dom.mjs');
    const win = makeEnv({ bodyClass: 'jb-v2' }); win.Date = Date;
    vm.runInNewContext(read('scribe-v2-api.js'), win); vm.runInNewContext(read('scribe-v2-diff.js'), win); vm.runInNewContext(read('scribe-v2.js'), win);
    let current = 'r0', started = false;
    const calls = [];
    const api = {
      listVersions: async () => ({ currentRunId: current, versions: [{ runId: 'r1', n: 1, words: 23 }, { runId: 'r0', n: 0, words: 10 }] }),
      getModel: async id => { calls.push(['model', id]); return { model: {}, nodes: [{ id: 'p:p3', kind: 'paragraph', text: 'A newer exact block' }] }; },
      preview: async body => { calls.push(['preview', body.baseRunId]); return { html: body.baseRunId === 'r1' ? 'A newer exact block' : 'Old block', words: body.baseRunId === 'r1' ? 23 : 10 }; },
      propose: async () => { current = 'r1'; return { proposalId: 'p1', rebasedTo: 'r1' }; },
      stream: async (_id, h) => { started = true; h.onEvent({ event: 'op', data: { op: { opId: 'o1', op: 'replace', node: 'p:p3', text: 'A shorter block' } } }); h.onEvent({ event: 'done', data: { status: 'ready' } }); },
    };
    const ctl = win.JB_SCRIBE_V2.open({ slug: 'acme-example', doc: which, api });
    const flush = async () => { for (let i = 0; i < 5; i++) await settle(); };
    await flush();
    const frame = ctl.refs.frame;
    const original = new FakeDocument(); const p0 = original.createElement('p'); p0.setAttribute('data-node', 'p:p3'); p0.textContent = 'Old block'; original.body.appendChild(p0);
    frame.contentDocument = original; frame.onload();
    ctl.refs.prompt.value = 'Shorter'; ctl.refs.composer.dispatchEvent({ type: 'submit', target: ctl.refs.composer }); await flush();
    assert.equal(started, false, 'the exact iframe load gates SSE');
    assert.equal(ctl.state.proposal.id, 'p1');
    assert.ok(calls.some(c => c[0] === 'model' && c[1] === 'r1'));
    assert.equal(frame.srcdoc, 'A newer exact block');
    const exact = new FakeDocument(); const p1 = exact.createElement('p'); p1.setAttribute('data-node', 'p:p3'); p1.textContent = 'A newer exact block'; exact.body.appendChild(p1);
    frame.contentDocument = exact; frame.onload(); await flush();
    assert.equal(started, true);
    assert.equal(ctl.state.currentRunId, 'r1');
    assert.equal(ctl.state.proposal.baseWords, 23);
    assert.equal(ctl.state.proposal.changes[0].before, 'A newer exact block');
    assert.match(frame.getAttribute('title'), /version 1/);
    assert.equal(ctl.refs.versions.querySelector('[aria-current="true"]').getAttribute('data-run'), 'r1'); ctl.close();
  });
}
