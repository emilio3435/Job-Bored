/* ============================================================
   dossier-workshop-events.test.mjs
   ------------------------------------------------------------
   role-workshop.js used to render a standalone Workshop block
   into the Dossier. Post-refactor (2026-05-20), the Workshop
   is the renamed PART 04 region (data-region="letter"); the
   module now exposes pure HTML renderers and a single
   wireWorkshop(region, jobKey) delegate that emits the same
   events as before:
       jb:role:writeback  (stage, heardBack, reply, followupAt, passed)
       jb:role:action     (resume-tailor, resume-cover)
   These tests pin that event contract.
   ============================================================ */

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

/* A minimal "region" for the workshop delegate. */
function makeRegion() {
  const listeners = new Map();
  const attributes = {};
  const region = {
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
    _listeners: listeners,
  };
  return region;
}

function loadWorkshop() {
  const windowEl = makeBus();
  const documentEl = makeBus();
  windowEl.CustomEvent = TestCustomEvent;
  documentEl.querySelector = () => null;
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
  return { context, windowEl, documentEl };
}

function clickWith(region, attrs) {
  const target = {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    parentNode: region,
  };
  const handlers = region._listeners.get("click") || [];
  for (const fn of handlers) {
    fn.call(region, { type: "click", target });
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
  it("exposes the expected renderer surface and helpers", () => {
    const { context } = loadWorkshop();
    const api = context.window.JobBoredDossierWorkshop;
    assert.ok(api, "JobBoredDossierWorkshop is exposed");
    assert.equal(typeof api.renderHeroCtas, "function");
    assert.equal(typeof api.renderStageStepper, "function");
    assert.equal(typeof api.renderProgressChips, "function");
    assert.equal(typeof api.wireWorkshop, "function");
    assert.equal(typeof api.todayIso, "function");
    assert.equal(typeof api.plusDaysIso, "function");
  });

  it("renderHeroCtas returns empty (Dossier owns the canonical CTAs; Workshop must not duplicate them)", () => {
    /* Workshop is the doing surface (editor, scorecard, missing
       keywords, tools, progress). Entry-point CTAs live in the
       Dossier hero — see brief-structure tests. renderHeroCtas is
       preserved as an empty stub so letter.js can keep splicing it
       without conditionals. */
    const { context } = loadWorkshop();
    const html = context.window.JobBoredDossierWorkshop.renderHeroCtas({ jobKey: "job-1" });
    assert.equal(html, "", "renderHeroCtas must return empty string");
  });

  it("renderStageStepper highlights the current stage", () => {
    const { context } = loadWorkshop();
    const html = context.window.JobBoredDossierWorkshop.renderStageStepper({ stage: "applied" });
    assert.match(html, /class="jb-letter-block jb-letter-block--stage"/);
    assert.match(html, /class="stepper"/);
    assert.match(
      html,
      /class="stepper__step stepper__step--current"\s+data-stage-value="applied"/,
      "the current stage is marked",
    );
  });

  it("renderProgressChips emits four progress writeback chips", () => {
    const { context } = loadWorkshop();
    const html = context.window.JobBoredDossierWorkshop.renderProgressChips();
    assert.match(html, /class="jb-letter-block jb-letter-block--progress"/);
    assert.match(html, /class="writeback"/);
    assert.match(html, /data-writeback="heardBack"/);
    assert.match(html, /data-writeback="reply"/);
    assert.match(html, /data-writeback="followupAt"/);
    assert.match(html, /data-writeback="passed"/);
  });

  it("wireWorkshop -> clicking a stepper step emits jb:role:writeback with field='stage'", () => {
    const { context, windowEl, documentEl } = loadWorkshop();
    const writebacks = captureEvents([windowEl, documentEl], "jb:role:writeback");

    const region = makeRegion();
    context.window.JobBoredDossierWorkshop.wireWorkshop(region, "job-1");

    clickWith(region, { "data-stage-value": "phone-screen" });

    const onWindow = writebacks.filter((e) => e.bus === windowEl);
    assert.equal(onWindow.length, 1);
    assert.deepEqual(onWindow[0].detail, {
      jobKey: "job-1",
      field: "stage",
      value: "phone-screen",
    });
  });

  it("wireWorkshop -> each chip emits the matching jb:role:writeback field/value pair", () => {
    const cases = [
      { writeback: "heardBack", field: "heardBack", valueIsToday: true },
      { writeback: "reply", field: "reply", valueIsToday: true },
      { writeback: "followupAt", field: "followupAt", valueDaysOffset: 3 },
      { writeback: "passed", field: "passed", value: true },
    ];
    for (const c of cases) {
      const { context, windowEl, documentEl } = loadWorkshop();
      const writebacks = captureEvents([windowEl, documentEl], "jb:role:writeback");

      const region = makeRegion();
      context.window.JobBoredDossierWorkshop.wireWorkshop(region, "job-1");

      clickWith(region, { "data-writeback": c.writeback });

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

  it("wireWorkshop -> Tailor + Cover hero CTAs emit jb:role:action", () => {
    for (const action of ["resume-tailor", "resume-cover"]) {
      const { context, windowEl, documentEl } = loadWorkshop();
      const actions = captureEvents([windowEl, documentEl], "jb:role:action");

      const region = makeRegion();
      context.window.JobBoredDossierWorkshop.wireWorkshop(region, "job-1");

      clickWith(region, { "data-action": action });

      const onWindow = actions.filter((e) => e.bus === windowEl);
      assert.equal(onWindow.length, 1, `${action}: expected one jb:role:action on window`);
      assert.deepEqual(onWindow[0].detail, { action, jobKey: "job-1" });
    }
  });

  it("wireWorkshop is idempotent — calling twice updates jobKey without double-binding", () => {
    const { context, windowEl, documentEl } = loadWorkshop();
    const writebacks = captureEvents([windowEl, documentEl], "jb:role:writeback");

    const region = makeRegion();
    const api = context.window.JobBoredDossierWorkshop;
    api.wireWorkshop(region, "job-1");
    api.wireWorkshop(region, "job-2");

    clickWith(region, { "data-stage-value": "offer" });

    const onWindow = writebacks.filter((e) => e.bus === windowEl);
    assert.equal(onWindow.length, 1, "click should fire exactly once after re-wire");
    assert.equal(onWindow[0].detail.jobKey, "job-2");
  });
});
