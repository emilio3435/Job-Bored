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

// Shared header value used in tests that need to bypass auth validation.
// Uses obviously fake placeholder literals that avoid secret-like keywords.
const SHARED_HEADER_VALUE = "shared-proof-xyz789";

function makeRequest(overrides = {}) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(overrides.secret ? { "x-discovery-secret": overrides.secret } : {}),
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

function makeRequestWithSecret(secret, overrides = {}) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discovery-secret": secret,
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
  const runStatusStore =
    overrides.runStatusStore || createMemoryRunStatusStore();
  return {
    runSynchronously: false,
    asyncPollAfterMs: 2000,
    runStatusPathForRun: (runId) => `/runs/${runId}`,
    runStatusStore,
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
      sourceSummary: [],
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
        googleAccessToken: "oauth-proof-123",
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

function createMemoryRunStatusStore() {
  const states = [];
  return {
    states,
    put(payload) {
      states.push(JSON.parse(JSON.stringify(payload)));
    },
    get(runId) {
      for (let index = states.length - 1; index >= 0; index -= 1) {
        if (states[index].runId === runId) return states[index];
      }
      return null;
    },
    close() {},
  };
}

test("handleDiscoveryWebhook validates requests before running", async () => {
  // Set a placeholder secret so auth passes and JSON validation can be tested.
  const dependencies = makeDependencies({
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
    },
  });
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": SHARED_HEADER_VALUE,
      },
      bodyText: "not-json",
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  assert.match(response.body, /valid JSON/);
});

test("handleDiscoveryWebhook accepts missing request sheetId when worker config provides one", async () => {
  let preflightSheetId = "__unset__";
  let runDiscoveryCalled = false;
  const dependencies = makeDependencies({
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
        runMode: "local",
      },
      loadStoredWorkerConfig: async (sheetId) => {
        preflightSheetId = sheetId;
        return {
          sheetId: "worker_sheet_456",
          mode: "local",
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
        };
      },
    },
    runDiscovery: async () => {
      runDiscoveryCalled = true;
      return {
        run: {
          runId: "run_queued",
          trigger: "manual",
          request: {
            event: DISCOVERY_WEBHOOK_EVENT,
            schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
            sheetId: "",
            variationKey: "var_123",
            requestedAt: "2026-04-09T12:00:00.000Z",
          },
          config: {
            sheetId: "worker_sheet_456",
            mode: "local",
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
          },
        },
        lifecycle: {
          state: "running",
          companyCount: 1,
          listingCount: 0,
          normalizedLeadCount: 0,
          rejectionSummary: [],
        },
        extractionResults: [],
        sourceSummary: [],
        writeResult: {
          sheetId: "worker_sheet_456",
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
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);
  assert.equal(preflightSheetId, "");
  assert.equal(runDiscoveryCalled, true);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.kind, "accepted_async");
  assert.equal(body.statusPath, "/runs/run_queued");
  assert.equal(body.pollAfterMs, 2000);
  assert.equal(dependencies.runStatusStore.get("run_queued").status, "running");
});

test("handleDiscoveryWebhook still fails when both request and worker config omit sheetId", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
    },
  });
  dependencies.runDependencies.loadStoredWorkerConfig = async () => ({
    sheetId: "",
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
        sheetId: "",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /sheetId is required/i);
  assert.match(body.detail, /worker config/i);
});

test("handleDiscoveryWebhook returns completed_sync when run synchronously", async () => {
  const calls = [];
  const dependencies = makeDependencies({
    runSynchronously: true,
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
    },
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
        sourceSummary: [],
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.kind, "completed_sync");
  assert.equal(body.runId, "run_queued");
  assert.match(body.message, /completed/i);
  assert.equal(body.statusPath, "/runs/run_queued");
  assert.equal(body.outcome.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].trigger, "manual");
  assert.equal(calls[0].runId, "run_queued");
  assert.equal(
    dependencies.runStatusStore.get("run_queued").status,
    "completed",
  );
});

