// HOLES KEEP (substrate for R3, R7, R16): Scorer, Last Seen and Possible
// Duplicate append at AA–AC. A Sheet without them gains them on a writer
// touch; a custom label there is never overwritten; a grid that cannot grow
// still gets its leads written.
import assert from "node:assert/strict";
import test from "node:test";

import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";
import { createPipelineWriter } from "../../src/sheets/pipeline-writer.ts";
import { checkPipelineHeader } from "../../src/sheets/sheets-client.ts";
import { createFakeSheets, lead, runtimeConfig } from "./fake-sheets.ts";

const A_TO_Z = PIPELINE_HEADER_ROW.slice(0, 26);
const NOW = new Date("2026-10-02T15:00:00.000Z");

/** fake-sheets plus a grid: writes past the last column fail like Google's. */
function sheetWithGrid(header: string[], gridColumns: number, opts: { growStatus?: number } = {}) {
  const sheet = createFakeSheets({ Pipeline: [header] });
  let columns = gridColumns;
  const lastIndexOf = (range: string) => {
    const ref = range.slice(range.lastIndexOf("!") + 1).split(":").at(-1) || "";
    const letters = /^[A-Z]+/.exec(ref)?.[0] || "A";
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  };
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = String(init.method || "GET").toUpperCase();
    if (method === "GET" && /^\/v4\/spreadsheets\/[^/]+$/.test(url.pathname)) {
      return new Response(
        JSON.stringify({
          sheets: [{ properties: { title: "Pipeline", sheetId: 7, gridProperties: { columnCount: columns } } }],
        }),
        { status: 200 },
      );
    }
    if (method === "POST" && /:batchUpdate$/.test(url.pathname) && !/values:batchUpdate$/.test(url.pathname)) {
      const body = JSON.parse(String(init.body || "{}"));
      const grow = body.requests?.find((r: { appendDimension?: unknown }) => r.appendDimension)?.appendDimension;
      if (grow) {
        if (opts.growStatus) return new Response("grow refused", { status: opts.growStatus });
        columns += grow.length;
        return new Response("{}", { status: 200 });
      }
    }
    if (method === "GET" && url.pathname.includes("/values/") &&
        lastIndexOf(decodeURIComponent(url.pathname.split("/values/")[1] || "")) > columns) {
      return new Response(`Range exceeds grid limits. Max columns: ${columns}`, { status: 400 });
    }
    if (method === "GET" && /values:batchGet$/.test(url.pathname) &&
        url.searchParams.getAll("ranges").some((range) => lastIndexOf(range) > columns)) {
      return new Response(`Range exceeds grid limits. Max columns: ${columns}`, { status: 400 });
    }
    if (method !== "GET") {
      const body = JSON.parse(String(init.body || "{}"));
      const ranges: string[] = /:append$/.test(url.pathname)
        ? [decodeURIComponent(url.pathname.split("/values/")[1] || "")]
        : (body.data || []).map((d: { range: string }) => d.range);
      const widest = Math.max(
        0,
        ...ranges.map(lastIndexOf),
        ...(body.values || []).map((row: unknown[]) => row.length),
      );
      if (widest > columns) {
        return new Response(`Range exceeds grid limits. Max columns: ${columns}`, { status: 400 });
      }
    }
    return sheet.fetchImpl(input, init);
  }) as typeof fetch;
  return { sheet, fetchImpl, columns: () => columns };
}

test("an A–Z Sheet gains Scorer, Last Seen and Possible Duplicate at AA–AC on a writer touch", async () => {
  const { sheet, fetchImpl, columns } = sheetWithGrid(A_TO_Z, 26);
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, now: () => NOW, retries: 0 });
  const result = await writer.write("sheet_1", [lead({ scorer: "llm:gemini-flash" })]);
  assert.equal(result.appended, 1);
  assert.ok(columns() >= 29, "the grid grew to fit AA–AC");
  const rows = sheet.tabs.get("Pipeline")!;
  assert.deepEqual(rows[0].slice(26, 29), ["Scorer", "Last Seen", "Possible Duplicate"]);
  assert.equal(rows[1][1], "Engineer");
});

test("a custom AA header is left alone and never written; AB and AC still are", async () => {
  const { sheet, fetchImpl } = sheetWithGrid([...A_TO_Z, "My notes"], 29);
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, now: () => NOW, retries: 0 });
  await writer.write("sheet_1", [lead({ scorer: "heuristic" })]);
  const rows = sheet.tabs.get("Pipeline")!;
  assert.equal(rows[0][26], "My notes");
  assert.deepEqual(rows[0].slice(27, 29), ["Last Seen", "Possible Duplicate"]);
  assert.equal(rows[1][26] || "", "", "nothing is written under a custom header");
});

test("when the grid cannot grow, leads are still written without AA–AC", async () => {
  const { sheet, fetchImpl } = sheetWithGrid(A_TO_Z, 26, { growStatus: 403 });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl, now: () => NOW, retries: 0 });
  const result = await writer.write("sheet_1", [lead({})]);
  assert.equal(result.appended, 1);
  assert.equal(sheet.tabs.get("Pipeline")![1][1], "Engineer");
  assert.ok(
    result.warnings.some((w) => /Scorer|Last Seen|Possible Duplicate/.test(w)),
    result.warnings.join(" | "),
  );
});

test("custom labels after Z never block a write", () => {
  const state = checkPipelineHeader([...A_TO_Z, "Mine 1", "Mine 2", "Mine 3"]);
  assert.deepEqual(state.extensionHeaders, {
    scorer: "foreign",
    lastSeen: "foreign",
    possibleDuplicate: "foreign",
  });
});
