// Seed Q2 / PIPE-05-adjacent: positional row writes land on the wrong job when
// rows move between the writer's read and its batchUpdate (user deletes/sorts).
import { createPipelineWriter } from "../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts";
import { createFakeSheets, HEADER, lead, pipelineRow, runtimeConfig } from "./fake-sheets.mjs";

const A = pipelineRow({ title: "Alpha role", company: "Alpha", link: "https://alpha.example/jobs/1", status: "New" });
const B = pipelineRow({ title: "Beta role", company: "Beta", link: "https://beta.example/jobs/2", status: "Interviewing", notes: "Beta: onsite Tue, recruiter Sam" });
const C = pipelineRow({ title: "Gamma role", company: "Gamma", link: "https://gamma.example/jobs/3", status: "New" });
const sheet = createFakeSheets({ Pipeline: [HEADER, A, B, C] });
sheet.hooks.beforeWrite = async (kind) => {
  if (kind === "values.batchUpdate" && sheet.tabs.get("Pipeline").length === 4) {
    sheet.tabs.get("Pipeline").splice(1, 1); // user deletes Alpha (row 2) mid-run
  }
};
const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl });
await w.write("probe-sheet", [lead({ title: "Beta role", company: "Beta", url: "https://beta.example/jobs/2", location: "", fitAssessment: "re-discovered beta" })]);
for (const r of sheet.tabs.get("Pipeline").slice(1)) console.log(JSON.stringify({ title: r[1], company: r[2], link: r[4], status: r[12], notes: r[14] }));
const links = sheet.tabs.get("Pipeline").slice(1).map((r) => r[4]);
console.log(links.includes("https://gamma.example/jobs/3") ? "Gamma intact" : "DEFECT CONFIRMED: Gamma row overwritten by Beta's merged row (Gamma lost; Beta now duplicated)");
