// Seed Q3: Sheets + token calls for one 20-lead discovery run, per writer, with a
// probe service-account credential (JWT exchange hits the fake, never Google).
import { generateKeyPairSync } from "node:crypto";
import { createPipelineWriter } from "../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts";
import { appendDiscoveryRunRow } from "../../integrations/browser-use-discovery/src/sheets/discovery-runs-writer.ts";
import { validateSheetsCredentialReadiness } from "../../integrations/browser-use-discovery/src/sheets/credential-readiness.ts";
import { createFakeSheets, HEADER, lead, pipelineRow } from "./fake-sheets.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sa = JSON.stringify({ client_email: "probe-sa@probe.invalid", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
const runtimeConfig = { googleServiceAccountJson: sa, googleAccessToken: "" };
const existing = [HEADER];
for (let i = 0; i < 300; i += 1) existing.push(pipelineRow({ title: "Old " + i, company: "Co" + i, link: `https://old${i}.example/jobs/${i}` }));
for (let i = 0; i < 10; i += 1) existing.push(pipelineRow({ title: "Engineer " + i, company: "Acme" + i, link: `https://boards.greenhouse.io/acme${i}/jobs/${i}`, status: "New" }));
const sheet = createFakeSheets({ Pipeline: existing, Blacklist: [["URL"]], DiscoveryRuns: [["Run At","Trigger","Status","Duration (s)","Companies Seen","Leads New","Leads Updated","Source","Variation Key","Error"]] });
const leads = [];
for (let i = 0; i < 20; i += 1) leads.push(lead({ title: "Engineer " + i, company: "Acme" + i, url: `https://boards.greenhouse.io/acme${i}/jobs/${i}` }));

const mark = () => sheet.calls.length;
const step = (name, from) => { const c = sheet.calls.slice(from); console.log(name.padEnd(34), "token:", c.filter((x) => x.kind === "token").length, " sheets read:", c.filter((x) => /get/.test(x.kind)).length, " sheets write:", c.filter((x) => /update|append|batch/i.test(x.kind)).length, " [" + c.map((x) => x.kind).join(",") + "]"); return c.length; };
let m = mark(); await validateSheetsCredentialReadiness(runtimeConfig, { sheetId: "probe", fetchImpl: sheet.fetchImpl }); step("preflight readiness (webhook)", m);
m = mark(); await validateSheetsCredentialReadiness(runtimeConfig, { sheetId: "probe", fetchImpl: sheet.fetchImpl }); step("GET /health readiness (each poll)", m);
m = mark(); const w = await createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl }).write("probe", leads); step("pipeline write (20 leads)", m);
console.log("  -> appended", w.appended, "updated", w.updated, "| rows read in one GET:", existing.length - 1);
m = mark(); await appendDiscoveryRunRow("probe", { runAt: "x", trigger: "manual", status: "success", durationS: 1, companiesSeen: 1, leadsWritten: 10, leadsUpdated: 10, source: "w", variationKey: "v", error: "" }, { runtimeConfig, fetchImpl: sheet.fetchImpl }); step("DiscoveryRuns log", m);
const all = sheet.calls; console.log("TOTAL per run:", "token exchanges", all.filter((x) => x.kind === "token").length - 1, "(excl. /health), Sheets API calls", all.filter((x) => x.kind !== "token").length - 1);
const pipeBytes = JSON.stringify(existing).length; console.log("bytes of the full A2:Y read at 310 rows ~", pipeBytes, "(grows linearly; read on every write and every /ingest-url)");
