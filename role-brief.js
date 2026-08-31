/* ============================================================
   role-brief.js — JobBored v2 PART 03 · The Brief (Direction F)
   ------------------------------------------------------------
   Owner:    dossier-df/brief lane (run dossier-df-20260519T2030Z)
   Renders:  the parchment editorial Brief card mounted at
             [data-mount="brief"] inside [data-region="role"].
   Reads:    the role view-model produced by
             window.JobBoredDawn.data.getRoleViewModel(jobKey)
             and forwarded by role.js's renderDossier.
   Visual:   docs/redesign/dossier-direction-f-wireframe.html
   Events:
     EMITS    jb:role:note { jobKey, body }
              (via [data-action="notes"] blur, wired by role.js's
              wireDossier — preserved contract)
              jb:role:writeback { jobKey, field, value }
              (via masthead [data-action="edit-field"] blur/Enter,
              wired by role.js's wireDossier — field is one of
              title|company|location|salary)

   Activation: body.jb-v2 only. Off-flag: no-op.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;


  function shouldRun() {
    return !!(typeof document !== "undefined"
      && document.body
      && document.body.classList
      && document.body.classList.contains("jb-v2"));
  }

  function safeHref(href) {
    var s = String(href || "").trim();
    if (!s) return "";
    if (/^https?:|^mailto:/i.test(s)) return s;
    return "";
  }

  function pickPostingHref(job) {
    if (!job || !Array.isArray(job.links)) return "";
    for (var i = 0; i < job.links.length; i++) {
      var h = safeHref(job.links[i] && job.links[i].href);
      if (h) return h;
    }
    return "";
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }


  function countWords(s) {
    if (!s) return 0;
    var m = String(s).match(/\S+/g);
    return m ? m.length : 0;
  }

  function jdTotalWords(sections) {
    if (!Array.isArray(sections)) return 0;
    var total = 0;
    sections.forEach(function (section) {
      if (!section) return;
      total += countWords(section.body);
      if (Array.isArray(section.bullets)) {
        section.bullets.forEach(function (b) { total += countWords(b); });
      }
    });
    return total;
  }

  function _enr(job) {
    return (job && job.enrichment) || {};
  }

  function provenanceApi() {
    var w = typeof window !== "undefined" ? window : null;
    return (w && w.JobBoredDossierProvenance)
      || (typeof globalThis !== "undefined" && globalThis.JobBoredDossierProvenance)
      || null;
  }

  function structuredOutputApi() {
    var w = typeof window !== "undefined" ? window : null;
    return (w && w.JobBoredStructuredOutput)
      || (typeof globalThis !== "undefined" && globalThis.JobBoredStructuredOutput)
      || null;
  }

  function looksLikeDelimiterFallback(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return true;
    if (/^```(?:json|javascript|js|ts|xml|html|txt)?$/i.test(s)) return true;
    if (/^```/.test(s) && s.length < 24) return true;
    if (/^<\|[\w.-]+\|>/.test(s)) return true;
    if (/^<\/?[a-zA-Z][\w:-]*\s*\/?>$/.test(s)) return true;
    if (/^-{3,}$/.test(s) || /^\*{3,}$/.test(s) || /^_{3,}$/.test(s)) return true;
    if (/^(mustHaves|niceToHaves|responsibilities|toolsAndStack|talkingPoints|extraKeywords)\s*:?\s*$/i.test(s)) {
      return true;
    }
    if (/^#{1,6}\s+\S+(?:\s+\S+){0,3}$/.test(s) &&
        /must-?haves?|responsibilities|nice-?to-?haves?|tools?|stack|keywords?|output/i.test(s)) {
      return true;
    }
    return false;
  }

  function recoverJsonArrayFallback(raw) {
    var t = String(raw == null ? "" : raw).trim();
    if (!/^\s*\[/.test(t)) return null;
    try {
      var parsed = JSON.parse(t);
      if (!Array.isArray(parsed)) return null;
      return parsed.map(function (x) { return String(x == null ? "" : x).trim(); }).filter(Boolean);
    } catch (_) {
      return null;
    }
  }

  function localValidateEnrichment(enr) {
    var src = enr && typeof enr === "object" ? enr : {};
    var out = {};
    var keys = Object.keys(src);
    var i;
    for (i = 0; i < keys.length; i++) out[keys[i]] = src[keys[i]];
    var listFields = [
      "mustHaves", "responsibilities", "niceToHaves",
      "toolsAndStack", "talkingPoints", "extraKeywords",
    ];
    var pollutedFields = [];
    for (i = 0; i < listFields.length; i++) {
      var name = listFields[i];
      var arr = Array.isArray(src[name]) ? src[name] : [];
      var kept = [];
      var polluted = false;
      for (var j = 0; j < arr.length; j++) {
        var item = String(arr[j] == null ? "" : arr[j]).trim();
        var recovered = recoverJsonArrayFallback(item);
        if (recovered) {
          polluted = true;
          for (var r = 0; r < recovered.length; r++) {
            if (!looksLikeDelimiterFallback(recovered[r])) kept.push(recovered[r]);
          }
          continue;
        }
        if (looksLikeDelimiterFallback(item)) {
          polluted = true;
          continue;
        }
        kept.push(item);
      }
      out[name] = kept;
      if (polluted) pollutedFields.push(name);
    }
    if ((src.reviewState && src.reviewState.status === "needs_review") || pollutedFields.length) {
      out.reviewState = {
        status: "needs_review",
        reason: (src.reviewState && src.reviewState.reason) ||
          "Malformed model delimiters polluted structured fields.",
        pollutedFields: pollutedFields.length
          ? pollutedFields
          : ((src.reviewState && src.reviewState.pollutedFields) || []),
      };
    } else {
      out.reviewState = { status: "ok", reason: "", pollutedFields: [] };
    }
    return out;
  }

  function reviewedEnrichment(job) {
    var enr = _enr(job);
    var api = structuredOutputApi();
    if (api && typeof api.validateEnrichment === "function") {
      return api.validateEnrichment(enr);
    }
    return localValidateEnrichment(enr);
  }

  function postingGrounding(enr) {
    var prov = enr && enr.provenance;
    if (prov && prov.grounding) return String(prov.grounding);
    var source = String((enr && enr._scrapeSource) || "").trim();
    var desc = String((enr && (enr.description || enr.bodyText)) || "").trim();
    if (source === "title-and-company" || (enr && enr._scrapeBlocked)) return "inferred";
    if ((source === "cheerio" || source === "gemini-url-context") && desc.length >= 80) {
      return "posting";
    }
    return "unknown";
  }

  function ledeTagFor(enr, fromLlm, totalWords) {
    var api = provenanceApi();
    if (api && typeof api.ledeTag === "function") {
      return api.ledeTag(enr, { fromLlm: fromLlm, jdWordCount: totalWords });
    }
    if (!fromLlm) {
      var tag = "Compressed by JobBored AI";
      if (totalWords > 0) {
        tag += " · from " + totalWords + " word" + (totalWords === 1 ? "" : "s");
      }
      return tag;
    }
    var grounding = postingGrounding(enr);
    if (grounding === "posting") return "AI Summary · grounded in the posting";
    if (grounding === "inferred") return "AI Summary · inferred from title and company";
    return "AI Summary · source unverified";
  }

  function freshnessLabel(enr) {
    if (enr && enr.provenance && enr.provenance.freshness && enr.provenance.freshness.label) {
      return String(enr.provenance.freshness.label);
    }
    var api = provenanceApi();
    if (api && typeof api.freshness === "function") {
      var fresh = api.freshness(enr);
      return fresh && fresh.label ? String(fresh.label) : "";
    }
    return "";
  }

  var MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  function _parseMode(job) {
    var enr = _enr(job);
    return String(enr.parseMode || enr._parseMode || "").trim().toLowerCase();
  }

  function _isRecovered(job) {
    var mode = _parseMode(job);
    return mode === "loose" || mode === "repaired";
  }

  function _classifyProvenance(job, field) {
    var api = provenanceApi();
    var classify = api && api.classify;
    if (typeof classify === "function") {
      try {
        var result = classify(_enr(job), job && (job.editLock || job._editLock), field);
        if (result && result.label) return result;
      } catch (e) { /* unknown is the safe rendering fallback */ }
    }
    return { label: "unknown", source: "unknown", fetchedAt: null };
  }

  function _sourceLabel(source) {
    var value = String(source == null ? "" : source).trim();
    var known = {
      "cheerio": "Cheerio",
      "gemini-url-context": "Gemini URL Context",
      "title-and-company": "title + company",
      "edit-lock": "edit lock",
      "unknown": "unknown",
    };
    return known[value.toLowerCase()] || value || "unknown";
  }

  /* Sheet-persisted fetch time. This is the ONLY age surface: there is no
     separate 30-day display flag — "stale" keeps its single meaning, the
     3-day enrichment cache TTL stamped into provenance.freshness. */
  function _formatFetchedAt(value) {
    if (!value) return "";
    var date = new Date(value);
    var time = date.getTime();
    if (!Number.isFinite(time)) return "";
    var absolute = MONTH_NAMES[date.getUTCMonth()] + " " + date.getUTCDate() +
      ", " + date.getUTCFullYear();
    var ageMs = Math.max(0, Date.now() - time);
    var days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    var relative = days === 0
      ? "today"
      : days < 30
        ? days + " day" + (days === 1 ? "" : "s") + " ago"
        : days < 365
          ? Math.floor(days / 30) + " month" + (Math.floor(days / 30) === 1 ? "" : "s") + " ago"
          : Math.floor(days / 365) + " year" + (Math.floor(days / 365) === 1 ? "" : "s") + " ago";
    return "Fetched " + absolute + " · " + relative;
  }

  function _isStale(job) {
    var fresh = _enr(job).provenance && _enr(job).provenance.freshness;
    return !!(fresh && fresh.stale);
  }

  function _provenanceClass(label) {
    var known = ["posting-grounded", "user-provided", "inferred", "unknown"];
    return known.indexOf(label) === -1 ? "unknown" : label;
  }

  /* One per-field evidence line. Model- and scrape-controlled strings
     (source, fallbackReason) are escaped as a single joined payload. */
  function _renderProvenance(job, field, opts) {
    var options = opts || {};
    var result = _classifyProvenance(job, field);
    var recovered = _isRecovered(job);
    var stale = _isStale(job);
    var parts = [];
    if (options.prefix) parts.push(options.prefix);
    if (recovered) parts.push("Recovered — review");
    parts.push(result.label);
    parts.push("source " + _sourceLabel(result.source));
    var fetched = _formatFetchedAt(result.fetchedAt);
    if (fetched && options.includeFetched !== false) parts.push(fetched);
    if (stale) parts.push("stale");
    if (options.detail) parts.push(options.detail);
    var enr = _enr(job);
    var fallbackReason = enr.fallbackReason || enr._scrapeFallbackReason || "";
    if (fallbackReason && options.includeFallback !== false) {
      parts.push("reason " + String(fallbackReason));
    }
    var className = options.className || "brief__provenance";
    className += " brief__provenance--" + _provenanceClass(result.label);
    if (recovered) className += " brief__provenance--recovered";
    if (stale) className += " brief__provenance--stale";
    return '<div class="' + className + '">' + escapeHtml(parts.join(" · ")) + '</div>';
  }

  function renderIdentityProvenance(job) {
    var fields = [
      ["Title", "title"],
      ["Company", "company"],
      ["Location", "location"],
      ["Salary", "salary"],
    ];
    var chips = fields.map(function (entry) {
      var result = _classifyProvenance(job, entry[1]);
      var text = entry[0] + " · " + result.label + " · source " + _sourceLabel(result.source);
      return '<span class="brief__identity-provenance-chip brief__provenance--' +
        _provenanceClass(result.label) + '">' + escapeHtml(text) + '</span>';
    }).join("");
    return '<div class="brief__identity-provenance" aria-label="Dossier evidence">' +
      '<span class="brief__identity-provenance-label">Evidence</span>' + chips + '</div>';
  }

  function isEnrichmentLoading(job) {
    var enr = _enr(job);
    return enr.status === "loading";
  }

  /* Hook — prefer the AI's single-sentence framing of the role over any
     marketing tagline or raw JD snippet. Falls back gracefully when the
     enrichment hasn't landed yet. */
  function pickHook(job) {
    var enr = _enr(job);
    if (enr.roleInOneLine) return String(enr.roleInOneLine).trim();
    if (job.companyTagline) return String(job.companyTagline).trim();
    if (Array.isArray(job.jdSections) && job.jdSections.length) {
      var first = job.jdSections[0];
      if (first) {
        if (first.body) return String(first.body).trim();
        if (Array.isArray(first.bullets) && first.bullets[0]) return String(first.bullets[0]).trim();
      }
    }
    if (job.jdSnippet) return String(job.jdSnippet).trim();
    return "";
  }

  /* Lede — the long-form drop-cap paragraph. Prefer the LLM
     postingSummary (drawer-parity), then the first JD body. */
  function pickLede(job, hookText) {
    var enr = _enr(job);
    if (enr.postingSummary) {
      var s = String(enr.postingSummary).trim();
      if (s && s !== hookText) return s;
    }
    if (!Array.isArray(job.jdSections) || !job.jdSections.length) return "";
    var first = job.jdSections[0];
    if (!first || !first.body) return "";
    var body = String(first.body).trim();
    if (!body || body === hookText) return "";
    return body;
  }

  /* -------------------- masthead -------------------- */

  /* The Dossier hero. The role title is the dominant heading; company,
     location, comp, and source sit directly beneath it. Title, company,
     location, and salary are inline-editable borderless <input>s
     (data-action="edit-field"); role.js's wireDossier wires blur/Enter
     to commit and Escape to cancel, dispatching jb:role:writeback. The
     action cluster (View posting · Draft cover letter · Tailor resume)
     lives to the right on wide screens and stacks beneath the facts on
     narrow screens. These are the only entry points into the Workshop;
     they are intentionally NOT duplicated in the Workshop hero. */
  function renderMasthead(job) {
    var eyebrowParts = [];
    if (job.employment) eyebrowParts.push(String(job.employment).trim());
    var eyebrowText = eyebrowParts.filter(Boolean).join(" · ");
    var eyebrow = eyebrowText
      ? '<div class="brief__eyebrow">' + escapeHtml(eyebrowText) + '</div>'
      : "";

    // Title / company / location / salary are inline-editable. They render as
    // borderless <input>s that read like static text until hover/focus; role.js
    // wireDossier owns the blur/Enter/Escape wiring (this file sets innerHTML
    // only). data-original carries the seeded value so Escape can restore and
    // commit can no-op on an unchanged value.
    var editInputGuards = ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

    var titleVal = job.role ? String(job.role) : "";
    var title = '<input type="text" class="brief__title" data-action="edit-field"' +
      ' data-field="title" data-original="' + escapeHtml(titleVal) + '"' +
      ' value="' + escapeHtml(titleVal) + '" aria-label="Role title"' + editInputGuards + '>';

    var companyVal = job.company ? String(job.company) : "";
    var company = '<input type="text" class="brief__company" data-action="edit-field"' +
      ' data-field="company" data-original="' + escapeHtml(companyVal) + '"' +
      ' value="' + escapeHtml(companyVal) + '" aria-label="Company"' + editInputGuards + '>';

    var locationVal = job.location ? String(job.location) : "";
    var salaryVal = job.salary ? String(job.salary) : "";
    var factSpans = [];
    factSpans.push('<input type="text" class="brief__fact-input" data-action="edit-field"' +
      ' data-field="location" data-original="' + escapeHtml(locationVal) + '"' +
      ' value="' + escapeHtml(locationVal) + '" aria-label="Location" placeholder="Location"' + editInputGuards + '>');
    factSpans.push('<input type="text" class="brief__fact-input" data-action="edit-field"' +
      ' data-field="salary" data-original="' + escapeHtml(salaryVal) + '"' +
      ' value="' + escapeHtml(salaryVal) + '" aria-label="Salary" placeholder="Salary"' + editInputGuards + '>');
    if (job.source)   factSpans.push('<span>via ' + escapeHtml(job.source) + '</span>');
    var factsInner = "";
    for (var i = 0; i < factSpans.length; i++) {
      if (i > 0) factsInner += '<span class="dot">·</span>';
      factsInner += factSpans[i];
    }
    var facts = factSpans.length
      ? '<div class="brief__facts">' + factsInner + '</div>'
      : "";

    var postingHref = pickPostingHref(job);
    var viewLink = postingHref
      ? '<a href="' + escapeHtml(postingHref) + '" target="_blank" rel="noopener"' +
          ' class="brief__cta brief__cta--view" data-action="brief-view-posting"' +
          ' aria-label="Open the original job posting in a new tab">' +
          '<svg class="brief__cta-icon" width="14" height="14" viewBox="0 0 24 24"' +
          ' fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M7 17 17 7"/>' +
            '<path d="M9 7h8v8"/>' +
          '</svg>' +
          '<span>View posting</span>' +
        '</a>'
      : "";

    var coverBtn =
      '<button type="button" class="brief__cta brief__cta--cover"' +
        ' data-action="resume-cover"' +
        ' aria-label="Draft a cover letter for this role">' +
        '<svg class="brief__cta-icon" width="14" height="14" viewBox="0 0 24 24"' +
        ' fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M4 6h16v12H4z"/>' +
          '<path d="M4 7l8 6 8-6"/>' +
        '</svg>' +
        '<span>Draft cover letter</span>' +
      '</button>';

    var tailorBtn =
      '<button type="button" class="brief__cta brief__cta--tailor"' +
        ' data-action="resume-tailor"' +
        ' aria-label="Tailor your resume for this role">' +
        '<svg class="brief__cta-icon" width="14" height="14" viewBox="0 0 24 24"' +
        ' fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M12 20h9"/>' +
          '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>' +
        '</svg>' +
        '<span>Tailor resume</span>' +
      '</button>';

    var ctaCluster = '<div class="brief__cta-cluster" role="group" aria-label="Dossier actions">' +
      viewLink + coverBtn + tailorBtn +
    '</div>';

    if (!eyebrow && !title && !company && !facts) return "";

    return '<header class="brief__masthead">' +
      '<div class="brief__masthead-text">' + eyebrow + title + company + facts +
        renderIdentityProvenance(job) + '</div>' +
      ctaCluster +
    '</header>';
  }

  /* -------------------- left column -------------------- */

  function renderHook(job, hookText) {
    if (!hookText) return "";
    var enr = _enr(job);
    var field = enr.roleInOneLine && String(enr.roleInOneLine).trim() === hookText
      ? "roleInOneLine"
      : job.companyTagline && String(job.companyTagline).trim() === hookText
        ? "companyTagline"
        : "jdSnippet";
    return '<div class="brief__hook-block">' +
      '<p class="brief__hook">' + escapeHtml(hookText) + '</p>' +
      _renderProvenance(job, field, { prefix: "Role framing" }) +
    '</div>';
  }

  function renderLede(job, hookText) {
    var lede = pickLede(job, hookText);
    if (!lede) return "";
    var enr = _enr(job);
    var fromLlm = !!(enr && enr.postingSummary
      && String(enr.postingSummary).trim() === lede);
    var totalWords = jdTotalWords(job.jdSections);
    var tag = ledeTagFor(enr, fromLlm, totalWords);
    var grounding = fromLlm ? postingGrounding(enr) : "compressed";
    var fresh = freshnessLabel(enr);
    var freshHtml = fresh
      ? ' <span class="brief__freshness">' + escapeHtml(fresh) + '</span>'
      : "";
    return '<div class="brief__lede-block">' +
      '<p class="brief__lede">' + escapeHtml(lede) + '</p>' +
      '<div class="brief__lede-tag" data-grounding="' + escapeHtml(grounding) + '">' +
        escapeHtml(tag) + freshHtml +
      '</div>' +
      _renderProvenance(job, fromLlm ? "postingSummary" : "jdSnippet", {
        detail: !fromLlm && totalWords > 0
          ? "from " + totalWords + " word" + (totalWords === 1 ? "" : "s")
          : "",
      }) +
    '</div>';
  }

  function renderReviewState(enr) {
    var state = enr && enr.reviewState;
    if (!state || state.status !== "needs_review") return "";
    var reason = String(state.reason ||
      "Structured AI output contained malformed delimiters. Treat remaining claims as unverified until you read the posting.");
    return '<section class="brief__review" data-review-status="needs_review" role="status">' +
      '<h3 class="section-label">Needs review</h3>' +
      '<p class="brief__review-body">' + escapeHtml(reason) + '</p>' +
    '</section>';
  }

  /* Fit angle — the LLM's "why this role fits the candidate" line.
     Lives in the main column, just under the lede. Falls back to
     fitAssessment if the LLM hasn't generated a fitAngle yet. */
  function renderFitAngle(job) {
    var enr = _enr(job);
    var text = "";
    if (enr.fitAngle) text = String(enr.fitAngle).trim();
    else if (enr.fitAssessment) text = String(enr.fitAssessment).trim();
    if (!text) return "";
    return '<section class="brief__fit">' +
      '<h3 class="section-label">Why this role fits</h3>' +
      _renderProvenance(job, enr.fitAngle ? "fitAngle" : "fitAssessment") +
      '<p class="brief__fit-body">' + escapeHtml(text) + '</p>' +
    '</section>';
  }

  /* Structured AI lists — must-haves, responsibilities, nice-to-haves,
     tools & stack. Each is opt-in: empty arrays render nothing. */
  function _structSection(job, label, items, cls, field) {
    var arr = Array.isArray(items)
      ? items.map(function (x) { return String(x || "").trim(); }).filter(Boolean)
      : [];
    if (!arr.length) return "";
    var limited = arr.slice(0, 12);
    var bullets = limited.map(function (b) {
      var s = b.length > 300 ? b.slice(0, 297) + "…" : b;
      return '<li>' + escapeHtml(s) + '</li>';
    }).join("");
    var recoveredClass = _isRecovered(job) ? ' brief__struct--recovered' : '';
    return '<section class="brief__struct brief__struct--' + cls + recoveredClass + '">' +
      '<h3 class="section-label">' + escapeHtml(label) + '</h3>' +
      _renderProvenance(job, field) +
      '<ul>' + bullets + '</ul>' +
    '</section>';
  }

  function renderEnrichedSections(job) {
    var enr = _enr(job);
    return [
      _structSection(job, "Must-haves",       enr.mustHaves,       "must",  "mustHaves"),
      _structSection(job, "Responsibilities", enr.responsibilities,"resp",  "responsibilities"),
      _structSection(job, "Nice-to-haves",    enr.niceToHaves,     "nice",  "niceToHaves"),
      _structSection(job, "Tools & stack",    enr.toolsAndStack,   "tools", "toolsAndStack"),
    ].join("");
  }

  /* Loading skeleton — rendered while Gemini is producing insights
     for this role. It replaces the brief body while the call is in
     flight so stale fit, notes, and at-a-glance content cannot appear
     beside an in-progress enrichment. */
  function renderEnrichmentLoading(job) {
    var enr = _enr(job);
    if (enr.status !== "loading") return "";
    /* Status lines are static in markup, but the
       CSS animates between them with steps() + animation-delay so the
       text reads as if it were progressing live ("Reading the
       posting…" → "Identifying must-haves and tools…" → "Weighing
       this role against your profile…" → "Drafting talking points…").
       The whole thing is replaced atomically when jb:role:enriched
       fires, so we don't need JS intervals to manage the cycling. */
    return '<section class="brief__skeleton" aria-live="polite" aria-busy="true">' +
      '<div class="brief__skeleton-head">' +
        '<span class="brief__skeleton-badge">' +
          '<svg class="brief__skeleton-badge-icon" width="11" height="11" viewBox="0 0 24 24"' +
            ' fill="none" aria-hidden="true">' +
            '<path d="M12 2 L13.8 9.2 L21 11 L13.8 12.8 L12 20 L10.2 12.8 L3 11 L10.2 9.2 Z"' +
            ' fill="currentColor"/>' +
          '</svg>' +
          '<span>AI &middot; Gemini</span>' +
        '</span>' +
        '<div class="brief__skeleton-status" role="status">' +
          '<span class="brief__skeleton-status-line">Reading the posting&hellip;</span>' +
          '<span class="brief__skeleton-status-line">Identifying must-haves and tools&hellip;</span>' +
          '<span class="brief__skeleton-status-line">Weighing this role against your profile&hellip;</span>' +
          '<span class="brief__skeleton-status-line">Drafting your fit angle and talking points&hellip;</span>' +
        '</div>' +
      '</div>' +
      '<div class="brief__skeleton-hook">' +
        '<span class="brief__shimmer brief__shimmer--hook"></span>' +
      '</div>' +
      '<div class="brief__skeleton-lede">' +
        '<span class="brief__shimmer brief__shimmer--lede-1"></span>' +
        '<span class="brief__shimmer brief__shimmer--lede-2"></span>' +
        '<span class="brief__shimmer brief__shimmer--lede-3"></span>' +
        '<span class="brief__shimmer brief__shimmer--lede-4"></span>' +
      '</div>' +
      '<div class="brief__skeleton-fit">' +
        '<span class="brief__skeleton-label">WHY THIS ROLE FITS</span>' +
        '<span class="brief__shimmer brief__shimmer--fit-1"></span>' +
        '<span class="brief__shimmer brief__shimmer--fit-2"></span>' +
      '</div>' +
      '<div class="brief__skeleton-lists">' +
        '<div class="brief__skeleton-list">' +
          '<span class="brief__skeleton-label">MUST-HAVES</span>' +
          '<span class="brief__shimmer brief__shimmer--row"></span>' +
          '<span class="brief__shimmer brief__shimmer--row"></span>' +
          '<span class="brief__shimmer brief__shimmer--row brief__shimmer--row-short"></span>' +
        '</div>' +
        '<div class="brief__skeleton-list">' +
          '<span class="brief__skeleton-label">RESPONSIBILITIES</span>' +
          '<span class="brief__shimmer brief__shimmer--row"></span>' +
          '<span class="brief__shimmer brief__shimmer--row brief__shimmer--row-short"></span>' +
          '<span class="brief__shimmer brief__shimmer--row"></span>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  /* -------------------- right column -------------------- */

  function renderSkim(job) {
    var rows = [];
    var enr = _enr(job);
    var ats = Number(enr.atsFitScore);
    if (Number.isFinite(ats)) {
      rows.push({
        key: "ATS Fit",
        val: Math.max(0, Math.min(100, Math.round(ats))),
        score: true,
        field: "atsFitScore",
        rationale: String(enr.atsFitRationale || "").trim(),
      });
    }
    var signals = Array.isArray(enr.extraKeywords)
      ? enr.extraKeywords.map(function (t) { return String(t || "").trim(); }).filter(Boolean)
      : [];
    if (signals.length) {
      rows.push({ key: "Signals", val: signals.slice(0, 3).join(" · "), field: "extraKeywords" });
    }
    if (job.salary)   rows.push({ key: "Comp", val: String(job.salary), field: "salary" });
    if (job.location) rows.push({ key: "Location", val: String(job.location), field: "location" });
    if (!rows.length) return "";
    var inner = rows.map(function (r) {
      if (r.score) {
        var title = r.rationale ? ' title="' + escapeHtml(r.rationale) + '"' : "";
        return '<li>' +
          '<span class="key">' + escapeHtml(r.key) + '</span>' +
          '<span class="val val--score"' + title + '>' + escapeHtml(String(r.val)) +
            '<sup style="font-size:0.55em;color:var(--mute);font-family:var(--mono);">/100</sup>' +
          '</span>' + _renderProvenance(job, r.field, {
            includeFetched: false,
            includeFallback: false,
            className: "skim__provenance brief__provenance",
          }) +
        '</li>';
      }
      return '<li>' +
        '<span class="key">' + escapeHtml(r.key) + '</span>' +
        '<span class="val">' + escapeHtml(String(r.val)) + '</span>' +
        _renderProvenance(job, r.field, {
          includeFetched: false,
          includeFallback: false,
          className: "skim__provenance brief__provenance",
        }) +
      '</li>';
    }).join("");
    return '<ul class="skim">' + inner + '</ul>';
  }

  function renderTalkingPoints(job) {
    var enr = _enr(job);
    /* Prefer the LLM-generated talking points; they're tuned for the
       candidate's profile. Fall back to JD bullets when absent. */
    var bullets = [];
    if (Array.isArray(enr.talkingPoints) && enr.talkingPoints.length) {
      bullets = enr.talkingPoints
        .map(function (b) { return String(b || "").trim(); })
        .filter(Boolean);
    } else if (Array.isArray(job.jdSections) && job.jdSections.length) {
      var first = job.jdSections[0];
      bullets = first && Array.isArray(first.bullets)
        ? first.bullets.filter(Boolean)
        : [];
    }
    if (!bullets.length) return "";
    var items = bullets.slice(0, 6).map(function (b) {
      return '<li>' + escapeHtml(b) + '</li>';
    }).join("");
    return '<section class="points">' +
      '<h3 class="section-label">Talking points</h3>' +
      _renderProvenance(job, Array.isArray(enr.talkingPoints) && enr.talkingPoints.length
        ? "talkingPoints"
        : "jdSnippet") +
      '<ul>' + items + '</ul>' +
    '</section>';
  }

  /* Tags & skills — a dedicated card in the side column when the role
     has more than three tags, so the user can scan the vocabulary the
     LLM and the JD share. */
  function renderTagsAndSkills(job) {
    var tags = Array.isArray(job.tags)
      ? job.tags.map(function (t) { return String(t || "").trim(); }).filter(Boolean)
      : [];
    if (tags.length <= 3) return "";
    var chips = tags.slice(0, 18).map(function (t) {
      return '<span class="brief__skill-chip">' + escapeHtml(t) + '</span>';
    }).join("");
    return '<section class="brief__tags">' +
      '<h3 class="section-label">Tags &amp; skills</h3>' +
      '<div class="brief__tag-cloud">' + chips + '</div>' +
    '</section>';
  }

  function renderNotes(job) {
    var body = (job.notes && job.notes.body) ? String(job.notes.body) : "";
    return '<div class="brief-notes">' +
      '<h3 class="section-label">Notes</h3>' +
      '<textarea data-action="notes" placeholder="Interview prep, recruiter name, links you\u2019ve gathered, next steps\u2026">' +
        escapeHtml(body) +
      '</textarea>' +
    '</div>';
  }

  /* -------------------- public render -------------------- */

  function renderBrief(briefRoot, vm) {
    if (!briefRoot) return;
    if (!shouldRun()) return;
    var job = (vm && vm.job) || {};

    var reviewed = reviewedEnrichment(job);
    var viewJob = Object.assign({}, job, { enrichment: reviewed });

    var hookText = pickHook(viewJob);
    var mastheadHtml = renderMasthead(viewJob);
    var loadingHtml = renderEnrichmentLoading(viewJob);

    if (isEnrichmentLoading(viewJob)) {
      briefRoot.innerHTML = mastheadHtml + loadingHtml;
      return;
    }

    var hookHtml = renderHook(viewJob, hookText);
    var ledeHtml = renderLede(viewJob, hookText);
    var reviewHtml = renderReviewState(reviewed);
    var fitHtml = renderFitAngle(viewJob);
    var enrichedSectionsHtml = renderEnrichedSections(viewJob);
    var skimHtml = renderSkim(viewJob);
    var tagsHtml = renderTagsAndSkills(viewJob);
    var pointsHtml = renderTalkingPoints(viewJob);
    var notesHtml = renderNotes(viewJob);

    // Full-width editorial "lead" band — hook + AI lede span the whole
    // brief so the reader meets the role's framing before the two-column
    // spread (left = role detail, right = at-a-glance / talking points).
    var leadHtml = (hookHtml || ledeHtml)
      ? '<div class="brief__lead">' + hookHtml + ledeHtml + '</div>'
      : "";

    briefRoot.innerHTML = mastheadHtml +
      loadingHtml +
      leadHtml +
      reviewHtml +
      '<div class="brief__body">' +
        '<div class="brief__col brief__col--main">' +
          fitHtml + enrichedSectionsHtml +
        '</div>' +
        '<div class="brief__col brief__col--side">' +
          skimHtml + tagsHtml + '<div data-mount="recruiter-strip"></div>' +
          pointsHtml + notesHtml +
        '</div>' +
      '</div>';

    /* The strip innerHTML-overwrites whatever element it is handed, so it
       gets its own [data-mount] div — never a shared container. */
    if (root.JobBoredRecruiterStrip &&
        typeof root.JobBoredRecruiterStrip.render === "function") {
      root.JobBoredRecruiterStrip.render(
        briefRoot.querySelector('[data-mount="recruiter-strip"]'),
        vm,
      );
    }
  }

  /* -------------------- expose -------------------- */

  root.JobBoredDossierBrief = root.JobBoredDossierBrief || {};
  root.JobBoredDossierBrief.renderBrief = renderBrief;

  // Re-render on script load if a role is already open.
  // role.js loads (with defer) before this file and may have called
  // renderDossier synchronously without our renderer registered yet.
  try {
    var flowing = root.JobBoredFlowing;
    var roleApi = flowing && flowing.role;
    var openRole = flowing && flowing.openRole;
    if (roleApi && typeof roleApi.renderForKey === "function"
      && openRole && typeof openRole.get === "function") {
      var key = openRole.get();
      if (key) roleApi.renderForKey(key);
    }
  } catch (e) { /* */ }
})(typeof window !== "undefined" ? window : this);
