/**
 * HOLES BOARD — a small DOM for node:vm tests of the board's classic scripts.
 *
 * The repo ships no jsdom, and the existing fakes keep innerHTML as an opaque
 * string, so a region that builds its shell from markup and then queries it
 * (pipeline.js, dawn.js) cannot be mounted in them. This one parses the markup
 * those renderers emit into a real tree, answers the selectors they use, and
 * dispatches events with bubbling and AbortSignal removal — enough to count
 * listeners, follow focus and see which nodes a re-render replaced.
 *
 * Scope: tags, attributes, text, void elements; selectors made of tag, #id,
 * .class and [attr] / [attr="v"] parts, joined by descendant or child (>)
 * combinators, in comma lists. Not a browser: no layout, no CSS cascade.
 */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", times: "×", nbsp: " " };

function decode(s) {
  return String(s).replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, name) => {
    if (ENTITIES[name] !== undefined) return ENTITIES[name];
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return m;
  });
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/* ------------------------------ selectors ------------------------------ */

function parseCompound(src) {
  const parts = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(src))) {
    if (m.index !== consumed) throw new Error(`fake DOM: unsupported selector "${src}"`);
    consumed = re.lastIndex;
    if (m[1]) parts.tag = m[1].toLowerCase();
    else if (m[2]) parts.id = m[2];
    else if (m[3]) parts.classes.push(m[3]);
    else {
      const raw = m[5] !== undefined ? m[5].replace(/\\(.)/g, "$1") : m[6] !== undefined ? m[6] : m[7];
      parts.attrs.push({ name: m[4].toLowerCase(), value: raw });
    }
  }
  if (consumed !== src.length) throw new Error(`fake DOM: unsupported selector "${src}"`);
  return parts;
}

/** Split a selector list into compounds and combinators, outside quotes and brackets. */
function tokenizeSelector(selector) {
  const groups = [[]];
  let buf = "";
  let quote = "";
  let depth = 0;
  const push = (tok) => { if (tok) groups[groups.length - 1].push(tok); };
  for (const ch of String(selector)) {
    if (quote) { buf += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "[") depth += 1;
    if (ch === "]") depth -= 1;
    if (depth === 0 && (ch === "," || ch === ">" || /\s/.test(ch))) {
      push(buf);
      buf = "";
      if (ch === ">") push(">");
      if (ch === ",") groups.push([]);
      continue;
    }
    buf += ch;
  }
  push(buf);
  return groups;
}

function parseSelector(selector) {
  return tokenizeSelector(selector).map((tokens) => {
    const steps = [];
    let combinator = " ";
    for (const token of tokens) {
      if (token === ">") { combinator = ">"; continue; }
      steps.push({ combinator, compound: parseCompound(token) });
      combinator = " ";
    }
    return steps;
  });
}

function matchesCompound(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && el.getAttribute("id") !== c.id) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== undefined && el.getAttribute(a.name) !== a.value) return false;
  }
  return true;
}

function matchesSteps(el, steps, i) {
  if (!matchesCompound(el, steps[i].compound)) return false;
  if (i === 0) return true;
  const comb = steps[i].combinator;
  let p = el.parentNode;
  if (comb === ">") return !!p && p.nodeType === 1 && matchesSteps(p, steps, i - 1);
  while (p && p.nodeType === 1) {
    if (matchesSteps(p, steps, i - 1)) return true;
    p = p.parentNode;
  }
  return false;
}

function matchesSelector(el, selector) {
  return parseSelector(selector).some((steps) => matchesSteps(el, steps, steps.length - 1));
}

/* -------------------------------- events -------------------------------- */

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.detail = init.detail;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this._stop = false;
    this._stopNow = false;
    Object.assign(this, init.props || {});
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}

