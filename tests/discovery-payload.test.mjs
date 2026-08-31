import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const payload = require("../discovery-payload.js");

function makeInput(overrides = {}) {
  return {
    sheetId: "sheet_1234567890",
    requestedAt: "2026-05-26T11:00:00.000Z",
    trigger: "scheduled-local",
    discoveryProfile: {
      targetRoles: "Staff backend engineer, Platform engineer",
      locations: "Chicago, Remote",
      remotePolicy: "Remote-first",
      seniority: "Senior, Staff",
      keywordsInclude: "Postgres, distributed systems",
      keywordsExclude: "PHP",
      maxLeadsPerRun: "12",
      sourcePreset: "browser_plus_ats",
    },
    resume: {
      extractedText:
        "Built Python, Postgres, React, Kubernetes, and AI systems. PRIVATE_RESUME_SENTENCE should not be copied.",
      createdAt: "2026-05-20T00:00:00.000Z",
    },
    preferences: {
      tone: "warm",
      industriesToEmphasize: "Developer tools, AI",
      wordsToAvoid: "rockstar",
      voiceNotes: "Prefer small teams and practical product work.",
    },
    schedule: {
      local: { enabled: true, hour: 8, minute: 0 },
      github: { enabled: true, hour: 6, minute: 0 },
    },
    ...overrides,
  };
}

test("shared discovery payload includes fresh profile snapshot and rotated search plan without raw resume text", () => {
  const result = payload.buildDiscoveryWebhookPayload(makeInput());

  assert.equal(result.event, "command-center.discovery");
  assert.equal(result.trigger, "scheduled-local");
  assert.ok(result.discoveryProfile.profileSnapshot.resumeTextLength > 0);
  assert.equal(result.discoveryProfile.profileSnapshot.schedule.local.hour, 8);
  assert.equal(result.discoveryProfile.searchPlan.planVersion, 1);
  assert.ok(result.discoveryProfile.searchPlan.query.targetRoles);
  assert.ok(result.discoveryProfile.searchPlan.query.keywordsInclude);
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE_RESUME_SENTENCE/,
    "payload metadata must not include raw resume text",
  );
});

test("payload snapshot changes when profile or resume context changes", () => {
  const first = payload.buildDiscoveryWebhookPayload(makeInput());
  const roleChanged = payload.buildDiscoveryWebhookPayload(
    makeInput({
      discoveryProfile: {
        ...makeInput().discoveryProfile,
        targetRoles: "Growth product manager",
      },
    }),
  );
  const resumeChanged = payload.buildDiscoveryWebhookPayload(
    makeInput({
      resume: {
        extractedText: "Built lifecycle marketing analytics in SQL.",
        createdAt: "2026-05-21T00:00:00.000Z",
      },
    }),
  );

  assert.notEqual(
    roleChanged.discoveryProfile.profileSnapshot.profileHash,
    first.discoveryProfile.profileSnapshot.profileHash,
  );
  assert.notEqual(
    resumeChanged.discoveryProfile.profileSnapshot.profileHash,
    first.discoveryProfile.profileSnapshot.profileHash,
  );
});

test("scheduled search rotation is stable for the same day and differs across days", () => {
  const dayOneA = payload.buildDiscoveryWebhookPayload(makeInput());
  const dayOneB = payload.buildDiscoveryWebhookPayload(
    makeInput({
      requestedAt: "2026-05-26T23:45:00.000Z",
    }),
  );
  const dayTwo = payload.buildDiscoveryWebhookPayload(
    makeInput({
      requestedAt: "2026-05-27T11:00:00.000Z",
    }),
  );

  assert.deepEqual(
    dayOneA.discoveryProfile.searchPlan.selected,
    dayOneB.discoveryProfile.searchPlan.selected,
  );
  assert.notDeepEqual(
    dayOneA.discoveryProfile.searchPlan.selected,
    dayTwo.discoveryProfile.searchPlan.selected,
  );
});

test("manual search rotation can vary by variationKey while using the same builder", () => {
  const first = payload.buildDiscoveryWebhookPayload(
    makeInput({ trigger: "manual", variationKey: "manual-a" }),
  );
  const second = payload.buildDiscoveryWebhookPayload(
    makeInput({ trigger: "manual", variationKey: "manual-b" }),
  );

  assert.notEqual(
    first.discoveryProfile.searchPlan.seed,
    second.discoveryProfile.searchPlan.seed,
  );
});

