import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDiscoveryIntent,
  buildIntentKey,
  planCompanies,
} from "../../src/discovery/company-planner.ts";

const NOW = new Date("2026-04-13T12:00:00.000Z");

function makePlannerInput(overrides = {}) {
  return {
    targetRoles: ["Backend Engineer"],
    includeKeywords: ["Node.js", "TypeScript"],
    excludeKeywords: [],
    locations: ["Remote", "Chicago"],
    remotePolicy: "remote",
    seniority: "senior",
    sourcePreset: "browser_plus_ats",
    now: NOW,
    ...overrides,
  };
}

function makeCompany(overrides = {}) {
  return {
    name: "Acme",
    companyKey: "acme",
    normalizedName: "acme",
    domains: ["acme.com"],
    geoTags: ["remote", "chicago"],
    roleTags: ["backend engineer", "node js", "typescript", "senior"],
    boardHints: { greenhouse: "acme" },
    ...overrides,
  };
}

function makeCompanyRegistryRecord(overrides = {}) {
  return {
    companyKey: "acme",
    displayName: "Acme",
    normalizedName: "acme",
    aliasesJson: JSON.stringify([]),
    domainsJson: JSON.stringify(["acme.com"]),
    atsHintsJson: JSON.stringify({ greenhouse: "acme" }),
    geoTagsJson: JSON.stringify(["remote", "chicago"]),
    roleTagsJson: JSON.stringify(["backend engineer", "node js", "typescript", "senior"]),
    firstSeenAt: "2026-03-01T00:00:00.000Z",
    lastSeenAt: "2026-04-10T00:00:00.000Z",
    lastSuccessAt: "2026-04-10T00:00:00.000Z",
    successCount: 4,
    failureCount: 1,
    confidence: 0.8,
    cooldownUntil: "",
    ...overrides,
  };
}

function makeSurfaceRecord(overrides = {}) {
  return {
    surfaceId: "surface_acme_greenhouse",
    companyKey: "acme",
    surfaceType: "provider_board",
    providerType: "greenhouse",
    canonicalUrl: "https://boards.greenhouse.io/acme",
    host: "boards.greenhouse.io",
    finalUrl: "https://boards.greenhouse.io/acme",
    boardToken: "acme",
    sourceLane: "ats_provider",
    verifiedStatus: "verified",
    lastVerifiedAt: "2026-04-10T00:00:00.000Z",
    lastSuccessAt: "2026-04-10T00:00:00.000Z",
    lastFailureAt: "",
    failureReason: "",
    failureStreak: 0,
    cooldownUntil: "",
    metadataJson: "{}",
    ...overrides,
  };
}

function makeCoverageRecord(overrides = {}) {
  return {
    intentKey: "",
    companyKey: "acme",
    runId: "run_test",
    sourceLane: "ats_provider",
    surfacesSeen: 2,
    listingsSeen: 6,
    listingsWritten: 2,
    startedAt: "2026-04-12T09:00:00.000Z",
    completedAt: "2026-04-12T09:05:00.000Z",
    ...overrides,
  };
}

test("intent helpers normalize planner inputs into a stable intent key", () => {
  const first = buildIntentKey({
    targetRoles: [" Backend Engineer ", "Platform", "backend engineer"],
    includeKeywords: ["Node.js", "TypeScript"],
    excludeKeywords: ["Contract"],
    locations: ["Remote", "Chicago"],
    remotePolicy: " Remote ",
    seniority: "Senior",
    sourcePreset: "browser_plus_ats",
  });
  const second = buildIntentKey({
    targetRoles: ["platform", "backend engineer"],
    includeKeywords: ["typescript", "node js"],
    excludeKeywords: ["contract"],
    locations: ["chicago", "remote"],
    remotePolicy: "remote",
    seniority: "senior",
    sourcePreset: "browser_plus_ats",
  });

  assert.equal(first, second);

  const intent = buildDiscoveryIntent({
    targetRoles: ["Platform", "Backend Engineer"],
    includeKeywords: ["TypeScript", "Node.js"],
    excludeKeywords: ["Contract"],
    locations: ["Chicago", "Remote"],
    remotePolicy: "Remote",
    seniority: "Senior",
    sourcePreset: "browser_plus_ats",
  });

  assert.deepEqual(intent.targetRoles, ["backend engineer", "platform"]);
  assert.deepEqual(intent.includeKeywords, ["node js", "typescript"]);
  assert.deepEqual(intent.excludeKeywords, ["contract"]);
  assert.deepEqual(intent.locations, ["chicago", "remote"]);
  assert.equal(intent.remotePolicy, "remote");
  assert.equal(intent.intentKey, first);
});

