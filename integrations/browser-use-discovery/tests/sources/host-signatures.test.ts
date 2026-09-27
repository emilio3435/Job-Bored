import assert from "node:assert/strict";
import test from "node:test";

import {
  AGGREGATOR_HOST_SIGNATURES,
  ATS_HOST_SIGNATURES,
} from "../../src/sources/host-signatures.ts";

function atsProviderForHost(host: string): string | undefined {
  for (const signature of ATS_HOST_SIGNATURES) {
    if (signature.match.test(host)) return signature.provider;
  }
  return undefined;
}

// C10: ATS host regexes must anchor to real ATS domains. A substring match
// lets lookalike hosts ("clever.com" contains "lever") skew SerpApi URL
// ranking and providerType inference.
test("C10: lookalike hosts do not match any ATS provider", () => {
  assert.equal(atsProviderForHost("clever.com"), undefined);
  assert.equal(atsProviderForHost("www.clever.com"), undefined);
  assert.equal(atsProviderForHost("greenhouse-careers-scam.com"), undefined);
  assert.equal(
    atsProviderForHost("www.greenhouse-careers-scam.com"),
    undefined,
  );
  assert.equal(atsProviderForHost("notlever.co"), undefined);
  assert.equal(atsProviderForHost("lever.co.evil.com"), undefined);
});

test("C10: real ATS board hosts still resolve to their provider", () => {
  const cases: Array<[string, string]> = [
    ["boards.greenhouse.io", "greenhouse"],
    ["boards.eu.greenhouse.io", "greenhouse"],
    ["job-boards.greenhouse.io", "greenhouse"],
    ["jobs.lever.co", "lever"],
    ["jobs.ashbyhq.com", "ashby"],
    ["jobs.smartrecruiters.com", "smartrecruiters"],
    ["acme.wd5.myworkdayjobs.com", "workday"],
    ["acme.icims.com", "icims"],
    ["jobs.jobvite.com", "jobvite"],
    ["acme.taleo.net", "taleo"],
    ["acme.successfactors.com", "successfactors"],
    ["apply.workable.com", "workable"],
    ["acme.breezy.hr", "breezy"],
    ["acme.recruitee.com", "recruitee"],
    ["acme.teamtailor.com", "teamtailor"],
    ["jobs.personio.de", "personio"],
  ];
  for (const [host, provider] of cases) {
    assert.equal(atsProviderForHost(host), provider, host);
  }
});

test("C10: aggregator table matches the shared job-board hosts", () => {
  const matches = (host: string) =>
    AGGREGATOR_HOST_SIGNATURES.some((signature) => signature.match.test(host));
  for (const host of [
    "lnkd.in",
    "www.builtinnyc.com",
    "www.welcometothejungle.com",
    "www.jobs2careers.com",
    "www.linkedin.com",
    "www.indeed.com",
  ]) {
    assert.ok(matches(host), `${host} should match the aggregator table`);
  }
  assert.ok(!matches("boards.greenhouse.io"));
  assert.ok(!matches("careers.acme.example"));
});
