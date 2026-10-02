/* ============================================================
   scribe-score-adapter.js — JobBored v2 Scribe: the REAL score
   ------------------------------------------------------------
   Owner:      Scribe (P0-E)
   Global:     window.JobBoredScribeScore (classic global, no ESM)
   Load order: BEFORE scribe.js (index.html, defer).

   Scribe used to paint a word-count heuristic and stamp it
   "model demo-scorecard-v1". The real scorecard is produced by
   ats-scorecard.js (fetchAtsScorecard -> normalizeAtsScorecardResult)
   and broadcast by materials-state.js on the `jb:ats:state` bus:

     detail = { jobKey, status: idle|loading|success|error,
                result, error }

   whose result carries overallScore, five dimensionScores,
   evidence[] {claim, sourceSnippet, sourceType}, criticalGaps[]
   {gap, whyItMatters, severity}, confidence and model
   (AGENT_CONTRACT.md dossier event family — shapes are locked).

   REQUEST POLICY (the reason this is an adapter and not a fetch):
     - Subscribe to jb:ats:state always; render whatever the bus
       says, including loading/error/never-scored.
     - At mount, emit `jb:ats:state:request` — a pure re-broadcast
       of state materials-state.js already holds. Zero network.
     - Start a network analysis ONLY on an explicit user action
       (the Rescore button), and only one at a time. Keystrokes
       never trigger scoring: piggybacking a paid ATS call on the
       legacy 900ms idle refresh is a cost bug.

   Unknown is not zero: with no result there is NO percent on the
   ring and no axis numbers at all.

   HOLES SCORE: nothing paints here any more. The score modal
   (materials-score.js) shows the grade; this module keeps the bus
   view (getView, with stale when the text moved on), Rescore and
   keywordCoverage.
   ============================================================ */

