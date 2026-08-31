import { inspect } from "node:util";

/* Minimal fake DOM for executing the repo's classic-global browser scripts
   inside node:vm. There is no jsdom in this repo (see AGENTS.md); the two
   established idioms are source-string contract tests and node:vm execution
   against hand-rolled fakes (tests/dawn-data-lead-stories.test.mjs).
   Those fakes are read-only card stubs — this one adds the parts a *renderer*
   needs: element creation, appendChild trees, a small CSS-selector matcher,
   and a MutationObserver that actually fires on class changes so the
   body.jb-v2 activation race is testable rather than merely asserted about.

   Deliberately partial: it implements exactly what lattice.js / today.js
   touch. Anything else throws or returns null so a test never silently
   passes against a hole in the fake. */

const SELECTOR_TOKEN =
  /^([a-zA-Z][\w-]*)?((?:[#.][\w-]+|\[[\w-]+(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[^\]]*))?\])*)$/;

function parseSimple(token) {
  const m = SELECTOR_TOKEN.exec(token);
  if (!m) throw new Error(`jb-dom: unsupported selector part "${token}"`);
  const spec = { tag: m[1] ? m[1].toLowerCase() : null, id: null, classes: [], attrs: [] };
  const rest = m[2] || "";
  const re = /([#.])([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let part;
  while ((part = re.exec(rest))) {
    if (part[1] === "#") spec.id = part[2];
    else if (part[1] === ".") spec.classes.push(part[2]);
    else spec.attrs.push({ name: part[3], value: part[4] ?? part[5] ?? part[6] ?? null });
  }
  return spec;
}

function parseSelector(selector) {
  return String(selector)
    .trim()
    .split(/\s+/)
    .map(parseSimple);
}

function matchesSimple(node, spec) {
  if (spec.tag && node.tagName.toLowerCase() !== spec.tag) return false;
  if (spec.id && node.id !== spec.id) return false;
  for (const cls of spec.classes) {
    if (!node.classList.contains(cls)) return false;
  }
  for (const attr of spec.attrs) {
    if (!node.hasAttribute(attr.name)) return false;
    if (attr.value != null && node.getAttribute(attr.name) !== attr.value) return false;
  }
  return true;
}

function matchesChain(node, chain) {
  if (!matchesSimple(node, chain[chain.length - 1])) return false;
  let ancestor = node.parentNode;
  for (let i = chain.length - 2; i >= 0; i--) {
    let found = false;
    while (ancestor) {
      if (matchesSimple(ancestor, chain[i])) {
        found = true;
        ancestor = ancestor.parentNode;
        break;
      }
      ancestor = ancestor.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

function walk(node, visit) {
  for (const child of node.children) {
    visit(child);
    walk(child, visit);
  }
}

class FakeNode {
  constructor(tagName, doc) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.style = {};
    this.dataset = Object.create(null);
    this._text = "";
    this._listeners = Object.create(null);
    this.scrollLeft = 0;
    this.focusCount = 0;
    const self = this;
    this.classList = {
      add(...names) {
        const list = self._classes();
        let changed = false;
        for (const n of names) if (!list.includes(n)) { list.push(n); changed = true; }
        if (changed) self._setClass(list.join(" "));
      },
      remove(...names) {
        const next = self._classes().filter((c) => !names.includes(c));
        self._setClass(next.join(" "));
      },
      contains(name) {
        return self._classes().includes(name);
      },
      toggle(name, force) {
        const has = self.classList.contains(name);
        const want = force === undefined ? !has : !!force;
        if (want) self.classList.add(name);
        else self.classList.remove(name);
        return want;
      },
    };
  }

  _classes() {
    return String(this.attributes.class || "").split(/\s+/).filter(Boolean);
  }

  _setClass(value) {
    this.attributes.class = value;
    this.ownerDocument._notifyAttribute(this, "class");
  }

  get className() {
    return this.attributes.class || "";
  }

  set className(value) {
    this._setClass(String(value == null ? "" : value));
  }

  get id() {
    return this.attributes.id || "";
  }

  set id(value) {
    this.attributes.id = String(value);
  }

  setAttribute(name, value) {
    if (name === "class") return this._setClass(String(value));
    this.attributes[name] = String(value);
    this.ownerDocument._notifyAttribute(this, name);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  appendChild(child) {
    if (child == null) return child;
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument._notifyChildList(this);
    return child;
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) {
      this.children.splice(i, 1);
      child.parentNode = null;
      this.ownerDocument._notifyChildList(this);
    }
    return child;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get textContent() {
    if (!this.children.length) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(value) {
    this.children.length = 0;
    this._text = String(value == null ? "" : value);
  }

  /* innerHTML is write-mostly in these renderers: they either clear a region
     ("") or stamp a trusted tokenized string. We keep the raw string for
     assertions and drop children on any write, which is what the callers
     depend on. */
  get innerHTML() {
    if (this._html != null && !this.children.length) return this._html;
    return this.children.map((c) => c.outerHTMLish).join("");
  }

  set innerHTML(value) {
    this._html = String(value == null ? "" : value);
    this.children.length = 0;
    this.ownerDocument._notifyChildList(this);
  }

  get outerHTMLish() {
    const attrs = Object.keys(this.attributes)
      .map((k) => ` ${k}="${this.attributes[k]}"`)
      .join("");
    const tag = this.tagName.toLowerCase();
    return `<${tag}${attrs}>${this.innerHTML || this._text}</${tag}>`;
  }

  querySelector(selector) {
    const chain = parseSelector(selector);
    let hit = null;
    walk(this, (node) => {
      if (!hit && matchesChain(node, chain)) hit = node;
    });
    return hit;
  }

  querySelectorAll(selector) {
    const chain = parseSelector(selector);
    const out = [];
    walk(this, (node) => {
      if (matchesChain(node, chain)) out.push(node);
    });
    return out;
  }

  closest(selector) {
    const chain = parseSelector(selector);
    let node = this;
    while (node) {
      if (matchesChain(node, chain)) return node;
      node = node.parentNode;
    }
    return null;
  }

  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  /* Events bubble, because every renderer in this repo delegates from a
     container rather than binding per element. A listener claims a cancelable
     event with preventDefault(); dispatchEvent returns false when it does,
     which is how the jb:closure:change / jb:role:open default bindings work. */
  dispatchEvent(event) {
    if (typeof event.stopPropagation !== "function") event.stopPropagation = () => {};
    const userStop = event.stopPropagation;
    event.stopPropagation = function () {
      event.__stopped = true;
      userStop.call(this);
    };
    if (typeof event.preventDefault !== "function") {
      event.preventDefault = () => {
        if (event.cancelable !== false) event.defaultPrevented = true;
      };
    }
    let node = this;
    while (node) {
      for (const fn of (node._listeners[event.type] || []).slice()) {
        fn.call(node, event);
        if (event.__stopped) return !event.defaultPrevented;
      }
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }

  focus() {
    this.focusCount += 1;
    this.ownerDocument.activeElement = this;
  }

  select() {}

  /* Nodes are cyclic (parentNode/ownerDocument/_observers). Without this an
     assertion failure that prints one spends ~50s serializing the graph. */
  [inspect.custom]() {
    const cls = this.className ? "." + this.className.trim().split(/\s+/).join(".") : "";
    return `<${this.tagName.toLowerCase()}${this.id ? "#" + this.id : ""}${cls}>`;
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super("#document", null);
    this.ownerDocument = this;
    this.readyState = "complete";
    this._observers = [];
    this.documentElement = this.createElement("html");
    this.documentElement.parentNode = this;
    this.body = this.createElement("body");
    this.children.push(this.documentElement);
    this.documentElement.children.push(this.body);
    this.body.parentNode = this.documentElement;
    this.activeElement = this.body;
  }

  createElement(tag) {
    return new FakeNode(tag, this);
  }

  createTextNode(text) {
    const node = new FakeNode("#text", this);
    node.textContent = text;
    return node;
  }

  createDocumentFragment() {
    return new FakeNode("#fragment", this);
  }

  getElementById(id) {
    let hit = null;
    walk(this, (node) => {
      if (!hit && node.id === id) hit = node;
    });
    return hit;
  }

  _notifyAttribute(target, name) {
    for (const rec of this._observers) {
      if (rec.target !== target) continue;
      if (!rec.options.attributes && !rec.options.attributeFilter) continue;
      const filter = rec.options.attributeFilter;
      if (filter && !filter.includes(name)) continue;
      rec.observer._fire([{ type: "attributes", target, attributeName: name }]);
    }
  }

  _notifyChildList(target) {
    for (const rec of this._observers) {
      if (!rec.options.childList) continue;
      const same = rec.target === target;
      const inSubtree = rec.options.subtree && target.closest
        ? isAncestor(rec.target, target)
        : false;
      if (!same && !inSubtree) continue;
      rec.observer._fire([{ type: "childList", target }]);
    }
  }
}

function isAncestor(maybeAncestor, node) {
  let cur = node.parentNode;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = cur.parentNode;
  }
  return false;
}

function makeMutationObserver(doc) {
  return class MutationObserver {
    constructor(callback) {
      this._callback = callback;
      this._records = [];
    }
    observe(target, options) {
      doc._observers.push({ observer: this, target, options: options || {} });
    }
    disconnect() {
      doc._observers = doc._observers.filter((r) => r.observer !== this);
    }
    takeRecords() {
      const out = this._records;
      this._records = [];
      return out;
    }
    _fire(records) {
      this._callback(records, this);
    }
  };
}

function makeLocalStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
}

/** Build a document plus the window-ish globals the browser scripts read.
 *  `regions` is a list of data-region names to pre-mount under body. */
export function makeEnv(opts = {}) {
  const doc = new FakeDocument();
  if (opts.bodyClass) doc.body.className = opts.bodyClass;
  doc.readyState = opts.readyState || "complete";

  for (const name of opts.regions || []) {
    const section = doc.createElement("section");
    section.setAttribute("data-region", name);
    doc.body.appendChild(section);
  }
  for (const id of opts.ids || []) {
    const node = doc.createElement("div");
    node.id = id;
    doc.body.appendChild(node);
  }

  const timers = [];
  /* window is its own event target: AGENT_CONTRACT.md has these events
     dispatched on BOTH window and document, and a test that listens on one
     must not see the other's copy. */
  const winListeners = Object.create(null);
  const win = {
    document: doc,
    localStorage: makeLocalStorage(opts.localStorage),
    location: { search: "", hash: "" },
    MutationObserver: makeMutationObserver(doc),
    requestAnimationFrame: (fn) => { timers.push(fn); return timers.length; },
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    addEventListener: (type, fn) => {
      (winListeners[type] || (winListeners[type] = [])).push(fn);
    },
    removeEventListener: (type, fn) => {
      const list = winListeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchEvent: (ev) => {
      for (const fn of (winListeners[ev.type] || []).slice()) fn.call(win, ev);
      return !ev.defaultPrevented;
    },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = (init && init.detail) || null;
        this.bubbles = !!(init && init.bubbles);
      }
    },
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    Boolean,
    Promise,
    Set,
    Map,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  /** Run every queued rAF/setTimeout callback (renderers schedule through them). */
  win.flushTimers = () => {
    let guard = 0;
    while (timers.length && guard++ < 50) {
      const fn = timers.shift();
      try { fn(0); } catch (err) { win.__flushError = err; }
    }
  };
  return win;
}

export { FakeNode, FakeDocument };
