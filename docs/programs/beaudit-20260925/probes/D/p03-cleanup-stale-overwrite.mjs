// PIPE-06 / Seed Q2: expired cleanup writes M+O by stale row number after a
// long serial fetch loop; a user's mid-run edits are overwritten.
import { runExpiredJobCleanup } from "../../integrations/browser-use-discovery/src/cleanup/expired-job-cleanup.ts";
import { createFakeSheets, HEADER, pipelineRow, runtimeConfig } from "./fake-sheets.mjs";

const X = pipelineRow({ title: "X", company: "Xco", link: "https://x.example/jobs/1", status: "New", notes: "old note", followUp: "2026-10-01" });
const Y = pipelineRow({ title: "Y", company: "Yco", link: "https://y.example/jobs/2", status: "New" });
const sheet = createFakeSheets({ Pipeline: [HEADER, X, Y] });
let postingFetches = 0;
const fetchImpl = async (input, init) => {
  const u = new URL(String(input));
  if (u.hostname.endsWith(".example")) {
    postingFetches += 1;
    // While cleanup is fetching postings (minutes on a real sheet), the user
    // moves X to Applied and writes a note in the Sheet.
    const rows = sheet.tabs.get("Pipeline");
    rows[1][12] = "Applied"; rows[1][14] = "old note\nuser: applied today, ref #123";
    return new Response("<html>This job has expired</html>", { status: 200 });
  }
  return sheet.fetchImpl(input, init);
};
const res = await runExpiredJobCleanup({ sheetId: "probe-sheet", runtimeConfig, options: { fetchImpl, dryRun: false, now: () => new Date("2026-09-25T10:00:00Z") } });
console.log("cleanup result:", JSON.stringify({ checked: res.checked, updated: res.updated, postingFetches }));
const x = sheet.tabs.get("Pipeline")[1];
console.log("row X after:", JSON.stringify({ status: x[12], notes: x[14], followUp: x[15] }));
console.log(x[12] === "Expired" && !x[14].includes("ref #123") ? "DEFECT CONFIRMED: user's Applied status and new note overwritten; Follow-up Date left set on an Expired row" : "no overwrite");
