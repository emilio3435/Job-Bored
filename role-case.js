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
    var salaryHint = !id.salary && id.postingSalary ? id.postingSalary : "Salary";
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
    var view = link ? '<a class="case__cta" data-action="brief-view-posting" href="' + attr(link) + '" target="_blank" rel="noopener">View posting</a>' : "";
    /* The two Workshop entry points the Brief carried (frozen data-action
       contract): request a fresh cover letter / tailored resume pass.
       role.js routes both to jb:role:action → role-materials.js. */
    var draft = '<div class="case__cta-row">' +
      '<button type="button" class="case__cta case__cta--btn" data-action="resume-cover" aria-label="Draft a cover letter for this role">Draft cover letter</button>' +
      '<button type="button" class="case__cta case__cta--btn" data-action="resume-tailor" aria-label="Tailor your resume for this role">Tailor resume</button>' +
    "</div>";
    /* P1-1: the dossier had no headings at all — lane titles were spans and
       the role's own name existed only as "Role title, edit text", so H-key
       navigation and the rotor returned an empty list. The identity heading is
       visually hidden so the navy rail's typography is untouched. */
    var heading = '<h2 class="case__vh">' + esc((id.title || "Role") + (id.company ? " at " + id.company : "")) + "</h2>";
    return '<header class="case__rail">' + heading + logo +
      '<div class="case__rail-id">' +
        editInput("title", id.title, "case__title", "Role title") +
        editInput("company", id.company, "case__company", "Company") +
        '<div class="case__meta">' + meta.map(function (x) { return "<span>" + x + "</span>"; }).join("") + "</div>" +
      "</div>" +
      '<div class="case__rail-right">' + pills + view + draft + "</div>" +
    "</header>";
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
      tiles.push(tile("ats", "Resume score", src("ai"),
        (atsLow ? '<span class="case__num-v--crimson">' : "<span>") + esc(String(n.ats.value)) + "</span><small>/100</small>",
        "How well your draft answers this posting", "ai"));
    }
    if (n.keywords) tiles.push('<button type="button" class="case__num case__num--btn" data-num="keywords" data-action="open-profile-match">' +
      '<div class="case__num-k">Keywords ' + src("derived") + '</div><div class="case__num-v">' + esc(String(n.keywords.percentage)) + "<small>%</small></div>" +
      '<div class="case__num-sub">' + esc(n.keywords.found + " found · " + n.keywords.partial + " partial · " + n.keywords.missing + " missing") + "</div></button>");
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
    return tiles.length >= 2 ? '<div class="case__numbers" data-count="' + tiles.length + '">' + tiles.join("") + "</div>" : "";
  }
  function tile(key, k, s, v, sub, srcKind) {
    /* P1-4: the aria-hidden source chip's meaning is folded back in here, so
       the tile is still announced with where its number came from. */
    var label = srcKind ? ' aria-label="' + attr(k + ", " + srcWords(srcKind)) + '"' : "";
    return '<div class="case__num" data-num="' + key + '"' + label + '><div class="case__num-k">' + esc(k) + " " + s + '</div><div class="case__num-v">' + v + "</div>" + (sub ? '<div class="case__num-sub">' + sub + "</div>" : "") + "</div>";
  }

  function marked(list, cls, hasMatch) {
    return list.map(function (it) {
      var st = hasMatch ? it.status : "unknown";
      return "<li" + (cls ? ' class="' + cls + '"' : "") + ' data-status="' + st + '"><span class="case__m case__m--' + st + '"></span><span>' + esc(it.text) + "</span>" +
        (hasMatch && st !== "unknown" ? '<span class="case__st">' + esc(st) + "</span>" : "") + "</li>";
    }).join("");
  }
  function renderTheyWant(m) {
    var w = m.theyWant;
    if (m.loading.enrichment && !w.requirements.length) return '<section class="case__lane case__lane--they"><div class="case__lane-head"><h3 class="case__lane-title">They want</h3></div>' + skeletonRows(4, "Reading the posting…") + "</section>";
    if (!w.requirements.length && !w.niceToHaves.length && !w.stack.length) return "";
    var h = w.hasMatchData;
    /* DOSSIER-02: a payload the pipeline had to recover, or one the validator
       sent to review, is not evidence yet. The lane says so at its head and
       again over the requirements, because that list is what a hunter acts on. */
    var review = !!(m.provenance && m.provenance.needsReview);
    var html = '<section class="case__lane case__lane--they"><div class="case__lane-head"><h3 class="case__lane-title">They want</h3>' +
      src("scrape") + (h ? src("derived", "matched") : "") + (review ? src("review", "unverified") : "") + "</div>";
    if (!h) html += '<p class="case__hint">Add a resume to see what matches.</p>';
    var reqSub = review ? "Requirements · unverified — read these against the posting before you rely on them" : ("Requirements" + (h ? " · vs. your resume" : ""));
    if (w.requirements.length) html += '<div class="case__sub">' + reqSub + '</div><ul class="case__req">' + marked(w.requirements, "", h) + "</ul>";
    if (w.stack.length) html += '<div class="case__sub">Stack they name</div><div class="case__chips">' + w.stack.map(function (s) { var st = h ? s.status : "unknown"; return '<span class="case__chip" data-status="' + st + '"><span class="case__m case__m--' + st + '"></span>' + esc(s.text) + (h && st !== "unknown" ? '<span class="case__st case__st--vh">' + esc(st) + "</span>" : "") + "</span>"; }).join("") + "</div>";
    if (w.niceToHaves.length) html += '<div class="case__sub">Nice to have</div><ul class="case__req">' + marked(w.niceToHaves, "", h) + "</ul>";
    return html + "</section>";
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
    var html = '<section class="case__lane case__lane--you"><div class="case__lane-head"><h3 class="case__lane-title">You have</h3>' + (y.source === "scorecard" ? src("ai", "ai · scorecard") : src("derived", "keyword match")) + "</div>";
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

  function renderMoves(m) {
    var v = m.moves, p = v.people;
    var html = '<section class="case__lane case__lane--moves"><div class="case__lane-head"><h3 class="case__lane-title">Your moves</h3>' + src("ai") + src("sheet") + src("files") + "</div>";
    if (v.talkingPoints.length) html += '<div class="case__sub">Say this</div><ul class="case__tp">' + v.talkingPoints.map(function (t, i) { return '<li><span class="case__idx">' + (i < 9 ? "0" : "") + (i + 1) + "</span><span>" + esc(t) + "</span></li>"; }).join("") + "</ul>";
    html += '<div class="case__sub">Materials</div><div class="case__materials" data-mount="materials"></div>';
    /* People (spec §5) is the human side of the application, and it opens with
       a sentence rather than a form: the one move that follows from the four
       facts below it. The sentence is the block's only signature — everything
       under it is a quiet ledger row in the shared .case__kv idiom. */
    html += '<div class="case__sub">People</div>' +
      '<p class="case__move"><span class="case__move-k">Next move</span>' +
      '<span class="case__move-v">' + esc(p.nextMove) + "</span></p>" +
      '<ul class="case__kv case__kv--people">' +
      '<li><span class="case__k">Contact</span>' + editInput("contact", p.contact, "case__v case__v--edit", "Contact", ' placeholder="Add a contact"') + savedMark("contact") + "</li>" +
      '<li><span class="case__k">Last contact</span>' + editInput("heardBack", p.lastContactAt, "case__v case__v--edit", "Last contact", ' placeholder="Aug 30"') + savedMark("heardBack") + "</li>" +
      '<li><span class="case__k">Replied</span>' + replySegment(p.replied) + savedMark("reply") + "</li>" +
      '<li><span class="case__k">Follow-up</span><input class="case__v case__v--edit" data-action="edit-field" data-field="followupAt" type="date" data-original="' + attr(p.followUpAt) + '" value="' + attr(p.followUpAt) + '" aria-label="Follow-up date">' + savedMark("followupAt") + "</li>" +
    "</ul>";
    return html + "</section>";
  }

  function renderNotes(m) {
    var body = m.notes ? m.notes.body : "";
    return '<div class="case__notes"><textarea data-action="notes" placeholder="Interview prep, recruiter name, links you’ve gathered, next steps…">' + esc(body) + "</textarea></div>";
  }

  function renderRecord(m) {
    if (!m.record.length) return "";
    return '<div class="case__chron"><div class="case__chron-head"><h3 class="case__chron-title">The record</h3><span class="case__chron-rule"></span>' + src("sheet") + src("files") + "</div>" +
      '<div class="case__events" data-count="' + m.record.length + '">' + m.record.map(function (e) {
        return '<div class="case__ev case__ev--' + esc(e.state) + '"><div class="case__ev-dot"></div><div class="case__ev-d">' + esc(e.at || "—") + '</div><div class="case__ev-t">' + esc(e.label) + (e.detail ? "<small>" + esc(e.detail) + "</small>" : "") + "</div></div>";
      }).join("") + "</div></div>";
  }

  function render(mount, model) {
    if (!mount || !model) return;
    var stages = root.JobBoredStages;
    var lanes = renderTheyWant(model) + renderYouHave(model) + renderMoves(model);
    mount.innerHTML = '<div class="case">' +
      renderRail(model) + renderStepper(model, stages) + renderNumbers(model) +
      (model.oneLine ? '<div class="case__quote"><span class="case__k">In their words</span>' + esc(model.oneLine) + "</div>" : "") +
      (model.provenance && model.provenance.freshness ? '<div class="case__stamp case__stamp--fresh">' + esc(model.provenance.freshness) + "</div>" : "") +
      '<div class="case__board">' + lanes + "</div>" +
      renderNotes(model) + renderRecord(model) +
    "</div>";
  }

  root.JobBoredCase = root.JobBoredCase || {};
  root.JobBoredCase.render = render;
})(typeof window !== "undefined" ? window : globalThis);
