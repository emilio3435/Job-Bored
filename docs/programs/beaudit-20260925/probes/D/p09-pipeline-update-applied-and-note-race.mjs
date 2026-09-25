// PIPE-04 (worker half) + PIPE-05 residue: /pipeline-update stage=Applied writes
// only Status; two concurrent note appends lose one (read-modify-write of O).
import { createPipelinePatcher } from "../../integrations/browser-use-discovery/src/sheets/pipeline-patcher.ts";
import { createFakeSheets, HEADER, pipelineRow, runtimeConfig } from "./fake-sheets.mjs";

const url = "https://acme.example/jobs/1";
const sheet = createFakeSheets({ Pipeline: [HEADER, pipelineRow({ title: "Engineer", company: "Acme", link: url, status: "Researching", notes: "seed" })] });
const p = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: () => new Date("2026-09-25T12:00:00Z") });
await p.patch("probe-sheet", { job: { url }, fields: { stage: "Applied" } });
let r = sheet.tabs.get("Pipeline")[1];
console.log("after stage=Applied:", JSON.stringify({ status: r[12], appliedDate: r[13], followUp: r[15] }));
console.log(r[13] === "" && r[15] === "" ? "PIPE-04 worker half CONFIRMED: Applied with no Applied Date / Follow-up Date / audit note" : "side effects applied");

let arrivals = 0; let release; const barrier = new Promise((res) => (release = res));
sheet.hooks.onRead = async (range) => { if (range === "Pipeline!A2:Y") { arrivals += 1; if (arrivals === 2) release(); await barrier; } };
await Promise.all([
  p.patch("probe-sheet", { job: { url }, fields: { note: "recruiter emailed" } }),
  p.patch("probe-sheet", { job: { url }, fields: { note: "Hermes follow-up sent" } }),
]);
r = sheet.tabs.get("Pipeline")[1];
console.log("notes after two concurrent appends:", JSON.stringify(r[14]));
console.log(r[14].includes("recruiter emailed") && r[14].includes("Hermes follow-up sent") ? "both kept" : "DEFECT CONFIRMED: one concurrent note lost");
