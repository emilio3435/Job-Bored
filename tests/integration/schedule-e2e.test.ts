// Cross-workspace drift test — ensures the frontend's actual POST payload
// shape (settings-profile-tab.js:1190-1201 postScheduleSave) flows cleanly
// through the backend's handle-discovery-profile schedule-save /
// schedule-status branches (handle-discovery-profile.ts:485+/555+).
//
// If either half changes the contract without touching the other, one of
// these tests will fail. Keep the frontend-payload fixtures in lock-step
// with the real frontend code.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import type {
  StoredWorkerConfig,
  WorkerRuntimeConfig,
} from "../../integrations/browser-use-discovery/src/contracts.ts";
import {
  DISCOVERY_PROFILE_EVENT,
  DISCOVERY_PROFILE_SCHEMA_VERSION,
} from "../../integrations/browser-use-discovery/src/contracts.ts";
import { handleDiscoveryProfileWebhook } from "../../integrations/browser-use-discovery/src/webhook/handle-discovery-profile.ts";

function runtimeConfig(
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

function baselineStored(
  overrides: Partial<StoredWorkerConfig> = {},
): StoredWorkerConfig {
  return {
    sheetId: "sheet_drift",
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

// Mirrors settings-profile-tab.js::postScheduleSave verbatim. If the frontend
// changes this shape, update here too (and confirm with the backend team).
function frontendPostSchedulePayload(
  scheduleMode: "local" | "github" | "browser",
  state: { enabled: boolean; hour: number; minute: number },
  sheetId: string,
) {
  return JSON.stringify({
    event: DISCOVERY_PROFILE_EVENT,
    schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
    sheetId,
    mode: "schedule-save",
    schedule: {
      enabled: !!state.enabled,
      hour: state.hour,
      minute: state.minute,
      mode: scheduleMode,
    },
  });
}

function frontendStatusPayload(sheetId: string) {
  return JSON.stringify({
    event: DISCOVERY_PROFILE_EVENT,
    schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
    sheetId,
    mode: "schedule-status",
  });
}

test("drift: frontend local-tier payload round-trips through backend save+status", async () => {
  let savedConfig: StoredWorkerConfig = baselineStored();

  const deps = {
    runtimeConfig: runtimeConfig(),
    loadStoredWorkerConfig: async () => savedConfig,
    upsertStoredWorkerConfig: async (
      _rc: WorkerRuntimeConfig,
      input: { sheetId: string; mutations: Partial<StoredWorkerConfig> },
    ) => {
      savedConfig = baselineStored({
        sheetId: input.sheetId,
        schedule: input.mutations.schedule || { enabled: false },
      });
      return savedConfig;
    },
  };

  const saveRes = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: frontendPostSchedulePayload(
        "local",
        { enabled: true, hour: 8, minute: 30 },
        "sheet_drift",
      ),
    },
    deps,
  );
  assert.equal(saveRes.status, 200, "save should 200");
  const saveBody = JSON.parse(saveRes.body);
  assert.equal(saveBody.ok, true);
  assert.deepEqual(saveBody.schedule, {
    enabled: true,
    hour: 8,
    minute: 30,
    mode: "local",
    installedAt: null,
  });

  const statusRes = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: frontendStatusPayload("sheet_drift"),
    },
    deps,
  );
  assert.equal(statusRes.status, 200);
  const statusBody = JSON.parse(statusRes.body);
  assert.equal(statusBody.ok, true);
  assert.equal(
    statusBody.installed,
    false,
    "no breadcrumb yet -> installed:false",
  );
  assert.equal(statusBody.schedule.enabled, true);
  assert.equal(statusBody.schedule.mode, "local");
});

test("drift: frontend always-sends-mode behavior (enabled=false + mode='local') is accepted", async () => {
  // FRONTEND_HANDOFF question #1: frontend sends `mode` even when disabling
  // so the worker remembers which tier 'owns' the record. Backend must accept.
  let savedConfig: StoredWorkerConfig = baselineStored();

  const response = await handleDiscoveryProfileWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: frontendPostSchedulePayload(
        "local",
        { enabled: false, hour: 8, minute: 30 },
        "sheet_drift",
      ),
    },
    {
      runtimeConfig: runtimeConfig(),
      loadStoredWorkerConfig: async () => savedConfig,
      upsertStoredWorkerConfig: async (_rc, input) => {
        savedConfig = baselineStored({
          sheetId: input.sheetId,
          schedule: input.mutations.schedule || { enabled: false },
        });
        return savedConfig;
      },
    },
  );

  assert.equal(
    response.status,
    200,
    "backend must accept mode='local' even when enabled=false",
  );
  assert.equal(JSON.parse(response.body).ok, true);
});

