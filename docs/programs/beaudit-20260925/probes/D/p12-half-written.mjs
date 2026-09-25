// Seed Q4: half-written batch recovery.
import { createPipelineWriter, SheetWriteError } from "../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts";
import { createFakeSheets, HEADER, lead, pipelineRow, runtimeConfig } from "./fake-sheets.mjs";

const base = () => [HEADER, pipelineRow({ title: "Engineer", company: "Acme", link: "https://acme.example/jobs/1" })];
const leads = [lead({ title: "Engineer", company: "Acme", url: "https://acme.example/jobs/1" }), lead({ title: "New role", company: "Beta", url: "https://beta.example/jobs/2" })];

// (1) update phase 503: the append of brand-new leads is never attempted.
let s = createFakeSheets({ Pipeline: base() });
s.hooks.failNext.push({ kind: "values.batchUpdate", status: 503, body: "backendError" });
try { await createPipelineWriter(runtimeConfig, { fetchImpl: s.fetchImpl }).write("p", leads); }
catch (e) { console.log("(1) update 503 ->", e.name, "phase=" + e.phase, "partialResult=" + JSON.stringify(e.partialResult ?? null), "| append attempted:", s.calls.some((c) => c.kind === "values.append"), "| rows:", s.tabs.get("Pipeline").length - 1); }

// (2) append 500 after update succeeded: partialResult reports updated=1 appended=0.
s = createFakeSheets({ Pipeline: base() });
s.hooks.failNext.push({ kind: "values.append", status: 500, body: "internal" });
try { await createPipelineWriter(runtimeConfig, { fetchImpl: s.fetchImpl }).write("p", leads); }
catch (e) { console.log("(2) append 500 ->", "phase=" + e.phase, "partialResult=" + JSON.stringify({ appended: e.partialResult.appended, updated: e.partialResult.updated })); }

// (3) append committed but the response is lost (network reset): plain Error, not SheetWriteError.
s = createFakeSheets({ Pipeline: base() });
const lossy = async (input, init) => { const r = await s.fetchImpl(input, init); if (String(input).includes(":append")) throw new TypeError("fetch failed (socket hang up)"); return r; };
try { await createPipelineWriter(runtimeConfig, { fetchImpl: lossy }).write("p", leads); }
catch (e) { console.log("(3) append response lost ->", e.name, "isSheetWriteError=" + (e instanceof SheetWriteError), "| rows actually in Sheet:", s.tabs.get("Pipeline").length - 1, "(run-discovery.ts:1360 rethrows non-SheetWriteError -> run marked failed although the lead was written)"); }
// Retry after (3) is idempotent by URL:
const r = await createPipelineWriter(runtimeConfig, { fetchImpl: s.fetchImpl }).write("p", leads);
console.log("(3b) retry ->", JSON.stringify({ appended: r.appended, updated: r.updated }), "rows:", s.tabs.get("Pipeline").length - 1);
