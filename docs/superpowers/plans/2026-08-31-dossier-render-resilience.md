# Dossier & Brief Render Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Dossier/Brief pipeline render Markdown, HTML, entities, plain text, and structured lists cleanly at every stage — ingestion, transport, derivation, presentation — with no double-escaping, mid-word truncation, paragraph collapse, or lost user input.

**Architecture:** Two new pure-function text modules (`jb-text.js` for the browser, `server/shared/text-normalize.mjs` for Node) become the single owners of decoding, normalization, block parsing, and safe clipping. Consumers (`role-brief.js`, `role.js`, `dawn-data.js`, `pipeline-render.js`, `job-posting-insights.js`, scrapers) are converted stage by stage, presentation-first so users see fixes immediately even on legacy cached data.

**Tech Stack:** Vanilla JS classic-global IIFEs (browser), ESM (server), `node:test` + `node:vm` stub-DOM harness (existing convention), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-31-dossier-render-resilience-design.md` — read it first; tasks argue from it.

## Global Constraints

- Branch: cut `feat/dossier-render-resilience` from `main` (NOT from `feat/scraper-ats-json-lanes`; that branch has unrelated in-flight work). Use an isolated worktree via superpowers:using-git-worktrees.
- Test gate: `npm test` (runs `scripts/run-tests.mjs`, including `tests/integration/`). `node --test tests/foo.test.mjs` is fine for the inner loop; the full gate must be green before every commit.
- Frozen contracts (spec §7): all `jb:*` event names/shapes; every `data-*` attribute name and budget in `pipeline-render.js`; `.brief__*` class names asserted by `tests/dossier-brief-structure.test.mjs` and `tests/dossier-card-attrs.test.mjs`; Sheet Interface A.
- Design tokens in `style.css:159-177` must not change values.
- Client files are classic-global IIFEs (`(function (root) { ... })(typeof window !== "undefined" ? window : globalThis)`); match `var`-based style in `role*.js`/`dawn-data.js`, `const`/arrow style in `pipeline-render.js`/`job-posting-insights.js` (each file keeps its own idiom).
- No `push`/PR without explicit approval (CI-worthiness gate). Local commits after each green task.
- Transport budgets stay exactly: 240 (roleInOneLine), 1200 (postingSummary), 800 (fitAngle/fitAssessment), 500 (atsFitRationale), 4000 (jd-snippet), 16 items (arrays), 12/300 (struct display), 6 (talking points), 18 (chips), 160 (jdSnippet vm field).

---

## Phase 0 — Shared text foundations

New modules + tests only. Zero consumer changes; app behavior identical. Ships alone safely.

### Task 1: `jb-text.js` client module

**Files:**
- Create: `jb-text.js`
- Test: `tests/jb-text.test.mjs`
- Modify: `index.html` (add `<script src="jb-text.js" defer></script>` immediately BEFORE the `<script src="jb-ui.js" defer></script>` line, currently line 224 — defer order guarantees it executes before every consumer, including `pipeline-render.js?v=1` at ~line 1633)

**Interfaces:**
- Consumes: nothing (pure functions, no DOM).
- Produces: `window.JobBoredText` with `decodeEntities(s)`, `normalizeInline(s)`, `normalizeMultiline(s)`, `stripMarkdownInline(s)`, `stripListGlyph(s)`, `itemText(x)`, `toBlocks(s)` → `[{kind:"heading",text}|{kind:"p",text}|{kind:"bullets",items:[string]}]`, `clip(s, max)`, `escapeHtml(s)`, `escapeAttr(s)`. All later tasks depend on these exact names.

- [ ] **Step 1: Write the failing test**

```js
// tests/jb-text.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadJbText() {
  const src = readFileSync(join(repoRoot, "jb-text.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return sandbox.window.JobBoredText;
}
const T = loadJbText();

describe("decodeEntities", () => {
  it("decodes named, numeric, and hex entities exactly one level", () => {
    assert.equal(T.decodeEntities("Design &amp; Ship"), "Design & Ship");
    assert.equal(T.decodeEntities("&quot;quoted&quot; &#39;apos&#39;"), "\"quoted\" 'apos'");
    assert.equal(T.decodeEntities("A&nbsp;B &ndash; C&hellip;"), "A B – C…");
    assert.equal(T.decodeEntities("&#8217;s &#x2019;s"), "’s ’s");
    // single-level: double-encoded input surfaces the literal entity text
    assert.equal(T.decodeEntities("&amp;amp;"), "&amp;");
    assert.equal(T.decodeEntities("&amp;lt;p&amp;gt;"), "&lt;p&gt;");
  });
  it("leaves non-entities and unknown names untouched", () => {
    assert.equal(T.decodeEntities("AT&T R&D; 5 &up"), "AT&T R&D; 5 &up");
    assert.equal(T.decodeEntities("&notanentity;"), "&notanentity;");
  });
});

describe("stripMarkdownInline", () => {
  it("demotes emphasis, code, and links to plain text", () => {
    assert.equal(T.stripMarkdownInline("**5+ years** of *React* and `Node.js`"), "5+ years of React and Node.js");
    assert.equal(T.stripMarkdownInline("__bold__ and _ital_"), "bold and ital");
    assert.equal(T.stripMarkdownInline("[Apply here](https://x.co/a)"), "Apply here (https://x.co/a)");
  });
  it("never eats legitimate asterisks/underscores inside tokens", () => {
    assert.equal(T.stripMarkdownInline("C* algebra snake_case 2*3"), "C* algebra snake_case 2*3");
  });
});

describe("normalizeInline", () => {
  it("collapses newlines/NBSP, strips zero-width + control chars, trims", () => {
    assert.equal(T.normalizeInline("Senior\nEngineer\u00A0\u200B(Remote)\t"), "Senior Engineer (Remote)");
    assert.equal(T.normalizeInline("**Denver**, CO"), "Denver, CO");
    assert.equal(T.normalizeInline(null), "");
  });
});

describe("stripListGlyph", () => {
  it("strips one leading marker of any flavor", () => {
    for (const g of ["- ", "* ", "• ", "· ", "‣ ", "▪ ", "1. ", "12) ", "– ", "— "]) {
      assert.equal(T.stripListGlyph(`${g}Own the roadmap`), "Own the roadmap", `glyph ${JSON.stringify(g)}`);
    }
    assert.equal(T.stripListGlyph("2020. A fine year"), "A fine year"); // acceptable: leading enum stripped
    assert.equal(T.stripListGlyph("No glyph here"), "No glyph here");
  });
});

describe("itemText", () => {
  it("never yields [object Object]", () => {
    assert.equal(T.itemText({ text: "From object" }), "From object");
    assert.equal(T.itemText({ name: "Named" }), "Named");
    assert.equal(T.itemText({ weird: 1 }), "");
    assert.equal(T.itemText("plain"), "plain");
    assert.equal(T.itemText(7), "7");
  });
});

describe("toBlocks", () => {
  it("splits paragraphs on blank lines and soft-wraps single newlines", () => {
    assert.deepEqual(T.toBlocks("Para one line a\nline b\n\nPara two."), [
      { kind: "p", text: "Para one line a line b" },
      { kind: "p", text: "Para two." },
    ]);
  });
  it("recognizes colon, markdown, and ALL-CAPS headings — including periods and lowercase", () => {
    assert.deepEqual(T.toBlocks("U.S. Requirements:\n- Visa"), [
      { kind: "heading", text: "U.S. Requirements" },
      { kind: "bullets", items: ["Visa"] },
    ]);
    assert.deepEqual(T.toBlocks("## What you'll do\nShip things."), [
      { kind: "heading", text: "What you'll do" },
      { kind: "p", text: "Ship things." },
    ]);
    assert.deepEqual(T.toBlocks("BENEFITS\nHealth. Dental."), [
      { kind: "heading", text: "BENEFITS" },
      { kind: "p", text: "Health. Dental." },
    ]);
  });
  it("does NOT steal the first line of an ordinary paragraph as a heading", () => {
    assert.deepEqual(T.toBlocks("We are seeking an engineer\nwho has experience with Go."), [
      { kind: "p", text: "We are seeking an engineer who has experience with Go." },
    ]);
  });
  it("handles numbered + unicode bullets and wrapped continuation lines", () => {
    assert.deepEqual(T.toBlocks("Duties:\n1. Build the API\n2. Own deploys\nacross three regions\n‣ Mentor"), [
      { kind: "heading", text: "Duties" },
      { kind: "bullets", items: ["Build the API", "Own deploys across three regions", "Mentor"] },
    ]);
  });
  it("returns [] for empty input and never throws on junk", () => {
    assert.deepEqual(T.toBlocks(""), []);
    assert.deepEqual(T.toBlocks(null), []);
  });
});

describe("clip", () => {
  it("returns short strings unchanged, without ellipsis", () => {
    assert.equal(T.clip("short", 300), "short");
  });
  it("cuts at a word boundary with ellipsis, within budget", () => {
    const src = "Architecture reviews and design docs every sprint";
    const out = T.clip(src, 20);
    assert.ok(out.length <= 20, `len ${out.length}`);
    assert.ok(out.endsWith("…"));
    const prefix = out.slice(0, -1);
    assert.ok(src.startsWith(prefix), "clip must be a prefix of the source");
    assert.equal(src.charAt(prefix.length), " ", "cut must land on a word boundary");
    assert.equal(out, "Architecture…");
  });
  it("never splits a surrogate pair", () => {
    const s = "x".repeat(9) + "💡rest of the text";
    const out = T.clip(s, 11); // raw slice(0,10) would land between the 💡 surrogates
    assert.ok(!/[\uD800-\uDBFF]…$/.test(out), "lone high surrogate before ellipsis");
    assert.ok(out.length <= 11);
  });
});

describe("escapeAttr", () => {
  it("escapes the five specials plus newlines", () => {
    assert.equal(T.escapeAttr('a"b\nc'), "a&quot;b&#10;c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/jb-text.test.mjs`
Expected: FAIL — `ENOENT ... jb-text.js`

- [ ] **Step 3: Write the implementation**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/jb-text.test.mjs`
Expected: PASS (all describes). If a `stripListGlyph` edge disagrees (e.g. the `2020.` enum case), fix the regex bound (`\d{1,4}`) — not the test.

- [ ] **Step 5: Add the script tag** to `index.html` before `jb-ui.js` (line ~224):

```html
    <script src="jb-text.js" defer></script>
```

Run: `node --test tests/index-html-cold-start.test.mjs tests/index-html-size.test.mjs`
Expected: PASS (these suites police index.html hygiene).

- [ ] **Step 6: Full gate + commit**

Run: `npm test` → all green.

```bash
git add jb-text.js tests/jb-text.test.mjs index.html
git commit -m "feat(dossier): add jb-text shared text-normalization module"
```

### Task 2: `server/shared/text-normalize.mjs`

**Files:**
- Create: `server/shared/text-normalize.mjs`
- Test: `tests/text-normalize.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (named ESM exports, used by Tasks 11–14): `decodeHtmlEntities(s)`, `htmlToText(html)`, `normalizeJobText(s)`, `normalizeInlineField(s)`, `stripMarkdownInline(s)`, `stripListGlyph(s)`.
- Note: the entity map and Markdown/glyph helpers are deliberately duplicated from `jb-text.js` — the browser file is a classic script, the server is ESM, and the codebase already carries per-runtime copies of `escapeHtml`. Both files carry a header comment pointing at the other.

- [ ] **Step 1: Write the failing test**

```js
// tests/text-normalize.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeHtmlEntities,
  htmlToText,
  normalizeJobText,
  normalizeInlineField,
} from "../server/shared/text-normalize.mjs";

describe("htmlToText", () => {
  it("keeps paragraph boundaries as blank lines (Canonical Job Text §3)", () => {
    assert.equal(
      htmlToText("<div>About Us</div><div>We are building rockets.</div>"),
      "About Us\n\nWe are building rockets.",
    );
    assert.equal(
      htmlToText("<p>First.</p><p>Second.</p>"),
      "First.\n\nSecond.",
    );
  });
  it("renders list items as '- ' lines", () => {
    assert.equal(
      htmlToText("<h3>Requirements:</h3><ul><li>5+ years</li><li>Go &amp; Rust</li></ul>"),
      "Requirements:\n\n- 5+ years\n- Go & Rust",
    );
  });
  it("decodes entity-encoded HTML before stripping (Greenhouse double-encoding)", () => {
    assert.equal(
      htmlToText("&lt;p&gt;Health &amp;amp; dental&lt;/p&gt;&lt;p&gt;401k&lt;/p&gt;"),
      "Health &amp; dental\n\n401k",
    );
  });
  it("separates table cells and rows", () => {
    const out = htmlToText("<table><tr><td>Base</td><td>$150k</td></tr><tr><td>Bonus</td><td>10%</td></tr></table>");
    assert.match(out, /Base · \$150k\nBonus · 10%/);
  });
  it("drops script/style and survives junk", () => {
    assert.equal(htmlToText("<style>p{}</style><p>Real</p><script>x()</script>"), "Real");
    assert.equal(htmlToText(null), "");
  });
});

describe("normalizeJobText", () => {
  it("normalizes newlines, strips zero-width + markdown emphasis, caps blank runs", () => {
    assert.equal(
      normalizeJobText("Line\u200B one\r\n\r\n\r\n\r\n**Bold** two\r\nthree\t "),
      "Line one\n\nBold two\nthree",
    );
  });
});

describe("normalizeInlineField", () => {
  it("collapses to a clean single line", () => {
    assert.equal(normalizeInlineField("Senior\nEngineer&nbsp;— *Remote*"), "Senior Engineer — Remote");
  });
});

describe("decodeHtmlEntities", () => {
  it("is single-level like the client twin", () => {
    assert.equal(decodeHtmlEntities("&amp;amp;"), "&amp;");
    assert.equal(decodeHtmlEntities("AT&T"), "AT&T");
  });
});
```

Note the Greenhouse assertion: `&amp;amp;` inside entity-encoded HTML ends as `&amp;` after ONE decode pass, then `htmlToText`'s output keeps it decoded once more is NOT applied — the expected string in the test above (`Health &amp; dental`) pins exactly this: outer encoding decoded, inner `&amp;amp;` → `&amp;` → rendered later by the client as `&`. If implementation legitimately produces `Health & dental` (double-decode), that is a FAILURE — fix the code, not the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/text-normalize.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```js
/* server/shared/text-normalize.mjs
   Server twin of jb-text.js (spec §4.2) — Canonical Job Text producer.
   Keep the entity map and Markdown/glyph rules in sync with jb-text.js. */

const NAMED_ENTITIES = {
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

const ENTITY_RE = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([a-zA-Z]{2,10}));/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060]/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** @param {unknown} s */
export function decodeHtmlEntities(s) {
  if (s == null) return "";
  return String(s).replace(ENTITY_RE, (m, dec, hex, name) => {
    if (name) {
      const hit = Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name)
        ? NAMED_ENTITIES[name]
        : NAMED_ENTITIES[name.toLowerCase()];
      return hit != null ? hit : m;
    }
    const n = dec ? Number(dec) : Number.parseInt(hex, 16);
    if (!Number.isFinite(n) || (n < 32 && n !== 9 && n !== 10) || n > 0x10ffff) return m;
    try { return String.fromCodePoint(n); } catch { return m; }
  });
}

/** @param {unknown} s */
export function stripMarkdownInline(s) {
  let t = String(s == null ? "" : s);
  t = t.replace(/\[([^\]]+)\]\((\S+?)\)/g, "$1 ($2)");
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  t = t.replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?])/g, "$1$2");
  t = t.replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,;:!?])/g, "$1$2");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  return t;
}

