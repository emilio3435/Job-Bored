import assert from "node:assert/strict";
import { it } from "node:test";
import * as qa from "../server/materials-qa.mjs";
import { hashRenderedText, JUDGE_PROMPT_VERSION } from "../server/materials-judge.mjs";
import { PIPELINE_PROMPT_VERSION } from "../server/materials-cache.mjs";
import { LEGACY_V1, LEGACY_V2 } from "./fixtures/materials-qa-v3.mjs";
const text = "I built a dispatch forecast. I want to join Acme Robotics.";
const hash = hashRenderedText(text);
const dimensions = ["role_relevance", "evidence_quality", "voice", "coherence", "economy"];
const judgment = (status = "supported", score = 4) => ({ status: "ok", meta: { provider: "openai_compatible", model: "writer-example", promptVersion: "materials-judge-v3" }, judgment: { documents: [{ document: "letter", textHash: hash, ratings: dimensions.map(dimension => ({ dimension, score, reason: "Clear.", sentenceIds: ["L1"] })), sentences: [{ id: "L1", status, reason: "Claim evidence.", citations: [] }, { id: "L2", status: "nonfactual", reason: "A wish.", citations: [] }], issues: [], qualificationGaps: [], coverage: null }] } });
const build = (extra = {}) => qa.buildQaRecord({ document: "letter", runId: "example", finalText: text, textHash: hash, judge: judgment(), ...extra });
it("GRADE-B G1: failed gate wins over perfect ratings and sentence-only FAIL has a reason", () => {
  const record = build({ gates: [{ id: "tool_support", kind: "hard", pass: false, reason: "Unknown tool.", sentenceIds: ["L1"] }] });
  assert.equal(record.disposition, "FAIL");
  assert.equal(record.reasons[0].checkId, "tool_support");
  assert.equal(build({ judge: judgment("unsupported") }).reasons[0].text, "1 claim needs a source");
});
it("GRADE-B G2: built records contain no total or weights", () => {
  const record = build();
  assert.ok(!("quality" in record) && !("dispositionReason" in record));
  assert.ok(record.ratings.every(r => !("weight" in r)));
});
it("GRADE-B G4: disagreement is REVIEW; second outage leaves first verdict; gates still win", () => {
  const first = judgment("unsupported");
  const judge = { ...first, reviews: [{ role: "first", ...first }, { role: "second", ...judgment() }] };
  assert.equal(build({ judge }).disposition, "REVIEW");
  assert.equal(build({ judge }).reasons[0].text, "Reviewers disagree");
  const unavailable = { ...judgment(), reviews: [{ role: "first", ...judgment() }, { role: "second", status: "unavailable", meta: { model: "second-example", errorCode: "timeout" } }] };
  assert.equal(build({ judge: unavailable }).disposition, "READY");
  assert.equal(build({ judge: unavailable }).reviews[1].errorCode, "timeout");
  assert.equal(build({ judge, gates: [{ id: "pdf", kind: "hard", pass: false, reason: "Missing PDF.", sentenceIds: [] }] }).disposition, "FAIL");
});
it("GRADE-B G5: every failed check supplies repair targets and unflagged sentence preserve ids", () => {
  const record = build({ judge: judgment("unsupported") });
  const targets = qa.repairInstructionsFromQa([record]);
  assert.deepEqual(targets[0].sentenceIds, ["L1"]);
  assert.deepEqual(targets[0].preserveSentenceIds, ["L2"]);
});
it("GRADE-B D5: all dimensions below three cause named REVIEW with no total", () => {
  for (const dimension of dimensions) {
    const judge = judgment(); judge.judgment.documents[0].ratings.find(r => r.dimension === dimension).score = 2;
    const record = build({ judge });
    assert.equal(record.disposition, "REVIEW", dimension);
    assert.ok(record.checks.some(c => c.id === `dimension:${dimension}` && c.kind === "dimension"));
  }
  assert.equal(build({ judge: judgment("supported", 3) }).disposition, "READY");
});
it("GRADE-B D6: this document coverage records misses and counts covered requirements", () => {
  const judge = judgment(); judge.judgment.documents[0].coverage = { requirements: [{ id: "req:1", text: "Forecasts", status: "covered", sentenceIds: ["L1"] }, { id: "req:2", text: "Mentoring", status: "missing", sentenceIds: [] }] };
  assert.deepEqual(build({ judge }).coverage, { ...judge.judgment.documents[0].coverage, covered: 1, total: 2 });
  assert.equal(build().coverage, null);
});
it("GRADE-B D4: schema, judge and pipeline versions change and legacy views contain no numeric prose", () => {
  assert.equal(qa.QA_CONTRACT, "materials.qa.v3");
  assert.equal(JUDGE_PROMPT_VERSION, "materials-judge-v3");
  assert.notEqual(PIPELINE_PROMPT_VERSION, "materials.pipeline.mrev.v1");
  for (const source of [LEGACY_V1, LEGACY_V2]) {
    const before = JSON.stringify(source);
    const view = qa.readQaVerdict(source);
    assert.equal(view.legacy, "old_checker");
    assert.equal(view.contract, "materials.qa.v3");
    const served = qa.formatDocumentQaReport({ records: [view] });
    assert.doesNotMatch(served, /\b\d+\s*\/\s*(100|16)\b|Quality score/);
    assert.equal(JSON.stringify(source), before);
  }
});
it("GRADE-B G8: legacy version-recheck stub adapts to not-rescored with no verdict", () => {
  const view = qa.readQaVerdict({ ...LEGACY_V1, rubric: { rows: [{ id: "version_recheck" }] } });
  assert.equal(view.state, "not_rescored"); assert.equal(view.disposition, null);
});
it("GRADE-B D4: legacy nested reasons cannot expose a stored total", () => {
  const source = structuredClone(LEGACY_V2);
  source.gates[0].reason = "Quality score 100/100";
  source.sentences[0].reason = "Overall score 87 of 100";
  source.issues = [{ id: "i1", kind: "fact", severity: "hard", action: "rewrite", reason: "Scored 100/100", sentenceIds: ["L1"] }];
  const before = JSON.stringify(source);
  assert.doesNotMatch(JSON.stringify(qa.readQaVerdict(source)), /100\/100|87 of 100/);
  assert.equal(JSON.stringify(source), before);
});
