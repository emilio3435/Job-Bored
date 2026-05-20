import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workshopSource = readFileSync(join(repoRoot, "role-workshop.js"), "utf8");

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
      listeners.set(
        type,
        list.filter((h) => h !== handler),
      );
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

function makeMount({ isWorkshop = true } = {}) {
  const listeners = new Map();
  const attributes = {};
  const atsContainer = {
    _innerHTML: "",
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v == null ? "" : v); },
  };
  const mount = {
    classList: makeClassList(isWorkshop ? ["workshop"] : []),
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
    querySelector(selector) {
      if (selector === "[data-ats-container]") return atsContainer;
      return null;
    },
    _listeners: listeners,
    _atsContainer: atsContainer,
  };
  return mount;
}

function makeFixture(overrides) {
  const job = Object.assign({
    jobKey: "job-1",
    role: "Senior Product Designer, Growth",
    company: "Linear",
    stage: "applied",
    appliedAt: "2026-05-13T00:00:00Z",
    fitScore: 8,
    salary: "$165–210k",
    location: "Remote · SF",
    employment: "Full-time",
    source: "Linear Careers",
    tags: ["Figma", "React"],
    jdSnippet: "We build a tool for software teams.",
    jdSections: [
      {
        heading: "What you'll do",
        body: "Linear is looking for a senior product designer.",
        bullets: ["Design growth surfaces", "Partner with growth engineering"],
      },
    ],
    deadline: null,
    notes: null,
    contacts: [],
    links: [{ label: "Posting", href: "https://example.com/jobs/42" }],
  }, (overrides && overrides.job) || {});
  return { job };
}

function loadWorkshop() {
  const windowEl = makeBus();
  const documentEl = makeBus();
  windowEl.CustomEvent = TestCustomEvent;
  const letterRegion = {
    _scrolledIntoViewWith: null,
    scrollIntoView(opts) { this._scrolledIntoViewWith = opts || true; },
  };
  documentEl.querySelector = (selector) => {
    if (selector === '[data-region="letter"]') return letterRegion;
    return null;
  };
  windowEl.matchMedia = () => ({ matches: false });

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
  vm.runInContext(workshopSource, context, { filename: "role-workshop.js" });
  return { context, windowEl, documentEl, letterRegion };
}

function clickWith(mount, attrs) {
  const target = {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    parentNode: mount,
  };
  const handlers = mount._listeners.get("click") || [];
  for (const fn of handlers) {
    fn.call(mount, { type: "click", target });
  }
}

function captureEvents(busList, eventType) {
  const events = [];
  for (const bus of busList) {
    bus.addEventListener(eventType, (e) => {
      events.push({
        bus,
        type: e.type,
        detail: e.detail ? { ...e.detail } : e.detail,
      });
    });
  }
  return events;
}

