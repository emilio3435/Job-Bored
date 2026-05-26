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
