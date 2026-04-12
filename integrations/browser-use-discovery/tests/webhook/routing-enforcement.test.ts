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

// === VAL-ROUTE-008: ATS-only unrestricted scope executes ATS-attributed discovery behavior ===

test("VAL-ROUTE-008: ats_only with empty companies attempts ATS lane execution (not skipped due to missing companies)", async () => {
  // When ats_only preset is used with empty companies (unrestricted scope),
  // ATS lanes should attempt execution using an empty company placeholder,
  // not be skipped entirely due to missing company targets.
  const atsDetectCalls: string[] = [];

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
    },
    sourceAdapterRegistry: {
      adapters: [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          detect: async () => {
            atsDetectCalls.push("greenhouse");
            return null; // No board found with empty company
          },
          listJobs: async () => [],
          normalize: async () => null,
        },
      ],
      detectBoards: async ({ company }, effectiveSources) => {
        // detectBoards is called with the empty company placeholder
        assert.deepEqual(company, { name: "" }, "detectBoards should receive empty company placeholder");
        return []; // No boards found
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

  // The run should complete with empty results (no boards found with empty company placeholder)
  // but the ATS lane should have attempted execution (not skipped entirely)
  assert.ok(result.lifecycle.state === "empty" || result.lifecycle.state === "partial",
    "Lifecycle state should be empty or partial (no boards found)");

  // grounded_web should NOT be in sourceSummary (excluded by ats_only preset)
  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should appear in sourceSummary even when excluded");
  assert.ok(
    groundedEntry.warnings.some((w) => w.includes("excluded by preset")),
    "grounded_web should have 'excluded by preset' warning for ats_only"
  );

  // ATS lanes should appear with explicit attribution (even with zero results from empty company placeholder)
  const greenhouseEntry = result.sourceSummary.find((s) => s.sourceId === "greenhouse");
  assert.ok(greenhouseEntry, "greenhouse should be in sourceSummary for ats_only");
  // ATS lanes should have executed (even if they found no boards)
  assert.equal(greenhouseEntry.leadsSeen, 0, "greenhouse should have 0 leadsSeen (empty company placeholder)");
});

// === VAL-ROUTE-009: Browser+ATS unrestricted scope executes both lane families ===

test("VAL-ROUTE-009: browser_plus_ats with empty companies executes both grounded_web and ATS lanes", async () => {
  // When browser_plus_ats preset is used with empty companies (unrestricted scope),
  // both grounded_web and ATS lanes should execute, with truthful per-lane attribution.
  const detectBoardsCalls: { company: { name: string } }[] = [];
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
        detectBoardsCalls.push({ company: { name: company.name } });
        return []; // No boards found with empty company placeholder
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

  // grounded_web should have been called (runs with empty company placeholder for intent-only search)
  assert.ok(groundedSearchCalled, "grounded_web should be called for browser_plus_ats unrestricted");

  // Both lane families should appear in sourceSummary with truthful attribution
  const groundedEntry = result.sourceSummary.find((s) => s.sourceId === "grounded_web");
  assert.ok(groundedEntry, "grounded_web should appear in sourceSummary for browser_plus_ats");
  assert.equal(groundedEntry.leadsSeen, 0, "grounded_web should have 0 leadsSeen (no candidates found)");

  const greenhouseEntry = result.sourceSummary.find((s) => s.sourceId === "greenhouse");
  assert.ok(greenhouseEntry, "greenhouse should appear in sourceSummary for browser_plus_ats");
  assert.equal(greenhouseEntry.leadsSeen, 0, "greenhouse should have 0 leadsSeen (empty company placeholder)");

  // No lane should be skipped due to missing companies
  for (const entry of result.sourceSummary) {
    assert.ok(
      !entry.warnings.some((w) => w.includes("excluded by preset")),
      `Source ${entry.sourceId} should NOT have 'excluded by preset' warning (all lanes should execute)`
    );
  }
});
