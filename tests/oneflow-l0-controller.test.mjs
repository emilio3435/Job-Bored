import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadOneFlow } from "./oneflow-l0-harness.mjs";

/* ============================================================
   ONEFLOW SUBSTRATE — the flow controller contract.

   window.JobBoredOneFlow is what every beat lane builds against, so
   these probes pin the four things a beat may not discover the hard
   way: registration order, that state survives a refresh, that
   reopening lands on the saved beat, and that an existing user is never
   re-onboarded (spec §3.3). Plus the emission every lane's telemetry
   depends on.

   Everything runs against the REAL user-content-store.js over an
   in-memory IndexedDB and the REAL shell — the controller is only
   worth anything if those three agree.
   ============================================================ */

const STEP = (events, step) =>
  events.filter((e) => e.detail && e.detail.step === step);

function stubBeat(id, order, extra = {}) {
  return {
    id,
    order,
    timeLabel: `about ${20 - order} min left`,
    headline: `${id} headline`,
    sub: `${id} sub`,
    render(container) {
      container.appendChild(container.ownerDocument.createElement("p"));
    },
    ...extra,
  };
}

/** A flow sandbox where the test owns every registration. */
function bareFlow() {
  return loadOneFlow();
}

describe("JobBoredOneFlow.registerBeat — the beat registry (SUBSTRATE contract)", () => {
  it("orders beats by `order`, not by registration order", () => {
    const { flow } = bareFlow();
    flow.registerBeat(stubBeat("payoff", 6));
    flow.registerBeat(stubBeat("google", 1));
    flow.registerBeat(stubBeat("fit", 4));
    assert.deepEqual(
      [...flow.getRegisteredBeats().map((b) => b.id)],
      ["google", "fit", "payoff"],
      "script tag order must never decide the flow's order — spec §3.1 does",
    );
  });

  it("refuses an id that is not one of the six beats", () => {
    const { flow } = bareFlow();
    assert.throws(
      () => flow.registerBeat(stubBeat("bonus_round", 7)),
      /bonus_round/,
      "a typo'd beat id must fail loudly at load, not render an empty shell",
    );
  });

  it("refuses a beat with no render function", () => {
    const { flow } = bareFlow();
    assert.throws(() => flow.registerBeat({ id: "ai", order: 2 }), /render/);
  });

  it("re-registering an id replaces it instead of duplicating the beat", () => {
    const { flow } = bareFlow();
    flow.registerBeat(stubBeat("ai", 2));
    flow.registerBeat(stubBeat("ai", 2, { headline: "second" }));
    const beats = flow.getRegisteredBeats();
    assert.equal(beats.length, 1);
    assert.equal(beats[0].headline, "second");
  });

});

describe("JobBoredOneFlow state — one key, survives a refresh (spec §3.2)", () => {
  it("getState() reads as an unstarted v3 flow before anything happens", () => {
    const { flow } = bareFlow();
    const state = flow.getState();
    assert.equal(state.version, 3);
    assert.equal(state.beat, "");
    assert.deepEqual([...state.completedBeats], []);
  });

  it("round-trips through the store: a second boot sees the first boot's beat", async () => {
    const first = bareFlow();
    first.flow.registerBeat(stubBeat("google", 1));
    first.flow.registerBeat(stubBeat("ai", 2));
    await first.flow.open("ai");
    assert.equal(first.flow.getState().beat, "ai");

    // Same IndexedDB rows, fresh module instances — i.e. a page refresh.
    const stored = await first.store.getOnboardingFlowState();
    assert.equal(stored.beat, "ai");
    assert.ok(stored.startedAt, "the flow stamps when the deal started");
  });

  it("getState() hands back a copy — a beat cannot mutate flow state behind the controller", () => {
    const { flow } = bareFlow();
    flow.getState().completedBeats.push("google");
    assert.deepEqual([...flow.getState().completedBeats], []);
  });
});

