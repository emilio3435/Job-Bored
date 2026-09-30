import assert from "node:assert/strict";
import { it, before } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createRequire } from "node:module";

let JSDOM;
try { ({ JSDOM } = createRequire(import.meta.url)("jsdom")); } catch { /* The repository DOM harness remains available without optional jsdom. */ }
const domMode = JSDOM ? "jsdom" : "repository DOM harness";
let documentForTest;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "role-materials.js"), "utf8");
/* Trap 2: jb-text.js before role-case-model.js, or the model throws and
   CASE_DOC_TYPES is missing — the rows would silently degrade to the panel. */
const caseSources = ["jb-text.js", "role-case-model.js"].map((f) => ({
  filename: f,
  code: readFileSync(join(repoRoot, f), "utf8"),
}));

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
    this.bubbles = !!(options && options.bubbles);
    this.target = null;
  }
}

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
  };
}

function makeListeners() {
  return new Map();
}

function parseFirstTopLevelElement(html) {
  if (!html || typeof html !== "string") return null;
  const tagMatch = html.match(/^\s*<([a-zA-Z][\w-]*)\s*([^>]*)>([\s\S]*)<\/\1>\s*$/);
  if (!tagMatch) return null;
  const attrRe = /([a-zA-Z-][a-zA-Z0-9-]*)\s*=\s*"([^"]*)"/g;
  const attrs = {};
  let m;
  while ((m = attrRe.exec(tagMatch[2])) !== null) {
    attrs[m[1]] = m[2]
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
  const inner = tagMatch[3];
  const el = makeElement(tagMatch[1], attrs);
  el.innerHTML = inner;
  return el;
}

function makeElement(tag, attrs) {
  const listeners = makeListeners();
  const children = [];
  const attributes = { ...(attrs || {}) };
  let _innerHTML = "";
  const el = {
    tagName: String(tag || "").toUpperCase(),
    children,
    attributes,
    get innerHTML() { return _innerHTML; },
    set innerHTML(html) {
      _innerHTML = String(html == null ? "" : html);
      /* When a fresh element gets a single top-level child via
         innerHTML (the pattern role-materials uses for appendSection),
         materialise it so firstElementChild works. */
      const childEl = parseFirstTopLevelElement(_innerHTML);
      children.length = 0;
      if (childEl) children.push(childEl);
    },
    addEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      listeners.set(type, arr.filter((h) => h !== fn));
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? attributes[name]
        : null;
    },
    get firstElementChild() { return children[0] || null; },
    appendChild(node) { children.push(node); node.parentNode = el; return node; },
    removeChild(node) {
      const idx = children.indexOf(node);
      if (idx >= 0) children.splice(idx, 1);
      if (node) node.parentNode = null;
      return node;
    },
    querySelector(sel) {
      /* Minimal selector support: ".class" or "[attr="val"]" */
      const dotMatch = sel.match(/^\.(\S+)$/);
      const attrMatch = sel.match(/^\[([^=\]]+)="([^"]+)"\]$/);
      const walk = (node) => {
        for (const child of node.children) {
          if (dotMatch) {
            const cls = child.attributes && child.attributes.class;
            if (cls && cls.split(/\s+/).includes(dotMatch[1])) return child;
          }
          if (attrMatch) {
            const v = child.attributes && child.attributes[attrMatch[1]];
            if (v === attrMatch[2]) return child;
          }
          const inner = walk(child);
          if (inner) return inner;
        }
        return null;
      };
      return walk(el);
    },
    _listeners: listeners,
  };
  return el;
}

/**
 * Parse a fragment of HTML returned by role-materials into a synthetic
 * element tree we can run querySelector against. Only the pieces of
 * the structure the tests assert against are populated.
 */

function makeDocument() {
  const body = makeElement("body");
  body.classList = makeClassList(["jb-v2"]);
  const doc = {
    body,
    readyState: "complete",
    addEventListener() {},
    createElement(tag) { return makeElement(tag); },
    dispatchEvent() { return true; },
    /* We only ever query for the role region; return null so the
       module's listeners load but no auto-render happens. */
    querySelector() { return null; },
  };
  return doc;
}

