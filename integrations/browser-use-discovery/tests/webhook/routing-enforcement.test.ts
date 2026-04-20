import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";
import { computeEffectiveSources } from "../../src/config.ts";

function makeRequest() {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_123",
    variationKey: "var_123",
    requestedAt: "2026-04-10T03:00:00.000Z",
  };
}

// === computeEffectiveSources unit tests (VAL-ROUTE-001 through VAL-ROUTE-003) ===

test("computeEffectiveSources: browser_only returns only grounded_web", () => {
  const sources = ["greenhouse", "lever", "ashby", "grounded_web"];
  const result = computeEffectiveSources("browser_only", sources);
  assert.deepEqual(result, ["grounded_web"]);
});

test("computeEffectiveSources: browser_only with no grounded_web returns empty", () => {
  const sources = ["greenhouse", "lever", "ashby"];
  const result = computeEffectiveSources("browser_only", sources);
  assert.deepEqual(result, []);
});

test("computeEffectiveSources: ats_only returns only ATS sources", () => {
  const sources = ["greenhouse", "lever", "ashby", "grounded_web"];
  const result = computeEffectiveSources("ats_only", sources);
  assert.deepEqual(result, ["greenhouse", "lever", "ashby"]);
});

test("computeEffectiveSources: ats_only excludes grounded_web", () => {
  const sources = ["grounded_web"];
  const result = computeEffectiveSources("ats_only", sources);
  assert.deepEqual(result, []);
});

test("computeEffectiveSources: browser_plus_ats returns all sources", () => {
  const sources = ["greenhouse", "lever", "ashby", "grounded_web"];
  const result = computeEffectiveSources("browser_plus_ats", sources);
  assert.deepEqual(result, sources);
});

test("computeEffectiveSources: browser_plus_ats returns enabled subset", () => {
  const sources = ["greenhouse", "grounded_web"];
  const result = computeEffectiveSources("browser_plus_ats", sources);
  assert.deepEqual(result, ["greenhouse", "grounded_web"]);
});

// === runDiscovery routing enforcement tests ===

test("runDiscovery with browser_only preset excludes ATS adapters (VAL-ROUTE-001)", async () => {
  const atsDetectCalls: string[] = [];
  const atsListCalls: string[] = [];

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => {
            atsDetectCalls.push("greenhouse");
            return null;
          },
          listJobs: async () => {
            atsListCalls.push("greenhouse");
            return [];
          },
          normalize: async () => null,
        },
        {
          sourceId: "lever",
          sourceLabel: "Lever",
          detect: async () => {
            atsDetectCalls.push("lever");
            return null;
          },
          listJobs: async () => {
            atsListCalls.push("lever");
            return [];
          },
          normalize: async () => null,
        },
        {
          sourceId: "ashby",
          sourceLabel: "Ashby",
          detect: async () => {
            atsDetectCalls.push("ashby");
            return null;
          },
          listJobs: async () => {
            atsListCalls.push("ashby");
            return [];
          },
          normalize: async () => null,
        },
      ],
      detectBoards: async ({ company }, effectiveSources) => {
        // This should only be called for grounded_web since browser_only
        assert.deepEqual(effectiveSources, ["grounded_web"], "browser_only should pass only grounded_web as effectiveSources");
        return [];
      },
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: [],
        candidates: [],
        warnings: [],
      }),
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme" }],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_routing_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // ATS adapters should not have been called at all
  assert.equal(atsDetectCalls.length, 0, "ATS detect should not be called for browser_only");
  assert.equal(atsListCalls.length, 0, "ATS listJobs should not be called for browser_only");

  // grounded_web should be in sourceSummary (may have warnings from empty results)
  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should be in sourceSummary");

  // ATS sources should appear with skip evidence (excluded by preset)
  const greenhouseEntry = result.sourceSummary.find((s) => s.sourceId === "greenhouse");
  assert.ok(greenhouseEntry, "greenhouse should have skip evidence (excluded by preset)");
  assert.match(greenhouseEntry.warnings.join(" "), /excluded by preset.*browser_only/i);

  // State is 'partial' because grounded_web returned no candidates (no warnings from our mock, but lifecycle is still partial due to empty leads)
  assert.equal(result.lifecycle.state, "partial");
});

