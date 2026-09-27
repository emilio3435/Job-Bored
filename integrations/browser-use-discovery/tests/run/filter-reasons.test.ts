// DISCAT Fix-B: honest rejection reasons and sales role families. The
// DiscoveryRuns Run ID column (K) is RUNHIST #135's; its writer tests cover it.
import assert from "node:assert/strict";
import test from "node:test";

import type { RawListing } from "../../src/contracts.ts";
import type { UserProfile } from "../../src/contracts/user-profile.ts";
import { inferRoleFamilies, scoreListingMatch } from "../../src/match/job-matcher.ts";
import { preFilterRejection } from "../../src/normalize/lead-normalizer.ts";
import { runPreFilter } from "../../src/normalize/profile-aware-scorer.ts";
import { selectNearMissListings } from "../../src/run/filter-stats.ts";

function profile(hard: Partial<UserProfile["hardConstraints"]>): UserProfile {
  return {
    hardConstraints: { workMode: "any", ...hard },
  } as unknown as UserProfile;
}

function raw(extra: Partial<RawListing> = {}): RawListing {
  return {
    sourceId: "greenhouse",
    sourceLabel: "Greenhouse",
    title: "Director of Digital Sales",
    company: "Acme",
    location: "",
    url: "https://boards.greenhouse.io/acme/jobs/1",
    descriptionText: "Lead the digital sales team.",
    ...extra,
  } as RawListing;
}

function reasonFor(listing: RawListing, p: UserProfile) {
  const result = runPreFilter(listing, p);
  assert.equal(result.pass, false, JSON.stringify(result));
  if (result.pass) throw new Error("unreachable");
  return preFilterRejection(result);
}

test("should label a remote-only miss with unknown remote status as remote_unknown", () => {
  const rejection = reasonFor(raw({ location: "" }), profile({ workMode: "remote_only" }));
  assert.equal(rejection.reason, "remote_unknown");
  assert.equal(rejection.matchedKeywords, undefined);
});

test("should label a remote-only miss on a known onsite listing as remote_policy_mismatch", () => {
  const rejection = reasonFor(
    raw({ location: "New York, NY", remoteBucket: "onsite", descriptionText: "Onsite in Manhattan." }),
    profile({ workMode: "remote_only" }),
  );
  assert.equal(rejection.reason, "remote_policy_mismatch");
});

test("should map every other prefilter decision to its own precise reason", () => {
  assert.equal(
    reasonFor(raw({ title: "Sales Intern" }), profile({ skipTitles: ["intern"] })).reason,
    "skip_title",
  );
  assert.deepEqual(
    reasonFor(raw({ title: "Sales Intern" }), profile({ skipTitles: ["intern"] })).matchedKeywords,
    ["intern"],
  );
  assert.equal(
    reasonFor(
      raw({ location: "Denver, CO" }),
      profile({ workMode: "hybrid_ok", acceptableLocations: ["Chicago"] }),
    ).reason,
    "location_mismatch",
  );
  assert.equal(
    reasonFor(
      raw({ descriptionText: "No visa sponsorship available." }),
      profile({ workAuth: "needs_sponsorship" }),
    ).reason,
    "work_auth_mismatch",
  );
  assert.equal(
    reasonFor(raw({ compensationText: "$90k - $110k" }), profile({ salaryFloor: 150000 })).reason,
    "salary_below_floor",
  );
  assert.equal(
    reasonFor(raw({ compensationText: "" }), profile({ salaryRequired: true })).reason,
    "salary_missing",
  );
});

const TARGET_ROLES = [
  "Director of Digital Sales",
  "Head of Digital Strategy",
  "Director of AI Solutions",
];

test("should infer at least one role family for each sales/strategy target role", () => {
  for (const role of TARGET_ROLES) {
    assert.ok(inferRoleFamilies(role).length >= 1, `${role} inferred no family`);
  }
});

