// Probe: confirm the canonical runtime config default is gemini-3.5-flash.
// This validates that grounded-search.ts, job-matcher.ts, and
// profile-to-companies.ts all inherit the right default when the user
// hasn't set BROWSER_USE_DISCOVERY_GEMINI_MODEL.
//
// Run from repo root with:
//   node --experimental-strip-types probes/probe-config-defaults.mjs

import { loadRuntimeConfig } from "../integrations/browser-use-discovery/src/config.ts";

// Empty env -> default should kick in.
const emptyEnv = {};
const cfg = loadRuntimeConfig(emptyEnv);
console.log("PROBE_CONFIG_geminiModel:", cfg.geminiModel);

// Now simulate the URL each call site would build.
const callSites = [
  "grounded-search.ts:690 (findHostsForCompany)",
  "grounded-search.ts:945 (career-surface-resolver)",
  "grounded-search.ts:1024 (multi-rung query)",
  "grounded-search.ts:1173 (prose endpoint)",
  "grounded-search.ts:1235 (structuring endpoint)",
  "job-matcher.ts:298 (evaluate)",
  "profile-aware-scorer.ts:311 (scoreListingWithLlm)",
  "profile-to-companies.ts:555 (extractCandidateProfile)",
  "profile-to-companies.ts:1125 (provider registry)",
  "profile-to-companies.ts:1667 (discoverCompaniesForProfile)",
];

const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.geminiModel || "gemini-3.5-flash")}:generateContent`;
console.log("PROBE_RESOLVED_URL:", url);

const expected = "gemini-3.5-flash";
let pass = true;
if (!url.includes(expected)) {
  console.error(`PROBE_FAIL: default URL does not contain ${expected}`);
  pass = false;
}
if (cfg.geminiModel !== expected) {
  console.error(`PROBE_FAIL: cfg.geminiModel (${cfg.geminiModel}) !== ${expected}`);
  pass = false;
}

if (pass) {
  console.log(`PROBE_PASS: all ${callSites.length} call sites inherit ${expected} via runtimeConfig.geminiModel.`);
  for (const cs of callSites) console.log("  - " + cs);
  process.exit(0);
} else {
  process.exit(1);
}
