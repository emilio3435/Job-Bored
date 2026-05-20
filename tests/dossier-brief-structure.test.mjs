import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const briefSource = readFileSync(join(repoRoot, "role-brief.js"), "utf8");
const roleSource = readFileSync(join(repoRoot, "role.js"), "utf8");

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
    this.bubbles = !!(options && options.bubbles);
    this.target = null;
  }
}

function makeBus() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((h) => h !== handler));
    },
    dispatchEvent(event) {
      if (!event.target) event.target = this;
      const list = listeners.get(event.type) || [];
      for (const fn of list) fn.call(this, event);
      return true;
    },
    _listeners: listeners,
  };
}

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
    toggle(c) { if (set.has(c)) set.delete(c); else set.add(c); },
  };
}

function makeMount() {
  const listeners = new Map();
  const attributes = {};
  const mount = {
    classList: makeClassList(),
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((h) => h !== handler));
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] || null; },
    _innerHTML: "",
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v == null ? "" : v); },
    querySelector() { return null; },
    _listeners: listeners,
  };
  return mount;
}

function makeStubFromMatch(tagName, attrs, innerText) {
  const listeners = new Map();
  const attributeMap = parseAttributes(attrs);
  const stub = {
    tagName: tagName.toUpperCase(),
    value: decodeBasicEntities(innerText || ""),
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((h) => h !== handler));
    },
    dispatchEvent(event) {
      if (!event.target) event.target = stub;
      const list = listeners.get(event.type) || [];
      for (const fn of list) fn.call(stub, event);
      return true;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributeMap, name)
        ? attributeMap[name]
        : null;
    },
    setAttribute(name, value) { attributeMap[name] = String(value); },
    _listeners: listeners,
  };
  return stub;
}

function parseAttributes(rawAttrs) {
  const out = {};
  if (!rawAttrs) return out;
  const re = /([a-zA-Z_][\w:-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(rawAttrs)) !== null) {
    out[m[1]] = decodeBasicEntities(m[2]);
  }
  return out;
}

function decodeBasicEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findStubInHtml(html, selector, cache) {
  if (!html) return null;
  if (cache.has(selector)) return cache.get(selector);

  let attrName, attrValue;
  let m;
  if ((m = selector.match(/^\[([^=\]]+)="([^"]+)"\]$/))) {
    attrName = m[1];
    attrValue = m[2];
  } else {
    return null;
  }

  const attrRe = new RegExp(
    `<(\\w+)((?:\\s+[a-zA-Z_][\\w:-]*\\s*=\\s*"[^"]*")*?\\s+${escapeRegExp(attrName)}\\s*=\\s*"${escapeRegExp(attrValue)}"(?:\\s+[a-zA-Z_][\\w:-]*\\s*=\\s*"[^"]*")*?)\\s*(\\/?)>(?:([\\s\\S]*?)<\\/\\1>)?`
  );
  const match = attrRe.exec(html);
  if (!match) return null;

  const tag = match[1];
  const attrs = match[2];
  const inner = match[4] || "";
  const stub = makeStubFromMatch(tag, attrs, inner);
  cache.set(selector, stub);
  return stub;
}

