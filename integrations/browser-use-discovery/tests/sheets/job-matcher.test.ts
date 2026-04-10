import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { scoreListingMatch } from "../../src/match/job-matcher.ts";

function makeRun(overrides = {}) {
  return {
    runId: "run_test_matcher",
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
      companies: [{ name: "Scale AI" }],
      includeKeywords: ["AI", "product", "marketing"],
      excludeKeywords: ["account executive", "recruiter", "finance", "legal"],
      targetRoles: ["Product Manager", "Growth Marketing"],
      locations: ["Remote", "United States", "Chicago"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 20,
      enabledSources: ["greenhouse", "ashby", "grounded_web"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-04-09T12:00:00.000Z",
      ...overrides,
    },
  };
}

test("scoreListingMatch does not hard reject good roles because exclude words appear in boilerplate", () => {
  const result = scoreListingMatch(
    {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "AI Product Manager",
      company: "Scale AI",
      location: "Remote in United States",
      url: "https://jobs.example.com/ai-product-manager",
      descriptionText:
        "Partner with recruiter enablement and finance systems stakeholders while shipping AI product workflows.",
      tags: ["Product"],
    },
    makeRun(),
  );

  assert.equal(result.decision, "accept");
  assert.equal(result.hardRejectReason, "");
  assert.ok(result.componentScores.role >= 0.8);
  assert.ok(result.componentScores.negative > 0);
});

test("scoreListingMatch infers usable location when the structured location field is empty", () => {
  const result = scoreListingMatch(
    {
      sourceId: "grounded_web",
      sourceLabel: "Grounded Web",
      title: "Staff Product Manager, AI Applications (Remote - US)",
      company: "Scale AI",
      location: "",
      url: "https://company.example/jobs/staff-pm-ai-applications",
      descriptionText: "Lead product strategy for applied AI systems.",
      tags: ["AI", "Product"],
    },
    makeRun(),
  );

  assert.equal(result.decision, "accept");
  assert.ok(result.componentScores.location >= 0.8);
  assert.ok(result.componentScores.remote >= 0.8);
});

test("scoreListingMatch hard rejects explicit excluded roles", () => {
  const result = scoreListingMatch(
    {
      sourceId: "ashby",
      sourceLabel: "Ashby",
      title: "Enterprise Account Executive",
      company: "Notion",
      location: "Remote in United States",
      url: "https://jobs.example.com/enterprise-ae",
      descriptionText: "Own enterprise revenue expansion.",
      tags: ["Sales"],
    },
    makeRun({
      companies: [{ name: "Notion" }],
    }),
  );

  assert.equal(result.decision, "reject");
  assert.match(result.hardRejectReason, /account executive/i);
});
