/* ============================================================
   scribe-v2-diff.js — Scribe v2 diff and suggesting-mode marks
   (EDITOR lane F2)
   ------------------------------------------------------------
   Spec: docs/programs/editor-20260927/SPEC.md §2 (Proposal,
         Accept or reject, Guards), §3.5, §4 (tokens).

   Pure parts (no DOM):
     tokenize(text)          words, whitespace runs, single punctuation;
                             figures such as 38%, $4.1M and 2.3M stay whole.
     diffWords(a, b)         word-level Myers diff, A → B. Unchanged gaps of
                             two words or fewer between two changes fold into
                             the change, so a reworded phrase reads as one
                             mark instead of confetti. Returns
                             [{kind: "same"|"del"|"ins", text, a?}]; `text`
                             is B's wording, and a "same" part whose A
                             wording differs only in whitespace carries A's
                             in `a`.
     changesFromOps(ops, textOf)
                             the structural diff of a proposal by node id:
                             one change per op, with its glyph (~ + −),
                             word parts and word tallies.
     summarize(changes, decisions, baseWords)
                             counts, the words delta and the loss meter for
                             what would be saved now (rejected changes drop
                             out).

   DOM parts (run by the desk against the preview's script-less frame):
     markElement(el, parts)  rewrites a block in place with <ins>/<del> and
                             screen-reader "inserted: … end inserted" text.
                             It walks the block's own text nodes, so inline
                             template markup (a bold metric, a neutral span)
                             survives around the marks.
     unmarkElement(el)       puts the block back as it was.
     markStyles(tokenValue)  the one stylesheet for marks inside a frame.

   Publishes: window.JBScribeDiff.
   ============================================================ */

