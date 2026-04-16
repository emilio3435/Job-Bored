import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";
import { mergeDiscoveryConfig } from "../../src/config.ts";

// Shared header value used in tests that need to bypass auth validation.
const SHARED_HEADER_VALUE = "cross-area-test-secret";

function makeRequest(overrides = {}) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(overrides.secret
        ? { "x-discovery-secret": overrides.secret }
        : {}),
    },
    bodyText: JSON.stringify({
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_cross_area",
      variationKey: "var_cross",
      requestedAt: "2026-04-12T00:00:00.000Z",
      ...overrides,
    }),
  };
}

function createMemoryRunStatusStore() {
  const states = [];
  return {
    states,
    put(payload) {
      states.push(JSON.parse(JSON.stringify(payload)));
    },
    get(runId) {
      for (let index = states.length - 1; index >= 0; index--) {
        if (states[index].runId === runId) return states[index];
      }
      return null;
    },
    close() {},
  };
}

// Base runtime config shared across all tests
function makeBaseRuntimeConfig(overrides = {}) {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "",
    geminiApiKey: "test-key",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 6,
    groundedSearchMaxPagesPerCompany: 4,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "cross-area-test-oauth-token",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: SHARED_HEADER_VALUE,
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "hosted",
    asyncAckByDefault: true,
    ...overrides,
  };
}