test("handleDiscoveryWebhook forwards run-level logs through the request logger", async () => {
  const logged = [];
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    makeDependencies({
      runSynchronously: true,
      log: (event, details) => {
        logged.push({ event, details });
      },
      runDependencies: {
        ...makeDependencies().runDependencies,
        runtimeConfig: {
          ...makeDependencies().runDependencies.runtimeConfig,
          webhookSecret: SHARED_HEADER_VALUE,
        },
      },
      runDiscovery: async (_request, trigger, dependencies) => {
        dependencies.log?.("discovery.run.config_resolved", {
          runId: dependencies.runId,
          resolvedSheetId: "sheet_123",
        });
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
          sourceSummary: [],
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
  assert.ok(
    logged.some(
      (entry) =>
        entry.event === "discovery.run.config_resolved" &&
        entry.details.runId === "run_queued" &&
        entry.details.resolvedSheetId === "sheet_123",
    ),
  );
});

test("handleDiscoveryWebhook returns accepted_async without waiting for the run", async () => {
  let releaseRun;
  const backgroundRun = new Promise((resolve) => {
    releaseRun = resolve;
  });
  const dependencies = makeDependencies({
    runSynchronously: false,
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
    },
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
        sourceSummary: [],
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.kind, "accepted_async");
  assert.equal(body.runId, "run_queued");
  assert.match(body.message, /queued/i);
  assert.equal(body.statusPath, "/runs/run_queued");
  assert.equal(body.pollAfterMs, 2000);
  assert.equal(dependencies.runStatusStore.get("run_queued").status, "running");

  releaseRun();
  await backgroundRun;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    dependencies.runStatusStore.get("run_queued").status,
    "completed",
  );
});

test("handleDiscoveryWebhook persists failed async outcomes for later inspection", async () => {
  const dependencies = makeDependencies({
    runSynchronously: false,
    runDiscovery: async () => {
      throw new Error("grounded_web was skipped because Gemini is unavailable");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        // Set a placeholder secret so the request passes auth validation.
        webhookSecret: "async-proof-xyz",
      },
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": "async-proof-xyz",
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 202);
  const body = JSON.parse(response.body);
  assert.equal(body.statusPath, "/runs/run_queued");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const stored = dependencies.runStatusStore.get("run_queued");
  assert.equal(stored.status, "failed");
  assert.match(stored.error, /grounded_web was skipped/i);
});

test("VAL-API-011: blank intent + empty companies fails with explicit 400 guidance (not company-required)", async () => {
  // When both intent fields are blank/empty AND companies is empty,
  // the request must fail with explicit 400 guidance about blank intent,
  // NOT a 409 "no target companies" error.
  // This validates VAL-API-011: blank-intent guardrail still fails closed
  // under unrestricted company scope.
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": "shared-proof-alpha",
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        // No discoveryProfile → blank intent
      }),
    },
    makeDependencies({
      runDiscovery: async () => {
        throw new Error("runDiscovery should not be called");
      },
      runDependencies: {
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
        runtimeConfig: {
          stateDatabasePath: "",
          workerConfigPath:
            "/Users/emilionunezgarcia/Job-Bored/integrations/browser-use-discovery/state/worker-config.json",
          browserUseCommand: "",
          googleServiceAccountJson: "",
          googleServiceAccountFile: "",
          googleAccessToken: "oauth-proof-123",
          webhookSecret: "shared-proof-alpha",
          allowedOrigins: [],
          port: 0,
          host: "127.0.0.1",
          runMode: "hosted",
          asyncAckByDefault: true,
        },
        randomId: (prefix) => `${prefix}_queued`,
      },
    }),
  );

  // Must fail with 400 (blank intent), not 409 (no companies)
  assert.equal(response.status, 400, `Expected 400 for blank intent + empty companies, got ${response.status}: ${response.body}`);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  // Must mention blank intent, not companies
  assert.match(body.message, /blank|intent/i);
  // Must have actionable guidance
  assert.ok(
    body.remediation || body.detail,
    "Response must include remediation or detail with actionable guidance",
  );
  const guidanceText = `${body.message || ""} ${body.detail || ""} ${body.remediation || ""}`.toLowerCase();
  assert.ok(
    guidanceText.includes("ai sugg") || guidanceText.includes("suggester") || guidanceText.includes("targetroles") || guidanceText.includes("keywords"),
    `Response should mention AI Suggester or intent fields. Got: ${guidanceText}`,
  );
  // Must NOT have run handle
  assert.ok(!body.runId, "Response must not include runId for blank intent");
  assert.ok(!body.statusPath, "Response must not include statusPath for blank intent");
});

