// Seed Q2 / INGEST-03 follow-on: re-discovery overwrites user-edited columns
// (Source, Priority, Tags, Fit Assessment, Talking Points, unlocked Salary) and
// rewrites the whole A:Y row, flattening any formula the user had in the row.
import { createPipelineWriter } from "../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts";
import { createFakeSheets, HEADER, lead, pipelineRow, runtimeConfig } from "./fake-sheets.mjs";

const url = "https://boards.greenhouse.io/acme/jobs/1";
const userRow = pipelineRow({ date: "2026-09-01", title: "Engineer", company: "Acme", location: "Remote", link: url,
  source: "Manual", salary: "$150k (recruiter said)", fit: "9", priority: "🔥 top", tags: "referral, dream",
  fitAssessment: "User-provided job description:\nFull JD pasted by user...", status: "Researching",
  talking: "my own talking points", notes: "call Sam" });
const sheet = createFakeSheets({ Pipeline: [HEADER, userRow] });
const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl });
await w.write("probe-sheet", [lead({ url, compensationText: "$120k–$140k", fitScore: 6, priority: "medium", tags: ["backend"], fitAssessment: "LLM: decent fit", talkingPoints: "LLM talking points" })]);
const after = sheet.tabs.get("Pipeline")[1];
const cols = { 5: "Source", 6: "Salary", 7: "Fit Score", 8: "Priority", 9: "Tags", 10: "Fit Assessment", 16: "Talking Points", 12: "Status", 14: "Notes" };
let lost = 0;
for (const [i, name] of Object.entries(cols)) {
  const changed = userRow[i] !== after[i];
  if (changed) lost += 1;
  console.log(`${name.padEnd(15)} before=${JSON.stringify(userRow[i]).slice(0, 50).padEnd(52)} after=${JSON.stringify(after[i]).slice(0, 50)}${changed ? "  <-- overwritten" : ""}`);
}
const upd = sheet.calls.find((c) => c.kind === "values.batchUpdate");
console.log("write range:", JSON.parse(upd.body).data[0].range, "valueInputOption:", JSON.parse(upd.body).valueInputOption);
console.log(lost ? `DEFECT CONFIRMED: ${lost} user-edited columns overwritten by re-discovery` : "no overwrite");
