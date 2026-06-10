/* ============================================================
   role-field-edit-render-guard.test.mjs
   ------------------------------------------------------------
   Locks down the two UX-correctness grafts that make masthead
   identity editing safe in the jb-v2 role dossier:

     (1) FOCUS RE-RENDER GUARD — "no lost keystrokes."
         Every render rebuilds the dossier innerHTML wholesale.
         The 5-min CSV poll and every jb:write:succeeded fire
         jb:pipeline:rendered, which would re-render the OPEN
         dossier WHILE the user is still typing (pre-blur) and
         wipe the in-progress value. role.js must skip the
         re-render when an [data-action="edit-field"] input
         inside the region is document.activeElement — the
         dossier analog of pipeline.js scheduleRender's
         __pipePending bail. The guard is scoped to ONLY an
         edit-field activeElement so genuine updates (enrichment,
         stage change) are never swallowed.

     (2) COMMIT-ON-BLUR + ESCAPE-TO-CANCEL — "forgiving edits."
         Typing must NOT dispatch a write per keystroke; the
         write happens exactly once on blur (or Enter). Escape
         restores the seeded value and dispatches NOTHING.

   These are runtime tests over the REAL role-brief.js +
   role.js wiring, driven through a small DOM emulation that
   supports exactly what the wiring touches (innerHTML mounts,
   querySelectorAll for edit-field inputs, document.activeElement,
   region.contains).
   ============================================================ */

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
    this.target = null;
  }
}

function makeClassList(initial) {
  const set = new Set(initial || []);
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c) => (set.has(c) ? set.delete(c) : set.add(c)),
  };
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

/* A minimal editable <input> node. preventDefault() and Escape need
   blur() to actually fire the registered blur listeners, and matches()
   must recognize the edit-field selector for the focus guard. */
function makeInput(attrs, doc) {
  const listeners = new Map();
  const node = {
    nodeType: 1,
    tagName: "INPUT",
    value: attrs.value || "",
    _attrs: { ...attrs },
    getAttribute(name) {
      return name in this._attrs ? this._attrs[name] : null;
    },
    setAttribute(name, v) {
      this._attrs[name] = String(v);
    },
    matches(selector) {
      if (selector === '[data-action="edit-field"]') {
        return this._attrs["data-action"] === "edit-field";
      }
      return false;
    },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((h) => h !== handler));
    },
    dispatch(type, extra) {
      const event = { type, target: node, preventDefault() {}, ...extra };
      const list = listeners.get(type) || [];
      for (const fn of list) fn.call(node, event);
    },
    focus() {
      doc.activeElement = node;
    },
    blur() {
      this.dispatch("blur");
      if (doc.activeElement === node) doc.activeElement = doc.body;
    },
    _listeners: listeners,
  };
  return node;
}

/* Parse edit-field <input> tags out of an assembled HTML string into
   live node objects so the real wiring (querySelectorAll + blur/keydown)
   operates on the same nodes the test drives. */
function parseEditFields(html, doc) {
  const out = [];
  const re = /<input\b([^>]*\bdata-action="edit-field"[^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrText = m[1];
    const attrs = {};
    const attrRe = /([a-zA-Z_][\w:-]*)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(attrText)) !== null) attrs[a[1]] = a[2];
    out.push(makeInput(attrs, doc));
  }
  return out;
}

function makeMount(doc) {
  let html = "";
  return {
    get innerHTML() {
      return html;
    },
    set innerHTML(v) {
      html = String(v == null ? "" : v);
      doc._reindexEditFields();
    },
    classList: makeClassList(),
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
  };
}

function makeRegion(doc) {
  const listeners = new Map();
  const mounts = new Map();
  let html = "";
  const region = {
    nodeType: 1,
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
    setAttribute() {},
    getAttribute() {
      return null;
    },
    get innerHTML() {
      return html;
    },
    set innerHTML(v) {
      html = String(v == null ? "" : v);
      mounts.clear();
      const re = /data-mount="([^"]+)"/g;
      let m;
      while ((m = re.exec(html)) !== null) mounts.set(m[1], makeMount(doc));
      doc._reindexEditFields();
    },
    querySelector(selector) {
      const mountM = selector.match(/^\[data-mount="([^"]+)"\]$/);
      if (mountM) return mounts.get(mountM[1]) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-action="edit-field"]') return doc._editFields;
      return [];
    },
    contains(node) {
      return doc._editFields.includes(node);
    },
    _mounts: mounts,
    _assembledHtml() {
      let out = html;
      for (const [, mount] of mounts) out += "\n" + (mount.innerHTML || "");
      return out;
    },
  };
  return region;
}

function makeDocument() {
  const docBus = makeBus();
  const body = { classList: makeClassList(["jb-v2"]) };
  let region = null;
  const doc = Object.assign(docBus, {
    body,
    readyState: "complete",
    activeElement: body,
    _editFields: [],
    _reindexEditFields() {
      if (!region) {
        this._editFields = [];
        return;
      }
      this._editFields = parseEditFields(region._assembledHtml(), this);
    },
    querySelector(selector) {
      if (selector === '[data-region="role"]') return region;
      return null;
    },
    setRegion(r) {
      region = r;
    },
  });
  doc.body.contains = () => false;
  return doc;
}

