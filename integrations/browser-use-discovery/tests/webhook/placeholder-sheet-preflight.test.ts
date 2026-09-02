import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";

/*
  The placeholder Sheet id is not a configured Sheet.

  A fresh worker-config.json ships `sheetId: "YOUR_SHEET_ID_HERE"`, and local
  mode accepted it as the default for a request that carried none. The run then
  reached the credential probe, which asked Google for a spreadsheet by that
  literal name, got a 404, and reported:

    Discovery worker Google service account file is invalid or cannot access
    the configured Sheet.

  The key was valid; no Sheet was connected (Emilio, 2026-09-02). Preflight now
  says so, and points at the setup step that fixes it.
*/

const SECRET = "shared-proof-placeholder";

function makeServiceAccountJson() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "worker@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

function makeDependencies(storedSheetId: string) {
  return {
    runSynchronously: false,
    runDiscovery: async () => {
      throw new Error("runDiscovery should not be called");
    },
    runDependencies: {
      runtimeConfig: {
        stateDatabasePath: "",
        workerConfigPath: "",
        browserUseCommand: "",
        geminiApiKey: "",
        geminiModel: "gemini-2.5-flash",
        groundedSearchMaxResultsPerCompany: 6,
        groundedSearchMaxPagesPerCompany: 4,
        googleServiceAccountJson: makeServiceAccountJson(),
        googleServiceAccountFile: "",
        googleAccessToken: "",
        googleOAuthTokenJson: "",
        googleOAuthTokenFile: "",
        webhookSecret: SECRET,
        allowedOrigins: [],
        port: 0,
        host: "127.0.0.1",
        runMode: "local" as const,
        asyncAckByDefault: true,
      },
      sourceAdapterRegistry: {
        adapters: [],
        detectBoards: async () => [],
        collectListings: async () => [],
      },
      pipelineWriter: {
        write: async () => ({
          sheetId: storedSheetId,
          appended: 0,
          updated: 0,
          skippedDuplicates: 0,
          skippedBlacklist: 0,
          warnings: [],
        }),
      },
      loadStoredWorkerConfig: async () => ({
        sheetId: storedSheetId,
        mode: "local" as const,
        timezone: "UTC",
        companies: [{ name: "Acme" }],
        includeKeywords: [],
        excludeKeywords: [],
        targetRoles: ["Director of Integrated Marketing"],
        locations: [],
        remotePolicy: "",
        seniority: "",
        maxLeadsPerRun: 25,
        enabledSources: ["greenhouse"],
        schedule: { enabled: false, cron: "" },
      }),
      now: () => new Date("2026-09-02T16:45:00.000Z"),
      randomId: (prefix: string) => `${prefix}_test`,
    },
  } as never;
}

function request() {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discovery-secret": SECRET,
    },
    bodyText: JSON.stringify({
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      variationKey: "var_placeholder",
      requestedAt: "2026-09-02T16:45:00.000Z",
      discoveryProfile: { targetRoles: "Director of Integrated Marketing" },
    }),
  } as never;
}

test("a stored placeholder Sheet id is refused as 'no Sheet', not as a bad credential", async () => {
  const response = await handleDiscoveryWebhook(
    request(),
    makeDependencies("YOUR_SHEET_ID_HERE"),
  );

  assert.equal(response.status, 400, "a run with nowhere to write must not start");
  const body = JSON.parse(response.body);
  assert.match(body.message, /sheetId is required/i);
  assert.match(
    `${body.detail || ""} ${body.remediation || ""}`,
    /no google sheet is connected/i,
    "the user must learn the Sheet is missing, not that their credential is broken",
  );
  assert.doesNotMatch(
    `${body.message} ${body.detail || ""}`,
    /service account/i,
    "blaming the credential is the defect this fixes",
  );
});

test("a REAL stored Sheet id is still accepted as the local default", async () => {
  const response = await handleDiscoveryWebhook(
    request(),
    makeDependencies("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab"),
  );

  assert.notEqual(
    response.status,
    400,
    "local mode still falls back to a configured Sheet",
  );
});