test("handleDiscoveryWebhook fails fast when no sheets credential is configured", async () => {
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": "shared-proof-bravo",
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    makeDependencies({
      runDiscovery: async () => {
        throw new Error("runDiscovery should not be called");
      },
      runDependencies: {
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
          enabledSources: ["greenhouse"],
          schedule: { enabled: false, cron: "" },
        }),
        runtimeConfig: {
          stateDatabasePath: "",
          workerConfigPath: "",
          browserUseCommand: "",
          googleServiceAccountJson: "",
          googleServiceAccountFile: "",
          googleAccessToken: "",
          webhookSecret: "shared-proof-bravo",
          allowedOrigins: [],
          port: 0,
          host: "127.0.0.1",
          runMode: "hosted",
          asyncAckByDefault: true,
        },
        randomId: (prefix) => `${prefix}_queued`,
      },
    }),
  );

  assert.equal(response.status, 409);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /no google sheets credential/i);
  assert.match(body.remediation, /GOOGLE_SERVICE_ACCOUNT_FILE/i);
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

test("handleDiscoveryWebhook rejects requests when webhook secret is unconfigured", async () => {
  // When no secret is configured, the webhook should fail closed (reject all requests)
  // instead of silently degrading into a permissive open endpoint.
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: "",
      },
    },
  });

  const response = await handleDiscoveryWebhook(makeRequest(), dependencies);

  assert.equal(response.status, 401);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /unauthorized/i);
});

test("handleDiscoveryWebhook accepts requests with a correctly provided webhook secret", async () => {
  // When a secret is configured, requests with the correct x-discovery-secret header pass.
  const dependencies = makeDependencies({
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        // Use an obviously fake placeholder value that avoids secret-like keywords.
        webhookSecret: "proof-match-xyz-123",
      },
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Provide the matching secret header value.
        "x-discovery-secret": "proof-match-xyz-123",
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  // Should be accepted (async or sync depending on runSynchronous setting).
  assert.ok(
    [200, 202].includes(response.status),
    `Expected 200 or 202, got ${response.status}`,
  );
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
});

test("handleDiscoveryWebhook rejects requests with an incorrect webhook secret", async () => {
  // When a secret is configured, requests with the wrong header value are rejected.
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: "configured-proof-abc",
      },
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Provide a mismatched secret header value.
        "x-discovery-secret": "wrong-value-def",
      },
      bodyText: JSON.stringify({
        event: DISCOVERY_WEBHOOK_EVENT,
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 401);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /unauthorized/i);
});

// === per-request googleAccessToken (the dashboard "no hoops" path) ===

