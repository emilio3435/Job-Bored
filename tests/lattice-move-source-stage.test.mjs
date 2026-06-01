/**
 * Regression: a Lattice board move from Discovered/New -> Researching must
 * emit jb:write:succeeded with the TRUE source stage so role-materials.js
 * fires the auto-draft trigger.
 *
 * Root cause this guards against: the Lattice board optimistically mutates
 * job.status to the target stage before calling window.updateJobStatus().
 * Because getPipelineData()[i] is the same object, updateJobStatus used to
 * read prevStatus = job.status (already clobbered to the target), emitting
 * fromStage === toStage. role-materials.isAutoDraftMove() requires
 * fromStage to be "new"/blank, so materials generation silently never ran.
 *
 * The fix threads the captured previous stage through
 * setStage(dataIndex, toStage, prevStatus) -> updateJobStatus(.., override).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sheetsWriteSource = readFileSync(
  join(repoRoot, "sheets-writeback.js"),
  "utf8",
);

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options ? options.detail : undefined;
  }
}

/**
 * Load sheets-writeback.js in a sandbox with a minimal host() and an
 * OK-returning Sheets fetch, then return its public surface plus the list
 * of CustomEvents dispatched on `document`.
 */
function loadWriteback({ pipelineData }) {
  const events = [];
  const windowEl = {};
  windowEl.JobBoredApp = {
    core: {
      host: {
        getAccessToken: () => "test-token",
        getActiveSheetId: () => "test-sheet",
        getSheetId: () => "test-sheet",
        getPipelineData: () => pipelineData,
        renderPipeline() {},
        renderStats() {},
        renderBrief() {},
        showToast() {},
        refreshAccessTokenSilently: async () => false,
        clearSessionAuthState() {},
        showSheetAccessGate() {},
      },
    },
  };
  const documentEl = {
    dispatchEvent(ev) {
      events.push(ev);
      return true;
    },
  };
  const ctx = vm.createContext({
    window: windowEl,
    document: documentEl,
    CustomEvent: TestCustomEvent,
    console: { log() {}, info() {}, warn() {}, error() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    Promise,
    Date,
    Number,
    Object,
    JSON,
    setTimeout,
    encodeURIComponent,
    URL,
    URLSearchParams,
  });
  vm.runInContext(sheetsWriteSource, ctx, { filename: "sheets-writeback.js" });
  return { write: windowEl.JobBoredApp.sheetsWrite, events };
}

function lastMoveEvent(events) {
  return events
    .filter((e) => e.type === "jb:write:succeeded")
    .map((e) => e.detail)
    .filter((d) => d && d.kind === "pipeline:move")
    .pop();
}

describe("Lattice move preserves the source stage", () => {
  it("emits the real previous stage when the caller already mutated job.status", async () => {
    // Simulate the Lattice board: it sets job.status = toStage BEFORE the
    // write, then passes the captured prevStatus through.
    const job = { status: "Researching", _rawIndex: 0 }; // already optimistically moved
    const { write, events } = loadWriteback({ pipelineData: [job] });

    const ok = await write.updateJobStatus(0, "Researching", "New");
    assert.equal(ok, true, "write should succeed");

    const move = lastMoveEvent(events);
    assert.ok(move, "a pipeline:move write-succeeded event should be emitted");
    assert.equal(
      move.fromStage,
      "New",
      "fromStage must be the override, not the clobbered job.status",
    );
    assert.equal(move.toStage, "Researching");
  });

  it("treats a blank discovered status as the source stage", async () => {
    const job = { status: "Researching", _rawIndex: 0 };
    const { write, events } = loadWriteback({ pipelineData: [job] });

    await write.updateJobStatus(0, "Researching", "");

    const move = lastMoveEvent(events);
    assert.ok(move, "a pipeline:move event should be emitted");
    assert.equal(move.fromStage, "", "blank source stage must be preserved");
  });

  it("falls back to job.status when no override is passed (legacy dropdown)", async () => {
    // The status-select / stage-step paths do NOT pre-mutate job.status, so
    // the live value is still the real source stage.
    const job = { status: "New", _rawIndex: 0 };
    const { write, events } = loadWriteback({ pipelineData: [job] });

    await write.updateJobStatus(0, "Researching");

    const move = lastMoveEvent(events);
    assert.ok(move, "a pipeline:move event should be emitted");
    assert.equal(move.fromStage, "New", "legacy path should keep job.status");
    assert.equal(move.toStage, "Researching");
  });
});

describe("lattice.js threads the previous stage through the write", () => {
  const latticeSource = readFileSync(join(repoRoot, "lattice.js"), "utf8");

  it("setStage forwards prevStage to updateJobStatus", () => {
    assert.match(
      latticeSource,
      /updateJobStatus\(\s*dataIndex,\s*newStage,\s*prevStage\s*\)/,
      "setStage should pass prevStage to window.updateJobStatus",
    );
  });

  it("handleStageChange passes the captured prevStatus to setStage", () => {
    assert.match(
      latticeSource,
      /setStage\(\s*dataIndex,\s*toStage,\s*prevStatus\s*\)/,
      "handleStageChange should forward prevStatus into setStage",
    );
  });
});
