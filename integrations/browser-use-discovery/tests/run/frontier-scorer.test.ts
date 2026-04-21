import assert from "node:assert/strict";
import test from "node:test";

import {
  computeFrontierCompositeScore,
  companyToFrontierCandidate,
  leadToFrontierCandidate,
  sortFrontierCandidates,
  selectExploitTargets,
  createExplorationBudgetTracker,
  isCandidateSelected,
  DEFAULT_EXPLORATION_BUDGET,
  type FrontierScoreComponents,
  type FrontierCandidate,
  type ExplorationBudget,
  type ExploitTarget,
} from "../../src/run/frontier-scorer.ts";
import type { PlannedCompany, NormalizedLead } from "../../src/contracts.ts";

const NOW = new Date("2026-04-13T12:00:00.000Z");

// === Test Helpers ===

function makePlannedCompany(overrides: Partial<PlannedCompany> & { companyKey: string; displayName: string }): PlannedCompany {
  return {
    companyKey: overrides.companyKey,
    displayName: overrides.displayName,
    normalizedName: overrides.normalizedName || overrides.displayName.toLowerCase(),
    domains: overrides.domains || [],
    aliases: overrides.aliases || [],
    boardHints: overrides.boardHints || {},
    geoTags: overrides.geoTags || [],
    roleTags: overrides.roleTags || [],
    rank: overrides.rank ?? 75,
    intendedLanes: overrides.intendedLanes || ["ats_provider"],
    scores: {
      roleFit: overrides.scores?.roleFit ?? 70,
      geoFit: overrides.scores?.geoFit ?? 60,
      remoteFit: overrides.scores?.remoteFit ?? 80,
      recentHiringEvidence: overrides.scores?.recentHiringEvidence ?? 55,
      priorAcceptedYield: overrides.scores?.priorAcceptedYield ?? 65,
      surfaceHealth: overrides.scores?.surfaceHealth ?? 60,
      diversity: overrides.scores?.diversity ?? 50,
      freshness: overrides.scores?.freshness ?? 70,
      cooldownPenalty: overrides.scores?.cooldownPenalty ?? 0,
      recentCoveragePenalty: overrides.scores?.recentCoveragePenalty ?? 0,
    },
    reasons: overrides.reasons || [],
    evidence: overrides.evidence || [],
    ...overrides,
  };
}

function makeNormalizedLead(overrides: Partial<NormalizedLead> & { url: string; company: string; title: string }): NormalizedLead {
  return {
    sourceId: overrides.sourceId || "grounded_web",
    sourceLabel: overrides.sourceLabel || "Grounded Search",
    title: overrides.title,
    company: overrides.company,
    location: overrides.location || "Remote",
    url: overrides.url,
    compensationText: overrides.compensationText || "",
    fitScore: overrides.fitScore ?? 0.75,
    matchScore: overrides.matchScore ?? null,
    favorite: overrides.favorite ?? false,
    dismissedAt: overrides.dismissedAt ?? null,
    priority: overrides.priority || "—",
    tags: overrides.tags || ["backend", "typescript"],
    fitAssessment: overrides.fitAssessment || "Good fit",
    contact: overrides.contact || "",
    status: overrides.status || "New",
    appliedDate: overrides.appliedDate || "",
    notes: overrides.notes || "",
    followUpDate: overrides.followUpDate || "",
    talkingPoints: overrides.talkingPoints || "",
    logoUrl: overrides.logoUrl || "",
    discoveredAt: overrides.discoveredAt || NOW.toISOString(),
    metadata: {
      runId: "test-run",
      variationKey: "test",
      sourceQuery: "Backend Engineer at Acme",
      ...overrides.metadata,
    },
    ...overrides,
  };
}

function makeIntent() {
  return {
    intentKey: "test-intent",
    targetRoles: ["Backend Engineer"],
    includeKeywords: ["TypeScript"],
    excludeKeywords: [],
    locations: ["Remote"],
    remotePolicy: "remote",
    seniority: "senior",
    sourcePreset: "browser_plus_ats" as const,
  };
}