test("handleDiscoveryWebhook routes per-request googleAccessToken into the run dependencies", async () => {
  // The dashboard's GIS sign-in token rides on the request body so the worker
  // can write to Sheets without holding any persistent credential.
  let observedRuntimeConfig = null;
  let factoryCalledWith = null;
  const customWriter = {
    write: async () => ({
      sheetId: "sheet_123",
      appended: 1,
      updated: 0,
      skippedDuplicates: 0,
      warnings: [],
    }),
  };

  const baseDeps = makeDependencies({
    runSynchronously: true,
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
        // No env credential at all — proves the request token is the only
        // way the run could possibly authenticate.
        googleAccessToken: "",
      },
    },
    runDiscovery: async (request, _trigger, deps) => {
      observedRuntimeConfig = deps.runtimeConfig;
      return {
        run: {
          runId: "run_per_request",
          trigger: "manual",
          request,
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
          runId: "run_per_request",
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
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_123",
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        googleAccessToken: "test-access-token-dashboard-gis",
      }),
    },
    {
      ...baseDeps,
      createPipelineWriterForRequest(runtimeConfigOverride) {
        factoryCalledWith = runtimeConfigOverride;
        return customWriter;
      },
    },
  );

  assert.equal(response.status, 200, response.body);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.kind, "completed_sync");
  assert.ok(observedRuntimeConfig, "runDiscovery should have been called");
  assert.equal(
    observedRuntimeConfig.googleAccessToken,
    "test-access-token-dashboard-gis",
    "per-request token must override runtimeConfig.googleAccessToken for the run",
  );
  assert.ok(
    factoryCalledWith,
    "createPipelineWriterForRequest should be called when token present",
  );
  assert.equal(
    factoryCalledWith.googleAccessToken,
    "test-access-token-dashboard-gis",
  );
});

test("handleDiscoveryWebhook strips googleAccessToken from the request before runDiscovery sees it", async () => {
  // Defense in depth: even though the persistence helpers project specific
  // fields, we don't want the run pipeline (logs, run.request copies, etc.)
  // to be carrying a live OAuth token around.
  let observedRequest = null;
  const dependencies = makeDependencies({
    runSynchronously: true,
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
    },
    runDiscovery: async (request, _trigger, _deps) => {
      observedRequest = request;
      return {
        run: {
          runId: "run_strip",
          trigger: "manual",
          request,
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
          runId: "run_strip",
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
        sourceSummary: [],
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        googleAccessToken: "test-access-token-must-be-stripped",
      }),
    },
    {
      ...dependencies,
      createPipelineWriterForRequest(runtimeConfigOverride) {
        // Need a writer for this branch even though we don't use it directly.
        return dependencies.runDependencies.pipelineWriter;
      },
    },
  );

  assert.equal(response.status, 200, response.body);
  assert.ok(observedRequest, "runDiscovery should have been called");
  assert.equal(
    observedRequest.googleAccessToken,
    undefined,
    "googleAccessToken must be stripped from the request before runDiscovery sees it",
  );
  // Verify the rest of the request still flows through.
  assert.equal(observedRequest.sheetId, "sheet_123");
  assert.equal(observedRequest.variationKey, "var_123");
});

test("handleDiscoveryWebhook keeps googleAccessToken out of persisted run-status payloads", async () => {
  // The run-status store is on disk in real deployments. A leaked OAuth
  // token there is the kind of thing that costs people their accounts.
  const runStatusStore = createMemoryRunStatusStore();
  const dependencies = makeDependencies({
    runSynchronously: true,
    runStatusStore,
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        googleAccessToken: "test-access-token-never-persist",
      }),
    },
    {
      ...dependencies,
      createPipelineWriterForRequest(runtimeConfigOverride) {
        return dependencies.runDependencies.pipelineWriter;
      },
    },
  );

  assert.equal(response.status, 200, response.body);
  assert.ok(
    runStatusStore.states.length > 0,
    "store should have at least one entry",
  );
  for (const state of runStatusStore.states) {
    const serialized = JSON.stringify(state);
    assert.ok(
      !serialized.includes("test-access-token-never-persist"),
      `persisted state must not contain the token. Found in: ${serialized}`,
    );
  }
});

test("handleDiscoveryWebhook rejects non-string googleAccessToken", async () => {
  const dependencies = makeDependencies({
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
    },
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        googleAccessToken: { not: "a string" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.match(body.message, /googleAccessToken/);
});

test("handleDiscoveryWebhook still works without googleAccessToken (env credential path)", async () => {
  // Backwards-compat: when no per-request token, the existing env credential
  // path must still work and createPipelineWriterForRequest must NOT be called.
  let factoryCallCount = 0;
  const dependencies = makeDependencies({
    runSynchronously: true,
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
        googleAccessToken: "env-token-abc",
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        // no googleAccessToken
      }),
    },
    {
      ...dependencies,
      createPipelineWriterForRequest() {
        factoryCallCount += 1;
        return dependencies.runDependencies.pipelineWriter;
      },
    },
  );

  assert.equal(response.status, 200, response.body);
  assert.equal(
    factoryCallCount,
    0,
    "the per-request writer factory must not be called when no token is in the body",
  );
});

