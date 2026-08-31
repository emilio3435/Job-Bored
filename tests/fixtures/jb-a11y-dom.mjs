/**
 * tests/fixtures/jb-a11y-dom.mjs
 *
 * Hand-rolled minimal DOM for vm-executing jb-a11y.js (T0 lane P0-F).
 *
 * WHY this exists: the repo has NO jsdom / linkedom dependency (see the header
 * of tests/kanban-card-attrs.test.mjs) and `npm test` is plain node:test. The
 * jb-a11y dialog primitive's whole job is focus/inert/Escape behavior, which a
 * source-shape regex pin cannot prove. So we hand-roll exactly enough DOM to
 * execute the real jb-a11y.js source and observe:
 *
 *   - document.activeElement transitions from focus() calls (with the opts bag,
 *     so `{ preventScroll: true }` is observable),
 *   - the `inert` property on body children and on parent dialogs,
 *   - document-level keydown listeners (Escape),
 *   - dispatched CustomEvents (jb:a11y:dialog:opened / :closed).
 *
 * It is deliberately NOT a spec-complete DOM. It supports the selector forms
 * jb-a11y.js actually uses (#id, .class, tag, [attr], [attr=value], compound,
 * descendant chains, comma groups) — the same engine shape as
 * tests/kanban-card-attrs.test.mjs, extended with events + focus + classList.
 *
 * Mutation check: if jb-a11y.js stops calling focus() / stops setting .inert /
 * stops listening for keydown on document, the behavioral tests using this
 * harness go red — there is no way to satisfy them without the real wiring.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Selector engine (ported from tests/kanban-card-attrs.test.mjs)
   ============================================================ */

function tokenizeSimple(sel) {
  const tokens = [];
  let i = 0;
  const s = sel;
  let m = /^([a-zA-Z][a-zA-Z0-9_-]*)/.exec(s.slice(i));
  if (m) {
    tokens.push({ kind: "tag", value: m[1] });
    i += m[0].length;
  }
  while (i < s.length) {
    const ch = s[i];
    if (ch === ".") {
      m = /^\.([a-zA-Z_][\w-]*)/.exec(s.slice(i));
      if (!m) throw new Error("bad class selector: " + s);
      tokens.push({ kind: "class", value: m[1] });
      i += m[0].length;
    } else if (ch === "#") {
      m = /^#([a-zA-Z_][\w-]*)/.exec(s.slice(i));
      if (!m) throw new Error("bad id selector: " + s);
      tokens.push({ kind: "id", value: m[1] });
      i += m[0].length;
    } else if (ch === "[") {
      const end = s.indexOf("]", i);
      if (end === -1) throw new Error("bad attr selector: " + s);
      const body = s.slice(i + 1, end);
      const eq = body.indexOf("=");
      if (eq === -1) {
        tokens.push({ kind: "attr", name: body.trim(), value: undefined });
      } else {
        const name = body.slice(0, eq).trim();
        let val = body.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        tokens.push({ kind: "attr", name, value: val });
      }
      i = end + 1;
    } else {
      throw new Error("unexpected char in selector: " + s + " at " + i);
    }
  }
  return tokens;
}

function matchesSimple(el, simpleSel) {
  if (simpleSel === "*") return true;
  for (const t of tokenizeSimple(simpleSel)) {
    if (t.kind === "tag") {
      if (el.tagName !== t.value.toUpperCase()) return false;
    } else if (t.kind === "class") {
      if (!el._classList.includes(t.value)) return false;
    } else if (t.kind === "id") {
      if (el._attrs.id !== t.value) return false;
    } else if (t.kind === "attr") {
      if (!(t.name in el._attrs)) return false;
      if (t.value !== undefined && el._attrs[t.name] !== t.value) return false;
    }
  }
  return true;
}

function walk(node, fn) {
  fn(node);
  for (const c of node.children.slice()) walk(c, fn);
}

