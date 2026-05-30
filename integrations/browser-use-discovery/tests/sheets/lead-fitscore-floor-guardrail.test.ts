/**
 * Permanent guardrail against the keyword-floor regression.
 *
 * History: prior to 04f7d7a, lead-normalizer.ts did
 *   effectiveFitScore = Math.max(keywordScore, llmScore)
 * which inflated listings the LLM had honestly judged as junior or
 * wrong-industry up to 7-10 whenever the run-config keywords appeared in
 * the description. Validation against the live 243-row sheet showed mean
 * fitScore 8.14 → 4.42 once the floor was removed.
 *
 * This test asserts the floor cannot silently come back: any listing the
 * LLM rates ≤ 2 (junior IC, wrong-industry, closed listing, etc.) must
 * not surface as fitScore > 4, no matter how aggressively the run-config
 * keyword counter would have scored it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { normalizeLead } from "../../src/normalize/lead-normalizer.ts";
import type { LlmFitScoreResult } from "../../src/contracts/user-profile.ts";

function makeCannedCache(canned: LlmFitScoreResult) {
  return {
    get: () => canned,
    put: () => undefined,
    getBreakdown: () => null,
    putBreakdown: () => undefined,
    close: () => undefined,
  };
}

function makeRunMaxKeywordsWithProfile(cannedScore: LlmFitScoreResult) {
  return {
    runId: "run_floor_guardrail",
    trigger: "manual" as const,
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_guardrail",
      variationKey: "var_guardrail",
      requestedAt: "2026-05-30T00:00:00.000Z",
    },
    config: {
      sheetId: "sheet_guardrail",
      mode: "hosted",
      timezone: "UTC",
      companies: [],
      // Pile in broad include keywords + target roles so scoreLead() would
      // return 10 if it were ever re-introduced as a floor.
      includeKeywords: [
        "marketing", "digital", "AI", "performance", "growth", "strategy",
        "automation", "platform", "consulting",
      ],
      excludeKeywords: [],
      targetRoles: [
        "Director", "Manager", "Lead", "Senior", "Head of", "Principal",
      ],
      locations: ["Remote", "Denver", "Philadelphia"],
      remotePolicy: "remote-first" as const,
      seniority: "senior" as const,
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      variationKey: "var_guardrail",
      requestedAt: "2026-05-30T00:00:00.000Z",
      userProfile: {
        version: 1,
        identity: {
          targetRoles: ["AI Solutions Architect", "Director, AI/GTM"],
          targetSeniority: "ic_staff",
          primaryNarrative:
            "AI product builder and digital marketing strategist pivoting to AI-forward roles.",
        },
        strengths: [
          { name: "AI/LLM systems", rank: 1 },
          { name: "performance marketing", rank: 2 },
        ],
        hardConstraints: { workMode: "any" },
      },
      runtimeConfig: {
        geminiApiKey: "test-key",
        geminiModel: "gemini-3.5-flash",
      },
      listingScoreCache: makeCannedCache(cannedScore),
    },
  };
}

test(
  "guardrail: junior SDR listing with broad keyword match cannot inflate above ~4 when LLM rates it 2",
  async () => {
    // Modeled on the live sheet's Cardwell Beach row: an SDR title that hits
    // many include-keywords ("digital", "marketing") but is junior-IC quota
    // sales — exactly the listings that used to floor-bump to 8+.
    const cannedJunior: LlmFitScoreResult = {
      fitScore: 2,
      band: "Low",
      perStrength: [
        { name: "AI/LLM systems", score: 0, rationale: "No AI scope." },
        { name: "performance marketing", score: 2, rationale: "Pure quota sales." },
      ],
      concerns: [
        "Junior IC / SDR role — outside target seniority.",
        "Pure quota sales — explicitly avoided.",
      ],
      matches: [],
      rationale: "Wrong seniority + wrong work type.",
    };
    const listing = {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Sales Development Representative - Digital Marketing",
      company: "Cardwell Beach",
      location: "Remote",
      url: "https://jobs.example.com/sdr-digital-marketing",
      compensationText: "$50k base + commission",
      descriptionText:
        "Drive top-of-funnel growth as an SDR on our digital marketing team. " +
        "Senior leadership runs strategy; you'll prospect, qualify, and book meetings.",
    };
    const run = makeRunMaxKeywordsWithProfile(cannedJunior);
    const lead = await normalizeLead(listing, run);
    assert.ok(lead, "expected listing to produce a lead");
    assert.ok(
      (lead?.fitScore || 0) <= 4,
      `Guardrail breach: fitScore=${lead?.fitScore} but LLM rated this junior role 2. ` +
        "The keyword-floor (Math.max) bug is likely back somewhere in the pipeline.",
    );
    // Stronger assertion: the LLM score must round-trip exactly.
    assert.equal(lead?.fitScore, 2, "LLM's 2 should be the final fitScore.");
  },
);

test(
  "guardrail: wrong-industry director with broad keyword match cannot inflate above ~4 when LLM rates it 1",
  async () => {
    // Modeled on the live sheet's Amcor row: senior-sounding director title
    // in a completely off-target industry. Keyword counter matches heavily on
    // the title's "Director" + content-level marketing terms, but the LLM
    // correctly rates it 1.
    const cannedWrongIndustry: LlmFitScoreResult = {
      fitScore: 1,
      band: "Low",
      perStrength: [
        { name: "AI/LLM systems", score: 0, rationale: "Packaging industry, no AI." },
        { name: "performance marketing", score: 0, rationale: "Enterprise account sales." },
      ],
      concerns: [
        "Packaging manufacturing — outside target domain.",
        "Enterprise account management, not marketing or AI building.",
      ],
      matches: [],
      rationale: "Complete industry + role-type mismatch.",
    };
    const listing = {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      title: "Global Key Account Director, Private Label",
      company: "Amcor",
      location: "Remote",
      url: "https://jobs.example.com/amcor-kad",
      compensationText: "$180k-$220k",
      descriptionText:
        "Senior director-level role managing strategic accounts across our " +
        "packaging platform. Drive growth across enterprise customers.",
    };
    const run = makeRunMaxKeywordsWithProfile(cannedWrongIndustry);
    const lead = await normalizeLead(listing, run);
    assert.ok(lead, "expected listing to produce a lead");
    assert.ok(
      (lead?.fitScore || 0) <= 4,
      `Guardrail breach: fitScore=${lead?.fitScore} but LLM rated this wrong-industry role 1. ` +
        "The keyword-floor (Math.max) bug is likely back somewhere in the pipeline.",
    );
    assert.equal(lead?.fitScore, 1, "LLM's 1 should be the final fitScore.");
  },
);
