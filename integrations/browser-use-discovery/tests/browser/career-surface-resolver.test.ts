import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  classifyCareerSurfaceSourcePolicy,
  detectCareerSurfaceCandidatesFromHtml,
  isPreflightReadyCareerSurface,
  isThirdPartyJobBoardHost,
  resolveCareerSurfaceCandidate,
} from "../../src/discovery/career-surface-resolver.ts";
import { collectGroundedWebListings } from "../../src/grounding/grounded-search.ts";

// Third-party job board hosts that should remain non-extractable
const THIRD_PARTY_HOSTS = [
  "linkedin.com",
  "glassdoor.com",
  "indeed.com",
  "monster.com",
  "ziprecruiter.com",
  "careerbuilder.com",
  "simplyhired.com",
  "builtin.com",
  "wellfound.com",
  "otta.com",
  "workingnomads.com",
  "remoteok.com",
  "weworkremotely.com",
  "remotive.io",
  "flexjobs.com",
  "himalayas.app",
  "angel.co",
];

function makeRun(company = { name: "Notion", domains: ["notion.so"] }) {
  return {
    runId: "run_career_surface_test",
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_123",
      variationKey: "var_123",
      requestedAt: "2026-04-13T12:00:00.000Z",
    },
    config: {
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [company],
      includeKeywords: ["platform"],
      excludeKeywords: [],
      targetRoles: ["Platform Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-04-13T12:00:00.000Z",
    },
  };
}

