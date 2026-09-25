// /ingest-url order probe: does the paid/outbound extraction run before the Sheets credential is checked?
// No network: globalThis.fetch is replaced with a recorder that throws; extractors are counting stubs.
// Run from worktree root: node --experimental-strip-types .lane-evidence/probes/ingest-order.mts
const outbound: string[] = [];
globalThis.fetch = (async (url: unknown) => {
  outbound.push(String(url));
  throw new Error("probe: network disabled");
}) as typeof fetch;

const { handleIngestUrlWebhook } = await import("../../integrations/browser-use-discovery/src/webhook/handle-ingest-url.ts");
const { createPipelineWriter } = await import("../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts");
const { loadRuntimeConfig } = await import("../../integrations/browser-use-discovery/src/config.ts");

// Real runtime config with NO Google credential (explicit empty env, no dotenv file).
const runtimeConfig = loadRuntimeConfig({
  BROWSER_USE_DISCOVERY_WEBHOOK_SECRET: "probe-secret",
  BROWSER_USE_DISCOVERY_RUN_MODE: "local",
  BROWSER_USE_DISCOVERY_WORKER_CONFIG: ".lane-evidence/probes/does-not-exist.json",
  BROWSER_USE_DISCOVERY_GEMINI_API_KEY: "probe-gemini-key",
});
const calls = { greenhouse: 0, gemini: 0, browserUse: 0, scrape: 0 };
let res: { status: number; body: string };
try {
res = await handleIngestUrlWebhook(
  {
    method: "POST",
    headers: { "x-discovery-secret": "probe-secret" },
    bodyText: JSON.stringify({ event: "ingest.url.request", schemaVersion: 1, url: "https://boards.greenhouse.io/acme/jobs/123", sheetId: "1AbCdEfGhIjKlMnOpQrSt" }),
  },
  {
    runtimeConfig,
    pipelineWriter: createPipelineWriter(runtimeConfig),
    fetchGreenhouseJob: (async () => { calls.greenhouse += 1; return { ok: false, message: "stub 404", httpStatus: 404 }; }) as never,
    extractWithGeminiUrlContext: (async () => { calls.gemini += 1; return { ok: true, rawListing: { title: "Staff Engineer", company: "Acme", url: "https://boards.greenhouse.io/acme/jobs/123", descriptionText: "Build things. ".repeat(40) } }; }) as never,
    extractWithBrowserUseCloud: (async () => { calls.browserUse += 1; return { ok: false }; }) as never,
    scrapeJobPosting: (async () => { calls.scrape += 1; return { ok: false, message: "stub" }; }) as never,
  },

);
} catch (error) {
  res = { status: -1, body: `HANDLER THREW (server.ts maps to generic 500): ${(error as Error).message}` };
}
console.log(`status=${res.status} body=${res.body.slice(0, 220)}`);
console.log(`extraction calls before failing: ${JSON.stringify(calls)}; outbound fetch attempts=${outbound.length} ${outbound.slice(0, 3).join(" ")}`);
