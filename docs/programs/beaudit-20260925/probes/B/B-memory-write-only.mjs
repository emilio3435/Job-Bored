// Probe (stubbed, no network; sqlite under .lane-evidence/home). Two identical
// ATS runs share one real memory store. Shows what run 1 learns and whether
// run 2 reads any of it back.
import { mkdirSync, rmSync } from "node:fs";
import { DISCOVERY_WEBHOOK_EVENT, DISCOVERY_WEBHOOK_SCHEMA_VERSION } from "../../integrations/browser-use-discovery/src/contracts.ts";
import { mergeDiscoveryConfig } from "../../integrations/browser-use-discovery/src/config.ts";
import { runDiscovery } from "../../integrations/browser-use-discovery/src/run/run-discovery.ts";
import { createDiscoveryMemoryStore } from "../../integrations/browser-use-discovery/src/state/discovery-memory-store.ts";
import { createRunDiscoveryMemoryStore } from "../../integrations/browser-use-discovery/src/state/run-discovery-memory-store.ts";
globalThis.fetch = async (u) => { throw new Error("probe: network blocked " + u); };
const dir = new URL("../home/b-memory-probe/", import.meta.url).pathname;
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const raw = createDiscoveryMemoryStore(dir + "worker-state.sqlite");
const mem = createRunDiscoveryMemoryStore(raw);
let snapshotCompanies = [];
const wrapped = { ...mem, loadSnapshot(i) { const s = mem.loadSnapshot(i); snapshotCompanies.push({ intentKey: i.intentKey, companies: s.companies.length, surfaces: s.careerSurfaces.length, intentCoverage: s.intentCoverage.length, roleFamilies: s.roleFamilies.length }); return s; } };
const NOW = "2026-09-25T12:00:00.000Z";
let run = 0;
const deps = () => ({
  runtimeConfig: { geminiApiKey: "", runMode: "hosted", allowedOrigins: [], port: 0, host: "127.0.0.1" },
  sourceAdapterRegistry: { adapters: [],
    detectBoards: async ({ company }) => [{ matched: true, sourceId: "greenhouse", sourceLabel: "Greenhouse", boardUrl: `https://boards.greenhouse.io/${company.name.toLowerCase()}`, confidence: 1, warnings: [], boardToken: company.name.toLowerCase() }],
    collectListings: async (_r, dets) => dets.map((d, i) => ({ sourceId: "greenhouse", sourceLabel: "Greenhouse", title: "Senior Backend Engineer", company: "Acme", location: "Remote", url: `${d.boardUrl}/jobs/${7000 + i}`, descriptionText: "node typescript remote", tags: ["node"] })) },
  discoveryMemoryStore: wrapped,
  pipelineWriter: { write: async (sheetId, leads) => ({ sheetId, appended: leads.length, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] }) },
  loadStoredWorkerConfig: async (sheetId) => ({ sheetId, mode: "hosted", timezone: "UTC", companies: [{ name: "Acme" }], includeKeywords: ["node"], excludeKeywords: [], targetRoles: ["Backend Engineer"], locations: ["Remote"], remotePolicy: "remote", seniority: "", maxLeadsPerRun: 10, enabledSources: ["greenhouse"], schedule: { enabled: false, cron: "" }, sourcePreset: "ats_only" }),
  mergeDiscoveryConfig, now: () => new Date(NOW), randomId: (p) => `${p}_${++run}`,
});
const req = { event: DISCOVERY_WEBHOOK_EVENT, schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION, sheetId: "s", variationKey: "v", requestedAt: NOW, discoveryProfile: { targetRoles: "Backend Engineer", keywordsInclude: "node" } };
for (const n of [1, 2]) {
  const r = await runDiscovery(req, "manual", deps());
  console.log(`run ${n}: state=${r.lifecycle.state} leads=${r.lifecycle.normalizedLeadCount} snapshotReadAtStart=${JSON.stringify(snapshotCompanies[n - 1])}`);
  console.log(`   memory counts after run ${n}:`, JSON.stringify(raw.getCounts()));
}
raw.close();
