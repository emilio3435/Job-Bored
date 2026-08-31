/* ============================================================
   tests/fixtures/scribe/scribe-dom.mjs
   ------------------------------------------------------------
   Shared hand-rolled DOM + clock harness for the scribe lane.

   Extracted verbatim from tests/scribe.test.mjs (the richest fake
   DOM in the repo) so the boot-binding, real-score, refine-truth
   and stale-export probes reuse ONE harness instead of four
   copies. There is no jsdom in this repo (see
   tests/kanban-card-attrs.test.mjs) — scribe.js renders via
   region.innerHTML and walks the result with querySelector /
   cloneNode / textContent, so the fake parses the HTML the module
   emits.

   Additions over the original (all required by the T0 lane, none
   of which change the semantics the original tests relied on):
     - window/document are real event targets so the jb:ats:state
       and jb:draft:saved buses can be driven from a test.
     - CustomEvent with `detail`.
     - MutationObserver over body attribute changes, so the
       body.jb-v2 boot race (SCRIBE-01) is reproducible.
     - loadScribe() can load scribe-state.js / scribe-score-adapter.js
       alongside scribe.js and stub JobBoredApp + CommandCenterUserContent.
   ============================================================ */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const sourceCache = new Map();
function readSource(rel) {
  if (!sourceCache.has(rel)) sourceCache.set(rel, readFileSync(join(repoRoot, rel), "utf8"));
  return sourceCache.get(rel);
}

