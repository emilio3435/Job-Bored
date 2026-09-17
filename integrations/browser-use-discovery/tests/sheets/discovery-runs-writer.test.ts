import assert from "node:assert/strict";
import test from "node:test";

import type {
  DiscoveryRunLogRow,
  WorkerRuntimeConfig,
} from "../../src/contracts.ts";
import { DISCOVERY_RUNS_SHEET_NAME } from "../../src/contracts.ts";
import {
  appendDiscoveryRunRow,
  buildDiscoveryRunLogRowFromStatus,
  createDiscoveryRunsLogger,
  resolveDiscoveryRunLogError,
} from "../../src/sheets/discovery-runs-writer.ts";

function makeRuntimeConfig(
  overrides: Partial<WorkerRuntimeConfig> = {},
): WorkerRuntimeConfig {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "browser-use",
    geminiApiKey: "",
    geminiModel: "",
    groundedSearchMaxResultsPerCompany: 5,
    groundedSearchMaxPagesPerCompany: 2,
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "direct-token",
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

function makeRow(overrides: Partial<DiscoveryRunLogRow> = {}): DiscoveryRunLogRow {
  return {
    runAt: "2026-04-21T15:12:03.000Z",
    trigger: "manual",
    status: "success",
    durationS: 47,
    companiesSeen: 12,
    leadsWritten: 3,
    leadsUpdated: 2,
    source: "worker@test",
    variationKey: "var-1234",
    error: "",
    ...overrides,
  };
}

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText: string;
};

type FetchStubStep = {
  match: (call: FetchCall) => boolean;
  response: () => Response;
};

function makeFetchStub(steps: FetchStubStep[]) {
  const calls: FetchCall[] = [];
  const stub: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = String(init?.method || "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const raw = init.headers as Record<string, string>;
      for (const key of Object.keys(raw)) headers[key.toLowerCase()] = raw[key];
    }
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const call: FetchCall = { url, method, headers, bodyText };
    calls.push(call);
    const step = steps.find((s) => s.match(call));
    if (!step) {
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    }
    return step.response();
  };
  return { stub, calls };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("appendDiscoveryRunRow appends when the tab already exists with the expected header", async () => {
  const { stub, calls } = makeFetchStub([
    {
      match: (c) =>
        c.method === "GET" &&
        c.url.includes(`/values/${encodeURIComponent(`${DISCOVERY_RUNS_SHEET_NAME}!A1:J1`)}`),
      response: () =>
        okJson({
          range: `${DISCOVERY_RUNS_SHEET_NAME}!A1:J1`,
          majorDimension: "ROWS",
          values: [
            [
              "Run At",
              "Trigger",
              "Status",
              "Duration (s)",
              "Companies Seen",
              "Leads New",
              "Leads Updated",
              "Source",
              "Variation Key",
              "Error",
            ],
          ],
        }),
    },
    {
      match: (c) =>
        c.method === "POST" && c.url.includes(":append"),
      response: () => okJson({ updates: { updatedRows: 1 } }),
    },
  ]);

  const result = await appendDiscoveryRunRow("sheet-123", makeRow(), {
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: stub,
  });

  assert.deepEqual(result, { ok: true, created: false });
  assert.equal(calls.length, 2);
  const appendCall = calls[1];
  assert.equal(appendCall.method, "POST");
  const parsed = JSON.parse(appendCall.bodyText);
  assert.deepEqual(parsed.values, [
    [
      "2026-04-21T15:12:03.000Z",
      "manual",
      "success",
      "47",
      "12",
      "3",
      "2",
      "worker@test",
      "var-1234",
      "",
    ],
  ]);
  assert.equal(appendCall.headers["authorization"], "Bearer direct-token");
});

