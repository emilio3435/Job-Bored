/**
 * F2A-MOVE: board movement calls the F1-A transition adapter.
 * Until F1-A lands, the adapter mocks applyTransition and still
 * emits jb:pipeline:move so flowing-writes keeps working.
 *
 * Production change that would make this fail: pipeline.js dropping
 * a card without going through JobBoredPipelineTransitionAdapter, or
 * the adapter ignoring a live F1-A writer.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const adapterPath = join(repoRoot, "pipeline-transition-adapter.js");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");
const latticeJs = readFileSync(join(repoRoot, "lattice.js"), "utf8");

function loadAdapter({ transitions, events } = {}) {
  assert.equal(
    existsSync(adapterPath),
    true,
    "F2A-MOVE: pipeline-transition-adapter.js must exist so board moves can call F1-A (mocked until it lands)",
  );
  const dispatched = events || [];
  const document = {
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    },
  };
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const window = {
    document,
    JobBoredPipelineTransitions: transitions,
  };
  vm.runInNewContext(readFileSync(adapterPath, "utf8"), {
    window,
    document,
    CustomEvent,
    console,
    Promise,
  });
  assert.ok(
    window.JobBoredPipelineTransitionAdapter,
    "F2A-MOVE: helper must expose window.JobBoredPipelineTransitionAdapter",
  );
  return { adapter: window.JobBoredPipelineTransitionAdapter, dispatched, window };
}

describe("F2A-MOVE: board movement calls F1-A adapter", () => {
  it("pipeline.js drop path calls the transition adapter", () => {
    assert.match(
      pipelineJs,
      /JobBoredPipelineTransitionAdapter/,
      "F2A-MOVE: pipeline.js must route board movement through JobBoredPipelineTransitionAdapter",
    );
    assert.match(
      pipelineJs,
      /(?:adapter|JobBoredPipelineTransitionAdapter)[\s\S]{0,180}\.move\s*\(/,
      "F2A-MOVE: pipeline.js must call adapter.move(...) on a board move",
    );
  });

  it("lattice.js, if it still writes stages, also routes through the adapter", () => {
    // Lattice is the losing renderer; any leftover setStage path still
    // must not bypass F1-A once the adapter exists.
    assert.match(
      latticeJs,
      /JobBoredPipelineTransitionAdapter/,
      "F2A-MOVE: lattice.js leftover writes must call the same adapter, not only window.updateJobStatus",
    );
  });

  it("prefers F1-A applyTransition when the writer is present", async () => {
    const seen = [];
    const { adapter } = loadAdapter({
      transitions: {
        applyTransition(payload) {
          seen.push(payload);
          return { ok: true, mocked: false, payload };
        },
      },
    });
    const payload = { jobKey: "K1", fromStage: "new", toStage: "researching", source: "pipeline-board" };
    const result = await adapter.move(payload);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].jobKey, "K1");
    assert.equal(seen[0].toStage, "researching");
    assert.equal(result.mocked, false);
    assert.equal(result.ok, true);
  });

  /* F2A-MOVE-REPAIR: the adapter used to call applyTransition(payload) with a
     single argument. The real F1-A signature is applyTransition(input, patchApi),
     so every live board drop failed missing_row / missing_patch_api, the failure
     result was never read, and the jb:pipeline:move fallback never fired: the
     card moved optimistically and the Sheet was never written, silently.

     The repaired contract: a board move ends in EXACTLY ONE of
       - the planner write applied (patches handed to patchApi.applyCells),
       - jb:pipeline:move dispatched so flowing-writes owns the write,
       - jb:write:failed dispatched with NO write at all.
     Every branch below pins one of those three. */
  describe("F2A-MOVE-REPAIR: a board move never ends in silence", () => {
    const ROW = {
      sheetRow: 7,
      status: "Researching",
      notes: "",
      appliedDate: "",
      followUpDate: "",
      lastContact: "",
      dismissedAt: "",
    };

    /** The real F1-A planner, loaded the way pipeline-atomic-transition does. */
    function realWriter() {
      const window = {};
      vm.runInNewContext(readFileSync(join(repoRoot, "pipeline-transitions.js"), "utf8"), {
        window,
        Date,
        Object,
        String,
        Number,
        Array,
        Math,
        Promise,
        isNaN,
        console,
      });
      return window.JobBoredPipelineTransitions;
    }

    function loadWithHost({ host, transitions } = {}) {
      const loaded = loadAdapter({ transitions: transitions || realWriter() });
      if (host !== undefined) loaded.adapter.host = host;
      return loaded;
    }

    it("applies the planned patches through the host patchApi and dispatches nothing", async () => {
      const applied = [];
      const { adapter, dispatched } = loadWithHost({
        host: {
          getRow: (jobKey) => (jobKey === "K7" ? ROW : null),
          patchApi: { applyCells: (patches) => { applied.push(patches); return true; } },
        },
      });

      const result = await adapter.move({
        jobKey: "K7",
        fromStage: "researching",
        toStage: "interviewing",
        source: "pipeline-board",
      });

      assert.equal(result.ok, true, "a resolvable row + patchApi must produce a real write");
      assert.equal(applied.length, 1, "exactly one batch of cells reaches the Sheet");
      assert.ok(
        applied[0].some((p) => p.column === "M" && p.value === "Interviewing"),
        "the Status cell must be in the batch",
      );
      assert.equal(
        dispatched.length,
        0,
        "a completed write must not ALSO dispatch jb:pipeline:move — that is a double write",
      );
    });

    it("falls back to jb:pipeline:move when no host row can be resolved", async () => {
      const { adapter, dispatched } = loadWithHost({ host: null });

      const result = await adapter.move({
        jobKey: "K8",
        fromStage: "researching",
        toStage: "offer",
        source: "pipeline-board",
      });

      const move = dispatched.find((e) => e.type === "jb:pipeline:move");
      assert.ok(move, "missing_row must fall through to the event channel, not swallow the move");
      assert.equal(move.detail.jobKey, "K8");
      assert.equal(move.detail.toStage, "offer");
      assert.equal(result.code, "missing_row", "the planner's reason is reported, not hidden");
      assert.equal(
        dispatched.some((e) => e.type === "jb:write:failed"),
        false,
        "a move that was handed to flowing-writes has not failed",
      );
    });

    it("falls back to jb:pipeline:move when the host has a row but no patchApi", async () => {
      const { adapter, dispatched } = loadWithHost({ host: { getRow: () => ROW } });

      const result = await adapter.move({
        jobKey: "K9",
        fromStage: "researching",
        toStage: "offer",
        source: "pipeline-board",
      });

      assert.ok(
        dispatched.some((e) => e.type === "jb:pipeline:move" && e.detail.jobKey === "K9"),
        "missing_patch_api must fall through to the event channel",
      );
      assert.equal(result.code, "missing_patch_api");
    });

    it("falls back to jb:pipeline:move when Applied needs a confirmation the board cannot give", async () => {
      const applied = [];
      const { adapter, dispatched } = loadWithHost({
        host: {
          getRow: () => ROW,
          patchApi: { applyCells: (patches) => { applied.push(patches); return true; } },
        },
      });

      const result = await adapter.move({
        jobKey: "K10",
        fromStage: "researching",
        toStage: "applied",
        source: "pipeline-board",
      });

      assert.equal(applied.length, 0, "an unconfirmed Applied move must write nothing here");
      assert.ok(
        dispatched.some((e) => e.type === "jb:pipeline:move" && e.detail.toStage === "applied"),
        "the drag must reach flowing-writes so the submission confirmation gate can run",
      );
      assert.equal(result.code, "confirmation_required");
    });

    it("dispatches jb:write:failed and writes nothing for a stage that does not exist", async () => {
      const applied = [];
      const { adapter, dispatched } = loadWithHost({
        host: {
          getRow: () => ROW,
          patchApi: { applyCells: (patches) => { applied.push(patches); return true; } },
        },
      });

      const result = await adapter.move({
        jobKey: "K11",
        fromStage: "researching",
        toStage: "ghosted",
        source: "pipeline-board",
      });

      assert.equal(applied.length, 0, "an unknown stage must never reach the Sheet");
      assert.equal(
        dispatched.some((e) => e.type === "jb:pipeline:move"),
        false,
        "re-dispatching an unknown stage would just move the same failure downstream",
      );
      const failed = dispatched.find((e) => e.type === "jb:write:failed");
      assert.ok(failed, "the optimistic card move must be rolled back, not left lying");
      assert.equal(failed.detail.jobKey, "K11");
      assert.equal(
        failed.detail.kind,
        "pipeline:move",
        "pipeline.js only rolls back events whose kind is pipeline:move",
      );
      assert.equal(failed.detail.reason, "unknown_stage");
      assert.equal(result.ok, false);
    });

    it("reports the write as handled so lattice does not also call updateJobStatus", async () => {
      const { adapter } = loadWithHost({
        host: {
          getRow: () => ROW,
          patchApi: { applyCells: () => true },
        },
      });

      const result = await adapter.move({
        jobKey: "K12",
        fromStage: "researching",
        toStage: "offer",
        source: "lattice-board",
      });

      assert.equal(
        result.handled,
        true,
        "lattice.js suppresses its legacy updateJobStatus on result.handled — without " +
          "the flag every lattice move writes the row twice",
      );
    });

    it("surfaces jb:write:failed when the patch write itself throws", async () => {
      const { adapter, dispatched } = loadWithHost({
        host: {
          getRow: () => ROW,
          patchApi: { applyCells: () => { throw new Error("sheets 503"); } },
        },
      });

      const result = await adapter.move({
        jobKey: "K13",
        fromStage: "researching",
        toStage: "offer",
        source: "pipeline-board",
      });

      assert.equal(result.ok, false);
      const failed = dispatched.find((e) => e.type === "jb:write:failed");
      assert.ok(failed, "a throwing write must not look like a success");
      assert.equal(failed.detail.jobKey, "K13");
      assert.equal(failed.detail.kind, "pipeline:move");
    });
  });

  it("mocks the writer until F1-A lands and still emits jb:pipeline:move", async () => {
    const { adapter, dispatched } = loadAdapter();
    const payload = { jobKey: "K2", fromStage: "researching", toStage: "applied", source: "pipeline-board" };
    const result = await adapter.move(payload);
    assert.equal(result.ok, true);
    assert.equal(result.mocked, true);
    assert.ok(
      dispatched.some((event) => event.type === "jb:pipeline:move" && event.detail.jobKey === "K2"),
      "mock path must keep flowing-writes listening on jb:pipeline:move",
    );
  });
});
