// Probe: RUN-07 / RUN-10 / RUN-11 on the production runDiscovery ATS path (hermetic; stubs only).
// Run: node --experimental-strip-types .lane-evidence/probes/C-run-ats-gating.mjs
import { DISCOVERY_WEBHOOK_EVENT, DISCOVERY_WEBHOOK_SCHEMA_VERSION } from "../../integrations/browser-use-discovery/src/contracts.ts";
import { mergeDiscoveryConfig } from "../../integrations/browser-use-discovery/src/config.ts";
import { runDiscovery } from "../../integrations/browser-use-discovery/src/run/run-discovery.ts";

const NOW = "2026-04-09T12:00:00.000Z";
globalThis.fetch = async () => { throw new Error("probe: network disabled"); };

function deps({ enabledSources, preset, detections, listJobs, sourceTimeoutMs = 5000 }) {
  const calls = { detect: 0, list: 0, signals: [] };
  const written = [];
  const adapters = [...new Set(detections.map((d) => d.sourceId))].map((sourceId) => ({
    sourceId,
    async listJobs(ctx, signal) { calls.list += 1; calls.signals.push(signal === undefined ? "undefined" : "AbortSignal"); return listJobs(ctx, signal); },
  }));
  return {
    calls, written,
    d: {
      runtimeConfig: { stateDatabasePath: "", workerConfigPath: "", browserUseCommand: "", geminiApiKey: "", webhookSecret: "", allowedOrigins: [], port: 0, host: "127.0.0.1", runMode: "hosted", asyncAckByDefault: true, useStructuredExtraction: false },
      sourceTimeoutMs,
      sourceAdapterRegistry: {
        adapters,
        detectBoards: async () => { calls.detect += 1; return detections; },
      },
      groundedSearchClient: { search: async () => ({ searchQueries: [], candidates: [], warnings: [] }) },
      browserSessionManager: { run: async ({ url }) => ({ url, text: "[]", metadata: {} }) },
      pipelineWriter: { write: async (sheetId, leads) => { written.push(...leads); return { sheetId, appended: leads.length, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] }; } },
      loadStoredWorkerConfig: async (sheetId) => ({ sheetId, mode: "hosted", timezone: "UTC", companies: [{ name: "Acme", boardHints: Object.fromEntries(enabledSources.map((s) => [s, "acme"])) }], includeKeywords: [], excludeKeywords: [], targetRoles: ["Backend Engineer"], locations: [], remotePolicy: "", seniority: "", maxLeadsPerRun: 10, enabledSources, schedule: { enabled: false, cron: "" }, sourcePreset: preset }),
      mergeDiscoveryConfig,
      now: () => new Date(NOW),
      randomId: (p) => `${p}_probe`,
    },
  };
}
const request = (preset) => ({ event: DISCOVERY_WEBHOOK_EVENT, schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION, sheetId: "sheet_probe", variationKey: "v", requestedAt: NOW, discoveryProfile: { sourcePreset: preset, targetRoles: "Backend Engineer" } });
const det = (sourceId, boardUrl) => ({ matched: true, sourceId, sourceLabel: sourceId, boardUrl, confidence: 1, warnings: [] });
const listing = (sourceId, n) => ({ sourceId, sourceLabel: sourceId, title: "Backend Engineer", company: "Acme", location: "Remote", url: `https://boards.greenhouse.io/acme/jobs/${n}`, tags: [] });

// RUN-07
for (const enabled of [["workday", "smartrecruiters"], ["greenhouse", "workday"]]) {
  const h = deps({ enabledSources: enabled, preset: "ats_only", detections: [det(enabled[0], "https://acme.wd1.myworkdayjobs.com/x")], listJobs: async () => [] });
  const r = await runDiscovery(request("ats_only"), "manual", h.d);
  console.log(`RUN-07 enabled=${JSON.stringify(enabled)} -> detectBoards calls=${h.calls.detect} state=${r.state ?? r.status ?? "?"}`);
}
// RUN-10
{
  const h = deps({ enabledSources: ["greenhouse"], preset: "ats_only",
    detections: [det("greenhouse", "https://boards.greenhouse.io/acme"), det("greenhouse", "https://boards.greenhouse.io/acme-eu")],
    listJobs: async (ctx) => { if (String(ctx.boardUrl).includes("acme-eu")) throw new Error("board B exploded"); return [listing("greenhouse", 1)]; } });
  const r = await runDiscovery(request("ats_only"), "manual", h.d);
  console.log(`RUN-10 two greenhouse boards, board B throws -> listJobs calls=${h.calls.list} leadsWritten=${h.written.length}`);
  console.log(`RUN-10 warnings: ${JSON.stringify((r.warnings || []).filter((w) => /Listing collection/.test(w)))}`);
}
// RUN-11
{
  let aborted = "n/a";
  const h = deps({ enabledSources: ["greenhouse"], preset: "ats_only", sourceTimeoutMs: 25,
    detections: [det("greenhouse", "https://boards.greenhouse.io/acme")],
    listJobs: async (_ctx, signal) => { await new Promise((r) => setTimeout(r, 200)); aborted = signal ? String(signal.aborted) : "no signal"; return []; } });
  const t0 = Date.now();
  await runDiscovery(request("ats_only"), "manual", h.d);
  await new Promise((r) => setTimeout(r, 250));
  console.log(`RUN-11 ATS listJobs received signal=${JSON.stringify(h.calls.signals)} underlying-work-aborted=${aborted} (run took ${Date.now() - t0}ms)`);
}
// RUN-10 control: same two boards, neither throws
{
  const h = deps({ enabledSources: ["greenhouse"], preset: "ats_only",
    detections: [det("greenhouse", "https://boards.greenhouse.io/acme"), det("greenhouse", "https://boards.greenhouse.io/acme-eu")],
    listJobs: async (ctx) => [listing("greenhouse", String(ctx.boardUrl).includes("acme-eu") ? 2 : 1)] });
  await runDiscovery(request("ats_only"), "manual", h.d);
  console.log(`RUN-10 control (no board throws) -> listJobs calls=${h.calls.list} leadsWritten=${h.written.length}`);
}
