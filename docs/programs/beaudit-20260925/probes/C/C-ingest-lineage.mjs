// Probe: INGEST-01 / INGEST-04 — worker /ingest-url drops structured company/location from the shared scraper.
// Run: node --experimental-strip-types .lane-evidence/probes/C-ingest-lineage.mjs
import { INGEST_URL_EVENT, INGEST_URL_SCHEMA_VERSION } from "../../integrations/browser-use-discovery/src/contracts.ts";
import { handleIngestUrlWebhook } from "../../integrations/browser-use-discovery/src/webhook/handle-ingest-url.ts";
globalThis.fetch = async () => { throw new Error("probe: network disabled"); };
const rc = { stateDatabasePath: "", workerConfigPath: "", browserUseCommand: "", browserUseApiKey: "", geminiApiKey: "", webhookSecret: "probe-secret", allowedOrigins: [], port: 0, host: "127.0.0.1", runMode: "local", asyncAckByDefault: false, useStructuredExtraction: false, serpApiKey: "probe-serp-key" };
const desc = "Build and operate distributed backend services in TypeScript and Go. ".repeat(8);
for (const [url, scraped] of [
  ["https://careers.acme.com/jobs/123", { url: "https://careers.acme.com/jobs/123", title: "Senior Backend Engineer", company: "Acme Robotics", location: "Berlin, Germany", description: desc, method: "serpapi-google-jobs", source: "serpapi" }],
  ["https://jobs.example-co.com/role/9", { url: "https://jobs.example-co.com/role/9", title: "Staff Engineer", company: "Example Co", location: "Remote (US)", description: desc, method: "json-ld" }],
]) {
  const written = []; const scrapeArgs = [];
  const res = await handleIngestUrlWebhook(
    { method: "POST", headers: { "x-discovery-secret": "probe-secret" }, bodyText: JSON.stringify({ event: INGEST_URL_EVENT, schemaVersion: INGEST_URL_SCHEMA_VERSION, sheetId: "sheet_probe", url, async: false }) },
    { runtimeConfig: rc, scrapeJobPosting: async (...args) => { scrapeArgs.push(args.length); return scraped; },
      pipelineWriter: { write: async (sheetId, leads) => { written.push(...leads); return { sheetId, appended: leads.length, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] }; } } },
  );
  const lead = written[0] || {};
  console.log(JSON.stringify({ url, status: res.status, scraperCompany: scraped.company, writtenCompany: lead.company, scraperLocation: scraped.location, writtenLocation: lead.location ?? null, scraperMethod: scraped.method, writtenSourceLabel: lead.sourceLabel, scrapeJobPostingArgCount: scrapeArgs }));
}