const MERGED_USER_PROFILE = {
  version: 1,
  identity: {
    targetRoles: ["Staff backend engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative:
      "I build distributed backends and want to keep doing that at a product company.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  hardConstraints: { workMode: "remote_only" },
};

test("F1C-DISC02-PROFILE: mergedUserProfile survives the dashboard payload builder", () => {
  const result = payload.buildDiscoveryWebhookPayload(
    makeInput({ mergedUserProfile: MERGED_USER_PROFILE }),
  );
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.mergedUserProfile, MERGED_USER_PROFILE);
  assert.doesNotMatch(
    JSON.stringify(result.mergedUserProfile),
    /resumeText|extractedText/,
  );
});

test("F1C-DISC05-GW: grounded-web opt-out is serialized on discoveryProfile", () => {
  const result = payload.buildDiscoveryWebhookPayload(
    makeInput({
      discoveryProfile: {
        ...makeInput().discoveryProfile,
        groundedWebEnabled: false,
      },
    }),
  );
  assert.equal(result.discoveryProfile.groundedWebEnabled, false);
});

test("F1C-DISC03-INTENT: shared effective intent is not blank_intent when searchPlan carries roles", () => {
  const intent = require("../discovery-effective-intent.js");
  const effective = intent.buildEffectiveIntent({
    discoveryProfile: {
      targetRoles: "",
      keywordsInclude: "",
      searchPlan: {
        query: {
          targetRoles: "Platform Engineer",
          keywordsInclude: "typescript",
        },
      },
    },
    mergedUserProfile: null,
  });
  assert.equal(effective.blank, false);
  assert.equal(effective.reason, undefined);
  assert.ok(effective.targetRoles.includes("Platform Engineer"));
  assert.equal(effective.intentContractVersion, 1);
});

test("F1C-DISC03-INTENT: master Fit Profile targetRoles are not blank_intent", () => {
  const intent = require("../discovery-effective-intent.js");
  const effective = intent.buildEffectiveIntent({
    discoveryProfile: { targetRoles: "", keywordsInclude: "" },
    mergedUserProfile: MERGED_USER_PROFILE,
  });
  assert.equal(effective.blank, false);
  assert.ok(effective.targetRoles.includes("Staff backend engineer"));
});

test("F1C-DISC04-BLOCK: per-run blocklist is subtracted from ATS and normal pools", () => {
  const intent = require("../discovery-effective-intent.js");
  const companies = [
    { name: "Stripe", companyKey: "stripe" },
    { name: "Acme Holdings", companyKey: "acme-holdings" },
  ];
  const atsCompanies = [
    { name: "Linear", companyKey: "linear" },
    { name: "Acme Holdings", companyKey: "acme-holdings" },
  ];
  const resolved = intent.resolveEffectiveCompanyPools({
    companies,
    atsCompanies,
    companyHistory: [],
    negativeCompanyKeys: [],
    companyAllowlist: [],
    companyBlocklist: ["Acme Holdings"],
  });
  assert.deepEqual(
    resolved.companies.map((c) => c.companyKey),
    ["stripe"],
  );
  assert.deepEqual(
    resolved.atsCompanies.map((c) => c.companyKey),
    ["linear"],
  );
});

test("F1C-DISC05-GW: grounded-web opt-out is authoritative in effective-source resolution", () => {
  const intent = require("../discovery-effective-intent.js");
  const sources = intent.resolveEffectiveSources({
    sourcePreset: "browser_plus_ats",
    enabledSources: ["greenhouse", "grounded_web", "serpapi_google_jobs"],
    groundedWebEnabled: false,
  });
  assert.equal(sources.includes("grounded_web"), false);
  assert.ok(sources.includes("greenhouse"));
});

test("F1C-DISC06-ALLOW: unknown-only allowlist does not silently broaden to unrestricted search", () => {
  const intent = require("../discovery-effective-intent.js");
  const catalog = [
    { name: "Notion", companyKey: "notion" },
    { name: "Ramp", companyKey: "ramp" },
  ];
  const resolved = intent.resolveEffectiveCompanyPools({
    companies: catalog,
    atsCompanies: catalog,
    companyHistory: [],
    negativeCompanyKeys: [],
    companyAllowlist: ["unknown-company"],
    companyBlocklist: [],
  });
  assert.equal(resolved.allowlistResolution.mode, "blocked_unresolved");
  assert.deepEqual(resolved.companies, []);
  assert.equal(resolved.allowUnrestrictedFallback, false);
  assert.deepEqual(resolved.allowlistResolution.unknown, ["unknown-company"]);
});

test("F1C-P2-SHEETS: grouped multi-Sheet envelopes round-trip unknown fields", () => {
  const intent = require("../discovery-effective-intent.js");
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
  const next = intent.applySheetConfigMutation(envelope, "sheet_a", {
    companies: [{ name: "Alpha Updated", companyKey: "alpha" }],
  });
  assert.equal(next.extraEnvelopeField, 42);
  assert.equal(next.bySheetId.sheet_a.experimentalFlag, "keep-me");
  assert.equal(next.bySheetId.sheet_a.companies[0].name, "Alpha Updated");
  assert.equal(next.bySheetId.sheet_b.companies[0].name, "Beta");
  assert.equal(next.bySheetId.sheet_b.notes, "other-sheet");
});
