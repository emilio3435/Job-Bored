import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { handleDiscoveryWebhook } from "../../src/webhook/handle-discovery-webhook.ts";

/*
  Falling back to the stored Sheet must not skip the credential check.

  94b8340 moved the sheetId precondition ahead of the Sheets credential check
  but kept its early `return null`. Preflight then exited before
  validateSheetsCredentialReadiness whenever a local worker used its stored
  sheetId — so a worker with a missing, revoked, or unreadable Google
  credential answered 202 "run queued" instead of the 409 that names the
  problem, and the run died later at the Sheets write with a raw Google error.
*/

const SECRET = "shared-proof-order";

function makeDependencies(storedSheetId: string) {
  return {
    runSynchronously: false,
    runDiscovery: async () => {
      throw new Error("runDiscovery must not be reached without a credential");
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
        // Every Google credential source empty — the worker cannot write.
        googleServiceAccountJson: "",
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
      pipelineWriter: { write: async () => ({ sheetId: storedSheetId, appended: 0, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] }) },
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
      now: () => new Date("2026-09-02T18:00:00.000Z"),
      randomId: (prefix: string) => `${prefix}_order`,
    },
  } as never;
}

function request(sheetId?: string) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-discovery-secret": SECRET },
    bodyText: JSON.stringify({
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      ...(sheetId === undefined ? {} : { sheetId }),
      variationKey: "var_order",
      requestedAt: "2026-09-02T18:00:00.000Z",
      discoveryProfile: { targetRoles: "Director of Integrated Marketing" },
    }),
  } as never;
}

const REAL_SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab";

test("a request with no sheetId still fails closed on a missing credential", async () => {
  const response = await handleDiscoveryWebhook(request(), makeDependencies(REAL_SHEET));

  assert.equal(
    response.status,
    409,
    "falling back to the stored Sheet must not skip the credential check",
  );
  assert.match(JSON.parse(response.body).message, /credential/i);
});

test("an empty-string sheetId — what the dashboard sends — fails closed too", async () => {
  const response = await handleDiscoveryWebhook(request(""), makeDependencies(REAL_SHEET));

  assert.equal(response.status, 409);
});

test("an explicit sheetId still fails closed on a missing credential", async () => {
  const response = await handleDiscoveryWebhook(request(REAL_SHEET), makeDependencies(REAL_SHEET));

  assert.equal(response.status, 409);
});

test("the placeholder sheetId is still refused before the credential check", async () => {
  const response = await handleDiscoveryWebhook(
    request(),
    makeDependencies("YOUR_SHEET_ID_HERE"),
  );

  assert.equal(response.status, 400, "no Sheet is a setup step, not a credential fault");
  assert.match(JSON.parse(response.body).detail || "", /no google sheet is connected/i);
});

test("an explicit placeholder in the payload is refused, not treated as a Sheet", async () => {
  const response = await handleDiscoveryWebhook(
    request("YOUR_SHEET_ID_HERE"),
    makeDependencies("YOUR_SHEET_ID_HERE"),
  );

  assert.equal(response.status, 400);
});
