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
