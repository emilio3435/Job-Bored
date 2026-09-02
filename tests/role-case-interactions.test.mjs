/* ============================================================
   role-case-interactions.test.mjs
   ------------------------------------------------------------
   The cutover contract (Case plan Task 8, spec §5): role.js
   renders The Case into the role region and wires every action
   the renderer emits — stage stepper, the People writebacks
   (contact / last contact / replied toggle / follow-up date),
   the keywords tile, and the three new re-render triggers —
   all of them still behind the L1 focus guard.

   Harness: a small DOM emulation that parses the renderer's real
   HTML into nodes, so the assertions run against the SAME markup
   the browser gets. Trap 2 applies — jb-text.js is evaluated
   before role-case-model.js / role-case.js / role.js, and the
   first test asserts positive content so an empty render can
   never pass silently.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = ["jb-text.js", "role-case-model.js", "role-case.js", "role.js"].map((f) => ({
  filename: f,
  code: readFileSync(join(repoRoot, f), "utf8"),
}));

/* ------------------------------------------------------------
   Minimal DOM: parser + selector engine + bubbling dispatch.
   Only what role.js and the Case renderer actually touch.
   ------------------------------------------------------------ */

const VOID_TAGS = new Set(["input", "img", "br", "hr", "meta", "link"]);

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
    this.bubbles = !!(options && options.bubbles);
    this.target = null;
  }
}

/** Parse one simple selector (`button.foo[data-x="y"]`) into predicates. */
function compileSimple(sel) {
  const parts = [];
  const re = /^([a-zA-Z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/;
  let rest = sel.trim();
  while (rest) {
    const m = re.exec(rest);
    if (!m) throw new Error("unsupported selector fragment: " + sel);
    if (m[1]) parts.push((n) => n.tagName === m[1].toUpperCase());
    else if (m[2]) parts.push((n) => n.classList.contains(m[2]));
    else {
      const name = m[3];
      const want = m[4];
      parts.push((n) => (want === undefined ? n.getAttribute(name) !== null : n.getAttribute(name) === want));
    }
    rest = rest.slice(m[0].length);
  }
  return (node) => node.nodeType === 1 && parts.every((p) => p(node));
}

/** `a b, c` → [[matcherA, matcherB], [matcherC]] (descendant chains). */
function compileSelector(selector) {
  return String(selector)
    .split(",")
    .map((group) => group.trim().split(/\s+/).filter(Boolean).map(compileSimple))
    .filter((chain) => chain.length);
}

function matchesChain(node, chain) {
  if (!chain[chain.length - 1](node)) return false;
  let i = chain.length - 2;
  let parent = node.parentNode;
  while (i >= 0 && parent && parent.nodeType === 1) {
    if (chain[i](parent)) i -= 1;
    parent = parent.parentNode;
  }
  return i < 0;
}

function makeElement(tagName, attributes) {
  const attrs = { ...(attributes || {}) };
  const listeners = new Map();
  const children = [];
  const el = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    parentNode: null,
    children,
    style: {},
    text: "",
    value: attrs.value != null ? decodeEntities(attrs.value) : "",
    get type() { return attrs.type || (el.tagName === "INPUT" ? "text" : ""); },
    get classList() {
      const set = new Set(String(attrs.class || "").split(/\s+/).filter(Boolean));
      return { contains: (c) => set.has(c), add: (c) => set.add(c), remove: (c) => set.delete(c) };
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, v) { attrs[name] = String(v); },
    matches(selector) {
      return compileSelector(selector).some((chain) => chain[chain.length - 1](el));
    },
    contains(node) {
      for (let p = node; p; p = p.parentNode) if (p === el) return true;
      return false;
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter((h) => h !== fn));
    },
    _fire(event) {
      for (const fn of (listeners.get(event.type) || []).slice()) fn.call(el, event);
    },
    /** Bubbling dispatch: the handler chain role.js relies on. */
    dispatchEvent(event) {
      if (!event.target) event.target = el;
      for (let node = el; node; node = node.parentNode) {
        if (typeof node._fire === "function") node._fire(event);
      }
      return true;
    },
    click() {
      el.dispatchEvent({ type: "click", target: el, preventDefault() {} });
    },
    querySelectorAll(selector) {
      const chains = compileSelector(selector);
      const out = [];
      (function walk(node) {
        for (const child of node.children) {
          if (chains.some((chain) => matchesChain(child, chain))) out.push(child);
          walk(child);
        }
      })(el);
      return out;
    },
    querySelector(selector) {
      return el.querySelectorAll(selector)[0] || null;
    },
    appendChild(node) { node.parentNode = el; children.push(node); return node; },
    get innerHTML() { return el._html; },
    set innerHTML(html) {
      el._html = String(html == null ? "" : html);
      children.length = 0;
      for (const child of parseHtml(el._html)) {
        child.parentNode = el;
        children.push(child);
        adopt(child, el._ownerDocument);
      }
      el._renderCount = (el._renderCount || 0) + 1;
      /* A wholesale rebuild drops whatever was focused, exactly as the
         browser does when innerHTML replaces the subtree. */
      if (el._ownerDocument) el._ownerDocument.activeElement = el._ownerDocument.body;
    },
    _html: "",
    _renderCount: 0,
  };
  el.focus = function () { if (el._ownerDocument) el._ownerDocument.activeElement = el; };
  el.blur = function () {
    el.dispatchEvent({ type: "blur", target: el, preventDefault() {} });
    const doc = el._ownerDocument;
    if (doc && doc.activeElement === el) doc.activeElement = doc.body;
    el.dispatchEvent({ type: "focusout", target: el, preventDefault() {} });
  };
  return el;
}

