/**
 * GFX FE-B5 — B6 celebrates only what really happened.
 *
 *   · N8: Run discovery now AWAITS triggerRun(). A run that didn't start
 *     keeps B6 open with the reason inline and a way to try again; only a
 *     started run completes the flow and opens the drawer.
 *   · P1: the ○ rows for skipped or unverified steps are soft, honest and
 *     still name where to go.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadPayoff, textOf } from "./oneflow-l4-harness.mjs";

function ctxFor(sink) {
  return {
    state: { skipped: {}, completedBeats: [] },
    runtime: {},
    setMessage: (text, tone) => sink.messages.push([text, tone]),
    setBusy: (id, stages) => sink.busy.push([id, stages]),
    clearBusy: () => sink.busy.push(["clear"]),
    completeBeat: (detail) => {
      sink.completed.push(detail || {});
      return Promise.resolve();
    },
    skipBeat: () => Promise.resolve(),
    goToBeat: () => Promise.resolve(),
  };
}
const sink = () => ({ messages: [], busy: [], completed: [] });
const runNow = (env, s) => env.flow.getBeat("payoff").onAction("payoff_run_now", ctxFor(s));

describe("GFX-N8 · B6 waits for the first run to start", () => {
  it("GFX-N8: the flow completes only after triggerRun resolves ok", async () => {
    const env = loadPayoff();
    let resolveRun;
    env.window.JobBoredApp.core.host.triggerDiscoveryRun = () =>
      new Promise((resolve) => {
        resolveRun = resolve;
      });
    const s = sink();
    const done = runNow(env, s);
    for (let i = 0; i < 20 && !resolveRun; i += 1) await Promise.resolve();
    assert.ok(resolveRun, "the run was fired");
    assert.equal(s.completed.length, 0, "no completion before the run answers");
    resolveRun({ ok: true, kind: "accepted_async" });
    await done;
    assert.equal(s.completed.length, 1);
    assert.equal(s.completed[0].ran, true);
  });

  for (const [runResult, reason] of [
    [{ ok: false, reason: "no_url" }, /discovery isn't connected yet/],
    [{ ok: false, reason: "blank_intent" }, /no target roles/],
    [{ ok: false, kind: "stub_only" }, /test address/],
    [{ ok: false, reason: "network_error" }, /didn't answer/],
    [{ ok: false, reason: "error" }, /hit an error/],
  ]) {
    it(`GFX-N8: ${runResult.reason || runResult.kind} stays on B6 with the reason inline`, async () => {
      const env = loadPayoff({ runResult });
      const s = sink();
      await runNow(env, s);
      assert.equal(s.completed.length, 0, "a run that didn't start never finishes the flow");
      assert.equal(s.messages.length, 1);
      const [text, tone] = s.messages[0];
      assert.equal(tone, "error");
      assert.match(text, /^The first run didn't start — /);
      assert.match(text, reason);
      assert.match(text, /Try again\.$/);
      assert.deepEqual(s.busy[s.busy.length - 1], ["clear"], "the button comes back");
    });
  }

  it("GFX-N8: a triggerRun that throws is a failure, not a pass", async () => {
    const env = loadPayoff();
    env.window.JobBoredApp.core.host.triggerDiscoveryRun = () => Promise.reject(new Error("boom"));
    const s = sink();
    await runNow(env, s);
    assert.equal(s.completed.length, 0);
    assert.match(s.messages[0][0], /^The first run didn't start — /);
  });
});

describe("GFX-P1 · B6's ○ rows are soft and honest", () => {
  it("GFX-P1: skipped and unverified rows never scold and still name the way", () => {
    const env = loadPayoff();
    const lines = [
      env.payoff.SKIPPED_LINE,
      env.payoff.AI_UNVERIFIED_LINE,
      env.payoff.DISCOVERY_UNVERIFIED_LINE,
    ];
    for (const line of lines) {
      assert.match(line, /^○ /);
      assert.doesNotMatch(line, /isn't checked|is off|isn't set up|go back/i, line);
      assert.match(line, /yet/, `${line} reads as not-yet, not failed`);
    }
    assert.match(env.payoff.SKIPPED_LINE, /banner below/);
    assert.match(env.payoff.AI_UNVERIFIED_LINE, /Settings/);
  });
});

describe("GFX-N8 · the ETA promise shows only when a run can happen", () => {
  async function render(env, flowState = {}) {
    const state = await env.payoff.resolvePayoffState({
      state: { skipped: {}, completedBeats: [], ...flowState },
      runtime: {},
    });
    const container = env.document.createElement("div");
    env.payoff.renderPayoff(container, state);
    return textOf(container);
  }

  it("GFX-N8: armed → the ETA line", async () => {
    const env = loadPayoff();
    assert.ok((await render(env)).includes(env.payoff.ETA_LINE));
  });

  it("GFX-N8: no sheet → no 'first matches land tomorrow' claim", async () => {
    const env = loadPayoff({ sheetId: "" });
    const text = await render(env);
    assert.ok(text.includes(env.payoff.NOT_ARMED_LINE));
    assert.ok(!text.includes(env.payoff.ETA_LINE));
  });

  it("GFX-N8: skipped connect → no ETA either", async () => {
    const env = loadPayoff();
    const text = await render(env, { skipped: { discoveryConnect: true } });
    assert.ok(!text.includes(env.payoff.ETA_LINE));
  });
});
