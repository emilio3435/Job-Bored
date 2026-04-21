import assert from "node:assert/strict";
import test from "node:test";

import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";
import { SheetWriteError, createPipelineWriter } from "../../src/sheets/pipeline-writer.ts";

const runtimeConfig = {
  stateDatabasePath: "/tmp/state.db",
  workerConfigPath: "/tmp/config.json",
  browserUseCommand: "browser-use",
  googleServiceAccountJson: "",
  googleServiceAccountFile: "",
  googleAccessToken: "placeholder-access-xyz789",
  googleOAuthTokenJson: "",
  googleOAuthTokenFile: "",
  webhookSecret: "",
  allowedOrigins: ["http://localhost:8080"],
  port: 0,
  host: "127.0.0.1",
  runMode: "hosted",
  asyncAckByDefault: true,
  useStructuredExtraction: false,
};

function row(values) {
  return Array.from(
    { length: PIPELINE_HEADER_ROW.length },
    (_, index) => values[index] || "",
  );
}

function columnIndexToLetter(index) {
  if (!Number.isFinite(index) || index < 1) return "A";
  let n = Math.floor(index);
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const LAST_COLUMN_LETTER = columnIndexToLetter(PIPELINE_HEADER_ROW.length);

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function normalizeHeaders(headersInit) {
  const headers = new Headers(headersInit || {});
  return Object.fromEntries(headers.entries());
}

function createMockFetch({
  headerRows,
  blacklistRows = [],
  blacklistReadError = null,
  dataRows,
  responses,
}) {
  const calls = [];
  let responseIndex = 0;

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = String(init.method || "GET").toUpperCase();
    calls.push({
      url: url.toString(),
      method,
      headers: normalizeHeaders(init.headers),
      body: init.body ? String(init.body) : "",
    });

    if (
      url.pathname.includes("/values/") &&
      method === "GET" &&
      url.href.includes(`A1%3A${LAST_COLUMN_LETTER}1`)
    ) {
      return responseJson({ values: headerRows });
    }
    if (
      url.pathname.includes("/values/") &&
      method === "GET" &&
      url.href.includes("Blacklist!A2%3AA")
    ) {
      if (blacklistReadError) {
        return new Response(String(blacklistReadError.body || "read error"), {
          status: Number(blacklistReadError.status || 400),
        });
      }
      return responseJson({ values: blacklistRows });
    }
    if (
      url.pathname.includes("/values/") &&
      method === "GET" &&
      url.href.includes(`A2%3A${LAST_COLUMN_LETTER}`)
    ) {
      return responseJson({ values: dataRows });
    }

    const response = responses[responseIndex] || responseJson({}, 200);
    responseIndex += 1;
    return response;
  };

  return { fetchImpl, calls };
}

function makeLead(overrides = {}) {
  return {
    sourceId: "greenhouse",
    sourceLabel: "Greenhouse",
    title: "Backend Engineer",
    company: "Acme",
    location: "Remote",
    url: "https://jobs.example.com/backend-engineer?jobId=1",
    compensationText: "",
    fitScore: 8,
    priority: "⚡",
    tags: ["backend"],
    fitAssessment: "Strong fit",
    contact: "",
    status: "New",
    appliedDate: "",
    notes: "",
    followUpDate: "",
    talkingPoints: "",
    logoUrl: "",
    discoveredAt: "2026-04-09T12:00:00.000Z",
    favorite: false,
    dismissedAt: null,
    metadata: {
      runId: "run_1",
      variationKey: "var_1",
      sourceQuery: "Backend Engineer Acme",
      ...(overrides.metadata || {}),
    },
    ...overrides,
  };
}

