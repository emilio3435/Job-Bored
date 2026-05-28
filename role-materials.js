/* ============================================================
   role-materials.js — JobBored v2 Application Materials (Dossier add-on)
   ------------------------------------------------------------
   Owner:    materials-first lane (2026-05-27 handoff)
   Renders:  an "Application Materials" section appended to the
             open role's brief (data-mount="brief").
   Reads:    GET /api/applications (catalog)
             GET /api/applications/:slug/manifest (per-package)
             from the local JobBored server (server/index.mjs).
   Events:
     LISTENS  jb:role:opened   { jobKey }
              jb:role:closed
     EMITS    jb:role:materials:opened { slug, filename }
              jb:role:materials:downloaded { slug, filename }

   Matching strategy
     Slug is computed from the open role's company + title using the
     same casing rules Hermes applies on disk. When the exact slug
     isn't on disk we fall back to a "company prefix" match (longest
     title-word overlap wins). If no candidate matches, the section
     is hidden — never rendered with empty cards.

   Activation: body.jb-v2 only. Off-flag: no-op.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var REGION_SELECTOR = '[data-region="role"]';
  var BRIEF_SELECTOR = '[data-mount="brief"]';
  var SECTION_CLASS = "brief-materials";

  /* Allowlist mirrored from server/application-materials.mjs. Keep in
     sync — if the server rejects a filename, the UI must not link to it. */
  var ALLOWED_FILES = {
    "resume.pdf": { format: "PDF", inline: true },
    "resume.html": { format: "HTML", inline: true },
    "cover-letter.pdf": { format: "PDF", inline: true },
    "cover-letter.html": { format: "HTML", inline: true },
    "qa-report.md": { format: "Markdown", inline: false },
    "job-analysis.md": { format: "Markdown", inline: false },
    "job-description.md": { format: "Markdown", inline: false },
    "manual-apply-checklist.md": { format: "Markdown", inline: false },
    "manifest.json": { format: "JSON", inline: false },
  };

  var DOC_LABELS = {
    resume: { label: "Tailored Resume", role: "primary" },
    cover_letter: { label: "Cover Letter", role: "primary" },
    job_analysis: { label: "Job Analysis", role: "support" },
    qa_report: { label: "QA Report", role: "support" },
    job_description: { label: "Job Description", role: "support" },
    manual_apply_checklist: { label: "Apply Checklist", role: "support" },
  };

  function shouldRun() {
    return !!(typeof document !== "undefined"
      && document.body
      && document.body.classList
      && document.body.classList.contains("jb-v2"));
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

  /**
   * Normalise a free-form string into the slug shape Hermes uses for
   * its application folders: lowercase ASCII alphanumerics joined by
   * single dashes. Drops TLD-style suffixes (e.g. "chartis.io" →
   * "chartis") because Hermes drops them too.
   */
  function slugify(value) {
    var s = String(value == null ? "" : value).toLowerCase().trim();
    s = s.replace(/\.(io|ai|co|com|net|org|app|gg|so|sh|inc|llc)\b/g, "");
    s = s.replace(/&/g, " and ");
    s = s.replace(/[^a-z0-9]+/g, "-");
    s = s.replace(/^-+|-+$/g, "");
    return s;
  }

  /* Common corporate noise tokens we strip from the company slug when
     matching. The pipeline row often says "TEGNA Inc." or "Anthropic
     PBC" while Hermes stores the folder as plain "tegna-…" /
     "anthropic-…". Keeping this list short and conservative on purpose. */
  var COMPANY_NOISE = {
    inc: 1, llc: 1, ltd: 1, corp: 1, corporation: 1, co: 1,
    pbc: 1, plc: 1, gmbh: 1, sa: 1, ag: 1, "the": 1,
    holdings: 1, group: 1, media: 1, technologies: 1, technology: 1,
  };

  function companyTokens(company) {
    return slugify(company).split("-").filter(function (t) {
      return t && !COMPANY_NOISE[t];
    });
  }

  /**
   * Build the most-likely Hermes slug for a job. Tries the canonical
   * "<company>-<title>" join; the caller is responsible for falling
   * back to a prefix match when no application file matches exactly.
   */
  function buildCandidateSlug(job) {
    var c = slugify(job && job.company);
    var t = slugify(job && job.role);
    if (!c && !t) return "";
    if (c && t) return c + "-" + t;
    return c || t;
  }

  /**
   * Choose an application from the server list that best matches the
   * given job, even when Hermes slug differs from the dashboard slug
   * (e.g. abbreviated titles, dropped suffixes).
   */
  function pickApplication(job, applications) {
    if (!Array.isArray(applications) || !applications.length) return null;
    var target = buildCandidateSlug(job);
    var exact = target
      ? applications.find(function (a) { return a && a.slug === target; })
      : null;
    if (exact) return exact;

    var tokens = companyTokens(job && job.company);
    if (!tokens.length) return null;
    /* Match if the folder slug begins with the first meaningful company
       token. This is what makes "TEGNA Inc." → tegna-digital-sales-manager
       work, and also why Anthropic with a long abbreviated title still
       resolves. We then score by title-word overlap. */
    var head = tokens[0];
    var titleSlug = slugify(job && job.role);
    var titleWords = titleSlug.split("-").filter(Boolean);

    var bestScore = -1;
    var best = null;
    applications.forEach(function (a) {
      if (!a || typeof a.slug !== "string") return;
      if (a.slug !== head && a.slug.indexOf(head + "-") !== 0) return;
      var tail = a.slug === head ? "" : a.slug.slice(head.length + 1);
      /* Bonus when the full multi-token company slug also matches as a
         prefix — protects against "tegna" colliding with a hypothetical
         "tegna-foundation" folder when the row really is "TEGNA Media". */
      var companyBonus = 0;
      for (var i = 1; i < tokens.length; i++) {
        if (tail.indexOf(tokens[i]) !== -1) companyBonus += 1;
      }
      var overlap = 0;
      titleWords.forEach(function (w) {
        if (w && tail.indexOf(w) !== -1) overlap += 1;
      });
      var score = overlap * 2 + companyBonus;
      if (score > bestScore || (score === bestScore && best && a.slug.length < best.slug.length)) {
        bestScore = score;
        best = a;
      }
    });
    return best;
  }

  function formatRelative(iso) {
    if (!iso) return "";
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    var diff = Date.now() - t;
    if (diff < 60 * 1000) return "just now";
    if (diff < 60 * 60 * 1000) {
      return Math.max(1, Math.round(diff / (60 * 1000))) + "m ago";
    }
    if (diff < 24 * 60 * 60 * 1000) {
      return Math.round(diff / (60 * 60 * 1000)) + "h ago";
    }
    var days = Math.round(diff / (24 * 60 * 60 * 1000));
    if (days <= 1) return "yesterday";
    if (days < 7) return days + "d ago";
    var dt = new Date(t);
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[dt.getMonth()] + " " + dt.getDate();
  }

  function formatSize(bytes) {
    var n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function pickPreviewFile(doc) {
    if (!doc || !Array.isArray(doc.files) || !doc.files.length) return null;
    var byFormat = function (fmt) {
      return doc.files.find(function (f) { return f && f.format === fmt; });
    };
    return byFormat("html") || byFormat("pdf") || byFormat("md") || doc.files[0];
  }

  function pickDownloadFile(doc) {
    if (!doc || !Array.isArray(doc.files) || !doc.files.length) return null;
    var byFormat = function (fmt) {
      return doc.files.find(function (f) { return f && f.format === fmt; });
    };
    return byFormat("pdf") || byFormat("html") || byFormat("md") || doc.files[0];
  }

  function fileUrl(base, slug, filename, opts) {
    var qs = opts && opts.download ? "?download=1" : "";
    return base + "/api/applications/" + encodeURIComponent(slug)
      + "/files/" + encodeURIComponent(filename) + qs;
  }

  function getBaseUrl() {
    var helper = root.getJobPostingScrapeUrl;
    if (typeof helper === "function") {
      try {
        var url = helper();
        if (url) return String(url).replace(/\/+$/, "");
      } catch (e) { /* ignored */ }
    }
    var cfg = root.COMMAND_CENTER_CONFIG;
    var raw = cfg && cfg.jobPostingScrapeUrl;
    if (raw) return String(raw).trim().replace(/\/+$/, "");
    if (root.location) {
      var h = root.location.hostname;
      if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
        return "http://127.0.0.1:3847";
      }
    }
    return "";
  }

  function pendingAffectsType(pending, docType) {
    if (!pending || !pending.feature) return false;
    /* Don't paint cards as "Generating…" once the run is terminal. A
       FAILED banner should not visually claim its sibling cards are
       still in progress. */
    var phase = pending.progress && pending.progress.phase;
    if (phase === "failed" || phase === "complete") return false;
    if (pending.feature === "both") {
      return docType === "resume" || docType === "cover_letter";
    }
    if (pending.feature === "resume") return docType === "resume";
    if (pending.feature === "cover_letter") return docType === "cover_letter";
    return false;
  }

  function renderCard(slug, doc, base, pending) {
    var meta = DOC_LABELS[doc.type] || { label: doc.label || doc.type, role: "support" };
    var primaryFile = ALLOWED_FILES[doc.primary] || null;
    var preview = pickPreviewFile(doc);
    var download = pickDownloadFile(doc);
    var hasPreview = !!(preview && (ALLOWED_FILES[preview.filename] || {}).inline);
    var formats = doc.files.map(function (f) {
      return (ALLOWED_FILES[f.filename] && ALLOWED_FILES[f.filename].format) || (f.format || "").toUpperCase();
    });
    var size = primaryFile && doc.files.length
      ? formatSize((doc.files.find(function (f) { return f.filename === doc.primary; }) || doc.files[0]).size)
      : "";
    var updatedRel = formatRelative(doc.lastModifiedAt);
    var typeAttr = escapeHtml(doc.type);
    var isPending = pendingAffectsType(pending, doc.type);
    var statusLabel = isPending ? "Generating…" : "Ready";
    var statusAttr = isPending ? "pending" : "ready";

    var actions = [];
    if (hasPreview && preview) {
      actions.push(
        '<a class="brief-materials__btn brief-materials__btn--primary"'
        + ' href="' + escapeHtml(fileUrl(base, slug, preview.filename)) + '"'
        + ' target="_blank" rel="noopener"'
        + ' data-action="materials-preview"'
        + ' data-filename="' + escapeHtml(preview.filename) + '"'
        + '>Preview</a>'
      );
    }
    if (download) {
      actions.push(
        '<a class="brief-materials__btn brief-materials__btn--ghost"'
        + ' href="' + escapeHtml(fileUrl(base, slug, download.filename, { download: true })) + '"'
        + ' download'
        + ' data-action="materials-download"'
        + ' data-filename="' + escapeHtml(download.filename) + '"'
        + '>Download ' + escapeHtml((ALLOWED_FILES[download.filename] && ALLOWED_FILES[download.filename].format) || "") + '</a>'
      );
    }

    var metaParts = [];
    var primaryFormat = formats.filter(function (f) { return f; })[0];
    if (primaryFormat) metaParts.push(escapeHtml(primaryFormat));
    if (size) metaParts.push(escapeHtml(size));
    if (updatedRel) metaParts.push("Updated " + escapeHtml(updatedRel));

    return '<article class="brief-materials__card brief-materials__card--' + (meta.role === "primary" ? "primary" : "support")
      + (isPending ? " brief-materials__card--pending" : "")
      + '"'
      + ' data-doc-type="' + typeAttr + '">'
      + '<header class="brief-materials__card-head">'
        + '<span class="brief-materials__card-label">' + escapeHtml(meta.label) + '</span>'
        + '<span class="brief-materials__card-status" data-status="' + statusAttr + '">' + escapeHtml(statusLabel) + '</span>'
      + '</header>'
      + (metaParts.length ? '<p class="brief-materials__card-meta">' + metaParts.join(' <span class="brief-materials__dot">·</span> ') + '</p>' : '')
      + '<footer class="brief-materials__card-actions">' + actions.join("") + '</footer>'
      + '</article>';
  }

  function renderPendingPlaceholderCard(slug, type) {
    var meta = DOC_LABELS[type] || { label: type, role: "primary" };
    return '<article class="brief-materials__card brief-materials__card--primary brief-materials__card--pending"'
      + ' data-doc-type="' + escapeHtml(type) + '">'
      + '<header class="brief-materials__card-head">'
        + '<span class="brief-materials__card-label">' + escapeHtml(meta.label) + '</span>'
        + '<span class="brief-materials__card-status" data-status="pending">Generating…</span>'
      + '</header>'
      + '<p class="brief-materials__card-meta">Hermes is drafting this · check Telegram</p>'
      + '<footer class="brief-materials__card-actions"></footer>'
      + '</article>';
  }

  function renderEmpty(briefEl, options) {
    /* Empty state: a single line tag and a hint. Renders only when the
       brief is open, the role is known, and there's no matched package. */
    if (!briefEl) return;
    removeExisting(briefEl);
    var note = options && options.note ? options.note : "";
    var html = '<section class="' + SECTION_CLASS + ' brief-materials--empty" aria-label="Application materials">'
      + '<header class="brief-materials__head">'
        + '<h3 class="section-label">Application Materials</h3>'
        + '<span class="brief-materials__eyebrow">LOCAL · ~/.hermes/job-hunt</span>'
      + '</header>'
      + '<p class="brief-materials__empty">'
        + (note
          ? escapeHtml(note)
          : "No tailored resume or cover letter on disk for this role yet.")
      + '</p>'
      + '<p class="brief-materials__hint">Use <strong>Draft cover letter</strong> or <strong>Tailor resume</strong> above to ask Hermes for a tailored pass.</p>'
      + '</section>';
    appendSection(briefEl, html);
  }

  /* The spinning clock SVG the user wants reused throughout the
     progress UI. Two arcs + clock hands. The CSS animation rotates
     it from the .brief-materials__progress-clock wrapper. */
  var PROGRESS_CLOCK_SVG = ''
    + '<svg class="brief-materials__progress-clock" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path>'
      + '<path d="M3 3v5h5"></path>'
      + '<path d="M12 7v5l3 2"></path>'
    + '</svg>';

  function featureLabel(feature) {
    if (feature === "both") return "resume + cover letter";
    if (feature === "resume") return "resume";
    if (feature === "cover_letter") return "cover letter";
    return "materials";
  }

  /* Maps the watcher's progress.phase to a JobBored-flavoured message
     when the watcher hasn't supplied one of its own. Keeping these
     concise + warm; Winky can still override per-run. */
  function defaultPhaseMessage(phase, feature) {
    var label = featureLabel(feature);
    switch (phase) {
      case "queued":         return "Winky is queuing up your " + label + "…";
      case "drafting":       return "Winky is drafting your " + label + "…";
      case "rendering_pdf":  return "Polishing the PDFs…";
      case "verifying":      return "Double-checking the outputs…";
      case "complete":       return "Done! Files are syncing back to JobBored.";
      case "failed":         return "Something went sideways. Check Telegram.";
      default:               return "Winky is on it…";
    }
  }

  function formatElapsed(seconds) {
    var n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) n = 0;
    var m = Math.floor(n / 60);
    var s = Math.floor(n % 60);
    if (m === 0) return s + "s";
    if (m < 60) return m + "m " + (s < 10 ? "0" + s : s) + "s";
    var h = Math.floor(m / 60);
    var mm = m % 60;
    return h + "h " + (mm < 10 ? "0" + mm : mm) + "m";
  }

  /* Compute "live" elapsed seconds from started_at so the UI ticks
     between manifest polls — without this the clock would only jump
     every 3-12s when the manifest refresh fires. */
  function liveElapsedSeconds(progress) {
    if (!progress) return 0;
    if (progress.startedAt) {
      var t = Date.parse(progress.startedAt);
      if (Number.isFinite(t)) {
        return Math.max(0, Math.floor((Date.now() - t) / 1000));
      }
    }
    return Number.isFinite(progress.elapsedSeconds) ? progress.elapsedSeconds : 0;
  }

  /* New rich progress card. Replaces the old single-line pending
     banner. Shows the spinning clock, the phase-specific message,
     a live elapsed timer, and the user's original notes preview. */
  function pendingBannerHtml(pending) {
    if (!pending || !pending.feature) return "";
    var progress = pending.progress || null;
    var phase = (progress && progress.phase) || "queued";
    /* Treat "complete" as a celebratory state — same card structure,
       different visuals (no spin, check icon). Once Winky deletes
       pending.json the whole pending block disappears entirely. */
    var isComplete = phase === "complete";
    var isFailed = phase === "failed";
    var message = (progress && progress.message)
      ? String(progress.message)
      : defaultPhaseMessage(phase, pending.feature);
    var elapsed = liveElapsedSeconds(progress);
    var noteSnippet = "";
    if (pending.notes) {
      var t = String(pending.notes);
      noteSnippet = t.length > 110 ? t.slice(0, 107) + "…" : t;
    }
    var requestedRel = formatRelative(pending.requestedAt);
    var iconHtml = isComplete
      ? ('<svg class="brief-materials__progress-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         + '<polyline points="20 6 9 17 4 12"></polyline></svg>')
      : (isFailed
         ? ('<svg class="brief-materials__progress-failed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<circle cx="12" cy="12" r="10"></circle>'
            + '<line x1="12" y1="8" x2="12" y2="12"></line>'
            + '<line x1="12" y1="16" x2="12.01" y2="16"></line></svg>')
         : PROGRESS_CLOCK_SVG);

    /* Terminal phases (complete/failed) freeze the elapsed counter at
       its final value. Only "live" phases set data-elapsed-started so
       the per-second ticker keeps counting. Otherwise a failed run
       would show its timer creeping up indefinitely. */
    var isLive = !isComplete && !isFailed;
    var elapsedAttr = isLive
      ? ' data-elapsed-started="' + escapeHtml(progress && progress.startedAt || "") + '"'
      : '';
    var elapsedText = isComplete
      ? ""
      : formatElapsed(elapsed);
    /* Failed runs get an action row so the user can dismiss the stuck
       state (we archive pending.json on disk) or re-try (delete +
       re-fire the same request). Without these the FAILED card
       lingers forever, which we saw happen with the
       "missing job-description.md" case. */
    var actionsHtml = "";
    if (isFailed) {
      actionsHtml = '<div class="brief-materials__progress-actions">'
        + '<button type="button" class="brief-materials__btn brief-materials__btn--ghost"'
          + ' data-action="materials-dismiss"'
          + ' data-feature="' + escapeHtml(pending.feature) + '">'
          + 'Dismiss'
        + '</button>'
        + '<button type="button" class="brief-materials__btn brief-materials__btn--primary"'
          + ' data-action="materials-retry"'
          + ' data-feature="' + escapeHtml(pending.feature) + '">'
          + 'Try again'
        + '</button>'
      + '</div>';
    }
    return '<div class="brief-materials__progress" data-phase="' + escapeHtml(phase) + '" aria-live="polite">'
      + '<div class="brief-materials__progress-icon">' + iconHtml + '</div>'
      + '<div class="brief-materials__progress-body">'
        + '<div class="brief-materials__progress-line">'
          + '<span class="brief-materials__progress-eyebrow">'
            + (isComplete ? "MATERIALS READY"
              : (isFailed ? "MATERIALS FAILED" : "DRAFTING IN PROGRESS"))
          + '</span>'
          + '<span class="brief-materials__progress-elapsed"' + elapsedAttr + '>'
            + escapeHtml(elapsedText)
          + '</span>'
        + '</div>'
        + '<div class="brief-materials__progress-message">' + escapeHtml(message) + '</div>'
        + (noteSnippet
            ? '<div class="brief-materials__progress-note">"' + escapeHtml(noteSnippet) + '"</div>'
            : '')
        + '<div class="brief-materials__progress-meta">'
          + (requestedRel ? 'requested ' + escapeHtml(requestedRel) : '')
          + (progress && progress.attempt > 1
              ? ' <span class="brief-materials__dot">·</span> attempt ' + escapeHtml(String(progress.attempt))
              : '')
        + '</div>'
        + actionsHtml
      + '</div>'
      + '</div>';
  }

  function renderManifest(briefEl, manifest, base) {
    if (!briefEl || !manifest) return;
    removeExisting(briefEl);
    var docs = Array.isArray(manifest.documents) ? manifest.documents : [];
    var pending = manifest.pending || null;
    docs.sort(function (a, b) {
      var ra = DOC_LABELS[a.type] && DOC_LABELS[a.type].role === "primary" ? 0 : 1;
      var rb = DOC_LABELS[b.type] && DOC_LABELS[b.type].role === "primary" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      var oa = ["resume", "cover_letter", "job_analysis", "qa_report", "job_description", "manual_apply_checklist"];
      return oa.indexOf(a.type) - oa.indexOf(b.type);
    });
    var cards = docs.map(function (d) { return renderCard(manifest.slug, d, base, pending); });
    /* When a request is in flight for a doc type that doesn't yet
       exist on disk, inject a placeholder card so the user sees the
       request took effect even before Hermes ships the first file.
       Skip placeholders when the run has terminated (failed/complete)
       — a "GENERATING…" card alongside a "MATERIALS FAILED" banner is
       contradictory. */
    var pendingPhase = pending && pending.progress && pending.progress.phase;
    var pendingIsLive = pending && pendingPhase !== "failed" && pendingPhase !== "complete";
    if (pendingIsLive) {
      var existingTypes = {};
      docs.forEach(function (d) { existingTypes[d.type] = true; });
      var typesForFeature = pending.feature === "both"
        ? ["resume", "cover_letter"]
        : (pending.feature === "resume" ? ["resume"] : (pending.feature === "cover_letter" ? ["cover_letter"] : []));
      typesForFeature.forEach(function (t) {
        if (!existingTypes[t]) cards.unshift(renderPendingPlaceholderCard(manifest.slug, t));
      });
    }
    var derivedTag = manifest.derived
      ? '<span class="brief-materials__derived" title="Manifest derived from disk (no manifest.json on disk)">DERIVED</span>'
      : "";
    var bannerHtml = pendingBannerHtml(pending);
    var bodyHtml = cards.length
      ? '<div class="brief-materials__grid">' + cards.join("") + '</div>'
      : '<p class="brief-materials__empty">Folder is on disk but no allowlisted documents are ready yet.</p>';
    var html = '<section class="' + SECTION_CLASS + '" aria-label="Application materials" data-slug="' + escapeHtml(manifest.slug) + '">'
      + '<header class="brief-materials__head">'
        + '<h3 class="section-label">Application Materials</h3>'
        + '<span class="brief-materials__eyebrow">' + escapeHtml(manifest.slug) + '</span>'
        + derivedTag
      + '</header>'
      + bannerHtml
      + bodyHtml
      + '</section>';
    appendSection(briefEl, html);
    wireSection(briefEl);
    /* Start the per-second elapsed ticker iff a pending progress card
       is on screen. The ticker self-stops when the card disappears. */
    if (pending) ensureElapsedTicker();
  }

  function renderError(briefEl, message) {
    if (!briefEl) return;
    removeExisting(briefEl);
    var html = '<section class="' + SECTION_CLASS + ' brief-materials--error" aria-label="Application materials">'
      + '<header class="brief-materials__head">'
        + '<h3 class="section-label">Application Materials</h3>'
        + '<span class="brief-materials__eyebrow">LOCAL · ~/.hermes/job-hunt</span>'
      + '</header>'
      + '<p class="brief-materials__empty">'
        + escapeHtml(message || "Local materials server is unreachable.")
      + '</p>'
      + '</section>';
    appendSection(briefEl, html);
  }

  function removeExisting(briefEl) {
    if (!briefEl) return;
    var prior = briefEl.querySelector("." + SECTION_CLASS);
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);
  }

  function appendSection(briefEl, html) {
    if (!briefEl) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var node = tmp.firstElementChild;
    if (node) briefEl.appendChild(node);
  }

  function dispatch(name, detail) {
    if (typeof root.CustomEvent !== "function") return;
    try {
      var ev = new root.CustomEvent(name, { detail: detail || {}, bubbles: true });
      if (typeof document !== "undefined" && document.dispatchEvent) {
        document.dispatchEvent(ev);
      }
      if (typeof root.dispatchEvent === "function") root.dispatchEvent(ev);
    } catch (e) { /* swallow */ }
  }

  function wireSection(briefEl) {
    if (!briefEl) return;
    var section = briefEl.querySelector("." + SECTION_CLASS);
    if (!section || section.__wired) return;
    section.__wired = true;
    section.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== section) {
        if (t.getAttribute) {
          var action = t.getAttribute("data-action");
          if (action === "materials-preview" || action === "materials-download") {
            dispatch(
              action === "materials-preview"
                ? "jb:role:materials:opened"
                : "jb:role:materials:downloaded",
              {
                slug: section.getAttribute("data-slug") || "",
                filename: t.getAttribute("data-filename") || "",
              },
            );
            return;
          }
          if (action === "materials-dismiss") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            handleDismiss(section.getAttribute("data-slug") || "");
            return;
          }
          if (action === "materials-retry") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            handleRetry(
              section.getAttribute("data-slug") || "",
              t.getAttribute("data-feature") || "",
            );
            return;
          }
        }
        t = t.parentNode;
      }
    });
  }

  function handleDismiss(slug) {
    if (!slug || !currentContext) return;
    var base = currentContext.base;
    postJson(base + "/api/applications/" + encodeURIComponent(slug) + "/dismiss", {})
      .then(function () {
        /* Re-fetch the manifest so the pending block disappears
           cleanly. The polling loop is already idle on a terminal
           phase, so this is the only nudge needed. */
        return fetchJson(base + "/api/applications/" + encodeURIComponent(slug) + "/manifest");
      })
      .then(function (manifest) {
        var region = document.querySelector(REGION_SELECTOR);
        var brief = region && region.querySelector(BRIEF_SELECTOR);
        if (brief) renderManifest(brief, manifest, base);
      })
      .catch(function (err) {
        var brief = document.querySelector(REGION_SELECTOR + " " + BRIEF_SELECTOR);
        if (brief) renderError(brief, "Couldn't dismiss: " + ((err && err.message) || "unknown error"));
      });
  }

  function handleRetry(slug, feature) {
    if (!slug || !feature || !currentContext) return;
    var ctx = currentContext;
    /* Retry is dismiss + immediate re-request, reusing the original
       notes and metadata so the user doesn't have to retype. */
    var prevNotes = "";
    var region = document.querySelector(REGION_SELECTOR);
    var brief = region && region.querySelector(BRIEF_SELECTOR);
    var noteEl = brief && brief.querySelector(".brief-materials__progress-note");
    if (noteEl) {
      prevNotes = String(noteEl.textContent || "").replace(/^"|"$/g, "").trim();
    }
    postJson(ctx.base + "/api/applications/" + encodeURIComponent(slug) + "/dismiss", {})
      .catch(function () { /* dismiss may 404 if Winky already cleared it — that's fine */ })
      .then(function () {
        return postJson(ctx.base + "/api/applications/" + encodeURIComponent(slug) + "/request", {
          slug: slug,
          company: ctx.company,
          title: ctx.title,
          feature: feature,
          jobUrl: ctx.jobUrl,
          notes: prevNotes,
        });
      })
      .then(function () {
        return fetchJson(ctx.base + "/api/applications/" + encodeURIComponent(slug) + "/manifest");
      })
      .then(function (manifest) {
        var brief2 = document.querySelector(REGION_SELECTOR + " " + BRIEF_SELECTOR);
        if (!brief2) return;
        renderManifest(brief2, manifest, ctx.base);
        if (manifest.pending) startPolling(manifest.slug, ctx.base);
      })
      .catch(function (err) {
        var brief3 = document.querySelector(REGION_SELECTOR + " " + BRIEF_SELECTOR);
        if (brief3) renderError(brief3, "Retry failed: " + ((err && err.message) || "unknown error"));
      });
  }

  /* -------------------- network -------------------- */

  function fetchJson(url) {
    if (typeof fetch !== "function") {
      return Promise.reject(new Error("fetch unavailable"));
    }
    return fetch(url, { credentials: "omit", cache: "no-store" }).then(function (res) {
      if (!res.ok) {
        var err = new Error("Materials server returned " + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function postJson(url, body) {
    if (typeof fetch !== "function") {
      return Promise.reject(new Error("fetch unavailable"));
    }
    return fetch(url, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.text().then(function (txt) {
        var parsed = null;
        if (txt) {
          try { parsed = JSON.parse(txt); } catch (e) { parsed = null; }
        }
        if (!res.ok) {
          var err = new Error((parsed && parsed.error) || ("Materials request returned " + res.status));
          err.status = res.status;
          err.body = parsed;
          throw err;
        }
        return parsed || {};
      });
    });
  }

  /* Per-session cache so opening a role twice doesn't re-hit the server.
     Cleared on `jb:role:closed` to keep the cache short. */
  var applicationsPromise = null;
  function getApplications(base, opts) {
    if (opts && opts.refresh) applicationsPromise = null;
    if (applicationsPromise) return applicationsPromise;
    applicationsPromise = fetchJson(base + "/api/applications").then(function (body) {
      return (body && Array.isArray(body.applications)) ? body.applications : [];
    });
    return applicationsPromise;
  }

  function clearCache() {
    applicationsPromise = null;
    stopPolling();
  }

  /* -------------------- pending poller --------------------
     When a draft request fires (or the manifest already has a pending
     state on first open) we poll the manifest endpoint until either
     the pending state clears (Hermes removed pending.json) or new
     documents appear. Capped at ~10 minutes; the next manual open
     resumes polling fresh. */

  var poller = null;
  function stopPolling() {
    if (poller) {
      clearTimeout(poller.timeoutId);
      poller = null;
    }
    stopElapsedTicker();
  }

  /* The manifest polls at 3-12s intervals which is too slow for a
     "live" elapsed clock. This ticker just bumps the visible "Xm Ys"
     once a second by reading data-elapsed-started off the DOM. It's
     a separate concern from the manifest poll so it can keep ticking
     even when a manifest fetch is in flight. */
  var elapsedTickerId = null;
  function stopElapsedTicker() {
    if (elapsedTickerId != null) {
      clearInterval(elapsedTickerId);
      elapsedTickerId = null;
    }
  }
  function ensureElapsedTicker() {
    if (elapsedTickerId != null) return;
    elapsedTickerId = setInterval(function () {
      var nodes = document.querySelectorAll(".brief-materials__progress-elapsed[data-elapsed-started]");
      if (!nodes || !nodes.length) {
        stopElapsedTicker();
        return;
      }
      var now = Date.now();
      for (var i = 0; i < nodes.length; i++) {
        var iso = nodes[i].getAttribute("data-elapsed-started");
        if (!iso) continue;
        var t = Date.parse(iso);
        if (!Number.isFinite(t)) continue;
        var s = Math.max(0, Math.floor((now - t) / 1000));
        nodes[i].textContent = formatElapsed(s);
      }
    }, 1000);
  }

  function startPolling(slug, base) {
    stopPolling();
    var startedAt = Date.now();
    var attempts = 0;
    var maxMs = 10 * 60 * 1000;
    var minDelay = 3000;
    var maxDelay = 12000;

    function tick() {
      attempts += 1;
      if (Date.now() - startedAt > maxMs) {
        stopPolling();
        return;
      }
      fetchJson(base + "/api/applications/" + encodeURIComponent(slug) + "/manifest")
        .then(function (manifest) {
          var region = document.querySelector(REGION_SELECTOR);
          var brief = region && region.querySelector(BRIEF_SELECTOR);
          if (!brief) return;
          renderManifest(brief, manifest, base);
          if (manifest.pending) {
            var delay = Math.min(maxDelay, minDelay + attempts * 500);
            poller = { timeoutId: setTimeout(tick, delay) };
          } else {
            stopPolling();
          }
        })
        .catch(function () {
          /* Stay quiet on transient errors; back off and try again. */
          poller = { timeoutId: setTimeout(tick, maxDelay) };
        });
    }
    poller = { timeoutId: setTimeout(tick, minDelay) };
  }

  /* -------------------- top-level orchestration -------------------- */

  /* Track the current open role's resolved slug so request handlers
     and pollers don't have to re-derive it on each click. */
  var currentContext = null;

  function getCurrentJob(jobKey) {
    var api = root.JobBoredDawn && root.JobBoredDawn.data;
    if (!api || typeof api.getRoleViewModel !== "function") return null;
    try { return api.getRoleViewModel(jobKey); }
    catch (e) { return null; }
  }

  function loadForOpenRole(jobKey) {
    if (!shouldRun()) return;
    var region = document.querySelector(REGION_SELECTOR);
    if (!region) return;
    var brief = region.querySelector(BRIEF_SELECTOR);
    if (!brief) return;

    var vm = getCurrentJob(jobKey);
    var job = vm && vm.job;
    if (!job || (!job.company && !job.role)) return;

    var base = getBaseUrl();
    if (!base) {
      currentContext = null;
      renderError(brief, "Run npm start so the local materials server is available.");
      return;
    }

    getApplications(base).then(function (apps) {
      var picked = pickApplication(job, apps);
      var slug = picked ? picked.slug : buildCandidateSlug(job);
      currentContext = {
        jobKey: jobKey,
        slug: slug,
        company: String(job.company || ""),
        title: String(job.role || ""),
        jobUrl: pickPostingUrl(job),
        base: base,
      };
      if (!picked) {
        if (root.console && root.console.info) {
          root.console.info(
            "[role-materials] no match for",
            { company: job.company, role: job.role, tried: buildCandidateSlug(job) },
            "available:", apps.map(function (a) { return a.slug; }),
          );
        }
        /* Even without a folder, the request endpoint will create one
           and write pending.json, so we still expose the empty state
           which now includes a hint about the dossier CTAs above. */
        renderEmpty(brief, {
          note: "No drafts on disk yet. Use Draft cover letter / Tailor resume above to request a tailored pass.",
        });
        return;
      }
      return fetchJson(base + "/api/applications/" + encodeURIComponent(picked.slug) + "/manifest")
        .then(function (manifest) {
          renderManifest(brief, manifest, base);
          if (manifest.pending) startPolling(manifest.slug, base);
          else stopPolling();
        });
    }).catch(function (err) {
      var msg = err && err.status === 0
        ? "Local materials server is unreachable."
        : (err && err.message) || "Could not load application materials.";
      renderError(brief, msg);
    });
  }

  function pickPostingUrl(job) {
    if (!job || !Array.isArray(job.links)) return "";
    for (var i = 0; i < job.links.length; i++) {
      var l = job.links[i];
      var href = l && l.href ? String(l.href).trim() : "";
      if (/^https?:/i.test(href)) return href;
    }
    return "";
  }

  /* -------------------- inline notes form --------------------
     Replaces the legacy `window.prompt()` capture. Renders a small
     non-modal form just above the materials section so the user can
     type notes for Hermes without leaving the page or fighting a
     browser-level prompt dialog. */

  function notesFormHtml(feature) {
    var heading = feature === "cover_letter"
      ? "Notes for the cover letter"
      : "Notes for the resume tailoring";
    var placeholder = "What angle should Hermes emphasise? Tone? Must-shows?";
    return '<form class="brief-materials__notes-form" aria-label="' + escapeHtml(heading) + '">'
      + '<header class="brief-materials__notes-head">'
        + '<span class="brief-materials__notes-title">' + escapeHtml(heading) + '</span>'
        + '<span class="brief-materials__notes-eyebrow">NOTES FOR HERMES</span>'
      + '</header>'
      + '<textarea class="brief-materials__notes-textarea" rows="4" placeholder="' + escapeHtml(placeholder) + '"></textarea>'
      + '<footer class="brief-materials__notes-actions">'
        + '<button type="button" class="brief-materials__btn brief-materials__btn--ghost" data-action="notes-cancel">Cancel</button>'
        + '<button type="submit" class="brief-materials__btn brief-materials__btn--primary" data-action="notes-send">Send to Hermes</button>'
      + '</footer>'
      + '</form>';
  }

  function showNotesForm(feature, onSubmit) {
    if (!shouldRun()) return;
    var region = document.querySelector(REGION_SELECTOR);
    var brief = region && region.querySelector(BRIEF_SELECTOR);
    if (!brief) return;

    /* Remove any prior open form so a second click replaces it cleanly. */
    var prior = brief.querySelector(".brief-materials__notes-form");
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    var triggerAction = feature === "cover_letter" ? "resume-cover" : "resume-tailor";
    var trigger = region.querySelector('[data-action="' + triggerAction + '"]');

    var tmp = document.createElement("div");
    tmp.innerHTML = notesFormHtml(feature);
    var formNode = tmp.firstElementChild;
    if (!formNode) return;

    /* Place the form as a sibling immediately above .brief-materials
       so that re-renders of the section don't blow it away. If the
       section isn't mounted yet, fall back to appending to brief. */
    var section = brief.querySelector("." + SECTION_CLASS);
    if (section && section.parentNode) {
      section.parentNode.insertBefore(formNode, section);
    } else {
      brief.appendChild(formNode);
    }

    var textarea = formNode.querySelector(".brief-materials__notes-textarea");
    var cancelBtn = formNode.querySelector('[data-action="notes-cancel"]');

    var closed = false;
    /* `submitted` flips true when the user clicks Send. Close() uses
       this to decide whether to refocus the trigger (Cancel/Esc — no
       state change) or scroll to the new progress card (Send — the
       interesting content moved down, not up). */
    var submitted = false;
    function close() {
      if (closed) return;
      closed = true;
      if (formNode && formNode.parentNode) formNode.parentNode.removeChild(formNode);
      if (typeof document !== "undefined" && document.removeEventListener) {
        document.removeEventListener("keydown", onKey, true);
      }
      if (submitted) {
        /* On submit, the action moved down to the new progress card.
           Smoothly scroll it into view so the user's eye follows the
           work instead of being yanked back up to the CTA. */
        var progressEl = document.querySelector("." + SECTION_CLASS + " .brief-materials__progress");
        if (progressEl && typeof progressEl.scrollIntoView === "function") {
          try {
            progressEl.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch (e) {
            try { progressEl.scrollIntoView(); } catch (e2) { /* ignored */ }
          }
        }
      } else if (trigger && typeof trigger.focus === "function") {
        /* On cancel/escape, return focus to the trigger button. Use
           preventScroll so the trigger doesn't yank the viewport. */
        try { trigger.focus({ preventScroll: true }); }
        catch (e) {
          try { trigger.focus(); } catch (e2) { /* ignored */ }
        }
      }
    }

    function onKey(e) {
      var key = e && (e.key || e.keyCode);
      if (key === "Escape" || key === "Esc" || key === 27) {
        if (typeof e.preventDefault === "function") e.preventDefault();
        close();
      }
    }

    formNode.addEventListener("submit", function (e) {
      if (typeof e.preventDefault === "function") e.preventDefault();
      submitted = true;
      var notes = (textarea && textarea.value) ? String(textarea.value).trim() : "";
      /* Whimsy beat: briefly show an "On it!" state before tearing
         the form down. Keeps the click feeling deliberate and gives
         the optimistic UI underneath time to render the progress
         card. ~900ms is short enough not to feel like a hang. */
      formNode.classList.add("brief-materials__notes-form--sent");
      var sendBtn = formNode.querySelector('[data-action="notes-send"]');
      if (sendBtn) {
        sendBtn.setAttribute("disabled", "disabled");
        sendBtn.innerHTML = ''
          + '<span class="brief-materials__notes-sent-icon" aria-hidden="true">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
              + '<polyline points="20 6 9 17 4 12"></polyline></svg>'
          + '</span>'
          + 'On it!';
      }
      if (cancelBtn) cancelBtn.setAttribute("disabled", "disabled");
      if (textarea) textarea.setAttribute("disabled", "disabled");
      /* Fire the request immediately — don't make the user wait the
         celebration delay. The celebration is purely visual. */
      if (typeof onSubmit === "function") onSubmit(notes);
      setTimeout(close, 900);
    });
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function (e) {
        if (typeof e.preventDefault === "function") e.preventDefault();
        close();
      });
    }
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("keydown", onKey, true);
    }

    if (textarea && typeof textarea.focus === "function") {
      try { textarea.focus(); } catch (e) { /* ignored */ }
    }
  }

  /* Handle a dossier CTA action by POSTing to the request endpoint.
     If the request fires successfully, swap the materials section to
     a pending state and start polling. If it fails, surface the
     error inline (no toast framework wired in yet). */
  function handleDraftRequest(feature) {
    if (!shouldRun()) return;
    if (!currentContext) {
      if (root.console && root.console.warn) {
        root.console.warn("[role-materials] no open role context for request");
      }
      return;
    }
    var ctx = currentContext;
    var region = document.querySelector(REGION_SELECTOR);
    var brief = region && region.querySelector(BRIEF_SELECTOR);
    if (!brief) return;

    showNotesForm(feature, function (notes) {
      submitDraftRequest(ctx, feature, notes);
    });
  }

  function submitDraftRequest(ctx, feature, notes) {
    var region = document.querySelector(REGION_SELECTOR);
    var brief = region && region.querySelector(BRIEF_SELECTOR);
    if (!brief) return;

    /* Optimistic UI: stamp a fresh "pending" banner immediately so the
       click visibly registers, even before the server responds. */
    var optimisticManifest = {
      slug: ctx.slug,
      company: ctx.company,
      title: ctx.title,
      derived: true,
      documents: [],
      pending: {
        feature: feature,
        requestedAt: new Date().toISOString(),
        notes: notes,
        source: "jobbored-dossier",
      },
    };
    /* Merge with whatever the manifest endpoint last returned so
       existing cards stay visible while the request is in flight. */
    fetchJson(ctx.base + "/api/applications/" + encodeURIComponent(ctx.slug) + "/manifest")
      .catch(function () { return null; })
      .then(function (manifest) {
        var base = manifest || optimisticManifest;
        if (manifest) {
          base.pending = optimisticManifest.pending;
        }
        renderManifest(brief, base, ctx.base);
      });

    postJson(ctx.base + "/api/applications/" + encodeURIComponent(ctx.slug) + "/request", {
      slug: ctx.slug,
      company: ctx.company,
      title: ctx.title,
      feature: feature,
      jobUrl: ctx.jobUrl,
      notes: notes,
    }).then(function () {
      /* Re-fetch so we render the real pending.json the server wrote. */
      return fetchJson(ctx.base + "/api/applications/" + encodeURIComponent(ctx.slug) + "/manifest");
    }).then(function (manifest) {
      var brief2 = document.querySelector(REGION_SELECTOR + " " + BRIEF_SELECTOR);
      if (!brief2) return;
      /* Force the applications cache to refresh so the next role open
         sees the new folder (Hermes creates it when none existed). */
      getApplications(ctx.base, { refresh: true });
      renderManifest(brief2, manifest, ctx.base);
      if (manifest.pending) startPolling(manifest.slug, ctx.base);
    }).catch(function (err) {
      var brief3 = document.querySelector(REGION_SELECTOR + " " + BRIEF_SELECTOR);
      if (!brief3) return;
      renderError(brief3, "Materials request failed: " + ((err && err.message) || "Unknown error"));
    });
  }

  /* Re-entrancy guard: role.js used to dispatch `jb:role:action` on
     both document and window, which paired with our duplicate listener
     could fire `handleDraftRequest` twice for one click. Even with the
     duplicate listener removed, defensive dedupe absorbs rapid double
     clicks from any source. */
  var lastActionAt = 0;
  var lastActionTuple = "";
  var ACTION_DEDUPE_MS = 500;

  function onRoleAction(e) {
    var detail = e && e.detail;
    if (!detail) return;
    if (detail.action !== "resume-cover" && detail.action !== "resume-tailor") return;
    var tuple = String(detail.jobKey == null ? "" : detail.jobKey) + "|" + detail.action;
    var now = Date.now();
    if (tuple === lastActionTuple && (now - lastActionAt) < ACTION_DEDUPE_MS) return;
    lastActionTuple = tuple;
    lastActionAt = now;
    if (detail.action === "resume-cover") {
      handleDraftRequest("cover_letter");
    } else {
      handleDraftRequest("resume");
    }
  }

  function onOpened(e) {
    var key = e && e.detail && e.detail.jobKey;
    /* role.js renders the brief synchronously on this event. Defer to a
       microtask so brief markup is in place before we append. */
    if (typeof root.queueMicrotask === "function") {
      root.queueMicrotask(function () { loadForOpenRole(key); });
    } else {
      setTimeout(function () { loadForOpenRole(key); }, 0);
    }
  }
  function onClosed() {
    clearCache();
  }

  function onEnriched(e) {
    /* Brief re-renders when enrichment lands; reattach our section. */
    var k = e && e.detail && e.detail.jobKey;
    if (typeof root.queueMicrotask === "function") {
      root.queueMicrotask(function () { loadForOpenRole(k); });
    } else {
      setTimeout(function () { loadForOpenRole(k); }, 0);
    }
  }

  function init() {
    if (!shouldRun()) {
      if (typeof root.MutationObserver === "function" && document.body) {
        var mo = new root.MutationObserver(function () {
          if (shouldRun()) { init(); mo.disconnect(); }
        });
        mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      }
      return;
    }
    root.addEventListener("jb:role:opened", onOpened);
    root.addEventListener("jb:role:closed", onClosed);
    root.addEventListener("jb:role:enriched", onEnriched);
    /* role.js dispatches jb:role:action on both document and window.
       Listen on document only so the duplicate window dispatch does
       not fire a second handler invocation; the re-entrancy guard
       inside onRoleAction is a belt-and-braces backup. */
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("jb:role:action", onRoleAction);
    }
    /* On a hard reload the role can already be open when init() runs,
       which means jb:role:opened never fires. app.js dispatches
       jb:pipeline:rendered after the kanban paints — at that point
       the open-role view model is populated and we can finally load
       the materials panel. */
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("jb:pipeline:rendered", function () {
        var openKey = root.JobBoredFlowing
          && root.JobBoredFlowing.openRole
          && root.JobBoredFlowing.openRole.get
          && root.JobBoredFlowing.openRole.get();
        if (openKey) loadForOpenRole(openKey);
      });
    }
    /* If a role was already open at script load time, render once. */
    var key = root.JobBoredFlowing
      && root.JobBoredFlowing.openRole
      && root.JobBoredFlowing.openRole.get
      && root.JobBoredFlowing.openRole.get();
    if (key) {
      if (typeof root.queueMicrotask === "function") {
        root.queueMicrotask(function () { loadForOpenRole(key); });
      } else {
        setTimeout(function () { loadForOpenRole(key); }, 0);
      }
    }
  }

  if (typeof document !== "undefined" && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* -------------------- expose for tests -------------------- */

  root.JobBoredRoleMaterials = {
    slugify: slugify,
    buildCandidateSlug: buildCandidateSlug,
    pickApplication: pickApplication,
    renderManifest: renderManifest,
    renderEmpty: renderEmpty,
    renderError: renderError,
    /** Test-only hook to inject a fresh applications list. */
    _resetCache: clearCache,
  };
})(typeof window !== "undefined" ? window : this);
