/* ============================================================
   role-case.js — The Case renderer (spec §2.1, §5, §7)
   window.JobBoredCase.render(mount, model). String templates,
   escape exactly once; role.js wires every data-action.
   ============================================================ */
(function (root) {
  "use strict";

  function esc(s) { return root.JobBoredText.escapeHtml(s); }
  function attr(s) { return root.JobBoredText.escapeAttr(s); }
  /* P2-7: the source tags were the engineering reliability legend shipped as
     UI with no key. Each one now says, in words, where the fact came from.
     P1-4: they are decoration for the eye — a screen reader that reads every
     chip hears ~10 stray tokens per dossier, so the chip is aria-hidden and
     the source is folded into the owning tile's own label instead. */
  var SRC_WORDS = { sheet: "from your sheet", scrape: "from the posting", ai: "written by AI", derived: "matched here", files: "your files" };
  function srcWords(kind) { return SRC_WORDS[kind] || kind; }
  function src(kind, extra) { return '<span class="case__src case__src--' + esc(kind) + '" aria-hidden="true">' + esc(extra || srcWords(kind)) + "</span>"; }
  function safeHref(h) { var s = String(h || "").trim(); return /^https?:|^mailto:/i.test(s) ? s : ""; }
  var GUARDS = ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

  function editInput(field, value, cls, label, extra) {
    return '<input type="text" class="' + cls + '" data-action="edit-field" data-field="' + field + '"' +
      ' data-original="' + attr(value) + '" value="' + attr(value) + '" aria-label="' + attr(label) + '"' + (extra || "") + GUARDS + ">";
  }
  /* The title WRAPS. TEARDOWN §7 measured 81px of a real 57-character posting
     title unreachable inside an `<input width: 100%>` — no ellipsis, no wrap,
     no way to read it, and the deficit grows as the frame narrows. SPEC §5.2
     sanctions a `<textarea rows="1">` as the lower-risk form of
     display-then-edit: role.js's keydown and commit wiring already accept
     TEXTAREA, so the frozen edit-field contract is untouched — including
     data-original as the no-op baseline — and the text simply wraps. */
  function editText(field, value, cls, label) {
    return '<textarea class="' + cls + '" rows="1" data-action="edit-field" data-field="' + field + '"' +
      ' data-original="' + attr(value) + '" aria-label="' + attr(label) + '"' + GUARDS + ">" + esc(value) + "</textarea>";
  }

  function renderRail(m) {
    var id = m.identity;
    var logo = id.logoUrl && safeHref(id.logoUrl)
      ? '<img class="case__logo" src="' + attr(id.logoUrl) + '" alt="">'
      : '<div class="case__logo case__logo--mono">' + esc((id.company || "?").charAt(0).toUpperCase()) + "</div>";
    var meta = [];
    var closesIn = id.closesInDays;
    /* P0-B: Greenhouse and LinkedIn mirrors routinely carry a validThrough ~30
       days after posting on roles that stay live for months, so a deeply
       negative value is a stale feed, not a closed posting — the pill is
       suppressed below -30 days. And getPostingHealth returns "open" for any
       active row with an http link, having verified nothing, so it never gets
       to print "Posting open" beside a close date already in the past. */
    var closesSoon = closesIn != null && closesIn <= 14 && closesIn >= -30;
    var closedAlready = closesIn != null && closesIn < 0;
    /* Spec §5: all four rail identity fields edit in place. Location and
       salary are borderless inline inputs on the navy rail — the same
       edit-field contract role.js wires for title and company, not the
       read-only text the first cut shipped. Both render even when empty so
       a missing fact can be filled in without leaving the dossier. */
    meta.push(editInput("location", id.location, "case__fact-input", "Location", ' placeholder="Location"'));
    if (id.employment) meta.push(esc(id.employment));
    /* The posting's own salary is a scrape, not the user's data: it stands in
       as the placeholder so the empty input reads as a fact the sheet has yet
       to confirm, and the `scrape` tag says where the number came from. */
    var salaryHint = !id.salary && id.postingSalary ? id.postingSalary : "Add salary";
    meta.push(editInput("salary", id.salary, "case__fact-input", "Salary", ' placeholder="' + attr(salaryHint) + '"'));
    if (!id.salary && id.postingSalary) meta.push(src("scrape"));
    if (id.source) meta.push("via " + esc(id.source));
    /* DOSSIER-01: an identity the classifier will not ground in the posting is
       said so on the rail, never left to read like a scraped fact. */
    if (m.provenance && m.provenance.inferredIdentity) meta.push(src("inferred"));
    if (id.foundAt) meta.push("Found " + esc(id.foundAt));
    if (id.postedAt) meta.push("Posted " + esc(id.postedAt));
    /* A closing date the hunter still has time on is a meta line; one that is
       near or past is a pill instead — never both, or the same date reads as
       two facts. */
    if (id.closesAt && !closesSoon) meta.push("Closes " + esc(id.closesAt));
    if (id.priority) meta.push("Priority <b>" + esc(id.priority.charAt(0).toUpperCase() + id.priority.slice(1)) + "</b>");
    if (id.favorite) meta.push("<b>&#9733;</b> Favorite");
    var pills = "";
    if (m.nextAction) {
      var d = m.nextAction.daysUntil;
      var when = d == null ? "" : (d < 0 ? " · " + Math.abs(d) + "d overdue" : d === 0 ? " · today" : " · in " + d + " day" + (d === 1 ? "" : "s"));
      pills += '<span class="case__pill case__pill--due"><span class="case__dot case__dot--amber"></span>Follow-up ' + esc(m.nextAction.followUpAt) + esc(when) + "</span>";
    }
    if (closesSoon) {
      var closes = closesIn > 0
        ? "Closes in " + closesIn + " day" + (closesIn === 1 ? "" : "s")
        : (closesIn === 0 ? "Closes today" : "Closed " + Math.abs(closesIn) + " day" + (Math.abs(closesIn) === 1 ? "" : "s") + " ago");
      pills += '<span class="case__pill case__pill--due" data-pill="closes"><span class="case__dot case__dot--amber"></span>' + esc(closes) + "</span>";
    }
    if (m.health && m.health.state !== "unknown" && !(m.health.state === "open" && closedAlready)) {
      var cls = m.health.state === "open" ? "open" : (m.health.state === "expired" ? "expired" : "review");
      pills += '<span class="case__pill case__pill--' + cls + '"><span class="case__dot case__dot--' + (cls === "open" ? "mint" : "crimson") + '"></span>' +
        esc(m.health.label) + (m.health.checkedAt ? " · checked " + esc(m.health.checkedAt.slice(0, 10)) : "") + "</span>";
    }
    var link = safeHref(id.link);
    /* `View posting` stays here and NOT in the docket: it is navigation, and
       it belongs with "via Ashby · found · posted" rather than with the
       controls that change this role. Keeping it out of the docket is also
       what makes six stage labels fit — it is ~125px, the difference between
       the whole funnel being visible at a 1220px frame and the last stage
       scrolling out of view (SPEC §5.1). */
    var view = link ? '<a class="case__cta" data-action="brief-view-posting" href="' + attr(link) + '" target="_blank" rel="noopener">View posting</a>' : "";
    /* P1-1: the dossier had no headings at all — lane titles were spans and
       the role's own name existed only as "Role title, edit text", so H-key
       navigation and the rotor returned an empty list. The heading is the
       masthead's own identity block, so H-key navigation lands on the title
       the eye is already reading; the spoken name is the visually-hidden span
       inside it, because the ink itself is an edit surface. */
    var heading = '<h2 class="case__title-h">' +
      '<span class="case__vh">' + esc((id.title || "Role") + (id.company ? " at " + id.company : "")) + "</span>" +
      editText("title", id.title, "case__title", "Role title") +
    "</h2>";
    return '<header class="case__rail">' + logo +
      '<div class="case__rail-id">' + heading +
        editInput("company", id.company, "case__company", "Company") +
        '<div class="case__meta">' + meta.map(function (x) { return "<span>" + x + "</span>"; }).join("") + "</div>" +
      "</div>" +
      '<div class="case__rail-right">' + pills + view + "</div>" +
    "</header>";
  }

  /* ---------------- the docket (SPEC §5.1) ----------------
     Sticky. Stage on the left, the controls that change this role on the
     right, and the live materials run in between. It is the surface that
     makes the reading layout work: the reader can be anywhere in the dossier
     and still act, where before the drafting buttons sat in the masthead and
     scrolled away after ~200px of a 1,956px-tall frame (TEARDOWN §5). */
  function elapsedWords(seconds) {
    var n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) n = 0;
    var m = Math.floor(n / 60), s = Math.floor(n % 60);
    if (m === 0) return s + "s";
    return m + "m " + (s < 10 ? "0" + s : s) + "s";
  }
  var DOC_WORDS = { resume: "resume", cover_letter: "cover letter" };
  function docWords(type) { return DOC_WORDS[type] || "materials"; }
  /* The docket mirror and the ledger row render from the SAME manifest in the
     same render pass — two renderings of one run is how the overlay and the
     row came to disagree. This never polls. */
  function inflightChip(doc) {
    if (doc.status === "failed") {
      return '<button type="button" class="case__inflight case__inflight--failed" data-action="materials-retry"' +
        ' data-feature="' + attr(doc.type) + '" data-doc="' + attr(doc.type) + '"' +
        ' aria-label="' + attr("Retry the " + docWords(doc.type)) + '">' +
        esc(docWords(doc.type).charAt(0).toUpperCase() + docWords(doc.type).slice(1)) + " failed · retry</button>";
    }
    var word = /^queued$/i.test(doc.phase) ? "Queued" : "Drafting";
    return '<span class="case__inflight" role="status" aria-live="polite" data-doc="' + attr(doc.type) + '"' +
      ' data-phase="' + attr(doc.phase || "drafting") + '">' +
      '<span class="case__inflight-spin" aria-hidden="true"></span>' +
      esc(word + " " + docWords(doc.type) + " · " + elapsedWords(doc.elapsedSeconds)) + "</span>";
  }
  function docketAction(m, type, action, label, aria, primary) {
    var doc = (m.moves.materials || []).filter(function (d) { return d && d.type === type; })[0] || null;
    /* The same request cannot be issued twice from the same surface: while a
       run is in flight its button IS the chip. */
    if (doc && (doc.status === "pending" || doc.status === "failed")) return inflightChip(doc);
    /* C12 (TA-06): with the materials server down the button is off, not a
       promise of a queue nothing will ever read. The Materials section says
       why and how to start it; the disabled control names the reason too. */
    var down = m.moves.materialsServer === "down";
    return '<button type="button" class="case__btn' + (primary ? " case__btn--primary" : "") + '" data-action="' + action + '"' +
      ' aria-label="' + attr(down ? aria + " (the drafting server isn't running)" : aria) + '"' +
      (down ? ' disabled aria-describedby="case-materials-server"' : "") + ">" + esc(label) + "</button>";
  }
  function renderDocket(m, stages) {
    var actions = "";
    /* On a closed role the drafting actions are removed entirely — there is
       nothing to draft for a role that is over. */
    if (!m.stage.terminal) {
      actions += docketAction(m, "cover_letter", "resume-cover", "Draft cover letter", "Draft a cover letter for this role", true);
      actions += docketAction(m, "resume", "resume-tailor", "Tailor resume", "Tailor your resume for this role", false);
    }
    /* `close-role` has been wired in role.js since the cutover and nothing
       ever rendered it, so the dossier had no close control at all. */
    actions += '<button type="button" class="case__btn case__btn--icon" data-action="close-role" aria-label="Close this role">&times;</button>';
    return '<div class="case__docket" role="group" aria-label="Role docket">' +
      renderStepper(m, stages) +
      '<div class="case__docket-actions">' + actions + "</div>" +
    "</div>";
  }

  /* ---------------- the verdict (SPEC §4) ----------------
     One derived sentence, assembled in role-case-model.js from fields the
     model already carries, then the numbers. The gap clause is the only
     emphasis in the line, and it is always the thing the reader can do
     something about. */
  function renderVerdict(m) {
    var v = m.verdict || {};
    var parts = [];
    if (v.standing) parts.push("<b>" + esc(v.standing) + ".</b>");
    if (v.gap) parts.push("<em>" + esc(v.gap) + "</em>");
    if (v.next) parts.push(esc(v.next) + ".");
    if (v.note) parts.push(esc(v.note));
    var numbers = renderNumbers(m);
    if (!parts.length && !numbers) return "";
    return '<section class="case__verdict" aria-labelledby="case-verdict-h">' +
      '<h3 class="case__vh" id="case-verdict-h">Where this stands</h3>' +
      (parts.length ? '<p class="case__verdict-line">' + parts.join(" ") + "</p>" : "") +
      numbers +
    "</section>";
  }

  function renderStepper(m, stages) {
    if (m.stage.terminal) {
      /* P0-11: every non-terminal step goes through the registry's label, so
         the terminal chip does too — it was printing the raw key. */
      var termLabel = stages && stages.toLabel ? stages.toLabel(m.stage.current) : m.stage.current;
      return '<div class="case__stepper"><span class="case__terminal">' + esc(termLabel) + (m.stage.appliedAt ? " · applied " + esc(m.stage.appliedAt) : "") + "</span></div>";
    }
    var cur = m.stage.order.indexOf(m.stage.current);
    /* P1-2: N identical buttons with the current stage encoded only in a CSS
       class told assistive tech nothing. The row is a group, the current step
       carries aria-current, and each button says what pressing it does. */
    return '<div class="case__stepper" role="group" aria-label="Stage">' + m.stage.order.map(function (key, i) {
      var state = i < cur ? "done" : (i === cur ? "now" : "");
      var days = i === cur && m.stage.daysInStage != null ? ' <span class="case__step-days">· day ' + esc(String(m.stage.daysInStage)) + "</span>" : "";
      var label = stages && stages.toLabel ? stages.toLabel(key) : key;
      return (i ? '<span class="case__step-line"></span>' : "") +
        '<button type="button" class="case__step' + (state ? " case__step--" + state : "") + '" data-action="stage-step" data-stage="' + attr(key) + '"' +
          (state === "now" ? ' aria-current="step"' : "") + ' aria-label="' + attr("Move to " + label) + '">' +
          '<span class="case__step-dot"></span>' + esc(label) + days + "</button>";
    }).join("") + "</div>";
  }

  function renderNumbers(m) {
    var n = m.numbers, tiles = [];
    if (n.fit) tiles.push(tile("fit", "Fit", src("sheet"), esc(String(n.fit.value)) + "<small>/" + n.fit.max + "</small>", "Your agent's score", "sheet"));
    /* P2-3: "ATS" is never expanded anywhere in the product, and crimson is
       this design's missing/high-severity color — a 94/100 painted crimson
       reads as bad news. The number is named for what it is, and only a low
       score gets the alarm color. */
    if (n.ats) {
      var atsLow = Number(n.ats.value) < 70;
      /* C13 (TA-13): the score names the document it rates, and which
         version on which day, so it can never pass for the PDF you send. */
      var atsDoc = n.ats.doc || "draft";
      var atsKey = atsDoc.charAt(0).toUpperCase() + atsDoc.slice(1) + " score";
      var atsSub = "scored " + atsDoc + (n.ats.version ? " v" + n.ats.version : "") + (n.ats.scoredAt ? " · " + n.ats.scoredAt : "");
      tiles.push(tile("ats", atsKey, src("ai"),
        (atsLow ? '<span class="case__num-v--crimson">' : "<span>") + esc(String(n.ats.value)) + "</span><small>/100</small>",
        esc(atsSub), "ai"));
    }
    if (n.keywords) tiles.push('<li><button type="button" class="case__num case__num--btn" data-num="keywords" data-action="open-profile-match">' +
      '<div class="case__num-k">Keywords ' + src("derived") + '</div><div class="case__num-v">' + esc(String(n.keywords.percentage)) + "<small>%</small></div>" +
      '<div class="case__num-sub">' + esc(n.keywords.found + " found · " + n.keywords.partial + " partial · " + n.keywords.missing + " missing") + "</div></button></li>");
    /* P0-6 (spec §3, "each tile hides when its input is absent"): a role with
       nothing recorded was showing a tile whose entire value was the word
       "Unknown". Nothing recorded is not a number. */
    if (n.reply && (n.reply.value === "Yes" || n.reply.value === "No")) {
      tiles.push(tile("reply", "Reply", src("sheet"), esc(n.reply.value), m.nextAction && m.nextAction.lastContactAt ? "Last contact " + esc(m.nextAction.lastContactAt) : "", "sheet"));
    }
    /* P0-5: the caption branched only on `drafting`, so 0/4 was captioned
       "All ready" — the tile contradicting its own number. It reads off ready
       vs. total instead. */
    if (n.materials) {
      var mReady = Number(n.materials.ready) || 0, mTotal = Number(n.materials.total) || 0;
      var mCaption = n.materials.drafting
        ? esc(n.materials.drafting + " drafting")
        : (mTotal > 0 && mReady >= mTotal ? "All ready" : esc(mReady + " of " + mTotal + " ready"));
      tiles.push(tile("materials", "Materials", src("files"), esc(String(n.materials.ready)) + "<small>/" + n.materials.total + "</small>", mCaption, "files"));
    }
    /* `repeat(auto-fit, minmax(10rem, 1fr))` in the stylesheet, and the <li>
       is the grid cell: the shipped `repeat(var(--case-num-cols), minmax(0,
       1fr))` made every tile narrower each time one was added, which is the
       same no-floor pattern that crushed the materials row (SPEC §3.3). */
    return tiles.length >= 2 ? '<ul class="case__numbers" data-count="' + tiles.length + '">' + tiles.join("") + "</ul>" : "";
  }
  function tile(key, k, s, v, sub, srcKind) {
    /* P1-4: the aria-hidden source chip's meaning is folded back in here, so
       the tile is still announced with where its number came from. */
    var label = srcKind ? ' aria-label="' + attr(k + ", " + srcWords(srcKind)) + '"' : "";
    return '<li><div class="case__num" data-num="' + key + '"' + label + '><div class="case__num-k">' + esc(k) + " " + s + '</div><div class="case__num-v">' + v + "</div>" + (sub ? '<div class="case__num-sub">' + sub + "</div>" : "") + "</div></li>";
  }

  function marked(list, cls, hasMatch) {
    return list.map(function (it) {
      var st = hasMatch ? it.status : "unknown";
      /* Spec §3.3: under a found/partial requirement, the profile sentence
         that answers it. Never on missing/unknown — the model already nulls
         evidence there, and the renderer re-checks the status. */
      var ev = hasMatch && (st === "found" || st === "partial") && it.evidence && it.evidence.snippet
        ? '<span class="case__req-ev">&ldquo;' + esc(it.evidence.snippet) + "&rdquo; <i>from your resume</i></span>" : "";
      return "<li" + (cls ? ' class="' + cls + '"' : "") + ' data-status="' + st + '"><span class="case__m case__m--' + st + '"></span><span>' + esc(it.text) + "</span>" +
        (hasMatch && st !== "unknown" ? '<span class="case__st">' + esc(st) + "</span>" : "") + ev + "</li>";
    }).join("");
  }
  function safeId(s) { var v = String(s == null ? "" : s).replace(/[^a-zA-Z0-9_-]+/g, "-"); return v || "case"; }
  function niceList(list, h) { return '<div class="case__sub">Nice to have</div><ul class="case__req">' + marked(list, "", h) + "</ul>"; }
  /* Section furniture, shared by the canvas and the ledger. The board's three
     lanes had identical weight — same 11px mono title, same 2px rule, nothing
     primary — and the eye picked the leftmost, which was the reference
     material rather than the task (TEARDOWN §6). Sections are now stacked in
     one reading order, so weight comes from position. */
  function sectionHead(title, marks) {
    return '<div class="case__section-head"><h3 class="case__section-title">' + esc(title) + "</h3>" + (marks || "") + "</div>";
  }
  function renderTheyWant(m) {
    var w = m.theyWant;
    if (m.loading.enrichment && !w.requirements.length) return '<section class="case__section case__section--they">' + sectionHead("They want") + skeletonRows(4, "Reading the posting…") + "</section>";
    if (!w.requirements.length && !w.niceToHaves.length && !w.stack.length) return "";
    var h = w.hasMatchData;
    /* DOSSIER-02: a payload the pipeline had to recover, or one the validator
       sent to review, is not evidence yet. The section says so at its head and
       again over the requirements, because that list is what a hunter acts on. */
    var review = !!(m.provenance && m.provenance.needsReview);
    var html = '<section class="case__section case__section--they">' +
      sectionHead("They want", src("scrape") + (h ? src("derived", "matched") : "") + (review ? src("review", "unverified") : ""));
    /* C11 (TA-15): the sentence that says what is missing is also the way to
       fix it. Once a resume is on file the hint says matching is on its way. */
    if (!h) {
      html += m.moves.resume
        ? '<p class="case__hint">Matching against your resume…</p>'
        : '<p class="case__hint"><button type="button" class="case__link" data-action="open-resume">Add your resume</button> to see what matches.</p>';
    }
    var reqSub = review ? "Requirements · unverified — read these against the posting before you rely on them" : ("Requirements" + (h ? " · vs. your resume" : ""));
    /* Spec §3.2: the first visibleCount requirements render; the rest sit in
       .case__more behind a client-state toggle. Nice-to-haves keep their own
       list but move inside .case__more when collapsed, so the visible lane
       height stays bounded. At or under the cap there is no disclosure. */
    var total = w.requirements.length;
    var visibleCount = typeof w.visibleCount === "number" && w.visibleCount > 0 ? w.visibleCount : 8;
    var collapsed = total > visibleCount;
    var moreId = "case-more-" + safeId(m.jobKey);
    if (total) html += '<div class="case__sub">' + reqSub + '</div><ul class="case__req">' + marked(collapsed ? w.requirements.slice(0, visibleCount) : w.requirements, "", h) + "</ul>";
    if (collapsed) html += '<div class="case__more" id="' + attr(moreId) + '" hidden><ul class="case__req">' + marked(w.requirements.slice(visibleCount), "", h) + "</ul>";
    if (w.niceToHaves.length && collapsed) html += niceList(w.niceToHaves, h);
    if (collapsed) html += "</div>";
    /* Spec §3.2: twelve chips, then one quiet +N more chip that expands in
       place — the overflow sits in .case__chips-more under the same
       client-state pattern as the requirements disclosure. */
    function chip(s) { var st = h ? s.status : "unknown"; return '<span class="case__chip" data-status="' + st + '"><span class="case__m case__m--' + st + '"></span>' + esc(s.text) + (h && st !== "unknown" ? '<span class="case__st case__st--vh">' + esc(st) + "</span>" : "") + "</span>"; }
    if (w.stack.length) {
      html += '<div class="case__sub">Stack they name</div><div class="case__chips">' + w.stack.map(chip).join("");
      var hiddenCount = w.stackHidden && w.stackHidden.length ? w.stackHidden.length : 0;
      if (hiddenCount) {
        var stackId = "case-stack-" + safeId(m.jobKey);
        html += '<span class="case__chips-more" id="' + attr(stackId) + '" hidden>' + w.stackHidden.map(chip).join("") + "</span>" +
          '<button type="button" class="case__chip case__chip--more" data-action="toggle-stack" aria-expanded="false" aria-controls="' + attr(stackId) + '" data-collapsed-label="+' + hiddenCount + ' more">+' + hiddenCount + " more</button>";
      }
      html += "</div>";
    }
    if (w.niceToHaves.length && !collapsed) html += niceList(w.niceToHaves, h);
    if (collapsed) html += '<button type="button" class="case__more-btn" data-action="toggle-requirements" aria-expanded="false" aria-controls="' + attr(moreId) + '" data-collapsed-label="Show all ' + total + '">Show all ' + total + "</button>";
    return html + "</section>";
  }
  /* Spec §4: toggle-requirements and toggle-stack are client-state only — no
     event, no writeback. role.js is frozen, so the Case binds its own
     single delegated listener on the mount at render time. */
  function toggleDisclosure(button, panel) {
    var expanded = button.getAttribute("aria-expanded") === "true";
    if (expanded) {
      panel.setAttribute("hidden", "");
      button.setAttribute("aria-expanded", "false");
      button.textContent = button.getAttribute("data-collapsed-label") || button.textContent;
    } else {
      panel.removeAttribute("hidden");
      button.setAttribute("aria-expanded", "true");
      button.textContent = "Show fewer";
    }
  }
  function onBoardClick(root, event) {
    var target = event && event.target;
    var button = target && typeof target.closest === "function"
      ? target.closest('[data-action="toggle-requirements"], [data-action="toggle-stack"]')
      : null;
    if (!button) return;
    var id = typeof button.getAttribute === "function" ? button.getAttribute("aria-controls") : null;
    var panel = id && root && typeof root.querySelector === "function" ? root.querySelector("#" + id) : null;
    if (!panel || typeof panel.removeAttribute !== "function") return;
    toggleDisclosure(button, panel);
  }
  function bindBoardToggles(mountEl) {
    if (!mountEl || typeof mountEl.addEventListener !== "function" || mountEl.__caseBoardBound) return;
    mountEl.__caseBoardBound = true;
    mountEl.addEventListener("click", function (event) { onBoardClick(mountEl, event); });
  }
  /* aria-busy alone is silent: a screen reader announces nothing while the
     enrichment runs. role="status" + aria-live="polite" make the region a
     live one, and `status` gives it a line to actually read out — the Brief's
     announcement, restored (LANE-REPORT-L5.md §5, item 3). The aria-busy
     attribute stays adjacent to the class: tests/enrichment-self-heal.test.mjs
     greps this file for that exact pair. */
  function skeletonRows(n, status) {
    var s = status ? '<span class="case__skeleton-status">' + esc(status) + "</span>" : "";
    for (var i = 0; i < n; i++) s += '<span class="case__shimmer' + (i === n - 1 ? " case__shimmer--short" : "") + '"></span>';
    return '<div class="case__skeleton" aria-busy="true" role="status" aria-live="polite">' + s + "</div>";
  }

  function renderYouHave(m) {
    var y = m.youHave;
    /* P0-9 (spec §3): the early return only fired on source "none", but a
       keyword analysis whose terms are all `partial` yields no strengths and
       no gaps — the lane emitted a header and closed. */
    if (y.source === "none") return "";
    if (!y.strengths.length && !y.evidence.length && !y.gaps.length && !y.dimensions.length) return "";
    /* Stacked directly under "They want", at the same measure: a requirement
       and whether you answer it are a pair, and splitting them into adjacent
       columns separated by a rule made the reader saccade horizontally between
       two lists whose vertical positions never corresponded (TEARDOWN §6). */
    var html = '<section class="case__section case__section--you">' +
      sectionHead("You have", y.source === "scorecard" ? src("ai", "ai · scorecard") : src("derived", "keyword match"));
    if (y.strengths.length) html += '<div class="case__sub">Strengths</div>' + y.strengths.map(function (s) { return '<div class="case__strength">' + esc(s) + "</div>"; }).join("");
    if (y.evidence.length) html += y.evidence.map(function (e) { return '<div class="case__evidence"><span class="case__from">Evidence' + (e.sourceType ? " · from your " + esc(e.sourceType) : "") + "</span>&ldquo;" + esc(e.sourceSnippet || e.claim) + "&rdquo;</div>"; }).join("");
    if (y.gaps.length) html += '<div class="case__sub">Gaps</div>' + y.gaps.map(function (g) { return '<div class="case__gap"><span class="case__sev case__sev--' + esc(g.severity) + '">' + esc(g.severity === "medium" ? "med" : g.severity) + "</span><span>" + esc(g.gap) + (g.whyItMatters ? '<span class="case__why">' + esc(g.whyItMatters) + "</span>" : "") + "</span></div>"; }).join("");
    if (y.dimensions.length) html += '<div class="case__sub">Scorecard dimensions</div><div class="case__dims">' + y.dimensions.map(function (d) { return '<div class="case__dim"><span>' + esc(d.label) + '</span><span class="case__bar"><i style="width: ' + d.score + '%;"></i></span><b>' + d.score + "</b></div>"; }).join("") + "</div>";
    if (y.storedAt) html += '<div class="case__stamp">Scored ' + esc(String(y.storedAt).slice(0, 10)) + "</div>";
    return html + "</section>";
  }

  /* Replied is three-state, so it is a segmented control, not a toggle that
     hides one of its values behind a click. Every value is visible and the
     active one is filled; role.js reads data-value verbatim, so `Unknown`
     writes as itself. */
  var REPLY_VALUES = ["Yes", "No", "Unknown"];
  function replySegment(current) {
    var cur = current || "Unknown";
    return '<span class="case__seg" role="group" aria-label="Replied">' + REPLY_VALUES.map(function (value) {
      var on = value === cur;
      return '<button type="button" class="case__seg-b' + (on ? " case__seg-b--on" : "") + '"' +
        ' data-action="edit-field" data-field="reply" data-value="' + attr(value) + '"' +
        ' aria-pressed="' + (on ? "true" : "false") + '">' + esc(value) + "</button>";
    }).join("") + "</span>";
  }

  /* The result half of the vocabulary: the control says what it does, this
     says it happened. Painted by role.js on jb:write:succeeded and re-painted
     after every render, so a re-render mid-fade cannot swallow it. */
  function savedMark(field) {
    return '<span class="case__saved" data-saved="' + attr(field) + '" role="status" aria-live="polite"></span>';
  }

  /* Canvas: what the reader says back. Prose, so it belongs at the reading
     measure rather than in a 320px widget column. */
  function renderSayThis(m) {
    var points = m.moves.talkingPoints;
    if (!points.length) return "";
    return '<section class="case__section case__section--say">' + sectionHead("Say this", src("ai")) +
      '<ul class="case__tp">' + points.map(function (t, i) { return '<li><span class="case__idx">' + (i < 9 ? "0" : "") + (i + 1) + "</span><span>" + esc(t) + "</span></li>"; }).join("") + "</ul>" +
    "</section>";
  }

  /* Ledger: bounded widgets, every one designed and audited at 320px. The
     materials mount is a frozen contract — role-materials.js renders its rows
     into it — so this section renders whether or not there is a manifest. */
  function renderMaterialsSection() {
    return '<section class="case__section case__section--materials">' + sectionHead("Materials", src("files")) +
      '<div class="case__materials" data-mount="materials"></div>' +
    "</section>";
  }

  /* A ledger row puts its label ABOVE its value, so the value gets the row's
     full width: a nowrap mono label beside a `width: 60%` input is what
     truncated "Dana Whitfield (Talent Partner)" to "Dana Whitfield (Talent
     Partn" in the shipped dossier (TEARDOWN §7). */
  function ledgerRow(label, control, saved) {
    return '<div class="case__row"><dt class="case__k">' + esc(label) + (saved || "") + "</dt><dd>" + control + "</dd></div>";
  }
  function renderPeople(m) {
    var p = m.moves.people;
    /* People opens with a sentence rather than a form: the one move that
       follows from the four facts below it. */
    return '<section class="case__section case__section--people">' + sectionHead("People", src("sheet")) +
      '<p class="case__move"><span class="case__move-k">Next move</span>' +
      '<span class="case__move-v">' + esc(p.nextMove) + "</span></p>" +
      '<dl class="case__rows case__rows--people">' +
      ledgerRow("Contact", editInput("contact", p.contact, "case__v case__v--edit", "Contact", ' placeholder="Add a contact"'), savedMark("contact")) +
      ledgerRow("Last contact", editInput("heardBack", p.lastContactAt, "case__v case__v--edit", "Last contact", ' placeholder="Add a date"'), savedMark("heardBack")) +
      ledgerRow("Replied", replySegment(p.replied), savedMark("reply")) +
      /* Spec §3.7: the native date control stays, but its raw mm/dd/yyyy
         never reads as content — a Not-set sibling shows only while the
         input's value is empty (see the .case__date CSS rule). */
      ledgerRow("Follow-up", '<span class="case__date"><input class="case__v case__v--edit" data-action="edit-field" data-field="followupAt" type="date" data-original="' + attr(p.followUpAt) + '" value="' + attr(p.followUpAt) + '" aria-label="Follow-up date"><span class="case__date-empty">Not set</span></span>', savedMark("followupAt")) +
    "</dl></section>";
  }

  function renderNotes(m) {
    var body = m.notes ? m.notes.body : "";
    return '<section class="case__section case__section--notes"><h3 class="case__vh">Notes</h3>' +
      '<div class="case__notes"><textarea data-action="notes" placeholder="Interview prep, recruiter name, links you’ve gathered, next steps…">' + esc(body) + "</textarea></div>" +
    "</section>";
  }

  function renderRecord(m) {
    if (!m.record.length) return "";
    return '<section class="case__section case__section--record">' + sectionHead("The record", src("sheet") + src("files")) +
      '<div class="case__events" data-count="' + m.record.length + '">' + m.record.map(function (e) {
        return '<div class="case__ev case__ev--' + esc(e.state) + '"><div class="case__ev-dot"></div><div class="case__ev-d">' + esc(e.at || "—") + '</div><div class="case__ev-t">' + esc(e.label) + (e.detail ? "<small>" + esc(e.detail) + "</small>" : "") + "</div></div>";
      }).join("") + "</div>" +
      (m.provenance && m.provenance.freshness ? '<div class="case__stamp case__stamp--fresh">' + esc(m.provenance.freshness) + "</div>" : "") +
    "</section>";
  }

  function render(mount, model) {
    if (!mount || !model) return;
    var stages = root.JobBoredStages;
    /* The canvas holds prose and the ledger holds bounded widgets (SPEC §2).
       Three rules decide what goes where, and they are the reason a 320px
       ledger does not repeat the shipped bug: anything that is sentences gets
       a reading measure, anything that is a row or a pill or a field is
       designed for 320px, and anything the reader might want while looking at
       something else is in the docket. */
    var canvas = '<div class="case__canvas">' +
      (model.oneLine ? '<blockquote class="case__quote"><span class="case__k">In their words</span>' + esc(model.oneLine) + "</blockquote>" : "") +
      renderTheyWant(model) + renderYouHave(model) +
      renderSayThis(model) + renderNotes(model) +
    "</div>";
    var ledger = '<aside class="case__ledger" aria-label="Role ledger">' +
      renderMaterialsSection() + renderPeople(model) + renderRecord(model) +
    "</aside>";
    /* Source order is reading order, tab order and the single-column order
       (SPEC §2): masthead, verdict, docket, then the read. The ledger follows
       the canvas in source order and is never reordered visually, so tab order
       and reading order agree at every width (WCAG 1.3.2, 2.4.3). */
    /* C12 (TA-18): one inline line for a missing AI provider, in place of the
       stacked red toasts that covered the docket on every open. */
    var notice = model.notice
      ? '<p class="case__notice" role="status">' + esc(model.notice) + "</p>"
      : "";
    /* Spec §4 (casefit): the They-want disclosures are client-state only;
       the Case binds its own single delegated listener on the mount. */
    bindBoardToggles(mount);
    mount.innerHTML = '<div class="case">' +
      renderRail(model) + notice + renderVerdict(model) + renderDocket(model, stages) +
      '<div class="case__body">' + canvas + ledger + "</div>" +
    "</div>";
  }

  root.JobBoredCase = root.JobBoredCase || {};
  root.JobBoredCase.render = render;
})(typeof window !== "undefined" ? window : globalThis);
