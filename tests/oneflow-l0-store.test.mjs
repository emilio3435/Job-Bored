import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadStore } from "./oneflow-l0-harness.mjs";

/* ============================================================
   ONEFLOW spec §3.2: ONE IndexedDB key owns flow state —
   `onboardingFlowState = { version: 3, beat, completedBeats: [],
   skipped: {…}, startedAt }`. These probes run user-content-store.js
   against a real (in-memory) IndexedDB so a round trip is proven, not
   pattern-matched — the whole point of the key is that a refresh
   mid-flow resumes the same beat.
   ============================================================ */

describe("user-content-store — onboardingFlowState (spec §3.2)", () => {
  it("defaults to an unstarted v3 flow when nothing was ever saved", async () => {
    const { store } = loadStore();
    const state = await store.getOnboardingFlowState();
    assert.equal(state.version, 3);
    assert.equal(state.beat, "");
    assert.deepEqual([...state.completedBeats], []);
    assert.deepEqual({ ...state.skipped }, {});
    assert.equal(state.startedAt, "");
    assert.equal(state.completed, false);
  });

  it("round-trips a mid-flow save under the onboardingFlowState key", async () => {
    const { store, indexedDB } = loadStore();
    await store.saveOnboardingFlowState({
      beat: "fit",
      completedBeats: ["google", "ai", "resume"],
      startedAt: "2026-08-31T22:00:00.000Z",
    });
    const state = await store.getOnboardingFlowState();
    assert.equal(state.beat, "fit");
    assert.deepEqual([...state.completedBeats], ["google", "ai", "resume"]);
    assert.equal(state.startedAt, "2026-08-31T22:00:00.000Z");
    // The key itself is the contract: ONE settings row named
    // onboardingFlowState, in the same store as discoverySetupWizardState.
    const settings = indexedDB._databases
      .get("command-center-user-content")
      .stores.get("settings");
    assert.equal(settings.get("onboardingFlowState").value.beat, "fit");
  });

  it("merges partials like saveDiscoverySetupWizardState does — a second write never drops the first", async () => {
    const { store } = loadStore();
    await store.saveOnboardingFlowState({ beat: "ai", startedAt: "2026-08-31T22:00:00.000Z" });
    await store.saveOnboardingFlowState({ beat: "resume" });
    const state = await store.getOnboardingFlowState();
    assert.equal(state.beat, "resume");
    assert.equal(
      state.startedAt,
      "2026-08-31T22:00:00.000Z",
      "a debounced per-keystroke save must not wipe fields it did not name",
    );
  });

  it("keeps completedBeats unique and drops ids that are not beats", async () => {
    const { store } = loadStore();
    const state = await store.saveOnboardingFlowState({
      completedBeats: ["google", "google", "ai", "not_a_beat", ""],
    });
    assert.deepEqual([...state.completedBeats], ["google", "ai"]);
  });

  it("coerces an unknown beat id to the unstarted screen instead of rendering nothing", async () => {
    const { store } = loadStore();
    const state = await store.saveOnboardingFlowState({ beat: "wat" });
    assert.equal(state.beat, "");
  });

  it("normalizes skipped to a truth map — spec §5 B5 writes skipped.discoveryConnect", async () => {
    const { store } = loadStore();
    const state = await store.saveOnboardingFlowState({
      skipped: { discoveryConnect: true, somethingFalse: false },
    });
    assert.equal(state.skipped.discoveryConnect, true);
    assert.equal("somethingFalse" in state.skipped, false);
  });

  it("records completion so §3.3 migration can mark the flow done without running it", async () => {
    const { store } = loadStore();
    await store.saveOnboardingFlowState({ completed: true });
    assert.equal((await store.getOnboardingFlowState()).completed, true);
  });

  it("clearOnboardingFlowState resets to the unstarted default", async () => {
    const { store } = loadStore();
    await store.saveOnboardingFlowState({ beat: "payoff", completed: true });
    await store.clearOnboardingFlowState();
    const state = await store.getOnboardingFlowState();
    assert.equal(state.beat, "");
    assert.equal(state.completed, false);
  });

  it("publishes the helpers on window.CommandCenterUserContent", () => {
    const { store } = loadStore();
    for (const fn of [
      "getOnboardingFlowState",
      "saveOnboardingFlowState",
      "clearOnboardingFlowState",
      "normalizeOnboardingFlowState",
    ]) {
      assert.equal(typeof store[fn], "function", `${fn} must be exported`);
    }
    assert.equal(store.DEFAULT_ONBOARDING_FLOW_STATE.version, 3);
  });
});
