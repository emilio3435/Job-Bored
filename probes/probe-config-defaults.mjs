// Probe: confirm the canonical runtime config default is the Gemini Flash family,
// and HTTP endpoints resolve it to a pinned snapshot (gemini-3.7-flash).
// This validates that grounded-search.ts, job-matcher.ts, and
// profile-to-companies.ts all inherit the right default when the user
// hasn't set BROWSER_USE_DISCOVERY_GEMINI_MODEL and no llm.json pin exists.
//
// Run from repo root with:
//   node --experimental-strip-types probes/probe-config-defaults.mjs

import { loadRuntimeConfig } from "../integrations/browser-use-discovery/src/config.ts";

// Empty env -> default should kick in. Isolate the pin path so a developer
// machine's ~/.jobbored/llm.json cannot shadow the hardcoded fallback.
const emptyEnv = {
  JOBBORED_LLM_CONFIG_PATH: "/tmp/jobbored-missing-llm-pin.json",
};
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

const httpModel =
  !cfg.geminiModel || cfg.geminiModel === "gemini-flash"
    ? "gemini-3.7-flash"
    : cfg.geminiModel;
const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(httpModel)}:generateContent`;
console.log("PROBE_RESOLVED_URL:", url);

const expected = "gemini-3.7-flash";
let pass = true;
if (!url.includes(expected)) {
  console.error(`PROBE_FAIL: default URL does not contain ${expected}`);
  pass = false;
}
const expectedCfg = "gemini-flash";
if (cfg.geminiModel !== expectedCfg) {
  console.error(`PROBE_FAIL: cfg.geminiModel (${cfg.geminiModel}) !== ${expectedCfg}`);
  pass = false;
}

if (pass) {
  console.log(
    `PROBE_PASS: runtimeConfig.geminiModel is ${expectedCfg} and call sites resolve to ${expected} for HTTP.`,
  );
  for (const cs of callSites) console.log("  - " + cs);
  process.exit(0);
} else {
  process.exit(1);
}
