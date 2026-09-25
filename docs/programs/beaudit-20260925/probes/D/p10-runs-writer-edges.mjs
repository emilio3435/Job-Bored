// RUN-04 / Seed Q4: DiscoveryRuns writer edge cases.
import { appendDiscoveryRunRow } from "../../integrations/browser-use-discovery/src/sheets/discovery-runs-writer.ts";
import { createFakeSheets, runtimeConfig } from "./fake-sheets.mjs";

const RUNS = ["Run At","Trigger","Status","Duration (s)","Companies Seen","Leads New","Leads Updated","Source","Variation Key","Error"];
const row = { runAt: "2026-09-25T10:00:00Z", trigger: "manual", status: "partial", durationS: 30, companiesSeen: 4, leadsWritten: 2, leadsUpdated: 1, source: "worker", variationKey: "v1", error: "" };

// (a) 429 on the header read is treated as "tab missing" and triggers addSheet.
let s = createFakeSheets({ DiscoveryRuns: [RUNS] });
s.hooks.failNext.push({ kind: "values.get", status: 429, body: "RESOURCE_EXHAUSTED" });
let r = await appendDiscoveryRunRow("probe", row, { runtimeConfig, fetchImpl: s.fetchImpl });
console.log("(a) 429 header read ->", JSON.stringify(r), "calls:", s.calls.map((c) => c.kind).join(","));

// (b) legacy 9-column tab: header silently rewritten to 10 columns above old 9-cell rows.
const legacy = ["Run At","Trigger","Status","Duration (s)","Companies Seen","Leads Written","Source","Variation Key","Error"];
s = createFakeSheets({ DiscoveryRuns: [legacy, ["2026-08-01T00:00:00Z","manual","failure","10","3","0","worker","v0","Gemini key missing"]] });
r = await appendDiscoveryRunRow("probe", row, { runtimeConfig, fetchImpl: s.fetchImpl });
const tab = s.tabs.get("DiscoveryRuns");
console.log("(b) legacy tab after append:", JSON.stringify(r));
console.log("    header:", tab[0].join("|"));
console.log("    old row under new header -> Leads Updated=", JSON.stringify(tab[1][6]), " Source=", JSON.stringify(tab[1][7]), " Error=", JSON.stringify(tab[1][9] ?? ""));

// (c) partial row with empty error: Error cell blank (prior RUN-04 / in-flight #107-#113).
console.log("(c) partial row Error cell sent:", JSON.stringify(JSON.parse(s.calls.find((c) => c.kind === "values.append").body).values[0][9]));
