import assert from "node:assert/strict";
import test from "node:test";

import { collectSerpApiGoogleJobsListings } from "../../src/sources/serpapi-google-jobs.ts";
import type { WorkerRuntimeConfig } from "../../src/config.ts";

function makeRuntimeConfig(
  overrides: Partial<WorkerRuntimeConfig> = {},
): WorkerRuntimeConfig {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 6,
    groundedSearchMaxPagesPerCompany: 4,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: "",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "local",
    asyncAckByDefault: true,
    useStructuredExtraction: false,
    serpApiKey: "test-key-abcdef",
    ...overrides,
  };
}

const CANNED_THREE_JOBS = {
  jobs_results: [
    {
      title: "Senior Product Manager",
      company_name: "Plaid",
      location: "Remote · United States",
      description: "We're hiring a Senior PM for identity.",
      via: "via Greenhouse",
      job_id: "plaid-abc-123",
      apply_options: [
        { title: "Apply on Greenhouse", link: "https://boards.greenhouse.io/plaid/jobs/4728292004" },
      ],
      share_link: "https://www.google.com/search?ibp=htl;jobs#htivrt=jobs",
      detected_extensions: { posted_at: "3 days ago" },
    },
    {
      title: "Staff Product Manager",
      company_name: "Ramp",
      location: "New York, NY",
      description: "Ramp is looking for a Staff PM.",
      via: "via LinkedIn",
      job_id: "ramp-xyz-789",
      apply_options: [
        { title: "Apply on LinkedIn", link: "https://www.linkedin.com/jobs/view/3829172" },
      ],
      detected_extensions: { posted_at: "1 week ago" },
    },
    {
      title: "Senior Product Manager, Growth",
      company_name: "Figma",
      location: "San Francisco, CA",
      description: "Growth PM for Figma.",
      via: "via Ashby",
      job_id: "figma-qrs-456",
      apply_options: [
        { title: "Apply on Ashby", link: "https://jobs.ashbyhq.com/figma/7a2c" },
      ],
      extensions: ["2 days ago", "Full-time"],
    },
  ],
};

function fetchReturning(
  body: unknown,
  init: { status?: number; throwOnCall?: Error } = {},
) {
  return async (_url: string | URL) => {
    if (init.throwOnCall) throw init.throwOnCall;
    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      json: async () => body,
    } as Response;
  };
}

test("collectSerpApiGoogleJobsListings happy path returns 3 listings with mapped fields", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const result = await collectSerpApiGoogleJobsListings({
    profile: {
      targetRoles: ["Senior Product Manager"],
      locations: ["Remote"],
      remotePolicy: "remote",
    },
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: fetchReturning(CANNED_THREE_JOBS),
    log: (event, details) => logSink.push([event, details]),
  });

  assert.equal(result.listings.length, 3);
  assert.equal(result.rawListings.length, 3);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.stats.queryCount, 1);
  assert.equal(result.stats.httpFailureCount, 0);
  assert.equal(result.stats.listingCount, 3);

  const plaid = result.listings.find((l) => l.company === "Plaid");
  assert.ok(plaid, "Plaid listing present");
  assert.equal(plaid!.title, "Senior Product Manager");
  assert.equal(plaid!.url, "https://boards.greenhouse.io/plaid/jobs/4728292004");
  assert.equal(plaid!.providerType, "greenhouse");
  assert.equal(plaid!.postedAt, "3 days ago");

  const figma = result.listings.find((l) => l.company === "Figma");
  assert.equal(figma!.providerType, "ashby");

  const ramp = result.listings.find((l) => l.company === "Ramp");
  // "via LinkedIn" doesn't resolve to an AtsSourceId.
  assert.equal(ramp!.providerType, undefined);

  assert.equal(result.rawListings[0].sourceId, "serpapi_google_jobs");
  assert.equal(result.rawListings[0].sourceLabel, "Google Jobs (SerpApi)");

  assert.ok(
    logSink.some(([event]) => event === "discovery.run.serpapi_google_jobs_query_started"),
    "emits query_started",
  );
  assert.ok(
    logSink.some(([event]) => event === "discovery.run.serpapi_google_jobs_lane_completed"),
    "emits lane_completed",
  );
});

