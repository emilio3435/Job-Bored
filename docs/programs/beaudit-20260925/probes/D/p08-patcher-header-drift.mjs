// Seed Q2: /pipeline-update patcher writes fixed letters (L,M,N,O,R,S) with no
// header check, so on a drifted Sheet it writes into the wrong columns.
import { createPipelinePatcher } from "../../integrations/browser-use-discovery/src/sheets/pipeline-patcher.ts";
import { createFakeSheets, HEADER, runtimeConfig } from "./fake-sheets.mjs";

const header = [...HEADER.slice(0, 5), "Referral?", ...HEADER.slice(5)]; // user inserted a column at F
const row = header.map((h) => ({ Title: "Engineer", Company: "Acme", Link: "https://acme.example/jobs/1", Status: "Researching", "Applied Date": "", Notes: "keep me", Contact: "Sam" }[h] ?? ""));
const sheet = createFakeSheets({ Pipeline: [header, row] });
const p = createPipelinePatcher(runtimeConfig, { fetchImpl: sheet.fetchImpl, now: () => new Date("2026-09-25T12:00:00Z") });
// Link moved from E to F? No: insertion at F keeps Link at E, so the URL match still succeeds.
const res = await p.patch("probe-sheet", { job: { url: "https://acme.example/jobs/1" }, fields: { stage: "Interviewing", note: "onsite booked" } });
console.log("patch result:", JSON.stringify(res));
const after = sheet.tabs.get("Pipeline")[1];
header.forEach((h, i) => { if (after[i] !== row[i]) console.log(`  column ${String.fromCharCode(65 + i)} "${h}": ${JSON.stringify(row[i])} -> ${JSON.stringify(after[i])}`); });
console.log(after[header.indexOf("Status")] === "Researching" ? "DEFECT CONFIRMED: Status unchanged, stage and note written into the wrong columns, HTTP 200 returned" : "correct");
