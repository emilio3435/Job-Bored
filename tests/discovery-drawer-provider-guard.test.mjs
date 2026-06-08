import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const drawerJs = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");

/**
 * Load discovery-drawer.js (a browser-global IIFE) in an isolated vm context
 * and return the drawer namespace plus hooks to drive its provider switch.
 * generateDiscoverySuggestions reaches the resume-generation config via
 * window.CommandCenterResumeGenerate, routes through callConfiguredAi(), and
 * reaches profile helpers via the lazy drawer.host bridge.
 */
function loadDrawer({ genConfig, fetchImpl }) {
  const fetchCalls = [];
  const ctx = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(drawerJs, ctx, { filename: "discovery-drawer.js" });
  const drawer = ctx.window.JobBoredDiscovery.drawer;

  ctx.window.CommandCenterResumeGenerate = {
    getResumeGenerationConfig: () => genConfig,
  };

  const UC = {
    async openDb() {},
    async getDiscoveryProfile() {
      return {};
    },
  };

  drawer.host = {
    getUserContent: () => UC,
    buildCandidateProfileExcerpt: async () => "CANDIDATE PROFILE EXCERPT",
    parseJsonSafeForSuggestions: (t) => JSON.parse(t),
  };

  return { drawer, ctx, fetchCalls };
}

const okOpenAiCompatibleJson = (text) => ({
  status: 200,
  ok: true,
  json: async () => ({
    choices: [{ message: { content: text } }],
  }),
});

const okGeminiJson = (text) => ({
  status: 200,
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  }),
});

const BASE_CONFIG = {
  provider: "gemini",
  resumeGeminiApiKey: "",
  resumeOpenAIApiKey: "",
  resumeAnthropicApiKey: "",
  resumeOpenRouterApiKey: "",
  resumeOpenRouterModel: "openai/gpt-oss-120b:free",
  resumeOpenRouterBaseUrl: "https://openrouter.ai/api/v1",
  resumeLocalApiKey: "",
  resumeLocalModel: "gemma4:e2b",
  resumeLocalBaseUrl: "http://127.0.0.1:11434/v1",
  resumeGeminiModel: "gemini-3.5-flash",
  resumeOpenAIModel: "gpt-4o-mini",
  resumeAnthropicModel: "claude-sonnet-4-6",
};

describe("discovery-drawer generateDiscoverySuggestions — provider guard (VAL-PROV-011)", () => {
  it("openrouter provider routes directly through OpenRouter chat/completions", async () => {
    const { drawer, fetchCalls } = loadDrawer({
      genConfig: {
        ...BASE_CONFIG,
        provider: "openrouter",
        resumeOpenRouterApiKey: "sk-or-test",
      },
      fetchImpl: async () => okOpenAiCompatibleJson(JSON.stringify({
        safe: { targetRoles: "SRE" },
        adjacent: { targetRoles: "Platform Engineer" },
        stretch: { targetRoles: "Staff SRE" },
      })),
    });
    const out = await drawer.generateDiscoverySuggestions(null);
    assert.equal(fetchCalls.length, 1);
    assert.equal(
      fetchCalls[0].url,
      "https://openrouter.ai/api/v1/chat/completions",
    );
    assert.equal(fetchCalls[0].init.headers.Authorization, "Bearer sk-or-test");
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.model, "openai/gpt-oss-120b:free");
    assert.ok(body.max_tokens >= 4096, "json:true should raise max_tokens");
    assert.ok(out.safe && out.adjacent && out.stretch, "returns normalized strata");
  });

  it("local provider routes directly through the local OpenAI-compatible endpoint", async () => {
    const { drawer, fetchCalls } = loadDrawer({
      genConfig: {
        ...BASE_CONFIG,
        provider: "local",
        resumeLocalApiKey: "",
      },
      fetchImpl: async () => okOpenAiCompatibleJson(JSON.stringify({
        safe: { targetRoles: "SRE" },
        adjacent: { targetRoles: "Platform Engineer" },
        stretch: { targetRoles: "Staff SRE" },
      })),
    });
    const out = await drawer.generateDiscoverySuggestions(null);
    assert.equal(fetchCalls.length, 1);
    assert.equal(
      fetchCalls[0].url,
      "http://127.0.0.1:11434/v1/chat/completions",
    );
    assert.equal(fetchCalls[0].init.headers.Authorization, undefined);
    const body = JSON.parse(fetchCalls[0].init.body);
    assert.equal(body.model, "gemma4:e2b");
    assert.ok(out.safe && out.adjacent && out.stretch);
  });

  it("openrouter provider with no OpenRouter key does not fall back to a Gemini key", async () => {
    const { drawer } = loadDrawer({
      genConfig: {
        ...BASE_CONFIG,
        provider: "openrouter",
        resumeOpenRouterApiKey: "",
        resumeGeminiApiKey: "g-key",
      },
      fetchImpl: async () => okOpenAiCompatibleJson("{}"),
    });
    await assert.rejects(
      () => drawer.generateDiscoverySuggestions(null),
      /Add your OpenRouter key in Settings/,
    );
  });

  it("webhook provider surfaces the inline-suggestions message without fetch", async () => {
    let fetchCalled = false;
    const { drawer } = loadDrawer({
      genConfig: { ...BASE_CONFIG, provider: "webhook" },
      fetchImpl: async () => {
        fetchCalled = true;
        return okOpenAiCompatibleJson("{}");
      },
    });
    await assert.rejects(
      () => drawer.generateDiscoverySuggestions(null),
      /doesn't support inline suggestions/i,
    );
    assert.equal(fetchCalled, false);
  });

  it("does not regress the existing gemini path", async () => {
    const { drawer, fetchCalls } = loadDrawer({
      genConfig: { ...BASE_CONFIG, provider: "gemini", resumeGeminiApiKey: "g-key" },
      fetchImpl: async () => okGeminiJson(JSON.stringify({
        safe: { targetRoles: "SRE" },
        adjacent: { targetRoles: "Platform Engineer" },
        stretch: { targetRoles: "Staff SRE" },
      })),
    });
    const out = await drawer.generateDiscoverySuggestions(null);
    assert.equal(fetchCalls.length, 1);
    assert.match(
      fetchCalls[0].url,
      /^https:\/\/generativelanguage\.googleapis\.com\//,
    );
    assert.ok(out.safe && out.adjacent && out.stretch);
  });
});