// === sourcePreset validation (VAL-API-001, VAL-API-002) ===

test("handleDiscoveryWebhook accepts valid sourcePreset values in discoveryProfile", async () => {
  for (const preset of ["browser_only", "ats_only", "browser_plus_ats"]) {
    const dependencies = makeDependencies({
      runDependencies: {
        ...makeDependencies().runDependencies,
        runtimeConfig: {
          ...makeDependencies().runDependencies.runtimeConfig,
          webhookSecret: SHARED_HEADER_VALUE,
        },
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
          sheetId: "sheet_123",
          variationKey: "var_123",
          requestedAt: "2026-04-09T12:00:00.000Z",
          discoveryProfile: {
            sourcePreset: preset,
            targetRoles: "Senior Engineer", // required intent field
          },
        }),
      },
      dependencies,
    );
    assert.ok(
      [200, 202].includes(response.status),
      `Expected 200 or 202 for preset "${preset}", got ${response.status}: ${response.body}`,
    );
  }
});

test("handleDiscoveryWebhook rejects invalid sourcePreset enum value with 400", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: { sourcePreset: "invalid_preset" },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /sourcePreset/);
  assert.match(body.message, /browser_only.*ats_only.*browser_plus_ats/);
  assert.match(body.message, /invalid_preset/);
});

test("handleDiscoveryWebhook rejects non-string sourcePreset with 400", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: { sourcePreset: 42 },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /sourcePreset.*string/i);
});

test("handleDiscoveryWebhook rejects contradictory sourcePreset and enabledSources in discoveryProfile", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          enabledSources: ["greenhouse"],
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /mutually exclusive/i);
});

test("handleDiscoveryWebhook rejects unsupported event with explicit 400 message", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        event: "unknown.event",
        schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /event.*command-center\.discovery/);
});

test("handleDiscoveryWebhook rejects unsupported schemaVersion with explicit 400 message", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        schemaVersion: 99,
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /schemaVersion.*1/);
});

test("handleDiscoveryWebhook rejects invalid requestedAt with explicit 400 message", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "not-a-date",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /requestedAt.*ISO timestamp/);
});

test("handleDiscoveryWebhook rejects array-typed discoveryProfile with 400", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: [{ sourcePreset: "browser_only" }],
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /discoveryProfile.*object/);
});

// === sheetId boundary by mode (VAL-API-007) ===

test("handleDiscoveryWebhook rejects missing sheetId in hosted mode with explicit error", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
        runMode: "hosted",
      },
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
        // no sheetId
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /sheetId is required/i);
  assert.match(
    body.detail,
    /Hosted worker requests must include sheetId explicitly/i,
  );
});

// === VAL-API-006: Missing required run-intent is rejected explicitly (no stored-profile fallback) ===

test("VAL-API-006: rejects request with discoveryProfile but missing both targetRoles and keywordsInclude", async () => {
  // When discoveryProfile is provided but BOTH targetRoles and keywordsInclude
  // are absent, the request must be rejected with explicit 400 and no run handle.
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          // sourcePreset provided but NO targetRoles or keywordsInclude
          sourcePreset: "browser_only",
          // targetRoles: missing
          // keywordsInclude: missing
        },
      }),
    },
    dependencies,
  );

  // Must reject with 400
  assert.equal(response.status, 400, `Expected 400, got ${response.status}: ${response.body}`);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);

  // Must have explicit error about missing intent
  assert.match(body.message, /targetRoles|keywordsInclude/i);

  // Must NOT create a run handle
  assert.ok(!body.runId, "Response must not include runId when intent is missing");
  assert.ok(!body.statusPath, "Response must not include statusPath when intent is missing");

  // Must have actionable guidance (AI Suggester remediation)
  assert.ok(
    body.remediation || body.detail,
    "Response must include remediation or detail with actionable guidance",
  );
  const guidanceText = `${body.remediation || ""} ${body.detail || ""}`.toLowerCase();
  assert.ok(
    guidanceText.includes("ai sugg") || guidanceText.includes("suggester"),
    "Response should mention AI Suggester tab as remediation",
  );
});

