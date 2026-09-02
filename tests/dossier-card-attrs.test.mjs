/* ============================================================
   dossier-card-attrs.test.mjs
   ------------------------------------------------------------
   IA contract for the role region. Post-refactor (2026-05-20)
   the standalone Workshop block moved out to the renamed PART 04
   Workshop region (data-region="letter"); at the dossier-case
   cutover (2026-09-02) the editorial Brief it left behind became
   The Case. This test pins what the role region must (and must
   not) contain, retargeted block for block.

   Trap 2: jb-text.js evaluates BEFORE role-case-model.js and
   role-case.js, or both throw inside a try and the region paints
   empty — so every assertion below that pins an ABSENCE is
   paired with one that pins real content.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const caseSources = ["jb-text.js", "role-case-model.js", "role-case.js"].map((f) => ({
  filename: f,
  code: readFileSync(join(repoRoot, f), "utf8"),
}));
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

const CARD_STAGES = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];
const cardStages = {
  pairs: () => CARD_STAGES.map((k) => ({ key: k, label: k.replace("-", " ") })),
  toKey: (v) => (CARD_STAGES.includes(v) ? v : ""),
  toLabel: (v) => String(v).replace("-", " "),
  isClosed: (v) => ["rejected", "passed", "expired"].includes(v),
};

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
  windowEl.JobBoredStages = cardStages;
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

  for (const { filename, code } of caseSources) vm.runInContext(code, context, { filename });
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
  it("the dossier renders The Case: rail, stepper, numbers, lanes, notes, record", () => {
    const roleVm = fixtureVm();
    const { context, region } = loadAllThree({ vm: roleVm });

    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const html = assembleHtml(region);

    /* Dossier-owned actions: notes are the marginalia textarea. The CLOSE
       button on the divider has been removed — users close the dossier via
       the kanban-row affordance instead. */
    assert.doesNotMatch(html, /data-action="close-role"/, "close-role button should be removed");
    assert.match(html, /data-action="notes"/, "notes action selector missing");

    /* Case block selectors (spec §1 layout, in order). */
    assert.match(html, /class="case__rail"/, "status rail missing");
    assert.match(html, /class="case__stepper"/, "stage stepper missing");
    assert.match(html, /class="case__board"/, "evidence board missing");
    assert.match(html, /class="case__notes"/, "notes block missing");
    assert.match(html, /class="case__chron"/, "the record missing");

    /* Identity is editable in place, through the frozen writeback contract. */
    assert.match(html, /data-action="edit-field"[^\u003e]*data-field="title"/, "editable title missing");
    assert.match(html, /data-action="edit-field"[^\u003e]*data-field="company"/, "editable company missing");
    assert.match(html, /Senior Product Designer, Growth/, "the role title must actually render");

    /* View posting stays the canonical outbound link. The resume-cover /
       resume-tailor CTAs moved into the materials rows as Draft buttons
       (plan Task 9) and are rendered by role-materials.js, which this
       harness does not load — see tests/role-materials.test.mjs. */
    assert.match(html, /data-action="brief-view-posting"/, "brief-view-posting data-action missing");
    assert.match(html, /href="https:\/\/example\.com\/jobs\/42"/, "posting href missing");
    assert.match(html, /target="_blank"/, "external target missing");
  });

  it("standalone workshop selectors are NOT rendered into the dossier region", () => {
    const roleVm = fixtureVm();
    const { context, region } = loadAllThree({ vm: roleVm });
    context.window.JobBoredFlowing.role.renderForKey("linear-1");

    const html = assembleHtml(region);

    /* The standalone workshop block has been removed. None of these
       Workshop-specific selectors may appear inside the dossier region —
       they live in the renamed Workshop (data-region="letter") instead.
       The Case's own stepper is `case__stepper`, deliberately NOT the
       Workshop's `stepper`. */
    assert.match(html, /class="case__stepper"/, "precondition: the Case's own stepper renders");
    assert.doesNotMatch(html, /class="workshop"/, "workshop block must not be in dossier");
    assert.doesNotMatch(html, /class="workshop__bar"/, "workshop__bar must not be in dossier");
    assert.doesNotMatch(html, /class="mode-divider"/, "mode-divider must not be in dossier");
    assert.doesNotMatch(html, /class="stepper"/, "the Workshop stage stepper must not be in dossier");
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

    assert.match(briefMount.innerHTML, /class="case__rail"/);
    assert.match(briefMount.innerHTML, /class="case__board"/);
    assert.match(briefMount.innerHTML, /data-action="notes"/);
    /* The Case emits the materials mount role-materials.js renders into. */
    assert.match(briefMount.innerHTML, /class="case__materials" data-mount="materials"/);
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

/* ============================================================
   parsePipelineCSV reads the Edit-Lock column (Y) into _editLock
   ------------------------------------------------------------
   WHY: the read side must stay in lockstep with the write side.
   editJobField writes a comma-separated list of locked field ids
   into column Y (sheetIndex 24) so re-discovery skips those
   identity columns. If the parser does not surface that value as
   job._editLock, the in-app dossier would have no way to know a
   field is locked, and the lock state would silently round-trip
   only through the Sheet — invisible to the client. A row with NO
   column Y (legacy / un-edited) must default to '' so the rest of
   the app treats it as "nothing locked", preserving back-compat.
   ============================================================ */
function sliceParsePipelineCSV() {
  const sheetsReadJs = readFileSync(join(repoRoot, "sheets-read-load.js"), "utf8");
  const start = sheetsReadJs.indexOf("function isDiscoveryAutomationNotesString");
  assert.ok(start >= 0, "isDiscoveryAutomationNotesString must exist");
  const end = sheetsReadJs.indexOf("async function loadAllData", start);
  assert.ok(end > start, "loadAllData must follow parsePipelineCSV in source order");
  return sheetsReadJs.slice(start, end);
}

function runParsePipelineCSV(rows) {
  const slice = sliceParsePipelineCSV();
  const factory = new Function(
    "console",
    `${slice}\nreturn parsePipelineCSV;`,
  );
  const parse = factory({ error() {}, warn() {}, log() {} });
  return parse(rows);
}

describe("parsePipelineCSV — Edit Lock (column Y) read", () => {
  const header = Array.from({ length: 25 }, (_, i) => `col${i}`);

  it("parses column Y ('title,company') into job._editLock", () => {
    const dataRow = Array.from({ length: 25 }, () => "");
    dataRow[1] = "Senior Designer"; // title (required for the row to parse)
    dataRow[2] = "Linear"; // company
    dataRow[24] = "title,company"; // Edit Lock (column Y)

    const [job] = runParsePipelineCSV([header, dataRow]);
    assert.ok(job, "expected the row to parse into a job");
    assert.equal(
      job._editLock,
      "title,company",
      "the locked-field CSV in column Y must surface verbatim on _editLock",
    );
  });

  it("defaults _editLock to '' when the row has no column Y (back-compat)", () => {
    // A legacy 24-wide row (A..X, no Edit Lock column at all).
    const legacyHeader = Array.from({ length: 24 }, (_, i) => `col${i}`);
    const dataRow = Array.from({ length: 24 }, () => "");
    dataRow[1] = "Senior Designer";
    dataRow[2] = "Linear";

    const [job] = runParsePipelineCSV([legacyHeader, dataRow]);
    assert.ok(job, "expected the legacy row to parse into a job");
    assert.equal(
      job._editLock,
      "",
      "an absent column Y must read as no-lock ('') so un-edited rows " +
        "keep byte-identical pre-change discovery behavior",
    );
  });
});

/* ============================================================
   Kanban card transport (pipeline-render.js renderKanbanCard)
   ------------------------------------------------------------
   The card's data-* attributes are the ONLY channel between the
   board and the dossier, so their clipping and escaping is a
   contract, not an implementation detail. Both now run through
   window.JobBoredText (trap 2: it MUST be evaluated first —
   pipeline-render.js calls it unconditionally).
   ============================================================ */

const jbTextSource = readFileSync(join(repoRoot, "jb-text.js"), "utf8");
const pipelineRenderSource = readFileSync(join(repoRoot, "pipeline-render.js"), "utf8");

function loadPipelineRender() {
  const windowEl = makeBus();
  windowEl.JobBoredApp = {
    core: {
      getPipelineData: () => windowEl.__jobs,
      getViewedJobKeys: () => new Set(),
      getExpandedStages: () => new Set(),
      host: {
        escapeHtml: (s) =>
          String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;"),
      },
    },
    companyLogo: { renderLogoHtml: () => "" },
  };
  const context = vm.createContext({
    window: windowEl,
    document: {
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {},
    },
    console: { log() {}, warn() {}, error() {} },
    Set,
    Map,
    Date,
    Number,
    Math,
    JSON,
    parseInt,
    parseFloat,
  });
  vm.runInContext(jbTextSource, context, { filename: "jb-text.js" });
  assert.equal(
    typeof windowEl.JobBoredText.clip,
    "function",
    "jb-text.js must be evaluated before pipeline-render.js",
  );
  vm.runInContext(pipelineRenderSource, context, { filename: "pipeline-render.js" });
  return windowEl;
}

/** Render one job to its kanban-card HTML. */
function renderCardHtml(job) {
  const windowEl = loadPipelineRender();
  windowEl.__jobs = [job];
  return windowEl.JobBoredApp.pipelineRender.renderKanbanCard(job, 0);
}

/* Attribute values arrive HTML-escaped; decode ONE level (trap 4) so the
   assertions see the value the dossier's parser will see. */
function decodeAttrValue(raw) {
  return String(raw)
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Parse the <article> tag's data-* attributes into a decoded map. */
function renderCardAttrs(job) {
  const html = renderCardHtml(job);
  const tag = /<article\b([^>]*)>/.exec(html);
  assert.ok(tag, "renderKanbanCard must emit an <article> element");
  const out = {};
  const attrRe = /([a-zA-Z_][\w:-]*)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(tag[1])) !== null) out[m[1]] = decodeAttrValue(m[2]);
  // Absent attributes read as "" — _pair omits them entirely.
  return new Proxy(out, {
    get: (target, prop) =>
      (typeof prop === "string" && !(prop in target) && prop.startsWith("data-") ? "" : target[prop]),
  });
}

describe("v2 attr clipping is word- and surrogate-safe", () => {
  it("clips data-role-in-one-line at a word boundary within 240 chars", () => {
    const long = "Owns the platform roadmap " + "and the reliability program ".repeat(20);
    const attrs = renderCardAttrs({ _postingEnrichment: { roleInOneLine: long } });
    const v = attrs["data-role-in-one-line"];
    assert.ok(v.startsWith("Owns the platform roadmap"), "the head of the value must survive");
    assert.ok(v.length <= 240, `expected <= 240 chars, got ${v.length}`);
    assert.ok(v.endsWith("…"), "a clipped value must be marked with an ellipsis");
    assert.ok(!/\S{240}/.test(v), "must not be an unbroken 240-char cut");
  });

  it("leaves a short value untouched — no gratuitous ellipsis", () => {
    const attrs = renderCardAttrs({ _postingEnrichment: { roleInOneLine: "Own the platform." } });
    assert.equal(attrs["data-role-in-one-line"], "Own the platform.");
  });

  it("never emits a lone surrogate", () => {
    const s = "x".repeat(238) + "💡💡💡";
    const attrs = renderCardAttrs({ _postingEnrichment: { roleInOneLine: s } });
    const v = attrs["data-role-in-one-line"];
    assert.ok(v.length > 0, "the value must not be dropped entirely");
    assert.doesNotMatch(v, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    assert.doesNotMatch(v, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("clips the jd snippet to its 4000-char budget, word-safely", () => {
    const jd = "Para one. " + "reliability engineering work ".repeat(300);
    const attrs = renderCardAttrs({ _postingEnrichment: { description: jd } });
    const v = attrs["data-jd-snippet"];
    assert.ok(v.startsWith("Para one."), "the head of the JD must survive");
    assert.ok(v.length <= 4000, `expected <= 4000 chars, got ${v.length}`);
    assert.ok(v.endsWith("…"));
  });

  it("attribute newlines are encoded as &#10;", () => {
    const raw = renderCardHtml({ _postingEnrichment: { description: "Para one.\n\nPara two." } });
    assert.match(raw, /data-jd-snippet="[^"]*Para one\.&#10;&#10;Para two\./);
    assert.doesNotMatch(raw, /data-jd-snippet="[^"]*\n/, "a raw newline must never survive into an attribute");
  });

  it("escapes quotes so a JSON array attribute round-trips", () => {
    const attrs = renderCardAttrs({
      _postingEnrichment: { mustHaves: ['5+ yrs "systems" work', "Owns SLAs"] },
    });
    assert.deepEqual(JSON.parse(attrs["data-must-haves"]), ['5+ yrs "systems" work', "Owns SLAs"]);
  });
});

/* ============================================================
   Case attrs (spec §4) — sheet state the Case reads
   ------------------------------------------------------------
   Additive only: every existing attribute name and budget is
   unchanged. These carry priority, favorite, logo, match score,
   reply state and the structured requirement/skill lists from
   the board to the dossier.
   ============================================================ */
describe("case attrs", () => {
  it("serializes sheet state the Case needs", () => {
    const attrs = renderCardAttrs({
      priority: "⚡",
      favorite: true,
      logoUrl: "https://logo.test/m.png",
      matchScore: 74,
      responseFlag: "No",
      lastHeardFrom: "Aug 30",
      followUpDate: "2026-09-04",
      _postingEnrichment: { requirements: ["5+ years"], skills: ["React"], method: "ats-api" },
    });
    assert.equal(attrs["data-priority"], "high");
    assert.equal(attrs["data-favorite"], "yes");
    assert.equal(attrs["data-logo-url"], "https://logo.test/m.png");
    assert.equal(attrs["data-match-score"], "74");
    assert.equal(attrs["data-reply-flag"], "No");
    assert.deepEqual(JSON.parse(attrs["data-requirements"]), ["5+ years"]);
    assert.deepEqual(JSON.parse(attrs["data-skills"]), ["React"]);
    assert.equal(attrs["data-scrape-method"], "ats-api");
  });

  it("maps priority glyphs to words and omits empties", () => {
    assert.equal(renderCardAttrs({ priority: "🔥" })["data-priority"], "high");
    assert.equal(renderCardAttrs({ priority: "↓" })["data-priority"], "low");
    assert.equal(renderCardAttrs({ priority: "—" })["data-priority"], "normal");
    assert.equal(renderCardAttrs({})["data-priority"], "");
  });

  it("omits favorite, logo and match score when the sheet has none", () => {
    const attrs = renderCardAttrs({});
    assert.equal(attrs["data-favorite"], "");
    assert.equal(attrs["data-logo-url"], "");
    assert.equal(attrs["data-match-score"], "");
    assert.equal(attrs["data-reply-flag"], "");
    assert.equal(attrs["data-requirements"], "");
    assert.equal(attrs["data-skills"], "");
    assert.equal(attrs["data-scrape-method"], "");
  });

  it("emits a zero match score rather than swallowing it as empty", () => {
    assert.equal(renderCardAttrs({ matchScore: 0 })["data-match-score"], "0");
  });

  it("falls back to the scrape provider when no method is recorded", () => {
    const attrs = renderCardAttrs({
      _postingEnrichment: { scraping: { provider: "gemini-url-context" } },
    });
    assert.equal(attrs["data-scrape-method"], "gemini-url-context");
  });

  it("serializes posting facts and clips the posted salary to 80 characters", () => {
    const attrs = renderCardAttrs({
      _postingEnrichment: {
        postedAt: "2026-08-27",
        closesAt: "2026-09-30",
        postingSalary:
          "$185,000–$230,000 USD/yr plus a discretionary performance bonus and annual equity refresh grant",
      },
    });

    assert.equal(attrs["data-posted-at"], "2026-08-27");
    assert.equal(attrs["data-closes-at"], "2026-09-30");
    assert.match(attrs["data-posting-salary"], /^\$185,000–\$230,000 USD\/yr/);
    assert.ok(attrs["data-posting-salary"].length <= 80);
    assert.ok(attrs["data-posting-salary"].endsWith("…"));
  });

  it("leaves every pre-existing attribute name and budget untouched", () => {
    const attrs = renderCardAttrs({
      location: "Remote",
      salary: "$180k",
      tags: "Go, K8s",
      responseFlag: "No",
      lastHeardFrom: "Aug 30",
    });
    assert.equal(attrs["data-location"], "Remote");
    assert.equal(attrs["data-salary"], "$180k");
    assert.equal(attrs["data-tags"], "Go, K8s");
    assert.equal(attrs["data-replied"], "No");
    assert.equal(attrs["data-last-contact"], "Aug 30");
  });
});
