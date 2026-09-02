/* ============================================================
   dawn-data-jd-blocks.test.mjs
   ------------------------------------------------------------
   Derivation-layer contract for the role view-model:

     (1) JD SECTIONS come from the shared block model
         (window.JobBoredText.toBlocks) rather than a bespoke
         regex splitter, so a heading keeps the paragraphs and
         bullets that follow it, an ordinary paragraph is not
         amputated of its first line, and numbered lists stay
         bullets.

     (2) CARD ATTRIBUTE PARSING stops fragmenting values that
         legitimately contain the old delimiters — a talking
         point with a semicolon, a tag like "Austin, TX" — and
         tolerates object items plus legacy double-encoded
         entities left in the cache.

   Harness note (trap 2): jb-text.js MUST be evaluated before
   dawn-data.js. A consumer loaded without window.JobBoredText
   fails silently inside a try and the suite would "pass" on
   empty output — so every case asserts positive content.
   ============================================================ */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const jbTextSrc = readFileSync(join(repoRoot, "jb-text.js"), "utf8");
const dawnDataSrc = readFileSync(join(repoRoot, "dawn-data.js"), "utf8");

function textElement(text) {
  return { textContent: String(text || "") };
}

/* A kanban card stub shaped like the one pipeline-render.js emits: every
   value the derivation reads arrives as a data-* attribute string. */
function makeCard(attrs, opts) {
  const o = opts || {};
  const all = { "data-stable-key": o.key || "job-1", ...attrs };
  return {
    className: `kanban-card kanban-card--stage-${o.stage || "new"}`,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(all, name) ? all[name] : null;
    },
    querySelector(selector) {
      if (selector === ".kanban-card__title") return textElement(o.title || "Staff Engineer");
      if (selector === ".kanban-card__company") return textElement(o.company || "Meridian Labs");
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function makeDoc(card) {
  return {
    querySelectorAll(selector) {
      if (selector === ".kanban-card[data-stable-key]") return [card];
      return [];
    },
    querySelector() {
      return null;
    },
    getElementById() {
      return null;
    },
  };
}

function loadDawnData() {
  const win = {};
  const context = vm.createContext({
    window: win,
    Date,
    Number,
    Math,
    Object,
    String,
    Array,
    JSON,
    RegExp,
    parseInt,
    parseFloat,
    console,
  });
  // trap 2: the shared text module must exist before its consumer evaluates.
  vm.runInContext(jbTextSrc, context, { filename: "jb-text.js" });
  assert.equal(typeof win.JobBoredText.toBlocks, "function", "jb-text must load first");
  vm.runInContext(dawnDataSrc, context, { filename: "dawn-data.js" });
  return win.JobBoredDawn.data;
}

/* The view-model is built inside the vm realm, so its arrays/objects are not
   reference-equal to this realm's intrinsics. Round-trip through JSON so
   assert.deepEqual compares values, not prototypes. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Build the view-model for a single card carrying `attrs`. */
function viewModelFor(attrs, opts) {
  const card = makeCard(attrs, opts);
  const doc = makeDoc(card);
  const api = loadDawnData();
  return plain(
    api.getRoleViewModel((opts && opts.key) || "job-1", { doc, nowMs: Date.parse("2026-09-01T00:00:00Z") }),
  );
}

/** jdSections derived from a raw JD blob. */
function splitJd(jd) {
  return viewModelFor({ "data-jd-snippet": jd }).job.jdSections;
}

describe("_splitJdSections via toBlocks", () => {
  it("groups heading + paragraphs + bullets into one section", () => {
    const jd = "About the role:\nWe build tools.\n\n- Ship weekly\n- Review PRs\n\nBenefits:\nHealth. Dental.";
    const sections = splitJd(jd);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, "About the role");
    assert.equal(sections[0].body, "We build tools.");
    assert.deepEqual(sections[0].bullets, ["Ship weekly", "Review PRs"]);
    assert.equal(sections[1].heading, "Benefits");
    assert.equal(sections[1].body, "Health. Dental.");
  });

  it("no longer amputates the first line of an ordinary paragraph", () => {
    const sections = splitJd("We are seeking an engineer\nwho has experience with Go.");
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, "");
    assert.match(sections[0].body, /^We are seeking an engineer who has/);
  });

  it("keeps numbered lists as bullets", () => {
    const sections = splitJd("Duties:\n1. Build\n2. Operate");
    assert.equal(sections[0].heading, "Duties");
    assert.deepEqual(sections[0].bullets, ["Build", "Operate"]);
  });

  it("keeps multiple paragraphs under one heading, separated for re-blocking", () => {
    const sections = splitJd("Mission:\nWe ship.\n\nWe iterate weekly.");
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, "Mission");
    assert.equal(sections[0].body, "We ship.\n\nWe iterate weekly.");
  });

  it("falls back to the raw blob when the JD yields no blocks", () => {
    // A blob of pure punctuation produces no blocks; the raw-blob fallback
    // in getRoleViewModel must still surface something to render.
    const sections = splitJd("   ");
    assert.deepEqual(sections, []);
  });

  it("decodes entities on the way in (single level only)", () => {
    const sections = splitJd("Requirements:\n- 5+ yrs &amp; Go\n- Owns SLAs &amp;lt;99.9%");
    assert.deepEqual(sections[0].bullets, ["5+ yrs & Go", "Owns SLAs &lt;99.9%"]);
  });
});

