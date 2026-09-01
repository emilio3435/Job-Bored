/* ============================================================
   Shared fakes for the ONEFLOW L0 substrate probes.

   Not a *.test.mjs file, so scripts/run-tests.mjs never runs it as a
   suite — it is imported by tests/oneflow-l0-*.test.mjs. Three fakes:

     makeFakeIndexedDb()  — enough IndexedDB to run user-content-store.js
                            for real (open/upgrade/get/put/delete/getAll),
                            so persistence probes assert behavior instead
                            of source regexes.
     makeFakeDocument()   — the DOM subset discovery-wizard-shell.js builds
                            against (adapted from tests/discovery-wizard-
                            shell.test.mjs so the two harnesses agree).
     loadShell/loadStore/loadOneFlow — vm sandboxes per module.
   ============================================================ */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function readRepoFile(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

// ---------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------

function fireLater(fn) {
  // IndexedDB requests resolve on a later task; queueMicrotask keeps the
  // ordering async without dragging real timers into the probes.
  queueMicrotask(fn);
}

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }
  _succeed(result) {
    this.result = result;
    fireLater(() => {
      if (this.onsuccess) this.onsuccess({ target: this });
    });
  }
}

class FakeObjectStore {
  constructor(name, rows, keyPath) {
    this.name = name;
    this.rows = rows;
    this.keyPath = keyPath;
    this.indexNames = {
      _names: new Set(),
      contains(n) {
        return this._names.has(n);
      },
    };
  }
  createIndex(name) {
    this.indexNames._names.add(name);
  }
  index(name) {
    const rows = this.rows;
    return {
      getAll(key) {
        const req = new FakeRequest();
        req._succeed(
          [...rows.values()].filter((row) => row[name] === key),
        );
        return req;
      },
    };
  }
  get(key) {
    const req = new FakeRequest();
    req._succeed(this.rows.get(key));
    return req;
  }
  getAll() {
    const req = new FakeRequest();
    req._succeed([...this.rows.values()]);
    return req;
  }
  put(value) {
    const req = new FakeRequest();
    this.rows.set(value[this.keyPath], JSON.parse(JSON.stringify(value)));
    req._succeed(value[this.keyPath]);
    return req;
  }
  delete(key) {
    const req = new FakeRequest();
    this.rows.delete(key);
    req._succeed(undefined);
    return req;
  }
}

class FakeDatabase {
  constructor() {
    this.stores = new Map();
    this.keyPaths = new Map();
    this.onversionchange = null;
    this.objectStoreNames = {
      _self: this,
      contains: (name) => this.stores.has(name),
    };
  }
  createObjectStore(name, opts = {}) {
    this.stores.set(name, new Map());
    this.keyPaths.set(name, opts.keyPath || "id");
    return new FakeObjectStore(name, this.stores.get(name), opts.keyPath || "id");
  }
  transaction(names) {
    const db = this;
    return {
      objectStore(name) {
        if (!db.stores.has(name)) {
          throw new Error(`No object store ${name} (requested ${names})`);
        }
        return new FakeObjectStore(
          name,
          db.stores.get(name),
          db.keyPaths.get(name) || "id",
        );
      },
    };
  }
  close() {}
}