function matchChain(root, parts) {
  const lastSel = parts[parts.length - 1];
  const matches = [];
  walk(root, (el) => {
    if (el === root) return;
    if (!matchesSimple(el, lastSel)) return;
    if (parts.length === 1) {
      matches.push(el);
      return;
    }
    let ancestor = el.parentNode;
    let pi = parts.length - 2;
    while (ancestor && pi >= 0) {
      if (matchesSimple(ancestor, parts[pi])) pi--;
      ancestor = ancestor.parentNode;
    }
    if (pi < 0) matches.push(el);
  });
  return matches;
}

function querySelectorAll(root, selector, singleOnly) {
  const groups = selector
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const group of groups) {
    const parts = group.split(/\s+/).filter(Boolean);
    for (const m of matchChain(root, parts)) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
      if (singleOnly) return out;
    }
  }
  return out;
}

/* ============================================================
   Events
   ============================================================ */

class FakeEvent {
  constructor(type, init) {
    const o = init || {};
    this.type = String(type);
    this.bubbles = o.bubbles === true;
    this.cancelable = o.cancelable === true;
    this.detail = o.detail;
    this.key = o.key;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this._stopped = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this._stopped = true;
  }
}

function addListenerMixin(node) {
  node._listeners = Object.create(null);
  node.addEventListener = function (type, fn) {
    if (typeof fn !== "function") return;
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  };
  node.removeEventListener = function (type, fn) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
  node.dispatchEvent = function (evt) {
    if (!evt.target) evt.target = this;
    let cur = this;
    while (cur) {
      const arr = cur._listeners && cur._listeners[evt.type];
      if (arr) {
        evt.currentTarget = cur;
        for (const fn of arr.slice()) fn.call(cur, evt);
      }
      if (!evt.bubbles || evt._stopped) break;
      cur = cur.parentNode || cur._eventParent || null;
    }
    return !evt.defaultPrevented;
  };
}

/* ============================================================
   Element
   ============================================================ */

const FOCUSABLE_TAGS = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
]);

/** A style bag that supports both `style.foo = x` and setProperty/getPropertyValue. */
function makeStyle() {
  const bag = {};
  Object.defineProperty(bag, "setProperty", {
    enumerable: false,
    value(name, value) {
      bag[name] = String(value);
    },
  });
  Object.defineProperty(bag, "getPropertyValue", {
    enumerable: false,
    value(name) {
      return name in bag ? bag[name] : "";
    },
  });
  Object.defineProperty(bag, "removeProperty", {
    enumerable: false,
    value(name) {
      delete bag[name];
    },
  });
  return bag;
}

