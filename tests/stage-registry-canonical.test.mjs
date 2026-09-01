/* PIPE-02 — one stage vocabulary.
   Six divergent stage lists shipped simultaneously: pipeline.js dropped
   Rejected and Passed entirely and relabelled Expired as "Dismissed";
   dawn-data.js's getPipelineViewModel silently discarded rejected/passed
   cards; pipeline-render.js carried three separate copies of the list.
   This test pins every remaining list to the schema enum, so a stage can
   never again exist on one surface and not another.

   Not asserted here, by fence: flowing-writes.js STAGE_LABELS (still 7
   entries, so stageLabel("rejected") returns null and a Rejected move
   cannot write). flowing-writes.js is integrator-owned for T0; lane P0-A
   hands the hunk as an integration note instead of editing it. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const schema = JSON.parse(read("schemas/pipeline-row.v1.json"));
const SCHEMA_STATUSES = schema.columns.find((c) => c.id === "status").enum;
const SCHEMA_KEYS = SCHEMA_STATUSES.map((s) => s.toLowerCase().replace(/\s+/g, "-"));

/* Every consumer declares the same four-line mirror so that a missing
   stage-registry.js script tag degrades to the canonical list instead of a
   private one. The mirrors are pinned here; the runtime source is the
   registry. */
const CONSUMERS = [
  "stage-registry.js",
  "pipeline.js",
  "pipeline-render.js",
  "pipeline-controller.js",
  "dawn-data.js",
  "lattice.js",
];