const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*"[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
const ATTR_RE = /([^\s=]+)(?:\s*=\s*"([^"]*)")?/g;

function parseAttrs(text) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(String(text || "").trim())) !== null) {
    if (!m[1]) continue;
    attrs[m[1]] = m[2] === undefined ? "" : decodeEntities(m[2]);
  }
  return attrs;
}

/** @returns {object[]} top-level element nodes of `html`. */
function parseHtml(html) {
  const roots = [];
  const stack = [];
  const push = (node) => {
    const parent = stack[stack.length - 1];
    if (parent) { node.parentNode = parent; parent.children.push(node); }
    else roots.push(node);
  };
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (m[5] !== undefined) {
      const parent = stack[stack.length - 1];
      if (parent) parent.text += decodeEntities(m[5]);
      continue;
    }
    if (!m[2]) continue; // comment
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const node = makeElement(tag, parseAttrs(m[3]));
    push(node);
    if (!VOID_TAGS.has(tag) && m[4] !== "/") stack.push(node);
  }
  for (const node of roots) normalizeText(node);
  return roots;
}

/** A <textarea>'s value is its text content, not an attribute. */
function normalizeText(node) {
  if (node.tagName === "TEXTAREA") node.value = node.text;
  for (const child of node.children) normalizeText(child);
}

/** Attach the owning document to a subtree so focus()/blur() work. */
function adopt(node, doc) {
  if (!doc) return;
  node._ownerDocument = doc;
  for (const child of node.children) adopt(child, doc);
}

/* ------------------------------------------------------------
   Fixture — the Task 6 role (Meridian Labs, fictional).
   ------------------------------------------------------------ */

const STAGES = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];
const stages = {
  pairs: () => STAGES.map((k) => ({ key: k, label: k.replace("-", " ") })),
  toKey: (v) => (STAGES.includes(v) ? v : ""),
  toLabel: (v) => String(v).replace("-", " "),
  isClosed: (v) => ["rejected", "passed", "expired"].includes(v),
};

function fixtureJob() {
  return {
    jobKey: "job-1", role: "Senior PM", company: "Meridian Labs", location: "Austin, TX",
    employment: "Full-time", salary: "$185–230k", source: "Ashby", stage: "researching",
    daysInStage: 2, appliedAt: "", fitScore: 8, tags: ["Design Systems"],
    links: [{ label: "Posting", href: "https://jobs.test/1" }], foundAt: "2026-08-29",
    talkingPoints: [], notes: { body: "Recruiter: Dana", editedAt: "" }, priority: "high",
    favorite: true, logoUrl: "", contacts: [{ name: "Dana Reyes" }],
    lastHeardFrom: "2026-08-31", followUpDate: "2026-09-04", replied: "No",
    requirements: ["5+ years design systems"], skills: ["React"],
    enrichment: { roleInOneLine: "Design infrastructure that ships.", mustHaves: [], niceToHaves: [],
      toolsAndStack: ["React"], talkingPoints: ["Shipped tokens"], status: "ready" },
  };
}

function detailsOf(events, type) {
  return events
    .filter((e) => e.on === "window" && e.type === type)
    .map((e) => JSON.parse(JSON.stringify(e.detail)));
}