let api;

before(() => {
  const documentEl = JSDOM ? new JSDOM('<!doctype html><body class="jb-v2"></body>').window.document : makeDocument();
  documentForTest = documentEl;
  const windowEl = {
    document: documentEl,
    CustomEvent: TestCustomEvent,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    matchMedia: () => ({ matches: false }),
    location: { hostname: "localhost", hash: "" },
    JobBoredFlowing: {},
    queueMicrotask: (fn) => fn(),
  };
  const ctx = vm.createContext({
    window: windowEl,
    document: documentEl,
    CustomEvent: TestCustomEvent,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    /* The live elapsed ticker is the panel's concern, not this suite's:
       hand it a token it can clear so nothing keeps the loop alive. */
    setInterval: () => 1,
    clearInterval: () => {},
    fetch: () => Promise.reject(new Error("fetch not stubbed in unit test")),
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
  });
  for (const { filename, code } of caseSources) vm.runInContext(code, ctx, { filename });
  if (!windowEl.JobBoredCase?.model?.CASE_DOC_TYPES?.length) {
    throw new Error("role-case-model.js did not expose CASE_DOC_TYPES");
  }
  vm.runInContext(source, ctx, { filename: "role-materials.js" });
  api = windowEl.JobBoredRoleMaterials;
  if (!api) throw new Error("role-materials.js did not expose JobBoredRoleMaterials");
});

// jsdom can be supplied through NODE_PATH from an isolated temporary install.
// Exercise the actual renderer and script composition, not a source grep.
for (const [code, message] of [
  ["ingest_incomplete", "JobBored read 2 of 4 employers: Northwind Trading and Tailspin Studio."],
  ["ingest_needs_model", "Connect an AI provider so JobBored can read your résumé."],
  ["stale_ledger", "The saved résumé read is stale. Read it again."],
  ["ingest_failed", "JobBored could not read your résumé with local."],
]) it(`T-K19-08 (guard, ${domMode}) ${code} renders the server recovery message`, () => {
  const host = documentForTest.createElement("div");
  host.setAttribute("data-mount", "materials");
  api.renderManifest(host, { slug: "fictional-role", company: "Fabrikam", title: "Analyst", documents: [],
    pending: { feature: "resume", progress: { phase: "failed", code, message } },
  }, "http://127.0.0.1:3847");
  const html = Array.from(host.children).map((child) => child.innerHTML).join("");
  assert.ok(html.includes(message), "the rendered message must include the server recovery details");
  assert.match(html, /data-status="failed"/);
  assert.doesNotMatch(html, /We couldn’t read your resume clearly/);
});
it(`T-K19-08 (guard, ${domMode}) resume_source_review alone gets generic fallback copy`, () => {
  const host = documentForTest.createElement("div");
  host.setAttribute("data-mount", "materials");
  api.renderManifest(host, { slug: "fictional-role", company: "Fabrikam", title: "Analyst", documents: [],
    pending: { feature: "resume", progress: { phase: "failed", code: "resume_source_review" } },
  }, "http://127.0.0.1:3847");
  assert.match(Array.from(host.children).map((child) => child.innerHTML).join(""), /We couldn’t read your resume clearly/);
});

it(`P2-7 (${domMode}) a finished draft shows the placement notice in the existing status area`, () => {
  const host = documentForTest.createElement("div");
  host.setAttribute("data-mount", "materials");
  const notice = "2 résumé items set aside or needing placement review under Contoso and Tailspin <Studio> — review in Settings.";
  api.renderManifest(host, { slug: "fictional-role", company: "Fabrikam", title: "Analyst",
    documents: [{ type: "resume", status: "ready", primary: "resume.pdf", files: [{ filename: "resume.pdf" }] }],
    ingestReview: { notice },
  }, "http://127.0.0.1:3847");
  const html = Array.from(host.children).map((child) => child.innerHTML).join("");
  assert.match(html, /2 résumé items.*Contoso.*Tailspin &lt;Studio&gt;.*Settings/);
  assert.doesNotMatch(html, /Tailspin <Studio>/);
  assert.match(html, /data-status="ready"/);
});
