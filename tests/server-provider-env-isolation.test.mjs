import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeAtsScorecard,
  getAtsConfigStatus,
  getProviderConfigFromEnv,
} from "../server/ats-scorecard.mjs";
import { getProfileProviderConfig } from "../server/profile-from-resume.mjs";
import { getProfileRescoreProviderConfigFromEnv } from "../server/profile-rescore-worker.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const AMBIENT_KEY = "sk-ambient-openai-key-should-never-forward";

const ATS_ENV_KEYS = [
  "ATS_PROVIDER",
  "ATS_GEMINI_API_KEY",
  "GEMINI_API_KEY",
  "ATS_GEMINI_MODEL",
  "ATS_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "ATS_OPENAI_MODEL",
  "ATS_ANTHROPIC_API_KEY",
  "ANTHROPIC_API_KEY",
  "ATS_ANTHROPIC_MODEL",
  "ATS_OPENROUTER_API_KEY",
  "OPENROUTER_API_KEY",
  "ATS_OPENROUTER_MODEL",
  "OPENROUTER_MODEL",
  "ATS_OPENROUTER_BASE_URL",
  "OPENROUTER_BASE_URL",
  "ATS_OPENAI_COMPATIBLE_API_KEY",
  "ATS_OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPATIBLE_API_KEY",
  "ATS_OPENAI_COMPATIBLE_MODEL",
  "ATS_OPENAI_COMPAT_MODEL",
  "OPENAI_COMPATIBLE_MODEL",
  "ATS_OPENAI_COMPATIBLE_BASE_URL",
  "ATS_OPENAI_COMPAT_BASE_URL",
  "OPENAI_COMPATIBLE_BASE_URL",
  "OPENAI_BASE_URL",
  "PROFILE_PROVIDER",
  "PROFILE_LLM_PROVIDER",
  "PROFILE_OPENAI_API_KEY",
  "PROFILE_OPENAI_COMPATIBLE_API_KEY",
  "PROFILE_LOCAL_API_KEY",
  "LOCAL_LLM_API_KEY",
  "PROFILE_RESCORE_PROVIDER",
  "PROFILE_RESCORE_OPENAI_API_KEY",
  "PROFILE_RESCORE_LOCAL_API_KEY",
  "PROFILE_RESCORE_OPENAI_COMPATIBLE_API_KEY",
  "LOCAL_AI_API_KEY",
  "ATS_PROVIDER_TIMEOUT_MS",
];

/** @param {Record<string, string | undefined>} [overrides] */
function setIsolatedEnv(overrides = {}) {
  const previous = Object.fromEntries(
    ATS_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of ATS_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function buildPayload() {
  return {
    event: "command-center.ats-scorecard",
    schemaVersion: 1,
    feature: "cover_letter",
    docText:
      "This cover letter contains more than twenty characters so ATS validation can run.",
    job: {
      title: "Frontend Engineer",
      company: "Example Co",
      url: "https://example.com/jobs/frontend-engineer",
    },
  };
}

describe("F0D-F07-AMBIENT openai-compatible key isolation", () => {
  it("does not treat ambient OPENAI_API_KEY as openai_compatible config", () => {
    const restore = setIsolatedEnv({
      ATS_PROVIDER: "openai_compatible",
      OPENAI_API_KEY: AMBIENT_KEY,
    });
    try {
      const cfg = getProviderConfigFromEnv();
      const status = getAtsConfigStatus();
      assert.equal(cfg.provider, "openai_compatible");
      assert.equal(cfg.openAICompatibleApiKey, "");
      assert.equal(status.configured, false);
    } finally {
      restore();
    }
  });

  it("does not forward ambient OPENAI_API_KEY to a configured compatible endpoint", async () => {
    const restore = setIsolatedEnv({
      ATS_PROVIDER: "openai_compatible",
      OPENAI_API_KEY: AMBIENT_KEY,
      ATS_OPENAI_COMPATIBLE_MODEL: "local-model",
      ATS_OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    const originalFetch = globalThis.fetch;
    /** @type {{ url?: string, init?: RequestInit }} */
    let call = {};
    globalThis.fetch = async (url, init) => {
      call = { url: String(url), init };
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  schemaVersion: 1,
                  overallScore: 70,
                  dimensionScores: {
                    requirementsCoverage: 70,
                    experienceRelevance: 70,
                    impactClarity: 70,
                    atsParseability: 70,
                    toneFit: 70,
                  },
                  topStrengths: ["ok"],
                  criticalGaps: [
                    {
                      gap: "gap",
                      whyItMatters: "why",
                      severity: "low",
                    },
                  ],
                  evidence: [
                    {
                      claim: "claim",
                      sourceSnippet: "snippet",
                      sourceType: "resume",
                    },
                  ],
                  rewriteSuggestions: [
                    {
                      targetSection: "Opening",
                      before: "before",
                      after: "after",
                      rationale: "rationale",
                    },
                  ],
                  confidence: 0.5,
                  model: "local-model",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    try {
      const cfg = getProviderConfigFromEnv();
      assert.equal(cfg.openAICompatibleApiKey, "");
      await analyzeAtsScorecard(buildPayload());
      const headers = /** @type {Record<string, string>} */ (call.init?.headers || {});
      const authorization = headers.Authorization || headers.authorization || "";
      assert.equal(authorization, "");
      assert.doesNotMatch(authorization, new RegExp(AMBIENT_KEY));
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("does not use ambient OPENAI_API_KEY for profile-from-resume compatible providers", () => {
    const restore = setIsolatedEnv({
      PROFILE_PROVIDER: "openai_compatible",
      OPENAI_API_KEY: AMBIENT_KEY,
    });
    try {
      const cfg = getProfileProviderConfig();
      assert.equal(cfg.apiKey, "");
    } finally {
      restore();
    }
  });

  it("does not use ambient OPENAI_API_KEY for profile rescore compatible providers", () => {
    const cfg = getProfileRescoreProviderConfigFromEnv({
      PROFILE_RESCORE_PROVIDER: "openai_compatible",
      OPENAI_API_KEY: AMBIENT_KEY,
      PROFILE_RESCORE_OPENAI_COMPATIBLE_MODEL: "local-model",
      PROFILE_RESCORE_OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    assert.equal(cfg.apiKey, "");
  });

  it("does not document ambient OPENAI_API_KEY as an openai_compatible alias", () => {
    const example = readFileSync(join(repoRoot, "server", "ats-env.example"), "utf8");
    const compatibleBlock = example.slice(
      example.indexOf("openai_compatible"),
      example.indexOf("ATS_GEMINI_API_KEY"),
    );
    assert.doesNotMatch(
      compatibleBlock,
      /OPENAI_API_KEY=/,
      "ats-env.example must not instruct forwarding OPENAI_API_KEY to compatible endpoints",
    );
  });
});
