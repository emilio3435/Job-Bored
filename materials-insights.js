/* ============================================================
   materials-insights.js — JobBored v2 · Materials Wave 2 (L5)
   ------------------------------------------------------------
   Pure view helpers for the materials rows role-materials.js paints:

     U-1  quality scorecard: the verdict pill, rubric rows as pips,
          degraded AI steps in plain words, a "why" banner with the fix
     U-4  stage timeline: pending.json's structured stages mapped onto
          seven named steps (Read the job … Check quality)
     U-3  the Download menu and the in-page FAIL confirm
     U-7  role-term coverage ("14 / 24 role terms" + what is missing)
     U-6  version history list and the text diff of two runs

   Everything here returns strings or plain objects; no DOM, no fetch.
   role-materials.js owns wiring, network and state. Published as
   window.JobBoredMaterialsInsights.
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

  function cap(s) {
    var t = String(s || "");
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

  function docWords(type) {
    return type === "cover_letter" ? "cover letter" : (type === "resume" ? "resume" : "draft");
  }

  /* -------------------- plain words -------------------- */

  /* A model stage's technical failure ("output cut off at 1000 tokens
     (MAX_TOKENS) after 2 attempts") as the user would say it. */
  function plainReason(raw) {
    var t = String(raw || "").trim();
    if (!t) return "";
    if (/output cut off|MAX_TOKENS|truncat/i.test(t)) return "the AI’s answer was cut off";
    if (/rate limit|HTTP 429/i.test(t)) return "the AI provider was busy";
    if (/timed out|timeout/i.test(t)) return "the AI provider took too long";
    if (/network error/i.test(t)) return "the AI provider couldn’t be reached";
    if (/provider error|HTTP 5\d\d/i.test(t)) return "the AI provider had an error";
    if (/provider stopped|blocked/i.test(t)) return "the AI provider stopped the answer";
    if (/not valid JSON|schema/i.test(t)) return "the AI’s answer couldn’t be read";
    if (/no model configured|no pin|no_pin/i.test(t)) return "no AI model is set up";
    if (/model fill unavailable|model call failed/i.test(t)) return "the AI step didn’t answer";
    return t;
  }

  var DEGRADED_STAGE_WORDS = {
    "jd.extract": "Reading the job",
    "claims.select": "Picking your facts",
    draft: "Writing",
    support: "Checking the letter’s facts",
  };

  /* One qa.degraded[] entry — "claims.select: deterministic ranks (rate
     limited (HTTP 429) after 3 attempts)" — as one plain sentence. */
  function plainDegraded(entry) {
    var t = String(entry || "").trim();
    if (!t) return "";
    if (/^no pin\b/i.test(t)) return "No AI model is set up, so every step used rules.";
    var m = /^([a-z][a-z.-]*):\s*(.*)$/i.exec(t);
    var stage = m ? m[1] : "";
    var rest = m ? m[2] : t;
    var paren = rest.indexOf("(");
    var reason = paren >= 0 ? rest.slice(paren + 1).replace(/\)\s*$/, "") : "";
    var name = DEGRADED_STAGE_WORDS[stage] || (stage ? cap(stage.replace(/[._-]+/g, " ")) : "An AI step");
    var why = plainReason(reason);
    return name + " fell back to rules" + (why ? ": " + why : "") + ".";
  }

  /* The verdict's reason: rubric shortfalls and degraded notes rewritten,
     a plain message passed through. */
  function plainDisposition(qa) {
    var reason = String((qa && qa.dispositionReason) || "").trim();
    if (!reason) return "";
    var rub = /^rubric\s+(\d+)\/(\d+)\s+below\s+(\d+)/i.exec(reason);
    if (rub) return "It scored " + rub[1] + " of " + rub[2] + "; a ready draft needs " + rub[3] + ".";
    if (/^degraded:\s*/i.test(reason)) return plainDegraded(reason.replace(/^degraded:\s*/i, ""));
    reason = reason.replace(/^[a-z_]+\s+\d+\/\d+:\s*/i, "");
    return cap(reason) + (/[.!?]$/.test(reason) ? "" : ".");
  }

  /* -------------------- U-4 stage timeline -------------------- */

  /* The pipeline's stage order (materials-pipeline.mjs record() calls). */
  var STAGE_ORDER = [
    "intake", "jd.resolve", "jd.gate", "claims.load", "cache.lookup", "jd.extract",
    "claims.score", "claims.select", "outline", "draft", "support", "delint",
    "tag-metrics", "fit", "render", "qa", "publish",
  ];
  /* Each stage lands in exactly one named step. The job is read twice — a
     quick gate before the facts load, then the AI extract after — so
     "Read the job" can still be running after "Load facts" is done. */
  var TIMELINE_STEPS = [
    { id: "read", label: "Read the job", stages: ["intake", "jd.resolve", "jd.gate", "jd.extract"] },
    { id: "load", label: "Load facts", stages: ["claims.load", "cache.lookup"] },
    { id: "pick", label: "Pick facts", stages: ["claims.score", "claims.select", "outline"] },
    { id: "write", label: "Write", stages: ["draft", "delint"] },
    { id: "check", label: "Check facts", stages: ["support", "tag-metrics"] },
    { id: "render", label: "Render", stages: ["fit", "render"] },
    { id: "quality", label: "Check quality", stages: ["qa", "publish"] },
  ];
  /* K7 (MREV): prepare → write → validate/render → judge → save, plus an
     optional repair pass. A run that recorded any pre-MREV stage keeps the
     table above, so old run records keep their old labels. */
  var K7_STAGE_ORDER = ["prepare", "write", "validate", "render", "judge", "repair", "save"];
  var K7_TIMELINE_STEPS = [
    { id: "prepare", label: "Prepare", stages: ["prepare"] },
    { id: "write", label: "Write", stages: ["write"] },
    { id: "check", label: "Check & render", stages: ["validate", "render"] },
    { id: "judge", label: "Judge", stages: ["judge"] },
    { id: "repair", label: "Repair pass", stages: ["repair"] },
    { id: "save", label: "Save", stages: ["save"] },
  ];
  var MODEL_STAGES = { "jd.extract": 1, "claims.select": 1, draft: 1, write: 1 };

  /* `render` is in both tables; any other old id marks an old record. A
     run with no stages yet is a current one. */
  function isLegacyProgress(entries) {
    for (var i = 0; i < entries.length; i++) {
      var s = entries[i] && entries[i].stage;
      if (STAGE_ORDER.indexOf(s) >= 0 && K7_STAGE_ORDER.indexOf(s) < 0) return true;
    }
    return false;
  }

  function stageApplies(stage, feature, recorded) {
    /* The letter's fact check only runs when a letter is drafted. */
    if (stage === "support") return feature !== "resume";
    /* The repair pass shows only once the run made one. */
    if (stage === "repair") return !!(recorded && recorded.repair);
    return true;
  }

  function isDegraded(rec) {
    return rec.status === "review" || !!rec.degraded;
  }

  function stageReason(rec) {
    return String(rec.reason || (typeof rec.degraded === "string" ? rec.degraded : "") || rec.detail || "");
  }

  /**
   * progress: { phase, stages: [{ stage, status, reason? }] } (pending.json,
   * camelCased by the manifest). Returns one entry per named step:
   *   { id, label, state: "done" | "running" | "next" | "degraded" | "failed",
   *     reason }
   */
  function stageTimeline(progress, feature) {
    var phase = String((progress && progress.phase) || "queued").toLowerCase();
    var entries = progress && Array.isArray(progress.stages) ? progress.stages : [];
    var legacy = isLegacyProgress(entries);
    var order = legacy ? STAGE_ORDER : K7_STAGE_ORDER;
    var table = legacy ? TIMELINE_STEPS : K7_TIMELINE_STEPS;
    var recorded = {};
    var lastIdx = -1;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e.stage !== "string") continue;
      var idx = order.indexOf(e.stage);
      if (idx < 0) continue;
      recorded[e.stage] = e;
      /* A repair record can land before the pass it starts; it never
         marks the steps after it as done. */
      if (e.stage !== "repair" && idx > lastIdx) lastIdx = idx;
    }
    var nextStage = "";
    for (var j = lastIdx + 1; j < order.length; j++) {
      if (!recorded[order[j]] && stageApplies(order[j], feature, recorded)) { nextStage = order[j]; break; }
    }
    var failedRun = phase === "failed";
    var queued = phase === "queued" || (!entries.length && phase !== "drafting" && !failedRun);
    var stoppedMarked = false;
    return table.filter(function (step) {
      return step.stages.some(function (s) { return stageApplies(s, feature, recorded) || recorded[s]; });
    }).map(function (step) {
      var passed = 0;
      /* Stages that really happened (or were passed over): a step whose
         only "passed" stage does not apply to this document has not begun. */
      var touched = 0;
      var degraded = null;
      var failed = null;
      step.stages.forEach(function (s) {
        var rec = recorded[s];
        if (rec) {
          passed += 1;
          touched += 1;
          if (rec.status === "failed" && !failed) failed = rec;
          if (isDegraded(rec) && !degraded) degraded = rec;
        } else if (order.indexOf(s) < lastIdx && stageApplies(s, feature, recorded)) {
          passed += 1;
          touched += 1;
        } else if (!stageApplies(s, feature, recorded)) {
          passed += 1;
        }
      });
      var done = passed === step.stages.length;
      var holdsNext = step.stages.indexOf(nextStage) >= 0;
      var state;
      var reason = "";
      if (failed) {
        state = "failed";
        reason = stageReason(failed);
      } else if (failedRun && !done && !stoppedMarked && (holdsNext || touched > 0)) {
        state = "failed";
        stoppedMarked = true;
        reason = String((progress && progress.message) || "");
      } else if (done && degraded) {
        state = "degraded";
        reason = stageReason(degraded);
      } else if (done) {
        state = "done";
      } else if (queued || failedRun) {
        state = "next";
      } else if (holdsNext || touched > 0) {
        state = degraded ? "degraded" : "running";
        if (degraded) reason = stageReason(degraded);
      } else {
        state = "next";
      }
      var fellBack = !!(degraded && MODEL_STAGES[degraded.stage]);
      return { id: step.id, label: step.label, state: state, reason: reason, fellBack: fellBack };
    });
  }

  var STATE_WORDS = { done: "Done", running: "Running", next: "Next", failed: "Stopped" };

  function timelineReasonWords(step) {
    var raw = String(step.reason || "").replace(/^fell back to rules:?\s*/i, "");
    if (step.state === "degraded" && step.fellBack) {
      var why = plainReason(raw);
      return "Fell back to rules" + (why && why !== raw.trim() ? ": " + why : (raw ? ": " + raw : ""));
    }
    return cap(raw);
  }

  function timelineHtml(progress, feature) {
    var steps = stageTimeline(progress, feature);
    var items = steps.map(function (step) {
      var word = step.state === "degraded" ? (step.fellBack ? "Fallback" : "Review") : STATE_WORDS[step.state];
      var why = step.state === "degraded" || step.state === "failed" ? timelineReasonWords(step) : "";
      return '<li class="mat-tl__step mat-tl__step--' + step.state + '" data-step="' + esc(step.id) + '" data-state="' + esc(step.state) + '"'
        + (step.state === "running" ? ' aria-current="step"' : "") + ">"
        + '<span class="mat-tl__state">' + esc(word) + "</span>"
        + '<span class="mat-tl__label">' + esc(step.label)
        + (why ? '<span class="mat-tl__why">' + esc(why) + "</span>" : "")
        + "</span></li>";
    }).join("");
    return '<ol class="mat-tl" aria-label="Drafting steps">' + items + "</ol>";
  }

  /* -------------------- U-1 quality scorecard -------------------- */

  var RUBRIC_LABELS = {
    outcome_coverage: "Job outcomes covered",
    noun_fidelity: "Role terms",
    proof_density: "Proof with numbers",
    transfer_honesty: "Honest about tools",
    omission_record: "Nothing key left out",
    delint_clean: "Clean language",
    metric_dropped: "Numbers kept",
    underfill: "Page filled",
    company_specificity: "Names the company",
    metric_in_letter: "Numbers in the letter",
    letter_ungrounded: "Backed by your facts",
    sounds_human: "Sounds like you",
  };

  function rubricLabel(id) {
    return RUBRIC_LABELS[id] || cap(String(id || "").replace(/_/g, " "));
  }

  /* 1 for an old run's rubric record (materials.qa.v1), 2 for the judge's
     K3 record (materials.qa.v2), 0 for no verdict. The manifest may copy a
     v2 record without its contract field, so the fields decide. */
  function qaVersion(qa) {
    if (!qa || typeof qa !== "object") return 0;
    if (qa.rubric && typeof qa.rubric === "object") return 1;
    if (qa.contract === "materials.qa.v2" || (qa.quality && typeof qa.quality === "object") || Array.isArray(qa.gates)) return 2;
    return 0;
  }

  function qaOf(qualityDoc) {
    var qa = qualityDoc && qualityDoc.qa;
    return qaVersion(qa) ? qa : null;
  }

  function v2Score(qa) {
    return qa && qa.quality && typeof qa.quality.score === "number" ? qa.quality.score : null;
  }

  function dispositionOf(qualityDoc) {
    var qa = qaOf(qualityDoc);
    if (qa && qa.disposition) return String(qa.disposition).toUpperCase();
    var status = String((qualityDoc && qualityDoc.status) || "").toLowerCase();
    if (status === "fail") return "FAIL";
    if (status === "review") return "REVIEW";
    return qualityDoc ? "READY" : "";
  }

  /* The Download gate: a FAIL verdict (or a failing audit) asks first. */
  function isFail(qualityDoc) {
    return dispositionOf(qualityDoc) === "FAIL";
  }

  function pillText(qualityDoc) {
    var qa = qaOf(qualityDoc);
    var d = dispositionOf(qualityDoc);
    if (!d) return "";
    if (qaVersion(qa) === 2) {
      var score = v2Score(qa);
      return d + (score == null ? "" : " · " + score + " / 100");
    }
    return d + (qa && typeof qa.rubric.score === "number" && typeof qa.rubric.max === "number"
      ? " · " + qa.rubric.score + " / " + qa.rubric.max
      : "");
  }

  var DETAILS_CODES = /experience_missing|underfill|omission|summary_missing|statement_missing|education_missing|ledger|transfer_overclaim|invented_employer|frozen_fact|metric_dropped|proof_density|outcome_coverage/;
  var VOICE_CODES = /sounds_machine|sounds_human|banned_filler|delint|jd_echo|voice/;

  /* An old run is read-only: its run folder has no per-document draft for
     Repair to rewrite from (SPEC G3), so only a v2 verdict or none offers it. */
  function canRepair(qualityDoc) {
    return qaVersion(qualityDoc && qualityDoc.qa) !== 1;
  }

  /* The fix a verdict points at, most useful first. */
  function fixActions(qualityDoc, type) {
    var d = dispositionOf(qualityDoc);
    var qa = qaOf(qualityDoc);
    if (qaVersion(qa) === 2) {
      var issues = Array.isArray(qa.issues) ? qa.issues : [];
      var acts = [{ action: "materials-repair", feature: type, label: "Repair" }];
      if (issues.some(function (i) { return i && i.action === "needs_evidence"; })) acts.push({ action: "materials-open-profile", focus: "details", label: "Review your details" });
      if (issues.some(function (i) { return i && i.kind === "voice"; })) acts.push({ action: "materials-open-profile", focus: "voice", label: "Add a voice guide" });
      return acts;
    }
    if (d !== "FAIL" && d !== "REVIEW") return [];
    var codes = [];
    (qualityDoc && Array.isArray(qualityDoc.issues) ? qualityDoc.issues : []).forEach(function (i) {
      if (i && i.code) codes.push(String(i.code));
    });
    (qa && Array.isArray(qa.rubric.rows) ? qa.rubric.rows : []).forEach(function (r) {
      if (r && r.score < r.max) codes.push(String(r.id));
    });
    var all = codes.join(" ");
    var out = [];
    if (DETAILS_CODES.test(all)) out.push({ action: "materials-open-profile", focus: "details", label: "Review your details" });
    if (VOICE_CODES.test(all)) out.push({ action: "materials-open-profile", focus: "voice", label: "Add a voice guide" });
    if (canRepair(qualityDoc)) out.push({ action: "materials-repair", feature: type, label: "Repair" });
    return out;
  }

  function actionsHtml(list) {
    return list.map(function (a, i) {
      return '<button type="button" class="case__doc-btn ' + (i === 0 ? "case__doc-btn--primary" : "case__doc-btn--ghost") + '"'
        + ' data-action="' + esc(a.action) + '"'
        + (a.focus ? ' data-focus="' + esc(a.focus) + '"' : "")
        + (a.feature ? ' data-feature="' + esc(a.feature) + '"' : "")
        + ">" + esc(a.label) + "</button>";
    }).join("");
  }

  function pipsHtml(score, max) {
    var s = Math.max(0, Math.min(Number(score) || 0, Number(max) || 0));
    var m = Math.max(1, Math.min(Number(max) || 1, 10));
    var out = "";
    for (var i = 0; i < m; i++) out += '<i class="mat-pip' + (i < s ? " mat-pip--on" : "") + '"></i>';
    return '<span class="mat-pips" aria-hidden="true">' + out + "</span>";
  }

  function rubricHtml(qa, open) {
    var rows = Array.isArray(qa.rubric.rows) ? qa.rubric.rows : [];
    if (!rows.length) return "";
    var items = rows.map(function (r) {
      var below = r.score < r.max;
      return '<li class="mat-rubric__row' + (below ? " mat-rubric__row--below" : "") + '" data-rubric="' + esc(r.id) + '">'
        + '<span class="mat-rubric__label">' + esc(rubricLabel(r.id)) + "</span>"
        + pipsHtml(r.score, r.max)
        + '<span class="mat-rubric__n">' + esc(r.score + " / " + r.max) + "</span>"
        + (below && r.note ? '<span class="mat-rubric__note">' + esc(r.note) + "</span>" : "")
        + "</li>";
    }).join("");
    return '<details class="mat-rubric"' + (open ? " open" : "") + ">"
      + "<summary>Quality check · " + esc(qa.rubric.score + " of " + qa.rubric.max) + "</summary>"
      + '<ul class="mat-rubric__rows">' + items + "</ul></details>";
  }

  /**
   * The scorecard for one document row. qualityDoc is the manifest's
   * quality.documents[type]; returns "" when there is no verdict to show.
   */
  function scorecardHtml(qualityDoc, type) {
    var qa = qaOf(qualityDoc);
    if (!qa) return "";
    if (qaVersion(qa) === 2) return scorecardV2Html(qualityDoc, qa, type);
    var d = dispositionOf(qualityDoc);
    var tone = d === "FAIL" ? "fail" : (d === "REVIEW" ? "review" : "ready");
    var banner = "";
    if (tone !== "ready") {
      var degraded = Array.isArray(qa.degraded) ? qa.degraded.filter(Boolean) : [];
      var why = plainDisposition(qa);
      var list = degraded.length
        ? '<p class="mat-banner__sub">' + esc(degraded.length + " AI step" + (degraded.length === 1 ? "" : "s") + " fell back to rules:") + "</p>"
          + '<ul class="mat-banner__list">' + degraded.map(function (x) { return "<li>" + esc(plainDegraded(x)) + "</li>"; }).join("") + "</ul>"
        : "";
      var repaired = qa.repair && qa.repair.attempted
        ? '<p class="mat-banner__sub">We already ran one automatic repair' + (qa.repair.before
          ? " (it was " + esc(qa.repair.before.score + " / " + qa.repair.before.max) + " before)." : ".") + "</p>"
        : "";
      var actions = actionsHtml(fixActions(qualityDoc, type));
      banner = '<div class="mat-banner mat-banner--' + tone + '" role="note">'
        + '<p class="mat-banner__head">' + (tone === "fail"
          ? "This " + esc(docWords(type)) + " failed its quality check."
          : "This " + esc(docWords(type)) + " needs a look before you send it.") + "</p>"
        + (why ? '<p class="mat-banner__why">' + esc(why) + "</p>" : "")
        + list + repaired
        + (actions ? '<div class="mat-banner__acts">' + actions + "</div>" : "")
        + "</div>";
    }
    return '<div class="mat-score mat-score--' + tone + '" data-qa-disposition="' + esc(d) + '" data-qa-contract="v1">'
      + '<span class="mat-pill mat-pill--' + tone + '">' + esc(pillText(qualityDoc)) + "</span>"
      + '<p class="mat-score__old">Graded by the old checker. Draft it again for the judge\u2019s read and Repair.</p>'
      + banner
      + rubricHtml(qa, tone === "fail")
      + "</div>";
  }

  /* -------------------- D1 · the judge's scorecard (materials.qa.v2) -------------------- */

  var JUDGE_DIMENSIONS = [
    { id: "role_relevance", label: "Fits this role" },
    { id: "evidence_quality", label: "Evidence" },
    { id: "voice", label: "Sounds like you" },
    { id: "coherence", label: "Holds together" },
    { id: "economy", label: "No padding" },
  ];
  var ISSUE_KIND_WORDS = { fact: "Fact", scope: "Scope", voice: "Voice", relevance: "Relevance", clarity: "Clarity", format: "Format" };
  var ISSUE_GROUPS = [
    { id: "facts", head: "Factual blockers", sub: "Fix these before you send it: nothing in your background or the posting supports them." },
    { id: "check", head: "Facts to confirm", sub: "The judge couldn\u2019t confirm these from your background or the posting." },
    { id: "writing", head: "Writing feedback", sub: "" },
  ];

  /* Every issue as the scorecard and the Repair dialog show it, sorted into
     "facts" (hard: a sentence nothing supports, or a failed hard gate),
     "check" (a fact or scope question short of that) and "writing". An
     unsupported sentence or a failed hard gate the issue list left out
     still shows as a blocker: the verdict must never hide its reason. */
  function qaIssues(qa) {
    var sentences = Array.isArray(qa.sentences) ? qa.sentences.filter(Boolean) : [];
    var textOf = {};
    sentences.forEach(function (x) { if (x.id) textOf[x.id] = String(x.text || ""); });
    var quotes = function (ids) {
      return (Array.isArray(ids) ? ids : []).map(function (id) { return textOf[id] || ""; }).filter(Boolean);
    };
    var cited = {};
    /* A gate's issue carries the gate's reason (and its id, when the record
       has one): each failed hard gate is matched to its own issue. */
    var gateIssues = [];
    var out = [];
    (Array.isArray(qa.issues) ? qa.issues : []).forEach(function (i) {
      if (!i) return;
      (Array.isArray(i.sentenceIds) ? i.sentenceIds : []).forEach(function (id) { cited[id] = 1; });
      if (i.origin === "gate") gateIssues.push(i);
      var kind = String(i.kind || "");
      out.push({
        id: String(i.id || i.code || ""),
        kind: kind,
        group: i.severity === "hard" ? "facts" : (kind === "fact" || kind === "scope" ? "check" : "writing"),
        reason: String(i.reason || i.message || ""),
        quotes: quotes(i.sentenceIds),
      });
    });
    sentences.forEach(function (x) {
      if (cited[x.id] || (x.status !== "unsupported" && x.status !== "uncertain")) return;
      out.push({ id: "", kind: "fact", group: x.status === "unsupported" ? "facts" : "check", reason: String(x.reason || ""), quotes: quotes([x.id]) });
    });
    (Array.isArray(qa.gates) ? qa.gates : []).forEach(function (g) {
      if (!g || g.kind !== "hard" || g.pass !== false) return;
      var reason = String(g.reason || "Gate failed.");
      var covered = gateIssues.some(function (i) {
        return (i.gateId && i.gateId === g.id) || String(i.reason || "") === reason;
      });
      if (!covered) out.push({ id: "", kind: "", group: "facts", reason: String(g.reason || g.id || ""), quotes: quotes(g.sentenceIds) });
    });
    return out;
  }

  function kindWord(kind) {
    return ISSUE_KIND_WORDS[kind] || cap(String(kind || "").replace(/_/g, " "));
  }

  function issueItemHtml(it) {
    return '<li class="mat-issue mat-issue--' + (it.group === "facts" ? "hard" : "soft") + '"' + (it.id ? ' data-issue="' + esc(it.id) + '"' : "") + ">"
      + (it.kind ? '<span class="mat-issue__kind">' + esc(kindWord(it.kind)) + "</span>" : "")
      + it.quotes.map(function (q) { return '<q class="mat-issue__quote">' + esc(q) + "</q>"; }).join("")
      + (it.reason ? '<span class="mat-issue__why">' + esc(it.reason) + "</span>" : "")
      + "</li>";
  }

  function issueGroupsHtml(items) {
    return ISSUE_GROUPS.map(function (g) {
      var list = items.filter(function (it) { return it.group === g.id; });
      if (!list.length) return "";
      return '<section class="mat-issues mat-issues--' + g.id + '" data-group="' + g.id + '" aria-label="' + esc(g.head) + '">'
        + '<p class="mat-issues__head">' + esc(g.head) + " \u00b7 " + list.length + "</p>"
        + (g.sub ? '<p class="mat-issues__sub">' + esc(g.sub) + "</p>" : "")
        + '<ul class="mat-issues__list">' + list.map(issueItemHtml).join("") + "</ul></section>";
    }).join("");
  }

  /* Who graded it: an independent judge by name, the writer's own model, or
     nobody (the judge was down or its answer failed validation). */
  function judgeLine(qa) {
    var j = qa.judge && typeof qa.judge === "object" ? qa.judge : null;
    if (!j) return null;
    if (j.status && j.status !== "ok") return { kind: "unavailable", text: "Judge unavailable, so this needs your review" };
    if (j.independent === false) return { kind: "same", text: "Judged by the same model that wrote it" };
    return { kind: "independent", text: "Judged by " + (j.model || j.provider || "an independent model") };
  }

  function dimensionsHtml(qa, open) {
    var ratings = qa.quality && Array.isArray(qa.quality.ratings) ? qa.quality.ratings : [];
    var score = v2Score(qa);
    var rows = JUDGE_DIMENSIONS.map(function (dim) {
      var r = ratings.filter(function (x) { return x && x.dimension === dim.id; })[0];
      if (!r) return "";
      var n = Math.max(0, Math.min(4, Number(r.score) || 0));
      return '<li class="mat-dim' + (n < 3 ? " mat-dim--low" : "") + '" data-dimension="' + esc(dim.id) + '">'
        + '<span class="mat-dim__label">' + esc(dim.label) + "</span>"
        + pipsHtml(n, 4)
        + '<span class="mat-dim__n">' + esc(n + " / 4") + "</span>"
        + (r.reason ? '<span class="mat-dim__why">' + esc(r.reason) + "</span>" : "")
        + "</li>";
    }).join("");
    if (!rows) return "";
    return '<details class="mat-dims"' + (open ? " open" : "") + ">"
      + "<summary>Writing quality" + (score == null ? "" : " \u00b7 " + esc(score + " / 100")) + "</summary>"
      + '<ul class="mat-dims__rows">' + rows + "</ul></details>";
  }

  function gapsHtml(qa) {
    var gaps = (Array.isArray(qa.qualificationGaps) ? qa.qualificationGaps : []).map(function (g) { return String(g || "").trim(); }).filter(Boolean);
    if (!gaps.length) return "";
    return '<details class="mat-gaps" data-group="gaps">'
      + "<summary>Gaps in your background for this role \u00b7 " + gaps.length + "</summary>"
      + '<p class="mat-gaps__hint">What the posting asks for that your background doesn\u2019t show. This is information for you, not a problem with the writing.</p>'
      + '<ul class="mat-gaps__list">' + gaps.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul></details>";
  }

  function scorecardV2Html(qualityDoc, qa, type) {
    var d = dispositionOf(qualityDoc);
    var tone = d === "FAIL" ? "fail" : (d === "REVIEW" ? "review" : "ready");
    var reason = String(qa.dispositionReason || "").trim();
    var judge = judgeLine(qa);
    return '<div class="mat-score mat-score--' + tone + ' mat-score--v2" data-qa-disposition="' + esc(d) + '" data-qa-contract="v2">'
      + '<span class="mat-pill mat-pill--' + tone + '">' + esc(pillText(qualityDoc)) + "</span>"
      + '<div class="mat-verdict mat-verdict--' + tone + '">'
      + (reason ? '<p class="mat-verdict__why">' + esc(reason) + "</p>" : "")
      + (judge ? '<p class="mat-verdict__judge" data-judge="' + judge.kind + '">' + esc(judge.text) + "</p>" : "")
      + "</div>"
      + issueGroupsHtml(qaIssues(qa))
      + dimensionsHtml(qa, tone !== "ready")
      + gapsHtml(qa)
      + '<div class="mat-score__acts">' + actionsHtml(fixActions(qualityDoc, type)) + "</div>"
      + "</div>";
  }

  /* -------------------- D3 · the Repair dialog -------------------- */

  var REPAIR_MAX = 600;
  var REPAIR_PLACEHOLDER = "e.g. make it less formulaic; end on something specific to them";

  /* The issues Repair can be asked to fix: the verdict's own issues, by
     id (`code` mirrors it). A blocker the issue list left out has no id to
     send, so the instruction box covers it. */
  function repairTargets(qualityDoc) {
    var qa = qaOf(qualityDoc);
    if (qaVersion(qa) !== 2) return [];
    return qaIssues(qa).filter(function (it) { return it.id; });
  }

  /**
   * state: { instruction, checked: { [issueId]: bool } | null, error, busy }.
   * Without a choice yet, the hard issues start ticked.
   */
  function repairPanelHtml(type, qualityDoc, state) {
    var st = state || {};
    var text = String(st.instruction || "").slice(0, REPAIR_MAX);
    var id = "mat-repair-" + esc(type);
    var boxes = repairTargets(qualityDoc).map(function (t) {
      var on = st.checked && Object.prototype.hasOwnProperty.call(st.checked, t.id) ? !!st.checked[t.id] : t.group === "facts";
      return '<li class="mat-repair__issue"><label>'
        + '<input type="checkbox" data-repair-issue value="' + esc(t.id) + '"' + (on ? " checked" : "") + ">"
        + '<span class="mat-repair__issue-text">' + (t.kind ? "<b>" + esc(kindWord(t.kind)) + "</b> " : "") + esc(t.reason || t.quotes[0] || t.id) + "</span>"
        + "</label></li>";
    }).join("");
    var words = docWords(type);
    return '<form class="mat-repair" data-repair-for="' + esc(type) + '" aria-labelledby="' + id + '-t" novalidate>'
      + '<p class="mat-repair__title" id="' + id + '-t">Repair the ' + esc(words) + "</p>"
      + '<label class="mat-repair__label" for="' + id + '-i">What should change?</label>'
      + '<textarea class="mat-repair__input" id="' + id + '-i" data-repair-instruction rows="3" maxlength="' + REPAIR_MAX + '"'
      + ' placeholder="' + esc(REPAIR_PLACEHOLDER) + '">' + esc(text) + "</textarea>"
      + '<span class="mat-repair__count" data-repair-count>' + text.length + " / " + REPAIR_MAX + "</span>"
      + (boxes ? '<fieldset class="mat-repair__issues"><legend>Issues to fix</legend><ul>' + boxes + "</ul></fieldset>" : "")
      + (st.error ? '<p class="mat-repair__err" tabindex="-1" role="alert">' + esc(st.error) + "</p>" : "")
      + '<div class="mat-repair__acts">'
      + '<button type="submit" class="case__doc-btn case__doc-btn--primary"' + (st.busy ? " disabled" : "") + ">"
      + esc(st.busy ? "Sending\u2026" : "Repair the " + words) + "</button>"
      + '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-repair-cancel">Cancel</button>'
      + "</div></form>";
  }

  /* -------------------- D4 · what a repair changed -------------------- */

  /* The repair's own run in GET /runs (newest first): the one whose repair
     record names this parent, else the newest other run of the document
     that finished after the request. */
  function pickRepairRun(runs, watch) {
    var w = watch || {};
    var parent = String(w.parentRunId || "");
    var list = runsFor(runs, w.feature);
    var byParent = list.filter(function (r) {
      return r.runId !== parent && r.repair && parent && r.repair.parentRunId === parent;
    })[0];
    if (byParent) return byParent;
    var since = Date.parse(String(w.since || ""));
    return list.filter(function (r) {
      return r.runId !== parent && (!Number.isFinite(since) || Date.parse(String(r.date || "")) >= since);
    })[0] || null;
  }

  /* K4's repair record on the run; without it, a run in use was adopted. */
  function repairResultOf(run, feature) {
    var r = run && run.repair && typeof run.repair === "object" ? run.repair : {};
    return {
      parentRunId: String(r.parentRunId || ""),
      changed: typeof r.changed === "boolean" ? r.changed : null,
      adopted: typeof r.adopted === "boolean"
        ? r.adopted
        : (run && Array.isArray(run.active) ? run.active.indexOf(feature) >= 0 : null),
    };
  }

  /**
   * o: { feature, changed, adopted, diff, error }. Opens on its own when a
   * repair finishes. `changed` null reads the diff: no added or removed line
   * is no material change.
   */
  function repairOutcomeHtml(o) {
    var diff = o && o.diff && Array.isArray(o.diff.lines) ? o.diff : null;
    var moved = diff ? (Number(diff.added) || 0) + (Number(diff.removed) || 0) > 0 : null;
    var changed = typeof o.changed === "boolean" ? o.changed : moved;
    var kind;
    var head;
    var sub = "";
    if (changed === false) {
      kind = "same";
      head = "No material change: try a more specific instruction.";
      sub = "The rewrite came back saying the same thing. Name the sentence or the ending you want changed.";
    } else if (o.adopted === false) {
      kind = "kept";
      head = "Kept your previous version: the rewrite introduced a factual problem.";
      sub = "Below is what the rewrite tried. Your previous version is still the one in use.";
    } else {
      kind = "changed";
      head = "What changed in the " + docWords(o.feature);
    }
    return '<div class="mat-repaired mat-repaired--' + kind + '" role="status" tabindex="-1" data-repaired-for="' + esc(o.feature) + '" data-outcome="' + kind + '">'
      + '<p class="mat-repaired__head">' + esc(head) + "</p>"
      + (sub ? '<p class="mat-repaired__sub">' + esc(sub) + "</p>" : "")
      + (changed !== false && diff ? diffHtml(diff) : "")
      + (o.error ? '<p class="mat-repaired__sub">' + esc(o.error) + "</p>" : "")
      + '<div class="mat-repaired__acts"><button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-repair-dismiss">Close</button></div>'
      + "</div>";
  }

  /* -------------------- U-3 download menu -------------------- */

  var FILE_NAMES = {
    resume: { pdf: "resume.pdf", txt: "resume.txt", docx: "resume.docx" },
    cover_letter: { pdf: "cover-letter.pdf", txt: "cover-letter.txt", docx: "cover-letter.docx" },
  };

  /**
   * opts: { type, pdfHref, txtHref, docxHref, linkedin: bool, fail: bool }
   * Every entry keeps data-action="materials-download" (or the copy action)
   * so role-materials.js can gate it on a FAIL verdict.
   */
  function downloadMenuHtml(opts) {
    var type = opts.type;
    var names = FILE_NAMES[type] || FILE_NAMES.resume;
    var gate = opts.fail ? ' data-gate="fail"' : "";
    var items = [];
    function link(href, filename, title, sub) {
      items.push('<a class="mat-dl__item" role="menuitem" href="' + esc(href) + '" download'
        + ' data-action="materials-download" data-filename="' + esc(filename) + '"' + gate + ">"
        + '<span class="mat-dl__title">' + esc(title) + '</span><span class="mat-dl__sub">' + esc(sub) + "</span></a>");
    }
    if (opts.pdfHref) link(opts.pdfHref, names.pdf, "PDF", names.pdf);
    if (opts.txtHref) link(opts.txtHref, names.txt, "ATS plain text", names.txt);
    if (opts.docxHref) link(opts.docxHref, names.docx, "Word document", names.docx);
    if (opts.linkedin) {
      items.push('<button type="button" class="mat-dl__item" role="menuitem" data-action="materials-copy-linkedin"' + gate + ">"
        + '<span class="mat-dl__title">Copy for LinkedIn</span><span class="mat-dl__sub">About + Experience</span></button>');
    }
    if (!items.length) return "";
    return '<div class="mat-dl" data-dl="' + esc(type) + '">'
      + '<button type="button" class="case__doc-btn case__doc-btn--ghost mat-dl__toggle" data-action="materials-download-menu"'
      + ' aria-haspopup="true" aria-expanded="false">Download</button>'
      + '<div class="mat-dl__menu" role="menu" aria-label="Download the ' + esc(docWords(type)) + '" hidden>' + items.join("") + "</div>"
      + "</div>";
  }

  /* The in-page confirm a FAIL download asks before it goes (never
     window.confirm). */
  function failConfirmHtml(type, target, opts) {
    var id = "mat-confirm-" + esc(type);
    var second = opts && opts.repair === false
      ? '<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="materials-confirm-cancel">Cancel</button>'
      : '<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="materials-repair" data-feature="' + esc(type) + '">Repair first</button>';
    return '<div class="mat-confirm" role="alertdialog" aria-modal="false" aria-labelledby="' + id + '" data-confirm-for="' + esc(type) + '">'
      + '<p class="mat-confirm__q" id="' + id + '">This draft failed its quality check. Download anyway?</p>'
      + '<div class="mat-confirm__acts">'
      + '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-download-anyway"'
      + ' data-kind="' + esc(target.kind) + '"'
      + (target.href ? ' data-href="' + esc(target.href) + '"' : "")
      + (target.filename ? ' data-filename="' + esc(target.filename) + '"' : "")
      + ">Download anyway</button>"
      + second
      + "</div></div>";
  }

  /* -------------------- U-7 role-term coverage -------------------- */

  /* The rubric's noun list from jd-extract.json, de-duplicated. */
  function termsFromExtract(extract) {
    var nouns = extract && Array.isArray(extract.nouns) ? extract.nouns : [];
    var seen = {};
    var out = [];
    nouns.forEach(function (n) {
      var term = typeof n === "string" ? n : (n && n.term);
      var t = String(term || "").trim();
      var k = t.toLowerCase();
      if (!t || seen[k]) return;
      seen[k] = 1;
      out.push(t);
    });
    return out;
  }

  /* cov: scribe.keywordCoverage's { matched, missing, total }. */
  function coverageHtml(cov, type) {
    if (!cov || !cov.total) return "";
    var missing = Array.isArray(cov.missing) ? cov.missing : [];
    var line = '<span class="mat-kw__n"><b>' + esc(cov.matched.length + " / " + cov.total) + "</b> role terms</span>";
    var chips = missing.length
      ? '<details class="mat-kw__miss"><summary>' + esc(missing.length + " missing") + "</summary>"
        + '<span class="mat-kw__chips">' + missing.map(function (t) { return '<span class="mat-kw__chip">' + esc(t) + "</span>"; }).join("") + "</span></details>"
      : '<span class="mat-kw__all">covers every term the posting names</span>';
    return '<div class="mat-kw" data-coverage-for="' + esc(type) + '">' + line + chips + "</div>";
  }

  /* -------------------- U-6 version history -------------------- */

  function shortDate(iso) {
    var t = Date.parse(String(iso || ""));
    if (!Number.isFinite(t)) return "";
    var d = new Date(t);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var hh = d.getHours();
    var mm = d.getMinutes();
    return months[d.getMonth()] + " " + d.getDate() + ", " + (hh % 12 || 12) + ":" + (mm < 10 ? "0" : "") + mm + (hh < 12 ? " am" : " pm");
  }

  function runsFor(runs, type) {
    return (Array.isArray(runs) ? runs : []).filter(function (r) {
      return r && Array.isArray(r.documents) && r.documents.indexOf(type) >= 0;
    });
  }

  function historyHtml(runs, type) {
    var list = runsFor(runs, type);
    if (!list.length) return '<p class="mat-hist__empty">No earlier versions of this ' + esc(docWords(type)) + " yet.</p>";
    var rows = list.map(function (r) {
      var v = r.verdicts && r.verdicts[type];
      var d = v && v.disposition ? String(v.disposition).toUpperCase() : "";
      var tone = d === "FAIL" ? "fail" : (d === "REVIEW" ? "review" : (d ? "ready" : ""));
      var score = v && typeof v.score === "number" && typeof v.max === "number" ? v.score + " / " + v.max : "";
      var active = Array.isArray(r.active) && r.active.indexOf(type) >= 0;
      return '<li class="mat-hist__run" data-run="' + esc(r.runId) + '">'
        + '<span class="mat-hist__when">' + esc(shortDate(r.date) || r.runId) + "</span>"
        + '<span class="mat-hist__tpl">' + esc(r.template ? cap(r.template) : "") + (r.source === "regenerate" ? " · regenerated" : "") + "</span>"
        + (d ? '<span class="mat-pill mat-pill--' + tone + '">' + esc(d + (score ? " · " + score : "")) + "</span>" : "<span></span>")
        + (active
          ? '<span class="mat-hist__active">In use</span>'
          : '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-promote" data-run="' + esc(r.runId) + '" data-feature="' + esc(type) + '">Use this version</button>')
        + "</li>";
    }).join("");
    var opts = function (sel) {
      return list.map(function (r) {
        return '<option value="' + esc(r.runId) + '"' + (r.runId === sel ? " selected" : "") + ">" + esc(shortDate(r.date) || r.runId) + "</option>";
      }).join("");
    };
    var compare = list.length > 1
      ? '<div class="mat-hist__cmp">'
        + '<label><span>From</span><select data-hist-a>' + opts(list[1].runId) + "</select></label>"
        + '<label><span>To</span><select data-hist-b>' + opts(list[0].runId) + "</select></label>"
        + '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-diff" data-feature="' + esc(type) + '">Compare</button>'
        + "</div>"
      : "";
    return '<ol class="mat-hist__runs">' + rows + "</ol>" + compare + '<div class="mat-hist__diff" data-hist-diff></div>';
  }

  function diffHtml(diff) {
    if (!diff || !Array.isArray(diff.lines)) return "";
    if (!diff.added && !diff.removed) return '<p class="mat-hist__empty">These two versions say the same thing.</p>';
    var body = diff.lines.map(function (l) {
      var sign = l.op === "add" ? "+" : (l.op === "del" ? "−" : " ");
      return '<span class="mat-diff__l mat-diff__l--' + esc(l.op) + '"><span class="mat-diff__s" aria-hidden="true">' + sign + "</span>"
        + (l.op === "add" ? '<span class="mat-vh">added: </span>' : (l.op === "del" ? '<span class="mat-vh">removed: </span>' : ""))
        + esc(l.text || " ") + "</span>";
    }).join("");
    return '<p class="mat-diff__sum">' + esc(diff.added + " line" + (diff.added === 1 ? "" : "s") + " added, " + diff.removed + " removed") + "</p>"
      + '<div class="mat-diff" role="region" aria-label="Changes between the two versions" tabindex="0">' + body + "</div>";
  }

  /* -------------------- Wave 3 surfaces: outreach note + company facts -------------------- */

  /* The outreach verdict: manifest.outreach.qa.status, else its status,
     else outreach.json's own qa. "" when none is known. */
  function outreachStatus(meta, record) {
    var m = meta || {};
    var s = (m.qa && m.qa.status) || m.status || (record && record.qa && record.qa.status) || "";
    s = String(s).toLowerCase();
    return s === "pass" || s === "ready" ? "ready" : (s === "review" ? "review" : (s === "fail" ? "fail" : ""));
  }

  var OUTREACH_PILL = { ready: "ready", review: "review", fail: "fail" };

  function outreachPillHtml(meta, record) {
    var tone = outreachStatus(meta, record);
    if (!tone) return "";
    return '<span class="mat-pill mat-pill--' + tone + '">' + esc(OUTREACH_PILL[tone]) + "</span>";
  }

  /* outreach.json (materials.outreach.v1) → the LinkedIn note and the email,
     each with a Copy button. Tolerates a record missing either part. */
  function outreachHtml(record, meta) {
    if (!record || typeof record !== "object") return "";
    var li = record.linkedin && typeof record.linkedin === "object" ? record.linkedin : { text: typeof record.linkedin === "string" ? record.linkedin : "" };
    var em = record.email && typeof record.email === "object" ? record.email : null;
    var liText = String(li.text || "").trim();
    var body = em ? String(em.body || "").trim() : "";
    if (!liText && !body) return "";
    var max = Number(li.max) || 300;
    var chars = liText.length;
    var failing = record.qa && Array.isArray(record.qa.checks)
      ? record.qa.checks.filter(function (c) { return c && (c.severity === "fail" || c.severity === "review"); })
      : [];
    var parts = [];
    if (liText) {
      parts.push('<div class="mat-out__part" data-out="linkedin">'
        + '<div class="mat-out__head"><span class="mat-out__label">LinkedIn note</span>'
        + '<span class="mat-out__n' + (chars > max ? " mat-out__n--over" : "") + '">' + esc(chars + " / " + max + " characters") + "</span></div>"
        + '<p class="mat-out__text" data-copy-src>' + esc(liText) + "</p>"
        + '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-copy-text" aria-label="Copy the LinkedIn note">Copy</button>'
        + "</div>");
    }
    if (body) {
      var subject = String(em.subject || "").trim();
      var full = (subject ? "Subject: " + subject + "\n\n" : "") + body;
      var words = Number(em.words) || body.split(/\s+/).filter(Boolean).length;
      parts.push('<div class="mat-out__part" data-out="email">'
        + '<div class="mat-out__head"><span class="mat-out__label">Email</span>'
        + '<span class="mat-out__n">' + esc(words + " / " + (Number(em.max) || 120) + " words") + "</span></div>"
        + '<p class="mat-out__text" data-copy-src>' + esc(full) + "</p>"
        + '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-copy-text" aria-label="Copy the email">Copy</button>'
        + "</div>");
    }
    var who = record.contact && record.contact.name ? "To " + record.contact.name : "No contact on file, so it opens \u201cHi there\u201d";
    return '<div class="mat-out">'
      + '<p class="mat-out__who">' + esc(who) + "</p>"
      + (failing.length && outreachStatus(meta, record) !== "ready"
        ? '<ul class="mat-out__flags">' + failing.slice(0, 3).map(function (c) { return "<li>" + esc(cap(String(c.message || c.code))) + "</li>"; }).join("") + "</ul>"
        : "")
      + parts.join("")
      + "</div>";
  }

  /* intel.json (materials.intel.v1) → dated, sourced facts; mirrors the
     server's intelFacts(). manifest.intel.facts wins when it is a list. */
  function intelFactsFrom(pack, meta) {
    if (meta && Array.isArray(meta.facts)) return meta.facts.filter(function (f) { return f && f.text; }).slice(0, 8);
    if (!pack || typeof pack !== "object") return [];
    var asOf = String(pack.fetchedAt || "").slice(0, 10);
    var out = [];
    (Array.isArray(pack.news) ? pack.news : []).forEach(function (n) {
      if (n && n.url && n.date) out.push({ kind: "news", text: [n.headline, n.summary].filter(Boolean).join(": "), date: String(n.date), url: String(n.url) });
    });
    (Array.isArray(pack.products) ? pack.products : []).forEach(function (p) {
      if (p && p.url && p.name) out.push({ kind: "product", text: p.name + (p.oneLine ? ": " + p.oneLine : ""), date: asOf, url: String(p.url) });
    });
    var e = pack.earnings;
    if (e && e.url) out.push({ kind: "earnings", text: [(e.period || "") + " results", e.revenueNote, e.segmentNote].filter(Boolean).join(": "), date: String(e.period || asOf), url: String(e.url) });
    var ms = pack.missionSource;
    if (ms && ms.kind === "search" && ms.url && pack.mission) out.push({ kind: "mission", text: String(pack.mission), date: asOf, url: String(ms.url) });
    return out.filter(function (f) { return f.text && f.url; }).slice(0, 8);
  }

  function hostOf(url) {
    var m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ""));
    return m ? m[1].replace(/^www\./, "") : "";
  }

  var KIND_WORDS = { news: "News", product: "Product", earnings: "Earnings", mission: "Mission" };

  function intelHtml(facts, company, degraded) {
    if (!Array.isArray(facts) || !facts.length) return "";
    var items = facts.map(function (f) {
      var href = /^https?:\/\//i.test(String(f.url || "")) ? String(f.url) : "";
      return '<li class="mat-intel__fact">'
        + '<span class="mat-intel__meta">' + esc([KIND_WORDS[f.kind] || cap(f.kind || "fact"), f.date].filter(Boolean).join(" \u00b7 ")) + "</span>"
        + '<span class="mat-intel__text">' + esc(f.text) + "</span>"
        + (href ? '<a class="mat-intel__src" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(hostOf(href) || "source") + "</a>" : "")
        + "</li>";
    }).join("");
    return '<details class="mat-intel">'
      + "<summary>Company facts" + (company ? " about " + esc(company) : "") + " \u00b7 " + esc(String(facts.length)) + "</summary>"
      + '<p class="mat-intel__hint">What the letter may cite, each with its date and source.' + (degraded ? " Some research didn\u2019t finish, so this list may be short." : "") + "</p>"
      + '<ul class="mat-intel__facts">' + items + "</ul></details>";
  }

  root.JobBoredMaterialsInsights = {
    outreachStatus: outreachStatus,
    outreachPillHtml: outreachPillHtml,
    outreachHtml: outreachHtml,
    intelFactsFrom: intelFactsFrom,
    intelHtml: intelHtml,
    STAGE_ORDER: STAGE_ORDER,
    TIMELINE_STEPS: TIMELINE_STEPS,
    K7_STAGE_ORDER: K7_STAGE_ORDER,
    K7_TIMELINE_STEPS: K7_TIMELINE_STEPS,
    RUBRIC_LABELS: RUBRIC_LABELS,
    JUDGE_DIMENSIONS: JUDGE_DIMENSIONS,
    qaVersion: qaVersion,
    canRepair: canRepair,
    repairTargets: repairTargets,
    repairPanelHtml: repairPanelHtml,
    pickRepairRun: pickRepairRun,
    repairResultOf: repairResultOf,
    repairOutcomeHtml: repairOutcomeHtml,
    REPAIR_MAX: REPAIR_MAX,
    plainReason: plainReason,
    plainDegraded: plainDegraded,
    plainDisposition: plainDisposition,
    stageTimeline: stageTimeline,
    timelineHtml: timelineHtml,
    dispositionOf: dispositionOf,
    isFail: isFail,
    pillText: pillText,
    fixActions: fixActions,
    scorecardHtml: scorecardHtml,
    downloadMenuHtml: downloadMenuHtml,
    failConfirmHtml: failConfirmHtml,
    termsFromExtract: termsFromExtract,
    coverageHtml: coverageHtml,
    historyHtml: historyHtml,
    diffHtml: diffHtml,
  };
})(typeof window !== "undefined" ? window : this);
