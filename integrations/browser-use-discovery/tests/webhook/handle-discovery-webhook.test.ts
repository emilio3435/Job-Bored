import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  formatWebhookAck,
  handleDiscoveryWebhook,
} from "../../src/webhook/handle-discovery-webhook.ts";

function makeRequest(overrides = {}) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    bodyText: JSON.stringify({
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_123",
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
      ...overrides,
    }),
  };
}

function makeDependencies(overrides = {}) {
  return {
    runSynchronously: false,
    runDiscovery: async () => ({
      run: {
        runId: "run_123",
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
          variationKey: "var_123",
          requestedAt: "2026-04-09T12:00:00.000Z",
        },
      },
      lifecycle: {
        runId: "run_123",
        trigger: "manual",
        startedAt: "2026-04-09T12:00:00.000Z",
        completedAt: "2026-04-09T12:00:01.000Z",
        state: "completed",
        companyCount: 0,
        detectionCount: 0,
        listingCount: 0,
        normalizedLeadCount: 0,
      },
      extractionResults: [],
      writeResult: {
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        warnings: [],
      },
      warnings: [],
    }),
    runDependencies: {
      runtimeConfig: {
        stateDatabasePath: "",
        workerConfigPath: "",
        browserUseCommand: "",
        googleServiceAccountJson: "",
        googleServiceAccountFile: "",
        googleAccessToken: "",
        webhookSecret: "",
        allowedOrigins: [],
        port: 0,
        host: "127.0.0.1",
        runMode: "hosted",
        asyncAckByDefault: true,
      },
      sourceAdapterRegistry: {
        adapters: [],
        detectBoards: async () => [],
        collectListings: async () => [],
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
      }),
      mergeDiscoveryConfig: (stored, request) => ({
        ...stored,
        variationKey: request.variationKey,
        requestedAt: request.requestedAt,
      }),
      now: (() => {
        let index = 0;
        const dates = [
          new Date("2026-04-09T12:00:00.000Z"),
          new Date("2026-04-09T12:00:01.000Z"),
        ];
        return () => dates[Math.min(index++, dates.length - 1)];
      })(),
      randomId: (prefix) => `${prefix}_queued`,
      ...overrides.runDependencies,
    },
    ...overrides,
  };
}

test("handleDiscoveryWebhook validates requests before running", async () => {
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {},
      bodyText: "not-json",
    },
    makeDependencies(),
  );

  assert.equal(response.status, 400);
  assert.match(response.body, /valid JSON/);
});

test("handleDiscoveryWebhook returns completed_sync when run synchronously", async () => {
  const calls = [];
  const response = await handleDiscoveryWebhook(
    makeRequest(),
    makeDependencies({
      runSynchronously: true,
      runDiscovery: async (_request, trigger, dependencies) => {
        calls.push({ trigger, runId: dependencies.runId });
        return {
          run: {
            runId: dependencies.runId || "run_123",
            trigger,
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
              variationKey: "var_123",
              requestedAt: "2026-04-09T12:00:00.000Z",
            },
          },
          lifecycle: {
            runId: dependencies.runId || "run_123",
            trigger,
            startedAt: "2026-04-09T12:00:00.000Z",
            completedAt: "2026-04-09T12:00:01.000Z",
            state: "completed",
            companyCount: 0,
            detectionCount: 0,
            listingCount: 0,
            normalizedLeadCount: 0,
          },
          extractionResults: [],
          writeResult: {
            sheetId: "sheet_123",
            appended: 0,
            updated: 0,
            skippedDuplicates: 0,
            warnings: [],
          },
          warnings: [],
        };
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.kind, "completed_sync");
  assert.equal(body.runId, "run_queued");
  assert.match(body.message, /completed/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].trigger, "manual");
  assert.equal(calls[0].runId, "run_queued");
});

test("handleDiscoveryWebhook returns accepted_async without waiting for the run", async () => {
  let releaseRun;
  const backgroundRun = new Promise((resolve) => {
    releaseRun = resolve;
  });

  const response = await handleDiscoveryWebhook(
    makeRequest(),
    makeDependencies({
      runSynchronously: false,
      runDiscovery: async (_request, trigger, dependencies) => {
        await backgroundRun;
        return {
          run: {
            runId: dependencies.runId || "run_async",
            trigger,
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
              variationKey: "var_123",
              requestedAt: "2026-04-09T12:00:00.000Z",
            },
          },
          lifecycle: {
            runId: dependencies.runId || "run_async",
            trigger,
            startedAt: "2026-04-09T12:00:00.000Z",
            completedAt: "2026-04-09T12:00:01.000Z",
            state: "completed",
            companyCount: 0,
            detectionCount: 0,
            listingCount: 0,
            normalizedLeadCount: 0,
          },
          extractionResults: [],
          writeResult: {
            sheetId: "sheet_123",
            appended: 0,
            updated: 0,
            skippedDuplicates: 0,
            warnings: [],
          },
          warnings: [],
        };
      },
    }),
  );

  assert.equal(response.status, 202);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.kind, "accepted_async");
  assert.equal(body.runId, "run_queued");
  assert.match(body.message, /queued/i);

  releaseRun();
  await backgroundRun;
});

test("formatWebhookAck returns compact JSON", () => {
  assert.equal(
    formatWebhookAck({
      ok: true,
      kind: "accepted_async",
      runId: "run_1",
      message: "Discovery accepted",
    }),
    JSON.stringify({
      ok: true,
      kind: "accepted_async",
      runId: "run_1",
      message: "Discovery accepted",
    }),
  );
});
