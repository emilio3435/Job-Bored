/**
 * SIXBEATS-2 — Beat 2's provider defaults and Beat 3's drafting call.
 *
 * NEW-11: Beat 2 pre-selected Gemini and called it "Recommended"; spec §5 B2
 *         says `OpenRouter — free` is pre-selected and recommended.
 * NEW-8:  Beat 2 pinned the alias `gemini-flash`, which Google answers with
 *         404 "models/gemini-flash is not found for API version v1beta".
 * NEW-2:  Beat 3 posted `{resumeText}` alone, so the server drafted on its
 *         own env and told a fresh install "Missing Gemini API key" after it
 *         had just verified OpenRouter (SIXBEATS2 locked decision 3).
 * NEW-7:  Resume text typed into Beat 3 was lost on refresh — the beat now
 *         writes it through the controller's draft seam (locked decision 4)
 *         and restores it from `ctx.runtime.drafts` on render.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival, makeFetchDouble, renderedText } from "./oneflow-l1-harness.mjs";

const RESUME_TEXT = "Emilio N. — Staff engineer. Ten years shipping infra.";

const DRAFT_PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative: "I build the systems other teams build on top of, and I want more of that.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  hardConstraints: { workMode: "any" },
};

function draftingFetch() {
  return makeFetchDouble((call) => {
    if (call.url.includes("/profile/from-resume")) {
      return { ok: true, json: { ok: true, profile: DRAFT_PROFILE, source: "staged_request" } };
    }
    return { ok: true, json: { ok: true } };
  });
}

/** The Beat-2-verified config, in the shape resume-generate.js publishes. */
const VERIFIED_OPENROUTER = {
  provider: "openrouter",
  resumeGeminiApiKey: "",
  resumeOpenAIApiKey: "",
  resumeAnthropicApiKey: "",
  resumeOpenRouterApiKey: "sk-or-verified-key",
  resumeGeminiModel: "gemini-3.5-flash",
  resumeOpenAIModel: "gpt-5.6-terra",
  resumeAnthropicModel: "claude-sonnet-4-6",
  resumeOpenRouterModel: "openai/gpt-oss-120b:free",
  resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
  resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
  resumeLocalModel: "gemma4:e2b",
  resumeLocalApiKey: "",
  resumeGenerationWebhookUrl: "",
};

function useGenerationConfig(env, config) {
  env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => config;
}

/** A ctx stubbed to SIXBEATS2 locked decision 4 — the draft-persistence seam. */
function draftCtx(drafts = {}) {
  const saved = [];
  return {
    saved,
    state: {},
    runtime: { drafts },
    setMessage() {},
    setBusy() {},
    clearBusy() {},
    saveDraft(key, value) {
      saved.push({ key, value });
    },
    async completeBeat() {},
    async skipBeat() {},
    goToBeat() {},
  };
}

async function openResume(options = {}) {
  const env = loadArrival({ fetchImpl: draftingFetch(), ...options });
  await env.flow.open("resume");
  return env;
}

describe("SIXBEATS-2 NEW-11 — Beat 2 recommends OpenRouter (spec §5 B2)", () => {
  it("lists OpenRouter first and pre-selects it", async () => {
    const env = loadArrival({});
    await env.flow.open("ai");
    const providers = env
      .mount()
      .querySelectorAll("[data-provider]")
      .map((el) => el.dataset.provider);
    assert.deepEqual(providers, ["openrouter", "gemini", "openai", "anthropic", "local"]);
    assert.equal(
      env.mount().querySelector('[data-provider="openrouter"]').dataset.selected,
      "true",
    );
    assert.equal(env.beats.ai.getSelectedProvider(), "openrouter");
  });

  it("puts `Recommended` on the OpenRouter card and nowhere else", async () => {
    const env = loadArrival({});
    await env.flow.open("ai");
    const cardFor = (id) => env.mount().querySelector(`[data-provider="${id}"]`).textContent;
    assert.match(cardFor("openrouter"), /Recommended/);
    for (const id of ["gemini", "openai", "anthropic", "local"]) {
      assert.equal(
        /Recommended/.test(cardFor(id)),
        false,
        `${id} must not also claim the recommendation`,
      );
    }
  });

  it("ships the spec §5 B2 sub-line, which names OpenRouter as the free path", async () => {
    const env = loadArrival({});
    await env.flow.open("ai");
    assert.ok(
      renderedText(env.mount()).includes(
        "One AI key powers everything personal here: it drafts your fit " +
          "profile from your resume on the next screen, scores every job " +
          "discovery finds, and writes your tailored resumes and cover " +
          "letters. OpenRouter is free and takes about two minutes.",
      ),
    );
  });
});

describe("SIXBEATS-2 NEW-8 — Beat 2 pins a Gemini model Google actually serves", () => {
  it("defaults Gemini to gemini-3.5-flash, not the 404-ing `gemini-flash` alias", async () => {
    const env = loadArrival({});
    await env.flow.open("ai");
    const gemini = env.beats.ai.PROVIDERS.find((p) => p.id === "gemini");
    assert.equal(gemini.defaultModel, "gemini-3.5-flash");
  });

  it("pins that model on the server when Gemini passes its check", async () => {
    const env = loadArrival({
      verifyProvider: async () => ({ ok: true, provider: "gemini", model: "gemini-3.5-flash", ms: 8 }),
    });
    await env.flow.open("ai");
    env.mount().querySelector('[data-provider="gemini"]').dispatch("click");
    env.mount().querySelector("#oneFlowAiKeyInput").value = "AIzaSyTestKeyValue1234567";
    await env.beats.ai.handleAction("ai_check");
    const pin = env.fetchImpl.calls.find((c) => c.url.includes("/api/llm-config"));
    assert.ok(pin, "the beat pins the verified provider server-side");
    assert.equal(pin.body.model, "gemini-3.5-flash");
  });
});

