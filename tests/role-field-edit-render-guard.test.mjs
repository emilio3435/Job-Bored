/* ============================================================
   role-field-edit-render-guard.test.mjs
   ------------------------------------------------------------
   Locks down the UX-correctness grafts that make in-place
   editing safe in the jb-v2 role dossier:

     (1) FOCUS RE-RENDER GUARD — "no lost keystrokes."
         Every render rebuilds the dossier innerHTML wholesale.
         The 5-min CSV poll and every jb:write:succeeded fire
         jb:pipeline:rendered, which would re-render the OPEN
         dossier WHILE the user is still typing (pre-blur) and
         wipe the in-progress value. role.js must skip the
         re-render when a guarded edit surface inside the region
         is document.activeElement — the dossier analog of
         pipeline.js scheduleRender's __pipePending bail. The
         guard covers the masthead [data-action="edit-field"]
         inputs AND the [data-action="notes"] textarea, and is
         scoped to ONLY those so genuine updates (enrichment,
         stage change) are never swallowed.

     (2) DEFERRED-RENDER FLUSH — "never left stale."
         A swallowed render is queued, not dropped: focusout on
         a guarded surface flushes it on the next macrotask, so
         the enrichment that arrived mid-typing paints as soon
         as the user stops.

     (3) COMMIT-ON-BLUR + ESCAPE-TO-CANCEL — "forgiving edits."
         Typing must NOT dispatch a write per keystroke; the
         write happens exactly once on blur (or Enter). Escape
         restores the seeded value and dispatches NOTHING.

   These are runtime tests over the REAL Case renderer + role.js
   wiring, driven through a small DOM emulation that supports
   exactly what the wiring touches (innerHTML mounts,
   querySelectorAll for edit-field inputs, document.activeElement,
   region.contains).

   Retargeted at the cutover (Case plan Task 8): the guarded rail
   inputs are now `.case__title` / `.case__company` and the People
   row's `contact`, not the retired `.brief__*` masthead. Every
   behavioral assertion above is unchanged.

   The old (4) FACT-INPUT WIDTH FALLBACK block retired with the
   Brief: The Case's rail inputs are full-width block fields, so
   there is no borderless auto-sizing surface left to fall back
   for (see LANE-REPORT-L5.md §5).
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/* Trap 2: jb-text.js MUST evaluate before the Case model/renderer, or both
   throw inside a try and the region paints empty — a test asserting only
   absence would then "pass" on nothing. */
const caseSources = ["jb-text.js", "role-case-model.js", "role-case.js"].map((f) => ({
  filename: f,
  code: readFileSync(join(repoRoot, f), "utf8"),
}));
const roleSource = readFileSync(join(repoRoot, "role.js"), "utf8");

const STAGES = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];
const stages = {
  pairs: () => STAGES.map((k) => ({ key: k, label: k.replace("-", " ") })),
  toKey: (v) => (STAGES.includes(v) ? v : ""),
  toLabel: (v) => String(v).replace("-", " "),
  isClosed: (v) => ["rejected", "passed", "expired"].includes(v),
};

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

/* A minimal editable <input>/<textarea> node. preventDefault() and Escape
   need blur() to actually fire the registered blur listeners; matches()
   must recognize EVERY selector in a comma-joined edit-surface list so the
   focus guard sees the notes textarea as well as the masthead inputs; and
   blur() must bubble a focusout to the region so the deferred-render flush
   listener runs (spec D6). */
function makeField(attrs, doc, tagName) {
  const listeners = new Map();
  const node = {
    nodeType: 1,
    tagName: tagName || "INPUT",
    value: attrs.value || "",
    style: {},
    _attrs: { ...attrs },
    getAttribute(name) {
      return name in this._attrs ? this._attrs[name] : null;
    },
    setAttribute(name, v) {
      this._attrs[name] = String(v);
    },
    matches(selector) {
      return String(selector).split(",").some((part) => {
        const m = /^\s*\[data-action="([^"]+)"\]\s*$/.exec(part);
        return !!m && this._attrs["data-action"] === m[1];
      });
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
      // Real focusout bubbles to the region; the flush listener lives there.
      const region = doc._region;
      if (region && typeof region.dispatchEvent === "function") {
        region.dispatchEvent({ type: "focusout", target: node });
      }
    },
    _listeners: listeners,
  };
  return node;
}

/* Parse edit-field <input> tags out of an assembled HTML string into
   live node objects so the real wiring (querySelectorAll + blur/keydown)
   operates on the same nodes the test drives. */
function parseAttrs(attrText) {
  const attrs = {};
  const attrRe = /([a-zA-Z_][\w:-]*)="([^"]*)"/g;
  let a;
  while ((a = attrRe.exec(attrText)) !== null) attrs[a[1]] = a[2];
  return attrs;
}

