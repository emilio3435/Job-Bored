import assert from "node:assert/strict";
import test from "node:test";

import type {
  CareerSurfaceRecord,
  CompanyRegistryRecord,
  IntentCoverageRecord,
} from "../../src/contracts.ts";
import {
  buildIntentKey,
  planCompanies,
} from "../../src/discovery/company-planner.ts";

const NOW = new Date("2026-04-13T12:00:00.000Z");

function makeCompanyRecord(
  overrides: Partial<CompanyRegistryRecord> & {
    companyKey: string;
    displayName: string;
  },
): CompanyRegistryRecord {
  return {
    companyKey: overrides.companyKey,
    displayName: overrides.displayName,
    normalizedName:
      overrides.normalizedName ||
      overrides.displayName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    aliasesJson: overrides.aliasesJson || "[]",
    domainsJson: overrides.domainsJson || "[]",
    atsHintsJson: overrides.atsHintsJson || "{}",
    geoTagsJson: overrides.geoTagsJson || "[]",
    roleTagsJson: overrides.roleTagsJson || "[]",
    firstSeenAt: overrides.firstSeenAt || "2026-01-01T00:00:00.000Z",
    lastSeenAt: overrides.lastSeenAt || "2026-04-10T00:00:00.000Z",
    lastSuccessAt: overrides.lastSuccessAt || "2026-04-10T00:00:00.000Z",
    successCount: overrides.successCount ?? 3,
    failureCount: overrides.failureCount ?? 1,
    confidence: overrides.confidence ?? 0.8,
    cooldownUntil: overrides.cooldownUntil || "",
  };
}

function makeSurface(
  overrides: Partial<CareerSurfaceRecord> & {
    surfaceId: string;
    companyKey: string;
  },
): CareerSurfaceRecord {
  return {
    surfaceId: overrides.surfaceId,
    companyKey: overrides.companyKey,
    surfaceType: overrides.surfaceType || "provider_board",
    providerType: overrides.providerType || "greenhouse",
    canonicalUrl:
      overrides.canonicalUrl ||
      `https://boards.greenhouse.io/${overrides.companyKey}`,
    host: overrides.host || "boards.greenhouse.io",
    finalUrl:
      overrides.finalUrl ||
      `https://boards.greenhouse.io/${overrides.companyKey}`,
    boardToken: overrides.boardToken || overrides.companyKey,
    sourceLane: overrides.sourceLane || "ats_provider",
    verifiedStatus: overrides.verifiedStatus || "verified",
    lastVerifiedAt: overrides.lastVerifiedAt || "2026-04-12T00:00:00.000Z",
    lastSuccessAt: overrides.lastSuccessAt || "2026-04-12T00:00:00.000Z",
    lastFailureAt: overrides.lastFailureAt || "",
    failureReason: overrides.failureReason || "",
    failureStreak: overrides.failureStreak ?? 0,
    cooldownUntil: overrides.cooldownUntil || "",
    metadataJson: overrides.metadataJson || "{}",
  };
}

function makeCoverage(
  overrides: Partial<IntentCoverageRecord> & {
    intentKey: string;
    companyKey: string;
    runId: string;
  },
): IntentCoverageRecord {
  return {
    intentKey: overrides.intentKey,
    companyKey: overrides.companyKey,
    runId: overrides.runId,
    sourceLane: overrides.sourceLane || "ats_provider",
    surfacesSeen: overrides.surfacesSeen ?? 2,
    listingsSeen: overrides.listingsSeen ?? 4,
    listingsWritten: overrides.listingsWritten ?? 1,
    startedAt: overrides.startedAt || "2026-04-12T10:00:00.000Z",
    completedAt: overrides.completedAt || "2026-04-12T10:05:00.000Z",
  };
}

function makePlannerInput() {
  return {
    now: NOW,
    targetRoles: ["Backend Engineer"],
    includeKeywords: ["TypeScript"],
    excludeKeywords: ["contract"],
    locations: ["Remote"],
    remotePolicy: "remote",
    seniority: "senior",
    sourcePreset: "browser_plus_ats" as const,
  };
}