/** @param {unknown} s */
export function stripListGlyph(s) {
  return String(s == null ? "" : s).replace(/^\s*(?:[-*•·‣▪–—]|\d{1,4}[.)])\s+/, "");
}

/** Plain text → Canonical Job Text (spec §3). @param {unknown} s */
export function normalizeJobText(s) {
  let t = String(s == null ? "" : s);
  t = t.replace(/\r\n?/g, "\n").replace(ZERO_WIDTH_RE, "").replace(CONTROL_RE, " ");
  t = t.replace(/\u00A0/g, " ");
  t = t
    .split("\n")
    .map((l) => stripMarkdownInline(l).replace(/[ \t]+/g, " ").trim().replace(/\s*·$/, ""))
    .join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Single-line field → clean one-liner. @param {unknown} s */
export function normalizeInlineField(s) {
  let t = decodeHtmlEntities(s);
  t = t.replace(ZERO_WIDTH_RE, "").replace(CONTROL_RE, " ");
  t = t.replace(/[\r\n\t\u00A0]+/g, " ");
  t = stripMarkdownInline(t);
  return t.replace(/ {2,}/g, " ").trim();
}

/** Block-aware HTML → Canonical Job Text. Decode FIRST (Greenhouse
    entity-encodes whole documents), then strip with structure. @param {unknown} html */
export function htmlToText(html) {
  if (!html || typeof html !== "string") return "";
  let t = decodeHtmlEntities(html);
  if (!/[<>]/.test(t)) return normalizeJobText(t);
  t = t
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(?:p|div|h[1-6]|ul|ol|table|section|article|blockquote)>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, " · ")
    .replace(/<[^>]+>/g, " ");
  return normalizeJobText(t);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/text-normalize.test.mjs`
Expected: PASS. Watch the `- ` line assertions: a `<li>` inside `<ul>` yields `\n- item`, and the closing `</ul>` yields `\n\n` — `normalizeJobText`'s `\n{3,}` cap keeps output tidy.

- [ ] **Step 5: Full gate + commit**

Run: `npm test`

```bash
git add server/shared/text-normalize.mjs tests/text-normalize.test.mjs
git commit -m "feat(scraper): add server text-normalize module (Canonical Job Text)"
```

---

## Phase 1 — Presentation safety (`role-brief.js`, `role.js`, `role.css`)

Highest user-visible payoff, and it self-heals legacy cached data (spec D2) because normalization now runs at render time.

### Task 3: Content-format rendering in `role-brief.js`

**Files:**
- Modify: `role-brief.js` (renderHook ~232, renderLede ~237, renderFitAngle ~262, `_structSection` ~276, renderSkim ~366, renderTalkingPoints ~405, renderTagsAndSkills ~433)
- Test: create `tests/dossier-brief-content-formats.test.mjs`; update `tests/dossier-brief-structure.test.mjs`

**Interfaces:**
- Consumes: `window.JobBoredText` (Task 1). The test sandbox must evaluate `jb-text.js` BEFORE `role-brief.js` (same `vm` context) — add `const jbTextSource = readFileSync(join(repoRoot, "jb-text.js"), "utf8");` and run it first in every harness that loads `briefSource`.
- Produces: new CSS hooks `brief__lede--dropcap`, `brief__lede--cont`, `brief__lede-list`, `brief__fit-body--cont` (Task 4 styles them). Masthead inputs (title/company/location/salary) intentionally stay RAW — they round-trip to the Sheet via `jb:role:writeback` and must not be mutated by normalization.

- [ ] **Step 1: Write the failing tests** (new file; reuse the mount/harness helpers from `tests/dossier-brief-structure.test.mjs` — copy `makeMount`/`makeClassList` or extract them into `tests/helpers/brief-harness.mjs` if the copy exceeds ~80 lines)

```js
// tests/dossier-brief-content-formats.test.mjs  (harness boilerplate as described above)
function renderWith(job) {
  const sandbox = makeSandbox();               // stub document with body.jb-v2
  vm.runInNewContext(jbTextSource, sandbox);
  vm.runInNewContext(briefSource, sandbox);
  const mount = makeMount();
  sandbox.window.JobBoredDossierBrief.renderBrief(mount, { job });
  return mount.innerHTML;
}

describe("brief renders every content format cleanly", () => {
  it("multi-paragraph postingSummary renders as separate <p> blocks", () => {
    const html = renderWith({
      role: "PM", company: "Acme",
      enrichment: { postingSummary: "First paragraph.\n\nSecond paragraph.", status: "ready" },
    });
    assert.match(html, /<p class="brief__lede[^"]*">First paragraph\.<\/p>/);
    assert.match(html, /<p class="brief__lede brief__lede--cont">Second paragraph\.<\/p>/);
  });
  it("markdown + entities in the lede are demoted/decoded, not printed raw", () => {
    const html = renderWith({
      role: "PM", company: "Acme",
      enrichment: { postingSummary: "We ship **fast** &amp; safely.", status: "ready" },
    });
    assert.match(html, /We ship fast &amp; safely\./);   // &amp; = escapeHtml("&") — single escape
    assert.doesNotMatch(html, /\*\*fast\*\*/);
    assert.doesNotMatch(html, /&amp;amp;/);
  });
  it("drop-cap class only when the lede starts with a letter", () => {
    const letters = renderWith({ role: "r", company: "c", enrichment: { postingSummary: "Great role.", status: "ready" } });
    assert.match(letters, /brief__lede--dropcap/);
    const quote = renderWith({ role: "r", company: "c", enrichment: { postingSummary: "“Quoted opener” here.", status: "ready" } });
    assert.doesNotMatch(quote, /brief__lede--dropcap/);
  });
  it("struct items strip glyphs, coerce objects, and word-safe-clip at 300", () => {
    const long = "Architecture reviews " + "and design docs ".repeat(20);
    const html = renderWith({
      role: "r", company: "c",
      enrichment: { status: "ready", mustHaves: ["- Own the roadmap", { text: "From object" }, long] },
    });
    assert.match(html, /<li>Own the roadmap<\/li>/);
    assert.match(html, /<li>From object<\/li>/);
    assert.doesNotMatch(html, /\[object Object\]/);
    assert.doesNotMatch(html, /<li>- /);
    const li = /<li>(Architecture reviews[^<]*)<\/li>/.exec(html);
    assert.ok(li, "long item must render");
    assert.ok(li[1].length <= 300 && li[1].endsWith("…"));
    const prefix = li[1].slice(0, -1);
    const normalizedSrc = long.replace(/\s+/g, " ").trim();
    assert.ok(normalizedSrc.startsWith(prefix), "clip must be a prefix");
    assert.equal(normalizedSrc.charAt(prefix.length), " ", "cut must land on a word boundary");
  });
  it("talking points strip leading markdown glyphs", () => {
    const html = renderWith({
      role: "r", company: "c",
      enrichment: { status: "ready", talkingPoints: ["* Lead with the launch story", "• Ask about on-call"] },
    });
    assert.match(html, /<li>Lead with the launch story<\/li>/);
    assert.match(html, /<li>Ask about on-call<\/li>/);
  });
  it("tags render from the first tag (old <=3 suppression is gone)", () => {
    const html = renderWith({ role: "r", company: "c", tags: ["Go", "K8s"], enrichment: { status: "ready" } });
    assert.match(html, /brief__skill-chip/);
    assert.match(html, /Go/);
    const none = renderWith({ role: "r", company: "c", tags: [], enrichment: { status: "ready" } });
    assert.doesNotMatch(none, /brief__tags/);
  });
  it("bullets inside the lede render as a list", () => {
    const html = renderWith({
      role: "r", company: "c",
      enrichment: { status: "ready", postingSummary: "You will:\n- Ship\n- Review" },
    });
    assert.match(html, /<ul class="brief__lede-list"><li>Ship<\/li><li>Review<\/li><\/ul>/);
  });
});
```

- [ ] **Step 2: Run to verify failures**

Run: `node --test tests/dossier-brief-content-formats.test.mjs`
Expected: FAIL on every `it` (raw markdown, `--dropcap` absent, `[object Object]`, chip suppression).

- [ ] **Step 3: Implement in `role-brief.js`**

Add after `escapeHtml` (~line 60):

```js
  function T() { return root.JobBoredText; }

  var LETTER_START_RE = (function () {
    try { return new RegExp("^\\p{L}", "u"); } catch (e) { return /^[A-Za-z]/; }
  })();

  /* Canonical block rendering for multi-paragraph AI prose (spec §5.4).
     firstCls keeps the pinned contract class on paragraph 1. */
  function renderProseBlocks(text, firstCls, contCls, listCls, dropcap) {
    var blocks = T().toBlocks(text);
    var html = "";
    var first = true;
    blocks.forEach(function (b) {
      if (b.kind === "bullets") {
        html += '<ul class="' + listCls + '">' +
          b.items.map(function (i) { return "<li>" + escapeHtml(i) + "</li>"; }).join("") +
        "</ul>";
        return;
      }
      var text2 = b.kind === "heading" ? b.text + ":" : b.text;   // headings inside a lede stay prose
      var cls = first ? firstCls : firstCls.split(" ")[0] + " " + contCls;
      if (first && dropcap && LETTER_START_RE.test(text2)) cls += " " + firstCls.split(" ")[0] + "--dropcap";
      html += '<p class="' + cls + '">' + escapeHtml(text2) + "</p>";
      first = false;
    });
    return html;
  }

  function cleanItems(items, cap, clipLen) {
    var t = T();
    var arr = Array.isArray(items)
      ? items.map(function (x) { return t.stripListGlyph(t.normalizeInline(t.itemText(x))); }).filter(Boolean)
      : [];
    return arr.slice(0, cap).map(function (b) { return t.clip(b, clipLen); });
  }
```

Then rewire (keep every function's signature and section/label markup identical):

- `renderHook`: `hookText` → `T().normalizeInline(hookText)` before the emptiness check.
- `renderLede`: replace the two inner lines that build `<p class="brief__lede">…` with `renderProseBlocks(lede, "brief__lede", "brief__lede--cont", "brief__lede-list", true)`; keep the `brief__lede-block` wrapper and tag line untouched.
- `renderFitAngle`: body becomes `renderProseBlocks(text, "brief__fit-body", "brief__fit-body--cont", "brief__lede-list", false)`.
- `_structSection`: replace the map/filter/slice/truncate body with `var limited = cleanItems(items, 12, 300); if (!limited.length) return "";` and `var bullets = limited.map(function (s) { return "<li>" + escapeHtml(s) + "</li>"; }).join("");`.
- `renderTalkingPoints`: run both branches' bullets through `cleanItems(bullets, 6, 300)`.
- `renderSkim`: signals map via `T().normalizeInline(T().itemText(t))`; rationale via `T().normalizeInline(...)`.
- `renderTagsAndSkills`: `if (!tags.length) return "";` (drop `<= 3`), tags map via `T().normalizeInline(T().itemText(t))`.

- [ ] **Step 4: Run new + existing suites**

Run: `node --test tests/dossier-brief-content-formats.test.mjs tests/dossier-brief-structure.test.mjs tests/dossier-card-attrs.test.mjs tests/role-field-edit-render-guard.test.mjs`
Expected: new suite PASS. `dossier-brief-structure` will fail on two known assertions — the harness doesn't load `jb-text.js`, and the lede assertion shape. Fix the harness (evaluate `jbTextSource` first) and, only if the lede markup genuinely changed shape (`<p class="brief__lede brief__lede--dropcap">`), loosen those regexes to `class="brief__lede[^"]*"` — never delete an assertion.

