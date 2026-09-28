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
    if (v.source === "restore") return { text: v.label || "Restored" };
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

    r.scope = h("div", { class: "scribe__scope" });
    r.chips = h("div", { class: "scribe__chips", role: "group", "aria-label": "Quick requests" }, CHIPS.map(function (c) {
      return h("button", { type: "button", class: "scribe__chip", "data-chip": c, text: c });
    }));
    r.prompt = h("textarea", { id: ids.prompt, rows: "1", maxlength: String(root.JBScribeApi ? root.JBScribeApi.MAX_INSTRUCTION : 2000) });
    r.send = h("button", { type: "submit", class: "scribe__btn scribe__btn--primary", text: "Send" });
    r.composer = h("form", { class: "scribe__composer", autocomplete: "off", novalidate: true }, [
      r.scope,
      r.chips,
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
      head, seg, h("div", { class: "scribe__body" }, [docpane, side]), r.announcer,
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
      var stopBtn = h("button", { type: "button", class: "scribe__btn scribe__btn--small", "data-scribe": "stop", text: "Stop" });
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
        ? "Preview, PDF and download serve v" + v.n + "."
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
      h("button", { type: "button", class: "scribe__btn", "data-scribe": "discard", text: "Discard changes" }),
    ]);
    el.appendChild(sum);
    el.appendChild(acts);
  }

  function renderScope(ctl) {
    var el = ctl.refs.scope;
    clear(el);
    el.appendChild(h("span", { text: "Scope" }));
    el.appendChild(h("span", { class: "scribe__pill", text: ctl.state.doc === "resume" ? "Whole resume" : "Whole letter" }));
    /* region:F2-scope — a selection in the preview narrows this to
       "2 bullets selected ×" and fills `scope` with node ids. */
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
      reload: function () { return loadDoc(ctl); },
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

  function renderAll(ctl) {
    renderTabs(ctl);
    renderPages(ctl);
    renderRegionLabel(ctl);
    renderStage(ctl);
    renderReviewbar(ctl);
    renderScope(ctl);
    renderVersions(ctl);
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
    }
    ctl.frameDoc = null;
  }

  function watchFrameKeys(ctl) {
    unwatchFrameKeys(ctl);
    var inner = null;
    try { inner = ctl.refs.frame.contentDocument; } catch (e) { inner = null; }
    if (!inner || typeof inner.addEventListener !== "function") return;
    ctl.frameDoc = inner;
    inner.addEventListener("keydown", ctl.onFrameKey);
  }

  function showPreview(ctl, html) {
    var frame = ctl.refs.frame;
    ctl.refs.docNote.setAttribute("hidden", "");
    ctl.refs.pageBox.removeAttribute("hidden");
    frame.onload = function () {
      watchFrameKeys(ctl);
      fitFrame(ctl);
      ctl.refs.docscroll.setAttribute("aria-busy", "false");
    };
    frame.srcdoc = html;
  }

  function showDocNote(ctl, text, tone) {
    ctl.refs.docNote.textContent = text;
    ctl.refs.docNote.setAttribute("data-tone", tone || "info");
    ctl.refs.docNote.removeAttribute("hidden");
    ctl.refs.pageBox.setAttribute("hidden", "");
    ctl.refs.docscroll.setAttribute("aria-busy", "false");
  }

  /* ---------------- Loading a document ---------------- */

  function loadDoc(ctl) {
    var st = ctl.state;
    var which = st.doc;
    var token = ++ctl.loadToken;
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
      st.currentRunId = listing && listing.currentRunId;
      st.loading = false;
      renderAll(ctl);
      return ctl.api.preview({ doc: which, baseRunId: st.currentRunId }).then(function (res) {
        if (token !== ctl.loadToken || ctl.closed) return null;
        showPreview(ctl, String((res && res.html) || ""));
        return res;
      });
    }).catch(function (err) {
      if (token !== ctl.loadToken || ctl.closed) return null;
      st.loading = false;
      renderAll(ctl);
      showDocNote(ctl, (err && err.message) || "The document did not load.", "error");
      return null;
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
      p.ops.push(data.op);
      /* region:F2-ops — each validated op becomes a mark in the preview. */
      markOp(ctl, data.op);
    } else if (frame.event === "blocked") {
      p.blocked.push(data);
      var line = blockedLine(data);
      logMessage(ctl, "blocked", [h("b", { text: "Blocked: " }), line]);
      announce("Blocked: " + line, true);
    } else if (frame.event === "proposal") {
      p.summary = data.summary || null;
    } else if (frame.event === "error") {
      logMessage(ctl, "blocked", [data.message || "Scribe could not finish this request."]);
      announce(data.message || "Scribe could not finish this request.", true);
    } else if (frame.event === "done") {
      p.status = data.status || "ready";
    }
  }

  function finishRun(ctl) {
    var st = ctl.state;
    var p = st.proposal;
    st.busy = false;
    st.stage = null;
    ctl.abort = null;
    if (!p) { renderAll(ctl); return; }
    var s = p.summary;
    var n = p.ops.length;
    if (n) {
      var bits = [plural(n, "change")];
      if (s && s.removals) bits.push(plural(s.removals, "removal"));
      if (s && typeof s.wordsDelta === "number" && s.wordsDelta) bits.push((s.wordsDelta > 0 ? "+" : "−") + Math.abs(s.wordsDelta) + " words");
      if (s && s.pages) bits.push("still " + plural(s.pages, "page"));
      var head = p.status === "partial" ? "Stopped early" : (n === 1 ? "1 change is ready" : n + " changes are ready");
      logMessage(ctl, "scribe", [h("span", { class: "scribe__hand", text: head }), bits.join(" · ")]);
      announce(head + ". " + bits.join(", ") + ".");
      if (ctl.isNarrow()) ctl.setSeg("doc");
    } else {
      p.summary = null;
      logMessage(ctl, "note", [p.status === "partial" ? "Stopped. No changes were proposed." : "No changes were proposed. Try a more specific request."]);
      st.proposal = null;
    }
    renderAll(ctl);
  }

  function send(ctl) {
    var st = ctl.state;
    if (st.busy || st.loading) return;
    var text = String(ctl.refs.prompt.value || "").trim();
    if (!text) { ctl.refs.prompt.focus(); return; }
    var chips = st.chipsUsed.slice();
    ctl.refs.prompt.value = "";
    st.chipsUsed = [];
    autogrow(ctl);
    logMessage(ctl, "you", [text]);
    st.busy = true;
    st.stage = "reading";
    st.stageDetail = null;
    st.proposal = { id: null, ops: [], blocked: [], summary: null, status: "pending", instruction: text };
    ctl.refs.docscroll.setAttribute("aria-busy", "true");
    renderAll(ctl);
    var Abort = root.AbortController;
    var controller = typeof Abort === "function" ? new Abort() : null;
    ctl.abort = controller;
    ctl.api.propose({
      doc: st.doc,
      baseRunId: st.currentRunId,
      instruction: text,
      scope: "all",
      lockFacts: true,
      chips: chips,
    }).then(function (res) {
      if (ctl.closed) return null;
      st.proposal.id = res.proposalId;
      if (res.rebasedTo) st.currentRunId = res.rebasedTo;
      return ctl.api.stream(res.proposalId, {
        signal: controller ? controller.signal : undefined,
        onEvent: function (frame) { onStreamEvent(ctl, frame); },
      });
    }).then(function () {
      if (ctl.closed) return;
      ctl.refs.docscroll.setAttribute("aria-busy", "false");
      finishRun(ctl);
    }).catch(function (err) {
      if (ctl.closed) return;
      st.busy = false;
      st.stage = null;
      st.proposal = null;
      ctl.abort = null;
      ctl.refs.docscroll.setAttribute("aria-busy", "false");
      var message = (err && err.message) || "Scribe could not start this request.";
      logMessage(ctl, "blocked", [message]);
      announce(message, true);
      renderAll(ctl);
    });
  }

  /* Stop keeps every op already validated and marks the proposal partial
     (SPEC §2 Progress); the server's reply may carry ops the stream had
     not delivered yet. */
  function stop(ctl) {
    var p = ctl.state.proposal;
    if (!ctl.state.busy) return;
    if (p) {
      p.status = "partial";
      if (!p.summary && p.changes && p.changes.length) p.summary = reviewSummary(ctl);
    }
    if (p && p.id) {
      ctl.api.stopEdit(p.id).then(function (res) {
        if (ctl.closed || ctl.state.proposal !== p) return;
        var known = {};
        p.ops.forEach(function (op) { known[op.opId] = true; });
        var late = ((res && res.ops) || []).filter(function (op) { return op && !known[op.opId]; });
        late.forEach(function (op) { p.ops.push(op); markOp(ctl, op); });
        if (late.length && !ctl.state.busy) renderAll(ctl);
      }).catch(function () { /* the abort below still ends the run */ });
    }
    if (ctl.abort && typeof ctl.abort.abort === "function") ctl.abort.abort();
  }

  function discard(ctl) {
    var p = ctl.state.proposal;
    if (!p) return;
    if (p.id) ctl.api.rejectEdit(p.id).catch(function () { /* nothing was saved either way */ });
    clearReview(ctl);
    ctl.state.proposal = null;
    logMessage(ctl, "note", ["Changes discarded. Nothing was saved."]);
    announce("Changes discarded.");
    renderAll(ctl);
    fitFrame(ctl);
  }

  /* ---------------- Review (lane F2) ----------------
     Each validated op becomes a suggesting-mode mark on the real render:
     scribe-v2-diff.js rewrites the block the template names with
     data-node, inside the script-less frame. The controls live in the
     page's margin rail (≥600px) or a change card (<600px), and in the
     review bar. Nothing reaches disk until Save (SPEC §2). */

  var AUTO_SAVE_MS = 3000;
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
    return "Unverified: please confirm." + (facts.length ? " " + facts[0] : "");
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
      saveBtn = h("button", { type: "button", class: "scribe__btn scribe__btn--primary", "data-review": "discard", text: "Close without saving" });
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
      el.appendChild(h("p", { class: "scribe__autosave", text: "Every change is decided. Saving as v" + n + " in a moment." }));
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
    if (!p.id) { announce("This proposal has no server copy to save.", true); return; }
    p.saving = true;
    refreshReview(ctl);
    ctl.api.acceptEdit(p.id, {
      accept: accepted.map(function (c) { return c.opId; }),
      confirmUnverified: accepted.filter(function (c) { return c.unverified; }).map(function (c) { return c.opId; }),
    }).then(function (res) {
      if (ctl.closed || ctl.state.proposal !== p) return null;
      var run = (res && res.run) || {};
      var n = typeof run.n === "number" ? run.n : nextVersionN(ctl);
      var note = "Saved as v" + n + " (" + plural(accepted.length, "change") + ").";
      if (run.pdf === "stale") note += " The PDF catches up when the materials browser is back.";
      logMessage(ctl, "scribe", [h("span", { class: "scribe__hand", text: "Saved as v" + n }), note.replace(/^Saved as v\d+ /, "")]);
      announce("Saved as version " + n + ".");
      ctl.state.proposal = null;
      return loadDoc(ctl);
    }, function (err) {
      if (ctl.closed || ctl.state.proposal !== p) return;
      p.saving = false;
      var message = (err && err.message) || "The changes did not save.";
      logMessage(ctl, "blocked", [h("b", { text: "Not saved: " }), message]);
      announce("Not saved: " + message, true);
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
      if (!focused) announce("Press J to pick a change first.");
      else decide(ctl, focused.opId, k === "a" ? "accepted" : "rejected");
    }
    else if (k === "d" || k === "D") { toggleShow(ctl); }
    else return false;
    e.preventDefault();
    return true;
  }

  /* The blocked-op chat line (SPEC §2 Guards), worded by reason. */
  function blockedLine(data) {
    var detail = data && data.detail ? "“" + data.detail + "”" : "";
    var reason = data && data.reason;
    if (reason === "out_of_scope") return "that change was outside what you asked Scribe to edit.";
    if (reason === "shape") return "that change would break the template's shape" + (data.detail ? " (" + data.detail + ")" : "") + ".";
    if (reason === "invalid_model") return "Scribe returned a change the template can't hold.";
    return "would change " + (detail || "a locked fact") + ".";
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

  function onKeydown(ctl, e) {
    var r = ctl.refs;
    if (ctl.closed) return;
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
      if (act === "stop") { stop(ctl); return; }
      if (act === "discard") { discard(ctl); return; }
      if (act === "show-changes") { toggleShow(ctl); return; }
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
      announce((err && err.message) || "The star did not save.", true);
    });
    var btn = ctl.refs.versions.querySelector('[data-star="' + runId + '"]');
    if (btn) btn.focus();
  }

  /* ---------------- Controller ---------------- */

  function Controller(opts) {
    this.opts = opts;
    this.closed = false;
    this.loadToken = 0;
    this.abort = null;
    this.autoSave = null;
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

  Controller.prototype.isNarrow = function () {
    var mq = root.matchMedia;
    if (typeof mq !== "function") return false;
    try { return mq("(max-width: 599px)").matches; } catch (e) { return false; }
  };

  Controller.prototype.setDoc = function (d) {
    if (!DOC_LABEL[d] || d === this.state.doc) return;
    if (this.state.busy) stop(this);
    this.state.doc = d;
    this.refs.host.setAttribute("data-doc", d);
    this.refs.log.appendChild(h("div", { class: "scribe__msg scribe__msg--note", text: "Now editing the " + DOC_NOUN[d] + "." }));
    loadDoc(this);
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
    this.onFrameKey = function (e) { if (e.key === "Escape" || e.key === "Tab") onKeydown(self, e); };
    this.onViewport = function () { fitViewport(self); };
    this.onHostClick = function (e) { onClick(self, e); };
    this.onSubmit = function (e) { e.preventDefault(); send(self); };
    this.onInput = function () { autogrow(self); };
    this.onResize = function () { fitViewport(self); fitFrame(self); };
    this.onRoleClosed = function () { self.close("role-closed"); };
    /* Keys are heard on the document, in the capture phase, for the whole
       life of the desk: focus that falls to <body> is still inside it. */
    doc().addEventListener("keydown", this.onKey, true);
    r.host.addEventListener("click", this.onHostClick);
    r.composer.addEventListener("submit", this.onSubmit);
    r.prompt.addEventListener("input", this.onInput);
    root.addEventListener("resize", this.onResize);
    root.addEventListener("jb:role:closed", this.onRoleClosed);
    if (root.visualViewport && typeof root.visualViewport.addEventListener === "function") {
      root.visualViewport.addEventListener("resize", this.onViewport);
      root.visualViewport.addEventListener("scroll", this.onViewport);
    }
    doc().body.appendChild(r.host);
    fitViewport(this);
    if (doc().documentElement && doc().documentElement.classList) doc().documentElement.classList.add("jb-scribe-open");
    logMessage(this, "note", ["Ask for a change to this " + DOC_NOUN[this.state.doc] + ". Nothing is saved until you accept it."]);
    renderAll(this);
    var raf = typeof root.requestAnimationFrame === "function" ? root.requestAnimationFrame : function (fn) { fn(); };
    raf(function () { if (!self.closed) r.host.classList.add("is-open"); });
    r.prompt.focus();
    loadDoc(this);
  };

  Controller.prototype.close = function (reason) {
    if (this.closed) return;
    this.closed = true;
    var r = this.refs;
    if (this.state.busy) stop(this);
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
    if (active) active.close("replaced");
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