class Target {
  constructor() { this._listeners = []; }
  addEventListener(type, fn, opts) {
    if (typeof fn !== "function") return;
    const capture = typeof opts === "boolean" ? opts : !!(opts && opts.capture);
    const once = !!(opts && typeof opts === "object" && opts.once);
    const signal = opts && typeof opts === "object" ? opts.signal : null;
    if (signal && signal.aborted) return;
    if (this._listeners.some((l) => l.type === type && l.fn === fn && l.capture === capture)) return;
    const entry = { type, fn, capture, once };
    this._listeners.push(entry);
    if (signal) signal.addEventListener("abort", () => this._remove(entry), { once: true });
  }
  removeEventListener(type, fn, opts) {
    const capture = typeof opts === "boolean" ? opts : !!(opts && opts.capture);
    const entry = this._listeners.find((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (entry) this._remove(entry);
  }
  _remove(entry) {
    const i = this._listeners.indexOf(entry);
    if (i >= 0) this._listeners.splice(i, 1);
  }
  listenerCount(type) {
    return this._listeners.filter((l) => !type || l.type === type).length;
  }
  _fire(ev, capturePhase) {
    ev.currentTarget = this;
    for (const l of [...this._listeners]) {
      if (l.type !== ev.type || l.capture !== capturePhase) continue;
      if (!this._listeners.includes(l)) continue;
      if (l.once) this._remove(l);
      l.fn.call(this, ev);
      if (ev._stopNow) return;
    }
  }
}

/* -------------------------------- nodes -------------------------------- */

class Node extends Target {
  constructor(doc) {
    super();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  appendChild(child) {
    if (child.nodeType === 11) {
      for (const c of [...child.childNodes]) this.appendChild(c);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child, ref) {
    if (!ref) return this.appendChild(child);
    if (child.nodeType === 11) {
      for (const c of [...child.childNodes]) this.insertBefore(c, ref);
      return child;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    const i = this.childNodes.indexOf(ref);
    child.parentNode = this;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    this.ownerDocument._forgetFocus(child);
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v !== "" && v != null) this.appendChild(new Text(this.ownerDocument, String(v)));
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (matchesSelector(c, selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    if (this.ownerDocument && path[path.length - 1] === this.ownerDocument && this.ownerDocument.defaultView) {
      path.push(this.ownerDocument.defaultView);
    }
    for (let i = path.length - 1; i >= 1; i--) {
      path[i]._fire(ev, true);
      if (ev._stop) return !ev.defaultPrevented;
    }
    this._fire(ev, true);
    if (!ev._stopNow) this._fire(ev, false);
    if (ev.bubbles) {
      for (let i = 1; i < path.length && !ev._stop; i++) path[i]._fire(ev, false);
    }
    return !ev.defaultPrevented;
  }
}

class Text extends Node {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = data; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class Fragment extends Node {
  constructor(doc) { super(doc); this.nodeType = 11; }
}

class ClassList {
  constructor(el) { this.el = el; }
  _list() { return (this.el.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  _set(list) { this.el.setAttribute("class", list.join(" ")); }
  contains(c) { return this._list().includes(c); }
  add(...cs) { const l = this._list(); for (const c of cs) if (!l.includes(c)) l.push(c); this._set(l); }
  remove(...cs) { this._set(this._list().filter((c) => !cs.includes(c))); }
  toggle(c, force) {
    const on = force === undefined ? !this.contains(c) : !!force;
    if (on) this.add(c); else this.remove(c);
    return on;
  }
}

const FOCUSABLE = new Set(["button", "a", "input", "select", "textarea"]);

class Element extends Node {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attributes = new Map();
    this.classList = new ClassList(this);
    const styleStore = {};
    this.style = new Proxy(styleStore, {
      get: (t, k) => (k === "setProperty" ? (n, v) => { t[n] = String(v); }
        : k === "getPropertyValue" ? (n) => t[n] || ""
          : k === "removeProperty" ? (n) => { delete t[n]; }
            : t[k] === undefined ? "" : t[k]),
      set: (t, k, v) => { t[k] = String(v); return true; },
    });
    this.inert = false;
    this.disabled = false;
    this._value = "";
    this._focusCalls = 0;
  }
  get id() { return this.getAttribute("id") || ""; }
  set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(v) { if (v) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  get value() { return this._value; }
  set value(v) { this._value = String(v == null ? "" : v); }
  getAttribute(n) { const v = this.attributes.get(String(n).toLowerCase()); return v === undefined ? null : v; }
  setAttribute(n, v) {
    const name = String(n).toLowerCase();
    const before = this.attributes.get(name);
    this.attributes.set(name, String(v));
    if (name === "value") this._value = String(v);
    if (name === "disabled") this.disabled = true;
    if (before !== String(v)) this.ownerDocument._attributeChanged(this, name);
  }
  removeAttribute(n) {
    const name = String(n).toLowerCase();
    const had = this.attributes.has(name);
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
    if (had) this.ownerDocument._attributeChanged(this, name);
  }
  get dataset() {
    const el = this;
    const attr = (k) => "data-" + String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    return new Proxy({}, {
      get: (_t, k) => (typeof k === "string" ? (el.getAttribute(attr(k)) ?? undefined) : undefined),
      set: (_t, k, v) => { el.setAttribute(attr(k), v); return true; },
      deleteProperty: (_t, k) => { el.removeAttribute(attr(k)); return true; },
    });
  }
  hasAttribute(n) { return this.attributes.has(String(n).toLowerCase()); }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matchesSelector(n, selector)) return n;
    return null;
  }
  get innerHTML() { return this.childNodes.map(serialize).join(""); }
  set innerHTML(html) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    for (const n of parseHtml(this.ownerDocument, String(html))) this.appendChild(n);
  }
  get outerHTML() { return serialize(this); }
  before(...nodes) { for (const n of nodes) this.parentNode.insertBefore(n, this); }
  cloneNode(deep) {
    const copy = new Element(this.ownerDocument, this.tagName);
    for (const [k, v] of this.attributes) copy.attributes.set(k, v);
    if (deep) for (const c of this.childNodes) copy.appendChild(c.nodeType === 1 ? c.cloneNode(true) : new Text(this.ownerDocument, c.data));
    return copy;
  }
  _isFocusable() {
    if (this.disabled) return false;
    return FOCUSABLE.has(this.tagName.toLowerCase()) || this.hasAttribute("tabindex");
  }
  focus() {
    this._focusCalls += 1;
    if (!this._isFocusable() || !this.ownerDocument.contains(this)) return;
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) {
      if (n.hidden || n.inert) return;
    }
    this.ownerDocument.activeElement = this;
  }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  select() {}
  click() { this.dispatchEvent(new FakeEvent("click", { bubbles: true, cancelable: true, props: { button: 0 } })); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
}

function serialize(n) {
  if (n.nodeType === 3) return escapeText(n.data);
  if (n.nodeType !== 1) return "";
  const tag = n.tagName.toLowerCase();
  const attrs = [...n.attributes].map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`)).join("");
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${n.childNodes.map(serialize).join("")}</${tag}>`;
}

function parseHtml(doc, html) {
  const root = new Fragment(doc);
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === tag) { stack.length = i; break; }
      }
      continue;
    }
    if (m[2]) {
      const el = doc.createElement(m[2]);
      const attrRe = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attrRe.exec(m[3] || ""))) {
        const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : "";
        el.setAttribute(a[1], decode(v));
      }
      top.appendChild(el);
      if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el);
      continue;
    }
    if (m[5] && m[5].length) top.appendChild(new Text(doc, decode(m[5])));
  }
  return [...root.childNodes];
}

