// Seed Q2: header drift matrix for the Pipeline writer (and the cleanup gate).
import { createPipelineWriter } from "../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts";
import { runExpiredJobCleanup } from "../../integrations/browser-use-discovery/src/cleanup/expired-job-cleanup.ts";
import { createFakeSheets, HEADER, lead, runtimeConfig } from "./fake-sheets.mjs";

const cases = {
  "canonical 25": [...HEADER],
  "legacy 20 (A:T only)": HEADER.slice(0, 20),
  "legacy 17": HEADER.slice(0, 17),
  "user column appended at Z": [...HEADER, "My Column"],
  "user column inserted at F": [...HEADER.slice(0, 5), "Referral?", ...HEADER.slice(5)],
  "Status/Notes swapped": HEADER.map((h, i) => (i === 12 ? "Notes" : i === 14 ? "Status" : h)),
  "rename 'Salary'->'Comp'": HEADER.map((h) => (h === "Salary" ? "Comp" : h)),
  "rename optional 'Match Score'->'AI Score'": HEADER.map((h) => (h === "Match Score" ? "AI Score" : h)),
  "case drift 'Did They Reply?'": HEADER.map((h) => (h === "Did they reply?" ? "Did They Reply?" : h)),
};
for (const [name, header] of Object.entries(cases)) {
  const sheet = createFakeSheets({ Pipeline: [header] });
  const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl });
  let outcome;
  try {
    const r = await w.write("probe-sheet", [lead({})]);
    const hdrWrite = sheet.calls.find((c) => c.kind === "values.batchUpdate" && c.body.includes("A1:Y1"));
    const after = sheet.tabs.get("Pipeline")[0];
    outcome = `ok appended=${r.appended}${hdrWrite ? " header-rewritten" : ""}; header now ${after.length} cols${after[25] ? " (Z='" + after[25] + "' kept)" : ""}`;
  } catch (e) { outcome = "THROWS: " + String(e.message).slice(0, 70) + "…"; }
  let cleanup;
  try {
    const c2 = createFakeSheets({ Pipeline: [header] });
    await runExpiredJobCleanup({ sheetId: "p", runtimeConfig, options: { fetchImpl: c2.fetchImpl, dryRun: true } });
    cleanup = "ok";
  } catch (e) { cleanup = "THROWS"; }
  console.log(`${name.padEnd(42)} writer: ${outcome}  | cleanup: ${cleanup}`);
}
