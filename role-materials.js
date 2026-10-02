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
     isn't on disk we try a suffix-stripped company/title exact match,
     then a conservative company-prefix match where the on-disk title
     must extend the current role title. If no candidate matches, the
     section is hidden — never rendered with empty cards.

   Activation: body.jb-v2 only. Off-flag: no-op.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  /* E4: the JobBored API transport. Attaches the hosted token when
     hosted-api-auth.js is loaded; plain fetch otherwise. */
  function apiFetch(url, init) {
    var auth = root && root.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    return fetch(url, init);
  }

  var REGION_SELECTOR = '[data-region="role"]';
  var BRIEF_SELECTOR = '[data-mount="brief"]';
  var MATERIALS_MOUNT_SELECTOR = '[data-mount="materials"]';
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
    /* U-3: the ATS plain-text twins the server already writes and serves. */
    "resume.txt": { format: "TXT", inline: false },
    "cover-letter.txt": { format: "TXT", inline: false },
  };

  /* Wave 2 (U-1, U-3, U-4, U-6, U-7): pure view helpers live in
     materials-insights.js. Without it the rows paint as before. */
  function insights() {
    var mi = root.JobBoredMaterialsInsights;
    return mi && typeof mi.timelineHtml === "function" ? mi : null;
  }

  var DOC_LABELS = {
    resume: { label: "Tailored Resume", role: "primary" },
    cover_letter: { label: "Cover Letter", role: "primary" },
    job_analysis: { label: "Job Analysis", role: "support" },
    qa_report: { label: "QA Report", role: "support" },
    job_description: { label: "Job Description", role: "support" },
    manual_apply_checklist: { label: "Apply Checklist", role: "support" },
  };

  /* UX01 lane E. C11: the server refuses to draft without the user's own
     resume and says so with this code (server sub-lane contract). */
  var RESUME_REQUIRED_CODE = "resume_required";
  /* C12 (TA-26): a run past this is "taking longer than usual" — about twice
     the median local run, instead of silence for 30 minutes. */
  var STALL_NOTICE_SECONDS = 180;
  /* C12 (TA-03): auto-draft on a move to Researching is opt-in. */
  var AUTO_DRAFT_STORAGE_KEY = "jobBored:autoDraft:v1";
  /* C12 (TA-05): how long an optimistic "queued" row outlives a manifest
     that has not caught up with the request yet. */
  var OPTIMISTIC_HOLD_MS = 90 * 1000;
  var START_COMMAND = "npm start";

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
   * Returns the original URL only if it parses as http(s); otherwise empty
   * string. Mirrors JobBoredApp.utils.safeHref (app-utils.js:22) so a
   * pasted javascript: / data: jobUrl can't render as a clickable
   * script-exec anchor in the Source URL row. The escapeHtml wrap on the
   * returned value is still required — safeHref returns the raw URL, not
   * an HTML-safe one.
   */
  function safeHref(url) {
    if (!url) return "";
    var s = String(url).trim();
    if (/^https?:\/\//i.test(s)) return s;
    return "";
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
    }).map(function (t) {
      return stripFusedCompanyNoise(t);
    }).filter(function (t) {
      return t && !COMPANY_NOISE[t];
    });
  }

  function stripFusedCompanyNoise(token) {
    var t = String(token || "");
    var suffixes = ["corporation", "incorporated", "llc", "ltd", "corp", "pbc", "plc", "gmbh"];
    for (var i = 0; i < suffixes.length; i++) {
      var suffix = suffixes[i];
      if (t.length > suffix.length + 2 && t.slice(-suffix.length) === suffix) {
        return t.slice(0, -suffix.length);
      }
    }
    return t;
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

  var TITLE_NOISE = {
    a: 1, an: 1, and: 1, at: 1, for: 1, in: 1, of: 1, on: 1, the: 1, to: 1, with: 1,
  };

  var TRAILING_TITLE_NOISE = {
    remote: 1, hybrid: 1, onsite: 1, job: 1, jobs: 1, role: 1, position: 1,
  };

  function titleWordsFromSlug(slug) {
    var words = String(slug || "").split("-").filter(function (word) {
      return word && !TITLE_NOISE[word];
    });
    while (words.length && TRAILING_TITLE_NOISE[words[words.length - 1]]) {
      words.pop();
    }
    return words;
  }

  function dropLeadingCompanyTailWords(words, companyTokensForJob) {
    var out = words.slice();
    for (var i = 1; i < companyTokensForJob.length && out.length; i++) {
      if (out[0] !== companyTokensForJob[i]) break;
      out.shift();
    }
    return out;
  }

  function titleWordsPrefixMatch(targetWords, candidateWords) {
    if (!targetWords.length || candidateWords.length < targetWords.length) return false;
    for (var i = 0; i < targetWords.length; i++) {
      if (candidateWords[i] !== targetWords[i]) return false;
    }
    return true;
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
       resolves. We then require the folder title to extend the current
       role title, so another same-employer position cannot borrow its
       materials just because it shares one generic word. */
    var head = tokens[0];
    var titleSlug = slugify(job && job.role);
    var titleWords = titleWordsFromSlug(titleSlug);
    if (!titleWords.length) return null;
    var normalizedTarget = tokens.join("-") + "-" + titleWords.join("-");
    var normalizedExact = applications.find(function (a) {
      return a && a.slug === normalizedTarget;
    });
    if (normalizedExact) return normalizedExact;

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
      var candidateTitleWords = dropLeadingCompanyTailWords(titleWordsFromSlug(tail), tokens);
      if (titleWords.length < 3 && candidateTitleWords.length !== titleWords.length) return;
      if (!titleWordsPrefixMatch(titleWords, candidateTitleWords)) return;
      var extraTitleWords = Math.max(0, candidateTitleWords.length - titleWords.length);
      var score = (titleWords.length * 3) + companyBonus - extraTitleWords;
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
    return doc.files.find(function (f) {
      return f && String(f.format || "").toLowerCase() === "pdf";
    }) || null;
  }

  /* U17: a document whose PDF never rendered still downloads — the HTML
     the preview shows, which prints to a PDF. */
  function pickHtmlDownload(doc) {
    if (!doc || !Array.isArray(doc.files)) return null;
    return doc.files.find(function (f) {
      return f && String(f.format || "").toLowerCase() === "html" && ALLOWED_FILES[f.filename];
    }) || null;
  }

  function fileVersion(file) {
    if (!file) return "";
    var modified = file.modifiedAt ? String(file.modifiedAt) : "";
    var size = Number(file.size);
    var sizeText = Number.isFinite(size) ? String(size) : "";
    if (!modified && !sizeText) return "";
    return modified + "|" + sizeText;
  }

  function fileUrl(base, slug, filename, opts) {
    var params = [];
    if (opts && opts.download) params.push("download=1");
    if (opts && opts.version) params.push("v=" + encodeURIComponent(String(opts.version)));
    var qs = params.length ? "?" + params.join("&") : "";
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

  function getLocalMaterialsBaseUrl() {
    return "http://127.0.0.1:3847";
  }

  function isLocalMaterialsBase(base) {
    return String(base || "").replace(/\/+$/, "") === getLocalMaterialsBaseUrl();
  }

  /* Repair / Preview / Download PDF for one document. Shared by the legacy
     panel card and the Case's compact rows so the allowlist, the inline-vs-
     download split and the cache-busting version all live in one place;
     `cls(kind)` supplies each host's own button classes. */
  function docActionButtons(slug, doc, base, primaryQualityIssue, cls, opts) {
    var o = opts || {};
    var preview = pickPreviewFile(doc);
    var download = pickDownloadFile(doc);
    var hasPreview = !!(preview && (ALLOWED_FILES[preview.filename] || {}).inline);
    var typeAttr = escapeHtml(doc.type);
    var actions = [];
    if (primaryQualityIssue) {
      actions.push(
        '<button type="button" class="' + cls("primary") + '"'
        + ' data-action="materials-repair"'
        + ' data-feature="' + typeAttr + '"'
        + '>Repair</button>'
      );
    }
    if (hasPreview && preview) {
      actions.push(
        '<a class="' + cls("primary") + '"'
        + ' href="' + escapeHtml(fileUrl(base, slug, preview.filename)) + '"'
        + ' target="_blank" rel="noopener"'
        + ' data-action="materials-preview"'
        + ' data-filename="' + escapeHtml(preview.filename) + '"'
        + '>Preview</a>'
      );
    }
    var html = download ? null : pickHtmlDownload(doc);
    var mi = o.menu ? insights() : null;
    if (mi && (doc.type === "resume" || doc.type === "cover_letter")) {
      /* U-3: one Download menu (PDF, ATS text, Word, LinkedIn copy). */
      var txt = doc.text && doc.text.filename && ALLOWED_FILES[doc.text.filename] ? doc.text : null;
      var docxName = doc.type === "resume" ? "resume.docx" : "cover-letter.docx";
      var menu = mi.downloadMenuHtml({
        type: doc.type,
        pdfHref: download ? fileUrl(base, slug, download.filename, { download: true, version: fileVersion(download) }) : "",
        htmlHref: html ? fileUrl(base, slug, html.filename, { download: true, version: fileVersion(html) }) : "",
        txtHref: txt ? fileUrl(base, slug, txt.filename, { download: true, version: fileVersion(txt) }) : "",
        docxHref: doc.exports && doc.exports.docx ? exportUrl(base, slug, docxName, { download: true, version: fileVersion(download || txt) }) : "",
        linkedin: !!(doc.type === "resume" && doc.exports && doc.exports.linkedin),
        fail: !!o.fail,
      });
      if (menu) actions.push(menu);
    } else if (download || html) {
      var file = download || html;
      actions.push(
        '<a class="' + cls("ghost") + '"'
        + ' href="' + escapeHtml(fileUrl(base, slug, file.filename, {
          download: true,
          version: fileVersion(file),
        })) + '"'
        + ' download'
        + ' data-action="materials-download"'
        + ' data-filename="' + escapeHtml(file.filename) + '"'
        + (o.fail ? ' data-gate="fail"' : "")
        + '>' + (download ? "Download PDF" : "Download HTML") + '</a>'
      );
    }
    return actions;
  }

  function exportUrl(base, slug, name, opts) {
    var params = [];
    if (opts && opts.download) params.push("download=1");
    if (opts && opts.version) params.push("v=" + encodeURIComponent(String(opts.version)));
    return base + "/api/applications/" + encodeURIComponent(slug)
      + "/export/" + encodeURIComponent(name) + (params.length ? "?" + params.join("&") : "");
  }

  function renderCard(slug, doc, base, pending, identity, quality, manifest) {
    var meta = DOC_LABELS[doc.type] || { label: doc.label || doc.type, role: "support" };
    var primaryFile = ALLOWED_FILES[doc.primary] || null;
    var formats = doc.files.map(function (f) {
      return (ALLOWED_FILES[f.filename] && ALLOWED_FILES[f.filename].format) || (f.format || "").toUpperCase();
    });
    var size = primaryFile && doc.files.length
      ? formatSize((doc.files.find(function (f) { return f.filename === doc.primary; }) || doc.files[0]).size)
      : "";
    var updatedRel = formatRelative(doc.lastModifiedAt);
    var typeAttr = escapeHtml(doc.type);
    /* No "Generating…" pill on ready cards — the big progress banner
       above already owns that signal. We keep "Ready" so users see
       the card status at a glance. */
    var qualityIssues = quality && Array.isArray(quality.issues)
      ? quality.issues
      : [];
    var primaryQualityIssue = qualityIssues[0] || null;
    var isPending = false;
    var statusLabel = primaryQualityIssue ? "Review" : "Ready";
    var statusAttr = primaryQualityIssue ? "needs_review" : "ready";

    var mi = insights();
    var actions = docActionButtons(slug, doc, base, primaryQualityIssue, function (kind) {
      return "brief-materials__btn brief-materials__btn--" + kind;
    }, { fail: !!(mi && mi.isFail(quality)) });

    var metaParts = [];
    var primaryFormat = formats.filter(function (f) { return f; })[0];
    if (primaryFormat) metaParts.push(escapeHtml(primaryFormat));
    if (size) metaParts.push(escapeHtml(size));
    if (updatedRel) metaParts.push("Updated " + escapeHtml(updatedRel));

    /* Role identity sub-line: "321 The Agency · Director of Digital
       Marketing" baked into each card so the user can never confuse
       which role a Ready cover letter belongs to. Falls back gracefully
       when identity isn't supplied (e.g. older optimistic renders). */
    var identityHtml = "";
    if (identity && (identity.company || identity.title)) {
      var parts = [];
      if (identity.company) parts.push(escapeHtml(identity.company));
      if (identity.title)   parts.push(escapeHtml(identity.title));
      identityHtml = '<p class="brief-materials__card-identity">' + parts.join(' <span class="brief-materials__dot">·</span> ') + '</p>';
    }
    /* HOLES SCORE (§0.3): the card's critique line is the grade button now;
       the flags it named open in the score modal. */
    var gradeBtn = manifest && (doc.type === "resume" || doc.type === "cover_letter")
      ? gradeButtonHtml(manifest, doc.type) : "";
    var qualityHtml = gradeBtn ? '<p class="brief-materials__card-grade">' + gradeBtn + '</p>' : "";

    return '<article class="brief-materials__card brief-materials__card--' + (meta.role === "primary" ? "primary" : "support")
      + (isPending ? " brief-materials__card--pending" : "")
      + '"'
      + ' data-doc-type="' + typeAttr + '">'
      + '<header class="brief-materials__card-head">'
        + '<span class="brief-materials__card-label">' + escapeHtml(meta.label) + '</span>'
        + '<span class="brief-materials__card-status" data-status="' + statusAttr + '">' + escapeHtml(statusLabel) + '</span>'
      + '</header>'
      + identityHtml
      + (metaParts.length ? '<p class="brief-materials__card-meta">' + metaParts.join(' <span class="brief-materials__dot">·</span> ') + '</p>' : '')
      + qualityHtml
      + '<footer class="brief-materials__card-actions">' + actions.join("") + '</footer>'
      + '</article>';
  }

  /* -------------------- C11: the user's resume --------------------
     Drafts are written from the resume the user added in Portfolio (IndexedDB,
     via CommandCenterUserContent). A page without that store cannot know, so
     it drafts as before and lets the server decide (feature detection). */
  var resumeSummary; /* undefined = not read yet; null = none on file */

  function userContentApi() {
    var uc = root.CommandCenterUserContent;
    return uc && typeof uc.getActiveResume === "function" ? uc : null;
  }

  function resumePayload(rec) {
    if (!rec) return null;
    var text = String(rec.extractedText || rec.text || "").trim();
    if (!text) return null;
    var payload = {
      source: String(rec.source || "file"),
      filename: String(rec.label || rec.filename || "My resume"),
      addedAt: String(rec.createdAt || rec.addedAt || ""),
      text: text,
    };
    /* The server drafts from the user's newest saved resume unless this one
       was pinned on purpose; it never drafts from garbled text. */
    if (rec.pinned === true) payload.pinned = true;
    return payload;
  }

  function setResumeSummary(payload) {
    var next = payload ? { filename: payload.filename, addedAt: payload.addedAt } : null;
    var before = resumeSummary === undefined ? "?" : JSON.stringify(resumeSummary);
    resumeSummary = next;
    if (before !== JSON.stringify(next)) notifyCaseRerender();
  }

  /* Resolves { available, resume }: available is false when the page has no
     resume store at all, never when the store is merely empty. */
  function readResume() {
    var uc = userContentApi();
    if (!uc) return Promise.resolve({ available: false, resume: null });
    return Promise.resolve()
      .then(function () { return uc.getActiveResume(); })
      .then(function (rec) {
        var payload = resumePayload(rec);
        setResumeSummary(payload);
        return { available: true, resume: payload };
      })
      .catch(function () { return { available: false, resume: null }; });
  }

  /* Materials template registry (visual spec §9.4). The saved
     materialsTemplate preference rides every /request as preferredTemplate;
     the server resolves request → preference → default. */
  var TEMPLATE_FAMILIES_FALLBACK = [
    { id: "signal", label: "Signal" },
    { id: "dossier", label: "Dossier" },
    { id: "editorial", label: "Editorial" },
  ];

  function templateFamilies() {
    var uc = root.CommandCenterUserContent;
    var list = uc && Array.isArray(uc.MATERIALS_TEMPLATE_FAMILIES) ? uc.MATERIALS_TEMPLATE_FAMILIES : null;
    return list && list.length ? list : TEMPLATE_FAMILIES_FALLBACK;
  }

  function templateLabel(id) {
    var match = templateFamilies().filter(function (f) { return f.id === id; })[0];
    return match ? match.label : String(id || "");
  }

  function readTemplatePreference() {
    var uc = root.CommandCenterUserContent;
    if (!uc || typeof uc.getPreferences !== "function") return Promise.resolve("");
    return Promise.resolve()
      .then(function () { return uc.getPreferences(); })
      .then(function (prefs) { return prefs && prefs.materialsTemplate ? String(prefs.materialsTemplate) : ""; })
      .catch(function () { return ""; });
  }

  function withTemplatePreference(body) {
    return readTemplatePreference().then(function (id) {
      if (id) body.preferredTemplate = id;
      return body;
    });
  }

  function getResumeSummary() {
    return resumeSummary;
  }

  function isResumeRequiredError(err) {
    if (!err) return false;
    var body = err.body || null;
    return (err.status === 422 && body && body.code === RESUME_REQUIRED_CODE)
      || err.code === RESUME_REQUIRED_CODE;
  }

  /* Opens Portfolio on its Resume section (TA-15). profile-materials owns
     the modal; this only asks it to open and scrolls to the resume. */
  function openResume() {
    var app = root.JobBoredApp;
    var pm = app && app.profileMaterials;
    var open = (pm && pm.openMaterialsModal) || root.openMaterialsModal;
    if (typeof open !== "function") return false;
    try { open(); } catch (e) { return false; }
    var heading = typeof document !== "undefined" && document.getElementById
      ? document.getElementById("profileResumeHeading")
      : null;
    if (heading && typeof heading.scrollIntoView === "function") {
      try { heading.scrollIntoView({ block: "start" }); } catch (e) { /* ignored */ }
    }
    return true;
  }

  /* -------------------- C12: is the drafting server there? -------------------- */
  var serverState = ""; /* "" unknown, "up", "down" */

  function getServerState() {
    return serverState;
  }

  function setServerState(next) {
    if (serverState === next) return;
    var prev = serverState;
    serverState = next;
    /* The docket only differs for "down", so "" → "up" is not news. */
    if (prev === "down" || next === "down") notifyCaseRerender();
  }

  /* The Case re-reads getServerState/getResumeSummary on its next render;
     role.js re-renders the open role on jb:materials:manifest. */
  function notifyCaseRerender() {
    var key = openRoleKey();
    if (!key) return;
    dispatch("jb:materials:manifest", {
      jobKey: key,
      manifest: currentManifest && String(currentManifest.jobKey) === key ? currentManifest.manifest : null,
      reason: "state",
    });
  }

  function gateSection(kind, inner) {
    return '<section class="' + SECTION_CLASS + ' ' + SECTION_CLASS + '--rows ' + SECTION_CLASS + '--' + kind + '"'
      + ' aria-label="Application materials">' + inner + '</section>';
  }

  /* One honest state when nothing is listening on the materials port: no
     optimistic "queued", no paste-the-JD form (TA-06). */
  function renderServerDown(hostEl) {
    if (!hostEl) return;
    lastPaint = { kind: "server-down" };
    lastPaintKey = paintedRoleKey();
    removeExisting(hostEl);
    appendSection(hostEl, gateSection("server-down",
      '<div class="case__gate case__gate--server" id="case-materials-server" role="status">'
        + '<p class="case__gate-title">Drafting server not running</p>'
        + '<p class="case__gate-body">Drafting is paused. In your JobBored folder run <code>' + escapeHtml(START_COMMAND) + '</code>, then try again.</p>'
        + '<div class="case__gate-actions">'
          + '<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="materials-server-retry">Retry</button>'
          + '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-copy-command">Copy command</button>'
        + '</div>'
      + '</div>'));
    wireSection(hostEl);
  }

  /* C11 (TA-02): no draft starts without the user's own resume. */
  function renderResumeGate(hostEl) {
    if (!hostEl) return;
    lastPaint = { kind: "resume-gate" };
    lastPaintKey = paintedRoleKey();
    removeExisting(hostEl);
    appendSection(hostEl, gateSection("resume-gate",
      '<div class="case__gate case__gate--resume" role="status">'
        + '<p class="case__gate-kicker">No resume yet</p>'
        + '<p class="case__gate-title">Add your resume first</p>'
        + '<p class="case__gate-body">Drafts are written from it, so they sound like you and list only what you\u2019ve done. It stays on this computer.</p>'
        + '<div class="case__gate-actions">'
          + '<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="open-resume">Add your resume</button>'
        + '</div>'
      + '</div>'));
    wireSection(hostEl);
  }

  /* Retry keeps "down" until the load answers: the load's own
     setServerState("up") is then a down → up change, which re-renders the
     Case docket and re-enables Draft (TA-06). Resetting to "" here would
     turn it into an unannounced "" → up. */
  function retryServer() {
    clearCache();
    var key = openRoleKey() || (currentContext && currentContext.jobKey);
    if (key != null && key !== "") loadForOpenRole(key);
  }

  function copyStartCommand(btn) {
    var nav = root.navigator;
    var done = function () { if (btn) btn.textContent = "Copied"; };
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
      nav.clipboard.writeText(START_COMMAND).then(done, function () { /* the command is on screen */ });
    }
  }

  /* -------------------- C12: auto-draft is opt-in -------------------- */
  function isAutoDraftEnabled() {
    var cfg = root.COMMAND_CENTER_CONFIG;
    if (cfg && cfg.autoDraftOnResearching === true) return true;
    try {
      return !!(root.localStorage && root.localStorage.getItem(AUTO_DRAFT_STORAGE_KEY) === "on");
    } catch (e) {
      return false;
    }
  }

  function toast(message, tone) {
    if (typeof root.showToast !== "function") return;
    try { root.showToast(message, tone || "info"); } catch (e) { /* a toast is never load-bearing */ }
  }

  /* -------------------- C12 (TA-05): the optimistic row holds --------------------
     A 2xx /request whose manifest has not caught up yet used to revert the row
     to "not drafted" and invite a second request. The optimistic pending block
     survives until the manifest shows a server-written pending, a document,
     or the hold lapses. The run's own optimistic pending block (the same
     object, committed by renderOptimisticPending) is not "caught up". */
  var optimisticRun = null;

  function holdOptimistic(manifest) {
    if (!optimisticRun || !manifest || manifest.slug !== optimisticRun.slug) return manifest;
    var docs = Array.isArray(manifest.documents) ? manifest.documents : [];
    var serverPending = !!manifest.pending && manifest.pending !== optimisticRun.pending;
    var caughtUp = serverPending || docs.some(function (d) {
      return d && (d.type === optimisticRun.feature || optimisticRun.feature === "both") && d.lastModifiedAt
        && Date.parse(d.lastModifiedAt) >= optimisticRun.at;
    });
    if (caughtUp || Date.now() - optimisticRun.at > OPTIMISTIC_HOLD_MS) {
      optimisticRun = null;
      return manifest;
    }
    var held = {};
    for (var k in manifest) if (Object.prototype.hasOwnProperty.call(manifest, k)) held[k] = manifest[k];
    held.pending = optimisticRun.pending;
    return held;
  }

  function secondsSince(iso) {
    var t = Date.parse(String(iso || ""));
    return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 1000)) : 0;
  }

  /* Inside the Case a status line replaces the whole panel — the lane
     heading already says "Materials". */
  function renderCaseHint(hostEl, message, extraClass, hintClass) {
    appendSection(hostEl, '<section class="' + SECTION_CLASS + ' ' + SECTION_CLASS + '--rows'
      + (extraClass ? " " + extraClass : "") + '" aria-label="Application materials">'
      + '<p class="case__hint' + (hintClass ? " " + hintClass : "") + '">' + escapeHtml(message) + '</p>'
      + '</section>');
  }

  function renderEmpty(briefEl, options) {
    /* Empty state: a single line tag and a hint. Renders only when the
       brief is open, the role is known, and there's no matched package. */
    if (!briefEl) return;
    lastPaint = { kind: "empty", options: options };
    lastPaintKey = paintedRoleKey();
    removeExisting(briefEl);
    var note = options && options.note ? options.note : "";
    if (isCaseMount(briefEl)) {
      renderCaseHint(briefEl, note
        || "Nothing written for this role yet \u2014 use Draft cover letter or Tailor resume above to start one.");
      return;
    }
    var html = '<section class="' + SECTION_CLASS + ' brief-materials--empty" aria-label="Application materials">'
      + '<header class="brief-materials__head">'
        + '<h3 class="section-label">Application Materials</h3>'
        + '<span class="brief-materials__eyebrow">LOCAL · ON THIS MACHINE</span>'
      + '</header>'
      + '<p class="brief-materials__empty">'
        + (note
          ? escapeHtml(note)
          : "No tailored resume or cover letter on disk for this role yet.")
      + '</p>'
      + '<p class="brief-materials__hint">Use <strong>Draft cover letter</strong> or <strong>Tailor resume</strong> above to start a tailored draft.</p>'
      + '</section>';
    appendSection(briefEl, html);
  }

  /* A pen drawing a line — reads as "your draft is being written" rather
     than a backwards clock that just signals "this is taking forever".
     The nib sweeps left→right while the baseline inks in; CSS drives both
     (see .brief-materials__progress-pen* in role.css). */
  var PROGRESS_WRITING_SVG = ''
    + '<svg class="brief-materials__progress-pen" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<g class="brief-materials__progress-pen-nib">'
        + '<path d="M15.5 5.5l3 3"></path>'
        + '<path d="M16.8 4.2a1.7 1.7 0 0 1 2.4 2.4L8.5 17.3 4.5 18.5l1.2-4z"></path>'
      + '</g>'
      + '<line class="brief-materials__progress-pen-line" x1="4.5" y1="20.5" x2="19.5" y2="20.5"></line>'
    + '</svg>';

  function featureLabel(feature) {
    if (feature === "both") return "resume + cover letter";
    if (feature === "resume") return "resume";
    if (feature === "cover_letter") return "cover letter";
    return "materials";
  }

  /* Maps the watcher's progress.phase to a JobBored-flavoured message
     when the watcher hasn't supplied one of its own. Keeping these
     concise + warm; a per-run message can still override. */
  function defaultPhaseMessage(phase, feature) {
    var label = featureLabel(feature);
    switch (phase) {
      case "queued":         return "Your " + label + " is in line. We draft one role at a time and will start this next.";
      case "drafting":       return "Writing your " + label + "…";
      case "rendering_pdf":  return "Polishing the PDFs…";
      case "verifying":      return "Double-checking the outputs…";
      case "complete":       return "Done! Your files are ready.";
      case "failed":         return "Something went sideways. Open the request again to retry.";
      default:               return "Writing your " + label + "…";
    }
  }

  /* The compact row's phase word. defaultPhaseMessage says the same thing in
     a sentence for the progress block; this is the two-or-three word version
     that belongs on a status line — never the raw state-machine enum. */
  function phaseWords(phase) {
    switch (String(phase || "").toLowerCase()) {
      case "queued":        return "in line";
      case "drafting":      return "writing";
      case "rendering_pdf": return "polishing the PDFs";
      case "verifying":     return "double-checking";
      case "complete":      return "done";
      case "failed":        return "couldn't finish";
      default:              return "writing";
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
     banner. Shows the writing-pen icon, the phase-specific message,
     a live elapsed timer, and the user's original notes preview. */
  function pendingBannerHtml(pending) {
    if (!pending || !pending.feature) return "";
    var progress = pending.progress || null;
    /* Phase resolution:
       - explicit progress.phase wins
       - no progress block at all = "queued" (request landed, the writer
         hasn't claimed the file yet; can sit here for minutes if a
         prior draft is in flight, since drafts run one at a time)
       This distinction matters because "drafting at 0s" looks broken;
       the "WAITING IN QUEUE" state reads as expected. */
    var phase = (progress && progress.phase) || "queued";
    /* Treat "complete" as a celebratory state — same card structure,
       different visuals (no spin, check icon). Once Dobby deletes
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
    /* Larger icons in the enlarged card. The clock SVG keeps its
       inline width attribute internal — we just upscale via CSS via
       the parent class. */
    var iconHtml = isComplete
      ? ('<svg class="brief-materials__progress-check" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
         + '<polyline points="20 6 9 17 4 12"></polyline></svg>')
      : (isFailed
         ? ('<svg class="brief-materials__progress-failed" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<circle cx="12" cy="12" r="10"></circle>'
            + '<line x1="12" y1="8" x2="12" y2="12"></line>'
            + '<line x1="12" y1="16" x2="12.01" y2="16"></line></svg>')
         : PROGRESS_WRITING_SVG);

    /* Elapsed counter rules:
       - terminal phases (complete/failed) freeze at the final value
       - queued / no-progress states have nothing to count (Dobby
         hasn't started) — show "—" instead of a misleading "0s"
       - only running phases set data-elapsed-started so the ticker
         keeps counting between manifest polls */
    var isQueued = phase === "queued" || !progress;
    var isLive = !isComplete && !isFailed && !isQueued;
    var elapsedAttr = isLive
      ? ' data-elapsed-started="' + escapeHtml(progress && progress.startedAt || "") + '"'
      : '';
    var elapsedText;
    if (isComplete) elapsedText = "";
    else if (isQueued) elapsedText = "—";
    else elapsedText = formatElapsed(elapsed);
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
    /* Identity line: company · title · feature. Lets a user know
       exactly which role this card is for even when the dossier
       header above is for a different selected role (e.g. the user
       browsed to a different card while drafting was in flight). */
    var feLabel = featureLabel(pending.feature);
    var identityParts = [];
    if (pending.company) identityParts.push(escapeHtml(pending.company));
    if (pending.title)   identityParts.push(escapeHtml(pending.title));
    var identityHtml = identityParts.length
      ? '<div class="brief-materials__progress-identity">'
        + identityParts.join(' <span class="brief-materials__dot">·</span> ')
        + (feLabel ? ' <span class="brief-materials__progress-feature">' + escapeHtml(feLabel) + '</span>' : '')
      + '</div>'
      : '';

    /* U9: the elapsed clock below ticks every second, so this card is not a
       live region; announcePhase() says each phase once. */
    return '<div class="brief-materials__progress brief-materials__progress--enlarged" data-phase="' + escapeHtml(phase) + '">'
      + '<div class="brief-materials__progress-icon">' + iconHtml + '</div>'
      + '<div class="brief-materials__progress-body">'
        + '<div class="brief-materials__progress-line">'
          + '<span class="brief-materials__progress-eyebrow">'
            + (isComplete ? "MATERIALS READY"
              : (isFailed ? "MATERIALS FAILED"
              : (isQueued ? "WAITING IN QUEUE" : "DRAFTING IN PROGRESS")))
          + '</span>'
          + '<span class="brief-materials__progress-elapsed"' + elapsedAttr + '>'
            + escapeHtml(elapsedText)
          + '</span>'
        + '</div>'
        + identityHtml
        + '<div class="brief-materials__progress-message">' + escapeHtml(message) + '</div>'
        + (insights() && progress && !isQueued ? insights().timelineHtml(progress, pending.feature) : "")
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

  /* The Case's [data-mount="materials"] gets compact rows; the legacy
     [data-mount="brief"] fallback keeps the full panel. */
  function isCaseMount(hostEl) {
    return !!(hostEl && typeof hostEl.getAttribute === "function"
      && hostEl.getAttribute("data-mount") === "materials");
  }

  /* The document taxonomy is the Case model's contract (spec §3), never a
     copy: without it we degrade to the panel rather than render nothing. */
  function caseDocTypes() {
    var model = root.JobBoredCase && root.JobBoredCase.model;
    return model && Array.isArray(model.CASE_DOC_TYPES) && model.CASE_DOC_TYPES.length
      ? model.CASE_DOC_TYPES
      : null;
  }

  function caseRowsFor(hostEl) {
    return isCaseMount(hostEl) ? caseDocTypes() : null;
  }

  /* C11 (TA-01): which resume the drafts came from. The manifest's own
     record wins ("Drafted from"); before the server records one, the line
     names the resume the next draft will use ("Drafts use"). */
  function provenanceHtml(manifest) {
    var recorded = manifest && manifest.resume && manifest.resume.filename ? manifest.resume : null;
    var r = recorded || resumeSummary;
    if (!r || !r.filename) return "";
    var added = r.addedAt ? ", added " + escapeHtml(String(r.addedAt).slice(0, 10)) : "";
    /* When the server chose a different resume (the page's copy was older or
       garbled), it says so. */
    var note = recorded && recorded.note ? ' <span class="case__provenance-note">' + escapeHtml(String(recorded.note)) + "</span>" : "";
    return '<p class="case__provenance">' + (recorded ? "Drafted from " : "Drafts use ")
      + "<b>" + escapeHtml(r.filename) + "</b>" + added + note
      + ' <button type="button" class="case__link" data-action="open-resume">Change</button></p>';
  }

  /* Slice 3b: the package's recorded template, and "Change template" for the
     other families. It re-renders the stored render model and rewrites
     nothing, so it is a link here, apart from Repair's buttons (MREV D5). */
  function templateBarHtml(manifest) {
    var t = manifest && manifest.template && manifest.template.family ? manifest.template : null;
    if (!t || (manifest && manifest.pending)) return "";
    var others = templateFamilies().filter(function (f) { return f.id !== t.family; });
    var buttons = others.map(function (f) {
      return '<button type="button" class="case__link" data-action="materials-regenerate" data-template="'
        + escapeHtml(f.id) + '" aria-label="Change template to ' + escapeHtml(f.label) + '"'
        + (regenerating ? ' aria-disabled="true"' : "") + '>' + escapeHtml(f.label) + '</button>';
    }).join(" ");
    return '<p class="case__template" data-template-family="' + escapeHtml(t.family) + '">'
      + 'Template: <b>' + escapeHtml(templateLabel(t.family)) + '</b>'
      + (t.source === "regenerate" ? " (changed)" : "")
      + (buttons ? ' <span class="case__template-regen">Change template: ' + buttons + '</span>' : "")
      + '</p>';
  }

  /* C12 (TA-16): one click drafts; notes are an optional disclosure the next
     draft picks up, not a mandatory second form. */
  var draftNotes = "";
  function draftNotesHtml() {
    return '<details class="case__draft-notes"' + (draftNotes ? " open" : "") + '>'
      + '<summary>Notes for the next draft</summary>'
      + '<textarea class="case__draft-notes-input" data-materials-notes rows="3"'
      + ' aria-label="Notes for the next draft" placeholder="What angle should we emphasise? Tone? Must-shows?">'
      + escapeHtml(draftNotes) + '</textarea>'
      + '</details>';
  }

  /* C13 (TA-11): the QA report and the checklist open inline. EDITOR F1:
     a written resume or letter opens in Scribe v2 for editing. */
  function extraDocActions(type, doc) {
    var files = doc && Array.isArray(doc.files) ? doc.files : [];
    var out = [];
    if (type === "qa_report" || (type === "manual_apply_checklist" && !checklistAvailable())) {
      var md = files.filter(function (f) { return f && /\.md$/i.test(String(f.filename || "")); })[0];
      if (md && ALLOWED_FILES[md.filename]) {
        out.push('<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-open-md"'
          + ' data-filename="' + escapeHtml(md.filename) + '" aria-expanded="false">Open</button>');
      }
    }
    if (type === "resume" || type === "cover_letter") {
      var html = files.filter(function (f) { return f && /\.html$/i.test(String(f.filename || "")); })[0];
      if (html && ALLOWED_FILES[html.filename]) {
        out.push('<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-edit"'
          + ' data-feature="' + escapeHtml(type) + '" data-filename="' + escapeHtml(html.filename) + '" aria-haspopup="dialog">Edit</button>');
      }
    }
    return out;
  }

  /* RESD: the server stopped the draft because it could not ground the
     current resume source. The last good package is untouched on disk. */
  var RESUME_SOURCE_REVIEW_CODE = "resume_source_review";
  var RESUME_SOURCE_REVIEW_MESSAGE = "We couldn\u2019t read your resume clearly enough to draft from it. "
    + "Your last resume is unchanged. Check the resume, then try again.";

  /* RESD R5: the published run's count-only selectionSummary. Only a
     positive integer count is news; a legacy manifest has no block, and a
     resume request in flight or failed since then makes it an old run's
     number, so it stays hidden beside that request. */
  function pageBudgetExcludedOf(manifest, pending) {
    var acc = manifest && manifest.selectionSummary;
    var n = acc && typeof acc === "object" ? acc.pageBudgetExcluded : null;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return 0;
    if (pending && String(pending.feature || "") === "resume") return 0;
    return n;
  }

  /* One row per CASE_DOC_TYPES entry — every deliverable is always listed,
     so "not drafted yet" is as visible as "ready". */
  function renderCaseRows(hostEl, manifest, base, defs) {
    var docs = Array.isArray(manifest.documents) ? manifest.documents : [];
    /* A pending block with a feature but no progress yet is the optimistic
       "just requested" state — the legacy panel reads that as queued
       (isQueued = phase === "queued" || !progress); the rows must too. */
    var pending = manifest.pending && manifest.pending.feature ? manifest.pending : null;
    var pendingFeature = pending ? String(pending.feature || "") : "";
    var pendingProgress = pending && pending.progress ? pending.progress : null;
    var qualityDocs = manifest.quality && manifest.quality.documents ? manifest.quality.documents : {};
    var sourceReview = !!(pendingProgress && /^failed$/i.test(String(pendingProgress.phase || ""))
      && pendingProgress.code === RESUME_SOURCE_REVIEW_CODE);
    var budgetExcluded = pageBudgetExcludedOf(manifest, pending);

    var mi = insights();
    /* U-5 "Draft both": the letter waits behind the resume's run. */
    var pendingLive = pending && !/^(complete|done|failed)$/i.test(String((pendingProgress && pendingProgress.phase) || "queued"));
    var queuedNext = pendingLive && pending.next ? String(pending.next) : "";
    var rows = defs.map(function (def) {
      var doc = docs.filter(function (d) { return d && d.type === def.type; })[0] || null;
      var phase = pending && pendingFeature === def.type
        ? (pendingProgress ? (String(pendingProgress.phase || "") || "queued") : "queued")
        : (queuedNext === def.type ? "queued" : "");
      var isNextInLine = queuedNext === def.type && pendingFeature !== def.type;
      var isPending = !!phase && !/^(complete|done|failed)$/i.test(phase);
      var status = isPending
        ? "drafting"
        : (/^failed$/i.test(phase)
          ? "failed"
          : (doc
            ? (String(doc.status || "").toLowerCase() === "ready" ? "ready" : "failed")
            : "missing"));
      /* C13 (TA-12): QA flagged it, so it is "review", never "ready". */
      var qualityForRow = qualityDocs[def.type];
      var flags = qualityForRow && Array.isArray(qualityForRow.issues)
        ? qualityForRow.issues.filter(function (i) { return i && (i.message || i.code); })
        : [];
      if (status === "ready" && flags.length) status = "review";
      var rowProgress = isNextInLine ? null : pendingProgress;
      var attempt = Number(rowProgress && rowProgress.attempt) || 1;
      var elapsed = rowProgress ? formatElapsed(liveElapsedSeconds(rowProgress)) : "—";
      var isQueued = /^queued$/i.test(phase);
      /* The meta line, which owns the whole row's width (SPEC §3.4). Every
         sentence the row has to say lands here rather than beside the label:
         the pill carries one word, so it can never claim the name column's
         width again. */
      var meta = "";
      if (status === "failed") {
        meta = "stopped after " + elapsed + (attempt > 1 ? " · attempt " + attempt : "");
      } else if (status === "ready" || status === "review") {
        /* U16: a review row's flags are critique, so every one of them is
           listed in the score modal; the meta line says what was drafted. */
        var files = doc && Array.isArray(doc.files) ? doc.files.length : 0;
        meta = (doc && doc.lastModifiedAt ? "drafted " + String(doc.lastModifiedAt).slice(0, 10) : "drafted")
          + (files ? " · " + files + " file" + (files === 1 ? "" : "s") : "");
      } else if (status === "missing") {
        /* A deliverable nothing can draft on its own says what produces it,
           instead of offering a button that does nothing (SPEC §6 state 7). */
        meta = def.draftAction ? "never requested" : "written with the resume";
      }
      var clearedReviewHtml = "";
      if ((status === "ready" || status === "review") && (def.type === "resume" || def.type === "cover_letter") && manifest.ingestReview && manifest.ingestReview.notice) {
        var cleared = Array.isArray(manifest.ingestReview.cleared) ? manifest.ingestReview.cleared : [];
        if (cleared.length) {
          clearedReviewHtml = '<details data-ingest-cleared><summary>' + escapeHtml(manifest.ingestReview.notice) + '</summary><ul>'
            + cleared.map(function (item) { return '<li>Line ' + escapeHtml(item.line) + ' (' + escapeHtml(item.reason) + '): ' + escapeHtml(item.text) + '</li>'; }).join("")
            + '</ul><button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-open-profile" data-focus="resume">Edit or re-read résumé</button></details>';
        } else meta += " · " + String(manifest.ingestReview.notice);
      }
      /* The queue state, carried into the row: the eyebrow says what is
         happening and for how long, the worker's own message says what it is
         doing, and the indeterminate track says it is still alive. */
      var progressHtml = "";
      if (isPending && isNextInLine) {
        progressHtml = '<span class="case__doc-progress" data-phase="queued">'
          + '<span class="case__doc-eyebrow">next in line</span>'
          + '<span class="case__doc-msg">' + escapeHtml("Drafts after the " + featureLabel(pendingFeature) + " finishes, with its own quality check.") + '</span>'
        + '</span>';
      } else if (isPending) {
        var prog = pendingProgress;
        var eyebrow = (isQueued ? "waiting in queue" : (/^drafting$/i.test(phase) ? "drafting in progress" : phaseWords(phase)))
          + " · " + elapsed
          /* A retry count only above 1: "attempt 1" on every row reads as
             "something already went wrong" (the legacy panel showed it only
             once a run had actually been retried). */
          + (attempt > 1 ? " · retry " + attempt : "");
        var msg = prog && prog.message ? String(prog.message) : defaultPhaseMessage(phase, pending.feature);
        /* C12 (TA-26): past ~2x the median run, say so instead of letting
           the clock climb for 30 minutes. */
        var runSeconds = prog ? liveElapsedSeconds(prog) : secondsSince(pending.requestedAt);
        var stall = runSeconds >= STALL_NOTICE_SECONDS
          ? '<span class="case__doc-stall">Taking longer than usual \u00b7 check that the drafting server is still running.</span>'
          : "";
        /* U9: the eyebrow carries the elapsed time and the rows repaint on
           every poll, so no live region here; announcePhase() speaks. */
        progressHtml = '<span class="case__doc-progress" data-phase="' + escapeHtml(phase) + '">'
          + '<span class="case__doc-eyebrow">' + escapeHtml(eyebrow) + '</span>'
          + '<span class="case__doc-msg">' + escapeHtml(msg) + '</span>'
          + stall
          + '<span class="case__doc-track" aria-hidden="true"><i></i></span>'
          /* U-4: the named steps, never the raw "stage: status" strings. */
          + (mi && !isQueued ? mi.timelineHtml(prog, pendingFeature) : "")
        + '</span>';
      } else if (status === "failed") {
        /* Same words the pill used to carry in 15 nowrap characters, in the
           place that has room for them. */
        var reason = pendingProgress && pendingProgress.message
          ? String(pendingProgress.message)
          : (sourceReview
            ? RESUME_SOURCE_REVIEW_MESSAGE
            : "The drafting worker stopped before the " + featureLabel(pendingFeature || def.type) + " was written. Nothing was saved.");
        progressHtml = '<span class="case__doc-msg"'
          + (sourceReview ? ' data-review="' + RESUME_SOURCE_REVIEW_CODE + '"' : "") + '>' + escapeHtml(reason) + '</span>'
          + (mi && pendingProgress && Array.isArray(pendingProgress.stages) && pendingProgress.stages.length
            ? mi.timelineHtml(pendingProgress, pendingFeature) : "");
      }
      var issue = flags[0] || null;
      /* HOLES SCORE (§0.3): a drafted resume or letter shows one grade
         button; its verdict, blockers, dimensions and fixes open in the
         score modal. With a pipeline verdict the modal owns Repair, so the
         action row does not repeat it (U-1). */
      var verdict = !!(mi && (status === "ready" || status === "review") && mi.qaVersion(qualityForRow && qualityForRow.qa));
      var gradeBtn = (status === "ready" || status === "review") && (def.type === "resume" || def.type === "cover_letter")
        ? gradeButtonHtml(manifest, def.type) : "";
      var fail = !!(mi && mi.isFail(qualityForRow));
      var actions = status === "ready" || status === "review"
        ? docActionButtons(manifest.slug, doc, base, verdict ? null : issue, function (kind) {
          return "case__doc-btn case__doc-btn--" + kind;
        }, { menu: true, fail: fail }).concat(extraDocActions(def.type, doc))
        : (status === "missing" && def.draftAction
          ? ['<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="'
            + escapeHtml(def.draftAction) + '">Draft</button>']
          /* A failure with no way out is a dead end: the legacy panel always
             paired FAILED with dismiss + retry, and the row must too. The
             feature is the pending run's, which is what both handlers key on. */
          : (status === "failed" && pendingFeature && sourceReview
            /* RESD: the fix is in the resume, so the row opens it. */
            ? ['<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="materials-retry"'
              + ' data-feature="' + escapeHtml(pendingFeature) + '">Retry</button>',
              '<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="open-resume">Open Resume</button>']
          : (status === "failed" && pendingFeature
            ? ['<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-dismiss"'
              + ' data-feature="' + escapeHtml(pendingFeature) + '">Dismiss</button>',
              '<button type="button" class="case__doc-btn case__doc-btn--primary" data-action="materials-retry"'
              + ' data-feature="' + escapeHtml(pendingFeature) + '">Try again</button>']
            : [])));
      /* Three areas, never one line (SPEC §3.4). The shipped row was
         `minmax(0, 1fr) auto auto` — name, pill, buttons — and both `auto`
         tracks were nowrap, so at a 323px lane they took 309px and the name
         track rendered at 12.3px with "Cover letter" shredded over nine
         lines (TEARDOWN §2). Here the buttons and the label never share a
         line, so no content-sized track can take the label's width. */
      var stateWord = status === "missing"
        ? "not drafted"
        : (isPending && isQueued ? "queued" : status);
      var stateClass = isPending && isQueued ? "queued" : status;
      if (isNextInLine) stateWord = "next";
      if (verdict) {
        /* The pill keeps the verdict's one word; the score is the grade
           button's, and only the grade button's (§0.3). */
        var tone = mi.dispositionOf(qualityForRow).toLowerCase();
        stateWord = tone;
        stateClass = "qa-" + (tone === "ready" ? "ready" : tone);
      }
      if (verdict && (def.type === "resume" || def.type === "cover_letter")) {
        actions = actions.concat(['<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-history"'
          + ' data-feature="' + escapeHtml(def.type) + '" aria-expanded="false">Versions</button>']);
      }
      /* The manual-apply checklist is a live, checkable list the server
         builds from the package, not a .md to download. */
      var checklist = "";
      if (def.type === "manual_apply_checklist" && checklistAvailable()) {
        var prog = root.JobBoredApplyChecklist.progress(manifest.slug);
        status = "checklist";
        stateClass = "checklist";
        stateWord = prog ? prog.done + " / " + prog.total + " done" : "to do";
        meta = "";
        progressHtml = "";
        actions = ['<button type="button" class="case__doc-btn case__doc-btn--ghost" data-action="materials-checklist-toggle"'
          + ' aria-expanded="' + (checklistOpen ? "true" : "false") + '">' + (checklistOpen ? "Hide checklist" : "Show checklist") + '</button>'];
        if (checklistOpen) {
          var contact = currentContext && currentContext.enrichment && currentContext.enrichment.contact
            ? String(currentContext.enrichment.contact) : "";
          checklist = '<jb-apply-checklist data-slug="' + escapeHtml(manifest.slug) + '" data-base="' + escapeHtml(base) + '"'
            + ' data-version="' + escapeHtml(String(manifest.updatedAt || "") + "|" + String(manifest.runId || "")) + '"'
            + (contact ? ' data-contact="' + escapeHtml(contact) + '"' : "") + '></jb-apply-checklist>';
        }
      }
      /* RESD R5: say how much selected evidence the one-page budget left out. */
      var budgetNote = def.type === "resume" && doc && budgetExcluded
        ? '<span class="case__doc-note" data-page-budget-excluded="' + budgetExcluded + '">'
          + budgetExcluded + " selected point" + (budgetExcluded === 1 ? "" : "s") + " didn\u2019t fit on one page.</span>"
        : "";
      var repairBlocks = def.type === "resume" || def.type === "cover_letter"
        ? repairBlocksHtml(manifest.slug, def.type, qualityForRow, isPending) : "";
      return '<div class="case__doc case__doc--' + status + (fail ? " case__doc--qafail" : "") + (gradeBtn ? " case__doc--graded" : "") + '" data-doc="' + escapeHtml(def.type) + '"'
        + (fail ? ' data-qa="fail"' : "") + '>'
        + '<div class="case__doc-n"><span class="case__doc-label">' + escapeHtml(def.label) + '</span></div>'
        + (gradeBtn ? '<span class="case__doc-grade">' + gradeBtn + '</span>' : "")
        + '<span class="case__docst case__docst--' + stateClass + '" data-status="' + escapeHtml(status) + '">'
          + escapeHtml(stateWord) + '</span>'
        + '<div class="case__doc-meta">' + (meta ? escapeHtml(meta) : "") + progressHtml + budgetNote + clearedReviewHtml + '</div>'
        + (checklist ? '<div class="case__doc-qa">' + checklist + '</div>' : "")
        + (actions.length ? '<div class="case__doc-actions">' + actions.join("") + '</div>' : "")
        + repairBlocks
      + '</div>';
    }).join("");

    /* U-5: one click queues the resume, then the letter, each its own run
       with its own verdict. Offered while nothing is in flight. */
    var draftBoth = mi && !pendingLive && defs.some(function (d) { return d.type === "resume"; })
      && defs.some(function (d) { return d.type === "cover_letter"; })
      ? '<p class="mat-both"><button type="button" class="case__doc-btn case__doc-btn--primary" data-action="materials-draft-both">Draft both</button>'
        + '<span class="mat-both__hint">Resume first, then the cover letter, each with its own quality check.</span></p>'
      : "";
    /* Wave 3 surfaces, when the package carries them. */
    var outreachRow = mi ? outreachRowHtml(manifest) : "";
    var intel = mi ? intelFor(manifest) : "";
    var option = mi && !pendingLive ? outreachOptionHtml() : "";
    appendSection(hostEl, '<section class="' + SECTION_CLASS + ' ' + SECTION_CLASS + '--rows"'
      + ' aria-label="Application materials" data-slug="' + escapeHtml(manifest.slug) + '">'
      + provenanceHtml(manifest)
      + templateBarHtml(manifest)
      + draftBoth
      + option
      + rows
      + outreachRow
      + intel
      + draftNotesHtml()
      + '</section>');
    wireSection(hostEl);
    /* No per-second ticker here: the row's elapsed value is recomputed from
       started_at on every manifest poll (3-12s), which is the right cadence
       for a one-line status. The big panel keeps the live clock. */
  }

  /* U9: the drafting card's clock ticks every second and the rows repaint
     on every manifest poll, so neither is a live region. Each phase of a
     run is said once, here, with no clock in it. */
  var phaseSaid = "";
  function announcePhase(manifest) {
    var pending = manifest && manifest.pending && manifest.pending.feature ? manifest.pending : null;
    if (!pending) return;
    var progress = pending.progress || null;
    var phase = String((progress && progress.phase) || "queued").toLowerCase();
    var key = String(manifest.slug || "") + "|" + String(pending.feature) + "|" + phase;
    if (key === phaseSaid) return;
    phaseSaid = key;
    var words = phase === "queued" ? "waiting in queue" : (phase === "drafting" ? "drafting in progress" : phaseWords(phase));
    var label = featureLabel(pending.feature);
    var a11y = root.JobBoredA11y;
    if (a11y && a11y.live && typeof a11y.live.announce === "function") {
      a11y.live.announce(label.charAt(0).toUpperCase() + label.slice(1) + ": " + words + ".");
    }
  }

  function renderManifest(briefEl, manifest, base) {
    if (!briefEl || !manifest) return;
    announcePhase(manifest);
    removeExisting(briefEl);
    var caseDefs = caseRowsFor(briefEl);
    if (caseDefs) {
      renderCaseRows(briefEl, manifest, base, caseDefs);
      return;
    }
    var docsAll = Array.isArray(manifest.documents) ? manifest.documents : [];
    var pending = manifest.pending || null;
    /* Filter to only the user-facing deliverables: tailored resume +
       cover letter. The other on-disk artifacts (job-description.md,
       job-analysis.md, qa-report.md, manual-apply-checklist.md) are
       internal scaffolding for Dobby and shouldn't crowd the Materials
       box. They remain readable through the direct file URL if
       someone really wants to inspect them. */
    var docs = docsAll.filter(function (d) {
      return d.type === "resume" || d.type === "cover_letter";
    });
    docs.sort(function (a, b) {
      var oa = ["resume", "cover_letter"];
      return oa.indexOf(a.type) - oa.indexOf(b.type);
    });
    /* Carry company/title through to the card so each card can show
       its role identity in the label. */
    var roleIdentity = {
      company: manifest.company || (pending && pending.company) || "",
      title: manifest.title || (pending && pending.title) || "",
    };
    var qualityDocs = manifest.quality && manifest.quality.documents
      ? manifest.quality.documents
      : {};
    var cards = docs.map(function (d) {
      return renderCard(manifest.slug, d, base, pending, roleIdentity, qualityDocs[d.type], manifest);
    });
    /* No per-doc placeholder cards. The enlarged progress banner
       above is the single source of "this is in flight" truth — a
       second "Generating…" pill on the doc grid is redundant and
       got visually contradictory in failed states. */
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
      + templateBarHtml(manifest)
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
    lastPaint = { kind: "error", message: message };
    lastPaintKey = paintedRoleKey();
    removeExisting(briefEl);
    if (isCaseMount(briefEl)) {
      /* A failure must not read like an empty shelf: role-case.css hangs the
         crimson, non-italic rule on case__hint--error (P1-0e). */
      renderCaseHint(briefEl, message || "Local materials server is unreachable.",
        "brief-materials--error", "case__hint--error");
      return;
    }
    var html = '<section class="' + SECTION_CLASS + ' brief-materials--error" aria-label="Application materials">'
      + '<header class="brief-materials__head">'
        + '<h3 class="section-label">Application Materials</h3>'
        + '<span class="brief-materials__eyebrow">LOCAL · ON THIS MACHINE</span>'
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

  /* The Case renders its own [data-mount="materials"]; the legacy dossier
     only has [data-mount="brief"]. Resolve the panel host once, here, so
     every render path lands in the same place during the cutover. */
  function findMount() {
    if (typeof document === "undefined" || !document.querySelector) return null;
    var region = document.querySelector(REGION_SELECTOR);
    if (!region || typeof region.querySelector !== "function") return null;
    return (
      region.querySelector(MATERIALS_MOUNT_SELECTOR)
      || region.querySelector(BRIEF_SELECTOR)
    );
  }

  /* Manifest ownership: role-materials is the only module that fetches the
     manifest, so it announces every manifest it renders and keeps the last
     one readable. The Case model reads it instead of re-fetching. */
  var currentManifest = null;
  /* What role-materials last painted into the mount: the Case rebuilds
     its whole region on jb:materials:manifest (and other events), which
     replaces the [data-mount="materials"] element — role.js then calls
     rehydrateOpenRole() to repaint this state into the fresh mount
     WITHOUT re-dispatching the event (that would loop). */
  var lastPaint = null;
  /* …and for WHICH role. Switching straight from A to B never fires
     jb:role:closed, so without this the repaint painted A's files into B's
     Materials lane (P0-0b). */
  var lastPaintKey = null;

  function paintedRoleKey() {
    if (currentContext && currentContext.jobKey != null && currentContext.jobKey !== "") return String(currentContext.jobKey);
    if (currentManifest && currentManifest.jobKey) return String(currentManifest.jobKey);
    return "";
  }

  function openRoleKey() {
    var flow = root.JobBoredFlowing && root.JobBoredFlowing.openRole;
    var key = flow && typeof flow.get === "function" ? flow.get() : null;
    return key == null ? "" : String(key);
  }

  function commitManifest(hostEl, manifest, base, jobKey) {
    manifest = holdOptimistic(manifest);
    Object.keys(scribeSaves).forEach(function (k) {
      if (manifest && k.indexOf(manifest.slug + "|") === 0 && scribeSaves[k] === manifest.runId) delete scribeSaves[k];
    });
    renderManifest(hostEl, manifest, base);
    lastPaint = { kind: "manifest" };
    lastPaintKey = paintedRoleKey();
    currentManifest = {
      jobKey: jobKey != null && jobKey !== ""
        ? jobKey
        : (currentContext && currentContext.jobKey) || "",
      manifest: manifest,
      base: base,
    };
    dispatch("jb:materials:manifest", {
      jobKey: currentManifest.jobKey,
      manifest: manifest,
    });
    refreshScore();
    maybeFinishRepair(manifest, base);
    return manifest;
  }

  function getCurrentManifest() {
    return currentManifest;
  }

  function rehydrateOpenRole() {
    var host = findMount();
    if (!host || !lastPaint) return;
    /* Only ever repaint the role we painted: a stale repaint under a
       different role lists the previous role's files (P0-0b). */
    var open = openRoleKey();
    if (open && lastPaintKey && open !== lastPaintKey) return;
    if (lastPaint.kind === "manifest") {
      if (currentManifest && currentManifest.manifest) renderManifest(host, currentManifest.manifest, currentManifest.base);
    } else if (lastPaint.kind === "empty") {
      renderEmpty(host, lastPaint.options);
    } else if (lastPaint.kind === "error") {
      renderError(host, lastPaint.message);
    } else if (lastPaint.kind === "server-down") {
      renderServerDown(host);
    } else if (lastPaint.kind === "resume-gate") {
      renderResumeGate(host);
    }
  }

  function wireSection(briefEl) {
    if (!briefEl) return;
    var section = briefEl.querySelector("." + SECTION_CLASS);
    if (!section || section.__wired) return;
    section.__wired = true;
    section.addEventListener("change", function (e) {
      var t = e && e.target;
      if (t && t.getAttribute && t.getAttribute("data-materials-outreach") != null) includeOutreach = !!t.checked;
      if (t && t.getAttribute && t.getAttribute("data-repair-issue") != null) syncRepairForm(t.closest(".mat-repair"));
    });
    section.addEventListener("submit", function (e) {
      var form = e && e.target;
      if (!form || !form.classList || !form.classList.contains("mat-repair")) return;
      e.preventDefault();
      submitRepairForm(form, section);
    });
    section.addEventListener("input", function (e) {
      var t = e && e.target;
      if (t && t.getAttribute && t.getAttribute("data-materials-notes") != null) {
        draftNotes = String(t.value || "");
      }
      if (t && t.getAttribute && t.getAttribute("data-repair-instruction") != null) syncRepairForm(t.closest(".mat-repair"));
      if (t && t.getAttribute && t.getAttribute("data-materials-outreach") != null) {
        includeOutreach = !!t.checked;
      }
    });
    section.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== section) {
        if (t.getAttribute) {
          if (t.hasAttribute && t.hasAttribute("data-score-open")) {
            if (typeof e.preventDefault === "function") e.preventDefault();
            openScore(t.getAttribute("data-feature") || docTypeOf(docHostOf(t)), t);
            return;
          }
          var action = t.getAttribute("data-action");
          if (action === "materials-download" && t.getAttribute("data-gate") === "fail") {
            /* U-1: a FAIL draft never downloads silently — ask in the page. */
            if (typeof e.preventDefault === "function") e.preventDefault();
            closeDownloadMenus(section);
            showFailConfirm(t, { kind: "link", href: t.getAttribute("href") || "", filename: t.getAttribute("data-filename") || "" });
            return;
          }
          if (action === "materials-preview" || action === "materials-download") {
            if (action === "materials-download") closeDownloadMenus(section);
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
          if (action === "materials-download-menu") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            toggleDownloadMenu(t, section);
            return;
          }
          if (action === "materials-download-anyway") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            downloadAnyway(t, section);
            return;
          }
          if (action === "materials-copy-linkedin") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            closeDownloadMenus(section);
            if (t.getAttribute("data-gate") === "fail") {
              showFailConfirm(t, { kind: "linkedin" });
              return;
            }
            copyForLinkedIn(t, section);
            return;
          }
          if (action === "materials-open-profile") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            openProfileSettings(t.getAttribute("data-focus") || "");
            return;
          }
          if (action === "materials-history") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            toggleHistory(t, section);
            return;
          }
          if (action === "materials-promote") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            promoteVersion(t, section);
            return;
          }
          if (action === "materials-diff") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            diffVersions(t, section);
            return;
          }
          if (action === "materials-copy-text") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            copyNearbyText(t);
            return;
          }
          if (action === "materials-checklist-toggle") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            toggleChecklist(t);
            return;
          }
          if (action === "materials-draft-both") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            handleDraftRequest("resume", null, { then: "cover_letter" });
            return;
          }
          if (action === "materials-dismiss") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            handleDismiss(section.getAttribute("data-slug") || "");
            return;
          }
          if (action === "materials-regenerate") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            if (t.getAttribute("aria-disabled") === "true") return;
            handleRegenerate(
              section.getAttribute("data-slug") || "",
              t.getAttribute("data-template") || "",
            );
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
          if (action === "materials-server-retry") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            retryServer();
            return;
          }
          if (action === "materials-copy-command") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            copyStartCommand(t);
            return;
          }
          if (action === "materials-open-md") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            toggleMarkdown(t, section);
            return;
          }
          if (action === "materials-edit") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            openScribe(t, section);
            return;
          }
          if (action === "materials-repair") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            removeFailConfirm(t);
            openRepairForm(t, section);
            return;
          }
          if (action === "materials-repair-cancel") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            closeRepairForm(t.closest(".mat-repair"));
            return;
          }
          if (action === "materials-repair-dismiss") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            dismissRepairOutcome(t);
            return;
          }
          if (action === "materials-confirm-cancel") {
            if (typeof e.preventDefault === "function") e.preventDefault();
            removeFailConfirm(t);
            return;
          }
        }
        t = t.parentNode;
      }
      /* A click anywhere else in the section closes an open menu. */
      closeDownloadMenus(section);
    });
    section.addEventListener("keydown", function (e) {
      if (!e || e.key !== "Escape") return;
      var open = section.querySelector(".mat-dl__menu:not([hidden])");
      var confirm = section.querySelector(".mat-confirm");
      var inRepair = e.target && e.target.closest ? e.target.closest(".mat-repair") : null;
      var repairOpen = inRepair || (!open && !confirm ? section.querySelector(".mat-repair") : null);
      if (repairOpen) {
        closeRepairForm(repairOpen);
      } else if (open) {
        var toggle = open.parentNode && open.parentNode.querySelector(".mat-dl__toggle");
        closeDownloadMenus(section);
        if (toggle && typeof toggle.focus === "function") toggle.focus();
      } else if (confirm) {
        removeFailConfirm(confirm);
      }
    });
    ensureOutsideMenuClose();
  }

  /* -------------------- Wave 2: menus, gate, exports, history -------------------- */

  var outsideCloseWired = false;
  function ensureOutsideMenuClose() {
    if (outsideCloseWired || typeof document === "undefined" || !document.addEventListener) return;
    outsideCloseWired = true;
    document.addEventListener("click", function (e) {
      var t = e && e.target;
      while (t && t.getAttribute) {
        if (t.getAttribute("data-dl") != null) return;
        t = t.parentNode;
      }
      if (document.querySelectorAll) {
        var menus = document.querySelectorAll(".mat-dl__menu:not([hidden])");
        for (var i = 0; i < menus.length; i++) closeMenu(menus[i]);
      }
    });
  }

  function closeMenu(menu) {
    if (!menu) return;
    menu.setAttribute("hidden", "");
    var toggle = menu.parentNode && menu.parentNode.querySelector ? menu.parentNode.querySelector(".mat-dl__toggle") : null;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function closeDownloadMenus(section, except) {
    if (!section || !section.querySelectorAll) return;
    var menus = section.querySelectorAll(".mat-dl__menu:not([hidden])");
    for (var i = 0; i < menus.length; i++) if (menus[i] !== except) closeMenu(menus[i]);
  }

  function toggleDownloadMenu(btn, section) {
    var wrap = btn.parentNode;
    var menu = wrap && wrap.querySelector ? wrap.querySelector(".mat-dl__menu") : null;
    if (!menu) return;
    var opening = menu.hasAttribute("hidden");
    closeDownloadMenus(section, menu);
    if (!opening) {
      closeMenu(menu);
      return;
    }
    menu.removeAttribute("hidden");
    btn.setAttribute("aria-expanded", "true");
    var first = menu.querySelector("[role=menuitem]");
    if (first && typeof first.focus === "function") first.focus();
  }

  /* The row (or legacy card) a control belongs to. */
  function docHostOf(node) {
    var t = node;
    while (t && t.getAttribute) {
      if (t.getAttribute("data-doc") != null || t.getAttribute("data-doc-type") != null) return t;
      t = t.parentNode;
    }
    return null;
  }

  function docTypeOf(host) {
    if (!host) return "";
    return host.getAttribute("data-doc") || host.getAttribute("data-doc-type") || "";
  }

  function showFailConfirm(trigger, target) {
    var mi = insights();
    var host = docHostOf(trigger);
    if (!mi || !host) return;
    var prior = host.querySelector(".mat-confirm");
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);
    var holder = document.createElement("div");
    var type = docTypeOf(host);
    /* D2: an old run is read-only, so its confirm offers Cancel, not Repair. */
    holder.innerHTML = mi.failConfirmHtml(type, target, { repair: mi.canRepair(qualityDocFor(type)) });
    var box = holder.firstElementChild || holder.firstChild;
    if (!box) return;
    host.appendChild(box);
    var first = box.querySelector("button");
    if (first && typeof first.focus === "function") first.focus();
  }

  function removeFailConfirm(node) {
    var t = node;
    while (t && t.getAttribute) {
      if (t.classList && t.classList.contains("mat-confirm")) {
        if (t.parentNode) t.parentNode.removeChild(t);
        return;
      }
      t = t.parentNode;
    }
  }

  function triggerDownload(href) {
    if (!href || typeof document === "undefined") return;
    var a = document.createElement("a");
    a.href = href;
    a.setAttribute("download", "");
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    if (a.parentNode) a.parentNode.removeChild(a);
  }

  function downloadAnyway(btn, section) {
    var kind = btn.getAttribute("data-kind") || "link";
    var host = docHostOf(btn);
    removeFailConfirm(btn);
    if (kind === "linkedin") {
      copyForLinkedIn(host || btn, section);
      return;
    }
    var href = btn.getAttribute("data-href") || "";
    triggerDownload(href);
    dispatch("jb:role:materials:downloaded", {
      slug: section.getAttribute("data-slug") || "",
      filename: btn.getAttribute("data-filename") || "",
      afterFailConfirm: true,
    });
  }

  function copyForLinkedIn(node, section) {
    var slug = section.getAttribute("data-slug") || "";
    if (!slug) return;
    var host = docHostOf(node);
    fetchJson(exportUrl(materialsBase(), slug, "linkedin.json")).then(function (body) {
      var text = String((body && body.text) || "");
      if (!text) throw new Error("nothing to copy yet");
      var nav = root.navigator;
      var write = nav && nav.clipboard && typeof nav.clipboard.writeText === "function"
        ? nav.clipboard.writeText(text)
        : Promise.reject(new Error("no clipboard"));
      return write.then(function () {
        toast("Copied your About and Experience. Paste them into LinkedIn.", "success");
      }, function () {
        showCopyFallback(host, text);
      });
    }).catch(function (err) {
      toast("Couldn\u2019t build the LinkedIn text: " + ((err && err.message) || "unknown error"), "error");
    });
  }

  /* No clipboard permission: show the text selected, ready for Ctrl/Cmd+C. */
  function showCopyFallback(host, text) {
    if (!host || typeof document === "undefined") return;
    var prior = host.querySelector(".mat-copy");
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);
    var box = document.createElement("div");
    box.className = "mat-copy";
    var label = document.createElement("p");
    label.className = "mat-copy__hint";
    label.textContent = "Copy this into LinkedIn (it is selected: press Ctrl+C or \u2318C).";
    var area = document.createElement("textarea");
    area.className = "mat-copy__text";
    area.readOnly = true;
    area.rows = 8;
    area.setAttribute("aria-label", "About and Experience text for LinkedIn");
    area.value = text;
    box.appendChild(label);
    box.appendChild(area);
    host.appendChild(box);
    try { area.focus(); area.select(); } catch (e) { /* selection is a convenience */ }
  }

  function openProfileSettings(focus) {
    var open = root.openCommandCenterSettingsModal;
    if (typeof open === "function") {
      try {
        open({ tab: "fit-profile" });
        return;
      } catch (e) { /* fall through to the resume view */ }
    }
    if (focus !== "voice") openResume();
  }

  /* -------------------- Wave 3: outreach note + company facts --------------------
     Both are read lazily from the package (outreach.json, intel.json) when the
     manifest names them, cached per run, and painted in place. Absent fields
     render nothing. */
  var includeOutreach = false;
  var outreachCache = {};
  var intelCache = {};

  function outreachOptionHtml() {
    return '<label class="mat-opt"><input type="checkbox" data-materials-outreach' + (includeOutreach ? " checked" : "") + '>'
      + '<span>Include outreach note</span><span class="mat-opt__hint">A LinkedIn note and a short email to the hiring manager, written with the cover letter.</span></label>';
  }

  function outreachMeta(manifest) {
    var o = manifest && manifest.outreach;
    return o && typeof o === "object" ? o : null;
  }

  function outreachRowHtml(manifest) {
    var mi = insights();
    var meta = outreachMeta(manifest);
    if (!mi || !meta) return "";
    var key = manifest.slug + "|" + String(meta.runId || manifest.runId || "");
    var hit = outreachCache[key];
    if (!hit) {
      outreachCache[key] = { state: "loading" };
      loadOutreach(manifest.slug, String(meta.json || "outreach.json"), key);
    }
    var record = hit && hit.state === "done" ? hit.record : null;
    var body = record ? mi.outreachHtml(record, meta) : "";
    var tone = mi.outreachStatus(meta, record);
    return '<div class="case__doc case__doc--ready mat-outreach" data-doc="outreach_note">'
      + '<div class="case__doc-n"><span class="case__doc-label">Outreach note</span></div>'
      + '<span class="case__docst case__docst--' + (tone ? "qa-" + tone : "ready") + '" data-outreach-qa="' + escapeHtml(tone) + '">'
        + escapeHtml(tone || "drafted") + '</span>'
      + '<div class="case__doc-meta">LinkedIn note + email</div>'
      + '<div class="case__doc-qa" data-outreach-body>' + (body || (hit && hit.state === "none"
        ? '<p class="mat-hist__empty">The note isn\u2019t on disk any more. Draft the letter again with the outreach note.</p>'
        : '<p class="mat-hist__empty">Loading the note\u2026</p>')) + '</div>'
    + '</div>';
  }

  function loadOutreach(slug, filename, key) {
    if (!ALLOWED_FILES[filename]) filename = "outreach.json";
    fetchJson(fileUrl(materialsBase(), slug, filename)).then(function (record) {
      outreachCache[key] = { state: "done", record: record };
    }, function () {
      outreachCache[key] = { state: "none" };
    }).then(function () { repaintMaterials(slug); });
  }

  function intelFor(manifest) {
    var mi = insights();
    var meta = manifest && manifest.intel && typeof manifest.intel === "object" ? manifest.intel : null;
    if (!mi || !meta) return "";
    if (Array.isArray(meta.facts)) return mi.intelHtml(mi.intelFactsFrom(null, meta), manifest.company, meta.degraded);
    var key = manifest.slug + "|" + String(meta.runId || manifest.runId || "");
    var hit = intelCache[key];
    if (!hit) {
      intelCache[key] = { state: "loading" };
      fetchJson(fileUrl(materialsBase(), manifest.slug, "intel.json")).then(function (pack) {
        intelCache[key] = { state: "done", facts: mi.intelFactsFrom(pack, null) };
      }, function () {
        intelCache[key] = { state: "none" };
      }).then(function () { repaintMaterials(manifest.slug); });
      return "";
    }
    return hit.state === "done" ? mi.intelHtml(hit.facts, manifest.company, meta.degraded) : "";
  }

  /* Repaint the rows from the last manifest once lazily-read data lands. */
  function repaintMaterials(slug) {
    if (!currentManifest || !currentManifest.manifest || currentManifest.manifest.slug !== slug) return;
    var host = findMount();
    if (!host) return;
    var section = host.querySelector && host.querySelector("." + SECTION_CLASS);
    if (section && section.contains && typeof document !== "undefined" && section.contains(document.activeElement)
      && document.activeElement && document.activeElement.tagName === "TEXTAREA") return;
    renderManifest(host, currentManifest.manifest, currentManifest.base);
  }

  function copyNearbyText(btn) {
    var part = btn.parentNode;
    var src = part && part.querySelector ? part.querySelector("[data-copy-src]") : null;
    if (!src) return;
    var text = String(src.textContent || "");
    var nav = root.navigator;
    var write = nav && nav.clipboard && typeof nav.clipboard.writeText === "function"
      ? nav.clipboard.writeText(text)
      : Promise.reject(new Error("no clipboard"));
    write.then(function () {
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = "Copy"; }, 1600);
    }, function () {
      /* No clipboard permission: select the text for Ctrl/Cmd+C. */
      try {
        var range = document.createRange();
        range.selectNodeContents(src);
        var sel = root.getSelection && root.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        btn.textContent = "Selected: press \u2318C";
      } catch (e) { /* a convenience */ }
    });
  }

  /* The manual-apply checklist (apply-checklist.js). Open by default; the
     row's toggle folds it for this session. */
  var checklistOpen = true;
  function checklistAvailable() {
    return !!(root.JobBoredApplyChecklist && root.customElements
      && typeof root.customElements.get === "function" && root.customElements.get("jb-apply-checklist"));
  }

  function toggleChecklist(btn) {
    checklistOpen = !checklistOpen;
    var row = docHostOf(btn);
    if (!row) return;
    btn.setAttribute("aria-expanded", checklistOpen ? "true" : "false");
    btn.textContent = checklistOpen ? "Hide checklist" : "Show checklist";
    var el = row.querySelector("jb-apply-checklist");
    if (!checklistOpen) {
      var band = el && el.parentNode;
      if (el && band) band.removeChild(el);
      if (band && !band.children.length && band.parentNode) band.parentNode.removeChild(band);
      return;
    }
    if (currentManifest && currentManifest.manifest) {
      var host = findMount();
      if (host) renderManifest(host, currentManifest.manifest, currentManifest.base);
    }
  }

  /* U-7: role-term coverage, computed in the browser with Scribe's own
     keywordCoverage over the run's jd-extract.json nouns. One fetch pair per
     served text version. HOLES SCORE: it is shown in the score modal's
     Keyword coverage step, never inline in a row. */
  var coverageCache = {};
  function coverageOf(manifest, type, doc) {
    var score = root.JobBoredScribeScore;
    if (!insights() || !score || typeof score.keywordCoverage !== "function") return null;
    if (!manifest || !doc || !doc.text || !doc.text.filename) return null;
    var key = manifest.slug + "|" + type + "|" + fileVersion(doc.text) + "|" + (manifest.runId || "");
    var hit = coverageCache[key];
    if (hit && hit.state === "done") return hit.cov;
    if (!hit) {
      coverageCache[key] = { state: "loading" };
      loadCoverage(manifest.slug, type, doc, key);
    }
    return null;
  }

  function loadCoverage(slug, type, doc, key) {
    var base = materialsBase();
    Promise.all([
      fetchJson(fileUrl(base, slug, "jd-extract.json")),
      fetchText(fileUrl(base, slug, doc.text.filename, { version: fileVersion(doc.text) })),
    ]).then(function (out) {
      var mi = insights();
      var score = root.JobBoredScribeScore;
      if (!mi || !score) return;
      var terms = mi.termsFromExtract(out[0]);
      if (!terms.length) {
        coverageCache[key] = { state: "none" };
        return;
      }
      coverageCache[key] = { state: "done", cov: score.keywordCoverage(String(out[1] || ""), terms) };
      refreshScore();
    }).catch(function () {
      coverageCache[key] = { state: "none" };
    });
  }

  /* U-6: every run of this document, which one is in use, and a diff. */
  function toggleHistory(btn, section) {
    var mi = insights();
    var row = docHostOf(btn);
    if (!mi || !row) return;
    var open = row.querySelector(".mat-hist");
    if (open) {
      if (open.parentNode) open.parentNode.removeChild(open);
      btn.setAttribute("aria-expanded", "false");
      return;
    }
    var type = btn.getAttribute("data-feature") || docTypeOf(row);
    var slug = section.getAttribute("data-slug") || "";
    var panel = document.createElement("div");
    panel.className = "mat-hist";
    panel.setAttribute("data-hist-for", type);
    panel.innerHTML = '<p class="mat-hist__empty">Loading versions\u2026</p>';
    row.appendChild(panel);
    btn.setAttribute("aria-expanded", "true");
    fetchJson(materialsBase() + "/api/applications/" + encodeURIComponent(slug) + "/runs").then(function (body) {
      panel.innerHTML = mi.historyHtml(body && body.runs, type);
    }).catch(function (err) {
      panel.innerHTML = '<p class="mat-hist__empty">' + escapeHtml("Couldn\u2019t load versions: " + ((err && err.message) || "unknown error")) + "</p>";
    });
  }

  function promoteRun(slug, runId) {
    var base = materialsBase();
    return postJson(base + "/api/applications/" + encodeURIComponent(slug) + "/runs/" + encodeURIComponent(runId) + "/promote", {})
      .then(function () {
        dispatch("jb:materials:changed", { slug: slug, reason: "promoted" });
        return fetchJson(base + "/api/applications/" + encodeURIComponent(slug) + "/manifest");
      })
      .then(function (manifest) {
        var brief = findMount();
        if (brief && manifest) commitManifest(brief, manifest, base, currentContext && currentContext.jobKey);
        toast("That version is in use again. Preview and Download serve it now.", "success");
      });
  }

  function promoteVersion(btn, section) {
    var runId = btn.getAttribute("data-run") || "";
    var slug = section.getAttribute("data-slug") || "";
    if (!runId || !slug) return;
    btn.setAttribute("disabled", "");
    promoteRun(slug, runId).catch(function (err) {
      btn.removeAttribute("disabled");
      toast("Couldn\u2019t switch versions: " + ((err && err.message) || "unknown error"), "error");
    });
  }

  function diffVersions(btn, section) {
    var mi = insights();
    var panel = btn;
    while (panel && !(panel.classList && panel.classList.contains("mat-hist"))) panel = panel.parentNode;
    if (!mi || !panel) return;
    var a = panel.querySelector("[data-hist-a]");
    var b = panel.querySelector("[data-hist-b]");
    var out = panel.querySelector("[data-hist-diff]");
    var slug = section.getAttribute("data-slug") || "";
    var doc = btn.getAttribute("data-feature") || "resume";
    if (!a || !b || !out || !slug) return;
    out.innerHTML = '<p class="mat-hist__empty">Comparing\u2026</p>';
    fetchJson(materialsBase() + "/api/applications/" + encodeURIComponent(slug) + "/runs-diff?a="
      + encodeURIComponent(a.value) + "&b=" + encodeURIComponent(b.value) + "&doc=" + encodeURIComponent(doc))
      .then(function (diff) { out.innerHTML = mi.diffHtml(diff); })
      .catch(function (err) {
        out.innerHTML = '<p class="mat-hist__empty">' + escapeHtml("Couldn\u2019t compare: " + ((err && err.message) || "unknown error")) + "</p>";
      });
  }

  function rowOf(node) {
    var t = node;
    while (t && t.getAttribute) {
      if (t.getAttribute("data-doc") != null) return t;
      t = t.parentNode;
    }
    return null;
  }

  function fetchText(url) {
    if (typeof fetch !== "function") return Promise.reject(new Error("fetch unavailable"));
    return apiFetch(url, { credentials: "omit", cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("Materials server returned " + res.status);
      return res.text();
    });
  }

  function materialsBase() {
    return (currentManifest && currentManifest.base) || getBaseUrl();
  }

  /* C13 (TA-11): read the QA report or checklist inline, under its row. The
     text is plain text in a <pre>, never parsed as HTML. */
  function toggleMarkdown(btn, section) {
    var row = rowOf(btn);
    if (!row) return;
    var open = row.querySelector(".case__doc-read");
    if (open) {
      if (open.parentNode) open.parentNode.removeChild(open);
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "Open";
      return;
    }
    var slug = section.getAttribute("data-slug") || "";
    var filename = btn.getAttribute("data-filename") || "";
    if (!slug || !ALLOWED_FILES[filename]) return;
    var panel = document.createElement("div");
    panel.className = "case__doc-read";
    var pre = document.createElement("pre");
    pre.className = "case__doc-read-text";
    pre.textContent = "Loading\u2026";
    panel.appendChild(pre);
    row.appendChild(panel);
    btn.setAttribute("aria-expanded", "true");
    btn.textContent = "Close";
    fetchText(fileUrl(materialsBase(), slug, filename)).then(function (text) {
      pre.textContent = text;
    }).catch(function (err) {
      pre.textContent = "Couldn\u2019t open " + filename + ": " + ((err && err.message) || "unknown error");
    });
  }

  /* EDITOR F1: Edit opens Scribe v2 bound to this role's server package
     (docs/programs/editor-20260927/SPEC.md §1). The desk reads the package
     itself; nothing is flattened to text here. */
  function openScribe(btn, section) {
    var desk = root.JB_SCRIBE_V2;
    var slug = section.getAttribute("data-slug") || "";
    var feature = btn.getAttribute("data-feature") || "";
    if (!slug || (feature !== "resume" && feature !== "cover_letter")) return;
    /* U15: an Edit that cannot open says so instead of doing nothing. */
    var cantOpen = function () {
      toast("The editor didn\u2019t load, so the " + featureLabel(feature) + " can\u2019t open for editing. Reload the page and try again.", "error");
    };
    if (!desk || typeof desk.open !== "function") { cantOpen(); return; }
    var jobKey = openRoleKey() || (currentContext && currentContext.jobKey) || "";
    var job = getMaterialsJob(jobKey) || {};
    var manifest = currentManifest && currentManifest.manifest;
    var family = manifest && manifest.template && manifest.template.family ? String(manifest.template.family) : "";
    var opened = desk.open({
      slug: slug,
      doc: feature,
      base: materialsBase(),
      opener: btn,
      /* A manifest poll can repaint the rows while the desk is open; focus
         then returns to the live Edit button for the same document. */
      findOpener: function () {
        var doc = root.document;
        if (!doc) return null;
        var buttons = doc.querySelectorAll('[data-action="materials-edit"]');
        for (var i = 0; i < buttons.length; i++) {
          var b = buttons[i];
          var host = b.closest ? b.closest("." + SECTION_CLASS) : null;
          if (b.getAttribute("data-feature") === feature && host && host.getAttribute("data-slug") === slug) return b;
        }
        return null;
      },
      title: String(job.role || job.title || (manifest && manifest.title) || ""),
      company: String(job.company || (manifest && manifest.company) || ""),
      family: family,
      /* HOLES SCORE: the desk's header shows this document's grade, and its
         modal pre-fills the desk's composer instead of Repair. */
      score: {
        gradeFor: function (doc) { return gradeFor(doc); },
        open: function (doc, opener, hooks) { return openScore(doc, opener, hooks); },
      },
    });
    if (!opened) cantOpen();
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
        var brief = findMount();
        if (brief) commitManifest(brief, manifest, base);
        dispatch("jb:materials:changed", { slug: slug, reason: "dismiss" });
      })
      .catch(function (err) {
        var brief = findMount();
        if (brief) renderError(brief, "Couldn't dismiss: " + ((err && err.message) || "unknown error"));
      });
  }

  function handleRetry(slug, feature) {
    if (!slug || !feature || !currentContext) return;
    var ctx = currentContext;
    /* Retry is dismiss + immediate re-request, reusing the original
       notes and metadata so the user doesn't have to retype. */
    var prevNotes = "";
    var brief = findMount();
    var noteEl = brief && brief.querySelector(".brief-materials__progress-note");
    if (noteEl) {
      prevNotes = String(noteEl.textContent || "").replace(/^"|"$/g, "").trim();
    }
    /* Retry now runs through the same JD fallback chain as a fresh
       click. The screenshot-bug case ("Missing job-description.md")
       used to lock the user in a retry-fail loop because Retry would
       just re-fire /request without ensuring a JD was on disk. Now
       it dismisses the old pending.json, runs the JD chain (browser
       cache → server scrape → user paste), then re-submits. */
    postJson(ctx.base + "/api/applications/" + encodeURIComponent(slug) + "/dismiss", {})
      .catch(function () { /* dismiss may 404 if Dobby already cleared it — that's fine */ })
      .then(function () { return readResume(); })
      .then(function (r) {
        if (r.available && !r.resume) { renderResumeGate(findMount()); return null; }
        return submitDraftRequest(ctx, feature, prevNotes, r.resume);
      });
  }

  /* U14: one template change at a time. A second click while the first
     is running sends nothing, and the links say they are busy. */
  var regenerating = false;

  function markRegenerating(on) {
    regenerating = on;
    var section = currentSection();
    var links = section && section.querySelectorAll ? section.querySelectorAll('[data-action="materials-regenerate"]') : [];
    for (var i = 0; i < links.length; i++) {
      if (on) links[i].setAttribute("aria-disabled", "true");
      else links[i].removeAttribute("aria-disabled");
    }
  }

  function handleRegenerate(slug, template) {
    if (!slug || !template || !currentContext || regenerating) return;
    var ctx = currentContext;
    markRegenerating(true);
    toast("Changing the template to " + templateLabel(template) + "\u2026", "info");
    return postJson(ctx.base + "/api/applications/" + encodeURIComponent(slug) + "/regenerate", { template: template })
      .then(function () {
        dispatch("jb:materials:changed", { slug: slug, reason: "regenerated" });
        return fetchJson(ctx.base + "/api/applications/" + encodeURIComponent(slug) + "/manifest");
      })
      .then(function (manifest) {
        regenerating = false;
        var brief = findMount();
        if (brief && manifest) commitManifest(brief, manifest, ctx.base, ctx.jobKey);
        toast("Changed the template to " + templateLabel(template) + ". Nothing was rewritten.", "success");
      })
      .catch(function (err) {
        toast("Couldn\u2019t change the template: " + ((err && err.message) || "unknown error"), "error");
      })
      .then(function () { markRegenerating(false); });
  }

  /* -------------------- HOLES SCORE: the grade button and its modal --------------------
     Spec §0.3/§2 SCORE: a drafted resume or letter shows one grade button
     (materials-score.js); what the graders said opens in the score modal.
     role-materials owns the manifest, so it builds what the modal reads and
     takes its actions — for the rows, the Case (role-case.js) and Scribe's
     header (scribe-v2.js). Fix this, Apply and Repair pre-fill the row's
     Repair form; opened from Scribe, they pre-fill Scribe's composer. */

  var ATS_FEATURE = { resume: "resume_update", cover_letter: "cover_letter" };
  /* U12: Scribe saves the manifest has not caught up with, slug|doc -> runId. */
  var scribeSaves = {};
  var scoreOpen = null;
  var rescoring = {};

  function scoreApi() {
    var ms = root.JobBoredMaterialsScore;
    return ms && typeof ms.gradeOf === "function" && typeof ms.open === "function" ? ms : null;
  }

  function scoreJobKey() {
    return openRoleKey() || (currentContext && currentContext.jobKey) || (currentManifest && currentManifest.jobKey) || "";
  }

  /* The role's job as the ATS scorer and the scorecard store key it. */
  function scoreJob() {
    var key = scoreJobKey();
    var core = root.JobBoredApp && root.JobBoredApp.core;
    if (key !== "" && core && typeof core.getJobByStableKey === "function") {
      try {
        var job = core.getJobByStableKey(key);
        if (job) return job;
      } catch (e) { /* fall through */ }
    }
    return key !== "" ? getPipelineJobByKey(key) : null;
  }

  /* The role keeps one stored scorecard, and it rates the document it
     names: a letter's score is never the resume's grade. */
  function atsEntryFor(feature) {
    var state = root.JobBoredApp && root.JobBoredApp.materialsState;
    var job = scoreJob();
    if (!state || typeof state.getScorecardForJob !== "function" || !job) return null;
    var entry = null;
    try { entry = state.getScorecardForJob(job); } catch (e) { entry = null; }
    if (!entry || !entry.result) return null;
    return entry.feature === ATS_FEATURE[feature] ? entry : null;
  }

  function qualityDocOf(manifest, feature) {
    var docs = manifest && manifest.quality && manifest.quality.documents ? manifest.quality.documents : null;
    return docs ? docs[feature] : undefined;
  }

  function docOf(manifest, feature) {
    var docs = manifest && Array.isArray(manifest.documents) ? manifest.documents : [];
    return docs.filter(function (d) { return d && d.type === feature; })[0] || null;
  }

  /* U12: a grade is stale once the draft moves on — a Scribe save the
     manifest hasn't caught up with, or a role-match score older than the
     text it rated. MATQ's runId (and an equal docHash) decide when the
     scorecard carries them. */
  function scoreIsStale(manifest, feature, entry, grade) {
    if (!manifest) return false;
    var saved = scribeSaves[manifest.slug + "|" + feature];
    if (saved && saved !== manifest.runId) return true;
    if (!entry || grade.source !== "ats") return false;
    var r = entry.result || {};
    var qa = (qualityDocOf(manifest, feature) || {}).qa || null;
    if (r.runId && qa && qa.runId) return r.runId !== qa.runId;
    if (r.docHash && qa && qa.textHash && r.docHash === qa.textHash) return false;
    var doc = docOf(manifest, feature);
    var changed = Date.parse(String((doc && doc.text && doc.text.modifiedAt) || (doc && doc.lastModifiedAt) || ""));
    var scored = Date.parse(String(entry.storedAt || ""));
    return Number.isFinite(changed) && Number.isFinite(scored) && changed > scored;
  }

  /** { grade, stale } for one document of the manifest (default: the open one). */
  function gradeFor(feature, manifest) {
    var ms = scoreApi();
    var m = manifest || (currentManifest && currentManifest.manifest) || null;
    if (!ms || (feature !== "resume" && feature !== "cover_letter")) return null;
    var entry = atsEntryFor(feature);
    var grade = ms.gradeOf(qualityDocOf(m, feature), entry);
    return { grade: grade, stale: scoreIsStale(m, feature, entry, grade) };
  }

  function gradeButtonHtml(manifest, feature) {
    var ms = scoreApi();
    var g = ms ? gradeFor(feature, manifest) : null;
    return g ? ms.buttonHtml(g.grade, { feature: feature, scope: "row", stale: g.stale }) : "";
  }

  function canRescore(manifest, feature) {
    var ats = root.JobBoredApp && root.JobBoredApp.ats;
    var doc = docOf(manifest, feature);
    return !!(ats && typeof ats.startAtsScorecardAnalysis === "function" && doc && doc.text && doc.text.filename && scoreJob());
  }

  function scoreData(feature, fill) {
    var m = currentManifest && currentManifest.manifest;
    var mi = insights();
    var qd = qualityDocOf(m, feature);
    var entry = atsEntryFor(feature);
    var g = gradeFor(feature, m);
    var pendingHere = !!(m && m.pending && /^(resume|cover_letter|both)$/.test(String(m.pending.feature || ""))
      && !/^(complete|done|failed)$/i.test(String((m.pending.progress && m.pending.progress.phase) || "queued")));
    var repairable = !!(m && mi && mi.canRepair(qd) && !pendingHere);
    var doc = docOf(m, feature);
    return {
      feature: feature,
      role: [m && m.title, m && m.company].filter(Boolean).join(" \u00b7 "),
      drafted: doc && doc.lastModifiedAt ? String(doc.lastModifiedAt) : "",
      qualityDoc: qd,
      ats: entry,
      stale: !!(g && g.stale),
      coverage: coverageOf(m, feature, doc),
      busy: !!rescoring[feature],
      can: {
        fix: !!fill || repairable,
        apply: !!fill || repairable,
        repair: !!fill || repairable,
        rescore: canRescore(m, feature),
        promote: !fill && !!m,
        retry: !fill && !!m,
        profile: !fill,
      },
    };
  }

  /* Repair, pre-filled: the instruction, and only the issue it came from
     ticked. Focus lands in the instruction box (paintRepairForm). */
  function prefillRepair(feature, item) {
    var section = currentSection();
    var mi = insights();
    if (!section || !mi || !currentManifest || !currentManifest.manifest) return;
    var checked = null;
    if (item && item.issueId) {
      checked = {};
      mi.repairTargets(qualityDocFor(feature)).forEach(function (t) { checked[t.id] = t.id === item.issueId; });
    }
    repairForm = {
      slug: section.getAttribute("data-slug") || currentManifest.manifest.slug,
      feature: feature,
      instruction: String((item && item.instruction) || "").slice(0, mi.REPAIR_MAX || 600),
      checked: checked, error: "", busy: false, requestId: "",
    };
    paintRepairForm(section);
  }

  /* Scribe's Repair: the blockers, as one instruction for its composer. */
  function blockerInstruction(feature) {
    var mi = insights();
    var qd = qualityDocFor(feature);
    var qa = qd && qd.qa;
    var reasons = mi && qa && mi.qaVersion(qa) === 2
      ? mi.qaIssues(qa).filter(function (it) { return it.group === "facts"; }).map(function (it) { return it.reason; })
      : [];
    (qd && Array.isArray(qd.issues) ? qd.issues : []).forEach(function (f) { if (f && f.message) reasons.push(String(f.message)); });
    reasons = reasons.filter(Boolean).slice(0, 3);
    return reasons.length ? "Fix these: " + reasons.join("; ") : "Fix what the grade found.";
  }

  /* Rescore: the role-match check over this package's own text, for this
     role. It resolves when the scorecard bus says the score landed. */
  function rescoreDoc(feature) {
    if (rescoring[feature]) return rescoring[feature];
    var ats = root.JobBoredApp && root.JobBoredApp.ats;
    var m = currentManifest && currentManifest.manifest;
    var doc = docOf(m, feature);
    var job = scoreJob();
    if (!ats || typeof ats.startAtsScorecardAnalysis !== "function") return Promise.reject(new Error("scoring isn\u2019t available in this session"));
    if (!m || !doc || !doc.text || !doc.text.filename) return Promise.reject(new Error("this draft has no text version to score"));
    if (!job) return Promise.reject(new Error("this role isn\u2019t loaded"));
    var atsFeature = ATS_FEATURE[feature];
    var run = fetchText(fileUrl(materialsBase(), m.slug, doc.text.filename, { version: fileVersion(doc.text) })).then(function (text) {
      var body = String(text || "").trim();
      if (!body) throw new Error("this draft is empty");
      var cacheKey = ats.computeAtsScorecardCacheKey(body, job, atsFeature);
      if (!cacheKey) throw new Error("this role is missing a title or company");
      var payload = ats.buildAtsScorecardRequestPayload(body, job, { feature: atsFeature });
      return new Promise(function (resolve, reject) {
        function onState(e) {
          var d = (e && e.detail) || {};
          if (d.jobKey !== cacheKey || (d.status !== "success" && d.status !== "error")) return;
          root.removeEventListener("jb:ats:state", onState);
          if (d.status === "success") resolve();
          else reject(new Error(d.error || "the scorer didn\u2019t return a result"));
        }
        root.addEventListener("jb:ats:state", onState);
        try {
          ats.startAtsScorecardAnalysis(cacheKey, payload, job);
        } catch (err) {
          root.removeEventListener("jb:ats:state", onState);
          reject(err);
        }
      });
    });
    rescoring[feature] = run;
    var done = function () { rescoring[feature] = null; repaintMaterials(m.slug); };
    run.then(done, done);
    return run;
  }

  /**
   * Open the score modal for one document of the open role. hooks.fill,
   * when Scribe passes it, takes Fix this, Apply and Repair instead of the
   * row's Repair form.
   */
  function openScore(feature, opener, hooks) {
    var ms = scoreApi();
    if (!ms || (feature !== "resume" && feature !== "cover_letter")) return null;
    var fill = hooks && typeof hooks.fill === "function" ? hooks.fill : null;
    var slug = currentManifest && currentManifest.manifest ? currentManifest.manifest.slug : "";
    var handle = ms.open({
      opener: opener || null,
      read: function () { return scoreData(feature, fill); },
      fix: function (item) { if (fill) fill(item.instruction); else prefillRepair(feature, item); },
      apply: function (s) { if (fill) fill(s.instruction); else prefillRepair(feature, { instruction: s.instruction }); },
      repair: function () { if (fill) fill(blockerInstruction(feature)); else prefillRepair(feature, null); },
      retry: function () { handleRetry(slug, feature); },
      profile: function (focus) { openProfileSettings(focus); },
      rescore: function () { return rescoreDoc(feature); },
      loadHistory: function () {
        return fetchJson(materialsBase() + "/api/applications/" + encodeURIComponent(slug) + "/runs").then(function (body) {
          return body && body.runs;
        });
      },
      promote: function (runId) { return promoteRun(slug, runId); },
      onClose: function () { if (scoreOpen && scoreOpen.handle === handle) scoreOpen = null; },
    });
    scoreOpen = handle ? { handle: handle, feature: feature, slug: slug } : null;
    return handle;
  }

  function refreshScore() {
    if (scoreOpen && scoreOpen.handle && scoreOpen.handle.isOpen()) scoreOpen.handle.refresh();
  }

  /* U12: a Scribe save marks the document's grade stale at once, then the
     manifest is read again so the fresh grade (or its absence) replaces it. */
  function onScribeSaved(e) {
    var d = (e && e.detail) || {};
    var cur = currentManifest;
    if (!cur || !cur.manifest || !d.slug || d.slug !== cur.manifest.slug || !d.doc) return;
    scribeSaves[d.slug + "|" + d.doc] = String(d.runId || "saved");
    repaintMaterials(d.slug);
    refreshScore();
    fetchJson(cur.base + "/api/applications/" + encodeURIComponent(d.slug) + "/manifest").then(function (manifest) {
      var brief = findMount();
      if (brief && manifest) commitManifest(brief, manifest, cur.base, cur.jobKey);
    }).catch(function () { /* the next open or poll catches up */ });
  }

  /* -------------------- MREV D3/D4: Repair with an instruction -------------------- */

  /* The open Repair dialog, the repair in flight, and what the last one
     changed. They live here rather than in the DOM so a manifest poll that
     repaints the rows keeps them. */
  var repairForm = null;    /* { slug, feature, instruction, checked, error, busy, requestId } */
  var repairWatch = null;   /* { slug, feature, parentRunId, since } */
  var repairOutcome = null; /* { slug, feature, html } */

  var REPAIR_ERRORS = {
    repair_base_stale: "This document changed since you opened it; refresh",
    repair_source_missing: "There’s no saved draft of this version to rewrite from. Draft it again, then Repair.",
  };

  function qualityDocFor(feature) {
    var m = currentManifest && currentManifest.manifest;
    var docs = m && m.quality && m.quality.documents ? m.quality.documents : null;
    return docs ? docs[feature] : undefined;
  }

  /* K4's idempotency key: a resend of the same request gets the first result. */
  function newRequestId() {
    var c = root.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    return "req-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  /* The Case row (or legacy card) for one document inside the section. */
  function docHostFor(section, feature) {
    if (!section || !section.querySelector) return null;
    return section.querySelector('[data-doc="' + feature + '"]') || section.querySelector('[data-doc-type="' + feature + '"]');
  }

  function currentSection() {
    var host = findMount();
    return host && host.querySelector ? host.querySelector("." + SECTION_CLASS) : null;
  }

  /* The dialog and the last outcome for one row, from state (renderCaseRows). */
  function repairBlocksHtml(slug, feature, qualityDoc, isPending) {
    var mi = insights();
    if (!mi) return "";
    var out = "";
    if (repairOutcome && repairOutcome.slug === slug && repairOutcome.feature === feature) out += repairOutcome.html;
    if (!isPending && repairForm && repairForm.slug === slug && repairForm.feature === feature) {
      out += mi.repairPanelHtml(feature, qualityDoc, repairForm);
    }
    return out;
  }

  function replaceBlock(host, selector, html) {
    var prior = host.querySelector(selector);
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);
    if (!html) return null;
    host.insertAdjacentHTML("beforeend", html);
    return host.querySelector(selector);
  }

  /* A repaint replaces the form, so focus lands again: on its message when
     it has one, else on the instruction box. */
  function paintRepairForm(section) {
    var mi = insights();
    var host = repairForm ? docHostFor(section, repairForm.feature) : null;
    if (!mi || !host) return null;
    var form = replaceBlock(host, ".mat-repair", mi.repairPanelHtml(repairForm.feature, qualityDocFor(repairForm.feature), repairForm));
    var target = form && (form.querySelector('[role="alert"]') || form.querySelector("[data-repair-instruction]"));
    if (target && typeof target.focus === "function") target.focus();
    return form;
  }

  function openRepairForm(btn, section) {
    var slug = section.getAttribute("data-slug") || "";
    var feature = btn.getAttribute("data-feature") || docTypeOf(docHostOf(btn));
    if (!slug || !feature) return;
    repairForm = { slug: slug, feature: feature, instruction: "", checked: null, error: "", busy: false, requestId: "" };
    paintRepairForm(section);
  }

  /* Cancel and Escape: close the dialog and hand focus back to its Repair. */
  function closeRepairForm(form) {
    var feature = repairForm ? repairForm.feature : "";
    repairForm = null;
    var host = form && form.parentNode;
    if (form && form.parentNode) form.parentNode.removeChild(form);
    var again = host && host.querySelector ? host.querySelector('[data-action="materials-repair"]') : null;
    if (!again && feature) {
      var section = currentSection();
      var row = docHostFor(section, feature);
      again = row && row.querySelector('[data-action="materials-repair"]');
    }
    if (again && typeof again.focus === "function") again.focus();
  }

  /* Typing and ticking update the state, so a repaint keeps them. */
  function syncRepairForm(form) {
    if (!repairForm || !form || !form.querySelector) return;
    var input = form.querySelector("[data-repair-instruction]");
    if (input) repairForm.instruction = String(input.value || "");
    var boxes = form.querySelectorAll("[data-repair-issue]");
    var checked = {};
    for (var i = 0; i < boxes.length; i++) checked[boxes[i].value] = !!boxes[i].checked;
    repairForm.checked = checked;
    var count = form.querySelector("[data-repair-count]");
    if (count) count.textContent = repairForm.instruction.length + " / " + ((insights() && insights().REPAIR_MAX) || 600);
  }

  function submitRepairForm(form, section) {
    if (!repairForm || repairForm.busy) return;
    syncRepairForm(form);
    var feature = repairForm.feature;
    var instruction = repairForm.instruction.trim().slice(0, (insights() && insights().REPAIR_MAX) || 600);
    var checked = repairForm.checked || {};
    var issueIds = Object.keys(checked).filter(function (id) { return checked[id]; });
    if (!instruction && !issueIds.length) {
      repairForm.error = "Say what should change, or tick an issue to fix.";
      paintRepairForm(section);
      return;
    }
    var doc = qualityDocFor(feature);
    var qa = doc && doc.qa ? doc.qa : null;
    if (!repairForm.requestId) repairForm.requestId = newRequestId();
    /* K4, plus G5's stale-base guard and idempotency key. */
    var request = { feature: feature, instruction: instruction, issueIds: issueIds, requestId: repairForm.requestId };
    if (qa && qa.textHash) request.baseDocumentHash = String(qa.textHash);
    if (qa && qa.runId) request.parentRunId = String(qa.runId);
    repairForm.busy = true;
    repairForm.error = "";
    paintRepairForm(section);
    handleRepair(section.getAttribute("data-slug") || repairForm.slug, feature, request);
  }

  function repairFailed(err) {
    var code = err && err.body && err.body.code ? String(err.body.code) : "";
    var message = REPAIR_ERRORS[code] || ("Repair didn’t start: " + ((err && err.message) || "unknown error"));
    if (!repairForm) {
      var brief = findMount();
      if (brief) renderError(brief, message);
      return;
    }
    repairForm.busy = false;
    repairForm.error = message;
    /* A refused request is finished; the next submit is a new one. */
    if (err && err.status >= 400 && err.status < 500) repairForm.requestId = "";
    paintRepairForm(currentSection());
  }

  function handleRepair(slug, feature, request) {
    if (!slug || !feature || !currentContext) return;
    var ctx = currentContext;
    var repairNote = request.instruction || ("Repairing the " + featureLabel(feature) + ".");
    var since = new Date().toISOString();
    var formSlug = repairForm ? repairForm.slug : "";

    function sendRepairRequest() {
      /* C11: a repair re-drafts too, so it carries the same resume. */
      return readResume().then(function (r) {
        var body = { feature: feature, jobUrl: ctx.jobUrl };
        for (var k in request) if (Object.prototype.hasOwnProperty.call(request, k)) body[k] = request[k];
        if (r.resume) body.resume = r.resume;
        return postJson(ctx.base + "/api/applications/" + encodeURIComponent(slug) + "/repair", body);
      });
    }

    function completeRepairRequest() {
      return sendRepairRequest().then(function () {
        repairForm = null;
        repairOutcome = null;
        repairWatch = { slug: slug, feature: feature, parentRunId: request.parentRunId || "", since: since };
        dispatch("jb:materials:changed", { slug: slug, reason: "repair-sent" });
        return fetchJson(ctx.base + "/api/applications/" + encodeURIComponent(slug) + "/manifest");
      }).then(function (manifest) {
        var brief = findMount();
        if (!brief) return;
        getApplications(ctx.base, { refresh: true });
        commitManifest(brief, manifest, ctx.base, ctx.jobKey);
        if (manifest.pending) startPolling(manifest.slug, ctx.base);
        dispatch("jb:materials:changed", { slug: slug });
      });
    }

    refreshContextApplication(ctx).then(function () {
      return refreshContextFromLocalMaterials(ctx);
    }).then(function () {
      slug = ctx.slug || slug;
      return ensureJobDescription(ctx);
    }).then(completeRepairRequest).catch(function (err) {
      var brief = findMount();
      if (!brief) return;
      if (err && err.code === "JD_PASTE_REQUIRED") {
        /* The dialog waits for the paste instead of saying "Sending…". */
        if (repairForm) {
          repairForm.busy = false;
          repairForm.error = "Paste the job description to continue: Repair runs once it’s saved.";
          paintRepairForm(currentSection());
        }
        renderJdPasteForm(brief, ctx, feature, repairNote, function () {
          /* Cancelled while the paste form was open: send nothing. */
          if (!repairForm || repairForm.slug !== formSlug || repairForm.feature !== feature) return Promise.resolve();
          repairForm.busy = true;
          repairForm.error = "";
          paintRepairForm(currentSection());
          /* Its refusal belongs in the dialog, not on the detached paste form. */
          return completeRepairRequest().catch(repairFailed);
        });
        return;
      }
      repairFailed(err);
    });
  }

  /* D4: once the repair's run leaves pending, find it and open its diff. */
  function maybeFinishRepair(manifest, base) {
    var w = repairWatch;
    if (!w || !manifest || manifest.slug !== w.slug) return;
    var p = manifest.pending;
    var phase = p && p.feature ? String((p.progress && p.progress.phase) || "queued") : "";
    if (phase && !/^(complete|done|failed)$/i.test(phase)) return;
    repairWatch = null;
    if (/^failed$/i.test(phase)) return; /* the row shows the failure */
    showRepairOutcome(w, base);
  }

  function showRepairOutcome(w, base) {
    var mi = insights();
    if (!mi) return;
    var api = base + "/api/applications/" + encodeURIComponent(w.slug);
    var failed = function (err) { return (err && err.message) || "unknown error"; };
    fetchJson(api + "/runs").then(function (body) {
      var runs = body && Array.isArray(body.runs) ? body.runs : [];
      var run = mi.pickRepairRun(runs, w);
      if (!run) throw new Error("the new version isn’t in your versions list yet");
      var result = mi.repairResultOf(run, w.feature);
      var ofDoc = runs.filter(function (r) { return r && Array.isArray(r.documents) && r.documents.indexOf(w.feature) >= 0; });
      var older = ofDoc[ofDoc.indexOf(run) + 1];
      var parent = result.parentRunId || w.parentRunId || (older ? older.runId : "");
      if (!parent) return { result: result, diff: null, error: "There is no earlier version to compare with." };
      /* G5: the diff route keeps a/b/doc. */
      return fetchJson(api + "/runs-diff?a=" + encodeURIComponent(parent) + "&b=" + encodeURIComponent(run.runId)
        + "&doc=" + encodeURIComponent(w.feature)).then(function (diff) {
        return { result: result, diff: diff };
      }, function (err) {
        return { result: result, diff: null, error: "Couldn’t load the comparison: " + failed(err) };
      });
    }).then(function (out) {
      setRepairOutcome(w, mi.repairOutcomeHtml({
        feature: w.feature, changed: out.result.changed, adopted: out.result.adopted, diff: out.diff, error: out.error,
      }));
    }).catch(function (err) {
      setRepairOutcome(w, mi.repairOutcomeHtml({
        feature: w.feature, changed: null, adopted: null, diff: null,
        error: "The repair finished, but its result couldn’t be loaded: " + failed(err),
      }));
    });
  }

  function setRepairOutcome(w, html) {
    repairOutcome = { slug: w.slug, feature: w.feature, html: html };
    var section = currentSection();
    if (!section || section.getAttribute("data-slug") !== w.slug) return;
    var host = docHostFor(section, w.feature);
    var panel = host ? replaceBlock(host, ".mat-repaired", html) : null;
    if (panel && typeof panel.focus === "function") panel.focus();
  }

  function dismissRepairOutcome(node) {
    repairOutcome = null;
    var panel = node && node.closest ? node.closest(".mat-repaired") : null;
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  }

  /* -------------------- network -------------------- */

  function isMaterialsNetworkError(err) {
    if (!err) return false;
    if (err.status === 0) return true;
    var helper = root.isFetchNetworkError;
    if (typeof helper === "function") {
      try {
        if (helper(err)) return true;
      } catch (e) { /* fall through */ }
    }
    var msg = String((err && err.message) || err || "");
    var name = err && err.name ? String(err.name) : "";
    return (
      name === "TypeError" ||
      msg === "Failed to fetch" ||
      /NetworkError|Network request failed|Load failed|CONNECTION_REFUSED|ECONNREFUSED|aborted/i.test(msg)
    );
  }

  function formatMaterialsFetchError(err, baseUrl) {
    var base = String(baseUrl || getBaseUrl() || "").replace(/\/+$/, "");
    var blocked = root.isScraperUrlBlockedOnThisPage;
    if (typeof blocked === "function" && base) {
      try {
        if (blocked(base)) {
          return "This HTTPS page can't reach the materials server on this computer — the browser blocks it. Open your local dashboard (http://localhost:8080) instead, or deploy the scraper to HTTPS and set Job posting scrape URL in Settings.";
        }
      } catch (e) { /* fall through */ }
    }
    if (isMaterialsNetworkError(err)) {
      return "The materials server on this computer isn't answering. Run npm start in your JobBored folder, then try again.";
    }
    return (err && err.message) || "Could not load application materials.";
  }

  function fetchJson(url) {
    if (typeof fetch !== "function") {
      return Promise.reject(new Error("fetch unavailable"));
    }
    return apiFetch(url, { credentials: "omit", cache: "no-store" }).then(function (res) {
      if (!res.ok) {
        var err = new Error("Materials server returned " + res.status);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }).catch(function (err) {
      if (err && err.status) throw err;
      var wrapped = new Error(formatMaterialsFetchError(err, url));
      wrapped.status = 0;
      wrapped.cause = err;
      throw wrapped;
    });
  }

  function postJson(url, body) {
    if (typeof fetch !== "function") {
      return Promise.reject(new Error("fetch unavailable"));
    }
    return apiFetch(url, {
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
    }).catch(function (err) {
      if (err && err.status) throw err;
      var wrapped = new Error(formatMaterialsFetchError(err, url));
      wrapped.status = 0;
      wrapped.cause = err;
      throw wrapped;
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

  function pickApplicationWithRefresh(base, job, applications) {
    var picked = pickApplication(job, applications);
    if (picked) {
      return Promise.resolve({ applications: applications || [], picked: picked });
    }
    return getApplications(base, { refresh: true })
      .then(function (freshApps) {
        return {
          applications: freshApps || [],
          picked: pickApplication(job, freshApps || []),
        };
      })
      .catch(function () {
        return { applications: applications || [], picked: null };
      });
  }

  function refreshContextApplication(ctx) {
    if (!ctx || !ctx.base) return Promise.resolve(ctx);
    var job = {
      company: ctx.company,
      role: ctx.title || ctx.role,
    };
    if (!hasJobIdentity(job)) return Promise.resolve(ctx);
    return getApplications(ctx.base, { refresh: true })
      .then(function (apps) {
        var picked = pickApplication(job, apps || []);
        if (picked && picked.slug) ctx.slug = picked.slug;
        return ctx;
      })
      .catch(function () {
        return ctx;
      });
  }

  function refreshContextFromLocalMaterials(ctx) {
    if (!ctx || !ctx.base || isLocalMaterialsBase(ctx.base)) return Promise.resolve(ctx);
    var localBase = getLocalMaterialsBaseUrl();
    var job = {
      company: ctx.company,
      role: ctx.title || ctx.role,
    };
    if (!hasJobIdentity(job)) return Promise.resolve(ctx);
    return fetchJson(localBase + "/api/applications")
      .then(function (body) {
        var apps = body && Array.isArray(body.applications) ? body.applications : [];
        var picked = pickApplication(job, apps);
        if (picked && picked.slug) {
          ctx.base = localBase;
          ctx.slug = picked.slug;
        }
        return ctx;
      })
      .catch(function () {
        return ctx;
      });
  }

  /* -------------------- pending poller --------------------
     When a draft request fires (or the manifest already has a pending
     state on first open) we poll the manifest endpoint until either
     the pending state clears (Hermes removed pending.json) or new
     documents appear. Capped at ~30 minutes; the next manual open
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
    var maxMs = 30 * 60 * 1000;
    var minDelay = 3000;
    var maxDelay = 12000;

    function tick() {
      attempts += 1;
      if (Date.now() - startedAt > maxMs) {
        stopPolling();
        /* Honesty over silence: a draft that has produced nothing in 30
           minutes almost certainly has a dead worker behind it. Say so
           instead of freezing the progress card mid-climb. */
        var capBrief = findMount();
        if (capBrief) {
          renderError(
            capBrief,
            "Still no result after 30 minutes — the drafting worker may be down. Open the request again or check the worker logs.",
          );
        }
        return;
      }
      fetchJson(base + "/api/applications/" + encodeURIComponent(slug) + "/manifest")
        .then(function (manifest) {
          var brief = findMount();
          if (!brief) return;
          var committed = commitManifest(brief, manifest, base);
          if (committed && committed.pending) {
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

  function hasJobIdentity(job) {
    return !!(job && (job.company || job.role || job.title));
  }

  function getPipelineJobByKey(jobKey) {
    if (typeof root.getPipelineJobByIndex === "function") {
      try {
        var byIndex = root.getPipelineJobByIndex(jobKey);
        if (byIndex) return byIndex;
      } catch (e) { /* fall through */ }
    }
    var jb = root.JobBored;
    if (jb && typeof jb.getPipelineJobs === "function") {
      try {
        var jobs = jb.getPipelineJobs() || [];
        var n = Number(jobKey);
        if (Number.isFinite(n) && jobs[n]) return jobs[n];
      } catch (e2) { /* fall through */ }
    }
    return null;
  }

  function firstText() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (value == null) continue;
      var text = String(value).trim();
      if (text) return text;
    }
    return "";
  }

  function firstArray() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (Array.isArray(value) && value.length) return value;
    }
    return [];
  }

  function mergeMaterialsJob(primary, fallback) {
    if (!primary && !fallback) return null;
    primary = primary || {};
    fallback = fallback || {};
    return {
      company: firstText(primary.company, fallback.company),
      role: firstText(primary.role, primary.title, fallback.role, fallback.title),
      title: firstText(primary.title, primary.role, fallback.title, fallback.role),
      jobUrl: firstText(primary.jobUrl, primary.job_url, fallback.jobUrl, fallback.job_url),
      postingUrl: firstText(primary.postingUrl, fallback.postingUrl),
      applyUrl: firstText(primary.applyUrl, fallback.applyUrl),
      canonicalUrl: firstText(primary.canonicalUrl, fallback.canonicalUrl),
      finalUrl: firstText(primary.finalUrl, fallback.finalUrl),
      url: firstText(primary.url, fallback.url),
      link: firstText(primary.link, fallback.link),
      links: firstArray(primary.links, fallback.links),
      _postingEnrichment: primary._postingEnrichment || fallback._postingEnrichment || null,
      enrichment: primary.enrichment || fallback.enrichment || null,
      cachedJobDescription: firstText(primary.cachedJobDescription, fallback.cachedJobDescription),
      jobDescription: firstText(primary.jobDescription, fallback.jobDescription),
      description: firstText(primary.description, fallback.description),
      jdSnippet: firstText(primary.jdSnippet, fallback.jdSnippet),
      jdSections: firstArray(primary.jdSections, fallback.jdSections),
      fitAssessment: firstText(primary.fitAssessment, fallback.fitAssessment),
      /* C16: where the role came from prefills the Applied source, and its
         stage decides whether "Did you apply?" is still a question. */
      source: firstText(primary.source, fallback.source),
      stage: firstText(primary.stage, primary.status, fallback.stage, fallback.status),
      /* C-4: sheet fields the draft prompt carries. */
      fitScore: primary.fitScore != null ? primary.fitScore : fallback.fitScore,
      talkingPoints: primary.talkingPoints || fallback.talkingPoints || null,
      contacts: firstArray(primary.contacts, fallback.contacts),
      contact: firstText(primary.contact, fallback.contact),
    };
  }

  function textList(value) {
    var list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n+/) : [];
    return list
      .map(function (item) {
        var text = item && typeof item === "object" ? item.text || item.label || "" : item;
        return String(text == null ? "" : text).replace(/^\s*(?:[-\u2022*]|\d+[.)])\s+/, "").trim();
      })
      .filter(Boolean);
  }

  /* C-4: what JobBored already knows about the role (enrichment + sheet
     fields) rides along with every materials request. Empty fields are
     left out so the server sees only real signal. */
  function materialsEnrichment(job) {
    if (!job) return null;
    var pe = job._postingEnrichment || {};
    var en = job.enrichment || {};
    var out = {};
    var fitAngle = firstText(pe.fitAngle, en.fitAngle);
    if (fitAngle) out.fitAngle = fitAngle;
    var talking = textList(pe.talkingPoints);
    if (!talking.length) talking = textList(en.talkingPoints);
    if (!talking.length) talking = textList(job.talkingPoints);
    if (talking.length) out.talkingPoints = talking.slice(0, 6);
    var musts = textList(pe.mustHaves);
    if (!musts.length) musts = textList(en.mustHaves);
    if (musts.length) out.mustHaves = musts.slice(0, 8);
    var first = Array.isArray(job.contacts) && job.contacts[0];
    var contact = firstText(first && first.name, job.contact);
    if (contact && !/^unknown$/i.test(contact)) out.contact = contact;
    var score = Number(job.fitScore);
    if (job.fitScore !== null && job.fitScore !== "" && job.fitScore !== undefined && isFinite(score)) out.fitScore = score;
    return Object.keys(out).length ? out : null;
  }

  function getMaterialsJob(jobKey) {
    var vm = getCurrentJob(jobKey);
    var vmJob = vm && vm.job;
    var pipelineJob = getPipelineJobByKey(jobKey);
    return mergeMaterialsJob(vmJob, pipelineJob);
  }

  /* Build a request context synchronously so dossier CTAs work as soon as
     the role opens — don't wait for the async applications/manifest fetch. */
  function buildMaterialsContext(jobKey) {
    var base = getBaseUrl();
    if (!base) return null;
    var job = getMaterialsJob(jobKey);
    if (!hasJobIdentity(job)) return null;
    return {
      jobKey: jobKey,
      slug: buildCandidateSlug(job),
      company: String(job.company || ""),
      title: String(job.role || job.title || ""),
      jobUrl: pickPostingUrl(job),
      base: base,
      cachedJobDescription: pickCachedJobDescription(job),
      enrichment: materialsEnrichment(job),
    };
  }

  function resolveMaterialsContext(jobKeyHint) {
    var jobKey = jobKeyHint;
    if (jobKey == null || jobKey === "") {
      jobKey = root.JobBoredFlowing
        && root.JobBoredFlowing.openRole
        && root.JobBoredFlowing.openRole.get
        && root.JobBoredFlowing.openRole.get();
    }
    if (jobKey == null || jobKey === "") return null;
    if (
      currentContext
      && String(currentContext.jobKey) === String(jobKey)
      && currentContext.base
    ) {
      return currentContext;
    }
    return buildMaterialsContext(jobKey);
  }

  function loadForOpenRole(jobKey) {
    if (!shouldRun()) return;
    var region = document.querySelector(REGION_SELECTOR);
    if (!region) return;
    var brief = findMount();
    if (!brief) return;

    var job = getMaterialsJob(jobKey);
    if (!hasJobIdentity(job)) return;

    var base = getBaseUrl();
    if (!base) {
      currentContext = null;
      setServerState("down");
      renderServerDown(brief);
      return;
    }

    currentContext = buildMaterialsContext(jobKey);
    /* C11: know the resume before the reader reaches Draft. Never blocks. */
    readResume();

    getApplications(base).then(function (apps) {
      setServerState("up");
      return pickApplicationWithRefresh(base, job, apps);
    }).then(function (resolved) {
      var apps = resolved.applications || [];
      var picked = resolved.picked;
      var slug = picked ? picked.slug : buildCandidateSlug(job);
      if (currentContext && String(currentContext.jobKey) === String(jobKey)) {
        currentContext.slug = slug;
      } else {
        currentContext = buildMaterialsContext(jobKey);
        if (currentContext) currentContext.slug = slug;
      }
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
        /* The mount is resolved at paint time: a Case render while the
           fetch was in flight (the resume read can trigger one) replaced the
           element captured above. */
        renderEmpty(findMount() || brief, {
          note: "No drafts on disk yet. Use Draft cover letter / Tailor resume above to request a tailored pass.",
        });
        return;
      }
      return fetchJson(base + "/api/applications/" + encodeURIComponent(picked.slug) + "/manifest")
        .then(function (manifest) {
          commitManifest(findMount() || brief, manifest, base, jobKey);
          if (manifest.pending) startPolling(manifest.slug, base);
          else stopPolling();
        });
    }).catch(function (err) {
      if (isServerDownError(err, base)) {
        setServerState("down");
        renderServerDown(findMount() || brief);
        return;
      }
      renderError(findMount() || brief, formatMaterialsFetchError(err, base));
    });
  }

  /* A network failure against a plain local server is "not running"; a
     mixed-content block keeps its own, more specific message. */
  function isServerDownError(err, base) {
    if (!err || err.status !== 0) return false;
    var blocked = root.isScraperUrlBlockedOnThisPage;
    if (typeof blocked === "function" && base) {
      try { if (blocked(base)) return false; } catch (e) { /* fall through */ }
    }
    return true;
  }

  /* -------------------- kanban auto-draft trigger --------------------
     The board writes Status to Sheets before emitting jb:write:succeeded.
     Use that confirmed event, not the optimistic drag event, so Hermes
     only queues materials for moves that actually persisted. */

  var autoDraftInFlight = Object.create(null);

  function normalizeStageKey(value) {
    var s = String(value == null ? "" : value).trim().toLowerCase();
    if (!s) return "";
    s = s.replace(/[_\s]+/g, "-");
    if (s === "discovered") return "new";
    return s;
  }

  function isAutoDraftMove(detail) {
    if (!detail || detail.kind !== "pipeline:move") return false;
    var fromStage = normalizeStageKey(detail.fromStage);
    var toStage = normalizeStageKey(detail.toStage || detail.status);
    return (fromStage === "new" || fromStage === "")
      && toStage === "researching";
  }

  var AUTO_DRAFT_SNAPSHOT_STORAGE_KEY = "jobBored:autoDraftStageSnapshot:v1";
  var autoDraftStageSnapshot = null;

  function getAutoDraftSnapshotStorageKey() {
    var sheetId = "";
    var jb = root.JobBored;
    try {
      if (jb && typeof jb.getSheetId === "function") {
        sheetId = String(jb.getSheetId() || "").trim();
      }
    } catch (e) { /* fall through to default key */ }
    return AUTO_DRAFT_SNAPSHOT_STORAGE_KEY + ":" + (sheetId || "default");
  }

  function readAutoDraftStageSnapshot() {
    var storage = root.localStorage;
    if (!storage || typeof storage.getItem !== "function") return null;
    try {
      var raw = storage.getItem(getAutoDraftSnapshotStorageKey());
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function writeAutoDraftStageSnapshot(snapshot) {
    var storage = root.localStorage;
    if (!storage || typeof storage.setItem !== "function") return;
    try {
      storage.setItem(getAutoDraftSnapshotStorageKey(), JSON.stringify(snapshot || {}));
    } catch (e) { /* best-effort only */ }
  }

  function pipelineStageRows() {
    var jb = root.JobBored;
    if (!jb || typeof jb.getPipelineJobs !== "function") return [];
    var jobs = [];
    try {
      jobs = jb.getPipelineJobs() || [];
    } catch (e) {
      return [];
    }
    if (!Array.isArray(jobs)) return [];
    return jobs.map(function (job, index) {
      return {
        jobKey: String(index),
        stage: normalizeStageKey(job && (job.status || job.stage || "")),
      };
    });
  }

  function refreshAutoDraftStageSnapshot() {
    if (!shouldRun()) return;
    var rows = pipelineStageRows();
    if (!rows.length) return;
    if (!autoDraftStageSnapshot) {
      autoDraftStageSnapshot = readAutoDraftStageSnapshot();
    }
    var next = Object.create(null);
    rows.forEach(function (row) {
      next[row.jobKey] = row.stage;
      if (!autoDraftStageSnapshot) return;
      var prior = Object.prototype.hasOwnProperty.call(autoDraftStageSnapshot, row.jobKey)
        ? autoDraftStageSnapshot[row.jobKey]
        : "";
      if ((prior === "new" || prior === "") && row.stage === "researching") {
        requestAutoDraftForMove({
          jobKey: row.jobKey,
          kind: "pipeline:move",
          fromStage: prior || "new",
          toStage: "researching",
          status: "Researching",
        });
      }
    });
    autoDraftStageSnapshot = next;
    writeAutoDraftStageSnapshot(next);
  }

  function getJobForAutoDraft(jobKey) {
    var api = root.JobBoredDawn && root.JobBoredDawn.data;
    var vmJob = null;
    if (api && typeof api.getRoleViewModel === "function") {
      try {
        var vm = api.getRoleViewModel(jobKey);
        vmJob = vm && vm.job;
      } catch (e) { /* fall through */ }
    }
    var job = mergeMaterialsJob(vmJob, getPipelineJobByKey(jobKey));
    return hasJobIdentity(job) ? job : null;
  }

  function manifestHasDoc(manifest, type) {
    var docs = manifest && Array.isArray(manifest.documents) ? manifest.documents : [];
    return docs.some(function (doc) {
      return doc && doc.type === type && Array.isArray(doc.files) && doc.files.length > 0;
    });
  }

  function autoDraftSkipReason(manifest) {
    if (!manifest) return "";
    if (manifest.pending) return "pending";
    if (manifestHasDoc(manifest, "resume") && manifestHasDoc(manifest, "cover_letter")) {
      return "ready";
    }
    return "";
  }

  function fetchManifestOrNull(base, slug) {
    return fetchJson(base + "/api/applications/" + encodeURIComponent(slug) + "/manifest")
      .catch(function (err) {
        if (err && err.status === 404) return null;
        throw err;
      });
  }

  function emitAutoDraftSkipped(detail, reason, slug) {
    dispatch("jb:materials:auto-request-skipped", {
      jobKey: detail && detail.jobKey,
      slug: slug || "",
      reason: reason || "not-applicable",
    });
  }

  /* True only when `jobKey` is the role currently open in the dossier, so
     the kanban auto-draft path renders into / polls the right surface and
     never paints one role's progress over another. */
  function isOpenRole(jobKey) {
    var openKey = root.JobBoredFlowing
      && root.JobBoredFlowing.openRole
      && root.JobBoredFlowing.openRole.get
      && root.JobBoredFlowing.openRole.get();
    return openKey != null && openKey !== "" && String(openKey) === String(jobKey);
  }

  function renderAutoDraftManifestInOpenDossier(jobKey, manifest, base) {
    if (!isOpenRole(jobKey)) return;
    var brief = findMount();
    if (!brief) return;
    commitManifest(brief, manifest, base, jobKey);
    if (manifest && manifest.pending) startPolling(manifest.slug, base);
    else stopPolling();
  }

  /* After an auto-request writes pending.json, re-read the manifest into
     the open dossier and start the bounded poll — the same tail as the
     manual submitDraftRequest path. Without this the dossier renders its
     pre-request snapshot and stops, so generated docs only appear after a
     manual browser refresh. No-ops when a different role (or none) is open
     or the request resolved into another role. */
  function reflectAutoDraftInOpenDossier(jobKey, slug, base) {
    if (!isOpenRole(jobKey)) return;
    fetchJson(base + "/api/applications/" + encodeURIComponent(slug) + "/manifest")
      .then(function (manifest) {
        renderAutoDraftManifestInOpenDossier(jobKey, manifest, base);
      })
      .catch(function () {
        /* Leave the optimistic in-progress card up; the global queue strip
           and the next manual open both recover the real state. */
      });
  }

  function requestAutoDraftForMove(detail) {
    if (!shouldRun() || !isAutoDraftMove(detail)) return;
    /* C12 (TA-03): a stage move no longer spends AI quota on its own. */
    if (!isAutoDraftEnabled()) {
      emitAutoDraftSkipped(detail, "opt-in-off", "");
      return;
    }

    var jobKey = detail.jobKey;
    var job = getJobForAutoDraft(jobKey);
    var role = job && (job.role || job.title || "");
    var company = job && job.company;
    if (!job || (!company && !role)) {
      dispatch("jb:materials:auto-request-failed", {
        jobKey: jobKey,
        slug: "",
        error: "Could not resolve job for auto materials request.",
      });
      return;
    }

    var base = getBaseUrl();
    var slug = buildCandidateSlug({ company: company, role: role });
    if (!base || !slug) {
      dispatch("jb:materials:auto-request-failed", {
        jobKey: jobKey,
        slug: slug || "",
        error: !base ? "Local materials server is not configured." : "Could not build materials slug.",
      });
      return;
    }

    var lockKey = String(jobKey == null ? "" : jobKey) + "|" + slug;
    if (autoDraftInFlight[lockKey]) {
      emitAutoDraftSkipped(detail, "in-flight", slug);
      return;
    }
    autoDraftInFlight[lockKey] = true;

    var ctx = {
      jobKey: jobKey,
      slug: slug,
      company: String(company || ""),
      title: String(role || ""),
      jobUrl: pickPostingUrl(job),
      base: base,
      cachedJobDescription: pickCachedJobDescription(job),
      enrichment: materialsEnrichment(job),
    };

    /* If this role is the one open in the dossier, stamp an immediate
       in-progress card so the move visibly registers while the JD chain
       and request round-trip resolve. */
    if (isOpenRole(jobKey)) {
      renderOptimisticPending(ctx, "both", "", "kanban-auto");
    }

    getApplications(base, { refresh: true })
      .catch(function () { return []; })
      .then(function (apps) {
        var picked = pickApplication({ company: company, role: role }, apps);
        if (picked && picked.slug) {
          slug = picked.slug;
          ctx.slug = picked.slug;
        }
        return fetchManifestOrNull(base, slug);
      })
      .then(function (manifest) {
        var reason = autoDraftSkipReason(manifest);
        if (reason) {
          if (manifest) renderAutoDraftManifestInOpenDossier(jobKey, manifest, base);
          emitAutoDraftSkipped(detail, reason, slug);
          return null;
        }
        var resumeForRun = null;
        return readResume()
          .then(function (r) {
            if (r.available && !r.resume) {
              var noResume = new Error("Auto-draft skipped for " + (ctx.title || ctx.company) + ": add your resume first.");
              noResume.code = RESUME_REQUIRED_CODE;
              throw noResume;
            }
            resumeForRun = r.resume;
            return ensureJobDescription(ctx);
          })
          .then(function (jdResult) {
            var body = {
              slug: slug,
              company: ctx.company,
              title: ctx.title,
              feature: "both",
              jobUrl: ctx.jobUrl,
              notes: "",
              jdSource: jdResult && jdResult.source,
            };
            if (ctx.enrichment) body.enrichment = ctx.enrichment;
            if (resumeForRun) body.resume = resumeForRun;
            /* The opt-in run says what it is spending, as it happens. */
            toast("Drafting resume + letter for " + (ctx.title || "this role") + (ctx.company ? " at " + ctx.company : ""), "info");
            return withTemplatePreference(body).then(function (b) {
              return postJson(base + "/api/applications/" + encodeURIComponent(slug) + "/request", b);
            });
          })
          .then(function (result) {
            getApplications(base, { refresh: true });
            dispatch("jb:materials:changed", { slug: slug, reason: "auto-request-sent" });
            dispatch("jb:materials:auto-requested", {
              jobKey: jobKey,
              slug: slug,
              feature: "both",
              result: result || null,
            });
            /* Re-read the manifest into the open dossier and start the
               bounded poll so resume + cover letter surface live. */
            reflectAutoDraftInOpenDossier(jobKey, slug, base);
            return result;
          });
      })
      .catch(function (err) {
        var message = (err && err.message) || (err && err.code) || "Auto materials request failed.";
        if (root.console && root.console.warn) {
          root.console.warn("[role-materials] auto materials request failed", message);
        }
        /* TA-03: failures used to reach only the console. */
        toast(isResumeRequiredError(err) && !(err && err.status) ? message : "Auto-draft failed: " + message, "error");
        dispatch("jb:materials:auto-request-failed", {
          jobKey: jobKey,
          slug: slug,
          error: message,
        });
      })
      .then(function () {
        delete autoDraftInFlight[lockKey];
      });
  }

  /* -------------------- C16 (MP-04): back from the posting --------------------
     Leaving through View posting and coming back is the moment the user most
     likely applied. Ask once, in one tap, and route a yes through
     JobBoredSubmission.confirmApplied (lane D) so the Applied confirmation
     contract — its dialog, grace period and write — is untouched. */
  var AFTER_APPLY_STAGES = /^(applied|phone-screen|interviewing|offer|rejected|passed|expired)$/;
  var returnWatch = null;
  var returnPrompt = null;

  function localToday() {
    var d = new Date();
    var mm = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
  }

  function noteViewPosting(jobKey) {
    if (jobKey == null || jobKey === "") return;
    var job = getMaterialsJob(jobKey) || {};
    var stage = normalizeStageKey(job.stage || job.status || "");
    if (AFTER_APPLY_STAGES.test(stage)) return;
    returnWatch = {
      jobKey: String(jobKey),
      company: String(job.company || ""),
      title: String(job.role || job.title || ""),
      source: String(job.source || ""),
      fromStage: stage,
      left: false,
    };
  }

  function onVisibilityChange() {
    if (!returnWatch || typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      returnWatch.left = true;
      return;
    }
    if (document.visibilityState === "visible" && returnWatch.left) {
      var w = returnWatch;
      returnWatch = null;
      showReturnPrompt(w);
    }
  }

  function closeReturnPrompt() {
    if (returnPrompt && returnPrompt.el && returnPrompt.el.parentNode) {
      returnPrompt.el.parentNode.removeChild(returnPrompt.el);
    }
    returnPrompt = null;
  }

  function showReturnPrompt(w) {
    if (!document.body) return;
    closeReturnPrompt();
    var who = w.company || w.title || "this role";
    var el = document.createElement("div");
    el.className = "case-return";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Did you apply?");
    el.innerHTML = '<p class="case-return__q" aria-live="polite">Back from ' + escapeHtml(who)
      + '\u2019s posting. <b>Did you apply to ' + escapeHtml(who) + '?</b></p>'
      + '<div class="case-return__actions">'
        + '<button type="button" class="case-return__btn case-return__btn--primary" data-return="yes">Yes, mark applied</button>'
        + '<button type="button" class="case-return__btn" data-return="no">Not yet</button>'
      + '</div>';
    el.addEventListener("click", function (e) {
      var t = e && e.target;
      while (t && t !== el) {
        var answer = t.getAttribute && t.getAttribute("data-return");
        if (answer) { answerReturnPrompt(answer === "yes"); return; }
        t = t.parentNode;
      }
    });
    document.body.appendChild(el);
    returnPrompt = { el: el, watch: w };
  }

  function answerReturnPrompt(yes) {
    var w = returnPrompt && returnPrompt.watch;
    closeReturnPrompt();
    if (!yes || !w) return Promise.resolve(null);
    var prefill = { source: w.source, date: localToday() };
    var sub = root.JobBoredSubmission;
    if (sub && typeof sub.confirmApplied === "function") {
      /* Positional form flowing-writes already uses, plus lane D's prefill. */
      return Promise.resolve(sub.confirmApplied(w.jobKey, {
        fromStage: w.fromStage,
        source: prefill.source,
        appliedDate: prefill.date,
        prefill: prefill,
      }));
    }
    /* No submission module: the stage move itself still asks for confirmation. */
    dispatch("jb:pipeline:move", { jobKey: w.jobKey, fromStage: w.fromStage, toStage: "applied", prefill: prefill });
    return Promise.resolve(null);
  }

  function onDocumentClick(e) {
    var t = e && e.target;
    while (t && t.getAttribute) {
      var action = t.getAttribute("data-action");
      if (action === "brief-view-posting") {
        noteViewPosting(openRoleKey() || (currentContext && currentContext.jobKey));
        return;
      }
      if (action === "open-resume") {
        if (openResume() && typeof e.preventDefault === "function") e.preventDefault();
        return;
      }
      t = t.parentNode;
    }
  }

  function onWriteSucceeded(e) {
    requestAutoDraftForMove(e && e.detail);
  }

  function pickPostingUrl(job) {
    if (!job) return "";
    var direct =
      job.jobUrl ||
      job.job_url ||
      job.postingUrl ||
      job.applyUrl ||
      job.canonicalUrl ||
      job.finalUrl ||
      job.url ||
      job.link;
    if (direct && /^https?:/i.test(String(direct).trim())) return String(direct).trim();
    if (!Array.isArray(job.links)) return "";
    for (var i = 0; i < job.links.length; i++) {
      var l = job.links[i];
      var href = l && l.href ? String(l.href).trim() : "";
      if (/^https?:/i.test(href)) return href;
    }
    return "";
  }

  /* Returns the most useful JD text the browser already has cached
     for this role, in this order:
       1. job._postingEnrichment.description (full scraped JD)
       2. job._postingEnrichment.bodyText    (fallback when description is empty)
       3. dossier/Pipeline cached JD fields  (jdSnippet, jdSections, description)
       4. job.fitAssessment                  (last-resort: AI summary text)
     Returns "" if nothing usable is on hand. */
  function pickCachedJobDescription(job) {
    if (!job) return "";
    var p = job._postingEnrichment;
    var e = job.enrichment;
    if (p && typeof p.description === "string" && p.description.trim()) return p.description.trim();
    if (p && typeof p.bodyText === "string" && p.bodyText.trim()) return p.bodyText.trim();
    if (typeof job.cachedJobDescription === "string" && job.cachedJobDescription.trim()) return job.cachedJobDescription.trim();
    if (typeof job.jobDescription === "string" && job.jobDescription.trim()) return job.jobDescription.trim();
    if (typeof job.description === "string" && job.description.trim()) return job.description.trim();
    if (typeof job.jdSnippet === "string" && job.jdSnippet.trim()) return job.jdSnippet.trim();
    var fromSections = jdSectionsToText(job.jdSections);
    if (fromSections) return fromSections;
    if (e && typeof e.description === "string" && e.description.trim()) return e.description.trim();
    if (e && typeof e.postingSummary === "string" && e.postingSummary.trim()) return e.postingSummary.trim();
    if (e && typeof e.fitAssessment === "string" && e.fitAssessment.trim()) return e.fitAssessment.trim();
    if (typeof job.fitAssessment === "string" && job.fitAssessment.trim()) return job.fitAssessment.trim();
    return "";
  }

  function jdSectionsToText(sections) {
    if (!Array.isArray(sections) || !sections.length) return "";
    var out = [];
    sections.forEach(function (section) {
      if (!section) return;
      var heading = section.heading ? String(section.heading).trim() : "";
      var body = section.body ? String(section.body).trim() : "";
      if (heading) out.push(heading);
      if (body) out.push(body);
      if (Array.isArray(section.bullets)) {
        section.bullets.forEach(function (bullet) {
          var text = String(bullet || "").trim();
          if (text) out.push("- " + text);
        });
      }
    });
    return out.join("\n").trim();
  }

  /* C12 (TA-16): the mandatory notes form is gone. One click drafts; notes
     live in the optional "Notes for the next draft" disclosure in the
     Materials section (draftNotesHtml). */

  /* Handle a dossier CTA action by POSTing to the request endpoint.
     If the request fires successfully, swap the materials section to
     a pending state and start polling. If it fails, surface the
     error inline (no toast framework wired in yet). */
  function handleDraftRequest(feature, jobKeyHint, opts) {
    if (!shouldRun()) return;
    var ctx = resolveMaterialsContext(jobKeyHint);
    var brief = findMount();
    if (!ctx) {
      if (brief) {
        var base = getBaseUrl();
        renderError(
          brief,
          !base
            ? "Run npm start so the local materials server is available."
            : "Open a role with a company or title before requesting materials.",
        );
      } else if (root.console && root.console.warn) {
        root.console.warn("[role-materials] no open role context for request");
      }
      return;
    }
    currentContext = ctx;
    if (!brief) return;
    /* C12 (TA-06): no optimistic "queued" while nothing is listening. */
    if (serverState === "down") {
      renderServerDown(brief);
      return;
    }
    /* C11 (TA-02) + C12 (TA-16): one click drafts — from the user's resume,
       or not at all. */
    readResume().then(function (r) {
      if (r.available && !r.resume) {
        renderResumeGate(findMount());
        return;
      }
      var notes = String(draftNotes || "").trim();
      draftNotes = "";
      submitDraftRequest(ctx, feature, notes, r.resume, opts);
    });
  }

  function renderOptimisticPending(ctx, feature, notes, source, pending) {
    var brief = findMount();
    if (!brief) return;

    var optimisticManifest = {
      slug: ctx.slug,
      company: ctx.company,
      title: ctx.title,
      derived: true,
      documents: [],
      pending: pending || {
        feature: feature,
        company: ctx.company,
        title: ctx.title,
        jobUrl: ctx.jobUrl,
        requestedAt: new Date().toISOString(),
        notes: notes,
        source: source || "jobbored-dossier",
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
        commitManifest(brief, base, ctx.base, ctx.jobKey);
      });
  }

  /* Is anything answering on the materials port? An HTTP error still means
     a server is there; only a network failure means it is not. */
  function probeServer(base) {
    return fetchJson(base + "/api/applications").then(function () { return true; }, function (err) {
      return !isServerDownError(err, base);
    });
  }

  function submitDraftRequest(ctx, feature, notes, resume, opts) {
    var brief = findMount();
    if (!brief) return;
    return probeServer(ctx.base).then(function (up) {
      if (!up) {
        setServerState("down");
        renderServerDown(findMount());
        return;
      }
      setServerState("up");
      return sendDraftRequest(ctx, feature, notes, resume, opts);
    });
  }

  function sendDraftRequest(ctx, feature, notes, resume, opts) {
    /* U-5 "Draft both": the server queues the letter after the resume. */
    var then = opts && opts.then === "cover_letter" && feature === "resume" ? "cover_letter" : "";

    /* Optimistic UI: stamp a fresh "pending" banner immediately so the
       click visibly registers, even before the server responds. */
    /* Re-resolve against disk before the JD check. The user may have
       had the role open before Hermes created a matching folder, which
       leaves currentContext.slug stale even though job-description.md
       now exists under the canonical application slug. */
    refreshContextApplication(ctx).then(function () {
      return refreshContextFromLocalMaterials(ctx);
    }).then(function () {
      /* The hold is set first and shares its pending object with the
         optimistic commit, so holdOptimistic can tell the run's own block
         from a server-written one (TA-05). */
      optimisticRun = {
        slug: ctx.slug,
        feature: feature,
        at: Date.now(),
        pending: { feature: feature, company: ctx.company, title: ctx.title, jobUrl: ctx.jobUrl, requestedAt: new Date().toISOString(), notes: notes, source: "jobbored-dossier", next: then || undefined },
      };
      renderOptimisticPending(ctx, feature, notes, "jobbored-dossier", optimisticRun.pending);
      /* Run the JD fallback chain BEFORE asking Hermes to draft. The
         contract is: pending.json should not get written unless the
         slug folder has a job-description.md, otherwise Dobby's
         refusal-on-missing-JD path triggers. */
      return ensureJobDescription(ctx);
    }).then(function (jdResult) {
      var body = {
        slug: ctx.slug,
        company: ctx.company,
        title: ctx.title,
        feature: feature,
        jobUrl: ctx.jobUrl,
        notes: notes,
        jdSource: jdResult && jdResult.source,
      };
      if (ctx.enrichment) body.enrichment = ctx.enrichment;
      if (then) body.then = then;
      /* Wave 3: the outreach note is written with the letter (a resume-only
         request never asks; Draft both hands it to the chained letter). */
      if (includeOutreach && (feature !== "resume" || then)) body.extras = ["outreach"];
      /* C11: the server drafts from this, and 422s without it. */
      if (resume) body.resume = resume;
      return withTemplatePreference(body).then(function (b) {
        return postJson(ctx.base + "/api/applications/" + encodeURIComponent(ctx.slug) + "/request", b);
      });
    }).then(function () {
      /* Fire the queue-changed event immediately so the global strip
         updates without waiting for the manifest re-fetch round-trip.
         A second dispatch lands later when the re-fetch resolves —
         the queue strip's refresh is idempotent. */
      dispatch("jb:materials:changed", { slug: ctx.slug, reason: "request-sent" });
      /* Re-fetch so we render the real pending.json the server wrote. */
      return fetchJson(ctx.base + "/api/applications/" + encodeURIComponent(ctx.slug) + "/manifest");
    }).then(function (manifest) {
      var brief2 = findMount();
      if (!brief2) return;
      /* Force the applications cache to refresh so the next role open
         sees the new folder (Hermes creates it when none existed). */
      getApplications(ctx.base, { refresh: true });
      /* A held manifest still shows pending, so poll until the server's
         own pending or a document lands (or the hold lapses). */
      var committed = commitManifest(brief2, manifest, ctx.base, ctx.jobKey);
      if (committed && committed.pending) startPolling(committed.slug || ctx.slug, ctx.base);
      /* Nudge the global queue strip so it shows the new request
         without waiting for its next poll. */
      dispatch("jb:materials:changed", { slug: ctx.slug });
    }).catch(function (err) {
      var brief3 = findMount();
      if (!brief3) return;
      /* The "needs paste" path is a structured error — show a paste
         form instead of a generic error string. */
      optimisticRun = null;
      if (isResumeRequiredError(err)) {
        renderResumeGate(brief3);
        return;
      }
      if (isServerDownError(err, ctx.base)) {
        setServerState("down");
        renderServerDown(brief3);
        return;
      }
      if (err && err.code === "JD_PASTE_REQUIRED") {
        renderJdPasteForm(brief3, ctx, feature, notes);
        return;
      }
      renderError(brief3, "Materials request failed: " + ((err && err.message) || "Unknown error"));
    });
  }

  /* The JD always-available fallback chain. Steps, in order:
       1. Server reports JD already on disk → done.
       2. Browser cache has JD → PUT it and we're done.
       3. Server can scrape the jobUrl → server writes JD via scrape
          endpoint and we PUT the returned text → done.
       4. None of the above → reject with JD_PASTE_REQUIRED so the
          UI prompts the user to paste.

     Each step is best-effort: a failure in step N falls through to
     step N+1 rather than blowing up. The only "hard" outcome is
     step 4 — and even then we don't error, we surface a paste form. */
  function ensureJobDescription(ctx) {
    if (!ctx || !ctx.slug || !ctx.base) {
      return Promise.reject(new Error("ensureJobDescription: missing slug/base"));
    }
    var slug = ctx.slug;
    var base = ctx.base;
    var slugEnc = encodeURIComponent(slug);

    /* Step 1: does it already exist? */
    return fetchJson(base + "/api/applications/" + slugEnc + "/job-description")
      .catch(function () { return { exists: false }; })
      .then(function (probe) {
        if (probe && probe.exists) return { source: "already-on-disk" };

        /* Step 2: browser memory cache. */
        var cached = ctx.cachedJobDescription;
        if (cached && cached.length > 50) {
          return putJobDescription(base, slug, cached, "browser-cache", ctx.jobUrl)
            .then(function () { return { source: "browser-cache" }; })
            /* Cache write failed for some reason — fall through. */
            .catch(function () { return tryScrape(base, slug, ctx); });
        }
        return tryScrape(base, slug, ctx);
      });
  }

  function tryScrape(base, slug, ctx) {
    var jobUrl = typeof ctx === "string" ? ctx : (ctx && ctx.jobUrl);
    if (!jobUrl) return Promise.reject({ code: "JD_PASTE_REQUIRED" });
    var slugEnc = encodeURIComponent(slug);
    var payload = {
      jobUrl: jobUrl,
      title: ctx && ctx.title ? String(ctx.title) : "",
      company: ctx && ctx.company ? String(ctx.company) : "",
    };
    return postJson(base + "/api/applications/" + slugEnc + "/scrape-job-description", payload)
      .then(function (resp) {
        if (!resp || !resp.text) throw { code: "JD_PASTE_REQUIRED" };
        var source = resp.source || "server-scrape";
        return putJobDescription(base, slug, resp.text, source, jobUrl)
          .then(function () { return { source: source }; });
      })
      .catch(function (err) {
        /* If the server scrape produced nothing, fall through to
           the paste form rather than failing the whole click. */
        if (err && err.code === "JD_PASTE_REQUIRED") return Promise.reject(err);
        return Promise.reject({ code: "JD_PASTE_REQUIRED" });
      });
  }

  function putJobDescription(base, slug, text, source, jobUrl) {
    var slugEnc = encodeURIComponent(slug);
    var url = base + "/api/applications/" + slugEnc + "/job-description";
    if (typeof fetch !== "function") return Promise.reject(new Error("fetch unavailable"));
    return apiFetch(url, {
      method: "PUT",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, source: source, jobUrl: jobUrl || "" }),
    }).then(function (res) {
      if (!res.ok) throw new Error("PUT /job-description -> HTTP " + res.status);
      return res.json();
    });
  }

  function renderJdPasteForm(briefEl, ctx, feature, notes, afterSave) {
    if (!briefEl) return;
    /* Locate the materials section so we can paint the paste form
       above it (similar to the notes form pattern). */
    var section = briefEl.querySelector("." + SECTION_CLASS);
    var existing = briefEl.querySelector(".brief-materials__jd-form");
    if (existing) existing.parentNode.removeChild(existing);
    var holder = document.createElement("div");
    holder.className = "brief-materials__jd-form";
    // Hardened against jobUrl XSS: a pasted javascript:/data: URL must NOT
    // render as a clickable anchor (its onclick would exec). safeHref drops
    // everything that isn't http(s); the escapeHtml on the http(s) value
    // is still needed because attribute values must be HTML-safe.
    var __href = safeHref(ctx.jobUrl);
    var __sourceUrl = __href
      ? ' Source URL: <a href="' + escapeHtml(__href) + '" target="_blank" rel="noopener">' + escapeHtml(__href) + '</a>'
      : '';
    holder.innerHTML = ''
      + '<form aria-label="Paste job description">'
        + '<header class="brief-materials__jd-head">'
          + '<span class="brief-materials__jd-title">Job description isn\'t on disk and we couldn\'t fetch it.</span>'
          + '<span class="brief-materials__jd-eyebrow">PASTE THE JD</span>'
        + '</header>'
        + '<p class="brief-materials__jd-hint">'
          + 'Paste the full job description from the posting and we\'ll save it for this role, then start your draft.'
          + __sourceUrl
        + '</p>'
        + '<textarea name="jd" rows="10" required minlength="50" placeholder="Paste the full job description here…"></textarea>'
        + '<footer class="brief-materials__jd-actions">'
          + '<button type="button" class="brief-materials__btn brief-materials__btn--ghost" data-action="jd-cancel">Cancel</button>'
          + '<button type="submit" class="brief-materials__btn brief-materials__btn--primary">Save &amp; draft</button>'
        + '</footer>'
      + '</form>';
    if (section && section.parentNode) section.parentNode.insertBefore(holder, section);
    else briefEl.appendChild(holder);
    var formEl = holder.querySelector("form");
    var ta = holder.querySelector("textarea");
    if (ta) setTimeout(function () { try { ta.focus(); } catch (e) {} }, 0);
    formEl.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-action") === "jd-cancel") {
        if (typeof e.preventDefault === "function") e.preventDefault();
        if (holder.parentNode) holder.parentNode.removeChild(holder);
      }
    });
    formEl.addEventListener("submit", function (e) {
      if (typeof e.preventDefault === "function") e.preventDefault();
      var text = ta && ta.value ? String(ta.value).trim() : "";
      if (text.length < 50) return;
      putJobDescription(ctx.base, ctx.slug, text, "user-paste", ctx.jobUrl)
        .then(function () {
          if (holder.parentNode) holder.parentNode.removeChild(holder);
          if (typeof afterSave === "function") {
            return afterSave();
          }
          /* Re-fire the original submit flow now that the JD is on
             disk. submitDraftRequest will re-run the JD chain, but
             step 1 will short-circuit (JD now exists) and we go
             straight to /request. */
          return readResume().then(function (r) {
            return submitDraftRequest(ctx, feature, notes, r.resume);
          });
        })
        .catch(function (err) {
          var hint = holder.querySelector(".brief-materials__jd-hint");
          if (hint) hint.textContent = "Couldn't save: " + ((err && err.message) || "unknown error");
        });
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
      handleDraftRequest("cover_letter", detail.jobKey);
    } else {
      handleDraftRequest("resume", detail.jobKey);
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
    currentManifest = null;
    lastPaint = null;
    lastPaintKey = null;
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
    root.addEventListener("jb:scribe:saved", onScribeSaved);
    /* role.js dispatches jb:role:action on both document and window.
       Listen on document only so the duplicate window dispatch does
       not fire a second handler invocation; the re-entrancy guard
       inside onRoleAction is a belt-and-braces backup. */
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("jb:role:action", onRoleAction);
      document.addEventListener("jb:write:succeeded", onWriteSucceeded);
      document.addEventListener("click", onDocumentClick);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    /* On a hard reload the role can already be open when init() runs,
       which means jb:role:opened never fires. app.js dispatches
       jb:pipeline:rendered after the kanban paints — at that point
       the open-role view model is populated and we can finally load
       the materials panel. */
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("jb:pipeline:rendered", function () {
        refreshAutoDraftStageSnapshot();
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
    getCurrentManifest: getCurrentManifest,
    rehydrateOpenRole: rehydrateOpenRole,
    renderEmpty: renderEmpty,
    renderError: renderError,
    /* UX01 lane E: read by role-case-model.js collectDeps (C11, C12). */
    getServerState: getServerState,
    retryServer: retryServer,
    getResumeSummary: getResumeSummary,
    isAutoDraftEnabled: isAutoDraftEnabled,
    AUTO_DRAFT_STORAGE_KEY: AUTO_DRAFT_STORAGE_KEY,
    /* C16: the return prompt, callable directly in tests. */
    noteViewPosting: noteViewPosting,
    answerReturnPrompt: answerReturnPrompt,
    /* Wave 2: the in-page confirm and draft-both entry, for tests. */
    handleDraftRequest: handleDraftRequest,
    /* HOLES SCORE: the Case's grade buttons open the same modal. */
    openScore: openScore,
    gradeFor: function (feature) { return gradeFor(feature); },
    /** Test-only hook to inject a fresh applications list. */
    _resetCache: clearCache,
    _refreshContextApplication: refreshContextApplication,
    _refreshContextFromLocalMaterials: refreshContextFromLocalMaterials,
  };
})(typeof window !== "undefined" ? window : this);
