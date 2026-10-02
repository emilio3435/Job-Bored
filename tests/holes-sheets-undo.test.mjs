/**
 * HOLES lane SHEETS · A15 (undo half) — a planner Undo finds its job by
 * stable key, never by the row or array index it had before the await.
 *
 * The board's move went through pipeline-transition-adapter.js: its Undo
 * replayed rollback patches that carried the pre-move row number and
 * synced pipelineData[jobKey] by index, so a load that reordered rows in
 * between wrote the undo onto whichever job now sat there.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  COL,
  HEADERS,
  createFakeSheets,
  loadWriteback,
  pipelineRow,
  rowByLink,
} from "./holes-sheets-fake.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = "https://boards.greenhouse.io/acme/jobs/101";
const B = "https://jobs.lever.co/globex/b-202";

/** A planner stand-in with pipeline-transitions.js's patch and rollback shape. */
const writer = {
  async applyTransition(input, patchApi) {
    const sheetRow = input.row.sheetRow;
    const cell = (value) => ({ column: "M", sheetRow, range: `Pipeline!M${sheetRow}`, value });
    const patches = [cell("Phone Screen")];
    if ((await patchApi.applyCells(patches)) === false) return { ok: false, code: "write_failed" };
    return { ok: true, patches, rollback: { handle: "h1", patches: [cell("New")] } };
  },
  async applyUndo(rollback, patchApi) {
    if ((await patchApi.applyCells(rollback.patches)) === false) return { ok: false, code: "write_failed" };
    return { ok: true, patches: rollback.patches };
  },
};

function setup() {
  const fake = createFakeSheets({
    Pipeline: [
      HEADERS.slice(),
      pipelineRow({ title: "Alpha Engineer", company: "Acme", link: A, status: "New" }),
      pipelineRow({ title: "Beta Analyst", company: "Globex", link: B, status: "New" }),
    ],
  });
  const env = loadWriteback(fake);
  env.load();
  const window = {
    document: { dispatchEvent: () => true },
    JobBoredApp: env.app,
    JobBoredPipelineTransitions: writer,
  };
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  vm.runInNewContext(readFileSync(join(repoRoot, "pipeline-transition-adapter.js"), "utf8"), {
    window,
    document: window.document,
    CustomEvent,
    console,
    Promise,
  });
  const adapter = window.JobBoredPipelineTransitionAdapter;
  adapter.host = {
    patchApi: { applyCells: (patches, opts) => env.sw.applyCells(patches, opts) },
    applyLocal(jobKey, patches) {
      const job = env.state.data[Number(jobKey)];
      for (const p of patches) if (p.column === "M") job.status = p.value;
    },
  };
  return { fake, env, adapter };
}

describe("A15 · a planner Undo after a reload finds its job by key", () => {
  it("writes and syncs the Undo onto the moved job, not the one now on its old row", async () => {
    const { fake, env, adapter } = setup();
    const idx = env.indexOf(A);
    const planned = await adapter.move({
      jobKey: idx,
      fromStage: "new",
      toStage: "phone_screen",
      row: { sheetRow: idx + 2 },
      announce: false,
    });
    assert.equal(planned.ok, true);
    assert.equal(rowByLink(fake, A)[COL.status], "Phone Screen");
    // The person sorts the Sheet; a poll reloads it before they click Undo.
    fake.sortPipeline((row) => (row[COL.link] === A ? 1 : 0));
    env.load();
    assert.notEqual(env.indexOf(A), idx, "A left its old index and row");
    const res = await planned.undo();
    assert.equal(res.ok, true);
    assert.equal(rowByLink(fake, A)[COL.status], "New", "the undo landed on A");
    assert.equal(rowByLink(fake, B)[COL.status], "New", "B, now on A's old row, is untouched");
    assert.equal(env.state.data.find((j) => j.link === A).status, "New", "the board shows A undone");
    assert.equal(env.state.data.find((j) => j.link === B).status, "New", "B's card is untouched");
  });

  it("refuses the Undo when the job is gone, writing nothing", async () => {
    const { fake, env, adapter } = setup();
    const idx = env.indexOf(A);
    const planned = await adapter.move({
      jobKey: idx,
      fromStage: "new",
      toStage: "phone_screen",
      row: { sheetRow: idx + 2 },
      announce: false,
    });
    fake.deletePipelineRow((row) => row[COL.link] === A);
    env.load();
    const before = fake.writes().length;
    const res = await planned.undo();
    assert.equal(res.ok, false);
    assert.equal(fake.writes().length, before);
    assert.equal(rowByLink(fake, B)[COL.status], "New");
  });
});
