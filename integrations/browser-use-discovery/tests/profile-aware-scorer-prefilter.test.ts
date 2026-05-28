import { describe, test } from "node:test";
import { strict as assert } from "node:assert";

import {
  runPreFilter,
  parseSalaryMax,
} from "../src/normalize/profile-aware-scorer.ts";
import type { RawListing } from "../src/contracts.ts";
import type { UserProfile } from "../src/contracts/user-profile.ts";

function makeProfile(
  overrides: Partial<UserProfile["hardConstraints"]> = {},
): UserProfile {
  return {
    version: 1,
    identity: {
      targetRoles: ["Staff Engineer"],
      targetSeniority: "ic_staff",
      primaryNarrative:
        "I am a staff backend engineer looking for distributed systems work.",
    },
    strengths: [{ name: "backend systems", rank: 1 }],
    hardConstraints: {
      workMode: "any",
      ...overrides,
    },
  };
}

function makeListing(overrides: Partial<RawListing> = {}): RawListing {
  return {
    sourceId: "greenhouse",
    sourceLabel: "Greenhouse",
    title: "Senior Backend Engineer",
    company: "Acme",
    location: "San Francisco, CA",
    url: "https://jobs.example.com/be",
    compensationText: "$200k-$240k",
    descriptionText: "Build distributed systems on a small team.",
    ...overrides,
  };
}

describe("runPreFilter", () => {
  test("happy path passes when no constraints fire", () => {
    const result = runPreFilter(makeListing(), makeProfile());
    assert.equal(result.pass, true);
  });

  test("skipTitles substring rejects with skip_title_match", () => {
    const result = runPreFilter(
      makeListing({ title: "Junior Backend Intern" }),
      makeProfile({ skipTitles: ["intern", "junior"] }),
    );
    assert.equal(result.pass, false);
    if (!result.pass) {
      assert.equal(result.reason, "skip_title_match");
    }
  });

  test("workMode=remote_only rejects onsite listings", () => {
    const result = runPreFilter(
      makeListing({ remoteBucket: "onsite" }),
      makeProfile({ workMode: "remote_only" }),
    );
    assert.equal(result.pass, false);
    if (!result.pass) {
      assert.equal(result.reason, "work_mode_mismatch");
    }
  });

  test("workMode=remote_only accepts remote listings", () => {
    const result = runPreFilter(
      makeListing({ remoteBucket: "remote", location: "Anywhere" }),
      makeProfile({
        workMode: "remote_only",
        acceptableLocations: ["denver"], // ignored for remote
      }),
    );
    assert.equal(result.pass, true);
  });

  test("acceptableLocations rejects out-of-list onsite listings", () => {
    const result = runPreFilter(
      makeListing({
        remoteBucket: "onsite",
        location: "Boise, ID",
      }),
      makeProfile({
        workMode: "onsite_ok",
        acceptableLocations: ["Denver", "Philadelphia"],
      }),
    );
    assert.equal(result.pass, false);
    if (!result.pass) {
      assert.equal(result.reason, "location_outside_acceptable");
    }
  });

  test("workAuth=needs_sponsorship rejects on no-sponsorship phrase", () => {
    const result = runPreFilter(
      makeListing({
        descriptionText:
          "Great role. Note: No visa sponsorship offered for this position.",
      }),
      makeProfile({ workAuth: "needs_sponsorship" }),
    );
    assert.equal(result.pass, false);
    if (!result.pass) {
      assert.equal(result.reason, "work_auth_mismatch");
    }
  });

  test("salaryRequired rejects listings with no parseable comp", () => {
    const result = runPreFilter(
      makeListing({ compensationText: "" }),
      makeProfile({ salaryRequired: true }),
    );
    assert.equal(result.pass, false);
    if (!result.pass) {
      assert.equal(result.reason, "salary_missing_but_required");
    }
  });

  test("salaryFloor rejects listings below floor", () => {
    const result = runPreFilter(
      makeListing({ compensationText: "$90k-$110k" }),
      makeProfile({ salaryRequired: true, salaryFloor: 150000 }),
    );
    assert.equal(result.pass, false);
    if (!result.pass) {
      assert.equal(result.reason, "salary_below_floor");
    }
  });

  test("salaryFloor pass when listing max meets floor", () => {
    const result = runPreFilter(
      makeListing({ compensationText: "$140k-$180k" }),
      makeProfile({ salaryRequired: true, salaryFloor: 150000 }),
    );
    assert.equal(result.pass, true);
  });
});

describe("parseSalaryMax", () => {
  test("parses $150k", () => {
    assert.equal(parseSalaryMax("$150k"), 150000);
  });
  test("parses range $150K - $180K, returns max", () => {
    assert.equal(parseSalaryMax("$150K - $180K"), 180000);
  });
  test("parses $150,000", () => {
    assert.equal(parseSalaryMax("$150,000"), 150000);
  });
  test("parses 150-180k range", () => {
    assert.equal(parseSalaryMax("150-180k"), 180000);
  });
  test("parses bare 200000", () => {
    assert.equal(parseSalaryMax("200000"), 200000);
  });
  test("returns null for empty/unparseable", () => {
    assert.equal(parseSalaryMax(""), null);
    assert.equal(parseSalaryMax("competitive"), null);
  });
});
