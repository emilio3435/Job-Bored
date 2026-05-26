/* ============================================================
   letter.js — JobBored v2 Letter editor + ATS scorecard
   ------------------------------------------------------------
   Owner:    Letter (Phase 2.D · flowing-page)
   Renders:  <section data-region="letter">
   Reads:    window.JobBoredDawn.data.getLetterViewModel(jobKey)
   Scores:   window.JobBoredAts.score / .analyze (deterministic)

   Behavior
     - Active only when document.body has class "jb-v2".
     - Job key is read from URL hash: #letter=<jobKey>.
     - On mount + on hashchange the section re-renders.
     - Editor is contenteditable; debounced re-score (1.2s).
       Generated and AI-revised drafts persist through app.js's
       IndexedDB draft library. Manual edits stay in the editor until
       the user saves a generated/revised version.
     - Tools (Tighten / Add evidence / Honest cut / Trim), custom
       revision instructions, and per-miss "Address" buttons revise
       through app.js's generated-draft bridge.
   ============================================================ */

(function (root) {
  "use strict";

  var REGION_SELECTOR = '[data-region="letter"]';
  var DEBOUNCE_SCORE_MS = 1200;

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function shouldRun() {
    return !!(document.body && document.body.classList && document.body.classList.contains("jb-v2"));
  }

  function getRegion() {
    return document.querySelector(REGION_SELECTOR);
  }

  function readJobKeyFromHash() {
    // Prefer flowing-store; fall back to hash parsing for `#role=` then `#letter=`.
    var openRole = root.JobBoredFlowing && root.JobBoredFlowing.openRole;
    if (openRole && typeof openRole.get === "function") {
      var k = openRole.get();
      if (k) return k;
    }
    var hash = String((root.location && root.location.hash) || "");
    if (!hash) return "";
    // Strip leading "#"
    var raw = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    var parts = raw.split("&");
    var byKey = {};
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");
      if (kv[0] && kv[1] != null) {
        try { byKey[kv[0]] = decodeURIComponent(kv[1]); }
        catch (e) { byKey[kv[0]] = kv[1]; }
      }
    }
    return byKey.role || byKey.letter || "";
  }

  function readingLevelFlavor(grade) {
    var n = parseInt(String(grade || "").replace(/[^0-9]/g, ""), 10);
    if (!isFinite(n)) return "balanced";
    if (n <= 8) return "accessible";
    if (n <= 12) return "balanced";
    return "dense";
  }

  function nowHHMM() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? "pm" : "am";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" : "") + m + ampm;
  }

  function formatRelative(iso) {
    if (!iso) return "";
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    var diff = Date.now() - t;
    if (diff < 60 * 1000) return "just now";
    if (diff < 60 * 60 * 1000) return Math.max(1, Math.round(diff / (60 * 1000))) + "m ago";
    if (diff < 24 * 60 * 60 * 1000) return Math.round(diff / (60 * 60 * 1000)) + "h ago";
    var d = Math.round(diff / (24 * 60 * 60 * 1000));
    if (d <= 1) return "yesterday";
    if (d < 7) return d + "d ago";
    var dt = new Date(t);
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[dt.getMonth()] + " " + dt.getDate();
  }

  /* ---------- draft folder (Part 04 paper-card strip) ---------- */

  function getDraftsForFeature(pipelineJob, feature) {
    if (!pipelineJob || typeof root.getDraftsForJob !== "function") return [];
    try {
      var list = root.getDraftsForJob(pipelineJob, feature) || [];
      // newest first
      return list.slice().sort(function (a, b) {
        return Number(b.versionNumber || 0) - Number(a.versionNumber || 0);
      });
    } catch (e) { return []; }
  }

  function draftCardHtml(d, isActive) {
    var vLabel = "V" + Number(d.versionNumber || 0);
    var modeLabel = d.mode === "refine" ? "Refined" : "Initial";
    var excerptRaw = String(d.excerpt || "");
    var excerpt = excerptRaw.slice(0, 110);
    return '' +
      '<button type="button"' +
      ' class="jb-letter-folder__card' + (isActive ? " is-active" : "") + '"' +
      ' data-action="load-draft"' +
      ' data-draft-id="' + escapeHtml(d.id) + '"' +
      ' aria-pressed="' + (isActive ? "true" : "false") + '">' +
        '<span class="jb-letter-folder__card-meta">' + escapeHtml(vLabel) + ' · ' + escapeHtml(modeLabel) + '</span>' +
        '<span class="jb-letter-folder__card-date">' + escapeHtml(formatRelative(d.createdAt)) + '</span>' +
        '<p class="jb-letter-folder__card-excerpt">' + escapeHtml(excerpt) + (excerptRaw.length > 110 ? "…" : "") + '</p>' +
        '<span class="jb-letter-folder__card-open"' +
        ' role="button"' +
        ' tabindex="0"' +
        ' data-action="open-draft-fullscreen"' +
        ' data-draft-id="' + escapeHtml(d.id) + '"' +
        ' aria-label="Open in fullscreen"' +
        ' title="Open in fullscreen">⤢</span>' +
      '</button>';
  }

  function writeTextToEditor(editor, text) {
    if (!editor) return;
    var draft = String(text || "");
    if (draft.indexOf("\n") !== -1) {
      editor.innerHTML = draft
        .split(/\n{2,}/)
        .map(function (para) {
          return "<p>" + escapeHtml(para).replace(/\n/g, "<br>") + "</p>";
        })
        .join("");
    } else {
      editor.textContent = draft;
    }
  }

  function folderHtml(jobIdx, clDrafts, reDrafts, activeDraftId) {
    var totalCount = clDrafts.length + reDrafts.length;
    var idxAttr = ' data-index="' + escapeHtml(String(jobIdx == null ? "" : jobIdx)) + '"';
    if (!totalCount) {
      /* No drafts yet — render an empty container only. The hero CTAs
         (Tailor / Cover) sit above and own the "start a draft" action,
         so we don't duplicate +Cover/+Tailor here. */
      return '<section class="jb-letter-folder jb-letter-folder--empty" hidden data-region-folder' + idxAttr + '></section>';
    }
    var clLabel = clDrafts.length + ' ' + (clDrafts.length === 1 ? "letter" : "letters");
    var reLabel = reDrafts.length + ' ' + (reDrafts.length === 1 ? "résumé" : "résumés");
    var lanes = "";
    if (clDrafts.length) {
      lanes += '<div class="jb-letter-folder__lane" data-feature="cover_letter">' +
        '<span class="jb-letter-folder__lane-label">Cover letters</span>' +
        '<div class="jb-letter-folder__strip">' +
          clDrafts.map(function (d) { return draftCardHtml(d, d.id === activeDraftId); }).join("") +
        '</div>' +
      '</div>';
    }
    if (reDrafts.length) {
      lanes += '<div class="jb-letter-folder__lane" data-feature="resume_update">' +
        '<span class="jb-letter-folder__lane-label">Résumés</span>' +
        '<div class="jb-letter-folder__strip">' +
          reDrafts.map(function (d) { return draftCardHtml(d, d.id === activeDraftId); }).join("") +
        '</div>' +
      '</div>';
    }
    return '' +
      '<section class="jb-letter-folder" data-region-folder' + idxAttr + '>' +
        '<header class="jb-letter-folder__head">' +
          '<p class="jb-letter-folder__eyebrow">YOUR DRAFTS · ' + escapeHtml(clLabel) + ' · ' + escapeHtml(reLabel) + '</p>' +
        '</header>' +
        '<div class="jb-letter-folder__lanes">' + lanes + '</div>' +
      '</section>';
  }

  function loadDraftIntoEditor(region, draft) {
    if (!region || !draft) return;
    var editor = region.querySelector("[data-letter-editor]");
    if (!editor) return;
    var text = String(draft.text || "");
    writeTextToEditor(editor, text);
    // mark active card in the strip
    var ctx = region.__letterCtx;
    if (ctx) ctx.activeDraftId = draft.id;
    var cards = region.querySelectorAll(".jb-letter-folder__card");
    cards.forEach(function (c) {
      var isActive = c.getAttribute("data-draft-id") === draft.id;
      c.classList.toggle("is-active", isActive);
      c.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    // re-score immediately (no debounce)
    try {
      var ats = root.JobBoredAts && root.JobBoredAts.analyze
        ? root.JobBoredAts.analyze({ jd: (ctx && ctx.jdSnippet) || "", draft: text })
        : null;
      if (ats) updateScorecard(region, ats);
    } catch (e) { /* never throw */ }
    setSaveState(region, "saved", nowHHMM());
  }

  function renderFolderInto(region, pipelineJob, activeDraftId) {
    var existing = region.querySelector('[data-region-folder]');
    var jobIdx = "";
    if (existing) jobIdx = existing.getAttribute("data-index") || "";
    var ctx = region.__letterCtx;
    if (!jobIdx && ctx && ctx.jobKey) jobIdx = ctx.jobKey;
    var cl = getDraftsForFeature(pipelineJob, "cover_letter");
    var re = getDraftsForFeature(pipelineJob, "resume_update");
    var html = folderHtml(jobIdx, cl, re, activeDraftId || null);
    if (existing) {
      existing.outerHTML = html;
    } else {
      // insert before the editor grid
      var grid = region.querySelector(".jb-letter-grid");
      if (grid) grid.insertAdjacentHTML("beforebegin", html);
    }
  }

  /* ---------- HTML builders ----------------------------------- */

  function noJobHtml() {
    return [
      '<div class="jb-letter-empty">',
      '  <p class="jb-letter-empty__eyebrow">WORKSHOP</p>',
      '  <h1 class="jb-letter-empty__headline">Open a card from the pipeline to start working.</h1>',
      '  <p class="jb-letter-empty__caption">Each role gets its own workbench — draft, score, and move the stage forward in one place.</p>',
      '</div>',
    ].join("");
  }

  function scoreCardHtml(label, value, target, reason) {
    var v = Math.max(0, Math.min(100, Number(value) || 0));
    var headline = reason && reason.headline ? reason.headline : "";
    var detail   = reason && reason.detail   ? reason.detail   : "";
    return [
      '<article class="jb-letter-score" data-score-name="', escapeHtml(label), '">',
      '  <span class="jb-letter-score__label">', escapeHtml(label), '</span>',
      '  <span class="jb-letter-score__value jb-data" data-score-value>', v, '</span>',
      '  <div class="jb-letter-score__bar" role="presentation">',
      '    <span class="jb-letter-score__bar-fill" style="width:', v, '%"></span>',
      target ? '    <span class="jb-letter-score__bar-target" style="left:' + target.from + '%;width:' + (target.to - target.from) + '%"></span>' : '',
      '  </div>',
      '  <span class="jb-letter-score__sub">', escapeHtml(target ? ("target " + target.label) : "0–100"), '</span>',
      headline ? '  <p class="jb-letter-score__reason">' + escapeHtml(headline) + '</p>' : '',
      detail ? [
        '  <details class="jb-letter-score__why">',
        '    <summary>Why this score</summary>',
        '    <p>', escapeHtml(detail), '</p>',
        '  </details>',
      ].join("") : '',
      '</article>',
    ].join("");
  }

  /* Pull score reasons from the LLM's per-draft insights payload.
     Returns null when no insights exist (hand-typed draft, or a
     generation that pre-dated the insights schema). The render
     code MUST tolerate null and render numbers only. */
  function readLlmReasons(vm) {
    var i = vm && vm.insights;
    if (!i) return null;
    function pick(node) {
      if (!node || typeof node !== "object") return null;
      var headline = node.reason ? String(node.reason) : "";
      return headline ? { headline: headline, detail: "" } : null;
    }
    return {
      keyword: pick(i.keywordCoverage),
      tone:    pick(i.toneMatch),
      length:  pick(i.length),
    };
  }

  function chipHtml(term) {
    return '<span class="jb-letter-chip" data-term="' + escapeHtml(term) + '">' + escapeHtml(term) + '</span>';
  }

  /* (missRowHtml removed — Missing keywords block has been deleted
     from the right rail; the per-miss "Address" action no longer
     has a rendering surface.) */

  function toolButtonHtml(action, label, hint) {
    return [
      '<button type="button" class="jb-letter-tool" data-action="', action, '" title="', escapeHtml(hint), '">',
      '  <span class="jb-letter-tool__label">', escapeHtml(label), '</span>',
      '  <span class="jb-letter-tool__hint">', escapeHtml(hint), '</span>',
      '</button>',
    ].join("");
  }

  function lengthTargetCard(length, reason) {
    var words = (length && length.words) || 0;
    var lo = (length && length.target && length.target[0]) || 200;
    var hi = (length && length.target && length.target[1]) || 320;
    var max = Math.max(hi * 1.4, words * 1.1, 1);
    var pos = Math.min(100, Math.max(0, (words / max) * 100));
    var fromPct = Math.min(100, (lo / max) * 100);
    var toPct = Math.min(100, (hi / max) * 100);
    var headline = reason && reason.headline ? reason.headline : "";
    var detail   = reason && reason.detail   ? reason.detail   : "";
    return [
      '<article class="jb-letter-score" data-score-name="length">',
      '  <span class="jb-letter-score__label">Length</span>',
      '  <span class="jb-letter-score__value jb-data" data-score-value-words>', words, '</span>',
      '  <div class="jb-letter-score__bar jb-letter-score__bar--length" role="presentation">',
      '    <span class="jb-letter-score__bar-target" style="left:', fromPct, '%;width:', (toPct - fromPct), '%"></span>',
      '    <span class="jb-letter-score__bar-marker" style="left:', pos, '%"></span>',
      '  </div>',
      '  <span class="jb-letter-score__sub">target ', lo, '–', hi, ' words</span>',
      headline ? '  <p class="jb-letter-score__reason">' + escapeHtml(headline) + '</p>' : '',
      detail ? [
        '  <details class="jb-letter-score__why">',
        '    <summary>Why this score</summary>',
        '    <p>', escapeHtml(detail), '</p>',
        '  </details>',
      ].join("") : '',
      '</article>',
    ].join("");
  }

  /* ---------- compose panel (prefill + tone/length + Generate) ---------- */

  var TONE_OPTIONS = [
    { value: "warm",       label: "Warm" },
    { value: "direct",     label: "Direct" },
    { value: "formal",     label: "Formal" },
    { value: "confident",  label: "Confident" },
    { value: "friendly",   label: "Friendly" },
  ];
  var LENGTH_OPTIONS = [
    { value: "200", label: "Concise (~200)" },
    { value: "350", label: "Standard (~350)" },
    { value: "500", label: "Detailed (~500)" },
  ];

  function pipelineJobForKey(jobKey) {
    if (typeof root.getPipelineJobByIndex !== "function") return null;
    try { return root.getPipelineJobByIndex(jobKey); }
    catch (e) { return null; }
  }

  function buildPrefill(pipelineJob, feature) {
    if (!pipelineJob || typeof root.buildDraftNotesPrefill !== "function") return "";
    try { return root.buildDraftNotesPrefill(pipelineJob, feature) || ""; }
    catch (e) { return ""; }
  }

  function postingEnrichment(pipelineJob) {
    return (pipelineJob && pipelineJob._postingEnrichment) || null;
  }

  function topMustHaves(pipelineJob, limit) {
    var enr = postingEnrichment(pipelineJob);
    if (!enr || !Array.isArray(enr.mustHaves)) return [];
    var out = [];
    for (var i = 0; i < enr.mustHaves.length && out.length < (limit || 4); i++) {
      var v = String(enr.mustHaves[i] || "").trim();
      if (v) out.push(v);
    }
    return out;
  }

  /* (fitAngleFor removed — fit angle now comes from per-draft LLM
     insights, not cached posting enrichment.) */

  function selectHtml(name, dataAttr, options, selectedValue) {
    var opts = options.map(function (o) {
      var sel = String(o.value) === String(selectedValue) ? ' selected' : '';
      return '<option value="' + escapeHtml(o.value) + '"' + sel + '>' + escapeHtml(o.label) + '</option>';
    }).join("");
    return '<select class="jb-letter-compose__select" ' + dataAttr +
      ' aria-label="' + escapeHtml(name) + '">' + opts + '</select>';
  }

  function sourceBadge(label, present) {
    return '<span class="jb-letter-compose__source" data-present="' + (present ? "true" : "false") + '">' +
      '<span class="jb-letter-compose__source-dot" aria-hidden="true"></span>' +
      escapeHtml(label) +
    '</span>';
  }

  function composePanelHtml(jobKey, pipelineJob, defaults) {
    var feature = (defaults && defaults.feature) || "cover_letter";
    var tone = (defaults && defaults.tone) || "warm";
    var maxWords = String((defaults && defaults.maxWords) || 350);
    var notes = (defaults && defaults.notes != null) ? String(defaults.notes) : "";
    var summary = (defaults && defaults.summary) || {
      hasResume: false, hasLinkedIn: false, hasAdditional: false,
    };
    var musts = topMustHaves(pipelineJob, 4);
    var mustChips = musts.length
      ? '<div class="jb-letter-compose__chips">' +
          musts.map(function (m) {
            return '<span class="jb-letter-compose__chip">' + escapeHtml(m) + '</span>';
          }).join("") +
        '</div>'
      : '<p class="jb-letter-compose__hint">No must-haves detected — generation will use the JD as-is.</p>';
    /* Fit angle is no longer rendered from cached posting enrichment.
       It is now rendered AFTER a draft generation, sourced from the
       LLM's per-draft insights payload (see jb-letter-fit-angle slot
       in the scorecard block). */
    var titleVal   = String(defaults && defaults.title != null ? defaults.title : "");
    return '' +
      '<section class="jb-letter-compose" data-region-compose data-job-key="' + escapeHtml(String(jobKey)) + '">' +
        '<header class="jb-letter-compose__head">' +
          '<p class="jb-letter-compose__eyebrow">COMPOSE · PREFILLED FROM THIS ROLE</p>' +
          '<h2 class="jb-letter-compose__title">Generate a draft</h2>' +
        '</header>' +
        '<div class="jb-letter-compose__summary">' +
          mustChips +
          '<div class="jb-letter-compose__sources" aria-label="Profile sources">' +
            sourceBadge("Resume", summary.hasResume) +
            sourceBadge("LinkedIn", summary.hasLinkedIn) +
            sourceBadge("Notes", summary.hasAdditional) +
          '</div>' +
        '</div>' +
        '<div class="jb-letter-compose__controls">' +
          '<label class="jb-letter-compose__field">' +
            '<span class="jb-letter-compose__field-label">Document</span>' +
            selectHtml("Document type", 'data-compose-feature', [
              { value: "cover_letter",  label: "Cover letter" },
              { value: "resume_update", label: "Tailored résumé" },
            ], feature) +
          '</label>' +
          '<label class="jb-letter-compose__field">' +
            '<span class="jb-letter-compose__field-label">Tone</span>' +
            selectHtml("Tone", 'data-compose-tone', TONE_OPTIONS, tone) +
          '</label>' +
          '<label class="jb-letter-compose__field">' +
            '<span class="jb-letter-compose__field-label">Length</span>' +
            selectHtml("Length", 'data-compose-length', LENGTH_OPTIONS, maxWords) +
          '</label>' +
        '</div>' +
        /* Title field — a human label for this version. Falls back
           to "Version N" downstream when blank. */
        '<label class="jb-letter-compose__title-label" for="jbLetterComposeTitle">Title</label>' +
        '<input type="text" id="jbLetterComposeTitle" class="jb-letter-compose__title-input" data-compose-title placeholder="e.g. Reliability-led, Acme robotics fleet" value="' + escapeHtml(titleVal) + '" />' +
        /* Version Notes — guidance for THIS draft only. Was the
           "Notes for this draft" field; the Suggest button has been
           removed (it duplicated cached posting data). */
        '<label class="jb-letter-compose__notes-label" for="jbLetterComposeNotes">Version Notes</label>' +
        '<textarea id="jbLetterComposeNotes" class="jb-letter-compose__notes" rows="3" data-compose-notes placeholder="What changes do you want in THIS version vs. the last one? e.g. lean harder on platform reliability, drop the mentoring paragraph, keep it under 250 words.">' +
          escapeHtml(notes) +
        '</textarea>' +
        '<div class="jb-letter-compose__actions">' +
          '<button type="button" class="jb-letter-compose__primary" data-action="compose-generate">' +
            '<span data-compose-primary-label>Generate draft</span>' +
          '</button>' +
          '<button type="button" class="jb-letter-compose__secondary" data-action="compose-open-modal" title="Open the full draft notes modal">Advanced…</button>' +
          '<p class="jb-letter-compose__status" data-compose-status aria-live="polite"></p>' +
        '</div>' +
      '</section>';
  }

  function setComposeStatus(region, message, tone) {
    var el = region && region.querySelector("[data-compose-status]");
    if (!el) return;
    el.textContent = message || "";
    if (tone) el.setAttribute("data-tone", tone);
    else el.removeAttribute("data-tone");
  }

  function setComposeBusy(region, busy) {
    var btn = region && region.querySelector('[data-action="compose-generate"]');
    var advanced = region && region.querySelector('[data-action="compose-open-modal"]');
    var labelEl = region && region.querySelector('[data-compose-primary-label]');
    [btn, advanced].forEach(function (el) {
      if (!el) return;
      el.disabled = !!busy;
      el.setAttribute("aria-disabled", busy ? "true" : "false");
      if (busy) el.setAttribute("data-busy", "true");
      else el.removeAttribute("data-busy");
    });
    if (labelEl) labelEl.textContent = busy ? "Generating…" : "Generate draft";
  }

  function readComposeState(region) {
    var feat = region.querySelector('[data-compose-feature]');
    var tone = region.querySelector('[data-compose-tone]');
    var len  = region.querySelector('[data-compose-length]');
    var notes = region.querySelector('[data-compose-notes]');
    var title = region.querySelector('[data-compose-title]');
    return {
      feature: feat ? String(feat.value || "cover_letter") : "cover_letter",
      tone: tone ? String(tone.value || "warm") : "warm",
      maxWords: len ? Number(len.value) || 350 : 350,
      notes: notes ? String(notes.value || "") : "",
      title: title ? String(title.value || "").trim() : "",
    };
  }

  function renderComposePanelInto(region, jobKey, defaults) {
    var pipelineJob = pipelineJobForKey(jobKey);
    var existing = region.querySelector('[data-region-compose]');
    var html = composePanelHtml(jobKey, pipelineJob, defaults);
    if (existing) {
      existing.outerHTML = html;
    } else {
      var grid = region.querySelector(".jb-letter-grid");
      if (grid) grid.insertAdjacentHTML("beforebegin", html);
    }
  }

  async function refreshComposeDefaultsAsync(region, jobKey, feature) {
    if (!region) return;
    var summary = {
      hasResume: false, hasLinkedIn: false, hasAdditional: false,
      tone: "warm", defaultMaxWords: 350,
    };
    if (typeof root.getWorkshopProfileSummary === "function") {
      try { summary = await root.getWorkshopProfileSummary(); }
      catch (e) { /* keep defaults */ }
    }
    var pipelineJob = pipelineJobForKey(jobKey);
    var notes = buildPrefill(pipelineJob, feature || "cover_letter");
    renderComposePanelInto(region, jobKey, {
      feature: feature || "cover_letter",
      tone: summary.tone || "warm",
      maxWords: summary.defaultMaxWords || 350,
      notes: notes,
      summary: summary,
    });
  }

  async function handleComposeGenerate(region, ctx) {
    if (!region || !ctx) return;
    if (typeof root.runResumeGeneration !== "function") {
      setComposeStatus(region, "Generation is unavailable in this build.", "error");
      return;
    }
    var idx = parseInt(ctx.jobKey, 10);
    if (!Number.isFinite(idx)) {
      setComposeStatus(region, "Open a role from the pipeline first.", "error");
      return;
    }
    var state = readComposeState(region);
    setComposeBusy(region, true);
    setComposeStatus(region, "Generating…", "busy");
    setSaveState(region, "saving");
    try {
      var result = await root.runResumeGeneration(idx, state.feature, {
        userNotes: state.notes,
        tone: state.tone,
        maxWords: state.maxWords,
        title: state.title,
        silent: true,
      });
      if (result && result.draftId) {
        ctx.pendingActiveDraftId = result.draftId;
      }
      setComposeStatus(
        region,
        state.feature === "cover_letter"
          ? "Cover letter saved as a new version."
          : "Tailored resume saved as a new version.",
        "success",
      );
    } catch (err) {
      var msg = err && err.message ? String(err.message) : "Generation failed";
      setSaveState(region, "dirty");
      setComposeStatus(region, msg, "error");
    } finally {
      setComposeBusy(region, false);
    }
  }

  function shellHtml(vm) {
    var job = vm.job || {};
    var ats = vm.ats || { score: 0, keywordCoverage: 0, toneMatch: 0, length: { words: 0, target: [200, 320] }, hits: [], misses: [], readingLevel: "Grade 0" };
    var scoreReasons = readLlmReasons(vm) || { keyword: null, tone: null, length: null };
    /* When LLM insights override the deterministic numbers, prefer
       those for the displayed scores. Numbers absent → fall back to
       deterministic ats.* so the UI never shows a blank. */
    var ins = (vm && vm.insights) || null;
    var kcVal = ins && ins.keywordCoverage && Number.isFinite(Number(ins.keywordCoverage.score))
      ? Number(ins.keywordCoverage.score) : ats.keywordCoverage;
    var tmVal = ins && ins.toneMatch && Number.isFinite(Number(ins.toneMatch.score))
      ? Number(ins.toneMatch.score) : ats.toneMatch;
    var llmFitAngle = ins && typeof ins.fitAngle === "string" ? ins.fitAngle.trim() : "";
    var insightsError = !!(vm && vm.insightsError);
    var role = job.role || "Untitled role";
    var company = job.company || "Unknown company";
    var jobKey = job.jobKey || "";

    /* Workshop sub-renderers (hero CTAs) are owned by role-workshop.js.
       The Stage stepper, One-click tools, and Progress chips sections
       have been intentionally removed from the Workshop right rail —
       stage + progress live in the Dossier; revision is owned by the
       Compose panel above the editor. */
    var workshopApi = root.JobBoredDossierWorkshop;
    var heroCtasHtml = (workshopApi && typeof workshopApi.renderHeroCtas === "function")
      ? workshopApi.renderHeroCtas(job) : "";

    return [
      '<div class="jb-role-divider">',
      '  <div class="jb-role-divider__rule"></div>',
      '  <div class="jb-role-divider__inner">',
      '    <div>',
      '      <div class="jb-role-divider__num">PART 04 · NOW WORKING</div>',
      '      <div class="jb-role-divider__title">The <em>workshop</em></div>',
      '    </div>',
      '    <div class="jb-role-divider__sub">Draft, score, and move this role forward. Editor on the left; stage, scorecard, and tools on the right.</div>',
      '  </div>',
      '</div>',
      '<header class="jb-letter-head">',
      '  <p class="jb-letter-eyebrow">WORKSHOP · DRAFT</p>',
      '  <h1 class="jb-letter-headline">', escapeHtml(role), ' <span class="jb-letter-headline__co">at ', escapeHtml(company), '</span></h1>',
      '  <p class="jb-letter-meta">',
      '    <span class="jb-letter-meta__key">', escapeHtml(jobKey), '</span>',
      '    <span class="jb-letter-meta__sep">·</span>',
      '    <span class="jb-letter-save" data-save-state="idle">',
      '      <span class="jb-letter-save__dot" aria-hidden="true"></span>',
      '      <span class="jb-letter-save__text">Saved</span>',
      '    </span>',
      '  </p>',
      '</header>',

      /* --- hero CTAs (Tailor / Cover) ------------------------- */
      heroCtasHtml,

      /* --- compose panel (prefill + tone/length + generate) ---
         The draft folder ("Versions") used to live above Compose;
         it now lives inside the Scorecard block in the right rail
         as a "Versions" sub-section. See the <!--folder-slot--> in
         that block below. */
      '<!--compose-slot-->',

      '<div class="jb-letter-grid">',

      /* --- editor pane ---------------------------------------- */
      '  <section class="jb-letter-editor-pane" aria-label="Letter editor">',
      '    <div class="jb-letter-editor-frame">',
      '      <div class="jb-letter-editor"',
      '           contenteditable="true"',
      '           role="textbox"',
      '           aria-multiline="true"',
      '           aria-label="Cover letter draft"',
      '           spellcheck="true"',
      '           data-letter-editor></div>',
      '    </div>',
      '  </section>',

      /* --- scorecard pane ------------------------------------- */
      /* Right-rail hierarchy (diagnose → fix):
           1. Scorecard summary  — how is the draft scoring?
           2. Missing keywords   — what's hurting the score?
         The Stage stepper, One-click tools, Custom revision, and
         Progress chips have been removed from this rail — Compose
         panel owns generation/revision; the Dossier owns stage and
         progress write-backs. Matched-keywords list is rolled into
         the scorecard summary as a count chip; reading-level grade
         is rolled in as a compact pill in the scorecard header. */
      '  <aside class="jb-letter-scorecard" aria-label="Workshop scorecard">',

      /* 1. Scorecard summary. */
      '    <section class="jb-letter-block jb-letter-block--scorecard">',
      '      <header class="jb-letter-block__head">',
      '        <h2 class="jb-letter-block__title">Scorecard</h2>',
      '        <div class="jb-letter-block__meta">',
      '          <span class="jb-letter-meta-chip" title="Matched JD keywords">',
      '            <span class="jb-letter-meta-chip__label">Matched</span>',
      '            <span class="jb-letter-meta-chip__value" data-hit-count>', (ats.hits || []).length, '</span>',
      '          </span>',
      '          <span class="jb-letter-pill" data-reading-level data-flavor="', readingLevelFlavor(ats.readingLevel), '">',
      '            <span class="jb-letter-pill__label" data-reading-grade>', escapeHtml(ats.readingLevel || "Grade 0"), '</span>',
      '            <span class="jb-letter-pill__sub" data-reading-flavor>', readingLevelFlavor(ats.readingLevel), '</span>',
      '          </span>',
      '        </div>',
      '      </header>',
      '      <div class="jb-letter-score-row">',
      scoreCardHtml("Keyword coverage", kcVal, { from: 60, to: 100, label: "60–100" }, scoreReasons.keyword),
      scoreCardHtml("Tone match",       tmVal, { from: 60, to: 100, label: "60–100" }, scoreReasons.tone),
      lengthTargetCard(ats.length, scoreReasons.length),
      '      </div>',
      /* Matched-terms chips kept as an opt-in details for users who
         want to scan the actual matched vocabulary; collapsed by
         default so it doesn't compete with the misses list below. */
      '      <details class="jb-letter-matched-details">',
      '        <summary>Show matched terms</summary>',
      '        <div class="jb-letter-chips" data-letter-hits>',
      (ats.hits || []).map(function (h) { return chipHtml(h.term); }).join("") || '<span class="jb-letter-chips__empty">No matches yet — add keywords from the JD.</span>',
      '        </div>',
      '      </details>',
      /* LLM-derived "Fit angle" for the active draft. Empty when no
         insights are attached (hand-typed draft or pre-insights
         generation). */
      llmFitAngle
        ? '      <div class="jb-letter-fit"><h3 class="jb-letter-fit__title">Fit angle</h3><p class="jb-letter-fit__body">' + escapeHtml(llmFitAngle) + '</p></div>'
        : '',
      /* Insights parse-failure banner — shown when the LLM call
         succeeded for the draft text but the trailing insights JSON
         could not be parsed. The user is asked to regenerate. */
      insightsError
        ? '      <div class="jb-letter-insights-error" role="status">' +
          '<p class="jb-letter-insights-error__title">Insights unavailable</p>' +
          '<p class="jb-letter-insights-error__body">The model returned a draft but its scoring block was malformed. Regenerate to get fresh insights.</p>' +
          '</div>'
        : '',
      /* Versions sub-section: previous drafts for this role.
         Lives inside the Scorecard block so users can compare
         scores across versions without scrolling away. The slot
         is replaced with folderHtml() at render time. */
      '      <div class="jb-letter-versions">',
      '        <h3 class="jb-letter-versions__title">Versions</h3>',
      '<!--folder-slot-->',
      '      </div>',
      '    </section>',

      /* (Missing keywords block deleted — was a deterministic ATS
         token-match list that didn't reflect real draft quality.) */

      '  </aside>',
      '</div>',
    ].join("");
  }

  /* ---------- editor + state ---------------------------------- */

  function setSaveState(region, state, atText) {
    var save = region.querySelector(".jb-letter-save");
    if (!save) return;
    save.setAttribute("data-save-state", state);
    var text = save.querySelector(".jb-letter-save__text");
    if (!text) return;
    if (state === "saving") text.textContent = "Saving…";
    else if (state === "saved") text.textContent = "Saved · " + (atText || nowHHMM());
    else if (state === "dirty") text.textContent = "Unsaved";
    else text.textContent = "Saved";
  }

  function readEditorText(editor) {
    if (!editor) return "";
    // Prefer innerText so contenteditable line-breaks are preserved as \n.
    var t = (typeof editor.innerText === "string") ? editor.innerText : editor.textContent;
    return String(t || "");
  }

  function updateScorecard(region, ats) {
    if (!region || !ats) return;

    /* score values */
    var nodes = region.querySelectorAll("[data-score-name]");
    nodes.forEach(function (card) {
      var name = card.getAttribute("data-score-name");
      var valEl = card.querySelector("[data-score-value]");
      var fillEl = card.querySelector(".jb-letter-score__bar-fill");
      if (name === "Keyword coverage") {
        if (valEl) valEl.textContent = String(ats.keywordCoverage);
        if (fillEl) fillEl.style.width = ats.keywordCoverage + "%";
      } else if (name === "Tone match") {
        if (valEl) valEl.textContent = String(ats.toneMatch);
        if (fillEl) fillEl.style.width = ats.toneMatch + "%";
      }
    });

    /* length card */
    var lenCard = region.querySelector('[data-score-name="length"]');
    if (lenCard && ats.length) {
      var w = ats.length.words || 0;
      var wEl = lenCard.querySelector("[data-score-value-words]");
      if (wEl) wEl.textContent = String(w);
      var lo = (ats.length.target && ats.length.target[0]) || 200;
      var hi = (ats.length.target && ats.length.target[1]) || 320;
      var max = Math.max(hi * 1.4, w * 1.1, 1);
      var pos = Math.min(100, Math.max(0, (w / max) * 100));
      var fromPct = Math.min(100, (lo / max) * 100);
      var toPct = Math.min(100, (hi / max) * 100);
      var marker = lenCard.querySelector(".jb-letter-score__bar-marker");
      var target = lenCard.querySelector(".jb-letter-score__bar-target");
      if (marker) marker.style.left = pos + "%";
      if (target) {
        target.style.left = fromPct + "%";
        target.style.width = (toPct - fromPct) + "%";
      }
    }

    /* hits */
    var hitsHost = region.querySelector("[data-letter-hits]");
    var hitCount = region.querySelector("[data-hit-count]");
    var hits = ats.hits || [];
    if (hitCount) hitCount.textContent = String(hits.length);
    if (hitsHost) {
      hitsHost.innerHTML = hits.length
        ? hits.map(function (h) { return chipHtml(h.term); }).join("")
        : '<span class="jb-letter-chips__empty">No matches yet — add keywords from the JD.</span>';
    }

    /* (Missing keywords block removed from the rail — no live
       DOM update needed.) */

    /* reading level */
    var pill = region.querySelector("[data-reading-level]");
    var grade = region.querySelector("[data-reading-grade]");
    var flavor = region.querySelector("[data-reading-flavor]");
    if (pill) pill.setAttribute("data-flavor", readingLevelFlavor(ats.readingLevel));
    if (grade) grade.textContent = ats.readingLevel || "Grade 0";
    if (flavor) flavor.textContent = readingLevelFlavor(ats.readingLevel);
  }

  function readManualRevisionInstructions(region) {
    var input = region && region.querySelector("[data-letter-revision-instructions]");
    return input && input.value != null ? String(input.value).trim() : "";
  }

  function baseRevisionFeedback(action, term) {
    if (action === "tighten") {
      return "Tighten this cover letter: sharpen verbs, remove hedging and filler, keep the claims factual, and preserve the strongest role-specific evidence.";
    }
    if (action === "add-evidence") {
      return "Add concrete evidence to this cover letter from the candidate profile and job posting. Prefer outcomes, scope, tools, or metrics only when they are supported by the source material. Do not invent numbers or credentials.";
    }
    if (action === "honest-cut") {
      return "Make an honest cut: remove overstatement, unsupported claims, and generic praise. Keep the strongest truthful proof and make the letter sound credible.";
    }
    if (action === "trim") {
      return "Trim this cover letter toward 250 words while preserving the strongest role-specific evidence, truthful fit, and a clear close.";
    }
    if (action === "address") {
      return 'Revise this cover letter to address the missing job-description term "' + term + '". Use truthful evidence from the candidate profile or adjacent experience; do not pretend direct experience if it is not supported.';
    }
    return "";
  }

  function buildRevisionFeedback(region, action, term) {
    var manual = readManualRevisionInstructions(region);
    if (action === "manual-revise") return manual;
    var base = baseRevisionFeedback(action, term);
    if (!base) return manual;
    return manual
      ? base + "\n\nAdditional user instructions: " + manual
      : base;
  }

  function setRevisionStatus(region, message, tone) {
    var el = region && region.querySelector("[data-letter-revision-status]");
    if (!el) return;
    el.textContent = message || "";
    if (tone) el.setAttribute("data-tone", tone);
    else el.removeAttribute("data-tone");
  }

  function setRevisionBusy(region, busy, activeAction) {
    var controls = region.querySelectorAll(".jb-letter-tool, .jb-letter-miss__btn, .jb-letter-revision__button");
    controls.forEach(function (control) {
      control.disabled = !!busy;
      control.setAttribute("aria-disabled", busy ? "true" : "false");
      if (busy && activeAction && control.getAttribute("data-action") === activeAction) {
        control.setAttribute("data-busy", "true");
      } else {
        control.removeAttribute("data-busy");
      }
    });
    var input = region.querySelector("[data-letter-revision-instructions]");
    if (input) input.disabled = !!busy;
  }

  function applyRevisedDraft(region, ctx, text, draftId) {
    var editor = region.querySelector("[data-letter-editor]");
    if (!editor) return;
    writeTextToEditor(editor, text);
    if (ctx) {
      if (ctx.scoreTimer) { clearTimeout(ctx.scoreTimer); ctx.scoreTimer = null; }
      if (ctx.saveTimer) { clearTimeout(ctx.saveTimer); ctx.saveTimer = null; }
      ctx.activeDraftId = draftId || ctx.activeDraftId || null;
    }
    try {
      var ats = root.JobBoredAts && root.JobBoredAts.analyze
        ? root.JobBoredAts.analyze({ jd: (ctx && ctx.jdSnippet) || "", draft: text })
        : null;
      if (ats) updateScorecard(region, ats);
    } catch (e) { /* never throw */ }
    if (ctx && typeof root.getPipelineJobByIndex === "function") {
      renderFolderInto(region, root.getPipelineJobByIndex(ctx.jobKey), ctx.activeDraftId);
    }
    setSaveState(region, "saved", nowHHMM());
  }

  async function reviseWithAi(region, ctx, action, term) {
    if (!region || !ctx || ctx.revisionBusy) return;
    var editor = region.querySelector("[data-letter-editor]");
    var previousDraft = readEditorText(editor).trim();
    if (!previousDraft) {
      setRevisionStatus(region, "Add or load a draft before revising.", "error");
      return;
    }
    var feedback = buildRevisionFeedback(region, action, term || "");
    if (!feedback) {
      setRevisionStatus(region, "Type revision instructions first.", "error");
      return;
    }
    if (typeof root.reviseLetterDraftForJob !== "function") {
      setRevisionStatus(region, "AI revision is unavailable in this build.", "error");
      return;
    }
    ctx.revisionBusy = true;
    setRevisionBusy(region, true, action);
    setRevisionStatus(region, "Revising with AI…", "busy");
    setSaveState(region, "saving");
    try {
      var result = await root.reviseLetterDraftForJob(ctx.jobKey, {
        previousDraft: previousDraft,
        refinementFeedback: feedback,
        parentDraftId: ctx.activeDraftId || null,
      });
      var nextText = result && result.text ? String(result.text).trim() : "";
      if (!nextText) throw new Error("AI returned an empty revision");
      applyRevisedDraft(region, ctx, nextText, result && result.draftId);
      if (result && result.saved === false) {
        setRevisionStatus(region, result.saveError || "Revised, but could not save a new version.", "error");
      } else {
        setRevisionStatus(region, "Revised and saved as a new version.", "success");
      }
    } catch (err) {
      var msg = err && err.message ? String(err.message) : "Revision failed";
      setSaveState(region, "dirty");
      setRevisionStatus(region, msg, "error");
    } finally {
      ctx.revisionBusy = false;
      setRevisionBusy(region, false);
    }
  }

  function bindEditorEvents(region, ctx) {
    var editor = region.querySelector("[data-letter-editor]");
    if (!editor) return;

    function reschedule() {
      setSaveState(region, "dirty");
      // re-score (1.2s)
      if (ctx.scoreTimer) clearTimeout(ctx.scoreTimer);
      ctx.scoreTimer = setTimeout(function () {
        try {
          var ats = root.JobBoredAts && root.JobBoredAts.analyze
            ? root.JobBoredAts.analyze({ jd: ctx.jdSnippet, draft: readEditorText(editor) })
            : null;
          if (ats) updateScorecard(region, ats);
        } catch (e) { /* never throw to user */ }
      }, DEBOUNCE_SCORE_MS);

      // Manual editor edits are intentionally not written to Pipeline!O.
      // That Sheet column is dossier notes; generated/revised drafts persist
      // through the IndexedDB draft library instead.
      if (ctx.saveTimer) clearTimeout(ctx.saveTimer);
      ctx.saveTimer = null;
    }

    editor.addEventListener("input", reschedule);
    editor.addEventListener("keyup", function (e) {
      // Surface the dirty state immediately on first keystroke.
      if (region.querySelector(".jb-letter-save").getAttribute("data-save-state") === "saved") {
        setSaveState(region, "dirty");
      }
    });

    /* tools / address — revise through the generated-draft bridge in app.js. */
    region.addEventListener("click", function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      if (!action) return;
      if (action === "address") {
        var term = btn.getAttribute("data-term");
        void reviseWithAi(region, ctx, action, term || "");
        return;
      }
      if (action === "tighten" || action === "add-evidence" || action === "honest-cut" || action === "trim" || action === "manual-revise") {
        void reviseWithAi(region, ctx, action, "");
        return;
      }

      /* --- draft folder strip ----------------------------------- */
      if (action === "load-draft") {
        var loadId = btn.getAttribute("data-draft-id");
        if (!loadId) return;
        var job = (typeof root.getPipelineJobByIndex === "function")
          ? root.getPipelineJobByIndex(ctx.jobKey) : null;
        if (!job) return;
        var all = []
          .concat(getDraftsForFeature(job, "cover_letter"))
          .concat(getDraftsForFeature(job, "resume_update"));
        var match = all.find(function (d) { return d.id === loadId; });
        if (match) loadDraftIntoEditor(region, match);
        return;
      }
      if (action === "open-draft-fullscreen") {
        e.preventDefault();
        e.stopPropagation();
        var openId = btn.getAttribute("data-draft-id");
        if (openId && typeof root.openSavedDraftVersion === "function") {
          try { root.openSavedDraftVersion(openId); }
          catch (err) { /* ignore */ }
        }
        return;
      }
      if (action === "new-cover-letter" || action === "new-resume") {
        var feature = action === "new-cover-letter" ? "cover_letter" : "resume_update";
        var idx = parseInt(ctx.jobKey, 10);
        if (Number.isFinite(idx) && typeof root.openDraftNotesModal === "function") {
          root.openDraftNotesModal(idx, feature);
        }
        return;
      }

      /* --- compose panel actions ------------------------------- */
      if (action === "compose-generate") {
        void handleComposeGenerate(region, ctx);
        return;
      }
      if (action === "compose-open-modal") {
        var composeState = readComposeState(region);
        var advIdx = parseInt(ctx.jobKey, 10);
        if (Number.isFinite(advIdx) && typeof root.openDraftNotesModal === "function") {
          root.openDraftNotesModal(advIdx, composeState.feature, {
            prefillNotes: composeState.notes,
          });
        }
        return;
      }

      /* --- workshop hero CTAs ----------------------------------- */
      /* Tailor resume / Cover letter — role-workshop.js dispatches
         the jb:role:action event from its own delegate. Here we also
         open the draft-notes modal so the click actually opens the
         drafting flow. Order: letter.js delegate runs first (because
         it was attached first via bindEditorEvents → role-workshop.js
         wireWorkshop attaches second), so we explicitly handle both. */
      if (action === "resume-cover" || action === "resume-tailor") {
        var heroFeature = action === "resume-cover" ? "cover_letter" : "resume_update";
        var heroIdx = parseInt(ctx.jobKey, 10);
        if (Number.isFinite(heroIdx) && typeof root.openDraftNotesModal === "function") {
          root.openDraftNotesModal(heroIdx, heroFeature);
        }
        return;
      }
    });
  }

  /* ---------- render ------------------------------------------ */

  function clearTimers(ctx) {
    if (!ctx) return;
    if (ctx.scoreTimer) { clearTimeout(ctx.scoreTimer); ctx.scoreTimer = null; }
    if (ctx.saveTimer)  { clearTimeout(ctx.saveTimer);  ctx.saveTimer = null; }
  }

  function render() {
    if (!shouldRun()) return;
    var region = getRegion();
    if (!region) return;

    var jobKey = readJobKeyFromHash();

    if (!jobKey) {
      // Role region owns the empty-state shelf for both PART 03 and 04.
      // Letter region renders nothing when no role is open.
      clearTimers(region.__letterCtx);
      region.__letterCtx = null;
      if (region.__letterHtml !== "") {
        region.innerHTML = "";
        region.__letterHtml = "";
      }
      return;
    }

    var dataApi = root.JobBoredDawn && root.JobBoredDawn.data;
    if (!dataApi || typeof dataApi.getLetterViewModel !== "function") {
      // Data layer missing — render empty state but flag it in console.
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[letter] JobBoredDawn.data.getLetterViewModel not available");
      }
      region.innerHTML = noJobHtml();
      region.__letterHtml = "";
      return;
    }

    var vm;
    try {
      vm = dataApi.getLetterViewModel(jobKey);
    } catch (e) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[letter] view-model error", e);
      }
      vm = null;
    }
    if (!vm || !vm.job) {
      region.innerHTML = noJobHtml();
      region.__letterHtml = "";
      return;
    }

    var pipelineJob = (typeof root.getPipelineJobByIndex === "function")
      ? root.getPipelineJobByIndex(jobKey)
      : null;

    /* Re-render shell only if jobKey changed. Otherwise refresh
       the scorecard + draft folder strip in place, preserving editor state. */
    if (region.__letterCtx && region.__letterCtx.jobKey === jobKey) {
      updateScorecard(region, vm.ats || {});
      /* Keep workshop delegate's jobKey current even when shell is reused. */
      if (root.JobBoredDossierWorkshop && typeof root.JobBoredDossierWorkshop.wireWorkshop === "function") {
        root.JobBoredDossierWorkshop.wireWorkshop(region, jobKey);
      }
      var pendingId = region.__letterCtx.pendingActiveDraftId;
      renderFolderInto(region, pipelineJob, pendingId || region.__letterCtx.activeDraftId);
      if (pendingId) {
        var allDrafts = []
          .concat(getDraftsForFeature(pipelineJob, "cover_letter"))
          .concat(getDraftsForFeature(pipelineJob, "resume_update"));
        var match = allDrafts.find(function (d) { return d.id === pendingId; });
        if (match) loadDraftIntoEditor(region, match);
        region.__letterCtx.pendingActiveDraftId = null;
      }
      return;
    }

    clearTimers(region.__letterCtx);

    /* Synchronous initial render uses defaults; the async refresh below
       repopulates the compose panel with profile-source presence and
       the user's saved tone/length preferences once IndexedDB resolves. */
    var initialCompose = composePanelHtml(jobKey, pipelineJob, {
      feature: "cover_letter",
      tone: "warm",
      maxWords: 350,
      notes: buildPrefill(pipelineJob, "cover_letter"),
      summary: { hasResume: false, hasLinkedIn: false, hasAdditional: false },
    });
    var rendered = shellHtml(vm)
      .replace("<!--folder-slot-->", folderHtml(jobKey,
        getDraftsForFeature(pipelineJob, "cover_letter"),
        getDraftsForFeature(pipelineJob, "resume_update"),
        null))
      .replace("<!--compose-slot-->", initialCompose);
    region.innerHTML = rendered;
    region.__letterHtml = "letter:" + jobKey;

    var editor = region.querySelector("[data-letter-editor]");
    if (editor) {
      writeTextToEditor(editor, vm.draft || "");
    }

    var ctx = {
      jobKey: jobKey,
      jdSnippet: (vm.job && vm.job.jdSnippet) || "",
      scoreTimer: null,
      saveTimer: null,
      activeDraftId: null,
      pendingActiveDraftId: null,
      revisionBusy: false,
    };
    region.__letterCtx = ctx;
    bindEditorEvents(region, ctx);
    /* Wire the workshop delegate (stage stepper, progress chips,
       hero CTAs). role-workshop.js owns the click → event mapping;
       letter.js's own delegate handles editor tools/drafts. */
    if (root.JobBoredDossierWorkshop && typeof root.JobBoredDossierWorkshop.wireWorkshop === "function") {
      root.JobBoredDossierWorkshop.wireWorkshop(region, jobKey);
    }
    /* Repaint compose panel with real profile-source presence + saved
       tone/length once IndexedDB resolves. Errors are swallowed; the
       sync initial render already provides a usable panel. */
    if (typeof root.Promise !== "undefined") {
      Promise.resolve().then(function () {
        return refreshComposeDefaultsAsync(region, jobKey, "cover_letter");
      }).catch(function () { /* keep sync defaults */ });
    }
    setSaveState(region, "saved", nowHHMM());
  }

  /* ---------- observers --------------------------------------- */

  function bindHashListener() {
    if (root.__jbLetterHashBound) return;
    root.__jbLetterHashBound = true;
    root.addEventListener("hashchange", function () { render(); });
    root.addEventListener("jb:role:opened", function () { render(); });
    root.addEventListener("jb:role:closed", function () { render(); });
    document.addEventListener("jb:draft:saved", function (e) {
      var region = getRegion();
      if (!region || !region.__letterCtx) { render(); return; }
      var detailKey = e && e.detail && e.detail.jobKey != null ? String(e.detail.jobKey) : "";
      if (detailKey && detailKey !== String(region.__letterCtx.jobKey)) return;
      region.__letterCtx.pendingActiveDraftId = (e && e.detail && e.detail.draftId) || null;
      render();
    });
  }

  function observeBodyClass() {
    if (!document.body) return;
    var mo = new MutationObserver(function () { render(); });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function init() {
    root.JobBoredLetter = root.JobBoredLetter || {};
    root.JobBoredLetter.render = render;

    bindHashListener();
    observeBodyClass();
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