/** One in-memory IndexedDB namespace shared by every open() in a sandbox. */
export function makeFakeIndexedDb() {
  const databases = new Map();
  return {
    _databases: databases,
    open(name) {
      const req = new FakeRequest();
      let db = databases.get(name);
      const isNew = !db;
      if (isNew) {
        db = new FakeDatabase();
        databases.set(name, db);
      }
      fireLater(() => {
        if (isNew && req.onupgradeneeded) {
          req.result = db;
          req.onupgradeneeded({ target: { result: db, transaction: null } });
        }
        req.result = db;
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
}

// ---------------------------------------------------------------
// DOM
// ---------------------------------------------------------------

class FakeClassList {
  constructor() {
    this.classes = new Set();
  }
  add(...c) {
    for (const x of c) if (x) this.classes.add(x);
  }
  remove(...c) {
    for (const x of c) this.classes.delete(x);
  }
  contains(c) {
    return this.classes.has(c);
  }
  toggle(c, on) {
    if (on === undefined) {
      if (this.classes.has(c)) this.classes.delete(c);
      else this.classes.add(c);
      return !this.classes.has(c);
    }
    if (on) this.classes.add(c);
    else this.classes.delete(c);
    return on;
  }
}

function matches(node, sel) {
  if (!node || !sel) return false;
  const attrMatch = sel.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attrMatch) {
    const [, name, val] = attrMatch;
    if (name === "id") {
      return val === undefined ? !!node.id : node.id === val;
    }
    // Mirror the real DOM: createEl writes data-* through el.dataset, so a
    // [data-action-id="x"] selector has to read dataset.actionId.
    if (name.startsWith("data-")) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
      const stored = node.dataset ? node.dataset[key] : undefined;
      if (stored !== undefined) {
        return val === undefined ? true : stored === val;
      }
    }
    if (val === undefined) return node.attrs && node.attrs.has(name);
    return node.attrs && node.attrs.get(name) === val;
  }
  if (sel.startsWith("#")) return node.id === sel.slice(1);
  if (sel.startsWith(".")) {
    return node.classList && node.classList.contains(sel.slice(1));
  }
  return false;
}

function findFirst(root, sel) {
  if (matches(root, sel)) return root;
  for (const c of root.children || []) {
    const found = findFirst(c, sel);
    if (found) return found;
  }
  return null;
}

function findAll(root, sel) {
  const out = [];
  if (matches(root, sel)) out.push(root);
  for (const c of root.children || []) out.push(...findAll(c, sel));
  return out;
}

/** The shell branches on `content instanceof Node`; give the fake a base. */
export class FakeNode {}

export class FakeEl extends FakeNode {
  constructor(tag = "div") {
    super();
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this._text = "";
    this.id = "";
    this._listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.tabIndex = 0;
    this.htmlFor = "";
    this.type = "";
    this.value = "";
    this.placeholder = "";
    this.rows = 0;
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
    if (k === "hidden") this.hidden = true;
    if (k === "id") this.id = String(v);
  }
  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  removeAttribute(k) {
    this.attrs.delete(k);
    if (k === "hidden") this.hidden = false;
  }
  hasAttribute(k) {
    return this.attrs.has(k);
  }
  appendChild(child) {
    if (child) {
      this.children.push(child);
      child.parentNode = this;
    }
    return child;
  }
  append(...kids) {
    for (const c of kids) if (c) this.appendChild(c);
  }
  replaceChildren(...kids) {
    this.children = [];
    for (const c of kids) if (c) this.appendChild(c);
  }
  get className() {
    return [...this.classList.classes].join(" ");
  }
  set className(v) {
    this.classList.classes = new Set(
      String(v || "")
        .split(/\s+/)
        .filter(Boolean),
    );
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent || "").join("");
  }
  set textContent(v) {
    this._text = String(v == null ? "" : v);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get parentElement() {
    return this.parentNode;
  }
  get offsetParent() {
    return this.parentNode || null;
  }
  get offsetWidth() {
    return 0;
  }
  scrollIntoView() {}
  scrollBy() {}
  focus() {
    this.__focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  contains(el) {
    if (el === this) return true;
    for (const c of this.children) if (c.contains && c.contains(el)) return true;
    return false;
  }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener() {}
  dispatch(type, event = {}) {
    for (const fn of this._listeners.get(type) || []) fn(event);
  }
  querySelector(sel) {
    return findFirst(this, sel);
  }
  querySelectorAll(sel) {
    return findAll(this, sel);
  }
  closest(sel) {
    let node = this;
    while (node) {
      if (matches(node, sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

/**
 * Canonical text serialization of a rendered shell tree. Attribute and class
 * order is normalized so the legacy-unchanged lock compares STRUCTURE, not
 * insertion order.
 */
export function serializeTree(node, depth = 0) {
  if (!node) return "";
  const pad = "  ".repeat(depth);
  const attrs = [...node.attrs.entries()].map(([k, v]) => `${k}="${v}"`).sort();
  const data = Object.entries(node.dataset)
    .map(([k, v]) => `data:${k}="${v}"`)
    .sort();
  const cls = [...node.classList.classes].sort().join(" ");
  const head = [
    node.tagName.toLowerCase(),
    node.id ? `#${node.id}` : "",
    cls ? `.${cls}` : "",
    attrs.length ? ` ${attrs.join(" ")}` : "",
    data.length ? ` ${data.join(" ")}` : "",
    node.disabled ? " [disabled]" : "",
    node._text ? ` "${node._text}"` : "",
  ].join("");
  const kids = node.children.map((c) => serializeTree(c, depth + 1)).join("\n");
  return pad + head + (kids ? "\n" + kids : "");
}

export function makeFakeDocument() {
  const elements = new Map();
  const doc = {
    activeElement: null,
    body: new FakeEl("body"),
    _events: [],
    createElement(tag) {
      const el = new FakeEl(tag);
      el.ownerDocument = doc;
      return el;
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    register(id) {
      const el = new FakeEl("div");
      el.id = id;
      el.ownerDocument = doc;
      elements.set(id, el);
      return el;
    },
    dispatchEvent(ev) {
      doc._events.push(ev);
      return true;
    },
    contains() {
      return true;
    },
  };
  doc.body.ownerDocument = doc;
  return doc;
}

/** Minimal CustomEvent so onboarding-telemetry.js can emit inside a vm. */
export class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.bubbles = !!init.bubbles;
  }
}

function baseSandbox(doc, win) {
  return {
    window: win,
    document: doc,
    console: { warn(...a) { if (process.env.ONEFLOW_DEBUG) console.log("WARN", ...a); }, error() {}, log() {} },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: () => {},
    Object,
    Set,
    Map,
    Array,
    Number,
    String,
    Boolean,
    JSON,
    Date,
    Promise,
    Math,
    Error,
    Symbol,
    Node: FakeNode,
  };
}

/** discovery-wizard-shell.js in a sandbox with the given mount ids present. */
export function loadShell({ mountIds = ["discoverySetupWizardMount"] } = {}) {
  const doc = makeFakeDocument();
  for (const id of mountIds) doc.register(id);
  const win = {};
  const ctx = baseSandbox(doc, win);
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("discovery-wizard-shell.js"), ctx, {
    filename: "discovery-wizard-shell.js",
  });
  return {
    window: win,
    document: doc,
    root: win.JobBoredDiscoveryWizard,
    shell: win.JobBoredDiscoveryWizard.shell,
  };
}

/** user-content-store.js against a fresh in-memory IndexedDB. */
export function loadStore() {
  const doc = makeFakeDocument();
  const win = {};
  const ctx = baseSandbox(doc, win);
  ctx.indexedDB = makeFakeIndexedDb();
  ctx.crypto = { randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` };
  vm.createContext(ctx);
  vm.runInContext(readRepoFile("user-content-store.js"), ctx, {
    filename: "user-content-store.js",
  });
  return { window: win, store: win.CommandCenterUserContent, indexedDB: ctx.indexedDB };
}

/**
 * The substrate in one sandbox, in index.html's load order: store +
 * telemetry + shell + onboarding-flow. Pass `beatFiles: true` to also
 * load the six beat stubs (only the wiring probes need them).
 */
export function loadOneFlow({ beatFiles = false } = {}) {
  const doc = makeFakeDocument();
  doc.register("oneFlowMount");
  doc.register("discoverySetupWizardMount");
  const win = {};
  const ctx = baseSandbox(doc, win);
  ctx.indexedDB = makeFakeIndexedDb();
  ctx.crypto = { randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` };
  ctx.CustomEvent = FakeCustomEvent;
  win.CustomEvent = FakeCustomEvent;
  vm.createContext(ctx);
  const files = [
    "user-content-store.js",
    "onboarding-telemetry.js",
    "discovery-wizard-shell.js",
    "onboarding-flow.js",
  ];
  if (beatFiles) {
    files.push(
      "oneflow-beat-google.js",
      "oneflow-beat-ai.js",
      "oneflow-beat-resume.js",
      "oneflow-beat-fit.js",
      "oneflow-beat-discovery.js",
      "oneflow-beat-payoff.js",
      "oneflow-demo-board.js",
      "onboarding-celebration.js",
    );
  }
  for (const file of files) {
    vm.runInContext(readRepoFile(file), ctx, { filename: file });
  }
  return {
    window: win,
    document: doc,
    flow: win.JobBoredOneFlow,
    store: win.CommandCenterUserContent,
    shell: win.JobBoredDiscoveryWizard.shell,
    telemetry: win.JobBoredOnboardingTelemetry,
    events: doc._events,
  };
}