- [ ] **Step 5: Full gate + commit**

Run: `npm test`

```bash
git add role-brief.js tests/dossier-brief-content-formats.test.mjs tests/dossier-brief-structure.test.mjs
git commit -m "feat(dossier): render markdown/entities/blocks cleanly in the brief"
```

### Task 4: `role.css` typography & overflow hardening

**Files:**
- Modify: `role.css` (drop-cap block ~537-546; add overflow rules near the `.brief__lede` cluster; `.brief__body` columns ~1330s)
- Test: extend `tests/dossier-brief-structure.test.mjs` (it already reads `roleCssSource` — add a `describe("role.css text-safety contract")`)

**Interfaces:**
- Consumes: classes emitted by Task 3.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing CSS-contract test** (append to `dossier-brief-structure.test.mjs`)

```js
describe("role.css text-safety contract", () => {
  it("drop cap is opt-in via brief__lede--dropcap only", () => {
    assert.match(roleCssSource, /\.brief__lede--dropcap::first-letter\s*{/);
    assert.doesNotMatch(roleCssSource, /\.brief__lede::first-letter\s*{/);
  });
  it("body copy wraps long tokens", () => {
    const wrapRule = /\.brief__hook,\s*\.brief__lede,\s*\.brief__fit-body,\s*\.brief__struct li,\s*\.points li,\s*\.skim \.val,\s*\.brief__skill-chip\s*{[^}]*overflow-wrap:\s*anywhere/;
    assert.match(roleCssSource, wrapRule);
  });
  it("brief columns may shrink (min-width: 0)", () => {
    assert.match(roleCssSource, /\.brief__col\s*{[^}]*min-width:\s*0/);
  });
  it("continuation paragraphs have rhythm", () => {
    assert.match(roleCssSource, /\.brief__lede--cont/);
    assert.match(roleCssSource, /\.brief__fit-body--cont/);
    assert.match(roleCssSource, /\.brief__lede-list/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `node --test tests/dossier-brief-structure.test.mjs`

- [ ] **Step 3: Implement in `role.css`**

Rename the selector at ~537: `.brief__lede::first-letter` → `.brief__lede--dropcap::first-letter` (properties unchanged — 56px Lora crimson float is the design).

Add one rule block after the `.brief__lede` styles:

```css
/* Text safety — long tokens wrap, columns shrink, continuation rhythm.
   (Render-resilience spec §6.) */