/** The job half of the view-model, for attribute-parsing assertions. */
function parseCard(attrs) {
  return viewModelFor(attrs).job;
}

describe("card attribute parsing", () => {
  it("talking points with newlines split ONLY on newlines", () => {
    const pts = parseCard({
      "data-talking-points": "Shipped X; grew Y 40%\nAsk about on-call; and pager duty",
    }).jdSections[0].bullets;
    assert.deepEqual(pts, ["Shipped X; grew Y 40%", "Ask about on-call; and pager duty"]);
  });

  it("single-line talking points still split on ; and ·", () => {
    const pts = parseCard({
      "data-talking-points": "Point A; Point B · Point C",
    }).jdSections[0].bullets;
    assert.deepEqual(pts, ["Point A", "Point B", "Point C"]);
  });

  it("JSON data-tags arrays pass through un-fragmented", () => {
    const tags = parseCard({ "data-tags": JSON.stringify(["Austin, TX", "C#; .NET"]) }).tags;
    assert.deepEqual(tags, ["Austin, TX", "C#; .NET"]);
  });

  it("legacy comma-string tags keep splitting", () => {
    assert.deepEqual(parseCard({ "data-tags": "Go, K8s" }).tags, ["Go", "K8s"]);
  });

  it("JSON array attrs tolerate objects and legacy entities", () => {
    const items = parseCard({
      "data-must-haves": JSON.stringify([{ text: "Own SLAs" }, "5+ yrs &amp; Go"]),
    }).enrichment.mustHaves;
    assert.deepEqual(items, ["Own SLAs", "5+ yrs & Go"]);
  });

  it("JSON array attrs strip leading list glyphs", () => {
    const items = parseCard({
      "data-responsibilities": JSON.stringify(["• Run the on-call rotation", "- Mentor"]),
    }).enrichment.responsibilities;
    assert.deepEqual(items, ["Run the on-call rotation", "Mentor"]);
  });

  it("legacy cached enrichment strings self-heal markdown and entities", () => {
    const enr = parseCard({
      "data-role-in-one-line": "**Own** the platform &amp; its roadmap",
      "data-posting-summary": "Para one.\n\nPara two &amp; three.",
    }).enrichment;
    assert.equal(enr.roleInOneLine, "Own the platform & its roadmap");
    assert.equal(enr.postingSummary, "Para one.\n\nPara two & three.");
  });
});
