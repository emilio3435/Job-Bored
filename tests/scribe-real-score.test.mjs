import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadScribe } from "./fixtures/scribe/scribe-dom.mjs";

// ============================================================
// SCRIBE-02 — the demo heuristic presented as the score.
//
// scribe.js paints deriveAxisScores() — a word-count heuristic —
// into the scorecard and stamps it "model demo-scorecard-v1". For
// an EMPTY document that heuristic still yields ~40%, so the pane
// reports a match for a document that does not exist. Meanwhile the
// real pipeline (ats-scorecard.js -> materials-state.js) broadcasts
// normalized results on the jb:ats:state bus (AGENT_CONTRACT.md
// dossier event family) that scribe never subscribes to.
//
// The bus payload is locked: {jobKey, status, result, error} where
// result carries dimensionScores (5 keys), evidence[] with
// claim/sourceSnippet/sourceType, criticalGaps[] and overallScore.
//
// Request policy under test: the adapter SUBSCRIBES and may emit
// jb:ats:state:request (a pure re-broadcast, no network). It must
// never start a network analysis off a keystroke — only off an
// explicit user action.
// ============================================================

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
  topStrengths: ["Ships platform work end to end"],
  criticalGaps: [
    { gap: "No Kubernetes experience named", whyItMatters: "Listed as a must-have", severity: "high" },
    { gap: "No team size given", whyItMatters: "The role leads a team of eight", severity: "medium" },
  ],
  evidence: [
    {
      claim: "Cut deploy latency by 38%",
      sourceSnippet: "reduced p95 deploy time from 22m to 13m",
      sourceType: "resume",
    },
    {
      claim: "Requires Kubernetes",
      sourceSnippet: "You will own our multi-tenant Kubernetes estate",
      sourceType: "job",
    },
  ],
  rewriteSuggestions: [],
  confidence: 0.82,
  model: "claude-opus-5",
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

const BOUND_SESSION = {
  feature: "cover_letter",
  job: { title: "Staff Platform Engineer", company: "Northwind" },
};

const MODULES = ["scribe-state.js", "scribe-score-adapter.js", "scribe.js"];

function axesOf(env) {
  return env.rqa(".scribe-axis").map((el) => ({
    label: el.querySelector(".scribe-axis__label").textContent,
    value: el.querySelector(".scribe-axis__value").textContent,
    tier: el.getAttribute("data-tier"),
  }));
}

describe("scribe scorecard — an empty document has no score (SCRIBE-02)", () => {
  it("shows an explicit no-score state for an empty editor instead of the heuristic's ~40%", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "" });
    const card = env.byId("scribeScorecard");
    assert.equal(card.getAttribute("data-score-state"), "empty");
    assert.equal(axesOf(env).length, 0, "no axis may carry a number for an empty document");
    assert.equal(
      env.byId("scribeFitRing").getAttribute("percent"),
      null,
      "the fit ring must carry NO percent when there is nothing to score (0 would read as a measured zero)",
    );
    assert.equal(
      env.byId("scribeFitRing").getAttribute("aria-hidden"),
      "true",
      "jb-fit-ring is a role=meter that always publishes aria-valuenow — an empty meter must not be announced as 0",
    );
    assert.match(env.rq("[data-scribe-score-note]").textContent, /nothing to score/i);
  });

  it("a document with text but no score yet reads 'not scored', which is not the same as a zero score", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({
      modules: MODULES,
      jobBoredApp: host.app,
      legacyText: "Dear hiring team, I build platforms.",
    });
    assert.equal(env.byId("scribeScorecard").getAttribute("data-score-state"), "idle");
    assert.equal(axesOf(env).length, 0);
    assert.equal(env.byId("scribeFitRing").getAttribute("percent"), null);
    assert.match(env.rq("[data-scribe-score-note]").textContent, /not scored yet/i);
  });

  it("the demo scorer is gone from the source — no heuristic axis numbers and no demo-scorecard-v1 stamp anywhere", () => {
    const env = loadScribe({ modules: MODULES, jobBoredApp: makeAtsHost().app });
    const rendered = env.region.textContent;
    assert.ok(!/demo-scorecard-v1/.test(rendered), "the demo model footer must not render");
    assert.equal(env.window.JB_SCRIBE.rescore, undefined, "the demo rescore entry point is gone");
  });
});