.brief__hook, .brief__lede, .brief__fit-body, .brief__struct li,
.points li, .skim .val, .brief__skill-chip {
  overflow-wrap: anywhere;
}
.brief__col { min-width: 0; }
.brief__lede--cont,
.brief__fit-body--cont {
  margin-top: 0.75em;
}
.brief__lede--cont { font-size: inherit; }
.brief__lede-list {
  margin: 10px 0 0;
  padding-left: 1.1em;
}
.brief__lede-list li {
  margin: 4px 0;
  overflow-wrap: anywhere;
}
```

Match surrounding declaration order/format (2-space indent, one property per line).

- [ ] **Step 4: Run tests** — `node --test tests/dossier-brief-structure.test.mjs` → PASS; `node --test tests/v2-flow-width.test.mjs` → PASS (layout suite).

- [ ] **Step 5: Full gate + commit**

```bash
git add role.css tests/dossier-brief-structure.test.mjs
git commit -m "feat(dossier): conditional drop cap, overflow-wrap, paragraph rhythm in role.css"
```

### Task 5: Edit-surface focus guard + deferred re-render (`role.js`)

**Files:**
- Modify: `role.js` (`editFieldFocusedIn` ~236-240, `renderForKey` ~242, `rerenderOpenRole` ~268, `wireRegionClickOnce` ~142, `wireDossier` ~169)
- Test: extend `tests/role-field-edit-render-guard.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: guard behavior other suites rely on — `renderForKey(jobKey)` public surface unchanged.

- [ ] **Step 1: Update the test harness, then write failing tests.** In `tests/role-field-edit-render-guard.test.mjs`, the input stub's `matches()` recognizes only the literal `'[data-action="edit-field"]'`. Replace it with a selector-splitting version on BOTH the input stub and any textarea stub the harness gains:

```js
    matches(selector) {
      return String(selector).split(",").some((part) => {
        const m = /^\s*\[data-action="([^"]+)"\]\s*$/.exec(part);
        return !!m && this._attrs["data-action"] === m[1];
      });
    },
```

Add the new cases:

```js
describe("notes textarea is a guarded edit surface", () => {
  it("skips re-render while the notes textarea has focus", () => {
    const { sandbox, region, renderCount } = bootDossier();       // existing harness boot
    const notes = region.querySelector('[data-action="notes"]');
    notes.focus();
    sandbox.window.JobBoredFlowing.role.renderForKey("job-1");    // background event analog
    assert.equal(renderCount(), 1, "render must be deferred while notes focused");
  });
  it("flushes the deferred render after blur, so the dossier is not left stale", () => {
    const { sandbox, region, renderCount, flushTimers } = bootDossier();
    const notes = region.querySelector('[data-action="notes"]');
    notes.focus();
    sandbox.window.JobBoredFlowing.role.renderForKey("job-1");
    notes.blur();                                                  // fires blur + focusout in the stub
    flushTimers();                                                 // run the setTimeout(0) queue
    assert.equal(renderCount(), 2, "pending render must run after blur");
  });
});
```

The harness needs two additions: (a) `focusout` dispatch inside the stub's `blur()` (after the blur listeners), bubbled to the region listener; (b) a `setTimeout` capture in the sandbox (`sandbox.window.setTimeout = (fn) => { timers.push(fn); return timers.length; }` with `flushTimers()` draining the queue).