class FakeDocument extends Node {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.readyState = "complete";
    this.documentElement = new Element(this, "html");
    this.appendChild(this.documentElement);
    this.head = new Element(this, "head");
    this.body = new Element(this, "body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
    this.defaultView = null;
    this._observers = [];
    this._enqueue = (fn) => fn();
  }
  _attributeChanged(target, name) {
    for (const mo of this._observers) {
      for (const t of mo.targets) {
        if (t.target !== target || !t.opts || !t.opts.attributes) continue;
        if (Array.isArray(t.opts.attributeFilter) && !t.opts.attributeFilter.includes(name)) continue;
        this._enqueue(() => { if (mo.targets.length) mo.cb([{ type: "attributes", attributeName: name, target }], mo); });
      }
    }
  }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(_ns, tag) { return new Element(this, tag); }
  createTextNode(data) { return new Text(this, data); }
  createDocumentFragment() { return new Fragment(this); }
  getElementById(id) { return this.querySelector(`#${id}`); }
  _forgetFocus(node) {
    if (this.activeElement && node.contains && node.contains(this.activeElement)) this.activeElement = this.body;
  }
  elementsFromPoint() { return []; }
  elementFromPoint() { return null; }
}

/**
 * A window + document pair for vm.runInNewContext. Timers and idle callbacks
 * are queued, never run on their own: call flush() to drain them.
 */