test("VAL-API-006: rejects request with discoveryProfile having blank targetRoles and blank keywordsInclude", async () => {
  // When discoveryProfile has BOTH targetRoles AND keywordsInclude as blank strings,
  // the request must be rejected with explicit 400 and no run handle.
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "ats_only",
          targetRoles: "   ",  // blank (whitespace only)
          keywordsInclude: "", // blank (empty string)
        },
      }),
    },
    dependencies,
  );

  // Must reject with 400
  assert.equal(response.status, 400, `Expected 400, got ${response.status}: ${response.body}`);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);

  // Must NOT create a run handle
  assert.ok(!body.runId, "Response must not include runId when intent is blank");
  assert.ok(!body.statusPath, "Response must not include statusPath when intent is blank");

  // No run was accepted/enqueued
  assert.ok(
    !dependencies.runStatusStore.get("run_123"),
    "No run status should be stored for rejected request",
  );
});

test("VAL-API-006: runDiscovery must NOT be called when intent is missing", async () => {
  // Verification that the explicit rejection happens BEFORE runDiscovery is invoked.
  let runDiscoveryCallCount = 0;
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      runDiscoveryCallCount += 1;
      throw new Error("runDiscovery should not have been called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          // both targetRoles and keywordsInclude missing
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  assert.equal(runDiscoveryCallCount, 0, "runDiscovery must not be called for missing intent");
});

// === VAL-API-008: Blank run intent is rejected explicitly (no silent fallback) ===

test("VAL-API-008: accepts request when targetRoles is present (non-blank) even if keywordsInclude is blank", async () => {
  // One non-blank intent field is sufficient - should NOT reject.
  const dependencies = makeDependencies({
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Senior Engineer",
          keywordsInclude: "", // blank but targetRoles is non-blank
        },
      }),
    },
    dependencies,
  );

  // Should be accepted (202 async or 200 sync)
  assert.ok(
    [200, 202].includes(response.status),
    `Expected 200 or 202, got ${response.status}: ${response.body}`,
  );
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.ok(body.runId, "Must have runId for valid intent");
});

test("VAL-API-008: accepts request when keywordsInclude is present (non-blank) even if targetRoles is blank", async () => {
  // One non-blank intent field is sufficient - should NOT reject.
  const dependencies = makeDependencies({
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "ats_only",
          targetRoles: "   ", // blank
          keywordsInclude: "AI,python", // non-blank
        },
      }),
    },
    dependencies,
  );

  // Should be accepted
  assert.ok(
    [200, 202].includes(response.status),
    `Expected 200 or 202, got ${response.status}: ${response.body}`,
  );
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.ok(body.runId, "Must have runId for valid intent");
});

test("VAL-API-008: rejects blank-only intent with explicit AI Suggester guidance", async () => {
  // When both intent fields are blank, response must include AI Suggester guidance.
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_plus_ats",
          targetRoles: "",
          keywordsInclude: "   ",
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);

  // Check guidance mentions AI Suggester
  const guidanceText = `${body.message || ""} ${body.detail || ""} ${body.remediation || ""}`;
  assert.ok(
    /ai sugg/i.test(guidanceText),
    `Response should mention AI Suggester. Got: ${guidanceText}`,
  );
});

// === VAL-API-010: Empty companies config must not hard-fail preflight ===

