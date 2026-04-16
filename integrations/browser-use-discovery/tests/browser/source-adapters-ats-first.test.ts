import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { createSourceAdapterRegistry } from "../../src/browser/source-adapters.ts";

function makeRun() {
  return {
    runId: "run_multi_surface",
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_ats_first",
      variationKey: "var_multi_surface",
      requestedAt: "2026-04-13T00:00:00.000Z",
    },
    config: {
      sheetId: "sheet_ats_first",
      mode: "hosted",
      timezone: "UTC",
      companies: [
        {
          name: "Acme AI",
          boardHints: {
            greenhouse: "acme-ai",
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
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_multi_surface",
      requestedAt: "2026-04-13T00:00:00.000Z",
      sourcePreset: "ats_only",
      effectiveSources: ["greenhouse"],
    },
  };
}

test("collectListings keeps multiple greenhouse surfaces for the same company", async () => {
  const registry = createSourceAdapterRegistry({
    run: async () => ({ text: "", metadata: {} }),
  });
  const greenhouseAdapter = registry.adapters.find(
    (adapter) => adapter.sourceId === "greenhouse",
  );
  assert.ok(greenhouseAdapter, "greenhouse adapter should exist");

  const seenBoardUrls: string[] = [];
  greenhouseAdapter.listJobs = async (boardContext) => {
    seenBoardUrls.push(boardContext.boardUrl);

    if (boardContext.boardUrl.endsWith("/acme-ai-university")) {
      return [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "Campus Backend Engineer",
          company: "Acme AI",
          location: "Remote",
          url: "https://boards.greenhouse.io/acme-ai-university/jobs/2",
          descriptionText: "University recruiting surface.",
          tags: ["University"],
        },
      ];
    }

    return [
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title: "Senior Backend Engineer",
        company: "Acme AI",
        location: "Remote",
        url: "https://boards.greenhouse.io/acme-ai/jobs/1",
        descriptionText: "Primary hiring surface.",
        tags: ["Engineering"],
      },
    ];
  };

  const listings = await registry.collectListings(makeRun(), [
    {
      matched: true,
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      boardUrl: "https://boards.greenhouse.io/acme-ai",
      confidence: 1,
      warnings: [],
    },
    {
      matched: true,
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      boardUrl: "https://boards.greenhouse.io/acme-ai-university",
      confidence: 0.8,
      warnings: [],
    },
  ]);

  assert.deepEqual(seenBoardUrls, [
    "https://boards.greenhouse.io/acme-ai",
    "https://boards.greenhouse.io/acme-ai-university",
  ]);
  assert.equal(listings.length, 2);
  assert.deepEqual(
    listings.map((listing) => listing.title).sort(),
    ["Campus Backend Engineer", "Senior Backend Engineer"],
  );
});

test("collectListings dedupes duplicate greenhouse jobs surfaced from multiple boards", async () => {
  const registry = createSourceAdapterRegistry({
    run: async () => ({ text: "", metadata: {} }),
  });
  const greenhouseAdapter = registry.adapters.find(
    (adapter) => adapter.sourceId === "greenhouse",
  );
  assert.ok(greenhouseAdapter, "greenhouse adapter should exist");

  greenhouseAdapter.listJobs = async (boardContext) => {
    if (boardContext.boardUrl.endsWith("/acme-ai-university")) {
      return [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "Senior Backend Engineer",
          company: "Acme AI",
          location: "Remote",
          url: "https://boards.greenhouse.io/acme-ai/jobs/1?gh_src=campus",
          descriptionText: "Tracking variant from a secondary surface.",
          tags: ["Engineering"],
        },
      ];
    }

    return [
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title: "Senior Backend Engineer",
        company: "Acme AI",
        location: "Remote",
        url: "https://boards.greenhouse.io/acme-ai/jobs/1",
        descriptionText: "Canonical job URL from the primary surface.",
        tags: ["Engineering"],
      },
    ];
  };

  const listings = await registry.collectListings(makeRun(), [
    {
      matched: true,
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      boardUrl: "https://boards.greenhouse.io/acme-ai",
      confidence: 1,
      warnings: [],
    },
    {
      matched: true,
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      boardUrl: "https://boards.greenhouse.io/acme-ai-university",
      confidence: 0.8,
      warnings: [],
    },
  ]);

  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.url, "https://boards.greenhouse.io/acme-ai/jobs/1");
});

test("collectListings reconstructs a synthetic company when ATS detections are not in configured companies", async () => {
  const registry = createSourceAdapterRegistry({
    run: async () => ({ text: "", metadata: {} }),
  });
  const greenhouseAdapter = registry.adapters.find(
    (adapter) => adapter.sourceId === "greenhouse",
  );
  assert.ok(greenhouseAdapter, "greenhouse adapter should exist");

  const seenCompanyNames: string[] = [];
  greenhouseAdapter.listJobs = async (boardContext) => {
    seenCompanyNames.push(boardContext.company.name);
    return [
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        title: "Data Analyst",
        company: boardContext.company.name,
        location: "Remote",
        url: "https://boards.greenhouse.io/acme-ai/jobs/99",
        descriptionText: "Canonical ATS listing from an unrestricted seed.",
        tags: ["Analytics"],
      },
    ];
  };

  const listings = await registry.collectListings(
    {
      ...makeRun(),
      config: {
        ...makeRun().config,
        companies: [],
      },
    },
    [
      {
        matched: true,
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        boardUrl: "https://boards.greenhouse.io/acme-ai",
        confidence: 1,
        warnings: [],
        boardToken: "acme-ai",
        metadata: {
          companyName: "Acme AI",
        },
      },
    ],
  );

  assert.deepEqual(seenCompanyNames, ["Acme AI"]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.company, "Acme AI");
});