describe("dossier workshop events", () => {
  it("renderWorkshop emits jb:ats:state:request on mount with the job key", () => {
    const { context, windowEl, documentEl } = loadWorkshop();
    const requests = captureEvents([windowEl, documentEl], "jb:ats:state:request");

    const mount = makeMount();
    context.window.JobBoredDossierWorkshop.renderWorkshop(mount, makeFixture());

    const onWindow = requests.filter((e) => e.bus === windowEl);
    const onDocument = requests.filter((e) => e.bus === documentEl);
    assert.equal(onWindow.length, 1, "expected one jb:ats:state:request on window");
    assert.equal(onDocument.length, 1, "expected one jb:ats:state:request on document");
    assert.deepEqual(onWindow[0].detail, { jobKey: "job-1" });
    assert.deepEqual(onDocument[0].detail, { jobKey: "job-1" });
  });

  it("clicking a stepper step emits jb:role:writeback with field='stage'", () => {
    const { context, windowEl, documentEl } = loadWorkshop();
    const writebacks = captureEvents([windowEl, documentEl], "jb:role:writeback");

    const mount = makeMount();
    context.window.JobBoredDossierWorkshop.renderWorkshop(mount, makeFixture());

    clickWith(mount, { "data-stage-value": "phone-screen" });

    const onWindow = writebacks.filter((e) => e.bus === windowEl);
    assert.equal(onWindow.length, 1);
    assert.deepEqual(onWindow[0].detail, {
      jobKey: "job-1",
      field: "stage",
      value: "phone-screen",
    });
  });

  it("each chip emits the matching jb:role:writeback field/value pair", () => {
    const cases = [
      { writeback: "heardBack", field: "heardBack", valueIsToday: true },
      { writeback: "reply", field: "reply", valueIsToday: true },
      { writeback: "followupAt", field: "followupAt", valueDaysOffset: 3 },
      { writeback: "passed", field: "passed", value: true },
    ];
    for (const c of cases) {
      const { context, windowEl, documentEl } = loadWorkshop();
      const writebacks = captureEvents([windowEl, documentEl], "jb:role:writeback");

      const mount = makeMount();
      context.window.JobBoredDossierWorkshop.renderWorkshop(mount, makeFixture());

      clickWith(mount, { "data-writeback": c.writeback });

      const onWindow = writebacks.filter((e) => e.bus === windowEl);
      assert.equal(onWindow.length, 1, `chip ${c.writeback}: expected one writeback on window`);
      assert.equal(onWindow[0].detail.jobKey, "job-1");
      assert.equal(onWindow[0].detail.field, c.field);
      if (c.valueIsToday) {
        assert.match(
          onWindow[0].detail.value,
          /^\d{4}-\d{2}-\d{2}$/,
          `chip ${c.writeback}: expected ISO date value`,
        );
        const today = new Date();
        const expected =
          today.getFullYear() +
          "-" +
          String(today.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(today.getDate()).padStart(2, "0");
        assert.equal(onWindow[0].detail.value, expected);
      } else if (typeof c.valueDaysOffset === "number") {
        const target = new Date();
        target.setDate(target.getDate() + c.valueDaysOffset);
        const expected =
          target.getFullYear() +
          "-" +
          String(target.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(target.getDate()).padStart(2, "0");
        assert.equal(onWindow[0].detail.value, expected);
      } else {
        assert.equal(onWindow[0].detail.value, c.value);
      }
    }
  });

  it("clicking 'See full scorecard' emits jb:ats:modal:open", () => {
    const { context, windowEl, documentEl } = loadWorkshop();
    const opens = captureEvents([windowEl, documentEl], "jb:ats:modal:open");

    const mount = makeMount();
    context.window.JobBoredDossierWorkshop.renderWorkshop(mount, makeFixture());

    clickWith(mount, { "data-action": "ats-modal-open" });

    const onWindow = opens.filter((e) => e.bus === windowEl);
    const onDocument = opens.filter((e) => e.bus === documentEl);
    assert.equal(onWindow.length, 1, "expected one jb:ats:modal:open on window");
    assert.equal(onDocument.length, 1, "expected one jb:ats:modal:open on document");
    assert.deepEqual(onWindow[0].detail, { jobKey: "job-1" });
    assert.deepEqual(onDocument[0].detail, { jobKey: "job-1" });
  });

  it("'Tailor resume' and 'Cover letter' emit jb:role:action and scroll to letter region", () => {
    for (const action of ["resume-tailor", "resume-cover"]) {
      const { context, windowEl, documentEl, letterRegion } = loadWorkshop();
      const actions = captureEvents([windowEl, documentEl], "jb:role:action");

      const mount = makeMount();
      context.window.JobBoredDossierWorkshop.renderWorkshop(mount, makeFixture());

      letterRegion._scrolledIntoViewWith = null;
      clickWith(mount, { "data-action": action });

      const onWindow = actions.filter((e) => e.bus === windowEl);
      assert.equal(onWindow.length, 1, `${action}: expected one jb:role:action on window`);
      assert.deepEqual(onWindow[0].detail, { action, jobKey: "job-1" });
      assert.notEqual(
        letterRegion._scrolledIntoViewWith,
        null,
        `${action}: expected smoothScrollTo to run on the letter region`,
      );
    }
  });

  it("clicking 'Retry' on the ATS card emits jb:ats:state:request", () => {
    const { context, windowEl, documentEl } = loadWorkshop();
    // Drain the on-mount jb:ats:state:request before clicking retry.
    const mount = makeMount();
    context.window.JobBoredDossierWorkshop.renderWorkshop(mount, makeFixture());

    const requests = captureEvents([windowEl, documentEl], "jb:ats:state:request");
    clickWith(mount, { "data-action": "ats-state-retry" });

    const onWindow = requests.filter((e) => e.bus === windowEl);
    assert.equal(onWindow.length, 1);
    assert.deepEqual(onWindow[0].detail, { jobKey: "job-1" });
  });
});
