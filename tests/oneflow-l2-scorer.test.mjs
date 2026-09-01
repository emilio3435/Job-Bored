import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { _internal } from "../server/profile-rescore-worker.mjs";

function profile(hardConstraints) {
  return {
    version: 1,
    identity: {
      targetRoles: ["Staff Engineer"],
      targetSeniority: "ic_staff",
      primaryNarrative:
        "I build reliable distributed systems and lead high-leverage platform work.",
    },
    strengths: [{ name: "Distributed systems", rank: 1 }],
    hardConstraints: { workMode: "any", ...hardConstraints },
  };
}

function listing(overrides = {}) {
  return {
    sourceId: "rescore",
    sourceLabel: "Rescore",
    title: "Senior Backend Engineer",
    company: "Acme",
    location: "Boise, ID",
    url: "https://jobs.example.test/backend",
    remoteBucket: "onsite",
    compensationText: "$90k-$110k",
    descriptionText: "Build distributed systems on a small team.",
    ...overrides,
  };
}

function runPreFilter(rawListing, userProfile) {
  return _internal.runPreFilter(rawListing, userProfile);
}

describe("ONEFLOW L2 — profile-rescore prefilter mirrors discovery scoring", () => {
  it("L2-SCORER-MJS-LOCATION: workMode=any never hard-rejects a saved location mismatch", () => {
    const result = runPreFilter(
      listing(),
      profile({ workMode: "any", acceptableLocations: ["Denver"] }),
    );
    assert.equal(result.pass, true);
  });

  it("L2-SCORER-MJS-LOCATION-GATE: hybrid and onsite modes still enforce acceptable locations", () => {
    for (const workMode of ["hybrid_ok", "onsite_ok"]) {
      const result = runPreFilter(
        listing(),
        profile({ workMode, acceptableLocations: ["Denver"] }),
      );
      assert.equal(result.pass, false);
      assert.equal(result.reason, "location_outside_acceptable");
    }
  });

  it("L2-SCORER-MJS-SALARY: a published salary below salaryFloor rejects when salaryRequired is false", () => {
    const result = runPreFilter(
      listing(),
      profile({ salaryFloor: 150000, salaryRequired: false }),
    );
    assert.equal(result.pass, false);
    assert.equal(result.reason, "salary_below_floor");
  });

  it("L2-SCORER-MJS-SALARY-MISSING: salaryRequired alone owns the no-published-salary rejection", () => {
    assert.equal(
      runPreFilter(
        listing({ compensationText: "Competitive" }),
        profile({ salaryFloor: 150000, salaryRequired: false }),
      ).pass,
      true,
    );
    const required = runPreFilter(
      listing({ compensationText: "Competitive" }),
      profile({ salaryFloor: 150000, salaryRequired: true }),
    );
    assert.equal(required.pass, false);
    assert.equal(required.reason, "salary_missing_but_required");
  });

  it("L2-SCORER-MJS-SALARY-PARSE: non-salary numbers remain missing in the server mirror", () => {
    const result = runPreFilter(
      listing({ compensationText: "Competitive pay, 40 hours per week" }),
      profile({ salaryFloor: 150000, salaryRequired: true }),
    );
    assert.equal(result.pass, false);
    assert.equal(result.reason, "salary_missing_but_required");
  });
});
