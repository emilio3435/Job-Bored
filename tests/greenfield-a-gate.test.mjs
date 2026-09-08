/**
 * GREENFIELD lane A — the controller's prerequisite gate and returnTo seam
 * (GREENFIELD-SPEC §4.1, claims A1 and A2).
 *
 * A1 · gate. Beat 3 drafts with the provider Beat 2 verified, so `resume`
 *      is unreachable until `ai` is complete; Beat 6 arms discovery against
 *      the Sheet Beat 1 created, so `payoff` is unreachable until `google`
 *      is complete OR a sheet is already configured. A gated open lands on
 *      the PREREQUISITE with a one-line note, never on a dead end.
 * A2 · returnTo. A deep link from Settings or the discovery drawer opens one
 *      beat and must not walk the user forward through the rest of setup:
 *      `open(beatId, { returnTo: "close" })` closes the shell when that beat
 *      completes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival, renderedText } from "./oneflow-l1-harness.mjs";

/** The beat whose BODY is rendered — the spine carries data-beat-id too. */
function openBeat(env) {
  const bodies = env.mount().querySelectorAll(".oneflow-beat");
  const last = bodies[bodies.length - 1];
  return last ? last.dataset.beatId : "";
}

function gateNote(env, prereqId) {
  return env.mount().querySelector(`[data-gate-note="${prereqId}"]`);
}

/** Toast text the host bridge was asked to show, in order. */
function toasts(env) {
  return env.host.__calls
    .filter((c) => c.name === "showToast")
    .map((c) => c.args[0]);
}

/** A sandbox whose flow state is seeded before anything hydrates. */
async function seeded(patch, options = {}) {
  const env = loadArrival(options);
  await env.store.saveOnboardingFlowState(patch);
  return env;
}

const AI_NOTE = "Connect an AI provider first — your resume is drafted with it.";
const GOOGLE_NOTE = "Connect Google first — your board lives in that Sheet.";

describe("GREENFIELD A1 — the flow refuses to skip past an unmet prerequisite", () => {
  it("A1-RESUME-GATE: open(\"resume\") with Beat 2 incomplete lands on the AI beat", async () => {
    const env = await seeded({ completedBeats: [] });
    await env.flow.open("resume");
    assert.equal(openBeat(env), "ai", "Beat 3 drafts with the provider Beat 2 verified");
    assert.equal(env.flow.getState().beat, "ai");
  });

  it("A1-RESUME-NOTE: the redirect explains itself in the shell's message slot", async () => {
    const env = await seeded({ completedBeats: [] });
    await env.flow.open("resume");
    const note = gateNote(env, "ai");
    assert.ok(note, "spec §4.1: the note carries data-gate-note=\"ai\"");
    assert.equal(note.textContent, AI_NOTE);
    assert.ok(renderedText(env.mount()).includes(AI_NOTE));
  });

  it("A1-PAYOFF-GATE: open(\"payoff\") with no Google and no sheet lands on Google", async () => {
    const env = await seeded({ completedBeats: [] });
    await env.flow.open("payoff");
    assert.equal(openBeat(env), "google");
    const note = gateNote(env, "google");
    assert.ok(note, "spec §4.1: the note carries data-gate-note=\"google\"");
    assert.equal(note.textContent, GOOGLE_NOTE);
  });

  it("A1-PAYOFF-SHEET: a configured sheetId satisfies the Google prerequisite", async () => {
    const env = await seeded(
      { completedBeats: [] },
      { config: { sheetId: "sheet-already-configured" } },
    );
    await env.flow.open("payoff");
    assert.equal(
      openBeat(env),
      "payoff",
      "Beat 1's exit condition is a configured Sheet — an install that has one owes nothing",
    );
    assert.equal(gateNote(env, "google"), null);
  });

  it("A1-OPEN-DIRECT: beats with no prerequisite are never redirected", async () => {
    for (const id of ["discovery", "ai", "google", "fit"]) {
      const env = await seeded({ completedBeats: [] });
      await env.flow.open(id);
      assert.equal(openBeat(env), id, `open("${id}") must land on ${id}`);
      assert.equal(gateNote(env, "ai"), null);
      assert.equal(gateNote(env, "google"), null);
    }
  });

  it("A1-PILL-NOOP: open() resumes the saved beat, and the gate is a no-op there", async () => {
    const env = await seeded(
      { completedBeats: ["google", "ai"], beat: "resume" },
      { host: { getSheetId: () => "sheet-1" } },
    );
    await env.flow.open();
    assert.equal(openBeat(env), "resume", "the saved beat always has its prerequisites");
    assert.equal(gateNote(env, "ai"), null);
  });

  it("A1-S0-FRESH: reconcileStaleCompletion still runs before the gate", async () => {
    // The S0 invitation card calls open() with no argument on an install
    // whose saved beat is "payoff" but whose sheet is gone. The reconcile
    // clears the unvouched progress; the gate then has nothing to redirect.
    const env = await seeded({
      completedBeats: ["google", "ai", "resume", "fit", "discovery"],
      beat: "payoff",
      completed: true,
    });
    await env.flow.open();
    assert.equal(openBeat(env), "google", "a fresh install lands on Beat 1");
    assert.equal(env.flow.getState().completedBeats.length, 0);
  });
});

