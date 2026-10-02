/* ============================================================
   materials-score.js — the quality-check button and its modal
   ------------------------------------------------------------
   HOLES lane SCORE built the one-button + modal layout (§0.3); GRADE
   (docs/programs/grade-20261002/SPEC-GRADE.md D1, D7, A3) retired its
   letter grade and every "N of 100": a document shows its verdict word
   and the first reason ("Fails · 1 claim needs a source", "Ready").

   One pure view, verdictView(qualityDoc), feeds every surface: the
   button, the modal (Why, Coverage, Writing, Reviews, Versions), the
   version rows both lists share (versionsHtml), the Case tile and
   Scribe's header. open(spec) puts the modal in the page through
   JobBoredA11y.dialog; the host passes read() for the data and the
   actions it can take (fix, apply, repair, rescore, loadHistory,
   promote, download). A host that cannot take one leaves it out, and its
   buttons are not drawn.

   Published as window.JobBoredMaterialsScore.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* -------------------- GRADE: the verdict view -------------------- */

  /* SPEC-GRADE A3 "Front-end view": a document's quality check is its
     verdict word and the first reason — never a letter, a total or an ATS
     percentage. Every surface (button, modal, version rows, Case tile,
     Scribe header) renders from verdictView. */
  var WORDS = { READY: "Ready", REVIEW: "Needs review", FAIL: "Fails" };
  var TONES = { READY: "ok", REVIEW: "warn", FAIL: "err" };
  var DOC_LABEL = { resume: "Resume", cover_letter: "Cover letter" };
  var DOC_NOUN = { resume: "resume", cover_letter: "cover letter" };

  function finite(n) {
    return typeof n === "number" && isFinite(n);
  }

  function list(v) {
    return Array.isArray(v) ? v.filter(Boolean) : [];
  }

  function cap(s) {
    var t = String(s || "");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

  function insights() {
    var mi = root.JobBoredMaterialsInsights;
    return mi && typeof mi.qaIssues === "function" ? mi : null;
  }

  /* The manifest's quality record (quality.documents[type].qa). */
  function qaOf(qualityDoc) {
    var qa = qualityDoc && qualityDoc.qa;
    return qa && typeof qa === "object" ? qa : null;
  }

  /* 1 for an old rubric record, 2 for the judge's v2 record, 3 for GRADE's
     verdict record; the same sniff as materials-insights.js qaVersion. */
  function qaVersion(qa) {
    if (!qa || typeof qa !== "object") return 0;
    if (qa.rubric && typeof qa.rubric === "object") return 1;
    if (qa.contract === "materials.qa.v3" || (Array.isArray(qa.reasons) && Array.isArray(qa.checks))) return 3;
    if (qa.contract === "materials.qa.v2" || (qa.quality && typeof qa.quality === "object") || Array.isArray(qa.gates)) return 2;
    return 0;
  }

  /* A version saved from a stored model gets a placeholder rubric (one
     version_recheck row): nothing was graded, so it is "Not rescored". */
  function isUnscoredStub(qa) {
    var rows = qa && qa.rubric && Array.isArray(qa.rubric.rows) ? qa.rubric.rows : [];
    return rows.length > 0 && rows.every(function (r) { return r && r.id === "version_recheck"; });
  }

  function checkLabel(id) {
    var mi = insights();
    return mi ? mi.rubricLabel(id) : cap(String(id || "").replace(/_/g, " "));
  }

  function claimsText(n, one, many) {
    return n + " claim" + (n === 1 ? " " + one : "s " + many);
  }

  /* An old record (v1 rubric, v2 judge) read as the v3 shape: its stored
     verdict, with reasons from its failed gates and flagged sentences. Its
     stored prose ("Quality score 64 is below 80.", "6/16") is never read. */
  function adaptLegacy(qa, version, qualityDoc) {
    var checks = [];
    if (version === 2) {
      list(qa.gates).forEach(function (g) {
        if (g.kind !== "hard" || g.pass !== false) return;
        checks.push({ id: String(g.id || ""), kind: "gate", status: "fail", label: checkLabel(g.id), detail: String(g.reason || ""), sentenceIds: list(g.sentenceIds) });
      });
      list(qa.sentences).forEach(function (s) {
        if (s.status !== "unsupported" && s.status !== "uncertain") return;
        var bad = s.status === "unsupported";
        checks.push({ id: "sentence:" + s.id, kind: "sentence", status: bad ? "fail" : "review", label: bad ? "Claim needs a source" : "Claim to confirm", detail: String(s.reason || ""), sentenceIds: [s.id] });
      });
    } else {
      var flags = list(qa.checks).length ? qa.checks : list(qualityDoc && qualityDoc.issues);
      flags.forEach(function (c) {
        if (c.severity !== "fail" && c.severity !== "review") return;
        checks.push({ id: String(c.code || ""), kind: "gate", status: c.severity === "fail" ? "fail" : "review", label: checkLabel(c.code), detail: String(c.message || ""), sentenceIds: [] });
      });
    }
    var reasons = checks.filter(function (c) { return c.kind === "gate"; }).map(function (c) { return { checkId: c.id, text: c.detail || c.label }; });
    var unsupported = checks.filter(function (c) { return c.kind === "sentence" && c.status === "fail"; });
    var uncertain = checks.filter(function (c) { return c.kind === "sentence" && c.status === "review"; });
    if (unsupported.length) reasons.push({ checkId: unsupported[0].id, text: claimsText(unsupported.length, "needs a source", "need a source") });
    if (uncertain.length) reasons.push({ checkId: uncertain[0].id, text: claimsText(uncertain.length, "to confirm", "to confirm") });
    return {
      runId: qa.runId || "", passId: null, state: "graded", disposition: qa.disposition, reasons: reasons, checks: checks,
      sentences: version === 2 ? list(qa.sentences) : [], issues: version === 2 ? list(qa.issues) : [], ratings: [], coverage: null,
      reviews: [], qualificationGaps: version === 2 ? list(qa.qualificationGaps) : [], degraded: list(qa.degraded), repair: qa.repair || null, legacy: "old_checker",
    };
  }

  function coverageView(c, stale) {
    if (!c || typeof c !== "object" || !finite(c.total) || c.total <= 0) return null;
    var reqs = list(c.requirements);
    var named = function (status) {
      return reqs.filter(function (r) { return r.status === status; }).map(function (r) { return String(r.text || r.id || ""); }).filter(Boolean);
    };
    var covered = finite(c.covered) ? c.covered : reqs.filter(function (r) { return r.status === "covered"; }).length;
    return { covered: covered, total: c.total, missing: named("missing"), partial: named("partial"), requirements: reqs, stale: !!stale };
  }

  /** "Covers 7 of 9 requirements; missing: X, Y" (D6). */
  function coverageLine(cov) {
    if (!cov) return "";
    return "Covers " + cov.covered + " of " + cov.total + " requirement" + (cov.total === 1 ? "" : "s")
      + (cov.missing.length ? "; missing: " + cov.missing.join(", ") : "");
  }

  /* G3 (FIX1-F7): a carried-over record's coverage was measured on another
     run — the one it was carried from — so it reads "From an earlier
     version" whatever the host says. */
  function carriedFromOtherRun(rec) {
    var from = rec && rec.state === "carried_over" && rec.carriedFrom ? String(rec.carriedFrom.runId || "") : "";
    return !!from && from !== String(rec.runId || "");
  }

  function noPeriod(s) {
    return String(s || "").trim().replace(/[.!?]+$/, "");
  }

  /**
   * qualityDoc: the manifest's quality.documents[type] (or undefined).
   * opts: { stale } — the host knows when the text moved on.
   * Returns { disposition, state, word, reason, reasonFull, tone, runId,
   * stale, held, legacy, reviews, coverage, checks, sentences, ratings, … }.
   */
  function verdictView(qualityDoc, opts) {
    var o = opts || {};
    var qa = qaOf(qualityDoc);
    var version = qaVersion(qa);
    var rec = version === 3 ? qa : (version === 1 && isUnscoredStub(qa)
      ? { runId: qa.runId || "", state: "not_rescored", disposition: null, reasons: [], checks: [], legacy: "old_checker" }
      : (version ? adaptLegacy(qa, version, qualityDoc) : null));
    var state = rec ? String(rec.state || "graded") : "none";
    var disposition = rec && state !== "not_rescored" && WORDS[String(rec.disposition || "").toUpperCase()]
      ? String(rec.disposition).toUpperCase() : null;
    var checks = rec ? list(rec.checks) : [];
    var first = rec && state !== "not_rescored" ? list(rec.reasons)[0] : null;
    var check = first ? checks.filter(function (c) { return c.id === first.checkId; })[0] : null;
    /* A failed gate leads with its name ("Tool support"); every other reason
       is already a sentence ("1 claim needs a source"). */
    var gate = !!(check && check.kind === "gate" && check.label);
    var reason = first ? noPeriod(gate ? check.label : first.text) : "";
    var detail = first ? noPeriod(first.text) : "";
    var reasonFull = gate && detail && detail !== reason ? reason + ": " + detail : reason;
    return {
      disposition: disposition,
      state: state,
      word: state === "not_rescored" ? "Not rescored" : (WORDS[disposition] || "Not graded"),
      reason: reason,
      reasonFull: reasonFull,
      tone: TONES[disposition] || "none",
      runId: rec ? String(rec.runId || "") : "",
      passId: rec && rec.passId ? String(rec.passId) : "",
      stale: !!o.stale,
      held: disposition === "FAIL" ? { reason: reason || WORDS.FAIL } : null,
      legacy: rec && rec.legacy ? String(rec.legacy) : "",
      reviews: rec ? list(rec.reviews) : [],
      coverage: coverageView(rec && rec.coverage, o.stale || carriedFromOtherRun(rec)),
      checks: checks,
      sentences: rec ? list(rec.sentences) : [],
      issues: rec ? list(rec.issues) : [],
      ratings: rec ? list(rec.ratings) : [],
      qualificationGaps: rec ? list(rec.qualificationGaps) : [],
      degraded: rec ? list(rec.degraded) : [],
      carriedFrom: rec && rec.carriedFrom ? rec.carriedFrom : null,
      rescore: rec && rec.rescore ? rec.rescore : null,
    };
  }

  /* -------------------- the button -------------------- */

  function accessibleName(view, opts) {
    var o = opts || {};
    var v = view || verdictView();
    return (DOC_LABEL[o.feature] || "Quality check") + ": " + v.word
      + (v.reasonFull ? " — " + noPeriod(v.reasonFull) : "") + "."
      + (o.stale ? " Out of date." : "")
      + " Open the quality check.";
  }

  /**
   * opts: { feature, scope, stale }. The face is "<word> · <first reason>",
   * "Ready" alone when there is no reason; the full sentence is the name.
   */
  function buttonHtml(view, opts) {
    var o = opts || {};
    var v = view || verdictView();
    return '<button type="button" class="jb-grade" data-tone="' + esc(v.tone) + '" data-verdict="' + esc(v.disposition || v.state) + '" data-score-open'
      + (o.feature ? ' data-feature="' + esc(o.feature) + '"' : "")
      + (o.scope ? ' data-scope="' + esc(o.scope) + '"' : "")
      + (o.stale ? ' data-stale="true"' : "")
      + ' aria-haspopup="dialog" aria-label="' + esc(accessibleName(v, o)) + '">'
      + '<span class="jb-grade__word" aria-hidden="true">' + esc(v.word) + "</span>"
      + (v.reason ? '<span class="jb-grade__reason" aria-hidden="true"> · ' + esc(v.reason) + "</span>" : "")
      + (o.stale ? '<span class="jb-grade__stale" aria-hidden="true"></span>' : "")
      + "</button>";
  }

  /* -------------------- the modal: what it says -------------------- */

  var VERDICT_LINES = {
    READY: "Ready to send.",
    REVIEW: "Worth a look before you send it.",
    FAIL: "It failed a check. Fix it before you send it.",
  };
  /* Why: the checks that decided the verdict, deciding kinds first. */
  var WHY_GROUPS = [
    { kind: "gate", title: "Hard checks" },
    { kind: "sentence", title: "Claims" },
    { kind: "review", title: "Reviews" },
    { kind: "constraint", title: "Constraints" },
    { kind: "dimension", title: "Writing" },
    { kind: "rescore", title: "Rescore" },
    { kind: "audit", title: "Other checks" },
    { kind: "note", title: "Fallbacks" },
    { kind: "background", title: "Background gaps" },
  ];
  var BACKGROUND_HINT = "What the posting asks for that your background doesn’t show. This is information for you, not a problem with the writing.";
  var REQ_WORDS = { covered: "covered", partial: "partly covered", missing: "missing" };
  var REQ_TONES = { covered: "ok", partial: "warn", missing: "miss" };
  var INSTRUCTION_MAX = 600;
  var STEPS = [
    { id: "why", title: "Why" },
    { id: "coverage", title: "Coverage" },
    { id: "writing", title: "Writing" },
    { id: "reviews", title: "Reviews" },
    { id: "versions", title: "Versions" },
    /* The ATS check's line edits and the posting's role terms, below
       GRADE's sections and only when there are some: no score in either. */
    { id: "rewrites", title: "Rewrite suggestions", extra: true },
    { id: "keywords", title: "Keyword coverage", extra: true },
  ];

  function clip(s) {
    var t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > INSTRUCTION_MAX ? t.slice(0, INSTRUCTION_MAX - 1) + "…" : t;
  }

  function fixText(reason, quote) {
    return clip("Fix this: " + String(reason || "").trim() + (quote ? " (“" + quote + "”)" : ""));
  }

  function sentenceTexts(view, ids) {
    var by = {};
    view.sentences.forEach(function (s) { if (s.id) by[s.id] = String(s.text || ""); });
    return list(ids).map(function (id) { return by[id] || ""; }).filter(Boolean);
  }

  /* The issue Repair can tick for a check: a gate's own issue, or the issue
     that names the check's sentence. */
  function issueFor(view, c) {
    var ids = list(c.sentenceIds);
    var hit = view.issues.filter(function (i) {
      if (c.kind === "gate") return i.origin === "gate" && (i.gateId === c.id || String(i.reason || "") === String(c.detail || ""));
      return ids.length && list(i.sentenceIds).indexOf(ids[0]) >= 0;
    })[0];
    return hit ? String(hit.id || hit.code || "") : "";
  }

  function whyItems(view, qualityDoc) {
    var items = [];
    var seen = {};
    view.checks.forEach(function (c) {
      seen[c.id] = 1;
      if (c.status !== "fail" && c.status !== "review") return;
      var quotes = sentenceTexts(view, c.sentenceIds);
      var said = String(c.detail || c.label || "");
      var fixable = c.kind !== "review" && c.kind !== "rescore";
      items.push({
        group: c.kind || "gate", status: c.status, label: String(c.label || ""), why: c.detail && c.detail !== c.label ? String(c.detail) : "",
        quotes: quotes, issueId: fixable ? issueFor(view, c) : "", instruction: fixable ? fixText(said, quotes[0]) : "", noFix: !fixable,
      });
    });
    view.issues.forEach(function (i) { seen[i.id] = 1; seen[i.code] = 1; });
    /* The deterministic audit's flags, every one of them (U16). */
    list(qualityDoc && qualityDoc.issues).forEach(function (f) {
      var said = String(f.message || f.code || "").trim();
      if (!said || seen[f.code] || (f.severity !== "fail" && f.severity !== "review")) return;
      items.push({ group: "audit", status: f.severity === "fail" ? "fail" : "review", label: said, why: "", quotes: [], issueId: "", instruction: fixText(said) });
    });
    /* A step that fell back to rules says so; there is nothing to fix. */
    var mi = insights();
    view.degraded.forEach(function (x) {
      var said = mi ? mi.plainDegraded(x) : String(x || "");
      if (said) items.push({ group: "note", status: "info", label: said, why: "", quotes: [], issueId: "", instruction: "", noFix: true });
    });
    view.qualificationGaps.forEach(function (g) {
      var gap = String(g).trim();
      if (!gap) return;
      items.push({ group: "background", status: "info", label: gap, why: BACKGROUND_HINT, quotes: [], issueId: "", instruction: clip("Address this gap honestly, using only what my background supports: " + gap) });
    });
    var order = WHY_GROUPS.map(function (g) { return g.kind; });
    return items.map(function (it, i) { it.order = i; return it; }).sort(function (a, b) {
      return order.indexOf(a.group) - order.indexOf(b.group) || a.order - b.order;
    });
  }

  function writingRows(view) {
    var mi = insights();
    var dims = mi ? mi.JUDGE_DIMENSIONS : [];
    return view.ratings.map(function (r) {
      var named = dims.filter(function (d) { return d.id === r.dimension; })[0];
      return {
        label: named ? named.label : cap(String(r.dimension || "").replace(/_/g, " ")),
        value: Math.max(0, Math.min(4, Number(r.score) || 0)), max: 4, why: String(r.reason || ""),
      };
    });
  }

  var ROLE_WORDS = { first: "First review", second: "Second review" };

  function reviewModel(r) {
    return String(r.model || r.provider || "a model");
  }

  /* G4: who reviewed it and what each said; a review that didn't run says
     why, with Try again and Change grading model. */
  function reviewRows(view) {
    var mi = insights();
    var rows = [];
    var ok = view.reviews.filter(function (r) { return r.status === "ok" && WORDS[r.disposition]; });
    if (ok.length > 1 && ok.some(function (r) { return r.disposition !== ok[0].disposition; })) {
      rows.push({ kind: "disagree", text: "Reviewers disagree", acts: [] });
    }
    view.reviews.forEach(function (r) {
      var who = ROLE_WORDS[r.role] || "Review";
      if (r.status === "ok") {
        rows.push({ kind: "ok", tone: TONES[r.disposition] || "none", text: who + ": " + reviewModel(r) + " — " + (WORDS[r.disposition] || "no verdict"), acts: [] });
      } else if (r.status === "skipped") {
        rows.push({ kind: "skipped", text: who + " skipped — " + (r.reason ? noPeriod(r.reason) : "it uses the same model as the first review"), acts: [] });
      } else {
        var why = mi && typeof mi.gradeFailureReason === "function" ? mi.gradeFailureReason(r) : "it didn’t answer.";
        rows.push({
          kind: "unavailable", text: who + " didn’t run — " + why,
          acts: r.role === "second" ? ["retry", "grading"] : ["retry"],
        });
      }
    });
    if (!view.legacy && view.reviews.length === 1 && view.reviews[0].role === "first" && view.reviews[0].status === "ok") {
      rows.push({ kind: "note", text: "A grading model in Settings adds a second review.", acts: ["second"] });
    }
    return rows;
  }

  function provenanceOf(view) {
    if (view.legacy) return "Graded by the old checker";
    return view.reviews.filter(function (r) { return r.status === "ok"; }).map(function (r) {
      return (ROLE_WORDS[r.role] || "Review") + ": " + reviewModel(r);
    }).join(" · ");
  }

  function notesOf(view) {
    var mi = insights();
    var notes = [];
    if (view.state === "carried_over") {
      var when = view.carriedFrom && mi ? mi.shortDate(view.carriedFrom.date) : "";
      notes.push("Same text as " + (when || "an earlier version") + " — verdict carried over");
    }
    if (view.rescore && view.rescore.reducedEvidence) notes.push("Rescored with less context than the original draft");
    return notes;
  }

  function rewritesOf(ats) {
    return list(ats && ats.rewriteSuggestions).filter(function (s) { return s.after; }).map(function (s) {
      var section = String(s.targetSection || "").trim();
      var before = String(s.before || "").trim();
      var after = String(s.after || "").trim();
      return {
        section: section, before: before, after: after, why: String(s.rationale || ""),
        instruction: clip((section ? "In " + section + ", " : "") + (before
          ? "replace “" + before + "” with “" + after + "”."
          : "use: “" + after + "”.")),
      };
    });
  }

  /* A stored scorecard entry is { result, feature, storedAt }; the bus
     hands over the result itself. Only its line edits are read. */
  function atsResultOf(ats) {
    if (!ats || typeof ats !== "object") return null;
    return ats.result && typeof ats.result === "object" ? ats.result : ats;
  }

  /**
   * data: { feature, role, qualityDoc, ats, stale, keywords, base, busy,
   * can: { fix, apply, repair, rescore, promote, retry, profile } }.
   * Everything the modal shows, as plain values.
   */
  function modelOf(data) {
    var d = data || {};
    var mi = insights();
    var feature = d.feature === "cover_letter" ? "cover_letter" : (d.feature === "resume" ? "resume" : "");
    var view = verdictView(d.qualityDoc, { stale: d.stale });
    var kw = d.keywords && typeof d.keywords === "object" && finite(d.keywords.total) && d.keywords.total > 0 ? d.keywords : null;
    /* "Review your details" and "Add a voice guide": the fixes the verdict
       points at outside the draft itself. */
    var profile = mi && d.qualityDoc ? mi.fixActions(d.qualityDoc, feature).filter(function (a) {
      return a.action === "materials-open-profile";
    }).map(function (a) { return { focus: a.focus, label: a.label }; }) : [];
    var line = view.reasonFull || (view.state === "not_rescored" ? "Not rescored — Rescore"
      : (VERDICT_LINES[view.disposition] || "Nothing has checked this draft yet. Rescore checks it against the role."));
    return {
      feature: feature,
      role: String(d.role || ""),
      view: view,
      verdictLine: line,
      provenance: provenanceOf(view),
      notes: notesOf(view),
      stale: !!d.stale,
      base: String(d.base || ""),
      profile: profile,
      why: whyItems(view, d.qualityDoc),
      writing: writingRows(view),
      reviews: reviewRows(view),
      rewrites: rewritesOf(atsResultOf(d.ats)),
      keywords: kw ? { matched: list(kw.matched).map(String), missing: list(kw.missing).map(String), total: kw.total } : null,
      busy: !!d.busy,
      can: d.can && typeof d.can === "object" ? d.can : {},
    };
  }

  function stepCount(model, id) {
    if (id === "why") return model.why.length;
    if (id === "writing") return model.writing.length;
    if (id === "reviews") return model.view.reviews.length;
    if (id === "rewrites") return model.rewrites.length;
    if (id === "keywords") return model.keywords ? model.keywords.total : 0;
    return 0;
  }

  function stepsOf(model) {
    return STEPS.filter(function (s) { return !s.extra || stepCount(model, s.id); });
  }

  /* The first step with something in it starts open; Versions waits to be asked. */
  function defaultOpen(model) {
    var open = {};
    if (model.why.length) open.why = true;
    else if (model.view.coverage) open.coverage = true;
    else if (model.writing.length) open.writing = true;
    else if (model.reviews.length) open.reviews = true;
    return open;
  }

  /* -------------------- the modal: markup -------------------- */

  function btn(cls, attrs, label) {
    return '<button type="button" class="jb-score__btn' + (cls ? " " + cls : "") + '"' + attrs + ">" + label + "</button>";
  }

  function emptyHtml(words) {
    return '<p class="jb-score__empty">' + esc(words) + "</p>";
  }

  function chipHtml(tone, word) {
    return '<span class="jb-chip" data-tone="' + esc(tone) + '">' + esc(word) + "</span>";
  }

  function meterHtml(value, max) {
    var pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return '<span class="jb-score__meter" aria-hidden="true"><i style="--jb-score-fill: ' + pct + '%"></i></span>';
  }

  function whyItemHtml(it, i, can) {
    var fix = can.fix && !it.noFix && it.instruction
      ? btn("jb-score__btn--small", ' data-score-fix="' + i + '"', "Fix this")
      : "";
    return '<li class="jb-score__item" data-group="' + esc(it.group) + '" data-status="' + esc(it.status) + '">'
      + '<p class="jb-score__label">' + esc(it.label) + "</p>"
      + it.quotes.map(function (q) { return '<q class="jb-score__quote">' + esc(q) + "</q>"; }).join("")
      + (it.why ? '<p class="jb-score__why">' + esc(it.why) + "</p>" : "")
      + fix
      + "</li>";
  }

  function whyHtml(model) {
    var can = model.can;
    var noun = DOC_NOUN[model.feature] || "draft";
    var fixes = can.profile && model.profile.length
      ? '<p class="jb-score__acts">' + model.profile.map(function (a) {
        return btn("jb-score__btn--small", ' data-score-profile="' + esc(a.focus) + '"', esc(a.label));
      }).join("") + "</p>"
      : "";
    if (!model.why.length) {
      return emptyHtml(model.view.state === "not_rescored" || model.view.state === "none"
        ? "Nothing has checked this " + noun + " yet." : "Nothing is holding this " + noun + " back.") + fixes;
    }
    var html = "";
    WHY_GROUPS.forEach(function (g) {
      var idx = [];
      model.why.forEach(function (it, i) { if (it.group === g.kind) idx.push(i); });
      if (!idx.length) return;
      html += '<p class="jb-score__group">' + esc(g.title) + "</p>"
        + '<ul class="jb-score__items">' + idx.map(function (i) { return whyItemHtml(model.why[i], i, can); }).join("") + "</ul>";
    });
    return html + fixes;
  }

  function coverageHtml(model) {
    var cov = model.view.coverage;
    var noun = DOC_NOUN[model.feature] || "draft";
    if (!cov) {
      return emptyHtml((model.view.legacy ? "The old checker didn’t record which requirements this " + noun + " covers."
        : "Which requirements this " + noun + " covers wasn’t recorded.") + (model.can.rescore ? " Rescore records it." : ""));
    }
    return '<p class="jb-score__lede"><b>' + esc(coverageLine(cov)) + "</b></p>"
      + (cov.stale ? '<p class="jb-score__sub jb-score__stale-note">From an earlier version</p>' : "")
      + (cov.requirements.length ? '<ul class="jb-score__reqs">' + cov.requirements.map(function (r) {
        var st = REQ_WORDS[r.status] ? r.status : "missing";
        return '<li class="jb-score__req">' + chipHtml(REQ_TONES[st], REQ_WORDS[st]) + ' <span>' + esc(r.text || r.id) + "</span></li>";
      }).join("") + "</ul>" : "");
  }

  /* G4 (FIX1-F5): the ratings are the first successful review's — the
     second's when the first didn't run (server/materials-qa.mjs). */
  function ratedBy(view) {
    var ok = view.reviews.filter(function (r) { return r.status === "ok"; });
    var r = ok.filter(function (x) { return x.role === "first"; })[0] || ok[0];
    if (!r) return "";
    return (r.role === "second" ? "the second review" : "the first review") + " (" + reviewModel(r) + ")";
  }

  function writingHtml(model) {
    if (!model.writing.length) return emptyHtml("No writing ratings for this version.");
    var by = ratedBy(model.view);
    return '<p class="jb-score__sub">Advisory: each rating is 0–4' + esc(by ? " from " + by : "") + ", and one under 3 sends the draft to review.</p>"
      + '<ul class="jb-score__dimlist">' + model.writing.map(function (r) {
        return '<li class="jb-score__dim"><span class="jb-score__dim-label">' + esc(r.label) + "</span>"
          + meterHtml(r.value, r.max)
          + '<span class="jb-score__dim-n">' + esc(r.value + " / " + r.max) + "</span>"
          + (r.why ? '<span class="jb-score__dim-why">' + esc(r.why) + "</span>" : "")
          + "</li>";
      }).join("") + "</ul>";
  }

  /* Change grading model and Add a second review are settings-modal.js's
     own document-level action: the modal closes and lets the click through. */
  function reviewActHtml(act, can) {
    if (act === "retry" && can.rescore) return '<button type="button" class="jb-score__link" data-score-rescore>Try again</button>';
    if (act === "retry" && can.retry) return '<button type="button" class="jb-score__link" data-score-retry>Try again</button>';
    if (act === "grading") return '<button type="button" class="jb-score__link" data-action="settings-open-grading" data-score-handoff>Change grading model</button>';
    if (act === "second") return '<button type="button" class="jb-score__link" data-action="settings-open-grading" data-score-handoff>Add a second review</button>';
    return "";
  }

  function reviewsHtml(model) {
    if (model.view.legacy) return emptyHtml("Graded by the old checker. Rescore runs today’s reviews.");
    if (!model.reviews.length) return emptyHtml("No review ran for this version.");
    return '<ul class="jb-score__reviews">' + model.reviews.map(function (r) {
      var acts = r.acts.map(function (a) { return reviewActHtml(a, model.can); }).filter(Boolean).join(" ");
      return '<li class="jb-score__review" data-review="' + esc(r.kind) + '">' + esc(r.text)
        + (acts ? ' <span class="jb-score__judge-acts">' + acts + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
  }

  function versionsPanel(model, ui) {
    var h = ui.history;
    var noun = DOC_NOUN[model.feature] || "draft";
    if (h === "loading") return emptyHtml("Loading versions…");
    if (h && h.error) return emptyHtml("Couldn’t load versions: " + h.error);
    if (!Array.isArray(h)) return emptyHtml("Open to see every version of this " + noun + ".");
    return versionsHtml(h, model.feature, { base: model.base, promote: model.can.promote, rescore: model.can.rescore, confirm: ui.confirm });
  }

  function panelBody(model, id, ui) {
    if (id === "why") return whyHtml(model);
    if (id === "coverage") return coverageHtml(model);
    if (id === "writing") return writingHtml(model);
    if (id === "reviews") return reviewsHtml(model);
    if (id === "versions") return versionsPanel(model, ui);
    var noun = DOC_NOUN[model.feature] || "draft";
    if (id === "rewrites") {
      return '<ul class="jb-score__items">' + model.rewrites.map(function (s, i) {
        return '<li class="jb-score__item jb-score__item--rewrite">'
          + (s.section ? '<p class="jb-score__tag">' + esc(s.section) + "</p>" : "")
          + (s.before ? '<p class="jb-score__before"><span class="jb-score__vh">Before: </span>' + esc(s.before) + "</p>" : "")
          + '<p class="jb-score__after"><span class="jb-score__vh">After: </span>' + esc(s.after) + "</p>"
          + (s.why ? '<p class="jb-score__sub">' + esc(s.why) + "</p>" : "")
          + (model.can.apply ? btn("jb-score__btn--small", ' data-score-apply="' + i + '"', "Apply") : "")
          + "</li>";
      }).join("") + "</ul>";
    }
    /* keywords */
    var c = model.keywords;
    return '<p class="jb-score__lede"><b>' + esc(c.matched.length + " of " + c.total) + "</b> role terms appear in this " + esc(noun) + ".</p>"
      + (c.missing.length
        ? '<p class="jb-score__group">Missing</p><p class="jb-score__chips">' + c.missing.map(function (t) { return '<span class="jb-score__chip">' + esc(t) + "</span>"; }).join("") + "</p>"
        : '<p class="jb-score__sub">It covers every term the posting names.</p>');
  }

  function stepsHtml(model, ui, n) {
    var open = ui.open || defaultOpen(model);
    return '<ol class="jb-score__steps">' + stepsOf(model).map(function (s, i) {
      var id = "jb-score-" + s.id + "-" + n;
      var isOpen = !!open[s.id];
      var count = s.id === "why" || s.id === "writing" || s.id === "reviews" || s.extra ? String(stepCount(model, s.id)) : "";
      return '<li class="jb-score__step" data-step="' + s.id + '" style="--jb-step: ' + i + '">'
        + '<h3 class="jb-score__step-h"><button type="button" class="jb-score__step-btn" id="' + id + '-h" data-score-step="' + s.id + '"'
        + ' aria-expanded="' + (isOpen ? "true" : "false") + '" aria-controls="' + id + '">'
        + '<span class="jb-score__dot" aria-hidden="true"></span>'
        + '<span class="jb-score__step-title">' + esc(s.title) + "</span>"
        + (count ? '<span class="jb-score__count">' + esc(count) + "</span>" : "")
        + "</button></h3>"
        + '<div class="jb-score__panel" id="' + id + '" role="region" aria-labelledby="' + id + '-h"'
        + (isOpen ? (ui.reveal === s.id ? " data-reveal" : "") : " hidden") + ">"
        + panelBody(model, s.id, ui)
        + "</div></li>";
    }).join("") + "</ol>";
  }

  function headHtml(model, n) {
    var v = model.view;
    return '<header class="jb-score__head">'
      + '<div class="jb-score__headline">'
      + (model.role ? '<p class="jb-score__eyebrow">' + esc(model.role) + "</p>" : "")
      + '<h2 class="jb-score__title" id="jb-score-title-' + n + '"><span class="jb-score__doc">' + esc(DOC_LABEL[model.feature] || "Draft") + "</span> "
      + '<span class="jb-score__word" data-tone="' + esc(v.tone) + '">' + esc(v.word) + "</span></h2>"
      + '<p class="jb-score__verdict" id="jb-score-verdict-' + n + '">' + esc(model.verdictLine) + "</p>"
      + (model.provenance ? '<p class="jb-score__prov">' + esc(model.provenance) + "</p>" : "")
      + model.notes.map(function (t) { return '<p class="jb-score__judge">' + esc(t) + "</p>"; }).join("")
      + (model.stale ? '<p class="jb-score__badges"><span class="jb-score__badge jb-score__badge--stale">Changed since graded</span></p>' : "")
      + "</div></header>";
  }

  function footHtml(model, ui) {
    var can = model.can;
    var busy = !!(ui.busy || model.busy);
    var urgent = model.view.disposition === "FAIL" || model.view.disposition === "REVIEW";
    return '<footer class="jb-score__foot">'
      + (ui.error ? '<p class="jb-score__error" role="alert">' + esc(ui.error) + "</p>" : "")
      + (can.repair ? btn(urgent ? "jb-score__btn--primary" : "", " data-score-repair", "Repair") : "")
      + (can.rescore
        ? btn("", ' data-score-rescore aria-busy="' + (busy ? "true" : "false") + '" aria-disabled="' + (busy ? "true" : "false") + '"',
          busy ? '<span class="jb-score__spin" aria-hidden="true"></span>Rescoring…' : "Rescore")
        : "")
      + btn("jb-score__btn--ghost", " data-score-close", "Close")
      + "</footer>";
  }

  function innerHtml(model, ui) {
    var n = ui.n || 0;
    return '<div class="jb-score__scrim" data-score-close aria-hidden="true"></div>'
      + '<div class="jb-score__card">'
      + headHtml(model, n)
      + '<div class="jb-score__body">' + stepsHtml(model, ui, n) + "</div>"
      + footHtml(model, ui)
      + "</div>";
  }

  var idSeq = 0;

  /**
   * The whole modal as one escaped string. ui: { n, open, busy, error,
   * history, confirm } — the controller's state; omitted, a fresh modal.
   */
  function modalHtml(model, uiState) {
    var ui = uiState || {};
    if (!ui.n) ui = Object.assign({}, ui, { n: ++idSeq });
    return '<div class="jb-score" role="dialog" aria-modal="true" aria-labelledby="jb-score-title-' + ui.n + '"'
      + ' aria-describedby="jb-score-verdict-' + ui.n + '" data-feature="' + esc(model.feature) + '" data-tone="' + esc(model.view.tone) + '">'
      + innerHtml(model, ui)
      + "</div>";
  }

  /* -------------------- G6/G7 · the version rows -------------------- */

  var SOURCE_WORDS = { regenerate: "regenerated", repair: "repaired", manual: "edited", restore: "restored", edit: "edited" };

  function withQuery(href, q) {
    return href + (href.indexOf("?") >= 0 ? "&" : "?") + q;
  }

  /* RunSummary.verdicts[doc] = { disposition, state, reason, failedChecks, legacy }. */
  function runVerdict(v) {
    var x = v && typeof v === "object" ? v : {};
    var d = String(x.disposition || "").toUpperCase();
    var state = String(x.state || (WORDS[d] ? "graded" : "none"));
    if (state === "not_rescored") return { state: state, word: "Not rescored", tone: "miss", reason: "", legacy: "" };
    return { state: state, word: WORDS[d] || "Not graded", tone: TONES[d] || "none", reason: noPeriod(x.reason), legacy: x.legacy ? String(x.legacy) : "" };
  }

  /* The verdict a manual repair started from, for this row's document.
     FIX1-F1: a repair is known by its repair record, not by the run's
     source (the template's). FIX2-N3: only a manual repair names a parent
     run — the pipeline also writes `before` on an automatic two-pass run,
     with parentRunId null — and a per-document record (or a repair of one
     named document) gives each document its own before. */
  function repairBefore(r, feature) {
    var rep = r && r.kind !== "pass" && r.repair && typeof r.repair === "object" ? r.repair : null;
    if (!rep || !rep.parentRunId || !rep.before || typeof rep.before !== "object") return "";
    if (rep.feature && rep.feature !== feature) return "";
    var b = rep.before[feature] && typeof rep.before[feature] === "object" ? rep.before[feature] : rep.before;
    return WORDS[String(b.disposition || "").toUpperCase()] || "";
  }

  var CHECK_WORDS = { fail: "Fails", review: "Needs review" };

  /* FIX1-F3: a version's own failed and review checks
     (RunSummary.verdicts[doc].checks), readable without promoting it.
     FIX2-N8: identical labels with the same status are one line, counted. */
  function checksHtml(v) {
    var groups = [];
    var at = {};
    list(v && v.checks).forEach(function (c) {
      if (!CHECK_WORDS[c.status]) return;
      var label = String(c.label || c.id || "");
      var key = c.status + "|" + label;
      if (at[key] == null) { at[key] = groups.length; groups.push({ label: label, status: c.status, n: 0 }); }
      groups[at[key]].n += 1;
    });
    if (!groups.length) return "";
    return '<details class="jb-ver__checks"><summary>Checks for this version</summary><ul>'
      + groups.map(function (g) {
        return "<li>" + esc(g.label + (g.n > 1 ? " ×" + g.n : "")) + " — " + esc(CHECK_WORDS[g.status]) + "</li>";
      }).join("") + "</ul></details>";
  }

  function runRowHtml(r, feature, o) {
    var mi = insights();
    var v = runVerdict(r.verdicts && r.verdicts[feature]);
    var isDefault = typeof r.isDefault === "boolean" ? r.isDefault : (Array.isArray(r.active) && r.active.indexOf(feature) >= 0);
    var held = r.held && r.held.reason ? noPeriod(r.held.reason) : "";
    var files = r.files && r.files[feature] ? r.files[feature] : {};
    var base = String(o.base || "");
    var preview = files.html || files.pdf || "";
    var download = files.pdf || files.html || files.txt || "";
    var filename = String(download).split("?")[0].split("/").pop();
    var dlHref = download ? withQuery(base + download, "download=1") : "";
    var what = cap(r.template || "") + (SOURCE_WORDS[r.source] ? " · " + SOURCE_WORDS[r.source] : "");
    var before = repairBefore(r, feature);
    var acts = [];
    if (preview) {
      acts.push('<a class="jb-ver__btn" href="' + esc(base + preview) + '" target="_blank" rel="noopener" data-action="materials-preview"'
        + ' data-filename="' + esc(String(preview).split("?")[0].split("/").pop()) + '">Preview</a>');
    }
    if (download) {
      acts.push('<a class="jb-ver__btn" href="' + esc(dlHref) + '" download data-action="materials-download" data-filename="' + esc(filename) + '"'
        + (held ? ' data-gate="held" data-held="' + esc(held) + '"' : "") + ">Download</a>");
    }
    /* FIX1-F2: the server refuses to promote a pass (409 pass_not_promotable). */
    if (!isDefault && o.promote && r.kind !== "pass") {
      acts.push('<button type="button" class="jb-ver__btn" data-action="materials-promote" data-score-promote="' + esc(r.runId) + '"'
        + ' data-run="' + esc(r.runId) + '" data-feature="' + esc(feature) + '">Use this version</button>');
    }
    var verdict = v.state === "not_rescored"
      ? chipHtml(v.tone, v.word) + " — " + (o.rescore
        ? '<button type="button" class="jb-score__link" data-action="materials-rescore" data-score-rescore-run="' + esc(r.runId) + '" data-run="' + esc(r.runId) + '" data-feature="' + esc(feature) + '">Rescore</button>'
        : "Rescore")
      : chipHtml(v.tone, v.word) + (v.reason ? ' <span class="jb-ver__reason">' + esc(v.reason) + "</span>" : "");
    var confirm = o.confirm && o.confirm.runId === r.runId && mi
      ? mi.failConfirmHtml(feature, { kind: "link", href: o.confirm.href, filename: o.confirm.filename }, { repair: false, held: o.confirm.reason })
      : "";
    return '<li class="jb-ver__run" data-run="' + esc(r.runId) + '"' + (isDefault ? " data-default" : "") + (held ? " data-held" : "") + ">"
      + '<p class="jb-ver__head">'
      + (r.label ? '<span class="jb-ver__label">' + esc(r.label) + "</span>" : "")
      + '<span class="jb-ver__when">' + esc((mi && mi.shortDate(r.date)) || r.runId) + "</span>"
      + (what ? '<span class="jb-ver__what">' + esc(what) + "</span>" : "")
      + (isDefault ? '<span class="jb-ver__default">Default</span>' : "")
      + "</p>"
      + '<p class="jb-ver__verdict">' + verdict + "</p>"
      + (held ? '<p class="jb-ver__note jb-ver__note--held">Held — ' + esc(held) + "</p>" : "")
      + (before ? '<p class="jb-ver__note">' + esc(before + " → " + v.word) + "</p>" : "")
      + (v.state === "carried_over" ? '<p class="jb-ver__note">Same text as an earlier version — verdict carried over</p>' : "")
      + (v.legacy ? '<p class="jb-ver__note">Graded by the old checker</p>' : "")
      + checksHtml(r.verdicts && r.verdicts[feature])
      + (acts.length ? '<p class="jb-ver__acts">' + acts.join("") + "</p>" : "")
      + confirm
      + "</li>";
  }

  /**
   * One document's versions from GET /runs (RunSummary[]): the modal's
   * Versions step and the row's inline list render these same rows.
   * opts: { base, promote, rescore, confirm: { runId, href, filename, reason } }.
   */
  function versionsHtml(runs, feature, opts) {
    var o = opts || {};
    var rows = list(runs).filter(function (r) {
      return (Array.isArray(r.documents) && r.documents.indexOf(feature) >= 0) || (r.verdicts && r.verdicts[feature]);
    });
    if (!rows.length) return '<p class="jb-ver__empty">No earlier versions of this ' + esc(DOC_NOUN[feature] || "draft") + " yet.</p>";
    return '<ol class="jb-ver" data-ver-for="' + esc(feature) + '">' + rows.map(function (r) { return runRowHtml(r, feature, o); }).join("") + "</ol>";
  }

  /* -------------------- the modal: in the page -------------------- */

  var current = null;
  var ENTRANCE_MS = 900;

  function announce(message, assertive) {
    var a11y = root.JobBoredA11y;
    if (a11y && a11y.live && typeof a11y.live.announce === "function") {
      try { a11y.live.announce(message, assertive ? { assertive: true } : undefined); } catch (e) { /* announcing is best effort */ }
    }
  }

  function hiddenWithin(node, stop) {
    for (var n = node; n && n !== stop; n = n.parentNode) {
      if (n.hasAttribute && n.hasAttribute("hidden")) return true;
    }
    return false;
  }

  function focusables(el) {
    return Array.prototype.slice.call(el.querySelectorAll("button")).filter(function (b) {
      return !b.disabled && !hiddenWithin(b, el);
    });
  }

  /* A repaint replaces every node, so focus is found again by what it was. */
  var FOCUS_KEYS = ["data-score-step", "data-score-fix", "data-score-apply", "data-score-promote", "data-score-rescore-run"];
  function focusKeyOf(node) {
    if (!node || !node.getAttribute) return "";
    for (var i = 0; i < FOCUS_KEYS.length; i++) {
      var v = node.getAttribute(FOCUS_KEYS[i]);
      if (v != null) return "[" + FOCUS_KEYS[i] + '="' + v + '"]';
    }
    if (node.hasAttribute("data-score-rescore")) return "[data-score-rescore]";
    if (node.hasAttribute("data-score-repair")) return "[data-score-repair]";
    if (node.tagName === "BUTTON" && node.hasAttribute("data-score-close")) return "button[data-score-close]";
    return "";
  }

  function viewKey(v) {
    return [v.disposition, v.state, v.reason].join("|");
  }

  function spoken(v) {
    return v.word + (v.reasonFull ? " — " + noPeriod(v.reasonFull) : "") + ".";
  }

  function paint(ctl) {
    var d = root.document;
    var data = ctl.spec.read() || {};
    var model = modelOf(data);
    ctl.model = model;
    if (!ctl.ui.open) ctl.ui.open = defaultOpen(model);
    var active = d.activeElement;
    var inside = ctl.el.contains(active);
    var key = inside ? focusKeyOf(active) : "";
    var body = ctl.el.querySelector(".jb-score__body");
    var scroll = body ? body.scrollTop : 0;
    ctl.el.innerHTML = innerHtml(model, ctl.ui);
    /* A step animates in once, when it is opened, never on a repaint. */
    ctl.ui.reveal = null;
    ctl.el.setAttribute("data-tone", model.view.tone);
    ctl.el.setAttribute("data-feature", model.feature);
    var again = ctl.el.querySelector(".jb-score__body");
    if (again && scroll) again.scrollTop = scroll;
    if (inside) {
      var target = (key && ctl.el.querySelector(key)) || ctl.el.querySelector(".jb-score__step-btn");
      if (target && typeof target.focus === "function") target.focus();
    }
    return model;
  }

  function refresh(ctl, quiet) {
    if (ctl.closed) return;
    var before = ctl.model ? viewKey(ctl.model.view) : "";
    var model = paint(ctl);
    if (!quiet && before && viewKey(model.view) !== before) {
      announce("Quality check updated: " + spoken(model.view));
    }
  }

  function teardown(ctl) {
    if (ctl.torn) return;
    ctl.torn = true;
    ctl.closed = true;
    var d = root.document;
    if (ctl.el && ctl.el.parentNode) ctl.el.parentNode.removeChild(ctl.el);
    if (d.documentElement && d.documentElement.classList) d.documentElement.classList.remove("jb-score-open");
    if (current === ctl) current = null;
    if (typeof ctl.spec.onClose === "function") {
      try { ctl.spec.onClose(); } catch (e) { /* the host's tidy-up never blocks a close */ }
    }
  }

  function closeCtl(ctl, reason) {
    if (ctl.closed) return;
    ctl.closed = true;
    if (ctl.dialog) ctl.dialog.close(reason);
    else {
      teardown(ctl);
      var opener = ctl.spec.opener;
      if (opener && typeof opener.focus === "function") opener.focus();
    }
    teardown(ctl);
  }

  /* G8: Rescore re-runs the quality check on a version in place; with a
     runId, on that row's version, and the version list reloads. */
  function runRescore(ctl, runId) {
    if (ctl.ui.busy || (ctl.model && ctl.model.busy) || typeof ctl.spec.rescore !== "function") return;
    ctl.ui.busy = true;
    ctl.ui.error = "";
    refresh(ctl, true);
    var p;
    try { p = ctl.spec.rescore(runId || ""); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(function () {
      if (ctl.closed) return;
      ctl.ui.busy = false;
      if (runId || ctl.ui.history !== undefined) { ctl.ui.history = undefined; if (ctl.ui.open.versions) loadHistory(ctl); }
      refresh(ctl, true);
      announce("Rescored: " + spoken(ctl.model.view));
    }, function (err) {
      if (ctl.closed) return;
      ctl.ui.busy = false;
      /* FIX2-N1: a refused Rescore's api-error envelope already says
         "Rescore didn't finish — <why>"; show it once, as sent. */
      var said = String((err && err.message) || "unknown error");
      ctl.ui.error = /^Rescore didn[’']t finish/.test(said) ? said : "Rescore didn’t finish: " + said;
      refresh(ctl, true);
      announce(ctl.ui.error, true);
    });
  }

  /* A held version downloads only after the in-page confirm (G7). */
  function download(ctl, href, filename) {
    if (typeof ctl.spec.download === "function") { ctl.spec.download(href, filename); return; }
    var d = root.document;
    var a = d.createElement("a");
    a.setAttribute("href", href);
    a.setAttribute("download", "");
    d.body.appendChild(a);
    if (typeof a.click === "function") a.click();
    if (a.parentNode) a.parentNode.removeChild(a);
  }

  function focusIn(ctl, sel) {
    var target = ctl.el.querySelector(sel);
    if (target && typeof target.focus === "function") target.focus();
  }

  function loadHistory(ctl) {
    if (ctl.ui.history !== undefined || typeof ctl.spec.loadHistory !== "function") return;
    ctl.ui.history = "loading";
    var p;
    try { p = ctl.spec.loadHistory(); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(function (runs) {
      ctl.ui.history = Array.isArray(runs) ? runs : [];
    }, function (err) {
      ctl.ui.history = { error: (err && err.message) || "unknown error" };
    }).then(function () { refresh(ctl, true); });
  }

  function toggleStep(ctl, id) {
    ctl.ui.open[id] = !ctl.ui.open[id];
    ctl.ui.reveal = ctl.ui.open[id] ? id : null;
    if (ctl.ui.open[id] && id === "versions") loadHistory(ctl);
    refresh(ctl, true);
  }

  /* Fix this, Apply and Repair act on something behind the modal (the
     Repair form, Scribe's composer, Refine), so the modal closes first and
     the host then moves focus to what it filled. */
  function handOff(ctl, fn, arg) {
    closeCtl(ctl, "handoff");
    if (typeof fn === "function") fn(arg);
  }

  function closestRun(node, stop) {
    for (var n = node; n && n !== stop; n = n.parentNode) {
      if (n.getAttribute && n.getAttribute("data-run") != null && /\bjb-ver__run\b/.test(String(n.getAttribute("class") || ""))) return n.getAttribute("data-run");
    }
    return "";
  }

  function onClick(ctl, e) {
    var t = e.target;
    while (t && t !== ctl.el.parentNode) {
      if (t.getAttribute) {
        var action = t.getAttribute("data-action");
        if (action === "materials-download" && t.getAttribute("data-gate") === "held") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          ctl.ui.confirm = { runId: (closestRun(t, ctl.el) || ""), href: t.getAttribute("href") || "", filename: t.getAttribute("data-filename") || "", reason: t.getAttribute("data-held") || "" };
          refresh(ctl, true);
          focusIn(ctl, ".mat-confirm button");
          return;
        }
        if (action === "materials-download-anyway") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          ctl.ui.confirm = null;
          download(ctl, t.getAttribute("data-href") || "", t.getAttribute("data-filename") || "");
          refresh(ctl, true);
          return;
        }
        if (action === "materials-confirm-cancel") {
          ctl.ui.confirm = null;
          refresh(ctl, true);
          focusIn(ctl, '[data-score-step="versions"]');
          return;
        }
        if (action === "materials-download" || action === "materials-preview") return;
        var rerun = t.getAttribute("data-score-rescore-run");
        if (rerun) { runRescore(ctl, rerun); return; }
        if (t.hasAttribute("data-score-close")) { closeCtl(ctl, "button"); return; }
        if (t.hasAttribute("data-score-handoff")) { closeCtl(ctl, "handoff"); return; }
        if (t.hasAttribute("data-score-retry")) { handOff(ctl, ctl.spec.retry, { feature: ctl.model.feature }); return; }
        var focus = t.getAttribute("data-score-profile");
        if (focus) { handOff(ctl, ctl.spec.profile, focus); return; }
        var step = t.getAttribute("data-score-step");
        if (step) { toggleStep(ctl, step); return; }
        if (t.hasAttribute("data-score-rescore")) { runRescore(ctl, ""); return; }
        if (t.hasAttribute("data-score-repair")) { handOff(ctl, ctl.spec.repair, { feature: ctl.model.feature }); return; }
        var fix = t.getAttribute("data-score-fix");
        if (fix != null) {
          var item = ctl.model.why[Number(fix)];
          if (item) handOff(ctl, ctl.spec.fix, { feature: ctl.model.feature, instruction: item.instruction, issueId: item.issueId, why: item.why || item.label });
          return;
        }
        var apply = t.getAttribute("data-score-apply");
        if (apply != null) {
          var s = ctl.model.rewrites[Number(apply)];
          if (s) handOff(ctl, ctl.spec.apply, { feature: ctl.model.feature, instruction: s.instruction, section: s.section, before: s.before, after: s.after });
          return;
        }
        var run = t.getAttribute("data-score-promote");
        if (run && typeof ctl.spec.promote === "function") {
          ctl.ui.error = "";
          Promise.resolve(ctl.spec.promote(run)).then(function () {
            ctl.ui.history = undefined;
            loadHistory(ctl);
            refresh(ctl);
          }, function (err) {
            if (ctl.closed) return;
            ctl.ui.error = "Couldn’t switch versions: " + ((err && err.message) || "unknown error");
            refresh(ctl, true);
            announce(ctl.ui.error, true);
          });
          return;
        }
      }
      if (t === ctl.el) return;
      t = t.parentNode;
    }
  }

  function onKeydown(ctl, e) {
    /* Esc closes this modal and stops here: the page's own Esc handlers
       (materials-feature.js closes the draft modal) must not also see it. */
    if (e.key === "Escape") {
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      closeCtl(ctl, "escape");
      return;
    }
    if (e.key !== "Tab") return;
    var d = root.document;
    var items = focusables(ctl.el);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var active = d.activeElement;
    var outside = !ctl.el.contains(active);
    if (e.shiftKey && (outside || active === first)) {
      if (typeof e.preventDefault === "function") e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (outside || active === last)) {
      if (typeof e.preventDefault === "function") e.preventDefault();
      first.focus();
    }
  }

  /**
   * spec: { opener, read() -> data (see modelOf), fix(item), apply(s),
   * repair(), retry(), profile(focus), rescore(runId) -> Promise,
   * loadHistory() -> Promise<runs>, promote(runId) -> Promise,
   * download(href, filename), onClose() }.
   * Returns { el, refresh, close, isOpen }.
   */
  function open(spec) {
    var d = root.document;
    var s = spec || {};
    if (!d || !d.body || typeof s.read !== "function") return null;
    if (current) closeCtl(current, "replaced");
    var ctl = { spec: s, ui: { n: ++idSeq, open: null, busy: false, error: "", history: undefined, confirm: null }, el: null, dialog: null, closed: false, model: null };
    var holder = d.createElement("div");
    var model = modelOf(s.read() || {});
    ctl.model = model;
    ctl.ui.open = defaultOpen(model);
    holder.innerHTML = modalHtml(model, ctl.ui);
    ctl.el = holder.firstElementChild;
    if (!ctl.el) return null;
    ctl.el.addEventListener("click", function (e) { onClick(ctl, e); });
    ctl.el.addEventListener("keydown", function (e) { onKeydown(ctl, e); });
    d.body.appendChild(ctl.el);
    if (d.documentElement && d.documentElement.classList) d.documentElement.classList.add("jb-score-open");
    current = ctl;
    var first = ctl.el.querySelector(".jb-score__step-btn");
    var a11y = root.JobBoredA11y;
    if (a11y && a11y.dialog && typeof a11y.dialog.open === "function") {
      ctl.dialog = a11y.dialog.open(ctl.el, {
        opener: s.opener || null,
        initialFocus: first || undefined,
        onClose: function () { teardown(ctl); },
      });
    } else if (first) {
      first.focus();
    }
    /* The card rises and the steps arrive one after another;
       is-entering lasts only as long as that entrance. */
    var raf = typeof root.requestAnimationFrame === "function" ? root.requestAnimationFrame : function (fn) { fn(); };
    raf(function () {
      if (ctl.closed) return;
      ctl.el.classList.add("is-open", "is-entering");
      if (typeof root.setTimeout === "function") root.setTimeout(function () { ctl.el.classList.remove("is-entering"); }, ENTRANCE_MS);
    });
    var handle = {
      el: ctl.el,
      refresh: function () { refresh(ctl); },
      close: function () { closeCtl(ctl, "api"); },
      isOpen: function () { return !ctl.closed; },
    };
    ctl.handle = handle;
    return handle;
  }

  root.JobBoredMaterialsScore = {
    verdictView: verdictView,
    qaVersion: qaVersion,
    coverageLine: coverageLine,
    buttonHtml: buttonHtml,
    accessibleName: accessibleName,
    modelOf: modelOf,
    modalHtml: modalHtml,
    versionsHtml: versionsHtml,
    open: open,
    current: function () { return current ? current.handle : null; },
  };
})(typeof window !== "undefined" ? window : this);