test("buildIntentKey is stable across ordering, case, and whitespace", () => {
  const left = buildIntentKey({
    targetRoles: [" Backend Engineer ", "Platform Engineer"],
    includeKeywords: ["TypeScript", "Node"],
    excludeKeywords: ["Contract"],
    locations: [" Remote ", "United States"],
    remotePolicy: " Remote ",
    seniority: "Senior",
    sourcePreset: "browser_plus_ats",
  });
  const right = buildIntentKey({
    targetRoles: ["platform engineer", "backend engineer"],
    includeKeywords: ["node", "typescript"],
    excludeKeywords: [" contract "],
    locations: ["united states", "remote"],
    remotePolicy: "remote",
    seniority: " senior ",
    sourcePreset: "browser_plus_ats",
  });

  assert.equal(left, right);
});

test("planner prefers fresher companies when intent fit is otherwise similar", () => {
  const result = planCompanies({
    ...makePlannerInput(),
    companies: [
      {
        name: "FreshCo",
        roleTags: ["backend engineer", "typescript"],
        geoTags: ["remote"],
      },
      {
        name: "StaleCo",
        roleTags: ["backend engineer", "typescript"],
        geoTags: ["remote"],
      },
    ],
    memory: {
      companyRegistry: [
        makeCompanyRecord({
          companyKey: "freshco",
          displayName: "FreshCo",
          roleTagsJson: JSON.stringify(["backend engineer", "typescript"]),
          geoTagsJson: JSON.stringify(["remote"]),
          lastSeenAt: "2026-04-12T00:00:00.000Z",
          lastSuccessAt: "2026-04-11T00:00:00.000Z",
        }),
        makeCompanyRecord({
          companyKey: "staleco",
          displayName: "StaleCo",
          roleTagsJson: JSON.stringify(["backend engineer", "typescript"]),
          geoTagsJson: JSON.stringify(["remote"]),
          lastSeenAt: "2025-12-01T00:00:00.000Z",
          lastSuccessAt: "2025-11-20T00:00:00.000Z",
        }),
      ],
    },
  });

  assert.equal(result.plannedCompanies[0]?.displayName, "FreshCo");
  assert.ok(result.plannedCompanies[0].scores.freshness > result.plannedCompanies[1].scores.freshness);
});

test("planner boosts companies with verified career surfaces", () => {
  const result = planCompanies({
    ...makePlannerInput(),
    companies: [
      {
        name: "VerifiedCo",
        roleTags: ["backend engineer", "typescript"],
        geoTags: ["remote"],
      },
      {
        name: "UnverifiedCo",
        roleTags: ["backend engineer", "typescript"],
        geoTags: ["remote"],
      },
    ],
    memory: {
      companyRegistry: [
        makeCompanyRecord({
          companyKey: "verifiedco",
          displayName: "VerifiedCo",
          roleTagsJson: JSON.stringify(["backend engineer", "typescript"]),
          geoTagsJson: JSON.stringify(["remote"]),
        }),
        makeCompanyRecord({
          companyKey: "unverifiedco",
          displayName: "UnverifiedCo",
          roleTagsJson: JSON.stringify(["backend engineer", "typescript"]),
          geoTagsJson: JSON.stringify(["remote"]),
        }),
      ],
      careerSurfaces: [
        makeSurface({
          surfaceId: "surface_verified",
          companyKey: "verifiedco",
          verifiedStatus: "verified",
        }),
        makeSurface({
          surfaceId: "surface_unverified",
          companyKey: "unverifiedco",
          verifiedStatus: "suspect",
          lastVerifiedAt: "",
          lastSuccessAt: "",
        }),
      ],
    },
  });

  assert.equal(result.plannedCompanies[0]?.displayName, "VerifiedCo");
  assert.equal(result.plannedCompanies[0].evidence.verifiedSurfaceCount, 1);
  assert.ok(
    result.plannedCompanies[0].scores.recentHiringEvidence >
      result.plannedCompanies[1].scores.recentHiringEvidence,
  );
  assert.ok(
    result.plannedCompanies[0].reasons.some((reason) =>
      reason.includes("verified surface"),
    ),
  );
});

