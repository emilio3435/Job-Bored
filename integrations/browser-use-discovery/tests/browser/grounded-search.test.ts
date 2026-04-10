import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  collectGroundedWebListings,
  createGroundedSearchClient,
} from "../../src/grounding/grounded-search.ts";

function makeRun() {
  return {
    runId: "run_grounded_test",
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_123",
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
    },
    config: {
      sheetId: "sheet_123",
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
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
    },
  };
}

function makeRuntimeConfig(overrides = {}) {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "placeholder-api-value-abc123",
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
    ...overrides,
  };
}

test("createGroundedSearchClient merges explicit JSON results with grounded citations", async () => {
  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [
                        {
                          url: "https://www.notion.so/careers",
                          title: "Notion Careers",
                          pageType: "careers",
                          reason: "Employer careers page",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["Notion product marketing manager"],
                groundingChunks: [
                  {
                    web: {
                      uri: "https://www.notion.so/careers/product-marketing-manager",
                      title: "Product Marketing Manager - Notion",
                    },
                  },
                  {
                    web: {
                      uri: "https://www.linkedin.com/jobs/view/123",
                      title: "LinkedIn duplicate that should be filtered",
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  });

  const run = makeRun();
  const result = await client.search(run.config.companies[0], run);

  assert.deepEqual(result.searchQueries, ["Notion product marketing manager"]);
  assert.equal(result.candidates.length, 2);
  assert.equal(
    result.candidates[0].url,
    "https://www.notion.so/careers/product-marketing-manager",
  );
  assert.ok(result.candidates.every((entry) => !entry.url.includes("linkedin")));
});

test("collectGroundedWebListings expands a careers page into direct jobs", async () => {
  const run = makeRun();
  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://www.notion.so/careers",
            title: "Notion Careers",
            pageType: "careers",
            reason: "Employer careers page",
            sourceDomain: "www.notion.so",
          },
        ],
        warnings: [],
      }),
    },
    sessionManager: {
      run: async ({ url }) => ({
        url,
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Product Marketing Manager",
              company: "Notion",
              location: "Remote in United States",
              url: "https://www.notion.so/careers/product-marketing-manager",
              descriptionText:
                "Lead product marketing and remote launches across campaigns.",
              compensationText: "$170k-$210k",
              tags: ["marketing", "product"],
            },
            {
              title: "Careers",
              url: "https://www.notion.so/careers",
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
  });

  assert.equal(result.pagesVisited, 1);
  assert.deepEqual(result.searchQueries, ["Notion product marketing manager"]);
  assert.equal(result.rawListings.length, 1);
  assert.equal(result.rawListings[0].sourceId, "grounded_web");
  assert.equal(
    result.rawListings[0].url,
    "https://www.notion.so/careers/product-marketing-manager",
  );
  assert.match(String(result.rawListings[0].metadata?.sourceQuery || ""), /Notion product marketing manager/);
});
