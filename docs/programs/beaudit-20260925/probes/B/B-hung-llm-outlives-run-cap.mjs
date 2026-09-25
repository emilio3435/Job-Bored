// Probe (stubbed, no network): the profile LLM scorer call hangs. The run is
// given maxRunDurationMs=1500. Does runDiscovery return near its cap?
import { readFileSync } from "node:fs";
import { mergeDiscoveryConfig } from "../../integrations/browser-use-discovery/src/config.ts";
import { runDiscovery } from "../../integrations/browser-use-discovery/src/run/run-discovery.ts";
const example = JSON.parse(readFileSync(new URL("../../examples/discovery-webhook-request.v1-with-profile.json", import.meta.url)));
let sawSignal = false;
globalThis.fetch = (url, init) => { if (init?.signal) sawSignal = true; return new Promise(() => {}); }; // provider never answers
const NOW = "2026-09-25T12:00:00.000Z";
const deps = {
  runtimeConfig: { geminiApiKey: "probe-key", geminiModel: "gemini-2.5-flash", llmProvider: "gemini", runMode: "hosted", allowedOrigins: [], port: 0, host: "127.0.0.1" },
  maxRunDurationMs: 1500,
  sourceAdapterRegistry: { adapters: [], detectBoards: async () => [{ matched: true, sourceId: "greenhouse", sourceLabel: "Greenhouse", boardUrl: "https://boards.greenhouse.io/acme", confidence: 1, warnings: [] }],
    collectListings: async () => [{ sourceId: "greenhouse", sourceLabel: "Greenhouse", title: "Staff Backend Engineer", company: "Acme", location: "Remote", url: "https://boards.greenhouse.io/acme/jobs/5000001", descriptionText: "Go Postgres", remoteBucket: "remote" }] },
  pipelineWriter: { write: async (s, l) => ({ sheetId: s, appended: l.length, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] }) },
  loadStoredWorkerConfig: async (sheetId) => ({ sheetId, mode: "hosted", timezone: "UTC", companies: [{ name: "Acme" }], includeKeywords: ["go"], excludeKeywords: [], targetRoles: ["Backend Engineer"], locations: ["Remote"], remotePolicy: "remote", seniority: "", maxLeadsPerRun: 5, enabledSources: ["greenhouse"], schedule: { enabled: false, cron: "" }, sourcePreset: "ats_only" }),
  mergeDiscoveryConfig, now: () => new Date(), randomId: (p) => p + "_1",
};
const req = { ...example, sheetId: "s", companyAllowlist: [], companyBlocklist: [], discoveryProfile: { ...example.discoveryProfile, sourcePreset: "ats_only" } };
const t0 = Date.now();
const outcome = await Promise.race([
  runDiscovery(req, "manual", deps).then((r) => `returned state=${r.lifecycle.state}`, (e) => `threw ${e?.name}: ${e?.message}`),
  new Promise((res) => setTimeout(() => res("STILL RUNNING"), 8000)),
]);
console.log(`maxRunDurationMs=1500 | after ${Date.now() - t0}ms: ${outcome} | LLM fetch received an AbortSignal: ${sawSignal}`);
process.exit(0);
