import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidateProfile,
  WorkerRuntimeConfig,
} from "../../src/contracts.ts";
import { discoverCompaniesForProfile } from "../../src/discovery/profile-to-companies.ts";

function makeRuntimeConfig(): WorkerRuntimeConfig {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "test-api-key",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 5,
    groundedSearchMaxPagesPerCompany: 2,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: "secret-xyz",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "hosted",
    asyncAckByDefault: true,
    useStructuredExtraction: false,
  };
}

const PROFILE: CandidateProfile = {
  targetRoles: ["Growth Marketing Manager", "Performance Marketing Lead"],
  skills: ["SEO", "paid acquisition", "lifecycle", "AI automation"],
  seniority: "senior",
  yearsOfExperience: 7,
  locations: ["Remote", "Denver", "United States"],
  remotePolicy: "remote",
  industries: ["AI tooling", "B2B SaaS"],
};

function buildCompanyEntries(names: string[]) {
  return names.map((name) => ({
    name,
    domains: [`${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`],
    roleTags: ["growth marketing"],
    geoTags: ["remote"],
    reason: "current hiring signal",
  }));
}

function makeGeminiPayload(text: string) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
      },
    ],
  };
}

function makeGeminiResponse(text: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => makeGeminiPayload(text),
    text: async () => JSON.stringify(makeGeminiPayload(text)),
  } as Response;
}

function makeFetchStub(responseTexts: string[]) {
  const requestBodies: Array<Record<string, unknown>> = [];
  let callIndex = 0;
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    requestBodies.push(body);
    const text = responseTexts[callIndex++];
    assert.notEqual(text, undefined, `unexpected Gemini call #${callIndex}`);
    return makeGeminiResponse(text);
  };
  return { fetchImpl, requestBodies, getCallCount: () => callIndex };
}

function logSink() {
  const events: Array<[string, Record<string, unknown>]> = [];
  return {
    events,
    log: (event: string, details: Record<string, unknown>) => {
      events.push([event, details]);
    },
  };
}

test("thin-result retry fires when the first pass returns fewer than 15 companies", async () => {
  const firstPass = JSON.stringify({
    companies: buildCompanyEntries([
      "Notion",
      "Ramp",
      "Figma",
      "Miro",
      "Canva",
      "Webflow",
    ]),
  });
  const retryPass = JSON.stringify({
    companies: buildCompanyEntries([
      "Amplitude",
      "HubSpot",
      "ServiceNow",
      "Datadog",
      "Snowflake",
      "Asana",
      "Braze",
      "Monday.com",
      "Twilio",
      "Shopify",
    ]),
  });
  const { fetchImpl, requestBodies, getCallCount } = makeFetchStub([
    firstPass,
    firstPass,
    retryPass,
    retryPass,
  ]);
  const logs = logSink();

  const companies = await discoverCompaniesForProfile(PROFILE, {
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl,
    log: logs.log,
  });

  assert.equal(companies.length, 16);
  assert.equal(getCallCount(), 4);
  assert.ok(
    logs.events.some(([event]) => event === "discovery.profile.companies_thin_retry"),
  );
  assert.ok(
    !logs.events.some(([event]) => event === "discovery.profile.companies_industry_fanout"),
  );

  const firstUserPrompt = JSON.stringify(requestBodies[0]);
  assert.match(firstUserPrompt, /at least 20 companies and up to 30/i);
  assert.match(firstUserPrompt, /Do NOT stop at 5-10 companies/i);
  const retryUserPrompt = JSON.stringify(requestBodies[2]);
  assert.match(retryUserPrompt, /Find 15 MORE unique companies/i);
});

