import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival, makeFetchDouble, stepEvents } from "./oneflow-l1-harness.mjs";

/* ============================================================
   SIXBEATS claim C5 — closing the flow said nothing.

   ONE-FLOW spec §3.4: "Closing is pausing, never skipping." The state
   machine already honours that — the saved beat survives and the S0
   card re-enters where the user left off — but the SCREEN said none of
   it. Escape dropped you onto the board with no acknowledgement, which
   Gemini's walkthrough read as "did I just lose my setup?".

   The repair is the sentence the flow already earns: one toast, no
   confirm dialog. A confirm would make pausing feel like quitting, and
   §3.4 says it is not.
   ============================================================ */

const BEAT_ID = "ai";
const PAUSE_TOAST = "Setup paused — pick up anytime from the corner pill.";

async function openBeat() {
  const env = loadArrival({
    fetchImpl: makeFetchDouble(() => ({ ok: true, json: { ok: true } })),
  });
  await env.flow.open(BEAT_ID);
  return env;
}

function toasts(env) {
  return env.host.__calls.filter((c) => c.name === "showToast").map((c) => c.args);
}

describe("C5 · closing the flow is pausing, and says so (spec §3.4)", () => {
  it("toasts the pause line when the shell is closed with Escape", async () => {
    const env = await openBeat();
    env.mount().dispatch("keydown", { key: "Escape", preventDefault() {} });
    assert.deepEqual(
      toasts(env).map((args) => args[0]),
      [PAUSE_TOAST],
      "Escape with no feedback is what read as losing the setup — claim C5",
    );
  });

  it("toasts the same line when the flow is closed by the close button", async () => {
    const env = await openBeat();
    env.flow.close("close-button");
    assert.deepEqual(toasts(env).map((args) => args[0]), [PAUSE_TOAST]);
  });

  it("shows no confirm dialog — pausing is not quitting", async () => {
    const env = await openBeat();
    env.mount().dispatch("keydown", { key: "Escape", preventDefault() {} });
    assert.equal(
      env.host.__calls.filter((c) => c.name === "confirm").length,
      0,
      "spec §3.4: closing is pausing; a confirm would frame it as quitting",
    );
    assert.equal(env.flow.isOpen(), false, "the close is immediate");
  });

  it("still records beat_abandoned and leaves the saved beat intact", async () => {
    const env = await openBeat();
    env.mount().dispatch("keydown", { key: "Escape", preventDefault() {} });
    const abandoned = stepEvents(env.events, "beat_abandoned");
    assert.equal(abandoned.length, 1);
    assert.equal(abandoned[0].beat, BEAT_ID);
    assert.equal(abandoned[0].reason, "escape");
    assert.equal(
      env.flow.getState().beat,
      BEAT_ID,
      "the toast is a message about state that was already preserved — it must stay preserved",
    );
  });

  it("does NOT toast when the flow closes because it finished", async () => {
    const env = loadArrival({
      fetchImpl: makeFetchDouble(() => ({ ok: true, json: { ok: true } })),
    });
    await env.flow.open("payoff");
    await env.flow.completeBeat("payoff", {});
    assert.deepEqual(
      toasts(env).map((args) => args[0]),
      [],
      "a finished flow is not a paused one — the pause line would be a lie",
    );
  });
});
