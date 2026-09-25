import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";
import {
  loadDemoBoard,
  loadPayoff,
  readRepoFile,
  textOf,
} from "./oneflow-l4-harness.mjs";

/* ============================================================
   UX01 C6 — your real board once a Sheet exists.

   FR-02: "Poke around first" and closing mid-flow both left the stranger
   on sample data, so nothing could be tracked until five beats and three
   signups were done. FR-19: a paused flow re-offered the whole deal.
   FR-10: the payoff handed over no job. AX-09: the demo was dimmed to
   ~2.8:1 contrast. Each probe below pins one of those.
   ============================================================ */

function stubBoard(env) {
  const calls = { unmount: 0, reveal: 0 };
  let active = true;
  env.window.JobBoredOneFlowDemoBoard = {
    isActive: () => active,
    unmount: () => {
      calls.unmount += 1;
      active = false;
    },
  };
  env.window.JobBoredApp.setup.revealDashboardShell = () => {
    calls.reveal += 1;
  };
  return calls;
}

function resumePill(env) {
  return (env.document.body.children || []).find(
    (node) => node.id === "oneFlowResumePill",
  );
}

describe("C6 · closing setup once a Sheet exists (FR-02)", () => {
  it("reveals the real board and leaves the resume pill", async () => {
    const env = loadArrival({
      fetchImpl: makeFetchDouble(() => ({ ok: true, json: { ok: true } })),
    });
    env.host.__state.sheetId = "sheet-1";
    const calls = stubBoard(env);
    await env.flow.open("ai");
    env.flow.close("close-button");
    await new Promise(setImmediate);
    assert.equal(calls.unmount, 1, "the sample board is taken down");
    assert.equal(calls.reveal, 1, "the real dashboard shell is revealed");
    assert.ok(resumePill(env), "the resume pill is the way back into setup");
  });

  it("keeps the sample board when no Sheet exists yet", async () => {
    const env = loadArrival({
      fetchImpl: makeFetchDouble(() => ({ ok: true, json: { ok: true } })),
    });
    const calls = stubBoard(env);
    await env.flow.open("google");
    env.flow.close("escape");
    assert.equal(calls.unmount, 0, "there is no real board to show yet");
    assert.equal(calls.reveal, 0);
  });

  it("revealRealBoard() answers false without a Sheet and true with one", async () => {
    const env = loadArrival();
    stubBoard(env);
    assert.equal(env.flow.revealRealBoard(), false);
    env.host.__state.sheetId = "sheet-1";
    assert.equal(env.flow.revealRealBoard(), true);
  });

  it("names the saved beat for the S0 primary (FR-19)", async () => {
    const env = loadArrival();
    assert.equal(env.flow.resumeLabel(), "", "nothing saved, nothing to resume");
    await env.flow.open("resume");
    env.flow.close("escape");
    // The greenfield prerequisite gate sends an unverified B2 to AI first.
    assert.equal(env.flow.resumeLabel(), "Resume setup — AI");
  });
});

describe("C6 · S0 once a Sheet exists (FR-02, FR-19)", () => {
  function clickByLabel(root, label) {
    const el = root
      .querySelectorAll("[data-oneflow-demo-action]")
      .find((node) => textOf(node) === label);
    assert.ok(el, `no control labelled "${label}"`);
    el.dispatch("click", { preventDefault() {}, stopPropagation() {} });
    return el;
  }

  it("'Poke around first' hands over to the real board when the flow can show it", async () => {
    const env = loadDemoBoard();
    let revealed = 0;
    env.window.JobBoredOneFlow = {
      open() {},
      revealRealBoard() {
        revealed += 1;
        env.board.unmount();
        return true;
      },
    };
    const root = await env.board.mount();
    clickByLabel(root, "Poke around first");
    assert.equal(revealed, 1);
    assert.equal(env.board.isActive(), false, "the sample board is gone");
  });

  it("'Poke around first' still collapses to the pill with no Sheet", async () => {
    const env = loadDemoBoard();
    env.window.JobBoredOneFlow = { open() {}, revealRealBoard: () => false };
    const root = await env.board.mount();
    clickByLabel(root, "Poke around first");
    assert.ok(root.querySelector(".oneflow-demo__pill"));
  });

  it("the primary reads 'Resume setup — {beat}' when a beat is saved", async () => {
    const env = loadDemoBoard();
    const opened = [];
    env.window.JobBoredOneFlow = {
      open: (id) => opened.push(id),
      loadState: async () => ({}),
      resumeLabel: () => "Resume setup — AI",
    };
    const root = await env.board.mount();
    clickByLabel(root, "Resume setup — AI");
    assert.equal(opened.length, 1, "the resume primary re-enters the flow");
  });
});

describe("C6 · the payoff ends on a real row (FR-10)", () => {
  it("'Track a job you already found' finishes the flow, then opens manual add", async () => {
    const env = loadPayoff();
    const order = [];
    env.window.JobBoredIngest = {
      openManual: (opts) => order.push(["openManual", opts && opts.source]),
    };
    const beat = env.flow.getBeat("payoff");
    await beat.onAction("payoff_track_job", {
      completeBeat: async (detail) => {
        order.push(["completeBeat", detail.trackJob]);
        return {};
      },
    });
    assert.deepEqual(
      JSON.parse(JSON.stringify(order)),
      [
        ["completeBeat", true],
        ["openManual", "onboarding_payoff"],
      ],
      "the shell closes first so the manual form is not hidden under it",
    );
  });
});

describe("C7 · the payoff ticks only what was checked (FR-09)", () => {
  async function render(env, completedBeats) {
    const state = await env.payoff.resolvePayoffState({
      state: { skipped: {}, completedBeats },
      runtime: {},
    });
    const container = env.document.createElement("div");
    env.payoff.renderPayoff(container, state);
    return textOf(container);
  }

  it("renders ○ lines when B2 and B5 never passed their checks", async () => {
    const env = loadPayoff({ provider: "gemini" });
    const text = await render(env, ["google"]);
    assert.ok(!text.includes("✓ AI connected"), "stored config is not a check");
    assert.ok(!text.includes("✓ Discovery armed"));
    assert.ok(text.includes(env.payoff.AI_UNVERIFIED_LINE));
    assert.ok(text.includes(env.payoff.DISCOVERY_UNVERIFIED_LINE));
  });

  it("renders ✓ lines once the beats that check them completed", async () => {
    const env = loadPayoff({ provider: "gemini" });
    const text = await render(env, ["google", "ai", "resume", "fit", "discovery"]);
    assert.ok(text.includes("✓ AI connected — Gemini"));
    assert.ok(text.includes("✓ Discovery armed"));
  });
});

describe("C6 · the demo board keeps full ink (AX-09)", () => {
  it("does not dim the board with opacity", () => {
    const css = readRepoFile("css/oneflow.css");
    const rule = css.match(
      /\.oneflow-demo--watermarked \.oneflow-demo__board \{[^}]*\}/,
    );
    assert.ok(rule, "the watermarked board rule exists");
    assert.ok(!/opacity/.test(rule[0]), "opacity dropped demo text to ~2.8:1");
  });
});