- [ ] **Step 2: Run to verify failure** — `node --test tests/role-field-edit-render-guard.test.mjs` → new cases FAIL (guard ignores notes; nothing flushes).

- [ ] **Step 3: Implement in `role.js`**

```js
  var EDIT_SURFACE_SELECTOR = '[data-action="edit-field"], [data-action="notes"]';
  var hasPendingRender = false;
  var pendingRenderKey = null;

  /* Guard covers BOTH masthead inputs and the Notes textarea (spec D6):
     a background jb:pipeline:rendered / jb:role:enriched while typing
     defers the rebuild instead of wiping keystrokes — and the deferred
     render flushes on blur so the dossier never goes stale. */
  function editSurfaceFocusedIn(region) {
    if (!region) return false;
    var ae = document.activeElement;
    return !!(ae && ae.matches && ae.matches(EDIT_SURFACE_SELECTOR) && region.contains(ae));
  }
```

`renderForKey`: replace `if (editFieldFocusedIn(region)) return;` with:

```js
    if (editSurfaceFocusedIn(region)) {
      hasPendingRender = true;
      pendingRenderKey = jobKey;
      return;
    }
```

`rerenderOpenRole`: delete its own `if (editFieldFocusedIn(getRegion())) return;` line (renderForKey now self-guards and queues). Delete the old `editFieldFocusedIn` function.

`wireRegionClickOnce` gains the flush listener (region element survives innerHTML rebuilds, so once is enough):

```js
    region.addEventListener("focusout", function (e) {
      var t = e.target;
      if (!t || !t.matches || !t.matches(EDIT_SURFACE_SELECTOR)) return;
      root.setTimeout(function () {
        if (!hasPendingRender || editSurfaceFocusedIn(region)) return;
        var key = pendingRenderKey;
        hasPendingRender = false;
        pendingRenderKey = null;
        renderForKey(key);
      }, 0);
    });
```

`wireDossier` gains the fact-input width fallback (spec §6.4):

```js
    if (!(root.CSS && root.CSS.supports && root.CSS.supports("field-sizing", "content"))) {
      var factInputs = region.querySelectorAll(".brief__fact-input");
      for (var fi = 0; fi < factInputs.length; fi++) {
        (function (inp) {
          function size() { inp.style.width = Math.min((inp.value || "").length + 2, 40) + "ch"; }
          size();
          inp.addEventListener("input", size);
        })(factInputs[fi]);
      }
    }
```

- [ ] **Step 4: Run tests** — `node --test tests/role-field-edit-render-guard.test.mjs tests/dossier-card-attrs.test.mjs` → PASS.

- [ ] **Step 5: Full gate + commit**

```bash
git add role.js tests/role-field-edit-render-guard.test.mjs
git commit -m "fix(dossier): guard notes textarea from background re-renders, flush on blur"
```

### Task 6: Loading skeleton keeps the user's Notes (`role-brief.js`)

**Files:**
- Modify: `role-brief.js` (`renderBrief` loading branch ~468-471)
- Test: extend `tests/dossier-brief-content-formats.test.mjs`

- [ ] **Step 1: Failing test**

```js
describe("enrichment loading state", () => {
  it("keeps masthead + notes mounted beside the skeleton (spec D3)", () => {
    const html = renderWith({
      role: "PM", company: "Acme",
      notes: { body: "Recruiter: Sam. Ask about equity." },
      enrichment: { status: "loading" },
    });
    assert.match(html, /brief__skeleton/);
    assert.match(html, /brief__masthead/);
    assert.match(html, /data-action="notes"/);
    assert.match(html, /Recruiter: Sam\. Ask about equity\./);
    assert.doesNotMatch(html, /class="skim"/);           // AI-adjacent stays out
    assert.doesNotMatch(html, /class="points"/);
  });
});
```

- [ ] **Step 2: Verify failure** — the loading branch currently renders masthead + skeleton only.

- [ ] **Step 3: Implement** — in `renderBrief`:

```js
    if (isEnrichmentLoading(job)) {
      briefRoot.innerHTML = mastheadHtml + loadingHtml +
        '<div class="brief__body brief__body--loading">' +
          '<div class="brief__col brief__col--side">' + renderNotes(job) + '</div>' +
        '</div>';
      return;
    }
```

- [ ] **Step 4: Run** `node --test tests/dossier-brief-content-formats.test.mjs tests/dossier-brief-structure.test.mjs` → PASS (fix any loading-state `doesNotMatch` in the structure suite that assumed a bare skeleton, keeping its intent: no AI-derived sections while loading).

- [ ] **Step 5: `npm test` + commit**

```bash
git add role-brief.js tests/dossier-brief-content-formats.test.mjs tests/dossier-brief-structure.test.mjs
git commit -m "fix(dossier): keep notes mounted during enrichment loading skeleton"
```

**Phase 1 exit criteria:** `npm test` green; manual smoke — open the dashboard (`?greenfield=1` or the headless signed-in recipe), open a role whose cached enrichment contains markdown/entities, and verify: no `**`/`&amp;amp;` on screen, multi-paragraph lede, drop cap only on letters, chips for 1–3 tags, typing in Notes while a poll fires loses nothing and the dossier refreshes on blur.

---

## Phase 2 — Derivation (`dawn-data.js`)

### Task 7: Block-model JD sections

**Files:**
- Modify: `dawn-data.js` (`_splitJdSections` ~974-1000)
- Test: create `tests/dawn-data-jd-blocks.test.mjs` (harness: same `vm` pattern; evaluate `jb-text.js` then `dawn-data.js`; call `sandbox.window.JobBoredDawn.data.getRoleViewModel` with a stubbed card, or export-test `_splitJdSections` through an existing test seam if one exists — check `tests/dawn-data-lead-stories.test.mjs` for the established card stub and reuse it)

**Interfaces:**
- Consumes: `JobBoredText.toBlocks`.
- Produces: `jdSections` keeps shape `[{heading, body, bullets}]`; `body` may now contain `\n\n` between paragraphs (role-brief re-blocks it — Task 3 already handles this).

- [ ] **Step 1: Failing tests**

```js
describe("_splitJdSections via toBlocks", () => {
  it("groups heading + paragraphs + bullets into one section", () => {
    const jd = "About the role:\nWe build tools.\n\n- Ship weekly\n- Review PRs\n\nBenefits:\nHealth. Dental.";
    const sections = splitJd(jd);   // helper wraps getRoleViewModel with a card whose data-jd-snippet = jd
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, "About the role");
    assert.equal(sections[0].body, "We build tools.");
    assert.deepEqual(sections[0].bullets, ["Ship weekly", "Review PRs"]);
    assert.equal(sections[1].heading, "Benefits");
  });
  it("no longer amputates the first line of an ordinary paragraph", () => {
    const sections = splitJd("We are seeking an engineer\nwho has experience with Go.");
    assert.equal(sections[0].heading, "");
    assert.match(sections[0].body, /^We are seeking an engineer who has/);
  });
  it("keeps numbered lists as bullets", () => {
    const sections = splitJd("Duties:\n1. Build\n2. Operate");
    assert.deepEqual(sections[0].bullets, ["Build", "Operate"]);
  });
});
```

- [ ] **Step 2: Verify failure** — old regex splitter steals the heading and drops numbered bullets.

- [ ] **Step 3: Implement** — replace `_splitJdSections`'s body:

```js
  /** Canonical Job Text → dossier sections, via the shared block model.
      Groups each heading with the paragraphs/bullets that follow it. */
  function _splitJdSections(jd) {
    var T = root.JobBoredText;
    if (!T || typeof T.toBlocks !== "function") return [];
    var blocks = T.toBlocks(jd);
    var sections = [];
    var cur = null;
    function open(heading) {
      cur = { heading: heading || "", body: "", bullets: [] };
      sections.push(cur);
    }
    blocks.forEach(function (b) {
      if (b.kind === "heading") { open(b.text); return; }
      if (!cur) open("");
      if (b.kind === "p") cur.body = cur.body ? cur.body + "\n\n" + b.text : b.text;
      else if (b.kind === "bullets") cur.bullets = cur.bullets.concat(b.items);
    });
    return sections;
  }
```

