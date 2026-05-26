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

   Activation: body.jb-v2 only. Off-flag: no-op.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var STAGE_LABELS = {
    "researching":  "Researching",
    "applied":      "Applied",
    "phone-screen": "Phone screen",
    "interviewing": "Interviewing",
    "offer":        "Offer",
  };

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

  function toRoman(n) {
    if (!Number.isFinite(n) || n < 1) return "";
    var ones = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"];
    var tens = ["", "x", "xx", "xxx"];
    var hundreds = Math.floor(n / 100);
    if (hundreds > 0) return String(n);
    return tens[Math.floor(n / 10) % 4] + ones[n % 10];
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

  /* The Dossier hero. The role title is the dominant H1; company,
     location, comp, and source sit directly beneath it. The action
     cluster (View posting · Draft cover letter · Tailor resume) lives
     to the right on wide screens and stacks beneath the facts on
     narrow screens. These are the only entry points into the Workshop;
     they are intentionally NOT duplicated in the Workshop hero. */
  function renderMasthead(job) {
    var eyebrowParts = [];
    if (job.employment) eyebrowParts.push(String(job.employment).trim());
    var eyebrowText = eyebrowParts.filter(Boolean).join(" · ");
    var eyebrow = eyebrowText
      ? '<div class="brief__eyebrow">' + escapeHtml(eyebrowText) + '</div>'
      : "";

    var title = job.role
      ? '<h1 class="brief__title">' + escapeHtml(job.role) + '</h1>'
      : "";

    var company = job.company
      ? '<p class="brief__company">' + escapeHtml(job.company) + '</p>'
      : "";

    var factSpans = [];
    if (job.location) factSpans.push('<span>' + escapeHtml(job.location) + '</span>');
    if (job.salary)   factSpans.push('<span>' + escapeHtml(job.salary) + '</span>');
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
      '<div class="brief__masthead-text">' + eyebrow + title + company + facts + '</div>' +
      ctaCluster +
    '</header>';
  }

  /* -------------------- left column -------------------- */

  function renderHook(hookText) {
    if (!hookText) return "";
    return '<p class="brief__hook">' + escapeHtml(hookText) + '</p>';
  }

  function renderLede(job, hookText) {
    var lede = pickLede(job, hookText);
    if (!lede) return "";
    var enr = _enr(job);
    var fromLlm = !!(enr && enr.postingSummary
      && String(enr.postingSummary).trim() === lede);
    var totalWords = jdTotalWords(job.jdSections);
    var tag;
    if (fromLlm) {
      tag = "AI Summary · grounded in the posting";
    } else {
      tag = "Compressed by JobBored AI";
      if (totalWords > 0) {
        tag += " · from " + totalWords + " word" + (totalWords === 1 ? "" : "s");
      }
    }
    return '<div class="brief__lede-block">' +
      '<p class="brief__lede">' + escapeHtml(lede) + '</p>' +
      '<div class="brief__lede-tag">' + escapeHtml(tag) + '</div>' +
    '</div>';
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
      '<p class="brief__fit-body">' + escapeHtml(text) + '</p>' +
    '</section>';
  }

  /* Structured AI lists — must-haves, responsibilities, nice-to-haves,
     tools & stack. Each is opt-in: empty arrays render nothing. */
  function _structSection(label, items, cls) {
    var arr = Array.isArray(items)
      ? items.map(function (x) { return String(x || "").trim(); }).filter(Boolean)
      : [];
    if (!arr.length) return "";
    var limited = arr.slice(0, 12);
    var bullets = limited.map(function (b) {
      var s = b.length > 300 ? b.slice(0, 297) + "…" : b;
      return '<li>' + escapeHtml(s) + '</li>';
    }).join("");
    return '<section class="brief__struct brief__struct--' + cls + '">' +
      '<h3 class="section-label">' + escapeHtml(label) + '</h3>' +
      '<ul>' + bullets + '</ul>' +
    '</section>';
  }

  function renderEnrichedSections(job) {
    var enr = _enr(job);
    return [
      _structSection("Must-haves",       enr.mustHaves,       "must"),
      _structSection("Responsibilities", enr.responsibilities,"resp"),
      _structSection("Nice-to-haves",    enr.niceToHaves,     "nice"),
      _structSection("Tools & stack",    enr.toolsAndStack,   "tools"),
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

  /* Raw posting — the unedited JD sections, kept for users who want
     to verify what the AI compressed. Collapsed by default so it
     doesn't break the editorial rhythm of the brief; the AI-curated
     sections above (lede, fit angle, must-haves, responsibilities,
     etc.) are the primary read. */
  function renderRawPosting(job) {
    if (!Array.isArray(job.jdSections) || job.jdSections.length <= 1) return "";
    var rest = job.jdSections.slice(1);
    var sectionsHtml = "";
    var renderedIndex = 0;
    var totalBullets = 0;
    for (var i = 0; i < rest.length; i++) {
      var section = rest[i];
      if (!section) continue;
      var heading = section.heading ? String(section.heading).trim() : "";
      var bullets = Array.isArray(section.bullets) ? section.bullets.filter(Boolean) : [];
      var body = section.body ? String(section.body).trim() : "";
      if (!heading && !body && !bullets.length) continue;
      renderedIndex += 1;
      totalBullets += bullets.length;
      var roman = toRoman(renderedIndex);
      var countText = bullets.length + " bullet" + (bullets.length === 1 ? "" : "s");
      var bodyHtml = "";
      if (body) bodyHtml += '<p>' + escapeHtml(body) + '</p>';
      if (bullets.length) {
        bodyHtml += '<ul>' + bullets.map(function (b) {
          return '<li>' + escapeHtml(b) + '</li>';
        }).join("") + '</ul>';
      }
      var headingLabel = heading || ("Section " + renderedIndex);
      /* Each subsection renders as a small titled block — no nested
         disclosure. The outer <details> handles the open/closed state
         for the whole raw posting. */
      sectionsHtml += '<div class="jd__section">' +
        '<div class="jd__section-head">' +
          '<span class="roman">' + escapeHtml(roman) + '.</span>' +
          '<span class="jd__section-title">' + escapeHtml(headingLabel) + '</span>' +
          '<span class="count">' + escapeHtml(countText) + '</span>' +
        '</div>' +
        '<div class="jd__section-body">' + bodyHtml + '</div>' +
      '</div>';
    }
    if (!sectionsHtml) return "";
    var summaryCount = renderedIndex + " section" + (renderedIndex === 1 ? "" : "s")
      + (totalBullets ? " · " + totalBullets + " bullet" + (totalBullets === 1 ? "" : "s") : "");
    return '<section class="jd">' +
      '<details class="jd__details">' +
        '<summary class="jd__summary">' +
          '<span class="jd__summary-label">View full posting details</span>' +
          '<span class="jd__summary-count">' + escapeHtml(summaryCount) + '</span>' +
          '<span class="jd__summary-toggle" aria-hidden="true">+</span>' +
        '</summary>' +
        '<div class="jd__body">' + sectionsHtml + '</div>' +
      '</details>' +
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
        rationale: String(enr.atsFitRationale || "").trim(),
      });
    }
    var signals = Array.isArray(enr.extraKeywords)
      ? enr.extraKeywords.map(function (t) { return String(t || "").trim(); }).filter(Boolean)
      : [];
    if (signals.length) {
      rows.push({ key: "Signals", val: signals.slice(0, 3).join(" · ") });
    }
    if (job.salary)   rows.push({ key: "Comp", val: String(job.salary) });
    if (job.location) rows.push({ key: "Location", val: String(job.location) });
    if (!rows.length) return "";
    var inner = rows.map(function (r) {
      if (r.score) {
        var title = r.rationale ? ' title="' + escapeHtml(r.rationale) + '"' : "";
        return '<li>' +
          '<span class="key">' + escapeHtml(r.key) + '</span>' +
          '<span class="val val--score"' + title + '>' + escapeHtml(String(r.val)) +
            '<sup style="font-size:0.55em;color:var(--mute);font-family:var(--mono);">/100</sup>' +
          '</span>' +
        '</li>';
      }
      return '<li>' +
        '<span class="key">' + escapeHtml(r.key) + '</span>' +
        '<span class="val">' + escapeHtml(String(r.val)) + '</span>' +
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

    var hookText = pickHook(job);
    var mastheadHtml = renderMasthead(job);
    var loadingHtml = renderEnrichmentLoading(job);

    if (isEnrichmentLoading(job)) {
      briefRoot.innerHTML = mastheadHtml + loadingHtml;
      return;
    }

    var hookHtml = renderHook(hookText);
    var ledeHtml = renderLede(job, hookText);
    var fitHtml = renderFitAngle(job);
    var enrichedSectionsHtml = renderEnrichedSections(job);
    var rawHtml = renderRawPosting(job);
    var skimHtml = renderSkim(job);
    var tagsHtml = renderTagsAndSkills(job);
    var pointsHtml = renderTalkingPoints(job);
    var notesHtml = renderNotes(job);

    briefRoot.innerHTML = mastheadHtml +
      loadingHtml +
      '<div class="brief__body">' +
        '<div class="brief__col brief__col--main">' +
          hookHtml + ledeHtml + fitHtml + enrichedSectionsHtml + rawHtml +
        '</div>' +
        '<div class="brief__col brief__col--side">' +
          skimHtml + tagsHtml + pointsHtml + notesHtml +
        '</div>' +
      '</div>';
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
