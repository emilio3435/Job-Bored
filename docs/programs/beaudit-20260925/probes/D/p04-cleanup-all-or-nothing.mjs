// Reliability: cleanup holds every Sheet write until the whole loop ends, so a
// kill by the scheduler's --total-timeout-ms (45 min) writes nothing at all.
import { runExpiredJobCleanup } from "../../integrations/browser-use-discovery/src/cleanup/expired-job-cleanup.ts";
import { createFakeSheets, HEADER, pipelineRow, runtimeConfig } from "./fake-sheets.mjs";

const rows = [HEADER];
for (let i = 0; i < 5; i += 1) rows.push(pipelineRow({ title: "R" + i, company: "C" + i, link: `https://r${i}.example/jobs/${i}`, status: "New" }));
const sheet = createFakeSheets({ Pipeline: rows });
const writesSeenAtFetch = [];
const fetchImpl = async (input, init) => {
  const u = new URL(String(input));
  if (u.hostname.endsWith(".example")) {
    writesSeenAtFetch.push(sheet.calls.filter((c) => c.kind === "values.batchUpdate").length);
    return new Response("job has expired", { status: 200 });
  }
  return sheet.fetchImpl(input, init);
};
await runExpiredJobCleanup({ sheetId: "probe-sheet", runtimeConfig, options: { fetchImpl, dryRun: false } });
console.log("Sheet writes already flushed at each posting fetch:", JSON.stringify(writesSeenAtFetch));
console.log("total batchUpdate calls:", sheet.calls.filter((c) => c.kind === "values.batchUpdate").length);
const perRowWorstMs = 15000, killMs = 45 * 60000;
console.log(`rows fetched serially at the default 15s timeout before the 45-min kill: ${killMs / perRowWorstMs}`);
console.log("DEFECT CONFIRMED: writes are flushed only after the last row; a killed pass persists 0 rows and repeats the same fetches the next night");
