import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  buildLeadFingerprint,
  normalizeLead,
} from "../../src/normalize/lead-normalizer.ts";

function makeRun(overrides = {}) {
  return {
    runId: "run_fingerprint_test",
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_123",
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
    },
    config: {
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme" }],
      includeKeywords: ["Node", "TypeScript"],
      excludeKeywords: [],
      targetRoles: ["Platform Engineer", "Backend Engineer"],
      locations: ["Remote", "United States"],
      remotePolicy: "remote",
      seniority: "senior",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse", "lever", "ashby"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
      ...overrides,
    },
  };
}

test("buildLeadFingerprint prefers canonicalUrl + externalJobId when both are present", () => {
  const fingerprint = buildLeadFingerprint({
    title: "Senior Platform Engineer",
    company: "Acme",
    location: "Remote in USA",
    url: "https://jobs.example.com/platform/?utm_source=linkedin",
    canonicalUrl:
      "https://jobs.example.com/platform/?gh_jid=456&utm_campaign=spring",
    externalJobId: "GH-456",
    descriptionText: "Build browser automation systems in TypeScript.",
  });

  assert.equal(
    fingerprint.fingerprintBasis,
    "canonical_url_external_job_id",
  );
  assert.equal(
    fingerprint.canonicalUrl,
    "https://jobs.example.com/platform?gh_jid=456",
  );
  assert.equal(fingerprint.externalJobId, "gh-456");
  assert.equal(
    fingerprint.semanticKey,
    "acme|senior platform engineer|remote in united states|remote",
  );
  assert.match(fingerprint.fingerprintKey, /^primary:/);
});

test("buildLeadFingerprint falls back to semantic identity and keeps location in the key", () => {
  const chicago = buildLeadFingerprint({
    title: "Backend Engineer",
    company: "Acme",
    location: "Chicago, IL",
    descriptionText: "Own internal platform services.",
  });
  const newYork = buildLeadFingerprint({
    title: "Backend Engineer",
    company: "Acme",
    location: "New York, NY",
    descriptionText: "Own internal platform services.",
  });

  assert.equal(
    chicago.fingerprintBasis,
    "company_title_location_remote",
  );
  assert.equal(
    chicago.semanticKey,
    "acme|backend engineer|chicago il|unknown",
  );
  assert.equal(
    newYork.semanticKey,
    "acme|backend engineer|new york ny|unknown",
  );
  assert.notEqual(chicago.semanticKey, newYork.semanticKey);
  assert.notEqual(chicago.fingerprintKey, newYork.fingerprintKey);
});

test("buildLeadFingerprint falls back to content hash when semantic identity is incomplete", () => {
  const fingerprint = buildLeadFingerprint({
    title: "ML Engineer",
    location: "Remote",
    descriptionText: "Design retrieval systems across agents and ranking flows.",
  });
  const fingerprintVariant = buildLeadFingerprint({
    title: "  ML Engineer  ",
    location: "Remote",
    descriptionText:
      "Design retrieval systems across agents and ranking flows.",
  });

  assert.equal(fingerprint.fingerprintBasis, "content_hash");
  assert.match(fingerprint.fingerprintKey, /^content:/);
  assert.equal(fingerprint.fingerprintKey, fingerprintVariant.fingerprintKey);
  assert.equal(fingerprint.contentHash, fingerprintVariant.contentHash);
});

test("normalizeLead stamps fingerprint metadata for downstream cross-run dedupe", () => {
  const lead = normalizeLead(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior Platform Engineer",
      company: "Acme",
      location: "Remote in USA",
      url: "https://jobs.example.com/platform/?utm_source=linkedin",
      canonicalUrl:
        "https://jobs.example.com/platform/?gh_jid=789&utm_campaign=spring",
      externalJobId: "GH-789",
      remoteBucket: "remote",
      employmentType: "Full Time",
      descriptionText:
        "Build browser automation systems in Node and TypeScript for a senior platform team.",
      tags: ["automation"],
      metadata: {
        sourceQuery: "Acme platform engineer",
        boardToken: "acme",
        surfaceId: "surface_123",
      },
    },
    makeRun(),
  );

  assert.ok(lead);
  assert.equal(
    lead?.metadata.canonicalUrl,
    "https://jobs.example.com/platform?gh_jid=789",
  );
  assert.equal(lead?.metadata.externalJobId, "gh-789");
  assert.equal(lead?.metadata.remoteBucket, "remote");
  assert.equal(lead?.metadata.employmentType, "full time");
  assert.equal(lead?.metadata.companyKey, "acme");
  assert.equal(
    lead?.metadata.semanticKey,
    "acme|senior platform engineer|remote in united states|remote",
  );
  assert.match(lead?.metadata.fingerprintKey || "", /^primary:/);
});
