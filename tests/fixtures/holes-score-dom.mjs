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