function boot({ openKey = "job-1", job = fixtureJob() } = {}) {
  const events = [];
  const timers = [];
  const profileMatchOpens = [];
  const stripRenders = [];

  const region = makeElement("section", { "data-region": "role" });
  const body = makeElement("body", { class: "jb-v2" });

  const listenersFor = (target, on) => {
    const map = new Map();
    target.addEventListener = (type, fn) => {
      const list = map.get(type) || [];
      list.push(fn);
      map.set(type, list);
    };
    target.removeEventListener = (type, fn) => {
      map.set(type, (map.get(type) || []).filter((h) => h !== fn));
    };
    target.dispatchEvent = (event) => {
      events.push({ on: on, type: event.type, detail: event.detail });
      for (const fn of (map.get(event.type) || []).slice()) fn.call(target, event);
      return true;
    };
  };

  const documentEl = { body, readyState: "complete", activeElement: body };
  listenersFor(documentEl, "document");
  documentEl.querySelector = (sel) => (sel === '[data-region="role"]' ? region : null);
  region._ownerDocument = documentEl;

  const windowEl = {
    document: documentEl,
    CustomEvent: TestCustomEvent,
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    JobBoredStages: stages,
    JobBoredDawn: { data: { getRoleViewModel: () => ({ job }) } },
    JobBoredFlowing: { openRole: { get: () => openKey, set: () => {}, clear: () => { openKey = null; } } },
    JobBoredApp: {
      core: { getJobByStableKey: (k) => (String(k) === String(job.jobKey) ? job : null) },
      keywordMatch: {
        analyzeJob: () => ({
          percentage: 74, foundCount: 12, partialCount: 4, missingTerms: [{ label: "Kubernetes" }],
          byLabel: new Map([["5+ years design systems", "found"], ["react", "found"]]),
        }),
        openProfileMatchModal: (j) => profileMatchOpens.push(j),
      },
    },
    /* The real recruiter-strip.js innerHTML-overwrites whatever element it is
       handed; the stub only records that role.js handed it the Case's own
       mount and the open role's view-model. */
    JobBoredRecruiterStrip: {
      render: (mountEl, roleVm) => stripRenders.push({ mountEl, roleVm }),
    },
  };
  listenersFor(windowEl, "window");

  const context = vm.createContext({
    window: windowEl, document: documentEl, CustomEvent: TestCustomEvent,
    console: { log() {}, warn() {}, error() {} },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    Date, Number, Math, Array, Object, String, JSON, Map, Set, RegExp, isNaN, parseInt, parseFloat,
  });
  for (const { filename, code } of sources) vm.runInContext(code, context, { filename });

  return {
    region, win: windowEl, doc: documentEl, events, profileMatchOpens, stripRenders,
    /* Details are minted inside the vm realm, so copy them into plain
       host objects before deepEqual compares prototypes. */
    writebacks: () => detailsOf(events, "jb:role:writeback"),
    moves: () => detailsOf(events, "jb:pipeline:move"),
    renderCount: () => region._renderCount,
    flushTimers: () => { while (timers.length) timers.shift()(); },
    setOpenKey: (k) => { openKey = k; },
  };
}

