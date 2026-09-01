import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { writeLlmConfig } from "../server/llm-config.mjs";
import { analyzeAtsScorecard, getAtsConfigStatus } from "../server/ats-scorecard.mjs";
import {
  analyzeResumeToProfile,
  getProfileProviderConfig,
} from "../server/profile-from-resume.mjs";
import { readFileSync } from "node:fs";

function restoreEnv(key, previous) {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

describe("ATS respects llm.json over ATS_GEMINI_MODEL", () => {
  let dir;
  const prevPath = process.env.JOBBORED_LLM_CONFIG_PATH;
  const prevModel = process.env.ATS_GEMINI_MODEL;
  const prevKey = process.env.ATS_GEMINI_API_KEY;
  const prevProvider = process.env.ATS_PROVIDER;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-ats-pin-"));
    process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
    process.env.ATS_PROVIDER = "gemini";
    process.env.ATS_GEMINI_MODEL = "gemini-2.5-flash";
    process.env.ATS_GEMINI_API_KEY = "env-key";
    await writeLlmConfig(
      { provider: "gemini", model: "gemini-3.7-flash", apiKey: "pin-key", baseUrl: "" },
      process.env,
    );
  });

  afterEach(async () => {
    restoreEnv("JOBBORED_LLM_CONFIG_PATH", prevPath);
    restoreEnv("ATS_GEMINI_MODEL", prevModel);
    restoreEnv("ATS_GEMINI_API_KEY", prevKey);
    restoreEnv("ATS_PROVIDER", prevProvider);
    await rm(dir, { recursive: true, force: true });
  });

  it("is configured from the pin, not 2.5-flash env", () => {
    const status = getAtsConfigStatus();
    assert.equal(status.configured, true);
    assert.equal(status.provider, "gemini");
    assert.notEqual(status.model, "gemini-2.5-flash");
    assert.equal(status.model, "gemini-3.7-flash");
  });

  it("profile extract reads the pin, not ATS_GEMINI_MODEL", () => {
    const profile = getProfileProviderConfig();
    assert.equal(profile.provider, "gemini");
    assert.equal(profile.model, "gemini-3.7-flash");
    assert.equal(profile.apiKey, "pin-key");
  });
});

describe("ATS is unconfigured when no pin and no migratable env", () => {
  let dir;
  const prevPath = process.env.JOBBORED_LLM_CONFIG_PATH;
  const prevModel = process.env.ATS_GEMINI_MODEL;
  const prevKey = process.env.ATS_GEMINI_API_KEY;
  const prevProvider = process.env.ATS_PROVIDER;
  const prevGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-ats-nopin-"));
    process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
    delete process.env.ATS_PROVIDER;
    delete process.env.ATS_GEMINI_MODEL;
    delete process.env.ATS_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(async () => {
    restoreEnv("JOBBORED_LLM_CONFIG_PATH", prevPath);
    restoreEnv("ATS_GEMINI_MODEL", prevModel);
    restoreEnv("ATS_GEMINI_API_KEY", prevKey);
    restoreEnv("ATS_PROVIDER", prevProvider);
    restoreEnv("GEMINI_API_KEY", prevGeminiKey);
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the Settings pin reason", () => {
    const status = getAtsConfigStatus();
    assert.equal(status.configured, false);
    assert.equal(
      status.reason,
      "No LLM pin configured. Save an AI provider in Settings.",
    );
  });
});

describe("ATS missing key after llm.json exists points at Settings", () => {
  let dir;
  const prevPath = process.env.JOBBORED_LLM_CONFIG_PATH;
  const prevModel = process.env.ATS_GEMINI_MODEL;
  const prevKey = process.env.ATS_GEMINI_API_KEY;
  const prevProvider = process.env.ATS_PROVIDER;
  const prevGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-ats-nokey-"));
    process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
    process.env.ATS_PROVIDER = "gemini";
    delete process.env.ATS_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await writeLlmConfig(
      { provider: "gemini", model: "gemini-flash", apiKey: "", baseUrl: "" },
      process.env,
    );
  });

  afterEach(async () => {
    restoreEnv("JOBBORED_LLM_CONFIG_PATH", prevPath);
    restoreEnv("ATS_GEMINI_MODEL", prevModel);
    restoreEnv("ATS_GEMINI_API_KEY", prevKey);
    restoreEnv("ATS_PROVIDER", prevProvider);
    restoreEnv("GEMINI_API_KEY", prevGeminiKey);
    await rm(dir, { recursive: true, force: true });
  });

  it("does not name ATS_GEMINI_API_KEY", () => {
    const status = getAtsConfigStatus();
    assert.equal(status.configured, false);
    assert.match(status.reason, /Settings/);
    assert.doesNotMatch(status.reason, /ATS_GEMINI_API_KEY/);
    assert.doesNotMatch(status.reason, /GEMINI_API_KEY/);
  });
});

