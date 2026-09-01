import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLlmConfig } from "../server/llm-config.mjs";
import { getAtsConfigStatus } from "../server/ats-scorecard.mjs";
import { getProfileProviderConfig } from "../server/profile-from-resume.mjs";
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