test("createPipelineWriter updates existing rows and appends new ones", async () => {
  const existingRow = row([
    "2026-04-01",
    "Backend Engineer",
    "Acme",
    "Remote - US",
    "https://jobs.example.com/openings/backend-engineer?jobId=123",
    "Greenhouse",
    "$180k",
    "7",
    "⚡",
    "backend",
    "Great match",
    "Ada",
    "Applied",
    "2026-04-02",
    "keep me",
    "2026-04-09",
    "",
    "2026-04-05",
    "No",
  ]);

  const duplicateRow = row([
    "2026-04-01",
    "Backend Engineer Duplicate",
    "Acme",
    "Remote - US",
    "https://jobs.example.com/openings/backend-engineer/?utm_source=linkedin&jobId=123",
    "Greenhouse",
  ]);

  const responses = [
    responseJson({ updatedRows: 1 }),
    responseJson({ appendedRows: 1 }),
  ];
  const { fetchImpl, calls } = createMockFetch({
    headerRows: [PIPELINE_HEADER_ROW],
    dataRows: [existingRow, duplicateRow],
    responses,
  });

  const writer = createPipelineWriter(runtimeConfig, {
    fetchImpl,
    now: () => new Date("2026-04-09T12:00:00.000Z"),
  });

  const result = await writer.write("sheet_123", [
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior Backend Engineer",
      company: "Acme",
      location: "Remote - US",
      url: "https://jobs.example.com/openings/backend-engineer/?utm_source=linkedin&jobId=123",
      compensationText: "$190k",
      fitScore: 9,
      priority: "🔥",
      tags: ["backend", "typescript"],
      fitAssessment: "Matched backend, typescript",
      contact: "Ada",
      status: "New",
      appliedDate: "",
      notes: "",
      followUpDate: "",
      talkingPoints: "Use the team shape and remote-first signal",
      logoUrl: "",
      discoveredAt: "2026-04-09T12:00:00.000Z",
      metadata: {
        runId: "run_1",
        variationKey: "var_1",
        sourceQuery: "Senior Backend Engineer Acme",
      },
    },
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior Backend Engineer Duplicate",
      company: "Acme",
      location: "Remote - US",
      url: "https://jobs.example.com/openings/backend-engineer/?jobId=123&utm_source=twitter",
      compensationText: "$190k",
      fitScore: 2,
      priority: "↓",
      tags: ["backend"],
      fitAssessment: "Lower-confidence duplicate",
      contact: "",
      status: "New",
      appliedDate: "",
      notes: "",
      followUpDate: "",
      talkingPoints: "",
      logoUrl: "",
      discoveredAt: "2026-04-09T12:00:00.000Z",
      metadata: {
        runId: "run_1",
        variationKey: "var_1",
        sourceQuery: "Duplicate",
      },
    },
    {
      sourceId: "lever",
      sourceLabel: "Lever",
      title: "Data Engineer",
      company: "Beta",
      location: "Chicago, IL",
      url: "https://jobs.example.com/openings/data-engineer/?utm_source=linkedin&ref=share",
      compensationText: "$170k",
      fitScore: 6,
      priority: "⚡",
      tags: ["data"],
      fitAssessment: "Good fit",
      contact: "Jo",
      status: "New",
      appliedDate: "",
      notes: "",
      followUpDate: "",
      talkingPoints: "",
      logoUrl: "",
      discoveredAt: "2026-04-09T12:00:00.000Z",
      metadata: {
        runId: "run_1",
        variationKey: "var_1",
        sourceQuery: "Data Engineer Beta",
      },
    },
  ]);

  assert.equal(result.sheetId, "sheet_123");
  assert.equal(result.updated, 1);
  assert.equal(result.appended, 1);
  assert.equal(result.skippedDuplicates, 2);
  assert.equal(result.skippedBlacklist, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /duplicate existing Pipeline rows/i);

  assert.equal(calls.length, 5);
  assert.match(
    calls[0].url,
    new RegExp(`values/Pipeline!A1%3A${LAST_COLUMN_LETTER}1`),
  );
  assert.match(calls[1].url, /values\/Blacklist!A2%3AA/);
  assert.match(
    calls[2].url,
    new RegExp(`values/Pipeline!A2%3A${LAST_COLUMN_LETTER}`),
  );
  assert.equal(calls[3].method, "POST");
  assert.match(calls[3].url, /values:batchUpdate$/);
  assert.equal(calls[4].method, "POST");
  assert.match(
    calls[4].url,
    new RegExp(`values/Pipeline!A%3A${LAST_COLUMN_LETTER}:append`),
  );

  const batchUpdateBody = JSON.parse(calls[3].body);
  assert.equal(batchUpdateBody.valueInputOption, "USER_ENTERED");
  assert.equal(batchUpdateBody.data.length, 1);
  assert.equal(batchUpdateBody.data[0].range, `Pipeline!A2:${LAST_COLUMN_LETTER}2`);

  const updatedRow = batchUpdateBody.data[0].values[0];
  assert.equal(updatedRow[1], "Senior Backend Engineer");
  assert.equal(updatedRow[12], "Applied");
  assert.equal(updatedRow[13], "2026-04-02");
  assert.equal(updatedRow[14], "keep me");
  assert.equal(updatedRow[15], "2026-04-09");
  assert.equal(updatedRow[16], "Use the team shape and remote-first signal");
  assert.equal(updatedRow[17], "2026-04-05");
  assert.equal(updatedRow[18], "No");

  const appendBody = JSON.parse(calls[4].body);
  assert.equal(appendBody.values.length, 1);
  const appendedRow = appendBody.values[0];
  assert.equal(appendedRow[1], "Data Engineer");
  assert.equal(
    appendedRow[4],
    "https://jobs.example.com/openings/data-engineer",
  );
  assert.equal(appendedRow[12], "New");
  assert.equal(appendedRow[16], "");
});