function loadHarness(roleVm) {
  const documentEl = makeDocument();
  const region = makeRegion(documentEl);
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

  const writebacks = [];
  windowEl.addEventListener("jb:role:writeback", (e) => {
    writebacks.push({ ...e.detail });
  });

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

  return { context, windowEl, documentEl, region, writebacks };
}

function fixtureVm() {
  return {
    job: {
      jobKey: "linear-1",
      role: "Senior Product Designer",
      company: "Acme",
      location: "Remote",
      salary: "$165k",
      source: "Careers",
      employment: "Full-time",
      stage: "applied",
      notes: { body: "", editedAt: "" },
      links: [{ label: "Posting", href: "https://example.com/jobs/42" }],
    },
  };
}

function fieldInput(documentEl, field) {
  return documentEl._editFields.find((n) => n.getAttribute("data-field") === field);
}

describe("dossier masthead edit — focus re-render guard", () => {
  it("skips the wholesale re-render while an edit-field is focused (no keystroke loss)", () => {
    const roleVm = fixtureVm();
    const { context, documentEl, region } = loadHarness(roleVm);

    context.window.JobBoredFlowing.role.renderForKey("linear-1");
    const before = region.innerHTML;
    assert.ok(/data-action="edit-field"/.test(region._assembledHtml()), "masthead inputs must render");

    // User is mid-edit: type into the title field and keep focus.
    const titleInput = fieldInput(documentEl, "title");
    assert.ok(titleInput, "title edit-field must exist");
    titleInput.focus();
    titleInput.value = "Goog";

    // The 5-min poll / jb:write:succeeded cascade fires jb:pipeline:rendered
    // on document WHILE the user is still focused (pre-blur).
    documentEl.dispatchEvent(new TestCustomEvent("jb:pipeline:rendered", { detail: {} }));

    // The guard bailed: the region was NOT rebuilt and the keystrokes survive.
    assert.equal(
      region.innerHTML,
      before,
      "the dossier must NOT re-render while an edit-field is the activeElement",
    );
    assert.equal(
      documentEl._editFields.find((n) => n.getAttribute("data-field") === "title").value,
      "Goog",
      "the in-progress value must survive the cascade",
    );
  });

  it("does NOT skip the re-render when nothing in the region is focused", () => {
    const roleVm = fixtureVm();
    const { context, documentEl } = loadHarness(roleVm);
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    // Nobody is editing: activeElement is the body, not an edit-field.
    documentEl.activeElement = documentEl.body;
    const editFieldsBefore = documentEl._editFields;

    documentEl.dispatchEvent(new TestCustomEvent("jb:pipeline:rendered", { detail: {} }));

    // A genuine re-render must still happen (guard is scoped to edit-field
    // focus only) — confirmed by a fresh set of edit-field nodes.
    assert.notEqual(
      documentEl._editFields,
      editFieldsBefore,
      "the re-render must NOT be swallowed when no edit-field is focused",
    );
  });
});

describe("dossier masthead edit — Escape cancels, blur commits once", () => {
  it("Escape restores the original and dispatches NO writeback", () => {
    const roleVm = fixtureVm();
    const { context, documentEl, writebacks } = loadHarness(roleVm);
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const companyInput = fieldInput(documentEl, "company");
    assert.equal(companyInput.getAttribute("data-original"), "Acme");

    companyInput.focus();
    companyInput.value = "Acme Corp"; // typing changes the field...
    companyInput.dispatch("keydown", { key: "Escape" });

    // Escape restored the seeded value and committed nothing.
    assert.equal(companyInput.value, "Acme", "Escape must restore data-original");
    assert.equal(
      writebacks.length,
      0,
      "Escape must cancel — no jb:role:writeback may be dispatched",
    );
  });

  it("typing dispatches nothing; blur commits exactly once with the final value", () => {
    const roleVm = fixtureVm();
    const { context, documentEl, writebacks } = loadHarness(roleVm);
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const titleInput = fieldInput(documentEl, "title");
    titleInput.focus();

    // Simulate per-keystroke input events — none may dispatch a write.
    titleInput.value = "S";
    titleInput.dispatch("input", {});
    titleInput.value = "Staff Engineer";
    titleInput.dispatch("input", {});
    assert.equal(
      writebacks.length,
      0,
      "commit must be on blur/Enter only — never per keystroke",
    );

    // Blur commits exactly once with the final trimmed value.
    titleInput.blur();
    assert.equal(writebacks.length, 1, "blur must commit exactly once");
    assert.deepEqual(writebacks[0], {
      jobKey: "linear-1",
      field: "title",
      value: "Staff Engineer",
    });
  });

  it("a blur with an unchanged value commits nothing (no needless relock)", () => {
    const roleVm = fixtureVm();
    const { context, documentEl, writebacks } = loadHarness(roleVm);
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const salaryInput = fieldInput(documentEl, "salary");
    salaryInput.focus();
    // Leave the value identical (modulo whitespace) to data-original.
    salaryInput.value = "  $165k  ";
    salaryInput.blur();

    assert.equal(
      writebacks.length,
      0,
      "an unchanged value must not dispatch a writeback (avoids a needless " +
        "Sheet write + re-lock of the column)",
    );
  });
});