export class FakeEvent {
  constructor(type, opts = {}) {
    this.type = String(type);
    this.bubbles = !!opts.bubbles;
    this.defaultPrevented = false;
    this.target = null;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
}

export class FakeCustomEvent extends FakeEvent {
  constructor(type, opts = {}) {
    super(type, opts);
    this.detail = opts && "detail" in opts ? opts.detail : null;
  }
}

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Minimal listener bag shared by window, document and elements. */
function addEventTargetMethods(target) {
  const listeners = new Map();
  target._listeners = listeners;
  target.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  target.removeEventListener = (type, fn) => {
    const fns = listeners.get(type);
    if (!fns) return;
    const idx = fns.indexOf(fn);
    if (idx >= 0) fns.splice(idx, 1);
  };
  target.dispatchEvent = (evt) => {
    if (!evt.target) evt.target = target;
    const fns = listeners.get(evt.type);
    if (fns) for (const fn of [...fns]) fn.call(target, evt);
    return !evt.defaultPrevented;
  };
  return target;
}

export function makeDom() {
  function makeText(text) {
    return { nodeType: 3, data: String(text), parentNode: null };
  }

  // Plain constructor so scribe's smoke hook can monkey-patch
  // HTMLElement.prototype.click exactly like it does in a browser.
  // Defined per-load so a patch in one test never leaks into another.
  function FakeHTMLElement() {}
  FakeHTMLElement.prototype.click = function () {
    this.dispatchEvent(new FakeEvent("click", { bubbles: true }));
  };

  /** Observers registered through the fake MutationObserver. */
  const attributeObservers = [];

  class FakeElement extends FakeHTMLElement {
    constructor(tagName) {
      super();
      this.nodeType = 1;
      this.tagName = String(tagName || "div").toUpperCase();
      this.parentNode = null;
      this.childNodes = [];
      this.dataset = {};
      this.style = {};
      this.value = "";
      this._attrs = new Map();
      this._classes = new Set();
      this._listeners = new Map();
      this._scrollCalls = [];
      this._focusCalls = 0;
      const classes = this._classes;
      const notify = () => this._notifyAttribute("class");
      this.classList = {
        add: (...cs) => {
          cs.forEach((c) => classes.add(c));
          notify();
        },
        remove: (...cs) => {
          cs.forEach((c) => classes.delete(c));
          notify();
        },
        contains: (c) => classes.has(c),
        toggle: (c) => {
          const out = classes.has(c) ? classes.delete(c) : classes.add(c);
          notify();
          return out;
        },
      };
    }
    _notifyAttribute(name) {
      for (const entry of attributeObservers) {
        if (entry.target !== this) continue;
        if (entry.filter && !entry.filter.includes(name)) continue;
        entry.callback([{ type: "attributes", attributeName: name, target: this }]);
      }
    }
    get id() {
      return this._attrs.get("id") || "";
    }
    set id(v) {
      this._attrs.set("id", String(v));
    }
    get className() {
      return [...this._classes].join(" ");
    }
    set className(v) {
      this._classes.clear();
      String(v || "").split(/\s+/).filter(Boolean).forEach((c) => this._classes.add(c));
      this._notifyAttribute("class");
    }
    get textContent() {
      let out = "";
      for (const c of this.childNodes) out += c.nodeType === 3 ? c.data : c.textContent;
      return out;
    }
    set textContent(v) {
      this.childNodes.length = 0;
      const text = String(v == null ? "" : v);
      if (text) {
        const node = makeText(text);
        node.parentNode = this;
        this.childNodes.push(node);
      }
    }
    set innerHTML(html) {
      this.childNodes.length = 0;
      parseInto(this, String(html == null ? "" : html));
    }
    setAttribute(name, value) {
      const v = String(value);
      this._attrs.set(name, v);
      if (name === "class") this.className = v;
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[key] = v;
      }
      this._notifyAttribute(name);
    }
    getAttribute(name) {
      return this._attrs.has(name) ? this._attrs.get(name) : null;
    }
    removeAttribute(name) {
      this._attrs.delete(name);
    }
    appendChild(child) {
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const fns = this._listeners.get(type);
      if (!fns) return;
      const idx = fns.indexOf(fn);
      if (idx >= 0) fns.splice(idx, 1);
    }
    dispatchEvent(evt) {
      if (!evt.target) evt.target = this;
      let node = this;
      while (node) {
        const fns = node._listeners && node._listeners.get(evt.type);
        if (fns) for (const fn of [...fns]) fn.call(node, evt);
        if (!evt.bubbles) break;
        node = node.parentNode;
      }
      return !evt.defaultPrevented;
    }
    cloneNode(deep) {
      const copy = new FakeElement(this.tagName);
      for (const [k, v] of this._attrs) copy.setAttribute(k, v);
      copy.value = this.value;
      if (deep) {
        for (const c of this.childNodes) {
          copy.appendChild(c.nodeType === 3 ? makeText(c.data) : c.cloneNode(true));
        }
      }
      return copy;
    }
    replaceWith(replacement) {
      const parent = this.parentNode;
      if (!parent) return;
      const idx = parent.childNodes.indexOf(this);
      const node = typeof replacement === "string" ? makeText(replacement) : replacement;
      node.parentNode = parent;
      parent.childNodes[idx] = node;
    }
    querySelectorAll(sel) {
      return collectElements(this).filter((el) => matchesSelector(el, sel));
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    closest(sel) {
      let node = this;
      while (node && node.nodeType === 1) {
        if (matchesSelector(node, sel)) return node;
        node = node.parentNode;
      }
      return null;
    }
    focus() {
      this._focusCalls += 1;
    }
    scrollIntoView(opts) {
      this._scrollCalls.push(opts || null);
    }
  }

  function collectElements(root, out = []) {
    for (const c of root.childNodes) {
      if (c && c.nodeType === 1) {
        out.push(c);
        collectElements(c, out);
      }
    }
    return out;
  }

  // Selector support: #id, tag, .class, [attr], [attr="value"],
  // compounds thereof, and comma-separated OR lists — everything
  // scribe.js actually uses (no descendant combinators needed).
  function matchesCompound(el, sel) {
    let rest = sel.trim();
    const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
    if (tagMatch) {
      if (el.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) return false;
      rest = rest.slice(tagMatch[1].length);
    }
    const partRe = /([#.][\w-]+|\[[^\]]+\])/g;
    let m;
    while ((m = partRe.exec(rest))) {
      const part = m[1];
      if (part[0] === "#") {
        if (el.id !== part.slice(1)) return false;
      } else if (part[0] === ".") {
        if (!el._classes.has(part.slice(1))) return false;
      } else {
        const body = part.slice(1, -1);
        const eq = body.indexOf("=");
        if (eq === -1) {
          if (!el._attrs.has(body.trim())) return false;
        } else {
          const name = body.slice(0, eq).trim();
          let val = body.slice(eq + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (el._attrs.get(name) !== val) return false;
        }
      }
    }
    return true;
  }

  function matchesSelector(el, selector) {
    return String(selector)
      .split(",")
      .some((s) => matchesCompound(el, s.trim()));
  }

  // Minimal well-formed-HTML parser for the markup scribe.js emits
  // (double-quoted attrs, boolean attrs, custom elements, <br />).
  function parseInto(parent, html) {
    const stack = [parent];
    let i = 0;
    while (i < html.length) {
      const lt = html.indexOf("<", i);
      if (lt === -1) {
        appendTextTo(stack[stack.length - 1], html.slice(i));
        break;
      }
      if (lt > i) appendTextTo(stack[stack.length - 1], html.slice(i, lt));
      const gt = html.indexOf(">", lt);
      if (gt === -1) break;
      const raw = html.slice(lt + 1, gt).trim();
      if (raw.startsWith("/")) {
        if (stack.length > 1) stack.pop();
      } else if (!raw.startsWith("!")) {
        const selfClosing = raw.endsWith("/");
        const tagBody = selfClosing ? raw.slice(0, -1) : raw;
        const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(tagBody);
        const el = new FakeElement(nameMatch[1]);
        const attrSrc = tagBody.slice(nameMatch[1].length);
        const attrRe = /([a-zA-Z_][a-zA-Z0-9_:.-]*)(?:\s*=\s*"([^"]*)")?/g;
        let am;
        while ((am = attrRe.exec(attrSrc))) {
          el.setAttribute(am[1], am[2] === undefined ? "" : decodeEntities(am[2]));
        }
        stack[stack.length - 1].appendChild(el);
        if (!selfClosing && !VOID_TAGS.has(nameMatch[1].toLowerCase())) stack.push(el);
      }
      i = gt + 1;
    }
  }

  function appendTextTo(parent, text) {
    if (!text) return;
    const node = makeText(decodeEntities(text));
    node.parentNode = parent;
    parent.childNodes.push(node);
  }

  const docListeners = [];
  const body = new FakeElement("body");
  const document = addEventTargetMethods({
    readyState: "complete",
    body,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => makeText(text),
    getElementById: (id) => collectElements(body).find((el) => el.id === id) || null,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
  });
  // Keep the original recording behavior (tests assert the
  // DOMContentLoaded registration) on top of real dispatch.
  const rawAddDocListener = document.addEventListener;
  document.addEventListener = (type, fn) => {
    docListeners.push({ type, fn });
    rawAddDocListener(type, fn);
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this._entries = [];
    }
    observe(target, opts) {
      const entry = {
        target,
        callback: this.callback,
        filter: opts && opts.attributeFilter ? [...opts.attributeFilter] : null,
      };
      this._entries.push(entry);
      attributeObservers.push(entry);
    }
    disconnect() {
      for (const entry of this._entries) {
        const idx = attributeObservers.indexOf(entry);
        if (idx >= 0) attributeObservers.splice(idx, 1);
      }
      this._entries.length = 0;
    }
  }

  return {
    FakeHTMLElement,
    FakeElement,
    makeText,
    body,
    document,
    docListeners,
    MutationObserver: FakeMutationObserver,
    attributeObservers,
  };
}

export function makeTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    set(fn, ms) {
      const id = nextId++;
      tasks.set(id, { fn, ms });
      return id;
    },
    clear(id) {
      tasks.delete(id);
    },
    count() {
      return tasks.size;
    },
    pending() {
      return [...tasks.values()].map((t) => t.ms);
    },
    flush() {
      const snapshot = [...tasks.entries()];
      for (const [id, task] of snapshot) {
        tasks.delete(id);
        task.fn();
      }
    },
  };
}

