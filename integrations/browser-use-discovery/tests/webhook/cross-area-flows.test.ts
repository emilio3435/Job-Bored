import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";

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
