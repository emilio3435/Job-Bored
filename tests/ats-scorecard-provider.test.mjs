import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeAtsScorecard } from "../server/ats-scorecard.mjs";

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

function setTestProviderEnv() {
  const previous = {
    ATS_PROVIDER: process.env.ATS_PROVIDER,
    ATS_GEMINI_API_KEY: process.env.ATS_GEMINI_API_KEY,
    ATS_GEMINI_MODEL: process.env.ATS_GEMINI_MODEL,
  };
  process.env.ATS_PROVIDER = "gemini";
  process.env.ATS_GEMINI_API_KEY = "test-key";
  process.env.ATS_GEMINI_MODEL = "gemini-test";
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

describe("analyzeAtsScorecard provider parsing", () => {
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
