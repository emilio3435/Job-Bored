/* ============================================================
   role-case.js — The Case renderer (spec §2.1, §5, §7)
   window.JobBoredCase.render(mount, model). String templates,
   escape exactly once; role.js wires every data-action.
   ============================================================ */
(function (root) {
  "use strict";

  function esc(s) { return root.JobBoredText.escapeHtml(s); }
  function attr(s) { return root.JobBoredText.escapeAttr(s); }
  function src(kind, extra) { return '<span class="case__src case__src--' + esc(kind) + '">' + esc(extra || kind) + "</span>"; }
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
    /* Spec §5: all four rail identity fields edit in place. Location and
       salary are borderless inline inputs on the navy rail — the same
       edit-field contract role.js wires for title and company, not the
       read-only text the first cut shipped. Both render even when empty so
       a missing fact can be filled in without leaving the dossier. */
    meta.push(editInput("location", id.location, "case__fact-input", "Location", ' placeholder="Location"'));
    if (id.employment) meta.push(esc(id.employment));
    meta.push(editInput("salary", id.salary, "case__fact-input", "Salary", ' placeholder="Salary"'));
    if (id.source) meta.push("via " + esc(id.source));
    if (id.foundAt) meta.push("Found " + esc(id.foundAt));
    if (id.priority) meta.push("Priority <b>" + esc(id.priority.charAt(0).toUpperCase() + id.priority.slice(1)) + "</b>");
    if (id.favorite) meta.push("<b>&#9733;</b> Favorite");
    var pills = "";
    if (m.nextAction) {
      var d = m.nextAction.daysUntil;
      var when = d == null ? "" : (d < 0 ? " · " + Math.abs(d) + "d overdue" : d === 0 ? " · today" : " · in " + d + " day" + (d === 1 ? "" : "s"));
      pills += '<span class="case__pill case__pill--due"><span class="case__dot case__dot--amber"></span>Follow-up ' + esc(m.nextAction.followUpAt) + esc(when) + "</span>";
    }
    if (m.health && m.health.state !== "unknown") {
      var cls = m.health.state === "open" ? "open" : (m.health.state === "expired" ? "expired" : "review");
      pills += '<span class="case__pill case__pill--' + cls + '"><span class="case__dot case__dot--' + (cls === "open" ? "mint" : "crimson") + '"></span>' +
        esc(m.health.label) + (m.health.checkedAt ? " · checked " + esc(m.health.checkedAt.slice(0, 10)) : "") + "</span>";
    }
    var link = safeHref(id.link);
    var view = link ? '<a class="case__cta" data-action="brief-view-posting" href="' + attr(link) + '" target="_blank" rel="noopener">View posting</a>' : "";
    return '<header class="case__rail">' + logo +
      '<div class="case__rail-id">' +
        editInput("title", id.title, "case__title", "Role title") +
        editInput("company", id.company, "case__company", "Company") +
        '<div class="case__meta">' + meta.map(function (x) { return "<span>" + x + "</span>"; }).join("") + "</div>" +
      "</div>" +
      '<div class="case__rail-right">' + pills + view + "</div>" +
    "</header>";
  }

  function renderStepper(m, stages) {
    if (m.stage.terminal) {
      return '<div class="case__stepper"><span class="case__terminal">' + esc(m.stage.current) + (m.stage.appliedAt ? " · applied " + esc(m.stage.appliedAt) : "") + "</span></div>";
    }
    var cur = m.stage.order.indexOf(m.stage.current);
    return '<div class="case__stepper">' + m.stage.order.map(function (key, i) {
      var state = i < cur ? "done" : (i === cur ? "now" : "");
      var days = i === cur && m.stage.daysInStage != null ? ' <span class="case__step-days">· day ' + esc(String(m.stage.daysInStage)) + "</span>" : "";
      var label = stages && stages.toLabel ? stages.toLabel(key) : key;
      return (i ? '<span class="case__step-line"></span>' : "") +
        '<button type="button" class="case__step' + (state ? " case__step--" + state : "") + '" data-action="stage-step" data-stage="' + attr(key) + '">' +
          '<span class="case__step-dot"></span>' + esc(label) + days + "</button>";
    }).join("") + "</div>";
  }

  function renderNumbers(m) {
    var n = m.numbers, tiles = [];
    if (n.fit) tiles.push(tile("fit", "Fit", src("sheet"), esc(String(n.fit.value)) + "<small>/" + n.fit.max + "</small>", "Your agent's score"));
    if (n.ats) tiles.push(tile("ats", "ATS", src("ai"), '<span class="case__num-v--crimson">' + esc(String(n.ats.value)) + "</span><small>/100</small>", "Resume vs. posting"));
    if (n.keywords) tiles.push('<button type="button" class="case__num case__num--btn" data-num="keywords" data-action="open-profile-match">' +
      '<div class="case__num-k">Keywords ' + src("derived") + '</div><div class="case__num-v">' + esc(String(n.keywords.percentage)) + "<small>%</small></div>" +
      '<div class="case__num-sub">' + esc(n.keywords.found + " found · " + n.keywords.partial + " partial · " + n.keywords.missing + " missing") + "</div></button>");
    tiles.push(tile("reply", "Reply", src("sheet"), esc(n.reply.value), m.nextAction && m.nextAction.lastContactAt ? "Last contact " + esc(m.nextAction.lastContactAt) : ""));
    if (n.materials) tiles.push(tile("materials", "Materials", src("files"), esc(String(n.materials.ready)) + "<small>/" + n.materials.total + "</small>", n.materials.drafting ? esc(n.materials.drafting + " drafting") : "All ready"));
    return tiles.length >= 2 ? '<div class="case__numbers" data-count="' + tiles.length + '">' + tiles.join("") + "</div>" : "";
  }
  function tile(key, k, s, v, sub) {
    return '<div class="case__num" data-num="' + key + '"><div class="case__num-k">' + esc(k) + " " + s + '</div><div class="case__num-v">' + v + "</div>" + (sub ? '<div class="case__num-sub">' + sub + "</div>" : "") + "</div>";
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
    if (m.loading.enrichment && !w.requirements.length) return '<section class="case__lane case__lane--they"><div class="case__lane-head"><span class="case__lane-title">They want</span></div>' + skeletonRows(4) + "</section>";
    if (!w.requirements.length && !w.niceToHaves.length && !w.stack.length) return "";
    var h = w.hasMatchData;
    var html = '<section class="case__lane case__lane--they"><div class="case__lane-head"><span class="case__lane-title">They want</span>' + src("scrape") + (h ? src("derived", "matched") : "") + "</div>";
    if (!h) html += '<p class="case__hint">Add a resume to see what matches.</p>';
    if (w.requirements.length) html += '<div class="case__sub">Requirements' + (h ? " · vs. your resume" : "") + '</div><ul class="case__req">' + marked(w.requirements, "", h) + "</ul>";
    if (w.stack.length) html += '<div class="case__sub">Stack they name</div><div class="case__chips">' + w.stack.map(function (s) { var st = h ? s.status : "unknown"; return '<span class="case__chip" data-status="' + st + '"><span class="case__m case__m--' + st + '"></span>' + esc(s.text) + "</span>"; }).join("") + "</div>";
    if (w.niceToHaves.length) html += '<div class="case__sub">Nice to have</div><ul class="case__req">' + marked(w.niceToHaves, "", h) + "</ul>";
    return html + "</section>";
  }
  function skeletonRows(n) { var s = ""; for (var i = 0; i < n; i++) s += '<span class="case__shimmer' + (i === n - 1 ? " case__shimmer--short" : "") + '"></span>'; return '<div class="case__skeleton" aria-busy="true">' + s + "</div>"; }

  function renderYouHave(m) {
    var y = m.youHave;
    if (y.source === "none") return "";
    var html = '<section class="case__lane case__lane--you"><div class="case__lane-head"><span class="case__lane-title">You have</span>' + (y.source === "scorecard" ? src("ai", "ai · scorecard") : src("derived", "keyword match")) + "</div>";
    if (y.strengths.length) html += '<div class="case__sub">Strengths</div>' + y.strengths.map(function (s) { return '<div class="case__strength">' + esc(s) + "</div>"; }).join("");
    if (y.evidence.length) html += y.evidence.map(function (e) { return '<div class="case__evidence"><span class="case__from">Evidence' + (e.sourceType ? " · from your " + esc(e.sourceType) : "") + "</span>&ldquo;" + esc(e.sourceSnippet || e.claim) + "&rdquo;</div>"; }).join("");
    if (y.gaps.length) html += '<div class="case__sub">Gaps</div>' + y.gaps.map(function (g) { return '<div class="case__gap"><span class="case__sev case__sev--' + esc(g.severity) + '">' + esc(g.severity === "medium" ? "med" : g.severity) + "</span><span>" + esc(g.gap) + (g.whyItMatters ? '<span class="case__why">' + esc(g.whyItMatters) + "</span>" : "") + "</span></div>"; }).join("");
    if (y.dimensions.length) html += '<div class="case__sub">Scorecard dimensions</div><div class="case__dims">' + y.dimensions.map(function (d) { return '<div class="case__dim"><span>' + esc(d.label) + '</span><span class="case__bar"><i style="width: ' + d.score + '%;"></i></span><b>' + d.score + "</b></div>"; }).join("") + "</div>";
    if (y.storedAt) html += '<div class="case__stamp">Scored ' + esc(String(y.storedAt).slice(0, 10)) + "</div>";
    return html + "</section>";
  }

  function renderMoves(m) {
    var v = m.moves, p = v.people;
    var html = '<section class="case__lane case__lane--moves"><div class="case__lane-head"><span class="case__lane-title">Your moves</span>' + src("ai") + src("sheet") + src("files") + "</div>";
    if (v.talkingPoints.length) html += '<div class="case__sub">Say this</div><ul class="case__tp">' + v.talkingPoints.map(function (t, i) { return '<li><span class="case__idx">' + (i < 9 ? "0" : "") + (i + 1) + "</span><span>" + esc(t) + "</span></li>"; }).join("") + "</ul>";
    html += '<div class="case__sub">Materials</div><div class="case__materials" data-mount="materials"></div>';
    html += '<div class="case__sub">People</div><ul class="case__kv">' +
      '<li><span class="case__k">Contact</span>' + editInput("contact", p.contact, "case__v case__v--edit", "Contact", ' placeholder="Add a contact"') + "</li>" +
      '<li><span class="case__k">Last contact</span>' + editInput("heardBack", p.lastContactAt, "case__v case__v--edit", "Last contact", ' placeholder="e.g. Aug 30"') + "</li>" +
      '<li><span class="case__k">Replied</span><button type="button" class="case__v case__v--toggle' + (p.replied === "Yes" ? "" : " case__v--warn") + '" data-action="edit-field" data-field="reply" data-value="' + (p.replied === "Yes" ? "No" : "Yes") + '" aria-label="Toggle replied">' + esc(p.replied) + "</button></li>" +
      '<li><span class="case__k">Follow-up</span><input class="case__v case__v--edit" data-action="edit-field" data-field="followupAt" type="date" data-original="' + attr(p.followUpAt) + '" value="' + attr(p.followUpAt) + '" aria-label="Follow-up date"></li>' +
    "</ul>";
    /* The recruiter CRM row (recruiter-strip.js) innerHTML-overwrites whatever
       element it is handed, so it gets its own mount under People and nothing
       else. role.js fills it after Case.render — the region owner drives the
       seam, exactly as the retired Brief did. */
    html += '<div data-mount="recruiter-strip"></div>';
    return html + "</section>";
  }

  function renderNotes(m) {
    var body = m.notes ? m.notes.body : "";
    return '<div class="case__notes"><textarea data-action="notes" placeholder="Interview prep, recruiter name, links you’ve gathered, next steps…">' + esc(body) + "</textarea></div>";
  }

  function renderRecord(m) {
    if (!m.record.length) return "";
    return '<div class="case__chron"><div class="case__chron-head"><span class="case__chron-title">The record</span><span class="case__chron-rule"></span>' + src("sheet") + src("files") + "</div>" +
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
      '<div class="case__board">' + lanes + "</div>" +
      renderNotes(model) + renderRecord(model) +
    "</div>";
  }

  root.JobBoredCase = root.JobBoredCase || {};
  root.JobBoredCase.render = render;
})(typeof window !== "undefined" ? window : globalThis);
