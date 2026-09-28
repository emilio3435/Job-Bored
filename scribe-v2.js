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
        var state = j < idx ? "done" : (j === idx ? "now" : "todo");
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
    var avail = ctl.refs.docscroll.clientWidth || natW;
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
    } else if (frame.event === "blocked") {
      p.blocked.push(data);
      var detail = data.detail ? "“" + data.detail + "”" : "a locked fact";
      logMessage(ctl, "blocked", [h("b", { text: "Blocked: " }), "would change " + detail + "."]);
      announce("Blocked: would change " + detail + ".", true);
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

  function stop(ctl) {
    var p = ctl.state.proposal;
    if (!ctl.state.busy) return;
    if (p && p.id) ctl.api.stopEdit(p.id).catch(function () { /* the abort below still ends the run */ });
    if (ctl.abort && typeof ctl.abort.abort === "function") ctl.abort.abort();
  }

  function discard(ctl) {
    var p = ctl.state.proposal;
    if (!p) return;
    if (p.id) ctl.api.rejectEdit(p.id).catch(function () { /* nothing was saved either way */ });
    ctl.state.proposal = null;
    logMessage(ctl, "note", ["Changes discarded. Nothing was saved."]);
    announce("Changes discarded.");
    renderAll(ctl);
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