test("planner prioritizes role and geo fit even when another company has better historical yield", () => {
  const result = planCompanies({
    ...makePlannerInput(),
    companies: [
      makeCompany({
        name: "Acme",
        companyKey: "acme",
      }),
      makeCompany({
        name: "Brio",
        companyKey: "brio",
        normalizedName: "brio",
        domains: ["brio.com"],
        geoTags: ["remote"],
        roleTags: ["product designer", "figma"],
        boardHints: { greenhouse: "brio" },
      }),
    ],
    memory: {
      companyRegistry: [
        makeCompanyRegistryRecord({
          companyKey: "acme",
          displayName: "Acme",
          normalizedName: "acme",
          successCount: 4,
          failureCount: 1,
          confidence: 0.8,
        }),
        makeCompanyRegistryRecord({
          companyKey: "brio",
          displayName: "Brio",
          normalizedName: "brio",
          domainsJson: JSON.stringify(["brio.com"]),
          geoTagsJson: JSON.stringify(["remote"]),
          roleTagsJson: JSON.stringify(["product designer", "figma"]),
          atsHintsJson: JSON.stringify({ greenhouse: "brio" }),
          lastSeenAt: "2026-04-12T00:00:00.000Z",
          lastSuccessAt: "2026-04-12T00:00:00.000Z",
          successCount: 8,
          failureCount: 0,
          confidence: 0.9,
        }),
      ],
      careerSurfaces: [
        makeSurfaceRecord({
          companyKey: "acme",
          surfaceId: "surface_acme_greenhouse",
          boardToken: "acme",
          lastVerifiedAt: "2026-04-10T00:00:00.000Z",
          lastSuccessAt: "2026-04-10T00:00:00.000Z",
        }),
        makeSurfaceRecord({
          companyKey: "brio",
          surfaceId: "surface_brio_greenhouse",
          boardToken: "brio",
          lastVerifiedAt: "2026-04-12T00:00:00.000Z",
          lastSuccessAt: "2026-04-12T00:00:00.000Z",
        }),
      ],
      intentCoverage: [],
    },
  });

  assert.equal(result.plannedCompanies[0]?.companyKey, "acme");
  assert.equal(result.plannedCompanies[1]?.companyKey, "brio");
  assert.ok(
    result.plannedCompanies[0].scores.roleFit >
      result.plannedCompanies[1].scores.roleFit,
  );
  assert.ok(result.plannedCompanies[0].scores.remoteFit > 0);
  assert.ok(
    result.plannedCompanies[0].reasons.some((reason) =>
      reason.startsWith("role match:"),
    ),
  );
});

test("planner suppresses cooled-down companies and exposes cooldown evidence when requested", () => {
  const result = planCompanies({
    ...makePlannerInput(),
    includeSuppressed: true,
    companies: [
      makeCompany({
        name: "Cooling Co",
        companyKey: "cooling",
        normalizedName: "cooling co",
        domains: ["cooling.example"],
      }),
      makeCompany({
        name: "Ready Co",
        companyKey: "ready",
        normalizedName: "ready co",
        domains: ["ready.example"],
      }),
    ],
    memory: {
      companyRegistry: [
        makeCompanyRegistryRecord({
          companyKey: "cooling",
          displayName: "Cooling Co",
          normalizedName: "cooling co",
          domainsJson: JSON.stringify(["cooling.example"]),
          cooldownUntil: "2026-04-20T00:00:00.000Z",
          failureCount: 6,
        }),
        makeCompanyRegistryRecord({
          companyKey: "ready",
          displayName: "Ready Co",
          normalizedName: "ready co",
          domainsJson: JSON.stringify(["ready.example"]),
          cooldownUntil: "",
          failureCount: 1,
        }),
      ],
      careerSurfaces: [
        makeSurfaceRecord({
          companyKey: "cooling",
          surfaceId: "surface_cooling_greenhouse",
          boardToken: "cooling",
          cooldownUntil: "2026-04-20T00:00:00.000Z",
          failureStreak: 4,
          verifiedStatus: "dead",
        }),
        makeSurfaceRecord({
          companyKey: "ready",
          surfaceId: "surface_ready_greenhouse",
          boardToken: "ready",
        }),
      ],
      intentCoverage: [],
    },
  });

  assert.equal(result.plannedCompanies[0]?.companyKey, "ready");
  assert.equal(result.suppressedCompanies[0]?.companyKey, "cooling");
  assert.equal(result.suppressedCompanies[0].scores.cooldownPenalty, 100);
  assert.ok(
    result.suppressedCompanies[0].suppressionReasons.some((reason) =>
      reason.includes("company cooldown active until 2026-04-20T00:00:00.000Z"),
    ),
  );
});

