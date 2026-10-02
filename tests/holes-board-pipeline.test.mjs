/**
 * HOLES BOARD — the v2 sticker board (pipeline.js) mounted in a small DOM.
 *
 * Each describe block names the finding it pins. The board is loaded as the
 * browser loads it (a classic script in a window-shaped vm context) on top of
 * tests/holes-board-dom.mjs, with the data seams it reads stubbed:
 * JobBoredDawn.data.getPipelineViewModel() and JobBored.getPipelineJobs().
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createBoardEnv } from "./holes-board-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(repoRoot, name), "utf8");
const pipelineJs = read("pipeline.js");
const companyCapJs = read("company-cap.js");

const STAGE_KEYS = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];

/** Rows in the shape JobBored.getPipelineJobs() returns; jobKey is the index. */
function job(over = {}) {
  return { title: "Engineer", company: "Acme", status: "Researching", favorite: false, ...over };
}

function viewModelFrom(jobs) {
  const byStage = Object.fromEntries(STAGE_KEYS.map((k) => [k, []]));
  jobs.forEach((j, i) => {
    const stage = j.stage || "researching";
    byStage[stage].push({ jobKey: String(i), role: j.title, company: j.company, fitScore: j.fit ?? null, index: i });
  });
  const stages = STAGE_KEYS.map((key) => ({ key, label: key, cards: byStage[key] }));
  return { stages, untriaged: byStage.new.slice(), empty: jobs.length === 0 };
}

/** Mount the board. Returns the env plus spies on the seams it calls. */
function mountBoard({ jobs = [job()], withCap = false, a11y = null, adapter = null } = {}) {
  const env = createBoardEnv({ html: '<section data-region="pipeline"></section>' });
  const w = env.window;
  const calls = { favorite: [], ingest: [], moves: [], vm: 0 };
  const state = { jobs };
  w.JobBoredDawn = {
    data: {
      getPipelineViewModel() {
        calls.vm += 1;
        return viewModelFrom(state.jobs);
      },
    },
  };
  w.JobBored = {
    getPipelineJobs: () => state.jobs,
    toggleFavorite: (key) => {
      calls.favorite.push(String(key));
      const row = state.jobs[Number(key)];
      if (row) row.favorite = !row.favorite;
    },
    ingestJobUrl: (url) => {
      calls.ingest.push(url);
      return new Promise(() => {}); // stays in flight; the test only counts calls
    },
  };
  if (a11y) w.JobBoredA11y = a11y;
  if (adapter) w.JobBoredPipelineTransitionAdapter = adapter;
  if (withCap) vm.runInNewContext(companyCapJs, w, { filename: "company-cap.js" });
  vm.runInNewContext(pipelineJs, w, { filename: "pipeline.js" });
  env.flush();
  const region = env.document.querySelector('[data-region="pipeline"]');
  return { ...env, w, region, calls, state, api: w.JobBoredPipeline };
}

function remount(board) {
  board.api.clearRegion();
  board.api.scheduleRender();
  board.flush();
}

function pointer(board, target, type) {
  return board.fire(target, type, { props: { button: 0, pointerId: 1, clientX: 0, clientY: 0 } });
}

describe("B1 · a remount does not stack listeners (one AbortController per mount)", () => {
  it("should hold the same listener count on the region and document after unmount and remount", () => {
    const board = mountBoard();
    const regionCount = board.region.listenerCount();
    const docCount = board.document.listenerCount();
    assert.ok(regionCount > 0, "the board binds its delegated listeners on mount");
    remount(board);
    remount(board);
    assert.equal(board.region.listenerCount(), regionCount, "region listeners after two remounts");
    assert.equal(board.document.listenerCount(), docCount, "document listeners after two remounts");
  });

  it("should remove every mount listener on unmount", () => {
    const board = mountBoard();
    const docBefore = board.document.listenerCount();
    board.api.clearRegion();
    assert.equal(board.region.listenerCount(), 0, "an unmounted region keeps no board listeners");
    assert.ok(board.document.listenerCount() < docBefore, "mount-scoped document listeners are released");
  });

  it("should toggle a favorite once per press after a remount", () => {
    const board = mountBoard();
    remount(board);
    const star = board.region.querySelector('[data-card-action="toggle-favorite"]');
    assert.ok(star, "the card renders its favorite star");
    pointer(board, star, "pointerdown");
    pointer(board, star, "pointerup");
    star.click();
    assert.deepEqual(board.calls.favorite, ["0"], "one press is one toggle");
  });

  it("should ingest a pasted URL once per submit after a remount", () => {
    const board = mountBoard();
    remount(board);
    board.region.querySelector('.pipe-tool__btn[data-action="add-job-url"]').click();
    board.region.querySelector("[data-pipeline-url-input]").value = "https://boards.example.com/jobs/1";
    board.fire(board.region.querySelector("[data-pipeline-url-form]"), "submit");
    assert.deepEqual(board.calls.ingest, ["https://boards.example.com/jobs/1"], "one submit is one ingest");
  });
});
