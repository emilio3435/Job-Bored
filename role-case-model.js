/* ============================================================
   role-case-model.js — The Case: pure model assembly (spec §2.1, §4)
   window.JobBoredCase.model.buildCaseModel(jobKey, deps)
   window.JobBoredCase.model.collectDeps(jobKey)
   No DOM writes, no fetches. deps are injectable for tests.
   ============================================================ */
(function (root) {
  "use strict";

  var CASE_DOC_TYPES = [
    { type: "resume", label: "Tailored resume", draftAction: "resume-tailor" },
    { type: "cover_letter", label: "Cover letter", draftAction: "resume-cover" },
    { type: "manual_apply_checklist", label: "Manual-apply checklist", draftAction: "" },
    { type: "qa_report", label: "QA report", draftAction: "" },
  ];
  var DIMENSIONS = [
    ["requirementsCoverage", "Requirements"], ["experienceRelevance", "Relevance"],
    ["impactClarity", "Impact clarity"], ["atsParseability", "ATS parse"], ["toneFit", "Tone fit"],
  ];
  /* Display casing the provider id cannot supply on its own. Never a default:
     an unlisted id title-cases, an unset provider yields "". No vendor name is
     ever hardcoded as the label of record (spec D7, ground rule 9). */
  var PROVIDER_CASING = { openai: "OpenAI", openrouter: "OpenRouter", local: "Local model", webhook: "Webhook" };
  var DAY = 864e5;
  /* job-posting-insights.js stamps "schema" when the model's JSON parsed
     outright, "loose" when a key-value scrape had to recover it, "repaired"
     when truncated JSON had to be patched. Only a clean schema parse (or a
     payload from before the stamp existed) is trustworthy without a warning,
     so an unrecognized future mode falls to the review side, not to silence. */
  var CLEAN_PARSE_MODES = { "": true, schema: true };

  function T() { return root.JobBoredText; }
  function inline(s) { return T() ? T().normalizeInline(s) : String(s == null ? "" : s).trim(); }
  function items(arr) {
    var t = T();
    return (Array.isArray(arr) ? arr : []).map(function (x) { return t ? t.stripListGlyph(t.normalizeInline(t.itemText(x))) : String(x || "").trim(); }).filter(Boolean);
  }
  function dedupe(list) {
    var seen = Object.create(null), out = [];
    list.forEach(function (s) { var k = s.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(s); } });
    return out;
  }
  /* The analyzer never stores a requirement whole: it splits long items on
     `;,|`/and/or, skips anything past 8 words, and truncates labels at 72
     chars. So an exact lookup of the requirement string marks almost nothing
     and the whole THEY WANT lane reads `unknown` (P0-0). Match on containment
     in either direction after normalization, and take the strongest status
     among every term that overlaps. */
  var STATUS_RANK = { found: 3, partial: 2, missing: 1 };
  function normTerm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim(); }
  function termList(keywords) {
    if (!keywords) return [];
    if (Array.isArray(keywords.uniqueTerms)) {
      return keywords.uniqueTerms.map(function (t) {
        return { label: String((t && (t.label || t.fullLabel)) || ""), status: String((t && t.status) || "") };
      }).filter(function (t) { return t.label; });
    }
    var out = [];
    if (keywords.byLabel && typeof keywords.byLabel.forEach === "function") {
      keywords.byLabel.forEach(function (status, label) { out.push({ label: String(label || ""), status: String(status || "") }); });
    }
    return out;
  }
  function markAll(list, terms) {
    return list.map(function (text) {
      var norm = normTerm(text), best = "unknown", bestRank = 0;
      for (var i = 0; i < terms.length; i++) {
        var tn = normTerm(terms[i].label);
        if (!tn || tn.length < 3 || !norm) continue;
        if (tn !== norm && norm.indexOf(tn) === -1 && tn.indexOf(norm) === -1) continue;
        var rank = STATUS_RANK[terms[i].status] || 0;
        if (rank > bestRank) { bestRank = rank; best = terms[i].status; }
      }
      return { text: text, status: bestRank ? best : "unknown" };
    });
  }
  /* `Number(null) === 0`, so an unscored card used to render ATS 0/100 and
     five 0% bars — "not scored" made indistinguishable from "scored zero"
     (P0-0c). Nothing but a real number is a score. */
  function scoreOf(v) {
    if (v == null || (typeof v === "string" && !v.trim())) return null;
    var n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  }
  function fmtDate(ms) { return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ""; }

  /* P0-0d: raw millisecond deltas are UTC, so west of UTC every count is a day
     early — a follow-up due Sep 4 read "today" at 18:30 MDT on Sep 3. Compare
     LOCAL calendar days instead, and read a bare YYYY-MM-DD as the calendar
     date it names rather than as UTC midnight. */
  function dayIndex(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / DAY); }
  function dayIndexOf(value, deps) {
    var str = String(value == null ? "" : value).trim();
    var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (iso) return dayIndex(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    var ms = deps.parseDate(str);
    if (ms == null) return null;
    var dt = new Date(ms);
    return dayIndex(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }
  function daysFromNow(value, deps) {
    var target = dayIndexOf(value, deps);
    if (target == null) return null;
    var now = new Date(deps.nowMs);
    return target - dayIndex(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
  function warn(message, err) {
    /* Silence is what let a cleared provenance list and a vanished "You have"
       lane ship (P0-E). No console in a bare vm realm, so guard the guard. */
    try { if (typeof console !== "undefined" && console && console.warn) console.warn("[role-case-model] " + message, err); } catch (e) { /* nothing left to say */ }
  }

  function buildStage(job, stages) {
    var current = stages.toKey(job.stage) || "new";
    /* Forward stages only: closed (rejected/passed) AND archived (expired) stay off the stepper. */
    var isTerminal = function (k) { return !!(stages.isClosed(k) || (typeof stages.isArchived === "function" && stages.isArchived(k))); };
    var order = stages.pairs().map(function (p) { return p.key; }).filter(function (k) { return !isTerminal(k); });
    return { current: current, order: order, terminal: isTerminal(current), daysInStage: job.daysInStage == null ? null : job.daysInStage, appliedAt: inline(job.appliedAt) };
  }

  function buildNextAction(job, deps) {
    var followUpAt = inline(job.followUpDate);
    if (!followUpAt) return null;
    return { followUpAt: followUpAt, daysUntil: daysFromNow(followUpAt, deps), replied: job.replied || "Unknown", lastContactAt: inline(job.lastHeardFrom) };
  }
  /* The next-move sentence reads as prose, so an ISO follow-up date is spoken
     as `Sep 4`. Anything that is not a plain YYYY-MM-DD passes through as the
     user typed it — this formats, it never invents a date. */

  /* One source of truth for the four branches: recruiter-strip.js `nextAction`
     is what the kanban compact strip already says, so the Case says the same
     sentence rather than re-deriving it. The strip's "Unknown" vocabulary is
     the contract, and the date presentation stays the caller's — that is why
     nextAction takes a data bag and not a job. */
  function nextMove(people) {
    var api = root.JobBoredRecruiterStrip;
    if (!api || typeof api.nextAction !== "function") return "";
    return api.nextAction({
      contact: people.contact || "Unknown",
      reply: people.replied || "Unknown",
      followUp: people.followUpAt || "Unknown",
    });
  }

  /* Whole LOCAL days from today until the posting closes: positive ahead, 0
     today, negative once it has closed. Same rule as nextAction's daysUntil so
     the two rail dates never disagree by a day. */
  function closesInDays(closesAt, deps) {
    if (!closesAt) return null;
    return daysFromNow(closesAt, deps);
  }

  function buildMaterials(manifest) {
    if (!manifest || !Array.isArray(manifest.documents)) return null;
    var pending = manifest.pending && manifest.pending.progress ? manifest.pending : null;
    var pendingFeature = pending ? String(manifest.pending.feature || "") : "";
    return CASE_DOC_TYPES.map(function (def) {
      var doc = manifest.documents.filter(function (d) { return d && d.type === def.type; })[0] || null;
      var isPending = !!(pendingFeature && pendingFeature === def.type && !/^(complete|done|failed)$/i.test(String(pending.progress.phase || "")));
      var status = isPending ? "pending" : (doc ? (String(doc.status || "").toLowerCase() === "ready" ? "ready" : (String(doc.status || "").toLowerCase() === "failed" ? "failed" : "pending")) : "missing");
      if (pendingFeature === def.type && pending && /^failed$/i.test(String(pending.progress.phase || ""))) status = "failed";
      return {
        type: def.type, label: def.label, draftAction: def.draftAction, status: status,
        phase: isPending ? inline(pending.progress.phase) : "", elapsedSeconds: isPending ? Number(pending.progress.elapsedSeconds) || 0 : 0,
        attempt: isPending ? Number(pending.progress.attempt) || 0 : 0,
        updatedAt: doc ? inline(doc.lastModifiedAt) : "", files: doc && Array.isArray(doc.files) ? doc.files : [],
      };
    });
  }

  function buildYouHave(scorecard, keywords) {
    var r = scorecard && scorecard.result;
    if (r) {
      return {
        source: "scorecard", storedAt: scorecard.storedAt || "",
        strengths: items(r.topStrengths),
        evidence: (Array.isArray(r.evidence) ? r.evidence : []).map(function (e) { return { claim: inline(e && e.claim), sourceSnippet: inline(e && e.sourceSnippet), sourceType: inline(e && e.sourceType) }; }).filter(function (e) { return e.claim || e.sourceSnippet; }).slice(0, 3),
        gaps: (Array.isArray(r.criticalGaps) ? r.criticalGaps : []).map(function (g) { return { gap: inline(g && g.gap), whyItMatters: inline(g && g.whyItMatters), severity: /^(high|medium|low)$/.test(String(g && g.severity)) ? g.severity : "medium" }; }).filter(function (g) { return g.gap; }).slice(0, 5),
        dimensions: DIMENSIONS.map(function (d) { return { key: d[0], label: d[1], score: scoreOf(r.dimensionScores && r.dimensionScores[d[0]]) }; }).filter(function (d) { return d.score != null; }),
      };
    }
    if (keywords) {
      /* The term carries its own display casing; the map key is lowercased, so
         reading strengths off the key shipped "wcag 2.2" (P0-10). And no
         engine graded these gaps, so the fallback names no severity — a MED
         pill here is a judgement nobody made (P0-7). */
      var found = termList(keywords).filter(function (t) { return t.status === "found"; }).map(function (t) { return inline(t.label); }).filter(Boolean);
      return {
        source: "keywords", storedAt: "",
        strengths: dedupe(found).slice(0, 6),
        evidence: [],
        gaps: (keywords.missingTerms || []).map(function (t) { return { gap: inline(t && (t.label || t.fullLabel)), whyItMatters: "" }; }).filter(function (g) { return g.gap; }).slice(0, 5),
        dimensions: [],
      };
    }
    return { source: "none", storedAt: "", strengths: [], evidence: [], gaps: [], dimensions: [] };
  }

  function buildRecord(job, enr, materials, deps) {
    var ev = [];
    var found = deps.parseDate(job.foundAt);
    ev.push({ at: job.foundAt || "", ms: found, label: "Found", detail: [job.source, "discovery"].filter(Boolean).join(" · "), state: "done" });
    if (enr && Number.isFinite(enr.enrichedAt)) ev.push({ at: fmtDate(enr.enrichedAt), ms: enr.enrichedAt, label: "Enriched", detail: deps.providerLabel || "Configured provider", state: "done" });
    (materials || []).forEach(function (d) {
      if (d.status === "ready" && d.updatedAt && (d.type === "resume" || d.type === "cover_letter")) {
        ev.push({ at: d.updatedAt.slice(0, 10), ms: deps.parseDate(d.updatedAt), label: (d.type === "resume" ? "Resume" : "Cover letter") + " drafted", detail: "", state: "done" });
      }
    });
    if (job.lastHeardFrom) ev.push({ at: job.lastHeardFrom, ms: deps.parseDate(job.lastHeardFrom), label: "Contacted", detail: job.replied === "Yes" ? "They replied" : "No reply yet", state: "done" });
    if (job.followUpDate) {
      /* A date that merely passed is a MISSED follow-up, not a completed one
         (P0-8). Only an actual contact on or after the due day closes it. */
      var f = deps.parseDate(job.followUpDate);
      var dueDay = dayIndexOf(job.followUpDate, deps);
      var contactDay = job.lastHeardFrom ? dayIndexOf(job.lastHeardFrom, deps) : null;
      var kept = dueDay != null && contactDay != null && contactDay >= dueDay;
      ev.push({ at: job.followUpDate, ms: f, label: "Follow-up due", detail: "", state: kept ? "done" : "due" });
    }
    if (job.appliedAt) ev.push({ at: job.appliedAt, ms: deps.parseDate(job.appliedAt), label: "Applied", detail: "", state: "done" });
    else ev.push({ at: "", ms: null, label: "Applied", detail: "Not yet", state: "future" });
    ev.sort(function (a, b) {
      var ra = a.state === "future" ? 2 : (a.state === "due" ? 1 : 0), rb = b.state === "future" ? 2 : (b.state === "due" ? 1 : 0);
      if (ra !== rb) return ra - rb;
      return (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms);
    });
    return ev.map(function (e) { return { at: e.at, label: e.label, detail: e.detail, state: e.state }; });
  }

  /* Provenance (spec DOSSIER-01/02). dossier-field-provenance.js is the one
     classifier and structured-output-validator.js the one review verdict —
     both are consumed here, never re-derived. `inferredFields` names the
     claim fields the classifier will not call posting-grounded; `freshness`
     is the helper's own label, blank when the payload carries no fetch time
     at all so a role that was never enriched is not stamped "unknown". */
  function buildProvenance(enr, deps) {
    var api = deps.provenance || root.JobBoredDossierProvenance;
    var parseMode = String(enr.parseMode || enr._parseMode || "").trim().toLowerCase();
    var rs = enr.reviewState && enr.reviewState.status ? enr.reviewState : null;
    var reviewState = rs ? {
      status: String(rs.status),
      reason: inline(rs.reason),
      pollutedFields: (Array.isArray(rs.pollutedFields) ? rs.pollutedFields : []).map(inline).filter(Boolean),
    } : null;
    var freshness = "";
    var inferredFields = [];
    if (api) {
      try {
        var f = typeof api.freshness === "function" ? api.freshness(enr, deps.nowMs) : null;
        freshness = f && f.scrapedAt && f.label ? String(f.label) : "";
      } catch (e) { freshness = ""; warn("provenance freshness failed", e); }
      try {
        /* classify() only speaks once a payload carries schema-parse metadata.
           A pre-metadata scrape still has lineage, and resolveGrounding is the
           SAME rule set, so it fills that gap — in one direction only: this can
           add an `inferred` mark, never upgrade one to posting-grounded. */
        var grounding = typeof api.resolveGrounding === "function" && typeof api.resolveSource === "function"
          ? api.resolveGrounding(enr, api.resolveSource(enr)) : "";
        var names = Array.isArray(api.CLAIM_FIELDS) ? api.CLAIM_FIELDS : [];
        for (var i = 0; i < names.length; i++) {
          var label = typeof api.classify === "function" ? String((api.classify(enr, deps.editLock || "", names[i]) || {}).label || "") : "";
          if (label === "inferred" || (label === "unknown" && grounding === "inferred")) inferredFields.push(names[i]);
        }
      } catch (e2) {
        /* Keep what was already collected: clearing the list here upgraded a
           GUESSED title to posting-grounded, failing toward over-confidence —
           the one direction this must never move (P0-E). */
        warn("provenance classification failed; keeping the marks already found", e2);
      }
    }
    return {
      parseMode: parseMode,
      reviewState: reviewState,
      freshness: freshness,
      inferredFields: inferredFields,
      /* Two render flags, derived here so the renderer never has to know the
         parse-mode vocabulary or which claim fields carry the identity. */
      needsReview: !CLEAN_PARSE_MODES[parseMode] || !!(reviewState && reviewState.status === "needs_review"),
      inferredIdentity: inferredFields.indexOf("inferredTitle") !== -1 || inferredFields.indexOf("inferredCompany") !== -1,
    };
  }

  function buildCaseModel(jobKey, deps) {
    var job = (deps.vm && deps.vm.job) || {};
    var enr = job.enrichment || {};
    var keywords = deps.keywords || null;
    var materials = buildMaterials(deps.manifest);
    var ready = materials ? materials.filter(function (d) { return d.status === "ready"; }).length : 0;
    var drafting = materials ? materials.filter(function (d) { return d.status === "pending"; }).length : 0;
    var terms = termList(keywords);
    var requirements = markAll(dedupe(items(job.requirements).concat(items(enr.mustHaves))), terms);
    var niceToHaves = markAll(dedupe(items(enr.niceToHaves)), terms);
    var stack = markAll(dedupe(items(enr.toolsAndStack).concat(items(job.skills)).concat(items(job.tags))), terms);
    var foundAt = inline(job.foundAt || job.dateFound || "");
    var jobForRecord = { foundAt: foundAt, source: inline(job.source), lastHeardFrom: inline(job.lastHeardFrom), replied: job.replied, followUpDate: inline(job.followUpDate), appliedAt: inline(job.appliedAt) };
    var aiPoints = items(enr.talkingPoints);
    var people = { contact: inline(job.contacts && job.contacts[0] && job.contacts[0].name), lastContactAt: inline(job.lastHeardFrom), replied: job.replied || "Unknown", followUpAt: inline(job.followUpDate) };
    people.nextMove = nextMove(people);

    return {
      jobKey: String(jobKey || job.jobKey || ""),
      identity: {
        title: inline(job.role), company: inline(job.company), location: inline(job.location), employment: inline(job.employment),
        salary: inline(job.salary), source: inline(job.source), link: (job.links && job.links[0] && job.links[0].href) || "",
        logoUrl: inline(job.logoUrl), foundAt: foundAt, priority: job.priority || "", favorite: !!job.favorite,
        /* Posting facts from the scrape (A<->B contract): the dates the
           posting itself carries and the salary it advertises, which is not
           the user's sheet value and never overwrites it. */
        postedAt: inline(job.postedAt), closesAt: inline(job.closesAt), postingSalary: inline(job.postingSalary),
        closesInDays: closesInDays(inline(job.closesAt), deps),
      },
      stage: buildStage(job, deps.stages),
      nextAction: buildNextAction(job, deps),
      health: deps.health || { state: "unknown", label: "", detail: "", checkedAt: "" },
      numbers: {
        fit: Number.isFinite(Number(job.fitScore)) && job.fitScore !== null ? { value: Number(job.fitScore), max: 10 } : null,
        ats: deps.scorecard && deps.scorecard.result && scoreOf(deps.scorecard.result.overallScore) != null ? { value: scoreOf(deps.scorecard.result.overallScore) } : null,
        keywords: keywords ? { percentage: Math.round(Number(keywords.percentage) || 0), found: Number(keywords.foundCount) || 0, partial: Number(keywords.partialCount) || 0, missing: (keywords.missingTerms || []).length } : null,
        reply: { value: job.replied || "Unknown" },
        materials: materials ? { ready: ready, total: CASE_DOC_TYPES.length, drafting: drafting } : null,
      },
      oneLine: inline(enr.roleInOneLine),
      theyWant: { requirements: requirements, niceToHaves: niceToHaves, stack: stack, hasMatchData: !!keywords },
      youHave: buildYouHave(deps.scorecard, keywords),
      moves: {
        talkingPoints: aiPoints.length ? aiPoints.slice(0, 6) : items(job.talkingPoints).slice(0, 6),
        materials: materials,
        materialsError: deps.materialsError || "",
        people: people,
      },
      notes: job.notes ? { body: String(job.notes.body || ""), editedAt: String(job.notes.editedAt || "") } : null,
      record: buildRecord(jobForRecord, enr, materials, deps),
      provenance: buildProvenance(enr, deps),
      loading: { enrichment: enr.status === "loading", keywords: !keywords && !!(deps.keywordsPending), materials: !!deps.materialsPending },
      meta: { providerLabel: deps.providerLabel || "" },
    };
  }

  /* Gather deps from the live page (role.js calls this). Every source is optional. */
  function collectDeps(jobKey) {
    var app = root.JobBoredApp || {};
    var vm = root.JobBoredDawn && root.JobBoredDawn.data && root.JobBoredDawn.data.getRoleViewModel(jobKey);
    var rawJob = null;
    try { rawJob = app.core && app.core.getJobByStableKey ? app.core.getJobByStableKey(jobKey) : null; } catch (e) { rawJob = null; warn("getJobByStableKey failed", e); }
    var keywords = null;
    try { keywords = rawJob && app.keywordMatch && app.keywordMatch.analyzeJob ? app.keywordMatch.analyzeJob(rawJob) : null; } catch (e) { keywords = null; warn("analyzeJob failed", e); }
    var scorecard = null;
    try { scorecard = rawJob && app.materialsState && app.materialsState.getScorecardForJob ? app.materialsState.getScorecardForJob(rawJob) : null; } catch (e) { scorecard = null; warn("getScorecardForJob failed", e); }
    var mat = root.JobBoredRoleMaterials && root.JobBoredRoleMaterials.getCurrentManifest ? root.JobBoredRoleMaterials.getCurrentManifest() : null;
    var health = rawJob && root.JobBoredExpiredReview && root.JobBoredExpiredReview.getPostingHealth ? root.JobBoredExpiredReview.getPostingHealth(rawJob) : null;
    var cfg = null;
    try { cfg = root.CommandCenterResumeGenerate && root.CommandCenterResumeGenerate.getResumeGenerationConfig ? root.CommandCenterResumeGenerate.getResumeGenerationConfig() : null; } catch (e) { cfg = null; warn("getResumeGenerationConfig failed", e); }
    var providerId = cfg && cfg.provider ? String(cfg.provider).toLowerCase() : "";
    var stages = root.JobBoredStages;
    return {
      vm: vm || { job: {} }, job: rawJob, keywords: keywords, scorecard: scorecard,
      manifest: mat && String(mat.jobKey) === String(jobKey) ? mat.manifest : null, materialsError: "",
      health: health, stages: stages,
      providerLabel: providerId ? (PROVIDER_CASING[providerId] || providerId.charAt(0).toUpperCase() + providerId.slice(1)) : "",
      nowMs: Date.now(),
      parseDate: function (s) { var t = Date.parse(String(s || "")); return Number.isFinite(t) ? t : null; },
      keywordsPending: !keywords && !!(app.keywordMatch && app.keywordMatch.getCandidateProfileMatchCache && !app.keywordMatch.getCandidateProfileMatchCache().loaded),
      materialsPending: false,
    };
  }

  root.JobBoredCase = root.JobBoredCase || {};
  root.JobBoredCase.model = { buildCaseModel: buildCaseModel, collectDeps: collectDeps, CASE_DOC_TYPES: CASE_DOC_TYPES };
})(typeof window !== "undefined" ? window : globalThis);
