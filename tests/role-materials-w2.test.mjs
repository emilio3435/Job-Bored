/**
 * role-materials.js rows with materials-insights.js loaded, as index.html
 * loads them (Wave 2): the verdict pill + scorecard (U-1), the Download
 * menu and FAIL gate (U-3), the timeline (U-4), next-in-line (U-5) and the
 * Versions entry (U-6). Same vm harness as role-materials.test.mjs.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "role-materials.js"), "utf8");
const insightsSource = readFileSync(join(repoRoot, "materials-insights.js"), "utf8");
const scoreSource = readFileSync(join(repoRoot, "materials-score.js"), "utf8");
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
  const documentEl = makeDocument();
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
  vm.runInContext(insightsSource, ctx, { filename: "materials-insights.js" });
  vm.runInContext(scoreSource, ctx, { filename: "materials-score.js" });
  vm.runInContext(source, ctx, { filename: "role-materials.js" });
  api = windowEl.JobBoredRoleMaterials;
  if (!api) throw new Error("role-materials.js did not expose JobBoredRoleMaterials");
});


const FILE = (name, t = "2026-09-27T09:00:00.000Z") => ({ filename: name, format: name.split(".").pop(), size: 1000, modifiedAt: t });

function manifest(extra = {}) {
  return {
    slug: "northwindmedia-director-digital-sales",
    company: "NorthwindMedia",
    title: "Director, Digital Sales",
    runId: "mr_20260927_northwind_086c",
    documents: [
      {
        type: "resume", label: "Tailored Resume", status: "ready", primary: "resume.pdf",
        lastModifiedAt: "2026-09-27T09:00:00.000Z",
        files: [FILE("resume.pdf"), FILE("resume.html")],
        text: FILE("resume.txt"),
        exports: { docx: true, linkedin: true },
      },
      {
        type: "cover_letter", label: "Cover Letter", status: "ready", primary: "cover-letter.pdf",
        lastModifiedAt: "2026-09-27T09:00:00.000Z",
        files: [FILE("cover-letter.pdf"), FILE("cover-letter.html")],
        text: FILE("cover-letter.txt"),
        exports: { docx: true, linkedin: false },
      },
    ],
    quality: {
      documents: {
        resume: {
          status: "fail",
          issues: [{ code: "resume_experience_missing", message: "Resume is missing an experience section.", severity: "fail" }],
          qa: {
            disposition: "FAIL", dispositionReason: "Resume is missing an experience section.",
            degraded: ["jd.extract: deterministic half (output cut off at 1000 tokens (MAX_TOKENS) after 2 attempts)"],
            rubric: { score: 6, max: 12, threshold: 10, rows: [{ id: "outcome_coverage", score: 0, max: 2, note: "0/3 outcomes" }] },
          },
        },
        cover_letter: {
          status: "review",
          issues: [{ code: "metric_in_letter", message: "No traced metric in the letter.", severity: "review" }],
          qa: {
            disposition: "REVIEW", dispositionReason: "No traced metric in the letter.", degraded: [],
            rubric: { score: 9, max: 12, threshold: 10, rows: [{ id: "metric_in_letter", score: 0, max: 2, note: "no metric" }] },
          },
        },
      },
    },
    ...extra,
  };
}

function render(m) {
  const host = makeElement("div", { "data-mount": "materials" });
  api.renderManifest(host, m, "http://127.0.0.1:3847");
  return (host.children[0] && host.children[0].innerHTML) || "";
}

function row(html, type) {
  const start = html.indexOf('data-doc="' + type + '"');
  assert.ok(start >= 0, "row " + type + " rendered");
  const next = html.indexOf('<div class="case__doc ', start + 10);
  return html.slice(start, next < 0 ? undefined : next);
}

describe("W2 · rows with a pipeline verdict", () => {
  /* HOLES SCORE (spec §0.3): the row shows the grade button and nothing
     of the scorecard; the why and the fix moved to the score modal
     (tests/holes-score-dossier.test.mjs). */
  /* GRADE D7: the button is the verdict word and its first reason. */
  it("should show the FAIL verdict as a verdict button and keep the scorecard out of the row", () => {
    const r = row(render(manifest()), "resume");
    assert.match(r, /data-qa="fail"/);
    assert.match(r, /class="jb-grade"[^>]*data-score-open data-feature="resume"[^>]*aria-label="Resume: Fails — [^"]+\. Open the quality check\."/);
    assert.doesNotMatch(r, /of 100|Grade [A-F]/);
    /* Grok review: the pill says the document's own state, not the verdict. */
    assert.match(r, /case__docst--ready" data-status="review">ready</);
    assert.doesNotMatch(r, /6 \/ 12|failed its quality check|fell back to rules|Review your details/);
    assert.equal((r.match(/data-action="materials-repair"/g) || []).length, 0);
  });

  /* GRADE G7: a FAIL root is held; every entry asks first, with the reason. */
  it("should gate every Download entry of a FAIL draft as held, and none of a REVIEW draft", () => {
    const html = render(manifest());
    const resume = row(html, "resume");
    const letter = row(html, "cover_letter");
    assert.match(resume, /data-action="materials-download-menu"/);
    assert.equal((resume.match(/data-gate="held" data-held="[^"]+"/g) || []).length, 4, "PDF, text, Word and LinkedIn copy");
    assert.match(resume, /\/files\/resume\.txt\?download=1/);
    assert.match(resume, /\/export\/resume\.docx\?download=1/);
    assert.doesNotMatch(letter, /data-gate/);
    assert.match(letter, /case__docst--ready" data-status="review">ready</);
    assert.doesNotMatch(letter, /LinkedIn/);
  });

  it("should offer Versions on a drafted document", () => {
    const r = row(render(manifest()), "resume");
    assert.match(r, /data-action="materials-history" data-feature="resume" aria-expanded="false">Versions</);
  });

  it("should offer Draft both while nothing is in flight", () => {
    assert.match(render(manifest()), /data-action="materials-draft-both">Draft both</);
  });
});

describe("MREV D1 · rows with a judge verdict (materials.qa.v2)", () => {
  it("should show the v2 verdict as one verdict button, with no score and no inline scorecard", async () => {
    const { V2_LETTER_FAIL } = await import("./fixtures/materials-qa-v2.mjs");
    const base = manifest();
    const html = render({ ...base, quality: { documents: { ...base.quality.documents, cover_letter: V2_LETTER_FAIL } } });
    const r = row(html, "cover_letter");
    assert.match(r, /class="jb-grade"[^>]*data-feature="cover_letter"[^>]*aria-label="Cover letter: Fails — 1 claim needs a source\. Open the quality check\."/);
    /* Grok review: the pill says the document's own state, not the verdict. */
    assert.match(r, /case__docst--ready" data-status="review">ready</);
    assert.doesNotMatch(r, /data-qa-contract|Factual blockers|64 \/ 100/);
    assert.equal((r.match(/data-action="materials-repair"/g) || []).length, 0, "Repair lives in the modal");
    /* A v2 FAIL still gates Download. */
    assert.equal((r.match(/data-gate="held"/g) || []).length, 3, "PDF, text and Word");
  });
});

describe("W2 · drafting rows", () => {
  const pending = (progress, extra = {}) => manifest({
    documents: [],
    quality: undefined,
    pending: { feature: "resume", company: "NorthwindMedia", title: "Director", requestedAt: "2026-09-27T09:00:00.000Z", progress, ...extra },
  });

  it("should show the named steps, not the raw stage strings", () => {
    const html = render(pending({
      phase: "drafting", message: "Picking the facts that fit this job…", startedAt: "2026-09-27T09:00:00.000Z", attempt: 1,
      stages: [{ stage: "intake", status: "ok" }, { stage: "jd.resolve", status: "ok" }, { stage: "jd.gate", status: "ok" },
        { stage: "claims.load", status: "ok" }, { stage: "cache.lookup", status: "ok" },
        { stage: "jd.extract", status: "review", reason: "fell back to rules: output cut off at 1000 tokens" }],
    }));
    const r = row(html, "resume");
    assert.match(r, /<ol class="mat-tl" aria-label="Drafting steps">/);
    assert.match(r, /data-step="read" data-state="degraded"/);
    assert.match(r, /data-step="pick" data-state="running" aria-current="step"/);
    assert.doesNotMatch(html, /jd\.extract|claims\.select|: running/);
    assert.doesNotMatch(html, /Draft both/, "no second request while one is in flight");
  });

  it("should show the letter as next in line behind the resume (Draft both)", () => {
    const html = render(pending({ phase: "drafting", startedAt: "2026-09-27T09:00:00.000Z", stages: [] }, { next: "cover_letter" }));
    const letter = row(html, "cover_letter");
    assert.match(letter, /case__docst--queued" data-status="drafting">next</);
    assert.match(letter, /next in line/);
    assert.match(letter, /Drafts after the resume finishes, with its own quality check\./);
  });
});

describe("W2 · Wave 3 fields on the rows", () => {
  it("should render no outreach row, facts or errors when the fields are absent", () => {
    const html = render(manifest());
    assert.doesNotMatch(html, /data-doc="outreach_note"/);
    assert.doesNotMatch(html, /mat-intel/);
    assert.match(html, /data-materials-outreach/, "the Include outreach note option is offered");
    assert.match(html, /Include outreach note/);
  });

  it("should add an Outreach note row with its QA pill when manifest.outreach is present", async () => {
    const { W3_MANIFEST_EXTRA } = await import("./fixtures/materials-w3-package.mjs");
    const html = render(manifest(W3_MANIFEST_EXTRA));
    const r = row(html, "outreach_note");
    assert.match(r, /Outreach note/);
    assert.match(r, /case__docst--qa-review" data-outreach-qa="review">review</);
    assert.match(r, /LinkedIn note \+ email/);
  });

  it("should hide the option while a draft is running", () => {
    const html = render(manifest({ documents: [], quality: undefined, pending: { feature: "cover_letter", requestedAt: "2026-09-27T09:00:00.000Z", progress: { phase: "drafting", stages: [] } } }));
    assert.doesNotMatch(html, /data-materials-outreach/);
  });
});
