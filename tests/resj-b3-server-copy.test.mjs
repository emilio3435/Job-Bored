import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";

/* ============================================================
   RESJ K1-B3, superseded by JOBQA: onboarding B3 used to save the
   resume to IndexedDB and copy it to the server (PUT
   /profile/resume) at upload, then report whether that copy
   landed. An upload is now staged in the wizard draft and saved
   only by B4's commit, so B3 makes no server copy and has no
   "Saved in this browser only" line to show. Fictional text only.
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

describe("onboarding B3 makes no server copy at upload (JOBQA, was K1-B3)", () => {
  it("should finish the beat without ever PUTting /profile/resume", async () => {
    const { env, toasts } = await runB3({ putStatus: 404, putJson: null });
    assert.ok(env.flow.getState().completedBeats.includes("resume"), "the draft still completes the beat");
    const puts = env.fetchImpl.calls.filter((c) => c.url.endsWith("/profile/resume"));
    assert.equal(puts.length, 0, "the saved resume changes only on B4's commit");
    assert.equal(toasts.filter((args) => /Saved in this browser only/.test(String(args[0]))).length, 0);
  });

  it("should never report a server copy, because none is made", async () => {
    const { toasts } = await runB3({ putStatus: 200, putJson: { ok: true, savedAt: "2026-01-01T00:00:00.000Z" } });
    assert.equal(toasts.filter((args) => /Saved in this browser only/.test(String(args[0]))).length, 0);
  });
});
