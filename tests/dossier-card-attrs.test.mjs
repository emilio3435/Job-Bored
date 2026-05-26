/* ============================================================
   dossier-card-attrs.test.mjs
   ------------------------------------------------------------
   Post-refactor (2026-05-20) IA contract: the Dossier renders
   only the editorial Brief. The standalone Workshop block has
   been removed; stage controls, ATS scorecard, hero CTAs, and
   progress chips live in the renamed PART 04 Workshop region
   (data-region="letter"). This test pins what the role region
   must (and must not) contain.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const briefSource = readFileSync(join(repoRoot, "role-brief.js"), "utf8");
const workshopSource = readFileSync(join(repoRoot, "role-workshop.js"), "utf8");
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

function makeMount(classes) {
  const listeners = new Map();
  const attributes = {};
  const mount = {
    classList: makeClassList(classes),
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

function makeRegion() {
  const listeners = new Map();
  const mounts = new Map();
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
      const re = /<(\w+)((?:\s+[a-zA-Z_][\w:-]*\s*=\s*"[^"]*")*?\s+data-mount\s*=\s*"([^"]+)"(?:\s+[a-zA-Z_][\w:-]*\s*=\s*"[^"]*")*?)\s*>\s*<\/\1>/g;
      let m;
      while ((m = re.exec(_innerHTML)) !== null) {
        const mountName = m[3];
        const attrs = m[2];
        const classMatch = attrs.match(/\bclass\s*=\s*"([^"]*)"/);
        const classes = classMatch
          ? classMatch[1].split(/\s+/).filter(Boolean)
          : [];
        mounts.set(mountName, makeMount(classes));
      }
    },
    get innerHTML() { return _innerHTML; },
    querySelector(selector) {
      const mountM = selector.match(/^\[data-mount="([^"]+)"\]$/);
      if (mountM) return mounts.get(mountM[1]) || null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    _mounts: mounts,
    _listeners: listeners,
  };
  return region;
}

function makeDocument() {
  const docBus = makeBus();
  const body = { classList: makeClassList(["jb-v2"]) };
  let region = null;
  const queryHandlers = {};
  return Object.assign(docBus, {
    body,
    readyState: "complete",
    querySelector(selector) {
      if (selector === '[data-region="role"]') return region;
      if (queryHandlers[selector]) return queryHandlers[selector]();
      return null;
    },
    setRegion(r) { region = r; },
    setQueryHandler(selector, fn) { queryHandlers[selector] = fn; },
  });
}

function fixtureVm() {
  return {
    job: {
      jobKey: "linear-1",
      role: "Senior Product Designer, Growth",
      company: "Linear",
      companyTagline: "We build a tool for software teams that's fast, focused.",
      employment: "Full-time",
      stage: "applied",
      location: "Remote · SF",
      salary: "$165–210k",
      source: "Linear Careers",
      fitScore: 7.8,
      tags: ["Figma", "React"],
      jdSnippet: "We build a tool for software teams.",
      jdSections: [
        {
          heading: "What you'll do",
          body: "Linear is looking for a senior product designer to own growth surfaces.",
          bullets: ["Design growth surfaces.", "Partner with growth engineering."],
        },
        {
          heading: "What we're looking for",
          body: "",
          bullets: ["5+ years.", "Portfolio with measurable outcomes."],
        },
      ],
      deadline: { dueDate: "2026-05-23T00:00:00Z", daysUntil: 4 },
      notes: { body: "Recruiter intro Thu", editedAt: "" },
      contacts: [],
      links: [{ label: "Posting", href: "https://example.com/jobs/42" }],
      appliedAt: "2026-05-13T00:00:00Z",
    },
  };
}

function loadAllThree({ vm: roleVm }) {
  const documentEl = makeDocument();
  const region = makeRegion();
  region.setAttribute("data-region", "role");
  documentEl.setRegion(region);
  documentEl.setQueryHandler('[data-region="letter"]', () => null);
  documentEl.setQueryHandler('[data-region="pipeline"]', () => null);

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
  vm.runInContext(workshopSource, context, { filename: "role-workshop.js" });
  vm.runInContext(roleSource, context, { filename: "role.js" });
  return { context, windowEl, documentEl, region };
}

function assembleHtml(region) {
  let html = region.innerHTML || "";
  for (const [, mount] of region._mounts) {
    html += "\n" + (mount.innerHTML || "");
  }
  return html;
}

describe("dossier card attrs", () => {
  it("the dossier renders the brief with masthead + notes + full CTA cluster (View / Cover / Tailor)", () => {
    const roleVm = fixtureVm();
    const { context, region } = loadAllThree({ vm: roleVm });

    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const html = assembleHtml(region);

    /* Dossier-owned actions: close-role lives on the divider; notes
       are the marginalia textarea inside the brief. */
    assert.match(html, /data-action="close-role"/, "close-role action selector missing");
    assert.match(html, /data-action="notes"/, "notes action selector missing");

    /* Brief class selectors */
    assert.match(html, /class="brief__masthead"/, "brief__masthead missing");
    assert.match(html, /class="brief__col brief__col--main[^"]*"/, "brief__col--main missing");
    assert.match(html, /class="brief__col brief__col--side[^"]*"/, "brief__col--side missing");

    /* The Dossier hero owns the canonical action cluster: View posting,
       Draft cover letter, Tailor resume. The Workshop is the doing
       surface and does NOT duplicate these entry points. */
    assert.match(html, /class="brief__cta-cluster"/, "brief__cta-cluster missing");
    assert.match(html, /class="brief__cta brief__cta--view"/, "View posting CTA missing");
    assert.match(html, /data-action="brief-view-posting"/, "brief-view-posting data-action missing");
    assert.match(html, /class="brief__cta brief__cta--cover"/, "Cover-letter CTA missing");
    assert.match(html, /data-action="resume-cover"/, "resume-cover CTA missing");
    assert.match(html, /class="brief__cta brief__cta--tailor"/, "Tailor-resume CTA missing");
    assert.match(html, /data-action="resume-tailor"/, "resume-tailor CTA missing");
    assert.match(html, /href="https:\/\/example\.com\/jobs\/42"/, "posting href missing");
    assert.match(html, /target="_blank"/, "external target missing");
  });

  it("standalone workshop selectors are NOT rendered into the dossier region", () => {
    const roleVm = fixtureVm();
    const { context, region } = loadAllThree({ vm: roleVm });
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const html = assembleHtml(region);

    /* The standalone workshop block has been removed. None of these
       Workshop-specific selectors may appear inside the dossier
       region — they live in the renamed Workshop (data-region="letter")
       instead. The CTAs themselves (resume-cover / resume-tailor) ARE
       in the Dossier masthead as the canonical entry points; the
       assertion target here is the Workshop's *editor and stepper UI*,
       not the entry-point CTAs. */
    assert.doesNotMatch(html, /class="workshop"/, "workshop block must not be in dossier");
    assert.doesNotMatch(html, /class="workshop__bar"/, "workshop__bar must not be in dossier");
    assert.doesNotMatch(html, /class="mode-divider"/, "mode-divider must not be in dossier");
    assert.doesNotMatch(html, /class="stepper"/, "stage stepper must not be in dossier");
    assert.doesNotMatch(html, /class="writeback"/, "progress chips must not be in dossier");
    assert.doesNotMatch(html, /class="ats-card[^"]*"/, "ats-card must not be in dossier");
  });

  it("the brief mount is the only dossier mount; the workshop mount is gone", () => {
    const roleVm = fixtureVm();
    const { context, region } = loadAllThree({ vm: roleVm });
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const briefMount = region._mounts.get("brief");
    const workshopMount = region._mounts.get("workshop");
    assert.ok(briefMount, "expected a brief mount");
    assert.equal(workshopMount, undefined, "expected NO workshop mount in dossier");

    assert.match(briefMount.innerHTML, /class="brief__masthead"/);
    assert.match(briefMount.innerHTML, /class="brief__col brief__col--main[^"]*"/);
    assert.match(briefMount.innerHTML, /class="brief__col brief__col--side[^"]*"/);
    assert.match(briefMount.innerHTML, /data-action="notes"/);
    assert.match(briefMount.innerHTML, /class="brief__cta-cluster"/);
  });

  it("renderForKey on an unknown key falls back to the empty shelf, not the dossier", () => {
    const roleVm = { job: { jobKey: "linear-1", role: "", company: "" } };
    const { context, region } = loadAllThree({ vm: roleVm });
    context.window.JobBoredFlowing.role.renderForKey("not-a-real-key");

    const html = region.innerHTML;
    assert.match(html, /class="jb-shelf"/, "expected empty shelf");
    assert.doesNotMatch(html, /class="dossier"/);
  });
});
