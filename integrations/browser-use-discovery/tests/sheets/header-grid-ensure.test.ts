import assert from "node:assert/strict";
import test from "node:test";

import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";
import { SheetWriteError, createPipelineWriter } from "../../src/sheets/pipeline-writer.ts";
import { runtimeConfig } from "./fake-sheets.ts";

const COLUMN_COUNT = PIPELINE_HEADER_ROW.length;
const TAB_ID = 424242;

type RouteOptions = {
  headerRow: string[];
  gridColumns?: number;
  /** Full metadata payload override (e.g. a missing Pipeline tab). */
  metaPayload?: unknown;
  metaStatus?: number;
  metaBody?: string;
  growStatus?: number;
  growBody?: string;
  z1Status?: number;
  z1Body?: string;
  a1y1Status?: number;
  a1y1Body?: string;
};

type RecordedCall = { method: string; url: string; body: string };

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function missingWorkModeHeader(): string[] {
  return [...PIPELINE_HEADER_ROW.slice(0, 25), ""];
}

function createRoutedFetch(route: RouteOptions) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ method, url: url.toString(), body: init.body ? String(init.body) : "" });
    const path = url.pathname;
    // Spreadsheet metadata (grid-width ensure).
    if (method === "GET" && /^\/v4\/spreadsheets\/[^/]+$/.test(path)) {
      if (route.metaStatus && route.metaStatus !== 200) {
        return new Response(route.metaBody ?? "metadata error", { status: route.metaStatus });
      }
      return json(
        route.metaPayload ?? {
          sheets: [
            {
              properties: {
                title: "Pipeline",
                sheetId: TAB_ID,
                gridProperties: { columnCount: route.gridColumns ?? COLUMN_COUNT },
              },
            },
          ],
        },
      );
    }
    // Header read.
    if (method === "GET" && path.includes("/values/") && url.toString().includes("Pipeline!A1")) {
      return json({ values: [route.headerRow] });
    }
    // No Blacklist tab in these tests.
    if (method === "GET" && url.toString().includes("Blacklist!")) {
      return new Response("Unable to parse range", { status: 400 });
    }
    // Identity snapshot / link reads: an empty Pipeline.
    if (method === "GET") {
      return json({ valueRanges: [] });
    }
    // Grid-grow call.
    if (method === "POST" && /:batchUpdate$/.test(path) && !/values:batchUpdate$/.test(path)) {
      if (route.growStatus && route.growStatus !== 200) {
        return new Response(route.growBody ?? "grow error", { status: route.growStatus });
      }
      return json({});
    }
    // Header / cell writes.
    if (method === "POST" && /values:batchUpdate$/.test(path)) {
      const parsed = JSON.parse(String(init.body || "{}")) as {
        data?: Array<{ range?: string }>;
      };
      const ranges = (parsed.data || []).map((entry) => entry.range || "");
      if (ranges.some((range) => range === "Pipeline!Z1") && route.z1Status) {
        return new Response(route.z1Body ?? "z1 error", { status: route.z1Status });
      }
      if (ranges.some((range) => range === "Pipeline!A1:Y1") && route.a1y1Status) {
        return new Response(route.a1y1Body ?? "a1y1 error", { status: route.a1y1Status });
      }
      return json({});
    }
    return json({});
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

function growCalls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter(
    (call) =>
      call.method === "POST" &&
      /:batchUpdate$/.test(new URL(call.url).pathname) &&
      !/values:batchUpdate$/.test(new URL(call.url).pathname),
  );
}

function z1Calls(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter(
    (call) =>
      call.method === "POST" &&
      /values:batchUpdate$/.test(new URL(call.url).pathname) &&
      call.body.includes("Pipeline!Z1"),
  );
}

test("a 25-column grid is grown before the Work Mode Z1 write", async () => {
  const { fetchImpl, calls } = createRoutedFetch({
    headerRow: missingWorkModeHeader(),
    gridColumns: 25,
  });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, retries: 0 });
  const result = await writer.write("sheet_123", []);
  assert.equal(result.updated, 0);

  const grows = growCalls(calls);
  assert.equal(grows.length, 1);
  const request = JSON.parse(grows[0].body).requests[0].updateSheetProperties;
  assert.deepEqual(request, {
    properties: { sheetId: TAB_ID, gridProperties: { columnCount: COLUMN_COUNT } },
    fields: "gridProperties.columnCount",
  });
  const z1s = z1Calls(calls);
  assert.equal(z1s.length, 1);
  assert.ok(calls.indexOf(grows[0]) < calls.indexOf(z1s[0]));
});