test("should count an advertising-sales headline mismatch as a near miss for sales targets", () => {
  const near = selectNearMissListings(
    [
      {
        totalRejected: 2,
        rejectionReasons: { headline_mismatch: 2 },
        rejectionSamples: [],
        headlineMismatches: [
          { title: "VP, Advertising Sales", companyKey: "acme", sourceLane: "ats_provider" },
          { title: "Warehouse Associate", companyKey: "acme", sourceLane: "ats_provider" },
        ],
      } as never,
    ],
    TARGET_ROLES,
  );
  assert.deepEqual(near.map((ref) => ref.title), ["VP, Advertising Sales"]);
});

test("should keep excluded_keyword for matcher rejects only when a keyword matched", async () => {
  const { matchDecisionToRejection } = await import("../../src/run/run-discovery.ts");
  const base = {
    decision: "reject" as const,
    overallScore: 0.2,
    confidence: 0.8,
    componentScores: { role: 1, location: 1, remote: 1, seniority: 1, negative: 0 },
    reasons: [],
    modelVersion: "ai",
    promptVersion: "v",
  };
  const run = { config: { locations: [], remotePolicy: "" } } as never;
  const listing = raw();
  assert.equal(
    matchDecisionToRejection({ ...base, hardRejectReason: "Onsite only." }, listing, run).reason,
    "matcher_rejected",
  );
  const keyword = matchDecisionToRejection(
    { ...base, hardRejectReason: "Headline matched exclude keywords: php.", excludeKeywordMatches: ["php"] },
    listing,
    run,
  );
  assert.equal(keyword.reason, "excluded_keyword");
  assert.deepEqual(keyword.matchedKeywords, ["php"]);
  assert.equal(
    matchDecisionToRejection({ ...base, hardRejectReason: "" }, listing, run).reason,
    "matcher_rejected",
  );
});

// DISCAT round 3: the sales/revenue families join on titles and target roles
// only; a description that mentions one never lifts an unrelated target.
function matcherRun(config: Record<string, unknown>) {
  return {
    runId: "run_family",
    trigger: "manual",
    request: { sheetId: "sheet_1", variationKey: "v", requestedAt: "2026-09-27T00:00:00.000Z" },
    config: {
      sheetId: "sheet_1",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme" }],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: [],
      locations: [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 10,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      ...config,
    },
  } as never;
}

test("should not join a sales family through description text", () => {
  const listing = raw({
    title: "Account Executive",
    descriptionText: "Partner with our solutions consultant team on every deal.",
  });
  // The review's scenario: a non-sales Solutions Architect target.
  for (const config of [
    { targetRoles: ["Solutions Architect"] },
    // Include keywords are not target roles; they never add a new family.
    { targetRoles: ["Principal Cloud Architect"], includeKeywords: ["solutions architect"] },
  ]) {
    const decision = scoreListingMatch(listing, matcherRun(config));
    assert.equal(
      decision.reasons.some((reason) => reason.includes("ai_solutions_consulting")),
      false,
      JSON.stringify(decision.reasons),
    );
    assert.ok(decision.componentScores.role < 0.85, `role score ${decision.componentScores.role}`);
  }
});

test("should join a sales family through the job title and a target role", () => {
  const decision = scoreListingMatch(
    raw({ title: "Senior Solutions Consultant", descriptionText: "Run demos." }),
    matcherRun({ targetRoles: ["AI Solutions Architect"] }),
  );
  assert.ok(
    decision.reasons.some((reason) => reason.includes("ai_solutions_consulting")),
    JSON.stringify(decision.reasons),
  );
  assert.equal(decision.componentScores.role, 0.85);
});

test("should keep description-based joins for the pre-existing families", () => {
  const decision = scoreListingMatch(
    raw({
      title: "Platform Lead",
      descriptionText: "You will own growth marketing experiments across lifecycle.",
    }),
    matcherRun({ targetRoles: ["Growth Marketing Manager"] }),
  );
  assert.ok(
    decision.reasons.some((reason) => reason.includes("growth_marketing")),
    JSON.stringify(decision.reasons),
  );
});
