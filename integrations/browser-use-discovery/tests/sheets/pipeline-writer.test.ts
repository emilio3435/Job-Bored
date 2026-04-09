import assert from "node:assert/strict";
import test from "node:test";

import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";
import { createPipelineWriter } from "../../src/sheets/pipeline-writer.ts";

const runtimeConfig = {
  stateDatabasePath: "/tmp/state.db",
  workerConfigPath: "/tmp/config.json",
  browserUseCommand: "browser-use",
  googleServiceAccountJson: "",
  googleServiceAccountFile: "",
  googleAccessToken: "test-token",
  webhookSecret: "",
  allowedOrigins: ["http://localhost:8080"],
  port: 0,
  host: "127.0.0.1",
  runMode: "hosted",
  asyncAckByDefault: true,
};

function row(values) {
  return Array.from(
    { length: PIPELINE_HEADER_ROW.length },
    (_, index) => values[index] || "",
  );
}

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createMockFetch({ headerRows, dataRows, responses }) {
  const calls = [];
  let responseIndex = 0;

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = String(init.method || "GET").toUpperCase();
    calls.push({
      url: url.toString(),
      method,
      body: init.body ? String(init.body) : "",
    });

    if (
      url.pathname.includes("/values/") &&
      method === "GET" &&
      url.href.includes("A1%3AS1")
    ) {
      return responseJson({ values: headerRows });
    }
    if (
      url.pathname.includes("/values/") &&
      method === "GET" &&
      url.href.includes("A2%3AS")
    ) {
      return responseJson({ values: dataRows });
    }

    const response = responses[responseIndex] || responseJson({}, 200);
    responseIndex += 1;
    return response;
  };

  return { fetchImpl, calls };
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

  const responses = [responseJson({ updatedRows: 1 }), responseJson({ appendedRows: 1 })];
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
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /duplicate existing Pipeline rows/i);

  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /values\/Pipeline!A1%3AS1/);
  assert.match(calls[1].url, /values\/Pipeline!A2%3AS/);
  assert.equal(calls[2].method, "POST");
  assert.match(calls[2].url, /values:batchUpdate$/);
  assert.equal(calls[3].method, "POST");
  assert.match(calls[3].url, /values\/Pipeline!A%3AS:append/);

  const batchUpdateBody = JSON.parse(calls[2].body);
  assert.equal(batchUpdateBody.valueInputOption, "USER_ENTERED");
  assert.equal(batchUpdateBody.data.length, 1);
  assert.equal(batchUpdateBody.data[0].range, "Pipeline!A2:S2");

  const updatedRow = batchUpdateBody.data[0].values[0];
  assert.equal(updatedRow[1], "Senior Backend Engineer");
  assert.equal(updatedRow[12], "Applied");
  assert.equal(updatedRow[13], "2026-04-02");
  assert.equal(updatedRow[14], "keep me");
  assert.equal(updatedRow[15], "2026-04-09");
  assert.equal(updatedRow[16], "Use the team shape and remote-first signal");
  assert.equal(updatedRow[17], "2026-04-05");
  assert.equal(updatedRow[18], "No");

  const appendBody = JSON.parse(calls[3].body);
  assert.equal(appendBody.values.length, 1);
  const appendedRow = appendBody.values[0];
  assert.equal(appendedRow[1], "Data Engineer");
  assert.equal(appendedRow[4], "https://jobs.example.com/openings/data-engineer");
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

  await assert.rejects(writer.write("sheet_123", []), /Pipeline header mismatch/);
});
