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

// === VAL-ROUTE-012: Multi-query fan-out from modifiers ===

function makeUnrestrictedRun(overrides = {}) {
  const defaults = {
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
      companies: [{ name: "" }], // Empty company = unrestricted scope
      includeKeywords: ["marketing", "product"],
      excludeKeywords: [],
      targetRoles: ["Product Marketing Manager", "Senior Product Manager"],
      locations: ["Remote", "United States"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
      // UltraPlan tuning with multi-query enabled
      ultraPlanTuning: {
        multiQueryEnabled: true,
        retryBroadeningEnabled: true,
        parallelCompanyProcessingEnabled: false,
      },
      // Grounded search tuning with cap
      groundedSearchTuning: {
        maxResultsPerCompany: 6,
        maxPagesPerCompany: 4,
        maxRuntimeMs: 30000,
        maxTokensPerQuery: 2048,
        multiQueryCap: 4,
      },
    },
  };

  // Deep merge the overrides
  if (overrides.config?.groundedSearchTuning) {
    defaults.config.groundedSearchTuning = {
      ...defaults.config.groundedSearchTuning,
      ...overrides.config.groundedSearchTuning,
    };
  }
  if (overrides.config?.ultraPlanTuning) {
    defaults.config.ultraPlanTuning = {
      ...defaults.config.ultraPlanTuning,
      ...overrides.config.ultraPlanTuning,
    };
  }
  if (overrides.config) {
    defaults.config = { ...defaults.config, ...overrides.config };
  }

  return defaults;
}

