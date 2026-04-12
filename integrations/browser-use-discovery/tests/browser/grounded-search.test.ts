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

// VAL-DATA-006: Grounded HTML fallback rejects junk navigation titles
test("collectGroundedWebListings rejects junk navigation anchor titles (VAL-DATA-006)", async () => {
  const run = makeRun();
  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion software engineer"],
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
        // HTML page with real job links mixed with junk navigation links
        text: `
          <html>
          <body>
            <a href="/jobs/123">Skip to content</a>
            <a href="/jobs/456">Senior Software Engineer</a>
            <a href="/jobs/789">Read more</a>
            <a href="/jobs/101">Learn more about our team</a>
            <a href="/jobs/102">Click here to apply</a>
            <a href="/jobs/103">View all</a>
            <a href="/jobs/104">See more jobs</a>
            <a href="/jobs/105">More info</a>
            <a href="/jobs/106">Backend Engineer</a>
            <a href="/jobs/107">Menu</a>
            <a href="/jobs/108">Home</a>
          </body>
          </html>
        `,
        metadata: { mode: "browser_use_command" },
      }),
    },
  });

  // Only real job titles should be included; junk navigation text should be filtered
  const titles = result.rawListings.map((l) => l.title);
  assert.ok(!titles.includes("Skip to content"), "Skip to content should be rejected");
  assert.ok(!titles.includes("Read more"), "Read more should be rejected");
  assert.ok(!titles.includes("Learn more about our team"), "Learn more prefix should be rejected");
  assert.ok(!titles.includes("Click here to apply"), "Click here should be rejected");
  assert.ok(!titles.includes("View all"), "View all should be rejected");
  assert.ok(!titles.includes("See more jobs"), "See more should be rejected");
  assert.ok(!titles.includes("More info"), "More info should be rejected");
  assert.ok(!titles.includes("Menu"), "Menu should be rejected");
  assert.ok(!titles.includes("Home"), "Home should be rejected");

  // Real job titles should be retained
  assert.ok(titles.includes("Senior Software Engineer"), "Real job title should be retained");
  assert.ok(titles.includes("Backend Engineer"), "Real job title should be retained");

  // No more than 8 listings should be returned (enforced by extractListingsFromHtmlLinks)
  assert.ok(result.rawListings.length <= 8, "Should cap at 8 listings from HTML links");
});

// VAL-DATA-006: Same URL with junk and quality title candidates retains quality title
test("collectGroundedWebListings prefers quality title over junk for same URL (VAL-DATA-006)", async () => {
  const run = makeRun();
  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Acme jobs"],
        candidates: [
          {
            url: "https://acme.com/careers",
            title: "Acme Careers",
            pageType: "careers",
            reason: "Employer careers page",
            sourceDomain: "acme.com",
          },
        ],
        warnings: [],
      }),
    },
    sessionManager: {
      run: async ({ url }) => ({
        url,
        // HTML page where the same URL appears with both junk and quality text
        text: `
          <html>
          <body>
            <a href="/jobs/123">Read more</a>
            <a href="/jobs/456">Senior Platform Engineer</a>
            <a href="/jobs/456">click here</a>
            <a href="/jobs/789">View all jobs</a>
            <a href="/jobs/101">Product Manager</a>
          </body>
          </html>
        `,
        metadata: { mode: "browser_use_command" },
      }),
    },
  });

  const titles = result.rawListings.map((l) => l.title);
  // Quality titles should be retained
  assert.ok(titles.includes("Senior Platform Engineer"), "Quality title should be retained");
  assert.ok(titles.includes("Product Manager"), "Quality title should be retained");
  // Junk titles should be rejected
  assert.ok(!titles.includes("Read more"), "Junk title should be rejected");
  assert.ok(!titles.includes("click here"), "Junk title should be rejected");
  assert.ok(!titles.includes("View all jobs"), "Generic careers page title should be rejected");
});

// VAL-DATA-007: Multi-signal dedupe collapses semantic duplicates across alternate URLs
test("collectGroundedWebListings collapses semantic duplicates using multi-signal dedupe (VAL-DATA-007)", async () => {
  const run = makeRun();
  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion jobs"],
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
        // Structured JSON with same job appearing under alternate URLs
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Product Marketing Manager",
              company: "Notion",
              location: "Remote in United States",
              url: "https://www.notion.so/careers/product-marketing-manager",
              descriptionText: "Lead product marketing and messaging for remote-first launches.",
            },
            {
              title: "Product Marketing Manager",
              company: "Notion",
              location: "Remote in United States",
              // Alternate URL (short link vs long link)
              url: "https://notion.so/jobs/123",
              descriptionText: "Lead product marketing and messaging.",
            },
            {
              title: "Product Marketing Manager",
              company: "Notion",
              location: "Remote",
              // Another alternate URL with same title+company
              url: "https://www.notion.so/careers/product-marketing-manager?utm_source=linkedin",
              descriptionText: "Lead product marketing and messaging for remote-first launches.",
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
  });

  // Despite 3 entries for the same title+company across alternate URLs,
  // multi-signal dedupe should collapse them to 1
  const titles = result.rawListings.map((l) => l.title);
  assert.equal(
    titles.filter((t) => t === "Product Marketing Manager").length,
    1,
    "Same title+company across alternate URLs should collapse to 1 entry",
  );
});