// === VAL-LOOP-SCORE-001: ATS and browser opportunities share one scoring frontier ===

test("VAL-LOOP-SCORE-001: companyToFrontierCandidate converts ATS company to frontier candidate with unified schema", () => {
  const company = makePlannedCompany({
    companyKey: "acme",
    displayName: "Acme Corp",
    scores: {
      roleFit: 80,
      geoFit: 70,
      remoteFit: 90,
      recentHiringEvidence: 65,
      priorAcceptedYield: 75,
      surfaceHealth: 60,
      diversity: 55,
      freshness: 70,
      cooldownPenalty: 0,
      recentCoveragePenalty: 10,
    },
  });

  const candidate = companyToFrontierCandidate(company, "ats_provider", "greenhouse");

  assert.equal(candidate.candidateId, "company:acme");
  assert.equal(candidate.sourceLane, "ats_provider");
  assert.equal(candidate.sourceId, "greenhouse");
  assert.equal(candidate.companyKey, "acme");
  assert.equal(candidate.displayName, "Acme Corp");
  assert.ok(candidate.isViable);
  assert.equal(candidate.suppressionReasons.length, 0);
  assert.ok(candidate.compositeScore > 0);
  assert.ok(candidate.scores.roleFit === 80);
  assert.ok(candidate.scores.remoteFit === 90);
});

test("VAL-LOOP-SCORE-001: leadToFrontierCandidate converts browser/grounded lead to frontier candidate with unified schema", () => {
  const lead = makeNormalizedLead({
    url: "https://acme.com/jobs/backend-engineer",
    company: "Acme Corp",
    title: "Backend Engineer",
    fitScore: 0.82,
    tags: ["backend", "typescript", "node"],
    priority: "🔥",
    metadata: {
      runId: "test-run",
      variationKey: "test",
      sourceQuery: "Backend Engineer at Acme",
      sourceLane: "grounded_web",
    },
  });

  const candidate = leadToFrontierCandidate(lead, "grounded_web");

  assert.equal(candidate.candidateId, "lead:https://acme.com/jobs/backend-engineer");
  assert.equal(candidate.sourceLane, "grounded_web");
  assert.equal(candidate.sourceId, "grounded_web");
  assert.equal(candidate.url, "https://acme.com/jobs/backend-engineer");
  assert.ok(candidate.isViable);
  assert.equal(candidate.suppressionReasons.length, 0);
  assert.ok(candidate.compositeScore > 0);
});

test("VAL-LOOP-SCORE-001: both ATS company and browser lead produce candidates in same frontier with same score schema", () => {
  const company = makePlannedCompany({
    companyKey: "acme",
    displayName: "Acme Corp",
    scores: {
      roleFit: 75,
      geoFit: 65,
      remoteFit: 85,
      recentHiringEvidence: 60,
      priorAcceptedYield: 70,
      surfaceHealth: 55,
      diversity: 50,
      freshness: 65,
      cooldownPenalty: 0,
      recentCoveragePenalty: 5,
    },
  });

  const lead = makeNormalizedLead({
    url: "https://acme.com/jobs/backend-engineer",
    company: "Acme Corp",
    title: "Backend Engineer",
    fitScore: 0.75,
    metadata: { runId: "test", variationKey: "test", sourceQuery: "test", sourceLane: "grounded_web" },
  });

  const companyCandidate = companyToFrontierCandidate(company, "ats_provider", "greenhouse");
  const leadCandidate = leadToFrontierCandidate(lead, "grounded_web");

  // Both have the same score component keys
  const companyScoreKeys = Object.keys(companyCandidate.scores).sort();
  const leadScoreKeys = Object.keys(leadCandidate.scores).sort();

  assert.deepEqual(companyScoreKeys, leadScoreKeys);
  assert.ok(companyScoreKeys.includes("roleFit"));
  assert.ok(companyScoreKeys.includes("geoFit"));
  assert.ok(companyScoreKeys.includes("remoteFit"));
  assert.ok(companyScoreKeys.includes("cooldownPenalty"));
  assert.ok(companyScoreKeys.includes("recentCoveragePenalty"));
});

