/**
 * A staged Wave 3 package: what feat/materials-w3-intel writes beside the
 * letter (outreach.json, outreach.txt, intel.json, manifest.outreach,
 * manifest.intel). Shapes follow materials.outreach.v1 / materials.intel.v1
 * as that branch writes them. Fictional people and example URLs only.
 */

export const W3_OUTREACH = {
  contract: "materials.outreach.v1",
  runId: "mr_20260927091000_meridian_b2",
  generatedAt: "2026-09-27T09:10:00.000Z",
  company: "Meridian Labs",
  title: "Senior Product Manager",
  contact: { name: "Dana", source: "sheet", raw: "Dana Reyes" },
  greeting: "Hi Dana,",
  linkedin: {
    text: "Hi Dana, I just applied for the Senior PM role. I owned the pricing roadmap for a B2B SaaS line and grew expansion revenue 18%. Worth a 15-minute call about how Meridian is approaching usage-based pricing?",
    chars: 0,
    max: 300,
  },
  email: {
    subject: "Senior Product Manager: pricing roadmap",
    body: "Hi Dana,\n\nI applied for the Senior Product Manager role this morning. At my last company I owned the pricing roadmap for a B2B SaaS line and grew expansion revenue 18% in a year.\n\nWould a 15-minute call next week work?\n\nJordan",
    words: 45,
    max: 120,
  },
  qa: {
    status: "review",
    checks: [
      { code: "linkedin_length", severity: "pass", message: "LinkedIn note is 196/300 characters" },
      { code: "support", severity: "review", message: "no support verdicts (the fact check did not run)" },
    ],
  },
  sources: [],
};
W3_OUTREACH.linkedin.chars = W3_OUTREACH.linkedin.text.length;

export const W3_OUTREACH_TXT = `LinkedIn note (${W3_OUTREACH.linkedin.chars}/300 characters)\n\n${W3_OUTREACH.linkedin.text}\n`;

export const W3_INTEL = {
  contract: "materials.intel.v1",
  fetchedAt: "2026-09-27T09:05:00.000Z",
  ttlDays: 14,
  company: { name: "Meridian Labs", domain: "meridian-labs.example" },
  mission: "Make usage-based pricing simple for B2B software.",
  missionSource: { url: "https://meridian-labs.example/about", kind: "search" },
  products: [{ name: "Meter", oneLine: "usage metering for SaaS billing", url: "https://meridian-labs.example/meter" }],
  news: [{ headline: "Meridian Labs raises a Series B", summary: "to expand its pricing platform", date: "2026-08", url: "https://news.example.com/meridian-series-b" }],
  sources: ["https://news.example.com/meridian-series-b"],
};

export const W3_MANIFEST_EXTRA = {
  outreach: {
    json: "outreach.json",
    txt: "outreach.txt",
    runId: "mr_20260927091000_meridian_b2",
    status: "review",
    linkedinChars: W3_OUTREACH.linkedin.chars,
    emailWords: 45,
    contact: "Dana",
  },
  intel: { json: "intel.json", runId: "mr_20260927091000_meridian_b2", facts: 3, news: 1 },
};
