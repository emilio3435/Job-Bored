// HOLES KEEP R7: every Fit Score carries its scorer (column AA, Scorer), and
// a score that is not from an LLM never replaces one that is.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import type { LlmFitScoreResult } from "../../src/contracts/user-profile.ts";
import { normalizeLead } from "../../src/normalize/lead-normalizer.ts";
import { createPipelineWriter } from "../../src/sheets/pipeline-writer.ts";
import { HEADER, createFakeSheets, lead, pipelineRow, runtimeConfig } from "./fake-sheets.ts";

const SCORER = 26;
const URL_1 = "https://boards.greenhouse.io/acme/jobs/1";

function existingRow(fields: Record<string, string>, scorer: string): string[] {
  const row = pipelineRow({ title: "Engineer", company: "Acme", location: "Remote", link: URL_1, ...fields });
  row[SCORER] = scorer;
  return row;
}

async function rediscover(existing: string[], incoming: Record<string, unknown>) {
  const sheet = createFakeSheets({ Pipeline: [HEADER, existing] });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, retries: 0 });
  const result = await writer.write("sheet_1", [lead({ url: URL_1, ...incoming })]);
  assert.equal(result.updated, 1);
  return sheet.tabs.get("Pipeline")![1];
}

test("R7: a heuristic re-run never replaces an LLM Fit Score, its assessment or its scorer", async () => {
  const row = await rediscover(
    existingRow({ fit: "8", fitAssessment: "LLM: strong backend fit" }, "llm:gemini-flash"),
    { fitScore: 4, fitAssessment: "heuristic says weak", scorer: "heuristic", logoUrl: "https://logo.example/acme.png" },
  );
  assert.equal(row[7], "8");
  assert.equal(row[10], "LLM: strong backend fit");
  assert.equal(row[SCORER], "llm:gemini-flash");
  assert.equal(row[19], "https://logo.example/acme.png", "other discovery-owned cells still refresh");
});

test("R7: a placeholder score with no scorer never replaces an LLM score", async () => {
  const row = await rediscover(
    existingRow({ fit: "9", fitAssessment: "LLM: exceptional" }, "llm:gpt-5"),
    { fitScore: 5, fitAssessment: "", scorer: undefined },
  );
  assert.equal(row[7], "9");
  assert.equal(row[SCORER], "llm:gpt-5");
});

test("R7: an LLM score replaces a heuristic one and records its model", async () => {
  const row = await rediscover(
    existingRow({ fit: "4", fitAssessment: "heuristic says weak" }, "heuristic"),
    { fitScore: 9, fitAssessment: "LLM: exceptional", scorer: "llm:gemini-flash" },
  );
  assert.equal(row[7], "9");
  assert.equal(row[10], "LLM: exceptional");
  assert.equal(row[SCORER], "llm:gemini-flash");
});

test("R7: a heuristic score replaces only an explicitly heuristic one, and says so", async () => {
  for (const before of ["heuristic"]) {
    const row = await rediscover(existingRow({ fit: "4" }, before), { fitScore: 6, scorer: "heuristic" });
    assert.equal(row[7], "6", `scorer before: ${before || "(blank)"}`);
    assert.equal(row[SCORER], "heuristic");
  }
});

test("R7: an appended lead records its scorer", async () => {
  const sheet = createFakeSheets({ Pipeline: [HEADER] });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, retries: 0 });
  await writer.write("sheet_1", [lead({ scorer: "llm:gemini-flash" })]);
  assert.equal(sheet.tabs.get("Pipeline")![1][SCORER], "llm:gemini-flash");
});

