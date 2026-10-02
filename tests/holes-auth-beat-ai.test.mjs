import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadArrival } from "./oneflow-l1-harness.mjs";

/* ============================================================
   HOLES AUTH — Beat 2 (AI) keeps a key only once it passes its check.

   A5 a typed key is checked live; when it fails, the provider that
      worked before is put back, in storage and in the live config.

   Against the real beat in the L1 arrival sandbox.
   ============================================================ */

describe("A5 · the AI step verifies a key before it keeps it", () => {
  const WORKING = {
    resumeProvider: "gemini",
    resumeGeminiApiKey: "AIza-example-working",
    resumeGeminiModel: "gemini-flash",
  };

  async function openAi(options) {
    const env = loadArrival({ config: { ...WORKING }, ...options });
    await env.flow.open("ai");
    return env;
  }

  function startCheck(env, provider, value) {
    env.mount().querySelector(`[data-provider="${provider}"]`).dispatch("click");
    const field = env.mount().querySelector("#oneFlowAiKeyInput");
    field.value = value;
    field.dispatch("input", { target: field });
    return env.beats.ai.handleAction("ai_check");
  }

  function stored(env) {
    return Object.assign(
      {},
      ...env.host.__calls
        .filter((c) => c.name === "mergeStoredConfigOverridePatch")
        .map((c) => c.args[0]),
    );
  }

  it("checks the typed key, then puts the working provider back when it fails", async () => {
    const checked = [];
    const env = await openAi({
      verifyProvider: async (_opts, win) => {
        checked.push(win.COMMAND_CENTER_CONFIG.resumeProvider);
        return { ok: false, provider: "openrouter", message: "OpenRouter HTTP 401" };
      },
    });
    await startCheck(env, "openrouter", "sk-or-typo-example");

    assert.deepEqual(checked, ["openrouter"], "the typed key is what gets checked");
    assert.equal(stored(env).resumeProvider, "gemini", "storage keeps the working provider");
    assert.notEqual(stored(env).resumeOpenRouterApiKey, "sk-or-typo-example");
    assert.equal(env.window.COMMAND_CENTER_CONFIG.resumeProvider, "gemini");
    assert.equal(env.window.COMMAND_CENTER_CONFIG.resumeGeminiApiKey, "AIza-example-working");
    assert.notEqual(env.window.COMMAND_CENTER_CONFIG.resumeOpenRouterApiKey, "sk-or-typo-example");
    assert.equal(env.flow.getState().completedBeats.includes("ai"), false);
  });

  it("rolls back to the provider that worked, not to an earlier failed try", async () => {
    let releaseFirst;
    const answers = [
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
      Promise.resolve({ ok: false, provider: "openai", message: "OpenAI HTTP 401" }),
    ];
    const env = await openAi({ verifyProvider: async () => answers.shift() });

    const first = startCheck(env, "openrouter", "sk-or-typo-example");
    await startCheck(env, "openai", "sk-typo-example");
    releaseFirst({ ok: false, provider: "openrouter", message: "OpenRouter HTTP 401" });
    await first;

    assert.equal(stored(env).resumeProvider, "gemini");
    assert.notEqual(stored(env).resumeOpenRouterApiKey, "sk-or-typo-example");
    assert.notEqual(stored(env).resumeOpenAIApiKey, "sk-typo-example");
    assert.equal(env.window.COMMAND_CENTER_CONFIG.resumeProvider, "gemini");
  });

  it("keeps a key that passes", async () => {
    const env = await openAi();
    await startCheck(env, "openrouter", "sk-or-good-example");
    assert.equal(stored(env).resumeProvider, "openrouter");
    assert.equal(stored(env).resumeOpenRouterApiKey, "sk-or-good-example");
  });
});