test("drift: breadcrumb + saved local schedule -> installed:true (happy path)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "schedule-drift-"));
  const breadcrumbPath = join(dir, "schedule-installed.json");
  try {
    await writeFile(
      breadcrumbPath,
      JSON.stringify({
        platform: "darwin",
        installedAt: "2026-04-21T14:32:10.000Z",
        artifactPath: "/Users/x/Library/LaunchAgents/com.jobbored.refresh.plist",
        hour: 8,
        minute: 30,
        port: 8644,
      }),
    );

    const response = await handleDiscoveryProfileWebhook(
      {
        method: "POST",
        headers: { "x-discovery-secret": "secret-xyz" },
        bodyText: frontendStatusPayload("sheet_drift"),
      },
      {
        runtimeConfig: runtimeConfig(),
        scheduleInstalledPath: breadcrumbPath,
        loadStoredWorkerConfig: async () =>
          baselineStored({
            schedule: {
              enabled: true,
              hour: 8,
              minute: 30,
              mode: "local",
            },
          }),
      },
    );
    const body = JSON.parse(response.body);
    assert.equal(response.status, 200);
    assert.equal(body.installed, true, "breadcrumb + enabled local -> installed");
    assert.equal(body.installedArtifact?.platform, "darwin");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("drift: breadcrumb + mode='github' -> installed:false (contract §5)", async () => {
  // Contract §5: worker cannot verify GitHub remotely; must return false even
  // if a stale local breadcrumb exists on disk.
  const dir = await mkdtemp(join(tmpdir(), "schedule-drift-"));
  const breadcrumbPath = join(dir, "schedule-installed.json");
  try {
    await writeFile(
      breadcrumbPath,
      JSON.stringify({
        platform: "darwin",
        installedAt: "2026-04-21T14:32:10.000Z",
        artifactPath: "/some/stale/path",
        hour: 8,
        minute: 30,
        port: 8644,
      }),
    );

    const response = await handleDiscoveryProfileWebhook(
      {
        method: "POST",
        headers: { "x-discovery-secret": "secret-xyz" },
        bodyText: frontendStatusPayload("sheet_drift"),
      },
      {
        runtimeConfig: runtimeConfig(),
        scheduleInstalledPath: breadcrumbPath,
        loadStoredWorkerConfig: async () =>
          baselineStored({
            schedule: {
              enabled: true,
              hour: 8,
              minute: 30,
              mode: "github",
            },
          }),
      },
    );
    const body = JSON.parse(response.body);
    assert.equal(response.status, 200);
    assert.equal(
      body.installed,
      false,
      "github tier cannot report installed even with local breadcrumb",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("drift: stale breadcrumb + enabled=false -> installed:false (review fix guard)", async () => {
  // Codex review fix #1: stale breadcrumbs must not report installed:true
  // when the user has disabled the schedule or the saved tier isn't local.
  const dir = await mkdtemp(join(tmpdir(), "schedule-drift-"));
  const breadcrumbPath = join(dir, "schedule-installed.json");
  try {
    await writeFile(
      breadcrumbPath,
      JSON.stringify({
        platform: "darwin",
        installedAt: "2026-04-21T14:32:10.000Z",
        artifactPath: "/stale/path",
        hour: 8,
        minute: 30,
        port: 8644,
      }),
    );

    const response = await handleDiscoveryProfileWebhook(
      {
        method: "POST",
        headers: { "x-discovery-secret": "secret-xyz" },
        bodyText: frontendStatusPayload("sheet_drift"),
      },
      {
        runtimeConfig: runtimeConfig(),
        scheduleInstalledPath: breadcrumbPath,
        loadStoredWorkerConfig: async () =>
          baselineStored({
            schedule: {
              enabled: false,
              hour: 8,
              minute: 30,
              mode: "local",
            },
          }),
      },
    );
    const body = JSON.parse(response.body);
    assert.equal(response.status, 200);
    assert.equal(
      body.installed,
      false,
      "disabled schedule must not report installed even with breadcrumb",
    );
    // But breadcrumb info should still be echoed so UI can warn.
    assert.ok(
      body.installedArtifact,
      "installedArtifact should still be returned so UI can show stale warning",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