describe("scribe scorecard — real jb:ats:state results render (SCRIBE-02)", () => {
  it("renders the REAL dimensionScores and the REAL overallScore from a success payload on the bus", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });

    env.emit("jb:ats:state", {
      jobKey: "cover_letter|Northwind|8",
      status: "success",
      result: REAL_RESULT,
      error: null,
    });

    assert.equal(env.byId("scribeScorecard").getAttribute("data-score-state"), "success");
    assert.deepEqual(axesOf(env), [
      { label: "Requirements", value: "82%", tier: "high" },
      { label: "Experience", value: "74%", tier: "mid" },
      { label: "Impact", value: "61%", tier: "mid" },
      { label: "Parseability", value: "93%", tier: "high" },
      { label: "Tone", value: "55%", tier: "mid" },
    ]);
    assert.equal(
      env.byId("scribeFitRing").getAttribute("percent"),
      "78",
      "the ring shows the model's own overallScore, not an average scribe invented",
    );
    assert.equal(
      env.byId("scribeFitRing").getAttribute("aria-hidden"),
      null,
      "a real score is announced",
    );
  });

  it("cites the scoring model and its confidence — never a hardcoded demo label", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.emit("jb:ats:state", { jobKey: "k", status: "success", result: REAL_RESULT, error: null });
    const model = env.rq("[data-scribe-model]").textContent;
    assert.match(model, /claude-opus-5/);
    assert.match(model, /82%/, "confidence must be surfaced with the score");
    assert.ok(!/demo-scorecard-v1/.test(model));
  });

  it("renders the evidence[] the score was built from (claim, source snippet, source type) so the number is auditable", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.emit("jb:ats:state", { jobKey: "k", status: "success", result: REAL_RESULT, error: null });

    const items = env.rqa(".scribe-evidence__item");
    assert.equal(items.length, 2);
    assert.match(items[0].textContent, /Cut deploy latency by 38%/);
    assert.match(items[0].textContent, /reduced p95 deploy time from 22m to 13m/);
    assert.equal(items[0].getAttribute("data-source-type"), "resume");
    assert.equal(items[1].getAttribute("data-source-type"), "job");
  });

  it("renders the model's criticalGaps with their severity instead of the heuristic's 'weakest three axes' filler", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.emit("jb:ats:state", { jobKey: "k", status: "success", result: REAL_RESULT, error: null });

    const gaps = env.byId("scribeGaps").querySelectorAll(".scribe-gap");
    assert.equal(gaps.length, 2);
    assert.match(gaps[0].textContent, /No Kubernetes experience named/);
    assert.match(gaps[0].textContent, /Listed as a must-have/);
    assert.equal(gaps[0].getAttribute("data-severity"), "high");
    assert.equal(gaps[1].getAttribute("data-severity"), "medium");
  });

  it("a scored draft with zero gaps says 'no critical gaps' — a measured empty list, distinct from 'not scored'", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.emit("jb:ats:state", {
      jobKey: "k",
      status: "success",
      result: { ...REAL_RESULT, criticalGaps: [], evidence: [] },
      error: null,
    });
    assert.equal(env.byId("scribeScorecard").getAttribute("data-score-state"), "success");
    assert.match(env.byId("scribeGaps").textContent, /No critical gaps/i);
    assert.match(env.byId("scribeEvidence").textContent, /cited no evidence/i);
  });

  it("loading and error states are distinct from each other and from 'no score' — an error never renders as a number", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });

    env.emit("jb:ats:state", { jobKey: "k", status: "loading", result: null, error: null });
    assert.equal(env.byId("scribeScorecard").getAttribute("data-score-state"), "loading");
    assert.equal(axesOf(env).length, 0);

    env.emit("jb:ats:state", {
      jobKey: "k",
      status: "error",
      result: null,
      error: "ATS provider returned 503",
    });
    assert.equal(env.byId("scribeScorecard").getAttribute("data-score-state"), "error");
    assert.equal(axesOf(env).length, 0, "an error must clear the axes, not leave stale numbers");
    assert.equal(env.byId("scribeFitRing").getAttribute("percent"), null);
    assert.match(env.rq("[data-scribe-score-note]").textContent, /ATS provider returned 503/);
  });

  it("a stale success is dropped when a later loading event arrives (the pane always shows the newest bus state)", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.emit("jb:ats:state", { jobKey: "k", status: "success", result: REAL_RESULT, error: null });
    env.emit("jb:ats:state", { jobKey: "k", status: "loading", result: null, error: null });
    assert.equal(axesOf(env).length, 0, "the previous run's numbers must not linger under a new run");
  });

  it("hydrates from the CURRENT bus state at mount, so opening the workspace after a score does not show a blank card", () => {
    const host = makeAtsHost({
      session: BOUND_SESSION,
      state: { cacheKey: "k", status: "success", result: REAL_RESULT, error: "", payload: null },
    });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    assert.equal(env.byId("scribeScorecard").getAttribute("data-score-state"), "success");
    assert.equal(env.byId("scribeFitRing").getAttribute("percent"), "78");
  });
});