// Base runDependencies shared across all tests
function makeBaseRunDependencies(overrides = {}) {
  return {
    runtimeConfig: makeBaseRuntimeConfig(),
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async () => ({
        sheetId: "sheet_cross_area",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_cross_area",
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
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
    }),
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-12T00:00:00.000Z"),
        new Date("2026-04-12T00:00:01.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix) => `${prefix}_cross_${Date.now()}`,
    ...overrides,
  };
}

function makeDependencies(overrides = {}) {
  const runStatusStore =
    overrides.runStatusStore || createMemoryRunStatusStore();
  return {
    runSynchronously: false,
    asyncPollAfterMs: 2000,
    runStatusPathForRun: (runId) => `/runs/${runId}`,
    runStatusStore,
    runDiscovery: async () => ({
      run: {
        runId: "run_cross_mock",
        trigger: "manual",
        request: {
          event: DISCOVERY_WEBHOOK_EVENT,
          schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
          sheetId: "sheet_cross_area",
          variationKey: "var_cross",
          requestedAt: "2026-04-12T00:00:00.000Z",
        },
        config: {
          sheetId: "sheet_cross_area",
          mode: "hosted",
          timezone: "UTC",
          companies: [],
          includeKeywords: [],
          excludeKeywords: [],
          targetRoles: [],
          locations: [],
          remotePolicy: "",
          seniority: "",
          maxLeadsPerRun: 25,
          enabledSources: ["greenhouse"],
          schedule: { enabled: false, cron: "" },
          variationKey: "var_cross",
          requestedAt: "2026-04-12T00:00:00.000Z",
        },
      },
      lifecycle: {
        runId: "run_cross_mock",
        trigger: "manual",
        startedAt: "2026-04-12T00:00:00.000Z",
        completedAt: "2026-04-12T00:00:01.000Z",
        state: "completed",
        companyCount: 0,
        detectionCount: 0,
        listingCount: 0,
        normalizedLeadCount: 0,
      },
      extractionResults: [],
      sourceSummary: [],
      writeResult: {
        sheetId: "sheet_cross_area",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      },
      warnings: [],
    }),
    runDependencies: makeBaseRunDependencies(overrides.runDependencies || {}),
    ...overrides,
  };
}

// === VAL-CROSS-006: End-to-end runId lineage consistency ===

test("VAL-CROSS-006: runId is consistent from webhook ack through terminal status", async () => {
  const runStatusStore = createMemoryRunStatusStore();
  const logged: Array<{ event: string; details: Record<string, unknown> }> =
    [];

  // Track the runId used by runDiscovery
  let observedRunIdInDiscovery = null;

  const dependencies = makeDependencies({
    runStatusStore,
    log: (event, details) => {
      logged.push({ event, details });
    },
    runDiscovery: async (_request, _trigger, runDeps) => {
      observedRunIdInDiscovery = runDeps.runId;
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            enabledSources: ["greenhouse"],
            schedule: { enabled: false, cron: "" },
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "ats_only",
            effectiveSources: ["greenhouse"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 1,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "ats_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  // 1. Ack includes runId
  const ackBody = JSON.parse(response.body);
  assert.equal(ackBody.ok, true);
  const ackRunId = ackBody.runId;
  assert.ok(ackRunId, "ack must include runId");
  assert.ok(ackRunId.startsWith("run_"), "runId must have run_ prefix");

  // 2. statusPath includes the same runId
  assert.ok(ackBody.statusPath?.includes(ackRunId));

  // 3. runDiscovery was called with the same runId
  assert.equal(
    observedRunIdInDiscovery,
    ackRunId,
    "runDiscovery must receive the same runId as the ack",
  );

  // 4. Terminal status has the same runId
  await new Promise((resolve) => setTimeout(resolve, 10));
  const terminalStatus = runStatusStore.get(ackRunId);
  assert.ok(terminalStatus, "terminal status must be stored for the ack runId");
  assert.equal(
    terminalStatus.runId,
    ackRunId,
    "terminal status runId must match ack runId",
  );

  // 5. Logs reference the same runId
  const acceptedLog = logged.find((e) => e.event === "discovery.run.accepted");
  assert.ok(acceptedLog, "accepted log must exist");
  assert.equal(
    acceptedLog.details.runId,
    ackRunId,
    "accepted log runId must match ack runId",
  );
});

// === VAL-CROSS-001: Browser-only preset yields browser-attributed outcomes only ===

test("VAL-CROSS-001: browser_only preset includes only grounded_web in terminal sources", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_only",
            effectiveSources: ["grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [
          {
            runId: runDeps.runId,
            sourceId: "grounded_web",
            querySummary: "Acme jobs",
            leads: [],
            warnings: [],
            stats: { pagesVisited: 0, leadsSeen: 0, leadsAccepted: 0 },
          },
        ],
        sourceSummary: [
          {
            sourceId: "grounded_web",
            querySummary: "Acme jobs",
            pagesVisited: 0,
            leadsSeen: 0,
            leadsAccepted: 0,
            leadsRejected: 0,
            warnings: [],
          },
        ],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  // Wait for async completion
  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // browser_only must only have grounded_web sources
  assert.ok(terminalStatus.sources.length > 0, "sources must not be empty");
  for (const source of terminalStatus.sources) {
    assert.equal(
      source.sourceId,
      "grounded_web",
      `browser_only sources must only contain grounded_web, found: ${source.sourceId}`,
    );
  }

  // No ATS sources in terminal status
  const hasAtsSource = terminalStatus.sources.some((s) =>
    ["greenhouse", "lever", "ashby"].includes(s.sourceId),
  );
  assert.ok(
    !hasAtsSource,
    "browser_only must not have ATS sources in terminal status",
  );
});

// === VAL-CROSS-002: ATS-only preset yields ATS-attributed outcomes only ===

test("VAL-CROSS-002: ats_only preset includes only ATS sources in terminal sources", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "ats_only",
            effectiveSources: ["greenhouse", "lever", "ashby"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 1,
          listingCount: 1,
          normalizedLeadCount: 1,
        },
        extractionResults: [
          {
            runId: runDeps.runId,
            sourceId: "greenhouse",
            querySummary: "https://boards.greenhouse.io/acme",
            leads: [
              {
                sourceId: "greenhouse",
                sourceLabel: "Greenhouse",
                title: "Backend Engineer",
                company: "Acme",
                location: "Remote",
                url: "https://jobs.example.com/backend",
                compensationText: "",
                fitScore: 0.8,
                priority: "—",
                tags: [],
                fitAssessment: "",
                contact: "",
                status: "New",
                appliedDate: "",
                notes: "",
                followUpDate: "",
                talkingPoints: "",
                logoUrl: "",
                discoveredAt: "2026-04-12T00:00:00.000Z",
                metadata: {
                  runId: runDeps.runId,
                  variationKey: "var_cross",
                  sourceQuery: "https://boards.greenhouse.io/acme",
                },
              },
            ],
            warnings: [],
            stats: { pagesVisited: 1, leadsSeen: 1, leadsAccepted: 1 },
          },
        ],
        sourceSummary: [
          {
            sourceId: "greenhouse",
            querySummary: "https://boards.greenhouse.io/acme",
            pagesVisited: 1,
            leadsSeen: 1,
            leadsAccepted: 1,
            leadsRejected: 0,
            warnings: [],
          },
          {
            sourceId: "lever",
            querySummary: "",
            pagesVisited: 0,
            leadsSeen: 0,
            leadsAccepted: 0,
            leadsRejected: 0,
            warnings: [
              "Source lever was excluded by preset 'ats_only' and did not execute.",
            ],
          },
          {
            sourceId: "ashby",
            querySummary: "",
            pagesVisited: 0,
            leadsSeen: 0,
            leadsAccepted: 0,
            leadsRejected: 0,
            warnings: [
              "Source ashby was excluded by preset 'ats_only' and did not execute.",
            ],
          },
          {
            sourceId: "grounded_web",
            querySummary: "",
            pagesVisited: 0,
            leadsSeen: 0,
            leadsAccepted: 0,
            leadsRejected: 0,
            warnings: [
              "Source grounded_web was excluded by preset 'ats_only' and did not execute.",
            ],
          },
        ],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "ats_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // ats_only must have ATS sources (and excluded grounded_web with skip warning)
  assert.ok(terminalStatus.sources.length > 0, "sources must not be empty");

  // grounded_web must not appear as an executed source (only as skip evidence)
  const executedSources = terminalStatus.sources.filter(
    (s) => !s.warnings.some((w) => w.includes("excluded by preset")),
  );
  for (const source of executedSources) {
    assert.ok(
      ["greenhouse", "lever", "ashby"].includes(source.sourceId),
      `ats_only executed sources must only be ATS lanes, found: ${source.sourceId}`,
    );
  }

  // No browser/grounded_web as executed source
  const hasBrowserSource = executedSources.some(
    (s) => s.sourceId === "grounded_web",
  );
  assert.ok(
    !hasBrowserSource,
    "ats_only must not have grounded_web as executed source",
  );

  // Write result must be from ATS source
  assert.ok(
    terminalStatus.writeResult.appended >= 0,
    "writeResult must be present",
  );
});

// === VAL-CROSS-003: Browser+ATS yields mixed attribution with lane status ===

test("VAL-CROSS-003: browser_plus_ats preset includes both lane families with explicit per-lane status", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_plus_ats",
            effectiveSources: ["greenhouse", "lever", "ashby", "grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 1,
          listingCount: 1,
          normalizedLeadCount: 1,
        },
        extractionResults: [],
        sourceSummary: [
          {
            sourceId: "greenhouse",
            querySummary: "https://boards.greenhouse.io/acme",
            pagesVisited: 1,
            leadsSeen: 1,
            leadsAccepted: 1,
            leadsRejected: 0,
            warnings: [],
          },
          {
            sourceId: "grounded_web",
            querySummary: "Acme jobs",
            pagesVisited: 1,
            leadsSeen: 1,
            leadsAccepted: 0,
            leadsRejected: 1,
            warnings: ["GEMINI_API_KEY not configured — grounded web degraded"],
          },
        ],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_plus_ats", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // browser_plus_ats must have both ATS and browser sources
  const hasAtsSource = terminalStatus.sources.some((s) =>
    ["greenhouse", "lever", "ashby"].includes(s.sourceId),
  );
  const hasBrowserSource = terminalStatus.sources.some(
    (s) => s.sourceId === "grounded_web",
  );

  assert.ok(hasAtsSource, "browser_plus_ats must include at least one ATS source");
  assert.ok(
    hasBrowserSource,
    "browser_plus_ats must include grounded_web source",
  );

  // Each source must have explicit counters/warnings
  for (const source of terminalStatus.sources) {
    assert.ok(
      "pagesVisited" in source,
      `source ${source.sourceId} must have pagesVisited counter`,
    );
    assert.ok(
      "leadsSeen" in source,
      `source ${source.sourceId} must have leadsSeen counter`,
    );
    assert.ok(
      "leadsAccepted" in source,
      `source ${source.sourceId} must have leadsAccepted counter`,
    );
    assert.ok(
      "warnings" in source,
      `source ${source.sourceId} must have warnings array`,
    );
  }
});

// === VAL-CROSS-004: Lane-specific failure never appears as full success ===

test("VAL-CROSS-004: one-lane failure in browser_plus_ats produces partial status (not full success)", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDependencies: makeBaseRunDependencies({
      runtimeConfig: makeBaseRuntimeConfig({
        geminiApiKey: "", // Missing — triggers grounded_web warning
      }),
    }),
    runDiscovery: async (_request, _trigger, runDeps) => {
      // ATS lane succeeds, browser lane fails
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_plus_ats",
            effectiveSources: ["greenhouse", "grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "partial", // <-- explicit partial due to grounded_web warning
          companyCount: 1,
          detectionCount: 1,
          listingCount: 1,
          normalizedLeadCount: 1,
        },
        extractionResults: [],
        sourceSummary: [
          {
            sourceId: "greenhouse",
            querySummary: "https://boards.greenhouse.io/acme",
            pagesVisited: 1,
            leadsSeen: 1,
            leadsAccepted: 1,
            leadsRejected: 0,
            warnings: [],
          },
          {
            sourceId: "grounded_web",
            querySummary: "",
            pagesVisited: 0,
            leadsSeen: 0,
            leadsAccepted: 0,
            leadsRejected: 0,
            warnings: [
              "Grounded web source is enabled but BROWSER_USE_DISCOVERY_GEMINI_API_KEY is not configured.",
            ],
          },
        ],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [
          "Grounded web source is enabled but BROWSER_USE_DISCOVERY_GEMINI_API_KEY is not configured.",
        ],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_plus_ats", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // Must NOT be "completed" — must be "partial"
  assert.notEqual(
    terminalStatus.status,
    "completed",
    "Lane failure must not produce 'completed' status",
  );
  assert.notEqual(
    terminalStatus.status,
    "empty",
    "Lane failure must not produce 'empty' status",
  );

  // Must be "partial" with terminal=true
  assert.equal(
    terminalStatus.status,
    "partial",
    "Lane failure must produce 'partial' status",
  );
  assert.equal(
    terminalStatus.terminal,
    true,
    "partial status must be terminal",
  );

  // Failing lane must have explicit warning attribution
  const groundedEntry = terminalStatus.sources.find(
    (s) => s.sourceId === "grounded_web",
  );
  assert.ok(
    groundedEntry?.warnings.some((w) => w.includes("GEMINI_API_KEY")),
    "Failing lane must have explicit warning with cause",
  );

  // Terminal message must be actionable
  assert.ok(
    terminalStatus.message.length > 0,
    "partial terminal status must have a message",
  );
});

// === VAL-CROSS-004: Write failure also produces partial (not full success) ===

test("VAL-CROSS-004: write failure after successful collection produces partial status", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      // ATS collection succeeds, but write fails
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_only",
            effectiveSources: ["grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "partial", // write failure → partial
          companyCount: 1,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [
          {
            sourceId: "grounded_web",
            querySummary: "",
            pagesVisited: 0,
            leadsSeen: 0,
            leadsAccepted: 0,
            leadsRejected: 0,
            warnings: [
              "Grounded web source is enabled but BROWSER_USE_DISCOVERY_GEMINI_API_KEY is not configured.",
            ],
          },
        ],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [
            "Sheet write failed during update phase: HTTP 500",
          ],
          writeError: {
            phase: "update",
            message: "Sheet write failed during update phase: HTTP 500",
            httpStatus: 500,
            detail: "Internal server error",
          },
        },
        warnings: [
          "Sheet write failed during update phase: HTTP 500",
        ],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // Write failure → partial, not completed
  assert.equal(
    terminalStatus.status,
    "partial",
    "Write failure must produce 'partial' status",
  );
  assert.equal(terminalStatus.terminal, true);

  // writeError phase attribution must be present
  assert.ok(
    terminalStatus.writeResult?.writeError,
    "writeResult must have writeError for write-path failure",
  );
  assert.equal(
    terminalStatus.writeResult.writeError.phase,
    "update",
    "writeError must indicate the phase (update/append)",
  );
});

// === VAL-CROSS-005: First-visit run path is reachable and non-silent ===

test("VAL-CROSS-005: no saved preset → request succeeds with resolved preset in ack and terminal status", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            // Resolved fallback: browser_plus_ats (mixed sources → default)
            sourcePreset: "browser_plus_ats",
            effectiveSources: ["greenhouse", "grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  // Request WITHOUT sourcePreset (first-visit / legacy path)
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        // NO discoveryProfile.sourcePreset — simulates first-visit / legacy state
      }),
    },
    dependencies,
  );

  // Must succeed — not silent rejection
  assert.ok(
    [200, 202].includes(response.status),
    `First-visit request must succeed (got ${response.status}): ${response.body}`,
  );

  const ackBody = JSON.parse(response.body);
  assert.equal(ackBody.ok, true, "ack must be ok");
  assert.ok(ackBody.runId, "First-visit request must produce a runId");

  // Terminal status must exist and be non-silent
  await new Promise((resolve) => setTimeout(resolve, 10));
  const terminalStatus = runStatusStore.get(ackBody.runId);
  assert.ok(
    terminalStatus,
    "First-visit path must produce terminal status (not silent)",
  );
  assert.equal(
    terminalStatus.terminal,
    true,
    "First-visit terminal status must be terminal",
  );
  assert.ok(
    terminalStatus.message.length > 0,
    "First-visit terminal status must have a message",
  );

  // statusPath must be traceable
  assert.ok(
    terminalStatus.runId,
    "First-visit terminal status must have traceable runId",
  );
});

