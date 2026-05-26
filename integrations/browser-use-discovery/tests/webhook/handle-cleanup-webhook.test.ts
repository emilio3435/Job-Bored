import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerRuntimeConfig } from "../../src/config.ts";
import type { ExpiredCleanupResult } from "../../src/cleanup/expired-job-cleanup.ts";
import { handleCleanupExpiredWebhook } from "../../src/webhook/handle-cleanup-webhook.ts";

function makeRuntimeConfig(
  overrides: Partial<WorkerRuntimeConfig> = {},
): WorkerRuntimeConfig {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash",
    groundedSearchMaxResultsPerCompany: 6,
    groundedSearchMaxPagesPerCompany: 4,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    googleOAuthTokenJson: "",
    googleOAuthTokenFile: "",
    webhookSecret: "secret-xyz",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "local",
    asyncAckByDefault: true,
    useStructuredExtraction: false,
    serpApiKey: "",
    ...overrides,
  };
}

function fakeResult(overrides: Partial<ExpiredCleanupResult> = {}): ExpiredCleanupResult {
  return {
    sheetId: "sheet_123",
    sheetName: "Pipeline",
    dryRun: true,
    checked: 2,
    open: 1,
    needsReview: 1,
    skipped: 0,
    wouldExpire: 0,
    updated: 0,
    wouldUpdate: 0,
    results: [
      {
        rowNumber: 2,
        link: "https://jobs.example.com/a",
        normalizedLink: "https://jobs.example.com/a",
        previousStatus: "New",
        action: "open",
        reason: "Job page accepted applications",
      },
      {
        rowNumber: 3,
        link: "https://jobs.example.com/b",
        normalizedLink: "https://jobs.example.com/b",
        previousStatus: "Researching",
        action: "needs_review",
        reason: "Page asked for human verification",
      },
    ],
    ...overrides,
  };
}

test("cleanup-expired requires POST", async () => {
  const res = await handleCleanupExpiredWebhook(
    {
      method: "GET",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: "",
    },
    { runtimeConfig: makeRuntimeConfig() },
  );
  assert.equal(res.status, 405);
});

test("cleanup-expired refuses the wrong secret", async () => {
  const res = await handleCleanupExpiredWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "wrong" },
      bodyText: JSON.stringify({ sheetId: "sheet_123" }),
    },
    { runtimeConfig: makeRuntimeConfig() },
  );
  assert.equal(res.status, 401);
});

test("cleanup-expired returns 400 when sheetId is missing", async () => {
  const res = await handleCleanupExpiredWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({}),
    },
    { runtimeConfig: makeRuntimeConfig() },
  );
  assert.equal(res.status, 400);
  const body = JSON.parse(res.body as string);
  assert.equal(body.ok, false);
  assert.match(body.message, /sheetId/);
});

test("cleanup-expired runs the cleanup and returns counts plus results", async () => {
  let runtimeSeen: WorkerRuntimeConfig | null = null;
  let optionsSeen: { dryRun?: boolean } | undefined = undefined;
  const res = await handleCleanupExpiredWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({ sheetId: "sheet_123", dryRun: true }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      runCleanup: async (params) => {
        runtimeSeen = params.runtimeConfig;
        optionsSeen = params.options;
        return fakeResult();
      },
    },
  );
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body as string);
  assert.equal(body.ok, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.checked, 2);
  assert.equal(body.needsReview, 1);
  assert.equal(Array.isArray(body.results), true);
  assert.equal(optionsSeen?.dryRun, true);
  assert.equal(runtimeSeen?.googleAccessToken, "");
});

test("cleanup-expired applies the per-request googleAccessToken to a per-call runtime", async () => {
  let runtimeSeen: WorkerRuntimeConfig | null = null;
  await handleCleanupExpiredWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({
        sheetId: "sheet_123",
        googleAccessToken: "user-token-abc",
      }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      runCleanup: async (params) => {
        runtimeSeen = params.runtimeConfig;
        return fakeResult();
      },
    },
  );
  assert.equal(runtimeSeen?.googleAccessToken, "user-token-abc");
});

test("cleanup-expired surfaces classifier errors as 500", async () => {
  const res = await handleCleanupExpiredWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({ sheetId: "sheet_123" }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      runCleanup: async () => {
        throw new Error("sheet api unreachable");
      },
    },
  );
  assert.equal(res.status, 500);
  const body = JSON.parse(res.body as string);
  assert.equal(body.ok, false);
  assert.match(body.detail, /sheet api unreachable/);
});

test("cleanup-expired defaults to dry-run when dryRun is omitted", async () => {
  let optionsSeen: { dryRun?: boolean } | undefined = undefined;
  await handleCleanupExpiredWebhook(
    {
      method: "POST",
      headers: { "x-discovery-secret": "secret-xyz" },
      bodyText: JSON.stringify({ sheetId: "sheet_123" }),
    },
    {
      runtimeConfig: makeRuntimeConfig(),
      runCleanup: async (params) => {
        optionsSeen = params.options;
        return fakeResult();
      },
    },
  );
  assert.equal(optionsSeen?.dryRun, true);
});
