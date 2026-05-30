import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const briefSource = readFileSync(join(repoRoot, "role-brief.js"), "utf8");
const roleSource = readFileSync(join(repoRoot, "role.js"), "utf8");
const roleCssSource = readFileSync(join(repoRoot, "role.css"), "utf8");

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
  it("masthead emits editable role + company + facts seeded with current values", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, fixtureVm());

    const html = mount.innerHTML;
    assert.match(html, /<header class="brief__masthead">/);
    // Title and company are now editable inputs (data-action="edit-field"),
    // seeded with the current value so a blur with no change is a no-op.
    assert.match(
      html,
      /<input[^>]*class="brief__title"[^>]*data-action="edit-field"[^>]*data-field="title"[^>]*value="Senior Product Designer, Growth"/,
    );
    assert.match(
      html,
      /<input[^>]*class="brief__company"[^>]*data-action="edit-field"[^>]*data-field="company"[^>]*value="Linear"/,
    );
    assert.match(html, /<div class="brief__facts">/);
    // Location and salary are editable facts.
    assert.match(html, /<input[^>]*data-action="edit-field"[^>]*data-field="location"[^>]*value="Remote · SF"/);
    assert.match(html, /<input[^>]*data-action="edit-field"[^>]*data-field="salary"[^>]*value="\$165–210k"/);
    // Source attribution stays static (not user-editable).
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
    context.window.JobBoredDossierBrief.renderBrief(
      mountFull,
      fixtureVm({
        job: {
          enrichment: {
            atsFitScore: 82,
            atsFitRationale: "Strong growth-design match; experimentation depth still needs proof.",
            extraKeywords: ["Growth design", "Experimentation", "Lifecycle"],
          },
        },
      }),
    );
    const skimFull = mountFull.innerHTML;
    assert.match(skimFull, /<ul class="skim">/);
    assert.match(skimFull, /<span class="key">ATS Fit<\/span>/);
    assert.match(skimFull, /<span class="val val--score" title="Strong growth-design match; experimentation depth still needs proof\.">82/);
    assert.match(skimFull, /<span class="key">Signals<\/span>/);
    assert.match(skimFull, /Growth design · Experimentation · Lifecycle/);
    assert.match(skimFull, /<span class="key">Comp<\/span>/);
    assert.match(skimFull, /<span class="key">Location<\/span>/);

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
    assert.doesNotMatch(skimSparse, /<span class="key">Signals<\/span>/);
    assert.doesNotMatch(skimSparse, /<span class="key">Comp<\/span>/);
    assert.doesNotMatch(skimSparse, /<span class="key">ATS fit<\/span>/);

    const mountFitOnly = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mountFitOnly,
      fixtureVm({
        job: {
          tags: [],
          salary: "",
          location: "",
          fitScore: 7.8,
        },
      }),
    );
    assert.doesNotMatch(mountFitOnly.innerHTML, /class="skim"/);
    assert.doesNotMatch(mountFitOnly.innerHTML, /ATS fit/);
    assert.doesNotMatch(mountFitOnly.innerHTML, /val--score/);
  });

  it("does not render the raw-posting disclosure (removed for editorial clarity)", () => {
    /* The brief now stays AI-curated end to end. The "View full posting
       details" disclosure has been removed from the left column; users
       open the original posting via the masthead's "View posting" CTA. */
    const { context } = loadBriefOnly();

    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, fixtureVm());

    assert.doesNotMatch(mount.innerHTML, /<details/, "no <details> in the brief");
    assert.doesNotMatch(mount.innerHTML, /class="jd__details"/);
    assert.doesNotMatch(mount.innerHTML, /View full posting details/);
    assert.doesNotMatch(mount.innerHTML, /class="jd__section"/);
    assert.doesNotMatch(mount.innerHTML, /class="jd"/);
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

  it("notes textarea renders with data-action='notes' and a placeholder", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      fixtureVm({ job: { notes: { body: "Recruiter Maya · Thu 2pm", editedAt: "" } } }),
    );

    assert.match(mount.innerHTML, /<div class="brief-notes">/);
    assert.match(mount.innerHTML, /<h3 class="section-label">Notes<\/h3>/);
    assert.doesNotMatch(mount.innerHTML, /Marginalia/);
    assert.match(mount.innerHTML, /<textarea data-action="notes" placeholder="[^"]+">/);
    assert.match(mount.innerHTML, /Recruiter Maya · Thu 2pm/);
    assert.match(roleCssSource, /\.brief-notes::before\s*{[\s\S]*content: "NOTES";/);
    assert.doesNotMatch(roleCssSource, /content:\s*"MARGINALIA"/);
  });

  it("notes textarea is wired to jb:role:note on blur (role.js + role-brief.js)", () => {
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

  it("re-renders an already-open role after Pipeline card attrs hydrate cached enrichment", () => {
    const roleVm = fixtureVm({
      job: {
        jobKey: "L1",
        enrichment: { status: "", postingSummary: "", mustHaves: [] },
      },
    });
    const { windowEl, documentEl, region } = loadRoleAndBrief({ vm: roleVm });

    windowEl.JobBoredFlowing.role.renderForKey("L1");
    assert.doesNotMatch(region.innerHTML, /Cached rich summary/);

    roleVm.job.enrichment = {
      status: "ready",
      roleInOneLine: "Cached rich hook",
      postingSummary: "Cached rich summary",
      fitAngle: "Cached rich fit",
      mustHaves: ["Cached must-have"],
      niceToHaves: [],
      responsibilities: ["Cached responsibility"],
      toolsAndStack: ["Cached tool"],
      atsFitScore: 82,
      atsFitRationale: "Cached rationale",
      extraKeywords: ["Cached"],
      talkingPoints: ["Cached talking point"],
    };
    documentEl.dispatchEvent(new TestCustomEvent("jb:pipeline:rendered"));

    const briefMount = region.querySelector('[data-mount="brief"]');
    assert.ok(briefMount, "expected role.js to render the brief mount");
    assert.match(briefMount.innerHTML, /Cached rich summary/);
    assert.match(briefMount.innerHTML, /Cached must-have/);
    assert.match(briefMount.innerHTML, /Cached responsibility/);
    assert.match(briefMount.innerHTML, /Cached talking point/);
  });
});

