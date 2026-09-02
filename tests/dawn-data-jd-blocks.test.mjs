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
