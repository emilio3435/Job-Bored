import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionButton, loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";

/* ============================================================
   SIXBEATS claim C2 — Beat 3's template grid was a one-way door.

   ONE-FLOW spec §5 B3 makes the starter templates a CHOICE ("a template
   is a seed, not a lock"). As shipped, choosing to look at them removed
   every route back: the dropzone and the paste box were gone, and the
   only escape was a page reload — which also threw away whatever the
   user had already pasted. Gemini's walkthrough tagged it MISMATCH.

   The repair is one secondary action that returns to the intake screen
   with the pasted draft intact.
   ============================================================ */

const BEAT_ID = "resume";
const PASTED = "Emilio N. — Staff engineer. Ten years shipping infra.";

function draftingFetch() {
  return makeFetchDouble(() => ({ ok: true, json: { ok: true } }));
}

async function openBeat() {
  const env = loadArrival({ fetchImpl: draftingFetch() });
  await env.flow.open(BEAT_ID);
  return env;
}

function pasteBox(env) {
  return env.mount().querySelector("#oneFlowResumePaste");
}

function typeIntoPasteBox(env, text) {
  const box = pasteBox(env);
  assert.ok(box, "the paste box is one of B3's three intake routes");
  box.value = text;
  box.dispatch("input", { target: box });
}

describe("C2 · B3 template grid — the way back (spec §5 B3)", () => {
  it("offers 'Back to upload or paste' as a shell action while the grid is up", async () => {
    const env = await openBeat();
    await env.beats.resume.handleAction("resume_template");
    assert.ok(
      env.mount().querySelector(".oneflow-resume__template-grid"),
      "precondition: the template grid is what replaced the dropzone",
    );
    const back = actionButton(env.mount(), "resume_back");
    assert.ok(
      back,
      "a template screen with no way back is a one-way door — claim C2",
    );
    assert.equal(back.textContent, "Back to upload or paste");
  });

  it("returns to the dropzone and the paste box when it is pressed", async () => {
    const env = await openBeat();
    await env.beats.resume.handleAction("resume_template");
    await env.beats.resume.handleAction("resume_back");
    const mount = env.mount();
    assert.ok(mount.querySelector(".oneflow-resume__drop"), "drag target is back");
    assert.ok(mount.querySelector("#oneFlowResumeFile"), "browse input is back");
    assert.ok(mount.querySelector("#oneFlowResumePaste"), "paste box is back");
    assert.equal(
      mount.querySelector(".oneflow-resume__template-grid"),
      null,
      "the grid gives way to the intake screen",
    );
  });

  it("preserves text already pasted, so looking at the templates costs nothing", async () => {
    const env = await openBeat();
    typeIntoPasteBox(env, PASTED);
    await env.beats.resume.handleAction("resume_template");
    await env.beats.resume.handleAction("resume_back");
    assert.equal(
      pasteBox(env).value,
      PASTED,
      "losing a pasted resume for peeking at the templates is the cost C2 removes",
    );
  });

  it("still drafts from the preserved text after the round trip", async () => {
    const env = await openBeat();
    typeIntoPasteBox(env, PASTED);
    await env.beats.resume.handleAction("resume_template");
    await env.beats.resume.handleAction("resume_back");
    await env.beats.resume.handleAction("resume_use_text");
    const call = env.fetchImpl.calls.find((c) => c.url.includes("/profile/from-resume"));
    assert.ok(call, "the preserved draft is what gets drafted");
    assert.equal(call.body.resumeText, PASTED);
  });
});
