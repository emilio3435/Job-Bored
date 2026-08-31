/**
 * Minimal DOM for F3-D a11y primitive tests.
 * No jsdom in this repo; this is enough for overlay stack, live regions,
 * focus restore, labels, and the Move-to widget.
 */

function addEventTarget(target) {
  const listeners = new Map();
  target.addEventListener = (type, handler) => {
    const bucket = listeners.get(type) || [];
    bucket.push(handler);
    listeners.set(type, bucket);
  };
  target.removeEventListener = (type, handler) => {
    const bucket = listeners.get(type) || [];
    listeners.set(
      type,
      bucket.filter((entry) => entry !== handler),
    );
  };
  target.dispatchEvent = (event) => {
    if (!event.target) event.target = target;
    for (const handler of listeners.get(event.type) || []) {
      handler.call(target, event);
    }
    return true;
  };
  return target;
}

function createClassList(el) {
  const tokens = new Set();
  function sync() {
    el.attributes.class = [...tokens].join(" ");
  }
  return {
    add(...names) {
      for (const n of names) if (n) tokens.add(n);
      sync();
    },
    remove(...names) {
      for (const n of names) tokens.delete(n);
      sync();
    },
    contains(name) {
      return tokens.has(name);
    },
    toggle(name, force) {
      if (force === true) tokens.add(name);
      else if (force === false) tokens.delete(name);
      else if (tokens.has(name)) tokens.delete(name);
      else tokens.add(name);
      sync();
      return tokens.has(name);
    },
    toString() {
      return [...tokens].join(" ");
    },
  };
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    addEventTarget(this);
    this.tagName = String(tagName || "DIV").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = Object.create(null);
    this.classList = createClassList(this);
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this._text = "";
    this._value = "";
  }

  get id() {
    return this.attributes.id || "";
  }

  set id(value) {
    this.setAttribute("id", value);
  }

  get className() {
    return this.attributes.class || "";
  }

  set className(value) {
    const parts = String(value || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    this.attributes.class = parts.join(" ");
    this.classList = createClassList(this);
    for (const p of parts) this.classList.add(p);
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(value) {
    this.children = [];
    this._text = value == null ? "" : String(value);
  }

  get value() {
    return this._value;
  }

  set value(v) {
    this._value = v == null ? "" : String(v);
  }

  setAttribute(name, value) {
    const key = String(name);
    this.attributes[key] = String(value);
    if (key === "id") this.attributes.id = String(value);
    if (key === "class") this.className = String(value);
    if (key === "hidden") this.hidden = true;
    if (key === "disabled") this.disabled = true;
    if (key === "inert") this.inert = true;
  }

  getAttribute(name) {
    const key = String(name);
    return key in this.attributes ? this.attributes[key] : null;
  }

  hasAttribute(name) {
    return String(name) in this.attributes;
  }

  removeAttribute(name) {
    const key = String(name);
    delete this.attributes[key];
    if (key === "hidden") this.hidden = false;
    if (key === "disabled") this.disabled = false;
    if (key === "inert") this.inert = false;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    if (child.parentNode === this) child.parentNode = null;
    return child;
  }

  contains(node) {
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains(node)) return true;
    }
    return false;
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all[0] || null;
  }

  querySelectorAll(sel) {
    const out = [];
    walk(this, (el) => {
      if (el !== this && matches(el, sel)) out.push(el);
    });
    return out;
  }
}

function walk(el, visit) {
  visit(el);
  for (const child of el.children) walk(child, visit);
}

function matches(el, selector) {
  const parts = String(selector)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.some((part) => matchSimple(el, part));
}

function matchSimple(el, selector) {
  if (selector.startsWith("#")) {
    return el.id === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    return el.classList.contains(selector.slice(1));
  }
  const attrEq = selector.match(/^\[([a-zA-Z0-9:-]+)=["']?([^"'\]]+)["']?\]$/);
  if (attrEq) return el.getAttribute(attrEq[1]) === attrEq[2];
  const attr = selector.match(/^\[([a-zA-Z0-9:-]+)\]$/);
  if (attr) return el.hasAttribute(attr[1]);
  if (/^[a-z][a-z0-9-]*$/i.test(selector)) {
    return el.tagName === selector.toUpperCase();
  }
  return false;
}

function findById(root, id) {
  let found = null;
  walk(root, (el) => {
    if (!found && el.id === id) found = el;
  });
  return found;
}

export function createFakeDom() {
  const document = addEventTarget({
    body: null,
    documentElement: null,
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      return findById(document.documentElement, id);
    },
    contains(node) {
      return document.documentElement.contains(node);
    },
    querySelector(sel) {
      return document.documentElement.querySelector(sel);
    },
    querySelectorAll(sel) {
      return document.documentElement.querySelectorAll(sel);
    },
  });
  const html = new FakeElement("html", document);
  const body = new FakeElement("body", document);
  html.appendChild(body);
  document.documentElement = html;
  document.body = body;
  document.activeElement = body;
  const window = addEventTarget({ document, JobBoredA11y: undefined });
  return { document, window, FakeElement };
}

export function keyEvent(key, extras = {}) {
  const event = {
    key,
    shiftKey: Boolean(extras.shiftKey),
    preventDefault() {
      event.defaultPrevented = true;
    },
    defaultPrevented: false,
    target: extras.target || null,
  };
  return event;
}
