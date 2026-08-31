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

  const SOURCE_LABELS = {
    resume: "Resume",
    cover_letter: "Cover letter",
    job: "Job posting",
    profile: "Profile",
  };

  const NOTES = {
    empty: "Nothing to score yet — this document is empty.",
    idle: "This draft is not scored yet.",
    loading: "Scoring this draft against the role…",
    unbound: "No role is bound, so there is nothing to score this draft against.",
    incomplete: "This role is missing a title or company, so it cannot be scored.",
    foreign: "The last score was measured against a different role — rescore this draft.",
  };

  const state = {
    region: null,
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

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tierFor(pct) {
    if (pct >= 75) return "high";
    if (pct >= 50) return "mid";
    return "low";
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

  /** The role scope the bound session + current draft would be scored under,
   *  or "" when there is nothing to compare against. */
  function boundRoleScope() {
    const api = ats();
    if (!api || typeof api.computeAtsScorecardCacheKey !== "function") return "";
    const current = session();
    const job = current && current.job && typeof current.job === "object" ? current.job : null;
    if (!job) return "";
    const text = currentText();
    if (!text) return "";
    const feature = current.feature === "resume_update" ? "resume_update" : "cover_letter";
    try {
      return roleScopeOf(api.computeAtsScorecardCacheKey(text, job, feature));
    } catch (_err) {
      return "";
    }
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
      return { status: "success", result: bus.result, error: "", note: "" };
    }
    return { status: "idle", result: null, error: "", note: NOTES.idle };
  }

  function getView() {
    const view = buildView(state.bus, {
      docEmpty: !currentText(),
      foreign: evidenceIsForeign(state.bus),
    });
    // A refusal reason the user just triggered outranks the standing note,
    // but never the state itself.
    if (state.note && view.status !== "success") return { ...view, note: state.note };
    return view;
  }

  // ---------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------
  function renderAxes(result) {
    return DIMENSIONS.map((dim) => {
      const pct = Math.max(0, Math.min(100, Number(result.dimensionScores[dim.key]) || 0));
      const tier = tierFor(pct);
      return `
        <div class="scribe-axis" data-tier="${tier}" data-axis="${dim.key}" role="listitem"
             aria-label="${escapeHtml(dim.label)} ${pct}%" title="${escapeHtml(dim.help)}">
          <span class="scribe-axis__label">${escapeHtml(dim.label)}</span>
          <span class="scribe-axis__bar" aria-hidden="true">
            <span class="scribe-axis__fill" style="--scribe-axis-pct:${pct}%"></span>
          </span>
          <span class="scribe-axis__value jb-data">${pct}%</span>
        </div>
      `;
    }).join("");
  }

  function renderGaps(result) {
    const gaps = Array.isArray(result.criticalGaps) ? result.criticalGaps : [];
    if (!gaps.length) {
      return '<li class="scribe-gaps__empty">No critical gaps in the scored draft.</li>';
    }
    return gaps
      .map(
        (gap) => `
        <li>
          <div class="scribe-gap" data-severity="${escapeHtml(gap.severity || "medium")}">
            <span class="scribe-gap__axis">${escapeHtml(String(gap.severity || "medium").toUpperCase())}</span>
            <span class="scribe-gap__body">
              <span class="scribe-gap__text">${escapeHtml(gap.gap)}</span>
              <span class="scribe-gap__why">${escapeHtml(gap.whyItMatters)}</span>
            </span>
          </div>
        </li>
      `,
      )
      .join("");
  }

  function renderEvidence(result) {
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
    if (!evidence.length) {
      return '<li class="scribe-evidence__empty">This score cited no evidence.</li>';
    }
    return evidence
      .map(
        (item) => `
        <li class="scribe-evidence__item" data-source-type="${escapeHtml(item.sourceType || "profile")}">
          <span class="scribe-evidence__claim">${escapeHtml(item.claim)}</span>
          <span class="scribe-evidence__snippet">${escapeHtml(item.sourceSnippet)}</span>
          <span class="scribe-evidence__source">${escapeHtml(
            SOURCE_LABELS[item.sourceType] || "Profile",
          )}</span>
        </li>
      `,
      )
      .join("");
  }

  function renderTalking(result) {
    const strengths = Array.isArray(result.topStrengths) ? result.topStrengths : [];
    if (!strengths.length) {
      return `
        <li class="scribe-talking__item">
          <span class="scribe-talking__bullet" aria-hidden="true">·</span>
          <span>The scored draft surfaced no standout strengths.</span>
        </li>
      `;
    }
    return strengths
      .map(
        (point) => `
        <li class="scribe-talking__item">
          <span class="scribe-talking__bullet" aria-hidden="true">›</span>
          <span>${escapeHtml(point)}</span>
        </li>
      `,
      )
      .join("");
  }

  function render(region, view) {
    if (!region) return;
    const card = region.querySelector("#scribeScorecard");
    const ring = region.querySelector("#scribeFitRing");
    const axesEl = region.querySelector("#scribeAxes");
    const modelEl = region.querySelector("[data-scribe-model]");
    const noteEl = region.querySelector("[data-scribe-score-note]");
    const gapsEl = region.querySelector("#scribeGaps");
    const evidenceEl = region.querySelector("#scribeEvidence");
    const talkingEl = region.querySelector("#scribeTalking");
    const scored = view.status === "success" && view.result;

    if (card) card.setAttribute("data-score-state", view.status);

    if (ring) {
      if (scored) {
        const overall = Math.max(0, Math.min(100, Number(view.result.overallScore) || 0));
        ring.setAttribute("percent", String(overall));
        ring.setAttribute("label", `Overall ATS match ${overall}%`);
        ring.removeAttribute("data-unscored");
        ring.removeAttribute("aria-hidden");
      } else {
        // No percent attribute at all: 0 would read as a measured zero.
        ring.removeAttribute("percent");
        ring.setAttribute("label", "Overall ATS match not available");
        ring.setAttribute("data-unscored", "true");
        // jb-fit-ring is a role="meter" and always publishes an
        // aria-valuenow (0 with no percent). Hide the empty meter from the
        // a11y tree; [data-scribe-score-note] carries the honest text.
        ring.setAttribute("aria-hidden", "true");
      }
    }

    if (axesEl) axesEl.innerHTML = scored ? renderAxes(view.result) : "";
    if (noteEl) noteEl.textContent = scored ? "" : view.note || "";
    if (modelEl) {
      if (scored) {
        const confidence = Math.round(Number(view.result.confidence || 0) * 100);
        modelEl.textContent = `model ${view.result.model} · confidence ${confidence}%`;
      } else {
        modelEl.textContent = "no score on record";
      }
    }
    if (gapsEl) {
      gapsEl.innerHTML = scored
        ? renderGaps(view.result)
        : '<li class="scribe-gaps__empty">Gap callouts appear once this draft is scored.</li>';
    }
    if (evidenceEl) {
      evidenceEl.innerHTML = scored
        ? renderEvidence(view.result)
        : '<li class="scribe-evidence__empty">Evidence appears once this draft is scored.</li>';
    }
    if (talkingEl) {
      talkingEl.innerHTML = scored
        ? renderTalking(view.result)
        : `
        <li class="scribe-talking__item">
          <span class="scribe-talking__bullet" aria-hidden="true">·</span>
          <span>Talking points appear once this draft is scored.</span>
        </li>
      `;
    }
  }

  function paint() {
    render(state.region, getView());
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
    paint();
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
      paint();
      return { started: false, reason: "empty" };
    }
    const current = session();
    const job = current && current.job && typeof current.job === "object" ? current.job : null;
    const hasRole = !!(job && (String(job.title || "").trim() || String(job.company || "").trim()));
    if (!hasRole) {
      state.note = NOTES.unbound;
      paint();
      return { started: false, reason: "unbound" };
    }
    const api = ats();
    if (!api || typeof api.startAtsScorecardAnalysis !== "function") {
      state.note = "Scoring is unavailable in this session.";
      paint();
      return { started: false, reason: "no-scorer" };
    }
    if (state.inFlight || state.bus.status === "loading") {
      return { started: false, reason: "in-flight" };
    }
    const feature = current.feature === "resume_update" ? "resume_update" : "cover_letter";
    const cacheKey = api.computeAtsScorecardCacheKey(text, job, feature);
    if (!cacheKey) {
      state.note = NOTES.incomplete;
      paint();
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
      paint();
      return { started: false, reason: "threw" };
    }
    paint();
    return { started: true, reason: "" };
  }

  function mount(region, opts) {
    const options = opts || {};
    state.region = region || null;
    state.getText = typeof options.getText === "function" ? options.getText : null;
    if (!state.unsubscribe) {
      window.addEventListener("jb:ats:state", onBusState);
      state.unsubscribe = () => window.removeEventListener("jb:ats:state", onBusState);
    }
    hydrateFromState();
    paint();
    requestState();
    return {
      refresh: paint,
      requestRescore,
      unmount() {
        if (state.unsubscribe) state.unsubscribe();
        state.unsubscribe = null;
        state.region = null;
      },
    };
  }

  window.JobBoredScribeScore = Object.freeze({
    DIMENSIONS,
    mount,
    render,
    buildView,
    getView,
    requestState,
    requestRescore,
    refresh: paint,
  });
})();
