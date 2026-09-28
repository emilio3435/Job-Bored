// Probe: DISC-06. A companyAllowlist mixing one catalog company and one typo.
// The typo is dropped; does the run surface it anywhere a user would see?
import { DISCOVERY_WEBHOOK_EVENT, DISCOVERY_WEBHOOK_SCHEMA_VERSION } from "../../integrations/browser-use-discovery/src/contracts.ts";
import { mergeDiscoveryConfig } from "../../integrations/browser-use-discovery/src/config.ts";
import { runDiscovery } from "../../integrations/browser-use-discovery/src/run/run-discovery.ts";
globalThis.fetch = async (u) => { throw new Error("probe: network blocked " + u); };
const stored = { sheetId: "s", mode: "hosted", timezone: "UTC", companies: [{ name: "Acme" }, { name: "Initech" }], includeKeywords: ["node"], excludeKeywords: [], targetRoles: ["Backend Engineer"], locations: ["Remote"], remotePolicy: "", seniority: "", maxLeadsPerRun: 10, enabledSources: ["greenhouse"], schedule: { enabled: false, cron: "" }, sourcePreset: "ats_only" };
const NOW = "2026-09-25T12:00:00.000Z";
for (const allow of [["Acme", "Globexx"], ["Globexx"]]) {
  const req = { event: DISCOVERY_WEBHOOK_EVENT, schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION, sheetId: "s", variationKey: "v", requestedAt: NOW, companyAllowlist: allow, discoveryProfile: { targetRoles: "Backend Engineer" } };
  const cfg = mergeDiscoveryConfig(stored, req);
  console.log(`allowlist=${JSON.stringify(allow)} -> mode=${cfg.allowlistResolution.mode} unknown=${JSON.stringify(cfg.allowlistResolution.unknown)} companies=${JSON.stringify(cfg.companies.map((c) => c.name))} effectiveSources=${JSON.stringify(cfg.effectiveSources)}`);
  if (cfg.allowlistResolution.mode === "restricted") {
    const logs = [];
    const r = await runDiscovery(req, "manual", { runtimeConfig: { runMode: "hosted" }, sourceAdapterRegistry: { adapters: [], detectBoards: async () => [], collectListings: async () => [] }, pipelineWriter: { write: async (s) => ({ sheetId: s, appended: 0, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] }) }, loadStoredWorkerConfig: async () => stored, mergeDiscoveryConfig, now: () => new Date(NOW), randomId: (p) => p + "_1", log: (e, d) => logs.push(e + " " + JSON.stringify(d)) });
    const mentions = [...r.warnings, ...logs].filter((x) => /Globexx/.test(x));
    console.log(`   run warnings/logs mentioning the dropped entry: ${mentions.length} (warnings=${JSON.stringify(r.warnings)})`);
  }
}
