import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveAtsCompanySeeds,
  reconcileAtsCompaniesWithActivePool,
} from "../../src/discovery/company-keys.ts";

test("effectiveAtsCompanySeeds inherits broad companies when ATS list is empty", () => {
  const companies = [{ name: "Ramp", companyKey: "ramp", normalizedName: "ramp" }];
  const seeds = effectiveAtsCompanySeeds([], companies);
  assert.deepEqual(seeds.map((company) => company.companyKey), ["ramp"]);
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