function makeRuntimeConfig(overrides = {}) {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "placeholder-api-key",
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

test("career surface resolver canonicalizes ATS pages and broad hint-only hosts", () => {
  const company = { name: "Notion", domains: ["notion.so"] };
  const lever = resolveCareerSurfaceCandidate(
    {
      url: "https://jobs.lever.co/notion/platform-engineer?lever-via=test",
      title: "Platform Engineer - Notion",
    },
    company,
  );
  assert.ok(lever, "Lever URL should resolve");
  assert.equal(lever?.providerType, "lever");
  assert.equal(lever?.canonicalUrl, "https://jobs.lever.co/notion");
  assert.equal(lever?.surfaceType, "job_posting");
  assert.equal(lever?.sourcePolicy, "extractable");

  const builtin = resolveCareerSurfaceCandidate(
    {
      url: "https://www.builtin.com/job/platform-engineer/123",
      title: "Built In listing",
    },
    company,
  );
  assert.ok(builtin, "Built In hints should be preserved");
  assert.equal(builtin?.sourcePolicy, "hint_only");

  const googleJobs = classifyCareerSurfaceSourcePolicy(
    "https://www.google.com/search?q=platform+engineer&ibp=htl;jobs",
  );
  assert.equal(googleJobs, "hint_only");
  assert.equal(classifyCareerSurfaceSourcePolicy("https://www.google.com/"), "blocked");

  const workingNomadsUrl = "https://www.workingnomads.com/jobs/product-marketing-manager";
  assert.ok(isThirdPartyJobBoardHost(workingNomadsUrl));
  assert.equal(classifyCareerSurfaceSourcePolicy(workingNomadsUrl), "hint_only");

  const workingNomads = resolveCareerSurfaceCandidate(
    {
      url: workingNomadsUrl,
      title: "Product Marketing Manager | Working Nomads",
    },
    company,
  );
  assert.ok(workingNomads, "WorkingNomads URLs should resolve as hint-only candidates");
  assert.equal(workingNomads?.sourcePolicy, "hint_only");
  assert.equal(isPreflightReadyCareerSurface(workingNomads!, company), false);

  assert.equal(
    classifyCareerSurfaceSourcePolicy("https://remoteok.com/remote-jobs/frontend-engineer"),
    "hint_only",
  );
  assert.equal(
    classifyCareerSurfaceSourcePolicy("https://weworkremotely.com/categories/remote-programming-jobs"),
    "hint_only",
  );
});

test("career surface resolver detects first-party paths, ATS links, sitemap URLs, and job schema URLs", () => {
  const company = { name: "Notion", domains: ["notion.so"] };
  const detection = detectCareerSurfaceCandidatesFromHtml({
    url: "https://www.notion.so/company",
    finalUrl: "https://www.notion.so/company",
    company,
    sourceLane: "company_surface",
    html: `
      <html>
        <head>
          <title>About Notion</title>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Platform Engineer",
              "url": "https://www.notion.so/jobs/platform-engineer"
            }
          </script>
        </head>
        <body>
          <a href="/careers">Careers</a>
          <a href="https://jobs.lever.co/notion">Open roles</a>
          <urlset>
            <url><loc>https://www.notion.so/work-with-us</loc></url>
          </urlset>
        </body>
      </html>
    `,
  });

  const urls = detection.candidates.map((entry) => entry.url);
  assert.ok(urls.includes("https://www.notion.so/careers"));
  assert.ok(urls.includes("https://jobs.lever.co/notion"));
  assert.ok(urls.includes("https://www.notion.so/work-with-us"));
  assert.ok(urls.includes("https://www.notion.so/jobs/platform-engineer"));

  const lever = detection.candidates.find((entry) => entry.url === "https://jobs.lever.co/notion");
  assert.equal(lever?.providerType, "lever");
  assert.ok(
    detection.signals.includes("ats_link") || detection.signals.includes("ats_host"),
    "Expected ATS detection signals",
  );
  assert.ok(detection.signals.includes("job_schema"), "Expected job schema detection signal");
  assert.ok(detection.signals.includes("sitemap"), "Expected sitemap detection signal");
});

test("collectGroundedWebListings upgrades employer pages into canonical career surfaces before extraction", async () => {
  const company = { name: "Acme", domains: ["acme.com"] };
  const run = makeRun(company);
  const longDescription =
    "Current openings include platform engineering, infrastructure, and developer tooling responsibilities with clear apply paths. ".repeat(
      8,
    );
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://www.acme.com/company") {
      return new Response(
        `
          <html>
            <head><title>Acme Company</title></head>
            <body>
              <p>${longDescription}</p>
              <a href="/careers">Careers</a>
              <a href="https://jobs.lever.co/acme">Open roles</a>
            </body>
          </html>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url === "https://www.acme.com/careers") {
      return new Response(
        `
          <html>
            <head><title>Acme Careers</title></head>
            <body>
              <h1>Careers</h1>
              <p>${longDescription}</p>
            </body>
          </html>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url === "https://jobs.lever.co/acme") {
      return new Response(
        `
          <html>
            <head><title>Acme Jobs</title></head>
            <body>
              <h1>Open Roles</h1>
              <p>${longDescription}</p>
            </body>
          </html>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  };

  const sessionVisits: string[] = [];
  const result = await collectGroundedWebListings({
    company,
    run,
    runtimeConfig: makeRuntimeConfig({ groundedSearchMaxPagesPerCompany: 2 }),
    fetchImpl,
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Acme platform engineer"],
        candidates: [
          {
            url: "https://www.acme.com/company",
            title: "Acme Company",
            pageType: "other",
            reason: "Employer company page",
            sourceDomain: "www.acme.com",
          },
        ],
        warnings: [],
      }),
      resolveHint: async () => [],
    },
    sessionManager: {
      run: async ({ url }) => {
        sessionVisits.push(url);
        if (url === "https://jobs.lever.co/acme") {
          return {
            url,
            text: JSON.stringify({
              pageType: "listings",
              jobs: [
                {
                  title: "Platform Engineer",
                  company: "Acme",
                  location: "Remote",
                  url: "https://jobs.lever.co/acme/platform-engineer",
                  descriptionText: "Lead platform systems and infrastructure for Acme.",
                },
              ],
            }),
            metadata: { mode: "browser_use_command" },
          };
        }
        return {
          url,
          text: JSON.stringify({
            pageType: "listings",
            jobs: [
              {
                title: "Platform Engineer",
                company: "Acme",
                location: "Remote",
                url: "https://www.acme.com/careers/platform-engineer",
                descriptionText: "Lead platform systems and infrastructure for Acme.",
              },
            ],
          }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  assert.deepEqual(
    result.seedUrls,
    ["https://jobs.lever.co/acme", "https://www.acme.com/careers"],
  );
  assert.deepEqual(sessionVisits, result.seedUrls);
  assert.equal(result.rawListings.length, 1);
  assert.ok(result.rawListings.every((entry) => entry.sourceLane === "grounded_web"));
  assert.ok(
    result.rawListings.some((entry) => entry.providerType === "lever"),
    "Expected at least one extracted listing to preserve ATS provider metadata",
  );
});

// === VAL-LOOP-BROWSER assertions ===

// VAL-LOOP-BROWSER-001: Browser candidate classification is deterministic
// Each URL must classify into exactly one policy class and be repeatable
test("VAL-LOOP-BROWSER-001: classifyCareerSurfaceSourcePolicy is deterministic - same URL always gets same classification", () => {
  const testCases = [
    // ATS providers - extractable
    { url: "https://jobs.lever.co/notion", expected: "extractable" },
    { url: "https://boards.greenhouse.io/acme/jobs/123", expected: "extractable" },
    { url: "https://jobs.ashbyhq.com/acme/jobs/456", expected: "extractable" },
    { url: "https://jobs.smartrecruiters.com/acme/789", expected: "extractable" },
    // Third-party boards - hint_only
    { url: "https://www.linkedin.com/jobs/view/123", expected: "hint_only" },
    { url: "https://www.glassdoor.com/job-listing/123", expected: "hint_only" },
    { url: "https://www.indeed.com/job/123", expected: "hint_only" },
    { url: "https://www.monster.com/job/123", expected: "hint_only" },
    { url: "https://www.ziprecruiter.com/job/123", expected: "hint_only" },
    { url: "https://www.builtin.com/job/123", expected: "hint_only" },
    { url: "https://www.wellfound.com/jobs/123", expected: "hint_only" },
    { url: "https://www.otta.com/job/123", expected: "hint_only" },
    { url: "https://www.workingnomads.com/jobs/123", expected: "hint_only" },
    { url: "https://remoteok.com/remote-jobs/123", expected: "hint_only" },
    { url: "https://weworkremotely.com/jobs/123", expected: "hint_only" },
    // Google jobs - hint_only
    { url: "https://www.google.com/search?q=engineer&ibp=htl;jobs", expected: "hint_only" },
    // Blocked hosts
    { url: "https://www.google.com/", expected: "blocked" },
    { url: "https://accounts.google.com/", expected: "blocked" },
    { url: "https://support.google.com/", expected: "blocked" },
    { url: "https://docs.google.com/", expected: "blocked" },
    // Employer domains - extractable
    { url: "https://www.notion.so/careers", expected: "extractable" },
    { url: "https://acme.com/jobs/123", expected: "extractable" },
  ];

  for (const { url, expected } of testCases) {
    // Classify 3 times to verify determinism
    const policy1 = classifyCareerSurfaceSourcePolicy(url);
    const policy2 = classifyCareerSurfaceSourcePolicy(url);
    const policy3 = classifyCareerSurfaceSourcePolicy(url);

    assert.equal(policy1, policy2, `Classification of ${url} should be deterministic (first vs second call)`);
    assert.equal(policy2, policy3, `Classification of ${url} should be deterministic (second vs third call)`);
    assert.equal(policy1, expected, `Expected ${url} to be classified as ${expected}, got ${policy1}`);
  }
});

// VAL-LOOP-BROWSER-001: Classification returns exactly one policy for any valid URL
test("VAL-LOOP-BROWSER-001: classifyCareerSurfaceSourcePolicy returns exactly one of three policy classes", () => {
  const validPolicies = ["blocked", "hint_only", "extractable"];

  const testUrls = [
    "https://jobs.lever.co/notion",
    "https://www.linkedin.com/jobs/view/123",
    "https://www.google.com/",
    "https://www.notion.so/careers",
  ];

  for (const url of testUrls) {
    const policy = classifyCareerSurfaceSourcePolicy(url);
    assert.ok(
      validPolicies.includes(policy),
      `Policy for ${url} must be one of ${validPolicies.join(", ")}, got "${policy}"`,
    );
  }
});

// VAL-LOOP-BROWSER-006: Known third-party hosts stay non-extractable across ingestion paths
// Third-party hosts should always be classified as hint_only regardless of path
test("VAL-LOOP-BROWSER-006: all known third-party job board hosts classify as hint_only", () => {
  for (const host of THIRD_PARTY_HOSTS) {
    const url = `https://www.${host}/jobs/test`;
    const policy = classifyCareerSurfaceSourcePolicy(url);
    assert.equal(
      policy,
      "hint_only",
      `Third-party host ${host} should be hint_only, got "${policy}"`,
    );
  }
});

test("VAL-LOOP-BROWSER-006: third-party hosts classify consistently regardless of URL path variations", () => {
  const pathVariations = [
    "/jobs/123",
    "/job/software-engineer",
    "/jobs/view/456",
    "/role/789",
    "/position/abc",
    "/careers",
  ];

  for (const host of ["linkedin.com", "indeed.com", "glassdoor.com", "builtin.com", "wellfound.com"]) {
    for (const path of pathVariations) {
      const url = `https://www.${host}${path}`;
      const policy = classifyCareerSurfaceSourcePolicy(url);
      assert.equal(
        policy,
        "hint_only",
        `Third-party host ${host} with path ${path} should be hint_only, got "${policy}"`,
      );
    }
  }
});

test("VAL-LOOP-BROWSER-006: resolveCareerSurfaceCandidate returns null for blocked hosts", () => {
  const company = { name: "TestCompany", domains: ["testcompany.com"] };

  const blockedUrls = [
    "https://accounts.google.com/",
    "https://support.google.com/",
    "https://docs.google.com/",
  ];

  for (const url of blockedUrls) {
    const result = resolveCareerSurfaceCandidate({ url, title: "Test" }, company);
    assert.equal(result, null, `Blocked host ${url} should return null from resolveCareerSurfaceCandidate`);
  }
});

test("VAL-LOOP-BROWSER-006: resolveCareerSurfaceCandidate marks third-party boards as hint_only", () => {
  const company = { name: "TestCompany", domains: ["testcompany.com"] };

  for (const host of ["linkedin.com", "indeed.com", "glassdoor.com"]) {
    const result = resolveCareerSurfaceCandidate(
      { url: `https://www.${host}/jobs/test`, title: "Software Engineer" },
      company,
    );
    assert.ok(result, `Should resolve third-party URL from ${host}`);
    assert.equal(
      result?.sourcePolicy,
      "hint_only",
      `Third-party URL from ${host} should have sourcePolicy "hint_only", got "${result?.sourcePolicy}"`,
    );
  }
});

// VAL-LOOP-BROWSER-007: Canonical scout/exploit emits auditable diagnostics with URL attribution
// This test verifies that diagnostic codes include URL attribution
test("VAL-LOOP-BROWSER-007: canonical_surface_extracted diagnostic includes URL attribution", async () => {
  const company = { name: "Acme", domains: ["acme.com"] };
  const run = makeRun(company);
  const longDescription = "Current openings include platform engineering responsibilities with clear apply paths. ".repeat(12);

  let extractedUrl: string | null = null;

  const result = await collectGroundedWebListings({
    company,
    run,
    runtimeConfig: makeRuntimeConfig({ groundedSearchMaxPagesPerCompany: 1 }),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Acme platform engineer"],
        candidates: [
          {
            url: "https://jobs.lever.co/acme",
            title: "Acme Jobs",
            pageType: "listings",
            reason: "ATS board",
            sourceDomain: "jobs.lever.co",
          },
        ],
        warnings: [],
      }),
    },
    fetchImpl: async (input) => {
      const url = String(input);
      return new Response(
        `<html><head><title>Acme Jobs</title></head><body><p>${longDescription}</p></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    },
    sessionManager: {
      run: async ({ url }) => {
        extractedUrl = url;
        return {
          url,
          text: JSON.stringify({
            pageType: "listings",
            jobs: [
              {
                title: "Platform Engineer",
                company: "Acme",
                location: "Remote",
                url: "https://jobs.lever.co/acme/platform-engineer",
                descriptionText: "Lead platform systems.",
              },
            ],
          }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  // Verify canonical_surface_extracted diagnostic exists with URL
  const canonicalDiag = result.diagnostics?.find((d) => d.code === "canonical_surface_extracted");
  assert.ok(canonicalDiag, "Should emit canonical_surface_extracted diagnostic");
  assert.ok(canonicalDiag?.url, "canonical_surface_extracted diagnostic should have URL attribution");
  assert.equal(canonicalDiag?.url, "https://jobs.lever.co/acme");
  assert.ok(canonicalDiag?.context.includes("https://jobs.lever.co/acme"));
});

// VAL-LOOP-BROWSER-007: hint_only_candidate diagnostic includes URL attribution
test("VAL-LOOP-BROWSER-007: hint_only_candidate diagnostic includes URL attribution", async () => {
  const company = { name: "Notion", domains: ["notion.so"] };
  const run = makeRun(company);

  const result = await collectGroundedWebListings({
    company,
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
      resolveHint: async () => [], // Return empty to trigger hint_resolution_failed
    },
    sessionManager: {
      run: async () => ({ url: "", text: "{}", metadata: { mode: "browser_use_command" } }),
    },
  });

  // Verify hint_only_candidate diagnostic exists with URL
  const hintDiag = result.diagnostics?.find((d) => d.code === "hint_only_candidate");
  assert.ok(hintDiag, "Should emit hint_only_candidate diagnostic");
  assert.ok(hintDiag?.url, "hint_only_candidate diagnostic should have URL attribution");
  assert.ok(hintDiag?.url.includes("workingnomads.com"));
  assert.ok(hintDiag?.context.includes("workingnomads.com"));
});

// VAL-LOOP-BROWSER-007: third_party_extraction_blocked diagnostic includes URL attribution
test("VAL-LOOP-BROWSER-007: third_party_extraction_blocked diagnostic includes URL attribution", async () => {
  const company = { name: "Notion", domains: ["notion.so"] };
  const run = makeRun(company);

  const result = await collectGroundedWebListings({
    company,
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://www.linkedin.com/jobs/view/123",
            title: "Product Marketing Manager at Notion | LinkedIn",
            pageType: "job",
            reason: "Third-party hint",
            sourceDomain: "www.linkedin.com",
            sourcePolicy: "hint_only",
          },
        ],
        warnings: [],
      }),
      resolveHint: async () => [],
    },
    sessionManager: {
      run: async () => ({ url: "", text: "{}", metadata: { mode: "browser_use_command" } }),
    },
  });

  // Verify third_party_extraction_blocked diagnostic exists with URL
  const blockedDiag = result.diagnostics?.find((d) => d.code === "third_party_extraction_blocked");
  assert.ok(blockedDiag, "Should emit third_party_extraction_blocked diagnostic");
  assert.ok(blockedDiag?.url, "third_party_extraction_blocked diagnostic should have URL attribution");
  assert.ok(blockedDiag?.url.includes("linkedin.com"));
});

// VAL-LOOP-BROWSER-007: hint_resolution_failed diagnostic includes URL attribution
test("VAL-LOOP-BROWSER-007: hint_resolution_failed diagnostic includes URL attribution", async () => {
  const company = { name: "Notion", domains: ["notion.so"] };
  const run = makeRun(company);

  const result = await collectGroundedWebListings({
    company,
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://www.indeed.com/job/123",
            title: "Product Marketing Manager at Notion | Indeed",
            pageType: "job",
            reason: "Third-party hint",
            sourceDomain: "www.indeed.com",
            sourcePolicy: "hint_only",
          },
        ],
        warnings: [],
      }),
      resolveHint: async () => [], // Empty resolution triggers failure
    },
    sessionManager: {
      run: async () => ({ url: "", text: "{}", metadata: { mode: "browser_use_command" } }),
    },
  });

  // Verify hint_resolution_failed diagnostic exists with URL
  const failedDiag = result.diagnostics?.find((d) => d.code === "hint_resolution_failed");
  assert.ok(failedDiag, "Should emit hint_resolution_failed diagnostic");
  assert.ok(failedDiag?.url, "hint_resolution_failed diagnostic should have URL attribution");
  assert.ok(failedDiag?.url.includes("indeed.com"));
});

// VAL-LOOP-BROWSER-002: Hint-only candidates are never directly exploited
test("VAL-LOOP-BROWSER-002: hint_only candidates never enter direct extraction path", async () => {
  const company = { name: "Notion", domains: ["notion.so"] };
  const run = makeRun(company);
  let sessionCalls = 0;

  const result = await collectGroundedWebListings({
    company,
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion software engineer"],
        candidates: [
          {
            url: "https://www.linkedin.com/jobs/view/456",
            title: "Software Engineer at Notion | LinkedIn",
            pageType: "job",
            reason: "Third-party hint",
            sourceDomain: "www.linkedin.com",
            sourcePolicy: "hint_only",
          },
          {
            url: "https://jobs.lever.co/notion",
            title: "Notion Jobs",
            pageType: "listings",
            reason: "ATS board",
            sourceDomain: "jobs.lever.co",
            sourcePolicy: "extractable",
          },
        ],
        warnings: [],
      }),
      resolveHint: async () => [], // Failed hint resolution
    },
    fetchImpl: async (input) => {
      const url = String(input);
      return new Response(
        `<html><head><title>Notion Jobs</title></head><body><p>${"Current openings include platform engineering roles. ".repeat(8)}</p><a href="/jobs/123">Apply now</a></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    },
    sessionManager: {
      run: async ({ url }) => {
        sessionCalls++;
        return {
          url,
          text: JSON.stringify({ pageType: "job", jobs: [{ title: "Engineer", url, company: "Notion", location: "Remote" }] }),
          metadata: { mode: "browser_use_command" },
        };
      },
    },
  });

  // Session should only be called for the extractable ATS URL, not for LinkedIn
  assert.equal(sessionCalls, 1, "Session should only be called once for canonical ATS URL");
  assert.ok(result.seedUrls.includes("https://jobs.lever.co/notion"));
  assert.ok(!result.seedUrls.some((u) => u.includes("linkedin.com")));
});

