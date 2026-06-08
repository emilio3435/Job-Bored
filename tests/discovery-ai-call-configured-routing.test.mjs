import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Provider-agnostic AI routing for the discovery/onboarding
   suggestion path (VAL-PROV-011).

   callConfiguredAi(system, user, opts) reads the resume-generation
   config and dispatches to the configured provider's chat/completions
   call. This test loads the real discovery-drawer.js in a vm context
   with a stubbed window.CommandCenterResumeGenerate and a stubbed
   fetch, and asserts:

     1. openrouter branch POSTs to https://openrouter.ai/api/v1/chat/completions
        with bearer auth and a default openai/gpt-oss-120b:free model.
     2. local branch POSTs to http://127.0.0.1:11434/v1/chat/completions
        with the configured model and NO Authorization when no key set.
     3. openai / anthropic / gemini dispatch to their existing call
        helpers with the right key + model.
     4. webhook provider throws a clear "doesn't support inline
        suggestions" message (no fetch made).
     5. Missing key surfaces an "Add your <provider> key in Settings"
        message for openrouter / openai / anthropic / gemini.

   The router lives on window.JobBoredDiscovery.drawer.callConfiguredAi
   once discovery-drawer.js has run. We grab the drawer namespace from
   the realm and call it directly.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const drawerJs = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");

function loadRouter({ genConfig, fetchImpl }) {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
  const ctx = {
    window: {
      CommandCenterResumeGenerate: {
        getResumeGenerationConfig: () => genConfig,
      },
    },
    console: { log() {}, warn() {}, error() {} },
    fetch: fetchStub,
  };
  vm.createContext(ctx);
  vm.runInContext(drawerJs, ctx, { filename: "discovery-drawer.js" });
  const drawer = ctx.window.JobBoredDiscovery.drawer;
  return { drawer, calls };
}

const okJson = (text) => ({
  status: 200,
  ok: true,
  json: async () => ({
    choices: [{ message: { content: text } }],
  }),
});

/** Response shape for Anthropic's /v1/messages. */
const okAnthropicJson = (text) => ({
  status: 200,
  ok: true,
  json: async () => ({
    content: [{ type: "text", text }],
  }),
});

/** Response shape for Gemini's generativelanguage endpoint. */
const okGeminiJson = (text) => ({
  status: 200,
  ok: true,
  json: async () => ({
    candidates: [
      { content: { parts: [{ text }] }, finishReason: "STOP" },
    ],
  }),
});

/**
 * Pick the right mock-response shape for a given provider URL so each
 * call helper's parser finds the text. OpenAI-compatible responses use
 * the `choices[0].message.content` shape; Anthropic and Gemini have
 * their own shapes.
 */
function dispatchFetch(url) {
  const u = String(url);
  if (u.includes("anthropic.com")) return okAnthropicJson("ok");
  if (u.includes("generativelanguage.googleapis.com")) return okGeminiJson("ok");
  return okJson("ok");
}

const BASE_CONFIG = {
  provider: "openrouter",
  resumeOpenRouterApiKey: "sk-or-test",
  resumeOpenRouterModel: "openai/gpt-oss-120b:free",
  resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
  resumeLocalApiKey: "",
  resumeLocalModel: "gemma4:e2b",
  resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
  resumeGeminiApiKey: "AIza-test",
  resumeOpenAIApiKey: "sk-openai-test",
  resumeAnthropicApiKey: "sk-ant-test",
};

