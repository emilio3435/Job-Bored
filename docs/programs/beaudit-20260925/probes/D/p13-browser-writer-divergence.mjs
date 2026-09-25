// PIPE-06 / PIPE-04 / APPLY-01: load the browser writer (sheets-writeback.js) in a
// VM with a stubbed fetch and record which cells each stage path writes.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../../sheets-writeback.js", import.meta.url), "utf8");
const writes = [];
const job = () => ({ _rawIndex: 0, status: "Researching", title: "Eng", company: "Acme", link: "https://acme.example/jobs/1", appliedDate: "", followUpDate: "2026-10-01" });
let data = [job()];
const host = { getSheetId: () => "probe", getSHEET_ID: () => "probe", getAccessToken: () => "probe-token", getPipelineData: () => data, renderPipeline() {}, renderStats() {}, renderBrief() {}, showToast() {}, renderExpiredReviewButton() {}, refreshAccessTokenSilently: async () => false, showSheetAccessGate() {} };
const window = { JobBoredApp: { core: { host }, config: {} }, dispatchEvent() {}, CustomEvent: class {} };
const fetch = async (url, init) => { const b = JSON.parse(init.body || "{}"); for (const d of b.data || [b]) writes.push(d.range + "=" + JSON.stringify(d.values?.[0]?.[0] ?? "")); return new Response("{}", { status: 200 }); };
const ctx = vm.createContext({ window, fetch, Response, URL, URLSearchParams, console, setTimeout, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, document: { dispatchEvent() {} } });
window.JobBoredApp.core.host = host; ctx.window.getSHEET_ID = () => "probe";
vm.runInContext(src, ctx);
const sw = window.JobBoredApp.sheetsWrite;
const run = async (label, fn) => { writes.length = 0; data = [job()]; try { await fn(); } catch (e) { writes.push("threw: " + e.message); } console.log(label.padEnd(44), writes.join("  ") || "(no writes)"); };
await run("browser markStatusExpired (Brief/review)", () => sw.markStatusExpired(0));
await run("browser updateJobStatus(Expired) (board)", () => sw.updateJobStatus(0, "Expired"));
await run("browser updateJobStatus(Applied) (submission-flow)", () => sw.updateJobStatus(0, "Applied", "Researching"));
console.log("updateJobStatus arity:", sw.updateJobStatus.length, "-> submission-flow.js:204 passes (jobKey,'Applied',fromStage); evidence {appliedDate,source,receiptNote,followUpDate} is dropped");