test("planner boosts freshness and penalizes recent same-intent coverage", () => {
  const intent = buildDiscoveryIntent(makePlannerInput());
  const result = planCompanies({
    ...makePlannerInput(),
    companies: [
      makeCompany({
        name: "Frontier",
        companyKey: "frontier",
        normalizedName: "frontier",
        domains: ["frontier.example"],
      }),
      makeCompany({
        name: "Loop",
        companyKey: "loop",
        normalizedName: "loop",
        domains: ["loop.example"],
      }),
    ],
    memory: {
      companyRegistry: [
        makeCompanyRegistryRecord({
          companyKey: "frontier",
          displayName: "Frontier",
          normalizedName: "frontier",
          domainsJson: JSON.stringify(["frontier.example"]),
          successCount: 5,
          failureCount: 1,
        }),
        makeCompanyRegistryRecord({
          companyKey: "loop",
          displayName: "Loop",
          normalizedName: "loop",
          domainsJson: JSON.stringify(["loop.example"]),
          successCount: 5,
          failureCount: 1,
        }),
      ],
      careerSurfaces: [
        makeSurfaceRecord({
          companyKey: "frontier",
          surfaceId: "surface_frontier_greenhouse",
          boardToken: "frontier",
        }),
        makeSurfaceRecord({
          companyKey: "loop",
          surfaceId: "surface_loop_greenhouse",
          boardToken: "loop",
        }),
      ],
      intentCoverage: [
        makeCoverageRecord({
          intentKey: intent.intentKey,
          companyKey: "loop",
          completedAt: "2026-04-12T09:05:00.000Z",
          listingsSeen: 7,
          listingsWritten: 3,
        }),
        makeCoverageRecord({
          intentKey: intent.intentKey,
          companyKey: "loop",
          runId: "run_test_2",
          completedAt: "2026-04-11T09:05:00.000Z",
          listingsSeen: 5,
          listingsWritten: 2,
        }),
      ],
    },
  });

  assert.equal(result.plannedCompanies[0]?.companyKey, "frontier");
  assert.equal(result.plannedCompanies[1]?.companyKey, "loop");
  assert.ok(
    result.plannedCompanies[0].scores.freshness >
      result.plannedCompanies[1].scores.freshness,
  );
  assert.ok(
    result.plannedCompanies[1].scores.recentCoveragePenalty >
      result.plannedCompanies[0].scores.recentCoveragePenalty,
  );
  assert.ok(
    result.plannedCompanies[0].reasons.includes("under-covered for this intent"),
  );
});

