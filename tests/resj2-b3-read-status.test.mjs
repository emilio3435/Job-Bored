import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionButton, loadArrival, makeFetchDouble, renderedText } from "./oneflow-l1-harness.mjs";

/** Stage rows as plain "label:state" strings (the beat lives in a vm realm). */
const rows = (stages) => Array.from(stages, (s) => `${s.label}:${s.state}`);

/* ============================================================
   RESJ2-EXTRACT — onboarding B3 says when the AI reads the resume,
   with which provider and model, and what it read.

   Jordan (2026-09-27 22:36) saw the text box fill (the browser's own
   text extraction, no AI) and doubted any AI ran. B3's stages now name
   each step for what it is; while the AI reads, the second stage names
   the provider and model B2 verified; when it finishes, the stage and a
   toast that outlives the beat say what it read, from the server's
   `read` counts. Loads the real profile-identity.js (the shared reader),
   as index.html does. No live AI call: the fetch is a double.
   ============================================================ */

const RESUME_TEXT = "SAM LEE\nOperations Leader\nEXPERIENCE\nContoso Health, Director of Operations 2018 – Present";
const MODEL = "openai/gpt-oss-120b:free";

const READ = {
  version: 1,
  by: { provider: "openrouter", model: MODEL },
  counts: {
    employers: 3,
    roles: 6,
    achievements: 20,
    withNumbers: 14,
    skills: 22,
    education: 1,
    certifications: 2,
    awards: 0,
    projects: 0,
    languages: 0,
    links: 2,
  },
};

const DONE_LINE =
  `Read by ${MODEL}: 6 roles across 3 employers, 14 achievements with numbers, 22 skills, ` +
  "education, certifications, links.";

async function openBeat({ fromResume, withReader = true } = {}) {
  let env = null;
  const stagesDuringCall = [];
  const fetchImpl = makeFetchDouble((call) => {
    if (call.url.includes("/profile/from-resume")) {
      stagesDuringCall.push(env.beats.resume.getRenderedStages());
      return fromResume
        ? fromResume(call)
        : {
            ok: true,
            json: {
              ok: true,
              profile: {
                version: 1,
                identity: { targetRoles: ["COO"], targetSeniority: "vp", primaryNarrative: "I run operations teams." },
                strengths: [{ name: "Operations", rank: 1 }],
                hardConstraints: { workMode: "any" },
              },
              read: READ,
              source: "staged_request",
            },
          };
    }
    return { ok: true, json: { ok: true } };
  });
  env = loadArrival({ fetchImpl, extraFiles: withReader ? ["profile-identity.js"] : [] });
  env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => ({
    provider: "openrouter",
    resumeOpenRouterApiKey: "sk-or-verified-key",
    resumeOpenRouterModel: MODEL,
    resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
  });
  await env.store.saveOnboardingFlowState({ completedBeats: ["ai"] });
  await env.flow.open("resume");
  return { env, stagesDuringCall };
}

describe("RESJ2-EXTRACT — B3 status: running, done with counts, failed with reason", () => {
  it("names the provider and model while the AI reads", async () => {
    const { env, stagesDuringCall } = await openBeat();
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.deepEqual(
      rows(stagesDuringCall[0]),
      ["Saving your resume in this browser:done", `Reading your resume with OpenRouter (${MODEL}):active`],
      "the browser's save is done before the AI read starts, and the read says who is reading",
    );
  });

  it("says what was read, in the stage list and a toast that outlives the beat", async () => {
    const { env } = await openBeat();
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const stages = env.beats.resume.getRenderedStages();
    assert.deepEqual(rows(stages), [
      "Saving your resume in this browser:done",
      `${DONE_LINE}:done`,
    ]);
    const toasts = env.host.__calls.filter((c) => c.name === "showToast").map((c) => c.args);
    assert.ok(
      toasts.some((args) => args[0] === DONE_LINE && args[1] === "success"),
      `toast carries the read line; got ${JSON.stringify(toasts)}`,
    );
  });

  it("shows the plain failure reason and offers Try again", async () => {
    const { env } = await openBeat({
      fromResume: () => ({
        ok: false,
        status: 500,
        json: { ok: false, reason: "gemini_error", message: "Gemini cut the draft off at its output limit." },
      }),
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.match(renderedText(env.mount()), /Gemini cut the draft off at its output limit\./);
    assert.equal(actionButton(env.mount(), "resume_retry").textContent, "Try again");
  });

  it("falls back to the plain stage names when the shared reader did not load", async () => {
    const { env, stagesDuringCall } = await openBeat({ withReader: false });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.equal(stagesDuringCall[0][1].label, "Reading your resume with AI");
    assert.equal(env.beats.resume.getRenderedStages()[1].label, "Reading your resume with AI");
  });
});
