import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectionalQuery,
  buildQueryVariations,
  buildApplicationFramingPrompt,
  buildFitAssessment,
  inferQueryLane,
  QUERY_OUTCOME,
} from "../../src/discovery/directional-prompting.ts";
import { buildProfileFitAssessment } from "../../src/normalize/profile-aware-scorer.ts";

/* -----------------------------------------------------------------------
 * inferQueryLane
 * ----------------------------------------------------------------------- */

test("inferQueryLane returns 'consultant' for strategist and director roles", () => {
  const cases: [string, string][] = [
    ["Digital Marketing Consultant", "consultant"],
    ["Senior Strategist, Digital Strategy", "consultant"],
    ["Director of Digital Strategy", "consultant"],
    ["Principal Consultant Marketing AI", "consultant"],
    ["Practice Lead Digital", "consultant"],
    ["AI Search Strategist", "consultant"],
    ["GEO Strategist", "consultant"],
    ["Growth Marketing Director", "consultant"],
  ];
  for (const [role, expected] of cases) {
    assert.equal(
      inferQueryLane(role),
      expected,
      `Expected '${expected}' for '${role}'`,
    );
  }
});

test("inferQueryLane returns 'ai_builder' for AI and solutions roles", () => {
  const cases: [string, string][] = [
    ["AI Product Builder", "ai_builder"],
    ["AI Solutions Architect", "ai_builder"],
    ["Forward Deployed AI Engineer", "ai_builder"],
    ["GTM Engineer AI", "ai_builder"],
    ["Technical Account Manager AI", "ai_builder"],
    ["Implementation Lead AI platforms", "ai_builder"],
  ];
  for (const [role, expected] of cases) {
    assert.equal(
      inferQueryLane(role),
      expected,
      `Expected '${expected}' for '${role}'`,
    );
  }
});

test("inferQueryLane returns 'pm_smme' for PMM and staff/technical PM roles", () => {
  const cases: [string, string][] = [
    ["Senior Product Marketing Manager", "pm_smme"],
    ["Staff Product Marketing Manager", "pm_smme"],
    ["Technical PMM AI", "pm_smme"],
    ["Principal PMM AI", "pm_smme"],
    ["Director of Product Marketing AI", "pm_smme"],
  ];
  for (const [role, expected] of cases) {
    assert.equal(
      inferQueryLane(role),
      expected,
      `Expected '${expected}' for '${role}'`,
    );
  }
});

test("inferQueryLane returns 'gtm_growth' for performance and growth marketing", () => {
  const cases: [string, string][] = [
    ["Growth Marketing Manager", "gtm_growth"],
    ["Performance Marketing Manager", "gtm_growth"],
    ["Director of Performance Marketing", "gtm_growth"],
    ["Senior Paid Acquisition Lead", "gtm_growth"],
    ["Paid Media Director", "gtm_growth"],
  ];
  for (const [role, expected] of cases) {
    assert.equal(
      inferQueryLane(role),
      expected,
      `Expected '${expected}' for '${role}'`,
    );
  }
});

test("inferQueryLane returns 'demand_gen' for demand gen and lifecycle roles", () => {
  const cases: [string, string][] = [
    ["Demand Generation Manager", "demand_gen"],
    ["Lifecycle Marketing Manager", "demand_gen"],
    ["Marketing Operations Lead", "demand_gen"],
    ["Account Based Marketing Director", "demand_gen"],
    ["ABM Manager", "demand_gen"],
  ];
  for (const [role, expected] of cases) {
    assert.equal(
      inferQueryLane(role),
      expected,
      `Expected '${expected}' for '${role}'`,
    );
  }
});

test("inferQueryLane defaults to 'consultant' for unrecognized roles", () => {
  const cases = [
    "Software Engineer",
    "Data Scientist",
    "Sales Development Representative",
    "Chief Marketing Officer",
    "Product Designer",
  ];
  for (const role of cases) {
    assert.equal(
      inferQueryLane(role),
      "consultant",
      `Expected 'consultant' default for '${role}'`,
    );
  }
});

/* -----------------------------------------------------------------------
 * buildDirectionalQuery
 * ----------------------------------------------------------------------- */

test("buildDirectionalQuery uses the primary lane phrase when role matches poorly", () => {
  const result = buildDirectionalQuery(
    "Senior Product Manager",
    "Remote",
    "remote",
    "consultant",
  );
  // Should not be "Senior Product Manager" — should use the lane's primary.
  assert.ok(
    result.includes("Digital Marketing Consultant") ||
      result.includes("Consultant"),
    `Got: ${result}`,
  );
});

test("buildDirectionalQuery uses the role itself when it matches the primary", () => {
  const result = buildDirectionalQuery(
    "Digital Marketing Consultant",
    "Denver",
    "",
    "consultant",
  );
  assert.ok(result.includes("Digital Marketing Consultant"), `Got: ${result}`);
});