describe("JobBoredOneFlow.open — resume, not restart (spec §3.4)", () => {
  it("open() with no argument lands on the saved beat", async () => {
    const { flow, store } = bareFlow();
    for (const [id, order] of [["google", 1], ["ai", 2], ["fit", 4]]) {
      flow.registerBeat(stubBeat(id, order));
    }
    await store.saveOnboardingFlowState({ beat: "fit" });
    await flow.open();
    assert.equal(
      flow.getState().beat,
      "fit",
      "reopening mid-flow must never dump the user back at beat 1",
    );
  });

  it("open() with nothing saved starts at the first beat by order", async () => {
    const { flow } = bareFlow();
    flow.registerBeat(stubBeat("ai", 2));
    flow.registerBeat(stubBeat("google", 1));
    await flow.open();
    assert.equal(flow.getState().beat, "google");
  });

  it("renders the beat into #oneFlowMount through the shared shell", async () => {
    const { flow, document } = bareFlow();
    flow.registerBeat(stubBeat("google", 1));
    await flow.open();
    const mount = document.getElementById("oneFlowMount");
    assert.equal(mount.hidden, false);
    assert.ok(
      mount.querySelector(".discovery-setup-wizard"),
      "spec §3.5: ONE chassis — beats render through discovery-wizard-shell.js",
    );
  });

  it("renders the beat's own DOM via render(container, ctx)", async () => {
    const { flow, document } = bareFlow();
    let seenCtx = null;
    flow.registerBeat(
      stubBeat("google", 1, {
        render(container, ctx) {
          seenCtx = ctx;
          const card = container.ownerDocument.createElement("div");
          card.className = "probe-card";
          container.appendChild(card);
        },
      }),
    );
    await flow.open();
    assert.ok(document.getElementById("oneFlowMount").querySelector(".probe-card"));
    for (const fn of [
      "setMessage",
      "setBusy",
      "clearBusy",
      "completeBeat",
      "skipBeat",
      "goToBeat",
    ]) {
      assert.equal(typeof seenCtx[fn], "function", `ctx.${fn} is part of the contract`);
    }
    assert.equal(seenCtx.state.beat, "google");
    assert.ok(seenCtx.runtime, "ctx.runtime carries cross-beat handoffs (B3 draft → B4)");
  });

  it("emits flow_opened once, then beat_opened per beat", async () => {
    const { flow, events } = bareFlow();
    flow.registerBeat(stubBeat("google", 1));
    flow.registerBeat(stubBeat("ai", 2));
    await flow.open();
    await flow.goToBeat("ai");
    assert.equal(STEP(events, "flow_opened").length, 1);
    assert.deepEqual(
      [...STEP(events, "beat_opened").map((e) => e.detail.beat)],
      ["google", "ai"],
    );
  });
});

describe("JobBoredOneFlow.maybeStart — never re-onboard an existing user (spec §3.3)", () => {
  it("returns false and records completion when both legacy flags are set", async () => {
    const { flow, store } = bareFlow();
    await store.completeInfraSetup();
    await store.completeOnboarding();
    assert.equal(
      await flow.maybeStart(),
      false,
      "a legacy-complete profile must boot straight to the dashboard",
    );
    assert.equal((await store.getOnboardingFlowState()).completed, true);
  });

  it("returns true for a fresh profile and stamps startedAt", async () => {
    const { flow, store } = bareFlow();
    assert.equal(await flow.maybeStart(), true);
    const state = await store.getOnboardingFlowState();
    assert.equal(state.completed, false);
    assert.ok(state.startedAt);
  });

  it("returns false once the flow itself has completed", async () => {
    const { flow, store } = bareFlow();
    await store.saveOnboardingFlowState({ completed: true });
    assert.equal(await flow.maybeStart(), false);
  });

  it("still returns true when only ONE legacy flag is set — a half-finished setup is not done", async () => {
    const { flow, store } = bareFlow();
    await store.completeOnboarding();
    assert.equal(await flow.maybeStart(), true);
  });

  it("renders nothing — boot wiring is L6's job, not maybeStart's", async () => {
    const { flow, document } = bareFlow();
    await flow.maybeStart();
    assert.equal(
      document.getElementById("oneFlowMount").children.length,
      0,
      "SUBSTRATE locked decision 1: the substrate lands DARK",
    );
  });
});

