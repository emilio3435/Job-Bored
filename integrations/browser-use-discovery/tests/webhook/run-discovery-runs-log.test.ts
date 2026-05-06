import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type DiscoveryRunLogRow,
  type DiscoveryRunTrigger,
} from "../../src/contracts.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  globalThis.fetch = (async () =>
    new Response("", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as typeof fetch;
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

type LoggerCall = { sheetId: string; row: DiscoveryRunLogRow };

function makeDependencies(options: {
  loggerAppend: (sheetId: string, row: DiscoveryRunLogRow) => Promise<
    | { ok: true; created: boolean }
    | { ok: false; reason: string }
  >;
}) {
  return {
    runtimeConfig: {
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
      useStructuredExtraction: false,
      serpApiKey: "",
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async () => [],
      collectListings: async () => [],
    },
    pipelineWriter: {
      write: async (sheetId: string) => ({
        sheetId,
        appended: 2,
        updated: 0,
        skippedDuplicates: 0,
        skippedBlacklist: 0,
        warnings: [],
      }),
    },
    discoveryRunsLogger: {
      append: options.loggerAppend,
    },
    discoveryRunsSource: "worker@test",
    loadStoredWorkerConfig: async (sheetId: string) => ({
      sheetId,
      mode: "hosted" as const,
      timezone: "UTC",
      companies: [{ name: "Acme" }, { name: "Beta" }, { name: "Gamma" }],
      includeKeywords: ["node"],
      excludeKeywords: [],
      targetRoles: ["Backend Engineer"],
      locations: ["Remote"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 5,
      enabledSources: ["grounded_web"] as const,
      schedule: { enabled: false, cron: "" },
    }),
    mergeDiscoveryConfig: (stored: Record<string, unknown>, request: Record<string, unknown>) => ({
      ...stored,
      sheetId: request.sheetId,
      variationKey: request.variationKey,
      requestedAt: request.requestedAt,
      sourcePreset: "browser_only" as const,
      effectiveSources: ["grounded_web"],
    }),
    now: (() => {
      let index = 0;
      const dates = [
        new Date("2026-04-09T12:00:00.000Z"),
        new Date("2026-04-09T12:00:47.000Z"),
      ];
      return () => dates[Math.min(index++, dates.length - 1)];
    })(),
    randomId: (prefix: string) => `${prefix}_logger_test`,
  };
}

function makeRequest(trigger?: DiscoveryRunTrigger) {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_abc",
    variationKey: "var_xyz",
    requestedAt: "2026-04-09T12:00:00.000Z",
    ...(trigger ? { trigger } : {}),
  };
}

test("runDiscovery calls discoveryRunsLogger.append with a row matching the run outcome", async () => {
  const loggerCalls: LoggerCall[] = [];
  const dependencies = makeDependencies({
    loggerAppend: async (sheetId, row) => {
      loggerCalls.push({ sheetId, row });
      return { ok: true, created: false };
    },
  });

  const result = await runDiscovery(
    makeRequest("scheduled-github"),
    "manual",
    dependencies as unknown as Parameters<typeof runDiscovery>[2],
  );

  assert.equal(loggerCalls.length, 1);
  const logged = loggerCalls[0];
  assert.equal(logged.sheetId, "sheet_abc");
  assert.equal(logged.row.trigger, "scheduled-github");
  assert.equal(logged.row.variationKey, "var_xyz");
  assert.equal(logged.row.source, "worker@test");
  assert.equal(logged.row.companiesSeen, 3);
  assert.equal(logged.row.runAt, "2026-04-09T12:00:47.000Z");
  assert.equal(logged.row.durationS, 47);
  // No adapters produced leads → pipelineWriter is not called → appended=0.
  assert.equal(logged.row.leadsWritten, 0);
  assert.equal(logged.row.leadsUpdated, 0);
  // No writer error, but the run emits warnings (because there were no
  // adapters), so the lifecycle resolves to "partial".
  assert.ok(
    logged.row.status === "partial" || logged.row.status === "success",
    `status should be partial or success, got ${logged.row.status}`,
  );
  assert.equal(logged.row.error, "");
  // The run itself must still return normally.
  assert.equal(result.run.runId, "run_logger_test");
});

test("runDiscovery falls back to dispatcher trigger when request.trigger is absent", async () => {
  const loggerCalls: LoggerCall[] = [];
  const dependencies = makeDependencies({
    loggerAppend: async (sheetId, row) => {
      loggerCalls.push({ sheetId, row });
      return { ok: true, created: false };
    },
  });

  await runDiscovery(
    makeRequest(),
    "manual",
    dependencies as unknown as Parameters<typeof runDiscovery>[2],
  );

  assert.equal(loggerCalls.length, 1);
  assert.equal(loggerCalls[0].row.trigger, "manual");
});

test("runDiscovery does not fail the run when discoveryRunsLogger.append returns ok:false", async () => {
  const dependencies = makeDependencies({
    loggerAppend: async () => ({ ok: false, reason: "HTTP 403 - permission denied" }),
  });

  const events: Array<[string, Record<string, unknown>]> = [];
  const result = await runDiscovery(
    makeRequest("manual"),
    "manual",
    {
      ...dependencies,
      log: (event, details) => events.push([event, details]),
    } as unknown as Parameters<typeof runDiscovery>[2],
  );

  // The run itself must still complete normally.
  assert.equal(result.run.runId, "run_logger_test");
  // A skip log must have been emitted so operators can see why the row was lost.
  const skipLog = events.find(([event]) => event === "discovery.runs_log.append_skipped");
  assert.ok(skipLog, "expected discovery.runs_log.append_skipped log entry");
  assert.match(String(skipLog![1].reason), /HTTP 403/);
});

test("runDiscovery does not fail the run when discoveryRunsLogger.append throws", async () => {
  const dependencies = makeDependencies({
    loggerAppend: async () => {
      throw new Error("kaboom");
    },
  });

  const events: Array<[string, Record<string, unknown>]> = [];
  const result = await runDiscovery(
    makeRequest("manual"),
    "manual",
    {
      ...dependencies,
      log: (event, details) => events.push([event, details]),
    } as unknown as Parameters<typeof runDiscovery>[2],
  );

  assert.equal(result.run.runId, "run_logger_test");
  const crashLog = events.find(([event]) => event === "discovery.runs_log.append_crashed");
  assert.ok(crashLog, "expected discovery.runs_log.append_crashed log entry");
  assert.match(String(crashLog![1].message), /kaboom/);
});
