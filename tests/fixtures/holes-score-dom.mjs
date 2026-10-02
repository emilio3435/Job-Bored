/* tests/fixtures/holes-score-dom.mjs — HOLES lane SCORE.

   tests/fixtures/jb-dom.mjs (the Scribe harness) plus the three things the
   score modal needs from a DOM that jb-dom leaves out on purpose:

     - innerHTML that PARSES: materials-score.js builds its dialog from one
       escaped string (modalHtml), so its buttons must exist as nodes for
       focus, Tab and click to be testable. The parser only has to read
       markup this repo generates: well-formed tags, double-quoted
       attributes, the five entities esc() writes, and void elements.
     - nodeType and contains(), which jb-a11y.js reads to find focusable
       nodes and to decide where focus returns.
     - the real jb-a11y.js, so dialog/inert/Escape are the shipped ones.

   Everything else is jb-dom's: selectors, bubbling, focus. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { FakeDocument, FakeNode, makeEnv } from "./jb-dom.mjs";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&times;/g, "×")
    .replace(/&amp;/g, "&");
}

const TOKEN = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*"([^"]*)")?/g;

/** Parse `html` into children of `parent` (a ParsingNode). */
export function parseInto(parent, html) {
  const doc = parent.ownerDocument;
  const stack = [parent];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === name) { stack.length = i; break; }
      }
      continue;
    }
    if (m[2]) {
      const el = doc.createElement(m[2]);
      let a;
      ATTR.lastIndex = 0;
      while ((a = ATTR.exec(m[3] || ""))) el.setAttribute(a[1], a[2] == null ? "" : decode(a[2]));
      top.appendChild(el);
      if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el);
      continue;
    }
    if (m[5] && m[5].length) top.appendChild(doc.createTextNode(decode(m[5])));
  }
}

/* Selectors: role-materials.js asks for ".mat-dl__menu:not([hidden])" on
   every click, which jb-dom's matcher (rightly, for its renderers) refuses.
   This one reads compound selectors (tag, #id, .class, [attr], [attr=v],
   :not(...)), the descendant and child combinators, and comma groups. */
function splitTop(src, sep) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of src) {
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseCompound(src) {
  const c = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let i = 0;
  const ident = () => {
    const m = /^[\w-]+/.exec(src.slice(i));
    if (!m) throw new Error(`holes-score-dom: bad selector "${src}"`);
    i += m[0].length;
    return m[0];
  };
  if (src[0] === "*") i = 1;
  else if (/[a-zA-Z]/.test(src[0] || "")) c.tag = ident().toLowerCase();
  while (i < src.length) {
    const ch = src[i];
    if (ch === "#") { i++; c.id = ident(); continue; }
    if (ch === ".") { i++; c.classes.push(ident()); continue; }
    if (ch === "[") {
      const end = src.indexOf("]", i);
      const body = src.slice(i + 1, end);
      const m = /^([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|(.*)))?$/.exec(body.trim());
      if (!m) throw new Error(`holes-score-dom: bad attribute selector "${body}"`);
      c.attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
      i = end + 1;
      continue;
    }
    if (src.startsWith(":not(", i)) {
      let depth = 0;
      let j = i + 4;
      for (; j < src.length; j++) {
        if (src[j] === "(") depth++;
        if (src[j] === ")") { depth--; if (depth === 0) break; }
      }
      c.nots.push(parseCompound(src.slice(i + 5, j)));
      i = j + 1;
      continue;
    }
    throw new Error(`holes-score-dom: unsupported selector "${src}"`);
  }
  return c;
}

function parseComplex(src) {
  const parts = [];
  const tokens = src.replace(/\s*>\s*/g, " > ").split(/\s+/).filter(Boolean);
  let comb = " ";
  for (const t of tokens) {
    if (t === ">") { comb = ">"; continue; }
    parts.push({ comp: parseCompound(t), comb });
    comb = " ";
  }
  return parts;
}

function matchesCompound(node, c) {
  if (!node || node.nodeType !== 1) return false;
  if (c.tag && node.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && node.getAttribute("id") !== c.id) return false;
  for (const cls of c.classes) if (!node.classList.contains(cls)) return false;
  for (const a of c.attrs) {
    if (!node.hasAttribute(a.name)) return false;
    if (a.value != null && node.getAttribute(a.name) !== a.value) return false;
  }
  for (const n of c.nots) if (matchesCompound(node, n)) return false;
  return true;
}

function matchesParts(node, parts, idx) {
  if (!matchesCompound(node, parts[idx].comp)) return false;
  if (idx === 0) return true;
  const comb = parts[idx].comb;
  let up = node.parentNode;
  if (comb === ">") return matchesParts(up, parts, idx - 1);
  while (up) {
    if (matchesParts(up, parts, idx - 1)) return true;
    up = up.parentNode;
  }
  return false;
}

function compileSelector(selector) {
  const groups = splitTop(String(selector), ",").map(parseComplex);
  return (node) => groups.some((parts) => matchesParts(node, parts, parts.length - 1));
}

function descendants(root, test, firstOnly) {
  const out = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (test(child)) {
        out.push(child);
        if (firstOnly) return true;
      }
      if (visit(child)) return true;
    }
    return false;
  };
  visit(root);
  return out;
}