describe("SIXBEATS-2 NEW-2 — Beat 3 drafts through the provider Beat 2 verified", () => {
  it("sends {provider, apiKey, model, baseUrl} alongside the resume text", async () => {
    const env = await openResume();
    useGenerationConfig(env, VERIFIED_OPENROUTER);
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const call = env.fetchImpl.calls.find((c) => c.url.includes("/profile/from-resume"));
    assert.equal(call.body.resumeText, RESUME_TEXT);
    assert.equal(call.body.provider, "openrouter");
    assert.equal(call.body.apiKey, "sk-or-verified-key");
    assert.equal(call.body.model, "openai/gpt-oss-120b:free");
    assert.equal(call.body.baseUrl, "https://openrouter.ai/api/v1");
  });

  it("carries the key and model of whichever provider is configured", async () => {
    const env = await openResume();
    useGenerationConfig(env, {
      ...VERIFIED_OPENROUTER,
      provider: "gemini",
      resumeGeminiApiKey: "AIza-verified-key",
    });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const call = env.fetchImpl.calls.find((c) => c.url.includes("/profile/from-resume"));
    assert.equal(call.body.provider, "gemini");
    assert.equal(call.body.apiKey, "AIza-verified-key");
    assert.equal(call.body.model, "gemini-3.5-flash");
  });

  it("sends the local server's base URL and no key for the Local provider", async () => {
    const env = await openResume();
    useGenerationConfig(env, { ...VERIFIED_OPENROUTER, provider: "local" });
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const call = env.fetchImpl.calls.find((c) => c.url.includes("/profile/from-resume"));
    assert.equal(call.body.provider, "local");
    assert.equal(call.body.apiKey, "");
    assert.equal(call.body.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(call.body.model, "gemma4:e2b");
  });

  it("omits the provider block entirely when nothing is configured", async () => {
    const env = await openResume();
    env.window.CommandCenterResumeGenerate.getResumeGenerationConfig = () => {
      throw new Error("not loaded");
    };
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    const call = env.fetchImpl.calls.find((c) => c.url.includes("/profile/from-resume"));
    assert.equal(call.body.resumeText, RESUME_TEXT);
    assert.equal(
      "provider" in call.body,
      false,
      "a body with no provider must let the server fall back to its own env",
    );
  });
});

describe("SIXBEATS-2 NEW-7 — Beat 3 writes its drafts through the controller seam", () => {
  it("saves the pasted text on input", async () => {
    const env = await openResume();
    const ctx = draftCtx();
    const container = env.document.createElement("div");
    env.flow.getBeat("resume").render(container, ctx);
    const box = container.querySelector("#oneFlowResumePaste");
    box.value = "Half a resume so far";
    box.dispatch("input");
    assert.deepEqual(
      ctx.saved.filter((s) => s.key === "resumeText").map((s) => s.value),
      ["Half a resume so far"],
      "spec §3.2: what the user typed survives a refresh",
    );
  });

  it("saves the drafted profile once the draft is ready", async () => {
    const env = await openResume();
    useGenerationConfig(env, VERIFIED_OPENROUTER);
    const ctx = draftCtx();
    const container = env.document.createElement("div");
    env.flow.getBeat("resume").render(container, ctx);
    container.querySelector("#oneFlowResumePaste").value = RESUME_TEXT;
    await env.beats.resume.handleAction("resume_use_text", ctx);
    const saved = ctx.saved.filter((s) => s.key === "profileDraft");
    assert.equal(saved.length, 1, "B4 reads this after a refresh — NEW-14");
    assert.equal(saved[0].value.profile.identity.targetRoles[0], "Staff Engineer");
    assert.equal(saved[0].value.source, "paste");
  });

  it("saves the template draft too, so a refresh keeps the template choice", async () => {
    const env = await openResume();
    const ctx = draftCtx();
    const container = env.document.createElement("div");
    env.flow.getBeat("resume").render(container, ctx);
    await env.beats.resume.handleAction("resume_template", ctx);
    await env.beats.resume.pickTemplate("engineer");
    const saved = ctx.saved.filter((s) => s.key === "profileDraft");
    assert.equal(saved.length, 1);
    assert.equal(saved[0].value.starterTemplate, "engineer");
  });

  it("restores the resume text from ctx.runtime.drafts on render", async () => {
    const env = await openResume();
    const ctx = draftCtx({ resumeText: "Text I typed before the refresh" });
    const container = env.document.createElement("div");
    env.flow.getBeat("resume").render(container, ctx);
    assert.equal(
      container.querySelector("#oneFlowResumePaste").value,
      "Text I typed before the refresh",
    );
  });

  it("restores the drafted profile from ctx.runtime.drafts on render", async () => {
    const env = await openResume();
    const draft = { profile: DRAFT_PROFILE, source: "paste", starterTemplate: "custom" };
    const ctx = draftCtx({ profileDraft: draft });
    const container = env.document.createElement("div");
    env.flow.getBeat("resume").render(container, ctx);
    assert.deepEqual(env.beats.resume.getDraft(), draft);
  });

  it("survives a controller with no draft seam yet", async () => {
    const env = await openResume();
    useGenerationConfig(env, VERIFIED_OPENROUTER);
    await env.beats.resume.ingestText(RESUME_TEXT, "paste");
    assert.equal(env.flow.getState().beat, "fit", "no saveDraft must never block the beat");
  });
});