// === VAL-LOOP-SCORE-002: Ranking reflects required fit, quality, and penalty inputs ===

test("VAL-LOOP-SCORE-002: higher roleFit produces higher composite score", () => {
  const highRoleFit: FrontierScoreComponents = {
    roleFit: 90,
    geoFit: 60,
    remoteFit: 60,
    recentHiringEvidence: 50,
    priorAcceptedYield: 50,
    surfaceHealth: 50,
    diversity: 50,
    freshness: 50,
    cooldownPenalty: 0,
    recentCoveragePenalty: 0,
  };

  const lowRoleFit: FrontierScoreComponents = {
    roleFit: 30,
    geoFit: 60,
    remoteFit: 60,
    recentHiringEvidence: 50,
    priorAcceptedYield: 50,
    surfaceHealth: 50,
    diversity: 50,
    freshness: 50,
    cooldownPenalty: 0,
    recentCoveragePenalty: 0,
  };

  const highScore = computeFrontierCompositeScore(highRoleFit);
  const lowScore = computeFrontierCompositeScore(lowRoleFit);

  assert.ok(highScore.composite > lowScore.composite, "Higher roleFit should produce higher composite score");
  assert.ok(highScore.composite > 50);
});

test("VAL-LOOP-SCORE-002: cooldownPenalty reduces composite score", () => {
  const noCooldown: FrontierScoreComponents = {
    roleFit: 70,
    geoFit: 60,
    remoteFit: 70,
    recentHiringEvidence: 60,
    priorAcceptedYield: 60,
    surfaceHealth: 60,
    diversity: 50,
    freshness: 60,
    cooldownPenalty: 0,
    recentCoveragePenalty: 0,
  };

  const withCooldown: FrontierScoreComponents = {
    ...noCooldown,
    cooldownPenalty: 80,
  };

  const noCooldownScore = computeFrontierCompositeScore(noCooldown);
  const withCooldownScore = computeFrontierCompositeScore(withCooldown);

  assert.ok(noCooldownScore.composite > withCooldownScore.composite, "Cooldown should reduce composite score");
});

test("VAL-LOOP-SCORE-002: recentCoveragePenalty reduces composite score", () => {
  const noPenalty: FrontierScoreComponents = {
    roleFit: 70,
    geoFit: 60,
    remoteFit: 70,
    recentHiringEvidence: 60,
    priorAcceptedYield: 60,
    surfaceHealth: 60,
    diversity: 50,
    freshness: 60,
    cooldownPenalty: 0,
    recentCoveragePenalty: 0,
  };

  const withPenalty: FrontierScoreComponents = {
    ...noPenalty,
    recentCoveragePenalty: 50,
  };

  const noPenaltyScore = computeFrontierCompositeScore(noPenalty);
  const withPenaltyScore = computeFrontierCompositeScore(withPenalty);

  assert.ok(noPenaltyScore.composite > withPenaltyScore.composite, "Coverage penalty should reduce composite score");
});

test("VAL-LOOP-SCORE-002: attribution array includes active dimension names", () => {
  const components: FrontierScoreComponents = {
    roleFit: 80,
    geoFit: 60,
    remoteFit: 75,
    recentHiringEvidence: 55,
    priorAcceptedYield: 65,
    surfaceHealth: 50,
    diversity: 50,
    freshness: 50,
    cooldownPenalty: 0,
    recentCoveragePenalty: 0,
  };

  const result = computeFrontierCompositeScore(components);

  assert.ok(result.attribution.length > 0, "Attribution should not be empty");
  assert.ok(result.attribution.some(a => a.startsWith("role:")), "Attribution should include role");
});

// === VAL-LOOP-SCORE-003: Shared exploration budget controls are enforced ===

