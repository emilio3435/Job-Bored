import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerRuntimeConfig } from "../../src/config.ts";
import type { CandidateProfile, DiscoveryRun } from "../../src/contracts.ts";
import { resolveWorkerChatProvider } from "../../src/ai/chat-provider.ts";
import { discoverCompaniesForProfile } from "../../src/discovery/profile-to-companies.ts";
import { createGroundedSearchClient } from "../../src/grounding/grounded-search.ts";
import { extractJobWithGeminiUrlContext } from "../../src/sources/gemini-url-context-extractor.ts";

const CASES = [
  ["", "gemini-flash-latest"],
  ["gemini-flash", "gemini-flash-latest"],
  ["gemini-3.7-flash", "gemini-flash-latest"],
  ["gemini-2.5-pro", "gemini-2.5-pro"],
  ["gemini-flash-lite", "gemini-flash-lite"],
  ["gemini-3.5-flash", "gemini-3.5-flash"],
  ["gemini-3.7-flash-preview", "gemini-3.7-flash-preview"],
] as const;

const PROFILE = {
  targetRoles: ["Product Manager"],
  skills: ["Planning"],
  seniority: "senior",
  yearsOfExperience: 6,
  locations: ["Remote"],
  remotePolicy: "remote",
  industries: [],
} as CandidateProfile;

const RUN = {
  runId: "synthetic-flash-wire",
  config: {
    targetRoles: ["Product Manager"],
    includeKeywords: [],
    excludeKeywords: [],
    locations: ["Remote"],
    remotePolicy: "remote",
    seniority: "senior",
    groundedSearchTuning: { maxResultsPerCompany: 2 },
  },
} as DiscoveryRun;

function runtimeConfig(geminiModel: string): WorkerRuntimeConfig {
  return {
    geminiApiKey: "synthetic-key",
    geminiModel,
    serpApiKey: "",
    groundedSearchMaxResultsPerCompany: 2,
    groundedSearchMaxPagesPerCompany: 1,
    useStructuredExtraction: false,
  } as WorkerRuntimeConfig;
}

function rejectUpstream(captured: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    captured.push(String(input));
    return new Response(JSON.stringify({ error: { message: "synthetic stop" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

for (const [configured, expected] of CASES) {
  test(`Gemini worker HTTP edges map ${configured || "blank"} to ${expected}`, async () => {
    const config = runtimeConfig(configured);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${expected}:generateContent`;

    const chat = resolveWorkerChatProvider({
      llmProvider: "gemini",
      llmApiKey: "synthetic-key",
      llmModel: configured,
    });
    assert.equal(chat?.model, expected);
    assert.equal(chat?.endpoint, endpoint);

    const urlCalls: string[] = [];
    const extraction = await extractJobWithGeminiUrlContext({
      url: "https://example.com/jobs/1",
      runId: "synthetic-flash-wire",
      runtimeConfig: config,
      fetchImpl: rejectUpstream(urlCalls),
    });
    assert.equal(extraction.ok, false);
    assert.deepEqual(urlCalls, [endpoint]);

    const groundedCalls: string[] = [];
    const grounded = createGroundedSearchClient(config, {
      fetchImpl: rejectUpstream(groundedCalls),
    });
    await grounded.search({ name: "Example" }, RUN);
    assert.deepEqual(groundedCalls, [endpoint]);

    const profileCalls: string[] = [];
    await assert.rejects(
      discoverCompaniesForProfile(PROFILE, {
        runtimeConfig: config,
        fetchImpl: rejectUpstream(profileCalls),
      }),
      /Gemini HTTP 400/,
    );
    assert.deepEqual(profileCalls, [endpoint]);
  });
}

test("non-Gemini worker chat provider keeps its selected model and endpoint", () => {
  const provider = resolveWorkerChatProvider({
    llmProvider: "openai",
    llmApiKey: "synthetic-key",
    llmModel: "gpt-test",
  });
  assert.equal(provider?.model, "gpt-test");
  assert.equal(provider?.endpoint, "https://api.openai.com/v1/chat/completions");
});