describe("JobBoredOneFlow.completeBeat / skipBeat — advancing the flow", () => {
  it("marks the beat done, emits beat_completed with the beat's detail, and advances", async () => {
    const { flow, events, store } = bareFlow();
    flow.registerBeat(stubBeat("google", 1));
    flow.registerBeat(stubBeat("ai", 2));
    await flow.open();
    await flow.completeBeat("google", { createdSheet: true });
    const done = STEP(events, "beat_completed");
    assert.equal(done.length, 1);
    assert.equal(done[0].detail.beat, "google");
    assert.equal(done[0].detail.createdSheet, true);
    assert.equal(flow.getState().beat, "ai");
    assert.deepEqual([...(await store.getOnboardingFlowState()).completedBeats], ["google"]);
  });

  it("records a skip under its own key and emits beat_skipped", async () => {
    const { flow, events, store } = bareFlow();
    flow.registerBeat(stubBeat("discovery", 5));
    flow.registerBeat(stubBeat("payoff", 6));
    await flow.open();
    await flow.skipBeat("discovery", { key: "discoveryConnect", beat: "discovery_connect" });
    assert.equal(STEP(events, "beat_skipped")[0].detail.beat, "discovery_connect");
    assert.equal(
      (await store.getOnboardingFlowState()).skipped.discoveryConnect,
      true,
      "spec §5 B5: B6 renders its adapted variant off this flag",
    );
    assert.equal(flow.getState().beat, "payoff");
  });

  it("completing the last beat writes every legacy completion flag (spec §3.2)", async () => {
    const { flow, events, store } = bareFlow();
    flow.registerBeat(stubBeat("discovery", 5));
    flow.registerBeat(stubBeat("payoff", 6));
    await flow.open("payoff");
    await flow.completeBeat("payoff");
    assert.equal(await store.isOnboardingComplete(), true);
    assert.equal(await store.isInfraSetupComplete(), true);
    assert.equal(
      await store.isDiscoverySetupComplete(),
      true,
      "connect was not skipped, so every legacy discovery reader must see it done",
    );
    assert.equal((await store.getOnboardingFlowState()).completed, true);
    const finished = STEP(events, "flow_completed");
    assert.equal(finished.length, 1);
    assert.equal(typeof finished[0].detail.durationMs, "number");
  });

  it("a skipped connection leaves discoverySetupComplete alone — B6's adapted variant is honest", async () => {
    const { flow, store } = bareFlow();
    flow.registerBeat(stubBeat("discovery", 5));
    flow.registerBeat(stubBeat("payoff", 6));
    await flow.open();
    await flow.skipBeat("discovery", { key: "discoveryConnect" });
    await flow.completeBeat("payoff");
    assert.equal(await store.isOnboardingComplete(), true);
    assert.equal(await store.isDiscoverySetupComplete(), false);
  });
});

describe("JobBoredOneFlow close — pausing, with the reason recorded (spec §3.4)", () => {
  it("emits beat_abandoned with the beat and the reason", async () => {
    const { flow, events } = bareFlow();
    flow.registerBeat(stubBeat("ai", 2));
    await flow.open();
    flow.close("escape");
    const abandoned = STEP(events, "beat_abandoned");
    assert.equal(abandoned.length, 1);
    assert.equal(abandoned[0].detail.beat, "ai");
    assert.equal(abandoned[0].detail.reason, "escape");
  });

  it("routes the shell's own × / Esc close through the same emission", async () => {
    const { flow, events, shell } = bareFlow();
    flow.registerBeat(stubBeat("ai", 2));
    await flow.open();
    shell.closeWizardShell("close-button");
    assert.equal(STEP(events, "beat_abandoned")[0].detail.reason, "close-button");
  });

  it("closing leaves the saved beat intact — closing is pausing, never skipping", async () => {
    const { flow, store } = bareFlow();
    flow.registerBeat(stubBeat("google", 1));
    flow.registerBeat(stubBeat("ai", 2));
    await flow.open("ai");
    flow.close("escape");
    assert.equal((await store.getOnboardingFlowState()).beat, "ai");
    assert.deepEqual([...(await store.getOnboardingFlowState()).completedBeats], []);
    await flow.open();
    assert.equal(flow.getState().beat, "ai");
  });

  it("does not emit an abandon when the flow was never open", () => {
    const { flow, events } = bareFlow();
    flow.close("escape");
    assert.equal(STEP(events, "beat_abandoned").length, 0);
  });
});
