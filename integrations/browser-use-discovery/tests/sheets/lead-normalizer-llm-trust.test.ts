import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { normalizeLead } from "../../src/normalize/lead-normalizer.ts";
import { scoreListingWithLlm } from "../../src/normalize/profile-aware-scorer.ts";
import type { LlmFitScoreResult } from "../../src/contracts/user-profile.ts";

function makeCannedCache(canned: LlmFitScoreResult) {
  return {
    get: () => canned,
    put: () => undefined,
    getBreakdown: () => null,
    putBreakdown: () => undefined,
    close: () => undefined,
  };
}

function makeRunWithProfile(cannedScore: LlmFitScoreResult) {
  return {
    runId: "run_llm_trust",
    trigger: "manual" as const,
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_123",
      variationKey: "var_123",
      requestedAt: "2026-05-29T12:00:00.000Z",
    },
    config: {
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme", includeKeywords: ["TypeScript"] }],
      // Stack the keyword counter so it would maximally inflate scoreLead().
      includeKeywords: ["Node", "browser automation", "TypeScript", "platform"],
      excludeKeywords: [],
      targetRoles: ["Platform Engineer", "Backend Engineer"],
      locations: ["Remote", "Austin"],
      remotePolicy: "remote-first" as const,
      seniority: "senior" as const,
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-05-29T12:00:00.000Z",
      userProfile: {
        version: 1,
        identity: {
          targetRoles: ["Staff Engineer"],
          targetSeniority: "ic_staff",
          primaryNarrative: "Staff backend engineer.",
        },
        strengths: [{ name: "backend systems", rank: 1 }],
        hardConstraints: { workMode: "any" },
      },
      runtimeConfig: {
        geminiApiKey: "test-key",
        geminiModel: "gemini-3.5-flash",
      },
      listingScoreCache: makeCannedCache(cannedScore),
    },
  };
}

const HIGH_KEYWORD_LISTING = {
  sourceId: "greenhouse",
  sourceLabel: "Greenhouse",
  // Title + description maximally match the include keywords + target roles
  // so scoreLead() would return 10 if it were ever taken as the floor.
  title: "Senior Platform Engineer",
  company: "Acme",
  location: "Austin, TX Remote-first",
  url: "https://jobs.example.com/role-1",
  compensationText: "$180k-$210k",
  descriptionText:
    "Build browser automation systems in Node and TypeScript for a senior platform team.",
};

test(
  "normalizeLead trusts LLM low score over high keyword-counter score (regression: Math.max floor-bump)",
  async () => {
    const cannedLowLlm: LlmFitScoreResult = {
      fitScore: 3,
      band: "Low",
      perStrength: [{ name: "backend systems", score: 2, rationale: "Wrong stack." }],
      concerns: ["Industry mismatch.", "Wrong seniority lane."],
      matches: [],
      rationale: "LLM judged this a low fit.",
    };
    const run = makeRunWithProfile(cannedLowLlm);
    const lead = await normalizeLead(HIGH_KEYWORD_LISTING, run);
    assert.ok(lead, "expected listing to pass and produce a lead");
    assert.equal(
      lead?.fitScore,
      3,
      "LLM's 3 must be the final fitScore, not floor-bumped by the keyword counter.",
    );
  },
);

test(
  "normalizeLead surfaces LLM high score directly (no double-counting against itself)",
  async () => {
    const cannedHighLlm: LlmFitScoreResult = {
      fitScore: 9,
      band: "Exceptional",
      perStrength: [{ name: "backend systems", score: 9, rationale: "Strong stack match." }],
      concerns: [],
      matches: ["Exact role fit", "Remote OK"],
      rationale: "LLM judged this an exceptional fit.",
    };
    const run = makeRunWithProfile(cannedHighLlm);
    const lead = await normalizeLead(HIGH_KEYWORD_LISTING, run);
    assert.ok(lead, "expected listing to produce a lead");
    assert.equal(lead?.fitScore, 9, "LLM's 9 must round-trip exactly.");
  },
);

test("scoreListingWithLlm uses OpenRouter chat completions without Gemini", async () => {
  let requestUrl = "";
  let requestHeaders: Record<string, string> = {};
  let requestBody: Record<string, unknown> = {};
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    requestUrl = String(input || "");
    requestHeaders = init?.headers as Record<string, string>;
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fitScore: 8,
                band: "Strong",
                perStrength: [
                  {
                    name: "backend systems",
                    score: 8,
                    rationale: "Strong backend platform fit.",
                  },
                ],
                concerns: ["Some domain uncertainty."],
                matches: ["Remote role", "TypeScript systems"],
                rationale: "Strong but not perfect.",
                leadAngle: "Lead with platform automation experience.",
              }),
            },
          },
        ],
      }),
      text: async () => "",
    } as Response;
  };
  const run = makeRunWithProfile({
    fitScore: 8,
    band: "Strong",
    perStrength: [],
    concerns: [],
    matches: [],
    rationale: "",
  });

  const result = await scoreListingWithLlm(
    HIGH_KEYWORD_LISTING,
    run.config.userProfile,
    {
      runtimeConfig: {
        geminiApiKey: "",
        geminiModel: "",
        llmProvider: "openrouter",
        openRouterApiKey: "or-test-key",
        openRouterModel: "openai/gpt-4.1-mini",
      },
      fetchImpl,
    },
  );

  assert.equal(requestUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requestHeaders.authorization, "Bearer or-test-key");
  assert.equal(requestHeaders["x-goog-api-key"], undefined);
  assert.equal(requestBody.model, "openai/gpt-4.1-mini");
  assert.equal(requestBody.temperature, 0.2);
  assert.equal(requestBody.max_tokens, 2048);
  assert.ok(Array.isArray(requestBody.messages));
  assert.equal(result.fitScore, 8);
  assert.equal(result.band, "Strong");
  assert.equal(result.leadAngle, "Lead with platform automation experience.");
});

test("scoreListingWithLlm supports local OpenAI-compatible base URL without auth", async () => {
  let requestUrl = "";
  let requestHeaders: Record<string, string> = {};
  let requestBody: Record<string, unknown> = {};
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    requestUrl = String(input || "");
    requestHeaders = init?.headers as Record<string, string>;
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                fitScore: 7,
                band: "Interesting",
                perStrength: [
                  {
                    name: "backend systems",
                    score: 7,
                    rationale: "Useful platform overlap.",
                  },
                ],
                concerns: [],
                matches: ["Local model scored the role."],
                rationale: "Interesting fit.",
              }),
            },
          },
        ],
      }),
      text: async () => "",
    } as Response;
  };
  const run = makeRunWithProfile({
    fitScore: 7,
    band: "Interesting",
    perStrength: [],
    concerns: [],
    matches: [],
    rationale: "",
  });

  const result = await scoreListingWithLlm(
    HIGH_KEYWORD_LISTING,
    run.config.userProfile,
    {
      runtimeConfig: {
        geminiApiKey: "",
        geminiModel: "",
        llmProvider: "local",
        llmBaseUrl: "http://127.0.0.1:1234/v1",
        llmModel: "local-json-model",
      },
      fetchImpl,
    },
  );

  assert.equal(requestUrl, "http://127.0.0.1:1234/v1/chat/completions");
  assert.equal(requestHeaders.authorization, undefined);
  assert.equal(requestHeaders["x-goog-api-key"], undefined);
  assert.equal(requestBody.model, "local-json-model");
  assert.equal(requestBody.max_tokens, 2048);
  assert.equal(result.fitScore, 7);
  assert.equal(result.band, "Interesting");
});