describe("scribe scorecard — request policy: subscribe always, fetch only on demand (SCRIBE-02)", () => {
  it("asks the bus to re-broadcast at mount (jb:ats:state:request) and starts NO network analysis", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const requests = [];
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.window.addEventListener("jb:ats:state:request", (e) => requests.push(e.detail));
    env.window.JobBoredScribeScore.requestState();
    assert.equal(requests.length, 1, "the re-broadcast request is a pure event, not a fetch");
    assert.equal(host.analyses.length, 0, "mount must never hit the scoring provider");
  });

  it("typing does NOT start an ATS analysis — keystroke-driven scoring is a cost bug, not a feature", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    const editor = env.byId("scribeEditor");
    editor.textContent = "A much longer draft that would change the cache key.";
    env.input(editor);
    env.timers.flush();
    assert.equal(host.analyses.length, 0, "no analysis may be started off the editor debounce");
  });

  it("an explicit Rescore click starts exactly ONE analysis, with the payload the real pipeline builds", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.byId("scribeRescoreBtn").click();
    assert.equal(host.analyses.length, 1);
    assert.equal(host.analyses[0].cacheKey, "cover_letter|Northwind|8");
    assert.equal(host.analyses[0].payload.docText, "A draft.");
    assert.equal(host.analyses[0].payload.job.company, "Northwind");
  });

  it("a second Rescore click while the first run is still loading does not fire a duplicate paid call", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.byId("scribeRescoreBtn").click();
    env.emit("jb:ats:state", { jobKey: "k", status: "loading", result: null, error: null });
    env.byId("scribeRescoreBtn").click();
    assert.equal(host.analyses.length, 1, "one in-flight analysis at a time");
  });

  it("Rescore on an empty document is refused with a reason instead of scoring nothing", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "" });
    env.byId("scribeRescoreBtn").click();
    assert.equal(host.analyses.length, 0);
    assert.match(env.rq("[data-scribe-score-note]").textContent, /nothing to score/i);
  });

  it("Rescore without a bound role is refused with a reason — the score needs a job to score against", () => {
    const host = makeAtsHost({ session: null });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.byId("scribeRescoreBtn").click();
    assert.equal(host.analyses.length, 0);
    assert.match(env.rq("[data-scribe-score-note]").textContent, /no role/i);
  });
});

// ============================================================
// SCRIBE-02b / F3B-SCRIBE02 — the stale foreign-role score leak.
//
// materials-state.js holds the LAST ats scorecard state and nothing
// clears it when the workspace rebinds to another role. Subscribing to
// jb:ats:state and rendering whatever arrives therefore paints role A's
// 92% over the draft you are writing for role B — a wrong number
// presented with full confidence, which is worse than no number.
//
// The bus `jobKey` IS the ATS cache key (materials-state.js:43 forwards
// atsScorecardState.cacheKey), built by ats-scorecard.js:58 as
//     feature|jobOpportunityKey|hash(text)|hash(transport)|hash(role)
// so the first two segments identify the role+feature and the third is
// the scored text — which must NOT take part, or every keystroke would
// invalidate an honest score.
//
// The guard is binding-scoped and only fires on PROOF: it needs a bound
// role it can compute an expected key for, and a bus key well-formed
// enough to compare. An opaque key is not evidence of foreignness, and
// this module does not invent verdicts (same rule as "unknown is not
// zero").
// ============================================================

describe("scribe scorecard — evidence bound to another role is refused (SCRIBE-02)", () => {
  it("does not paint a success scored against a DIFFERENT role over the bound role's draft", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });

    env.emit("jb:ats:state", {
      jobKey: "cover_letter|Southwind|11",
      status: "success",
      result: REAL_RESULT,
      error: null,
    });

    assert.notEqual(
      env.byId("scribeScorecard").getAttribute("data-score-state"),
      "success",
      "a score measured against another posting is not this draft's score",
    );
    assert.equal(axesOf(env).length, 0, "no axis may carry the foreign numbers");
    assert.equal(
      env.byId("scribeFitRing").getAttribute("percent"),
      null,
      "and the ring must not show 78 — an unrelated measurement is not a measurement",
    );
    assert.match(
      env.rq("[data-scribe-score-note]").textContent,
      /different role|another role|not scored/i,
      "the pane must say why it is blank rather than going quietly empty",
    );
  });

  it("still paints the score once the same role is scored again", () => {
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.emit("jb:ats:state", {
      jobKey: "cover_letter|Southwind|11",
      status: "success",
      result: REAL_RESULT,
      error: null,
    });
    env.emit("jb:ats:state", {
      jobKey: "cover_letter|Northwind|8",
      status: "success",
      result: REAL_RESULT,
      error: null,
    });
    assert.equal(env.byId("scribeScorecard").getAttribute("data-score-state"), "success");
    assert.equal(env.byId("scribeFitRing").getAttribute("percent"), "78");
  });

  it("ignores the text hash — editing the draft does not make its own score foreign", () => {
    // Segment 3 of the cache key is the scored text. If the guard compared
    // whole keys, one keystroke would blank a score that is still about this
    // role, and the user would learn to distrust the pane.
    const host = makeAtsHost({ session: BOUND_SESSION });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.emit("jb:ats:state", {
      jobKey: "cover_letter|Northwind|999",
      status: "success",
      result: REAL_RESULT,
      error: null,
    });
    assert.equal(env.byId("scribeScorecard").getAttribute("data-score-state"), "success");
  });

  it("never guards when there is no bound role to contradict the evidence", () => {
    const host = makeAtsHost({ session: null });
    const env = loadScribe({ modules: MODULES, jobBoredApp: host.app, legacyText: "A draft." });
    env.emit("jb:ats:state", {
      jobKey: "cover_letter|Northwind|8",
      status: "success",
      result: REAL_RESULT,
      error: null,
    });
    assert.equal(
      env.byId("scribeScorecard").getAttribute("data-score-state"),
      "success",
      "with nothing bound there is no contradiction — refusing here would hide real scores",
    );
  });
});