describe("browser fallbacks no longer hardcode 3.5-flash as the product default", () => {
  it("resume-generate.js default Gemini id is gemini-flash", () => {
    const src = readFileSync(new URL("../resume-generate.js", import.meta.url), "utf8");
    assert.match(src, /gemini-flash/);
    assert.doesNotMatch(
      src,
      /resumeGeminiModel \|\| "gemini-3\.5-flash"/,
    );
  });

  it("discovery-drawer.js resolveGeminiModel last fallback is gemini-flash", () => {
    const src = readFileSync(new URL("../discovery-drawer.js", import.meta.url), "utf8");
    assert.match(src, /return "gemini-flash";/);
    assert.doesNotMatch(src, /return "gemini-3\.5-flash";/);
  });

  it("job-posting-insights.js Gemini fallback is gemini-flash", () => {
    const src = readFileSync(new URL("../job-posting-insights.js", import.meta.url), "utf8");
    assert.match(src, /resumeGeminiModel \|\| "gemini-flash"/);
    assert.doesNotMatch(src, /resumeGeminiModel \|\| "gemini-3\.5-flash"/);
  });

  it("profile-rescore-worker.mjs loads the llm.json pin", () => {
    const src = readFileSync(
      new URL("../server/profile-rescore-worker.mjs", import.meta.url),
      "utf8",
    );
    assert.match(src, /loadLlmConfig/);
    assert.match(src, /migrateLlmConfigFromEnv/);
    assert.match(src, /resolveActivePin/);
  });
});

function geminiOk(text) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const VALID_SCORECARD = {
  schemaVersion: 1,
  overallScore: 78,
  dimensionScores: {
    requirementsCoverage: 70,
    experienceRelevance: 80,
    impactClarity: 75,
    atsParseability: 88,
    toneFit: 82,
  },
  topStrengths: ["Strong React fit"],
  criticalGaps: [
    {
      gap: "Missing impact metric",
      whyItMatters: "Quantified outcomes improve ATS relevance.",
      severity: "medium",
    },
  ],
  evidence: [
    {
      claim: "Candidate shipped React features.",
      sourceSnippet: "Built React growth surfaces.",
      sourceType: "resume",
    },
  ],
  rewriteSuggestions: [
    {
      targetSection: "Opening",
      before: "Built product features.",
      after: "Built React product features with measurable impact.",
      rationale: "Adds React keyword and impact framing.",
    },
  ],
  confidence: 0.86,
  model: "gemini-3.7-flash",
};

