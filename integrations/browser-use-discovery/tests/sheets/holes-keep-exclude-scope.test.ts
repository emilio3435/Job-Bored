// HOLES KEEP R1: an exclude keyword matches the headline (title, company,
// location, tags) by default. "anywhere: <keyword>" opts that keyword into
// the description as well. A boilerplate mention never drops a lead silently.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { scoreListingMatch } from "../../src/match/job-matcher.ts";
import {
  findMatchedKeywords,
  normalizeLeadWithDiagnostics,
} from "../../src/normalize/lead-normalizer.ts";

function makeRun(excludeKeywords: string[]) {
  return {
    runId: "run_holes_keep_r1",
    trigger: "manual",
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_123",
      variationKey: "var_123",
      requestedAt: "2026-10-01T12:00:00.000Z",
    },
    config: {
      sheetId: "sheet_123",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Scale AI" }],
      includeKeywords: ["product"],
      excludeKeywords,
      targetRoles: ["Product Manager"],
      locations: ["Remote", "United States"],
      remotePolicy: "remote",
      seniority: "",
      maxLeadsPerRun: 20,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_123",
      requestedAt: "2026-10-01T12:00:00.000Z",
    },
  } as never;
}

const CLEARANCE_IN_DESCRIPTION = {
  sourceId: "greenhouse",
  sourceLabel: "Greenhouse",
  title: "AI Product Manager",
  company: "Scale AI",
  location: "Remote in United States",
  url: "https://jobs.example.com/ai-product-manager/4012",
  descriptionText: "Ship AI product workflows. Some federal programs require a security clearance.",
  tags: ["Product"],
};

test("R1: by default a description-only exclude hit neither penalizes nor reports the lead", () => {
  const result = scoreListingMatch(CLEARANCE_IN_DESCRIPTION, makeRun(["security clearance"]));
  assert.equal(result.componentScores.negative, 1);
  assert.deepEqual(result.excludeKeywordMatches, []);
  assert.equal(result.hardRejectReason, "");
});

test("R1: an 'anywhere:' keyword opts into matching the description", () => {
  const result = scoreListingMatch(CLEARANCE_IN_DESCRIPTION, makeRun(["anywhere: security clearance"]));
  assert.equal(result.componentScores.negative, 0.45);
  assert.deepEqual(result.excludeKeywordMatches, ["security clearance"]);
});

test("R1: an 'anywhere:' keyword still hard-rejects a headline match, reported without the prefix", () => {
  const result = scoreListingMatch(
    { ...CLEARANCE_IN_DESCRIPTION, title: "Security Clearance Program Manager" },
    makeRun(["anywhere:security clearance"]),
  );
  assert.equal(result.decision, "reject");
  assert.match(result.hardRejectReason, /: security clearance\.$/);
});

test("R1: lead-normalizer's exclude filter reads the headline unless the keyword says anywhere", async () => {
  const kept = await normalizeLeadWithDiagnostics(CLEARANCE_IN_DESCRIPTION, makeRun(["security clearance"]), {
    enforceRelevanceFilters: true,
  });
  assert.equal(kept.rejection, null);
  assert.ok(kept.lead);

  const dropped = await normalizeLeadWithDiagnostics(
    CLEARANCE_IN_DESCRIPTION,
    makeRun(["anywhere: security clearance"]),
    { enforceRelevanceFilters: true },
  );
  assert.equal(dropped.lead, null);
  assert.equal(dropped.rejection?.reason, "excluded_keyword");
  assert.deepEqual(dropped.rejection?.matchedKeywords, ["security clearance"]);
});

test("R1: title-only checks (the backlog re-check) read an 'anywhere:' keyword as the keyword itself", () => {
  assert.equal(findMatchedKeywords("Clearance Program Analyst", ["anywhere: clearance"]).length, 1);
  assert.equal(findMatchedKeywords("Program Analyst", ["anywhere: clearance"]).length, 0);
});
