import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import {
  scoreListingMatch,
  shouldUseAiMatcher,
} from "../../src/match/job-matcher.ts";

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

test("scoreListingMatch does not let single-letter keywords match arbitrary words", () => {
  const result = scoreListingMatch(
    {
      sourceId: "grounded_web",
      sourceLabel: "Grounded Web",
      title: "Customer Success Manager",
      company: "Scale AI",
      location: "Remote in United States",
      url: "https://jobs.example.com/customer-success-manager",
      descriptionText: "Support customers and improve retention.",
      tags: ["Customer Success"],
    },
    makeRun({
      includeKeywords: ["R"],
      targetRoles: [],
      remotePolicy: "",
    }),
  );

  assert.notEqual(result.decision, "accept");
  assert.ok(
    result.reasons.every((reason) => !/Matched role phrases: R/i.test(reason)),
  );
});

test("shouldUseAiMatcher does not spend AI calls on deterministic rejects", () => {
  const decision = scoreListingMatch(
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

  assert.equal(decision.decision, "reject");
  assert.equal(shouldUseAiMatcher(decision, makeRun(), 0), false);
});

test("shouldUseAiMatcher caps ATS follow-up calls more aggressively", () => {
  const uncertain = {
    decision: "uncertain",
    overallScore: 0.5,
    confidence: 0.55,
    componentScores: {
      role: 0.5,
      location: 0.5,
      remote: 0.5,
      seniority: 0.5,
      negative: 1,
    },
    reasons: ["Borderline role fit."],
    hardRejectReason: "",
    modelVersion: "deterministic-structured-v1",
    promptVersion: "job-match-v1",
  } as const;

  assert.equal(shouldUseAiMatcher(uncertain, makeRun(), 0), true);
  assert.equal(shouldUseAiMatcher(uncertain, makeRun(), 12), false);
});