test("VAL-LOOP-SCORE-003: createExplorationBudgetTracker respects maxScoutSurfaces", () => {
  const budget: ExplorationBudget = {
    maxScoutSurfaces: 3,
    maxExploitSurfaces: 5,
    maxScoutListingsPerSurface: 10,
  };

  const tracker = createExplorationBudgetTracker(budget);

  assert.equal(tracker.getStatus().scoutSurfaceBudgetRemaining, 3);
  assert.ok(tracker.recordScoutSurface());
  assert.equal(tracker.getStatus().scoutSurfaceBudgetRemaining, 2);
  assert.ok(tracker.recordScoutSurface());
  assert.ok(tracker.recordScoutSurface());
  assert.equal(tracker.getStatus().scoutSurfaceBudgetRemaining, 0);
  assert.ok(!tracker.recordScoutSurface(), "Should reject when budget exhausted");
});

test("VAL-LOOP-SCORE-003: createExplorationBudgetTracker respects maxExploitSurfaces", () => {
  const budget: ExplorationBudget = {
    maxScoutSurfaces: 10,
    maxExploitSurfaces: 2,
    maxScoutListingsPerSurface: 10,
  };

  const tracker = createExplorationBudgetTracker(budget);

  assert.equal(tracker.getStatus().exploitSurfaceBudgetRemaining, 2);
  assert.ok(tracker.recordExploitSelection());
  assert.equal(tracker.getStatus().exploitSurfaceBudgetRemaining, 1);
  assert.ok(tracker.recordExploitSelection());
  assert.equal(tracker.getStatus().exploitSurfaceBudgetRemaining, 0);
  assert.ok(!tracker.recordExploitSelection(), "Should reject when exploit budget exhausted");
});

test("VAL-LOOP-SCORE-003: selectExploitTargets respects maxExploitSurfaces budget", () => {
  const budget: ExplorationBudget = {
    maxScoutSurfaces: 50,
    maxExploitSurfaces: 2,
    maxScoutListingsPerSurface: 20,
  };

  const intent = makeIntent();

  const candidates: FrontierCandidate[] = [
    { ...makePlannedCompany({ companyKey: "c1", displayName: "Company 1", scores: { roleFit: 80, geoFit: 60, remoteFit: 70, recentHiringEvidence: 60, priorAcceptedYield: 60, surfaceHealth: 60, diversity: 50, freshness: 60, cooldownPenalty: 0, recentCoveragePenalty: 0 } }), candidateId: "company:c1", sourceLane: "ats_provider", sourceId: "greenhouse", observedAt: NOW.toISOString(), isViable: true, suppressionReasons: [], sortKey: "" } as FrontierCandidate,
    { ...makePlannedCompany({ companyKey: "c2", displayName: "Company 2", scores: { roleFit: 75, geoFit: 60, remoteFit: 70, recentHiringEvidence: 60, priorAcceptedYield: 60, surfaceHealth: 60, diversity: 50, freshness: 60, cooldownPenalty: 0, recentCoveragePenalty: 0 } }), candidateId: "company:c2", sourceLane: "ats_provider", sourceId: "greenhouse", observedAt: NOW.toISOString(), isViable: true, suppressionReasons: [], sortKey: "" } as FrontierCandidate,
    { ...makePlannedCompany({ companyKey: "c3", displayName: "Company 3", scores: { roleFit: 70, geoFit: 60, remoteFit: 70, recentHiringEvidence: 60, priorAcceptedYield: 60, surfaceHealth: 60, diversity: 50, freshness: 60, cooldownPenalty: 0, recentCoveragePenalty: 0 } }), candidateId: "company:c3", sourceLane: "ats_provider", sourceId: "greenhouse", observedAt: NOW.toISOString(), isViable: true, suppressionReasons: [], sortKey: "" } as FrontierCandidate,
  ];

  // Add composite scores
  for (const c of candidates) {
    const result = computeFrontierCompositeScore(c.scores);
    c.compositeScore = result.composite;
    c.sortKey = String(100 - result.composite).padStart(6, "0") + "|" + c.companyKey;
  }

  const result = selectExploitTargets(candidates, budget, intent);

  assert.equal(result.selectedTargets.length, 2, "Should select only 2 targets due to budget");
  assert.equal(result.finalBudgetUsage.exploitSurfacesSelected, 2);
  assert.equal(result.rejectedCandidates.length, 1);
  assert.equal(result.telemetry.selectedCount, 2);
  assert.equal(result.telemetry.budgetRejectedCount, 1);
});