test("runDiscovery with ats_only preset excludes grounded_web (VAL-ROUTE-002)", async () => {
  const groundedSearchCalls: string[] = [];

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [
            {
              sourceId: "greenhouse",
              sourceLabel: "Greenhouse",
              title: "Backend Engineer",
              company: "Acme",
              location: "Remote",
              url: "https://jobs.example.com/backend",
              descriptionText: "Build things",
              tags: [],
            },
          ],
          normalize: async () => null,
        },
      ],
      detectBoards: async ({ company }, effectiveSources) => {
        assert.deepEqual(effectiveSources, ["greenhouse"], "ats_only should pass only ATS sources");
        return [
          {
            matched: true,
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            boardUrl: "https://boards.greenhouse.io/acme",
            confidence: 1,
            warnings: [],
          },
        ];
      },
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => {
        groundedSearchCalls.push("search");
        return {
          searchQueries: [],
          candidates: [],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => {
        groundedSearchCalls.push("browser");
        return {
          url: "",
          text: "[]",
          metadata: {},
        };
      },
    },
    pipelineWriter: {
      write: async (sheetId, leads) => ({
        sheetId,
        appended: leads.length,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme" }],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "ats_only",
      effectiveSources: ["greenhouse"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_ats_only_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // grounded_web should not have been called
  assert.equal(groundedSearchCalls.length, 0, "grounded_web should not be called for ats_only");

  // grounded_web should appear with skip evidence
  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should have skip evidence (excluded by preset)");
  assert.match(groundedEntry.warnings.join(" "), /excluded by preset.*ats_only/i);

  // greenhouse should have been executed
  const greenhouseEntry = result.sourceSummary.find((s) => s.sourceId === "greenhouse");
  assert.ok(greenhouseEntry, "greenhouse should be in sourceSummary");
  assert.equal(greenhouseEntry.leadsSeen, 1);

  // State is 'partial' because leads were found but normalized lead count matches
  assert.equal(result.lifecycle.state, "partial");
});

test("runDiscovery with browser_plus_ats executes both families (VAL-ROUTE-003)", async () => {
  const detectBoardsCalls: { effectiveSources: string[] }[] = [];
  let groundedSearchCalled = false;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async ({ company }, effectiveSources) => {
        detectBoardsCalls.push({ effectiveSources: [...effectiveSources] });
        return [
          {
            matched: true,
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            boardUrl: "https://boards.greenhouse.io/acme",
            confidence: 1,
            warnings: [],
          },
        ];
      },
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => {
        groundedSearchCalled = true;
        return {
          searchQueries: [],
          candidates: [],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme" }],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_plus_ats",
      effectiveSources: ["greenhouse", "grounded_web"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_both_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // detectBoards should have been called with browser_plus_ats effectiveSources
  assert.ok(detectBoardsCalls.length > 0, "detectBoards should be called");
  const lastCall = detectBoardsCalls[detectBoardsCalls.length - 1];
  assert.ok(lastCall.effectiveSources.includes("greenhouse"), "browser_plus_ats should include greenhouse");
  assert.ok(lastCall.effectiveSources.includes("grounded_web"), "browser_plus_ats should include grounded_web");

  // grounded_web should have been called
  assert.ok(groundedSearchCalled, "grounded_web should be called for browser_plus_ats");

  // Both should appear in sourceSummary
  const greenhouseEntry = result.sourceSummary.find((s) => s.sourceId === "greenhouse");
  assert.ok(greenhouseEntry, "greenhouse should be in sourceSummary");

  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should be in sourceSummary");

  // State is 'empty' because no leads were found (adapters returned empty)
  assert.equal(result.lifecycle.state, "empty");
});

// === Skip evidence tests (VAL-ROUTE-006) ===

test("runDiscovery generates skip evidence for excluded ATS sources (VAL-ROUTE-006)", async () => {
  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
        {
          sourceId: "lever",
          sourceLabel: "Lever",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
        {
          sourceId: "ashby",
          sourceLabel: "Ashby",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: [],
        candidates: [],
        warnings: [],
      }),
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme" }],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_skip_evidence_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // All excluded ATS sources should have skip evidence
  for (const sourceId of ["greenhouse", "lever", "ashby"]) {
    const entry = result.sourceSummary.find((s) => s.sourceId === sourceId);
    assert.ok(entry, `${sourceId} should appear in sourceSummary with skip evidence`);
    assert.equal(entry.pagesVisited, 0, `${sourceId} should have zero pagesVisited`);
    assert.equal(entry.leadsSeen, 0, `${sourceId} should have zero leadsSeen`);
    assert.ok(entry.warnings.some((w) => w.includes("excluded by preset")), `${sourceId} should have skip warning`);
  }

  // grounded_web should be the only source that executed
  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should be in sourceSummary");
  // grounded_web might have 0 leads if no candidates found, but it should not have "excluded by preset" warning
  assert.ok(
    !groundedEntry.warnings.some((w) => w.includes("excluded by preset")),
    "grounded_web should NOT have excluded-by-preset warning (it executed)",
  );
});

// === VAL-ROUTE-007: Browser-only unrestricted scope executes grounded lane without legacy fixed-company pinning ===

test("VAL-ROUTE-007: browser_only with empty companies executes grounded_web using unrestricted scope (not legacy defaults)", async () => {
  // When browser_only preset is used with empty companies (unrestricted scope),
  // grounded_web should execute using the empty company placeholder [{ name: "" }]
  // for unrestricted intent-based search, NOT legacy fixed-company defaults like Scale AI/Figma/Notion.
  let groundedSearchCompanyName: string | undefined;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
        {
          sourceId: "ashby",
          sourceLabel: "Ashby",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async (company) => {
        // Capture the company name used for grounded search
        groundedSearchCompanyName = company.name;
        return {
          searchQueries: company.name ? [`${company.name} product manager`] : ["product manager"],
          candidates: [],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [], // Empty companies - unrestricted scope
      includeKeywords: ["product"],
      excludeKeywords: [],
      targetRoles: ["Product Manager"],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "ashby", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_browser_unrestricted_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // grounded_web should have executed
  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should be in sourceSummary for browser_only");

  // grounded_web should have been called with empty company name (unrestricted scope)
  assert.equal(
    groundedSearchCompanyName,
    "",
    "grounded_web should be called with empty company name for unrestricted scope (not Scale AI/Figma/Notion legacy defaults)",
  );

  // ATS lanes should be excluded with skip warnings
  const greenhouseEntry = result.sourceSummary.find((s) => s.sourceId === "greenhouse");
  assert.ok(greenhouseEntry, "greenhouse should appear in sourceSummary for browser_only");
  assert.ok(
    greenhouseEntry.warnings.some((w) => w.includes("excluded by preset")),
    "greenhouse should have 'excluded by preset' warning for browser_only",
  );
});

// === VAL-ROUTE-008: ATS-only unrestricted scope does not fabricate empty-company ATS execution ===

test("VAL-ROUTE-008: ats_only with empty companies does not fabricate ATS placeholder execution", async () => {
  let detectBoardsCalls = 0;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async () => {
        detectBoardsCalls += 1;
        return [];
      },
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: [],
        candidates: [],
        warnings: [],
      }),
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [], // Empty companies - unrestricted scope
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: ["Software Engineer"],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "ats_only",
      effectiveSources: ["greenhouse", "lever", "ashby"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_ats_unrestricted_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.ok(
    result.lifecycle.state === "empty" || result.lifecycle.state === "partial",
    "Lifecycle state should be empty or partial when no ATS company seeds exist",
  );

  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should appear in sourceSummary even when excluded");
  assert.ok(
    groundedEntry.warnings.some((w) => w.includes("excluded by preset")),
    "grounded_web should have 'excluded by preset' warning for ats_only",
  );

  const greenhouseEntry = result.sourceSummary.find((s) => s.sourceId === "greenhouse");
  // Wave-3: ATS source entries are created for unrestricted scope to provide lane-execution evidence.
  // The entry should have a warning indicating no boards were found (not fabricated detections).
  assert.ok(greenhouseEntry, "greenhouse should appear in sourceSummary with unrestricted-scope warning");
  assert.ok(
    greenhouseEntry.warnings.some((w) => /unrestricted scope/i.test(w)),
    "greenhouse warning should indicate unrestricted scope with empty company target",
  );
  assert.equal(
    greenhouseEntry.leadsAccepted,
    0,
    "greenhouse should have zero accepted leads when no real boards exist",
  );
  assert.equal(
    detectBoardsCalls,
    0,
    "detectBoards should not be called with a fabricated empty company placeholder",
  );
});

// === VAL-ROUTE-009: Browser+ATS unrestricted scope runs grounded lane without fabricating ATS summaries ===

test("VAL-ROUTE-009: browser_plus_ats with empty companies runs grounded lane without fake ATS placeholder entries", async () => {
  let detectBoardsCalls = 0;
  let groundedSearchCalled = false;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async () => {
        detectBoardsCalls += 1;
        return [];
      },
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => {
        groundedSearchCalled = true;
        return {
          searchQueries: [],
          candidates: [],
          warnings: ["Grounded search returned no usable candidate links."],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [], // Empty companies - unrestricted scope
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: ["Software Engineer"],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_plus_ats",
      effectiveSources: ["greenhouse", "lever", "ashby", "grounded_web"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_both_unrestricted_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  assert.ok(
    groundedSearchCalled,
    "grounded_web should be called for browser_plus_ats unrestricted scope",
  );

  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should appear in sourceSummary for browser_plus_ats");
  assert.equal(groundedEntry.leadsSeen, 0, "grounded_web should have 0 leadsSeen (no candidates found)");

  const greenhouseEntry = result.sourceSummary.find((s) => s.sourceId === "greenhouse");
  // Wave-3: ATS source entries are created for unrestricted scope to provide lane-execution evidence.
  // The entry should have a warning indicating no boards were found (not fabricated detections).
  assert.ok(greenhouseEntry, "greenhouse should appear in sourceSummary with unrestricted-scope warning");
  assert.ok(
    greenhouseEntry.warnings.some((w) => /unrestricted scope/i.test(w)),
    "greenhouse warning should indicate unrestricted scope with empty company target",
  );
  assert.equal(
    greenhouseEntry.leadsAccepted,
    0,
    "greenhouse should have zero accepted leads when no real boards exist",
  );
  assert.equal(
    detectBoardsCalls,
    0,
    "detectBoards should not be called with a fabricated empty company placeholder",
  );

  for (const entry of result.sourceSummary) {
    assert.ok(
      !entry.warnings.some((w) => w.includes("excluded by preset")),
      `Source ${entry.sourceId} should NOT have 'excluded by preset' warning (all active lanes should execute)`,
    );
  }
});

// === VAL-ROUTE-010: Browser-only unrestricted grounded query evidence is modifier-driven (not placeholder-company-driven) ===

test("VAL-ROUTE-010: browser_only with empty companies uses modifier-driven grounded query (no placeholder company artifacts)", async () => {
  // When browser_only preset is used with empty companies and non-blank modifiers,
  // the grounded search prompt should be driven by role/keyword/location modifiers
  // and NOT use placeholder company artifacts like "Target careers".
  let groundedSearchPrompt: string | undefined;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async (company, run) => {
        // Capture that the search is called with empty company name (unrestricted scope)
        assert.equal(company.name, "", "Company name should be empty for unrestricted scope");
        
        // The querySummary should contain modifier tokens, not placeholder company artifacts
        // We can't directly test the prompt here, but we can verify the grounded search
        // is called and produces proper searchQueries based on modifiers
        return {
          searchQueries: run.config.targetRoles.length > 0 
            ? [`${run.config.targetRoles.join(" ")} ${run.config.includeKeywords.join(" ")}`.trim()]
            : ["modifier-driven search"],
          candidates: [
            {
              url: "https://example.com/senior-engineer",
              title: "Senior Software Engineer",
              pageType: "job",
              reason: "Direct job posting",
              sourceDomain: "example.com",
            },
          ],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "https://example.com/senior-engineer",
        text: JSON.stringify({
          pageType: "job",
          jobs: [
            {
              title: "Senior Software Engineer",
              company: "Example Corp",
              location: "Remote",
              url: "https://example.com/senior-engineer",
              descriptionText: "Build software",
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 1,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [], // Empty companies - unrestricted scope
      includeKeywords: ["python", "machine learning"],
      excludeKeywords: [],
      targetRoles: ["Senior Software Engineer", "Staff Engineer"],
      locations: ["Remote", "United States"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_modifier_driven_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // grounded_web should have executed with modifier-driven query
  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should be in sourceSummary for browser_only unrestricted");

  // The querySummary should contain modifier tokens (role/keyword/location), not placeholder company artifacts
  // Since we mock searchQueries to be modifier-based, verify it was captured
  assert.ok(
    result.extractionResults.some((r) => r.sourceId === "grounded_web" && r.querySummary.length > 0),
    "grounded_web should have querySummary with modifier-driven search queries"
  );

  // Should NOT have placeholder company artifacts in the search results
  // The mock returns modifier-based search queries, not company-based ones
  const groundedResults = result.extractionResults.find((r) => r.sourceId === "grounded_web");
  if (groundedResults) {
    assert.ok(
      !groundedResults.querySummary.includes("Scale AI") &&
      !groundedResults.querySummary.includes("Figma") &&
      !groundedResults.querySummary.includes("Notion"),
      "Query should not contain placeholder company artifacts (Scale AI, Figma, Notion)"
    );
  }
});

// === VAL-ROUTE-011: Valid unrestricted modifier intent does not emit misleading missing-company degradation warnings ===

test("VAL-ROUTE-011: browser_only with empty companies and non-blank modifiers does NOT emit misleading missing-company warning", async () => {
  // When browser_only preset is used with empty companies but non-blank modifier intent,
  // the "No companies are configured" warning should NOT be emitted because grounded
  // search can proceed with modifiers alone.

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: ["Senior Engineer Remote"],
        candidates: [
          {
            url: "https://example.com/senior-engineer",
            title: "Senior Software Engineer",
            pageType: "job",
            reason: "Direct job posting",
            sourceDomain: "example.com",
          },
        ],
        warnings: [],
      }),
    },
    browserSessionManager: {
      run: async () => ({
        url: "https://example.com/senior-engineer",
        text: JSON.stringify({
          pageType: "job",
          jobs: [
            {
              title: "Senior Software Engineer",
              company: "Example Corp",
              location: "Remote",
              url: "https://example.com/senior-engineer",
              descriptionText: "Build software",
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 1,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [], // Empty companies - unrestricted scope
      includeKeywords: ["python"],
      excludeKeywords: [],
      targetRoles: ["Senior Software Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_no_warning_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // grounded_web should have executed
  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should be in sourceSummary for browser_only unrestricted");

  // The "No companies are configured" warning should NOT be present because:
  // - companies is empty AND
  // - grounded_web is in effectiveSources AND
  // - we have non-blank modifier intent (targetRoles, keywordsInclude, etc.)
  assert.ok(
    !result.warnings.some((w) => w.includes("No companies are configured")),
    "Should NOT emit 'No companies are configured' warning for browser_only with modifier intent and empty companies"
  );

  // Verify the grounded execution was NOT treated as degraded due to missing companies
  assert.ok(
    !result.warnings.some((w) => w.includes("missing companies") || w.includes("no companies")),
    "Should NOT have any misleading missing-company warnings during grounded execution"
  );
});

test("VAL-ROUTE-011: ats_only with empty companies and no modifiers SHOULD emit missing-company warning", async () => {
  // When ats_only preset is used with empty companies AND no modifier intent,
  // the "No companies are configured" warning SHOULD be emitted because
  // ATS lanes cannot execute without company targets.

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => null,
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async () => ({
        searchQueries: [],
        candidates: [],
        warnings: [],
      }),
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [], // Empty companies
      includeKeywords: [], // NO modifiers
      excludeKeywords: [],
      targetRoles: [], // NO modifiers
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "ats_only",
      effectiveSources: ["greenhouse", "lever", "ashby"],
    }),
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_ats_no_mods_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // The "No companies are configured" warning SHOULD be present because:
  // - companies is empty AND
  // - no modifier intent AND
  // - ATS lanes cannot execute without company targets
  assert.ok(
    result.warnings.some((w) => w.includes("No companies are configured")),
    "Should emit 'No companies are configured' warning when no companies AND no modifiers"
  );
});

// === VAL-ROUTE-015: parallel company processing is bounded by configured concurrency ===

test("VAL-ROUTE-015: parallel company processing respects concurrency cap (cap=3 with 5 companies)", async () => {
  // When parallelCompanyProcessingEnabled=true with 5 companies and cap=3,
  // peak in-flight should never exceed 3.
  const processedCompanies: string[] = [];
  const inFlightCounts: number[] = [];
  let currentInFlight = 0;
  const concurrencyLogs: { event: string; company?: string; inFlight?: number }[] = [];

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async (company: { name: string }) => {
        // Simulate processing delay to allow concurrency tracking
        processedCompanies.push(company.name);
        currentInFlight++;
        inFlightCounts.push(currentInFlight);
        concurrencyLogs.push({
          event: "start",
          company: company.name,
          inFlight: currentInFlight,
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        currentInFlight--;
        concurrencyLogs.push({
          event: "end",
          company: company.name,
          inFlight: currentInFlight,
        });

        return {
          searchQueries: [`query for ${company.name}`],
          candidates: [
            {
              url: `https://${company.name}.com/careers`,
              title: `${company.name} job`,
              pageType: "job" as const,
              reason: "Direct job posting",
              sourceDomain: `${company.name}.com`,
            },
          ],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Software Engineer",
              company: "Test Company",
              location: "Remote",
              url: "https://example.com/job",
              descriptionText: "Build software",
              tags: [],
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [
        { name: "Company A" },
        { name: "Company B" },
        { name: "Company C" },
        { name: "Company D" },
        { name: "Company E" },
      ],
      includeKeywords: ["engineer"],
      excludeKeywords: [],
      targetRoles: ["Software Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
      ultraPlanTuning: {
        multiQueryEnabled: false,
        retryBroadeningEnabled: false,
        parallelCompanyProcessingEnabled: true,
      },
      groundedSearchTuning: {
        maxResultsPerCompany: 6,
        maxPagesPerCompany: 4,
        maxRuntimeMs: 30000,
        maxTokensPerQuery: 2048,
        multiQueryCap: 3,
      },
    }),
    log: (event: string, details: Record<string, unknown>) => {
      if (event === "discovery.run.concurrency_summary") {
        concurrencyLogs.push({
          event: "concurrency_summary",
          inFlight: details.peakInFlight as number,
        });
      }
    },
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_concurrency_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // VAL-ROUTE-015: Peak in-flight should not exceed the effective cap (3)
  // The concurrency tracker in the code uses cap=3 for 5 companies with parallel enabled
  const peakInFlight = Math.max(...inFlightCounts);

  // All companies should have been processed
  assert.equal(
    processedCompanies.length,
    5,
    "All 5 companies should be processed",
  );

  // The peak in-flight count should be bounded (default cap is 3)
  assert.ok(
    peakInFlight <= 3,
    `Peak in-flight (${peakInFlight}) should not exceed effective cap (3)`,
  );

  // Check the concurrency summary log
  const summaryLog = concurrencyLogs.find(
    (log) => log.event === "concurrency_summary",
  );
  assert.ok(summaryLog, "Concurrency summary should be logged");
  assert.equal(summaryLog.inFlight, peakInFlight, "Logged peakInFlight should match observed");
});

test("VAL-ROUTE-015: cap=1 forces sequential processing", async () => {
  // When parallelCompanyProcessingEnabled=false, cap resolves to 1 and
  // processing should be sequential even with multiple companies.
  const processingOrder: string[] = [];
  const inFlightCounts: number[] = [];
  let currentInFlight = 0;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async (company: { name: string }) => {
        processingOrder.push(`start:${company.name}`);
        currentInFlight++;
        inFlightCounts.push(currentInFlight);

        await new Promise((resolve) => setTimeout(resolve, 30));

        processingOrder.push(`end:${company.name}`);
        currentInFlight--;

        return {
          searchQueries: [`query for ${company.name}`],
          candidates: [],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [
        { name: "Company A" },
        { name: "Company B" },
        { name: "Company C" },
      ],
      includeKeywords: ["engineer"],
      excludeKeywords: [],
      targetRoles: ["Software Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
      // parallelCompanyProcessingEnabled=false forces cap=1 (sequential)
      ultraPlanTuning: {
        multiQueryEnabled: false,
        retryBroadeningEnabled: false,
        parallelCompanyProcessingEnabled: false,
      },
      groundedSearchTuning: {
        maxResultsPerCompany: 6,
        maxPagesPerCompany: 4,
        maxRuntimeMs: 30000,
        maxTokensPerQuery: 2048,
        multiQueryCap: 3,
      },
    }),
    log: () => {},
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_sequential_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // With parallel disabled (cap=1), only 1 company processes at a time
  const peakInFlight = Math.max(...inFlightCounts);
  assert.equal(
    peakInFlight,
    1,
    "With parallel disabled, peak in-flight should be 1 (sequential)",
  );
});

test("VAL-ROUTE-015: cap>=companyCount runs all in parallel", async () => {
  // When there are fewer companies than the default cap (3),
  // all companies can run in parallel.
  const inFlightCounts: number[] = [];
  let currentInFlight = 0;

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async (company: { name: string }) => {
        currentInFlight++;
        inFlightCounts.push(currentInFlight);

        await new Promise((resolve) => setTimeout(resolve, 30));

        currentInFlight--;

        return {
          searchQueries: [`query for ${company.name}`],
          candidates: [],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: "[]",
        metadata: {},
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [
        { name: "Company A" },
        { name: "Company B" },
      ],
      includeKeywords: ["engineer"],
      excludeKeywords: [],
      targetRoles: ["Software Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
      ultraPlanTuning: {
        multiQueryEnabled: false,
        retryBroadeningEnabled: false,
        parallelCompanyProcessingEnabled: true,
      },
      groundedSearchTuning: {
        maxResultsPerCompany: 6,
        maxPagesPerCompany: 4,
        maxRuntimeMs: 30000,
        maxTokensPerQuery: 2048,
        multiQueryCap: 3,
      },
    }),
    log: () => {},
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_parallel_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // With 2 companies and cap=3, both can run in parallel
  const peakInFlight = Math.max(...inFlightCounts);
  assert.equal(
    peakInFlight,
    2,
    "2 companies with cap>=2 should both run in parallel (peak=2)",
  );
});

// === VAL-ROUTE-016: one-company failure is isolated and does not abort successful companies ===

test("VAL-ROUTE-016: one-company failure does not abort other companies", async () => {
  // When one company fails, other companies should continue processing
  // and successful outputs should still appear in results.
  const processedCompanies: { name: string; succeeded: boolean }[] = [];

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async (company: { name: string }) => {
        processedCompanies.push({ name: company.name, succeeded: false });

        // Company B fails with an error
        if (company.name === "Company B") {
          throw new Error("Simulated Company B failure");
        }

        // Companies A and C succeed
        processedCompanies[processedCompanies.length - 1].succeeded = true;

        return {
          searchQueries: [`query for ${company.name}`],
          candidates: [
            {
              url: `https://${company.name}.com/careers`,
              title: `${company.name} job`,
              pageType: "job" as const,
              reason: "Direct job posting",
              sourceDomain: `${company.name}.com`,
            },
          ],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Software Engineer",
              company: "Test Company",
              location: "Remote",
              url: "https://example.com/job",
              descriptionText: "Build software",
              tags: [],
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [
        { name: "Company A" },
        { name: "Company B" },
        { name: "Company C" },
      ],
      includeKeywords: ["engineer"],
      excludeKeywords: [],
      targetRoles: ["Software Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
      ultraPlanTuning: {
        multiQueryEnabled: false,
        retryBroadeningEnabled: false,
        parallelCompanyProcessingEnabled: true,
      },
      groundedSearchTuning: {
        maxResultsPerCompany: 6,
        maxPagesPerCompany: 4,
        maxRuntimeMs: 30000,
        maxTokensPerQuery: 2048,
        multiQueryCap: 3,
      },
    }),
    log: () => {},
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_isolation_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // All 3 companies should have been attempted (failure isolation)
  assert.equal(
    processedCompanies.length,
    3,
    "All 3 companies should be attempted even with one failure",
  );

  // 2 companies succeeded
  const succeededCompanies = processedCompanies.filter((c) => c.succeeded);
  assert.equal(
    succeededCompanies.length,
    2,
    "Companies A and C should have succeeded",
  );

  // Company B should have failed
  const failedCompany = processedCompanies.find((c) => !c.succeeded);
  assert.equal(
    failedCompany?.name,
    "Company B",
    "Company B should have failed",
  );

  // The run should have warnings about Company B's failure
  const companyBWarnings = result.warnings.filter(
    (w) => w.includes("Company B") && w.includes("failed"),
  );
  assert.ok(
    companyBWarnings.length > 0,
    "Warnings should contain Company B failure attribution",
  );

  // VAL-ROUTE-016: Successful companies should still appear in source summary
  const groundedEntry = result.sourceSummary.find(
    (s) => s.sourceId === "grounded_web",
  );
  assert.ok(groundedEntry, "grounded_web should be in sourceSummary");

  // Diagnostics should include company-attributed failure evidence
  const companyBDiagnostics = groundedEntry?.diagnostics?.filter(
    (d) => d.context.includes("Company B"),
  );
  assert.ok(
    companyBDiagnostics && companyBDiagnostics.length > 0,
    "Diagnostics should include Company B failure attribution",
  );
});

test("VAL-ROUTE-016: company failure emits explicit company-attributed failure evidence", async () => {
  // Company failures should emit structured diagnostic context that names
  // the failed company, providing company-scoped failure attribution.
  let failedWithAttribution = false;
  let attributionContext = "";

  const dependencies = {
    runtimeConfig: {
      stateDatabasePath: "",
      workerConfigPath: "",
      browserUseCommand: "",
      geminiApiKey: "test-key",
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
      runMode: "hosted",
      asyncAckByDefault: true,
      useStructuredExtraction: false,
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    groundedSearchClient: {
      search: async (company: { name: string }) => {
        if (company.name === "FailingCompany") {
          throw new Error("FailingCompany explicit failure");
        }
        return {
          searchQueries: [`query for ${company.name}`],
          candidates: [
            {
              url: `https://${company.name}.com/careers`,
              title: `${company.name} job`,
              pageType: "job" as const,
              reason: "Direct job posting",
              sourceDomain: `${company.name}.com`,
            },
          ],
          warnings: [],
        };
      },
    },
    browserSessionManager: {
      run: async () => ({
        url: "",
        text: JSON.stringify({
          pageType: "listings",
          jobs: [
            {
              title: "Software Engineer",
              company: "Test Company",
              location: "Remote",
              url: "https://example.com/job",
              descriptionText: "Build software",
              tags: [],
            },
          ],
        }),
        metadata: { mode: "browser_use_command" },
      }),
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [
        { name: "GoodCompany" },
        { name: "FailingCompany" },
      ],
      includeKeywords: ["engineer"],
      excludeKeywords: [],
      targetRoles: ["Software Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["grounded_web"],
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored, request) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only",
      effectiveSources: ["grounded_web"],
      ultraPlanTuning: {
        multiQueryEnabled: false,
        retryBroadeningEnabled: false,
        parallelCompanyProcessingEnabled: true,
      },
      groundedSearchTuning: {
        maxResultsPerCompany: 6,
        maxPagesPerCompany: 4,
        maxRuntimeMs: 30000,
        maxTokensPerQuery: 2048,
        multiQueryCap: 3,
      },
    }),
    log: (event: string, details: Record<string, unknown>) => {
      if (event === "discovery.run.company_failed") {
        failedWithAttribution = true;
        attributionContext = JSON.stringify(details);
      }
    },
    now: () => new Date("2026-04-10T03:00:00.000Z"),
    randomId: () => "run_attribution_test",
  };

  const result = await runDiscovery(makeRequest(), "manual", dependencies);

  // Company failure should be logged with attribution
  assert.ok(
    failedWithAttribution,
    "Company failure should be logged with attribution",
  );
  assert.ok(
    attributionContext.includes("FailingCompany"),
    "Failure attribution should name the failed company",
  );

  // Diagnostics should include the company name in context
  const groundedEntry = result.sourceSummary.find(
    (s) => s.sourceId === "grounded_web",
  );
  const failingCompanyDiagnostics = groundedEntry?.diagnostics?.filter(
    (d) => d.context.includes("FailingCompany"),
  );
  assert.ok(
    failingCompanyDiagnostics && failingCompanyDiagnostics.length > 0,
    "Diagnostics context should include FailingCompany name",
  );

  // Warnings should also include company name for backward compatibility
  const failingCompanyWarnings = result.warnings.filter(
    (w) => w.includes("FailingCompany"),
  );
  assert.ok(
    failingCompanyWarnings.length > 0,
    "Warnings should include FailingCompany name for backward compatibility",
  );
});