test("buildDirectionalQuery appends location + remote suffix correctly", () => {
  const withRemote = buildDirectionalQuery(
    "AI Solutions Architect",
    "Remote",
    "remote",
    "ai_builder",
  );
  assert.ok(
    withRemote.includes("remote") || withRemote.includes("Remote"),
    `Got: ${withRemote}`,
  );

  const withCity = buildDirectionalQuery(
    "Performance Marketing Director",
    "Denver CO",
    "hybrid",
    "gtm_growth",
  );
  assert.ok(withCity.includes("Denver"), `Got: ${withCity}`);
});

test("buildDirectionalQuery handles empty location", () => {
  const result = buildDirectionalQuery(
    "Demand Generation Manager",
    "",
    "remote",
    "demand_gen",
  );
  assert.ok(result.length > 0, "Query should not be empty");
  assert.ok(result.includes("Demand Generation"), `Got: ${result}`);
});

test("buildDirectionalQuery produces no negations in output", () => {
  const negationWords = ["don't", "do not", "never", "avoid", "exclude", "no "];
  const testCases: [string, string, string][] = [
    ["Digital Marketing Consultant", "Remote", "remote"],
    ["AI Solutions Architect", "Denver", "hybrid"],
    ["Growth Marketing Manager", "Colorado", ""],
    ["Demand Generation Manager", "", "remote"],
  ];

  for (const [role, location, remote] of testCases) {
    const lane = inferQueryLane(role);
    const result = buildDirectionalQuery(role, location, remote, lane);
    const lower = result.toLowerCase();
    for (const neg of negationWords) {
      assert.ok(
        !lower.includes(neg),
        `Query '${result}' contains negation '${neg}'`,
      );
    }
  }
});

/* -----------------------------------------------------------------------
 * buildQueryVariations
 * ----------------------------------------------------------------------- */

test("buildQueryVariations returns at least 2 queries", () => {
  const variations = buildQueryVariations(
    "Digital Marketing Consultant",
    "Remote",
    "remote",
    "consultant",
  );
  assert.ok(variations.length >= 2, `Got ${variations.length} variations`);
});

test("buildQueryVariations dedupes identical queries", () => {
  const variations = buildQueryVariations(
    "Consultant",
    "Remote",
    "remote",
    "consultant",
  );
  const unique = new Set(variations.map((q) => q.toLowerCase()));
  assert.equal(
    unique.size,
    variations.length,
    `Duplicates found in: ${JSON.stringify(variations)}`,
  );
});

test("buildQueryVariations caps at 4 total (1 primary + 3 alternatives)", () => {
  const variations = buildQueryVariations(
    "Growth Marketing Manager",
    "Remote",
    "remote",
    "gtm_growth",
  );
  assert.ok(variations.length <= 4, `Got ${variations.length} variations`);
});

test("buildQueryVariations contains no negations", () => {
  const negationWords = ["don't", "do not", "never", "avoid"];
  const variations = buildQueryVariations(
    "Performance Marketing Manager",
    "United States",
    "",
    "gtm_growth",
  );
  for (const query of variations) {
    const lower = query.toLowerCase();
    for (const neg of negationWords) {
      assert.ok(
        !lower.includes(neg),
        `Query '${query}' contains negation '${neg}'`,
      );
    }
  }
});

/* -----------------------------------------------------------------------
 * buildApplicationFramingPrompt
 * ----------------------------------------------------------------------- */

test("buildApplicationFramingPrompt includes company and role", () => {
  const result = buildApplicationFramingPrompt({
    company: "Notion",
    role: "Growth Marketing Manager",
    fitSummary: "Strong fit — track record of growing B2B SaaS pipelines",
    keyAchievements: [
      "Grew paid search conversions 130% YoY",
      "Managed $10M+ annual digital P&L",
    ],
  });

  assert.ok(result.includes("Notion"), `Missing company: ${result}`);
  assert.ok(result.includes("Growth Marketing Manager"), `Missing role: ${result}`);
});

test("buildApplicationFramingPrompt includes Goal/Success/Stop phrasing", () => {
  const result = buildApplicationFramingPrompt({
    company: "Figma",
    role: "Senior PMM",
    fitSummary: "AI GTM experience + design-tool background",
    keyAchievements: ["Built multi-model AI platform"],
  });

  assert.ok(result.includes("Goal:"), `Missing Goal block: ${result}`);
  assert.ok(result.includes("Success means:"), `Missing Success block: ${result}`);
  assert.ok(result.includes("Stop when:"), `Missing Stop block: ${result}`);
});

test("buildApplicationFramingPrompt includes key achievements", () => {
  const achievements = [
    "Grew paid search conversions 130% YoY",
    "Managed $10M+ annual digital P&L",
  ];
  const result = buildApplicationFramingPrompt({
    company: "Scale AI",
    role: "Director of Growth",
    fitSummary: "Scale + AI domain expertise",
    keyAchievements: achievements,
  });

  for (const a of achievements) {
    assert.ok(result.includes(a), `Missing achievement '${a}': ${result}`);
  }
});

