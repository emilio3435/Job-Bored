/**
 * HOLES BOARD — B12: one toast entry point, and an Undo that always shows.
 *
 * Before: pipeline.js fell back to a local .pipe-toast that dropped its Retry
 * action, pipeline-transition-adapter.js showed nothing at all without
 * jb-a11y.js, flowing-writes.js reached for window.showToast and otherwise
 * only logged, and JobBoredA11y.toast announces but paints nothing until the
 * app's renderer is bridged. Now window.JobBoredFlowing.toast
 * (flowing-writes.js) is the one entry point all three use, and it paints the
 * action itself when no renderer is there to do it.
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

function load(env, ...files) {
  for (const f of files) vm.runInNewContext(read(f), env.window, { filename: f });
}

function painted(env) {
  return env.document.querySelectorAll(".toast").map((t) => ({
    text: (t.querySelector(".toast-message") || t).textContent,
    action: (t.querySelector(".toast-action-btn") || { textContent: "" }).textContent,
    node: t,
  }));
}

const undo = (calls) => ({ label: "Undo", onClick: () => calls.push("undo") });

describe("B12 · window.JobBoredFlowing.toast is the board's one toast entry point", () => {
  it("should be published by flowing-writes.js", () => {
    const env = createBoardEnv();
    load(env, "flowing-writes.js");
    assert.equal(typeof env.window.JobBoredFlowing.toast, "function");
  });

  it("should paint the Undo button itself when no app toast renderer is bridged", () => {
    const env = createBoardEnv();
    const announced = [];
    env.window.JobBoredA11y = { toast: (m) => { announced.push(m); return () => {}; }, live: { announce: (m) => announced.push(m) } };
    load(env, "flowing-writes.js");
    const calls = [];
    env.window.JobBoredFlowing.toast("Moved Staff Engineer to Applied.", "success", { action: undo(calls) });
    const [shown] = painted(env);
    assert.ok(shown, "a toast is painted even though jb-a11y.js has no renderer to hand it to");
    assert.equal(shown.action, "Undo");
    shown.node.querySelector(".toast-action-btn").click();
    assert.deepEqual(calls, ["undo"], "the painted Undo runs the action");
    assert.equal(painted(env).length, 0, "and the toast closes");
  });

  it("should hand a bridged renderer an action toast that stays up long enough to reach", () => {
    const env = createBoardEnv();
    const shown = [];
    let dismissed = 0;
    env.window.JobBoredApp = { core: { host: { showToast: (...args) => { shown.push(args); return () => { dismissed += 1; }; } } } };
    env.window.JobBoredA11y = {
      toast: (m, t, o) => env.window.JobBoredApp.core.host.showToast(m, t, o.persistent === true, o.action),
      live: { announce() {} },
    };
    load(env, "flowing-writes.js");
    env.window.JobBoredFlowing.toast("Moved Staff Engineer to Applied.", "success", { action: undo([]) });
    assert.equal(shown.length, 1);
    assert.equal(shown[0][2], true, "an action toast is not left to the renderer's 3 s auto-dismiss");
    assert.equal(shown[0][3].label, "Undo");
    env.advance(7000);
    assert.equal(dismissed, 0, "still up after 7 s");
    env.advance(2000);
    assert.equal(dismissed, 1, "dismissed after the action window");
    assert.equal(painted(env).length, 0, "no second, home-made toast on top of the app's");
  });

  it("should use window.showToast when jb-a11y.js is absent", () => {
    const env = createBoardEnv();
    const shown = [];
    env.window.showToast = (...args) => { shown.push(args); return () => {}; };
    load(env, "flowing-writes.js");
    env.window.JobBoredFlowing.toast("Couldn't save notes: offline", "error");
    assert.equal(shown.length, 1);
    assert.equal(shown[0][0], "Couldn't save notes: offline");
    assert.equal(shown[0][1], "error");
  });
});

describe("B12 · every board surface toasts through the entry point", () => {
  it("should paint the adapter's Undo when only flowing-writes.js is there to paint it", async () => {
    const env = createBoardEnv();
    env.window.JobBored = { getPipelineJobs: () => [{ title: "Staff Engineer", company: "Acme" }] };
    load(env, "flowing-writes.js", "pipeline-transitions.js", "pipeline-transition-adapter.js");
    env.window.JobBoredPipelineTransitionAdapter.host = {
      getRow: () => ({ sheetRow: 7, status: "Researching", notes: "", appliedDate: "", followUpDate: "", lastContact: "", dismissedAt: "" }),
      patchApi: { applyCells: async () => true },
    };
    const result = await env.window.JobBoredPipelineTransitionAdapter.move({ jobKey: "0", fromStage: "researching", toStage: "rejected" });
    assert.equal(result.ok, true);
    const toast = painted(env).find((t) => /Rejected/.test(t.text));
    assert.ok(toast, "the move names its stage in a painted toast");
    assert.equal(toast.action, "Undo", "and Undo is there to press");
  });

  it("should paint the board's Retry when a move fails", () => {
    const env = createBoardEnv({ html: '<section data-region="pipeline"></section>' });
    const jobs = [{ title: "Staff Engineer", company: "Acme", status: "Researching" }];
    env.window.JobBored = { getPipelineJobs: () => jobs };
    env.window.JobBoredDawn = {
      data: {
        getPipelineViewModel: () => ({
          stages: ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"]
            .map((key) => ({ key, cards: key === "researching" ? [{ jobKey: "0", role: "Staff Engineer", company: "Acme" }] : [] })),
          untriaged: [],
          empty: false,
        }),
      },
    };
    env.window.JobBoredPipelineTransitionAdapter = { move: () => new Promise(() => {}) };
    load(env, "flowing-writes.js", "pipeline.js");
    env.flush();
    const region = env.document.querySelector('[data-region="pipeline"]');
    const target = region.querySelector('.pipe-col[data-stage="applied"]');
    env.document.elementsFromPoint = () => [target];
    const node = region.querySelector('.pipe-sticker[data-stable-key="0"]');
    env.fire(node, "pointerdown", { props: { button: 0, pointerId: 3, clientX: 0, clientY: 0 } });
    env.fire(node, "pointermove", { props: { button: 0, pointerId: 3, clientX: 40, clientY: 40 } });
    env.fire(node, "pointerup", { props: { button: 0, pointerId: 3, clientX: 40, clientY: 40 } });
    env.fire(env.document, "jb:write:failed", { detail: { kind: "pipeline:move", jobKey: "0", reason: "write_failed" } });
    const toast = painted(env).find((t) => /Couldn't move/.test(t.text));
    assert.ok(toast, "the failed move is named in a painted toast");
    assert.equal(toast.action, "Retry", "with its Retry, not a bare status line");
  });

  it("should paint a flowing-writes failure instead of only logging it", async () => {
    const env = createBoardEnv();
    load(env, "flowing-writes.js");
    env.fire(env.window, "jb:role:writeback", { detail: { jobKey: "0", field: "heardBack", value: "2026-10-01" } });
    for (let i = 0; i < 20 && !painted(env).length; i++) await new Promise((r) => setImmediate(r));
    const toast = painted(env).find((t) => /Couldn't save/.test(t.text));
    assert.ok(toast, "a failed write tells the person");
  });
});