test("planner rewards provider and source-lane diversity in the rank output", () => {
  const result = planCompanies({
    ...makePlannerInput(),
    companies: [
      makeCompany({
        name: "Mono",
        companyKey: "mono",
        normalizedName: "mono",
        domains: ["mono.example"],
        boardHints: { greenhouse: "mono" },
      }),
      makeCompany({
        name: "Diverse",
        companyKey: "diverse",
        normalizedName: "diverse",
        domains: ["diverse.example"],
        boardHints: { greenhouse: "diverse", lever: "diverse" },
      }),
    ],
    memory: {
      companyRegistry: [
        makeCompanyRegistryRecord({
          companyKey: "mono",
          displayName: "Mono",
          normalizedName: "mono",
          domainsJson: JSON.stringify(["mono.example"]),
          atsHintsJson: JSON.stringify({ greenhouse: "mono" }),
          successCount: 8,
          failureCount: 0,
          confidence: 0.9,
        }),
        makeCompanyRegistryRecord({
          companyKey: "diverse",
          displayName: "Diverse",
          normalizedName: "diverse",
          domainsJson: JSON.stringify(["diverse.example"]),
          atsHintsJson: JSON.stringify({ greenhouse: "diverse", lever: "diverse" }),
          successCount: 6,
          failureCount: 0,
          confidence: 0.9,
        }),
      ],
      careerSurfaces: [
        makeSurfaceRecord({
          companyKey: "mono",
          surfaceId: "surface_mono_greenhouse",
          boardToken: "mono",
          providerType: "greenhouse",
          sourceLane: "ats_provider",
        }),
        makeSurfaceRecord({
          companyKey: "diverse",
          surfaceId: "surface_diverse_greenhouse",
          boardToken: "diverse",
          providerType: "greenhouse",
          sourceLane: "ats_provider",
        }),
        makeSurfaceRecord({
          companyKey: "diverse",
          surfaceId: "surface_diverse_lever",
          providerType: "lever",
          canonicalUrl: "https://jobs.lever.co/diverse",
          host: "jobs.lever.co",
          finalUrl: "https://jobs.lever.co/diverse",
          boardToken: "diverse",
          sourceLane: "hint_resolution",
        }),
        makeSurfaceRecord({
          companyKey: "diverse",
          surfaceId: "surface_diverse_employer",
          surfaceType: "employer_jobs",
          providerType: "",
          canonicalUrl: "https://careers.diverse.example/jobs",
          host: "careers.diverse.example",
          finalUrl: "https://careers.diverse.example/jobs",
          boardToken: "",
          sourceLane: "company_surface",
        }),
      ],
      intentCoverage: [],
    },
  });

  assert.equal(result.plannedCompanies[0]?.companyKey, "diverse");
  assert.equal(result.plannedCompanies[1]?.companyKey, "mono");
  assert.ok(
    result.plannedCompanies[0].scores.diversity >
      result.plannedCompanies[1].scores.diversity,
  );
  assert.ok(
    result.plannedCompanies[0].evidence.providerCount >
      result.plannedCompanies[1].evidence.providerCount,
  );
  assert.ok(
    result.plannedCompanies[0].evidence.sourceLaneCount >
      result.plannedCompanies[1].evidence.sourceLaneCount,
  );
  assert.ok(
    result.plannedCompanies[0].reasons.includes("strong provider/source diversity"),
  );
});

test("VAL-LOOP-MEM-004: planner uses role-family memory to find adjacent companies deterministically", () => {
  // Role family learned from a successful backend engineer lead at Acme
  const roleFamilyBackendEngineer = {
    familyKey: "backend engineer::acme::ats_provider",
    baseRole: "backend engineer",
    roleVariants: [
      "senior backend engineer",
      "staff backend engineer",
      "principal backend engineer",
      "backend engineer",
    ],
    companyKey: "acme",
    sourceLane: "ats_provider",
    confirmedCount: 3,
    nearMissCount: 1,
    lastConfirmedAt: "2026-04-10T00:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
  };

  const result = planCompanies({
    ...makePlannerInput(),
    companies: [
      // Only Acme is configured
      makeCompany({
        name: "Acme",
        companyKey: "acme",
      }),
    ],
    memory: {
      companyRegistry: [
        makeCompanyRegistryRecord({
          companyKey: "acme",
          displayName: "Acme",
          normalizedName: "acme",
          successCount: 3,
          failureCount: 1,
          confidence: 0.85,
        }),
        // Adjacent company with matching role tags but not in configured companies
        makeCompanyRegistryRecord({
          companyKey: "adjacent-co",
          displayName: "Adjacent Co",
          normalizedName: "adjacent co",
          domainsJson: JSON.stringify(["adjacent.co"]),
          roleTagsJson: JSON.stringify([
            "backend engineer",
            "senior backend engineer",
            "node js",
          ]),
          atsHintsJson: JSON.stringify({ greenhouse: "adjacent" }),
          successCount: 2,
          failureCount: 0,
          confidence: 0.7,
        }),
        // Another adjacent company with partial match
        makeCompanyRegistryRecord({
          companyKey: "partial-adjacent",
          displayName: "Partial Adjacent",
          normalizedName: "partial adjacent",
          domainsJson: JSON.stringify(["partial.example"]),
          roleTagsJson: JSON.stringify(["backend engineer"]), // Only exact match
          atsHintsJson: JSON.stringify({}),
          successCount: 1,
          failureCount: 0,
          confidence: 0.5,
        }),
      ],
      careerSurfaces: [
        makeSurfaceRecord({
          companyKey: "acme",
          surfaceId: "surface_acme_greenhouse",
          boardToken: "acme",
          verifiedStatus: "verified",
          lastVerifiedAt: "2026-04-10T00:00:00.000Z",
          lastSuccessAt: "2026-04-10T00:00:00.000Z",
        }),
        makeSurfaceRecord({
          companyKey: "adjacent-co",
          surfaceId: "surface_adjacent_greenhouse",
          boardToken: "adjacent",
          verifiedStatus: "verified",
          lastVerifiedAt: "2026-04-08T00:00:00.000Z",
          lastSuccessAt: "2026-04-08T00:00:00.000Z",
        }),
        makeSurfaceRecord({
          companyKey: "partial-adjacent",
          surfaceId: "surface_partial_greenhouse",
          boardToken: "partial",
          verifiedStatus: "pending",
        }),
      ],
      intentCoverage: [],
      // Role family memory from accepted leads
      roleFamilies: [roleFamilyBackendEngineer],
    },
  });

  // Acme should be first since it's directly configured
  assert.equal(result.plannedCompanies[0]?.companyKey, "acme");

  // Adjacent-co should be found via role-family targeting (has matching role variants)
  const adjacentCo = result.plannedCompanies.find((c) => c.companyKey === "adjacent-co");
  assert.ok(adjacentCo, "adjacent-co should be found via role-family targeting");

  // Verify the candidate source includes role_family_adjacent
  assert.ok(
    adjacentCo?.evidence?.candidateSources?.includes("role_family_adjacent"),
    "adjacent-co should have role_family_adjacent candidate source",
  );

  // Verify role-family evidence is recorded
  assert.ok(
    adjacentCo?.reasons?.some((r) => r.includes("role-family adjacent via")),
    "adjacent-co should have role-family adjacent evidence in reasons",
  );

  // Partial-adjacent should also be found (exact match on "backend engineer")
  const partialAdjacent = result.plannedCompanies.find(
    (c) => c.companyKey === "partial-adjacent",
  );
  assert.ok(
    partialAdjacent,
    "partial-adjacent should also be found via role-family targeting",
  );
  assert.ok(
    partialAdjacent?.evidence?.candidateSources?.includes("role_family_adjacent"),
    "partial-adjacent should have role_family_adjacent candidate source",
  );
});

