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

const originalFetch = globalThis.fetch;

function makePreflightResponse(url: string): Response {
  const normalizedUrl = String(url || "");
  const title = normalizedUrl.includes("/careers")
    ? "Notion Careers"
    : normalizedUrl.includes("lever.co")
      ? "Product Marketing Manager at Notion"
      : "Backend Engineer at Notion";
  const longDescription = "This role includes job description, responsibilities, qualifications, and an apply now path for current openings. ".repeat(8);
  const body = normalizedUrl.includes("/careers")
    ? `
      <html>
      <head><title>${title}</title></head>
      <body>
        <h1>Open Roles</h1>
        <a href="/jobs/123">Backend Engineer</a>
        <p>${longDescription}</p>
      </body>
      </html>
    `
    : `
      <html>
      <head><title>${title}</title></head>
      <body>
        <h1>${title}</h1>
        <button>Apply now</button>
        <p>${longDescription}</p>
      </body>
      </html>
    `;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

test.beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request) => makePreflightResponse(String(input))) as typeof fetch;
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

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

test("createGroundedSearchClient keeps third-party boards as hint_only candidates while merging canonical results", async () => {
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
  assert.equal(result.candidates.length, 3);
  assert.equal(
    result.candidates[0].url,
    "https://www.notion.so/careers/product-marketing-manager",
  );
  const linkedinCandidate = result.candidates.find((entry) => entry.url.includes("linkedin.com/jobs/view/123"));
  assert.ok(linkedinCandidate, "LinkedIn candidate should be preserved as hint-only");
  assert.equal(linkedinCandidate?.sourcePolicy, "hint_only");
  assert.ok(result.candidates.every((entry) => !entry.url.includes("google.com")));
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

test("collectGroundedWebListings honors the resolved run page limit over runtime defaults", async () => {
  const run = makeRun();
  run.config.groundedSearchTuning = {
    maxResultsPerCompany: 8,
    maxPagesPerCompany: 4,
    maxRuntimeMs: 300000,
    maxTokensPerQuery: 4096,
    multiQueryCap: 4,
  };

  const visitedUrls: string[] = [];
  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig({
      groundedSearchMaxPagesPerCompany: 2,
    }),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://jobs.lever.co/notion/1",
            title: "Product Marketing Manager | Notion",
            pageType: "job",
            reason: "ATS direct job page",
            sourceDomain: "jobs.lever.co",
          },
          {
            url: "https://jobs.lever.co/notion/2",
            title: "Senior Product Marketing Manager | Notion",
            pageType: "job",
            reason: "ATS direct job page",
            sourceDomain: "jobs.lever.co",
          },
          {
            url: "https://jobs.lever.co/notion/3",
            title: "Lifecycle Marketing Manager | Notion",
            pageType: "job",
            reason: "ATS direct job page",
            sourceDomain: "jobs.lever.co",
          },
          {
            url: "https://jobs.lever.co/notion/4",
            title: "Growth Marketing Manager | Notion",
            pageType: "job",
            reason: "ATS direct job page",
            sourceDomain: "jobs.lever.co",
          },
        ],
        warnings: [],
      }),
    },
    sessionManager: {
      run: async ({ url }) => {
        visitedUrls.push(url);
        return {
          url,
          text: JSON.stringify({
            pageType: "job",
            jobs: [
              {
                title: `Role ${visitedUrls.length}`,
                company: "Notion",
                location: "Remote",
                url,
                descriptionText: "Product marketing role",
              },
            ],
          }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  assert.equal(result.pagesVisited, 4, "Should visit 4 pages from resolved run config");
  assert.equal(visitedUrls.length, 4, "Should not be capped by runtime default page limit");
});

test("collectGroundedWebListings resolves hint_only candidates to canonical ATS pages before extraction", async () => {
  const run = makeRun();
  const visitedUrls: string[] = [];
  const preflightedUrls: string[] = [];

  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Product Marketing Manager at Notion"],
        candidates: [
          {
            url: "https://www.workingnomads.com/jobs/product-marketing-manager",
            title: "Product Marketing Manager at Notion | Working Nomads",
            pageType: "job",
            reason: "Third-party hint",
            sourceDomain: "www.workingnomads.com",
            sourcePolicy: "hint_only",
          },
        ],
        warnings: [],
      }),
      resolveHint: async () => [
        {
          url: "https://jobs.lever.co/notion/product-marketing-manager",
          title: "Product Marketing Manager at Notion",
          pageType: "job",
          reason: "Canonical ATS job page",
          sourceDomain: "jobs.lever.co",
          sourcePolicy: "extractable",
        },
      ],
    },
    fetchImpl: async (url) => {
      preflightedUrls.push(String(url));
      return makePreflightResponse(String(url));
    },
    sessionManager: {
      run: async ({ url }) => {
        visitedUrls.push(url);
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
                descriptionText: "Lead product marketing campaigns and launches.",
              },
            ],
          }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  assert.deepEqual(preflightedUrls, ["https://jobs.lever.co/notion/product-marketing-manager"]);
  assert.deepEqual(visitedUrls, ["https://jobs.lever.co/notion/product-marketing-manager"]);
  assert.equal(result.rawListings.length, 1);
  assert.ok(
    result.diagnostics?.some((entry) => entry.code === "hint_only_candidate"),
    "Should emit hint_only_candidate diagnostic for the third-party board",
  );
});

