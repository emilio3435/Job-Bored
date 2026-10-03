/* ============================================================
   scribe-v2.js — Scribe v2, the materials edit desk (EDITOR F1)
   ------------------------------------------------------------
   Spec:    docs/programs/editor-20260927/SPEC.md §1, §2, §4
   Mockup:  docs/programs/editor-20260927/mockup/index.html
   Network: scribe-v2-api.js (window.JBScribeApi) only.

   Lifecycle. Scribe is ABSENT until a role's Edit button opens it
   (SPEC §1): role-materials.js calls JB_SCRIBE_V2.open({slug, doc,
   base, opener, …}), which appends one <jb-scribe> to <body> and
   opens the sheet. close() removes that node entirely and returns
   focus to the Edit button, so a signed-in user without a package
   never has a Scribe node in the DOM (recon R1, R2).

   The desk is built with createElement/textContent only. Nothing
   the server or the user wrote is ever parsed as HTML in the page;
   the rendered document lives in a script-less sandboxed srcdoc
   iframe (SPEC §0 D4, proven by tests/e2e-smoke/scribe-csp-srcdoc).

   Region comments mark where lane F2 (proposal marks, diff and
   keyboard review) and lane F3 (versions compare, View, Restore)
   add their sections. Keep them stable.

   Publishes: window.JB_SCRIBE_V2 = { open, close, isOpen, current,
   boot, closeAll }.
   Events (window): jb:scribe:opened {slug, doc},
                    jb:scribe:closed {slug, doc, reason}.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var DOC_LABEL = { resume: "Resume", cover_letter: "Cover letter" };
  var DOC_NOUN = { resume: "resume", cover_letter: "cover letter" };
  var DOC_ORDER = ["resume", "cover_letter"];
  var STAGES = [
    { key: "reading", label: function (doc) { return "Reading " + DOC_NOUN[doc]; } },
    { key: "drafting", label: function () { return "Drafting edits"; } },
    { key: "checking facts", label: function () { return "Checking facts"; } },
    { key: "checking", label: function (doc, s) { return "Checking facts" + (s && s.total ? " (" + (s.done || 0) + "/" + s.total + ")" : ""); } },
    { key: "measuring", label: function () { return "Measuring length"; } },
    { key: "ready", label: function () { return "Ready"; } },
  ];
  var CHIPS = ["Punchier", "Shorter", "Fit to 1 page", "Match JD keywords", "Quantify", "More formal"];
  var FAMILY_LABEL = { signal: "Signal", dossier: "Dossier", editorial: "Editorial" };
  var LOCK_PATH = "M5 7V5a3 3 0 1 1 6 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1Zm1.5 0h3V5a1.5 1.5 0 1 0-3 0v2Z";
  var SVG_NS = "http://www.w3.org/2000/svg";

  var active = null;
  var idSeq = 0;

  /* ---------------- DOM helpers ---------------- */

  function doc() { return root.document; }

  function h(tag, attrs, kids) {
    var el = doc().createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "text") el.textContent = String(v);
        else if (k === "class") el.className = v;
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid == null || kid === false) return;
      el.appendChild(typeof kid === "string" ? doc().createTextNode(kid) : kid);
    });
    return el;
  }

  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function lockIcon() {
    var d = doc();
    if (typeof d.createElementNS !== "function") return h("span", { class: "scribe__lock-icon", "aria-hidden": "true" });
    var svg = d.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "scribe__lock-icon");
    var path = d.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", LOCK_PATH);
    svg.appendChild(path);
    return svg;
  }

  function within(ancestor, node) {
    for (var n = node; n; n = n.parentNode) if (n === ancestor) return true;
    return false;
  }

  function isTextField(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    return tag === "textarea" || tag === "input" || tag === "select" || el.isContentEditable === true;
  }

  function announce(message, assertive) {
    var a11y = root.JobBoredA11y;
    if (a11y && a11y.live && typeof a11y.live.announce === "function") {
      try { a11y.live.announce(message, assertive ? { politeness: "assertive" } : undefined); return; } catch (e) { /* fall back */ }
    }
    if (active && active.refs.announcer) {
      active.refs.announcer.textContent = "";
      active.refs.announcer.textContent = message;
    }
  }

  function emit(name, detail) {
    var Ctor = root.CustomEvent;
    if (typeof Ctor !== "function" || typeof root.dispatchEvent !== "function") return;
    root.dispatchEvent(new Ctor(name, { detail: detail }));
  }

  /* ---------------- Formatting ---------------- */

  function plural(n, word) {
    return n + " " + word + (n === 1 ? "" : "s");
  }

  function relativeTime(iso, now) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return "";
    var diff = Math.max(0, (now || Date.now()) - t);
    var min = Math.round(diff / 60000);
    if (min < 1) return "Just now";
    if (min < 60) return plural(min, "minute") + " ago";
    var hr = Math.round(min / 60);
    if (hr < 24) return plural(hr, "hour") + " ago";
    if (hr < 48) return "Yesterday";
    var d = new Date(t);
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return months[d.getMonth()] + " " + d.getDate();
  }

  /* What a version row says it is (SPEC §2 Versions). */
  function versionWhat(v) {
    if (v.source === "draft") return { text: "Drafted" };
    if (v.source === "manual") return { text: "Manual edit" };
    if (v.source === "restore") return { text: v.label ? v.label.replace(/^Restored from /, "Brought back from ") : "Brought back" };
    if (v.source === "regenerate") return { text: v.label || "Template changed" };
    if (v.prompt) return { text: v.prompt, quoted: true };
    return { text: v.label || "Edit" };
  }

  function pagesText(n, measured) {
    if (!n) return "";
    return (measured ? "≈" : "") + plural(n, "page");
  }

  /* ---------------- Build ---------------- */

  function build(ctl) {
    var n = ++idSeq;
    var ids = {
      title: "scribe-title-" + n,
      doc: "scribe-doc-" + n,
      chat: "scribe-chat-" + n,
      versions: "scribe-versions-" + n,
      stChat: "scribe-st-chat-" + n,
      stVersions: "scribe-st-versions-" + n,
      prompt: "scribe-prompt-" + n,
    };
    var r = {};

    r.close = h("button", { type: "button", class: "scribe__btn scribe__btn--ghost", "data-scribe": "close", "aria-label": "Close Scribe", text: "Close" });
    r.pages = h("span", { class: "scribe__pill scribe__pill--pages", title: "Measured from the preview; the PDF confirms it on save" });
    r.docTabs = DOC_ORDER.map(function (d) {
      return h("button", { type: "button", role: "tab", id: "scribe-tab-" + d + "-" + n, "data-doc": d, "aria-controls": ids.doc, text: DOC_LABEL[d] });
    });

    var head = h("header", { class: "scribe__head" }, [
      h("div", { class: "scribe__title" }, [
        h("h2", { id: ids.title, text: "Scribe" }),
        h("span", { class: "scribe__role", text: [ctl.opts.title, ctl.opts.company].filter(Boolean).join(" · ") }),
      ]),
      h("div", { class: "scribe__tabs", role: "tablist", "aria-label": "Document", "data-scribe": "doc-tabs" }, r.docTabs),
      h("div", { class: "scribe__group" }, [
        /* HOLES SCORE: this document's grade; it opens the score modal. */
        r.grade = h("span", { class: "scribe__grade", "data-scribe": "grade" }),
        r.pages,
        h("span", { class: "scribe__pill scribe__pill--lock", title: "Employer, title, dates, degree and figures cannot be changed by Scribe" }, [lockIcon(), "Facts locked"]),
      ]),
      /* region:F2-header — Show changes (D) joins this group. */
      /* region:F3-header — Compare (C) joins this group. */
      h("div", { class: "scribe__group scribe__group--tools" }, [
        r.showBtn = h("button", {
          type: "button", class: "scribe__btn scribe__btn--small", "data-scribe": "show-changes", "aria-pressed": "true",
          "aria-keyshortcuts": "D", title: "Show or hide the marks (D)", hidden: true,
        }, ["Show changes ", h("kbd", { class: "scribe__compare-kbd", text: "D" })]),
        r.compareBtn = root.JBScribeVersions ? h("button", {
          type: "button", class: "scribe__btn scribe__btn--small", "data-ver-compare": "", "aria-pressed": "false",
          "aria-keyshortcuts": "C", title: "Compare two versions (C)",
        }, ["Compare ", h("kbd", { class: "scribe__compare-kbd", text: "C" })]) : null,
        r.close,
      ]),
    ]);

    r.segs = ["doc", "chat", "versions"].map(function (s) {
      return h("button", { type: "button", role: "tab", "data-seg": s, text: s === "doc" ? "Doc" : (s === "chat" ? "Chat" : "Versions") });
    });
    var seg = h("div", { class: "scribe__seg", role: "tablist", "aria-label": "View", "data-scribe": "segs" }, r.segs);

    r.stage = h("div", { class: "scribe__stage" });
    r.frame = h("iframe", { class: "scribe__frame", sandbox: "allow-same-origin", title: "Document preview", tabindex: "-1" });
    r.pageBox = h("div", { class: "scribe__page" }, [r.frame]);
    r.docNote = h("p", { class: "scribe__docnote", hidden: true });
    r.docscroll = h("div", { class: "scribe__docscroll", id: ids.doc, role: "region", tabindex: "-1", "aria-busy": "true" }, [r.docNote, r.pageBox]);
    /* region:F2-marks — proposal marks and the margin rail render over
       the preview here, keyed by data-node inside the iframe. */
    /* The page and its margin rail sit side by side: the marks live in
       the frame, the controls in the rail beside each changed block. */
    r.rail = h("div", { class: "scribe__rail", role: "group", "aria-label": "Changes", hidden: true });
    r.paper = h("div", { class: "scribe__paper" });
    r.docscroll.removeChild(r.pageBox);
    r.paper.appendChild(r.pageBox);
    r.paper.appendChild(r.rail);
    r.docscroll.appendChild(r.paper);
    r.reviewbar = h("div", { class: "scribe__reviewbar" });

    var docpane = h("section", { class: "scribe__docpane", "aria-label": "Document" }, [r.stage, r.docscroll, r.reviewbar]);

    r.sideTabs = [
      h("button", { type: "button", role: "tab", id: ids.stChat, "data-side": "chat", "aria-controls": ids.chat, text: "Chat" }),
      h("button", { type: "button", role: "tab", id: ids.stVersions, "data-side": "versions", "aria-controls": ids.versions, text: "Versions" }),
    ];
    /* role=log without aria-live: announce() is the one live region
       (SPEC §4), so a result is spoken once, not twice. */
    r.log = h("div", { class: "scribe__log", role: "log", "aria-label": "Conversation with Scribe" });
    r.chatPanel = h("div", { class: "scribe__panel", id: ids.chat, role: "tabpanel", "aria-labelledby": ids.stChat }, [r.log]);
    r.versions = h("ol", { class: "scribe__versions" });
    r.versionsPanel = h("div", { class: "scribe__panel", id: ids.versions, role: "tabpanel", "aria-labelledby": ids.stVersions, hidden: true }, [
      r.versions,
      /* region:F3-versions — View, Compare with current and Restore as new
         attach to each row; the compare pane lives under .scribe__compare
         (scribe-v2-versions.js adds it to the document pane). */
    ]);

    r.recover = h("div", { class: "scribe__recover", role: "group", "aria-label": "Unfinished request", hidden: true });
    r.statusText = h("span");
    r.statusAction = h("button", { type: "button", class: "scribe__btn scribe__btn--small scribe__status-action", hidden: true });
    r.status = h("div", { class: "scribe__status", role: "status", "data-state": "idle", hidden: true }, [r.statusText, r.statusAction]);
    r.unsaved = h("div", { class: "scribe__unsaved", role: "alertdialog", "aria-label": "Unsaved text", hidden: true });
    r.clearScope = h("button", { type: "button", "data-action": "clear-scope", "aria-label": "Use whole document", text: "×", hidden: true });
    r.scope = h("div", { class: "scribe__scope" });
    r.scope.style.flexWrap = "wrap";
    r.manualState = h("span", { class: "scribe__manual-state", role: "status", hidden: true });
    r.selectionActions = h("div", { class: "scribe__selection-actions", role: "toolbar", "aria-label": "Selected text", hidden: true },
      [["rewrite", "Rewrite"], ["shorten", "Shorten"], ["emphasize", "Emphasize"], ["ask", "Ask…"], ["edit", "Edit text"]].map(function (item) {
        var button = h("button", { type: "button", class: "scribe__btn scribe__btn--small", "data-selection": item[0], text: item[1] });
        if (ctl.isNarrow()) { button.style.minHeight = "45px"; button.style.minWidth = "44px"; }
        return button;
      }));
    r.docscroll.style.position = "relative";
    r.docscroll.appendChild(r.selectionActions);
    r.chips = h("div", { class: "scribe__chips", role: "group", "aria-label": "Quick requests" }, CHIPS.map(function (c) {
      return h("button", { type: "button", class: "scribe__chip", "data-chip": c, text: c });
    }));
    r.prompt = h("textarea", { id: ids.prompt, rows: "1", maxlength: String(root.JBScribeApi ? root.JBScribeApi.MAX_INSTRUCTION : 2000) });
    r.send = h("button", { type: "submit", class: "scribe__btn scribe__btn--primary", text: "Send" });
    r.composer = h("form", { class: "scribe__composer", autocomplete: "off", novalidate: true }, [
      r.recover,
      r.scope,
      r.chips,
      r.status,
      h("div", { class: "scribe__compose-box" }, [
        h("label", { for: ids.prompt, class: "scribe__sr", text: "Ask Scribe for a change" }),
        r.prompt,
        r.send,
      ]),
      h("p", { class: "scribe__hint" }, [
        h("kbd", { text: "Enter" }), " sends · ",
        h("kbd", { text: "Shift" }), "+", h("kbd", { text: "Enter" }), " new line · ",
        h("kbd", { text: "/" }), " ask · ",
        h("kbd", { text: "Esc" }), " close",
      ]),
    ]);

    var side = h("aside", { class: "scribe__side", "aria-label": "Chat and versions" }, [
      h("div", { class: "scribe__sidetabs", role: "tablist", "aria-label": "Side panel", "data-scribe": "side-tabs" }, r.sideTabs),
      r.chatPanel,
      r.versionsPanel,
      r.composer,
    ]);

    r.announcer = h("div", { class: "scribe__sr", role: "status", "aria-live": "polite" });
    r.sheet = h("div", { class: "scribe__sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": ids.title, "data-seg": "doc" }, [
      head, seg, h("div", { class: "scribe__body" }, [docpane, side]), r.unsaved, r.announcer,
    ]);
    r.scrim = h("div", { class: "scribe__scrim", "data-scribe": "scrim" });
    r.host = h("jb-scribe", { class: "scribe", "data-slug": ctl.opts.slug }, [r.scrim, r.sheet]);
    return r;
  }

  /* ---------------- Render ---------------- */

  function renderTabs(ctl) {
    var r = ctl.refs;
    r.docTabs.forEach(function (b) {
      var on = b.getAttribute("data-doc") === ctl.state.doc;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.setAttribute("tabindex", on ? "0" : "-1");
    });
    r.sideTabs.forEach(function (b) {
      var on = b.getAttribute("data-side") === ctl.state.side;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.setAttribute("tabindex", on ? "0" : "-1");
    });
    r.segs.forEach(function (b) {
      var on = b.getAttribute("data-seg") === ctl.state.seg;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.setAttribute("tabindex", on ? "0" : "-1");
    });
    r.sheet.setAttribute("data-seg", ctl.state.seg);
    if (ctl.state.side === "chat") { r.chatPanel.removeAttribute("hidden"); r.versionsPanel.setAttribute("hidden", ""); }
    else { r.versionsPanel.removeAttribute("hidden"); r.chatPanel.setAttribute("hidden", ""); }
    r.versions.setAttribute("aria-label", DOC_LABEL[ctl.state.doc] + " versions, newest first");
    r.prompt.setAttribute("placeholder", "Ask for a change to your " + DOC_NOUN[ctl.state.doc] + "…");
  }

  function currentVersion(ctl) {
    var list = ctl.state.versions || [];
    for (var i = 0; i < list.length; i++) if (list[i].runId === ctl.state.currentRunId) return list[i];
    return list[0] || null;
  }

  function renderPages(ctl) {
    var v = currentVersion(ctl);
    var text = v && v.pages ? pagesText(v.pages, false) : pagesText(ctl.state.measuredPages, true);
    ctl.refs.pages.textContent = text || "…";
  }

  function renderRegionLabel(ctl) {
    var v = currentVersion(ctl);
    var label = DOC_LABEL[ctl.state.doc] + (v ? ", version " + v.n : "");
    if (ctl.state.proposal && ctl.state.proposal.ops.length) label += ", proposal with " + plural(ctl.state.proposal.ops.length, "change");
    ctl.refs.docscroll.setAttribute("aria-label", label);
    ctl.refs.frame.setAttribute("title", DOC_LABEL[ctl.state.doc] + " preview" + (v ? ", version " + v.n : ""));
  }

  function renderStage(ctl) {
    var el = ctl.refs.stage;
    /* A focused Stop button must not drop focus to <body> when the stage
       line is rebuilt: focus the new Stop, or the composer once the run
       has ended. */
    var focused = doc().activeElement;
    var hadStop = !!(focused && focused.getAttribute && focused.getAttribute("data-scribe") === "stop" && within(el, focused));
    clear(el);
    var st = ctl.state;
    if (st.busy) {
      var idx = -1;
      for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === st.stage) idx = i;
      var list = h("ol", { class: "scribe__stages" });
      STAGES.forEach(function (s, j) {
        /* "checking facts" (the model's check) and "checking" (the
           tally) are one step on the line, not two. */
        if (s.key === "checking facts") return;
        var at = STAGES[idx] && STAGES[idx].key === "checking facts" ? idx + 1 : idx;
        var state = j < at ? "done" : (j === at ? "now" : "todo");
        list.appendChild(h("li", { "data-s": state }, [h("span", { class: "scribe__dot", "aria-hidden": "true" }), s.label(st.doc, j === idx ? st.stageDetail : null)]));
      });
      var now = STAGES[Math.max(0, idx)];
      el.appendChild(h("span", { class: "scribe__stage-short", text: now.label(st.doc, st.stageDetail) }));
      el.appendChild(list);
      var stopping = ctl.request && ctl.request.stopRequested;
      var stopBtn = h("button", { type: "button", class: "scribe__btn scribe__btn--small", "data-scribe": "stop", "aria-label": "Stop and keep changes so far", disabled: stopping, "aria-busy": stopping ? "true" : null, text: stopping ? "Stopping…" : "Stop" });
      el.appendChild(stopBtn);
      if (hadStop) stopBtn.focus();
      return;
    }
    if (hadStop) ctl.refs.prompt.focus();
    var v = currentVersion(ctl);
    if (!v) {
      el.appendChild(h("span", { text: st.loading ? "Loading versions…" : "No saved versions yet." }));
      return;
    }
    el.appendChild(h("span", { class: "scribe__ver-tag", text: "v" + v.n }));
    el.appendChild(h("span", { text: "Current version" + (v.family ? " · " + (FAMILY_LABEL[v.family] || v.family) + " template" : "") }));
  }

  function renderReviewbar(ctl) {
    var el = ctl.refs.reviewbar;
    clear(el);
    var p = ctl.state.proposal;
    /* region:F2-review — once the run ends, an open proposal's review
       (summary, loss meter, Accept all, Reject all, Save) owns the bar. */
    renderRail(ctl);
    if (p && p.changes && p.changes.length && !ctl.state.busy) { renderReview(ctl); return; }
    if (!p || !p.summary) {
      var v = currentVersion(ctl);
      el.appendChild(h("p", { class: "scribe__reviewbar-sum", text: v
        ? "Showing v" + v.n + ", the current version."
        : "Nothing saved yet." }));
      return;
    }
    var s = p.summary;
    var sum = h("p", { class: "scribe__reviewbar-sum" }, [
      h("b", { text: plural(s.changes || 0, "change") }),
      s.removals ? " · " + plural(s.removals, "removal") : "",
      s.unverified ? " · " + s.unverified + " to check" : "",
      s.pages ? " · still " + plural(s.pages, "page") : "",
    ]);
    var acts = h("div", { class: "scribe__reviewbar-acts" }, [
      /* region:F2-review — Accept all, per-change controls and
         "Save as vN (k accepted)" join these actions. */
      h("button", { type: "button", class: "scribe__btn", "data-scribe": "discard", text: "Discard" }),
    ]);
    el.appendChild(sum);
    el.appendChild(acts);
  }

  function renderScope(ctl) {
    var el = ctl.refs.scope;
    clear(el);
    var scope = ctl.scope;
    var text = !scope ? "Whole document" : scope.ids.length === 1
      ? "Selected: " + labelFor({ op: "replace", node: scope.ids[0] }, frameNodes(frameDoc(ctl)))
      : "Selected: " + scope.ids.length + " blocks";
    el.appendChild(h("span", { class: "scribe__pill", text: text }));
    if (scope) ctl.refs.clearScope.removeAttribute("hidden");
    else ctl.refs.clearScope.setAttribute("hidden", "");
    if (ctl.isNarrow()) { ctl.refs.clearScope.style.minWidth = "44px"; ctl.refs.clearScope.style.minHeight = "44px"; }
    el.appendChild(ctl.refs.clearScope);
    if (scope && scope.stale) {
      var warning = h("span", { text: "Your selection changed. Select the text again." });
      warning.style.flexBasis = "100%"; warning.style.minWidth = "0";
      el.appendChild(warning);
    }
  }

  function logMessage(ctl, kind, parts, extra) {
    var msg = h("div", { class: "scribe__msg scribe__msg--" + kind }, parts);
    if (extra) msg.appendChild(extra);
    ctl.refs.log.appendChild(msg);
    if (typeof ctl.refs.chatPanel.scrollTop === "number") ctl.refs.chatPanel.scrollTop = ctl.refs.chatPanel.scrollHeight || 0;
    return msg;
  }

  /* region:F3-versions — scribe-v2-versions.js owns View, Compare and
     Bring back; it attaches once, on the first versions render. */
  function versionsUi(ctl) {
    if (ctl.versionsUi || !root.JBScribeVersions) return ctl.versionsUi || null;
    ctl.versionsUi = root.JBScribeVersions.attach(ctl, {
      h: h,
      announce: announce,
      logMessage: function (kind, parts) { return logMessage(ctl, kind, parts); },
      renderVersions: function () { renderVersions(ctl); },
      setStatus: function (state, text, label, action) { status(ctl, state, text, label, action); },
      notifySaved: function (res, which) { emitSaved(ctl, res && res.run && res.run.runId, which); },
      reload: function (res, keep) { return reloadSaved(ctl, res, keep); },
    });
    return ctl.versionsUi;
  }

  function renderVersions(ctl) {
    var el = ctl.refs.versions;
    var ui = versionsUi(ctl);
    clear(el);
    var list = ctl.state.versions || [];
    if (!list.length) {
      el.appendChild(h("li", { class: "scribe__ver-empty", text: ctl.state.loading ? "Loading versions…" : "No saved versions yet." }));
      if (ui) ui.sync();
      return;
    }
    var byId = {};
    list.forEach(function (v) { byId[v.runId] = v; });
    var now = ctl.now();
    list.forEach(function (v) {
      var what = versionWhat(v);
      var parent = v.parentRunId ? byId[v.parentRunId] : null;
      var meta = [relativeTime(v.createdAt, now)];
      if (parent && typeof v.words === "number" && typeof parent.words === "number") {
        var d = v.words - parent.words;
        meta.push((d >= 0 ? "+" : "−") + Math.abs(d) + " words");
      } else if (typeof v.words === "number") {
        meta.push(plural(v.words, "word"));
      }
      if (v.pages) meta.push(plural(v.pages, "page"));
      if (v.family) meta.push(FAMILY_LABEL[v.family] || v.family);
      var current = v.runId === ctl.state.currentRunId;
      var acts = h("span", { class: "scribe__ver-acts" });
      if (v.pinned) {
        acts.appendChild(h("span", { class: "scribe__ver-pin", text: "Pinned" }));
      } else {
        acts.appendChild(h("button", {
          type: "button", class: "scribe__star", "data-star": v.runId,
          "aria-pressed": v.starred ? "true" : "false",
          "aria-label": (v.starred ? "Unstar" : "Star") + " v" + v.n,
          text: v.starred ? "★" : "☆",
        }));
      }
      /* region:F3-version-actions — View, Compare with current, Restore as new. */
      var f3 = ui ? ui.rowParts(v) : null;
      var metaText = meta.filter(Boolean).join(" · ") + (current ? " · Current" : "");
      el.appendChild(h("li", { class: "scribe__ver", "data-run": v.runId, "aria-current": current ? "true" : null }, [
        h("span", { class: "scribe__ver-n", text: "v" + v.n }),
        h("span", { class: "scribe__ver-what" }, what.quoted ? [h("q", { text: what.text })] : [what.text]),
        h("span", { class: "scribe__ver-meta" }, f3 ? [f3.tag, metaText] : [metaText]),
        acts,
        f3 && f3.acts,
        f3 && f3.confirm,
      ]));
    });
    if (ui) ui.sync();
  }

  /* HOLES SCORE ("Scribe v2 shows no score"): the header carries the
     open document's grade button, from the host's opts.score. */
  function renderScore(ctl) {
    var el = ctl.refs && ctl.refs.grade;
    var score = ctl.opts.score;
    var ms = root.JobBoredMaterialsScore;
    if (!el) return;
    var g = score && typeof score.gradeFor === "function" && ms ? score.gradeFor(ctl.state.doc) : null;
    el.innerHTML = g ? ms.buttonHtml(g.grade, { feature: ctl.state.doc, scope: "scribe", stale: g.stale }) : "";
  }

  /* U12: a save or a Bring back makes a new run; the rows mark this
     document's grade stale until the manifest catches up. */
  function emitSaved(ctl, runId, which) {
    emit("jb:scribe:saved", { slug: ctl.opts.slug, doc: which || ctl.state.doc, runId: String(runId || "") });
  }

  function reloadSaved(ctl, res, keep) {
    clearReview(ctl);
    ctl.state.proposal = null; ctl.openProposal = keep || null; ctl.openProposals = null; ctl.request = null;
    emitSaved(ctl, res && res.run && res.run.runId);
    return loadDoc(ctl);
  }

  function renderAll(ctl) {
    renderScore(ctl);
    renderTabs(ctl);
    renderPages(ctl);
    renderRegionLabel(ctl);
    renderStage(ctl);
    ctl.refs.stage.appendChild(ctl.refs.manualState);
    renderReviewbar(ctl);
    renderScope(ctl);
    renderVersions(ctl);
    renderRecovery(ctl);
    ctl.refs.send.setAttribute("aria-disabled", ctl.state.busy ? "true" : "false");
  }

  /* ---------------- Phone keyboard (SPEC §1: composer pinned to
     visualViewport) ---------------- */

  /* 100dvh does not shrink for the software keyboard. Under 600px the
     sheet takes the visual viewport's height and sits on its bottom edge,
     so the composer stays above the keyboard. */
  function fitViewport(ctl) {
    var sheet = ctl.refs.sheet;
    var vv = root.visualViewport;
    if (!vv || !ctl.isNarrow()) {
      sheet.style.height = "";
      sheet.style.bottom = "";
      return;
    }
    var layoutH = root.innerHeight || vv.height;
    sheet.style.height = Math.round(vv.height) + "px";
    sheet.style.bottom = Math.max(0, Math.round(layoutH - vv.height - (vv.offsetTop || 0))) + "px";
  }

  /* ---------------- Preview (sandboxed srcdoc) ---------------- */

  /* The rendered page is a fixed-width sheet; scale it down to the pane
     so a phone never scrolls sideways (SPEC §4, no horizontal scroll). */
  function fitFrame(ctl) {
    var frame = ctl.refs.frame;
    var inner = null;
    try { inner = frame.contentDocument; } catch (e) { inner = null; }
    if (!inner || !inner.documentElement) return;
    var el = inner.documentElement;
    var natW = Math.max(el.scrollWidth || 0, 1);
    var natH = Math.max(el.scrollHeight || 0, 1);
    /* The margin rail (lane F2) takes its width beside the page. */
    var avail = (ctl.refs.docscroll.clientWidth || natW) - (ctl.refs.rail.hasAttribute("hidden") ? 0 : ctl.refs.rail.offsetWidth || 0);
    var pad = 32;
    var scale = Math.min(1, Math.max(0.2, (avail - pad) / natW));
    frame.style.width = natW + "px";
    frame.style.height = natH + "px";
    frame.style.transform = scale < 1 ? "scale(" + scale + ")" : "";
    ctl.refs.pageBox.style.width = Math.round(natW * scale) + "px";
    ctl.refs.pageBox.style.height = Math.round(natH * scale) + "px";
    var pages = inner.querySelectorAll ? inner.querySelectorAll("[data-page]").length : 0;
    ctl.state.measuredPages = pages || null;
    renderPages(ctl);
    layoutRail(ctl);
  }

  /* A click in the preview moves focus into the iframe's document, where
     the page's key listeners never hear it. Forward Esc and Tab from it. */
  function unwatchFrameKeys(ctl) {
    if (ctl.frameDoc && typeof ctl.frameDoc.removeEventListener === "function") {
      ctl.frameDoc.removeEventListener("keydown", ctl.onFrameKey);
      Object.keys(ctl.frameHandlers || {}).forEach(function (name) { ctl.frameDoc.removeEventListener(name, ctl.frameHandlers[name]); });
      if (ctl.frameDoc.defaultView) ctl.frameDoc.defaultView.removeEventListener("unload", ctl.onFrameUnload);
    }
    ctl.frameDoc = null; ctl.frameHandlers = null;
  }

  function watchFrameKeys(ctl) {
    unwatchFrameKeys(ctl);
    var inner = null;
    try { inner = ctl.refs.frame.contentDocument; } catch (e) { inner = null; }
    if (!inner || typeof inner.addEventListener !== "function") return;
    ctl.frameDoc = inner;
    inner.addEventListener("keydown", ctl.onFrameKey);
    bindCapabilities(ctl, inner);
    ctl.onFrameUnload = function () {
      if (ctl.manual.active) { captureManual(ctl); ctl.manual.active = null; }
      if (ctl.manual.timer) root.clearTimeout(ctl.manual.timer); ctl.manual.timer = null;
      invalidateScope(ctl); unwatchFrameKeys(ctl);
    };
    if (inner.defaultView) inner.defaultView.addEventListener("unload", ctl.onFrameUnload);
  }

  function showPreview(ctl, html) {
    var frame = ctl.refs.frame;
    if (ctl.frameReadyResolve) ctl.frameReadyResolve(false);
    invalidateScope(ctl, true);
    unwatchFrameKeys(ctl);
    ctl.refs.docNote.setAttribute("hidden", "");
    ctl.refs.pageBox.removeAttribute("hidden");
    return new Promise(function (resolve) {
      ctl.frameReadyResolve = resolve;
      frame.onload = function () {
        if (ctl.closed) { resolve(false); return; }
        watchFrameKeys(ctl);
        fitFrame(ctl);
        ctl.refs.docscroll.setAttribute("aria-busy", "false");
        ctl.frameReadyResolve = null;
        resolve(true);
      };
      frame.srcdoc = html;
    });
  }

  function showDocNote(ctl, text, tone) {
    ctl.refs.docNote.textContent = text;
    ctl.refs.docNote.setAttribute("data-tone", tone || "info");
    ctl.refs.docNote.removeAttribute("hidden");
    ctl.refs.pageBox.setAttribute("hidden", "");
    ctl.refs.docscroll.setAttribute("aria-busy", "false");
  }

  /* Parent-owned capabilities. The preview never runs a script. Scope and
     manual drafts are tied to one authoritative document/run in memory. */
  function nodeMap(ctl) {
    var map = Object.create(null);
    (ctl.state.nodes || []).forEach(function (n) {
      var letter = n.kind === "paragraph" || n.kind === "salutation";
      if ((ctl.state.doc === "cover_letter") === letter) map[n.id] = n;
    });
    return map;
  }

  function scopeStamp(ctl) {
    return ctl.state.doc + "|" + ctl.state.currentRunId + "|" + JSON.stringify(ctl.state.model && ctl.state.model.template || null);
  }

  function lockText(node) {
    if (node && node.kind === "credential") return "Degree and school are locked.";
    if (node && node.locked && node.locked.whole) return "Employer, title and dates are locked.";
    return "Figures in this line are locked.";
  }

  function capabilityPaused(ctl) {
    return ctl.closed || ctl.state.loading || ctl.state.busy || ctl.state.proposal || ctl.openProposal ||
      ctl.openProposals && ctl.openProposals.length || ctl.manual.saving || ctl.versionsUi && ctl.versionsUi.isActive();
  }

  function hideSelectionActions(ctl, focus) {
    ctl.refs.selectionActions.setAttribute("hidden", "");
    ctl.refs.selectionActions.style.display = "none";
    if (focus) {
      var target = ctl.scope && ctl.scope.anchor;
      ctl.selectionFocusReturn = true;
      if (target && typeof target.focus === "function") target.focus();
      else ctl.refs.docscroll.focus();
      ctl.selectionFocusReturn = false;
    }
  }

  function invalidateScope(ctl, quiet) {
    if (ctl.scope) { ctl.scope.stale = true; if (!quiet) status(ctl, "selection", "Your selection changed. Select the text again."); }
    var inner = frameDoc(ctl);
    if (inner) Array.prototype.forEach.call(inner.querySelectorAll("[data-scribe-selected]"), function (el) { el.removeAttribute("data-scribe-selected"); });
    hideSelectionActions(ctl);
    renderScope(ctl);
  }

  function clearScope(ctl) {
    ctl.scope = null;
    if (ctl.refs.status.getAttribute("data-state") === "selection") status(ctl, "idle", "");
    var inner = frameDoc(ctl);
    if (inner) Array.prototype.forEach.call(inner.querySelectorAll("[data-scribe-selected]"), function (el) { el.removeAttribute("data-scribe-selected"); });
    hideSelectionActions(ctl);
    renderScope(ctl);
  }

  function scopePayload(ctl) {
    if (!ctl.scope) return "all";
    var s = ctl.scope, map = nodeMap(ctl), rendered = frameNodes(frameDoc(ctl));
    if (s.stale || s.stamp !== scopeStamp(ctl) || !s.ids.length || s.ids.some(function (id) { return !map[id] || !rendered[id]; })) {
      invalidateScope(ctl); return null;
    }
    var locked = s.ids.filter(function (id) { return map[id].locked && map[id].locked.whole; });
    if (locked.length) { status(ctl, "selection", lockText(map[locked[0]])); return null; }
    return s.ids.slice();
  }

  function pickSelection(ctl, event) {
    if (ctl.selectionFocusReturn) return;
    if (capabilityPaused(ctl) || ctl.manual.active) { hideSelectionActions(ctl); return; }
    var inner = frameDoc(ctl), map = nodeMap(ctl), ids = [], range = null;
    var selection = inner && typeof inner.getSelection === "function" && inner.getSelection();
    if (selection && selection.rangeCount && !selection.isCollapsed) {
      range = selection.getRangeAt(0);
      Array.prototype.forEach.call(inner.querySelectorAll("[data-node]"), function (el) {
        var id = el.getAttribute("data-node");
        if (map[id] && range.intersectsNode(el) && ids.indexOf(id) < 0) ids.push(id);
      });
    } else if (event && event.type !== "selectionchange") {
      for (var target = event.target; target && target !== inner; target = target.parentNode) {
        var id = target.getAttribute && target.getAttribute("data-node");
        if (id) { if (map[id]) ids.push(id); break; }
      }
      /* Clicking non-document chrome does not broaden a retained scope. */
      if (!ids.length && !target) return;
    } else return; /* moving to the parent composer retains a valid scope */
    ctl.scope = { ids: ids, stamp: scopeStamp(ctl), stale: !ids.length, anchor: ids.length ? frameNodes(inner)[ids[0]] : null };
    Array.prototype.forEach.call(inner.querySelectorAll("[data-node]"), function (el) {
      if (ids.indexOf(el.getAttribute("data-node")) >= 0) el.setAttribute("data-scribe-selected", "");
      else el.removeAttribute("data-scribe-selected");
    });
    renderScope(ctl);
    if (!ids.length) { invalidateScope(ctl); return; }
    var locked = ids.filter(function (id) { return map[id].locked && map[id].locked.whole; });
    if (locked.length) { hideSelectionActions(ctl); status(ctl, "selection", lockText(map[locked[0]])); return; }
    if (ids.some(function (id) { return map[id].locked && map[id].locked.spans.length; })) status(ctl, "selection", "Figures in this line are locked.");
    var toolbar = ctl.refs.selectionActions;
    var rect = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() :
      ctl.scope.anchor && ctl.scope.anchor.getBoundingClientRect && ctl.scope.anchor.getBoundingClientRect();
    toolbar.removeAttribute("hidden");
    toolbar.style.position = "absolute";
    toolbar.style.maxWidth = "calc(100% - 16px)";
    toolbar.style.display = "flex"; toolbar.style.flexWrap = "wrap"; toolbar.style.gap = "4px";
    if (rect) {
      var hostRect = ctl.refs.docscroll.getBoundingClientRect ? ctl.refs.docscroll.getBoundingClientRect() : { left: 0, top: 0 };
      var frameRect = ctl.refs.frame.getBoundingClientRect ? ctl.refs.frame.getBoundingClientRect() : { left: 0, top: 0 };
      var scale = parseFloat((ctl.refs.frame.style.transform || "").replace(/[^\d.]/g, "")) || 1;
      var width = ctl.refs.docscroll.clientWidth || 300;
      toolbar.style.left = Math.max(8, Math.min(width - (toolbar.offsetWidth || width - 16) - 8, frameRect.left - hostRect.left + rect.left * scale)) + "px";
      toolbar.style.top = Math.max(8, frameRect.top - hostRect.top + rect.bottom * scale + (ctl.refs.docscroll.scrollTop || 0) + 8) + "px";
    }
  }

  function selectionAction(ctl, action) {
    var ids = scopePayload(ctl);
    if (!ids || ids === "all" || capabilityPaused(ctl)) return;
    if (action === "edit") { if (ids.length === 1) beginManual(ctl, ctl.scope.anchor); return; }
    var words = { rewrite: "Rewrite the selected text.", shorten: "Shorten the selected text.", emphasize: "Emphasize the selected text.", ask: "" };
    ctl.refs.prompt.value = words[action] || "";
    hideSelectionActions(ctl); autogrow(ctl);
    if (ctl.isNarrow()) ctl.setSeg("chat");
    ctl.refs.prompt.focus();
  }

  function manualMessage(ctl, state, text, actions) {
    var el = ctl.refs.manualState;
    el.setAttribute("data-state", state); el.removeAttribute("hidden"); clear(el);
    el.appendChild(h("span", { text: text }));
    (actions || []).forEach(function (a) {
      var btn = h("button", { type: "button", class: "scribe__btn scribe__btn--small" + (["retry", "reapply", "confirm", "save"].indexOf(a[0]) >= 0 ? " scribe__btn--primary" : ""), "data-manual": a[0], text: a[1] });
      btn.addEventListener("click", a[2]); el.appendChild(btn);
    });
    if (el.parentNode !== ctl.refs.stage) ctl.refs.stage.appendChild(el);
  }

  function dirtyManual(ctl) { return Object.keys(ctl.manual.drafts).length > 0; }

  function changedRange(before, after) {
    var start = 0, end = before.length, tail = after.length;
    while (start < end && start < tail && before.charAt(start) === after.charAt(start)) start++;
    while (end > start && tail > start && before.charAt(end - 1) === after.charAt(tail - 1)) { end--; tail--; }
    return { start: start, end: end, delta: after.length - before.length };
  }

  function touches(spans, start, end) {
    return spans.some(function (span) { return start === end ? start > span[0] && start < span[1] : start < span[1] && end > span[0]; });
  }

  function captureManual(ctl) {
    var m = ctl.manual, a = m.active;
    if (!a) return;
    var text = String(a.el.textContent || "");
    var diff = changedRange(a.last, text);
    if (touches(a.spans, diff.start, diff.end)) {
      a.el.textContent = a.last;
      manualMessage(ctl, "error", lockText(a.node)); return;
    }
    a.spans = a.spans.map(function (span) { return span[0] >= diff.end ? [span[0] + diff.delta, span[1] + diff.delta] : span; });
    a.last = text;
    if (text === a.node.text) delete m.drafts[a.node.id];
    else {
      var previous = m.drafts[a.node.id];
      m.drafts[a.node.id] = { opId: previous ? previous.opId : "manual-" + (++ctl.manualSeq), op: "replace", node: a.node.id, text: text };
    }
  }

  function finishManual(ctl) {
    var m = ctl.manual;
    if (!m.active) return;
    captureManual(ctl);
    m.active.el.removeAttribute("contenteditable"); m.active.el.removeAttribute("data-scribe-editing");
    m.active = null;
    if (m.timer) root.clearTimeout(m.timer);
    m.timer = null;
    if (dirtyManual(ctl)) m.timer = root.setTimeout(function () { m.timer = null; saveManual(ctl); }, 2000);
    else { m.base = null; m.doc = null; }
  }

  function beginManual(ctl, el) {
    if (!el || capabilityPaused(ctl)) return;
    var map = nodeMap(ctl), id = el.getAttribute && el.getAttribute("data-node"), node = map[id];
    if (!node || el.hasAttribute("hidden") || typeof el.getClientRects === "function" && !el.getClientRects().length ||
        ["statement", "intro", "bullet", "line", "toolkit", "salutation", "paragraph"].indexOf(node.kind) < 0 || node.locked && node.locked.whole) {
      if (node) manualMessage(ctl, "error", lockText(node)); return;
    }
    var m = ctl.manual;
    if (m.active && m.active.el === el) return;
    if (m.active) finishManual(ctl);
    if (m.timer) root.clearTimeout(m.timer); m.timer = null;
    if (m.base && (m.base !== ctl.state.currentRunId || m.doc !== ctl.state.doc)) { manualConflict(ctl); return; }
    m.base = ctl.state.currentRunId; m.doc = ctl.state.doc;
    var text = m.drafts[id] ? m.drafts[id].text : node.text;
    var spans = node.locked && node.locked.spans || [];
    /* Retained drafts may have shifted a metric; recover its ordered offset. */
    var from = 0;
    spans = spans.map(function (span) { var token = node.text.slice(span[0], span[1]); var at = text.indexOf(token, from); from = at + token.length; return [at, from]; });
    el.textContent = text;
    m.active = { el: el, node: node, last: text, spans: spans };
    el.setAttribute("contenteditable", "plaintext-only"); el.setAttribute("data-scribe-editing", "");
    el.setAttribute("tabindex", "0"); hideSelectionActions(ctl); el.focus();
    manualMessage(ctl, "editing", "Editing " + labelFor({ op: "replace", node: id }, frameNodes(frameDoc(ctl))) + ". Saves when you leave the block.");
  }

  function editOffsets(inner, el) {
    var selection = inner.getSelection && inner.getSelection();
    if (!selection || !selection.rangeCount) return null;
    var range = selection.getRangeAt(0);
    if (!within(el, range.startContainer) || !within(el, range.endContainer)) return null;
    var prefix = range.cloneRange(); prefix.selectNodeContents(el); prefix.setEnd(range.startContainer, range.startOffset);
    var start = prefix.toString().length;
    return { range: range, start: start, end: start + range.toString().length };
  }

  function manualBeforeInput(ctl, e) {
    var a = ctl.manual.active;
    if (!a || !within(a.el, e.target)) return;
    if (e.inputType === "insertFromPaste") { e.preventDefault(); return; }
    var allowed = /^(insertText|insertCompositionText|insertLineBreak|insertParagraph|deleteContentBackward|deleteContentForward|deleteByCut|deleteByDrag|historyUndo|historyRedo)$/;
    if (!allowed.test(e.inputType || "")) { e.preventDefault(); return; }
    var offsets = editOffsets(frameDoc(ctl), a.el);
    if (!offsets) { if (a.spans.length) e.preventDefault(); return; }
    var start = offsets.start, end = offsets.end;
    if (start === end && e.inputType === "deleteContentBackward") start--;
    if (start === end && e.inputType === "deleteContentForward") end++;
    if (touches(a.spans, start, end)) { e.preventDefault(); manualMessage(ctl, "error", lockText(a.node)); }
  }

  function manualPaste(ctl, e) {
    var a = ctl.manual.active;
    if (!a || !within(a.el, e.target)) return;
    e.preventDefault();
    var text = e.clipboardData && e.clipboardData.getData("text/plain") || "";
    var offsets = editOffsets(frameDoc(ctl), a.el);
    if (offsets && touches(a.spans, offsets.start, offsets.end)) { manualMessage(ctl, "error", lockText(a.node)); return; }
    if (!offsets && a.spans.length) return;
    if (offsets) {
      var range = offsets.range, inner = frameDoc(ctl), selection = inner.getSelection();
      range.deleteContents(); var inserted = inner.createTextNode(text); range.insertNode(inserted);
      range.setStartAfter(inserted); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    } else a.el.textContent += text;
    captureManual(ctl);
  }

  function manualConflict(ctl) {
    manualMessage(ctl, "conflict", "A newer version exists. Your text is kept.", [
      ["review", "Review current", function () { ctl.api.listVersions(ctl.state.doc).then(function (listing) {
        ctl.state.versions = listing.versions || []; ctl.state.latestRunId = listing.currentRunId; renderVersions(ctl); reviewCurrent(ctl, true);
      }).catch(function () { manualMessage(ctl, "error", "Not saved. Your text is kept."); }); }],
      ["reapply", "Reapply", function () { reapplyManual(ctl); }],
    ]);
  }

  function reapplyManual(ctl) {
    var m = ctl.manual, generation = ctl.generation;
    if (m.saving || ctl.state.proposal || ctl.openProposal) return;
    ctl.api.listVersions(m.doc).then(function (listing) {
      var run = listing.currentRunId;
      return Promise.all([ctl.api.getModel(run), ctl.api.preview({ doc: m.doc, baseRunId: run })]).then(function (parts) {
        if (ctl.closed || generation !== ctl.generation) return;
        var nodes = parts[0].nodes || [], map = Object.create(null);
        nodes.forEach(function (node) { map[node.id] = node; });
        var invalid = Object.keys(m.drafts).some(function (id) {
          var n = map[id];
          return !n || n.locked.whole || n.locked.spans.some(function (span) { return m.drafts[id].text.indexOf(n.text.slice(span[0], span[1])) < 0; });
        });
        if (invalid) { manualMessage(ctl, "error", "Figures in this line are locked."); return; }
        if (ctl.versionsUi && ctl.versionsUi.isActive()) ctl.versionsUi.exit({ silent: true });
        m.base = run; ctl.state.currentRunId = ctl.state.latestRunId = run; ctl.state.nodes = nodes; ctl.state.model = parts[0].model; ctl.state.versions = listing.versions;
        invalidateScope(ctl);
        showPreview(ctl, parts[1].html).then(function () { renderAll(ctl); manualMessage(ctl, "editing", "Editing " + labelFor({ op: "replace", node: Object.keys(m.drafts)[0] }, frameNodes(frameDoc(ctl))) + ". Saves when you leave the block.", [["save", "Save", function () { saveManual(ctl); }]]); });
      });
    }).catch(function () { manualMessage(ctl, "error", "Not saved. Your text is kept."); });
  }

  function saveManual(ctl, confirmed) {
    var m = ctl.manual;
    if (m.active) finishManual(ctl);
    if (m.timer) root.clearTimeout(m.timer); m.timer = null;
    if (!dirtyManual(ctl)) return Promise.resolve(true);
    if (m.saving || ctl.closed) return Promise.resolve(false);
    if (ctl.state.proposal || ctl.openProposal || ctl.openProposals && ctl.openProposals.length || ctl.state.busy) {
      manualMessage(ctl, "error", "Not saved. Your text is kept."); return Promise.resolve(false);
    }
    var ops = Object.keys(m.drafts).map(function (id) { return m.drafts[id]; });
    var which = m.doc, generation = ctl.generation;
    m.saving = true; hideSelectionActions(ctl);
    manualMessage(ctl, "saving", "Saving…");
    return ctl.api.manualEdit({ doc: which, baseRunId: m.base, manualOps: ops, confirmUnverified: confirmed ? ops.map(function (op) { return op.opId; }) : [] }).then(function (res) {
      m.saving = false; m.drafts = Object.create(null); m.base = null;
      emitSaved(ctl, res && res.run && res.run.runId, which);
      if (ctl.closed || generation !== ctl.generation) return true;
      var n = res.n == null ? res.run && res.run.n : res.n;
      var text = res.textSaved ? "Text saved as v" + n + ". PDF unavailable — it’s rebuilt on your next save." : "Saved as v" + n;
      manualMessage(ctl, "saved", text);
      if (res.textSaved) status(ctl, "saved-pdf-unavailable", text);
      return loadDoc(ctl).then(function () { return true; });
    }).catch(function (err) {
      m.saving = false;
      if (ctl.closed || generation !== ctl.generation) return false;
      if (err && err.code === "stale_base") manualConflict(ctl);
      else if (err && err.code === "unverified_confirmation_required") {
        /* C4 has no fact list. Quote the user's retained replacement rather
           than invent a fact that the server did not identify. */
        manualMessage(ctl, "confirm", "“" + ops[0].text + "” isn’t in your saved facts.", [
          ["confirm", "Save anyway", function () { saveManual(ctl, true); }],
          ["edit", "Edit", function () { beginManual(ctl, frameNodes(frameDoc(ctl))[ops[0].node]); }],
        ]);
      } else if (err && err.code === "locked") manualMessage(ctl, "error", lockText(nodeMap(ctl)[ops[0].node]));
      else {
        manualMessage(ctl, "error", "Not saved. Your text is kept.", [["retry", "Try again", function () { saveManual(ctl); }]]);
        if (err && err.code === "materials_pending") return readOpen(ctl, true).then(function () { return false; });
      }
      return false;
    });
  }

  function discardManual(ctl) {
    var m = ctl.manual;
    if (m.timer) root.clearTimeout(m.timer);
    if (m.active) { m.active.el.removeAttribute("contenteditable"); m.active.el.removeAttribute("data-scribe-editing"); }
    var nodes = nodeMap(ctl), els = frameNodes(frameDoc(ctl));
    Object.keys(m.drafts).forEach(function (id) { if (els[id] && nodes[id]) els[id].textContent = nodes[id].text; });
    m.drafts = Object.create(null); m.active = null; m.base = null; m.timer = null;
    ctl.refs.manualState.setAttribute("hidden", "");
  }

  function guardManualNavigation(ctl, action) {
    if (ctl.manual.active) { captureManual(ctl); finishManual(ctl); }
    if (!dirtyManual(ctl) && !ctl.manual.saving) return action();
    if (ctl.manual.timer) root.clearTimeout(ctl.manual.timer); ctl.manual.timer = null;
    var el = ctl.refs.unsaved; clear(el); el.removeAttribute("hidden");
    el.appendChild(h("span", { text: "You have unsaved text." }));
    [["save", "Save"], ["discard", "Discard"], ["stay", "Stay"]].forEach(function (entry) {
      var btn = h("button", { type: "button", class: "scribe__btn" + (entry[0] === "save" ? " scribe__btn--primary" : ""), "data-unsaved": entry[0], text: entry[1] });
      btn.addEventListener("click", function () {
        if (ctl.manual.saving) return;
        if (entry[0] === "save") saveManual(ctl).then(function (saved) { if (saved) { el.setAttribute("hidden", ""); action(); } });
        else { el.setAttribute("hidden", ""); if (entry[0] === "discard") { discardManual(ctl); action(); } else ctl.refs.prompt.focus(); }
      }); el.appendChild(btn);
    });
    el.querySelector("button").focus(); return false;
  }

  function bindCapabilities(ctl, inner) {
    ensureMarkStyles(inner);
    ctl.frameHandlers = {
      selectionchange: function (e) { pickSelection(ctl, e); },
      focusin: function (e) { pickSelection(ctl, e); },
      pointerup: function (e) { pickSelection(ctl, e); },
      keyup: function (e) { if (!ctl.manual.active && /^(Arrow|Home|End|Page)/.test(e.key || "")) pickSelection(ctl, e); },
      dblclick: function (e) { var el = e.target; while (el && !el.getAttribute("data-node")) el = el.parentElement; beginManual(ctl, el); },
      beforeinput: function (e) { manualBeforeInput(ctl, e); },
      input: function () { captureManual(ctl); },
      paste: function (e) { manualPaste(ctl, e); },
      drop: function (e) { if (ctl.manual.active) e.preventDefault(); },
      focusout: function (e) { if (ctl.manual.active && within(ctl.manual.active.el, e.target) && !within(ctl.manual.active.el, e.relatedTarget)) finishManual(ctl); },
    };
    Object.keys(ctl.frameHandlers).forEach(function (name) { inner.addEventListener(name, ctl.frameHandlers[name]); });
    var els = frameNodes(inner), map = nodeMap(ctl);
    Object.keys(map).forEach(function (id) { if (els[id]) { els[id].setAttribute("tabindex", "0"); if (!ctl.state.proposal && ctl.manual.drafts[id]) els[id].textContent = ctl.manual.drafts[id].text; } });
  }

  /* ---------------- Loading a document ---------------- */

  function status(ctl, state, text, label, action) {
    if (ctl.closed) return;
    var r = ctl.refs;
    r.status.setAttribute("data-state", state);
    r.statusText.textContent = text;
    r.status.removeAttribute("hidden");
    r.statusAction.textContent = label || "";
    ctl.statusAction = action || null;
    if (label) r.statusAction.removeAttribute("hidden");
    else r.statusAction.setAttribute("hidden", "");
  }

  function copy(code) {
    return root.JBScribeApi && root.JBScribeApi.errorCopy ? root.JBScribeApi.errorCopy(code) : "That didn’t work. Try again.";
  }

  function requestCurrent(ctl, request) {
    return !ctl.closed && ctl.request === request && request.generation === ctl.generation && !request.detached;
  }

  function cancelAutoSave(ctl) {
    if (ctl.autoSave) root.clearTimeout(ctl.autoSave);
    ctl.autoSave = null;
  }

  function renderRecovery(ctl) {
    var r = ctl.refs.recover;
    clear(r);
    var rows = ctl.openProposals || (ctl.openProposal ? [ctl.openProposal] : []);
    if (ctl.request && ctl.state.busy) rows = rows.filter(function (p) { return p.proposalId !== ctl.request.proposalId; });
    if (!rows.length) { r.setAttribute("hidden", ""); r.removeAttribute("data-recover-doc"); return; }
    r.removeAttribute("hidden");
    rows.forEach(function (p) {
      var same = p.doc === ctl.state.doc;
      r.setAttribute("data-recover-doc", p.doc);
      var text;
      if (ctl.openProposals) text = DOC_LABEL[p.doc] + " has suggested changes waiting.";
      else if (p.status === "accepting") text = "A save didn’t finish.";
      else if (p.status === "pending") text = "An earlier request didn’t finish.";
      else if (same && p.baseRunId && ctl.state.latestRunId && p.baseRunId !== ctl.state.latestRunId) {
        var base, latest;
        ctl.state.versions.forEach(function (v) { if (v.runId === p.baseRunId) base = v.n; if (v.runId === ctl.state.latestRunId) latest = v.n; });
        text = "These changes were suggested for v" + base + "; v" + latest + " is now current.";
      } else text = same ? "You have " + plural((p.ops || []).length, "suggested change") + " from an earlier request." : "The " + DOC_NOUN[p.doc] + " has suggested changes waiting.";
      var row = h("div", { "data-recover-doc": p.doc }, [h("span", { text: text })]);
      function button(label, action, fn) {
        var el = h("button", { type: "button", class: "scribe__btn scribe__btn--small", "data-action": action, "data-proposal-id": p.proposalId, text: label });
        el.addEventListener("click", fn); row.appendChild(el);
      }
      if (!ctl.openProposals && p.status !== "accepting") {
        if (p.status === "pending") {
          button("Continue", "continue-request", function () { continueRequest(ctl, p); });
          button("Stop", "stop-request", function () { stopRecovered(ctl, p); });
        } else button("Review", "review-request", function () {
          if (!same) ctl.setDoc(p.doc);
          else { if (!ctl.state.proposal) recoverProposal(ctl, p); if (ctl.versionsUi && ctl.versionsUi.isActive()) ctl.versionsUi.exit({ silent: true }); ctl.refs.docscroll.focus(); }
        });
        if (same && p.baseRunId !== ctl.state.latestRunId) button("Review current", "review-current", function () { reviewCurrent(ctl); });
      }
      button("Discard", "discard-request", function () { discard(ctl, p.proposalId); });
      r.appendChild(row);
    });
  }

  function reviewCurrent(ctl, keepDraft) {
    var ui = versionsUi(ctl);
    if (ui) ui.view(ctl.state.latestRunId, ctl.refs.statusAction, keepDraft);
  }

  /* Runs are immutable. Install one exact render without dropping the
     proposal, then wait for its iframe before replaying validated ops. */
  function installExactBase(ctl, runId, which, generation) {
    return Promise.all([ctl.api.listVersions(which), ctl.api.getModel(runId), ctl.api.preview({ doc: which, baseRunId: runId })]).then(function (parts) {
      if (ctl.closed || generation !== ctl.generation || which !== ctl.state.doc) return false;
      clearReview(ctl);
      var st = ctl.state;
      st.versions = parts[0].versions || [];
      st.latestRunId = parts[0].currentRunId;
      st.currentRunId = runId;
      st.model = parts[1].model;
      st.nodes = parts[1].nodes || [];
      st.loading = false;
      renderAll(ctl);
      return showPreview(ctl, String(parts[2].html || ""));
    });
  }

  function recoverProposal(ctl, stored) {
    ctl.openProposal = stored;
    ctl.openProposals = null;
    renderRecovery(ctl);
    if (stored.doc !== ctl.state.doc || stored.status === "accepting") return Promise.resolve();
    if (ctl.state.proposal && ctl.state.proposal.id === stored.proposalId) return Promise.resolve();
    var generation = ctl.generation;
    var p = { id: stored.proposalId, doc: stored.doc, baseRunId: stored.baseRunId, instruction: stored.instruction,
      ops: stored.ops || [], blocked: stored.blocked || [], summary: stored.summary, status: stored.status };
    ctl.state.proposal = p;
    ctl.state.loading = true;
    return installExactBase(ctl, stored.baseRunId, stored.doc, generation).then(function (loaded) {
      if (!loaded || generation !== ctl.generation || ctl.state.proposal !== p) return;
      p.ops.forEach(function (op) { markOp(ctl, op); });
      renderAll(ctl);
      status(ctl, "recovered", "Your earlier accept/reject choices weren’t kept. Review again.");
    }).catch(function () {
      if (generation !== ctl.generation || ctl.closed) return;
      ctl.state.loading = false;
      status(ctl, "error", "The " + DOC_NOUN[stored.doc] + " didn’t load.", "Retry", function () { ctl.state.proposal = null; recoverProposal(ctl, stored); });
      renderAll(ctl);
    });
  }

  function readOpen(ctl, pending) {
    var generation = ctl.generation;
    if (typeof ctl.api.getOpenEdit !== "function") {
      if (pending) status(ctl, "error", copy("materials_pending"));
      return Promise.resolve(null);
    }
    return ctl.api.getOpenEdit().then(function (res) {
      if (ctl.closed || generation !== ctl.generation) return null;
      if (res && res.proposal) return recoverProposal(ctl, res.proposal);
      ctl.openProposal = null; ctl.openProposals = null;
      if (pending) status(ctl, "error", copy("materials_pending"));
      renderRecovery(ctl);
      return null;
    }).catch(function (err) {
      if (ctl.closed || generation !== ctl.generation) return null;
      if (err && err.code === "multiple_open_proposals") {
        ctl.openProposals = err.proposals || []; ctl.openProposal = null; renderRecovery(ctl);
      } else if (pending || err && err.code === "materials_pending") status(ctl, "error", copy("materials_pending"));
      return null; /* an older/offline server must still open the desk */
    });
  }

  function loadDoc(ctl) {
    var st = ctl.state;
    var which = st.doc;
    var token = ++ctl.loadToken;
    cancelAutoSave(ctl);
    invalidateScope(ctl, true);
    unwatchFrameKeys(ctl);
    clearReview(ctl);
    st.nodes = []; st.model = null;
    st.loading = true;
    st.versions = [];
    st.currentRunId = null;
    st.measuredPages = null;
    st.proposal = null;
    ctl.refs.docscroll.setAttribute("aria-busy", "true");
    renderAll(ctl);
    return ctl.api.listVersions(which).then(function (listing) {
      if (token !== ctl.loadToken || ctl.closed) return null;
      st.versions = (listing && listing.versions) || [];
      st.latestRunId = st.currentRunId = listing && listing.currentRunId;
      st.loading = false;
      renderAll(ctl);
      return Promise.all([ctl.api.preview({ doc: which, baseRunId: st.currentRunId }),
        typeof ctl.api.getModel === "function" ? ctl.api.getModel(st.currentRunId) : Promise.resolve({ nodes: [] })]).then(function (parts) {
        if (token !== ctl.loadToken || ctl.closed) return null;
        var res = parts[0]; st.nodes = parts[1].nodes || []; st.model = parts[1].model;
        showPreview(ctl, String((res && res.html) || ""));
        return readOpen(ctl).then(function () { return res; });
      });
    }).catch(function (err) {
      if (token !== ctl.loadToken || ctl.closed) return null;
      st.loading = false;
      renderAll(ctl);
      showDocNote(ctl, (err && err.message) || "The " + DOC_NOUN[which] + " didn’t load.", "error");
      return readOpen(ctl);
    });
  }

  /* ---------------- Asking for a change ---------------- */

  function autogrow(ctl) {
    var ta = ctl.refs.prompt;
    if (!ta.style) return;
    ta.style.height = "auto";
    if (ta.scrollHeight) ta.style.height = Math.min(ta.scrollHeight, 144) + "px";
  }

  function onStreamEvent(ctl, frame) {
    var st = ctl.state;
    var p = st.proposal;
    if (!p || ctl.closed) return;
    var data = frame.data || {};
    if (frame.event === "stage") {
      st.stage = data.stage;
      st.stageDetail = data;
      renderStage(ctl);
      for (var i = 0; i < STAGES.length; i++) {
        if (STAGES[i].key === data.stage) announce(STAGES[i].label(st.doc, data));
      }
    } else if (frame.event === "op" && data.op) {
      if (p.ops.some(function (op) { return op.opId === data.op.opId; })) return;
      p.ops.push(data.op);
      /* region:F2-ops — each validated op becomes a mark in the preview. */
      markOp(ctl, data.op);
    } else if (frame.event === "blocked") {
      p.blocked.push(data);
      var line = blockedLine(data);
      logMessage(ctl, "blocked", [line]);
      if (data.reason !== "locked" && data.reason !== "out_of_scope") {
        p.failure = true;
        errorStatus(ctl, data.reason);
      } else announce(line, true);
    } else if (frame.event === "proposal") {
      p.summary = data.summary || null;
    } else if (frame.event === "error") {
      p.failure = true;
      logMessage(ctl, "blocked", [copy(data.code)]);
      errorStatus(ctl, data.code);
    } else if (frame.event === "done") {
      p.status = data.status || "ready";
    }
  }

  function errorStatus(ctl, code) {
    var settings = code === "llm_unconfigured" || code === "no_pin";
    status(ctl, "error", copy(code), settings ? "Settings" : "Try again", function () {
      if (settings && typeof root.openCommandCenterSettingsModal === "function") root.openCommandCenterSettingsModal({ tab: "ai" });
      else send(ctl);
    });
  }

  function finishRun(ctl) {
    ctl.refs.docscroll.setAttribute("aria-busy", "false");
    var st = ctl.state;
    var p = st.proposal;
    st.busy = false;
    st.stage = null;
    ctl.abort = null;
    if (ctl.request && !ctl.request.detached) ctl.request = null;
    if (p && p.ops.length) ctl.openProposal = { proposalId: p.id, doc: p.doc || st.doc, baseRunId: p.baseRunId || st.currentRunId, ops: p.ops, status: p.status };
    else ctl.openProposal = null;
    if (!p) { renderAll(ctl); return; }
    var s = p.summary;
    var n = p.ops.length;
    if (n) {
      var bits = [plural(n, "change")];
      if (s && s.removals) bits.push(plural(s.removals, "removal"));
      if (s && typeof s.wordsDelta === "number" && s.wordsDelta) bits.push((s.wordsDelta > 0 ? "+" : "−") + Math.abs(s.wordsDelta) + " words");
      if (s && s.pages) bits.push("still " + plural(s.pages, "page"));
      var head = p.status === "partial" ? "Stopped. " + plural(n, "change") + " ready to review." : plural(n, "suggested change");
      logMessage(ctl, "scribe", [h("span", { class: "scribe__hand", text: head }), bits.join(" · ")]);
      announce(head + ". " + bits.join(", ") + ".");
      if (ctl.isNarrow()) ctl.setSeg("doc");
    } else {
      p.summary = null;
      if (p.failure) { if (!ctl.refs.prompt.value) ctl.refs.prompt.value = p.instruction || ""; }
      else logMessage(ctl, "note", [p.status === "partial" ? "Stopped. No changes suggested." : "No changes suggested. Try a more specific request."]);
      st.proposal = null;
    }
    renderAll(ctl);
  }

  function attachStream(ctl, request) {
    var Abort = root.AbortController;
    ctl.abort = typeof Abort === "function" ? new Abort() : null;
    return ctl.api.stream(request.proposalId, {
      signal: ctl.abort ? ctl.abort.signal : undefined,
      onEvent: function (frame) { if (requestCurrent(ctl, request) && !request.stopRequested) onStreamEvent(ctl, frame); },
    }).then(function () {
      if (request.stopRequested) return request.stopReply;
      if (requestCurrent(ctl, request)) finishRun(ctl);
    });
  }

  function requestFailure(ctl, request, err) {
    if (!requestCurrent(ctl, request)) return null;
    ctl.state.busy = false; ctl.state.stage = null; ctl.abort = null;
    ctl.refs.docscroll.setAttribute("aria-busy", "false");
    if (!ctl.refs.prompt.value) ctl.refs.prompt.value = request.instruction || "";
    if (!request.proposalId) { ctl.state.proposal = null; ctl.request = null; }
    if (err && (err.code === "selection_stale" || err.code === "stale_base" && request.scope !== "all")) {
      ctl.state.proposal = null; invalidateScope(ctl); renderAll(ctl); return null;
    }
    if (err && err.code === "materials_pending") { renderAll(ctl); return readOpen(ctl, true); }
    var message = (err && err.message) || "That didn’t work. Try again.";
    var settings = err && (err.code === "llm_unconfigured" || err.code === "no_pin");
    status(ctl, "error", message, settings ? "Settings" : "Try again", function () {
      if (settings && typeof root.openCommandCenterSettingsModal === "function") root.openCommandCenterSettingsModal({ tab: "ai" });
      else if (request.proposalId) readOpen(ctl); else send(ctl);
    });
    logMessage(ctl, "blocked", [message]); renderAll(ctl);
    return null;
  }

  function send(ctl) {
    var st = ctl.state;
    if (st.proposal || ctl.openProposal || ctl.openProposals && ctl.openProposals.length || ctl.request) {
      status(ctl, "recovered", "Review or discard the open changes first. Your new request is kept below.");
      renderRecovery(ctl); return;
    }
    if (st.busy || st.loading || ctl.manual.saving) return;
    if (ctl.versionsUi && ctl.versionsUi.isActive()) { invalidateScope(ctl); return; }
    if (dirtyManual(ctl) || ctl.manual.active) { guardManualNavigation(ctl, function () { send(ctl); }); return; }
    var scope = scopePayload(ctl);
    if (!scope) return;
    var text = String(ctl.refs.prompt.value || "").trim();
    if (!text) { ctl.refs.prompt.focus(); return; }
    var chips = st.chipsUsed.slice();
    ctl.refs.prompt.value = ""; st.chipsUsed = []; autogrow(ctl);
    logMessage(ctl, "you", [text]);
    st.busy = true; st.stage = "reading"; st.stageDetail = null;
    var request = ctl.request = { doc: st.doc, baseRunId: st.currentRunId, proposalId: null,
      instruction: text, scope: scope, stopRequested: false, detached: false, generation: ctl.generation };
    st.proposal = { id: null, doc: request.doc, baseRunId: request.baseRunId, ops: [], blocked: [], summary: null, status: "pending", instruction: text, scope: scope };
    ctl.refs.docscroll.setAttribute("aria-busy", "true"); renderAll(ctl);
    ctl.api.propose({ doc: request.doc, baseRunId: request.baseRunId, instruction: text, scope: scope, lockFacts: true, chips: chips }).then(function (res) {
      request.proposalId = res.proposalId;
      if (request.stopRequested || request.detached || ctl.closed) return stopRequest(ctl, request);
      if (!requestCurrent(ctl, request)) return null;
      st.proposal.id = res.proposalId;
      request.baseRunId = res.rebasedTo || request.baseRunId;
      st.proposal.baseRunId = request.baseRunId;
      ctl.openProposal = { proposalId: res.proposalId, doc: request.doc, baseRunId: request.baseRunId, ops: [], status: "pending" };
      var base = res.rebasedTo ? installExactBase(ctl, res.rebasedTo, request.doc, request.generation) : Promise.resolve(true);
      return base.then(function (loaded) {
        if (!loaded || !requestCurrent(ctl, request)) return null;
        if (request.stopRequested) return stopRequest(ctl, request);
        return attachStream(ctl, request);
      });
    }).catch(function (err) { return requestFailure(ctl, request, err); });
  }

  function stopRequest(ctl, request) {
    if (!request.proposalId) return Promise.resolve();
    if (request.stopReply) return request.stopReply;
    request.stopReply = ctl.api.stopEdit(request.proposalId).then(function (res) {
      if (!requestCurrent(ctl, request)) return null;
      var p = ctl.state.proposal;
      if (!p) return null;
      p.id = request.proposalId; p.status = (res && res.status) || "partial";
      ((res && res.ops) || []).forEach(function (op) {
        if (!p.ops.some(function (known) { return known.opId === op.opId; })) { p.ops.push(op); markOp(ctl, op); }
      });
      if (ctl.abort) ctl.abort.abort();
      finishRun(ctl);
      return res;
    }).catch(function () {
      if (!requestCurrent(ctl, request)) return;
      ctl.state.busy = false; ctl.state.stage = null;
      ctl.openProposal = { proposalId: request.proposalId, doc: request.doc, baseRunId: request.baseRunId, status: "pending", ops: [] };
      status(ctl, "error", "That didn’t work. Try again.", "Try again", function () { request.stopReply = null; stopRequest(ctl, request); });
      renderAll(ctl);
    });
    return request.stopReply;
  }

  function stop(ctl) {
    var request = ctl.request;
    if (!ctl.state.busy || !request) return;
    request.stopRequested = true;
    renderStage(ctl);
    if (request.proposalId) stopRequest(ctl, request);
  }

  function continueRequest(ctl, stored) {
    if (ctl.state.busy || ctl.state.loading) return;
    if (stored.doc !== ctl.state.doc) return guardManualNavigation(ctl, function () {
      return ctl.setDoc(stored.doc).then(function () { continueRequest(ctl, stored); });
    });
    var request = ctl.request = { doc: stored.doc, baseRunId: stored.baseRunId, proposalId: stored.proposalId,
      stopRequested: false, detached: false, generation: ctl.generation };
    ctl.state.loading = true;
    return installExactBase(ctl, stored.baseRunId, stored.doc, request.generation).then(function (loaded) {
      if (!loaded || !requestCurrent(ctl, request)) return;
      ctl.state.proposal.ops = []; ctl.state.proposal.changes = null; ctl.state.proposal.decisions = null;
      ctl.state.busy = true; ctl.state.stage = "reading"; renderAll(ctl);
      return attachStream(ctl, request);
    }).catch(function (err) { ctl.state.loading = false; requestFailure(ctl, request, err); });
  }

  function stopRecovered(ctl, stored) {
    if (stored.doc !== ctl.state.doc) {
      ctl.api.stopEdit(stored.proposalId).then(function () { readOpen(ctl); }).catch(function () { status(ctl, "error", "That didn’t work. Try again."); });
      return;
    }
    var request = ctl.request = { doc: stored.doc, baseRunId: stored.baseRunId, proposalId: stored.proposalId,
      stopRequested: true, detached: false, generation: ctl.generation };
    ctl.state.busy = true; renderStage(ctl); stopRequest(ctl, request);
  }

  function detachRequest(ctl) {
    cancelAutoSave(ctl);
    if (ctl.request) {
      var request = ctl.request;
      request.detached = true; request.stopRequested = true;
      if (request.proposalId) stopRequest(ctl, request);
      ctl.request = null;
    }
    if (ctl.abort) ctl.abort.abort();
    ctl.abort = null; ctl.state.busy = false; ctl.state.stage = null;
    ctl.generation++;
    if (ctl.frameReadyResolve) { ctl.frameReadyResolve(false); ctl.frameReadyResolve = null; }
  }

  function discard(ctl, id) {
    var p = ctl.state.proposal;
    id = id || p && p.id || ctl.openProposal && ctl.openProposal.proposalId;
    if (!id || ctl.discarding || p && p.saving) return Promise.resolve(false);
    ctl.discarding = true;
    return ctl.api.rejectEdit(id).then(function () {
      if (ctl.closed) return false;
      detachRequest(ctl);
      clearReview(ctl);
      ctl.state.proposal = null; ctl.openProposal = null; ctl.openProposals = null; ctl.request = null;
      status(ctl, "idle", "Discarded.");
      logMessage(ctl, "note", ["Discarded."]); renderAll(ctl);
      return loadDoc(ctl);
    }).catch(function (err) {
      if (ctl.closed) return false;
      if (err && err.status === 404) {
        return readOpen(ctl).then(function () { if (!ctl.openProposal && !ctl.openProposals) { clearReview(ctl); ctl.state.proposal = null; ctl.request = null; renderAll(ctl); } });
      }
      status(ctl, "error", "Couldn’t discard. The suggested changes are still open.", "Try again", function () { discard(ctl, id); });
      renderRecovery(ctl); return false;
    }).finally(function () { ctl.discarding = false; });
  }

  /* ---------------- Review (lane F2) ----------------
     Each validated op becomes a suggesting-mode mark on the real render:
     scribe-v2-diff.js rewrites the block the template names with
     data-node, inside the script-less frame. The controls live in the
     page's margin rail (≥600px) or a change card (<600px), and in the
     review bar. Nothing reaches disk until Save (SPEC §2). */

  var AUTO_SAVE_MS = 3000;
  var FRAME_REVIEW_KEYS = { j: 1, k: 1, a: 1, r: 1, A: 1, d: 1, D: 1 };
  var LOSS_BANNER_PCT = 20;
  var KIND_NAME = { stmt: "summary", intro: "intro", seat: "role title", line: "earlier role", cred: "education", sal: "greeting" };
  var DEFAULT_NOTE = { replace: "rewrite", insert: "new line", remove: "removal" };

  function differ() { return root.JBScribeDiff || null; }

  function frameDoc(ctl) {
    try { return ctl.refs.frame.contentDocument || null; } catch (e) { return null; }
  }

  function tokenValue(name, fallback) {
    try {
      var v = root.getComputedStyle(doc().documentElement).getPropertyValue(name);
      return String(v || "").trim() || fallback;
    } catch (e) { return fallback; }
  }

  /* Every block the render names, by id, in reading order. A block the
     family doesn't render (intro in Signal and Dossier) is simply absent. */
  function frameNodes(inner) {
    var map = {};
    if (!inner || typeof inner.querySelectorAll !== "function") return map;
    var list = inner.querySelectorAll("[data-node]");
    for (var i = 0; i < list.length; i++) map[list[i].getAttribute("data-node")] = list[i];
    return map;
  }

  function insertAfter(ref, el) {
    var parent = ref.parentNode;
    if (!parent) return;
    if (typeof parent.insertBefore === "function") { parent.insertBefore(el, ref.nextSibling); return; }
    var kids = Array.prototype.slice.call(parent.children || []);
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    kids.forEach(function (k) { parent.appendChild(k); if (k === ref) parent.appendChild(el); });
  }

  function stub(inner, text) {
    var s = inner.createElement("span");
    s.className = "scribe-stub";
    s.textContent = text;
    return s;
  }

  function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* A name a reader recognises: "summary", "bullet 2, Operations
     Analyst", "new bullet, Coordinator", "paragraph 3". */
  function labelFor(op, nodes) {
    var insert = op.op === "insert";
    var id = String((insert ? op.after : op.node) || "");
    var bits = id.split(":");
    var ids = Object.keys(nodes);
    function ordinal(prefix) {
      var list = ids.filter(function (k) { return k.indexOf(prefix) === 0; });
      var at = list.indexOf(id);
      return at >= 0 ? at + 1 : null;
    }
    if (bits[0] === "b") {
      var seatEl = nodes["seat:" + bits[1]];
      var seat = seatEl ? String(seatEl.textContent || "").trim() : bits[1];
      if (insert) return "new bullet, " + seat;
      var nb = ordinal("b:" + bits[1] + ":");
      return "bullet" + (nb ? " " + nb : "") + ", " + seat;
    }
    if (bits[0] === "p") {
      if (insert) return "new paragraph";
      var np = ordinal("p:");
      return "paragraph" + (np ? " " + np : "");
    }
    if (bits[0] === "tool") return "toolkit, " + bits.slice(1).join(":");
    if (insert) return "new line";
    return KIND_NAME[bits[0]] || "block";
  }

  function ensureMarkStyles(inner) {
    if (!inner || !inner.head || typeof inner.getElementById !== "function" || inner.getElementById("scribe-marks")) return;
    var style = inner.createElement("style");
    style.id = "scribe-marks";
    style.textContent = differ().markStyles(tokenValue);
    inner.head.appendChild(style);
  }

  function setMarkState(change, state) {
    if (change.el) change.el.setAttribute("data-scribe-state", state);
  }

  /* One op → one mark (region:F2-ops). */
  function markOp(ctl, op) {
    var p = ctl.state.proposal;
    var D = differ();
    if (!p || !D || !op || !op.opId) return;
    if (!p.changes) {
      p.changes = [];
      p.decisions = {};
      p.focus = -1;
      p.baseWords = baseWords(ctl);
    }
    if (p.decisions[op.opId]) return;
    var inner = frameDoc(ctl);
    var nodes = frameNodes(inner);
    var target = op.op === "insert" ? nodes[op.after] : nodes[op.node];
    var change = D.changesFromOps([op], function (id) { return nodes[id] ? nodes[id].textContent : ""; })[0];
    change.label = labelFor(op, nodes);
    change.el = null;
    change.anchor = null;
    if (!target && change.kind !== "insert") change.delta = 0; /* its words aren't on this page */
    if (target) {
      ensureMarkStyles(inner);
      if (change.kind === "insert") {
        var el;
        if (typeof target.cloneNode === "function") el = target.cloneNode(true);
        else { el = inner.createElement(target.tagName); if (target.getAttribute("class")) el.setAttribute("class", target.getAttribute("class")); }
        ["data-node", "data-claim", "id"].forEach(function (a) { el.removeAttribute(a); });
        D.unmarkElement(el); /* the neighbour may already carry its own marks */
        insertAfter(target, el);
        D.markInserted(el, change.after);
        el.appendChild(stub(inner, "New line rejected"));
        change.el = el;
      } else if (target.hasAttribute("data-scribe-op")) {
        change.anchor = target; /* a second op on one block: listed, marked once */
      } else {
        D.markElement(target, change.parts);
        if (change.kind === "remove") target.appendChild(stub(inner, "Removed"));
        change.el = target;
      }
      if (change.el) {
        change.el.setAttribute("data-scribe-op", change.kind);
        change.el.setAttribute("data-scribe-id", op.opId);
        change.el.setAttribute("data-scribe-state", "pending");
        if (change.unverified) change.el.setAttribute("data-scribe-flag", "unverified");
        change.anchor = change.el;
      }
    }
    p.decisions[op.opId] = "pending";
    p.changes.push(change);
    orderChanges(p, inner);
    fitFrame(ctl);
    renderRail(ctl); /* notes join as ops arrive; controls wait for the run to end */
  }

  /* j/k walk the changes in reading order; a change whose block isn't
     on this page comes first, as its rail note does. */
  function orderChanges(p, inner) {
    var rank = {};
    if (inner && typeof inner.querySelectorAll === "function") {
      var marked = inner.querySelectorAll("[data-scribe-op]");
      for (var i = 0; i < marked.length; i++) rank[marked[i].getAttribute("data-scribe-id")] = i;
    }
    var focused = p.focus >= 0 ? p.changes[p.focus] : null;
    p.changes.forEach(function (c, i) {
      var at = c.el ? rank[c.opId] : null;
      if (at == null && c.anchor) at = rank[c.anchor.getAttribute("data-scribe-id")] + 0.5;
      c.rank = at == null ? -1 : at;
      c.seq = i;
    });
    p.changes.sort(function (a, b) { return a.rank - b.rank || a.seq - b.seq; });
    if (focused) p.focus = p.changes.indexOf(focused);
  }

  function baseWords(ctl) {
    var v = currentVersion(ctl);
    if (v && typeof v.words === "number" && v.words > 0) return v.words;
    var inner = frameDoc(ctl);
    return inner && inner.body ? differ().wordCount(inner.body.textContent) : 0;
  }

  function reviewSummary(ctl) {
    var p = ctl.state.proposal;
    var s = differ().summarize(p.changes, p.decisions, p.baseWords);
    var v = currentVersion(ctl);
    s.pages = (p.summary && p.summary.pages) || (v && v.pages) || ctl.state.measuredPages || null;
    return s;
  }

  function nextVersionN(ctl) {
    var max = -1;
    (ctl.state.versions || []).forEach(function (v) { if (typeof v.n === "number" && v.n > max) max = v.n; });
    return max + 1;
  }

  function stateWord(p, c) {
    var st = p.decisions[c.opId] || "pending";
    return st + (st === "pending" && c.unverified ? ", unverified" : "");
  }

  function changeName(p, c) {
    return "change " + (p.changes.indexOf(c) + 1) + " of " + p.changes.length + ": " + c.label;
  }

  function flagText(c) {
    var facts = (c.op.facts || []).filter(function (f) { return !/^claimId:/.test(f); });
    return "Not in your saved facts — confirm before accepting." + (facts.length ? " " + facts[0] : "");
  }

  /* The margin rail: one note per change, beside its block. */
  function renderRail(ctl) {
    var r = ctl.refs;
    var p = ctl.state.proposal;
    var on = !!(p && p.changes && p.changes.length);
    var was = !r.rail.hasAttribute("hidden");
    clear(r.rail);
    if (on) r.rail.removeAttribute("hidden"); else r.rail.setAttribute("hidden", "");
    if (on) r.showBtn.removeAttribute("hidden"); else r.showBtn.setAttribute("hidden", "");
    r.showBtn.setAttribute("aria-pressed", ctl.state.showChanges === false ? "false" : "true");
    if (!on) { if (was) fitFrame(ctl); return; }
    p.changes.forEach(function (c, i) {
      var st = p.decisions[c.opId] || "pending";
      var name = changeName(p, c);
      var item = h("div", {
        class: "scribe__mm", "data-op": c.opId, "data-state": st, "data-flag": c.unverified ? "unverified" : null,
        "data-focus": i === p.focus ? "true" : null, tabindex: "-1", role: "group",
        "aria-label": capital(name) + ", " + stateWord(p, c),
      }, [
        h("span", { class: "scribe__mm-glyph", "data-g": c.glyph, "aria-hidden": "true", text: c.glyph }),
        h("span", { class: "scribe__mm-note", text: c.op.rationale || DEFAULT_NOTE[c.kind] }),
      ]);
      if (!ctl.state.busy) item.appendChild(decisionControls(p, c, name, "scribe__mm"));
      if (st === "pending" && c.unverified) item.appendChild(h("p", { class: "scribe__mm-flag", text: flagText(c) }));
      if (!c.anchor) item.appendChild(h("p", { class: "scribe__mm-missing", text: capital(c.label) + " isn’t shown in this template." }));
      r.rail.appendChild(item);
    });
    if (!was) fitFrame(ctl); else layoutRail(ctl);
  }

  /* ✓ / ✗ in the rail; the phone's card has room to spell them out. */
  function decisionControls(p, c, name, cls) {
    var words = cls === "scribe__card";
    var st = p.decisions[c.opId] || "pending";
    if (st !== "pending") {
      return h("span", { class: cls + "-done" }, [
        st === "accepted" ? "Accepted" : "Rejected",
        h("button", { type: "button", class: "scribe__btn scribe__btn--small scribe__btn--ghost", "data-review": "undo", "data-op": c.opId, "aria-label": "Undo decision on " + name, text: "Undo" }),
      ]);
    }
    return h("span", { class: cls + "-acts" }, [
      h("button", {
        type: "button", class: "scribe__btn scribe__btn--small scribe__ok", "data-review": "accept", "data-op": c.opId,
        "aria-label": (c.unverified ? "Confirm and accept " : "Accept ") + name, text: c.unverified ? "Confirm" : (words ? "✓ Accept" : "✓"),
      }),
      h("button", { type: "button", class: "scribe__btn scribe__btn--small scribe__no", "data-review": "reject", "data-op": c.opId, "aria-label": "Reject " + name, text: words ? "✗ Reject" : "✗" }),
    ]);
  }

  /* Place each note level with its block (the frame is scaled into the
     pane), pushing a note down when the one above would overlap. */
  function layoutRail(ctl) {
    var r = ctl.refs;
    var p = ctl.state.proposal;
    if (!p || !p.changes || r.rail.hasAttribute("hidden")) return;
    var scale = parseFloat(r.pageBox.style.width) / parseFloat(r.frame.style.width);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var items = r.rail.children || [];
    var floor = 0;
    for (var i = 0; i < items.length; i++) {
      var c = p.changes[i];
      var top = 0;
      if (c && c.anchor && typeof c.anchor.getBoundingClientRect === "function") top = c.anchor.getBoundingClientRect().top * scale;
      top = Math.max(top, floor);
      items[i].style.top = Math.round(top) + "px";
      floor = top + (items[i].offsetHeight || 0) + 6;
    }
    r.rail.style.minHeight = Math.round(Math.max(floor, parseFloat(r.pageBox.style.height) || 0)) + "px";
  }

  /* The review bar: summary, loss meter, bulk actions and Save. */
  function renderReview(ctl) {
    var el = ctl.refs.reviewbar;
    var p = ctl.state.proposal;
    var s = reviewSummary(ctl);
    var decided = s.accepted + s.rejected > 0;
    var noun = DOC_NOUN[ctl.state.doc];
    if (s.lossPct > LOSS_BANNER_PCT) {
      el.appendChild(h("p", { class: "scribe__loss-banner", text: "This removes " + s.lossPct + "% of your " + noun + ". Review each removal." }));
    }
    if (ctl.isNarrow()) el.appendChild(renderCard(ctl));
    /* The loss meter counts words removed, as the banner does; words
       added are said apart, so the two never disagree. */
    var added = s.wordsDelta + s.lossWords;
    var loss = "−" + s.lossWords + " words (" + s.lossPct + "%)";
    el.appendChild(h("p", { class: "scribe__reviewbar-sum" }, [
      h("b", { text: decided ? s.pending + " of " + plural(s.changes, "change") + " to review" : plural(s.changes, "change") }),
      s.removals ? " · " + plural(s.removals, "removal") : "",
      s.unverified ? " · " + s.unverified + " to check" : "",
      " · ",
      h("span", { class: "scribe__loss", title: "Words removed if you save now", text: loss }),
      added > 0 ? " · +" + plural(added, "word") + " added" : "",
      s.pages ? " · still " + plural(s.pages, "page") : "",
    ]));
    var verified = s.pending - s.unverified;
    var n = nextVersionN(ctl);
    var saveBtn;
    if (!s.pending && !s.accepted) {
      saveBtn = h("button", { type: "button", class: "scribe__btn scribe__btn--primary", "data-review": "discard", text: "Discard" });
    } else {
      saveBtn = h("button", {
        type: "button", class: "scribe__btn" + (verified > 0 ? "" : " scribe__btn--primary"), "data-review": "save",
        "aria-disabled": s.accepted && !p.saving ? "false" : "true",
        text: p.saving ? "Saving…" : "Save as v" + n + (s.accepted ? " (" + s.accepted + " accepted)" : ""),
      });
    }
    el.appendChild(h("div", { class: "scribe__reviewbar-acts" }, [
      h("button", { type: "button", class: "scribe__btn scribe__btn--ghost", "data-review": "reject-all", "aria-disabled": s.pending ? "false" : "true", text: "Reject all" }),
      h("button", {
        type: "button", class: "scribe__btn" + (verified > 0 ? " scribe__btn--primary" : ""), "data-review": "accept-all",
        "aria-disabled": verified > 0 ? "false" : "true", "aria-keyshortcuts": "Shift+A",
        text: "Accept all" + (s.unverified ? " verified" : ""),
      }),
      saveBtn,
    ]));
    if (ctl.autoSave) {
      el.appendChild(h("p", { class: "scribe__autosave", text: "All changes decided. Saving as v" + n + "…" }));
    }
  }

  /* Under 600px the rail has no room: one card for the focused change. */
  function renderCard(ctl) {
    var p = ctl.state.proposal;
    var c = p.changes[Math.max(0, p.focus)];
    var name = changeName(p, c);
    var st = p.decisions[c.opId];
    return h("div", { class: "scribe__card", role: "group", tabindex: "-1", "data-state": st, "aria-label": capital(name) + ", " + stateWord(p, c) }, [
      h("button", { type: "button", class: "scribe__btn scribe__card-nav", "data-review": "prev", "aria-label": "Previous change", "aria-keyshortcuts": "K", text: "‹" }),
      h("div", { class: "scribe__card-body" }, [
        h("span", { class: "scribe__mm-glyph", "data-g": c.glyph, "aria-hidden": "true", text: c.glyph }),
        h("span", { class: "scribe__card-label" }, [
          h("b", { text: capital(c.label) }),
          " · " + (c.op.rationale || DEFAULT_NOTE[c.kind]),
        ]),
        st === "pending" && c.unverified ? h("span", { class: "scribe__mm-flag", text: flagText(c) }) : null,
      ]),
      decisionControls(p, c, name, "scribe__card"),
      h("button", { type: "button", class: "scribe__btn scribe__card-nav", "data-review": "next", "aria-label": "Next change", "aria-keyshortcuts": "J", text: "›" }),
    ]);
  }

  /* Re-render the review, keeping keyboard focus on the same change. */
  function refreshReview(ctl) {
    var active = doc().activeElement;
    var inReview = active && (within(ctl.refs.rail, active) || within(ctl.refs.reviewbar, active));
    var keepOp = inReview && active.getAttribute ? active.getAttribute("data-op") : null;
    var keepAct = inReview && active.getAttribute ? active.getAttribute("data-review") : null;
    renderReviewbar(ctl);
    renderRegionLabel(ctl);
    if (!inReview) return;
    var scope = ctl.isNarrow() ? ctl.refs.reviewbar : ctl.refs.rail;
    var target = null;
    if (keepAct && !keepOp) target = ctl.refs.reviewbar.querySelector('[data-review="' + keepAct + '"]');
    if (!target && keepOp) {
      target = scope.querySelector('[data-op="' + keepOp + '"] button') || scope.querySelector('button[data-op="' + keepOp + '"]');
    }
    if (!target) target = focusedItem(ctl);
    if (target) target.focus();
  }

  function focusedItem(ctl) {
    var p = ctl.state.proposal;
    if (!p || p.focus < 0) return null;
    if (ctl.isNarrow()) return ctl.refs.reviewbar.querySelector(".scribe__card");
    return ctl.refs.rail.children[p.focus] || null;
  }

  function decide(ctl, opId, state) {
    var p = ctl.state.proposal;
    if (!p || !p.changes || p.saving) return;
    var c = null;
    p.changes.forEach(function (x) { if (x.opId === opId) c = x; });
    if (!c) return;
    p.decisions[opId] = state;
    setMarkState(c, state);
    p.focus = p.changes.indexOf(c);
    markFocus(ctl);
    var verb = state === "accepted" ? "Accepted" : (state === "rejected" ? "Rejected" : "Reopened");
    announce(verb + " " + changeName(p, c) + ".");
    armAutoSave(ctl);
    refreshReview(ctl);
  }

  function decideAll(ctl, state) {
    var p = ctl.state.proposal;
    if (!p || !p.changes || p.saving) return;
    var done = 0;
    var skipped = 0;
    p.changes.forEach(function (c) {
      if (p.decisions[c.opId] !== "pending") return;
      /* Accept all never takes an Unverified change: each needs its own ✓. */
      if (state === "accepted" && c.unverified) { skipped++; return; }
      p.decisions[c.opId] = state;
      setMarkState(c, state);
      done++;
    });
    if (state === "accepted") {
      announce("Accepted " + plural(done, "change") + "." + (skipped ? " " + plural(skipped, "unverified change") + " still " + (skipped === 1 ? "needs" : "need") + " your check." : ""));
    } else {
      announce("Rejected " + plural(done, "remaining change") + ".");
    }
    armAutoSave(ctl);
    refreshReview(ctl);
  }

  function markFocus(ctl) {
    var p = ctl.state.proposal;
    p.changes.forEach(function (c, i) {
      if (!c.anchor) return;
      if (i === p.focus) c.anchor.setAttribute("data-scribe-focus", "");
      else c.anchor.removeAttribute("data-scribe-focus");
    });
  }

  /* j / k (SPEC §4): next or previous change, brought into view. */
  function move(ctl, d) {
    var p = ctl.state.proposal;
    var n = p.changes.length;
    p.focus = p.focus < 0 ? (d > 0 ? 0 : n - 1) : (p.focus + d + n) % n;
    if (ctl.isNarrow()) ctl.setSeg("doc");
    markFocus(ctl);
    renderReviewbar(ctl);
    var c = p.changes[p.focus];
    scrollToChange(ctl, c);
    var item = focusedItem(ctl);
    if (item) item.focus();
    announce(capital(changeName(p, c)) + ", " + stateWord(p, c) + ".");
  }

  function scrollToChange(ctl, c) {
    var r = ctl.refs;
    if (!c.anchor || typeof c.anchor.getBoundingClientRect !== "function") return;
    var scale = parseFloat(r.pageBox.style.width) / parseFloat(r.frame.style.width);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var top = (r.paper.offsetTop || 0) + c.anchor.getBoundingClientRect().top * scale;
    r.docscroll.scrollTop = Math.max(0, Math.round(top - (r.docscroll.clientHeight || 0) / 3));
  }

  /* D (SPEC §2): hide the marks and read the clean proposed text. */
  function toggleShow(ctl) {
    var p = ctl.state.proposal;
    if (!p || !p.changes || !p.changes.length) return;
    ctl.state.showChanges = ctl.state.showChanges === false;
    var inner = frameDoc(ctl);
    if (inner && inner.documentElement && inner.documentElement.classList) {
      inner.documentElement.classList.toggle("scribe-clean", !ctl.state.showChanges);
    }
    ctl.refs.showBtn.setAttribute("aria-pressed", ctl.state.showChanges ? "true" : "false");
    announce(ctl.state.showChanges ? "Showing changes." : "Showing the clean proposed text.");
    fitFrame(ctl);
  }

  /* Every change decided and at least one accepted: save after 3 s idle. */
  function armAutoSave(ctl) {
    var p = ctl.state.proposal;
    if (ctl.autoSave) root.clearTimeout(ctl.autoSave);
    ctl.autoSave = null;
    if (!p || !p.changes || p.saving) return;
    var s = differ().summarize(p.changes, p.decisions, p.baseWords);
    if (s.pending || !s.accepted) return;
    ctl.autoSave = root.setTimeout(function () {
      ctl.autoSave = null;
      if (ctl.closed || ctl.state.proposal !== p) return;
      save(ctl);
    }, AUTO_SAVE_MS);
  }

  function save(ctl) {
    var p = ctl.state.proposal;
    if (!p || !p.changes || p.saving || ctl.state.busy) return;
    if (ctl.autoSave) { root.clearTimeout(ctl.autoSave); ctl.autoSave = null; }
    var accepted = p.changes.filter(function (c) { return p.decisions[c.opId] === "accepted"; });
    if (!accepted.length) { announce("Accept at least one change first."); return; }
    if (!p.id) { announce("These changes can’t be saved. Discard them and send the request again.", true); return; }
    var which = p.doc || ctl.state.doc;
    p.saving = true;
    refreshReview(ctl);
    ctl.api.acceptEdit(p.id, {
      accept: accepted.map(function (c) { return c.opId; }),
      confirmUnverified: accepted.filter(function (c) { return c.unverified; }).map(function (c) { return c.opId; }),
    }).then(function (res) {
      if (ctl.closed || ctl.state.proposal !== p) { emitSaved(ctl, res && res.run && res.run.runId, which); return null; }
      var run = (res && res.run) || {};
      var n = typeof run.n === "number" ? run.n : nextVersionN(ctl);
      var unavailable = res && res.textSaved || run.pdf === "stale";
      var note = unavailable ? "Text saved as v" + n + ". PDF unavailable — it’s rebuilt on your next save." : "Saved as v" + n + " (" + plural(accepted.length, "change") + ").";
      logMessage(ctl, "scribe", [note]);
      status(ctl, unavailable ? "saved-pdf-unavailable" : "saved", note);
      return reloadSaved(ctl, res);
    }, function (err) {
      if (ctl.closed || ctl.state.proposal !== p) return;
      p.saving = false;
      var mapped = copy(err && err.code);
      var settings = err && (err.code === "llm_unconfigured" || err.code === "no_pin");
      var message = err && err.code === "stale_base" ? "Not saved — a newer version exists." : mapped === "That didn’t work. Try again." ? "Not saved. Your accepted changes are still here." : (err && err.message) || mapped;
      status(ctl, err && err.code === "stale_base" ? "stale" : "error", message,
        err && err.code === "stale_base" ? "Review current" : settings ? "Settings" : "Try again", function () {
          if (err && err.code === "stale_base") ctl.api.listVersions(ctl.state.doc).then(function (listing) {
            ctl.state.versions = listing.versions; ctl.state.latestRunId = listing.currentRunId; renderAll(ctl); reviewCurrent(ctl);
          }).catch(function () { status(ctl, "error", "That didn’t work. Try again."); });
          else if (settings && typeof root.openCommandCenterSettingsModal === "function") root.openCommandCenterSettingsModal({ tab: "ai" });
          else save(ctl);
        });
      logMessage(ctl, "blocked", [message]);
      refreshReview(ctl);
    });
  }

  function clearReview(ctl) {
    if (ctl.autoSave) { root.clearTimeout(ctl.autoSave); ctl.autoSave = null; }
    var inner = frameDoc(ctl);
    var D = differ();
    if (!inner || !D || typeof inner.querySelectorAll !== "function") return;
    var marked = inner.querySelectorAll("[data-scribe-op]");
    for (var i = 0; i < marked.length; i++) {
      var el = marked[i];
      if (el.getAttribute("data-scribe-op") === "insert") { if (el.parentNode) el.parentNode.removeChild(el); }
      else D.unmarkElement(el);
    }
    if (inner.documentElement && inner.documentElement.classList) inner.documentElement.classList.remove("scribe-clean");
    ctl.state.showChanges = true;
  }

  function reviewAction(ctl, act, opId, btn) {
    if (btn && btn.getAttribute("aria-disabled") === "true") {
      if (act === "save") announce("Accept at least one change first.");
      return;
    }
    var p = ctl.state.proposal;
    if (act === "accept") decide(ctl, opId, "accepted");
    else if (act === "reject") decide(ctl, opId, "rejected");
    else if (act === "undo") decide(ctl, opId, "pending");
    else if (act === "accept-all") decideAll(ctl, "accepted");
    else if (act === "reject-all") decideAll(ctl, "rejected");
    else if (act === "save") save(ctl);
    else if (act === "discard") discard(ctl);
    else if ((act === "next" || act === "prev") && p && p.changes && p.changes.length) move(ctl, act === "next" ? 1 : -1);
  }

  /* region:F2-keys handler. True when the key was a review key. */
  function reviewKey(ctl, e) {
    var p = ctl.state.proposal;
    if (!p || !p.changes || !p.changes.length || ctl.state.busy || p.saving) return false;
    /* A key is activity: an armed auto-save waits for 3 s of quiet. */
    if (ctl.autoSave) armAutoSave(ctl);
    var k = e.key;
    var focused = p.focus >= 0 ? p.changes[p.focus] : null;
    if (k === "j" || k === "k") { move(ctl, k === "j" ? 1 : -1); }
    else if (k === "A" && e.shiftKey) { decideAll(ctl, "accepted"); }
    else if (k === "a" || k === "r") {
      if (!focused) announce("Pick a change first (J/K to move).");
      else decide(ctl, focused.opId, k === "a" ? "accepted" : "rejected");
    }
    else if (k === "d" || k === "D") { toggleShow(ctl); }
    else return false;
    e.preventDefault();
    return true;
  }

  /* The blocked-op chat line (SPEC §2 Guards), worded by reason. */
  function blockedLine(data) {
    var reason = data && data.reason;
    if (reason === "out_of_scope") return active && active.state.proposal && Array.isArray(active.state.proposal.scope) ? "Blocked: that change is outside the selected text." : "Blocked: that change was outside what you asked Scribe to edit.";
    if (reason === "locked") return "Blocked: that would change a locked fact.";
    return copy(reason);
  }

  /* ---------------- Events ---------------- */

  /* Tabbable controls in DOM order. A walk rather than a selector list,
     so a hidden pane's whole subtree is skipped at once. */
  function focusables(ctl) {
    var out = [];
    var TAGS = { button: 1, textarea: 1, input: 1, select: 1 };
    function visit(el) {
      var kids = el.children || [];
      for (var i = 0; i < kids.length; i++) {
        var node = kids[i];
        if (node.hasAttribute && node.hasAttribute("hidden")) continue;
        var tag = String(node.tagName || "").toLowerCase();
        var tabindex = node.getAttribute ? node.getAttribute("tabindex") : null;
        var candidate = (TAGS[tag] || (tag === "a" && node.hasAttribute("href")) || tabindex != null) && tabindex !== "-1" && !node.disabled;
        if (candidate && (typeof node.getClientRects !== "function" || node.getClientRects().length)) out.push(node);
        if (tag !== "iframe") visit(node);
      }
    }
    visit(ctl.refs.sheet);
    return out;
  }

  function arrowTab(e, buttons, attr, pick) {
    var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    var idx = -1;
    for (var i = 0; i < buttons.length; i++) if (buttons[i] === e.target) idx = i;
    if (idx < 0) return false;
    var next = null;
    if (keys[e.key]) next = buttons[(idx + keys[e.key] + buttons.length) % buttons.length];
    else if (e.key === "Home") next = buttons[0];
    else if (e.key === "End") next = buttons[buttons.length - 1];
    if (!next) return false;
    e.preventDefault();
    pick(next.getAttribute(attr));
    next.focus();
    return true;
  }

  /* A dialog opened over the desk (the score modal) owns its own keys:
     Esc closes it, not Scribe. */
  function inOtherModal(ctl, node) {
    for (var n = node; n && n.getAttribute; n = n.parentNode) {
      if (n === ctl.refs.sheet) return false;
      if (n.getAttribute("aria-modal") === "true") return true;
    }
    return false;
  }

  function onKeydown(ctl, e) {
    var r = ctl.refs;
    if (ctl.closed) return;
    if (inOtherModal(ctl, e.target)) return;
    if (e.key === "Escape" && !r.selectionActions.hasAttribute("hidden")) { e.preventDefault(); e.stopPropagation(); hideSelectionActions(ctl, true); return; }
    if (within(r.selectionActions, e.target) && e.key === "Tab") {
      var buttons = Array.prototype.slice.call(r.selectionActions.querySelectorAll("button"));
      var at = buttons.indexOf(e.target); e.preventDefault(); buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus(); return;
    }
    if (!r.unsaved.hasAttribute("hidden") && e.key === "Escape") { e.preventDefault(); r.unsaved.setAttribute("hidden", ""); r.prompt.focus(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      /* The desk is modal: Esc is ours, not the page's dialog stack. */
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      if (ctl.state.busy) stop(ctl);
      else ctl.close("escape");
      return;
    }
    if (e.key === "Tab") {
      var list = focusables(ctl);
      if (!list.length) return;
      var first = list[0];
      var last = list[list.length - 1];
      var activeEl = doc().activeElement;
      /* Focus on <body> or in the preview iframe is outside the trap. */
      var outside = !within(r.sheet, activeEl) || activeEl === r.frame;
      if (e.shiftKey && (outside || activeEl === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (outside || activeEl === last)) { e.preventDefault(); first.focus(); }
      return;
    }
    if (arrowTab(e, r.docTabs, "data-doc", function (d) { ctl.setDoc(d); })) return;
    if (arrowTab(e, r.sideTabs, "data-side", function (s) { ctl.setSide(s); })) return;
    if (arrowTab(e, r.segs, "data-seg", function (s) { ctl.setSeg(s); })) return;
    if (e.target === r.prompt && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(ctl);
      return;
    }
    if (e.target === r.prompt && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send(ctl);
      return;
    }
    if (isTextField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      if (ctl.isNarrow()) ctl.setSeg("chat");
      else ctl.setSide("chat");
      r.prompt.focus();
      return;
    }
    if (e.key === "F6") {
      e.preventDefault();
      var order = ["doc", "chat", "versions"];
      var at = order.indexOf(ctl.state.focusZone || "doc");
      var zone = order[(at + (e.shiftKey ? order.length - 1 : 1)) % order.length];
      ctl.state.focusZone = zone;
      if (zone === "doc") { if (ctl.isNarrow()) ctl.setSeg("doc"); r.docscroll.focus(); }
      else { if (ctl.isNarrow()) ctl.setSeg(zone); else ctl.setSide(zone); (zone === "chat" ? r.prompt : r.sideTabs[1]).focus(); }
    }
    /* region:F2-keys — j/k/a/r, Shift+A, D and Cmd/Ctrl+Z bind here. */
    if (reviewKey(ctl, e)) return;
    /* region:F3-keys — c (Compare) binds here. */
    if ((e.key === "c" || e.key === "C") && !e.shiftKey && ctl.versionsUi) {
      e.preventDefault();
      ctl.versionsUi.toggleCompare();
    }
  }

  function onClick(ctl, e) {
    var t = e.target;
    while (t && t !== ctl.refs.host) {
      var act = t.getAttribute && t.getAttribute("data-scribe");
      if (act === "close" || act === "scrim") { ctl.close(act === "scrim" ? "scrim" : "button"); return; }
      if (t.getAttribute && t.getAttribute("data-action") === "clear-scope") { clearScope(ctl); return; }
      if (t.getAttribute && t.getAttribute("data-selection")) { selectionAction(ctl, t.getAttribute("data-selection")); return; }
      if (act === "stop") { stop(ctl); return; }
      if (act === "discard") { discard(ctl); return; }
      if (act === "show-changes") { toggleShow(ctl); return; }
      if (t.getAttribute && t.getAttribute("data-score-open") != null) { openScore(ctl, t); return; }
      if (t.getAttribute && t.getAttribute("data-review") != null) { reviewAction(ctl, t.getAttribute("data-review"), t.getAttribute("data-op"), t); return; }
      if (t.getAttribute && t.getAttribute("data-doc") != null && t.getAttribute("role") === "tab") { ctl.setDoc(t.getAttribute("data-doc")); return; }
      if (t.getAttribute && t.getAttribute("data-side") != null) { ctl.setSide(t.getAttribute("data-side")); return; }
      if (t.getAttribute && t.getAttribute("data-seg") != null && t.getAttribute("role") === "tab") { ctl.setSeg(t.getAttribute("data-seg")); return; }
      if (t.getAttribute && t.getAttribute("data-chip") != null) { fillChip(ctl, t.getAttribute("data-chip")); return; }
      if (t.getAttribute && t.getAttribute("data-star") != null) { toggleStar(ctl, t.getAttribute("data-star")); return; }
      t = t.parentNode;
    }
  }

  /* A chip fills the composer; it never sends (SPEC §2). */
  /* The score modal's Fix this, Apply and Repair fill the composer. */
  function openScore(ctl, btn) {
    var score = ctl.opts.score;
    if (!score || typeof score.open !== "function") return;
    score.open(ctl.state.doc, btn, {
      fill: function (text) {
        var ta = ctl.refs.prompt;
        if (ctl.closed || !ta) return;
        ta.value = String(text || "");
        autogrow(ctl);
        if (ctl.isNarrow()) ctl.setSeg("chat");
        ta.focus();
      },
    });
  }

  function fillChip(ctl, chip) {
    var ta = ctl.refs.prompt;
    var cur = String(ta.value || "").trim();
    ta.value = cur ? cur + (/[.!?]$/.test(cur) ? " " : ". ") + chip : chip;
    if (ctl.state.chipsUsed.indexOf(chip) < 0) ctl.state.chipsUsed.push(chip);
    autogrow(ctl);
    ta.focus();
  }

  function toggleStar(ctl, runId) {
    var v = null;
    (ctl.state.versions || []).forEach(function (x) { if (x.runId === runId) v = x; });
    if (!v || v.pinned) return;
    var next = !v.starred;
    v.starred = next;
    renderVersions(ctl);
    ctl.api.star(runId, next).catch(function (err) {
      v.starred = !next;
      renderVersions(ctl);
      announce((err && err.message) || "Star didn’t save.", true);
    });
    var btn = ctl.refs.versions.querySelector('[data-star="' + runId + '"]');
    if (btn) btn.focus();
  }

  /* ---------------- Controller ---------------- */

  function Controller(opts) {
    this.opts = opts;
    this.closed = false;
    this.loadToken = 0;
    this.generation = 0;
    this.request = null;
    this.openProposal = null;
    this.openProposals = null;
    this.abort = null;
    this.autoSave = null;
    this.scope = null; this.manualSeq = 0;
    this.manual = { drafts: Object.create(null), active: null, base: null, doc: null, timer: null, saving: false };
    this.now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
    this.state = {
      doc: opts.doc === "cover_letter" ? "cover_letter" : "resume",
      side: "chat",
      seg: "doc",
      busy: false,
      loading: false,
      stage: null,
      stageDetail: null,
      versions: [],
      currentRunId: null,
      measuredPages: null,
      proposal: null,
      chipsUsed: [],
      focusZone: "doc",
      showChanges: true,
    };
    this.api = opts.api || root.JBScribeApi.create({
      base: opts.base,
      slug: opts.slug,
      mode: opts.mode,
      family: opts.family,
    });
    this.refs = build(this);
  }

  Controller.prototype.guardNavigation = function (action) { return guardManualNavigation(this, action); };
  Controller.prototype.invalidateSelection = function () { invalidateScope(this); };

  Controller.prototype.isNarrow = function () {
    var mq = root.matchMedia;
    if (typeof mq !== "function") return false;
    try { return mq("(max-width: 599px)").matches; } catch (e) { return false; }
  };

  Controller.prototype.setDoc = function (d) {
    if (!DOC_LABEL[d] || d === this.state.doc) return;
    var self = this;
    if (!this.navigationApproved) return guardManualNavigation(this, function () { self.navigationApproved = true; var result = self.setDoc(d); self.navigationApproved = false; return result; });
    invalidateScope(this); unwatchFrameKeys(this);
    detachRequest(this);
    this.state.doc = d;
    this.refs.host.setAttribute("data-doc", d);
    this.refs.log.appendChild(h("div", { class: "scribe__msg scribe__msg--note", text: "Now editing the " + DOC_NOUN[d] + "." }));
    return loadDoc(this);
  };

  Controller.prototype.setSide = function (s) {
    if (s !== "chat" && s !== "versions") return;
    this.state.side = s;
    if (this.state.seg !== "doc") this.state.seg = s;
    renderTabs(this);
  };

  Controller.prototype.setSeg = function (s) {
    if (s !== "doc" && s !== "chat" && s !== "versions") return;
    this.state.seg = s;
    if (s !== "doc") this.state.side = s;
    renderTabs(this);
    if (s === "doc") fitFrame(this);
  };

  Controller.prototype.mount = function () {
    var self = this;
    var r = this.refs;
    r.host.setAttribute("data-doc", this.state.doc);
    this.onKey = function (e) { onKeydown(self, e); };
    /* Review keys (lane F2) work from inside the page too; c stays with
       compare's own frames. */
    this.onFrameKey = function (e) {
      if (e.key === "Tab" && !self.manual.active && !self.refs.selectionActions.hasAttribute("hidden")) {
        e.preventDefault(); var actions = self.refs.selectionActions.querySelectorAll("button"); actions[e.shiftKey ? actions.length - 1 : 0].focus();
      } else if (e.key === "Escape" || e.key === "Tab" || FRAME_REVIEW_KEYS[e.key]) onKeydown(self, e);
      else if (!self.manual.active && (e.key === "Enter" || e.key === "F2") && self.scope && !self.refs.selectionActions.hasAttribute("hidden")) {
        e.preventDefault(); self.refs.selectionActions.querySelector("button").focus();
      }
    };
    this.onViewport = function () { fitViewport(self); };
    this.onHostClick = function (e) { onClick(self, e); };
    this.onSubmit = function (e) { e.preventDefault(); send(self); };
    this.onInput = function () { autogrow(self); };
    this.onResize = function () { fitViewport(self); fitFrame(self); };
    this.onRoleClosed = function () { self.close("role-closed"); };
    this.onManifest = function () { renderScore(self); };
    /* Keys are heard on the document, in the capture phase, for the whole
       life of the desk: focus that falls to <body> is still inside it. */
    doc().addEventListener("keydown", this.onKey, true);
    r.statusAction.addEventListener("click", function () { if (self.statusAction) self.statusAction(); });
    r.host.addEventListener("click", this.onHostClick);
    r.composer.addEventListener("submit", this.onSubmit);
    r.prompt.addEventListener("input", this.onInput);
    root.addEventListener("resize", this.onResize);
    root.addEventListener("jb:role:closed", this.onRoleClosed);
    root.addEventListener("jb:materials:manifest", this.onManifest);
    if (root.visualViewport && typeof root.visualViewport.addEventListener === "function") {
      root.visualViewport.addEventListener("resize", this.onViewport);
      root.visualViewport.addEventListener("scroll", this.onViewport);
    }
    doc().body.appendChild(r.host);
    fitViewport(this);
    if (doc().documentElement && doc().documentElement.classList) doc().documentElement.classList.add("jb-scribe-open");
    logMessage(this, "note", ["Ask for a change. You review every suggested change before it’s saved."]);
    renderAll(this);
    var raf = typeof root.requestAnimationFrame === "function" ? root.requestAnimationFrame : function (fn) { fn(); };
    raf(function () { if (!self.closed) r.host.classList.add("is-open"); });
    r.prompt.focus();
    loadDoc(this);
  };

  Controller.prototype.close = function (reason) {
    if (this.closed) return;
    var self = this;
    if (!this.navigationApproved && reason !== "role-closed") return guardManualNavigation(this, function () { self.navigationApproved = true; self.close(reason); self.navigationApproved = false; });
    if (this.manual.active) captureManual(this);
    if (this.manual.timer) root.clearTimeout(this.manual.timer);
    if (this.manual.active) { this.manual.active.el.removeAttribute("contenteditable"); this.manual.active = null; }
    detachRequest(this);
    this.closed = true;
    var r = this.refs;
    if (this.autoSave) { root.clearTimeout(this.autoSave); this.autoSave = null; }
    doc().removeEventListener("keydown", this.onKey, true);
    unwatchFrameKeys(this);
    if (root.visualViewport && typeof root.visualViewport.removeEventListener === "function") {
      root.visualViewport.removeEventListener("resize", this.onViewport);
      root.visualViewport.removeEventListener("scroll", this.onViewport);
    }
    r.host.removeEventListener("click", this.onHostClick);
    r.composer.removeEventListener("submit", this.onSubmit);
    r.prompt.removeEventListener("input", this.onInput);
    root.removeEventListener("resize", this.onResize);
    root.removeEventListener("jb:role:closed", this.onRoleClosed);
    root.removeEventListener("jb:materials:manifest", this.onManifest);
    if (r.host.parentNode) r.host.parentNode.removeChild(r.host);
    if (doc().documentElement && doc().documentElement.classList) doc().documentElement.classList.remove("jb-scribe-open");
    if (active === this) active = null;
    /* Focus goes back to the Edit button. A manifest poll may have
       repainted the rows while the desk was open, so ask the host for
       the live button when the original is gone. */
    var opener = this.opts.opener;
    var gone = !opener || !within(doc(), opener);
    if (gone && typeof this.opts.findOpener === "function") opener = this.opts.findOpener();
    if (opener && typeof opener.focus === "function") opener.focus();
    emit("jb:scribe:closed", { slug: this.opts.slug, doc: this.state.doc, reason: reason || "close" });
  };

  /* ---------------- Public API ---------------- */

  function open(opts) {
    opts = opts || {};
    if (!opts.slug) return null;
    if (!opts.api && !(root.JBScribeApi && typeof root.JBScribeApi.create === "function")) return null;
    if (active) {
      if (dirtyManual(active) || active.manual.active || active.manual.saving) {
        var previous = active;
        guardManualNavigation(previous, function () { previous.navigationApproved = true; previous.close("replaced"); open(opts); });
        return previous;
      }
      active.close("replaced");
    }
    var ctl = new Controller(opts);
    active = ctl;
    ctl.mount();
    emit("jb:scribe:opened", { slug: opts.slug, doc: ctl.state.doc });
    return ctl;
  }

  function close(reason) {
    if (active) active.close(reason || "api");
  }

  root.JB_SCRIBE_V2 = {
    open: open,
    close: close,
    closeAll: close,
    isOpen: function () { return !!active; },
    current: function () { return active; },
    /* The boot contract calls this when body.jb-v2 appears. Scribe v2
       has nothing to mount until a role binds it, so it is a no-op. */
    boot: function () { return true; },
  };
})(typeof window !== "undefined" ? window : globalThis);
