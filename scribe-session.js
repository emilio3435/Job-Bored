/* ============================================================
   scribe-session.js — selected-role / document / ATS / refine state
   ------------------------------------------------------------
   Isolated helper for Scribe (F3-B). No DOM. No network. No paid
   ATS providers. Fixture scorecards are first-class input.

   Public surface:
     window.JobBoredScribeSession.create() => session
   ============================================================ */

(function (root) {
  "use strict";

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function clampScore(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function emptyAxes() {
    return { req: 0, exp: 0, impact: 0, parse: 0, tone: 0, conf: 0 };
  }

  function confidenceToPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n >= 0 && n <= 1) return clampScore(n * 100);
    return clampScore(n);
  }

  function axesFromScorecard(result) {
    const ds = (result && result.dimensionScores) || {};
    return {
      req: clampScore(ds.requirementsCoverage),
      exp: clampScore(ds.experienceRelevance),
      impact: clampScore(ds.impactClarity),
      parse: clampScore(ds.atsParseability),
      tone: clampScore(ds.toneFit),
      conf: confidenceToPercent(result && result.confidence),
    };
  }

  function normalizeRole(input) {
    const src = input && typeof input === "object" ? input : {};
    const jobKey = String(src.jobKey || "").trim();
    if (!jobKey) return null;
    return {
      jobKey,
      title: String(src.title || "").trim(),
      company: String(src.company || "").trim(),
      url: String(src.url || "").trim(),
    };
  }

  function create() {
    let role = null;
    let documentState = null;
    let ats = { jobKey: null, status: "idle", result: null, error: null };
    let refine = {
      status: "idle",
      completed: true,
      ok: null,
      error: "",
      feedback: "",
    };

    function snapshot() {
      return {
        role: clone(role),
        document: clone(documentState),
        ats: clone(ats),
        refine: clone(refine),
      };
    }

    function roleLabel() {
      if (!role) return "No role selected";
      const title = role.title || "Untitled role";
      return role.company ? `${title} · ${role.company}` : title;
    }

    function currentText() {
      return documentState ? String(documentState.text || "") : "";
    }

    function gapsFromScorecard(result, axes) {
      const critical = Array.isArray(result && result.criticalGaps)
        ? result.criticalGaps
            .map((g, i) => ({
              axis: String((g && (g.severity || g.axis)) || "gap"),
              text: String((g && (g.gap || g.text)) || "").trim(),
              anchor: i,
            }))
            .filter((g) => g.text)
        : [];
      if (critical.length) return critical.slice(0, 3);
      const ranked = [
        { key: "req", label: "Req", pct: axes.req },
        { key: "exp", label: "Experience", pct: axes.exp },
        { key: "impact", label: "Impact", pct: axes.impact },
        { key: "parse", label: "Parseability", pct: axes.parse },
        { key: "tone", label: "Tone", pct: axes.tone },
        { key: "conf", label: "Confidence", pct: axes.conf },
      ]
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 3);
      return ranked.map((a, i) => ({
        axis: a.label,
        text: `${a.label} reads ${a.pct}%. Add a concrete example or rephrase the matching paragraph.`,
        anchor: i,
      }));
    }

    function talkingFromScorecard(result) {
      const suggestions = Array.isArray(result && result.rewriteSuggestions)
        ? result.rewriteSuggestions
            .map((row) => String((row && (row.after || row.rationale)) || "").trim())
            .filter(Boolean)
        : [];
      if (suggestions.length) return suggestions.slice(0, 4);
      const strengths = Array.isArray(result && result.topStrengths)
        ? result.topStrengths.map((row) => String(row || "").trim()).filter(Boolean)
        : [];
      return strengths.slice(0, 4);
    }

    function visibleScorecard() {
      const text = currentText().trim();
      if (!text) {
        return {
          overall: 0,
          axes: emptyAxes(),
          source: "empty",
          labeled: true,
          emptyDocument: true,
          model: "no document to score",
          label: "No document to score",
          gaps: [],
          talking: [],
        };
      }
      const roleKey = role && role.jobKey;
      const atsMatches =
        ats.status === "success" &&
        ats.result &&
        ats.jobKey &&
        roleKey &&
        ats.jobKey === roleKey;
      if (atsMatches) {
        const axes = axesFromScorecard(ats.result);
        return {
          overall: clampScore(ats.result.overallScore),
          axes,
          source: "ats",
          labeled: false,
          emptyDocument: false,
          model: String(ats.result.model || "ats-scorecard"),
          label: "",
          gaps: gapsFromScorecard(ats.result, axes),
          talking: talkingFromScorecard(ats.result),
        };
      }
      return {
        overall: 0,
        axes: emptyAxes(),
        source: "unavailable",
        labeled: true,
        emptyDocument: false,
        model: "ATS evidence unavailable",
        label: "ATS evidence unavailable",
        gaps: [],
        talking: [],
      };
    }

    function bindRole(input) {
      role = normalizeRole(input);
      if (!role) {
        documentState = null;
        return null;
      }
      if (ats.jobKey && ats.jobKey !== role.jobKey) {
        ats = { jobKey: null, status: "idle", result: null, error: null };
      }
      return clone(role);
    }

    function clearRole() {
      role = null;
      documentState = null;
      ats = { jobKey: null, status: "idle", result: null, error: null };
    }

    function setDocument(input) {
      const src = input && typeof input === "object" ? input : {};
      documentState = {
        feature: src.feature === "resume_update" ? "resume_update" : "cover_letter",
        versionNumber:
          Number.isInteger(src.versionNumber) && src.versionNumber > 0
            ? src.versionNumber
            : src.versionNumber == null
              ? null
              : Number(src.versionNumber) || null,
        draftId: src.draftId ? String(src.draftId) : null,
        text: String(src.text || ""),
        dirty: false,
      };
      return clone(documentState);
    }

    function noteUnsavedText(text) {
      if (!documentState) {
        documentState = {
          feature: "cover_letter",
          versionNumber: null,
          draftId: null,
          text: "",
          dirty: true,
        };
      }
      documentState.text = String(text || "");
      documentState.dirty = true;
      return clone(documentState);
    }

    function bindAtsEvidence(input) {
      const src = input && typeof input === "object" ? input : {};
      ats = {
        jobKey: src.jobKey ? String(src.jobKey) : null,
        status: String(src.status || "idle"),
        result: src.result && typeof src.result === "object" ? clone(src.result) : null,
        error: src.error ? String(src.error) : null,
      };
      return clone(ats);
    }

    function beginRefine(input) {
      const src = input && typeof input === "object" ? input : {};
      refine = {
        status: "refining",
        completed: false,
        ok: null,
        error: "",
        feedback: String(src.feedback || ""),
      };
      return clone(refine);
    }

    function completeRefine(input) {
      const src = input && typeof input === "object" ? input : {};
      const ok = src.ok !== false && !src.error;
      if (ok) {
        refine = {
          status: "refined",
          completed: true,
          ok: true,
          error: "",
          feedback: refine.feedback,
        };
        if (documentState) {
          if (src.text != null) documentState.text = String(src.text);
          if (src.draftId) documentState.draftId = String(src.draftId);
          if (src.versionNumber != null) {
            documentState.versionNumber = Number(src.versionNumber) || documentState.versionNumber;
          }
          documentState.dirty = false;
        }
      } else {
        refine = {
          status: "refine failed",
          completed: true,
          ok: false,
          error: String(src.error || "refine failed"),
          feedback: refine.feedback,
        };
      }
      return clone(refine);
    }

    function canExport() {
      if (refine.status === "refining" && refine.completed === false) return false;
      if (documentState && documentState.dirty) return false;
      return true;
    }

    async function flush(opts) {
      const options = opts && typeof opts === "object" ? opts : {};
      if (documentState) documentState.dirty = false;
      const result = {
        flushed: true,
        persisted: false,
        error: "",
        draftId: documentState ? documentState.draftId : null,
        versionNumber: documentState ? documentState.versionNumber : null,
      };
      if (typeof options.persist !== "function") return result;
      try {
        const saved = await options.persist({
          text: currentText(),
          feature: documentState ? documentState.feature : "cover_letter",
          jobKey: role ? role.jobKey : null,
          parentDraftId: documentState ? documentState.draftId : null,
          title: role ? role.title : "",
          company: role ? role.company : "",
        });
        if (saved && (saved.draftId || saved.versionNumber != null)) {
          result.persisted = true;
          result.draftId = saved.draftId || result.draftId;
          if (saved.versionNumber != null) result.versionNumber = saved.versionNumber;
          if (documentState) {
            if (saved.draftId) documentState.draftId = String(saved.draftId);
            if (saved.versionNumber != null) {
              documentState.versionNumber = Number(saved.versionNumber) || documentState.versionNumber;
            }
          }
        } else {
          result.persisted = true;
        }
      } catch (err) {
        result.persisted = false;
        result.error = err && err.message ? String(err.message) : String(err || "persist failed");
      }
      return result;
    }

    return {
      snapshot,
      roleLabel,
      visibleScorecard,
      bindRole,
      clearRole,
      setDocument,
      noteUnsavedText,
      bindAtsEvidence,
      beginRefine,
      completeRefine,
      flush,
      canExport,
    };
  }

  root.JobBoredScribeSession = {
    create,
    axesFromScorecard,
  };
})(typeof window !== "undefined" ? window : globalThis);
