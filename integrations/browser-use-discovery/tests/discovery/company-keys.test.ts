import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveAtsCompanySeeds,
  normalizeCompanyKey,
  reconcileAtsCompaniesWithActivePool,
  slugifyCompanyKey,
} from "../../src/discovery/company-keys.ts";

test("effectiveAtsCompanySeeds inherits broad companies when ATS list is empty", () => {
  const companies = [{ name: "Ramp", companyKey: "ramp", normalizedName: "ramp" }];
  const seeds = effectiveAtsCompanySeeds([], companies);
  assert.deepEqual(seeds.map((company) => company.companyKey), ["ramp"]);
});

test("B18: shared company-key helpers cover both historical semantics", () => {
  // normalizeCompanyKey: strip every non-alphanumeric (normalizer, grounded,
  // run-discovery). slugifyCompanyKey: dash-joined slug (config, planner,
  // profile-to-companies). The six file-local copies were replaced by these.
  const cases: Array<[unknown, string, string]> = [
    ["Acme", "acme", "acme"],
    ["Acme Inc.", "acmeinc", "acme-inc"],
    ["  Globex-Corp  ", "globexcorp", "globex-corp"],
    ["A&B  Holdings!", "abholdings", "a-b-holdings"],
    ["Café Møøse", "cafmse", "caf-m-se"],
    ["", "", ""],
    [null, "", ""],
    [undefined, "", ""],
    [123, "123", "123"],
  ];
  for (const [input, stripped, slugged] of cases) {
    assert.equal(
      normalizeCompanyKey(input as string),
      stripped,
      `normalizeCompanyKey(${JSON.stringify(input)})`,
    );
    assert.equal(
      slugifyCompanyKey(input as string),
      slugged,
      `slugifyCompanyKey(${JSON.stringify(input)})`,
    );
  }
});

test("reconcileAtsCompaniesWithActivePool drops stale ATS seeds after profile refresh", () => {
  const nextCompanies = [
    { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
    { name: "Stripe", companyKey: "stripe", normalizedName: "stripe" },
  ];
  const priorAts = [
    { name: "Figma", companyKey: "figma", normalizedName: "figma" },
    { name: "Ramp", companyKey: "ramp", normalizedName: "ramp" },
  ];
  const reconciled = reconcileAtsCompaniesWithActivePool(priorAts, nextCompanies);
  assert.deepEqual(
    reconciled.map((company) => company.companyKey),
    ["ramp"],
  );
});