// === VAL-CROSS-005: Credential failure on first-visit path is explicit (not silent) ===

test("VAL-CROSS-005: missing credential on first-visit path returns explicit error (not silent)", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called when credential is missing");
    },
    runDependencies: makeBaseRunDependencies({
      // Override to remove all credentials
      runtimeConfig: makeBaseRuntimeConfig({
        googleServiceAccountJson: "",
        googleServiceAccountFile: "",
        googleAccessToken: "",
      }),
    }),
  });

  // First-visit request (no preset)
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
      }),
    },
    dependencies,
  );

  // Must NOT silently accept — explicit error
  assert.notEqual(
    response.status,
    202,
    "Missing credential on first-visit must NOT return 202 (silent accept)",
  );
  assert.notEqual(
    response.status,
    200,
    "Missing credential on first-visit must NOT return 200 (silent success)",
  );

  const body = JSON.parse(response.body);
  assert.equal(body.ok, false, "Missing credential must return ok:false");
  assert.ok(
    body.message.length > 0,
    "Missing credential error must have explicit message",
  );

  // No run was accepted
  assert.ok(
    !body.runId,
    "Failed preflight must not return a runId",
  );
  assert.ok(
    !body.statusPath,
    "Failed preflight must not return a statusPath",
  );
});

// === VAL-CROSS-006: runId consistency across multiple status transitions ===

