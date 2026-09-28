// Probe (stubbed fetch, fake key, no network): count chat-provider calls in one
// ATS run of N listings when the dashboard sends mergedUserProfile (the normal
// UI path). Also shows the calls land before frontier selection (18-slot cap)
// and that a second identical run re-scores every listing (no score cache).
import { readFileSync } from "node:fs";
import { mergeDiscoveryConfig } from "../../integrations/browser-use-discovery/src/config.ts";
import { runDiscovery } from "../../integrations/browser-use-discovery/src/run/run-discovery.ts";
import { createWorkerChatMatchClient } from "../../integrations/browser-use-discovery/src/match/job-matcher.ts";
const example = JSON.parse(readFileSync(new URL("../../examples/discovery-webhook-request.v1-with-profile.json", import.meta.url)));
const N = Number(process.env.PROBE_LISTINGS || 25);
let chatCalls = 0, promptChars = 0;
const fitReply = JSON.stringify({ fitScore: 8, band: "strong", perStrength: [], concerns: [], matches: [], rationale: "probe" });
globalThis.fetch = async (url, init) => {
  chatCalls++; promptChars += String(init?.body || "").length;
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: fitReply }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
};
const runtimeConfig = { geminiApiKey: "probe-key", geminiModel: "gemini-2.5-flash", llmProvider: "gemini", runMode: "hosted", allowedOrigins: [], port: 0, host: "127.0.0.1" };
const NOW = "2026-09-25T12:00:00.000Z";
let seq = 0; let written = 0;
const deps = () => ({
  runtimeConfig,
  matchClient: createWorkerChatMatchClient(runtimeConfig),
  sourceAdapterRegistry: { adapters: [],
    detectBoards: async () => [{ matched: true, sourceId: "greenhouse", sourceLabel: "Greenhouse", boardUrl: "https://boards.greenhouse.io/acme", confidence: 1, warnings: [] }],
    collectListings: async () => Array.from({ length: N }, (_, i) => ({ sourceId: "greenhouse", sourceLabel: "Greenhouse", title: `Staff Backend Engineer ${i}`, company: "Acme", location: "Remote", url: `https://boards.greenhouse.io/acme/jobs/${5000000 + i}`, descriptionText: "Go, Postgres, distributed systems. Remote US.", tags: ["go"], remoteBucket: process.env.PROBE_BUCKET === "unset" ? undefined : "remote" })) },
  pipelineWriter: { write: async (sheetId, leads) => { written = leads.length; return { sheetId, appended: leads.length, updated: 0, skippedDuplicates: 0, skippedBlacklist: 0, warnings: [] }; } },
  loadStoredWorkerConfig: async (sheetId) => ({ sheetId, mode: "hosted", timezone: "UTC", companies: [{ name: "Acme" }], includeKeywords: ["go"], excludeKeywords: [], targetRoles: ["Backend Engineer"], locations: ["Remote"], remotePolicy: "remote", seniority: "", maxLeadsPerRun: 50, enabledSources: ["greenhouse"], schedule: { enabled: false, cron: "" }, sourcePreset: "ats_only" }),
  mergeDiscoveryConfig, now: () => new Date(NOW), randomId: (p) => `${p}_${++seq}`,
});
const req = { ...example, sheetId: "s", companyAllowlist: [], companyBlocklist: [], discoveryProfile: { ...example.discoveryProfile, sourcePreset: "ats_only", maxLeadsPerRun: "50" } };
for (const n of [1, 2]) {
  chatCalls = 0; promptChars = 0;
  const r = await runDiscovery(req, "manual", deps());
  if (n === 1) console.log("rejections:", JSON.stringify(r.sourceSummary.map((s) => [s.sourceId, s.leadsSeen, s.leadsAccepted, s.rejectionSummary?.rejectionReasons, s.rejectionSummary?.rejectionSamples?.[0]?.detail])));
  console.log(`run ${n}: listings=${N} chatCalls=${chatCalls} requestBodyChars=${promptChars} (~${Math.round(promptChars / 4)} input tokens) written=${written} state=${r.lifecycle.state} profileUsed=${!!r.run.config.userProfile}`);
}