// === VAL-LOOP-SCORE-004: Exploit target selection is deterministic for fixed inputs ===

test("VAL-LOOP-SCORE-004: sortFrontierCandidates produces deterministic order for same input", () => {
  const candidates: FrontierCandidate[] = [
    {
      candidateId: "company:c3",
      sourceLane: "ats_provider",
      sourceId: "greenhouse",
      companyKey: "c3",
      displayName: "Company 3",
      observedAt: NOW.toISOString(),
      compositeScore: 65,
      isViable: true,
      suppressionReasons: [],
      sortKey: "35|c3",
      scores: {} as FrontierScoreComponents,
    },
    {
      candidateId: "company:c1",
      sourceLane: "ats_provider",
      sourceId: "greenhouse",
      companyKey: "c1",
      displayName: "Company 1",
      observedAt: NOW.toISOString(),
      compositeScore: 75,
      isViable: true,
      suppressionReasons: [],
      sortKey: "25|c1",
      scores: {} as FrontierScoreComponents,
    },
    {
      candidateId: "company:c2",
      sourceLane: "grounded_web",
      sourceId: "grounded_web",
      companyKey: "c2",
      displayName: "Company 2",
      observedAt: NOW.toISOString(),
      compositeScore: 70,
      isViable: true,
      suppressionReasons: [],
      sortKey: "30|c2",
      scores: {} as FrontierScoreComponents,
    },
  ];

  // Run sort multiple times and verify same result
  const result1 = sortFrontierCandidates(candidates);
  const result2 = sortFrontierCandidates(candidates);
  const result3 = sortFrontierCandidates(candidates);

  assert.deepEqual(result1.map(c => c.candidateId), result2.map(c => c.candidateId));
  assert.deepEqual(result2.map(c => c.candidateId), result3.map(c => c.candidateId));

  // Verify expected order: Company 1 (75) > Company 2 (70) > Company 3 (65)
  assert.equal(result1[0].candidateId, "company:c1");
  assert.equal(result1[1].candidateId, "company:c2");
  assert.equal(result1[2].candidateId, "company:c3");
});

test("VAL-LOOP-SCORE-004: selectExploitTargets is deterministic for fixed inputs", () => {
  const budget: ExplorationBudget = {
    maxScoutSurfaces: 50,
    maxExploitSurfaces: 10,
    maxScoutListingsPerSurface: 20,
  };

  const intent = makeIntent();

  const candidates: FrontierCandidate[] = [
    { candidateId: "company:c1", sourceLane: "ats_provider" as const, sourceId: "greenhouse", companyKey: "c1", displayName: "Company 1", observedAt: NOW.toISOString(), compositeScore: 75, isViable: true, suppressionReasons: [], sortKey: "25|c1", scores: {} as FrontierScoreComponents },
    { candidateId: "company:c2", sourceLane: "grounded_web" as const, sourceId: "grounded_web", companyKey: "c2", displayName: "Company 2", observedAt: NOW.toISOString(), compositeScore: 70, isViable: true, suppressionReasons: [], sortKey: "30|c2", scores: {} as FrontierScoreComponents },
    { candidateId: "company:c3", sourceLane: "ats_provider" as const, sourceId: "greenhouse", companyKey: "c3", displayName: "Company 3", observedAt: NOW.toISOString(), compositeScore: 65, isViable: true, suppressionReasons: [], sortKey: "35|c3", scores: {} as FrontierScoreComponents },
  ];

  // Run selection multiple times
  const result1 = selectExploitTargets(candidates, budget, intent);
  const result2 = selectExploitTargets(candidates, budget, intent);
  const result3 = selectExploitTargets(candidates, budget, intent);

  // Verify same selected targets in same order
  assert.deepEqual(result1.selectedTargets.map(t => t.candidateId), result2.selectedTargets.map(t => t.candidateId));
  assert.deepEqual(result2.selectedTargets.map(t => t.candidateId), result3.selectedTargets.map(t => t.candidateId));

  // Verify telemetry shows deterministic
  assert.ok(result1.telemetry.deterministic);
  assert.ok(result2.telemetry.deterministic);
  assert.ok(result3.telemetry.deterministic);
});