(`dawn-data.js` loads after `jb-text.js` in the defer chain; the `!T` bail returns `[]`, and `getRoleViewModel`'s existing `if (!jdSections.length && jd)` fallback keeps the raw-blob path alive.)

- [ ] **Step 4: Run** `node --test tests/dawn-data-jd-blocks.test.mjs tests/dawn-data-lead-stories.test.mjs tests/dawn-by-the-numbers-30d.test.mjs` → PASS (fix the lead-stories harness to evaluate `jb-text.js` first).

- [ ] **Step 5: `npm test` + commit** — `git add dawn-data.js tests/dawn-data-jd-blocks.test.mjs tests/dawn-data-lead-stories.test.mjs && git commit -m "feat(dossier): parse JD sections through the shared block model"`

### Task 8: Attribute-parsing repairs in `dawn-data.js`

**Files:**
- Modify: `dawn-data.js` (`_parseTagsFromCard` ~1016, `_parseTalkingPointsFromCard` ~1100, `_parseJsonArrayAttr` ~1144, `_parseEnrichmentFromCard` ~1163)
- Test: extend `tests/dawn-data-jd-blocks.test.mjs`

- [ ] **Step 1: Failing tests**

```js
describe("card attribute parsing", () => {
  it("talking points with newlines split ONLY on newlines", () => {
    const pts = parseCard({ "data-talking-points": "Shipped X; grew Y 40%\nAsk about on-call; and pager duty" }).talkingPointsLegacy;
    assert.deepEqual(pts, ["Shipped X; grew Y 40%", "Ask about on-call; and pager duty"]);
  });
  it("single-line talking points still split on ; and ·", () => {
    const pts = parseCard({ "data-talking-points": "Point A; Point B · Point C" }).talkingPointsLegacy;
    assert.deepEqual(pts, ["Point A", "Point B", "Point C"]);
  });
  it("JSON data-tags arrays pass through un-fragmented", () => {
    const tags = parseCard({ "data-tags": JSON.stringify(["Austin, TX", "C#; .NET"]) }).tags;
    assert.deepEqual(tags, ["Austin, TX", "C#; .NET"]);
  });
  it("legacy comma-string tags keep splitting", () => {
    assert.deepEqual(parseCard({ "data-tags": "Go, K8s" }).tags, ["Go", "K8s"]);
  });
  it("JSON array attrs tolerate objects and legacy entities", () => {
    const items = parseCard({ "data-must-haves": JSON.stringify([{ text: "Own SLAs" }, "5+ yrs &amp; Go"]) }).enrichment.mustHaves;
    assert.deepEqual(items, ["Own SLAs", "5+ yrs & Go"]);
  });
});
```

(`parseCard` builds the stubbed kanban card + calls `getRoleViewModel`; `talkingPointsLegacy` reads the synthetic "Why you" section produced when no jd snippet exists — reuse the Task 7 helper.)

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement**

`_parseTagsFromCard` — JSON-first, widened chip fallback:

```js
  function _parseTagsFromCard(card) {
    if (!card) return [];
    var T = root.JobBoredText;
    var tagsAttr = _attr(card, "data-tags");
    if (tagsAttr) {
      var trimmed = tagsAttr.trim();
      if (trimmed.charAt(0) === "[") {
        try {
          var arr = JSON.parse(trimmed);
          if (Array.isArray(arr)) {
            return arr.map(function (t) { return T ? T.normalizeInline(T.itemText(t)) : String(t || "").trim(); })
              .filter(Boolean);
          }
        } catch (e) { /* legacy string form below */ }
      }
      return tagsAttr.split(/[,;|]+/).map(function (t) { return t.trim(); }).filter(Boolean);
    }
    var chips = card.querySelectorAll(".skill-chip, .kanban-card__tag");
    var out = [];
    chips.forEach(function (c) {
      var t = (c.textContent || "").trim();
      if (t) out.push(t);
    });
    return out;
  }
```

`_parseTalkingPointsFromCard` — newline-first:

```js
  function _parseTalkingPointsFromCard(card) {
    if (!card) return [];
    var raw = _attr(card, "data-talking-points");
    if (!raw) return [];
    var T = root.JobBoredText;
    var parts = /\n/.test(raw) ? String(raw).split(/\n+/) : String(raw).split(/[;·]/);
    return parts.map(function (s) {
      s = T ? T.stripListGlyph(T.normalizeInline(s)) : s.trim().replace(/^[-*•]\s+/, "");
      return s;
    }).filter(Boolean);
  }
```

`_parseJsonArrayAttr` — item coercion + self-heal normalization:

```js
      if (Array.isArray(parsed)) {
        var T = root.JobBoredText;
        return parsed
          .map(function (s) {
            return T ? T.stripListGlyph(T.normalizeInline(T.itemText(s))) : String(s == null ? "" : s).trim();
          })
          .filter(Boolean);
      }
```

`_parseEnrichmentFromCard` — string fields self-heal (legacy cache, spec D2): `roleInOneLine`/`atsFitRationale` through `T.normalizeInline(...)`; `postingSummary`/`fitAngle`/`fitAssessment` through `T.normalizeMultiline(...)` (guard `T` with the same `T ? … : legacy` pattern).

- [ ] **Step 4: Run** the Phase-2 suites + `tests/dossier-brief-structure.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "fix(dossier): stop fragmenting tags/talking points; tolerate objects and legacy entities"`

---

## Phase 3 — Transport (`pipeline-render.js`)

### Task 9: Safe clipping + attribute escaping

**Files:**
- Modify: `pipeline-render.js` (`_attrEsc` ~187, `_clip` ~198, jd-snippet line ~209)
- Test: extend `tests/dossier-card-attrs.test.mjs`

**Interfaces:**
- Consumes: `window.JobBoredText.clip/escapeAttr` (loaded earlier in the defer chain).
- Produces: identical attribute names; values may now end in `…` instead of a mid-word cut.

- [ ] **Step 1: Failing test** (append to `dossier-card-attrs.test.mjs`, using its existing card-render harness — ensure the harness sandbox evaluates `jb-text.js` before `pipeline-render.js`)

```js
describe("v2 attr clipping is word- and surrogate-safe", () => {
  it("clips data-role-in-one-line at a word boundary within 240 chars", () => {
    const long = "Owns the platform roadmap " + "and the reliability program ".repeat(20);
    const attrs = renderCardAttrs({ _postingEnrichment: { roleInOneLine: long } });
    const v = attrs["data-role-in-one-line"];
    assert.ok(v.length <= 240);
    assert.ok(v.endsWith("…"));
    assert.ok(!/\S{240}/.test(v), "must not be an unbroken 240-char cut");
  });
  it("never emits a lone surrogate", () => {
    const s = "x".repeat(238) + "💡💡💡";
    const attrs = renderCardAttrs({ _postingEnrichment: { roleInOneLine: s } });
    assert.doesNotMatch(attrs["data-role-in-one-line"], /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
  it("attribute newlines are encoded as &#10;", () => {
    const raw = renderCardHtml({ _postingEnrichment: { description: "Para one.\n\nPara two." } });
    assert.match(raw, /data-jd-snippet="[^"]*Para one\.&#10;&#10;Para two\./);
  });
});
```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement** — three line-level edits:

```js
  const _attrEsc = (v) => `"${window.JobBoredText.escapeAttr(String(v))}"`;
  const _clip = (s, n) => (s ? window.JobBoredText.clip(String(s), n) : "");
```

and jd snippet: `_pair("data-jd-snippet", jdRaw ? window.JobBoredText.clip(String(jdRaw), 4000) : "")`.

- [ ] **Step 4: Run** `node --test tests/dossier-card-attrs.test.mjs tests/pipeline-collapse-scroll.test.mjs tests/pipeline-newest-sort.test.mjs` → PASS (pipeline suites' harnesses may need `jb-text.js` evaluated first; add it wherever `pipeline-render.js` is loaded in a sandbox — `grep -l "pipeline-render" tests/*.test.mjs`).

- [ ] **Step 5: `npm test` + commit** — `git commit -m "fix(pipeline): word/surrogate-safe attr clipping via jb-text"`

---

## Phase 4 — Ingestion (server scrapers + LLM normalization)

### Task 10: ATS fetchers adopt `htmlToText`

**Files:**
- Modify: `server/shared/ats-job-fetchers.mjs` (`stripHtml` ~1035-1061 delegates; add `import { htmlToText } from "./text-normalize.mjs";`)
- Test: update `tests/job-scraper-ats-api.test.mjs` expectations

- [ ] **Step 1: Adjust/extend tests first.** In `tests/job-scraper-ats-api.test.mjs`, find cases asserting description strings; update expectations: paragraph gaps become `\n\n`, list items `- item` (was `• item`, single `\n`). Add one explicit case inside the existing `describe("job scraper ATS public JSON lanes")`, reusing its `jsonResponse`/`htmlResponse` helpers and `CAREERS_LISTING_HTML` fixture:

```js
  it("greenhouse content keeps paragraph and list structure", async () => {
    const result = await scrapeJobPosting(
      "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
      {
        fetchImpl: async (url) => {
          if (/boards-api\.greenhouse\.io/.test(url)) {
            return jsonResponse({
              title: "Account Executive, AI Native",
              company_name: "Anthropic",
              location: { name: "San Francisco" },
              content:
                "&lt;p&gt;Sell Claude to AI-native companies and own a book of business end to end.&lt;/p&gt;&lt;p&gt;Run demos and close annual contracts.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;5+ years enterprise sales&lt;/li&gt;&lt;li&gt;Comfort with technical buyers&lt;/li&gt;&lt;/ul&gt;",
              absolute_url: "https://job-boards.greenhouse.io/anthropic/jobs/4461450008",
            });
          }
          return htmlResponse(CAREERS_LISTING_HTML);
        },
      },
    );
    assert.match(
      result.description,
      /own a book of business end to end\.\n\nRun demos and close annual contracts\.\n\n- 5\+ years enterprise sales\n- Comfort with technical buyers/,
    );
  });
```

- [ ] **Step 2: Run to see the delta** — `node --test tests/job-scraper-ats-api.test.mjs` (old `stripHtml` output vs new expectations).

- [ ] **Step 3: Implement** — replace `stripHtml`'s body:

```js
import { htmlToText } from "./text-normalize.mjs";

/** @param {unknown} html */
function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return htmlToText(html);
}
```

(Keep the `stripHtml` name — 20+ call sites stay untouched.)

- [ ] **Step 4: Run** `node --test tests/job-scraper-ats-api.test.mjs tests/ats-request-transport-alignment.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(scraper): ATS descriptions keep paragraph/list structure via htmlToText"`

### Task 11: Block-aware Cheerio extraction in `job-scraper-core.mjs`

**Files:**
- Modify: `server/shared/job-scraper-core.mjs` (add `blockText($, node)` near `stripTags` ~483; use it in `findBestDescriptionFromDom` ~650-696 and `largestTextBlock` ~699; decode entities in `textFromJobPostingLd`'s no-`<` branch ~545) and `server/shared/job-scraper-core.d.mts` (types, matching existing declaration style)
- Test: extend `tests/text-normalize.test.mjs`? No — scraper-specific: extend `tests/job-scraper-linkedin-fallback.test.mjs`'s fixture module or add `tests/job-scraper-block-text.test.mjs`

- [ ] **Step 1: Failing test**

```js
// tests/job-scraper-block-text.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrapeJobPosting } from "../server/shared/job-scraper-core.mjs";

/* Same response stub shape as tests/job-scraper-ats-api.test.mjs —
   the scraper consumes arrayBuffer(), not text(). */
function htmlResponse(html, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => ({}),
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  };
}

describe("DOM description extraction keeps block structure", () => {
  it("adjacent divs do not merge words", async () => {
    const html = `<!doctype html><html><head><title>Acme — Engineer</title></head><body><div class="job-description">
      <div>About Us</div><div>We are building rockets together with a team that ships production hardware every quarter.</div>
      <ul><li>Ship weekly and reliably always</li><li>Review PRs with care and speed</li></ul>
    </div></body></html>`;
    const out = await scrapeJobPosting("https://example.com/jobs/1", {
      fetchImpl: async () => htmlResponse(html),
    });
    assert.doesNotMatch(out.description, /About UsWe/);
    assert.match(out.description, /About Us\n\nWe are building rockets together/);
    assert.match(out.description, /- Ship weekly and reliably always/);
  });
  it("JSON-LD plain descriptions get entities decoded", async () => {
    const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "JobPosting", title: "Engineer",
      description: "Own the roadmap &amp; the on-call rotation. Health &ndash; dental included. " + "More detail here. ".repeat(20),
    })}</script></head><body><p>shell</p></body></html>`;
    const out = await scrapeJobPosting("https://example.com/jobs/2", {
      fetchImpl: async () => htmlResponse(html),
    });
    assert.match(out.description, /roadmap & the on-call/);
    assert.match(out.description, /Health – dental/);
  });
});
```

(If `scrapeJobPosting` rejects these minimal fixtures as careers-listing noise, pad the description text further — the thresholds live in `looksLikeCareersListing` and the ≥120-char selector minimum in `findBestDescriptionFromDom`.)

- [ ] **Step 2: Run to verify failure** — merged `About UsWe`, entities intact.

- [ ] **Step 3: Implement**

```js
import { decodeHtmlEntities, normalizeJobText } from "./text-normalize.mjs";