test("appendDiscoveryRunRow creates the tab + header when the sheet has no DiscoveryRuns tab", async () => {
  const events: Array<[string, Record<string, unknown>]> = [];
  const { stub, calls } = makeFetchStub([
    {
      match: (c) =>
        c.method === "GET" &&
        c.url.includes(`/values/${encodeURIComponent(`${DISCOVERY_RUNS_SHEET_NAME}!A1:J1`)}`),
      response: () =>
        errorJson(400, {
          error: {
            code: 400,
            message: "Unable to parse range: DiscoveryRuns!A1:J1",
          },
        }),
    },
    {
      match: (c) => c.method === "POST" && c.url.endsWith(":batchUpdate"),
      response: () => okJson({ replies: [{ addSheet: {} }] }),
    },
    {
      match: (c) =>
        c.method === "PUT" &&
        c.url.includes(`/values/${encodeURIComponent(`${DISCOVERY_RUNS_SHEET_NAME}!A1:J1`)}`),
      response: () => okJson({ updatedRange: "DiscoveryRuns!A1:J1" }),
    },
    {
      match: (c) => c.method === "POST" && c.url.includes(":append"),
      response: () => okJson({ updates: { updatedRows: 1 } }),
    },
  ]);

  const result = await appendDiscoveryRunRow("sheet-123", makeRow(), {
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: stub,
    log: (event, details) => events.push([event, details]),
  });

  assert.deepEqual(result, { ok: true, created: true });
  assert.equal(calls.length, 4);
  assert.ok(events.some(([event]) => event === "discovery.runs_log.tab_created"));
});

test("appendDiscoveryRunRow returns ok:false when the append request fails (does not throw)", async () => {
  const { stub } = makeFetchStub([
    {
      match: (c) =>
        c.method === "GET" &&
        c.url.includes(`/values/${encodeURIComponent(`${DISCOVERY_RUNS_SHEET_NAME}!A1:J1`)}`),
      response: () =>
        okJson({
          values: [
            [
              "Run At",
              "Trigger",
              "Status",
              "Duration (s)",
              "Companies Seen",
              "Leads New",
              "Leads Updated",
              "Source",
              "Variation Key",
              "Error",
            ],
          ],
        }),
    },
    {
      match: (c) => c.method === "POST" && c.url.includes(":append"),
      response: () => errorJson(500, { error: { message: "Internal error" } }),
    },
  ]);

  const result = await appendDiscoveryRunRow("sheet-123", makeRow(), {
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: stub,
  });

  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason, /HTTP 500/);
  }
});

test("appendDiscoveryRunRow truncates long error strings to <=200 chars", async () => {
  const longError = "x".repeat(500);
  let capturedBody = "";
  const { stub } = makeFetchStub([
    {
      match: (c) =>
        c.method === "GET" &&
        c.url.includes(`/values/${encodeURIComponent(`${DISCOVERY_RUNS_SHEET_NAME}!A1:J1`)}`),
      response: () =>
        okJson({
          values: [
            [
              "Run At",
              "Trigger",
              "Status",
              "Duration (s)",
              "Companies Seen",
              "Leads New",
              "Leads Updated",
              "Source",
              "Variation Key",
              "Error",
            ],
          ],
        }),
    },
    {
      match: (c) => {
        if (c.method === "POST" && c.url.includes(":append")) {
          capturedBody = c.bodyText;
          return true;
        }
        return false;
      },
      response: () => okJson({ updates: { updatedRows: 1 } }),
    },
  ]);

  await appendDiscoveryRunRow(
    "sheet-123",
    makeRow({ status: "failure", error: longError }),
    { runtimeConfig: makeRuntimeConfig(), fetchImpl: stub },
  );

  const parsed = JSON.parse(capturedBody) as { values: string[][] };
  const errorCell = parsed.values[0][9];
  assert.ok(errorCell.length <= 200, `error cell exceeded 200 chars: ${errorCell.length}`);
});

test("appendDiscoveryRunRow returns ok:false without throwing when no Google credential is configured", async () => {
  const result = await appendDiscoveryRunRow(
    "sheet-123",
    makeRow(),
    { runtimeConfig: makeRuntimeConfig({ googleAccessToken: "" }) },
  );

  assert.equal(result.ok, false);
  if (result.ok === false) {
    assert.match(result.reason, /token resolution failed/);
  }
});