(function () {
  "use strict";

  // Order matches ats-scorecard.js normalizeAtsScorecardResult.
  const DIMENSIONS = [
    { key: "requirementsCoverage", label: "Requirements", help: "Required keywords coverage" },
    { key: "experienceRelevance", label: "Experience", help: "Years / level fit" },
    { key: "impactClarity", label: "Impact", help: "Outcome-driven phrasing" },
    { key: "atsParseability", label: "Parseability", help: "ATS-safe structure" },
    { key: "toneFit", label: "Tone", help: "Voice match" },
  ];

  const NOTES = {
    empty: "Nothing to score yet — this document is empty.",
    idle: "This draft is not scored yet.",
    loading: "Scoring this draft against the role…",
    unbound: "No role is bound, so there is nothing to score this draft against.",
    incomplete: "This role is missing a title or company, so it cannot be scored.",
    foreign: "The last score was measured against a different role — rescore this draft.",
    stale: "This draft changed after it was scored — rescore to update the grade.",
  };

  const state = {
    getText: null,
    bus: { status: "idle", result: null, error: "", jobKey: null },
    note: "",
    inFlight: false,
    unsubscribe: null,
  };

  function app() {
    return window.JobBoredApp || null;
  }

  function ats() {
    const a = app();
    return a && a.ats ? a.ats : null;
  }

  function materialsState() {
    const a = app();
    return a && a.materialsState ? a.materialsState : null;
  }

  function session() {
    const a = app();
    const rg = a && a.resumeGeneration ? a.resumeGeneration : null;
    if (!rg || typeof rg.getLastResumeGenerationSession !== "function") return null;
    try {
      return rg.getLastResumeGenerationSession() || null;
    } catch (_err) {
      return null;
    }
  }

  function currentText() {
    if (typeof state.getText !== "function") return "";
    try {
      return String(state.getText() || "").trim();
    } catch (_err) {
      return "";
    }
  }

  // ---------------------------------------------------------
  // Stale foreign-role evidence (F3B-SCRIBE02)
  // ---------------------------------------------------------
  /* materials-state.js holds the LAST ats scorecard state and nothing clears
     it when the workspace rebinds, so a plain "render whatever the bus says"
     paints role A's score over role B's draft — a wrong number delivered with
     full confidence, which is worse than no number.

     The bus jobKey IS the ATS cache key (materials-state.js:43 forwards
     atsScorecardState.cacheKey), built by ats-scorecard.js:58 as

         feature | jobOpportunityKey | hash(text) | hash(transport) | hash(role)

     so the first two segments name the role+feature. Only those take part:
     segment 3 is the scored text, and comparing it would blank an honest
     score on every keystroke.

     The guard fires only on PROOF — a bound role we can compute an expected
     key for, and a bus key structured enough to compare. An opaque key is not
     evidence of foreignness, and this module does not invent verdicts (the
     same rule that keeps "unknown" from rendering as zero). */
  const KEY_SEP = "|";

  function roleScopeOf(cacheKey) {
    const parts = String(cacheKey || "").split(KEY_SEP);
    if (parts.length < 2) return "";
    if (!parts[0] || !parts[1]) return "";
    return parts[0] + KEY_SEP + parts[1];
  }

  /** The cache key the bound session + current draft would be scored under,
   *  or "" when there is nothing to compare against. */
  function boundKey() {
    const api = ats();
    if (!api || typeof api.computeAtsScorecardCacheKey !== "function") return "";
    const current = session();
    const job = current && current.job && typeof current.job === "object" ? current.job : null;
    if (!job) return "";
    const text = currentText();
    if (!text) return "";
    const feature = current.feature === "resume_update" ? "resume_update" : "cover_letter";
    try {
      return String(api.computeAtsScorecardCacheKey(text, job, feature) || "");
    } catch (_err) {
      return "";
    }
  }

  function boundRoleScope() {
    return roleScopeOf(boundKey());
  }

  /* U12 (HOLES SCORE): segment 3 of the key is the scored text's hash. The
     role-scope guard leaves it out on purpose; staleness reads it — the
     same role's score of other text is a grade the draft moved on from. */
  function textHashOf(cacheKey) {
    const parts = String(cacheKey || "").split(KEY_SEP);
    return parts.length >= 3 ? parts[2] : "";
  }

  function scoreIsStale(bus) {
    if (!bus || bus.status !== "success" || !bus.jobKey) return false;
    const got = textHashOf(bus.jobKey);
    const want = textHashOf(boundKey());
    return !!(got && want && got !== want);
  }

  function evidenceIsForeign(bus) {
    if (!bus || !bus.jobKey) return false;
    const got = roleScopeOf(bus.jobKey);
    if (!got) return false;
    const want = boundRoleScope();
    if (!want) return false;
    return got !== want;
  }

  // ---------------------------------------------------------
  // View derivation (pure)
  // ---------------------------------------------------------
  function buildView(bus, opts) {
    const o = opts || {};
    if (o.docEmpty) return { status: "empty", result: null, error: "", note: NOTES.empty };
    const status = (bus && bus.status) || "idle";
    if (status === "loading") return { status: "loading", result: null, error: "", note: NOTES.loading };
    if (status === "error") {
      return {
        status: "error",
        result: null,
        error: String((bus && bus.error) || "").trim() || "The scorer did not return a result.",
        note: String((bus && bus.error) || "").trim() || "The scorer did not return a result.",
      };
    }
    if (status === "success" && bus && bus.result) {
      if (o.foreign) {
        return { status: "idle", result: null, error: "", note: NOTES.foreign };
      }
      if (o.stale) return { status: "success", result: bus.result, error: "", note: NOTES.stale, stale: true };
      return { status: "success", result: bus.result, error: "", note: "", stale: false };
    }
    return { status: "idle", result: null, error: "", note: NOTES.idle };
  }

  function getView() {
    const view = buildView(state.bus, {
      docEmpty: !currentText(),
      foreign: evidenceIsForeign(state.bus),
      stale: scoreIsStale(state.bus),
    });
    // A refusal reason the user just triggered outranks the standing note,
    // but never the state itself.
    if (state.note && view.status !== "success") return { ...view, note: state.note };
    return view;
  }

  // ---------------------------------------------------------
  // Bus wiring
  // ---------------------------------------------------------
  function onBusState(e) {
    const detail = (e && e.detail) || {};
    state.bus = {
      status: String(detail.status || "idle"),
      result: detail.result || null,
      error: detail.error || "",
      jobKey: detail.jobKey || null,
    };
    if (state.bus.status === "success" || state.bus.status === "error") state.inFlight = false;
    state.note = "";
  }

  /** Ask materials-state.js to re-broadcast what it already holds. No network. */
  function requestState() {
    window.dispatchEvent(
      new CustomEvent("jb:ats:state:request", { detail: { jobKey: null, source: "scribe" } }),
    );
  }

  function hydrateFromState() {
    const ms = materialsState();
    if (!ms || typeof ms.getAtsScorecardState !== "function") return;
    try {
      const current = ms.getAtsScorecardState();
      if (!current) return;
      state.bus = {
        status: String(current.status || "idle"),
        result: current.result || null,
        error: current.error || "",
        jobKey: current.cacheKey || null,
      };
    } catch (err) {
      console.warn("[JobBored] scribe score hydrate:", err);
    }
  }

  /**
   * Explicit, user-initiated rescore. Returns {started, reason}.
   * This is the ONLY path in the lane that can cost a provider call.
   */
  function requestRescore() {
    const text = currentText();
    if (!text) {
      state.note = NOTES.empty;
      return { started: false, reason: "empty" };
    }
    const current = session();
    const job = current && current.job && typeof current.job === "object" ? current.job : null;
    const hasRole = !!(job && (String(job.title || "").trim() || String(job.company || "").trim()));
    if (!hasRole) {
      state.note = NOTES.unbound;
      return { started: false, reason: "unbound" };
    }
    const api = ats();
    if (!api || typeof api.startAtsScorecardAnalysis !== "function") {
      state.note = "Scoring is unavailable in this session.";
      return { started: false, reason: "no-scorer" };
    }
    if (state.inFlight || state.bus.status === "loading") {
      return { started: false, reason: "in-flight" };
    }
    const feature = current.feature === "resume_update" ? "resume_update" : "cover_letter";
    const cacheKey = api.computeAtsScorecardCacheKey(text, job, feature);
    if (!cacheKey) {
      state.note = NOTES.incomplete;
      return { started: false, reason: "incomplete-role" };
    }
    const payload = api.buildAtsScorecardRequestPayload(text, job, current);
    state.inFlight = true;
    state.note = "";
    try {
      api.startAtsScorecardAnalysis(cacheKey, payload);
    } catch (err) {
      state.inFlight = false;
      state.note = `Rescore failed to start: ${String((err && err.message) || err)}`;
      return { started: false, reason: "threw" };
    }
    return { started: true, reason: "" };
  }

  function mount(region, opts) {
    const options = opts || {};
    state.getText = typeof options.getText === "function" ? options.getText : null;
    if (!state.unsubscribe) {
      window.addEventListener("jb:ats:state", onBusState);
      state.unsubscribe = () => window.removeEventListener("jb:ats:state", onBusState);
    }
    hydrateFromState();
    requestState();
    return {
      requestRescore,
      unmount() {
        if (state.unsubscribe) state.unsubscribe();
        state.unsubscribe = null;
      },
    };
  }

  /* UX01 C14 (MP-03): the free, deterministic half of scoring. Which of the
     posting's named terms the draft already uses — whole-word, case-folded,
     no network call, so it can recompute on every keystroke. The paid AI
     scorecard stays behind Rescore. */
  function normTerm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();
  }
  function keywordCoverage(text, terms) {
    const hay = ` ${normTerm(text)} `;
    const seen = new Set();
    const matched = [];
    const missing = [];
    for (const raw of Array.isArray(terms) ? terms : []) {
      const label = String(raw == null ? "" : raw).trim();
      const key = normTerm(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      (hay.includes(` ${key} `) ? matched : missing).push(label);
    }
    return { matched, missing, total: matched.length + missing.length };
  }

  window.JobBoredScribeScore = Object.freeze({
    keywordCoverage,
    DIMENSIONS,
    mount,
    buildView,
    getView,
    requestState,
    requestRescore,
  });
})();
