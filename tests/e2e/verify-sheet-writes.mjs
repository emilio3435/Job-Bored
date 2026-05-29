/**
 * verify-sheet-writes.mjs
 * Reads the live Pipeline sheet and reports the distribution of Fit Score
 * values + the count of rows that have a Fit Assessment filled in.
 * Lets us confirm the live rescore actually wrote back.
 */
import {
  loadWorkerConfig,
  resolveSheetsAccessToken,
} from "../../server/profile-rescore-worker.mjs";

const cfg = await loadWorkerConfig();
const token = await resolveSheetsAccessToken({});
const range = "Pipeline!A2:U500";
const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.sheetId)}/values/${encodeURIComponent(range)}`;
const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!resp.ok) {
  console.error("[fatal] sheet read failed:", resp.status, await resp.text());
  process.exit(1);
}
const data = await resp.json();
const rows = data.values || [];
console.log(`[verify] read ${rows.length} rows from Pipeline`);

const fitScoreCol = 7;   // column H (0-indexed 7) = Fit Score
const fitAssessCol = 10; // column K = Fit Assessment
const talkPointsCol = 16; // column Q = Talking Points

const dist = new Map();
let withFitScore = 0;
let withAssessment = 0;
let withTalkingPoints = 0;
for (const row of rows) {
  const fitScore = String(row[fitScoreCol] || "").trim();
  if (fitScore) {
    withFitScore += 1;
    dist.set(fitScore, (dist.get(fitScore) || 0) + 1);
  }
  if (String(row[fitAssessCol] || "").trim()) withAssessment += 1;
  if (String(row[talkPointsCol] || "").trim()) withTalkingPoints += 1;
}

console.log(`\n[verify] rows with Fit Score:        ${withFitScore} / ${rows.length}`);
console.log(`[verify] rows with Fit Assessment:   ${withAssessment} / ${rows.length}`);
console.log(`[verify] rows with Talking Points:   ${withTalkingPoints} / ${rows.length}`);

console.log("\n[verify] Fit Score distribution:");
const entries = [...dist.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
for (const [score, count] of entries) {
  console.log(`  ${score.padStart(2, " ")}: ${"█".repeat(Math.min(count, 50))} (${count})`);
}

// Show a few sample Fit Assessments to confirm they look LLM-generated
console.log("\n[verify] Sample Fit Assessments (first 3 non-empty):");
let samples = 0;
for (let i = 0; i < rows.length && samples < 3; i += 1) {
  const a = String(rows[i][fitAssessCol] || "").trim();
  if (a) {
    console.log(`  row ${i + 2} [score=${rows[i][fitScoreCol]}]: ${a.slice(0, 200)}${a.length > 200 ? "…" : ""}`);
    samples += 1;
  }
}