test("planner rewards under-covered companies for the same intent", () => {
  const intentKey = buildIntentKey(makePlannerInput());
  const result = planCompanies({
    ...makePlannerInput(),
    companies: [
      {
        name: "UnderCovered",
        roleTags: ["backend engineer", "typescript"],
        geoTags: ["remote"],
      },
      {
        name: "HeavyCovered",
        roleTags: ["backend engineer", "typescript"],
        geoTags: ["remote"],
      },
    ],
    memory: {
      companyRegistry: [
        makeCompanyRecord({
          companyKey: "undercovered",
          displayName: "UnderCovered",
          roleTagsJson: JSON.stringify(["backend engineer", "typescript"]),
          geoTagsJson: JSON.stringify(["remote"]),
        }),
        makeCompanyRecord({
          companyKey: "heavycovered",
          displayName: "HeavyCovered",
          roleTagsJson: JSON.stringify(["backend engineer", "typescript"]),
          geoTagsJson: JSON.stringify(["remote"]),
        }),
      ],
      intentCoverage: [
        makeCoverage({
          intentKey,
          companyKey: "heavycovered",
          runId: "run_1",
          surfacesSeen: 5,
          listingsSeen: 8,
          listingsWritten: 4,
          completedAt: "2026-04-12T09:00:00.000Z",
        }),
        makeCoverage({
          intentKey,
          companyKey: "heavycovered",
          runId: "run_2",
          surfacesSeen: 4,
          listingsSeen: 7,
          listingsWritten: 3,
          completedAt: "2026-04-11T09:00:00.000Z",
        }),
      ],
    },
  });

  const underCovered = result.plannedCompanies.find(
    (company) => company.companyKey === "undercovered",
  );
  const heavyCovered = result.plannedCompanies.find(
    (company) => company.companyKey === "heavycovered",
  );

  assert.ok(underCovered);
  assert.ok(heavyCovered);
  assert.ok(underCovered.rank > heavyCovered.rank);
  assert.ok(underCovered.scores.diversity > heavyCovered.scores.diversity);
  assert.ok(
    heavyCovered.evidence.penalties.recentCoverage >
      underCovered.evidence.penalties.recentCoverage,
  );
});

test("planner suppresses companies on cooldown from the planned output", () => {
  const result = planCompanies({
    ...makePlannerInput(),
    companies: [
      {
        name: "CoolingCo",
        roleTags: ["backend engineer", "typescript"],
        geoTags: ["remote"],
      },
      {
        name: "ActiveCo",
        roleTags: ["backend engineer", "typescript"],
        geoTags: ["remote"],
      },
    ],
    memory: {
      companyRegistry: [
        makeCompanyRecord({
          companyKey: "coolingco",
          displayName: "CoolingCo",
          roleTagsJson: JSON.stringify(["backend engineer", "typescript"]),
          geoTagsJson: JSON.stringify(["remote"]),
          cooldownUntil: "2026-04-20T00:00:00.000Z",
        }),
        makeCompanyRecord({
          companyKey: "activeco",
          displayName: "ActiveCo",
          roleTagsJson: JSON.stringify(["backend engineer", "typescript"]),
          geoTagsJson: JSON.stringify(["remote"]),
        }),
      ],
    },
  });

  assert.deepEqual(
    result.plannedCompanies.map((company) => company.displayName),
    ["ActiveCo"],
  );
  assert.equal(result.suppressedCompanies.length, 1);
  assert.equal(result.suppressedCompanies[0].displayName, "CoolingCo");
  assert.equal(result.suppressedCompanies[0].scores.cooldownPenalty, 100);
  assert.ok(
    result.suppressedCompanies[0].suppressionReasons.some((reason) =>
      reason.includes("company cooldown active"),
    ),
  );
});
