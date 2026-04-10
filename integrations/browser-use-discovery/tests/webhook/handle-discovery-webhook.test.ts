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

// Shared placeholder secret value used in tests that need to bypass auth validation.
// Uses obviously fake placeholder literals that avoid secret-like keywords.
const PLACEHOLDER_SECRET = "placeholder-shared-value-xyz789";

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
  const runStatusStore = overrides.runStatusStore || createMemoryRunStatusStore();
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
        googleAccessToken: "token_123",
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
        webhookSecret: PLACEHOLDER_SECRET,
      },
    },
  });
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": PLACEHOLDER_SECRET,
      },
      bodyText: "not-json",
    },
    dependencies,
  );

  assert.equal(response.status, 400);
  assert.match(response.body, /valid JSON/);
});

test("handleDiscoveryWebhook accepts missing request sheetId when worker config provides one", async () => {
  const dependencies = makeDependencies({
    runDependencies: {
      ...makeDependencies().runDependencies,
      runtimeConfig: {
        ...makeDependencies().runDependencies.runtimeConfig,
        webhookSecret: PLACEHOLDER_SECRET,
      },
    },
  });
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": PLACEHOLDER_SECRET,
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
        webhookSecret: PLACEHOLDER_SECRET,
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
        "x-discovery-secret": PLACEHOLDER_SECRET,
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
        webhookSecret: PLACEHOLDER_SECRET,
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
        "x-discovery-secret": PLACEHOLDER_SECRET,
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
  assert.equal(dependencies.runStatusStore.get("run_queued").status, "completed");
});

test("handleDiscoveryWebhook forwards run-level logs through the request logger", async () => {
  const logged = [];
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": PLACEHOLDER_SECRET,
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
          webhookSecret: PLACEHOLDER_SECRET,
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
        webhookSecret: PLACEHOLDER_SECRET,
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
        "x-discovery-secret": PLACEHOLDER_SECRET,
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
  assert.equal(dependencies.runStatusStore.get("run_queued").status, "completed");
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
        webhookSecret: "placeholder-shared-value-xyz",
      },
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": "placeholder-shared-value-xyz",
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

test("handleDiscoveryWebhook fails fast when no companies are configured", async () => {
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": "placeholder-test-shared-abc",
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
          googleAccessToken: "token_123",
          webhookSecret: "placeholder-test-shared-abc",
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
  assert.match(body.message, /no target companies/i);
  assert.match(body.detail, /worker-config\.json/);
});

test("handleDiscoveryWebhook fails fast when no sheets credential is configured", async () => {
  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": "placeholder-test-shared-def",
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
          webhookSecret: "placeholder-test-shared-def",
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

  const response = await handleDiscoveryWebhook(
    makeRequest(),
    dependencies,
  );

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
        webhookSecret: "shared-value-xyz-123",
      },
    },
  });

  const response = await handleDiscoveryWebhook(
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Provide the matching secret header value.
        "x-discovery-secret": "shared-value-xyz-123",
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
  assert.ok([200, 202].includes(response.status), `Expected 200 or 202, got ${response.status}`);
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
        webhookSecret: "the-real-shared-value-abc",
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