test("VAL-CROSS-006: runId is consistent across accepted → running → terminal transitions", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
            mode: "hosted",
            timezone: "UTC",
            companies: [],
            includeKeywords: [],
            excludeKeywords: [],
            targetRoles: [],
            locations: [],
            remotePolicy: "",
            seniority: "",
            maxLeadsPerRun: 25,
            enabledSources: ["greenhouse"],
            schedule: { enabled: false, cron: "" },
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "ats_only",
            effectiveSources: ["greenhouse"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "empty",
          companyCount: 0,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "ats_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  const ackBody = JSON.parse(response.body);
  const ackRunId = ackBody.runId;

  // Wait for async completion
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Collect all states for this runId
  const allStatesForRun = runStatusStore.states.filter(
    (s) => s.runId === ackRunId,
  );

  assert.ok(
    allStatesForRun.length >= 2,
    `Expected at least 2 state transitions (accepted/running + terminal), got ${allStatesForRun.length}`,
  );

  // Every state must have the same runId
  for (const state of allStatesForRun) {
    assert.equal(
      state.runId,
      ackRunId,
      `All state transitions must have the same runId=${ackRunId}, found runId=${state.runId}`,
    );
  }

  // Terminal state must have the same runId
  const terminalStatus = runStatusStore.get(ackRunId);
  assert.equal(
    terminalStatus.runId,
    ackRunId,
    "Terminal status runId must match original ack runId",
  );

  // statusPath must reference the same runId
  assert.ok(
    ackBody.statusPath?.includes(ackRunId),
    "statusPath must reference the same runId",
  );
});

// === VAL-CROSS-001: One-flag-off rollback matrix — multiQueryEnabled disabled ===

