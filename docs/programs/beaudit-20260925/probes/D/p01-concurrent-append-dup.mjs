// Seed Q1 / PIPE-07: two concurrent runs append the same URL twice.
import { createPipelineWriter } from "../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts";
import { createFakeSheets, HEADER, lead, runtimeConfig } from "./fake-sheets.mjs";

const sheet = createFakeSheets({ Pipeline: [HEADER] });
let arrivals = 0; let release;
const barrier = new Promise((r) => (release = r));
sheet.hooks.onRead = async (range) => {
  if (range === "Pipeline!A2:Y") { arrivals += 1; if (arrivals === 2) release(); await barrier; }
};
const w1 = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl });
const w2 = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl });
const L = lead({ url: "https://boards.greenhouse.io/acme/jobs/1" });
const [a, b] = await Promise.all([w1.write("probe-sheet", [L]), w2.write("probe-sheet", [{ ...L }])]);
console.log("run1", JSON.stringify({ appended: a.appended, updated: a.updated }));
console.log("run2", JSON.stringify({ appended: b.appended, updated: b.updated }));
const rows = sheet.tabs.get("Pipeline").slice(1);
console.log("pipeline data rows:", rows.length, "links:", rows.map((r) => r[4]).join(" , "));
// Next run sees the duplicate and only warns; it never merges them.
const w3 = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl });
sheet.hooks.onRead = null;
const c = await w3.write("probe-sheet", [{ ...L }]);
console.log("run3 warnings:", JSON.stringify(c.warnings), "rows now:", sheet.tabs.get("Pipeline").length - 1);
console.log(rows.length === 2 ? "DEFECT CONFIRMED: duplicate row for one URL" : "no duplicate");