// VAL-LOOP-BROWSER-003: Hint resolution upgrades to canonical or records explicit failure
test("VAL-LOOP-BROWSER-003: hint resolution succeeds and upgrades to canonical ATS surface", async () => {
  const company = { name: "Notion", domains: ["notion.so"] };
  const run = makeRun(company);
  const preflightedUrls: string[] = [];

  // Use the same pattern as the existing passing test in grounded-search.test.ts
  const result = await collectGroundedWebListings({
    company,
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
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
    fetchImpl: async (input) => {
      const url = String(input);
      preflightedUrls.push(url);
      const longDescription = "This role includes job description, responsibilities, qualifications, and an apply now path for current openings. ".repeat(8);
      return new Response(
        `<html>
          <head><title>Product Marketing Manager at Notion</title></head>
          <body>
            <h1>Product Marketing Manager</h1>
            <button>Apply now</button>
            <p>${longDescription}</p>
          </body>
        </html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    },
    sessionManager: {
      run: async ({ url }) => ({
        url,
        text: JSON.stringify({ pageType: "job", jobs: [{ title: "Product Marketing Manager", url, company: "Notion", location: "Remote" }] }),
        metadata: { mode: "browser_use_command" },
      }),
    },
  });

  // Verify preflight was called for the resolved canonical URL
  assert.ok(preflightedUrls.includes("https://jobs.lever.co/notion/product-marketing-manager"),
    `Expected preflight to be called for Lever URL, but only preflighted: ${preflightedUrls.join(", ")}`);

  // Verify the canonical surface was extracted (hint resolved and passed preflight)
  assert.ok(result.seedUrls.includes("https://jobs.lever.co/notion/product-marketing-manager"),
    `Expected seedUrls to include Lever URL, got: ${JSON.stringify(result.seedUrls)}`);

  // Verify hint_only_candidate diagnostic was emitted for the WorkingNomads hint
  const hintDiag = result.diagnostics?.find((d) => d.code === "hint_only_candidate");
  assert.ok(hintDiag, "Should emit hint_only_candidate diagnostic for WorkingNomads");
  assert.ok(hintDiag?.url.includes("workingnomads.com"));

  // Verify third_party_extraction_blocked was emitted
  const blockedDiag = result.diagnostics?.find((d) => d.code === "third_party_extraction_blocked");
  assert.ok(blockedDiag, "Should emit third_party_extraction_blocked diagnostic");
  assert.ok(blockedDiag?.url.includes("workingnomads.com"));
});

test("VAL-LOOP-BROWSER-003: hint resolution fails explicitly with hint_resolution_failed diagnostic", async () => {
  const company = { name: "Notion", domains: ["notion.so"] };
  const run = makeRun(company);

  const result = await collectGroundedWebListings({
    company,
    run,
    runtimeConfig: makeRuntimeConfig(),
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Notion product marketing manager"],
        candidates: [
          {
            url: "https://www.remoteok.com/job/123",
            title: "Product Marketing Manager at Notion | RemoteOK",
            pageType: "job",
            reason: "Third-party hint",
            sourceDomain: "www.remoteok.com",
            sourcePolicy: "hint_only",
          },
        ],
        warnings: [],
      }),
      resolveHint: async () => [], // Empty resolution = failure
    },
    sessionManager: {
      run: async () => ({ url: "", text: "{}", metadata: { mode: "browser_use_command" } }),
    },
  });

  // Verify hint_resolution_failed diagnostic was emitted
  const failedDiag = result.diagnostics?.find((d) => d.code === "hint_resolution_failed");
  assert.ok(failedDiag, "Should emit hint_resolution_failed diagnostic when hint resolution returns empty");
  assert.ok(failedDiag?.url.includes("remoteok.com"));
  assert.ok(failedDiag?.context.includes("Could not resolve canonical"));
});