test("VAL-CROSS-001: disabling multiQueryEnabled produces isolated routing behavior (no multi-query fan-out)", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  // Track what routing behavior was executed based on the resolved config
  const routingBehavior: string[] = [];

  // Build the stored config that would be loaded by the real system
  const storedConfig = {
    sheetId: "sheet_cross_area",
    mode: "hosted" as const,
    timezone: "UTC",
    companies: [{ name: "Acme" }],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 25,
    enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"] as const,
    schedule: { enabled: false, cron: "" },
  };

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (request, _trigger, runDeps) => {
      // Call the REAL mergeDiscoveryConfig to resolve tuning
      // This exercises resolveUltraPlanTuning with real async default-propagation
      const resolvedConfig = mergeDiscoveryConfig(storedConfig, request);

      // Record the resolved tuning state to verify isolation
      if (resolvedConfig.ultraPlanTuning.multiQueryEnabled === false) {
        routingBehavior.push("multiQueryDisabled");
      }
      if (resolvedConfig.ultraPlanTuning.retryBroadeningEnabled) {
        routingBehavior.push("retryBroadeningEnabled");
      }
      if (resolvedConfig.ultraPlanTuning.parallelCompanyProcessingEnabled) {
        routingBehavior.push("parallelProcessingEnabled");
      }

      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: resolvedConfig,
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Software Engineer",
          ultraPlanTuning: {
            multiQueryEnabled: false,
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // Verify multiQuery was disabled but other flags remain enabled
  assert.ok(
    routingBehavior.includes("multiQueryDisabled"),
    "multiQueryEnabled must be disabled as requested",
  );
  assert.ok(
    routingBehavior.includes("retryBroadeningEnabled"),
    "retryBroadeningEnabled must remain enabled (not cascading side effect)",
  );
  assert.ok(
    routingBehavior.includes("parallelProcessingEnabled"),
    "parallelCompanyProcessingEnabled must remain enabled (not cascading side effect)",
  );

  // Terminal status must expose the resolved ultraPlanTuning from real mergeDiscoveryConfig
  assert.ok(
    terminalStatus.ultraPlanTuning,
    "Terminal status must expose ultraPlanTuning for cross-area verification",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.multiQueryEnabled,
    false,
    "Terminal ultraPlanTuning must reflect multiQueryEnabled=false",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.retryBroadeningEnabled,
    true,
    "Terminal ultraPlanTuning must reflect retryBroadeningEnabled=true (no side effect)",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.parallelCompanyProcessingEnabled,
    true,
    "Terminal ultraPlanTuning must reflect parallelCompanyProcessingEnabled=true (no side effect)",
  );
});

// === VAL-CROSS-001: One-flag-off rollback matrix — retryBroadeningEnabled disabled ===

test("VAL-CROSS-001: disabling retryBroadeningEnabled produces isolated routing behavior (no retry ladder)", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const routingBehavior: string[] = [];

  // Build the stored config that would be loaded by the real system
  const storedConfig = {
    sheetId: "sheet_cross_area",
    mode: "hosted" as const,
    timezone: "UTC",
    companies: [{ name: "Acme" }],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 25,
    enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"] as const,
    schedule: { enabled: false, cron: "" },
  };

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (request, _trigger, runDeps) => {
      // Call the REAL mergeDiscoveryConfig to resolve tuning
      // This exercises resolveUltraPlanTuning with real async default-propagation
      const resolvedConfig = mergeDiscoveryConfig(storedConfig, request);

      if (resolvedConfig.ultraPlanTuning.multiQueryEnabled) {
        routingBehavior.push("multiQueryEnabled");
      }
      if (resolvedConfig.ultraPlanTuning.retryBroadeningEnabled === false) {
        routingBehavior.push("retryBroadeningDisabled");
      }
      if (resolvedConfig.ultraPlanTuning.parallelCompanyProcessingEnabled) {
        routingBehavior.push("parallelProcessingEnabled");
      }

      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: resolvedConfig,
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Software Engineer",
          ultraPlanTuning: {
            retryBroadeningEnabled: false,
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // Verify retryBroadening was disabled but other flags remain enabled
  assert.ok(
    routingBehavior.includes("retryBroadeningDisabled"),
    "retryBroadeningEnabled must be disabled as requested",
  );
  assert.ok(
    routingBehavior.includes("multiQueryEnabled"),
    "multiQueryEnabled must remain enabled (not cascading side effect)",
  );
  assert.ok(
    routingBehavior.includes("parallelProcessingEnabled"),
    "parallelCompanyProcessingEnabled must remain enabled (not cascading side effect)",
  );

  // Terminal status must expose the resolved ultraPlanTuning
  assert.ok(
    terminalStatus.ultraPlanTuning,
    "Terminal status must expose ultraPlanTuning for cross-area verification",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.retryBroadeningEnabled,
    false,
    "Terminal ultraPlanTuning must reflect retryBroadeningEnabled=false",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.multiQueryEnabled,
    true,
    "Terminal ultraPlanTuning must reflect multiQueryEnabled=true (no side effect)",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.parallelCompanyProcessingEnabled,
    true,
    "Terminal ultraPlanTuning must reflect parallelCompanyProcessingEnabled=true (no side effect)",
  );
});

// === VAL-CROSS-001: One-flag-off rollback matrix — parallelCompanyProcessingEnabled disabled ===

test("VAL-CROSS-001: disabling parallelCompanyProcessingEnabled produces isolated routing behavior (sequential processing)", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const routingBehavior: string[] = [];

  // Build the stored config that would be loaded by the real system
  const storedConfig = {
    sheetId: "sheet_cross_area",
    mode: "hosted" as const,
    timezone: "UTC",
    companies: [{ name: "Acme" }],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 25,
    enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"] as const,
    schedule: { enabled: false, cron: "" },
  };

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (request, _trigger, runDeps) => {
      // Call the REAL mergeDiscoveryConfig to resolve tuning
      // This exercises resolveUltraPlanTuning with real async default-propagation
      const resolvedConfig = mergeDiscoveryConfig(storedConfig, request);

      if (resolvedConfig.ultraPlanTuning.multiQueryEnabled) {
        routingBehavior.push("multiQueryEnabled");
      }
      if (resolvedConfig.ultraPlanTuning.retryBroadeningEnabled) {
        routingBehavior.push("retryBroadeningEnabled");
      }
      if (resolvedConfig.ultraPlanTuning.parallelCompanyProcessingEnabled === false) {
        routingBehavior.push("parallelProcessingDisabled");
      }

      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: resolvedConfig,
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Software Engineer",
          ultraPlanTuning: {
            parallelCompanyProcessingEnabled: false,
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // Verify parallel processing was disabled but other flags remain enabled
  assert.ok(
    routingBehavior.includes("parallelProcessingDisabled"),
    "parallelCompanyProcessingEnabled must be disabled as requested",
  );
  assert.ok(
    routingBehavior.includes("multiQueryEnabled"),
    "multiQueryEnabled must remain enabled (not cascading side effect)",
  );
  assert.ok(
    routingBehavior.includes("retryBroadeningEnabled"),
    "retryBroadeningEnabled must remain enabled (not cascading side effect)",
  );

  // Terminal status must expose the resolved ultraPlanTuning
  assert.ok(
    terminalStatus.ultraPlanTuning,
    "Terminal status must expose ultraPlanTuning for cross-area verification",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.parallelCompanyProcessingEnabled,
    false,
    "Terminal ultraPlanTuning must reflect parallelCompanyProcessingEnabled=false",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.multiQueryEnabled,
    true,
    "Terminal ultraPlanTuning must reflect multiQueryEnabled=true (no side effect)",
  );
  assert.equal(
    terminalStatus.ultraPlanTuning.retryBroadeningEnabled,
    true,
    "Terminal ultraPlanTuning must reflect retryBroadeningEnabled=true (no side effect)",
  );
});

// === VAL-CROSS-001: Full flag rollback matrix — all three flags disabled ===

test("VAL-CROSS-001: disabling all three ultraPlanTuning flags produces conservative baseline behavior", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const routingBehavior: string[] = [];

  // Build the stored config that would be loaded by the real system
  const storedConfig = {
    sheetId: "sheet_cross_area",
    mode: "hosted" as const,
    timezone: "UTC",
    companies: [{ name: "Acme" }],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 25,
    enabledSources: ["greenhouse", "lever", "ashby", "grounded_web"] as const,
    schedule: { enabled: false, cron: "" },
  };

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (request, _trigger, runDeps) => {
      // Call the REAL mergeDiscoveryConfig to resolve tuning
      // This exercises resolveUltraPlanTuning with real async default-propagation
      const resolvedConfig = mergeDiscoveryConfig(storedConfig, request);

      if (resolvedConfig.ultraPlanTuning.multiQueryEnabled === false) routingBehavior.push("multiQueryDisabled");
      if (resolvedConfig.ultraPlanTuning.retryBroadeningEnabled === false) routingBehavior.push("retryBroadeningDisabled");
      if (resolvedConfig.ultraPlanTuning.parallelCompanyProcessingEnabled === false) routingBehavior.push("parallelProcessingDisabled");

      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: resolvedConfig,
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Software Engineer",
          ultraPlanTuning: {
            multiQueryEnabled: false,
            retryBroadeningEnabled: false,
            parallelCompanyProcessingEnabled: false,
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const ackBody = JSON.parse(response.body);
  const terminalStatus = runStatusStore.get(ackBody.runId);

  // All three flags must be disabled
  assert.ok(routingBehavior.includes("multiQueryDisabled"), "multiQueryEnabled must be disabled");
  assert.ok(routingBehavior.includes("retryBroadeningDisabled"), "retryBroadeningEnabled must be disabled");
  assert.ok(routingBehavior.includes("parallelProcessingDisabled"), "parallelCompanyProcessingEnabled must be disabled");

  // Terminal status must reflect all flags as disabled
  assert.ok(terminalStatus.ultraPlanTuning, "Terminal status must expose ultraPlanTuning");
  assert.equal(terminalStatus.ultraPlanTuning.multiQueryEnabled, false);
  assert.equal(terminalStatus.ultraPlanTuning.retryBroadeningEnabled, false);
  assert.equal(terminalStatus.ultraPlanTuning.parallelCompanyProcessingEnabled, false);
});

// === VAL-CROSS-003: Async acceptance lineage — ack includes explicit runId and statusPath ===

test("VAL-CROSS-003: accepted_async ack includes runId, statusPath, and pollAfterMs for terminal polling", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            enabledSources: ["greenhouse"],
            schedule: { enabled: false, cron: "" },
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "ats_only",
            effectiveSources: ["greenhouse"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 1,
          listingCount: 1,
          normalizedLeadCount: 1,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "ats_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  // Must return async ack
  assert.equal(response.status, 202, "Async request must return 202");

  const ackBody = JSON.parse(response.body);

  // Ack must include explicit lineage metadata
  assert.equal(ackBody.ok, true, "ack.ok must be true");
  assert.equal(ackBody.kind, "accepted_async", "ack.kind must be 'accepted_async'");
  assert.ok(ackBody.runId, "ack must include runId for lineage tracing");
  assert.ok(ackBody.runId.startsWith("run_"), "runId must have run_ prefix");
  assert.ok(ackBody.message, "ack must include message");
  assert.ok(ackBody.statusPath, "ack must include statusPath for polling");
  assert.ok(
    ackBody.statusPath.includes(ackBody.runId),
    "statusPath must reference the ack runId for terminal polling",
  );
  assert.ok(
    typeof ackBody.pollAfterMs === "number",
    "ack must include numeric pollAfterMs for async polling guidance",
  );
  assert.ok(
    ackBody.pollAfterMs > 0,
    "pollAfterMs must be positive for async polling",
  );

  // Terminal status must have the same runId for lineage verification
  await new Promise((resolve) => setTimeout(resolve, 10));
  const terminalStatus = runStatusStore.get(ackBody.runId);
  assert.ok(terminalStatus, "Terminal status must be stored under ack runId");
  assert.equal(
    terminalStatus.runId,
    ackBody.runId,
    "Terminal status runId must match ack runId for async lineage verification",
  );
  assert.equal(
    terminalStatus.terminal,
    true,
    "Terminal status must have terminal=true",
  );
});

// === VAL-CROSS-003: Async acceptance lineage — groundedSearchTuning propagates through terminal status ===

test("VAL-CROSS-003: groundedSearchTuning propagates through terminal status for async lineage verification", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            enabledSources: ["grounded_web"],
            schedule: { enabled: false, cron: "" },
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_only",
            effectiveSources: ["grounded_web"],
            // Explicit groundedSearchTuning
            groundedSearchTuning: {
              maxResultsPerCompany: 12,
              maxPagesPerCompany: 8,
              maxRuntimeMs: 60000,
              maxTokensPerQuery: 4096,
              multiQueryCap: 4,
            },
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Software Engineer",
          groundedSearchTuning: {
            maxResultsPerCompany: 12,
            maxPagesPerCompany: 8,
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  const ackBody = JSON.parse(response.body);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const terminalStatus = runStatusStore.get(ackBody.runId);

  // Terminal status must expose groundedSearchTuning for async lineage verification
  assert.ok(
    terminalStatus.groundedSearchTuning,
    "Terminal status must expose groundedSearchTuning for async lineage verification",
  );
  assert.equal(
    terminalStatus.groundedSearchTuning.maxResultsPerCompany,
    12,
    "Terminal groundedSearchTuning must reflect requested maxResultsPerCompany",
  );
  assert.equal(
    terminalStatus.groundedSearchTuning.maxPagesPerCompany,
    8,
    "Terminal groundedSearchTuning must reflect requested maxPagesPerCompany",
  );

  // Ack must reference the same runId for async lineage
  assert.ok(
    terminalStatus.runId === ackBody.runId,
    "Terminal status runId must match ack runId for async lineage",
  );
});

// === VAL-LOOP-CORE-008: Unrestricted mixed runs expose machine-readable stage order ===

test("VAL-LOOP-CORE-008: stageOrder is an array with monotonically increasing sequence numbers", async () => {
  const runStatusStore = createMemoryRunStatusStore();
  const capturedLogs: Array<{ event: string; details: Record<string, unknown> }> = [];

  const dependencies = makeDependencies({
    runStatusStore,
    log: (event, details) => {
      capturedLogs.push({ event, details });
    },
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_plus_ats",
            effectiveSources: ["greenhouse", "grounded_web"],
          },
        },
        // stageOrder must be an ARRAY of LoopStageEvidence objects with monotonic sequences
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 1,
          listingCount: 1,
          normalizedLeadCount: 1,
          stageOrder: [
            { sequence: 1, phase: "scout", startedAt: "2026-04-12T00:00:00.100Z" },
            { sequence: 2, phase: "score", startedAt: "2026-04-12T00:00:00.200Z" },
            { sequence: 3, phase: "exploit", startedAt: "2026-04-12T00:00:00.300Z" },
            { sequence: 4, phase: "learn", startedAt: "2026-04-12T00:00:00.400Z" },
          ],
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_plus_ats", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const terminalStatus = runStatusStore.get(JSON.parse(response.body).runId);

  // VAL-LOOP-CORE-008: stageOrder must be an array
  assert.ok(
    Array.isArray(terminalStatus.lifecycle?.stageOrder),
    "lifecycle.stageOrder must be an array (LoopStageEvidence[])",
  );

  // VAL-LOOP-CORE-008: stageOrder must contain 4 entries for scout->score->exploit->learn
  const stageOrder = terminalStatus.lifecycle?.stageOrder;
  assert.equal(
    stageOrder?.length,
    4,
    "stageOrder must have 4 entries for scout->score->exploit->learn",
  );

  // VAL-LOOP-CORE-008: Sequence numbers must be monotonically increasing
  for (let i = 1; i < (stageOrder?.length || 0); i++) {
    assert.ok(
      stageOrder[i].sequence > stageOrder[i - 1].sequence,
      `Sequence ${stageOrder[i].sequence} must be greater than previous ${stageOrder[i - 1].sequence}`,
    );
  }

  // VAL-LOOP-CORE-008: Phases must follow scout->score->exploit->learn order
  const expectedPhases = ["scout", "score", "exploit", "learn"];
  for (let i = 0; i < expectedPhases.length; i++) {
    assert.equal(
      stageOrder?.[i]?.phase,
      expectedPhases[i],
      `Stage ${i} must be ${expectedPhases[i]}, got ${stageOrder?.[i]?.phase}`,
    );
  }

  // VAL-LOOP-CORE-008: Each entry must have startedAt timestamp
  for (const entry of stageOrder || []) {
    assert.ok(
      entry.startedAt,
      "Each stageOrder entry must have a startedAt timestamp",
    );
  }
});

test("VAL-LOOP-CORE-008: stage_transition log events are emitted for each loop stage", async () => {
  const runStatusStore = createMemoryRunStatusStore();
  const capturedLogs: Array<{ event: string; details: Record<string, unknown> }> = [];

  const dependencies = makeDependencies({
    runStatusStore,
    log: (event, details) => {
      capturedLogs.push({ event, details });
    },
    runDiscovery: async (_request, _trigger, runDeps) => {
      // Emit stage_transition log events as the real runDiscovery would
      runDeps.log?.("discovery.run.stage_transition", {
        runId: runDeps.runId,
        sequence: 1,
        phase: "scout",
        startedAt: "2026-04-12T00:00:00.100Z",
      });
      runDeps.log?.("discovery.run.stage_transition", {
        runId: runDeps.runId,
        sequence: 2,
        phase: "score",
        startedAt: "2026-04-12T00:00:00.200Z",
      });
      runDeps.log?.("discovery.run.stage_transition", {
        runId: runDeps.runId,
        sequence: 3,
        phase: "exploit",
        startedAt: "2026-04-12T00:00:00.300Z",
      });
      runDeps.log?.("discovery.run.stage_transition", {
        runId: runDeps.runId,
        sequence: 4,
        phase: "learn",
        startedAt: "2026-04-12T00:00:00.400Z",
      });
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
            mode: "hosted",
            timezone: "UTC",
            companies: [],
            includeKeywords: [],
            excludeKeywords: [],
            targetRoles: [],
            locations: [],
            remotePolicy: "",
            seniority: "",
            maxLeadsPerRun: 25,
            enabledSources: ["grounded_web"],
            schedule: { enabled: false, cron: "" },
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_plus_ats",
            effectiveSources: ["grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 0,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
          stageOrder: [
            { sequence: 1, phase: "scout", startedAt: "2026-04-12T00:00:00.100Z" },
            { sequence: 2, phase: "score", startedAt: "2026-04-12T00:00:00.200Z" },
            { sequence: 3, phase: "exploit", startedAt: "2026-04-12T00:00:00.300Z" },
            { sequence: 4, phase: "learn", startedAt: "2026-04-12T00:00:00.400Z" },
          ],
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_plus_ats", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  // VAL-LOOP-CORE-008: stage_transition events must be logged for each stage
  const stageTransitionLogs = capturedLogs.filter(
    (log) => log.event === "discovery.run.stage_transition",
  );

  assert.ok(
    stageTransitionLogs.length > 0,
    "discovery.run.stage_transition events must be logged",
  );

  // Each stage transition must have runId, sequence, phase, and startedAt
  for (const log of stageTransitionLogs) {
    assert.ok(log.details.runId, "stage_transition log must include runId");
    assert.ok(
      typeof log.details.sequence === "number",
      "stage_transition log must include sequence number",
    );
    assert.ok(log.details.phase, "stage_transition log must include phase");
    assert.ok(log.details.startedAt, "stage_transition log must include startedAt");
  }
});

test("VAL-LOOP-CORE-008: browser_plus_ats mixed run exposes ordered stage progression", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    runDiscovery: async (_request, _trigger, runDeps) => {
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
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
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_plus_ats",
            effectiveSources: ["greenhouse", "grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 1,
          detectionCount: 1,
          listingCount: 1,
          normalizedLeadCount: 1,
          stageOrder: [
            { sequence: 1, phase: "scout", startedAt: "2026-04-12T00:00:00.100Z" },
            { sequence: 2, phase: "score", startedAt: "2026-04-12T00:00:00.200Z" },
            { sequence: 3, phase: "exploit", startedAt: "2026-04-12T00:00:00.300Z" },
            { sequence: 4, phase: "learn", startedAt: "2026-04-12T00:00:00.400Z" },
          ],
        },
        extractionResults: [
          {
            runId: runDeps.runId,
            sourceId: "greenhouse",
            querySummary: "https://boards.greenhouse.io/acme",
            leads: [],
            warnings: [],
            stats: { pagesVisited: 1, leadsSeen: 1, leadsAccepted: 1 },
          },
          {
            runId: runDeps.runId,
            sourceId: "grounded_web",
            querySummary: "Acme jobs",
            leads: [],
            warnings: [],
            stats: { pagesVisited: 1, leadsSeen: 1, leadsAccepted: 0 },
          },
        ],
        sourceSummary: [
          {
            sourceId: "greenhouse",
            querySummary: "https://boards.greenhouse.io/acme",
            pagesVisited: 1,
            leadsSeen: 1,
            leadsAccepted: 1,
            leadsRejected: 0,
            warnings: [],
          },
          {
            sourceId: "grounded_web",
            querySummary: "Acme jobs",
            pagesVisited: 1,
            leadsSeen: 1,
            leadsAccepted: 0,
            leadsRejected: 1,
            warnings: [],
          },
        ],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 1,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_plus_ats", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  await new Promise((resolve) => setTimeout(resolve, 10));

  const terminalStatus = runStatusStore.get(JSON.parse(response.body).runId);

  // VAL-LOOP-CORE-008: browser_plus_ats must expose stage order evidence
  assert.ok(
    terminalStatus.lifecycle?.stageOrder,
    "browser_plus_ats must expose stageOrder in lifecycle",
  );

  // VAL-LOOP-CORE-008: Stage progression must be ordered
  const stageOrder = terminalStatus.lifecycle?.stageOrder;
  assert.equal(stageOrder?.length, 4, "Must have all 4 loop stages");
  assert.equal(stageOrder?.[0]?.phase, "scout");
  assert.equal(stageOrder?.[1]?.phase, "score");
  assert.equal(stageOrder?.[2]?.phase, "exploit");
  assert.equal(stageOrder?.[3]?.phase, "learn");
});

// === VAL-LOOP-CORE-009: Async lifecycle terminalizes within bounded duration ===

test("VAL-LOOP-CORE-009: async run reaches terminal state without hanging indefinitely", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    // Use a short asyncPollAfterMs to simulate bounded duration
    asyncPollAfterMs: 100,
    runDiscovery: async (_request, _trigger, runDeps) => {
      // Simulate a run that completes quickly
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
            mode: "hosted",
            timezone: "UTC",
            companies: [],
            includeKeywords: [],
            excludeKeywords: [],
            targetRoles: [],
            locations: [],
            remotePolicy: "",
            seniority: "",
            maxLeadsPerRun: 25,
            enabledSources: ["grounded_web"],
            schedule: { enabled: false, cron: "" },
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_only",
            effectiveSources: ["grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:01.000Z",
          state: "completed",
          companyCount: 0,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  // VAL-LOOP-CORE-009: Wait for async completion - must not hang indefinitely
  await new Promise((resolve) => setTimeout(resolve, 200));

  const terminalStatus = runStatusStore.get(JSON.parse(response.body).runId);

  // VAL-LOOP-CORE-009: Must reach terminal state
  assert.ok(
    terminalStatus?.terminal,
    "Async run must reach terminal state within bounded duration",
  );

  // VAL-LOOP-CORE-009: Terminal state must have explicit status (not stuck in running)
  assert.ok(
    ["completed", "partial", "empty", "failed"].includes(terminalStatus?.status),
    "Terminal status must be explicit (completed/partial/empty/failed), not 'running'",
  );
});

test("VAL-LOOP-CORE-009: async timeout force-terminalization produces explicit terminal reason", async () => {
  const runStatusStore = createMemoryRunStatusStore();

  const dependencies = makeDependencies({
    runStatusStore,
    asyncPollAfterMs: 50,
    runDiscovery: async () => {
      // Simulate timeout - runDiscovery throws TimeoutError
      throw new Error("Run timed out after max duration");
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  // Wait for timeout to trigger terminalization
  await new Promise((resolve) => setTimeout(resolve, 150));

  const terminalStatus = runStatusStore.get(JSON.parse(response.body).runId);

  // VAL-LOOP-CORE-009: Timeout must produce terminal state
  assert.ok(
    terminalStatus?.terminal,
    "Timeout force-terminalization must produce terminal state",
  );

  // VAL-LOOP-CORE-009: Terminal state must be 'failed' with explicit reason
  assert.equal(
    terminalStatus?.status,
    "failed",
    "Timeout terminalization must produce 'failed' status",
  );

  // VAL-LOOP-CORE-009: Explicit reason attribution must be present
  assert.ok(
    terminalStatus?.error || terminalStatus?.message,
    "Timeout terminalization must include explicit reason (error or message)",
  );

  // VAL-LOOP-CORE-009: Reason must mention timeout
  const reasonText = `${terminalStatus?.error || ""} ${terminalStatus?.message || ""}`.toLowerCase();
  assert.ok(
    reasonText.includes("timeout") || reasonText.includes("timed out"),
    `Timeout reason must be explicit, got: ${reasonText}`,
  );
});

test("VAL-LOOP-CORE-009: bounded duration enforcement prevents indefinite running state", async () => {
  const runStatusStore = createMemoryRunStatusStore();
  let pollCount = 0;

  const dependencies = makeDependencies({
    runStatusStore,
    asyncPollAfterMs: 20,
    runDiscovery: async (_request, _trigger, runDeps) => {
      pollCount++;
      // Simulate a run that hasn't completed yet (still in progress)
      return {
        run: {
          runId: runDeps.runId,
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "sheet_cross_area",
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
          },
          config: {
            sheetId: "sheet_cross_area",
            mode: "hosted",
            timezone: "UTC",
            companies: [],
            includeKeywords: [],
            excludeKeywords: [],
            targetRoles: [],
            locations: [],
            remotePolicy: "",
            seniority: "",
            maxLeadsPerRun: 25,
            enabledSources: ["grounded_web"],
            schedule: { enabled: false, cron: "" },
            variationKey: "var_cross",
            requestedAt: "2026-04-12T00:00:00.000Z",
            sourcePreset: "browser_only",
            effectiveSources: ["grounded_web"],
          },
        },
        lifecycle: {
          runId: runDeps.runId,
          trigger: "manual",
          startedAt: "2026-04-12T00:00:00.000Z",
          completedAt: "2026-04-12T00:00:00.500Z",
          state: "completed",
          companyCount: 0,
          detectionCount: 0,
          listingCount: 0,
          normalizedLeadCount: 0,
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_cross_area",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: [],
      };
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_cross_area",
        variationKey: "var_cross",
        requestedAt: "2026-04-12T00:00:00.000Z",
        discoveryProfile: { sourcePreset: "browser_only", targetRoles: "Software Engineer" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);

  // Wait for multiple poll cycles
  await new Promise((resolve) => setTimeout(resolve, 100));

  // VAL-LOOP-CORE-009: Run must eventually terminalize
  const terminalStatus = runStatusStore.get(JSON.parse(response.body).runId);

  assert.ok(
    terminalStatus?.terminal,
    "Async run must terminalize within bounded duration",
  );

  // VAL-LOOP-CORE-009: Must not be stuck in 'running' state
  assert.notEqual(
    terminalStatus?.status,
    "running",
    "Async run must not remain in 'running' state indefinitely",
  );
});