function makeElement(doc, tagName) {
  const el = {
    ownerDocument: doc,
    nodeType: 1,
    tagName: String(tagName || "DIV").toUpperCase(),
    parentNode: null,
    children: [],
    _attrs: Object.create(null),
    _classList: [],
    _text: "",
    _focusCalls: [],
    _blurCalls: 0,
    value: "",
    disabled: false,
    hidden: false,
    inert: false,
    checked: false,
    style: makeStyle(),
    dataset: Object.create(null),
  };

  addListenerMixin(el);

  Object.defineProperty(el, "className", {
    get() {
      return this._classList.join(" ");
    },
    set(v) {
      this._classList = String(v || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      this._attrs.class = this._classList.join(" ");
    },
  });

  Object.defineProperty(el, "id", {
    get() {
      return this._attrs.id || "";
    },
    set(v) {
      this._attrs.id = String(v);
    },
  });

  // Reflected content attributes: in a real DOM `button.type = "button"`
  // writes the attribute, and querySelector('[type=button]') then matches.
  Object.defineProperty(el, "type", {
    get() {
      return this._attrs.type || "";
    },
    set(v) {
      this._attrs.type = String(v);
    },
  });

  Object.defineProperty(el, "htmlFor", {
    get() {
      return this._attrs.for || "";
    },
    set(v) {
      this._attrs.for = String(v);
    },
  });

  Object.defineProperty(el, "textContent", {
    get() {
      if (this.children.length === 0) return this._text;
      let out = this._text;
      for (const c of this.children) out += c.textContent;
      return out;
    },
    set(v) {
      this.children.length = 0;
      this._text = v == null ? "" : String(v);
    },
  });

  Object.defineProperty(el, "childElementCount", {
    get() {
      return this.children.length;
    },
  });

  Object.defineProperty(el, "firstElementChild", {
    get() {
      return this.children[0] || null;
    },
  });

  el.classList = {
    add: (...names) => {
      for (const n of names) {
        if (!el._classList.includes(n)) el._classList.push(n);
      }
      el._attrs.class = el._classList.join(" ");
    },
    remove: (...names) => {
      el._classList = el._classList.filter((c) => !names.includes(c));
      el._attrs.class = el._classList.join(" ");
    },
    contains: (n) => el._classList.includes(n),
    toggle: (n, force) => {
      const want = force === undefined ? !el._classList.includes(n) : !!force;
      if (want) el.classList.add(n);
      else el.classList.remove(n);
      return want;
    },
  };

  el.setAttribute = function (name, value) {
    this._attrs[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name === "tabindex") this.tabIndex = Number(value);
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
  };
  el.getAttribute = function (name) {
    return name in this._attrs ? this._attrs[name] : null;
  };
  el.hasAttribute = function (name) {
    return name in this._attrs;
  };
  el.removeAttribute = function (name) {
    delete this._attrs[name];
    if (name === "class") this.className = "";
  };
  el.appendChild = function (child) {
    if (child && child.nodeType === 11) {
      for (const c of child.children.slice()) this.appendChild(c);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  };
  el.append = function (...nodes) {
    for (const n of nodes) {
      if (typeof n === "string") this._text += n;
      else this.appendChild(n);
    }
  };
  el.removeChild = function (child) {
    const i = this.children.indexOf(child);
    if (i >= 0) {
      this.children.splice(i, 1);
      child.parentNode = null;
    }
    return child;
  };
  el.remove = function () {
    if (this.parentNode) this.parentNode.removeChild(this);
  };
  el.insertBefore = function (node, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    if (i < 0) this.children.push(node);
    else this.children.splice(i, 0, node);
    return node;
  };
  el.contains = function (other) {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  };
  el.closest = function (sel) {
    let cur = this;
    while (cur && cur.nodeType === 1) {
      if (matchesSimple(cur, sel)) return cur;
      cur = cur.parentNode;
    }
    return null;
  };
  el.matches = function (sel) {
    return querySelectorAll({ children: [this] }, sel, true).length > 0
      ? true
      : matchesSimple(this, sel);
  };
  el.querySelector = function (sel) {
    const r = querySelectorAll(this, sel, true);
    return r.length ? r[0] : null;
  };
  el.querySelectorAll = function (sel) {
    return querySelectorAll(this, sel, false);
  };
  el.focus = function (opts) {
    this._focusCalls.push(opts || null);
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  };
  el.blur = function () {
    this._blurCalls += 1;
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  };
  el.click = function () {
    this.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  };

  Object.defineProperty(el, "isFocusableTag", {
    get() {
      return FOCUSABLE_TAGS.has(this.tagName);
    },
  });

  return el;
}

/* ============================================================
   Document + window
   ============================================================ */

/**
 * Build a fresh fake DOM.
 * @returns {{window: object, document: object, context: object,
 *            flushRaf: () => void, press: (key: string) => void,
 *            events: Array<{type: string, detail: any}>}}
 */
export function createDom() {
  const doc = {
    nodeType: 9,
    tagName: "#document",
    children: [],
    _attrs: Object.create(null),
    _classList: [],
    activeElement: null,
  };
  addListenerMixin(doc);

  doc.createElement = (tag) => makeElement(doc, tag);
  doc.createTextNode = (text) => {
    const n = makeElement(doc, "#text");
    n.nodeType = 3;
    n._text = String(text == null ? "" : text);
    return n;
  };
  doc.createDocumentFragment = () => {
    const f = makeElement(doc, "#fragment");
    f.nodeType = 11;
    return f;
  };
  doc.getElementById = (id) => {
    let found = null;
    walk(doc, (el) => {
      if (el !== doc && el._attrs && el._attrs.id === id && !found) found = el;
    });
    return found;
  };
  doc.querySelector = (sel) => {
    const r = querySelectorAll(doc, sel, true);
    return r.length ? r[0] : null;
  };
  doc.querySelectorAll = (sel) => querySelectorAll(doc, sel, false);
  doc.contains = (other) => {
    let cur = other;
    while (cur) {
      if (cur === doc) return true;
      cur = cur.parentNode;
    }
    return false;
  };
  doc.appendChild = (child) => {
    child.parentNode = doc;
    doc.children.push(child);
    return child;
  };

  const html = makeElement(doc, "HTML");
  const head = makeElement(doc, "HEAD");
  const body = makeElement(doc, "BODY");
  doc.appendChild(html);
  html.appendChild(head);
  html.appendChild(body);
  doc.documentElement = html;
  doc.head = head;
  doc.body = body;
  doc.activeElement = body;
  // document-level listeners are the parent of body's bubble chain
  body._eventParent = doc;

  /** @type {Array<{type: string, detail: any}>} */
  const events = [];
  const win = {};
  addListenerMixin(win);
  doc._eventParent = win;
  const origDocDispatch = doc.dispatchEvent.bind(doc);
  doc.dispatchEvent = (evt) => {
    events.push({ type: evt.type, detail: evt.detail });
    return origDocDispatch(evt);
  };

  const rafQueue = [];
  const context = {
    window: win,
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    CustomEvent: FakeEvent,
    Event: FakeEvent,
    requestAnimationFrame: (fn) => {
      rafQueue.push(fn);
      return rafQueue.length;
    },
    cancelAnimationFrame: () => {},
  };
  win.document = doc;
  win.CustomEvent = FakeEvent;
  win.requestAnimationFrame = context.requestAnimationFrame;
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  context.globalThis = context;

  return {
    window: win,
    document: doc,
    context,
    events,
    /** Run every pending requestAnimationFrame callback. */
    flushRaf() {
      while (rafQueue.length) rafQueue.shift()();
    },
    /**
     * Dispatch a keydown on document (the level jb-a11y listens at).
     * @param {string} key
     */
    press(key) {
      const evt = new FakeEvent("keydown", { key, bubbles: true });
      doc.dispatchEvent(evt);
      return evt;
    },
    /** Dispatch a keydown that originates at an element and bubbles. */
    pressOn(el, key) {
      const evt = new FakeEvent("keydown", { key, bubbles: true });
      el.dispatchEvent(evt);
      return evt;
    },
    /** Make and append an element in one call. */
    make(tag, attrs, parent) {
      const el = makeElement(doc, tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (k === "class") el.className = v;
        else el.setAttribute(k, v);
      }
      (parent || body).appendChild(el);
      return el;
    },
  };
}

export { FakeEvent, makeElement };

/**
 * Strip comments so a source pin matches CODE, not prose.
 *
 * jb-a11y.js and jb-a11y.css document their own rules in header comments
 * ("never calls updateJobStatus", "NOT scoped to body.jb-v2"). A naive text
 * search would match the explanation and fail the file for saying the right
 * thing, so every negative source pin runs through this first.
 *
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ============================================================
   jb-a11y.js loader
   ============================================================ */

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Execute the real jb-a11y.js inside a fresh fake DOM and hand back both the
 * harness and the resulting window.JobBoredA11y surface.
 *
 * Fails loudly (rather than returning undefined) if the classic-IIFE contract
 * is broken — an accidental `export` statement or a missing window assignment
 * would otherwise show up as a confusing "cannot read property of undefined".
 */
export function loadA11y() {
  const dom = createDom();
  const src = readFileSync(join(repoRoot, "jb-a11y.js"), "utf8");
  vm.runInNewContext(src, dom.context, { filename: "jb-a11y.js" });
  const api = dom.window.JobBoredA11y;
  if (!api) {
    throw new Error(
      "jb-a11y.js did not expose window.JobBoredA11y — the classic-defer IIFE " +
        "contract is broken (an ES `export` silently kills the whole file)",
    );
  }
  return { ...dom, api };
}
