/* ============================================================
   jb-text.js — shared text normalization for the v2 UI
   ------------------------------------------------------------
   Pure functions, no DOM. Single owner of entity decoding,
   Markdown demotion, block parsing, and safe clipping for
   role-case.js, role.js, dawn-data.js, pipeline-render.js,
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
  var FRAGMENT_STOP_WORDS = {
    a: 1, an: 1, and: 1, are: 1, as: 1, at: 1, be: 1, by: 1,
    for: 1, from: 1, in: 1, into: 1, of: 1, on: 1, or: 1, the: 1,
    to: 1, with: 1, using: 1, your: 1, our: 1, their: 1, you: 1, we: 1,
    will: 1, have: 1, has: 1, had: 1, this: 1, that: 1, these: 1,
    those: 1, years: 1, year: 1, plus: 1, strong: 1, ability: 1,
    abilities: 1, experience: 1, experienced: 1, knowledge: 1,
    understanding: 1, background: 1, preferred: 1, required: 1,
    requirement: 1, requirements: 1,
  };
  var FALLBACK_KNOWN_TOOLS = {
    ai: 1, api: 1, apis: 1, crm: 1, cdp: 1, sms: 1, js: 1, ts: 1,
    ml: 1, aws: 1, gcp: 1, k8s: 1, figma: 1, openai: 1, gemini: 1,
    grok: 1, llama: 1, react: 1, reactjs: 1, javascript: 1,
    typescript: 1, node: 1, nodejs: 1, python: 1, kubernetes: 1,
    postgresql: 1, postgres: 1, statsig: 1,
  };

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

  function stripControlTokens(s) {
    return String(s == null ? "" : s)
      .replace(/\[?<\|[^\r\n]*?\|>/g, " ")
      .replace(/\[?<\|/g, " ")
      .replace(/\|>/g, " ")
      .replace(/\[</g, " ")
      .replace(/>\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function fragmentKey(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/\bnode\.js\b/g, "nodejs")
      .replace(/\breact\.js\b/g, "reactjs")
      .replace(/[^a-z0-9+#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function knownTool(s) {
    var key = fragmentKey(s);
    if (FALLBACK_KNOWN_TOOLS[key]) return true;
    var aliases = root.JobBoredApp && root.JobBoredApp.keywordMatch && root.JobBoredApp.keywordMatch.KNOWN_TOOL_ALIASES;
    return Array.isArray(aliases) && aliases.some(function (alias) { return fragmentKey(alias) === key; });
  }

  function significantTokens(s) {
    return fragmentKey(s).split(" ").filter(function (token) {
      return token && (token.length > 1 || /\d/.test(token)) && !FRAGMENT_STOP_WORDS[token];
    });
  }

  /* One fragment rule: broken delimiters; short lowercase continuations;
     dangling conjunction/punctuation; or fewer than two meaningful tokens
     unless the whole value is a known analyzer tool alias. */
  function isFragment(s) {
    var text = stripControlTokens(s);
    if (!text) return true;
    var opens = (text.match(/\(/g) || []).length;
    var closes = (text.match(/\)/g) || []).length;
    var straightQuotes = (text.match(/"/g) || []).length;
    var curlyOpens = (text.match(/“/g) || []).length;
    var curlyCloses = (text.match(/”/g) || []).length;
    if (opens !== closes || straightQuotes % 2 || curlyOpens !== curlyCloses) return true;
    var tokens = significantTokens(text);
    if (knownTool(text)) return false;
    if (/^[a-z]/.test(text) && tokens.length < 3) return true;
    if (/(?:[,;]|\b(?:and|or))\s*$/i.test(text)) return true;
    return tokens.length < 2;
  }

  function splitHeadingTail(s) {
    var text = String(s == null ? "" : s).trim();
    var match = /^([\s\S]*[.!?])\s+([^.!?]+)$/.exec(text);
    if (!match) return { body: text, heading: "" };
    var words = match[2].match(/[A-Za-z0-9][A-Za-z0-9/+.-]*/g) || [];
    if (!words.length || words.length > 6) return { body: text, heading: "" };
    var titleWords = words.filter(function (word) { return /^[A-Z]/.test(word); }).length;
    if (titleWords / words.length < 0.6) return { body: text, heading: "" };
    return { body: match[1].trim(), heading: match[2].trim() };
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
    stripControlTokens: stripControlTokens,
    isFragment: isFragment,
    splitHeadingTail: splitHeadingTail,
    toBlocks: toBlocks,
    clip: clip,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
  };
})(typeof window !== "undefined" ? window : globalThis);