test("VAL-LOOP-SCORE-004: telemetry.deterministic is always true", () => {
  const budget = DEFAULT_EXPLORATION_BUDGET;
  const intent = makeIntent();

  const candidates: FrontierCandidate[] = [
    { candidateId: "company:c1", sourceLane: "ats_provider" as const, sourceId: "greenhouse", companyKey: "c1", displayName: "Company 1", observedAt: NOW.toISOString(), compositeScore: 75, isViable: true, suppressionReasons: [], sortKey: "25|c1", scores: {} as FrontierScoreComponents },
  ];

  const result = selectExploitTargets(candidates, budget, intent);
  assert.equal(result.telemetry.deterministic, true);
});

// === VAL-LOOP-SCORE-005: Deep extraction is restricted to selected exploit targets ===

test("VAL-LOOP-SCORE-005: isCandidateSelected returns true for selected candidate", () => {
  const selectedTargets: ExploitTarget[] = [
    {
      candidateId: "company:acme",
      sourceLane: "ats_provider",
      sourceId: "greenhouse",
      companyKey: "acme",
      displayName: "Acme",
      observedAt: NOW.toISOString(),
      compositeScore: 75,
      isViable: true,
      suppressionReasons: [],
      sortKey: "25|acme",
      scores: {} as FrontierScoreComponents,
      exploitRank: 1,
      extractionPermitted: true,
    },
  ];

  assert.ok(isCandidateSelected("company:acme", selectedTargets));
  assert.ok(!isCandidateSelected("company:not-selected", selectedTargets));
});

test("VAL-LOOP-SCORE-005: selected targets have extractionPermitted=true", () => {
  const budget: ExplorationBudget = {
    maxScoutSurfaces: 50,
    maxExploitSurfaces: 5,
    maxScoutListingsPerSurface: 20,
  };

  const intent = makeIntent();

  const candidates: FrontierCandidate[] = [
    { candidateId: "company:c1", sourceLane: "ats_provider" as const, sourceId: "greenhouse", companyKey: "c1", displayName: "Company 1", observedAt: NOW.toISOString(), compositeScore: 75, isViable: true, suppressionReasons: [], sortKey: "25|c1", scores: {} as FrontierScoreComponents },
    { candidateId: "company:c2", sourceLane: "grounded_web" as const, sourceId: "grounded_web", companyKey: "c2", displayName: "Company 2", observedAt: NOW.toISOString(), compositeScore: 70, isViable: true, suppressionReasons: [], sortKey: "30|c2", scores: {} as FrontierScoreComponents },
  ];

  const result = selectExploitTargets(candidates, budget, intent);

  for (const target of result.selectedTargets) {
    assert.ok(target.extractionPermitted, `Target ${target.candidateId} should have extractionPermitted=true`);
    assert.ok(target.exploitRank > 0, `Target ${target.candidateId} should have valid exploitRank`);
  }
});

test("VAL-LOOP-SCORE-005: rejected candidates are tracked separately", () => {
  const budget: ExplorationBudget = {
    maxScoutSurfaces: 50,
    maxExploitSurfaces: 1,
    maxScoutListingsPerSurface: 20,
  };

  const intent = makeIntent();

  const candidates: FrontierCandidate[] = [
    { candidateId: "company:c1", sourceLane: "ats_provider" as const, sourceId: "greenhouse", companyKey: "c1", displayName: "Company 1", observedAt: NOW.toISOString(), compositeScore: 75, isViable: true, suppressionReasons: [], sortKey: "25|c1", scores: {} as FrontierScoreComponents },
    { candidateId: "company:c2", sourceLane: "grounded_web" as const, sourceId: "grounded_web", companyKey: "c2", displayName: "Company 2", observedAt: NOW.toISOString(), compositeScore: 70, isViable: true, suppressionReasons: [], sortKey: "30|c2", scores: {} as FrontierScoreComponents },
  ];

  const result = selectExploitTargets(candidates, budget, intent);

  assert.equal(result.selectedTargets.length, 1);
  assert.equal(result.rejectedCandidates.length, 1);
  assert.equal(result.selectedTargets[0].candidateId, "company:c1");
  assert.equal(result.rejectedCandidates[0].candidateId, "company:c2");
});

