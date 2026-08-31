import assert from "node:assert/strict";
import test from "node:test";

import {
  applySheetConfigMutation,
  buildEffectiveIntent,
  resolveEffectiveCompanyPools,
  resolveEffectiveSources,
} from "../../src/discovery/effective-intent.ts";

const MERGED_USER_PROFILE = {
  version: 1 as const,
  identity: {
    targetRoles: ["Staff backend engineer"],
    targetSeniority: "ic_staff" as const,
    primaryNarrative:
      "I build distributed backends and want to keep doing that at a product company.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  hardConstraints: { workMode: "remote_only" as const },
};

test("F1C-DISC03-INTENT: worker effective intent uses searchPlan when top-level fields are blank", () => {
  const effective = buildEffectiveIntent({
    discoveryProfile: {
      targetRoles: "",
      keywordsInclude: "",
      searchPlan: {
        planVersion: 1,
        generatedAt: "2026-04-08T12:00:00.000Z",
        seed: "seed",
        query: {
          targetRoles: "Platform Engineer",
          keywordsInclude: "typescript",
        },
      },
    },
  });
  assert.equal(effective.blank, false);
  assert.ok(effective.targetRoles.includes("Platform Engineer"));
  assert.equal(effective.intentContractVersion, 1);
});

test("F1C-DISC03-INTENT: searchPlan query overrides broader profile fields", () => {
  const effective = buildEffectiveIntent({
    discoveryProfile: {
      targetRoles: "Broad profile role",
      keywordsInclude: "broad keyword",
      searchPlan: {
        planVersion: 1,
        generatedAt: "2026-04-08T12:00:00.000Z",
        seed: "seed",
        query: {
          targetRoles: "Rotated plan role",
          keywordsInclude: "rotated keyword",
        },
      },
    },
  });
  assert.deepEqual(effective.targetRoles, ["Rotated plan role"]);
  assert.deepEqual(effective.includeKeywords, ["rotated keyword"]);
});

test("F1C-DISC03-INTENT: worker effective intent uses mergedUserProfile targetRoles", () => {
  const effective = buildEffectiveIntent({
    discoveryProfile: { targetRoles: "", keywordsInclude: "" },
    mergedUserProfile: MERGED_USER_PROFILE,
  });
  assert.equal(effective.blank, false);
  assert.ok(effective.targetRoles.includes("Staff backend engineer"));
});

test("F1C-DISC04-BLOCK: blocklist is subtracted from ATS and normal pools after allowlist/skip", () => {
  const resolved = resolveEffectiveCompanyPools({
    companies: [
      { name: "Stripe", companyKey: "stripe" },
      { name: "Acme Holdings", companyKey: "acme-holdings" },
      { name: "Blocked Skip", companyKey: "blocked-skip" },
    ],
    atsCompanies: [
      { name: "Linear", companyKey: "linear" },
      { name: "Acme Holdings", companyKey: "acme-holdings" },
    ],
    companyHistory: [{ name: "Notion", companyKey: "notion" }],
    negativeCompanyKeys: ["blocked-skip"],
    companyAllowlist: ["stripe", "acme-holdings", "linear", "notion"],
    companyBlocklist: ["Acme Holdings"],
  });
  assert.deepEqual(
    resolved.companies.map((company) => company.companyKey).sort(),
    ["notion", "stripe"],
  );
  assert.deepEqual(
    resolved.atsCompanies.map((company) => company.companyKey),
    ["linear"],
  );
});

test("F1C-DISC04-BLOCK: company names and skip aliases use the same matching vocabulary", () => {
  const resolved = resolveEffectiveCompanyPools({
    companies: [
      { name: "Acme Holdings", companyKey: "acme-holdings" },
      { name: "Beta Labs", companyKey: "beta-labs" },
    ],
    atsCompanies: [],
    companyAllowlist: ["Beta Labs"],
    negativeCompanyKeys: ["Acme Holdings"],
  });
  assert.equal(resolved.allowlistResolution.mode, "restricted");
  assert.deepEqual(
    resolved.companies.map((company) => company.companyKey),
    ["beta-labs"],
  );
});

test("F1C-DISC04-BLOCK: domain blocklist entries suppress matching companies", () => {
  const resolved = resolveEffectiveCompanyPools({
    companies: [{
      name: "Acme Holdings",
      companyKey: "acme-holdings",
      domains: ["jobs.acme.example"],
    }],
    companyBlocklist: ["jobs.acme.example"],
  });
  assert.deepEqual(resolved.companies, []);
});

test("F1C-DISC05-GW: grounded-web opt-out wins over preset/enabledSources", () => {
  const sources = resolveEffectiveSources({
    sourcePreset: "browser_plus_ats",
    enabledSources: ["greenhouse", "grounded_web", "serpapi_google_jobs"],
    groundedWebEnabled: false,
  });
  assert.equal(sources.includes("grounded_web"), false);
  assert.ok(sources.includes("greenhouse"));
});

test("F1C-DISC06-ALLOW: unknown-only allowlist is blocked_unresolved, not unrestricted", () => {
  const resolved = resolveEffectiveCompanyPools({
    companies: [
      { name: "Notion", companyKey: "notion" },
      { name: "Ramp", companyKey: "ramp" },
    ],
    atsCompanies: [{ name: "Notion", companyKey: "notion" }],
    companyHistory: [],
    negativeCompanyKeys: [],
    companyAllowlist: ["unknown-company"],
    companyBlocklist: [],
  });
  assert.equal(resolved.allowlistResolution.mode, "blocked_unresolved");
  assert.deepEqual(resolved.companies, []);
  assert.equal(resolved.allowUnrestrictedFallback, false);
});

test("F1C-DISC06-ALLOW: explicit allowUnrestrictedFallback is the only broad fallback", () => {
  const resolved = resolveEffectiveCompanyPools({
    companies: [
      { name: "Notion", companyKey: "notion" },
      { name: "Ramp", companyKey: "ramp" },
    ],
    atsCompanies: [{ name: "Notion", companyKey: "notion" }],
    companyHistory: [],
    negativeCompanyKeys: [],
    companyAllowlist: ["unknown-company"],
    companyBlocklist: [],
    allowUnrestrictedFallback: true,
  });
  assert.equal(resolved.allowlistResolution.mode, "explicit_unrestricted");
  assert.deepEqual(
    resolved.companies.map((company) => company.companyKey).sort(),
    ["notion", "ramp"],
  );
});

test("F1C-P2-SHEETS: grouped multi-Sheet envelopes preserve siblings and unknown fields", () => {
  const envelope = {
    bySheetId: {
      sheet_a: {
        companies: [{ name: "Alpha", companyKey: "alpha" }],
        experimentalFlag: "keep-me",
      },
      sheet_b: {
        companies: [{ name: "Beta", companyKey: "beta" }],
        notes: "other-sheet",
      },
    },
    extraEnvelopeField: 42,
  };
  const next = applySheetConfigMutation(envelope, "sheet_a", {
    companies: [{ name: "Alpha Updated", companyKey: "alpha" }],
  });
  assert.equal(next.extraEnvelopeField, 42);
  assert.equal(
    (next.bySheetId as Record<string, { experimentalFlag?: string }>).sheet_a
      .experimentalFlag,
    "keep-me",
  );
  assert.equal(
    (next.bySheetId as Record<string, { companies: { name: string }[] }>).sheet_a
      .companies[0].name,
    "Alpha Updated",
  );
  assert.equal(
    (next.bySheetId as Record<string, { companies: { name: string }[] }>).sheet_b
      .companies[0].name,
    "Beta",
  );
});
