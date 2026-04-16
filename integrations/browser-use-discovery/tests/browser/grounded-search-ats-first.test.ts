import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { collectGroundedWebListings } from "../../src/grounding/grounded-search.ts";

function makeRun() {
  return {
    runId: "run_hint_only",
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_hint_only",
      variationKey: "var_hint_only",
      requestedAt: "2026-04-13T00:00:00.000Z",
    },
    config: {
      sheetId: "sheet_hint_only",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Notion" }],
      includeKeywords: ["marketing"],
      excludeKeywords: [],
      targetRoles: ["Product Marketing Manager"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_hint_only",
      requestedAt: "2026-04-13T00:00:00.000Z",
    },
  };
}

function makeRuntimeConfig() {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "test-key",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 5,
    groundedSearchMaxPagesPerCompany: 2,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: "",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "hosted",
    asyncAckByDefault: true,
  };
}

test("collectGroundedWebListings never extracts unresolved WorkingNomads boards directly", async () => {
  const run = makeRun();
  let preflightCalls = 0;
  let sessionCalls = 0;

  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://www.workingnomads.com/jobs/123",
            title: "Product Marketing Manager at Notion | Working Nomads",
            pageType: "job",
            reason: "Third-party hint",
            sourceDomain: "www.workingnomads.com",
            sourcePolicy: "hint_only",
          },
        ],
        warnings: [],
      }),
      resolveHint: async () => [],
    },
    fetchImpl: async () => {
      preflightCalls += 1;
      return new Response("<html><title>Unexpected preflight</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
    sessionManager: {
      run: async ({ url }) => {
        sessionCalls += 1;
        return {
          url,
          text: JSON.stringify({
            pageType: "job",
            jobs: [
              {
                title: "Product Marketing Manager",
                company: "Notion",
                location: "Remote",
                url,
                descriptionText: "This should never be extracted from WorkingNomads.",
              },
            ],
          }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  assert.equal(preflightCalls, 0);
  assert.equal(sessionCalls, 0);
  assert.equal(result.pagesVisited, 0);
  assert.equal(result.rawListings.length, 0);
  assert.deepEqual(result.seedUrls, []);
  assert.ok(
    result.diagnostics?.some((entry) => entry.code === "hint_only_candidate"),
    "should record the third-party board as hint_only_candidate",
  );
  assert.ok(
    result.diagnostics?.some(
      (entry) => entry.code === "third_party_extraction_blocked",
    ),
    "should record that direct third-party extraction was blocked",
  );
  assert.ok(
    result.diagnostics?.some((entry) => entry.code === "hint_resolution_failed"),
    "should record the unresolved hint failure instead of extracting directly",
  );
});

test("collectGroundedWebListings suppresses previously junk hosts before preflight", async () => {
  let preflightCalls = 0;
  let sessionCalls = 0;

  const result = await collectGroundedWebListings({
    company: makeRun().config.companies[0],
    run: makeRun(),
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://spamjobs.example/roles/123",
            title: "Product Marketing Manager at Notion",
            pageType: "job",
            reason: "Untrusted board candidate",
            sourceDomain: "spamjobs.example",
            sourcePolicy: "extractable",
          },
        ],
        warnings: [],
      }),
    },
    isHostSuppressed: async (url) => url.includes("spamjobs.example"),
    fetchImpl: async () => {
      preflightCalls += 1;
      return new Response("<html><title>Unexpected preflight</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
    sessionManager: {
      run: async ({ url }) => {
        sessionCalls += 1;
        return {
          url,
          text: JSON.stringify({ pageType: "job", jobs: [] }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  assert.equal(preflightCalls, 0);
  assert.equal(sessionCalls, 0);
  assert.equal(result.rawListings.length, 0);
  assert.ok(
    result.diagnostics?.some((entry) => entry.code === "junk_host_suppressed"),
    "should suppress previously junk hosts from memory before extraction",
  );
});
