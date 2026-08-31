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

test("buildLeadFingerprint prefers canonicalUrl + externalJobId when both are present", async () => {
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

test("buildLeadFingerprint falls back to semantic identity and keeps location in the key", async () => {
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

test("buildLeadFingerprint falls back to content hash when semantic identity is incomplete", async () => {
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

test("normalizeLead stamps fingerprint metadata for downstream cross-run dedupe", async () => {
  const lead = await normalizeLead(
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

test("F1D-RUN09-LOC production run identity keeps distinct locations", async () => {
  const { dedupeLeadsForProductionRun } = await import(
    "../../src/normalize/intake-identity.ts"
  );
  const result = dedupeLeadsForProductionRun([
    {
      title: "Account Executive",
      company: "Acme Labs",
      location: "Austin, TX",
      url: "https://boards.greenhouse.io/acme/jobs/111",
      sourceId: "greenhouse",
      metadata: { jobId: "111" },
    },
    {
      title: "Account Executive",
      company: "Acme Labs",
      location: "New York, NY",
      url: "https://boards.greenhouse.io/acme/jobs/222",
      sourceId: "greenhouse",
      metadata: { jobId: "222" },
    },
  ]);

  assert.equal(result.uniqueItems.length, 2);
  assert.equal(result.duplicateCount, 0);
});

test("F1D-RUN10-ATTR identity layer keeps successful sibling boards when one fails", async () => {
  const { retainAttributedBoardSuccesses } = await import(
    "../../src/normalize/intake-identity.ts"
  );
  const result = retainAttributedBoardSuccesses([
    {
      boardId: "greenhouse",
      status: "fulfilled",
      value: [
        {
          title: "Platform Engineer",
          company: "Acme",
          location: "Remote",
          url: "https://boards.greenhouse.io/acme/jobs/1",
        },
      ],
    },
    {
      boardId: "lever",
      status: "rejected",
      reason: new Error("lever timeout"),
    },
    {
      boardId: "ashby",
      status: "fulfilled",
      value: [
        {
          title: "Platform Engineer",
          company: "Beta",
          location: "Chicago, IL",
          url: "https://jobs.ashbyhq.com/beta/abc",
        },
      ],
    },
  ]);

  assert.equal(result.leads.length, 2);
  assert.equal(result.leads[0].company, "Acme");
  assert.equal(result.leads[1].company, "Beta");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].boardId, "lever");
  assert.match(String(result.failures[0].reason), /timeout/i);
});
