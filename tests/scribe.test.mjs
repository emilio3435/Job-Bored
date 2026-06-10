import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scribeJs = readFileSync(join(repoRoot, "scribe.js"), "utf8");

// ============================================================
// Behavioral coverage for scribe.js — the v2 ATS + cover-letter
// workspace. scribe.js is a classic-global IIFE that renders into
// [data-region="scribe"], bridges every action to the LEGACY modal
// controls by id (#resumeGenerate*), keeps #resumeGenerateOutput the
// source of truth for body text, and debounces editor keystrokes via
// window.setTimeout before syncing back.
//
// Harness: the module is loaded into a fresh VM context per test
// (mirrors tests/discovery-cross-rec.test.mjs). Because scribe.js
// renders via region.innerHTML and walks the result with
// querySelector/cloneNode/textContent, the fake DOM here is richer
// than enhancements-wizard's makeFakeDom: it parses the HTML the
// module emits (hand-rolled — no jsdom in this repo, see
// tests/kanban-card-attrs.test.mjs). All timers route through
// window.setTimeout, so a fake clock makes the 600ms debounce, the
// 350ms refine snapshot, and the 50ms smoke defer deterministic.
// location.search stays empty by default so smoke mode never
// auto-runs unless a test opts in.
// ============================================================

class FakeEvent {
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

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function makeDom() {
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
      this.classList = {
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c)),
        contains: (c) => classes.has(c),
        toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
      };
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
    removeEventListener() {}
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
  const document = {
    readyState: "complete",
    body,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => makeText(text),
    getElementById: (id) => collectElements(body).find((el) => el.id === id) || null,
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener: (type, fn) => {
      docListeners.push({ type, fn });
    },
  };

  return { FakeHTMLElement, FakeElement, makeText, body, document, docListeners };
}

function makeTimers() {
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
    flush() {
      const snapshot = [...tasks.entries()];
      for (const [id, task] of snapshot) {
        tasks.delete(id);
        task.fn();
      }
    },
  };
}

const ALL_LEGACY_BUTTONS = [
  "resumeGeneratePrint",
  "resumeGenerateCopy",
  "resumeGenerateDone",
  "resumeGenerateClose",
  "resumeGenerateRefine",
];

