import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  normalizeLead,
  normalizeLeadUrl,
} from "../../src/normalize/lead-normalizer.ts";

function makeRun(overrides = {}) {
  return {
    runId: "run_test_1",
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
      companies: [{ name: "Acme", includeKeywords: ["TypeScript"] }],
      includeKeywords: ["Node", "browser automation"],
      excludeKeywords: ["wordpress"],
      targetRoles: ["Platform Engineer", "Backend Engineer"],
      locations: ["Remote", "Austin"],
      remotePolicy: "remote-first",
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

test("normalizeLeadUrl removes tracking params and trailing slashes", () => {
  assert.equal(
    normalizeLeadUrl(
      "https://jobs.example.com/backend-engineer/?utm_source=linkedin&jobId=123#section",
    ),
    "https://jobs.example.com/backend-engineer?jobId=123",
  );
});

test("normalizeLead returns a scored normalized lead with stable defaults", () => {
  const run = makeRun();
  const lead = normalizeLead(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Senior Platform Engineer",
      company: "Acme",
      location: "Austin, TX Remote-first",
      url: "https://jobs.example.com/backend-engineer/?utm_source=linkedin&jobId=123",
      compensationText: "$180k-$210k",
      contact: "Ada Lovelace",
      descriptionText:
        "Build browser automation systems in Node and TypeScript for a senior backend platform team.",
      tags: ["automation"],
      metadata: {
        sourceQuery: "Acme platform engineer",
      },
    },
    run,
  );

  assert.ok(lead);
  assert.equal(lead?.url, "https://jobs.example.com/backend-engineer?jobId=123");
  assert.equal(lead?.status, "New");
  assert.equal(lead?.metadata.runId, "run_test_1");
  assert.equal(lead?.metadata.variationKey, "var_123");
  assert.equal(lead?.metadata.sourceQuery, "Acme platform engineer");
  assert.ok((lead?.fitScore || 0) >= 8);
  assert.ok(["⚡", "🔥"].includes(lead?.priority || ""));
  assert.ok(lead?.tags.includes("Node"));
  assert.ok(lead?.tags.includes("Platform Engineer"));
  assert.match(lead?.fitAssessment || "", /Role match/i);
});

test("normalizeLead filters out excluded-keyword matches", () => {
  const run = makeRun();
  const lead = normalizeLead(
    {
      sourceId: "lever",
      sourceLabel: "Lever",
      title: "Senior WordPress Engineer",
      company: "Acme",
      location: "Remote",
      url: "https://jobs.example.com/wordpress",
      descriptionText: "WordPress platform role",
    },
    run,
  );

  assert.equal(lead, null);
});
