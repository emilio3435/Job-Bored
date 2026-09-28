import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";

/* ============================================================
   RESJ K1 review fix K1-B3 (Grok, 1caa65dc): onboarding B3 saved
   the resume to IndexedDB and never read serverSync, so a hosted
   404, an offline PUT or a 422 finished the beat with no word
   that the server kept an older resume. B3 now waits for the
   server copy after the draft (outside its deadline) and shows
   the "Saved in this browser only" line as a note that survives
   the move to the next beat. Fictional text only.
   ============================================================ */

const RESUME = "Jane Doe\nStaff engineer, ten years of distributed systems.";
const PROVIDER_CONFIG = {
  provider: "openrouter",
  resumeOpenRouterApiKey: "sk-or-fake-0000",
  resumeOpenRouterModel: "openai/gpt-5.4-mini",
};

/** @param {{ putStatus: number, putJson?: unknown }} opts */
async function runB3({ putStatus, putJson }) {
  const env = loadArrival({
    fetchImpl: makeFetchDouble((call) => {
      if (call.url.endsWith("/profile/resume")) {
        return { ok: putStatus < 300, status: putStatus, json: putJson !== undefined ? putJson : { ok: putStatus < 300 } };
      }
      if (call.url.endsWith("/profile/from-resume")) {
        return { ok: true, json: { ok: true, profile: {}, source: "staged_request" } };
      }
      return { ok: true, json: { ok: true } };
    }),
  });
  env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => ({ ...PROVIDER_CONFIG });
  env.window.JobBoredProfileDraft = {
    SYSTEM_PROMPT: "system",
    buildUserPrompt: (t) => t,
    parseJsonSafe: (t) => JSON.parse(t),
    clampToUserProfile: (p) => p,
  };
  await env.store.saveOnboardingFlowState({ completedBeats: ["ai"] });
  await env.flow.open("resume");
  await env.beats.resume.ingestText(RESUME, "paste");
  const toasts = env.host.__calls.filter((c) => c.name === "showToast").map((c) => c.args);
  return { env, toasts };
}

describe("onboarding B3 says when the server copy wasn't saved (K1-B3)", () => {
  it("should finish the beat and show 'Saved in this browser only' when the page has no JobBored API", async () => {
    const { env, toasts } = await runB3({ putStatus: 404, putJson: null });
    assert.ok(env.flow.getState().completedBeats.includes("resume"), "the draft still completes the beat");
    const line = toasts.find((args) => /^Saved in this browser only\./.test(String(args[0])));
    assert.ok(line, `toasts: ${JSON.stringify(toasts)}`);
    assert.equal(line[1], "warning");
  });

  it("should say the server kept the previous resume when it refused the text as garbled", async () => {
    const { toasts } = await runB3({ putStatus: 422, putJson: { ok: false, reason: "resume_garbled", message: "garbled" } });
    assert.ok(toasts.some((args) => /kept your previous resume/.test(String(args[0]))), JSON.stringify(toasts));
  });

  it("should stay quiet when the server copy was saved", async () => {
    const { toasts } = await runB3({ putStatus: 200, putJson: { ok: true, savedAt: "2026-01-01T00:00:00.000Z" } });
    assert.equal(toasts.filter((args) => /Saved in this browser only/.test(String(args[0]))).length, 0);
  });
});