function extractStagePairs(src, rel) {
  const decl = rel === "stage-registry.js" ? "ROWS" : "STAGE_FALLBACK";
  const m = new RegExp(`(?:var|const|let) ${decl} = \\[([\\s\\S]*?)\\n\\s*\\];`).exec(src);
  assert.ok(m, `${rel} should declare ${decl} as the canonical stage mirror`);
  const pairs = [...m[1].matchAll(/\["([a-z-]+)",\s*"([^"]+)"/g)].map((p) => [p[1], p[2]]);
  assert.ok(pairs.length > 0, `${rel}: ${decl} should list [key, label] pairs`);
  return pairs;
}

/** Comments legitimately mention stage labels; only code counts as a list. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function loadRegistry() {
  const ctx = { window: {} };
  vm.runInNewContext(read("stage-registry.js"), { ...ctx, Object, String, Array });
  return ctx.window.JobBoredStages;
}

describe("Canonical stage registry (PIPE-02)", () => {
  it("mirrors the schema status enum exactly, in order", () => {
    const registry = loadRegistry();
    assert.deepEqual([...registry.STATUSES], SCHEMA_STATUSES);
    assert.deepEqual([...registry.KEYS], SCHEMA_KEYS);
    assert.equal(registry.KEYS.length, 9);
  });

  it("round-trips every schema status through toKey/toLabel", () => {
    const registry = loadRegistry();
    for (const status of SCHEMA_STATUSES) {
      const key = registry.toKey(status);
      assert.ok(key, `toKey(${JSON.stringify(status)}) should resolve`);
      assert.equal(registry.toLabel(key), status);
      assert.equal(registry.toLabel(status), status);
      assert.ok(registry.orderOf(key) >= 0);
      assert.ok(registry.toDotKey(key), `every stage needs a jb-stage-dot token`);
    }
  });

  it("returns null for unknown input instead of defaulting to a real stage", () => {
    const registry = loadRegistry();
    assert.equal(registry.toKey(""), null);
    assert.equal(registry.toKey(null), null);
    assert.equal(registry.toKey("Ghosted"), null);
    assert.equal(registry.toLabel("Ghosted"), null);
    assert.equal(registry.orderOf("Ghosted"), -1);
  });

  it("separates closed outcomes from archived columns", () => {
    const registry = loadRegistry();
    // Rejected/Passed are outcomes the candidate reached; Expired is a fact
    // about the posting. lattice hides the first pair, boards collapse all three.
    assert.deepEqual([...registry.CLOSED_KEYS], ["rejected", "passed"]);
    assert.deepEqual([...registry.ARCHIVE_KEYS], ["rejected", "passed", "expired"]);
    assert.equal(registry.isClosed("Expired"), false);
    assert.equal(registry.isArchived("Expired"), true);
  });

  for (const rel of CONSUMERS) {
    it(`${rel} carries the canonical nine stages and no private list`, () => {
      const src = read(rel);
      const pairs = extractStagePairs(src, rel);
      assert.deepEqual(pairs.map((p) => p[0]), SCHEMA_KEYS, `${rel} stage keys`);
      assert.deepEqual(pairs.map((p) => p[1]), SCHEMA_STATUSES, `${rel} stage labels`);
      // One list per file: "Phone Screen" is the tell for a stage array, and
      // pipeline-render.js used to carry three of them.
      const bare = stripComments(src);
      const copies = bare.split('"Phone Screen"').length - 1;
      assert.equal(
        copies,
        1,
        `${rel} should hold exactly one stage list literal (found ${copies}): ` +
          bare.split("\n").filter((l) => l.includes('"Phone Screen"')).join(" | "),
      );
    });
  }

  for (const rel of CONSUMERS.slice(1)) {
    it(`${rel} resolves stages through window.JobBoredStages at runtime`, () => {
      const src = read(rel);
      assert.ok(
        /JobBoredStages/.test(src),
        `${rel} should read the shared registry, keeping its literal as a fallback only`,
      );
    });
  }

  it("keeps rejected and passed rows in the pipeline view-model", () => {
    // dawn-data.js used to build byStage from a six-stage list and `continue`
    // past anything missing, so Rejected/Passed cards vanished from every v2
    // board that reads getPipelineViewModel.
    const cards = [
      makeCard({ key: "R1", index: 1, stage: "rejected", title: "Rejected role", company: "Acme", fit: 8 }),
      makeCard({ key: "P1", index: 2, stage: "passed", title: "Passed role", company: "Bravo", fit: 6 }),
      makeCard({ key: "A1", index: 3, stage: "applied", title: "Applied role", company: "Delta", fit: 7 }),
    ];
    const api = loadDawnData(makeDoc(cards));
    const model = api.getPipelineViewModel({ doc: makeDoc(cards), nowMs: Date.parse("2026-05-20T12:00:00Z") });

    const stageKeys = Array.from(model.stages, (s) => s.key);
    assert.deepEqual(stageKeys, SCHEMA_KEYS, "the VM should expose all nine stages");

    const seen = new Set();
    for (const stage of model.stages) for (const c of stage.cards) seen.add(c.jobKey);
    assert.ok(seen.has("R1"), "a Rejected card must survive into the view-model");
    assert.ok(seen.has("P1"), "a Passed card must survive into the view-model");
    assert.ok(seen.has("A1"));
  });
});

/* --- dawn-data vm harness (tests/dawn-data-lead-stories.test.mjs idiom) --- */

function textElement(text) {
  return { textContent: String(text || "") };
}

function makeCard(opts) {
  const attrs = {
    "data-stable-key": opts.key,
    "data-index": opts.index != null ? String(opts.index) : null,
    "data-fit": opts.fit != null ? String(opts.fit) : null,
  };
  return {
    className: `kanban-card kanban-card--stage-${opts.stage}`,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    querySelector(selector) {
      if (selector === ".kanban-card__title") return textElement(opts.title);
      if (selector === ".kanban-card__company") return textElement(opts.company);
      return null;
    },
  };
}

function makeDoc(cards) {
  return {
    implementation: null,
    getElementById: () => null,
    querySelectorAll(selector) {
      return selector === ".kanban-card[data-stable-key]" ? cards : [];
    },
  };
}

function loadDawnData(doc) {
  const win = {};
  vm.runInNewContext(read("dawn-data.js"), {
    window: win,
    document: doc,
    Date,
    Number,
    Object,
    String,
    Array,
    parseInt,
    console,
  });
  return win.JobBoredDawn.data;
}
