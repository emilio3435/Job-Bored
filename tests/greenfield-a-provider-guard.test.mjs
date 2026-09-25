/**
 * GREENFIELD lane A — Beat 3 drafts only with a provider Beat 2 verified
 * (GREENFIELD-SPEC §1 F1, claims A3 and A4).
 *
 * A3 · client guard. `verifiedProviderConfig()` is the beat's own answer to
 *      "is there a provider to draft with?", and it must say NO for a
 *      provider that was never given a key (or, for Local, never given a
 *      base URL). "Draft from this text" then makes no request at all and
 *      offers the one fix that works: go connect one on the AI beat.
 * A4 · server reasons. The server can still answer *_not_configured — an
 *      install whose key was blanked after Beat 2, or a stale server env.
 *      That is the same situation, so it gets the same locked copy and the
 *      same button, never the server's own wording.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";

const RESUME_TEXT = "Emilio N. — Staff engineer. Ten years shipping infra.";

const DRAFT_PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative: "I build the systems other teams build on top of.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  hardConstraints: { workMode: "any" },
};

/** The locked copy §4.1 gives BOTH the controller gate and this beat. */
const CONNECT_AI_COPY =
  "Connect an AI provider first — your resume is drafted with it.";

/** A config in the shape resume-generate.js publishes, with a live key. */
const VERIFIED_OPENROUTER = {
  provider: "openrouter",
  resumeGeminiApiKey: "",
  resumeOpenAIApiKey: "",
  resumeAnthropicApiKey: "",
  resumeOpenRouterApiKey: "sk-or-verified-key",
  resumeGeminiModel: "gemini-3.5-flash",
  resumeOpenRouterModel: "openai/gpt-oss-120b:free",
  resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
  resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
  resumeLocalModel: "gemma4:e2b",
  resumeLocalApiKey: "",
};

function draftingFetch(fromResume) {
  return makeFetchDouble((call) => {
    if (call.url.includes("/profile/from-resume")) {
      if (typeof fromResume === "function") return fromResume(call);
      return { ok: true, json: { ok: true, profile: DRAFT_PROFILE } };
    }
    return { ok: true, json: { ok: true } };
  });
}

/** Beat 3, legitimately reached: Beat 2 is recorded complete (§4.1 gate). */
async function openResume(options = {}) {
  const env = loadArrival({ fetchImpl: draftingFetch(options.fromResume), ...options });
  // Beat 2 only: recording "google" without a configured sheet is what
  // reconcileStaleCompletion exists to undo, and it would wipe the seed.
  await env.store.saveOnboardingFlowState({ completedBeats: ["ai"] });
  await env.flow.open("resume");
  return env;
}

function useGenerationConfig(env, config) {
  env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => config;
}

function providerConfig(env) {
  return env.beats.resume.verifiedProviderConfig();
}

function draftCalls(env) {
  return env.fetchImpl.calls.filter((c) => c.url.includes("/profile/from-resume"));
}

function message(env) {
  return env.mount().querySelector(".discovery-setup-wizard__message");
}

function connectButton(env) {
  return env.mount().querySelector('[data-action-id="resume_connect_ai"]');
}

function openBeatId(env) {
  const bodies = env.mount().querySelectorAll(".oneflow-beat");
  const last = bodies[bodies.length - 1];
  return last ? last.dataset.beatId : "";
}

