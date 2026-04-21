import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import type {
  StoredWorkerConfig,
  WorkerRuntimeConfig,
} from "../../src/contracts.ts";
import {
  DISCOVERY_PROFILE_EVENT,
  DISCOVERY_PROFILE_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { handleDiscoveryProfileWebhook } from "../../src/webhook/handle-discovery-profile.ts";

function makeRuntimeConfig(
  overrides: Partial<WorkerRuntimeConfig> = {},
): WorkerRuntimeConfig {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "test-api-key",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 5,
    groundedSearchMaxPagesPerCompany: 2,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: "secret-xyz",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "hosted",
    asyncAckByDefault: true,
    useStructuredExtraction: false,
    serpApiKey: "",
    ...overrides,
  };
}

function makeStoredConfig(
  overrides: Partial<StoredWorkerConfig> = {},
): StoredWorkerConfig {
  return {
    sheetId: "sheet_abc123",
    mode: "hosted",
    timezone: "UTC",
    companies: [],
    atsCompanies: [],
    includeKeywords: [],
    excludeKeywords: [],
    targetRoles: [],
    locations: [],
    remotePolicy: "",
    seniority: "",
    maxLeadsPerRun: 25,
    enabledSources: ["grounded_web"],
    schedule: { enabled: false },
    ...overrides,
  };
}

function requestBody(payload: Record<string, unknown>): string {
  return JSON.stringify({
    event: DISCOVERY_PROFILE_EVENT,
    schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
    ...payload,
  });
}

test("POST /discovery-profile mode:schedule-save writes schedule config", async () => {
  let captured:
    | {
        sheetId: string;
        mutations: Partial<StoredWorkerConfig>;
      }
    | null = null;

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: requestBody({
        mode: "schedule-save",
        sheetId: "sheet_abc123",
        schedule: {
          enabled: true,
          hour: 8,
          minute: 0,
          mode: "local",
        },
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      loadStoredWorkerConfig: async () => makeStoredConfig(),
      upsertStoredWorkerConfig: async (_runtimeConfig, input) => {
        captured = input;
        return makeStoredConfig({
          sheetId: input.sheetId,
          schedule: input.mutations.schedule || { enabled: false },
        });
      },
    },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.deepEqual(body.schedule, {
    enabled: true,
    hour: 8,
    minute: 0,
    mode: "local",
    installedAt: null,
  });
  assert.ok(captured, "upsertStoredWorkerConfig should be invoked");
  assert.equal(captured!.sheetId, "sheet_abc123");
  assert.deepEqual(captured!.mutations.schedule, {
    enabled: true,
    hour: 8,
    minute: 0,
    mode: "local",
  });
});

test("POST /discovery-profile mode:schedule-save rejects invalid input", async () => {
  const cases: Array<{
    name: string;
    payload: Record<string, unknown>;
    message: RegExp;
  }> = [
    {
      name: "missing sheetId",
      payload: {
        mode: "schedule-save",
        schedule: { enabled: true, hour: 8, minute: 0, mode: "local" },
      },
      message: /sheetId is required/,
    },
    {
      name: "bad hour",
      payload: {
        mode: "schedule-save",
        sheetId: "sheet_abc123",
        schedule: { enabled: true, hour: 24, minute: 0, mode: "local" },
      },
      message: /schedule\.hour/,
    },
    {
      name: "bad minute",
      payload: {
        mode: "schedule-save",
        sheetId: "sheet_abc123",
        schedule: { enabled: true, hour: 8, minute: 60, mode: "local" },
      },
      message: /schedule\.minute/,
    },
    {
      name: "bad mode",
      payload: {
        mode: "schedule-save",
        sheetId: "sheet_abc123",
        schedule: { enabled: true, hour: 8, minute: 0, mode: "weekly" },
      },
      message: /schedule\.mode/,
    },
  ];

  for (const item of cases) {
    const response = await handleDiscoveryProfileWebhook(
      {
        method: "POST",
        headers: { "x-discovery-secret": "secret-xyz" },
        bodyText: requestBody(item.payload),
      },
      {
        runtimeConfig: makeRuntimeConfig(),
        loadStoredWorkerConfig: async () => makeStoredConfig(),
        upsertStoredWorkerConfig: async () => makeStoredConfig(),
      },
    );

    assert.equal(response.status, 400, item.name);
    assert.match(response.body, item.message, item.name);
  }
});

test("POST /discovery-profile mode:schedule-status returns installed:false when breadcrumb is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jobbored-schedule-"));
  try {
    const response = await handleDiscoveryProfileWebhook(
      {
        method: "POST",
        headers: { "x-discovery-secret": "secret-xyz" },
        bodyText: requestBody({
          mode: "schedule-status",
          sheetId: "sheet_abc123",
        }),
      },
      {
        runtimeConfig: makeRuntimeConfig(),
        scheduleInstalledPath: join(dir, "schedule-installed.json"),
        loadStoredWorkerConfig: async () =>
          makeStoredConfig({
            schedule: {
              enabled: true,
              hour: 8,
              minute: 15,
              mode: "local",
            },
          }),
      },
    );

    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.schedule, {
      enabled: true,
      hour: 8,
      minute: 15,
      mode: "local",
    });
    assert.equal(body.installed, false);
    assert.equal(body.installedArtifact, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("POST /discovery-profile mode:schedule-status returns installed:true when breadcrumb is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jobbored-schedule-"));
  const breadcrumbPath = join(dir, "schedule-installed.json");
  try {
    await writeFile(
      breadcrumbPath,
      `${JSON.stringify({
        platform: "darwin",
        installedAt: "2026-04-21T14:32:10.000Z",
        artifactPath: "/Users/emilio/Library/LaunchAgents/com.jobbored.refresh.plist",
        hour: 8,
        minute: 0,
        port: 8644,
      })}\n`,
      "utf8",
    );

    const response = await handleDiscoveryProfileWebhook(
      {
        method: "POST",
        headers: { "x-discovery-secret": "secret-xyz" },
        bodyText: requestBody({
          mode: "schedule-status",
          sheetId: "sheet_abc123",
        }),
      },
      {
        runtimeConfig: makeRuntimeConfig(),
        scheduleInstalledPath: breadcrumbPath,
        loadStoredWorkerConfig: async () =>
          makeStoredConfig({
            schedule: {
              enabled: true,
              hour: 8,
              minute: 0,
              mode: "local",
            },
          }),
      },
    );

    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.schedule, {
      enabled: true,
      hour: 8,
      minute: 0,
      mode: "local",
      installedAt: "2026-04-21T14:32:10.000Z",
    });
    assert.equal(body.installed, true);
    assert.deepEqual(body.installedArtifact, {
      platform: "darwin",
      path: "/Users/emilio/Library/LaunchAgents/com.jobbored.refresh.plist",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