describe("GREENFIELD A2 — returnTo closes the shell instead of walking forward", () => {
  it("A2-CLOSE: completing a beat opened with returnTo:\"close\" closes the shell", async () => {
    const env = await seeded({ completedBeats: ["google"] }, { host: { getSheetId: () => "s" } });
    await env.flow.open("ai", { returnTo: "close" });
    assert.equal(openBeat(env), "ai");
    await env.flow.completeBeat("ai");
    assert.equal(env.shell.open, false, "the deep link closes where it opened");
    assert.equal(env.flow.isOpen(), false);
    assert.equal(openBeat(env), "", "the resume beat must not render");
  });

  it("A2-TOAST: the close is spoken", async () => {
    const env = await seeded({ completedBeats: ["google"] }, { host: { getSheetId: () => "s" } });
    await env.flow.open("ai", { returnTo: "close" });
    await env.flow.completeBeat("ai");
    assert.ok(toasts(env).includes("Saved."), `expected "Saved." in ${JSON.stringify(toasts(env))}`);
  });

  it("A2-PROGRESS: the completion is still recorded", async () => {
    const env = await seeded({ completedBeats: ["google"] }, { host: { getSheetId: () => "s" } });
    await env.flow.open("ai", { returnTo: "close" });
    await env.flow.completeBeat("ai");
    assert.ok(env.flow.getState().completedBeats.includes("ai"));
  });

  it("A2-UNCHANGED: without the option, completing a beat advances as before", async () => {
    const env = await seeded({ completedBeats: ["google"] }, { host: { getSheetId: () => "s" } });
    await env.flow.open("ai");
    await env.flow.completeBeat("ai");
    assert.equal(openBeat(env), "resume", "the ordinary walk-forward is untouched");
    assert.equal(env.shell.open, true);
  });

  it("A2-SCOPED: returnTo only fires for the beat it was opened with", async () => {
    const env = await seeded({ completedBeats: ["google"] }, { host: { getSheetId: () => "s" } });
    await env.flow.open("ai", { returnTo: "close" });
    await env.flow.goToBeat("fit");
    await env.flow.completeBeat("fit");
    assert.equal(env.shell.open, true, "a beat the deep link did not name still advances");
    assert.equal(openBeat(env), "discovery");
  });

  it("A2-PASSTHROUGH: goToBeat carries the option too", async () => {
    const env = await seeded({ completedBeats: ["google"] }, { host: { getSheetId: () => "s" } });
    await env.flow.open("ai");
    await env.flow.goToBeat("fit", { returnTo: "close" });
    await env.flow.completeBeat("fit");
    assert.equal(env.shell.open, false);
    assert.ok(toasts(env).includes("Saved."));
  });
});