test("VAL-ROUTE-012: multi-query fan-out generates multiple focused queries from modifiers", async () => {
  const run = makeUnrestrictedRun();
  const callLog: string[] = [];

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [
                        {
                          url: "https://example.com/job1",
                          title: "Product Marketing Manager",
                          pageType: "job",
                          reason: "Direct job posting",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  // Verify multi-query mode was used
  assert.ok(result.diagnostics, "Should have diagnostics");
  assert.equal(result.diagnostics!.multiQueryFanOutEnabled, true, "multiQueryFanOutEnabled should be true");
  assert.ok(result.diagnostics!.focusedQueryCount > 0, "Should have generated focused queries");
  assert.ok(result.diagnostics!.multiQueryCap > 0, "Should have multiQueryCap set");
  assert.ok(result.queryEvidence && result.queryEvidence.length > 0, "Should have query evidence");
});

test("VAL-ROUTE-012: multi-query fan-out caps at configured multiQueryCap", async () => {
  const run = makeUnrestrictedRun({
    config: {
      groundedSearchTuning: { multiQueryCap: 2 },
    },
  });

  let queryCount = 0;

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      queryCount++;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [
                        {
                          url: `https://example.com/job${queryCount}`,
                          title: "Product Marketing Manager",
                          pageType: "job",
                          reason: "Direct job posting",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: [`test query ${queryCount}`],
                groundingChunks: [],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  // The number of unique focused queries generated should be capped
  assert.ok(result.diagnostics, "Should have diagnostics");
  assert.ok(
    result.diagnostics!.focusedQueryCount <= run.config.groundedSearchTuning!.multiQueryCap!,
    `Generated queries (${result.diagnostics!.focusedQueryCount}) should be <= cap (${run.config.groundedSearchTuning!.multiQueryCap})`,
  );
});

test("VAL-ROUTE-012: multi-query fan-out produces deterministic unique queries for same input", async () => {
  const run = makeUnrestrictedRun();

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
                          url: "https://example.com/job1",
                          title: "Product Marketing Manager",
                          pageType: "job",
                          reason: "Direct job posting",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [],
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

  // Run twice with the same input
  const [result1, result2] = await Promise.all([
    client.search(run.config.companies[0], run),
    client.search(run.config.companies[0], run),
  ]);

  // Query counts should be identical (deterministic)
  assert.equal(
    result1.diagnostics!.focusedQueryCount,
    result2.diagnostics!.focusedQueryCount,
    "Same input should produce same number of focused queries",
  );

  // Query evidence should have same structure
  assert.equal(
    result1.queryEvidence?.length,
    result2.queryEvidence?.length,
    "Same input should produce same number of query evidence entries",
  );
});

// === VAL-ROUTE-013: Zero-candidate queries follow ordered broadening ladder ===

test("VAL-ROUTE-013: zero-candidate focused query triggers broadening ladder in correct order", async () => {
  const run = makeUnrestrictedRun({
    config: {
      groundedSearchTuning: { multiQueryCap: 1 }, // Single focused query to test ladder clearly
    },
  });

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [], // Zero candidates - triggers retry
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  // Verify query evidence shows the ladder progression for the single focused query
  assert.ok(result.queryEvidence, "Should have query evidence");
  // With cap=1 and zero candidates, we should see multiple rungs: 0 -> 1 -> 2
  assert.ok(result.queryEvidence!.length >= 2, `Should have multiple rung attempts, got ${result.queryEvidence!.length}`);

  // Verify rung order within the single query's ladder: 0 -> 1 -> 2
  // Since we only have one focused query, the rungs should be strictly increasing
  const rungs = result.queryEvidence!.map((e) => e.rung);
  for (let i = 1; i < rungs.length; i++) {
    assert.ok(
      rungs[i] > rungs[i - 1],
      `Rung order should be strictly increasing for single query: ${rungs}`,
    );
  }

  // Verify diagnostics show ladder behavior
  assert.ok(result.diagnostics, "Should have diagnostics");
  assert.equal(result.diagnostics!.retryBroadeningEnabled, true, "retryBroadeningEnabled should be true");
  assert.equal(result.diagnostics!.ladderExhausted, true, "Ladder should be exhausted with zero candidates");
});

test("VAL-ROUTE-013: broadening ladder executes each rung at most once per focused query", async () => {
  const run = makeUnrestrictedRun({
    config: {
      groundedSearchTuning: { multiQueryCap: 1 }, // Single focused query
    },
  });

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [], // Always zero candidates to force full ladder
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  // For the single focused query, each exact query text should appear at most once
  const queryCounts = new Map<string, number>();
  for (const evidence of result.queryEvidence!) {
    const count = queryCounts.get(evidence.query) || 0;
    queryCounts.set(evidence.query, count + 1);
  }

  for (const [query, count] of queryCounts) {
    assert.ok(
      count <= 1,
      `Query "${query}" should execute at most once per focused query, but executed ${count} times`,
    );
  }
});

// === VAL-ROUTE-014: First-rung success does not trigger unnecessary broadening ===

test("VAL-ROUTE-014: first-rung success short-circuits retry ladder for that query", async () => {
  const run = makeUnrestrictedRun({
    config: {
      groundedSearchTuning: { multiQueryCap: 1 }, // Single focused query to test clearly
    },
  });

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [
                        {
                          url: "https://example.com/job1",
                          title: "Product Marketing Manager",
                          pageType: "job",
                          reason: "Direct job posting",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [
                  {
                    web: {
                      uri: "https://example.com/job1",
                      title: "Product Marketing Manager",
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
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  // With candidates found on first rung, should only have 1 evidence entry (the first rung)
  assert.ok(result.queryEvidence, "Should have query evidence");
  assert.ok(
    result.queryEvidence!.length === 1,
    `First-rung success should produce 1 evidence entry, got ${result.queryEvidence!.length}`,
  );
  assert.equal(result.queryEvidence![0].rung, 0, "First evidence should be rung 0");
  assert.equal(result.queryEvidence![0].terminal, false, "First rung should not be terminal (candidates found)");
});

test("VAL-ROUTE-014: first-rung success means no broader retries for that query", async () => {
  const run = makeUnrestrictedRun({
    config: {
      groundedSearchTuning: { multiQueryCap: 1 }, // Single focused query
    },
  });

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [
                        {
                          url: "https://example.com/job1",
                          title: "Product Marketing Manager",
                          pageType: "job",
                          reason: "Direct job posting",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  // First rung returned candidates, so rungs 1 and 2 should not be in evidence
  const rungsAttempted = result.queryEvidence!.map((e) => e.rung);
  assert.ok(
    !rungsAttempted.includes(1) && !rungsAttempted.includes(2),
    `First-rung success should not attempt rung 1 or 2, but attempted rungs: ${rungsAttempted}`,
  );
});

// === VAL-ROUTE-017: Retry ladder exhaustion terminates finitely with explicit attribution ===

test("VAL-ROUTE-017: all-zero ladder terminates finitely with exhaustion attribution", async () => {
  const run = makeUnrestrictedRun();

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      // Always return zero candidates to force full ladder exhaustion
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  // Verify diagnostics show exhaustion
  assert.ok(result.diagnostics, "Should have diagnostics");
  assert.equal(result.diagnostics!.ladderExhausted, true, "ladderExhausted should be true");
  assert.ok(result.diagnostics!.exhaustedRungs, "Should have exhaustedRungs attribution");

  // Verify each exhausted sub-query has final rung attribution
  for (const exhausted of result.diagnostics!.exhaustedRungs!) {
    assert.ok(
      exhausted.finalRung >= 0 && exhausted.finalRung <= 2,
      `Exhausted rung should be 0-2, got ${exhausted.finalRung}`,
    );
  }

  // Verify warnings mention exhaustion
  assert.ok(
    result.warnings.some((w) => w.includes("exhausted") || w.includes("zero candidates")),
    "Warnings should mention ladder exhaustion",
  );
});

test("VAL-ROUTE-017: exhaustion attribution includes rung context", async () => {
  const run = makeUnrestrictedRun();

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      results: [],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  // Verify query evidence includes terminal flag and rung
  for (const evidence of result.queryEvidence!) {
    assert.ok(
      evidence.rung >= 0 && evidence.rung <= 2,
      `Evidence rung should be 0-2, got ${evidence.rung}`,
    );
    // Terminal evidence should have terminal: true
    if (evidence.terminal) {
      assert.ok(
        evidence.candidateCount === 0,
        "Terminal evidence with zero candidates should be properly marked",
      );
    }
  }
});

// === Edge cases ===

test("multi-query fan-out is skipped when multiQueryEnabled is false", async () => {
  const run = makeUnrestrictedRun({
    config: {
      ultraPlanTuning: {
        multiQueryEnabled: false,
        retryBroadeningEnabled: false,
        parallelCompanyProcessingEnabled: false,
      },
    },
  });

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
                          url: "https://example.com/job1",
                          title: "Product Marketing Manager",
                          pageType: "job",
                          reason: "Direct job posting",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["Notion product marketing manager"],
                groundingChunks: [],
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

  const result = await client.search(run.config.companies[0], run);

  // Should NOT have multi-query diagnostics when disabled
  assert.ok(!result.diagnostics || !result.diagnostics.multiQueryFanOutEnabled,
    "multiQueryFanOutEnabled should be false when disabled");
});

test("retry broadening is skipped when retryBroadeningEnabled is false", async () => {
  const run = makeUnrestrictedRun({
    config: {
      ultraPlanTuning: {
        multiQueryEnabled: true,
        retryBroadeningEnabled: false,
        parallelCompanyProcessingEnabled: false,
      },
    },
  });

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
                      results: [], // Zero candidates
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["test query"],
                groundingChunks: [],
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

  const result = await client.search(run.config.companies[0], run);

  // When retry is disabled, should not have multiple rung attempts for same query
  // (may still have multiple queries from fan-out, but no retry ladder per query)
  assert.ok(result.diagnostics, "Should have diagnostics");
  assert.equal(result.diagnostics!.retryBroadeningEnabled, false, "retryBroadeningEnabled should be false");
});

// === VAL-OBS-001: fetch_fallback diagnostic when session falls back to plain fetch ===

test("collectGroundedWebListings emits fetch_fallback diagnostic when session falls back to fetch", async () => {
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
              descriptionText: "Lead product marketing.",
            },
          ],
        }),
        metadata: {
          mode: "fetch_fallback",
          browserUseCommandError: "browser-use command not found",
        },
      }),
    },
  });

  // Should have fetch_fallback diagnostic
  assert.ok(result.diagnostics, "Should have diagnostics");
  const fallbackDiag = result.diagnostics!.find((d) => d.code === "fetch_fallback");
  assert.ok(fallbackDiag, "Should have fetch_fallback diagnostic");
  assert.match(fallbackDiag!.context, /browser-use command not found/i);
  assert.equal(fallbackDiag!.url, "https://www.notion.so/careers");

  // Should also have a backward-compatible warning about fallback
  assert.ok(result.warnings.some((w) => w.includes("fallback") || w.includes("browser-use command unavailable")), "Should have fallback warning");
});

// === VAL-OBS-001: low_content_spa diagnostic for very short responses ===

test("collectGroundedWebListings emits low_content_spa diagnostic for very short SPA responses", async () => {
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
        // Very short response that looks like an SPA loading state
        text: "<div id='root'></div>",
        metadata: { mode: "fetch" },
      }),
    },
  });

  // Should have low_content_spa diagnostic
  assert.ok(result.diagnostics, "Should have diagnostics");
  const lowContentDiag = result.diagnostics!.find((d) => d.code === "low_content_spa");
  assert.ok(lowContentDiag, "Should have low_content_spa diagnostic");
  assert.match(lowContentDiag!.context, /SPA|loading|skeleton/i);
  assert.equal(lowContentDiag!.url, "https://www.notion.so/careers");
});