(function (root) {
  "use strict";

  if (!root || typeof root !== "object") return;

  var GAP_WORDS = 2;
  /* Past this many tokens on both sides, or this many edits, the block is
     shown as one replacement: cheaper and just as readable. */
  var MAX_TOKENS = 4000;
  var MAX_EDITS = 1200;

  var TOKEN_RE = /[A-Za-z0-9À-ɏ$]+(?:['’.,\-/][A-Za-z0-9À-ɏ]+)*%?|\s+|[^\sA-Za-z0-9À-ɏ$]/g;
  var WORD_RE = /[A-Za-z0-9À-ɏ]/;

  function tokenize(text) {
    return String(text == null ? "" : text).match(TOKEN_RE) || [];
  }

  function wordCount(text) {
    return tokenize(text).filter(function (t) { return WORD_RE.test(t); }).length;
  }

  /* Whitespace runs compare equal whatever their shape, so a template's
     line breaks never read as an edit. */
  function keyOf(tok) {
    return /^\s+$/.test(tok) ? " " : tok;
  }

  /* ---------------- Myers ---------------- */

  /* Myers' O(ND) shortest edit script over token keys → steps
     [{k: "="|"-"|"+", a?, b?}] in order. Null when the input is too big. */
  function myers(a, b) {
    var n = a.length;
    var m = b.length;
    var max = n + m;
    if (n > MAX_TOKENS || m > MAX_TOKENS) return null;
    var off = max + 1;
    var v = new Array(2 * max + 3);
    for (var f = 0; f < v.length; f++) v[f] = 0;
    var trace = [];
    var found = false;
    for (var d = 0; d <= max && !found; d++) {
      if (d > MAX_EDITS) return null;
      trace.push(v.slice());
      for (var k = -d; k <= d; k += 2) {
        var x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
        var y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) { found = true; break; }
      }
    }
    var steps = [];
    var cx = n;
    var cy = m;
    for (var t = trace.length - 1; t >= 0; t--) {
      var vt = trace[t];
      var ck = cx - cy;
      var pk = (ck === -t || (ck !== t && vt[off + ck - 1] < vt[off + ck + 1])) ? ck + 1 : ck - 1;
      var px = vt[off + pk];
      var py = px - pk;
      while (cx > px && cy > py) { steps.push({ k: "=", a: cx - 1, b: cy - 1 }); cx--; cy--; }
      if (t > 0) {
        if (cx === px) steps.push({ k: "+", b: cy - 1 });
        else steps.push({ k: "-", a: cx - 1 });
      }
      cx = px;
      cy = py;
    }
    return steps.reverse();
  }

  /* ---------------- Word diff ---------------- */

  function diffWords(a, b) {
    var at = tokenize(a);
    var bt = tokenize(b);
    var steps = myers(at.map(keyOf), bt.map(keyOf));
    if (!steps) {
      steps = [];
      at.forEach(function (tok, i) { steps.push({ k: "-", a: i }); });
      bt.forEach(function (tok, i) { steps.push({ k: "+", b: i }); });
    }
    /* Runs: {same, a} for matches, {del, ins} for a cluster of edits (its
       deletions read before its insertions). */
    var segs = [];
    function top() { return segs[segs.length - 1]; }
    steps.forEach(function (s) {
      if (s.k === "=") {
        if (top() && top().same != null) { top().same += bt[s.b]; top().a += at[s.a]; }
        else segs.push({ same: bt[s.b], a: at[s.a] });
        return;
      }
      if (!top() || top().same != null) segs.push({ del: "", ins: "" });
      if (s.k === "-") top().del += at[s.a];
      else top().ins += bt[s.b];
    });
    /* Fold small gaps: change, gap of ≤2 words, change → one change. */
    var merged = [];
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var prev = merged[merged.length - 1];
      var next = segs[i + 1];
      if (seg.same != null && prev && prev.same == null && next && next.same == null && wordCount(seg.same) <= GAP_WORDS) {
        prev.del += seg.a + next.del;
        prev.ins += seg.same + next.ins;
        i++;
        continue;
      }
      merged.push(seg.same != null ? { same: seg.same, a: seg.a } : { del: seg.del, ins: seg.ins });
    }
    var parts = [];
    function same(text, aText) {
      var last = parts[parts.length - 1];
      if (last && last.kind === "same") {
        last.a = (last.a != null ? last.a : last.text) + aText;
        last.text += text;
        if (last.a === last.text) delete last.a;
        return;
      }
      parts.push(aText === text ? { kind: "same", text: text } : { kind: "same", text: text, a: aText });
    }
    merged.forEach(function (seg) {
      if (seg.same != null) { same(seg.same, seg.a); return; }
      /* A change that only moves whitespace is not a change a reader sees. */
      if (!seg.del.trim() && !seg.ins.trim()) { same(seg.ins, seg.del); return; }
      if (seg.del) parts.push({ kind: "del", text: seg.del });
      if (seg.ins) parts.push({ kind: "ins", text: seg.ins });
    });
    return parts;
  }

  /* ---------------- Proposal → changes ---------------- */

  var GLYPH = { replace: "~", insert: "+", remove: "−" };

  /* One change per op, in op order. `textOf(nodeId)` answers a block's
     current wording (null when the template doesn't render it). */
  function changesFromOps(ops, textOf) {
    return (ops || []).map(function (op) {
      var kind = GLYPH[op.op] ? op.op : "replace";
      var before = kind === "insert" ? "" : String((textOf && textOf(op.node)) || "");
      var after = kind === "remove" ? "" : String(op.text || "");
      var parts = kind === "replace" ? diffWords(before, after)
        : (kind === "insert" ? [{ kind: "ins", text: after }] : [{ kind: "del", text: before }]);
      var added = 0;
      var removed = 0;
      parts.forEach(function (p) {
        if (p.kind === "ins") added += wordCount(p.text);
        if (p.kind === "del") removed += wordCount(p.text);
      });
      var flags = Array.isArray(op.flags) ? op.flags : [];
      return {
        opId: op.opId,
        op: op,
        kind: kind,
        glyph: GLYPH[kind],
        node: kind === "insert" ? op.after : op.node,
        before: before,
        after: after,
        parts: parts,
        added: added,
        removed: removed,
        delta: wordCount(after) - wordCount(before),
        unverified: flags.indexOf("unverified") >= 0,
      };
    });
  }

  /* What saving now would do. Pending changes count as proposed; the
     loss meter is words removed (a removal, or a replacement that is
     shorter) over the document's words, as the server measures it. */
  function summarize(changes, decisions, baseWords) {
    var out = { changes: 0, removals: 0, pending: 0, accepted: 0, rejected: 0, unverified: 0, wordsDelta: 0, lossWords: 0, lossPct: 0 };
    (changes || []).forEach(function (c) {
      var st = (decisions && decisions[c.opId]) || "pending";
      out.changes++;
      if (c.kind === "remove") out.removals++;
      out[st]++;
      if (st === "pending" && c.unverified) out.unverified++;
      if (st === "rejected") return;
      out.wordsDelta += c.delta;
      out.lossWords += Math.max(0, -c.delta);
    });
    out.lossPct = baseWords > 0 ? Math.round(out.lossWords / baseWords * 100) : 0;
    return out;
  }

  /* ---------------- Marks in a document ---------------- */

  function kidsOf(node) {
    var list = node.childNodes || node.children || [];
    return Array.prototype.slice.call(list);
  }

  function isText(node) {
    return node.nodeType === 3 || node.tagName === "#TEXT";
  }

  function nodeText(node) {
    return isText(node) ? String(node.nodeValue != null ? node.nodeValue : node.textContent) : "";
  }

  function markTag(doc, kind, text) {
    var tag = doc.createElement(kind);
    tag.className = "scribe-mark";
    var sr = doc.createElement("span");
    sr.className = "scribe-mark-sr";
    sr.textContent = kind === "ins" ? "inserted: " : "deleted: ";
    var end = doc.createElement("span");
    end.className = "scribe-mark-sr";
    end.textContent = kind === "ins" ? " end inserted" : " end deleted";
    tag.appendChild(sr);
    tag.appendChild(doc.createTextNode(text));
    tag.appendChild(end);
    return tag;
  }

  /* Rewrite `el` so its text reads as `parts` (from diffWords(el's text,
     new text)). Parts consume the block's current text in order: "same"
     and "del" spans are cut out of the existing text nodes where they
     sit, and each "ins" goes in at its position. Elements inside the
     block are kept and marked from within. Returns how many marks were
     written. */
  function markElement(el, parts) {
    var doc = el.ownerDocument;
    var queue = [];
    (parts || []).forEach(function (p) {
      var len = p.kind === "ins" ? 0 : String(p.kind === "same" && p.a != null ? p.a : p.text).length;
      queue.push({ kind: p.kind, text: p.text, len: len });
    });
    var qi = 0;
    var used = 0; /* characters of queue[qi] already consumed */
    var marks = 0;

    function emitInserts(out) {
      while (qi < queue.length && queue[qi].kind === "ins") {
        out.push(markTag(doc, "ins", queue[qi].text));
        marks++;
        qi++;
      }
    }

    function rebuild(node) {
      var out = [];
      kidsOf(node).forEach(function (kid) {
        if (!isText(kid)) {
          emitInserts(out);
          rebuild(kid);
          out.push(kid);
          return;
        }
        var t = nodeText(kid);
        var pos = 0;
        while (pos < t.length) {
          emitInserts(out);
          if (qi >= queue.length) { out.push(doc.createTextNode(t.slice(pos))); pos = t.length; break; }
          var part = queue[qi];
          var take = Math.min(part.len - used, t.length - pos);
          var piece = t.slice(pos, pos + take);
          if (part.kind === "del") { out.push(markTag(doc, "del", piece)); marks++; }
          else out.push(doc.createTextNode(piece));
          pos += take;
          used += take;
          if (used >= part.len) { qi++; used = 0; }
        }
      });
      while (node.firstChild) node.removeChild(node.firstChild);
      out.forEach(function (child) { node.appendChild(child); });
    }

    rebuild(el);
    /* Insertions at the very end of the block. */
    var tail = [];
    emitInserts(tail);
    tail.forEach(function (child) { el.appendChild(child); });
    return marks;
  }

  /* A new block, made from a copy of its neighbour (so it sits in the
     template's own structure, such as Dossier's kicker + text grid):
     the copy's longest run of text, its content, becomes the insertion,
     and its other text goes. A metric kicker such as Dossier's
     <span class="k">38%</span> is a shorter run, so it is emptied, not
     written into. Returns 1. */
  function markInserted(el, text) {
    var doc = el.ownerDocument;
    var placed = false;
    var content = null;
    (function find(node) {
      kidsOf(node).forEach(function (kid) {
        if (!isText(kid)) { find(kid); return; }
        var len = nodeText(kid).trim().length;
        if (len && (!content || len > nodeText(content).trim().length)) content = kid;
      });
    })(el);
    function fill(node) {
      var out = [];
      kidsOf(node).forEach(function (kid) {
        if (!isText(kid)) { fill(kid); out.push(kid); return; }
        if (!nodeText(kid).trim()) { out.push(kid); return; }
        if (kid === content) { out.push(markTag(doc, "ins", text)); placed = true; }
      });
      while (node.firstChild) node.removeChild(node.firstChild);
      out.forEach(function (child) { node.appendChild(child); });
    }
    fill(el);
    if (!placed) el.appendChild(markTag(doc, "ins", text));
    return 1;
  }

  function hasClass(node, name) {
    var cls = node.getAttribute ? node.getAttribute("class") : null;
    return !!cls && (" " + cls + " ").indexOf(" " + name + " ") >= 0;
  }

  /* Undo markElement: drop insertions and stubs, return deleted text to
     plain text, and clear the block's review attributes. */
  function unmarkElement(el) {
    var doc = el.ownerDocument;
    function restore(node) {
      var out = [];
      kidsOf(node).forEach(function (kid) {
        if (isText(kid)) { out.push(kid); return; }
        if (hasClass(kid, "scribe-stub")) return;
        if (hasClass(kid, "scribe-mark")) {
          if (String(kid.tagName).toLowerCase() === "del") {
            var text = kidsOf(kid).filter(function (k) { return !hasClass(k, "scribe-mark-sr"); })
              .map(function (k) { return k.textContent; }).join("");
            out.push(doc.createTextNode(text));
          }
          return;
        }
        restore(kid);
        out.push(kid);
      });
      while (node.firstChild) node.removeChild(node.firstChild);
      out.forEach(function (child) { node.appendChild(child); });
    }
    restore(el);
    ["data-scribe-op", "data-scribe-id", "data-scribe-state", "data-scribe-flag", "data-scribe-focus"].forEach(function (name) {
      el.removeAttribute(name);
    });
  }

  /* The mark stylesheet written into a preview frame. Colours come from
     the app's tokens (the frame can't read them), through tokenValue. */
  function markStyles(tokenValue) {
    function t(name, fallback) { return tokenValue ? tokenValue(name, fallback) : fallback; }
    var ins = t("--jb-mint-tint", "transparent");
    var inkAccent = t("--jb-accent-ink", "currentColor");
    var err = t("--jb-err", "currentColor");
    var pending = t("--jb-action", "currentColor");
    var accepted = t("--jb-mint", "currentColor");
    var warn = t("--jb-warn", "currentColor");
    var warnTint = t("--jb-warn-tint", "transparent");
    var line = t("--jb-line", "currentColor");
    var inkSoft = t("--jb-ink-2", "currentColor");
    return [
      "[data-scribe-selected]{outline:2px solid " + t("--jb-focus-color", pending) + ";outline-offset:2px;background:" + t("--jb-info-tint", "transparent") + "}",
      "[data-scribe-editing]{outline:2px solid " + pending + ";outline-offset:2px;background:" + t("--jb-paper", "white") + ";white-space:pre-wrap}",
      "ins.scribe-mark{text-decoration:none;background:" + ins + ";box-shadow:inset 0 -2px 0 " + inkAccent + ";border-radius:2px}",
      "del.scribe-mark{color:" + err + ";text-decoration:line-through;text-decoration-thickness:1.5px}",
      ".scribe-mark-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
      "[data-scribe-op]{box-shadow:-9px 0 0 -6px " + pending + ";scroll-margin:48px}",
      "[data-scribe-state=accepted]{box-shadow:-9px 0 0 -6px " + accepted + "}",
      "[data-scribe-state=rejected]{box-shadow:-9px 0 0 -6px " + line + "}",
      "[data-scribe-flag=unverified][data-scribe-state=pending]{box-shadow:-9px 0 0 -6px " + warn + ";background:" + warnTint + "}",
      "[data-scribe-focus]{outline:2px solid " + pending + ";outline-offset:2px;border-radius:2px}",
      /* Accepted reads as the new text, rejected as the old. */
      "[data-scribe-state=accepted] del.scribe-mark,[data-scribe-state=rejected] ins.scribe-mark{display:none}",
      "[data-scribe-state=accepted] ins.scribe-mark,[data-scribe-state=rejected] del.scribe-mark{background:none;box-shadow:none;color:inherit;text-decoration:none}",
      ".scribe-stub{display:none;font-style:italic;color:" + inkSoft + "}",
      "[data-scribe-op=remove][data-scribe-state=accepted] > :not(.scribe-stub){display:none}",
      "[data-scribe-op=remove][data-scribe-state=accepted] > .scribe-stub,[data-scribe-op=insert][data-scribe-state=rejected] > .scribe-stub{display:inline}",
      "[data-scribe-op=insert][data-scribe-state=rejected] > :not(.scribe-stub){display:none}",
      /* Show changes off: the clean proposed text, no marks. */
      "html.scribe-clean [data-scribe-op]{box-shadow:none;background:none;outline:none}",
      "html.scribe-clean del.scribe-mark{display:none}",
      "html.scribe-clean ins.scribe-mark{background:none;box-shadow:none}",
      "html.scribe-clean [data-scribe-state=rejected] del.scribe-mark{display:inline}",
      "html.scribe-clean [data-scribe-op=remove]:not([data-scribe-state=rejected]),html.scribe-clean [data-scribe-op=insert][data-scribe-state=rejected]{display:none}",
      "html.scribe-clean .scribe-stub{display:none}",
    ].join("\n");
  }

  root.JBScribeDiff = {
    tokenize: tokenize,
    wordCount: wordCount,
    diffWords: diffWords,
    changesFromOps: changesFromOps,
    summarize: summarize,
    markElement: markElement,
    markInserted: markInserted,
    unmarkElement: unmarkElement,
    markStyles: markStyles,
    GAP_WORDS: GAP_WORDS,
  };
})(typeof window !== "undefined" ? window : globalThis);