test("industry fan-out fires when retry also returns fewer than 15 companies", async () => {
  const firstPass = JSON.stringify({
    companies: buildCompanyEntries([
      "Notion",
      "Ramp",
      "Figma",
      "Miro",
    ]),
  });
  const retryPass = JSON.stringify({
    companies: buildCompanyEntries([
      "Canva",
      "Webflow",
      "Braze",
    ]),
  });
  const aiToolingPass = JSON.stringify({
    companies: buildCompanyEntries([
      "OpenAI",
      "Anthropic",
      "Perplexity",
      "Scale AI",
      "Writer",
    ]),
  });
  const saasPass = JSON.stringify({
    companies: buildCompanyEntries([
      "HubSpot",
      "Datadog",
      "Snowflake",
      "Asana",
      "Atlassian",
    ]),
  });
  const { fetchImpl, requestBodies, getCallCount } = makeFetchStub([
    firstPass,
    firstPass,
    retryPass,
    retryPass,
    aiToolingPass,
    aiToolingPass,
    saasPass,
    saasPass,
  ]);
  const logs = logSink();

  const companies = await discoverCompaniesForProfile(PROFILE, {
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl,
    log: logs.log,
  });

  assert.equal(companies.length, 17);
  assert.equal(getCallCount(), 8);
  assert.ok(
    logs.events.some(([event]) => event === "discovery.profile.companies_thin_retry"),
  );
  assert.ok(
    logs.events.some(([event]) => event === "discovery.profile.companies_industry_fanout"),
  );

  const fanoutPrompts = requestBodies.slice(4).map((body) => JSON.stringify(body));
  assert.ok(
    fanoutPrompts.some((body) => /Industry focus for this pass: AI tooling/i.test(body)),
  );
  assert.ok(
    fanoutPrompts.some((body) => /Industry focus for this pass: B2B SaaS/i.test(body)),
  );
});

test("healthy first pass does not trigger retry or fan-out", async () => {
  const healthyPass = JSON.stringify({
    companies: buildCompanyEntries([
      "Notion",
      "Ramp",
      "Figma",
      "Miro",
      "Canva",
      "Webflow",
      "Amplitude",
      "HubSpot",
      "ServiceNow",
      "Datadog",
      "Snowflake",
      "Asana",
      "Braze",
      "Monday.com",
      "Twilio",
    ]),
  });
  const { fetchImpl, getCallCount } = makeFetchStub([healthyPass, healthyPass]);
  const logs = logSink();

  const companies = await discoverCompaniesForProfile(PROFILE, {
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl,
    log: logs.log,
  });

  assert.equal(companies.length, 15);
  assert.equal(getCallCount(), 2);
  assert.ok(
    !logs.events.some(([event]) => event === "discovery.profile.companies_thin_retry"),
  );
  assert.ok(
    !logs.events.some(([event]) => event === "discovery.profile.companies_industry_fanout"),
  );
});

test("dedup holds across retry merges", async () => {
  const firstPass = JSON.stringify({
    companies: buildCompanyEntries([
      "Notion",
      "Ramp",
      "Figma",
      "Miro",
      "Canva",
      "Webflow",
      "HubSpot",
    ]),
  });
  const retryPass = JSON.stringify({
    companies: buildCompanyEntries([
      "Notion",
      "Ramp",
      "Braze",
      "Monday.com",
      "Twilio",
      "Shopify",
      "Datadog",
      "Snowflake",
      "Asana",
    ]),
  });
  const aiToolingPass = JSON.stringify({
    companies: buildCompanyEntries([
      "OpenAI",
      "Anthropic",
      "Perplexity",
      "Scale AI",
      "Writer",
      "Notion",
    ]),
  });
  const saasPass = JSON.stringify({
    companies: buildCompanyEntries([
      "ServiceNow",
      "Atlassian",
      "Klaviyo",
      "Cloudflare",
      "Ramp",
    ]),
  });
  const { fetchImpl } = makeFetchStub([
    firstPass,
    firstPass,
    retryPass,
    retryPass,
    aiToolingPass,
    aiToolingPass,
    saasPass,
    saasPass,
  ]);

  const companies = await discoverCompaniesForProfile(PROFILE, {
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl,
  });

  assert.equal(companies.filter((company) => company.name === "Notion").length, 1);
  assert.equal(companies.filter((company) => company.name === "Ramp").length, 1);
  assert.equal(new Set(companies.map((company) => company.companyKey)).size, companies.length);
});