function loadScribe({
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
  const window = {
    location: { search },
    setTimeout: (fn, ms) => timers.set(fn, ms),
    clearTimeout: (id) => timers.clear(id),
    print: () => printCalls.push(1),
  };
  const ctx = {
    window,
    document: dom.document,
    console: {
      log: (...args) => consoleLines.push(args.join(" ")),
      table: () => {},
      warn: () => {},
      error: () => {},
    },
    setTimeout,
    clearTimeout,
    Event: FakeEvent,
    HTMLElement: dom.FakeHTMLElement,
    URLSearchParams,
    performance,
    navigator: { clipboard: { writeText: (text) => clipboardWrites.push(text) } },
  };
  vm.createContext(ctx);
  vm.runInContext(scribeJs, ctx, { filename: "scribe.js" });

  return {
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
    q: (sel) => (region ? region.querySelector(sel) : null),
    qa: (sel) => (region ? region.querySelectorAll(sel) : []),
    input: (el) => el.dispatchEvent(new FakeEvent("input", { bubbles: true })),
  };
}

function readAxes(env) {
  return env.qa(".scribe-axis").map((el) => ({
    label: el.querySelector(".scribe-axis__label").textContent,
    pct: parseInt(el.querySelector(".scribe-axis__value").textContent, 10),
    tier: el.getAttribute("data-tier"),
  }));
}

const LONG_DRAFT =
  "You shipped 14 releases across 3 teams and cut deploy latency by 38 percent. " +
  "The result drove 2 million dollars in retained revenue for the platform org. " +
  "You then rebuilt the hiring loop and onboarded 6 senior engineers in one quarter. " +
  "Every claim above maps to a metric the panel can verify. " +
  "You close with availability and a single clear ask.";

// ============================================================
// Boot gating + public API
// ============================================================

describe("scribe — boot gating + frozen public API", () => {
  it("leaves the legacy UI untouched when the page is not in jb-v2 mode (the v2 workspace must never leak into the classic dashboard)", () => {
    const env = loadScribe({ v2: false });
    assert.equal(env.region.childNodes.length, 0, "region must not be rendered into");
    assert.equal(env.byId("scribeEditor"), null, "no v2 editor in legacy mode");
  });

  it("renders the full split-pane workspace once jb-v2 is active (editor, scorecard, refine strip, tabs)", () => {
    const env = loadScribe();
    assert.ok(env.byId("scribeEditor"), "editor pane must exist");
    assert.ok(env.q("#scribeFitRing"), "fit ring must exist");
    assert.equal(env.qa(".scribe-axis").length, 6, "all six ATS axes render at boot");
    assert.ok(env.byId("scribeRefineInput"), "refine strip must exist");
    assert.equal(env.qa("[data-scribe-tab]").length, 2, "cover letter + resume tabs");
    assert.equal(env.q("[data-scribe-status]").textContent, "idle", "status pip starts idle");
  });

  it("an existing legacy draft is prefilled into the editor at boot (the textarea is the source of truth, not the new pane)", () => {
    const env = loadScribe({ legacyText: "Hello there." });
    const editor = env.byId("scribeEditor");
    assert.equal(editor.textContent, "Hello there.");
    assert.equal(editor.dataset.empty, "false");
    assert.equal(env.q("[data-scribe-counter]").textContent, "2 words");
  });

  it("boot is a safe no-op when the scribe region is absent — the API still loads and its calls never throw", () => {
    const env = loadScribe({ withRegion: false });
    assert.ok(env.JB, "JB_SCRIBE must still be exposed");
    env.JB.rescore();
    env.JB.syncEditorIntoLegacy();
    env.JB.setEditorFromLegacy();
  });

  it("the public JB_SCRIBE handle is frozen so host code cannot monkey-patch the bridge out from under the legacy pipeline", () => {
    const env = loadScribe();
    assert.ok(Object.isFrozen(env.JB));
    for (const key of ["smoke", "rescore", "syncEditorIntoLegacy", "setEditorFromLegacy"]) {
      assert.equal(typeof env.JB[key], "function", `JB_SCRIBE.${key} must be a function`);
    }
    assert.throws(() => {
      env.JB.rescore = () => {};
    }, TypeError);
  });

  it("when the script loads before the DOM is ready it waits for DOMContentLoaded instead of rendering into a half-built page", () => {
    const env = loadScribe({ readyState: "loading" });
    assert.equal(env.byId("scribeEditor"), null, "must not render before DOMContentLoaded");
    const ready = env.docListeners.find((l) => l.type === "DOMContentLoaded");
    assert.ok(ready, "must register a DOMContentLoaded listener");
    ready.fn();
    assert.ok(env.byId("scribeEditor"), "renders once the DOM is ready");
  });
});

// ============================================================
// Legacy textarea bridge — text conversion both directions
// ============================================================

describe("scribe — legacy textarea bridge (lossless round-trip + escaping)", () => {
  it("legacy plain text becomes paragraph blocks with stable p-N anchors (gap callouts deep-link to those anchors)", () => {
    const env = loadScribe();
    env.els.output.value = "One.\n\nTwo.\nthree";
    env.JB.setEditorFromLegacy();
    const editor = env.byId("scribeEditor");
    const ps = editor.querySelectorAll("p");
    assert.equal(ps.length, 2, "double newline splits paragraphs");
    assert.equal(ps[0].getAttribute("data-scribe-anchor"), "p-0");
    assert.equal(ps[1].getAttribute("data-scribe-anchor"), "p-1");
    assert.equal(ps[1].querySelectorAll("br").length, 1, "single newline becomes a <br>");
  });

  it("markup in a draft is escaped, never executed — a job description containing HTML must not inject elements into the editor DOM", () => {
    const env = loadScribe();
    const hostile = '<script>alert("x")</script> & <b>bold</b>';
    env.els.output.value = hostile;
    env.JB.setEditorFromLegacy();
    const editor = env.byId("scribeEditor");
    assert.equal(editor.querySelector("script"), null, "no script element may be created");
    assert.equal(editor.querySelector("b"), null, "no markup element may be created");
    assert.equal(
      editor.textContent,
      hostile,
      "the draft text must survive verbatim as text",
    );
  });

  it("editor → legacy sync is idempotent: an unchanged draft writes nothing and fires NO input event (each event triggers a full ATS rescore)", () => {
    const env = loadScribe();
    env.els.output.value = "One.\n\nTwo.\nthree";
    env.JB.setEditorFromLegacy();
    const taEvents = [];
    env.els.output.addEventListener("input", () => taEvents.push(1));
    env.JB.syncEditorIntoLegacy();
    assert.equal(env.els.output.value, "One.\n\nTwo.\nthree", "round-trip must be lossless");
    assert.equal(taEvents.length, 0, "no spurious input event when nothing changed");
  });

  it("a real editor edit lands in the legacy textarea WITH a bubbling input event so the legacy ATS pipeline reruns", () => {
    const env = loadScribe({ legacyText: "Old body" });
    const editor = env.byId("scribeEditor");
    const taEvents = [];
    env.els.output.addEventListener("input", (e) => taEvents.push(e));
    editor.textContent = "Brand new body";
    env.JB.syncEditorIntoLegacy();
    assert.equal(env.els.output.value, "Brand new body");
    assert.equal(taEvents.length, 1, "exactly one input event per real change");
    assert.equal(taEvents[0].bubbles, true, "must bubble for delegated listeners");
    assert.equal(env.q("[data-scribe-counter]").textContent, "3 words");
  });

  it("the word counter pluralizes honestly (1 word vs N words) so the strip never reads like filler", () => {
    const env = loadScribe();
    env.els.output.value = "Word";
    env.JB.setEditorFromLegacy();
    assert.equal(env.q("[data-scribe-counter]").textContent, "1 word");
    env.els.output.value = "";
    env.JB.setEditorFromLegacy();
    assert.equal(env.q("[data-scribe-counter]").textContent, "0 words");
    assert.equal(env.byId("scribeEditor").dataset.empty, "true", "empty flag restores the placeholder");
  });
});

// ============================================================
// Debounced editor → legacy sync
// ============================================================

describe("scribe — debounced keystroke sync (one rescore per idle pause, not per keystroke)", () => {
  it("a keystroke does NOT hit the legacy textarea until the idle debounce elapses — then exactly one sync + rescore fires", () => {
    const env = loadScribe();
    const editor = env.byId("scribeEditor");
    const taEvents = [];
    env.els.output.addEventListener("input", () => taEvents.push(1));

    editor.textContent = "Hello world";
    env.input(editor);

    assert.equal(env.els.output.value, "", "legacy textarea untouched before the idle window");
    assert.equal(env.q("[data-scribe-status]").textContent, "typing…");
    assert.equal(env.q("[data-scribe-status]").getAttribute("data-state"), "busy");
    assert.equal(env.timers.count(), 1, "one pending debounce task");

    env.timers.flush();
    assert.equal(env.els.output.value, "Hello world", "sync lands after the idle window");
    assert.equal(taEvents.length, 1, "exactly one input event reaches the ATS pipeline");
    assert.equal(env.q("[data-scribe-status]").textContent, "scored");
    assert.equal(env.q("[data-scribe-status]").getAttribute("data-state"), "ok");
  });

  it("rapid consecutive keystrokes collapse into ONE pending sync (each keystroke resets the timer instead of stacking rescores)", () => {
    const env = loadScribe();
    const editor = env.byId("scribeEditor");
    const taEvents = [];
    env.els.output.addEventListener("input", () => taEvents.push(1));

    editor.textContent = "Hello";
    env.input(editor);
    editor.textContent = "Hello brave world";
    env.input(editor);

    assert.equal(env.timers.count(), 1, "the second keystroke must replace the first timer, not add one");
    env.timers.flush();
    assert.equal(env.els.output.value, "Hello brave world", "only the final text syncs");
    assert.equal(taEvents.length, 1, "one sync for the whole burst");
  });

  it("the empty-placeholder flag tracks every keystroke immediately (it cannot wait for the debounce or the placeholder flickers late)", () => {
    const env = loadScribe();
    const editor = env.byId("scribeEditor");
    editor.textContent = "x";
    env.input(editor);
    assert.equal(editor.dataset.empty, "false");
    editor.textContent = "";
    env.input(editor);
    assert.equal(editor.dataset.empty, "true", "flag flips before any timer runs");
  });
});

// ============================================================
// Toolbar actions — every control proxies to the legacy modal
// ============================================================

describe("scribe — toolbar actions bridge to the legacy modal controls", () => {
  it("Print / PDF triggers the legacy #resumeGeneratePrint flow (no parallel print implementation)", () => {
    const env = loadScribe();
    env.byId("scribePrintBtn").click();
    assert.deepEqual(env.legacyClicks, ["resumeGeneratePrint"]);
    assert.equal(env.printCalls.length, 0, "window.print is only the fallback");
  });

  it("Print / PDF falls back to window.print() when the legacy button is missing — the user still gets a PDF path", () => {
    const env = loadScribe({ buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGeneratePrint") });
    env.byId("scribePrintBtn").click();
    assert.equal(env.printCalls.length, 1);
    assert.deepEqual(env.legacyClicks, []);
  });

  it("Copy syncs the editor into the legacy textarea BEFORE clicking legacy copy — otherwise the user copies a stale draft", () => {
    const env = loadScribe({ legacyText: "Original" });
    const editor = env.byId("scribeEditor");
    let valueAtCopyClick = null;
    env.els.resumeGenerateCopy.addEventListener("click", () => {
      valueAtCopyClick = env.els.output.value;
    });
    editor.textContent = "Edited body";
    env.byId("scribeCopyBtn").click();
    assert.equal(valueAtCopyClick, "Edited body", "legacy copy must see the freshest text");
    assert.ok(env.legacyClicks.includes("resumeGenerateCopy"));
  });

  it("Copy falls back to the clipboard API with the editor's plain text when the legacy button is gone", () => {
    const env = loadScribe({ buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGenerateCopy") });
    env.byId("scribeEditor").textContent = "Plain copy text";
    env.byId("scribeCopyBtn").click();
    assert.deepEqual(env.clipboardWrites, ["Plain copy text"]);
  });

  it("Done clicks legacy Done and does NOT also fire Close (double-dispatch would close the modal twice)", () => {
    const env = loadScribe();
    env.byId("scribeDoneBtn").click();
    assert.ok(env.legacyClicks.includes("resumeGenerateDone"));
    assert.ok(!env.legacyClicks.includes("resumeGenerateClose"), "Close is only the fallback");
  });

  it("Done falls back to legacy Close when Done is missing, so the user is never trapped in the workspace", () => {
    const env = loadScribe({ buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGenerateDone") });
    env.byId("scribeDoneBtn").click();
    assert.ok(env.legacyClicks.includes("resumeGenerateClose"));
  });

  it("Refine pipes the strip's instructions into the legacy feedback textarea, clicks legacy Refine, then snapshots the refined text back into the editor", () => {
    const env = loadScribe({ legacyText: "First draft." });
    const fbEvents = [];
    env.els.feedback.addEventListener("input", () => fbEvents.push(1));
    env.els.resumeGenerateRefine.addEventListener("click", () => {
      // The legacy refine flow writes its result back into the textarea.
      env.els.output.value = "Refined draft with a stronger opener.";
    });
    env.byId("scribeRefineInput").value = "make it shorter";
    env.byId("scribeRefineBtn").click();

    assert.equal(env.els.feedback.value, "make it shorter", "instructions must reach refineLastResumeGeneration");
    assert.equal(fbEvents.length, 1, "feedback change must fire input so legacy state updates");
    assert.ok(env.legacyClicks.includes("resumeGenerateRefine"));
    assert.equal(env.q("[data-scribe-status]").textContent, "refining…");
    assert.equal(env.q("[data-scribe-status]").getAttribute("data-state"), "busy");

    env.timers.flush();
    assert.equal(
      env.byId("scribeEditor").textContent,
      "Refined draft with a stronger opener.",
      "the refined legacy text must be mirrored back into the editor",
    );
    assert.equal(env.q("[data-scribe-status]").textContent, "refined");
    assert.equal(env.q("[data-scribe-status]").getAttribute("data-state"), "ok");
  });

  it("a missing legacy Refine handler is surfaced honestly in the status pip instead of faking success", () => {
    const env = loadScribe({ buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGenerateRefine") });
    env.byId("scribeRefineInput").value = "tighten";
    env.byId("scribeRefineBtn").click();
    assert.equal(env.q("[data-scribe-status]").textContent, "refine handler missing");
    assert.equal(env.timers.count(), 0, "no phantom snapshot is scheduled");
  });

  it("the Appearance select mirrors the legacy theme options and pushes changes back with a change event (the legacy renderer listens for it)", () => {
    const env = loadScribe({ withThemeSelect: true });
    const sel = env.byId("scribeAppearance");
    assert.equal(sel.querySelectorAll("option").length, 2, "options copied from the legacy select");
    assert.equal(sel.value, "mono", "current legacy theme preselected");
    const themeEvents = [];
    env.els.theme.addEventListener("change", () => themeEvents.push(1));
    sel.value = "classic";
    sel.dispatchEvent(new FakeEvent("change", { bubbles: true }));
    assert.equal(env.els.theme.value, "classic", "theme choice must reach the legacy select");
    assert.equal(themeEvents.length, 1, "legacy change listeners must re-render the preview");
  });
});

// ============================================================
// Tabs + refine chips
// ============================================================

describe("scribe — tabs and refine chips", () => {
  it("switching to the Resume tab flips aria-selected, retitles the editor, and re-dispatches through the legacy draft-tab switch", () => {
    const env = loadScribe({ withDraftTabs: true });
    const coverTab = env.q('[data-scribe-tab="cover_letter"]');
    const resumeTab = env.q('[data-scribe-tab="resume_update"]');

    resumeTab.click();
    assert.equal(resumeTab.getAttribute("aria-selected"), "true");
    assert.equal(coverTab.getAttribute("aria-selected"), "false");
    assert.equal(env.q("[data-scribe-kicker]").textContent, "Resume draft");
    assert.ok(env.legacyClicks.includes("draft-tab:resume_update"), "legacy panel must flip too");

    coverTab.click();
    assert.equal(coverTab.getAttribute("aria-selected"), "true");
    assert.equal(resumeTab.getAttribute("aria-selected"), "false");
    assert.equal(env.q("[data-scribe-kicker]").textContent, "Cover letter draft");
    assert.ok(env.legacyClicks.includes("draft-tab:cover_letter"));
  });

  it("quick-refine chips ACCUMULATE instructions with '; ' (a second chip must not erase the first) and refocus the input", () => {
    const env = loadScribe();
    const chips = env.qa("[data-scribe-chip]");
    const refineInput = env.byId("scribeRefineInput");
    chips[0].click();
    assert.equal(refineInput.value, "more specific");
    chips[1].click();
    assert.equal(refineInput.value, "more specific; cut to 250 words");
    assert.ok(refineInput._focusCalls >= 2, "input is refocused so the user can keep typing");
  });
});

// ============================================================
// External regeneration mirror + echo suppression
// ============================================================

describe("scribe — legacy regeneration mirror (echo-loop suppression)", () => {
  it("a fresh legacy generation (textarea input NOT caused by the editor) is mirrored into the editor and rescored", () => {
    const env = loadScribe();
    env.els.output.value = "Para one.\n\nPara two.";
    env.input(env.els.output);
    const editor = env.byId("scribeEditor");
    assert.equal(editor.querySelectorAll("p").length, 2, "regenerated body replaces the editor content");
    assert.equal(editor.dataset.empty, "false");
    assert.equal(env.q("[data-scribe-counter]").textContent, "4 words");
  });

  it("the editor's own debounced write-back must NOT echo into the editor and clobber in-flight typing", () => {
    const env = loadScribe();
    const editor = env.byId("scribeEditor");
    editor.textContent = "User typing here";
    env.input(editor); // marks the edit as ours (lastEditAt = now)
    env.els.output.value = "STALE ECHO";
    env.input(env.els.output); // the echo arrives within the debounce window
    assert.equal(
      editor.textContent,
      "User typing here",
      "an input within the debounce window of our own edit must never overwrite the editor",
    );
  });
});

// ============================================================
// Scorecard consistency
// ============================================================

describe("scribe — scorecard: ring, axes, tiers, and gap callouts tell one story", () => {
  it("the overall fit ring equals the rounded average of the six axis scores — the ring and the axis bars must never disagree", () => {
    const env = loadScribe({ legacyText: LONG_DRAFT });
    const axes = readAxes(env);
    assert.deepEqual(
      axes.map((a) => a.label),
      ["Req", "Experience", "Impact", "Parseability", "Tone", "Confidence"],
      "all six spec axes render, in spec order",
    );
    const expectedOverall = Math.round(axes.reduce((sum, a) => sum + a.pct, 0) / axes.length);
    const ring = parseInt(env.q("#scribeFitRing").getAttribute("percent"), 10);
    assert.equal(ring, expectedOverall);
    assert.match(
      env.q("#scribeFitRing").getAttribute("label"),
      new RegExp(`${expectedOverall}%`),
      "the accessible label carries the same number as the ring",
    );
  });

  it("axis tiers follow the published thresholds (>=75 high, >=50 mid, else low) so the colors mean the same thing on every draft", () => {
    for (const text of ["", LONG_DRAFT]) {
      const env = loadScribe({ legacyText: text });
      for (const axis of readAxes(env)) {
        const expected = axis.pct >= 75 ? "high" : axis.pct >= 50 ? "mid" : "low";
        assert.equal(axis.tier, expected, `${axis.label} at ${axis.pct}% must be tier ${expected}`);
      }
    }
  });

  it("gap callouts target the three WEAKEST axes — the user's attention goes where the score is lowest", () => {
    const env = loadScribe({ legacyText: "" });
    const axes = readAxes(env);
    const weakest = axes
      .slice()
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 3)
      .map((a) => a.label.toUpperCase());
    const gapAxes = env.q("#scribeGaps").querySelectorAll(".scribe-gap__axis").map((el) => el.textContent);
    assert.deepEqual(gapAxes, weakest);
  });
});

// ============================================================
// Gap callout → editor anchor navigation
// ============================================================

describe("scribe — gap callouts deep-link into the editor", () => {
  it("clicking a gap callout scrolls to and flashes the anchored paragraph, and the flash decays instead of sticking forever", () => {
    const env = loadScribe({ legacyText: "Para one.\n\nPara two.\n\nPara three." });
    const gapBtn = env.q('[data-scribe-anchor-target="p-0"]');
    assert.ok(gapBtn, "first gap callout must target paragraph p-0");
    const p0 = env.q('[data-scribe-anchor="p-0"]');

    gapBtn.click();
    assert.equal(p0._scrollCalls.length, 1, "must scroll the paragraph into view");
    assert.ok(p0.classList.contains("jb-mark"), "paragraph is highlighted");
    assert.ok(p0.classList.contains("scribe-anchor-flash"), "paragraph flashes");

    env.timers.flush(); // 900ms flash window
    assert.ok(!p0.classList.contains("scribe-anchor-flash"), "flash class is removed after the window");
    assert.ok(p0.classList.contains("jb-mark"), "the mark lingers briefly for orientation");
    env.timers.flush(); // 320ms mark fade
    assert.ok(!p0.classList.contains("jb-mark"), "no permanent highlight is left behind");
  });
});

// ============================================================
// Smoke harness gating
// ============================================================

describe("scribe — smoke harness is URL-gated, honest, and inert in production", () => {
  it("a normal page load runs NO smoke: no prototype monkey-patch, no console output, no results global", () => {
    const env = loadScribe();
    env.timers.flush();
    assert.equal(env.window.__JB_SCRIBE_SMOKE_RESULTS__, undefined);
    assert.equal(env.window.__JB_SCRIBE_HOOK__, undefined, "HTMLElement.prototype.click must stay unpatched");
    assert.deepEqual(env.consoleLines, [], "no console noise in normal sessions");
  });

  it("?jb-v2-test=scribe drives all four toolbar buttons through the legacy bridge and reports a PASS block", () => {
    const env = loadScribe({ search: "?jb-v2-test=scribe" });
    env.timers.flush(); // the deferred runSmoke tick
    const results = env.window.__JB_SCRIBE_SMOKE_RESULTS__;
    assert.ok(Array.isArray(results), "smoke must publish its results");
    assert.equal(results.length, 4, "print, copy, done, refine are all exercised");
    for (const r of results) {
      assert.equal(r.ok, true, `${r.btn} must reach legacy ${r.legacy}`);
    }
    assert.ok(env.consoleLines.includes("[scribe smoke] PASS"));
  });

  it("smoke reports FAIL honestly when a legacy target is missing (a silently broken bridge is the failure smoke exists to catch)", () => {
    const env = loadScribe({
      search: "?jb-v2-test=scribe",
      buttons: ALL_LEGACY_BUTTONS.filter((b) => b !== "resumeGeneratePrint"),
    });
    env.timers.flush();
    const results = env.window.__JB_SCRIBE_SMOKE_RESULTS__;
    const print = results.find((r) => r.btn === "#scribePrintBtn");
    assert.equal(print.ok, false, "the unmapped print bridge must be flagged");
    assert.equal(print.reason, "legacy id never clicked");
    assert.ok(env.consoleLines.includes("[scribe smoke] FAIL"));
    assert.equal(env.printCalls.length, 1, "the user-facing fallback still fired during the probe");
  });

  it("JB_SCRIBE.smoke() works as a manual handle without the URL param (on-demand QA from the console)", () => {
    const env = loadScribe();
    env.JB.smoke();
    const results = env.window.__JB_SCRIBE_SMOKE_RESULTS__;
    assert.equal(results.length, 4);
    assert.ok(results.every((r) => r.ok === true));
  });
});
