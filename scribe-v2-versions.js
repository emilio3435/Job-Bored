/* ============================================================
   scribe-v2-versions.js — Scribe v2 versions: View, Compare, Bring back
   (EDITOR lane F3)
   ------------------------------------------------------------
   Spec:    docs/programs/editor-20260927/SPEC.md §1 (Compare row),
            §2 (Versions), §3.2 (versions endpoints), §4 (keys, a11y)
   Mockup:  docs/programs/editor-20260927/mockup/index.html
   Network: the desk's scribe-v2-api.js client only (getModel,
            preview, restore).

   scribe-v2.js calls attach(ctl, deps) once, from its versions region,
   and then:
     - rowParts(v)      per version row: source tag, row actions and the
                        bring-back confirmation;
     - sync()           after every versions render;
     - toggleCompare()  from the `c` key (the header's Compare button,
                        refs.compareBtn, is handled here too).

   The document pane gains one `.scribe__compare` region that stands in
   for the live preview while a version is being viewed or compared:
     view     one read-only render of an older version;
     compare  A and B side by side at ≥1024px, an A/B toggle below.
              B's text is marked against A (word-level, no accept
              controls), in the render when it carries data-node, and
              always in the list of changed blocks above the pages.

   Bring back never deletes: it asks first, then POSTs …/restore, which
   appends a new run (source "restore"), and reloads the list.

   The word diff here is deliberately small. Lane F2 owns the shared
   scribe-v2-diff.js; once it lands, diffWords() should defer to it.

   Publishes: window.JBScribeVersions = { attach, diffWords, diffNodes,
   nodesForDoc, sourceLabel, tokenize }.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var SOURCE_LABEL = {
    draft: "Draft",
    edit: "Scribe edit",
    manual: "Manual",
    regenerate: "Regenerated",
    restore: "Brought back",
  };
  var LETTER_KINDS = { salutation: 1, paragraph: 1 };
  var KIND_LABEL = {
    statement: "Summary",
    intro: "Intro",
    seat: "Role title",
    bullet: "Bullet",
    line: "Earlier role",
    credential: "Education",
    toolkit: "Toolkit",
    salutation: "Greeting",
    paragraph: "Paragraph",
  };
  var DOC_NOUN = { resume: "resume", cover_letter: "cover letter" };
  /* Beyond this many token pairs the table is not worth building: the
     whole block is shown as replaced instead. */
  var MAX_CELLS = 160000;
  var GAP_WORDS = 2;

  /* ---------------- Word diff ---------------- */

  /* Words (with inner apostrophes, dots, dashes, %, as in 2.3M or 38%),
     runs of whitespace, and single punctuation marks. */
  var TOKEN_RE = /[A-Za-z0-9\u00C0-\u024F$]+(?:['\u2019.,\-/][A-Za-z0-9\u00C0-\u024F]+)*%?|\s+|[^\sA-Za-z0-9\u00C0-\u024F$]/g;

  function tokenize(text) {
    return String(text == null ? "" : text).match(TOKEN_RE) || [];
  }

  function wordCount(text) {
    return tokenize(text).filter(function (t) { return /[A-Za-z0-9\u00C0-\u024F]/.test(t); }).length;
  }

  /* Longest common subsequence over tokens → "=", "-", "+" steps. */
  function lcsSteps(a, b) {
    var n = a.length;
    var m = b.length;
    if (n * m > MAX_CELLS) {
      var out = [];
      if (n) out.push({ k: "-", t: a.join("") });
      if (m) out.push({ k: "+", t: b.join("") });
      return out;
    }
    var w = m + 1;
    var table = new Array((n + 1) * w);
    for (var f = 0; f < table.length; f++) table[f] = 0;
    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        table[i * w + j] = a[i] === b[j]
          ? table[(i + 1) * w + j + 1] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    var steps = [];
    var x = 0;
    var y = 0;
    while (x < n && y < m) {
      if (a[x] === b[y]) { steps.push({ k: "=", t: a[x] }); x++; y++; }
      else if (table[(x + 1) * w + y] >= table[x * w + y + 1]) { steps.push({ k: "-", t: a[x] }); x++; }
      else { steps.push({ k: "+", t: b[y] }); y++; }
    }
    while (x < n) steps.push({ k: "-", t: a[x++] });
    while (y < m) steps.push({ k: "+", t: b[y++] });
    return steps;
  }

  /* diffWords(a, b) → [{kind: "same"|"del"|"ins", text}], A → B.
     Changes cluster into one deletion followed by one insertion, and an
     unchanged gap of two words or fewer between two changes is folded
     into both sides (SPEC §2), so a reworded phrase reads as one change
     instead of a stutter of tiny marks. */
  function diffWords(a, b) {
    var steps = lcsSteps(tokenize(a), tokenize(b));
    var segs = [];
    function top() { return segs[segs.length - 1]; }
    steps.forEach(function (s) {
      if (s.k === "=") {
        if (top() && top().same != null) top().same += s.t;
        else segs.push({ same: s.t });
      } else {
        if (!top() || top().same != null) segs.push({ del: "", ins: "" });
        if (s.k === "-") top().del += s.t; else top().ins += s.t;
      }
    });
    /* Fold small gaps: change, gap ≤ 2 words, change → one change. */
    var merged = [];
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var prev = merged[merged.length - 1];
      var next = segs[i + 1];
      if (seg.same != null && prev && prev.same == null && next && next.same == null && wordCount(seg.same) <= GAP_WORDS) {
        prev.del += seg.same + next.del;
        prev.ins += seg.same + next.ins;
        i++;
        continue;
      }
      if (seg.same == null && prev && prev.same == null) {
        prev.del += seg.del;
        prev.ins += seg.ins;
        continue;
      }
      merged.push(seg.same != null ? { same: seg.same } : { del: seg.del, ins: seg.ins });
    }
    var parts = [];
    merged.forEach(function (seg) {
      if (seg.same != null) { parts.push({ kind: "same", text: seg.same }); return; }
      /* A change that only moves whitespace is not a change a reader sees. */
      if (!seg.del.trim() && !seg.ins.trim()) { parts.push({ kind: "same", text: seg.ins || seg.del }); return; }
      if (seg.del) parts.push({ kind: "del", text: seg.del });
      if (seg.ins) parts.push({ kind: "ins", text: seg.ins });
    });
    return parts;
  }

  /* ---------------- Node diff ---------------- */

  function nodesForDoc(nodes, which) {
    var letter = which === "cover_letter";
    return (nodes || []).filter(function (node) {
      return !!LETTER_KINDS[node && node.kind] === letter;
    });
  }

  function nodeLabel(node) {
    var base = KIND_LABEL[node.kind] || "Block";
    var bits = String(node.id || "").split(":");
    if (node.kind === "bullet" && bits[1]) return base + ", " + bits[1];
    if ((node.kind === "seat" || node.kind === "line") && bits[1]) return base + ", " + bits[1];
    if (node.kind === "toolkit" && bits[1]) return base + ", " + bits.slice(1).join(":");
    if (node.kind === "paragraph" && bits[1]) return base + " " + bits[1].replace(/^p/, "");
    return base;
  }

  /* diffNodes(aNodes, bNodes) → the blocks whose text differs, in B's
     reading order, with removed blocks placed after their A neighbour:
     [{id, kind, label, change: "changed"|"added"|"removed", parts,
       added, removed}] where added/removed count words. */
  function diffNodes(aNodes, bNodes) {
    var aById = {};
    var bById = {};
    (aNodes || []).forEach(function (n) { aById[n.id] = n; });
    (bNodes || []).forEach(function (n) { bById[n.id] = n; });
    var order = (bNodes || []).map(function (n) { return n.id; });
    var lastSeen = null;
    (aNodes || []).forEach(function (n) {
      if (bById[n.id]) { lastSeen = n.id; return; }
      var at = lastSeen == null ? 0 : order.indexOf(lastSeen) + 1;
      order.splice(at, 0, n.id);
      lastSeen = n.id;
    });
    var out = [];
    order.forEach(function (id) {
      var a = aById[id];
      var b = bById[id];
      var aText = a ? String(a.text || "") : "";
      var bText = b ? String(b.text || "") : "";
      if (a && b && aText === bText) return;
      var parts = a && b ? diffWords(aText, bText)
        : (b ? [{ kind: "ins", text: bText }] : [{ kind: "del", text: aText }]);
      var added = 0;
      var removed = 0;
      parts.forEach(function (p) {
        if (p.kind === "ins") added += wordCount(p.text);
        if (p.kind === "del") removed += wordCount(p.text);
      });
      if (a && b && !added && !removed) return;
      var node = b || a;
      out.push({
        id: id,
        kind: node.kind,
        label: nodeLabel(node),
        change: a && b ? "changed" : (b ? "added" : "removed"),
        parts: parts,
        added: added,
        removed: removed,
      });
    });
    return out;
  }

  function sourceLabel(v) {
    return (v && SOURCE_LABEL[v.source]) || "Saved";
  }

  /* ---------------- The desk UI ---------------- */

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  function attach(ctl, deps) {
    var h = deps.h;
    var doc = root.document;
    var r = ctl.refs;
    var ui = {
      compareBtn: r.compareBtn || null,
      mode: null, /* null | "view" | "compare" */
      forDoc: null,
      a: null,
      b: null,
      ab: "B",
      confirm: null,
      restoring: false,
      opener: null,
      token: 0,
      models: {},
      previews: {},
      diff: null,
      diffError: null,
    };

    var pane = h("section", { class: "scribe__compare", role: "region", tabindex: "-1", hidden: true });
    var bar = h("div", { class: "scribe__compare-bar" });
    var pages = h("div", { class: "scribe__compare-pages" });
    var changes = h("div", { class: "scribe__compare-changes" });
    /* The list of changed blocks leads: it is the diff that always reads,
       at any width, whether or not the render names its blocks. */
    pane.appendChild(bar);
    pane.appendChild(changes);
    pane.appendChild(pages);
    var docpane = r.docscroll.parentNode;
    if (docpane) docpane.appendChild(pane);

    /* The two pages exist only while a version is viewed or compared, so
       an idle desk holds one iframe: the live preview. */
    var figs = null;

    function buildFigs() {
      figs = { A: makeFig("a"), B: makeFig("b") };
      pages.appendChild(figs.A.el);
      pages.appendChild(figs.B.el);
    }

    function makeFig(which) {
      var caption = h("p", { class: "scribe__compare-cap" });
      var frame = h("iframe", { class: "scribe__compare-frame", sandbox: "allow-same-origin", tabindex: "-1" });
      var box = h("div", { class: "scribe__compare-sheet" }, [frame]);
      var el = h("figure", { class: "scribe__compare-fig scribe__compare-fig--" + which }, [caption, box]);
      return { el: el, caption: caption, frame: frame, box: box, runId: null };
    }

    /* ---------- lookups ---------- */

    function versions() { return ctl.state.versions || []; }

    function byId(runId) {
      var list = versions();
      for (var i = 0; i < list.length; i++) if (list[i].runId === runId) return list[i];
      return null;
    }

    function current() { return byId(ctl.state.currentRunId) || versions()[0] || null; }

    /* The version just before `v`: its parent if listed, else the next
       older row (the list is newest first). */
    function before(v) {
      if (!v) return null;
      if (v.parentRunId && byId(v.parentRunId)) return byId(v.parentRunId);
      var list = versions();
      for (var i = 0; i < list.length; i++) {
        if (list[i].runId === v.runId) return list[i + 1] || null;
      }
      return null;
    }

    function docNoun() { return DOC_NOUN[ctl.state.doc] || "document"; }

    /* ---------- data ---------- */

    function modelNodes(runId) {
      if (!ui.models[runId]) {
        ui.models[runId] = ctl.api.getModel(runId).then(function (res) {
          return nodesForDoc((res && res.nodes) || [], ui.forDoc);
        });
        ui.models[runId].catch(function () { delete ui.models[runId]; });
      }
      return ui.models[runId];
    }

    function previewHtml(runId) {
      if (!ui.previews[runId]) {
        ui.previews[runId] = ctl.api.preview({ doc: ui.forDoc, baseRunId: runId }).then(function (res) {
          return String((res && res.html) || "");
        });
        ui.previews[runId].catch(function () { delete ui.previews[runId]; });
      }
      return ui.previews[runId];
    }

    /* ---------- frames ---------- */

    function tokenValue(name, fallback) {
      try {
        var v = root.getComputedStyle(doc.documentElement).getPropertyValue(name);
        return String(v || "").trim() || fallback;
      } catch (e) { return fallback; }
    }

    function frameDoc(fig) {
      try { return fig.frame.contentDocument || null; } catch (e) { return null; }
    }

    function fitFig(fig) {
      var inner = frameDoc(fig);
      if (!inner || !inner.documentElement) return;
      var el = inner.documentElement;
      var natW = Math.max(el.scrollWidth || 0, 1);
      var natH = Math.max(el.scrollHeight || 0, 1);
      var avail = fig.el.clientWidth || natW;
      var scale = Math.min(1, Math.max(0.2, avail / natW));
      fig.frame.style.width = natW + "px";
      fig.frame.style.height = natH + "px";
      fig.frame.style.transform = scale < 1 ? "scale(" + scale + ")" : "";
      fig.box.style.width = Math.round(natW * scale) + "px";
      fig.box.style.height = Math.round(natH * scale) + "px";
    }

    function fitAll() {
      if (!ui.mode || !figs) return;
      fitFig(figs.A);
      fitFig(figs.B);
    }

    /* Marks inside the render, where the template names its blocks with
       data-node. The frame runs no script; the parent writes into it. */
    function markFrame(fig, blocks, side) {
      var inner = frameDoc(fig);
      if (!inner || typeof inner.querySelector !== "function" || !blocks || !blocks.length) return 0;
      var marked = 0;
      if (inner.head && !inner.getElementById("scribe-compare-marks")) {
        var style = inner.createElement("style");
        style.id = "scribe-compare-marks";
        style.textContent =
          "ins.scribe-cmp{background:" + tokenValue("--jb-mint-tint", "transparent") + ";text-decoration:underline 2px " + tokenValue("--jb-accent-ink", "currentColor") + ";text-underline-offset:2px}" +
          "del.scribe-cmp{color:" + tokenValue("--jb-err", "inherit") + ";text-decoration:line-through}" +
          "[data-scribe-cmp]{box-shadow:-6px 0 0 -3px " + tokenValue("--jb-accent-ink", "currentColor") + "}" +
          "[data-scribe-cmp=removed]{box-shadow:-6px 0 0 -3px " + tokenValue("--jb-err", "currentColor") + ";text-decoration:line-through}" +
          ".scribe-cmp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}";
        inner.head.appendChild(style);
      }
      blocks.forEach(function (block) {
        var el = null;
        try { el = inner.querySelector('[data-node="' + String(block.id).replace(/["\\]/g, "\\$&") + '"]'); } catch (e) { el = null; }
        if (!el) return;
        if (side === "A") {
          if (block.change !== "removed") return;
          el.setAttribute("data-scribe-cmp", "removed");
          marked++;
          return;
        }
        if (block.change === "removed") return;
        el.setAttribute("data-scribe-cmp", block.change);
        while (el.firstChild) el.removeChild(el.firstChild);
        block.parts.forEach(function (p) {
          if (p.kind === "same") { el.appendChild(inner.createTextNode(p.text)); return; }
          var tag = inner.createElement(p.kind);
          tag.className = "scribe-cmp";
          var sr = inner.createElement("span");
          sr.className = "scribe-cmp-sr";
          sr.textContent = p.kind === "ins" ? "inserted: " : "deleted: ";
          tag.appendChild(sr);
          tag.appendChild(inner.createTextNode(p.text));
          var end = inner.createElement("span");
          end.className = "scribe-cmp-sr";
          end.textContent = p.kind === "ins" ? " end inserted" : " end deleted";
          tag.appendChild(end);
          el.appendChild(tag);
        });
        marked++;
      });
      return marked;
    }

    /* A click in a page moves focus into the frame's own document, where
       the desk's key handler never hears it (Grok F3-trap). Forward Esc
       and `c` to the desk, and take Tab back to the compare controls. */
    function barControls() {
      var out = [];
      (function visit(el) {
        Array.prototype.slice.call(el.children || []).forEach(function (kid) {
          var tag = String(kid.tagName || "").toLowerCase();
          if (tag === "button" || tag === "select") {
            if (!kid.hasAttribute("hidden") && (typeof kid.getClientRects !== "function" || kid.getClientRects().length)) out.push(kid);
          } else visit(kid);
        });
      })(bar);
      return out;
    }

    function onPageKey(e) {
      if (e.key === "Tab") {
        var list = barControls();
        if (!list.length) return;
        e.preventDefault();
        list[e.shiftKey ? list.length - 1 : 0].focus();
        return;
      }
      if ((e.key === "Escape" || e.key === "c" || e.key === "C") && typeof ctl.onKey === "function") ctl.onKey(e);
    }

    function unwatchFig(fig) {
      if (fig && fig.keyDoc && typeof fig.keyDoc.removeEventListener === "function") fig.keyDoc.removeEventListener("keydown", onPageKey);
      if (fig) fig.keyDoc = null;
    }

    function watchFig(fig) {
      unwatchFig(fig);
      var inner = frameDoc(fig);
      if (!inner || typeof inner.addEventListener !== "function") return;
      fig.keyDoc = inner;
      inner.addEventListener("keydown", onPageKey);
    }

    function unwatchAll() {
      if (!figs) return;
      unwatchFig(figs.A);
      unwatchFig(figs.B);
    }

    function loadFig(fig, runId, side, token) {
      fig.runId = runId;
      fig.box.setAttribute("aria-busy", "true");
      unwatchFig(fig);
      return previewHtml(runId).then(function (html) {
        if (token !== ui.token) return;
        fig.frame.onload = function () {
          if (token !== ui.token) return;
          watchFig(fig);
          fig.box.setAttribute("aria-busy", "false");
          fitFig(fig);
          if (ui.mode === "compare" && ui.diff) markFrame(fig, ui.diff, side);
        };
        fig.frame.srcdoc = html;
      }, function (err) {
        if (token !== ui.token) return;
        fig.box.setAttribute("aria-busy", "false");
        fig.caption.textContent += " — " + ((err && err.message) || "this version did not load.");
      });
    }

    /* ---------- render ---------- */

    function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

    function versionOptions(selected, name) {
      var sel = h("select", { class: "scribe__compare-select", "data-cmp-pick": name, "aria-label": "Version " + name });
      versions().forEach(function (v) {
        var opt = h("option", { value: v.runId, text: "v" + v.n + (v.runId === ctl.state.currentRunId ? " (current)" : "") });
        if (v.runId === selected) opt.setAttribute("selected", "");
        sel.appendChild(opt);
      });
      sel.value = selected;
      return sel;
    }

    function renderBar() {
      clear(bar);
      var a = byId(ui.a);
      var b = byId(ui.b);
      var cur = current();
      if (ui.mode === "view") {
        var isCur = a && cur && a.runId === cur.runId;
        bar.appendChild(h("p", { class: "scribe__compare-what" }, [
          h("b", { text: "Viewing v" + (a ? a.n : "?") }),
          isCur ? " · the current version" : " · read-only",
        ]));
        var acts = h("div", { class: "scribe__compare-acts" });
        if (!isCur) {
          acts.appendChild(h("button", { type: "button", class: "scribe__btn scribe__btn--small", "data-cmp-act": "compare", text: "Compare with current" }));
          acts.appendChild(h("button", { type: "button", class: "scribe__btn scribe__btn--small", "data-cmp-act": "bring", text: "Bring back as new" }));
        }
        acts.appendChild(h("button", { type: "button", class: "scribe__btn scribe__btn--small scribe__btn--primary", "data-cmp-act": "exit", text: "Back to current" }));
        bar.appendChild(acts);
        return;
      }
      var pick = h("div", { class: "scribe__compare-pick" }, [
        h("label", { class: "scribe__compare-field" }, ["A", versionOptions(ui.a, "A")]),
        h("span", { class: "scribe__compare-arrow", "aria-hidden": "true", text: "→" }),
        h("label", { class: "scribe__compare-field" }, ["B", versionOptions(ui.b, "B")]),
      ]);
      var tabA = h("button", { type: "button", role: "tab", "data-ab": "A", "aria-selected": ui.ab === "A" ? "true" : "false", tabindex: ui.ab === "A" ? "0" : "-1", text: "A · v" + (a ? a.n : "?") });
      var tabB = h("button", { type: "button", role: "tab", "data-ab": "B", "aria-selected": ui.ab === "B" ? "true" : "false", tabindex: ui.ab === "B" ? "0" : "-1", text: "B · v" + (b ? b.n : "?") + " marked" });
      var toggle = h("div", { class: "scribe__compare-ab", role: "tablist", "aria-label": "Show version" }, [tabA, tabB]);
      bar.appendChild(pick);
      bar.appendChild(toggle);
      bar.appendChild(h("button", { type: "button", class: "scribe__btn scribe__btn--small", "data-cmp-act": "exit", text: "Done comparing" }));
    }

    function renderFigs() {
      if (!figs) return;
      var a = byId(ui.a);
      var b = byId(ui.b);
      var view = ui.mode === "view";
      pane.setAttribute("data-mode", ui.mode || "");
      pane.setAttribute("data-ab", ui.ab);
      if (view) {
        figs.B.el.setAttribute("hidden", "");
        figs.A.el.removeAttribute("hidden");
        figs.A.caption.textContent = "v" + (a ? a.n : "?") + ", read-only";
        figs.A.frame.setAttribute("title", "Version " + (a ? a.n : "?") + " of the " + docNoun() + ", read-only");
        return;
      }
      figs.A.el.removeAttribute("hidden");
      figs.B.el.removeAttribute("hidden");
      figs.A.caption.textContent = "A · v" + (a ? a.n : "?");
      figs.B.caption.textContent = "B · v" + (b ? b.n : "?") + ", marked against A";
      figs.A.frame.setAttribute("title", "Version A, v" + (a ? a.n : "?"));
      figs.B.frame.setAttribute("title", "Version B, v" + (b ? b.n : "?") + ", marked against A");
    }

    function renderChanges() {
      clear(changes);
      if (ui.mode !== "compare") { changes.setAttribute("hidden", ""); return; }
      changes.removeAttribute("hidden");
      var a = byId(ui.a);
      var b = byId(ui.b);
      var head = "What changed from v" + (a ? a.n : "?") + " to v" + (b ? b.n : "?");
      changes.appendChild(h("h3", { class: "scribe__compare-head", text: head }));
      if (ui.diffError) {
        changes.appendChild(h("p", { class: "scribe__compare-note", "data-tone": "error", text: ui.diffError }));
        return;
      }
      if (!ui.diff) {
        changes.appendChild(h("p", { class: "scribe__compare-note", text: "Reading both versions…" }));
        return;
      }
      if (!ui.diff.length) {
        changes.appendChild(h("p", { class: "scribe__compare-note", text: ui.a === ui.b ? "A and B are the same version." : "The wording is the same in both versions." }));
        return;
      }
      var list = h("ol", { class: "scribe__compare-list" });
      ui.diff.forEach(function (block) {
        var text = h("p", { class: "scribe__compare-text" });
        block.parts.forEach(function (p) {
          if (p.kind === "same") { text.appendChild(doc.createTextNode(p.text)); return; }
          text.appendChild(h(p.kind, {}, [
            h("span", { class: "scribe__sr", text: p.kind === "ins" ? "inserted: " : "deleted: " }),
            p.text,
            h("span", { class: "scribe__sr", text: p.kind === "ins" ? " end inserted" : " end deleted" }),
          ]));
        });
        var tally = [];
        if (block.added) tally.push("+" + block.added);
        if (block.removed) tally.push("−" + block.removed);
        list.appendChild(h("li", { class: "scribe__compare-item", "data-block": block.id, "data-change": block.change }, [
          h("p", { class: "scribe__compare-label" }, [
            h("span", { text: block.label + (block.change === "added" ? " (new in B)" : (block.change === "removed" ? " (gone in B)" : "")) }),
            h("span", { class: "scribe__compare-tally", text: tally.join(" ") + " words" }),
          ]),
          text,
        ]));
      });
      changes.appendChild(list);
    }

    function summaryText() {
      if (!ui.diff) return "";
      if (!ui.diff.length) return "No wording differs.";
      var added = 0;
      var removed = 0;
      ui.diff.forEach(function (d) { added += d.added; removed += d.removed; });
      return plural(ui.diff.length, "block") + " differ, +" + added + " −" + removed + " words.";
    }

    function renderLabel() {
      var a = byId(ui.a);
      var b = byId(ui.b);
      var noun = docNoun();
      var label = ui.mode === "view"
        ? noun.charAt(0).toUpperCase() + noun.slice(1) + ", version " + (a ? a.n : "?") + ", read-only"
        : "Comparing " + noun + " v" + (a ? a.n : "?") + " with v" + (b ? b.n : "?") + (ui.diff ? ". " + summaryText() : "");
      pane.setAttribute("aria-label", label);
    }

    function render() {
      if (!ui.mode) {
        pane.setAttribute("hidden", "");
        r.docscroll.removeAttribute("hidden");
        return;
      }
      r.docscroll.setAttribute("hidden", "");
      pane.removeAttribute("hidden");
      renderBar();
      renderFigs();
      renderChanges();
      renderLabel();
    }

    function syncHeader() {
      var btn = ui.compareBtn;
      if (!btn) return;
      btn.setAttribute("aria-pressed", ui.mode === "compare" ? "true" : "false");
      btn.setAttribute("aria-disabled", versions().length < 2 ? "true" : "false");
    }

    /* ---------- modes ---------- */

    function enter(mode, a, b, opener) {
      var token = ++ui.token;
      var wasOpen = !!ui.mode;
      ui.mode = mode;
      ui.forDoc = ctl.state.doc;
      ui.a = a;
      ui.b = b;
      ui.ab = "B";
      ui.diff = null;
      ui.diffError = null;
      if (!wasOpen) ui.opener = opener || null;
      if (!figs) buildFigs();
      if (ctl.isNarrow()) ctl.setSeg("doc");
      render();
      syncHeader();
      if (!wasOpen) root.addEventListener("resize", fitAll);
      if (mode === "view") {
        loadFig(figs.A, a, "A", token);
        announce("Viewing version " + byId(a).n + ", read-only.");
      } else {
        loadFig(figs.A, a, "A", token);
        loadFig(figs.B, b, "B", token);
        Promise.all([modelNodes(a), modelNodes(b)]).then(function (pair) {
          if (token !== ui.token) return;
          ui.diff = diffNodes(pair[0], pair[1]);
          if (figs) {
            markFrame(figs.A, ui.diff, "A");
            markFrame(figs.B, ui.diff, "B");
          }
          renderChanges();
          renderLabel();
          announce("Comparing v" + byId(a).n + " with v" + byId(b).n + ". " + summaryText());
        }, function (err) {
          if (token !== ui.token) return;
          ui.diffError = (err && err.message) || "The versions could not be read, so nothing is marked.";
          renderChanges();
        });
      }
      if (typeof pane.focus === "function") pane.focus();
    }

    function exit(opts) {
      if (!ui.mode) return;
      ui.token++;
      ui.mode = null;
      ui.diff = null;
      root.removeEventListener("resize", fitAll);
      unwatchAll();
      clear(pages);
      figs = null;
      render();
      syncHeader();
      if (typeof ctl.onResize === "function") ctl.onResize();
      if (opts && opts.silent) return;
      var back = ui.opener && within(r.sheet, ui.opener) ? ui.opener : r.docscroll;
      ui.opener = null;
      if (back && typeof back.focus === "function") back.focus();
    }

    function within(ancestor, node) {
      for (var n = node; n; n = n.parentNode) if (n === ancestor) return true;
      return false;
    }

    function announce(msg, assertive) { deps.announce(msg, assertive); }

    function compareWith(runId, opener) {
      var cur = current();
      if (!cur) return;
      var a = byId(runId) || before(cur);
      if (a && a.runId === cur.runId) a = before(cur);
      if (!a) { announce("Compare needs two versions.", true); return; }
      enter("compare", a.runId, cur.runId, opener);
    }

    ui.toggleCompare = function (opener) {
      if (ui.mode === "compare") { exit(); return; }
      if (versions().length < 2) { announce("Compare needs two versions."); return; }
      if (ctl.state.busy) { announce("Wait for Scribe to finish, or press Stop.", true); return; }
      compareWith(null, opener || doc.activeElement);
    };

    ui.view = function (runId, opener) {
      if (!byId(runId)) return;
      enter("view", runId, null, opener);
    };

    ui.exit = exit;
    ui.isActive = function () { return !!ui.mode; };
    ui.state = function () { return { mode: ui.mode, a: ui.a, b: ui.b, ab: ui.ab, confirm: ui.confirm }; };

    /* ---------- bring back ---------- */

    function focusIn(el, selector) {
      var target = el && el.querySelector ? el.querySelector(selector) : null;
      if (target && typeof target.focus === "function") target.focus();
    }

    function askBringBack(runId) {
      var v = byId(runId);
      if (!v || v.runId === ctl.state.currentRunId) return;
      if (ctl.state.busy) { announce("Wait for Scribe to finish, or press Stop.", true); return; }
      if (ui.mode) exit({ silent: true });
      ui.confirm = runId;
      if (ctl.isNarrow()) ctl.setSeg("versions");
      else ctl.setSide("versions");
      deps.renderVersions();
      focusIn(r.versions, '[data-ver-act="confirm"]');
    }

    function cancelBringBack() {
      var runId = ui.confirm;
      ui.confirm = null;
      deps.renderVersions();
      focusIn(r.versions, '[data-ver-act="bring"][data-run="' + runId + '"]');
    }

    function confirmBringBack() {
      var runId = ui.confirm;
      var v = byId(runId);
      if (!v || ui.restoring) return;
      ui.restoring = true;
      deps.renderVersions();
      ctl.api.restore(runId).then(function (res) {
        ui.restoring = false;
        ui.confirm = null;
        /* Only now that a new run exists is the open proposal stale; a
           failed restore leaves it open (Grok F3-discard). */
        var p = ctl.state.proposal;
        if (p && p.id) ctl.api.rejectEdit(p.id).catch(function () { /* the proposal was never saved */ });
        if (ctl.closed) return null;
        var n = res && res.run && typeof res.run.n === "number" ? res.run.n : null;
        var msg = "Brought back v" + v.n + (n != null ? " as v" + n : " as a new version") + ". Nothing was deleted.";
        deps.logMessage("note", [msg]);
        announce(msg);
        return deps.reload().then(function () {
          focusIn(r.versions, '[aria-current="true"] button');
        });
      }).catch(function (err) {
        ui.restoring = false;
        if (ctl.closed) return;
        deps.renderVersions();
        var msg = "Bring back didn’t save" + (err && err.message ? ": " + err.message : ".") +
          (ctl.state.proposal ? " Your versions and open proposal are unchanged." : " Your versions are unchanged.");
        deps.logMessage("blocked", [msg]);
        announce(msg, true);
        focusIn(r.versions, '[data-ver-act="confirm"]');
      });
    }

    /* ---------- per row (called from renderVersions) ---------- */

    ui.rowParts = function (v) {
      var isCur = v.runId === ctl.state.currentRunId;
      var tag = h("span", { class: "scribe__compare-src", "data-source": v.source || "", text: sourceLabel(v) });
      var acts = h("span", { class: "scribe__compare-rowacts" });
      if (!isCur) {
        acts.appendChild(h("button", { type: "button", class: "scribe__btn scribe__btn--ghost scribe__btn--small", "data-ver-act": "view", "data-run": v.runId, "aria-label": "View v" + v.n + ", read-only", text: "View" }));
      }
      var compareLabel = isCur ? "Compare v" + v.n + " with the version before it" : "Compare v" + v.n + " with current";
      acts.appendChild(h("button", {
        type: "button", class: "scribe__btn scribe__btn--ghost scribe__btn--small", "data-ver-act": "compare", "data-run": v.runId,
        "aria-label": compareLabel, "aria-disabled": versions().length < 2 ? "true" : null, text: "Compare",
      }));
      if (!isCur) {
        acts.appendChild(h("button", { type: "button", class: "scribe__btn scribe__btn--ghost scribe__btn--small", "data-ver-act": "bring", "data-run": v.runId, "aria-label": "Bring back v" + v.n + " as a new version", "aria-expanded": ui.confirm === v.runId ? "true" : "false", text: "Bring back" }));
      }
      var confirm = null;
      if (ui.confirm === v.runId) {
        var top = versions()[0];
        var next = top ? top.n + 1 : null;
        var cur = current();
        confirm = h("div", { class: "scribe__compare-confirm", role: "group", "aria-label": "Bring back v" + v.n }, [
          h("p", { text: "Bring back v" + v.n + " as " + (next != null ? "v" + next : "a new version") + "? " +
            (cur ? "v" + cur.n + " and every other version stay in the list." : "Every version stays in the list.") +
            (ctl.state.proposal ? " The open proposal will be discarded." : "") }),
          h("div", { class: "scribe__compare-acts" }, [
            h("button", { type: "button", class: "scribe__btn scribe__btn--small scribe__btn--primary", "data-ver-act": "confirm", "data-run": v.runId, "aria-disabled": ui.restoring ? "true" : null, text: ui.restoring ? "Bringing back…" : "Bring back as " + (next != null ? "v" + next : "new") }),
            h("button", { type: "button", class: "scribe__btn scribe__btn--small", "data-ver-act": "cancel", "data-run": v.runId, text: "Cancel" }),
          ]),
        ]);
      }
      return { tag: tag, acts: acts, confirm: confirm };
    };

    /* After each versions render: leave compare when its document or
       versions went away, or when a new request starts. */
    ui.sync = function () {
      if (ui.mode) {
        var gone = ui.forDoc !== ctl.state.doc || !byId(ui.a) || (ui.mode === "compare" && !byId(ui.b));
        if (gone || ctl.state.busy) exit({ silent: true });
        else if (ui.mode === "compare") { renderBar(); renderFigs(); }
      }
      if (ui.confirm && !byId(ui.confirm)) ui.confirm = null;
      syncHeader();
    };

    /* ---------- events ---------- */

    function onClick(e) {
      for (var t = e.target; t && t !== r.host; t = t.parentNode) {
        if (!t.getAttribute) continue;
        if (t.getAttribute("aria-disabled") === "true" && (t.hasAttribute("data-ver-act") || t.hasAttribute("data-ver-compare"))) {
          if (t.hasAttribute("data-ver-compare") || t.getAttribute("data-ver-act") === "compare") announce("Compare needs two versions.");
          return;
        }
        if (t.hasAttribute("data-ver-compare")) { ui.toggleCompare(t); return; }
        var act = t.getAttribute("data-ver-act");
        var run = t.getAttribute("data-run");
        if (act === "view") { ui.view(run, t); return; }
        if (act === "compare") { compareWith(run, t); return; }
        if (act === "bring") { if (ui.confirm === run) cancelBringBack(); else askBringBack(run); return; }
        if (act === "confirm") { confirmBringBack(); return; }
        if (act === "cancel") { cancelBringBack(); return; }
        var cmp = t.getAttribute("data-cmp-act");
        if (cmp === "exit") { exit(); return; }
        if (cmp === "compare") { compareWith(ui.a, ui.opener); return; }
        if (cmp === "bring") { askBringBack(ui.a); return; }
        var ab = t.getAttribute("data-ab");
        if (ab === "A" || ab === "B") { pickAb(ab); return; }
      }
    }

    function pickAb(ab) {
      ui.ab = ab;
      renderBar();
      renderFigs();
      fitAll();
      focusIn(bar, '[data-ab="' + ab + '"]');
    }

    function onChange(e) {
      var t = e.target;
      var which = t && t.getAttribute ? t.getAttribute("data-cmp-pick") : null;
      if (!which || ui.mode !== "compare") return;
      var a = which === "A" ? t.value : ui.a;
      var b = which === "B" ? t.value : ui.b;
      enter("compare", a, b);
      focusIn(bar, '[data-cmp-pick="' + which + '"]');
    }

    function onKey(e) {
      var t = e.target;
      if (!t || !t.getAttribute || !t.getAttribute("data-ab")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        pickAb(e.key === "ArrowLeft" || e.key === "Home" ? "A" : "B");
      }
    }

    r.host.addEventListener("click", onClick);
    pane.addEventListener("change", onChange);
    pane.addEventListener("keydown", onKey);
    root.addEventListener("jb:scribe:closed", function onClosed() {
      root.removeEventListener("jb:scribe:closed", onClosed);
      root.removeEventListener("resize", fitAll);
      unwatchAll();
      ui.token++;
    });

    ui.pane = pane;
    return ui;
  }

  root.JBScribeVersions = {
    attach: attach,
    diffWords: diffWords,
    diffNodes: diffNodes,
    nodesForDoc: nodesForDoc,
    sourceLabel: sourceLabel,
    tokenize: tokenize,
  };
})(typeof window !== "undefined" ? window : globalThis);