test("a 26-column grid skips the grow call but still writes Z1", async () => {
  const { fetchImpl, calls } = createRoutedFetch({
    headerRow: missingWorkModeHeader(),
    gridColumns: 26,
  });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, retries: 0 });
  await writer.write("sheet_123", []);
  assert.equal(growCalls(calls).length, 0);
  assert.equal(z1Calls(calls).length, 1);
});

test("a wider grid is never shrunk", async () => {
  const { fetchImpl, calls } = createRoutedFetch({
    headerRow: missingWorkModeHeader(),
    gridColumns: 30,
  });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, retries: 0 });
  await writer.write("sheet_123", []);
  assert.equal(growCalls(calls).length, 0);
  assert.equal(z1Calls(calls).length, 1);
});

test("a grid-metadata failure yields a phase update error containing the body", async () => {
  const body = JSON.stringify({
    error: { code: 400, message: "GRID_READ_BOOM", status: "INVALID_ARGUMENT" },
  });
  const { fetchImpl } = createRoutedFetch({
    headerRow: missingWorkModeHeader(),
    metaStatus: 400,
    metaBody: body,
  });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, retries: 0 });
  const error = await writer.write("sheet_123", []).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof SheetWriteError);
  assert.equal(error.phase, "update");
  assert.equal(error.httpStatus, 400);
  assert.match(error.message, /Work Mode header upgrade/);
  assert.match(error.message, /GRID_READ_BOOM/);
  assert.match(error.detail || "", /GRID_READ_BOOM/);
});

test("a grid-grow failure yields a phase update error containing the body", async () => {
  const body = JSON.stringify({
    error: { code: 400, message: "GRID_GROW_BOOM", status: "INVALID_ARGUMENT" },
  });
  const { fetchImpl } = createRoutedFetch({
    headerRow: missingWorkModeHeader(),
    gridColumns: 25,
    growStatus: 400,
    growBody: body,
  });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, retries: 0 });
  const error = await writer.write("sheet_123", []).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof SheetWriteError);
  assert.equal(error.phase, "update");
  assert.equal(error.httpStatus, 400);
  assert.match(error.message, /GRID_GROW_BOOM/);
  assert.match(error.detail || "", /GRID_GROW_BOOM/);
});

test("a missing Pipeline tab in metadata fails the header upgrade", async () => {
  const { fetchImpl } = createRoutedFetch({
    headerRow: missingWorkModeHeader(),
    metaPayload: { sheets: [{ properties: { title: "Other", sheetId: 9 } }] },
  });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, retries: 0 });
  const error = await writer.write("sheet_123", []).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof SheetWriteError);
  assert.equal(error.phase, "update");
  assert.match(error.message, /Pipeline/);
});

test("a Z1-write 400 carries Google's response body", async () => {
  const body = JSON.stringify({
    error: {
      code: 400,
      message: "Z1_WRITE_BOOM: Invalid range",
      status: "INVALID_ARGUMENT",
    },
  });
  const { fetchImpl } = createRoutedFetch({
    headerRow: missingWorkModeHeader(),
    gridColumns: 26,
    z1Status: 400,
    z1Body: body,
  });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, retries: 0 });
  const error = await writer.write("sheet_123", []).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof SheetWriteError);
  assert.equal(error.phase, "update");
  assert.equal(error.httpStatus, 400);
  assert.match(error.message, /Work Mode header upgrade: HTTP 400/);
  assert.match(error.message, /Z1_WRITE_BOOM/);
  assert.match(error.detail || "", /Z1_WRITE_BOOM/);
});

test("an A1:Y1-write 400 carries Google's response body", async () => {
  const body = JSON.stringify({
    error: {
      code: 400,
      message: "A1Y1_WRITE_BOOM: Invalid range",
      status: "INVALID_ARGUMENT",
    },
  });
  const { fetchImpl } = createRoutedFetch({
    headerRow: [...PIPELINE_HEADER_ROW.slice(0, 17), ...Array(8).fill(""), "Work Mode"],
    gridColumns: 26,
    a1y1Status: 400,
    a1y1Body: body,
  });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, retries: 0 });
  const error = await writer.write("sheet_123", []).then(
    () => null,
    (failure: unknown) => failure,
  );
  assert.ok(error instanceof SheetWriteError);
  assert.equal(error.phase, "update");
  assert.equal(error.httpStatus, 400);
  assert.match(error.message, /header upgrade: HTTP 400/);
  assert.match(error.message, /A1Y1_WRITE_BOOM/);
  assert.match(error.detail || "", /A1Y1_WRITE_BOOM/);
});