describe("analyze-time pin resolution uses resolvedModel and pin key", () => {
  let dir;
  const prevPath = process.env.JOBBORED_LLM_CONFIG_PATH;
  const prevModel = process.env.ATS_GEMINI_MODEL;
  const prevKey = process.env.ATS_GEMINI_API_KEY;
  const prevProvider = process.env.ATS_PROVIDER;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-ats-resolve-"));
    process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
    process.env.ATS_PROVIDER = "gemini";
    process.env.ATS_GEMINI_MODEL = "gemini-2.5-flash";
    process.env.ATS_GEMINI_API_KEY = "env-key";
    await writeLlmConfig(
      { provider: "gemini", model: "gemini-flash", apiKey: "pin-key", baseUrl: "" },
      process.env,
    );
  });

  afterEach(async () => {
    restoreEnv("JOBBORED_LLM_CONFIG_PATH", prevPath);
    restoreEnv("ATS_GEMINI_MODEL", prevModel);
    restoreEnv("ATS_GEMINI_API_KEY", prevKey);
    restoreEnv("ATS_PROVIDER", prevProvider);
    await rm(dir, { recursive: true, force: true });
  });

  it("ATS Gemini HTTP uses gemini-3.7-flash and pin-key, not the env snapshot", async () => {
    const originalFetch = globalThis.fetch;
    let call;
    globalThis.fetch = async (url, init) => {
      call = { url: String(url), init };
      return geminiOk(JSON.stringify(VALID_SCORECARD));
    };
    try {
      const status = getAtsConfigStatus();
      assert.equal(status.model, "gemini-flash");
      await analyzeAtsScorecard({
        event: "command-center.ats-scorecard",
        schemaVersion: 1,
        feature: "cover_letter",
        docText:
          "This cover letter contains more than twenty characters so ATS validation can run.",
        job: { title: "Frontend Engineer", company: "Example Co" },
      });
      assert.match(call.url, /models\/gemini-3\.7-flash:generateContent/);
      assert.match(call.url, /[?&]key=pin-key(?:&|$)/);
      assert.doesNotMatch(call.url, /gemini-2\.5-flash/);
      assert.doesNotMatch(call.url, /env-key/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("profile extract Gemini HTTP uses gemini-3.7-flash and pin-key", async () => {
    const originalFetch = globalThis.fetch;
    let call;
    globalThis.fetch = async (url, init) => {
      call = { url: String(url), init };
      return geminiOk(
        JSON.stringify({
          version: 1,
          identity: {
            targetRoles: ["Frontend Engineer"],
            targetSeniority: "ic_senior",
            primaryNarrative: "I ship product features with React and TypeScript.",
          },
          strengths: [{ name: "React", rank: 1 }],
          hardConstraints: { workMode: "any" },
        }),
      );
    };
    try {
      await analyzeResumeToProfile(
        "Frontend engineer with eight years of React and TypeScript product work.",
      );
      assert.match(call.url, /models\/gemini-3\.7-flash:generateContent/);
      assert.match(call.url, /[?&]key=pin-key(?:&|$)/);
      assert.doesNotMatch(call.url, /gemini-2\.5-flash/);
      assert.doesNotMatch(call.url, /env-key/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("gemini-flash is treated as a thinking model for output budget", () => {
  function geminiFetchCapture() {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            { content: { parts: [{ text: "ok" }] }, finishReason: "STOP" },
          ],
        }),
      };
    };
    return { calls, fetchImpl };
  }

  it("discovery-drawer JSON and non-JSON gemini-flash calls budget 8192", async () => {
    const src = readFileSync(new URL("../discovery-drawer.js", import.meta.url), "utf8");
    const { calls, fetchImpl } = geminiFetchCapture();
    const ctx = {
      window: {},
      console: { log() {}, warn() {}, error() {} },
      fetch: fetchImpl,
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: "discovery-drawer.js" });
    const drawer = ctx.window.JobBoredDiscovery.drawer;
    await drawer.callDiscoveryAiGemini("sys", "user", "k", "gemini-flash");
    await drawer.callDiscoveryAiGemini("sys", "user", "k", "gemini-flash", {
      json: true,
    });
    assert.equal(calls.length, 2);
    for (const call of calls) {
      const body = JSON.parse(call.init.body);
      assert.equal(body.generationConfig.maxOutputTokens, 8192);
    }
  });

  it("resume-generate non-JSON gemini-flash drafts budget 8192", async () => {
    const src = readFileSync(new URL("../resume-generate.js", import.meta.url), "utf8");
    const { calls, fetchImpl } = geminiFetchCapture();
    const ctx = {
      window: {
        COMMAND_CENTER_CONFIG: {
          resumeProvider: "gemini",
          resumeGeminiApiKey: "k",
          resumeGeminiModel: "gemini-flash",
        },
      },
      console: { log() {}, warn() {}, error() {} },
      fetch: fetchImpl,
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: "resume-generate.js" });
    await ctx.window.CommandCenterResumeGenerate.callConfiguredAi("sys", "user");
    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.generationConfig.maxOutputTokens, 8192);
  });
});