function parseEditFields(html, doc) {
  const out = [];
  const re = /<input\b([^>]*\bdata-action="edit-field"[^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(makeField(parseAttrs(m[1]), doc, "INPUT"));
  return out;
}

/* The Notes textarea is the second guarded edit surface (spec D6). */
function parseNotes(html, doc) {
  const m = /<textarea\b([^>]*\bdata-action="notes"[^>]*)>/.exec(html);
  return m ? makeField(parseAttrs(m[1]), doc, "TEXTAREA") : null;
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
      region._renderCount += 1;
      mounts.clear();
      const re = /data-mount="([^"]+)"/g;
      let m;
      while ((m = re.exec(html)) !== null) mounts.set(m[1], makeMount(doc));
      doc._reindexEditFields();
    },
    _renderCount: 0,
    querySelector(selector) {
      const mountM = selector.match(/^\[data-mount="([^"]+)"\]$/);
      if (mountM) return mounts.get(mountM[1]) || null;
      if (selector === '[data-action="notes"]') return doc._notes;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-action="edit-field"]') return doc._editFields;
      return [];
    },
    contains(node) {
      return doc._editFields.includes(node) || (!!doc._notes && node === doc._notes);
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
    _notes: null,
    _region: null,
    _reindexEditFields() {
      if (!region) {
        this._editFields = [];
        this._notes = null;
        return;
      }
      const assembled = region._assembledHtml();
      this._editFields = parseEditFields(assembled, this);
      this._notes = parseNotes(assembled, this);
    },
    querySelector(selector) {
      if (selector === '[data-region="role"]') return region;
      return null;
    },
    setRegion(r) {
      region = r;
      this._region = r;
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
  windowEl.JobBoredStages = stages;
  /* role.js schedules the deferred-render flush via root.setTimeout; capture
     the queue so tests drive it deterministically. */
  const timers = [];
  windowEl.setTimeout = (fn) => {
    timers.push(fn);
    return timers.length;
  };
  const flushTimers = () => {
    while (timers.length) timers.shift()();
  };
  windowEl.CustomEvent = TestCustomEvent;
  windowEl.JobBoredDawn = { data: { getRoleViewModel: () => roleVm } };
  windowEl.JobBoredApp = { core: { getJobByStableKey: () => roleVm.job } };
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
    Map,
    Set,
    RegExp,
    setTimeout,
    clearTimeout,
  });

  for (const { filename, code } of caseSources) vm.runInContext(code, context, { filename });
  vm.runInContext(roleSource, context, { filename: "role.js" });

  return {
    context,
    windowEl,
    documentEl,
    region,
    writebacks,
    flushTimers,
    renderCount: () => region._renderCount,
  };
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
      contacts: [{ name: "Dana Reyes" }],
      lastHeardFrom: "2026-08-31",
      followUpDate: "",
      replied: "No",
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
    const assembled = region._assembledHtml();
    assert.ok(/class="case__rail"/.test(assembled), "the Case rail must render (trap 2: empty HTML must not pass)");
    assert.ok(/class="case__title"/.test(assembled), "the guarded rail input is now .case__title");
    assert.ok(/data-action="edit-field"/.test(assembled), "rail inputs must render");

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

    const contactInput = fieldInput(documentEl, "contact");
    contactInput.focus();
    // Leave the value identical (modulo whitespace) to data-original.
    contactInput.value = "  Dana Reyes  ";
    contactInput.blur();

    assert.equal(
      writebacks.length,
      0,
      "an unchanged value must not dispatch a writeback (avoids a needless " +
        "Sheet write + re-lock of the column)",
    );
  });
});

/* ------------------------------------------------------------
   (3) NOTES IS A GUARDED EDIT SURFACE + DEFERRED RENDER FLUSH
   Resilience spec D6: the Notes textarea loses keystrokes to the
   same background cascade the masthead inputs were protected
   from, and a swallowed render must not leave the dossier stale
   forever — it flushes once the surface gives up focus.
   ------------------------------------------------------------ */
describe("notes textarea is a guarded edit surface", () => {
  it("skips re-render while the notes textarea has focus", () => {
    const { context, region, renderCount } = loadHarness(fixtureVm());
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const notes = region.querySelector('[data-action="notes"]');
    assert.ok(notes, "the notes textarea must render");
    notes.value = "Recruiter: Sam";
    notes.focus();

    const before = renderCount();
    // Background poll analog: jb:pipeline:rendered / jb:role:enriched.
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    assert.equal(
      renderCount(),
      before,
      "render must be deferred while the notes textarea is focused",
    );
    assert.equal(notes.value, "Recruiter: Sam", "in-progress notes must survive");
  });

  it("flushes the deferred render after blur, so the dossier is not left stale", () => {
    const { context, region, renderCount, flushTimers } = loadHarness(fixtureVm());
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const notes = region.querySelector('[data-action="notes"]');
    notes.focus();
    const before = renderCount();
    context.window.JobBoredFlowing.role.renderForKey("linear-1");
    assert.equal(renderCount(), before, "precondition: the render was deferred");

    notes.blur(); // fires blur + focusout in the stub
    flushTimers(); // drain the setTimeout(0) queue

    assert.equal(
      renderCount(),
      before + 1,
      "the pending render must run once the guarded surface blurs",
    );
  });

  it("a masthead edit-field also defers and then flushes on blur", () => {
    const { context, documentEl, region, renderCount, flushTimers } = loadHarness(fixtureVm());
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const titleInput = fieldInput(documentEl, "title");
    titleInput.focus();
    const before = renderCount();
    documentEl.dispatchEvent(new TestCustomEvent("jb:pipeline:rendered", { detail: {} }));
    assert.equal(renderCount(), before, "precondition: the render was deferred");

    titleInput.blur();
    flushTimers();

    assert.equal(
      renderCount(),
      before + 1,
      "the masthead guard must queue the render, not drop it on the floor",
    );
    assert.ok(region.innerHTML.length > 0, "the flushed render must paint the region");
  });

  it("nothing is flushed when no render was deferred", () => {
    const { context, region, renderCount, flushTimers } = loadHarness(fixtureVm());
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const notes = region.querySelector('[data-action="notes"]');
    notes.focus();
    const before = renderCount();

    notes.blur(); // focus/blur with no background cascade in between
    flushTimers();

    assert.equal(renderCount(), before, "a blur with no pending render must not re-render");
  });
});
