/* ============================================================
   dossier-mock.js — the redesigned Role Dossier, as a mock renderer.
   ------------------------------------------------------------
   MOCK. Loaded only by the pages in this folder. Production JS is
   untouched by this pass.

   Written in role-case.js's own idiom on purpose — string templates,
   escape once, one function per region — so the structure below maps
   one-to-one onto the functions an engineer will change:

     renderMasthead  ← role-case.js renderRail
     renderVerdict   ← new (see ../SPEC.md §4)
     renderDocket    ← new; absorbs renderStepper + the rail's CTAs
     renderCanvas    ← renderTheyWant + renderYouHave + the talking
                       points half of renderMoves + renderNotes
     renderLedger    ← the materials + people halves of renderMoves,
                       plus renderRecord
   Every data-action / data-field / data-value attribute is the one
   role.js already listens for; the frozen contract is preserved.
   ============================================================ */
(function (root) {
  "use strict";

  /* ---------- escaping (same two helpers role-case.js uses) ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var attr = esc;

  var SRC_WORDS = {
    sheet: "from your sheet",
    scrape: "from the posting",
    ai: "written by ai",
    derived: "matched here",
    files: "your files",
    review: "unverified",
  };
  function src(kind, words) {
    return '<span class="dossier__src dossier__src--' + esc(kind) + '" aria-hidden="true">'
      + esc(words || SRC_WORDS[kind] || kind) + "</span>";
  }

  /* Annotation badge. Inert and hidden unless the page turns
     annotations on, so the mock reads clean by default. */
  function anno(n) { return '<b class="anno" aria-hidden="true">' + esc(n) + "</b>"; }

  /* ---------------- 1 · MASTHEAD ---------------- */
  function renderMasthead(m) {
    var id = m.identity;
    var facts = id.facts.map(function (f) {
      return '<div class="dossier__fact' + (f.flag ? " dossier__fact--flag" : "") + '">'
        + "<dt>" + esc(f.k) + "</dt><dd>" + esc(f.v) + "</dd></div>";
    }).join("");

    var flags = (m.flags || []).map(function (p) {
      return '<span class="dossier__pill dossier__pill--' + esc(p.tone) + '">'
        + '<span class="dossier__dot dossier__dot--' + esc(p.dot) + '"></span>' + esc(p.text) + "</span>";
    }).join("");

    return '<header class="dossier__masthead">'
      + '<div class="dossier__crest">' + esc((id.company || "?").charAt(0).toUpperCase()) + "</div>"
      + '<div class="dossier__identity">'
        + '<p class="dossier__eyebrow">Part 03 · Dossier' + anno(1) + "</p>"
        /* The heading is real and visible. The shipped dossier's only
           h2 is visually hidden, so the rotor lists nothing. */
        + '<h2 class="dossier__title">'
          + '<span class="dossier__editable" role="textbox" tabindex="0"'
          + ' data-action="edit-field" data-field="title">' + esc(id.title) + "</span>" + anno(2)
        + "</h2>"
        + '<p class="dossier__company">'
          + '<span class="dossier__editable" role="textbox" tabindex="0"'
          + ' data-action="edit-field" data-field="company">' + esc(id.company) + "</span>"
        + "</p>"
        + '<dl class="dossier__facts">' + facts + "</dl>"
      + "</div>"
      + '<div class="dossier__flags">' + flags + anno(3) + "</div>"
    + "</header>";
  }

  /* ---------------- 2 · VERDICT ---------------- */
  function renderVerdict(m) {
    if (!m.verdict) return "";
    var tiles = (m.metrics || []).map(function (t) {
      var tag = t.src ? " " + src(t.src, t.srcWords) : "";
      var body = '<div class="dossier__metric-k">' + esc(t.k) + tag + "</div>"
        + '<div class="dossier__metric-v' + (t.alarm ? " dossier__metric-v--alarm" : "") + '">'
          + esc(t.v) + (t.unit ? "<small>" + esc(t.unit) + "</small>" : "") + "</div>"
        + (t.sub ? '<div class="dossier__metric-sub">' + esc(t.sub) + "</div>" : "");
      var label = t.src ? ' aria-label="' + attr(t.k + ", " + (SRC_WORDS[t.src] || t.src)) + '"' : "";
      return t.action
        ? '<li><button type="button" class="dossier__metric dossier__metric--action"'
          + ' data-action="' + attr(t.action) + '"' + label + ">" + body + "</button></li>"
        : '<li><div class="dossier__metric"' + label + ">" + body + "</div></li>";
    }).join("");

    return '<section class="dossier__verdict" aria-labelledby="dsr-verdict">'
      + '<h3 class="dossier__vh" id="dsr-verdict">Where this stands</h3>'
      + '<p class="dossier__verdict-line">' + m.verdict + anno(4) + "</p>"
      + (tiles ? '<ul class="dossier__metrics">' + tiles + "</ul>" : "")
    + "</section>";
  }

  /* ---------------- 3 · DOCKET (sticky) ---------------- */
  function renderDocket(m) {
    var stage = m.stage;
    var steps;
    if (stage.terminal) {
      steps = '<div class="dossier__stepper"><span class="dossier__terminal">'
        + esc(stage.terminalLabel) + "</span></div>";
    } else {
      var cur = stage.order.indexOf(stage.current);
      steps = '<div class="dossier__stepper" role="group" aria-label="Stage">'
        + stage.order.map(function (s, i) {
          var state = i < cur ? "done" : (i === cur ? "now" : "");
          var days = i === cur && stage.daysInStage != null
            ? ' <span class="dossier__step-days">· day ' + esc(stage.daysInStage) + "</span>" : "";
          return (i ? '<span class="dossier__step-line"></span>' : "")
            + '<button type="button" class="dossier__step' + (state ? " dossier__step--" + state : "") + '"'
            + ' data-action="stage-step" data-stage="' + attr(s.key) + '"'
            + (state === "now" ? ' aria-current="step"' : "")
            + ' aria-label="' + attr("Move to " + s.label) + '">'
            + '<span class="dossier__step-dot"></span>' + esc(s.label) + days + "</button>";
        }).join("")
        + "</div>";
    }

    var inflight = "";
    if (m.inflight) {
      inflight = '<span class="dossier__inflight' + (m.inflight.failed ? " dossier__inflight--failed" : "") + '"'
        + ' role="status" aria-live="polite">'
        + (m.inflight.failed ? "" : '<span class="dossier__inflight-spin"></span>')
        + esc(m.inflight.text) + "</span>" + anno(6);
    }

    var actions = (m.actions || []).map(function (a) {
      var cls = "dossier__btn" + (a.primary ? " dossier__btn--primary" : "");
      return a.href
        ? '<a class="' + cls + '" href="' + attr(a.href) + '" target="_blank" rel="noopener"'
          + ' data-action="' + attr(a.action) + '">' + esc(a.label) + "</a>"
        : '<button type="button" class="' + cls + '" data-action="' + attr(a.action) + '">'
          + esc(a.label) + "</button>";
    }).join("");

    return '<div class="dossier__docket" role="group" aria-label="Role docket">'
      + steps + anno(5)
      + '<div class="dossier__docket-actions">' + inflight + actions
        + '<button type="button" class="dossier__btn dossier__btn--icon" data-action="close-role"'
        + ' aria-label="Close this role">×</button>'
      + "</div>"
    + "</div>";
  }

  /* ---------------- banners ---------------- */
  function renderBanner(b) {
    if (!b) return "";
    var acts = (b.actions || []).map(function (a) {
      return '<button type="button" class="dossier__btn" data-action="' + attr(a.action) + '">'
        + esc(a.label) + "</button>";
    }).join("");
    return '<div class="dossier__banner' + (b.tone === "error" ? " dossier__banner--error" : "") + '"'
      + ' role="' + (b.tone === "error" ? "alert" : "status") + '">'
      + '<span class="dossier__banner-icon" aria-hidden="true">!</span>'
      + '<span class="dossier__banner-k">' + esc(b.k) + "</span>"
      + '<p class="dossier__banner-t">' + esc(b.text) + "</p>"
      + (acts ? '<div class="dossier__banner-actions">' + acts + "</div>" : "")
    + "</div>";
  }

  /* ---------------- sections ---------------- */
  function head(title, id, tags, mod) {
    return '<div class="dossier__section-head">'
      + '<h3 class="dossier__section-title" id="' + attr(id) + '">' + esc(title) + "</h3>"
      + (tags || "") + "</div>";
  }
  function section(mod, title, id, tags, body, extra) {
    return '<section class="dossier__section dossier__section--' + esc(mod) + '"'
      + ' aria-labelledby="' + attr(id) + '"' + (extra || "") + ">"
      + head(title, id, tags) + body + "</section>";
  }
  function skeleton(n, status) {
    var s = status ? '<span class="dossier__skeleton-k">' + esc(status) + "</span>" : "";
    for (var i = 0; i < n; i++) {
      s += '<span class="dossier__shimmer' + (i === n - 1 ? " dossier__shimmer--short" : "") + '"></span>';
    }
    return '<div class="dossier__skeleton" aria-busy="true" role="status" aria-live="polite">' + s + "</div>";
  }

  /* ---------------- 4a · CANVAS ---------------- */
  function renderCanvas(m) {
    var c = m.canvas;
    var out = "";

    if (c.lede) {
      out += '<blockquote class="dossier__lede">'
        + '<span class="dossier__lede-k">In their words ' + src("scrape") + "</span>"
        + esc(c.lede) + "</blockquote>";
    }

    /* They want */
    if (c.loading) {
      out += section("they", "They want", "dsr-they", src("scrape"), skeleton(4, "Reading the posting…"));
    } else if (c.requirements && c.requirements.length) {
      var reqs = c.requirements.map(function (r) {
        return '<li class="dossier__req" data-status="' + attr(r.status) + '">'
          + '<span class="dossier__mark dossier__mark--' + esc(r.status) + '"></span>'
          + '<span class="dossier__req-text">' + esc(r.text) + "</span>"
          + '<span class="dossier__req-status">' + esc(r.status === "unknown" ? "—" : r.status) + "</span>"
        + "</li>";
      }).join("");
      var body = '<div class="dossier__sub">Requirements' + (c.hasMatch ? " · vs. your resume" : "") + "</div>"
        + '<ul class="dossier__reqs">' + reqs + "</ul>";
      if (c.stack && c.stack.length) {
        body += '<div class="dossier__sub">Stack they name</div><div class="dossier__chips">'
          + c.stack.map(function (s) {
            return '<span class="dossier__chip" data-status="' + attr(s.status) + '">'
              + '<span class="dossier__mark dossier__mark--' + esc(s.status) + '"></span>' + esc(s.text)
              + '<span class="dossier__vh">' + esc(s.status) + "</span></span>";
          }).join("") + "</div>";
      }
      if (c.niceToHaves && c.niceToHaves.length) {
        body += '<div class="dossier__sub">Nice to have</div><ul class="dossier__reqs">'
          + c.niceToHaves.map(function (r) {
            return '<li class="dossier__req" data-status="' + attr(r.status) + '">'
              + '<span class="dossier__mark dossier__mark--' + esc(r.status) + '"></span>'
              + '<span class="dossier__req-text">' + esc(r.text) + "</span>"
              + '<span class="dossier__req-status">' + esc(r.status === "unknown" ? "—" : r.status) + "</span></li>";
          }).join("") + "</ul>";
      }
      out += section("they", "They want", "dsr-they",
        src("scrape") + (c.hasMatch ? src("derived", "matched") : "")
        + (c.needsReview ? src("review") : ""), body) + anno(7);
    }

    /* You have */
    if (c.youHave) {
      var y = c.youHave;
      var yb = "";
      if (y.invite) {
        yb = '<div class="dossier__invite"><p>' + esc(y.invite.text) + "</p>"
          + '<button type="button" class="dossier__btn dossier__btn--primary" data-action="'
          + attr(y.invite.action) + '">' + esc(y.invite.label) + "</button></div>";
      } else {
        if (y.strengths && y.strengths.length) {
          yb += '<div class="dossier__sub">Strengths</div>'
            + y.strengths.map(function (s) { return '<div class="dossier__strength">' + esc(s) + "</div>"; }).join("");
        }
        if (y.evidence && y.evidence.length) {
          yb += y.evidence.map(function (e) {
            return '<div class="dossier__evidence"><span class="dossier__from">Evidence · from your '
              + esc(e.sourceType) + "</span>&ldquo;" + esc(e.snippet) + "&rdquo;</div>";
          }).join("");
        }
        if (y.gaps && y.gaps.length) {
          yb += '<div class="dossier__sub">Gaps</div>' + y.gaps.map(function (g) {
            return '<div class="dossier__gap"><span class="dossier__sev dossier__sev--' + esc(g.severity) + '">'
              + esc(g.severity === "medium" ? "med" : g.severity) + "</span><span>" + esc(g.gap)
              + (g.why ? '<span class="dossier__why">' + esc(g.why) + "</span>" : "") + "</span></div>";
          }).join("");
        }
        if (y.dimensions && y.dimensions.length) {
          yb += '<div class="dossier__sub">Scorecard dimensions</div><div class="dossier__dims">'
            + y.dimensions.map(function (d) {
              return '<div class="dossier__dim"><span class="dossier__dim-k">' + esc(d.label) + "</span>"
                + '<span class="dossier__bar"><i style="width:' + Number(d.score) + '%"></i></span>'
                + "<b>" + esc(d.score) + "</b></div>";
            }).join("") + "</div>";
        }
        if (y.storedAt) yb += '<div class="dossier__stamp">Scored ' + esc(y.storedAt) + "</div>";
      }
      out += section("you", "You have", "dsr-you", y.tag || "", yb) + anno(8);
    }

    /* Say this */
    if (c.points && c.points.length) {
      out += section("say", "Say this", "dsr-say", src("ai"),
        '<ul class="dossier__points">' + c.points.map(function (p) {
          return '<li class="dossier__point"><span>' + esc(p) + "</span></li>";
        }).join("") + "</ul>");
    }

    /* Notes */
    out += '<section class="dossier__section" aria-labelledby="dsr-notes">'
      + '<h3 class="dossier__vh" id="dsr-notes">Your notes</h3>'
      + '<div class="dossier__notes"><textarea data-action="notes"'
      + ' placeholder="Interview prep, recruiter name, links you\u2019ve gathered, next steps\u2026">'
      + esc(c.notes || "") + "</textarea></div></section>";

    return '<div class="dossier__canvas">' + out + "</div>";
  }

  /* ---------------- 4b · LEDGER ---------------- */
  function renderDocRow(d) {
    var mod = d.state === "drafting" ? " dossier__doc--drafting"
      : (d.state === "failed" ? " dossier__doc--failed" : "");
    var meta;
    if (d.state === "drafting") {
      meta = '<span class="dossier__progress" role="status" aria-live="polite">'
        + '<span class="dossier__progress-k">' + esc(d.phase) + " · " + esc(d.elapsed)
        + (d.attempt > 1 ? " · retry " + esc(d.attempt) : "") + "</span>"
        + '<span class="dossier__progress-msg">' + esc(d.message) + "</span>"
        + '<span class="dossier__progress-track" aria-hidden="true"><i></i></span>'
      + "</span>";
    } else {
      meta = '<span class="dossier__doc-meta">' + esc(d.meta || "")
        + (d.detail ? "<em>" + esc(d.detail) + "</em>" : "") + "</span>";
    }
    var acts = (d.actions || []).map(function (a) {
      var cls = "dossier__doc-btn" + (a.primary ? " dossier__doc-btn--primary" : "");
      return a.href
        ? '<a class="' + cls + '" href="' + attr(a.href) + '" data-action="' + attr(a.action) + '">'
          + esc(a.label) + "</a>"
        : '<button type="button" class="' + cls + '" data-action="' + attr(a.action) + '"'
          + (a.feature ? ' data-feature="' + attr(a.feature) + '"' : "") + ">" + esc(a.label) + "</button>";
    }).join("");

    return '<div class="dossier__doc' + mod + '" data-doc="' + attr(d.type) + '">'
      + '<span class="dossier__doc-name">' + esc(d.label) + "</span>"
      + '<span class="dossier__doc-state dossier__doc-state--' + esc(d.state) + '">'
        + esc(d.stateWord) + "</span>"
      + meta
      + (acts ? '<div class="dossier__doc-actions">' + acts + "</div>" : "")
    + "</div>";
  }

  function renderLedger(m) {
    var l = m.ledger;
    var out = "";

    out += section("materials", "Materials", "dsr-materials", src("files"),
      '<div class="dossier__docs">' + l.docs.map(renderDocRow).join("") + "</div>") + anno(9);

    var p = l.people;
    var rows = ""
      + '<div class="dossier__row"><dt>Contact</dt><dd>'
        + '<input type="text" data-action="edit-field" data-field="contact" value="' + attr(p.contact) + '"'
        + ' aria-label="Contact"></dd></div>'
      + '<div class="dossier__row"><dt>Last contact</dt><dd>'
        + '<input type="text" data-action="edit-field" data-field="heardBack" value="' + attr(p.lastContactAt) + '"'
        + ' aria-label="Last contact"></dd></div>'
      + '<div class="dossier__row"><dt>Replied<span class="dossier__saved" data-saved="reply"></span></dt><dd>'
        + '<span class="dossier__seg" role="group" aria-label="Replied">'
        + ["Yes", "No", "Unknown"].map(function (v) {
          var on = v === p.replied;
          return '<button type="button" class="dossier__seg-b' + (on ? " dossier__seg-b--on" : "") + '"'
            + ' data-action="edit-field" data-field="reply" data-value="' + attr(v) + '"'
            + ' aria-pressed="' + (on ? "true" : "false") + '">' + esc(v) + "</button>";
        }).join("") + "</span></dd></div>"
      + '<div class="dossier__row"><dt>Follow-up</dt><dd>'
        + '<input type="date" data-action="edit-field" data-field="followupAt" value="' + attr(p.followUpAt) + '"'
        + ' aria-label="Follow-up date"></dd></div>';

    out += section("people", "People", "dsr-people", src("sheet"),
      '<p class="dossier__move"><span class="dossier__move-k">Next move</span>'
      + '<span class="dossier__move-v">' + esc(p.nextMove) + "</span></p>"
      + '<dl class="dossier__rows">' + rows + "</dl>") + anno(10);

    out += section("record", "The record", "dsr-record", src("sheet") + src("files"),
      '<div class="dossier__record">' + l.record.map(function (e) {
        return '<div class="dossier__event dossier__event--' + esc(e.state) + '">'
          + '<span class="dossier__event-dot" aria-hidden="true"></span>'
          + '<span class="dossier__event-d">' + esc(e.at || "—") + "</span>"
          + '<span class="dossier__event-t">' + esc(e.label)
            + (e.detail ? "<small>" + esc(e.detail) + "</small>" : "") + "</span>"
        + "</div>";
      }).join("") + "</div>"
      + (l.freshness ? '<div class="dossier__stamp">' + esc(l.freshness) + "</div>" : "")) + anno(11);

    return '<aside class="dossier__ledger" aria-label="Role ledger">' + out + "</aside>";
  }

  /* ---------------- top level ---------------- */
  function render(mount, m) {
    if (!mount || !m) return;
    mount.innerHTML = '<div class="dossier" data-stage="' + attr(m.stage.current) + '">'
      + renderMasthead(m)
      + renderVerdict(m)
      + renderDocket(m)
      + renderBanner(m.banner)
      + '<div class="dossier__body">' + renderCanvas(m) + renderLedger(m) + "</div>"
    + "</div>";
    return mount.firstChild;
  }

  root.JobBoredDossierMock = { render: render, renderDocRow: renderDocRow };
})(typeof window !== "undefined" ? window : globalThis);
