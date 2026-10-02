/**
 * HOLES MATQ — M12: the ATS overall score is computed from the five
 * dimension scores, the scorecard names the document version it scored
 * (docHash) and the scoring run (runId), and evidence whose snippet is not
 * in the scored document is dropped.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { analyzeAtsScorecard } from "../server/ats-scorecard.mjs";

const DOC_TEXT = [
  "Dear hiring team,",
  "I shipped React growth surfaces that lifted trial conversion by 19%.",
  "At Example Co I own the analytics   pipeline end to end.",
].join("\n");

const ENV = {
  ATS_PROVIDER: "openai",
  ATS_OPENAI_API_KEY: "sk-test-example",
  ATS_OPENAI_MODEL: "gpt-test",
};
const ENV_KEYS = [...Object.keys(ENV), "OPENAI_API_KEY", "ATS_GEMINI_API_KEY", "GEMINI_API_KEY"];

let saved;
let pinDir;
let originalFetch;
beforeEach(async () => {
  saved = Object.fromEntries([...ENV_KEYS, "JOBBORED_LLM_CONFIG_PATH"].map((key) => [key, process.env[key]]));
  pinDir = await mkdtemp(join(tmpdir(), "jb-matq-ats-"));
  process.env.JOBBORED_LLM_CONFIG_PATH = join(pinDir, "llm.json");
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, ENV);
  originalFetch = globalThis.fetch;
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(pinDir, { recursive: true, force: true });
});

const DIMENSIONS = { requirementsCoverage: 70, experienceRelevance: 80, impactClarity: 75, atsParseability: 88, toneFit: 82 };

function modelReply(overrides = {}) {
  return {
    schemaVersion: 1,
    overallScore: 100,
    dimensionScores: DIMENSIONS,
    topStrengths: ["React growth work"],
    criticalGaps: [],
    evidence: [
      { claim: "Quantified impact", sourceSnippet: "lifted trial conversion by 19%", sourceType: "cover_letter" },
      { claim: "Owns analytics", sourceSnippet: "I own the analytics pipeline...", sourceType: "cover_letter" },
      { claim: "Invented leadership", sourceSnippet: "Led a team of 40 engineers", sourceType: "cover_letter" },
      { claim: "Posting asks for SQL", sourceSnippet: "Strong SQL fundamentals", sourceType: "job" },
    ],
    rewriteSuggestions: [],
    confidence: 0.8,
    model: "gpt-test",
    ...overrides,
  };
}

/** @param {Record<string, unknown>} reply */
function stubProvider(reply) {
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const payload = () => ({
  event: "command-center.ats-scorecard",
  schemaVersion: 1,
  feature: "cover_letter",
  docText: DOC_TEXT,
  job: { title: "Growth Engineer", company: "Example Co", postingEnrichment: { description: "Strong SQL fundamentals. React." } },
});

describe("M12 the ATS score is computed, versioned and grounded", () => {
  it("M12-1 overallScore is the rounded mean of the dimension scores, not the model's own number", async () => {
    stubProvider(modelReply());
    const card = await analyzeAtsScorecard(payload());
    assert.equal(card.overallScore, 79);
    assert.equal(card.overallScoreSource, "dimensions");
  });

  it("M12-2 with no dimension scores the model's number is kept and labelled as such", async () => {
    stubProvider(modelReply({ dimensionScores: null, overallScore: 64 }));
    const card = await analyzeAtsScorecard(payload());
    assert.equal(card.overallScore, 64);
    assert.equal(card.overallScoreSource, "model");
  });

  it("M12-3 the scorecard carries the scored document's hash and its own run id", async () => {
    stubProvider(modelReply());
    const first = await analyzeAtsScorecard(payload());
    const second = await analyzeAtsScorecard(payload());
    assert.equal(first.docHash, `sha256:${createHash("sha256").update(DOC_TEXT).digest("hex")}`);
    assert.match(first.runId, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(first.runId, second.runId);
  });

  it("M12-4 evidence whose snippet is not in the scored document is dropped", async () => {
    stubProvider(modelReply());
    const card = await analyzeAtsScorecard(payload());
    assert.deepEqual(card.evidence.map((item) => item.claim), ["Quantified impact", "Owns analytics"]);
  });

  it("M12-5 the response, new fields included, validates against the response schema", async () => {
    stubProvider(modelReply());
    const card = await analyzeAtsScorecard(payload());
    const schema = JSON.parse(readFileSync(new URL("../schemas/ats-scorecard-response.v1.schema.json", import.meta.url), "utf8"));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    assert.equal(validate(card), true, JSON.stringify(validate.errors));
    assert.ok(Number.isInteger(card.overallScore) && card.overallScore >= 0 && card.overallScore <= 100);
  });
});
