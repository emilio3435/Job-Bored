// Probe: confirm scoreListingWithLlm hits gemini-3.5-flash endpoint.
// Run from repo root with:
//   node --experimental-strip-types probes/probe-profile-aware-scorer.mjs

import { scoreListingWithLlm } from "../integrations/browser-use-discovery/src/normalize/profile-aware-scorer.ts";

const capturedRequests = [];

const fakeFetch = async (url, init) => {
  capturedRequests.push({ url: String(url), method: init?.method });
  // Return a minimal-but-valid Gemini response shape so the scorer parses without throwing.
  const fakeBody = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                fitScore: 0.5,
                fitLevel: "match",
                reasons: ["probe"],
                blockers: [],
                signals: { compensation: null, location: null, seniority: null, contractType: null },
              }),
            },
          ],
        },
        finishReason: "STOP",
      },
    ],
  };
  return new Response(JSON.stringify(fakeBody), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const minimalListing = {
  url: "https://example.com/jobs/probe",
  canonicalUrl: "https://example.com/jobs/probe",
  title: "Probe Title",
  company: "ProbeCo",
  location: "Remote",
  description: "Probe job description.",
  source: "probe",
};

const minimalProfile = {
  identity: { primaryNarrative: "Probe user." },
  strengths: [{ rank: 1, name: "probe-strength", keywords: [], evidence: "" }],
  wants: [],
  avoids: [],
  tieBreakers: null,
};

try {
  await scoreListingWithLlm(minimalListing, minimalProfile, {
    runtimeConfig: { geminiApiKey: "probe-key" }, // no geminiModel -> default kicks in
    fetchImpl: fakeFetch,
  });
} catch (err) {
  console.error("PROBE_NOTE: scoreListingWithLlm threw — that's OK if we still captured the URL:", err.message);
}

const hit = capturedRequests[0];
if (!hit) {
  console.error("PROBE_FAIL: no outbound request observed.");
  process.exit(2);
}
console.log("PROBE_REQUEST:", hit.url);
const expectedSlug = "gemini-3.5-flash";
if (hit.url.includes(expectedSlug)) {
  console.log(`PROBE_PASS: URL contains ${expectedSlug}`);
  process.exit(0);
} else {
  console.error(`PROBE_FAIL: URL does NOT contain ${expectedSlug}`);
  process.exit(1);
}