function makeRun(withProfile: boolean) {
  const canned: LlmFitScoreResult = {
    fitScore: 7,
    band: "Strong",
    perStrength: [],
    concerns: [],
    matches: [],
    rationale: "LLM fit.",
  } as LlmFitScoreResult;
  return {
    runId: "run_r7",
    trigger: "manual" as const,
    request: {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: "sheet_1",
      variationKey: "v",
      requestedAt: "2026-10-01T12:00:00.000Z",
    },
    config: {
      sheetId: "sheet_1",
      mode: "hosted",
      timezone: "UTC",
      companies: [{ name: "Acme" }],
      includeKeywords: [],
      excludeKeywords: [],
      targetRoles: ["Platform Engineer"],
      locations: ["Remote"],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      variationKey: "v",
      requestedAt: "2026-10-01T12:00:00.000Z",
      ...(withProfile
        ? {
            userProfile: {
              version: 1,
              identity: { targetRoles: ["Staff Engineer"], targetSeniority: "ic_staff", primaryNarrative: "x" },
              strengths: [{ name: "backend systems", rank: 1 }],
              hardConstraints: { workMode: "any" },
            },
            runtimeConfig: { geminiApiKey: "test-key", geminiModel: "gemini-3.5-flash" },
            listingScoreCache: {
              get: () => canned,
              put: () => undefined,
              getBreakdown: () => null,
              putBreakdown: () => undefined,
              close: () => undefined,
            },
          }
        : {}),
    },
  } as never;
}

const LISTING = {
  sourceId: "greenhouse",
  sourceLabel: "Greenhouse",
  title: "Senior Platform Engineer",
  company: "Acme",
  location: "Remote",
  url: "https://jobs.example.com/role-1",
  descriptionText: "Build platform services.",
};

test("R7: lead-normalizer names the scorer it used", async () => {
  const llm = await normalizeLead(LISTING, makeRun(true));
  assert.match(String(llm?.scorer), /^llm:gemini-3\.5-flash$/);
  const heuristic = await normalizeLead(LISTING, makeRun(false));
  assert.equal(heuristic?.scorer, "heuristic");
});

test("R7: under a custom AA header, re-discovery leaves the user's AA cell alone", async () => {
  const header = [...HEADER];
  header[SCORER] = "My notes";
  const existing = existingRow({ fit: "6" }, "call the recruiter Tuesday");
  const sheet = createFakeSheets({ Pipeline: [header, existing] });
  const writer = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, retries: 0 });
  await writer.write("sheet_1", [lead({ url: URL_1, fitScore: 8, scorer: "llm:gemini-flash" })]);
  const row = sheet.tabs.get("Pipeline")![1];
  assert.equal(row[7], "8");
  assert.equal(row[SCORER], "call the recruiter Tuesday");
});

for (const incomingScorer of ["heuristic", "prefilter", undefined]) {
  test(`R7 review: a filled legacy score with blank AA survives ${incomingScorer || "placeholder"}`, async () => {
    const row = await rediscover(existingRow({ fit: "8", fitAssessment: "Existing assessment" }, ""),
      { fitScore: 1, fitAssessment: "Fallback assessment", scorer: incomingScorer });
    assert.equal(row[7], "8");
    assert.equal(row[10], "Existing assessment");
    assert.equal(row[SCORER], "");
  });
}

test("R7 review: an LLM may replace a legacy score with blank AA", async () => {
  const row = await rediscover(existingRow({ fit: "8" }, ""), { fitScore: 6, scorer: "llm:new-model" });
  assert.equal(row[7], "6");
  assert.equal(row[SCORER], "llm:new-model");
});

test("R7 review: an empty H can receive its first heuristic score", async () => {
  const row = await rediscover(existingRow({ fit: "" }, ""), { fitScore: 6, scorer: "heuristic" });
  assert.equal(row[7], "6");
  assert.equal(row[SCORER], "heuristic");
});

test("R7 review: a custom AA cannot authorize a heuristic overwrite", async () => {
  const header = [...HEADER]; header[SCORER] = "My notes";
  const sheet = createFakeSheets({ Pipeline: [header, existingRow({ fit: "8", fitAssessment: "Existing assessment" }, "heuristic")] });
  await createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl, retries: 0 }).write("sheet_1", [lead({ fitScore: 1, scorer: "heuristic" })]);
  assert.equal(sheet.tabs.get("Pipeline")![1][7], "8");
  assert.equal(sheet.tabs.get("Pipeline")![1][10], "Existing assessment");
});