test("appendDiscoveryRunRow success case leaves error column blank even when row.error is set", async () => {
  let capturedBody = "";
  const { stub } = makeFetchStub([
    {
      match: (c) =>
        c.method === "GET" &&
        c.url.includes(`/values/${encodeURIComponent(`${DISCOVERY_RUNS_SHEET_NAME}!A1:J1`)}`),
      response: () =>
        okJson({
          values: [
            [
              "Run At",
              "Trigger",
              "Status",
              "Duration (s)",
              "Companies Seen",
              "Leads New",
              "Leads Updated",
              "Source",
              "Variation Key",
              "Error",
            ],
          ],
        }),
    },
    {
      match: (c) => {
        if (c.method === "POST" && c.url.includes(":append")) {
          capturedBody = c.bodyText;
          return true;
        }
        return false;
      },
      response: () => okJson({ updates: { updatedRows: 1 } }),
    },
  ]);

  await appendDiscoveryRunRow(
    "sheet-123",
    makeRow({ status: "success", error: "should-be-dropped" }),
    { runtimeConfig: makeRuntimeConfig(), fetchImpl: stub },
  );

  const parsed = JSON.parse(capturedBody) as { values: string[][] };
  assert.equal(parsed.values[0][9], "");
});

test("createDiscoveryRunsLogger returns a bound append function that shares the dependencies", async () => {
  const { stub } = makeFetchStub([
    {
      match: (c) =>
        c.method === "GET" &&
        c.url.includes(`/values/${encodeURIComponent(`${DISCOVERY_RUNS_SHEET_NAME}!A1:J1`)}`),
      response: () =>
        okJson({
          values: [
            [
              "Run At",
              "Trigger",
              "Status",
              "Duration (s)",
              "Companies Seen",
              "Leads New",
              "Leads Updated",
              "Source",
              "Variation Key",
              "Error",
            ],
          ],
        }),
    },
    {
      match: (c) => c.method === "POST" && c.url.includes(":append"),
      response: () => okJson({}),
    },
  ]);

  const logger = createDiscoveryRunsLogger({
    runtimeConfig: makeRuntimeConfig(),
    fetchImpl: stub,
  });
  const result = await logger.append("sheet-123", makeRow());
  assert.equal(result.ok, true);
});

test("resolveDiscoveryRunLogError keeps success blank and prefers reason over warnings", () => {
  assert.equal(
    resolveDiscoveryRunLogError({
      status: "success",
      reasonMessage: "should not appear",
      warnings: ["grounded timed out"],
    }),
    "",
  );
  assert.equal(
    resolveDiscoveryRunLogError({
      status: "partial",
      reasonMessage: "ATS scout attempted detection but produced no scorable candidates.",
      warnings: ["Grounded search returned no usable candidate links."],
    }),
    "ATS scout attempted detection but produced no scorable candidates.",
  );
  assert.equal(
    resolveDiscoveryRunLogError({
      status: "partial",
      warnings: ["Grounded search returned no usable candidate links."],
    }),
    "Grounded search returned no usable candidate links.",
  );
});

test("buildDiscoveryRunLogRowFromStatus copies reasonMessage into Error for partial", () => {
  const row = buildDiscoveryRunLogRowFromStatus({
    runId: "run_partial",
    status: "partial",
    terminal: true,
    message: "Discovery completed with warnings — worker processed the run.",
    trigger: "manual",
    request: {
      sheetId: "sheet-123",
      variationKey: "var-partial",
      requestedAt: "2026-09-16T16:41:00.000Z",
    },
    acceptedAt: "2026-09-16T16:41:00.000Z",
    startedAt: "2026-09-16T16:41:00.000Z",
    completedAt: "2026-09-16T16:43:42.000Z",
    updatedAt: "2026-09-16T16:43:42.000Z",
    lifecycle: {
      runId: "run_partial",
      trigger: "manual",
      startedAt: "2026-09-16T16:41:00.000Z",
      completedAt: "2026-09-16T16:43:42.000Z",
      state: "partial",
      companyCount: 0,
      detectionCount: 0,
      listingCount: 0,
      normalizedLeadCount: 0,
      reasonMessage:
        "No surface discoveries were made by ATS or browser scouts. Check configured companies, intent keywords, and ATS board availability.",
    },
    writeResult: {
      sheetId: "sheet-123",
      appended: 0,
      updated: 0,
      skippedDuplicates: 0,
      skippedBlacklist: 0,
      warnings: [],
    },
    warnings: ["Grounded search returned no usable candidate links."],
    sources: [],
  });
  assert.equal(row.status, "partial");
  assert.equal(row.companiesSeen, 0);
  assert.equal(row.leadsWritten, 0);
  assert.match(row.error, /No surface discoveries were made/);
});
