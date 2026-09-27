/**
 * GFX-R4 — deep links never skip setup: discovery scores every job
 * against the fit profile, so reaching B5 with fit incomplete lands on B4
 * with its note (BEAT_PREREQS in onboarding-flow.js). A cold
 * ?beat=discovery — or the desktop app's jobbored://open?beat=discovery —
 * lands there too.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival } from "./oneflow-l1-harness.mjs";

describe("GFX-R4 · discovery requires fit", () => {
  const FIT_NOTE = "Set your fit profile first — discovery scores every job against it.";

  it("GFX-R4: open(\"discovery\") with fit incomplete lands on fit, with its note", async () => {
    const env = loadArrival({ host: { getSheetId: () => "sheet-1" } });
    await env.store.saveOnboardingFlowState({ completedBeats: ["google", "ai", "resume"] });
    await env.flow.open("discovery");
    assert.equal(env.flow.getState().beat, "fit");
    const note = env.mount().querySelector('[data-gate-note="fit"]');
    assert.ok(note);
    assert.equal(note.textContent, FIT_NOTE);
  });

  it("GFX-R4: a cold ?beat=discovery lands on fit too", async () => {
    const env = loadArrival();
    await env.store.saveOnboardingFlowState({ completedBeats: [] });
    const calls = [];
    env.window.location = { search: "?beat=discovery", pathname: "/", hash: "" };
    env.window.history = { replaceState: (...a) => calls.push(a) };
    await env.flow.openFromDeepLink();
    assert.equal(env.flow.getState().beat, "fit");
    assert.equal(calls.length, 1, "the link is consumed");
  });

  it("GFX-R4: with fit complete, discovery opens directly", async () => {
    const env = loadArrival({ host: { getSheetId: () => "sheet-1" } });
    await env.store.saveOnboardingFlowState({ completedBeats: ["google", "ai", "resume", "fit"] });
    await env.flow.open("discovery");
    assert.equal(env.flow.getState().beat, "discovery");
    assert.equal(env.mount().querySelector('[data-gate-note="fit"]'), null);
  });
});