describe("The Case interactions", () => {
  it("renders the case into the region for an open role", () => {
    const { region } = boot();
    assert.ok(region.querySelector(".case__rail"), "the status rail must render");
    assert.ok(region.querySelector('[data-mount="materials"]'), "the materials mount must render");
    assert.equal(region.querySelector(".case__title").getAttribute("value"), "Senior PM");
    assert.ok(region.querySelector('[data-action="notes"]'), "the notes surface must render");
  });

  /* L7 gap 2: the recruiter CRM row lived only in the retired Brief. The Case
     renders the mount at the foot of YOUR MOVES and role.js — the region
     owner, not the renderer — fills it, exactly as the Brief did. */
  it("mounts the recruiter strip under People in the your-moves lane", () => {
    const { region } = boot();
    const mount = region.querySelector('[data-mount="recruiter-strip"]');
    assert.ok(mount, "the recruiter-strip mount must render");
    const moves = region.querySelector(".case__lane--moves");
    assert.ok(moves && moves.contains(mount), "the mount belongs to the YOUR MOVES lane");
    const people = region.querySelector(".case__kv");
    assert.ok(people && moves.contains(people), "precondition: People renders in the same lane");
  });

  it("hands the recruiter strip its own mount and the open role", () => {
    const { region, stripRenders } = boot();
    assert.equal(stripRenders.length, 1, "role.js must render the strip exactly once per dossier render");
    assert.equal(
      stripRenders[0].mountEl,
      region.querySelector('[data-mount="recruiter-strip"]'),
      "the strip gets the dedicated mount, never a shared container it would overwrite",
    );
    assert.equal(stripRenders[0].roleVm.job.jobKey, "job-1");
    assert.equal(stripRenders[0].roleVm.job.company, "Meridian Labs");
  });

  it("stage step click dispatches jb:pipeline:move with the rendered from-stage", () => {
    const { region, moves } = boot();
    region.querySelector('[data-action="stage-step"][data-stage="applied"]').click();
    assert.deepEqual(moves(), [{ jobKey: "job-1", fromStage: "researching", toStage: "applied" }]);
  });

  it("clicking the step the role is already on dispatches nothing", () => {
    const { region, moves } = boot();
    region.querySelector('[data-action="stage-step"][data-stage="researching"]').click();
    assert.deepEqual(moves(), []);
  });

  it("follow-up date commits on change, exactly once", () => {
    const { region, writebacks } = boot();
    const date = region.querySelector('[data-field="followupAt"]');
    assert.equal(date.type, "date");
    date.value = "2026-09-10";
    date.dispatchEvent({ type: "change", target: date });
    date.blur();
    assert.deepEqual(writebacks(), [{ jobKey: "job-1", field: "followupAt", value: "2026-09-10" }]);
  });

  it("the replied toggle dispatches the opposite value, not the current one", () => {
    const { region, writebacks } = boot();
    const toggle = region.querySelector('[data-field="reply"]');
    assert.equal(toggle.getAttribute("data-value"), "Yes", "fixture replied=No, so the toggle offers Yes");
    toggle.click();
    assert.deepEqual(writebacks(), [{ jobKey: "job-1", field: "reply", value: "Yes" }]);
  });

  it("a replied role's toggle offers No", () => {
    const job = fixtureJob();
    job.replied = "Yes";
    const { region, writebacks } = boot({ job });
    region.querySelector('[data-field="reply"]').click();
    assert.deepEqual(writebacks(), [{ jobKey: "job-1", field: "reply", value: "No" }]);
  });

  it("contact and last-contact commit on blur through the writeback contract", () => {
    const { region, writebacks } = boot();
    const contact = region.querySelector('[data-field="contact"]');
    assert.equal(contact.getAttribute("data-original"), "Dana Reyes");
    contact.focus();
    contact.value = "Dana Reyes (recruiter)";
    contact.blur();

    const heard = region.querySelector('[data-field="heardBack"]');
    heard.focus();
    heard.value = "2026-09-01";
    heard.blur();

    assert.deepEqual(writebacks(), [
      { jobKey: "job-1", field: "contact", value: "Dana Reyes (recruiter)" },
      { jobKey: "job-1", field: "heardBack", value: "2026-09-01" },
    ]);
  });

  it("the keywords tile opens the existing profile-match modal with the raw job", () => {
    const { region, profileMatchOpens } = boot();
    const tile = region.querySelector('[data-action="open-profile-match"]');
    assert.ok(tile, "the keywords tile is a button when a match analysis exists");
    tile.click();
    assert.equal(profileMatchOpens.length, 1);
    assert.equal(profileMatchOpens[0].jobKey, "job-1");
  });

  it("re-renders on jb:ats:state, jb:profile-match:ready and jb:materials:manifest", () => {
    const { win, renderCount } = boot();
    let expected = renderCount();
    for (const type of ["jb:profile-match:ready", "jb:ats:state"]) {
      win.dispatchEvent(new TestCustomEvent(type, { detail: {} }));
      expected += 1;
      assert.equal(renderCount(), expected, type + " must re-render the open role");
    }
    win.dispatchEvent(new TestCustomEvent("jb:materials:manifest", { detail: { jobKey: "job-1" } }));
    assert.equal(renderCount(), expected + 1, "a manifest for the open role must re-render");
  });

  it("ignores a jb:materials:manifest for a different role", () => {
    const { win, renderCount } = boot();
    const before = renderCount();
    win.dispatchEvent(new TestCustomEvent("jb:materials:manifest", { detail: { jobKey: "other-job" } }));
    assert.equal(renderCount(), before);
  });

  it("defers the new triggers while an edit surface is focused, then flushes on blur", () => {
    const { region, win, renderCount, flushTimers } = boot();
    const notes = region.querySelector('[data-action="notes"]');
    notes.focus();
    const before = renderCount();

    win.dispatchEvent(new TestCustomEvent("jb:ats:state", { detail: { jobKey: "job-1", status: "success" } }));
    assert.equal(renderCount(), before, "deferred while notes focused");

    notes.blur();
    flushTimers();
    assert.equal(renderCount(), before + 1, "the deferred render flushes once notes give up focus");
  });

  it("the replied toggle never commits through the input path", () => {
    const { region, writebacks } = boot();
    const toggle = region.querySelector('[data-field="reply"]');
    // A <button> has no string `value`; blurring it must not write the label.
    toggle.blur();
    assert.deepEqual(writebacks(), [], "a non-input edit surface must not commit on blur");
  });
});
