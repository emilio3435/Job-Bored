import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Discovery drawer — generateDiscoverySuggestions routes
   through callConfiguredAi (VAL-PROV-011).

   The drawer no longer pins the suggestion path to a single BYO
   transport (gemini/openai/anthropic) and no longer throws an
   opaque "Switch to Gemini, OpenAI, or Anthropic" error. Instead
   it delegates to the provider-agnostic router callConfiguredAi
   exposed on drawer.host, which:

     - routes openrouter + local natively (no Gemini key required)
     - dispatches openai / anthropic / gemini to their existing
       call helpers
     - surfaces "Add your <provider> key in Settings" for missing
       keys (openrouter / openai / anthropic / gemini)
     - surfaces "doesn't support inline suggestions" for webhook

   This test loads the real discovery-drawer.js in a vm context,
   stubs the drawer.host bridge (including callConfiguredAi), and
   asserts the new routing contract. It must FAIL if the drawer
   reverts to the hardcoded gemini|openai|anthropic switch or the
   "degrade to whichever BYO key is configured" shim.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const drawerJs = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");

/**
 * Load discovery-drawer.js (a browser-global IIFE) in an isolated vm context
 * and return the drawer namespace plus hooks to drive the new routing path.
 * generateDiscoverySuggestions reaches the resume-generation config via
 * window.CommandCenterResumeGenerate and the AI transport via the lazy
 * drawer.host bridge — both stubbed here.
 *
 * callConfiguredAiStub receives the call args and may return text OR throw an
 * error. The keyless/webhook cases need the stub to throw so the test can
 * assert that the router's actionable message propagates through
 * generateDiscoverySuggestions untouched. The actual callConfiguredAi
 * message strings are covered by tests/discovery-ai-call-configured-routing.test.mjs.
 */
function loadDrawer({ genConfig, callConfiguredAiStub, calls }) {
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

  const stub =
    callConfiguredAiStub ||
    (async () => strataJson);

  drawer.host = {
    getUserContent: () => UC,
    buildCandidateProfileExcerpt: async () => "CANDIDATE PROFILE EXCERPT",
    parseJsonSafeForSuggestions: (t) => JSON.parse(t),
    callConfiguredAi: async (...args) => {
      calls.push({ args });
      return stub(...args);
    },
  };

  return { drawer, ctx };
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
  resumeGeminiModel: "gemini-3.5-flash",
  resumeOpenAIApiKey: "sk-openai-test",
  resumeOpenAIModel: "gpt-4o-mini",
  resumeAnthropicApiKey: "sk-ant-test",
  resumeAnthropicModel: "claude-sonnet-4-6",
};