/* ----------------------------------------------------------------
   AI enrichment — drawer-parity Gemini payload (postingSummary,
   fitAngle, mustHaves, responsibilities, niceToHaves, toolsAndStack,
   talkingPoints, roleInOneLine). renderBrief pulls these off
   vm.job.enrichment and surfaces them in the dossier so the user
   sees the same compressed insights the legacy drawer shows.
   ---------------------------------------------------------------- */
describe("dossier brief — AI enrichment sections", () => {
  function withEnrichment(extra) {
    const enrichment = Object.assign({
      roleInOneLine: "",
      postingSummary: "",
      fitAngle: "",
      fitAssessment: "",
      mustHaves: [],
      niceToHaves: [],
      responsibilities: [],
      toolsAndStack: [],
      atsFitScore: null,
      atsFitRationale: "",
      extraKeywords: [],
      talkingPoints: [],
      status: "",
    }, extra || {});
    return fixtureVm({ job: { enrichment } });
  }

  it("prefers enrichment.roleInOneLine for the hook over the company tagline", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      withEnrichment({ roleInOneLine: "Own activation as an IC outcome." }),
    );
    assert.match(
      mount.innerHTML,
      /<p class="brief__hook">Own activation as an IC outcome\.<\/p>/,
      "hook should be the AI's one-line role framing, not the tagline",
    );
  });

  it("renders the LLM postingSummary as the lede and labels it 'AI Summary'", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      withEnrichment({
        postingSummary:
          "Lead growth design for Linear, owning onboarding and activation surfaces end-to-end with measurable outcomes.",
      }),
    );
    assert.match(
      mount.innerHTML,
      /<p class="brief__lede">Lead growth design for Linear/,
      "AI summary should drive the lede",
    );
    assert.match(
      mount.innerHTML,
      /<div class="brief__lede-tag">AI Summary · grounded in the posting<\/div>/,
      "lede tag should advertise the LLM as the source",
    );
  });

  it("renders fitAngle as the 'Why this role fits' pull-quote", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      withEnrichment({
        fitAngle:
          "Your activation work at Stripe maps directly to their onboarding ownership ask.",
      }),
    );
    assert.match(mount.innerHTML, /<section class="brief__fit">/);
    assert.match(mount.innerHTML, /Why this role fits/);
    assert.match(
      mount.innerHTML,
      /Your activation work at Stripe maps directly/,
    );
  });

  it("falls back to fitAssessment when fitAngle is empty", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      withEnrichment({
        fitAngle: "",
        fitAssessment: "Strong overlap with current work.",
      }),
    );
    assert.match(mount.innerHTML, /<section class="brief__fit">/);
    assert.match(mount.innerHTML, /Strong overlap with current work\./);
  });

  it("renders must-haves / responsibilities / nice-to-haves / tools as structured lists", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      withEnrichment({
        mustHaves: ["5+ years growth design", "Portfolio of measurable outcomes"],
        responsibilities: ["Own onboarding", "Run experiments with growth eng"],
        niceToHaves: ["Experience with Linear", "Familiarity with experimentation tooling"],
        toolsAndStack: ["Figma", "React", "Statsig"],
      }),
    );
    assert.match(mount.innerHTML, /brief__struct--must/);
    assert.match(mount.innerHTML, /brief__struct--resp/);
    assert.match(mount.innerHTML, /brief__struct--nice/);
    assert.match(mount.innerHTML, /brief__struct--tools/);
    assert.match(mount.innerHTML, /5\+ years growth design/);
    assert.match(mount.innerHTML, /Own onboarding/);
    assert.match(mount.innerHTML, /Statsig/);
  });

  it("prefers enrichment.talkingPoints over JD bullets in the side column", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      withEnrichment({
        talkingPoints: [
          "Tie Stripe Atlas activation lift to their onboarding ask.",
          "Show evidence of measurable outcomes from your last role.",
        ],
      }),
    );
    /* AI talking points present */
    assert.match(mount.innerHTML, /Tie Stripe Atlas activation lift/);
    assert.match(mount.innerHTML, /Show evidence of measurable outcomes/);
    /* JD bullets suppressed when AI talking points are available */
    assert.doesNotMatch(
      mount.innerHTML,
      /<li>Design and ship growth surfaces\.<\/li>/,
      "JD bullets must NOT render when AI talking points exist",
    );
  });

  it("renders the loading skeleton while enrichment is in flight", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      withEnrichment({ status: "loading" }),
    );
    /* Loading renders the editorial skeleton, not stale body/sidebar
       content from a previous enrichment. */
    assert.match(mount.innerHTML, /class="brief__skeleton"/);
    assert.match(mount.innerHTML, /Reading the posting/);
    assert.match(mount.innerHTML, /brief__skeleton-badge/);
    assert.match(mount.innerHTML, /brief__shimmer/);
    assert.doesNotMatch(mount.innerHTML, /class="brief__body"/);
    assert.doesNotMatch(mount.innerHTML, /class="brief__fit"/);
    assert.doesNotMatch(mount.innerHTML, /<ul class="skim">/);
    assert.doesNotMatch(mount.innerHTML, /class="points"/);
    assert.doesNotMatch(mount.innerHTML, /class="brief-notes"/);
    assert.doesNotMatch(mount.innerHTML, /data-action="notes"/);
  });

  it("loading skeleton replaces cached content while a refresh is in flight", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      withEnrichment({
        status: "loading",
        roleInOneLine: "Own activation as an IC outcome.",
        mustHaves: ["5+ years growth design"],
      }),
    );
    assert.match(mount.innerHTML, /class="brief__skeleton"/);
    assert.doesNotMatch(mount.innerHTML, /brief__enriching--inline/);
    assert.doesNotMatch(mount.innerHTML, /class="brief__body"/);
    assert.doesNotMatch(mount.innerHTML, /Own activation as an IC outcome/);
  });

  it("renders cached ready enrichment as the real brief with notes, not the skeleton", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mount,
      fixtureVm({
        job: {
          notes: { body: "Ask Maya about activation ownership", editedAt: "" },
          enrichment: {
            status: "ready",
            roleInOneLine: "Own activation as an IC outcome.",
            postingSummary:
              "Lead growth design across onboarding and activation with measurable product outcomes.",
            fitAngle: "Your activation work maps directly to this role's ownership ask.",
            mustHaves: ["5+ years growth design", "Experimentation portfolio"],
            niceToHaves: [],
            responsibilities: ["Own onboarding", "Partner with growth engineering"],
            toolsAndStack: ["Figma", "Statsig"],
            atsFitScore: 84,
            atsFitRationale: "Strong evidence for growth design and experimentation.",
            extraKeywords: ["Growth design", "Activation"],
            talkingPoints: ["Connect prior activation lifts to their onboarding funnel."],
          },
        },
      }),
    );

    assert.doesNotMatch(mount.innerHTML, /class="brief__skeleton"/);
    assert.match(mount.innerHTML, /class="brief__body"/);
    assert.match(mount.innerHTML, /Own activation as an IC outcome/);
    assert.match(mount.innerHTML, /5\+ years growth design/);
    assert.match(mount.innerHTML, /Partner with growth engineering/);
    assert.match(mount.innerHTML, /Ask Maya about activation ownership/);
    assert.match(mount.innerHTML, /data-action="notes"/);
  });

  it("does not render the loading skeleton when status is empty", () => {
    const { context } = loadBriefOnly();
    const mount = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(mount, fixtureVm());
    assert.doesNotMatch(mount.innerHTML, /class="brief__enriching/);
    assert.doesNotMatch(mount.innerHTML, /class="brief__skeleton"/);
  });

  it("renders a tags & skills cloud only when there are more than three tags", () => {
    const { context } = loadBriefOnly();

    const mountFew = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mountFew,
      fixtureVm({ job: { tags: ["A", "B"] } }),
    );
    assert.doesNotMatch(mountFew.innerHTML, /brief__tag-cloud/);

    const mountMany = makeMount();
    context.window.JobBoredDossierBrief.renderBrief(
      mountMany,
      fixtureVm({ job: { tags: ["Figma", "React", "Growth", "Statsig", "Activation"] } }),
    );
    assert.match(mountMany.innerHTML, /brief__tag-cloud/);
    assert.match(mountMany.innerHTML, /brief__skill-chip">Statsig</);
  });
});
