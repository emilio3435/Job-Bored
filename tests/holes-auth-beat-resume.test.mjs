import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";

/* ============================================================
   HOLES AUTH — Beat 3 (resume) never turns a failure into a blank.

   A12 a template that fails to load is said out loud, never turned
       into a silent blank profile.

   Against the real beat in the L1 arrival sandbox.
   ============================================================ */

function message(env) {
  const node = env.mount().querySelector(".discovery-setup-wizard__message");
  return node ? node.textContent : "";
}

describe("A12 · a template that fails to load is said out loud", () => {
  async function openTemplates(templateAnswer) {
    const fetchImpl = makeFetchDouble((call) =>
      call.url.includes("/profile/template/") ? templateAnswer : { ok: true, json: { ok: true } },
    );
    const env = loadArrival({ fetchImpl });
    env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => ({
      provider: "openrouter",
      resumeOpenRouterApiKey: "sk-or-example-verified",
    });
    // B3 is gated on B2, so the probe arrives having passed it.
    await env.store.saveOnboardingFlowState({ completedBeats: ["ai"] });
    await env.flow.open("resume");
    await env.beats.resume.handleAction("resume_template");
    return env;
  }

  it("stays on the template grid with a message instead of a blank profile", async () => {
    const env = await openTemplates({ ok: false, status: 503, json: { ok: false } });
    await env.beats.resume.pickTemplate("engineer");

    assert.equal(env.flow.getState().completedBeats.includes("resume"), false);
    assert.match(message(env), /^Couldn't load the Engineer template/);
    assert.match(message(env), /Start blank/);
    assert.equal(env.beats.resume.getDraft(), null, "no blank profile stands in for it");
  });

  it("treats a reply with no template the same way", async () => {
    const env = await openTemplates({ ok: true, json: { ok: true } });
    await env.beats.resume.pickTemplate("marketer");
    assert.equal(env.flow.getState().completedBeats.includes("resume"), false);
    assert.match(message(env), /^Couldn't load the Marketer template/);
  });

  it("still completes Start blank and a template that loads", async () => {
    const blank = await openTemplates({ ok: false, status: 503, json: { ok: false } });
    await blank.beats.resume.pickTemplate("blank");
    assert.ok(blank.flow.getState().completedBeats.includes("resume"));

    const seeded = await openTemplates({
      ok: true,
      json: { ok: true, template: { headline: "Staff engineer" } },
    });
    await seeded.beats.resume.pickTemplate("engineer");
    assert.ok(seeded.flow.getState().completedBeats.includes("resume"));
    assert.equal(seeded.beats.resume.getDraft().profile.headline, "Staff engineer");
  });
});
