/* ============================================================
   jb-text.js — shared text normalization for the v2 UI
   ------------------------------------------------------------
   Pure functions, no DOM. Single owner of entity decoding,
   Markdown demotion, block parsing, and safe clipping for
   role-brief.js, role.js, dawn-data.js, pipeline-render.js,
   and job-posting-insights.js. Server mirror:
   server/shared/text-normalize.mjs (spec §4).
   Load order: BEFORE jb-ui.js in index.html (defer chain).
   ============================================================ */

(function (root) {
  "use strict";

  var NAMED_ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    nbsp: " ", ndash: "–", mdash: "—",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    hellip: "…", bull: "•", middot: "·", sect: "§",
    copy: "©", reg: "®", trade: "™", deg: "°",
    laquo: "«", raquo: "»", times: "×", divide: "÷",
    euro: "€", pound: "£", yen: "¥", cent: "¢",
    frac12: "½", frac14: "¼", plusmn: "±",
    eacute: "é", egrave: "è", agrave: "à",
    auml: "ä", ouml: "ö", uuml: "ü",
    ccedil: "ç", ntilde: "ñ",
  };

  var ENTITY_RE = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([a-zA-Z]{2,10}));/g;
  var ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060]/g;
  var CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  var BULLET_RE = /^(?:[-*•·‣▪–—]|\d{1,2}[.)])\s+/;

  /* Single pass ⇒ single-level: "&amp;lt;" → "&lt;", never "<". (Spec D2.) */
  function decodeEntities(s) {
    if (s == null) return "";
    return String(s).replace(ENTITY_RE, function (m, dec, hex, name) {
      if (name) {
        var hit = Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
          ? NAMED_ENTITIES[name]
          : NAMED_ENTITIES[name.toLowerCase()];
        return hit != null ? hit : m;
      }
      var n = dec ? Number(dec) : parseInt(hex, 16);
      if (!Number.isFinite(n) || (n < 32 && n !== 9 && n !== 10) || n > 0x10ffff) return m;
      try { return String.fromCodePoint(n); } catch (e) { return m; }
    });
  }

  function stripMarkdownInline(s) {
    var t = String(s == null ? "" : s);
    t = t.replace(/\[([^\]]+)\]\((\S+?)\)/g, "$1 ($2)");
    t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
    t = t.replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?])/g, "$1$2");
    t = t.replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,;:!?])/g, "$1$2");
    t = t.replace(/`([^`\n]+)`/g, "$1");
    return t;
  }

  function stripListGlyph(s) {
    return String(s == null ? "" : s).replace(/^\s*(?:[-*•·‣▪–—]|\d{1,4}[.)])\s+/, "");
  }

  function itemText(x) {
    if (x == null) return "";
    if (typeof x === "string") return x;
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    if (typeof x === "object") {
      var keys = ["text", "name", "value", "label", "title"];
      for (var i = 0; i < keys.length; i++) {
        var v = x[keys[i]];
        if (typeof v === "string" && v.trim()) return v;
      }
      return "";
    }
    return "";
  }

  function normalizeInline(s) {
    var t = decodeEntities(s);
    t = t.replace(ZERO_WIDTH_RE, "").replace(CONTROL_RE, " ");
    t = t.replace(/[\r\n\t\u00A0]+/g, " ");
    t = stripMarkdownInline(t);
    return t.replace(/ {2,}/g, " ").trim();
  }

  function normalizeMultiline(s) {
    var t = decodeEntities(s);
    t = t.replace(/\r\n?/g, "\n");
    t = t.replace(ZERO_WIDTH_RE, "").replace(CONTROL_RE, " ");
    t = t.replace(/\u00A0/g, " ");
    t = t.split("\n").map(function (line) {
      return stripMarkdownInline(line).replace(/[ \t]+/g, " ").replace(/[ \t]+$/, "");
    }).join("\n");
    return t.replace(/\n{3,}/g, "\n\n").trim();
  }

  function _isAllCapsHeading(line) {
    if (line.length < 3 || line.length > 60) return false;
    if (!/[A-Z]/.test(line)) return false;
    return line === line.toUpperCase() && !/[.?!]$/.test(line);
  }

  function _headingOf(first) {
    if (BULLET_RE.test(first)) return null;
    var md = /^#{1,6}\s+(.*)$/.exec(first);
    if (md) return md[1].trim();
    if (first.length <= 80 && /:$/.test(first)) return first.replace(/:$/, "").trim();
    if (_isAllCapsHeading(first)) return first;
    return null;
  }

  function toBlocks(s) {
    var text = normalizeMultiline(s);
    if (!text) return [];
    var out = [];
    text.split(/\n{2,}/).forEach(function (raw) {
      var lines = raw.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var heading = _headingOf(lines[0]);
      if (heading != null) {
        out.push({ kind: "heading", text: heading });
        lines = lines.slice(1);
      }
      var para = [];
      var items = null;
      function flushPara() {
        if (para.length) { out.push({ kind: "p", text: para.join(" ") }); para = []; }
      }
      lines.forEach(function (line) {
        if (BULLET_RE.test(line)) {
          flushPara();
          if (!items) items = [];
          items.push(stripListGlyph(line));
        } else if (items) {
          /* wrapped continuation of the previous bullet */
          items[items.length - 1] += " " + line;
        } else {
          para.push(line);
        }
      });
      flushPara();
      if (items && items.length) out.push({ kind: "bullets", items: items });
    });
    return out;
  }

  function clip(s, max) {
    var str = String(s == null ? "" : s);
    var n = Number(max);
    if (!Number.isFinite(n) || n <= 1 || str.length <= n) return str;
    var cut = str.slice(0, n - 1);
    var last = cut.charCodeAt(cut.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
    var sp = cut.lastIndexOf(" ");
    if (sp > 0 && sp >= cut.length - 24) cut = cut.slice(0, sp);
    cut = cut.replace(/[\s"'([{‘“.,;:·•–—-]+$/, "");
    return cut + "…";
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

  function escapeAttr(s) {
    return escapeHtml(s).replace(/\r/g, "").replace(/\n/g, "&#10;");
  }

  root.JobBoredText = {
    decodeEntities: decodeEntities,
    stripMarkdownInline: stripMarkdownInline,
    stripListGlyph: stripListGlyph,
    itemText: itemText,
    normalizeInline: normalizeInline,
    normalizeMultiline: normalizeMultiline,
    toBlocks: toBlocks,
    clip: clip,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
  };
})(typeof window !== "undefined" ? window : globalThis);