// === Default Budget Tests ===

test("DEFAULT_EXPLORATION_BUDGET has sensible defaults", () => {
  assert.ok(DEFAULT_EXPLORATION_BUDGET.maxScoutSurfaces > 0);
  assert.ok(DEFAULT_EXPLORATION_BUDGET.maxExploitSurfaces > 0);
  assert.ok(DEFAULT_EXPLORATION_BUDGET.maxScoutListingsPerSurface > 0);
  assert.ok(DEFAULT_EXPLORATION_BUDGET.maxScoutSurfaces >= DEFAULT_EXPLORATION_BUDGET.maxExploitSurfaces);
});

// === Edge Cases ===

test("selectExploitTargets handles empty candidates", () => {
  const budget = DEFAULT_EXPLORATION_BUDGET;
  const intent = makeIntent();

  const result = selectExploitTargets([], budget, intent);

  assert.equal(result.selectedTargets.length, 0);
  assert.equal(result.rejectedCandidates.length, 0);
  assert.equal(result.telemetry.totalCandidates, 0);
});

test("selectExploitTargets filters non-viable candidates", () => {
  const budget: ExplorationBudget = {
    maxScoutSurfaces: 50,
    maxExploitSurfaces: 10,
    maxScoutListingsPerSurface: 20,
  };

  const intent = makeIntent();

  const candidates: FrontierCandidate[] = [
    { candidateId: "company:c1", sourceLane: "ats_provider" as const, sourceId: "greenhouse", companyKey: "c1", displayName: "Company 1", observedAt: NOW.toISOString(), compositeScore: 75, isViable: true, suppressionReasons: [], sortKey: "25|c1", scores: {} as FrontierScoreComponents },
    { candidateId: "company:c2", sourceLane: "grounded_web" as const, sourceId: "grounded_web", companyKey: "c2", displayName: "Company 2", observedAt: NOW.toISOString(), compositeScore: 5, isViable: false, suppressionReasons: ["score below threshold"], sortKey: "95|c2", scores: {} as FrontierScoreComponents },
  ];

  const result = selectExploitTargets(candidates, budget, intent);

  assert.equal(result.selectedTargets.length, 1);
  assert.equal(result.telemetry.qualityRejectedCount, 1);
  assert.equal(result.selectedTargets[0].candidateId, "company:c1");
});

test("selectExploitTargets tracks ATS vs browser candidate counts in telemetry", () => {
  const budget = DEFAULT_EXPLORATION_BUDGET;
  const intent = makeIntent();

  const candidates: FrontierCandidate[] = [
    { candidateId: "company:c1", sourceLane: "ats_provider" as const, sourceId: "greenhouse", companyKey: "c1", displayName: "Company 1", observedAt: NOW.toISOString(), compositeScore: 75, isViable: true, suppressionReasons: [], sortKey: "25|c1", scores: {} as FrontierScoreComponents },
    { candidateId: "company:c2", sourceLane: "ats_provider" as const, sourceId: "lever", companyKey: "c2", displayName: "Company 2", observedAt: NOW.toISOString(), compositeScore: 70, isViable: true, suppressionReasons: [], sortKey: "30|c2", scores: {} as FrontierScoreComponents },
    { candidateId: "lead:https://c3.com/job", sourceLane: "grounded_web" as const, sourceId: "grounded_web", companyKey: "c3", displayName: "Company 3", observedAt: NOW.toISOString(), compositeScore: 65, isViable: true, suppressionReasons: [], sortKey: "35|c3", scores: {} as FrontierScoreComponents },
  ];

  const result = selectExploitTargets(candidates, budget, intent);

  assert.equal(result.telemetry.atsCandidates, 2);
  assert.equal(result.telemetry.browserCandidates, 1);
  assert.equal(result.telemetry.totalCandidates, 3);
});