test("buildApplicationFramingPrompt produces no negations in body", () => {
  const negationWords = ["don't", "do not", "never", "avoid", "refrain"];
  const result = buildApplicationFramingPrompt({
    company: "Vercel",
    role: "Performance Marketing Lead",
    fitSummary: "Proven performance marketing track record",
    keyAchievements: ["130% YoY conversion growth"],
  });

  const lower = result.toLowerCase();
  for (const neg of negationWords) {
    assert.ok(!lower.includes(neg), `Prompt contains '${neg}': ${result}`);
  }
});

/* -----------------------------------------------------------------------
 * buildFitAssessment
 * ----------------------------------------------------------------------- */

test("buildFitAssessment returns 'Exceptional' for score >= 9", () => {
  const result = buildFitAssessment({
    role: "Senior PMM",
    company: "Figma",
    fitScore: 9.5,
    fitSummary: "Strong AI PMM background",
    locationOk: true,
    remoteOk: true,
    salaryPublished: true,
    applicationComplexity: "Greenhouse",
  });
  assert.ok(result.includes("Exceptional"), `Got: ${result}`);
});

test("buildFitAssessment returns 'Strong' for score 8-8.9", () => {
  const result = buildFitAssessment({
    role: "Growth Marketing Manager",
    company: "Notion",
    fitScore: 8.2,
    fitSummary: "Good role fit",
    locationOk: true,
    remoteOk: false,
    salaryPublished: false,
    applicationComplexity: "Ashby",
  });
  assert.ok(result.includes("Strong"), `Got: ${result}`);
});

test("buildFitAssessment returns 'Interesting' for score 7-7.9", () => {
  const result = buildFitAssessment({
    role: "Product Manager",
    company: "SomeCo",
    fitScore: 7.5,
    fitSummary: "Adjacent but plausible",
    locationOk: false,
    remoteOk: false,
    salaryPublished: false,
    applicationComplexity: "Workday",
  });
  assert.ok(result.includes("Interesting"), `Got: ${result}`);
});

test("buildFitAssessment flags location concern when not ok", () => {
  const result = buildFitAssessment({
    role: "PMM",
    company: "AnyCorp",
    fitScore: 8.5,
    fitSummary: "Decent fit",
    locationOk: false,
    remoteOk: false,
    salaryPublished: false,
    applicationComplexity: "Greenhouse",
  });
  assert.ok(result.includes("Location may require attention"), `Got: ${result}`);
});

test("buildFitAssessment flags salary missing when not published", () => {
  const result = buildFitAssessment({
    role: "PMM",
    company: "AnyCorp",
    fitScore: 8.5,
    fitSummary: "Decent fit",
    locationOk: true,
    remoteOk: true,
    salaryPublished: false,
    applicationComplexity: "Greenhouse",
  });
  assert.ok(result.includes("Salary not published"), `Got: ${result}`);
  assert.ok(!result.includes("💰"), "Should not show salary icon when not published");
});

test("buildFitAssessment shows salary icon when published", () => {
  const result = buildFitAssessment({
    role: "PMM",
    company: "AnyCorp",
    fitScore: 8.5,
    fitSummary: "Decent fit",
    locationOk: true,
    remoteOk: true,
    salaryPublished: true,
    applicationComplexity: "Greenhouse",
  });
  assert.ok(result.includes("💰 Salary band published"), `Got: ${result}`);
});

test("buildProfileFitAssessment strips HTML from descriptionText fallback", () => {
  // When fitRationale is empty (no strong dimension signals), the fallback
  // uses descriptionText directly. HTML tags must be stripped.
  const result = buildProfileFitAssessment({
    role: "Associate",
    company: "Acme Corp",
    result: {
      fitScore: 1.5,
      band: "Low",
      dimensionScores: {
        laneFit: 0, aiRelevance: 0, performanceMarketing: 0,
        adtechMartechMedia: 0, seniority: 0, compensationTransparency: 0,
        remoteLocation: 0, companyCredibility: 0, applicationComplexity: 0,
      },
      primaryLane: "consultant",
      salaryPenalised: true,
      exceptionalWithoutSalary: false,
      fitRationale: "", // empty → triggers descriptionText fallback
    },
    applicationComplexity: "Standard",
    descriptionText: "<p>Build <strong>campaigns</strong> across channels.</p>",
  });
  assert.ok(!result.includes("<"), `HTML tag leaked: ${result}`);
  assert.ok(result.includes("campaigns"), `Fallback text not included: ${result}`);
});

/* -----------------------------------------------------------------------
 * QUERY_OUTCOME constant
 * ----------------------------------------------------------------------- */

test("QUERY_OUTCOME contains Goal, Success means, and Stop when", () => {
  assert.ok(QUERY_OUTCOME.includes("Goal:"), "Missing Goal:");
  assert.ok(QUERY_OUTCOME.includes("Success means:"), "Missing Success means:");
  assert.ok(QUERY_OUTCOME.includes("Stop when:"), "Missing Stop when:");
});

test("QUERY_OUTCOME contains no negations", () => {
  const negationWords = ["don't", "do not", "never", "avoid"];
  const lower = QUERY_OUTCOME.toLowerCase();
  for (const neg of negationWords) {
    assert.ok(!lower.includes(neg), `QUERY_OUTCOME contains '${neg}'`);
  }
});