test("VAL-API-010: accepts non-blank intent with empty companies (unrestricted scope)", async () => {
  // Requests with non-blank intent and empty companies must be accepted
  // for unrestricted company scope discovery. This must NOT return
  // "no target companies" preflight failure.
  let runDiscoveryCalled = false;
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      runDiscoveryCalled = true;
      return {
        run: {
          runId: "run_unrestricted",
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
            targetRoles: ["Senior Engineer"],
            locations: [],
            remotePolicy: "",
            seniority: "",
            maxLeadsPerRun: 25,
            enabledSources: ["grounded_web"],
            schedule: { enabled: false, cron: "" },
          },
        },
        lifecycle: {
          runId: "run_unrestricted",
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
        sourceSummary: [],
        writeResult: {
          sheetId: "sheet_123",
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          warnings: [],
        },
        warnings: ["No companies are configured for this discovery run."],
      };
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Senior Engineer",
          keywordsInclude: "",
        },
      }),
    },
    dependencies,
  );

  // Must be accepted (not 409 "no target companies")
  assert.ok(
    [200, 202].includes(response.status),
    `Expected 200 or 202 for non-blank intent + empty companies, got ${response.status}: ${response.body}`,
  );
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.ok(body.runId, "Must have runId for valid unrestricted request");
  assert.ok(
    runDiscoveryCalled,
    "runDiscovery must be called for non-blank intent + empty companies",
  );
});

test("VAL-API-010: blank intent with empty companies still fails (preserves VAL-API-011)", async () => {
  // Even with unrestricted company scope, blank intent must still fail.
  // This is the VAL-API-011 guardrail preserved under unrestricted scope.
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "   ", // blank
          keywordsInclude: "", // blank
        },
      }),
    },
    dependencies,
  );

  // Must fail with 400 (blank intent), not 409 (no companies)
  assert.equal(response.status, 400, `Expected 400 for blank intent + empty companies, got ${response.status}: ${response.body}`);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.ok(!body.runId, "Must not have runId for blank intent");
});

// === VAL-API-004: malformed control-plane payloads fail closed with explicit validation errors ===

test("VAL-API-004: rejects non-boolean ultraPlanTuning.multiQueryEnabled with 400", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Senior Engineer",
          ultraPlanTuning: {
            multiQueryEnabled: "not-a-boolean",
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400, `Expected 400 for non-boolean multiQueryEnabled, got ${response.status}`);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /multiQueryEnabled.*boolean/i);
  assert.ok(!body.runId, "Must not create runId for malformed control-plane payload");
});

test("VAL-API-004: rejects non-number groundedSearchTuning.maxResultsPerCompany with 400", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Senior Engineer",
          groundedSearchTuning: {
            maxResultsPerCompany: "not-a-number",
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400, `Expected 400 for non-number maxResultsPerCompany, got ${response.status}`);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /maxResultsPerCompany.*number/i);
  assert.ok(!body.runId, "Must not create runId for malformed control-plane payload");
});

test("VAL-API-004: rejects unknown ultraPlanTuning field with 400", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Senior Engineer",
          ultraPlanTuning: {
            unknownField: true,
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400, `Expected 400 for unknown ultraPlanTuning field, got ${response.status}`);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /ultraPlanTuning.*unknown field/i);
  assert.ok(!body.runId, "Must not create runId for malformed control-plane payload");
});

test("VAL-API-004: rejects unknown groundedSearchTuning field with 400", async () => {
  const dependencies = makeDependencies({
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: SHARED_HEADER_VALUE,
      },
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
        sheetId: "sheet_123",
        variationKey: "var_123",
        requestedAt: "2026-04-09T12:00:00.000Z",
        discoveryProfile: {
          sourcePreset: "browser_only",
          targetRoles: "Senior Engineer",
          groundedSearchTuning: {
            unknownTuningParam: 999,
          },
        },
      }),
    },
    dependencies,
  );

  assert.equal(response.status, 400, `Expected 400 for unknown groundedSearchTuning field, got ${response.status}`);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.match(body.message, /groundedSearchTuning.*unknown field/i);
  assert.ok(!body.runId, "Must not create runId for malformed control-plane payload");
});
