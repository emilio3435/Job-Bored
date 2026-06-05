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
 * window.CommandCenterResumeGenerate and its collaborators via the lazy
 * drawer.host bridge — both stubbed here.
 */
function loadDrawer({ genConfig, aiCalls }) {
  const ctx = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
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

  const strataJson = JSON.stringify({
    safe: { targetRoles: "SRE" },
    adjacent: { targetRoles: "Platform Engineer" },
    stretch: { targetRoles: "Staff SRE" },
  });

  drawer.host = {
    getUserContent: () => UC,
    buildCandidateProfileExcerpt: async () => "CANDIDATE PROFILE EXCERPT",
    parseJsonSafeForSuggestions: (t) => JSON.parse(t),
    callDiscoveryAiGemini: async (...args) => {
      aiCalls.push({ provider: "gemini", args });
      return strataJson;
    },
    callDiscoveryAiOpenAI: async (...args) => {
      aiCalls.push({ provider: "openai", args });
      return strataJson;
    },
    callDiscoveryAiAnthropic: async (...args) => {
      aiCalls.push({ provider: "anthropic", args });
      return strataJson;
    },
  };

  return { drawer, ctx };
}

const BASE_CONFIG = {
  provider: "gemini",
  resumeGeminiApiKey: "",
  resumeOpenAIApiKey: "",
  resumeAnthropicApiKey: "",
  resumeGeminiModel: "gemini-3.5-flash",
  resumeOpenAIModel: "gpt-4o-mini",
  resumeAnthropicModel: "claude-sonnet-4-6",
};

describe("discovery-drawer generateDiscoverySuggestions — provider guard (VAL-PROV-011)", () => {
  it("local provider with a Gemini key degrades to the Gemini path (no throw)", async () => {
    const aiCalls = [];
    const { drawer } = loadDrawer({
      genConfig: { ...BASE_CONFIG, provider: "local", resumeGeminiApiKey: "g-key" },
      aiCalls,
    });
    const out = await drawer.generateDiscoverySuggestions(null);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].provider, "gemini", "falls back to the Gemini transport");
    assert.equal(aiCalls[0].args[2], "g-key", "passes the configured Gemini key");
    assert.ok(out.safe && out.adjacent && out.stretch, "returns normalized strata");
  });

  it("openrouter provider with a Gemini key degrades to the Gemini path (no throw)", async () => {
    const aiCalls = [];
    const { drawer } = loadDrawer({
      genConfig: {
        ...BASE_CONFIG,
        provider: "openrouter",
        resumeGeminiApiKey: "g-key",
      },
      aiCalls,
    });
    const out = await drawer.generateDiscoverySuggestions(null);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].provider, "gemini");
    assert.ok(out.safe && out.adjacent && out.stretch);
  });

  it("local provider with only an OpenAI key falls back to the OpenAI path", async () => {
    const aiCalls = [];
    const { drawer } = loadDrawer({
      genConfig: {
        ...BASE_CONFIG,
        provider: "local",
        resumeOpenAIApiKey: "o-key",
      },
      aiCalls,
    });
    await drawer.generateDiscoverySuggestions(null);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].provider, "openai");
  });

  it("a new provider with no BYO key surfaces a clear, actionable message (not an opaque throw)", async () => {
    const aiCalls = [];
    const { drawer } = loadDrawer({
      genConfig: { ...BASE_CONFIG, provider: "openrouter" },
      aiCalls,
    });
    let caught;
    try {
      await drawer.generateDiscoverySuggestions(null);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, "must surface a message when no BYO key is configured");
    assert.equal(aiCalls.length, 0, "no AI transport is invoked without a key");
    assert.match(caught.message, /Gemini/i);
    assert.match(caught.message, /OpenAI/i);
    assert.match(caught.message, /Anthropic/i);
    assert.match(caught.message, /key/i);
  });

  it("does not regress the existing gemini path", async () => {
    const aiCalls = [];
    const { drawer } = loadDrawer({
      genConfig: { ...BASE_CONFIG, provider: "gemini", resumeGeminiApiKey: "g-key" },
      aiCalls,
    });
    const out = await drawer.generateDiscoverySuggestions(null);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].provider, "gemini");
    assert.ok(out.safe && out.adjacent && out.stretch);
  });
});