// === VAL-OBS-001: low_content_spa diagnostic for skeleton loading patterns ===

test("collectGroundedWebListings emits low_content_spa diagnostic for skeleton loading patterns", async () => {
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
        // HTML with skeleton/loading class patterns
        text: `
          <html><body>
            <div class="skeleton-loader"></div>
            <div class="loading-spinner"></div>
            <div class="job-skeleton"></div>
          </body></html>
        `,
        metadata: { mode: "fetch" },
      }),
    },
  });

  // Should have low_content_spa diagnostic for skeleton patterns
  assert.ok(result.diagnostics, "Should have diagnostics");
  const lowContentDiag = result.diagnostics!.find((d) => d.code === "low_content_spa");
  assert.ok(lowContentDiag, "Should have low_content_spa diagnostic for skeleton patterns");
  assert.match(lowContentDiag!.context, /skeleton|loading/i);
});

// === VAL-OBS-003: zero_results diagnostic when extraction returns no listings ===

test("collectGroundedWebListings emits zero_results diagnostic when all pages return empty", async () => {
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
          {
            url: "https://www.notion.so/jobs",
            title: "Notion Jobs",
            pageType: "listings",
            reason: "Jobs page",
            sourceDomain: "www.notion.so",
          },
        ],
        warnings: [],
      }),
    },
    sessionManager: {
      run: async ({ url }) => ({
        url,
        // Return minimal HTML that won't extract any jobs
        text: "<html><body><p>No jobs available</p></body></html>",
        metadata: { mode: "fetch" },
      }),
    },
  });

  // Should have zero_results diagnostic
  assert.ok(result.diagnostics, "Should have diagnostics");
  const zeroResultsDiag = result.diagnostics!.find((d) => d.code === "zero_results");
  assert.ok(zeroResultsDiag, "Should have zero_results diagnostic");
  assert.match(zeroResultsDiag!.context, /zero.*listing|2.*candidate/i);

  // Should also have a backward-compatible warning about zero results
  assert.ok(result.warnings.some((w) => w.includes("zero") || w.includes("no listings")), "Should have zero-results warning");

  // Raw listings should be empty
  assert.equal(result.rawListings.length, 0, "Should have zero raw listings");
});

