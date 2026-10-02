/* ============================================================
   materials-score.js — HOLES lane SCORE: the letter grade and the
   score modal
   ------------------------------------------------------------
   Spec: docs/programs/holes-20261002/SPEC-HOLES-2026-10-02.md
         §0.3 (modal, one minimal button), §0.8 (the grade), §2 SCORE.

   A document's score shows as ONE button: its letter in a small ring.
   Everything the graders said (blockers, dimensions, evidence, rewrite
   suggestions, keyword coverage, history) lives in one modal, opened
   through JobBoredA11y.dialog and revealed one step at a time. The
   dossier rows, the Case and Scribe paint nothing else of the score.

   Pure: gradeOf, buttonHtml, modelOf, modalHtml (strings, no DOM).
   open(spec) puts the modal in the page; the host passes read() for
   the data and the actions it can take (fix, apply, repair, rescore,
   loadHistory, promote). A host that cannot take one leaves it out,
   and its buttons are not drawn.

   The detail sections reuse materials-insights.js's readers of the
   judge's record (issue groups, rubric labels, run history).

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

  /* -------------------- §0.8 the grade -------------------- */

  /* Within a band the bottom three points are "-" and the top three "+";
     below 60 is a plain F. */
  var BANDS = [
    { base: "A", lo: 90, hi: 100 },
    { base: "B", lo: 80, hi: 89 },
    { base: "C", lo: 70, hi: 79 },
    { base: "D", lo: 60, hi: 69 },
  ];
  var RANK = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
  var FAIL_CAP = "D";

  function letterFor(score) {
    for (var i = 0; i < BANDS.length; i++) {
      var b = BANDS[i];
      if (score < b.lo) continue;
      if (score <= b.lo + 2) return b.base + "-";
      if (score >= b.hi - 2) return b.base + "+";
      return b.base;
    }
    return "F";
  }

  function finite(n) {
    return typeof n === "number" && isFinite(n);
  }

  function toScore(n) {
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  /* The manifest's quality record, read the way materials-insights.js reads
     it: a v1 record carries a rubric, a v2 record a quality block or gates
     (the manifest may copy a v2 record without its contract field). */
  function qaOf(qualityDoc) {
    var qa = qualityDoc && qualityDoc.qa;
    return qa && typeof qa === "object" ? qa : null;
  }

  function qaVersion(qa) {
    if (!qa) return 0;
    if (qa.rubric && typeof qa.rubric === "object") return 1;
    if (qa.contract === "materials.qa.v2" || (qa.quality && typeof qa.quality === "object") || Array.isArray(qa.gates)) return 2;
    return 0;
  }

  /* A version saved from a stored model gets a placeholder rubric (one
     version_recheck row, 0 of 1; server/materials-regenerate.mjs
     writeVersionQa): nothing was graded, so it is no score, never an F. */
  function isUnscoredStub(qa) {
    var rows = qa && qa.rubric && Array.isArray(qa.rubric.rows) ? qa.rubric.rows : [];
    return rows.length > 0 && rows.every(function (r) { return r && r.id === "version_recheck"; });
  }

  function verdictOf(qualityDoc) {
    var qa = qaOf(qualityDoc);
    if (qa && qa.disposition) return String(qa.disposition).toUpperCase();
    var status = String((qualityDoc && qualityDoc.status) || "").toLowerCase();
    if (status === "fail") return "FAIL";
    if (status === "review") return "REVIEW";
    return qualityDoc ? "READY" : "";
  }

  /* A stored scorecard entry is { result, feature, storedAt }; the bus and
     the legacy modal hand over the result itself. */
  function atsResultOf(ats) {
    if (!ats || typeof ats !== "object") return null;
    if (ats.result && typeof ats.result === "object") return ats.result;
    return ats;
  }

  var JUDGE_FAILURES = {
    auth: "the key was rejected",
    rate_limited: "the provider was busy",
    timeout: "it timed out",
    unconfigured: "no key is saved for it",
    invalid_json: "it returned a grade we couldn’t use",
    invalid_judgment: "it returned a grade we couldn’t use",
  };

  function whyUngraded(qa) {
    if (isUnscoredStub(qa)) {
      return "This version was saved without a grade: its evidence was not rescored. Rescore grades it against the role.";
    }
    var j = qa && qa.judge && typeof qa.judge === "object" ? qa.judge : null;
    if (j && j.status && j.status !== "ok") {
      var reason = JUDGE_FAILURES[String(j.errorCode || "")]
        || (j.status === "invalid" ? JUDGE_FAILURES.invalid_judgment : "it didn’t answer");
      return "Grading" + (j.model ? " by " + j.model : "") + " didn’t finish: " + reason
        + ". Rescore to grade it against the role.";
    }
    if (qa) return "The grading model gave this draft no score. Rescore to grade it against the role.";
    return "Nothing has graded this draft yet. Rescore grades it against the role.";
  }

  /**
   * qualityDoc: the manifest's quality.documents[type] (or undefined).
   * ats: an ATS scorecard result, or the stored { result, feature, storedAt }.
   * Returns { letter, base, score, source, verdict, capped, why }.
   */
  function gradeOf(qualityDoc, ats) {
    var qa = qaOf(qualityDoc);
    var version = qaVersion(qa);
    var verdict = verdictOf(qualityDoc);
    var score = null;
    var source = "none";
    if (version === 2 && qa.quality && finite(qa.quality.score)) {
      score = toScore(qa.quality.score);
      source = "judge";
    } else if (version === 1 && !isUnscoredStub(qa) && finite(qa.rubric.score) && finite(qa.rubric.max) && qa.rubric.max > 0) {
      score = toScore((qa.rubric.score / qa.rubric.max) * 100);
      source = "rubric";
    } else {
      var result = atsResultOf(ats);
      if (result && finite(result.overallScore)) {
        score = toScore(result.overallScore);
        source = "ats";
      }
    }
    if (score == null) {
      return { letter: "Grade", base: "", score: null, source: "none", verdict: verdict, capped: false, why: whyUngraded(qa) };
    }
    var letter = letterFor(score);
    var capped = verdict === "FAIL" && RANK.indexOf(letter) > RANK.indexOf(FAIL_CAP);
    if (capped) letter = FAIL_CAP;
    return { letter: letter, base: letter.charAt(0), score: score, source: source, verdict: verdict, capped: capped, why: "" };
  }

  /* -------------------- the button -------------------- */

  function toneOf(grade) {
    var b = grade && grade.base;
    if (b === "A" || b === "B") return "good";
    if (b === "C") return "fair";
    if (b === "D" || b === "F") return "low";
    return "none";
  }

  function accessibleName(grade, stale) {
    if (!grade || grade.score == null) return "Grade: not graded yet — open score details";
    return "Grade " + grade.letter + ", " + grade.score + " of 100"
      + (grade.capped ? ", capped by a failed check" : "")
      + (stale ? ", out of date" : "")
      + " — open score details";
  }

  /**
   * opts: { feature, scope, stale }. The visible face is the letter alone.
   */
  function buttonHtml(grade, opts) {
    var o = opts || {};
    var g = grade || gradeOf();
    return '<button type="button" class="jb-grade" data-tone="' + toneOf(g) + '" data-score-open'
      + (o.feature ? ' data-feature="' + esc(o.feature) + '"' : "")
      + (o.scope ? ' data-scope="' + esc(o.scope) + '"' : "")
      + ' data-grade="' + esc(g.letter) + '"'
      + (o.stale ? ' data-stale="true"' : "")
      + ' aria-haspopup="dialog" aria-label="' + esc(accessibleName(g, o.stale)) + '">'
      + '<span class="jb-grade__ring" aria-hidden="true">' + esc(g.score == null ? "Grade" : g.letter) + "</span>"
      + (o.stale ? '<span class="jb-grade__stale" aria-hidden="true"></span>' : "")
      + "</button>";
  }

  /* -------------------- the modal: what it says -------------------- */

  var DOC_LABEL = { resume: "Resume", cover_letter: "Cover letter" };
  var DOC_NOUN = { resume: "resume", cover_letter: "cover letter" };
  var ROLE_DIMENSIONS = [
    { key: "requirementsCoverage", label: "Requirements covered" },
    { key: "experienceRelevance", label: "Relevant experience" },
    { key: "impactClarity", label: "Impact clarity" },
    { key: "atsParseability", label: "Reads cleanly for screeners" },
    { key: "toneFit", label: "Tone fit" },
  ];
  var SOURCE_WORDS = { resume: "your resume", cover_letter: "your cover letter", job: "the posting", profile: "your profile" };
  var VERDICT_LINES = {
    READY: "Ready to send.",
    REVIEW: "Worth a look before you send it.",
    FAIL: "It failed a hard check. Fix the blockers before you send it.",
  };
  var VERDICT_CHIPS = { READY: "Ready", REVIEW: "Review", FAIL: "Failed a check" };
  /* Blockers first, the grader's notes last. */
  var GROUPS = ["blocker", "flag", "check", "rubric", "gap", "background", "writing", "note"];
  var GROUP_TAGS = {
    blocker: "Blocker", flag: "Check", check: "To confirm", rubric: "Rubric",
    gap: "Role gap", background: "Background gap", writing: "Writing", note: "Fallback",
  };
  var SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
  var INSTRUCTION_MAX = 600;
  var STEPS = [
    { id: "blockers", title: "Blockers and gaps" },
    { id: "dimensions", title: "Dimensions" },
    { id: "evidence", title: "Evidence" },
    { id: "rewrites", title: "Rewrite suggestions" },
    { id: "keywords", title: "Keyword coverage" },
    { id: "history", title: "History" },
  ];

  function insights() {
    var mi = root.JobBoredMaterialsInsights;
    return mi && typeof mi.qaIssues === "function" ? mi : null;
  }

  function cap(s) {
    var t = String(s || "");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

  function clip(s) {
    var t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > INSTRUCTION_MAX ? t.slice(0, INSTRUCTION_MAX - 1) + "…" : t;
  }

  function fixText(reason, quote) {
    return clip("Fix this: " + String(reason || "").trim() + (quote ? " (“" + quote + "”)" : ""));
  }

  function list(v) {
    return Array.isArray(v) ? v.filter(Boolean) : [];
  }

  function blockerItems(qualityDoc, qa, version, ats, mi) {
    var items = [];
    var judged = {};
    if (version === 2 && mi) {
      mi.qaIssues(qa).forEach(function (it) {
        if (it.id) judged[it.id] = 1;
        var group = it.group === "facts" ? "blocker" : (it.group === "check" ? "check" : "writing");
        items.push({
          group: group, kind: it.kind ? mi.kindWord(it.kind) : "", quotes: it.quotes, why: it.reason,
          issueId: it.id, instruction: fixText(it.reason, it.quotes[0]),
        });
      });
    }
    /* The deterministic audit's flags, every one of them (U16). */
    list(qualityDoc && qualityDoc.issues).forEach(function (f) {
      var said = String(f.message || f.code || "").trim();
      if (!said || judged[f.code]) return;
      items.push({ group: f.severity === "fail" ? "blocker" : "flag", kind: "", quotes: [], why: said, issueId: "", instruction: fixText(said) });
    });
    if (version === 1 && !isUnscoredStub(qa)) {
      list(qa.rubric.rows).forEach(function (r) {
        if (!(r.score < r.max)) return;
        var label = mi ? mi.rubricLabel(r.id) : cap(String(r.id || "").replace(/_/g, " "));
        items.push({
          group: "rubric", kind: label + " · " + r.score + " / " + r.max, quotes: [], why: String(r.note || label),
          issueId: "", instruction: clip("Improve “" + label + "”" + (r.note ? ": " + r.note : "")),
        });
      });
      list(qa.degraded).forEach(function (x) {
        items.push({ group: "note", kind: "", quotes: [], why: mi ? mi.plainDegraded(x) : String(x), issueId: "", instruction: "", noFix: true });
      });
    }
    list(ats && ats.criticalGaps).slice().sort(function (a, b) {
      return (SEVERITY_ORDER[a.severity] == null ? 1 : SEVERITY_ORDER[a.severity]) - (SEVERITY_ORDER[b.severity] == null ? 1 : SEVERITY_ORDER[b.severity]);
    }).forEach(function (g) {
      if (!g.gap) return;
      items.push({
        group: "gap", kind: g.severity ? cap(g.severity) : "", quotes: [], why: String(g.gap), sub: String(g.whyItMatters || ""),
        issueId: "", instruction: clip("Address this gap: " + g.gap + (g.whyItMatters ? " — " + g.whyItMatters : "")),
      });
    });
    if (version === 2) {
      list(qa.qualificationGaps).forEach(function (g) {
        var gap = String(g).trim();
        if (!gap) return;
        items.push({
          group: "background", kind: "", quotes: [], why: gap, sub: "What the posting asks for that your background doesn’t show.",
          issueId: "", instruction: clip("Address this gap honestly, using only what my background supports: " + gap),
        });
      });
    }
    return items.map(function (it, i) { it.order = i; return it; }).sort(function (a, b) {
      return GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order;
    });
  }

  function dimensionGroups(qa, version, ats, mi) {
    var groups = [];
    if (version === 2 && qa.quality && Array.isArray(qa.quality.ratings)) {
      var dims = mi ? mi.JUDGE_DIMENSIONS : [];
      var rows = qa.quality.ratings.filter(Boolean).map(function (r) {
        var named = dims.filter(function (d) { return d.id === r.dimension; })[0];
        return {
          label: named ? named.label : cap(String(r.dimension || "").replace(/_/g, " ")),
          value: Math.max(0, Math.min(4, Number(r.score) || 0)), max: 4, why: String(r.reason || ""),
        };
      });
      if (rows.length) groups.push({ title: "Writing", note: "0–4 from the grading model", rows: rows });
    }
    if (version === 1 && !isUnscoredStub(qa)) {
      var rubric = list(qa.rubric.rows).filter(function (r) { return finite(r.score) && finite(r.max) && r.max > 0; }).map(function (r) {
        return { label: mi ? mi.rubricLabel(r.id) : cap(String(r.id || "").replace(/_/g, " ")), value: r.score, max: r.max, why: String(r.note || "") };
      });
      if (rubric.length) groups.push({ title: "Rubric", note: "the old checker", rows: rubric });
    }
    var ds = ats && ats.dimensionScores && typeof ats.dimensionScores === "object" ? ats.dimensionScores : null;
    if (ds) {
      var role = ROLE_DIMENSIONS.filter(function (d) { return finite(ds[d.key]); }).map(function (d) {
        return { label: d.label, value: toScore(ds[d.key]), max: 100, why: "" };
      });
      if (role.length) groups.push({ title: "Role match", note: "0–100 from the role-match check", rows: role });
    }
    return groups;
  }

  function evidenceOf(qa, version, ats) {
    var out = { items: [], strengths: list(ats && ats.topStrengths).map(String), backed: "" };
    list(ats && ats.evidence).forEach(function (e) {
      if (!e.claim && !e.sourceSnippet) return;
      out.items.push({ claim: String(e.claim || ""), snippet: String(e.sourceSnippet || ""), source: SOURCE_WORDS[e.sourceType] || "your profile" });
    });
    if (version === 2) {
      var factual = list(qa.sentences).filter(function (x) { return x.status === "supported" || x.status === "unsupported" || x.status === "uncertain"; });
      var supported = factual.filter(function (x) { return x.status === "supported"; });
      if (factual.length) out.backed = supported.length + " of " + factual.length + " factual sentence" + (factual.length === 1 ? " is" : "s are") + " backed by your background.";
      supported.forEach(function (x) {
        var quotes = list(x.citations).map(function (c) { return String(c.quote || "").trim(); }).filter(Boolean);
        if (quotes.length) out.items.push({ claim: String(x.text || ""), snippet: quotes.join(" · "), source: "your background" });
      });
    }
    return out;
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

  function judgeLineOf(grade, qa, version, atsEntry, ats, mi) {
    var when = atsEntry && atsEntry.storedAt && mi ? mi.shortDate(atsEntry.storedAt) : "";
    if (grade.source === "judge") {
      var j = qa.judge && typeof qa.judge === "object" ? qa.judge : {};
      var who = j.independent === false
        ? "Graded by your writing model" + (j.model ? " (" + j.model + ")" : "")
        : "Graded by " + (j.model || j.provider || "an independent model");
      return who + (j.promptVersion ? " · " + j.promptVersion : "");
    }
    if (grade.source === "rubric") return "Graded by the old checker (rubric)";
    if (grade.source === "ats") {
      var pct = finite(ats.confidence) ? Math.round(ats.confidence * 100) : null;
      return "Role match by " + (ats.model || "the role-match check")
        + (pct != null ? " · " + pct + "% confidence" : "")
        + (ats.overallScoreSource === "dimensions" ? " · averaged from its five dimensions" : "")
        + (when ? " · scored " + when : "");
    }
    return version ? "Not graded" : "";
  }

  /**
   * data: { feature, role, qualityDoc, ats, stale, coverage, busy, can }.
   * Everything the modal shows, as plain values.
   */
  function modelOf(data) {
    var d = data || {};
    var mi = insights();
    var qa = qaOf(d.qualityDoc);
    var version = qaVersion(qa);
    var atsEntry = d.ats && d.ats.result ? d.ats : null;
    var ats = atsResultOf(d.ats);
    var grade = gradeOf(d.qualityDoc, d.ats);
    var verdictLine = grade.score == null
      ? grade.why
      : (version === 2 ? String(qa.dispositionReason || "").trim()
        : (version === 1 && mi ? mi.plainDisposition(qa) : "")) || VERDICT_LINES[grade.verdict]
        || "How well this draft matches the role, from the role-match check.";
    var cov = d.coverage && typeof d.coverage === "object" && finite(d.coverage.total) && d.coverage.total > 0 ? d.coverage : null;
    return {
      feature: d.feature === "cover_letter" ? "cover_letter" : (d.feature === "resume" ? "resume" : ""),
      role: String(d.role || ""),
      grade: grade,
      verdictLine: verdictLine,
      capNote: grade.capped ? "Capped at D: a failed hard check caps the grade, whatever the score." : "",
      judgeLine: judgeLineOf(grade, qa, version, atsEntry, ats || {}, mi),
      stale: !!d.stale,
      blockers: blockerItems(d.qualityDoc, qa, version, ats, mi),
      dimensions: dimensionGroups(qa, version, ats, mi),
      evidence: evidenceOf(qa, version, ats),
      rewrites: rewritesOf(ats),
      coverage: cov ? { matched: list(cov.matched).map(String), missing: list(cov.missing).map(String), total: cov.total } : null,
      busy: !!d.busy,
      can: d.can && typeof d.can === "object" ? d.can : {},
    };
  }

  /* The save-time stub is 0 of 1 (or of 2 for both documents) in /runs. */
  function verdictGrade(v) {
    if (!v || !finite(v.score) || !finite(v.max) || v.max <= 0) return null;
    if (v.score === 0 && v.max <= 2) return null;
    var score = toScore(v.max === 100 ? v.score : (v.score / v.max) * 100);
    var letter = letterFor(score);
    if (String(v.disposition || "").toUpperCase() === "FAIL" && RANK.indexOf(letter) > RANK.indexOf(FAIL_CAP)) letter = FAIL_CAP;
    return { letter: letter, score: score };
  }

  function stepCount(model, id) {
    if (id === "blockers") return model.blockers.length;
    if (id === "dimensions") return model.dimensions.reduce(function (n, g) { return n + g.rows.length; }, 0);
    if (id === "evidence") return model.evidence.items.length + model.evidence.strengths.length;
    if (id === "rewrites") return model.rewrites.length;
    if (id === "keywords") return model.coverage ? model.coverage.total : 0;
    return 0;
  }

  /* The first step with something in it starts open; History waits to be asked. */
  function defaultOpen(model) {
    var open = {};
    for (var i = 0; i < STEPS.length - 1; i++) {
      if (stepCount(model, STEPS[i].id)) { open[STEPS[i].id] = true; break; }
    }
    return open;
  }

  /* -------------------- the modal: markup -------------------- */

  function btn(cls, attrs, label) {
    return '<button type="button" class="jb-score__btn' + (cls ? " " + cls : "") + '"' + attrs + ">" + label + "</button>";
  }

  function itemHtml(it, i, can) {
    var fix = can.fix && !it.noFix && it.instruction
      ? btn("jb-score__btn--small", ' data-score-fix="' + i + '"', "Fix this")
      : "";
    return '<li class="jb-score__item" data-group="' + esc(it.group) + '">'
      + '<p class="jb-score__tag">' + esc(GROUP_TAGS[it.group] + (it.kind ? " · " + it.kind : "")) + "</p>"
      + it.quotes.map(function (q) { return '<q class="jb-score__quote">' + esc(q) + "</q>"; }).join("")
      + (it.why ? '<p class="jb-score__why">' + esc(it.why) + "</p>" : "")
      + (it.sub ? '<p class="jb-score__sub">' + esc(it.sub) + "</p>" : "")
      + fix
      + "</li>";
  }

  function emptyHtml(words) {
    return '<p class="jb-score__empty">' + esc(words) + "</p>";
  }

  function meterHtml(value, max) {
    var pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    return '<span class="jb-score__meter" aria-hidden="true"><i style="--jb-score-fill: ' + pct + '%"></i></span>';
  }

  function panelBody(model, id, ui) {
    var can = model.can;
    var noun = DOC_NOUN[model.feature] || "draft";
    if (id === "blockers") {
      if (!model.blockers.length) return emptyHtml("Nothing is blocking this " + noun + ".");
      return '<ul class="jb-score__items">' + model.blockers.map(function (it, i) { return itemHtml(it, i, can); }).join("") + "</ul>";
    }
    if (id === "dimensions") {
      if (!model.dimensions.length) return emptyHtml("No dimension scores yet." + (can.rescore ? " Rescore grades this " + noun + " against the role." : ""));
      return model.dimensions.map(function (g) {
        return '<div class="jb-score__dims"><p class="jb-score__group">' + esc(g.title) + ' <span class="jb-score__note">' + esc(g.note) + "</span></p>"
          + '<ul class="jb-score__dimlist">' + g.rows.map(function (r) {
            return '<li class="jb-score__dim"><span class="jb-score__dim-label">' + esc(r.label) + "</span>"
              + meterHtml(r.value, r.max)
              + '<span class="jb-score__dim-n">' + esc(r.value + " / " + r.max) + "</span>"
              + (r.why ? '<span class="jb-score__dim-why">' + esc(r.why) + "</span>" : "")
              + "</li>";
          }).join("") + "</ul></div>";
      }).join("");
    }
    if (id === "evidence") {
      var ev = model.evidence;
      if (!ev.items.length && !ev.strengths.length && !ev.backed) return emptyHtml("No evidence cited yet.");
      return (ev.backed ? '<p class="jb-score__lede">' + esc(ev.backed) + "</p>" : "")
        + (ev.items.length ? '<ul class="jb-score__items">' + ev.items.map(function (e) {
          return '<li class="jb-score__item jb-score__item--evidence"><p class="jb-score__why">' + esc(e.claim) + "</p>"
            + (e.snippet ? '<q class="jb-score__quote">' + esc(e.snippet) + "</q>" : "")
            + '<p class="jb-score__tag">From ' + esc(e.source) + "</p></li>";
        }).join("") + "</ul>" : "")
        + (ev.strengths.length ? '<p class="jb-score__group">Strengths</p><ul class="jb-score__plain">'
          + ev.strengths.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" : "");
    }
    if (id === "rewrites") {
      if (!model.rewrites.length) return emptyHtml("No rewrite suggestions yet." + (can.rescore ? " Rescore asks for line-level suggestions." : ""));
      return '<ul class="jb-score__items">' + model.rewrites.map(function (s, i) {
        return '<li class="jb-score__item jb-score__item--rewrite">'
          + (s.section ? '<p class="jb-score__tag">' + esc(s.section) + "</p>" : "")
          + (s.before ? '<p class="jb-score__before"><span class="jb-score__vh">Before: </span>' + esc(s.before) + "</p>" : "")
          + '<p class="jb-score__after"><span class="jb-score__vh">After: </span>' + esc(s.after) + "</p>"
          + (s.why ? '<p class="jb-score__sub">' + esc(s.why) + "</p>" : "")
          + (can.apply ? btn("jb-score__btn--small", ' data-score-apply="' + i + '"', "Apply") : "")
          + "</li>";
      }).join("") + "</ul>";
    }
    if (id === "keywords") {
      var c = model.coverage;
      if (!c) return emptyHtml("The posting’s role terms aren’t loaded for this " + noun + ".");
      return '<p class="jb-score__lede"><b>' + esc(c.matched.length + " of " + c.total) + "</b> role terms appear in this " + esc(noun) + ".</p>"
        + meterHtml(c.matched.length, c.total)
        + (c.missing.length
          ? '<p class="jb-score__group">Missing</p><p class="jb-score__chips">' + c.missing.map(function (t) { return '<span class="jb-score__chip">' + esc(t) + "</span>"; }).join("") + "</p>"
          : '<p class="jb-score__sub">It covers every term the posting names.</p>');
    }
    /* history */
    var h = ui.history;
    if (h === "loading") return emptyHtml("Loading versions…");
    if (h && h.error) return emptyHtml("Couldn’t load versions: " + h.error);
    if (!Array.isArray(h)) return emptyHtml("Open to read this " + noun + "’s earlier grades.");
    var mi = insights();
    var runs = h.filter(function (r) { return r && Array.isArray(r.documents) && r.documents.indexOf(model.feature) >= 0; });
    if (!runs.length) return emptyHtml("No earlier versions of this " + noun + " yet.");
    return '<ol class="jb-score__runs">' + runs.map(function (r) {
      var g = verdictGrade(r.verdicts && r.verdicts[model.feature]);
      var active = Array.isArray(r.active) && r.active.indexOf(model.feature) >= 0;
      return '<li class="jb-score__run" data-run="' + esc(r.runId) + '">'
        + '<span class="jb-score__run-when">' + esc((mi && mi.shortDate(r.date)) || r.runId) + "</span>"
        + '<span class="jb-score__run-what">' + esc(cap(r.template || "") + (r.source && r.source !== "draft" ? " · " + r.source : "")) + "</span>"
        + '<span class="jb-score__run-grade">' + esc(g ? g.letter + " · " + g.score : "—") + "</span>"
        + (active
          ? '<span class="jb-score__run-use">In use</span>'
          : (can.promote ? btn("jb-score__btn--small", ' data-score-promote="' + esc(r.runId) + '"', "Use this version") : "<span></span>"))
        + "</li>";
    }).join("") + "</ol>";
  }

  function stepsHtml(model, ui, n) {
    var open = ui.open || defaultOpen(model);
    return '<ol class="jb-score__steps">' + STEPS.map(function (s, i) {
      var id = "jb-score-" + s.id + "-" + n;
      var isOpen = !!open[s.id];
      var count = s.id === "history" ? "" : String(stepCount(model, s.id));
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
    var g = model.grade;
    var pct = g.score == null ? 0 : g.score;
    var title = (DOC_LABEL[model.feature] || "Draft") + " grade";
    return '<header class="jb-score__head">'
      + '<div class="jb-score__dial" data-tone="' + toneOf(g) + '" aria-hidden="true">'
      + '<svg class="jb-score__ring" viewBox="0 0 64 64" focusable="false"><circle class="jb-score__track" cx="32" cy="32" r="28" pathLength="100"></circle>'
      + '<circle class="jb-score__arc" cx="32" cy="32" r="28" pathLength="100" style="--jb-score-pct: ' + pct + '"></circle></svg>'
      + '<span class="jb-score__letter">' + esc(g.score == null ? "Grade" : g.letter) + "</span></div>"
      + '<div class="jb-score__headline">'
      + (model.role ? '<p class="jb-score__eyebrow">' + esc(model.role) + "</p>" : "")
      + '<h2 class="jb-score__title" id="jb-score-title-' + n + '"><span>' + esc(title) + "</span> "
      + '<span class="jb-score__of">' + esc(g.score == null ? "Not graded" : g.score + " / 100") + "</span></h2>"
      + '<p class="jb-score__verdict" id="jb-score-verdict-' + n + '">' + esc(model.verdictLine) + "</p>"
      + (model.capNote ? '<p class="jb-score__cap">' + esc(model.capNote) + "</p>" : "")
      + (model.judgeLine ? '<p class="jb-score__judge">' + esc(model.judgeLine) + "</p>" : "")
      + '<p class="jb-score__badges">'
      + (VERDICT_CHIPS[g.verdict] ? '<span class="jb-score__badge jb-score__badge--' + esc(g.verdict.toLowerCase()) + '">' + esc(VERDICT_CHIPS[g.verdict]) + "</span>" : "")
      + (model.stale ? '<span class="jb-score__badge jb-score__badge--stale">Changed since graded</span>' : "")
      + "</p></div></header>";
  }

  function footHtml(model, ui) {
    var can = model.can;
    var busy = !!(ui.busy || model.busy);
    var urgent = model.grade.verdict === "FAIL" || model.grade.verdict === "REVIEW";
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
   * history } — the controller's state; omitted, it is a fresh modal.
   */
  function modalHtml(model, uiState) {
    var ui = uiState || {};
    if (!ui.n) ui = Object.assign({}, ui, { n: ++idSeq });
    return '<div class="jb-score" role="dialog" aria-modal="true" aria-labelledby="jb-score-title-' + ui.n + '"'
      + ' aria-describedby="jb-score-verdict-' + ui.n + '" data-feature="' + esc(model.feature) + '" data-tone="' + toneOf(model.grade) + '">'
      + innerHtml(model, ui)
      + "</div>";
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
  var FOCUS_KEYS = ["data-score-step", "data-score-fix", "data-score-apply", "data-score-promote"];
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

  function gradeKey(g) {
    return g.letter + "|" + g.score;
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
    ctl.el.setAttribute("data-tone", toneOf(model.grade));
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
    var before = ctl.model ? gradeKey(ctl.model.grade) : "";
    var model = paint(ctl);
    if (!quiet && before && gradeKey(model.grade) !== before && model.grade.score != null) {
      announce("Score updated: grade " + model.grade.letter + ", " + model.grade.score + " of 100.");
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

  function runRescore(ctl) {
    if (ctl.ui.busy || (ctl.model && ctl.model.busy) || typeof ctl.spec.rescore !== "function") return;
    ctl.ui.busy = true;
    ctl.ui.error = "";
    refresh(ctl, true);
    var p;
    try { p = ctl.spec.rescore(); } catch (err) { p = Promise.reject(err); }
    Promise.resolve(p).then(function () {
      if (ctl.closed) return;
      ctl.ui.busy = false;
      refresh(ctl, true);
      var g = ctl.model.grade;
      announce(g.score == null ? "Rescore finished, but no score came back." : "Rescored: grade " + g.letter + ", " + g.score + " of 100.");
    }, function (err) {
      if (ctl.closed) return;
      ctl.ui.busy = false;
      ctl.ui.error = "Rescore didn’t finish: " + ((err && err.message) || "unknown error");
      refresh(ctl, true);
      announce(ctl.ui.error, true);
    });
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
    if (ctl.ui.open[id] && id === "history") loadHistory(ctl);
    refresh(ctl, true);
  }

  /* Fix this, Apply and Repair act on something behind the modal (the
     Repair form, Scribe's composer, Refine), so the modal closes first and
     the host then moves focus to what it filled. */
  function handOff(ctl, fn, arg) {
    closeCtl(ctl, "handoff");
    if (typeof fn === "function") fn(arg);
  }

  function onClick(ctl, e) {
    var t = e.target;
    while (t && t !== ctl.el.parentNode) {
      if (t.getAttribute) {
        if (t.hasAttribute("data-score-close")) { closeCtl(ctl, "button"); return; }
        var step = t.getAttribute("data-score-step");
        if (step) { toggleStep(ctl, step); return; }
        if (t.hasAttribute("data-score-rescore")) { runRescore(ctl); return; }
        if (t.hasAttribute("data-score-repair")) { handOff(ctl, ctl.spec.repair, { feature: ctl.model.feature }); return; }
        var fix = t.getAttribute("data-score-fix");
        if (fix != null) {
          var item = ctl.model.blockers[Number(fix)];
          if (item) handOff(ctl, ctl.spec.fix, { feature: ctl.model.feature, instruction: item.instruction, issueId: item.issueId, why: item.why });
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
          Promise.resolve(ctl.spec.promote(run)).then(function () {
            ctl.ui.history = undefined;
            loadHistory(ctl);
            refresh(ctl);
          }, function () { refresh(ctl, true); });
          return;
        }
      }
      if (t === ctl.el) return;
      t = t.parentNode;
    }
  }

  function onKeydown(ctl, e) {
    if (e.key === "Escape" && !ctl.dialog) {
      if (typeof e.preventDefault === "function") e.preventDefault();
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
   * repair(), rescore() -> Promise, loadHistory() -> Promise<runs>,
   * promote(runId) -> Promise, onClose() }. Returns { el, refresh, close }.
   */
  function open(spec) {
    var d = root.document;
    var s = spec || {};
    if (!d || !d.body || typeof s.read !== "function") return null;
    if (current) closeCtl(current, "replaced");
    var ctl = { spec: s, ui: { n: ++idSeq, open: null, busy: false, error: "", history: undefined }, el: null, dialog: null, closed: false, model: null };
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
    /* The card rises, the dial fills and the steps arrive one after
       another; is-entering lasts only as long as that entrance. */
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
    gradeOf: gradeOf,
    letterFor: letterFor,
    buttonHtml: buttonHtml,
    accessibleName: accessibleName,
    modelOf: modelOf,
    modalHtml: modalHtml,
    open: open,
    current: function () { return current ? current.handle : null; },
  };
})(typeof window !== "undefined" ? window : this);