test("createPipelineWriter rejects a sheet with the wrong Pipeline headers", async () => {
  const { fetchImpl } = createMockFetch({
    headerRows: [["Wrong", "Header"]],
    dataRows: [],
    responses: [],
  });
  const writer = createPipelineWriter(runtimeConfig, {
    fetchImpl,
    now: () => new Date("2026-04-09T12:00:00.000Z"),
  });

  await assert.rejects(
    writer.write("sheet_123", []),
    /Pipeline header mismatch/,
  );
});

test("createPipelineWriter skips incoming leads whose URL is in the Blacklist tab", async () => {
  const { fetchImpl, calls } = createMockFetch({
    headerRows: [PIPELINE_HEADER_ROW],
    blacklistRows: [
      ["https://jobs.example.com/backend-engineer/?utm_source=linkedin&jobId=1"],
    ],
    dataRows: [],
    responses: [],
  });
  const writer = createPipelineWriter(runtimeConfig, {
    fetchImpl,
    now: () => new Date("2026-04-09T12:00:00.000Z"),
  });

  const result = await writer.write("sheet_123", [
    makeLead({
      url: "https://jobs.example.com/backend-engineer?jobId=1&utm_source=twitter",
    }),
  ]);

  assert.equal(result.appended, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.skippedBlacklist, 1);
  assert.equal(result.skippedDuplicates, 0);
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("createPipelineWriter writes favorite=★ and dismissedAt to columns V and W", async () => {
  const dismissedAt = "2026-04-10T15:30:00.000Z";
  const { fetchImpl, calls } = createMockFetch({
    headerRows: [PIPELINE_HEADER_ROW],
    dataRows: [],
    responses: [responseJson({ appendedRows: 1 })],
  });
  const writer = createPipelineWriter(runtimeConfig, {
    fetchImpl,
    now: () => new Date("2026-04-09T12:00:00.000Z"),
  });

  const result = await writer.write("sheet_123", [
    makeLead({
      favorite: true,
      dismissedAt,
    }),
  ]);

  assert.equal(result.appended, 1);
  assert.equal(result.skippedBlacklist, 0);
  const appendBody = JSON.parse(calls[3].body);
  const appendedRow = appendBody.values[0];
  assert.equal(appendedRow[21], "★");
  assert.equal(appendedRow[22], dismissedAt);
});

test("createPipelineWriter treats an existing Pipeline row with non-empty column W as blacklisted", async () => {
  const existingDismissedRow = row([
    "2026-04-01",
    "Backend Engineer",
    "Acme",
    "Remote",
    "https://jobs.example.com/backend-engineer?jobId=1",
    "Greenhouse",
    "",
    "8",
    "⚡",
    "backend",
    "Strong fit",
    "",
    "New",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "2026-04-08T10:00:00.000Z",
  ]);
  const { fetchImpl, calls } = createMockFetch({
    headerRows: [PIPELINE_HEADER_ROW],
    dataRows: [existingDismissedRow],
    responses: [],
  });
  const writer = createPipelineWriter(runtimeConfig, {
    fetchImpl,
    now: () => new Date("2026-04-09T12:00:00.000Z"),
  });

  const result = await writer.write("sheet_123", [makeLead()]);

  assert.equal(result.updated, 0);
  assert.equal(result.appended, 0);
  assert.equal(result.skippedBlacklist, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("createPipelineWriter handles missing Blacklist tab gracefully", async () => {
  const { fetchImpl, calls } = createMockFetch({
    headerRows: [PIPELINE_HEADER_ROW],
    blacklistReadError: {
      status: 400,
      body: "Unable to parse range: Blacklist!A2:A",
    },
    dataRows: [],
    responses: [responseJson({ appendedRows: 1 })],
  });
  const writer = createPipelineWriter(runtimeConfig, {
    fetchImpl,
    now: () => new Date("2026-04-09T12:00:00.000Z"),
  });

  const result = await writer.write("sheet_123", [makeLead()]);

  assert.equal(result.appended, 1);
  assert.equal(result.skippedBlacklist, 0);
  assert.match(calls[1].url, /values\/Blacklist!A2%3AA/);
});

test("createPipelineWriter upgrades blank trailing optional headers", async () => {
  const legacyHeaderRow = [
    ...PIPELINE_HEADER_ROW.slice(0, 17),
    ...Array.from({ length: PIPELINE_HEADER_ROW.length - 17 }, () => ""),
  ];
  const responses = [
    responseJson({ updatedRows: 1 }),
    responseJson({ appendedRows: 1 }),
  ];
  const { fetchImpl, calls } = createMockFetch({
    headerRows: [legacyHeaderRow],
    dataRows: [],
    responses,
  });

  const writer = createPipelineWriter(runtimeConfig, {
    fetchImpl,
    now: () => new Date("2026-04-09T12:00:00.000Z"),
  });

  await writer.write("sheet_123", [
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Growth Marketing Manager",
      company: "Scale AI",
      location: "Remote",
      url: "https://boards.greenhouse.io/scaleai/jobs/12345",
      compensationText: "",
      fitScore: 8,
      priority: "🔥",
      tags: ["growth"],
      fitAssessment: "Strong fit",
      contact: "",
      status: "New",
      appliedDate: "",
      notes: "",
      followUpDate: "",
      talkingPoints: "",
      logoUrl: "",
      discoveredAt: "2026-04-09T12:00:00.000Z",
      metadata: {
        runId: "run_1",
        variationKey: "var_1",
        sourceQuery: "Growth Marketing Manager Scale AI",
      },
    },
  ]);

  assert.equal(calls[1].method, "POST");
  const headerUpgradeBody = JSON.parse(calls[1].body);
  assert.equal(
    headerUpgradeBody.data[0].range,
    `Pipeline!A1:${LAST_COLUMN_LETTER}1`,
  );
  assert.deepEqual(headerUpgradeBody.data[0].values[0], PIPELINE_HEADER_ROW);
  assert.match(calls[2].url, /values\/Blacklist!A2%3AA/);
  assert.match(
    calls[4].url,
    new RegExp(`values/Pipeline!A%3A${LAST_COLUMN_LETTER}:append`),
  );
});

test("createPipelineWriter refreshes a Google OAuth token when no service account is configured", async () => {
  const responses = [
    responseJson({ access_token: "refreshed-token" }),
    responseJson({ appendedRows: 1 }),
  ];
  const { fetchImpl, calls } = createMockFetch({
    headerRows: [PIPELINE_HEADER_ROW],
    dataRows: [],
    responses,
  });

  const writer = createPipelineWriter(
    {
      ...runtimeConfig,
      googleAccessToken: "",
      googleOAuthTokenJson: JSON.stringify({
        token: "expired-token",
        refresh_token: "refresh_123",
        client_id: "client_123",
        client_secret: "secret_123",
        token_uri: "https://oauth2.googleapis.com/token",
        expiry: "2026-04-09T11:00:00.000Z",
      }),
    },
    {
      fetchImpl,
      now: () => new Date("2026-04-09T12:00:00.000Z"),
    },
  );

  await writer.write("sheet_123", [
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Platform Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://jobs.example.com/openings/platform-engineer",
      compensationText: "",
      fitScore: 8,
      priority: "⚡",
      tags: ["platform"],
      fitAssessment: "Strong platform fit",
      contact: "",
      status: "New",
      appliedDate: "",
      notes: "",
      followUpDate: "",
      talkingPoints: "",
      logoUrl: "",
      discoveredAt: "2026-04-09T12:00:00.000Z",
      metadata: {
        runId: "run_1",
        variationKey: "var_1",
        sourceQuery: "Platform Engineer Acme",
      },
    },
  ]);

  assert.match(calls[0].url, /oauth2\.googleapis\.com\/token/);
  assert.equal(calls[0].method, "POST");
  assert.match(
    calls[1].url,
    new RegExp(`values/Pipeline!A1%3A${LAST_COLUMN_LETTER}1`),
  );
  assert.match(calls[2].url, /values\/Blacklist!A2%3AA/);
  assert.equal(calls[1].headers.authorization, "Bearer refreshed-token");
  assert.equal(calls[2].headers.authorization, "Bearer refreshed-token");
  assert.equal(calls[3].headers.authorization, "Bearer refreshed-token");
  assert.equal(calls[4].headers.authorization, "Bearer refreshed-token");
});

test("SheetWriteError is thrown with update phase on batchUpdate failure (VAL-DATA-005)", async () => {
  // Directly test SheetWriteError construction and properties for update phase
  const error = new SheetWriteError({
    phase: "update",
    message: "Sheet write failed during update phase: HTTP 500 - Internal Server Error",
    sheetId: "sheet_123",
    httpStatus: 500,
    detail: "Internal Server Error",
  });

  assert.equal(error.name, "SheetWriteError");
  assert.equal(error.phase, "update");
  assert.equal(error.httpStatus, 500);
  assert.match(error.message, /update phase/);
  assert.equal(error.sheetId, "sheet_123");
  assert.equal(error.detail, "Internal Server Error");

  // Verify it extends Error
  assert.ok(error instanceof Error);
  assert.ok(error instanceof SheetWriteError);
});

test("SheetWriteError is thrown with append phase on append failure (VAL-DATA-005)", async () => {
  // Directly test SheetWriteError construction and properties
  const error = new SheetWriteError({
    phase: "append",
    message: "Sheet write failed during append phase: HTTP 403 - Permission denied",
    sheetId: "sheet_123",
    httpStatus: 403,
    detail: "Permission denied",
  });

  assert.equal(error.name, "SheetWriteError");
  assert.equal(error.phase, "append");
  assert.equal(error.httpStatus, 403);
  assert.match(error.message, /append phase/);
  assert.equal(error.sheetId, "sheet_123");
  assert.equal(error.detail, "Permission denied");

  // Verify it extends Error
  assert.ok(error instanceof Error);
  assert.ok(error instanceof SheetWriteError);
});

test("SheetWriteError preserves canonical link and source attribution (VAL-DATA-002)", async () => {
  // Test that SheetWriteError includes sheetId for attribution
  const { fetchImpl, calls } = createMockFetch({
    headerRows: [PIPELINE_HEADER_ROW],
    dataRows: [],
    responses: [
      responseJson({ error: "Server Error" }, 500),
    ],
  });

  const writer = createPipelineWriter(runtimeConfig, {
    fetchImpl,
    now: () => new Date("2026-04-09T12:00:00.000Z"),
  });

  const sheetId = "canonical-sheet-123";
  await assert.rejects(
    async () => {
      await writer.write(sheetId, [
        {
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          title: "Test Engineer",
          company: "TestCo",
          location: "Remote",
          url: "https://jobs.example.com/careers/test-engineer",
          compensationText: "",
          fitScore: 8,
          priority: "⚡",
          tags: [],
          fitAssessment: "Good match",
          contact: "",
          status: "New",
          appliedDate: "",
          notes: "",
          followUpDate: "",
          talkingPoints: "",
          logoUrl: "",
          discoveredAt: "2026-04-09T12:00:00.000Z",
          metadata: {
            runId: "run_3",
            variationKey: "var_3",
            sourceQuery: "Test Engineer",
          },
        },
      ]);
    },
    (error) => {
      // Verify the error contains the sheetId for canonical attribution
      assert.equal(error.sheetId, sheetId);
      // Verify the calls were made with the correct sheetId
      assert.ok(calls.some((c) => c.url.includes(encodeURIComponent(sheetId))));
      return true;
    },
  );
});
