import assert from "node:assert/strict";
import test from "node:test";

import {
  ATS_SOURCE_IDS,
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { createAtsProviderRegistry } from "../../src/browser/providers/index.ts";
import { createSourceAdapterRegistry } from "../../src/browser/source-adapters.ts";

function makeRun(options = {}) {
  const enabledSources = options.enabledSources || ["greenhouse", "lever", "ashby"];
  const boardHints = options.boardHints || {
    greenhouse: "acme-ai",
    lever: "acme-ai",
    ashby: "acme-ai",
  };
  return {
    runId: "run_test",
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_123",
      variationKey: "var_123",
      requestedAt: "2026-04-09T00:00:00.000Z",
    },
    config: {
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [
        {
          name: options.companyName || "Acme AI",
          boardHints,
          ...(options.domains ? { domains: options.domains } : {}),
        },
      ],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources,
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-04-09T00:00:00.000Z",
      sourcePreset: "ats_only",
      effectiveSources: enabledSources,
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("source adapters detect and collect ATS-native public listings", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(typeof input === "string" ? input : input.url);

    if (url === "https://boards-api.greenhouse.io/v1/boards/acme-ai") {
      return jsonResponse({ name: "Acme AI", jobs: [] });
    }
    if (
      url ===
      "https://boards-api.greenhouse.io/v1/boards/acme-ai/jobs?content=true"
    ) {
      return jsonResponse({
        jobs: [
          {
            id: 1,
            title: "Backend Engineer",
            absolute_url: "https://boards.greenhouse.io/acme-ai/jobs/1",
            location: { name: "Remote" },
            content: "Build services",
            departments: [{ name: "Engineering" }],
            offices: [{ name: "Remote" }],
            metadata: { compensation: "$180k-$220k" },
          },
        ],
      });
    }
    if (url === "https://api.lever.co/v0/postings/acme-ai?mode=json") {
      return jsonResponse([
        {
          id: "lever-1",
          text: "Product Designer",
          hostedUrl: "https://jobs.lever.co/acme-ai/product-designer",
          categories: { location: "Remote", team: "Design" },
          salaryRange: "$150k-$190k",
          description: "Design the product",
        },
      ]);
    }
    if (
      url ===
      "https://api.ashbyhq.com/posting-api/job-board/acme-ai?includeCompensation=false"
    ) {
      return jsonResponse({
        apiVersion: "1",
        jobs: [{ id: "ashby-1", title: "Data Scientist", location: "Remote" }],
      });
    }
    if (
      url ===
      "https://api.ashbyhq.com/posting-api/job-board/acme-ai?includeCompensation=true"
    ) {
      return jsonResponse({
        apiVersion: "1",
        jobs: [
          {
            id: "ashby-1",
            title: "Data Scientist",
            jobUrl: "https://jobs.ashbyhq.com/acme-ai/1",
            location: "Remote",
            compensation: "$170k-$210k",
            description: "Model ranking systems",
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const registry = createSourceAdapterRegistry({
      run: async () => ({ text: "[]", metadata: {} }),
    });
    const run = makeRun();
    const companyContext = { company: run.config.companies[0], run };
    const detections = await registry.detectBoards(companyContext, run.config.effectiveSources);
    const listings = await registry.collectListings(run, detections);

    assert.equal(detections.length, 3);
    assert.deepEqual(detections.map((item) => item.sourceId).sort(), [
      "ashby",
      "greenhouse",
      "lever",
    ]);
    assert.equal(listings.length, 3);
    assert.ok(
      listings.some(
        (item) =>
          item.sourceId === "greenhouse" && item.title === "Backend Engineer",
      ),
    );
    assert.ok(
      listings.some(
        (item) =>
          item.sourceId === "lever" && item.title === "Product Designer",
      ),
    );
    assert.ok(
      listings.some(
        (item) => item.sourceId === "ashby" && item.title === "Data Scientist",
      ),
    );

    const gh = listings.find((item) => item.sourceId === "greenhouse");
    assert.equal(gh?.compensationText, "$180k-$220k");

    const lv = listings.find((item) => item.sourceId === "lever");
    assert.equal(lv?.compensationText, "$150k-$190k");

    const ab = listings.find((item) => item.sourceId === "ashby");
    assert.equal(ab?.compensationText, "$170k-$210k");

    assert.ok(
      (gh?.tags || []).includes("Engineering"),
      "Greenhouse departments should extract object names into tags",
    );
    assert.ok(
      (gh?.tags || []).includes("Remote"),
      "Greenhouse offices should extract object names into tags",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("greenhouse compensation sanitization strips encoded HTML junk", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(typeof input === "string" ? input : input.url);

    if (url === "https://boards-api.greenhouse.io/v1/boards/acme-ai") {
      return jsonResponse({ name: "Acme AI", jobs: [] });
    }
    if (
      url ===
      "https://boards-api.greenhouse.io/v1/boards/acme-ai/jobs?content=true"
    ) {
      return jsonResponse({
        jobs: [
          {
            id: 1,
            title: "Partner Marketing Lead",
            absolute_url: "https://boards.greenhouse.io/acme-ai/jobs/1",
            location: { name: "Remote" },
            content:
              "&lt;h2&gt;&lt;strong&gt;About the role&lt;/strong&gt;&lt;/h2&gt;&lt;p&gt;Lead product marketing.&lt;/p&gt;",
            metadata: {
              compensation:
                "&lt;h2&gt;&lt;strong&gt;About the role&lt;/strong&gt;&lt;/h2&gt;&lt;p&gt;Lead product marketing.&lt;/p&gt;",
            },
          },
        ],
      });
    }
    if (url === "https://api.lever.co/v0/postings/acme-ai?mode=json") {
      return jsonResponse([]);
    }
    if (
      url ===
      "https://api.ashbyhq.com/posting-api/job-board/acme-ai?includeCompensation=false"
    ) {
      return jsonResponse({ jobs: [] });
    }
    if (
      url ===
      "https://api.ashbyhq.com/posting-api/job-board/acme-ai?includeCompensation=true"
    ) {
      return jsonResponse({ jobs: [] });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const registry = createSourceAdapterRegistry({
      run: async () => ({ text: "[]", metadata: {} }),
    });
    const run = makeRun();
    const companyContext = { company: run.config.companies[0], run };
    const detections = await registry.detectBoards(companyContext, run.config.effectiveSources);
    const listings = await registry.collectListings(run, detections);

    const greenhouseListing = listings.find(
      (item) => item.sourceId === "greenhouse",
    );
    assert.ok(greenhouseListing);
    assert.equal(greenhouseListing?.compensationText, "");
    assert.equal(
      greenhouseListing?.descriptionText,
      "About the role Lead product marketing.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider registry exposes the widened ATS provider set", () => {
  const registry = createAtsProviderRegistry();
  assert.deepEqual(
    registry.providers.map((provider) => provider.id),
    [...ATS_SOURCE_IDS],
  );
});

test("provider registry returns responsive ATS detections even when one provider hangs", async () => {
  const registry = createAtsProviderRegistry(
    [
      {
        id: "greenhouse",
        label: "Greenhouse",
        async detectSurfaces(company) {
          return [
            {
              matched: true,
              sourceId: "greenhouse",
              sourceLabel: "Greenhouse",
              providerType: "greenhouse",
              surfaceType: "provider_board",
              boardUrl: "https://boards.greenhouse.io/acme-ai",
              canonicalUrl: "https://boards.greenhouse.io/acme-ai",
              finalUrl: "https://boards.greenhouse.io/acme-ai",
              boardToken: "acme-ai",
              confidence: 1,
              warnings: [],
              sourceLane: "ats_provider",
              metadata: {
                companyName: company.name,
              },
            },
          ];
        },
        async enumerateListings() {
          return [];
        },
        canonicalizeUrl(url) {
          return String(url || "");
        },
        extractExternalJobId() {
          return "";
        },
        scoreSurface() {
          return 100;
        },
      },
      {
        id: "ashby",
        label: "Ashby",
        async detectSurfaces() {
          return await new Promise(() => {});
        },
        async enumerateListings() {
          return [];
        },
        canonicalizeUrl(url) {
          return String(url || "");
        },
        extractExternalJobId() {
          return "";
        },
        scoreSurface() {
          return 50;
        },
      },
    ],
    { detectionTimeoutMs: 10 },
  );

  const detections = await registry.detectSurfaces(
    { name: "Acme AI" },
    ["greenhouse", "ashby"],
  );

  assert.equal(detections.length, 1);
  assert.equal(detections[0]?.sourceId, "greenhouse");
});

test("provider canonicalization covers expanded ATS URLs", () => {
  const registry = createAtsProviderRegistry();
  const cases = [
    [
      "smartrecruiters",
      "https://jobs.smartrecruiters.com/AcmeAI/platform-engineer?trid=123",
      "https://jobs.smartrecruiters.com/AcmeAI/platform-engineer",
    ],
    [
      "workday",
      "https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Austin-TX/Platform-Engineer_1234?source=foo",
      "https://acme.wd1.myworkdayjobs.com/en-US/Careers/job/Austin-TX/Platform-Engineer_1234",
    ],
    [
      "icims",
      "https://careers-acme.icims.com/jobs/1234/job?mobile=false",
      "https://careers-acme.icims.com/jobs/1234/job",
    ],
    [
      "jobvite",
      "https://jobs.jobvite.com/acme/job/o123456?nl=1",
      "https://jobs.jobvite.com/acme/job/o123456",
    ],
    [
      "taleo",
      "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345&lang=en",
      "https://acme.taleo.net/careersection/2/jobdetail.ftl?job=12345",
    ],
    [
      "successfactors",
      "https://career2.successfactors.eu/career?company=acme&career_job_req_id=9876",
      "https://career2.successfactors.eu/career?jobReq=9876",
    ],
    [
      "workable",
      "https://apply.workable.com/acme/j/ABC123/?utm_source=test",
      "https://apply.workable.com/acme/j/ABC123",
    ],
    [
      "breezy",
      "https://acme.breezy.hr/p/abc123-software-engineer?source=boards",
      "https://acme.breezy.hr/p/abc123-software-engineer",
    ],
    [
      "recruitee",
      "https://acme.recruitee.com/o/platform-engineer?lang=en",
      "https://acme.recruitee.com/o/platform-engineer",
    ],
    [
      "teamtailor",
      "https://acme.teamtailor.com/jobs/12345-platform-engineer?utm_campaign=test",
      "https://acme.teamtailor.com/jobs/12345-platform-engineer",
    ],
    [
      "personio",
      "https://acme.jobs.personio.de/job/123456?display=en",
      "https://acme.jobs.personio.de/job/123456",
    ],
  ];

  for (const [sourceId, input, expected] of cases) {
    const provider = registry.getProvider(sourceId);
    assert.ok(provider, `Expected provider for ${sourceId}`);
    assert.equal(provider?.canonicalizeUrl(input), expected);
  }
});

test("registry supports multiple surfaces for a single provider/company", async () => {
  const registry = createSourceAdapterRegistry({
    run: async () => ({ text: "<html></html>", metadata: {} }),
  });
  const run = makeRun({
    enabledSources: ["smartrecruiters"],
    boardHints: {
      smartrecruiters: [
        "https://jobs.smartrecruiters.com/AcmeAI",
        "https://jobs.smartrecruiters.com/AcmeAI/platform-engineer",
      ].join("\n"),
    },
  });
  const companyContext = { company: run.config.companies[0], run };
  const detections = await registry.detectBoards(
    companyContext,
    run.config.effectiveSources,
  );

  assert.equal(detections.length, 2);
  assert.deepEqual(
    detections.map((item) => item.canonicalUrl).sort(),
    [
      "https://jobs.smartrecruiters.com/AcmeAI",
      "https://jobs.smartrecruiters.com/AcmeAI/platform-engineer",
    ],
  );
  assert.deepEqual(
    detections.map((item) => item.surfaceType).sort(),
    ["job_posting", "provider_board"],
  );
});
