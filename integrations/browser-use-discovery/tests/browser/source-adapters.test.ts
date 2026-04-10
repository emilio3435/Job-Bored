import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { createSourceAdapterRegistry } from "../../src/browser/source-adapters.ts";

function makeRun() {
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
          name: "Acme AI",
          boardHints: {
            greenhouse: "acme-ai",
            lever: "acme-ai",
            ashby: "acme-ai",
          },
        },
      ],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-04-09T00:00:00.000Z",
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
    const detections = await registry.detectBoards(companyContext);
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
    const detections = await registry.detectBoards(companyContext);
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