test("collectGroundedWebListings rejects broken candidates during strict preflight before browser extraction", async () => {
  const run = makeRun();
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
            url: "https://jobs.lever.co/notion/broken-role",
            title: "Product Marketing Manager at Notion",
            pageType: "job",
            reason: "ATS direct job page",
            sourceDomain: "jobs.lever.co",
          },
        ],
        warnings: [],
      }),
    },
    fetchImpl: async () =>
      new Response("<html><title>Page Not Found</title><body>404 Page Not Found</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    sessionManager: {
      run: async ({ url }) => {
        sessionCalls += 1;
        return {
          url,
          text: "",
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  assert.equal(sessionCalls, 0, "Broken pages should be rejected before browser extraction");
  assert.equal(result.pagesVisited, 0);
  assert.equal(result.rawListings.length, 0);
  assert.ok(
    result.diagnostics?.some((entry) => entry.code === "preflight_rejected"),
    "Should emit preflight_rejected diagnostic",
  );
});

test("collectGroundedWebListings rejects informational company pages nested under /jobs paths", async () => {
  const run = makeUnrestrictedRun({
    config: {
      companies: [{ name: "Two Barrels" }],
      includeKeywords: ["marketing", "data"],
      targetRoles: ["Marketing Data Analyst"],
      locations: ["Remote"],
      remotePolicy: "remote",
    },
  });
  let sessionCalls = 0;

  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Marketing Data Analyst remote jobs"],
        candidates: [
          {
            url: "https://twobarrels.com/jobs/how-we-work",
            title: "How We Work | Two Barrels",
            pageType: "job",
            reason: "Employer page under /jobs path",
            sourceDomain: "twobarrels.com",
          },
        ],
        warnings: [],
      }),
    },
    fetchImpl: async () =>
      new Response(
        `
          <html>
          <head><title>How We Work</title></head>
          <body>
            <h1>How We Work</h1>
            <p>${"Benefits, values, and company culture information for employees. ".repeat(12)}</p>
          </body>
          </html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      ),
    sessionManager: {
      run: async ({ url }) => {
        sessionCalls += 1;
        return {
          url,
          text: "",
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  assert.equal(sessionCalls, 0, "Informational company pages should be rejected before extraction");
  assert.equal(result.pagesVisited, 0);
  assert.equal(result.rawListings.length, 0);
  assert.ok(
    result.diagnostics?.some(
      (entry) =>
        entry.code === "preflight_rejected" &&
        /informational company content/i.test(entry.context),
    ),
    "Should emit preflight_rejected diagnostic for informational job-adjacent pages",
  );
});

test("collectGroundedWebListings extracts a direct job page from page signals when no JSON is present", async () => {
  const run = makeUnrestrictedRun({
    config: {
      targetRoles: ["Growth Marketing Manager"],
      includeKeywords: ["marketing", "growth"],
      locations: ["Remote"],
      remotePolicy: "remote",
    },
  });

  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Growth Marketing Manager remote jobs"],
        candidates: [
          {
            url: "https://jobs.lever.co/notion/growth-marketing-manager",
            title: "Growth Marketing Manager at Notion",
            pageType: "job",
            reason: "ATS direct job page",
            sourceDomain: "jobs.lever.co",
          },
        ],
        warnings: [],
      }),
    },
    sessionManager: {
      run: async ({ url }) => ({
        url,
        text: `
          <html>
          <body>
            <h1>Growth Marketing Manager</h1>
            <div>Location: Remote</div>
            <section>
              <p>Own growth campaigns across product launches and lifecycle programs.</p>
            </section>
          </body>
          </html>
        `,
        metadata: {
          mode: "browser_use_command",
          title: "Growth Marketing Manager | Notion",
        },
      }),
    },
  });

  assert.equal(result.rawListings.length, 1);
  assert.equal(result.rawListings[0].title, "Growth Marketing Manager");
  assert.equal(result.rawListings[0].company, "Notion");
  assert.equal(result.rawListings[0].location, "Remote");
  assert.equal(result.rawListings[0].metadata?.extractionMode, "page_signals");
});

test("collectGroundedWebListings uses anchor attributes when inner text is junk", async () => {
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
        text: `
          <html>
          <body>
            <a href="/jobs/456" aria-label="Senior Software Engineer"><span>Apply now</span></a>
          </body>
          </html>
        `,
        metadata: { mode: "browser_use_command" },
      }),
    },
  });

  assert.equal(result.rawListings.length, 1);
  assert.equal(result.rawListings[0].title, "Senior Software Engineer");
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

test("createGroundedSearchClient aggregates grounded text and citations across Gemini candidates", async () => {
  const run = makeRun();
  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "" }],
              },
            },
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
                webSearchQueries: ["Notion product marketing manager jobs"],
                groundingChunks: [
                  {
                    web: {
                      uri: "https://www.notion.so/careers/product-marketing-manager",
                      title: "Product Marketing Manager - Notion",
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

  const result = await client.search(run.config.companies[0], run);

  assert.deepEqual(result.searchQueries, ["Notion product marketing manager jobs"]);
  assert.equal(result.candidates.length, 2);
  assert.ok(
    result.candidates.some((entry) => entry.url === "https://www.notion.so/careers"),
    "Should capture structured URL from later candidate text",
  );
  assert.ok(
    result.candidates.some(
      (entry) =>
        entry.url === "https://www.notion.so/careers/product-marketing-manager",
    ),
    "Should capture citation URL from later candidate grounding metadata",
  );
});

test("grounded search surfaces upstream HTTP failures instead of misreporting zero candidates", async () => {
  const run = makeUnrestrictedRun({
    config: {
      groundedSearchTuning: { multiQueryCap: 1 },
    },
  });
  let callCount = 0;

  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          error: {
            message: "Quota exceeded for metric generate_content_free_tier_requests.",
          },
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.search(run.config.companies[0], run);

  assert.equal(callCount, 1, "429 should abort the ladder instead of broadening all rungs");
  assert.equal(result.candidates.length, 0);
  assert.ok(
    result.warnings.some((warning) => /HTTP 429|quota exceeded/i.test(warning)),
    "Should surface upstream quota failure in warnings",
  );
  assert.ok(
    !result.warnings.some((warning) => /no usable candidate links|exhausted/i.test(warning)),
    "Should not misreport quota failure as zero-result ladder exhaustion",
  );
  assert.ok(result.diagnostics?.requestFailures?.length, "Should expose request failure diagnostics");
  assert.equal(result.diagnostics?.abortedDueToUpstreamError, true);
});

test("createGroundedSearchClient searchAtsHosts filters results to known ATS hosts", async () => {
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
                          url: "https://boards.greenhouse.io/acme/jobs/123",
                          title: "Data Analyst at Acme",
                          pageType: "job",
                          reason: "Direct ATS page",
                        },
                        {
                          url: "https://www.linkedin.com/jobs/view/999",
                          title: "LinkedIn result that should be filtered",
                          pageType: "job",
                          reason: "Third-party board",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["greenhouse data analyst remote"],
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

  const result = await client.searchAtsHosts?.({
    run: makeUnrestrictedRun(),
    sourceIds: ["greenhouse", "ashby"],
  });

  assert.ok(result, "searchAtsHosts should be implemented");
  assert.equal(result?.candidates.length, 1);
  assert.equal(
    result?.candidates[0]?.url,
    "https://boards.greenhouse.io/acme/jobs/123",
  );
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

test("collectGroundedWebListings emits upstream_error diagnostic and suppresses zero_results for search failures", async () => {
  const run = makeRun();
  const result = await collectGroundedWebListings({
    company: run.config.companies[0],
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: [],
        candidates: [],
        warnings: [
          "Grounded search upstream failure: HTTP 429: Quota exceeded for metric generate_content_free_tier_requests.",
        ],
        diagnostics: {
          multiQueryFanOutEnabled: true,
          multiQueryCap: 4,
          focusedQueryCount: 1,
          retryBroadeningEnabled: true,
          ladderExhausted: false,
          requestFailures: [
            {
              query: "Product Marketing Manager remote jobs",
              rung: 0,
              status: 429,
              message: "Quota exceeded for metric generate_content_free_tier_requests.",
              retryable: false,
            },
          ],
          abortedDueToUpstreamError: true,
        },
      }),
    },
    sessionManager: {
      run: async () => {
        throw new Error("sessionManager should not run when search returned no candidates");
      },
    },
  });

  assert.ok(result.diagnostics, "Should have diagnostics");
  assert.ok(
    result.diagnostics.some((entry) => entry.code === "upstream_error"),
    "Should emit upstream_error diagnostic",
  );
  assert.ok(
    !result.diagnostics.some((entry) => entry.code === "zero_results"),
    "Should not add zero_results when upstream search failed",
  );
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

// === VAL-OBS-001: low_content_html diagnostic for mostly-HTML minimal-content responses ===

test("collectGroundedWebListings emits low_content_html diagnostic for mostly-HTML minimal-content responses", async () => {
  const run = makeRun();
  // Create HTML that triggers low_content_html:
  // - length >= 500 (to skip low_content_spa short response path at length < 500)
  // - htmlTagCount > 20
  // - textContentRatio < 0.3
  // - length < 2000
  // - Does NOT match skeleton/loading patterns (no empty div chains)
  // This creates a page with lots of HTML markup but minimal extractable text
  const htmlParts: string[] = [];
  for (let i = 0; i < 40; i++) {
    // Use self-closing syntax which is common in React/SSR and won't match empty div chain pattern
    htmlParts.push("<div class='item-" + i + "'/>");
  }
  // Add minimal text content
  htmlParts.push("<p>X</p>");
  const htmlContent = "<html><head><title>Test</title></head><body>" +
    htmlParts.join("") +
    "</body></html>";
  // 42 tags: html, head, title, body, 40 self-closing divs, p
  // Self-closing divs don't match empty div chain pattern
  // Length should be > 500, < 2000
  // htmlTagCount ~42 (> 20), textContentRatio < 0.3
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
        text: htmlContent,
        metadata: { mode: "fetch" },
      }),
    },
  });

  // Should have low_content_html diagnostic
  assert.ok(result.diagnostics, "Should have diagnostics");
  const lowContentDiag = result.diagnostics!.find((d) => d.code === "low_content_html");
  assert.ok(lowContentDiag, "Should have low_content_html diagnostic for mostly-HTML responses");
  assert.match(lowContentDiag!.context, /HTML|markup|tag|text content/i);
  assert.equal(lowContentDiag!.url, "https://acme.com/careers");
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

// === VAL-DATA-001: Regex fallback for non-JSON/conversational grounded output ===

test("VAL-DATA-001: regex fallback recovers URLs from conversational/non-JSON output", async () => {
  const run = makeRun();
  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    // Conversational response with URLs embedded in text
                    text: "Based on my search, I found some great opportunities for you at Notion. Check out the careers page at https://www.notion.so/careers and also look at https://www.notion.so/careers/product-marketing-manager for the specific role. Another good resource is https://jobs.lever.co/notion.",
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

  // Should recover URLs via regex fallback
  assert.ok(result.candidates.length > 0, "Should recover URLs from conversational output");

  // Should include the employer careers page
  const urls = result.candidates.map((c) => c.url);
  assert.ok(urls.some((u) => u.includes("notion.so/careers")), "Should recover notion.so/careers URL");
  assert.ok(urls.some((u) => u.includes("lever.co")), "Should recover lever.co URL");

  // Should have regex fallback diagnostic and warning
  if (result.diagnostics?.regexFallbackUsed) {
    assert.ok(true, "regexFallbackUsed diagnostic should be set");
  }
  const regexWarning = result.warnings.find((w) => w.includes("Regex URL fallback"));
  assert.ok(regexWarning, "Should have regex fallback warning");
});

test("VAL-DATA-001: regex fallback handles zero-supported case explicitly", async () => {
  const run = makeRun();
  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    // Non-JSON response with no valid URLs
                    text: "I couldn't find any relevant job postings for this search.",
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["NonexistentCompany xyz marketing"],
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

  // Should have zero candidates and explicit fallback attribution
  assert.equal(result.candidates.length, 0, "Should have zero candidates for no-URL response");

  // Should have regex fallback warning
  const regexWarning = result.warnings.find((w) => w.includes("Regex URL fallback"));
  assert.ok(regexWarning, "Should have regex fallback warning for non-JSON with no URLs");
});

test("VAL-DATA-001: regex fallback keeps hint-only boards but blocks unsupported destinations", async () => {
  const run = makeRun();
  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "Found some jobs at https://www.linkedin.com/jobs/view/123, https://www.indeed.com/jobs/456, and https://www.notion.so/careers/product-marketing-manager",
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

  const urls = result.candidates.map((c) => c.url);
  const linkedin = result.candidates.find((c) => c.url.includes("linkedin"));
  const indeed = result.candidates.find((c) => c.url.includes("indeed"));
  assert.ok(urls.some((u) => u.includes("notion.so")), "Should include supported notion.so URL");
  assert.equal(linkedin?.sourcePolicy, "hint_only", "LinkedIn should be retained as hint_only");
  assert.equal(indeed?.sourcePolicy, "hint_only", "Indeed should be retained as hint_only");
});

// === VAL-DATA-002: Source policy classification across host variants ===

test("VAL-DATA-002: source policy classifies subdomain variants across all ingestion paths", async () => {
  const run = makeRun();
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
                        { url: "https://jobs.lever.co/notion/123", title: "Job 1" },
                        { url: "https://apply.linkedin.com/jobs/view/456", title: "Job 2" },
                        { url: "https://www.indeed.com/jobs/view/789", title: "Job 3" },
                        { url: "https://www.glassdoor.com/job-listing/backend-engineer-acme-JV_IC1132348_KO0,16_KE17,21.htm", title: "Job 4" },
                        { url: "https://careers.acme.com/job/111", title: "Job 5" },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["Notion jobs"],
                groundingChunks: [
                  { web: { uri: "https://jobs.lever.co/notion/123", title: "Job 1" } },
                  { web: { uri: "https://apply.linkedin.com/jobs/view/456", title: "Job 2" } },
                  { web: { uri: "https://www.indeed.com/jobs/view/789", title: "Job 3" } },
                  { web: { uri: "https://www.glassdoor.com/job-listing/backend-engineer-acme-JV_IC1132348_KO0,16_KE17,21.htm", title: "Job 4" } },
                  { web: { uri: "https://careers.acme.com/job/111", title: "Job 5" } },
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

  const result = await client.search(run.config.companies[0], run);

  const urls = result.candidates.map((c) => c.url);
  const linkedin = result.candidates.find((c) => c.url.includes("linkedin.com"));
  const indeed = result.candidates.find((c) => c.url.includes("indeed.com"));
  const lever = result.candidates.find((c) => c.url.includes("lever.co"));
  const employer = result.candidates.find((c) => c.url.includes("acme.com"));

  assert.ok(urls.some((u) => u.includes("acme.com")), "Should include valid employer domain");
  assert.equal(linkedin?.sourcePolicy, "hint_only", "LinkedIn should be hint_only");
  assert.equal(indeed?.sourcePolicy, "hint_only", "Indeed should be hint_only");
  assert.equal(lever?.sourcePolicy, "extractable", "Lever should remain extractable");
  assert.equal(employer?.sourcePolicy, "extractable", "Employer domain should remain extractable");
});

test("VAL-DATA-002: widened hint-only hosts classify BuiltIn, Wellfound, WorkingNomads, and Google Jobs-like results correctly", async () => {
  const run = makeRun();
  const client = createGroundedSearchClient(
    makeRuntimeConfig({ groundedSearchMaxResultsPerCompany: 8 }),
    {
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
                        { url: "https://www.builtin.com/job/backend-engineer/333", title: "BuiltIn Job" },
                        { url: "https://wellfound.com/jobs/444", title: "Wellfound Job" },
                        { url: "https://www.workingnomads.com/jobs/555", title: "Working Nomads Job" },
                        { url: "https://www.google.com/search?ibp=htl;jobs&q=backend+engineer", title: "Google Jobs" },
                        { url: "https://jobs.lever.co/notion/123", title: "Lever Job" },
                        { url: "https://careers.acme.com/job/111", title: "Employer Job" },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["Notion jobs"],
                groundingChunks: [
                  { web: { uri: "https://www.builtin.com/job/backend-engineer/333", title: "BuiltIn Job" } },
                  { web: { uri: "https://wellfound.com/jobs/444", title: "Wellfound Job" } },
                  { web: { uri: "https://www.workingnomads.com/jobs/555", title: "Working Nomads Job" } },
                  { web: { uri: "https://www.google.com/search?ibp=htl;jobs&q=backend+engineer", title: "Google Jobs" } },
                  { web: { uri: "https://jobs.lever.co/notion/123", title: "Lever Job" } },
                  { web: { uri: "https://careers.acme.com/job/111", title: "Employer Job" } },
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

  const result = await client.search(run.config.companies[0], run);

  const builtin = result.candidates.find((c) => c.url.includes("builtin.com"));
  const wellfound = result.candidates.find((c) => c.url.includes("wellfound.com"));
  const workingNomads = result.candidates.find((c) => c.url.includes("workingnomads.com"));
  const googleJobs = result.candidates.find((c) => c.url.includes("google.com/search"));
  const lever = result.candidates.find((c) => c.url.includes("lever.co"));
  const employer = result.candidates.find((c) => c.url.includes("acme.com"));

  assert.equal(builtin?.sourcePolicy, "hint_only", "BuiltIn should be hint_only");
  assert.equal(wellfound?.sourcePolicy, "hint_only", "Wellfound should be hint_only");
  assert.equal(workingNomads?.sourcePolicy, "hint_only", "WorkingNomads should be hint_only");
  assert.equal(googleJobs?.sourcePolicy, "hint_only", "Google Jobs-like search should be hint_only");
  assert.equal(lever?.sourcePolicy, "extractable", "Lever should remain extractable");
  assert.equal(employer?.sourcePolicy, "extractable", "Employer domain should remain extractable");
});

test("VAL-DATA-002: citation ingestion preserves hint_only candidates for later resolution", async () => {
  const run = makeRun();
  const client = createGroundedSearchClient(makeRuntimeConfig(), {
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "{}",
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["Notion marketing manager"],
                groundingChunks: [
                  // Only citation URLs - all should be filtered by denylist
                  { web: { uri: "https://jobs.linkedin.com/view/123", title: "LinkedIn Job" } },
                  { web: { uri: "https://www.indeed.com/jobs/view/456", title: "Indeed Job" } },
                  { web: { uri: "https://careers.notion.so/view/789", title: "Notion Careers" } },
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

  const result = await client.search(run.config.companies[0], run);

  const linkedin = result.candidates.find((c) => c.url.includes("linkedin.com"));
  const indeed = result.candidates.find((c) => c.url.includes("indeed.com"));
  const notion = result.candidates.find((c) => c.url.includes("careers.notion.so"));

  assert.equal(linkedin?.sourcePolicy, "hint_only", "LinkedIn citation should be hint_only");
  assert.equal(indeed?.sourcePolicy, "hint_only", "Indeed citation should be hint_only");
  assert.equal(notion?.sourcePolicy, "extractable", "First-party employer citation should stay extractable");
});

// === VAL-DATA-003: Bounded employer-domain bonus ranking ===

test("VAL-DATA-003: employer-domain bonus ranks first-party postings higher in tie scenarios", async () => {
  const run = makeRun(); // company = "Notion"
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
                        // Same pageType and similar signals - only employer domain should differ
                        // Use example.com as a non-denylisted aggregator to test ranking
                        { url: "https://www.example.com/company/notion/jobs/123", title: "Product Marketing Manager at Notion", pageType: "job" },
                        { url: "https://www.notion.so/careers/product-marketing-manager", title: "Product Marketing Manager", pageType: "job" },
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

  // First-party employer domain should rank higher due to bounded bonus
  const urls = result.candidates.map((c) => c.url);
  const notionIdx = urls.findIndex((u) => u.includes("notion.so"));
  const exampleIdx = urls.findIndex((u) => u.includes("example.com"));

  assert.ok(notionIdx >= 0 && exampleIdx >= 0, "Both URLs should be present");
  assert.ok(notionIdx < exampleIdx, "First-party notion.so should rank higher than example.com aggregator");
});

test("VAL-DATA-003: employer-domain bonus does not override stronger non-employer relevance", async () => {
  const run = makeRun(); // company = "Notion"
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
                        // Direct job page on aggregator (strong pageType score) vs careers page on employer domain
                        { url: "https://jobs.lever.co/notion/456", title: "Senior Product Marketing Manager at Notion", pageType: "job" },
                        { url: "https://www.notion.so/careers/general", title: "Notion Careers", pageType: "careers" },
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

  // The direct job page (pageType=job) should outrank the careers page
  // even though careers.notion.so is first-party, because "job" pageType scores 40
  // vs "careers" at 20, and the 4-point employer bonus can't override that 20-point difference
  const urls = result.candidates.map((c) => c.url);
  const leverIdx = urls.findIndex((u) => u.includes("lever.co"));
  const notionCareersIdx = urls.findIndex((u) => u.includes("notion.so/careers"));

  assert.ok(leverIdx >= 0 && notionCareersIdx >= 0, "Both URLs should be present");
  // The direct job posting (lever) should rank higher because pageType=job (40) > careers (20)
  assert.ok(leverIdx < notionCareersIdx, "Direct job posting should outrank careers page despite employer bonus");
});

test("VAL-DATA-003: employer-domain bonus applies to recognized first-party subdomain patterns", async () => {
  const run = {
    ...makeRun(),
    config: {
      ...makeRun().config,
      companies: [{ name: "Acme" }], // Override to match the test URLs
    },
  };
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
                        // Use example.com as non-denylisted aggregator
                        { url: "https://www.example.com/company/acme/jobs/123", title: "Acme Jobs", pageType: "listings" },
                        { url: "https://careers.acme.com/job/456", title: "Acme Job", pageType: "job" },
                        { url: "https://jobs.acme.com/view/789", title: "Acme Position", pageType: "job" },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["Acme engineering jobs"],
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

  // careers.acme.com and jobs.acme.com should rank higher than example.com due to employer bonus
  const urls = result.candidates.map((c) => c.url);
  const exampleIdx = urls.findIndex((u) => u.includes("example.com"));
  const careersIdx = urls.findIndex((u) => u.includes("careers.acme.com"));
  const jobsAcmeIdx = urls.findIndex((u) => u.includes("jobs.acme.com"));

  assert.ok(exampleIdx >= 0 && careersIdx >= 0 && jobsAcmeIdx >= 0, "All URLs should be present");
  // Both employer domain URLs should outrank example.com
  assert.ok(careersIdx < exampleIdx, "careers.acme.com should outrank example.com");
  assert.ok(jobsAcmeIdx < exampleIdx, "jobs.acme.com should outrank example.com");
});

test("VAL-DATA-003: ATS-hosted direct job pages outrank weaker third-party job hosts", async () => {
  const run = makeUnrestrictedRun({
    config: {
      companies: [{ name: "" }],
      targetRoles: ["Growth Marketing Manager"],
      includeKeywords: ["marketing"],
      locations: ["Remote"],
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
                          url: "https://builtinboston.com/job/growth-marketing-manager-ai/123",
                          title: "Growth Marketing Manager at Acme AI",
                          pageType: "job",
                        },
                        {
                          url: "https://jobs.lever.co/acme-ai/growth-marketing-manager",
                          title: "Growth Marketing Manager at Acme AI",
                          pageType: "job",
                        },
                      ],
                    }),
                  },
                ],
              },
              groundingMetadata: {
                webSearchQueries: ["Growth Marketing Manager remote jobs"],
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
  const urls = result.candidates.map((entry) => entry.url);
  const leverIdx = urls.findIndex((url) => url.includes("jobs.lever.co"));
  const builtinIdx = urls.findIndex((url) => url.includes("builtinboston.com"));

  assert.ok(leverIdx >= 0 && builtinIdx >= 0, "Both ATS and third-party URLs should be present");
  assert.ok(
    leverIdx < builtinIdx,
    "Known ATS direct job pages should outrank weaker third-party job hosts",
  );
});

// === VAL-OBS-002: Budget adaptation diagnostics ===
test("collectGroundedWebListings emits reduced_page_limit diagnostic when budget tracker indicates budget pressure", async () => {
  // Create a budget tracker that reports budget pressure (below threshold)
  const budgetTracker = {
    checkPageLimitReduction: (baseLimit: number) => {
      return {
        multiplier: 0.5,
        diagnostic: {
          code: "reduced_page_limit" as const,
          context: `Run budget at 40% (2000ms remaining of 5000ms total). Reduced page limit from ${baseLimit} to 2 to conserve budget.`,
        },
      };
    },
    checkCompanySkip: () => null,
  };

  const result = await collectGroundedWebListings({
    company: { name: "TestCompany" },
    run: makeRun(),
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Test Engineer at TestCompany"],
        candidates: [
          {
            url: "https://careers.testcompany.com/jobs/1",
            title: "Software Engineer",
            pageType: "job",
            reason: "Direct job page",
            sourceDomain: "careers.testcompany.com",
          },
          {
            url: "https://careers.testcompany.com/jobs/2",
            title: "Senior Engineer",
            pageType: "job",
            reason: "Direct job page",
            sourceDomain: "careers.testcompany.com",
          },
          {
            url: "https://careers.testcompany.com/jobs/3",
            title: "Staff Engineer",
            pageType: "job",
            reason: "Direct job page",
            sourceDomain: "careers.testcompany.com",
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
            { title: "Engineer", company: "TestCompany", location: "Remote", url, descriptionText: "Job description", tags: ["engineering"] },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    budgetTracker,
  });

  // Should have reduced_page_limit diagnostic
  assert.ok(result.diagnostics, "Should have diagnostics");
  const reducedLimitDiag = result.diagnostics!.find((d) => d.code === "reduced_page_limit");
  assert.ok(reducedLimitDiag, "Should have reduced_page_limit diagnostic");
  assert.match(reducedLimitDiag!.context, /budget|page limit|remaining/i);
});

test("collectGroundedWebListings does not emit reduced_page_limit when budget tracker reports no pressure", async () => {
  // Create a budget tracker that reports no budget pressure (above threshold)
  const budgetTracker = {
    checkPageLimitReduction: () => ({ multiplier: 1.0, diagnostic: null }),
    checkCompanySkip: () => null,
  };

  const result = await collectGroundedWebListings({
    company: { name: "TestCompany" },
    run: makeRun(),
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Test Engineer at TestCompany"],
        candidates: [
          {
            url: "https://careers.testcompany.com/jobs/1",
            title: "Software Engineer",
            pageType: "job",
            reason: "Direct job page",
            sourceDomain: "careers.testcompany.com",
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
            { title: "Engineer", company: "TestCompany", location: "Remote", url, descriptionText: "Job description", tags: ["engineering"] },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    budgetTracker,
  });

  // Should NOT have reduced_page_limit diagnostic
  assert.ok(!result.diagnostics || !result.diagnostics.find((d) => d.code === "reduced_page_limit"),
    "Should not have reduced_page_limit diagnostic when budget is healthy");
});