const BLOCK_BREAK_TAGS = new Set([
  "p", "div", "section", "article", "header", "footer",
  "ul", "ol", "table", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
]);

/** Block-aware text for a cheerio element — the structural twin of
    htmlToText for already-parsed DOM. @param {CheerioApi} $ @param {unknown} node */
function blockText($, node) {
  let out = "";
  /** @param {any} n */
  const walk = (n) => {
    if (!n) return;
    if (n.type === "text") { out += n.data || ""; return; }
    const name = String(n.name || "").toLowerCase();
    if (name === "script" || name === "style" || name === "noscript") return;
    if (name === "br") { out += "\n"; return; }
    if (name === "li") out += "\n- ";
    for (const child of n.children || []) walk(child);
    if (name === "li" || name === "tr") out += "\n";
    else if (name === "td" || name === "th") out += " · ";
    else if (BLOCK_BREAK_TAGS.has(name)) out += "\n\n";
  };
  walk(node);
  return normalizeJobText(out);
}
```

In `findBestDescriptionFromDom`'s `trySel`: `const t = blockText($, node);` (replacing `normalizeSpace($el.text())` — `node` is already the raw element from `.each`). In `largestTextBlock`'s candidate loop likewise. In `textFromJobPostingLd` line ~545: `desc = d.includes("<") ? stripTags(d) : normalizeJobText(decodeHtmlEntities(d));` — and change `stripTags` to feed through `htmlToText`-equivalent structure by replacing its body with `return normalizeJobText(blockTextFromHtml(html));` where `blockTextFromHtml` = `cheerio.load(html)` + `blockText($, $.root().get(0))`. Update `job-scraper-core.d.mts` if it declares any touched internal (it types exported surface only — verify with `npx tsc --noEmit` if the repo type-checks server files, else skip).

- [ ] **Step 4: Run** `node --test tests/job-scraper-block-text.test.mjs tests/job-scraper-linkedin-fallback.test.mjs tests/job-scraper-ats-api.test.mjs tests/job-scraper-gemini-url-context.test.mjs tests/enrichment-self-heal.test.mjs` → PASS (some fixtures will need whitespace-expectation updates — update expected strings to the structured form, never loosen to `.includes` unless the test was already substring-based).

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(scraper): block-aware cheerio text extraction; decode JSON-LD entities"`

### Task 12: Gemini URL-context normalization

**Files:**
- Modify: `server/shared/gemini-url-context-scrape.mjs` (description/title/company/location outputs)
- Test: extend `tests/job-scraper-gemini-url-context.test.mjs`

- [ ] **Step 1: Failing test** — following the suite's existing Gemini-response stub pattern, feed a response whose text is `"## About\n**Bold** claim\r\n\r\n\r\n* item one"` and assert on the resulting `description`:

```js
    assert.doesNotMatch(result.description, /\*\*/);          // emphasis demoted
    assert.match(result.description, /Bold claim/);
    assert.doesNotMatch(result.description, /\n{3,}/);        // blank runs capped
    assert.match(result.description, /## About/);             // heading MARKERS survive server-side —
                                                              // the client toBlocks strips them at derivation
```

- [ ] **Step 2: Verify failure** (`**` currently passes through).

- [ ] **Step 3: Implement** — in the result construction (~line 63):

