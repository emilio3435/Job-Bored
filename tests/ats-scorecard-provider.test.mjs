import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeAtsScorecard, getAtsConfigStatus } from "../server/ats-scorecard.mjs";

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
      fitAssessment: "Strong JavaScript and React fit.",
      talkingPoints: "Fast iteration, metrics ownership.",
      notes: "Emphasize measurable outcomes.",
      postingEnrichment: {
        description: "Ship product features with React and TypeScript.",
        requirements: ["3+ years of frontend experience"],
        skills: ["JavaScript", "TypeScript", "React"],
        mustHaves: ["React"],
        responsibilities: ["Ship product features"],
        toolsAndStack: ["React", "TypeScript"],
      },
    },
    profile: {
      candidateProfileText: "Frontend engineer with analytics ownership.",
      resumeSourceText: "Built React growth surfaces.",
      linkedinProfileText: "",
      additionalContextText: "",
    },
    instructions: {
      userNotes: "Keep it concise.",
      refinementFeedback: "",
    },
  };
}

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
];

function setTestProviderEnv(overrides = {}) {
  const previous = Object.fromEntries(
    ATS_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of ATS_ENV_KEYS) delete process.env[key];
  const next = {
    ATS_PROVIDER: "gemini",
    ATS_GEMINI_API_KEY: "test-key",
    ATS_GEMINI_MODEL: "gemini-test",
    ...overrides,
  };
  for (const [key, value] of Object.entries(next)) {
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

function buildGeminiSuccessResponse(text) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function buildChatCompletionsSuccessResponse(text) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function buildAnthropicSuccessResponse(text) {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function buildValidScorecard() {
  return {
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
    model: "gemini-test",
  };
}

describe("analyzeAtsScorecard provider routing", () => {
  it("routes ATS_PROVIDER=openrouter through OpenRouter chat completions without a Gemini key", async () => {
    const restoreEnv = setTestProviderEnv({
      ATS_PROVIDER: "openrouter",
      ATS_GEMINI_API_KEY: "",
      GEMINI_API_KEY: "",
      ATS_OPENROUTER_API_KEY: "or-test-key",
      ATS_OPENROUTER_MODEL: "openai/gpt-oss-120b:free",
      ATS_OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    });
    const originalFetch = globalThis.fetch;
    let call;
    globalThis.fetch = async (url, init) => {
      call = { url: String(url), init };
      return buildChatCompletionsSuccessResponse(JSON.stringify(buildValidScorecard()));
    };

    try {
      const scorecard = await analyzeAtsScorecard(buildPayload());
      const body = JSON.parse(call.init.body);
      assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(call.init.headers.Authorization, "Bearer or-test-key");
      assert.equal(body.model, "openai/gpt-oss-120b:free");
      assert.equal(body.response_format, undefined);
      assert.equal(scorecard.overallScore, 78);
      assert.equal(scorecard.model, "openai/gpt-oss-120b:free");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it("routes ATS_PROVIDER=openai_compatible through configured base URL and model without requiring a key", async () => {
    const restoreEnv = setTestProviderEnv({
      ATS_PROVIDER: "openai_compatible",
      ATS_GEMINI_API_KEY: "",
      GEMINI_API_KEY: "",
      ATS_OPENAI_COMPATIBLE_API_KEY: "",
      OPENAI_COMPATIBLE_API_KEY: "",
      ATS_OPENAI_COMPATIBLE_MODEL: "local/ats-json",
      ATS_OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:11434/v1/",
    });
    const originalFetch = globalThis.fetch;
    let call;
    globalThis.fetch = async (url, init) => {
      call = { url: String(url), init };
      return buildChatCompletionsSuccessResponse(JSON.stringify(buildValidScorecard()));
    };

    try {
      const scorecard = await analyzeAtsScorecard(buildPayload());
      const body = JSON.parse(call.init.body);
      assert.equal(call.url, "http://127.0.0.1:11434/v1/chat/completions");
      assert.equal(call.init.headers.Authorization, undefined);
      assert.equal(body.model, "local/ats-json");
      assert.equal(scorecard.model, "local/ats-json");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it("keeps the existing OpenAI provider branch green", async () => {
    const restoreEnv = setTestProviderEnv({
      ATS_PROVIDER: "openai",
      ATS_OPENAI_API_KEY: "openai-test-key",
      ATS_OPENAI_MODEL: "gpt-4o-mini",
    });
    const originalFetch = globalThis.fetch;
    let call;
    globalThis.fetch = async (url, init) => {
      call = { url: String(url), init };
      return buildChatCompletionsSuccessResponse(JSON.stringify(buildValidScorecard()));
    };

    try {
      const scorecard = await analyzeAtsScorecard(buildPayload());
      const body = JSON.parse(call.init.body);
      assert.equal(call.url, "https://api.openai.com/v1/chat/completions");
      assert.equal(call.init.headers.Authorization, "Bearer openai-test-key");
      assert.equal(body.model, "gpt-4o-mini");
      assert.equal(body.response_format.type, "json_schema");
      assert.equal(body.response_format.json_schema.name, "ats_scorecard");
      assert.equal(scorecard.model, "gpt-4o-mini");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it("keeps the existing Anthropic provider branch green", async () => {
    const restoreEnv = setTestProviderEnv({
      ATS_PROVIDER: "anthropic",
      ATS_ANTHROPIC_API_KEY: "anthropic-test-key",
      ATS_ANTHROPIC_MODEL: "claude-test",
    });
    const originalFetch = globalThis.fetch;
    let call;
    globalThis.fetch = async (url, init) => {
      call = { url: String(url), init };
      return buildAnthropicSuccessResponse(JSON.stringify(buildValidScorecard()));
    };

    try {
      const scorecard = await analyzeAtsScorecard(buildPayload());
      const body = JSON.parse(call.init.body);
      assert.equal(call.url, "https://api.anthropic.com/v1/messages");
      assert.equal(call.init.headers["x-api-key"], "anthropic-test-key");
      assert.equal(body.model, "claude-test");
      assert.equal(scorecard.model, "claude-test");
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it("names OpenRouter required env vars when that provider is selected but unconfigured", () => {
    const restoreEnv = setTestProviderEnv({
      ATS_PROVIDER: "openrouter",
      ATS_OPENROUTER_API_KEY: "",
      OPENROUTER_API_KEY: "",
    });

    try {
      const status = getAtsConfigStatus();
      assert.equal(status.configured, false);
      assert.equal(status.provider, "openrouter");
      assert.match(status.reason, /ATS_OPENROUTER_API_KEY/);
      assert.match(status.reason, /ATS_PROVIDER=openrouter/);
    } finally {
      restoreEnv();
    }
  });

  it("names OpenAI-compatible required env vars when base URL or model is missing", () => {
    const restoreEnv = setTestProviderEnv({
      ATS_PROVIDER: "openai_compatible",
      ATS_OPENAI_COMPATIBLE_API_KEY: "",
      ATS_OPENAI_COMPATIBLE_BASE_URL: "",
      ATS_OPENAI_COMPATIBLE_MODEL: "",
    });

    try {
      const status = getAtsConfigStatus();
      assert.equal(status.configured, false);
      assert.equal(status.provider, "openai_compatible");
      assert.doesNotMatch(status.reason, /set ATS_OPENAI_COMPATIBLE_API_KEY/);
      assert.match(status.reason, /ATS_OPENAI_COMPATIBLE_API_KEY is optional/);
      assert.match(status.reason, /ATS_OPENAI_COMPATIBLE_BASE_URL/);
      assert.match(status.reason, /ATS_OPENAI_COMPATIBLE_MODEL/);
      assert.match(status.reason, /ATS_PROVIDER=openai_compatible/);
    } finally {
      restoreEnv();
    }
  });
});

describe("analyzeAtsScorecard provider parsing", () => {
  it("recovers a valid scorecard from JSON wrapped in provider prose on the first attempt", async () => {
    const restoreEnv = setTestProviderEnv();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return buildGeminiSuccessResponse(
        `Here is the ATS scorecard JSON you requested:\n${JSON.stringify(buildValidScorecard())}\nUse this to render the grouped findings in the UI.`,
      );
    };

    try {
      const scorecard = await analyzeAtsScorecard(buildPayload());
      assert.equal(calls, 1);
      assert.equal(scorecard.overallScore, 78);
      assert.equal(scorecard.model, "gemini-test");
      assert.deepEqual(scorecard.topStrengths, ["Strong React fit"]);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it("retries once when Gemini returns malformed JSON and succeeds on the second attempt", async () => {
    const restoreEnv = setTestProviderEnv();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return buildGeminiSuccessResponse(
          '{"schemaVersion":1,"overallScore":78,"dimensionScores":{"requirementsCoverage":70}',
        );
      }
      return buildGeminiSuccessResponse(
        JSON.stringify({
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
          model: "gemini-test",
        }),
      );
    };

    try {
      const scorecard = await analyzeAtsScorecard(buildPayload());
      assert.equal(calls, 2);
      assert.equal(scorecard.overallScore, 78);
      assert.equal(scorecard.model, "gemini-test");
      assert.deepEqual(scorecard.topStrengths, ["Strong React fit"]);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it("raises an actionable error after malformed JSON on both attempts", async () => {
    const restoreEnv = setTestProviderEnv();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return buildGeminiSuccessResponse(
        '{"schemaVersion":1,"overallScore":78,"dimensionScores":{"requirementsCoverage":70}',
      );
    };

    try {
      await assert.rejects(
        () => analyzeAtsScorecard(buildPayload()),
        /malformed JSON after retry/i,
      );
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it("does not retry provider HTTP errors", async () => {
    const restoreEnv = setTestProviderEnv();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { message: "Rate limit" } }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(() => analyzeAtsScorecard(buildPayload()), (error) => {
        assert.match(String(error?.message || ""), /Rate limit/);
        assert.equal(error?.provider, "gemini");
        assert.equal(error?.upstreamStatus, 429);
        assert.equal(error?.classification, "rate_limit");
        assert.equal(error?.retryable, true);
        return true;
      });
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it("does not classify non-429 responses as rate limits from message substrings", async () => {
    const restoreEnv = setTestProviderEnv();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          error: {
            message:
              "Upstream dependency mentioned HTTP 429 in diagnostics, but this request failed with timeout.",
            status: "INTERNAL",
          },
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      );
    };

    try {
      await assert.rejects(() => analyzeAtsScorecard(buildPayload()), (error) => {
        assert.equal(error?.provider, "gemini");
        assert.equal(error?.upstreamStatus, 500);
        assert.equal(error?.classification, "upstream");
        assert.equal(error?.retryable, true);
        return true;
      });
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});