describe("GREENFIELD A3 — verifiedProviderConfig() answers for a USABLE provider", () => {
  it("A3-UNSET: nothing configured is not a provider", async () => {
    const env = await openResume();
    assert.equal(
      providerConfig(env),
      null,
      "getResumeGenerationConfig() defaults a provider name; a name is not a key",
    );
  });

  it("A3-EMPTY-KEY: a named provider with no key is not a provider", async () => {
    const env = await openResume();
    useGenerationConfig(env, { ...VERIFIED_OPENROUTER, resumeOpenRouterApiKey: "" });
    assert.equal(providerConfig(env), null);
  });

  it("A3-EMPTY-LOCAL: Local with no base URL is not a provider", async () => {
    const env = await openResume();
    useGenerationConfig(env, {
      ...VERIFIED_OPENROUTER,
      provider: "local",
      resumeLocalBaseUrl: "",
    });
    assert.equal(providerConfig(env), null, "Local's credential IS its base URL");
  });

  it("A3-LOCAL-OK: Local with a base URL and no key IS a provider", async () => {
    const env = await openResume();
    useGenerationConfig(env, { ...VERIFIED_OPENROUTER, provider: "local" });
    assert.deepEqual(
      JSON.parse(JSON.stringify(providerConfig(env))),
      {
        provider: "local",
        apiKey: "",
        model: "gemma4:e2b",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    );
  });

  it("A3-VERIFIED: a keyed provider is carried into the POST body", async () => {
    const env = await openResume();
    useGenerationConfig(env, VERIFIED_OPENROUTER);
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const call = draftCalls(env)[0];
    assert.equal(call.body.provider, "openrouter");
    assert.equal(call.body.apiKey, "sk-or-verified-key");
  });
});

describe("GREENFIELD A3 — an unverified provider costs no request", () => {
  it("A3-NO-FETCH: \"Draft from this text\" makes no /profile/from-resume call", async () => {
    const env = await openResume();
    env.mount().querySelector("#oneFlowResumePaste").value = RESUME_TEXT;
    await env.beats.resume.handleAction("resume_use_text");
    assert.equal(
      draftCalls(env).length,
      0,
      "there is nothing to draft WITH — asking the server is a guaranteed error",
    );
  });

  it("A3-COPY: the locked copy is what the user reads", async () => {
    const env = await openResume();
    env.mount().querySelector("#oneFlowResumePaste").value = RESUME_TEXT;
    await env.beats.resume.handleAction("resume_use_text");
    assert.equal(message(env).textContent, CONNECT_AI_COPY);
  });

  it("A3-BUTTON: the fix is one button away, and it lands on the AI beat", async () => {
    const env = await openResume();
    env.mount().querySelector("#oneFlowResumePaste").value = RESUME_TEXT;
    await env.beats.resume.handleAction("resume_use_text");
    assert.ok(connectButton(env), "spec §4.6 E1: a button that lands on the AI beat");
    await env.beats.resume.handleAction("resume_connect_ai");
    assert.equal(openBeatId(env), "ai");
  });

  it("A3-NOT-COMPLETE: a beat that drafted nothing is not complete", async () => {
    const env = await openResume();
    env.mount().querySelector("#oneFlowResumePaste").value = RESUME_TEXT;
    await env.beats.resume.handleAction("resume_use_text");
    assert.equal(env.flow.getState().completedBeats.includes("resume"), false);
  });

  it("A3-RESUME-KEPT: the pasted resume still reaches the browser store", async () => {
    const env = await openResume();
    env.mount().querySelector("#oneFlowResumePaste").value = RESUME_TEXT;
    await env.beats.resume.handleAction("resume_use_text");
    assert.equal(
      env.beats.resume.getWriteOrder().join(","),
      "indexeddb",
      "refusing to draft must never cost the upload — that is the keystone bug",
    );
  });
});

describe("GREENFIELD A4 — the server's *_not_configured is the same situation", () => {
  for (const reason of ["gemini_not_configured", "profile_provider_not_configured"]) {
    it(`A4-${reason}: renders the locked copy, not the server's wording`, async () => {
      const env = await openResume({
        fromResume: () => ({
          ok: false,
          status: 409,
          json: {
            ok: false,
            reason,
            message: "Missing Gemini API key. Go back and reconnect Gemini.",
          },
        }),
      });
      useGenerationConfig(env, VERIFIED_OPENROUTER);
      await env.beats.resume.ingestText(RESUME_TEXT, "paste");
      assert.equal(message(env).textContent, CONNECT_AI_COPY);
      assert.ok(connectButton(env), "the same button as A3");
      await env.beats.resume.handleAction("resume_connect_ai");
      assert.equal(openBeatId(env), "ai");
    });
  }

  it("A4-GENUINE: a real provider failure still surfaces verbatim", async () => {
    const env = await openResume({
      fromResume: () => ({
        ok: false,
        status: 500,
        json: { ok: false, reason: "profile_provider_error", message: "Rate limit reached" },
      }),
    });
    useGenerationConfig(env, VERIFIED_OPENROUTER);
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.equal(message(env).textContent, "Rate limit reached");
    assert.equal(connectButton(env), null, "connecting a provider is not the fix here");
  });

  it("A4-404: the missing-resume 404 keeps its own copy", async () => {
    const env = await openResume({
      fromResume: () => ({ ok: false, status: 404, json: { ok: false, reason: "no_resume_stored" } }),
    });
    useGenerationConfig(env, VERIFIED_OPENROUTER);
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.match(message(env).textContent, /nothing came through/);
    assert.equal(connectButton(env), null);
  });
});