const SELECTOR_API = {
  querySelector(selector) {
    return descendants(this, compileSelector(selector), true)[0] || null;
  },
  querySelectorAll(selector) {
    return descendants(this, compileSelector(selector), false);
  },
  matches(selector) {
    return compileSelector(selector)(this);
  },
  closest(selector) {
    const test = compileSelector(selector);
    for (let n = this; n; n = n.parentNode) if (test(n)) return n;
    return null;
  },
};

class ParsingNode extends FakeNode {
  get nodeType() {
    if (this.tagName === "#TEXT") return 3;
    if (this.tagName === "#DOCUMENT") return 9;
    return 1;
  }

  get innerHTML() {
    return this.children.map((c) => (c.tagName === "#TEXT" ? c.textContent : c.outerHTMLish)).join("");
  }

  set innerHTML(value) {
    this.children.length = 0;
    this._text = "";
    parseInto(this, String(value == null ? "" : value));
    this.ownerDocument._notifyChildList(this);
  }

  get firstElementChild() {
    return this.children.find((c) => c.nodeType === 1) || null;
  }

  get hidden() {
    return this.hasAttribute("hidden");
  }

  set hidden(v) {
    if (v) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }

  get disabled() {
    return this.hasAttribute("disabled");
  }

  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  insertAdjacentHTML(where, html) {
    if (where !== "beforeend") throw new Error(`holes-score-dom: insertAdjacentHTML ${where} unsupported`);
    parseInto(this, html);
  }

  getClientRects() {
    return [{}];
  }
}
Object.assign(ParsingNode.prototype, SELECTOR_API);

class ParsingDocument extends FakeDocument {
  createElement(tag) {
    return new ParsingNode(tag, this);
  }

  createTextNode(text) {
    const node = new ParsingNode("#text", this);
    node.textContent = text;
    return node;
  }

  get nodeType() {
    return 9;
  }

  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
}
Object.assign(ParsingDocument.prototype, SELECTOR_API);

/** makeEnv() with a parsing document. */
export function makeScoreEnv(opts = {}) {
  const win = makeEnv(opts);
  const doc = new ParsingDocument();
  if (opts.bodyClass) doc.body.className = opts.bodyClass;
  win.document = doc;
  win.Date = Date;
  win.matchMedia = () => ({ matches: false });
  return win;
}

/** Run browser scripts (repo-relative paths) in the env, in order. */
export function load(win, files) {
  for (const f of files) vm.runInNewContext(read(f), win, { filename: f });
  return win;
}

export function keydown(target, key, extra = {}) {
  return { type: "keydown", key, target, bubbles: true, shiftKey: false, ...extra };
}

export function click(target) {
  return { type: "click", target, bubbles: true };
}

/** The visible text of a node, whitespace collapsed. */
export function text(node) {
  return String(node ? node.textContent : "").replace(/\s+/g, " ").trim();
}