test("collectSerpApiGoogleJobsListings skips gracefully when API key is unset", async () => {
  let fetchCallCount = 0;
  const trackingFetch: typeof globalThis.fetch = async () => {
    fetchCallCount += 1;
    throw new Error("fetch should not be called");
  };
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const result = await collectSerpApiGoogleJobsListings({
    profile: {
      targetRoles: ["Product Manager"],
      locations: ["Remote"],
      remotePolicy: "remote",
    },
    runtimeConfig: makeRuntimeConfig({ serpApiKey: "" }),
    fetchImpl: trackingFetch,
    log: (event, details) => logSink.push([event, details]),
  });
  assert.equal(fetchCallCount, 0);
  assert.deepEqual(result.listings, []);
  assert.deepEqual(result.warnings, ["missing_api_key"]);
  assert.equal(result.stats.queryCount, 0);
  const skipEvent = logSink.find(
    ([event]) => event === "discovery.run.serpapi_google_jobs_skipped",
  );
  assert.ok(skipEvent, "skip event emitted");
  assert.equal(skipEvent![1].reason, "missing_api_key");
});

test("collectSerpApiGoogleJobsListings surfaces HTTP failures as warnings without throwing", async () => {
  const logSink: Array<[string, Record<string, unknown>]> = [];
  const result = await collectSerpApiGoogleJobsListings({
    profile: {
      targetRoles: ["Designer"],
      locations: ["New York"],
      remotePolicy: "hybrid",
    },
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: fetchReturning({}, { status: 429 }),
    log: (event, details) => logSink.push([event, details]),
  });
  assert.deepEqual(result.listings, []);
  assert.equal(result.stats.queryCount, 1);
  assert.equal(result.stats.httpFailureCount, 1);
  assert.deepEqual(result.warnings, ["http_429"]);
  assert.ok(
    logSink.some(([event]) => event === "discovery.run.serpapi_google_jobs_query_failed"),
    "query_failed event emitted",
  );
});

test("collectSerpApiGoogleJobsListings handles empty jobs_results with no warnings", async () => {
  const result = await collectSerpApiGoogleJobsListings({
    profile: {
      targetRoles: ["Engineer"],
      locations: [],
      remotePolicy: "remote",
    },
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: fetchReturning({ jobs_results: [] }),
  });
  assert.deepEqual(result.listings, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.stats.queryCount, 1);
  assert.equal(result.stats.httpFailureCount, 0);
});

test("collectSerpApiGoogleJobsListings dedupes identical URLs across queries", async () => {
  const duplicatedJob = {
    jobs_results: [
      {
        title: "Product Manager",
        company_name: "Plaid",
        location: "Remote",
        description: "PM role",
        via: "via Greenhouse",
        apply_options: [
          { title: "Apply", link: "https://boards.greenhouse.io/plaid/jobs/1" },
        ],
      },
    ],
  };
  const result = await collectSerpApiGoogleJobsListings({
    profile: {
      targetRoles: ["Product Manager", "Senior Product Manager"],
      locations: ["Remote"],
      remotePolicy: "remote",
    },
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: fetchReturning(duplicatedJob),
  });
  assert.equal(result.stats.queryCount, 2);
  assert.equal(result.listings.length, 1);
  assert.equal(result.rawListings.length, 1);
});

test("collectSerpApiGoogleJobsListings skips listings missing title, company, or applyUrl", async () => {
  const result = await collectSerpApiGoogleJobsListings({
    profile: {
      targetRoles: ["Product Manager"],
      locations: ["Remote"],
      remotePolicy: "remote",
    },
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: fetchReturning({
      jobs_results: [
        // Missing title
        { company_name: "X", apply_options: [{ link: "https://x.com/1" }] },
        // Missing company
        { title: "Y", apply_options: [{ link: "https://y.com/1" }] },
        // No apply url anywhere
        { title: "Z", company_name: "Zco" },
        // Valid
        {
          title: "PM",
          company_name: "Aco",
          apply_options: [{ link: "https://aco.com/jobs/1" }],
        },
      ],
    }),
  });
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].company, "Aco");
});

test("collectSerpApiGoogleJobsListings returns no_queries when targetRoles is empty", async () => {
  let fetchCallCount = 0;
  const result = await collectSerpApiGoogleJobsListings({
    profile: {
      targetRoles: [],
      locations: ["Remote"],
      remotePolicy: "remote",
    },
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: async () => {
      fetchCallCount += 1;
      throw new Error("fetch should not be called when no queries");
    },
  });
  assert.equal(fetchCallCount, 0);
  assert.deepEqual(result.warnings, ["no_queries"]);
  assert.equal(result.stats.queryCount, 0);
});
