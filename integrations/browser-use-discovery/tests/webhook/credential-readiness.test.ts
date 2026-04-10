import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  formatSheetsCredentialReadinessWarning,
  validateSheetsCredentialReadiness,
} from "../../src/sheets/credential-readiness.ts";
import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";

const baseRuntimeConfig = {
  stateDatabasePath: "",
  workerConfigPath: "",
  browserUseCommand: "",
  geminiApiKey: "",
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
  runMode: "hosted" as const,
  asyncAckByDefault: true,
};

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
      requestedAt: "2026-04-10T12:00:00.000Z",
      ...overrides,
    }),
  };
}

function makeDependencies(runtimeConfigOverrides = {}) {
  return {
    runSynchronously: false,
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      runtimeConfig: {
        ...baseRuntimeConfig,
        ...runtimeConfigOverrides,
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
        enabledSources: ["greenhouse"],
        schedule: { enabled: false, cron: "" },
      }),
      mergeDiscoveryConfig: (stored, request) => ({
        ...stored,
        variationKey: request.variationKey,
        requestedAt: request.requestedAt,
      }),
      now: () => new Date("2026-04-10T12:00:00.000Z"),
      randomId: (prefix) => `${prefix}_queued`,
    },
  };
}

test("validateSheetsCredentialReadiness reports missing service-account files explicitly", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-credential-readiness-"));
  try {
    const status = await validateSheetsCredentialReadiness({
      ...baseRuntimeConfig,
      googleServiceAccountFile: join(tempDir, "missing-service-account.json"),
    });

    assert.equal(status.configured, false);
    assert.equal(status.source, "service_account_file");
    assert.match(status.message || "", /service account file is unreadable/i);
    assert.match(status.detail || "", /does not exist/i);
    assert.match(
      formatSheetsCredentialReadinessWarning(status),
      /service account file is unreadable/i,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("validateSheetsCredentialReadiness rejects malformed OAuth token JSON files", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-credential-readiness-"));
  const tokenPath = join(tempDir, "oauth-token.json");
  try {
    await writeFile(tokenPath, "{not-valid-json", "utf8");

    const status = await validateSheetsCredentialReadiness({
      ...baseRuntimeConfig,
      googleOAuthTokenFile: tokenPath,
    });

    assert.equal(status.configured, false);
    assert.equal(status.source, "oauth_token_file");
    assert.match(status.message || "", /oauth token file is invalid/i);
    assert.ok(status.detail);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("handleDiscoveryWebhook fails fast when a configured service-account file is missing", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-credential-readiness-"));
  try {
    const response = await handleDiscoveryWebhook(
      makeRequest(),
      makeDependencies({
        googleServiceAccountFile: join(tempDir, "missing-service-account.json"),
      }),
    );

    assert.equal(response.status, 409);
    const body = JSON.parse(response.body);
    assert.equal(body.ok, false);
    assert.match(body.message, /service account file is unreadable/i);
    assert.match(body.detail, /does not exist/i);
    assert.match(
      body.remediation,
      /BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE/i,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
