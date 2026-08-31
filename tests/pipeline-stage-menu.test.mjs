/* MOBILE-01 (re-hosted) — the explicit "Move to stage" control lives on the
   PIPELINE board.

   T0 attached JobBoredA11y.stageMenu in lattice.js:829. F2-A makes lattice the
   losing renderer: init() unmounts and never paints. Porting the a11y primitive
   without re-hosting it would leave the only keyboard/touch stage-move path in
   the app attached to a board that never renders — a capability that is present
   in the source tree, passes its own unit test, and is unreachable by any user.

   The rules pinned here:
     - the menu is attached to the pipeline sticker card, after the card's
       innerHTML assignment (an attach before it is erased by the assignment);
     - the stages offered are the board's own columns, from the canonical
       registry — never a private list;
     - commitMove routes through JobBoredPipelineTransitionAdapter.move, the
       single board-move choke point, and never writes a cell itself;
     - a card whose move the adapter rejects reports false so the menu reverts
       its label instead of lying about where the row is;
     - with jb-a11y.js absent the board renders exactly as before. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const pipelineJs = read("pipeline.js");

/* ------------------------------------------------------------------ *
 * A DOM stub just wide enough for StickerCard + optimisticMove.       *
 * ------------------------------------------------------------------ */

class StubEl {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.classList = new Set();
    this._html = "";
  }
  get className() {
    return [...this.classList].join(" ");
  }
  set className(v) {
    this.classList = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(v) {
    // The real assignment destroys every child node; that is exactly the
    // ordering hazard this suite exists to catch.
    this._html = String(v);
    for (const c of this.children) c.parentNode = null;
    this.children = [];
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
  }
  hasAttribute(k) {
    return Object.prototype.hasOwnProperty.call(this.attrs, k);
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  addEventListener() {}
  contains() {
    return true;
  }
  closest() {
    return null;
  }
}

/* Source instrumentation, the idiom tests/pipeline-recently-moved-pin.test.mjs
   established: expose the internal on a test-only global rather than widening
   pipeline.js's production surface for a test. */
function loadPipeline({ a11y, adapter } = {}) {
  const marker = "  function emptyPlaceholderHtml(stageKey) {";
  const instrumented = pipelineJs.replace(
    marker,
    "  root.__pipelineTest = { StickerCard: StickerCard };\n\n" + marker,
  );
  assert.notEqual(instrumented, pipelineJs, "marker moved");

  const root = {};
  const doc = {
    readyState: "loading",
    createElement: (tag) => new StubEl(tag),
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    body: null,
  };
  root.document = doc;
  root.JobBoredA11y = a11y;
  root.JobBoredPipelineTransitionAdapter = adapter;
  vm.runInNewContext(read("stage-registry.js"), {
    window: root,
    document: doc,
    Object,
    String,
    Array,
  });
  vm.runInNewContext(
    instrumented,
    {
      window: root,
      document: doc,
      console,
      Promise,
      Date,
      Number,
      String,
      Object,
      Array,
      Math,
      JSON,
      setTimeout,
      clearTimeout,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
    },
    { filename: "pipeline.js" },
  );
  return { root, doc };
}

/** Capture what pipeline.js hands to JobBoredA11y.stageMenu.attach. */
function captureAttach() {
  const calls = [];
  return {
    calls,
    a11y: {
      stageMenu: {
        attach(cardEl, opts) {
          calls.push({ cardEl, opts });
          const marker = new StubEl("div");
          marker.className = "jb-a11y-stage-menu";
          cardEl.appendChild(marker);
          return function detach() {};
        },
      },
    },
  };
}

const CARD = { jobKey: "K1", role: "Staff Engineer", company: "Acme", fitScore: 7 };

function buildCard(loaded, stage = "researching") {
  return loaded.root.__pipelineTest.StickerCard(CARD, { stage });
}

describe("MOBILE-01: the stage menu is hosted on the pipeline board", () => {
  it("attaches the a11y stage menu to every sticker card", () => {
    const { calls, a11y } = captureAttach();
    const loaded = loadPipeline({ a11y, adapter: { move: () => Promise.resolve({ ok: true }) } });
    buildCard(loaded);

    assert.equal(calls.length, 1, "each card gets exactly one stage menu");
    assert.equal(
      calls[0].opts.current,
      "researching",
      "the menu must know the stage the card is actually in",
    );
    assert.equal(calls[0].opts.jobKey, "K1");
  });

  it("survives the card innerHTML assignment", () => {
    // The whole reason lattice's version could be ported wrong: StickerCard
    // assigns innerHTML, which erases every child appended before it.
    const { calls, a11y } = captureAttach();
    const loaded = loadPipeline({ a11y, adapter: { move: () => Promise.resolve({ ok: true }) } });
    const el = buildCard(loaded);

    assert.ok(
      el.children.some((c) => c.classList.has("jb-a11y-stage-menu")),
      "the menu must be appended AFTER innerHTML, or the card body deletes it",
    );
    assert.equal(calls[0].cardEl, el, "the menu is hosted on the card itself");
  });

  it("offers the board's own columns from the canonical registry", () => {
    const { calls, a11y } = captureAttach();
    const loaded = loadPipeline({ a11y, adapter: { move: () => Promise.resolve({ ok: true }) } });
    buildCard(loaded);

    const keys = calls[0].opts.stages.map((s) => s.key);
    assert.deepEqual(
      keys,
      loaded.root.JobBoredStages.KEYS,
      "the menu must offer exactly the nine registry stages the board renders",
    );
    const labels = Object.fromEntries(calls[0].opts.stages.map((s) => [s.key, s.label]));
    assert.equal(labels["new"], "Discovered", "the menu should read like the column heading");
    assert.equal(
      labels["expired"],
      "Expired",
      "and must never call the Expired column Dismissed — that is a different write",
    );
  });

  it("commits a move through the transition adapter, never with its own write", () => {
    const moves = [];
    const { calls, a11y } = captureAttach();
    const loaded = loadPipeline({
      a11y,
      adapter: {
        move(payload) {
          moves.push(payload);
          return Promise.resolve({ ok: true, handled: true });
        },
      },
    });
    buildCard(loaded);

    return calls[0].opts
      .commitMove("K1", "interviewing", "researching")
      .then((ok) => {
        assert.equal(ok, true, "a successful move must report true so the menu keeps the new label");
        assert.equal(moves.length, 1, "exactly one board-move call per menu commit");
        assert.equal(moves[0].jobKey, "K1");
        assert.equal(moves[0].fromStage, "researching");
        assert.equal(moves[0].toStage, "interviewing");
      });
  });

  it("reports false when the adapter refuses the move", () => {
    const { calls, a11y } = captureAttach();
    const loaded = loadPipeline({
      a11y,
      adapter: {
        move: () => Promise.resolve({ ok: false, handled: true, code: "unknown_stage" }),
      },
    });
    buildCard(loaded);

    return calls[0].opts.commitMove("K1", "ghosted", "researching").then((ok) => {
      assert.equal(
        ok,
        false,
        "the menu reverts its label on false; reporting true would leave the card " +
          "claiming a stage the Sheet never received",
      );
    });
  });

  it("renders the card unchanged when jb-a11y.js is not in the page", () => {
    const loaded = loadPipeline({ a11y: undefined, adapter: { move: () => Promise.resolve({ ok: true }) } });
    const el = buildCard(loaded);
    assert.ok(el, "no a11y primitive must never mean no card");
    assert.equal(
      el.children.some((c) => c.classList.has("jb-a11y-stage-menu")),
      false,
    );
  });

  it("keeps the menu source-visible as a >=44px touch target contract", () => {
    // The primitive supplies .jb-a11y-touch-target; the board must not opt out
    // of it by hand-rolling its own trigger.
    assert.equal(
      /jb-a11y-stage-menu__trigger/.test(pipelineJs),
      false,
      "pipeline.js must use JobBoredA11y.stageMenu.attach, not rebuild the control",
    );
    assert.match(
      pipelineJs,
      /stageMenu[\s\S]{0,200}\.attach\s*\(/,
      "pipeline.js must call JobBoredA11y.stageMenu.attach",
    );
  });
});