export function createBoardEnv({ bodyClass = "jb-v2", html = "", search = "", hostname = "localhost" } = {}) {
  const document = new FakeDocument();
  const queue = [];
  document._enqueue = (fn) => queue.push(fn);
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; this.targets = []; document._observers.push(this); }
    observe(target, opts) { this.targets.push({ target, opts: opts || {} }); }
    disconnect() { this.targets = []; }
    takeRecords() { return []; }
  }
  if (bodyClass) document.body.className = bodyClass;
  if (html) document.body.innerHTML = html;
  let now = 1_700_000_000_000;
  let seq = 0;
  const timers = new Map();
  function setTimeoutFake(fn, ms = 0) {
    const id = ++seq;
    timers.set(id, { fn, at: now + Number(ms || 0) });
    return id;
  }
  function clearTimeoutFake(id) { timers.delete(id); }
  const window = new Target();
  Object.assign(window, {
    document,
    location: { hostname, pathname: "/", search, hash: "", href: `http://${hostname}/` },
    localStorage: (() => {
      const map = new Map();
      return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
    })(),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestIdleCallback: (cb) => { queue.push(() => cb({ didTimeout: false, timeRemaining: () => 0 })); return queue.length; },
    requestAnimationFrame: (cb) => { queue.push(() => cb(now)); return queue.length; },
    setTimeout: setTimeoutFake,
    clearTimeout: clearTimeoutFake,
    CustomEvent: class CustomEvent extends FakeEvent {},
    Event: FakeEvent,
    MutationObserver: FakeMutationObserver,
    AbortController,
    URL,
    console,
    Date: class extends Date {
      constructor(...args) { if (args.length) super(...args); else super(now); }
      static now() { return now; }
    },
  });
  window.dispatchEvent = (ev) => {
    if (!ev.target) ev.target = window;
    window._fire(ev, true);
    if (!ev._stopNow) window._fire(ev, false);
    return !ev.defaultPrevented;
  };
  document.defaultView = window;
  window.window = window;
  window.globalThis = window;
  /** Run queued idle callbacks and frames, plus timers due within `ms`. */
  function flush(ms = 0) {
    const until = now + ms;
    for (let guard = 0; guard < 500; guard++) {
      if (queue.length) { queue.shift()(); continue; }
      const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      if (due[1].at > now) now = due[1].at;
      due[1].fn();
    }
    if (until > now) now = until;
  }
  function advance(ms) { flush(ms); }
  function fire(target, type, init = {}) {
    const ev = new FakeEvent(type, { bubbles: init.bubbles !== false, cancelable: true, detail: init.detail, props: init.props });
    target.dispatchEvent(ev);
    return ev;
  }
  return { window, document, flush, advance, fire, observers: document._observers, FakeEvent };
}