describe("discovery-drawer callConfiguredAi — provider-agnostic routing (VAL-PROV-011)", () => {
  it("openrouter branch POSTs to https://openrouter.ai/api/v1/chat/completions with bearer auth", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer, calls } = loadRouter({
      genConfig: { ...BASE_CONFIG, provider: "openrouter" },
      fetchImpl,
    });
    const text = await drawer.callConfiguredAi("sys", "user");
    assert.equal(text, "ok");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://openrouter.ai/api/v1/chat/completions",
      "openrouter must target the configured OpenAI-compatible base",
    );
    const headers = calls[0].init.headers;
    assert.equal(headers.Authorization, "Bearer sk-or-test");
    assert.equal(headers["Content-Type"], "application/json");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "openai/gpt-oss-120b:free");
    assert.deepEqual(body.messages, [
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
    assert.ok(
      Number.isFinite(body.max_tokens),
      "openrouter must send a max_tokens field",
    );
  });

  it("openrouter defaults the model to openai/gpt-oss-120b:free when none is set", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer, calls } = loadRouter({
      genConfig: {
        ...BASE_CONFIG,
        provider: "openrouter",
        resumeOpenRouterModel: "",
      },
      fetchImpl,
    });
    await drawer.callConfiguredAi("sys", "user");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "openai/gpt-oss-120b:free");
  });

  it("local branch POSTs to http://127.0.0.1:11434/v1/chat/completions with NO Authorization when no key set", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer, calls } = loadRouter({
      genConfig: {
        ...BASE_CONFIG,
        provider: "local",
        resumeLocalApiKey: "",
      },
      fetchImpl,
    });
    const text = await drawer.callConfiguredAi("sys", "user");
    assert.equal(text, "ok");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "http://127.0.0.1:11434/v1/chat/completions",
      "local must target the configured Ollama base",
    );
    const headers = calls[0].init.headers;
    assert.equal(
      headers.Authorization,
      undefined,
      "local must NOT send Authorization when no key is configured",
    );
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "gemma4:e2b");
  });

  it("local defaults the model to gemma4:e2b when none is set", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer, calls } = loadRouter({
      genConfig: {
        ...BASE_CONFIG,
        provider: "local",
        resumeLocalModel: "",
      },
      fetchImpl,
    });
    await drawer.callConfiguredAi("sys", "user");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, "gemma4:e2b");
  });

  it("openai branch dispatches to the existing callDiscoveryAiOpenAI helper", async () => {
    const fetchImpl = async (url) => dispatchFetch(url);
    const { drawer, calls } = loadRouter({
      genConfig: { ...BASE_CONFIG, provider: "openai" },
      fetchImpl,
    });
    const text = await drawer.callConfiguredAi("sys", "user");
    assert.equal(text, "ok");
    assert.equal(calls.length, 1);
    // The OpenAI branch posts to api.openai.com by default.
    assert.match(calls[0].url, /^https:\/\/api\.openai\.com\/v1\/chat\/completions$/);
  });

  it("anthropic branch dispatches to the existing callDiscoveryAiAnthropic helper", async () => {
    const fetchImpl = async (url) => dispatchFetch(url);
    const { drawer, calls } = loadRouter({
      genConfig: { ...BASE_CONFIG, provider: "anthropic" },
      fetchImpl,
    });
    const text = await drawer.callConfiguredAi("sys", "user");
    assert.equal(text, "ok");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.anthropic\.com\//);
  });

  it("gemini branch dispatches to the existing callDiscoveryAiGemini helper", async () => {
    const fetchImpl = async (url) => dispatchFetch(url);
    const { drawer, calls } = loadRouter({
      genConfig: { ...BASE_CONFIG, provider: "gemini" },
      fetchImpl,
    });
    const text = await drawer.callConfiguredAi("sys", "user");
    assert.equal(text, "ok");
    assert.equal(calls.length, 1);
    assert.match(
      calls[0].url,
      /^https:\/\/generativelanguage\.googleapis\.com\//,
    );
  });

  it("webhook provider throws 'doesn't support inline suggestions' and does not fetch", async () => {
    let fetchCalled = false;
    const fetchImpl = async () => {
      fetchCalled = true;
      return okJson("ok");
    };
    const { drawer } = loadRouter({
      genConfig: { ...BASE_CONFIG, provider: "webhook" },
      fetchImpl,
    });
    let caught;
    try {
      await drawer.callConfiguredAi("sys", "user");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "webhook provider must throw, not silently succeed");
    assert.match(
      caught.message,
      /doesn't support inline suggestions/i,
      "webhook provider must surface a clear 'inline suggestions' message",
    );
    assert.equal(
      fetchCalled,
      false,
      "webhook provider must not invoke fetch — it can't do inline suggestions",
    );
  });

  it("missing openrouter key throws 'Add your OpenRouter key in Settings'", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer, calls } = loadRouter({
      genConfig: {
        ...BASE_CONFIG,
        provider: "openrouter",
        resumeOpenRouterApiKey: "",
      },
      fetchImpl,
    });
    let caught;
    try {
      await drawer.callConfiguredAi("sys", "user");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "missing key must throw an actionable message");
    assert.match(
      caught.message,
      /Add your OpenRouter key in Settings/,
      "must name the provider so the user knows where to set it",
    );
    assert.equal(calls.length, 0, "no fetch must be made when key is missing");
  });

  it("missing openai key throws 'Add your OpenAI key in Settings'", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer } = loadRouter({
      genConfig: { ...BASE_CONFIG, provider: "openai", resumeOpenAIApiKey: "" },
      fetchImpl,
    });
    let caught;
    try {
      await drawer.callConfiguredAi("sys", "user");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "missing key must throw an actionable message");
    assert.match(caught.message, /Add your OpenAI key in Settings/);
  });

  it("missing anthropic key throws 'Add your Anthropic key in Settings'", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer } = loadRouter({
      genConfig: {
        ...BASE_CONFIG,
        provider: "anthropic",
        resumeAnthropicApiKey: "",
      },
      fetchImpl,
    });
    let caught;
    try {
      await drawer.callConfiguredAi("sys", "user");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "missing key must throw an actionable message");
    assert.match(caught.message, /Add your Anthropic key in Settings/);
  });

  it("missing gemini key throws 'Add your Gemini key in Settings'", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer } = loadRouter({
      genConfig: {
        ...BASE_CONFIG,
        provider: "gemini",
        resumeGeminiApiKey: "",
      },
      fetchImpl,
    });
    let caught;
    try {
      await drawer.callConfiguredAi("sys", "user");
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "missing key must throw an actionable message");
    assert.match(caught.message, /Add your Gemini key in Settings/);
  });

  it("local provider does NOT require a key (base URL + model suffice)", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer, calls } = loadRouter({
      genConfig: {
        ...BASE_CONFIG,
        provider: "local",
        resumeLocalApiKey: "",
      },
      fetchImpl,
    });
    // No throw expected: local servers (Ollama) usually need no key.
    const text = await drawer.callConfiguredAi("sys", "user");
    assert.equal(text, "ok");
    assert.equal(calls.length, 1);
  });

  it("opts.json bumps the output token cap for OpenAI-compatible providers", async () => {
    const fetchImpl = async () => okJson("ok");
    const { drawer, calls } = loadRouter({
      genConfig: { ...BASE_CONFIG, provider: "openrouter" },
      fetchImpl,
    });
    await drawer.callConfiguredAi("sys", "user", { json: true });
    const body = JSON.parse(calls[0].init.body);
    assert.ok(
      body.max_tokens >= 4096,
      "json:true must raise the max_tokens cap (>= 4096) so longer JSON responses aren't truncated",
    );
  });
});