describe(
  "discovery-drawer generateDiscoverySuggestions — routes through callConfiguredAi (VAL-PROV-011)",
  () => {
    it("openrouter (key set) drives the suggestion path through callConfiguredAi", async () => {
      const calls = [];
      const { drawer } = loadDrawer({
        genConfig: { ...BASE_CONFIG, provider: "openrouter" },
        calls,
      });
      const out = await drawer.generateDiscoverySuggestions(null);
      assert.equal(calls.length, 1, "callConfiguredAi must be invoked exactly once");
      const args = calls[0].args;
      assert.equal(args.length, 3, "callConfiguredAi receives (system, user, opts)");
      assert.equal(typeof args[0], "string", "first arg is the system prompt");
      assert.match(args[0], /expert career advisor/);
      assert.equal(typeof args[1], "string", "second arg is the user prompt");
      assert.match(args[1], /CANDIDATE PROFILE/);
      // GOTCHA: opts comes from a vm realm — assert the primitive field
      // directly (deepStrictEqual would fail on the cross-realm object).
      assert.equal(args[2] && args[2].json, true, "third arg carries json:true");
      assert.ok(
        out.safe && out.adjacent && out.stretch,
        "returns normalized strata from the routed response",
      );
      assert.equal(out.safe.targetRoles, "SRE");
      assert.equal(out.adjacent.targetRoles, "Platform Engineer");
      assert.equal(out.stretch.targetRoles, "Staff SRE");
    });

    it("local (no Gemini key) routes through callConfiguredAi — no Gemini key required", async () => {
      const calls = [];
      const { drawer } = loadDrawer({
        genConfig: {
          ...BASE_CONFIG,
          provider: "local",
          resumeGeminiApiKey: "",
          resumeOpenAIApiKey: "",
          resumeAnthropicApiKey: "",
        },
        calls,
      });
      const out = await drawer.generateDiscoverySuggestions(null);
      assert.equal(calls.length, 1, "callConfiguredAi must be invoked (local is supported)");
      assert.equal(typeof calls[0].args[0], "string");
      assert.equal(calls[0].args[2] && calls[0].args[2].json, true);
      assert.ok(
        out.safe && out.adjacent && out.stretch,
        "local returns normalized strata without requiring a Gemini key",
      );
    });

    it("gemini happy path still works (no regression in the BYO transport)", async () => {
      const calls = [];
      const { drawer } = loadDrawer({
        genConfig: { ...BASE_CONFIG, provider: "gemini" },
        calls,
      });
      const out = await drawer.generateDiscoverySuggestions(null);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].args[2] && calls[0].args[2].json, true);
      assert.ok(out.safe && out.adjacent && out.stretch);
      assert.equal(out.safe.targetRoles, "SRE");
    });

    it("keyless openrouter surfaces 'Add your OpenRouter key in Settings' (propagated, not opaque)", async () => {
      const calls = [];
      const { drawer } = loadDrawer({
        genConfig: { ...BASE_CONFIG, provider: "openrouter", resumeOpenRouterApiKey: "" },
        calls,
        callConfiguredAiStub: async () => {
          throw new Error("Add your OpenRouter key in Settings to use AI suggestions.");
        },
      });
      let caught;
      try {
        await drawer.generateDiscoverySuggestions(null);
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, "missing key must surface a message");
      assert.match(
        caught.message,
        /Add your OpenRouter key in Settings/,
        "must propagate the router's actionable message, not the old 'Gemini/OpenAI/Anthropic key' string",
      );
      assert.doesNotMatch(
        caught.message,
        /Gemini, OpenAI, or Anthropic/,
        "must NOT be the legacy 'degrade to BYO' error",
      );
      assert.equal(
        calls.length,
        1,
        "callConfiguredAi is invoked once and its error propagates (no opaque local throw)",
      );
    });

    it("keyless openai surfaces 'Add your OpenAI key in Settings'", async () => {
      const calls = [];
      const { drawer } = loadDrawer({
        genConfig: { ...BASE_CONFIG, provider: "openai", resumeOpenAIApiKey: "" },
        calls,
        callConfiguredAiStub: async () => {
          throw new Error("Add your OpenAI key in Settings to use AI suggestions.");
        },
      });
      let caught;
      try {
        await drawer.generateDiscoverySuggestions(null);
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, "missing key must surface a message");
      assert.match(caught.message, /Add your OpenAI key in Settings/);
      assert.equal(calls.length, 1, "callConfiguredAi is invoked and its error propagates");
    });

    it("webhook provider surfaces 'doesn't support inline suggestions'", async () => {
      const calls = [];
      const { drawer } = loadDrawer({
        genConfig: { ...BASE_CONFIG, provider: "webhook" },
        calls,
        callConfiguredAiStub: async () => {
          throw new Error(
            "Your AI provider is set to a custom webhook, which doesn't support inline suggestions. Switch to OpenRouter, Gemini, OpenAI, Anthropic, or local in Settings.",
          );
        },
      });
      let caught;
      try {
        await drawer.generateDiscoverySuggestions(null);
      } catch (e) {
        caught = e;
      }
      assert.ok(caught, "webhook must surface a message (not silently succeed)");
      assert.match(
        caught.message,
        /doesn't support inline suggestions/,
        "webhook must propagate the router's inline-suggestions message",
      );
      assert.doesNotMatch(
        caught.message,
        /Switch to Gemini, OpenAI, or Anthropic/,
        "must NOT be the legacy opaque 'Switch to …' throw",
      );
      assert.equal(calls.length, 1, "callConfiguredAi is invoked and its error propagates");
    });
  },
);