export const ALL_LEGACY_BUTTONS = [
  "resumeGeneratePrint",
  "resumeGenerateCopy",
  "resumeGenerateDone",
  "resumeGenerateClose",
  "resumeGenerateRefine",
];

/** Let every queued microtask (awaited promises inside the module) settle. */
export function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Load scribe.js (and optionally its sibling lane modules) into a fresh
 * VM context with a hand-rolled DOM, a fake clock and stubbable hosts.
 */
export function loadScribe({
  v2 = true,
  withRegion = true,
  readyState = "complete",
  search = "",
  legacyText = "",
  withOutput = true,
  withFeedback = true,
  buttons = ALL_LEGACY_BUTTONS,
  withThemeSelect = false,
  withDraftTabs = false,
  modules = ["scribe.js"],
  jobBoredApp = null,
  userContent = null,
  a11y = null,
} = {}) {
  const dom = makeDom();
  const { FakeElement, body } = dom;
  dom.document.readyState = readyState;
  if (v2) body.classList.add("jb-v2");

  let region = null;
  if (withRegion) {
    region = new FakeElement("section");
    region.setAttribute("data-region", "scribe");
    body.appendChild(region);
  }

  const legacyClicks = [];
  const els = {};
  if (withOutput) {
    const ta = new FakeElement("textarea");
    ta.id = "resumeGenerateOutput";
    ta.value = legacyText;
    body.appendChild(ta);
    els.output = ta;
  }
  if (withFeedback) {
    const fb = new FakeElement("textarea");
    fb.id = "resumeGenerateFeedback";
    body.appendChild(fb);
    els.feedback = fb;
  }
  for (const id of buttons) {
    const btn = new FakeElement("button");
    btn.id = id;
    btn.addEventListener("click", () => legacyClicks.push(id));
    body.appendChild(btn);
    els[id] = btn;
  }
  if (withThemeSelect) {
    const legacySel = new FakeElement("select");
    legacySel.id = "resumeGenerateVisualTheme";
    legacySel.options = [
      ["classic", "Classic"],
      ["mono", "Mono"],
    ].map(([value, label]) => {
      const o = new FakeElement("option");
      o.value = value;
      o.textContent = label;
      return o;
    });
    legacySel.value = "mono";
    body.appendChild(legacySel);
    els.theme = legacySel;
  }
  if (withDraftTabs) {
    for (const feature of ["cover_letter", "resume_update"]) {
      const tab = new FakeElement("button");
      tab.setAttribute("data-action", "draft-tab");
      tab.setAttribute("data-feature", feature);
      tab.addEventListener("click", () => legacyClicks.push(`draft-tab:${feature}`));
      body.appendChild(tab);
    }
  }

  const timers = makeTimers();
  const printCalls = [];
  const clipboardWrites = [];
  const consoleLines = [];
  const window = addEventTargetMethods({
    location: { search },
    setTimeout: (fn, ms) => timers.set(fn, ms),
    clearTimeout: (id) => timers.clear(id),
    print: () => printCalls.push(1),
  });
  if (jobBoredApp) window.JobBoredApp = jobBoredApp;
  if (userContent) window.CommandCenterUserContent = userContent;
  if (a11y) window.JobBoredA11y = a11y;

  const ctx = {
    window,
    document: dom.document,
    console: {
      log: (...args) => consoleLines.push(args.join(" ")),
      table: () => {},
      warn: (...args) => consoleLines.push(`warn: ${args.join(" ")}`),
      error: (...args) => consoleLines.push(`error: ${args.join(" ")}`),
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    Event: FakeEvent,
    CustomEvent: FakeCustomEvent,
    HTMLElement: dom.FakeHTMLElement,
    MutationObserver: dom.MutationObserver,
    URLSearchParams,
    performance,
    navigator: { clipboard: { writeText: (text) => clipboardWrites.push(text) } },
  };
  vm.createContext(ctx);
  for (const rel of modules) {
    vm.runInContext(readSource(rel), ctx, { filename: rel });
  }

  return {
    ctx,
    window,
    document: dom.document,
    body,
    region,
    els,
    timers,
    legacyClicks,
    printCalls,
    clipboardWrites,
    consoleLines,
    docListeners: dom.docListeners,
    JB: window.JB_SCRIBE,
    byId: (id) => dom.document.getElementById(id),
    q: (sel) => (dom.document.body.querySelector(sel)),
    qa: (sel) => (dom.document.body.querySelectorAll(sel)),
    // Region-scoped lookups (the region node is replaced only by
    // innerHTML writes, so holding the reference stays valid).
    rq: (sel) => (region ? region.querySelector(sel) : null),
    rqa: (sel) => (region ? region.querySelectorAll(sel) : []),
    input: (el) => el.dispatchEvent(new FakeEvent("input", { bubbles: true })),
    emit: (type, detail, target) =>
      (target || window).dispatchEvent(new FakeCustomEvent(type, { detail })),
  };
}