```js
import { normalizeJobText, normalizeInlineField } from "./text-normalize.mjs";
// ...
      title: normalizeInlineField(title) || null,
      company: normalizeInlineField(company),
      location: normalizeInlineField(location),
      description: normalizeJobText(text),
```

(match the module's actual variable names at the return site).

- [ ] **Step 4: Run** `node --test tests/job-scraper-gemini-url-context.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(scraper): normalize gemini url-context extracts to canonical job text"`

### Task 13: LLM enrichment normalization (`job-posting-insights.js`)

**Files:**
- Modify: `job-posting-insights.js` (`normalizeEnrichmentJson` ~364-381, `parseLooseFieldValue` ~195-208)
- Test: create `tests/insights-normalization.test.mjs` (vm harness: evaluate `jb-text.js`, stub `window.CommandCenterResumeGenerate`, then evaluate `job-posting-insights.js`; call the exposed normalize function — check what the IIFE exports on `window` (`grep -n "window\." job-posting-insights.js | tail -5`) and drive through that surface; if `normalizeEnrichmentJson` isn't exposed, expose it on the module's existing public object as `_normalizeEnrichmentJson` for tests, matching the codebase's underscore-test-seam convention)

- [ ] **Step 1: Failing tests**

```js
describe("normalizeEnrichmentJson", () => {
  it("demotes markdown and strips glyphs across fields", () => {
    const out = normalize({
      inferredTitle: "**Senior** PM", inferredCompany: "Acme", inferredLocation: "Denver,\nCO",
      postingSummary: "We move **fast**.\n\nAnd *carefully*.",
      roleInOneLine: "Owns the\nroadmap",
      mustHaves: ["- 5+ years", { text: "Go & Rust" }],
      responsibilities: ["1. Ship", "2. Operate"],
      niceToHaves: [], toolsAndStack: ["`k8s`"],
      atsFitScore: "88", atsFitRationale: "Strong *match*",
      fitAngle: "You shipped **X**", talkingPoints: ["• Ask about Y"], extraKeywords: [],
    });
    assert.equal(out.inferredTitle, "Senior PM");
    assert.equal(out.inferredLocation, "Denver, CO");
    assert.equal(out.postingSummary, "We move fast.\n\nAnd carefully.");
    assert.equal(out.roleInOneLine, "Owns the roadmap");
    assert.deepEqual(out.mustHaves, ["5+ years", "Go & Rust"]);
    assert.deepEqual(out.responsibilities, ["Ship", "Operate"]);
    assert.deepEqual(out.toolsAndStack, ["k8s"]);
    assert.equal(out.atsFitRationale, "Strong match");
    assert.deepEqual(out.talkingPoints, ["Ask about Y"]);
  });
});

describe("parseLooseFieldValue", () => {
  it("no longer shreds comma-bearing single items", () => {
    assert.deepEqual(loose("mustHaves", "Experience in Denver, CO area"), ["Experience in Denver, CO area"]);
  });
  it("still splits real enumerations", () => {
    assert.deepEqual(loose("toolsAndStack", "React, TypeScript, Node, Postgres"), ["React", "TypeScript", "Node", "Postgres"]);
    assert.deepEqual(loose("mustHaves", "A\nB\nC"), ["A", "B", "C"]);
  });
});
```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement**

```js
  function normalizeEnrichmentJson(parsed) {
    const T = window.JobBoredText;
    const line = (v) => T.normalizeInline(typeof v === "string" ? v : T.itemText(v));
    const multi = (v) => T.normalizeMultiline(typeof v === "string" ? v : T.itemText(v));
    const list = (v, n) =>
      (Array.isArray(v) ? v : [])
        .map((x) => T.stripListGlyph(T.normalizeInline(T.itemText(x))))
        .filter(Boolean)
        .slice(0, n);
    return {
      inferredTitle: line(parsed.inferredTitle),
      inferredCompany: line(parsed.inferredCompany),
      inferredLocation: line(parsed.inferredLocation),
      postingSummary: multi(parsed.postingSummary),
      roleInOneLine: line(parsed.roleInOneLine),
      mustHaves: list(parsed.mustHaves, 12),
      niceToHaves: list(parsed.niceToHaves, 8),
      responsibilities: list(parsed.responsibilities, 10),
      toolsAndStack: list(parsed.toolsAndStack, 14),
      atsFitScore: score100(parsed.atsFitScore),
      atsFitRationale: line(parsed.atsFitRationale),
      fitAngle: multi(parsed.fitAngle),
      talkingPoints: list(parsed.talkingPoints, 6),
      extraKeywords: list(parsed.extraKeywords, 12),
    };
  }
```

`parseLooseFieldValue` array branch:

```js
    if (prop.type !== "array") return value.replace(/^["']|["']$/g, "").trim();
    const hasHardBreaks = /[\n;]/.test(value);
    const commaCount = (value.match(/,/g) || []).length;
    const parts = hasHardBreaks
      ? value.split(/\n|;/)
      : commaCount >= 3
        ? value.split(",")
        : [value];
    return parts
      .map((item) => item.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
      .filter(Boolean);
```

(`strArr` stays for other callers; the old `.slice(0, n)` caps move into `list`.)

- [ ] **Step 4: Run** `node --test tests/insights-normalization.test.mjs tests/enrichment-self-heal.test.mjs tests/settings-fit-profile-and-gemini-models.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(enrichment): canonicalize LLM output (markdown demotion, glyphs, loose-parse commas)"`

---

## Phase 5 — Materials editor convergence (optional polish; ship only if Phases 0–4 land clean)

### Task 14: Markdown demotion on LLM-draft ingestion in editors/previews

**Files:**
- Modify: `scribe.js` (`htmlFromPlainText` ~234), `letter.js` (`writeTextToEditor` ~139), `resume-generation.js` (`formatCoverLetterPreviewHtml` ~164)
- Test: extend `tests/scribe.test.mjs`, `tests/letter-compose-panel.test.mjs`

- [ ] **Step 1: Failing tests** — in each suite, feed a draft containing `"Dear team,\n\nI shipped **X** and *Y*."` and assert the produced editor/preview HTML contains `I shipped X and Y.` with no literal asterisks.

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement** — one guarded line at the top of each conversion function (LLM-draft ingestion only; user keystrokes are never re-normalized):

```js
    var T = window.JobBoredText;
    if (T) text = T.stripMarkdownInline(String(text == null ? "" : text));
```

(`scribe.js`/`resume-generation.js` use `const`; match each file's idiom. Paragraph/`<br>` behavior is already correct in all three — do not touch it.)

- [ ] **Step 4: Run** `node --test tests/scribe.test.mjs tests/letter-compose-panel.test.mjs tests/draft-generation-stability.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(materials): demote markdown artifacts when ingesting LLM drafts"`

---

## Final verification (before requesting PR approval)

- [ ] `npm test` — full gate green (including `tests/integration/`).
- [ ] Grep for leftovers: `grep -n "slice(0, 297)\|slice(0, 4000)\|editFieldFocusedIn" role-brief.js role.js pipeline-render.js` → no hits.
- [ ] Manual smoke (headless recipe from project memory or `?greenfield=1`): open a role with (a) Greenhouse-sourced ATS description, (b) markdown-heavy cached enrichment, (c) a long unbroken URL in a bullet. Verify: paragraphs, `- ` bullets rendered as list items, no raw tokens, no horizontal overflow, drop cap correctness, notes survive a background poll.
- [ ] Update `CHANGELOG.md` under Unreleased: one line per user-visible fix (markdown/entity rendering, paragraph structure, notes protection, tag chips at 1–3 tags).
- [ ] Per the CI-worthiness gate: request Emilio's approval before `git push` / PR.

## Self-review checklist (run after writing code, per task)

1. Every changed line traces to a report finding (§ ref in the spec) — no adjacent "improvements."
2. No test was weakened: assertions were extended or made MORE specific.
3. `dossier-card-attrs` and `dossier-workshop-events` pass **unmodified** except for harness `jb-text.js` loading and the new appended describes.
4. Both entity decoders (`jb-text.js` / `text-normalize.mjs`) have identical NAMED_ENTITIES maps (`diff <(grep -A30 "NAMED_ENTITIES = {" jb-text.js) <(grep -A30 "NAMED_ENTITIES = {" server/shared/text-normalize.mjs)` — sync if drifted).