function makeRegion() {
  const listeners = new Map();
  const mounts = new Map();
  const stubCache = new Map();
  const attributes = {};
  let _innerHTML = "";
  const region = {
    classList: makeClassList(),
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((h) => h !== handler));
    },
    dispatchEvent(event) {
      if (!event.target) event.target = region;
      const list = listeners.get(event.type) || [];
      for (const fn of list) fn.call(region, event);
      return true;
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute(name) { return attributes[name] || null; },
    set innerHTML(html) {
      _innerHTML = String(html || "");
      mounts.clear();
      stubCache.clear();
      const re = /<(\w+)((?:\s+[a-zA-Z_][\w:-]*\s*=\s*"[^"]*")*?\s+data-mount\s*=\s*"([^"]+)"(?:\s+[a-zA-Z_][\w:-]*\s*=\s*"[^"]*")*?)\s*>\s*<\/\1>/g;
      let m;
      while ((m = re.exec(_innerHTML)) !== null) {
        mounts.set(m[3], makeMount());
      }
    },
    get innerHTML() { return _innerHTML; },
    querySelector(selector) {
      const mountM = selector.match(/^\[data-mount="([^"]+)"\]$/);
      if (mountM) return mounts.get(mountM[1]) || null;
      const own = findStubInHtml(_innerHTML, selector, stubCache);
      if (own) return own;
      for (const [, mount] of mounts) {
        const found = findStubInHtml(mount.innerHTML, selector, stubCache);
        if (found) return found;
      }
      return null;
    },
    _mounts: mounts,
    _listeners: listeners,
  };
  return region;
}

function makeDocument({ jbV2 = true } = {}) {
  const docBus = makeBus();
  const body = {
    classList: makeClassList(jbV2 ? ["jb-v2"] : []),
  };
  let region = null;
  return Object.assign(docBus, {
    body,
    readyState: "complete",
    querySelector(selector) {
      if (selector === '[data-region="role"]') return region;
      if (selector === '[data-region="letter"]') return null;
      if (selector === '[data-region="pipeline"]') return null;
      return null;
    },
    setRegion(r) { region = r; },
  });
}

function fixtureVm(overrides) {
  const job = Object.assign({
    jobKey: "linear-1",
    role: "Senior Product Designer, Growth",
    company: "Linear",
    companyTagline: "We build a tool for software teams that's fast, focused.",
    employment: "Full-time",
    stage: "researching",
    location: "Remote · SF",
    salary: "$165–210k",
    source: "Linear Careers",
    fitScore: 7.8,
    tags: ["Figma", "React", "Growth"],
    jdSnippet: "We build a tool for software teams.",
    jdSections: [
      {
        heading: "What you'll do",
        body:
          "Linear is looking for a senior product designer to own growth surfaces — onboarding, activation flows, and the marketing site — across web and desktop.",
        bullets: [
          "Design and ship growth surfaces.",
          "Partner with growth engineering on experimentation.",
          "Own activation as a measurable IC outcome.",
        ],
      },
      {
        heading: "What we're looking for",
        body: "",
        bullets: [
          "5+ years shipping growth or activation work.",
          "Portfolio with measurable outcomes.",
        ],
      },
      {
        heading: "About Linear",
        body: "",
        bullets: ["Fully remote.", "~80 people, Series B."],
      },
    ],
    deadline: null,
    notes: { body: "Recruiter intro Thu", editedAt: "" },
    contacts: [],
    links: [{ label: "Posting", href: "https://example.com/jobs/42" }],
  }, (overrides && overrides.job) || {});
  return { job };
}

function loadBriefOnly() {
  const documentEl = makeDocument();
  const windowEl = makeBus();
  windowEl.document = documentEl;
  windowEl.matchMedia = () => ({ matches: false });
  windowEl.CustomEvent = TestCustomEvent;
  windowEl.JobBoredFlowing = {};

  const context = vm.createContext({
    CustomEvent: TestCustomEvent,
    document: documentEl,
    window: windowEl,
    console: { error() {}, warn() {}, log() {} },
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(briefSource, context, { filename: "role-brief.js" });
  return { context, windowEl, documentEl };
}

function loadRoleAndBrief({ vm: roleVm }) {
  const documentEl = makeDocument();
  const region = makeRegion();
  region.setAttribute("data-region", "role");
  documentEl.setRegion(region);
  const windowEl = makeBus();
  windowEl.document = documentEl;
  windowEl.matchMedia = () => ({ matches: false });
  windowEl.CustomEvent = TestCustomEvent;
  windowEl.JobBoredDawn = { data: { getRoleViewModel: () => roleVm } };
  windowEl.JobBoredFlowing = {
    openRole: {
      get: () => roleVm.job.jobKey,
      set: () => {},
      clear: () => {},
    },
  };

  const context = vm.createContext({
    CustomEvent: TestCustomEvent,
    document: documentEl,
    window: windowEl,
    console: { error() {}, warn() {}, log() {} },
    MutationObserver: function () {
      return { observe() {}, disconnect() {} };
    },
    Date,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(briefSource, context, { filename: "role-brief.js" });
  vm.runInContext(roleSource, context, { filename: "role.js" });
  return { context, windowEl, documentEl, region };
}

describe("dossier brief structure", () => {
  it("masthead emits role + company + facts", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, fixtureVm());

    const html = mount.innerHTML;
    assert.match(html, /<header class="brief__masthead">/);
    assert.match(html, /<h1 class="brief__title">Senior Product Designer, Growth<\/h1>/);
    assert.match(html, /<p class="brief__company">Linear<\/p>/);
    assert.match(html, /<div class="brief__facts">/);
    assert.match(html, /<span>Remote · SF<\/span>/);
    assert.match(html, /<span>\$165–210k<\/span>/);
    assert.match(html, /<span>via Linear Careers<\/span>/);
    assert.match(html, /<div class="brief__eyebrow">Full-time<\/div>/);
  });

  it("hook renders only when companyTagline or first JD body exists", () => {
    const { context } = loadBriefOnly();

    const mountWith = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mountWith,
      fixtureVm({ job: { companyTagline: "Builders, builders." } }),
    );
    assert.match(mountWith.innerHTML, /<p class="brief__hook">Builders, builders\.<\/p>/);

    const mountJdBody = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mountJdBody,
      fixtureVm({
        job: {
          companyTagline: "",
          jdSnippet: "",
          jdSections: [
            {
              heading: "What you'll do",
              body: "Own growth surfaces and activation flows.",
              bullets: [],
            },
          ],
        },
      }),
    );
    assert.match(
      mountJdBody.innerHTML,
      /<p class="brief__hook">Own growth surfaces and activation flows\.<\/p>/,
    );

    const mountNeither = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mountNeither,
      fixtureVm({
        job: {
          companyTagline: "",
          jdSnippet: "",
          jdSections: [],
        },
      }),
    );
    assert.doesNotMatch(mountNeither.innerHTML, /class="brief__hook"/);
  });

  it("drop-cap lede renders the AI summary distinct from the hook", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, fixtureVm());

    assert.match(mount.innerHTML, /<p class="brief__lede">Linear is looking for/);
    assert.match(mount.innerHTML, /<div class="brief__lede-tag">Compressed by JobBored AI/);
  });

  it("lede is suppressed when first JD body equals the hook text", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      fixtureVm({
        job: {
          companyTagline: "",
          jdSnippet: "",
          jdSections: [
            { heading: "Hook section", body: "Same body for hook and lede.", bullets: [] },
          ],
        },
      }),
    );
    assert.match(mount.innerHTML, /<p class="brief__hook">Same body for hook and lede\.<\/p>/);
    assert.doesNotMatch(mount.innerHTML, /class="brief__lede"/);
  });

  it("skim panel renders only the fields present (no placeholders)", () => {
    const { context } = loadBriefOnly();

    const mountFull = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mountFull, fixtureVm());
    const skimFull = mountFull.innerHTML;
    assert.match(skimFull, /<ul class="skim">/);
    assert.match(skimFull, /<span class="key">Stack<\/span>/);
    assert.match(skimFull, /<span class="key">Comp<\/span>/);
    assert.match(skimFull, /<span class="key">Location<\/span>/);
    assert.match(skimFull, /<span class="key">ATS fit<\/span>/);
    assert.match(skimFull, /<span class="val val--score">78/);

    const mountSparse = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mountSparse,
      fixtureVm({
        job: {
          tags: [],
          salary: "",
          location: "Remote · SF",
          fitScore: null,
        },
      }),
    );
    const skimSparse = mountSparse.innerHTML;
    assert.match(skimSparse, /<ul class="skim">/);
    assert.match(skimSparse, /<span class="key">Location<\/span>/);
    assert.doesNotMatch(skimSparse, /<span class="key">Stack<\/span>/);
    assert.doesNotMatch(skimSparse, /<span class="key">Comp<\/span>/);
    assert.doesNotMatch(skimSparse, /<span class="key">ATS fit<\/span>/);

    const mountEmpty = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mountEmpty,
      fixtureVm({
        job: {
          tags: [],
          salary: "",
          location: "",
          fitScore: null,
        },
      }),
    );
    assert.doesNotMatch(mountEmpty.innerHTML, /class="skim"/);
  });

  it("raw posting accordion renders one <details> per JD section beyond [0]", () => {
    const { context } = loadBriefOnly();

    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, fixtureVm());
    const detailMatches = mount.innerHTML.match(/<details(?:\s|>)/g) || [];
    assert.equal(detailMatches.length, 2, "expected one <details> per JD section after [0]");

    const oneSectionMount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      oneSectionMount,
      fixtureVm({
        job: {
          jdSections: [
            { heading: "What you'll do", body: "Lead growth.", bullets: [] },
          ],
        },
      }),
    );
    assert.doesNotMatch(oneSectionMount.innerHTML, /<details/);
    assert.doesNotMatch(oneSectionMount.innerHTML, /class="jd"/);
  });

  it("first accordion section has [open] attribute", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, fixtureVm());

    const firstDetailsMatch = mount.innerHTML.match(/<details( open)?>/);
    assert.ok(firstDetailsMatch, "expected at least one <details>");
    assert.equal(firstDetailsMatch[1], " open", "first <details> should be open");

    const allMatches = mount.innerHTML.match(/<details(?:\s+open)?>/g) || [];
    const openCount = allMatches.filter((m) => /open/.test(m)).length;
    assert.equal(openCount, 1, "only the first <details> should carry [open]");
  });

  it("talking points list comes from jdSections[0].bullets", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, fixtureVm());

    assert.match(mount.innerHTML, /<section class="points">/);
    assert.match(mount.innerHTML, /<li>Design and ship growth surfaces\.<\/li>/);
    assert.match(mount.innerHTML, /<li>Partner with growth engineering on experimentation\.<\/li>/);
    assert.match(mount.innerHTML, /<li>Own activation as a measurable IC outcome\.<\/li>/);

    const noBullets = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      noBullets,
      fixtureVm({
        job: {
          jdSections: [{ heading: "What", body: "Just a body.", bullets: [] }],
        },
      }),
    );
    assert.doesNotMatch(noBullets.innerHTML, /class="points"/);
  });

  it("marginalia textarea renders with data-action='notes' and a placeholder", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      fixtureVm({ job: { notes: { body: "Recruiter Maya · Thu 2pm", editedAt: "" } } }),
    );

    assert.match(mount.innerHTML, /<div class="brief-notes">/);
    assert.match(mount.innerHTML, /<textarea data-action="notes" placeholder="[^"]+">/);
    assert.match(mount.innerHTML, /Recruiter Maya · Thu 2pm/);
  });

  it("marginalia textarea is wired to jb:role:note on blur (role.js + role-brief.js)", () => {
    const roleVm = fixtureVm({
      job: { jobKey: "L1", notes: { body: "initial", editedAt: "" } },
    });
    const { context, windowEl, documentEl, region } = loadRoleAndBrief({ vm: roleVm });

    const windowNotes = [];
    const documentNotes = [];
    windowEl.addEventListener("jb:role:note", (e) =>
      windowNotes.push({ type: e.type, detail: { ...e.detail } }),
    );
    documentEl.addEventListener("jb:role:note", (e) =>
      documentNotes.push({ type: e.type, detail: { ...e.detail } }),
    );

    context.window.JobBoredFlowing.role.renderForKey("L1");

    const textarea = region.querySelector('[data-action="notes"]');
    assert.ok(textarea, "expected role.js to find the brief textarea");
    textarea.value = "  Heard back from Maya  ";
    textarea.dispatchEvent({ type: "blur" });

    assert.equal(windowNotes.length, 1, "expected jb:role:note on window");
    assert.equal(documentNotes.length, 1, "expected jb:role:note on document");
    assert.deepEqual(windowNotes[0].detail, {
      jobKey: "L1",
      body: "Heard back from Maya",
    });
    assert.deepEqual(documentNotes[0].detail, {
      jobKey: "L1",
      body: "Heard back from Maya",
    });
  });
});