test("VAL-LOOP-MEM-004: role-family widening does not bypass final filters (cooldown enforced)", () => {
  const roleFamilyBackendEngineer = {
    familyKey: "backend engineer::acme::ats_provider",
    baseRole: "backend engineer",
    roleVariants: ["senior backend engineer", "backend engineer"],
    companyKey: "acme",
    sourceLane: "ats_provider",
    confirmedCount: 2,
    nearMissCount: 0,
    lastConfirmedAt: "2026-04-10T00:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-10T00:00:00.000Z",
  };

  const result = planCompanies({
    ...makePlannerInput(),
    includeSuppressed: true, // Include suppressed to verify cooldown is enforced
    companies: [
      makeCompany({
        name: "Acme",
        companyKey: "acme",
      }),
    ],
    memory: {
      companyRegistry: [
        makeCompanyRegistryRecord({
          companyKey: "acme",
          displayName: "Acme",
          normalizedName: "acme",
          successCount: 2,
          failureCount: 0,
          confidence: 0.8,
        }),
        // Adjacent company with matching role tags but cooled down
        makeCompanyRegistryRecord({
          companyKey: "cooled-adjacent",
          displayName: "Cooled Adjacent",
          normalizedName: "cooled adjacent",
          domainsJson: JSON.stringify(["cooled.example"]),
          roleTagsJson: JSON.stringify(["backend engineer", "senior backend engineer"]),
          cooldownUntil: "2026-04-20T00:00:00.000Z", // Cooldown active
          failureCount: 5,
          confidence: 0.6,
        }),
      ],
      careerSurfaces: [
        makeSurfaceRecord({
          companyKey: "acme",
          surfaceId: "surface_acme_greenhouse",
          boardToken: "acme",
          verifiedStatus: "verified",
        }),
        makeSurfaceRecord({
          companyKey: "cooled-adjacent",
          surfaceId: "surface_cooled_greenhouse",
          boardToken: "cooled",
          verifiedStatus: "dead",
          cooldownUntil: "2026-04-20T00:00:00.000Z",
          failureStreak: 4,
        }),
      ],
      intentCoverage: [],
      roleFamilies: [roleFamilyBackendEngineer],
    },
  });

  // Acme should be planned
  assert.equal(result.plannedCompanies[0]?.companyKey, "acme");

  // Cooled-adjacent should be in suppressed list (cooldown bypasses role-family widening)
  const cooledAdjacent = result.suppressedCompanies.find(
    (c) => c.companyKey === "cooled-adjacent",
  );
  assert.ok(
    cooledAdjacent,
    "cooled-adjacent should be in suppressed companies despite role-family match",
  );
  assert.ok(
    cooledAdjacent?.suppressionReasons?.some((r) =>
      r.includes("company cooldown active"),
    ),
    "cooled-adjacent suppression reason should mention cooldown",
  );
});
