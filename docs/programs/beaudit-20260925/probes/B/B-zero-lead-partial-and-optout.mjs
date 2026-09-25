// Probe (stubbed, no network). Case A: an ats_only run whose boards return no
// listings ends "partial" (not "empty") only because grounded_web was excluded by
// the preset, and the DiscoveryRuns row carries status=partial with a blank error.
// Case B: per-run groundedWebEnabled=false still spends a Gemini grounded
// google_search call (searchAtsHosts) when ATS lanes have no seeds.
import { DISCOVERY_WEBHOOK_EVENT, DISCOVERY_WEBHOOK_SCHEMA_VERSION } from "../../integrations/browser-use-discovery/src/contracts.ts";
import { mergeDiscoveryConfig } from "../../integrations/browser-use-discovery/src/config.ts";
import { runDiscovery } from "../../integrations/browser-use-discovery/src/run/run-discovery.ts";
globalThis.fetch = async (u) => { throw new Error("probe: network blocked " + u); };
const NOW = "2026-09-25T12:00:00.000Z";
function deps({ companies, enabledSources, preset, counters, logRows }) {
  return {
    runtimeConfig: { geminiApiKey: "probe-key", geminiModel: "gemini-2.5-flash", groundedSearchMaxResultsPerCompany: 4, groundedSearchMaxPagesPerCompany: 2, runMode: "hosted", allowedOrigins: [], port: 0, host: "127.0.0.1" },
    sourceAdapterRegistry: { adapters: [], detectBoards: async () => [], collectListings: async () => [] },
    groundedSearchClient: {
      search: async () => { counters.search++; return { searchQueries: [], candidates: [], warnings: [] }; },
      searchAtsHosts: async () => { counters.atsHosts++; return { searchQueries: [], candidates: [], warnings: [] }; },
    },
    browserSessionManager: { run: async () => ({ url: "", text: "{}", metadata: {} }) },
    pipelineWriter: { write: async (sheetId) => ({ sheetId, appended: 0, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] }) },
    discoveryRunsLogger: { append: async (_s, row) => { logRows.push(row); return { ok: true }; } },
    loadStoredWorkerConfig: async (sheetId) => ({ sheetId, mode: "hosted", timezone: "UTC", companies, atsCompanies: [], includeKeywords: ["node"], excludeKeywords: [], targetRoles: ["Backend Engineer"], locations: ["Remote"], remotePolicy: "remote", seniority: "", maxLeadsPerRun: 10, enabledSources, schedule: { enabled: false, cron: "" }, sourcePreset: preset }),
    mergeDiscoveryConfig, now: () => new Date(NOW), randomId: (p) => `${p}_probe`,
  };
}
const req = (extra = {}) => ({ event: DISCOVERY_WEBHOOK_EVENT, schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION, sheetId: "sheet_probe", variationKey: "v", requestedAt: NOW, discoveryProfile: { targetRoles: "Backend Engineer", keywordsInclude: "node", ...extra } });

{ const counters = { search: 0, atsHosts: 0 }, logRows = [];
  const r = await runDiscovery(req({ sourcePreset: "ats_only" }), "manual", deps({ companies: [{ name: "Acme" }], enabledSources: ["greenhouse", "grounded_web"], preset: "ats_only", counters, logRows }));
  console.log("A state:", r.lifecycle.state, "| reasonCode:", r.lifecycle.reasonCode, "| leads:", r.lifecycle.normalizedLeadCount);
  console.log("A warnings:", JSON.stringify(r.warnings));
  console.log("A DiscoveryRuns row:", JSON.stringify({ status: logRows[0]?.status, companiesSeen: logRows[0]?.companiesSeen, error: logRows[0]?.error })); }

{ const counters = { search: 0, atsHosts: 0 }, logRows = [];
  const r = await runDiscovery(req({ groundedWebEnabled: false }), "manual", deps({ companies: [], enabledSources: ["greenhouse", "grounded_web"], preset: "browser_plus_ats", counters, logRows }));
  console.log("B effectiveSources:", JSON.stringify(r.run.config.effectiveSources), "| grounded search() calls:", counters.search, "| searchAtsHosts() Gemini calls:", counters.atsHosts);
  console.log("B state:", r.lifecycle.state, "| DiscoveryRuns:", JSON.stringify({ status: logRows[0]?.status, companiesSeen: logRows[0]?.companiesSeen, error: logRows[0]?.error })); }