// === VAL-OBS-003: dual-layer diagnostics + warnings for degraded zero-result path ===

test("collectGroundedWebListings provides dual-layer diagnostics + warnings for degraded zero-result path", async () => {
  const run = makeRun();
  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["FictionalCompany product manager"],
        candidates: [
          {
            url: "https://www.fictionalcompany.com/careers",
            title: "FictionalCompany Careers",
            pageType: "careers",
            reason: "Employer careers page",
            sourceDomain: "www.fictionalcompany.com",
          },
        ],
        warnings: [],
      }),
    },
    sessionManager: {
      run: async ({ url }) => ({
        url,
        // SPA loading state that returns zero listings
        text: "<div id='root'></div>",
        metadata: {
          mode: "fetch_fallback",
          browserUseCommandError: "Command timed out",
        },
      }),
    },
  });

  // VAL-CROSS-002: Degraded path must have BOTH structured diagnostics AND warnings
  assert.ok(result.diagnostics, "Degraded path must have structured diagnostics");
  assert.ok(result.warnings.length > 0, "Degraded path must have warnings");

  // Should have both fetch_fallback and low_content_spa/zero_results diagnostics
  const fallbackDiag = result.diagnostics!.find((d) => d.code === "fetch_fallback");
  assert.ok(fallbackDiag, "Degraded path must have fetch_fallback diagnostic");

  // Should have a backward-compatible warning about fallback
  assert.ok(result.warnings.some((w) => w.includes("fallback") || w.includes("fetch")), "Degraded path must have fallback warning");

  // Zero result should be reflected
  assert.equal(result.rawListings.length, 0, "Degraded extraction should return zero listings");
});
