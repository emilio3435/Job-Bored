import assert from "node:assert/strict";
import { it } from "node:test";
import { buildQaRecord } from "../server/materials-qa.mjs";
import { hashRenderedText, judgeMaterials, splitSentences } from "../server/materials-judge.mjs";
import { advisoryEvidence, runHardGates } from "../server/materials-rubric.mjs";

const dimensions = ["role_relevance", "evidence_quality", "voice", "coherence", "economy"];
const validDraft = { contract: "materials.draft.v2", jdHash: "sha256:0", ledgerHash: "sha256:0", statement: "", bullets: [], letter: { hook: "", companyInsight: "", proof1: "", proof2: "", ask: "" } };

function judgeFor(text, { status = "supported", roleScore = 4, voiceScore = 4, sourceId = "claim:1", quote = "dispatch forecast" } = {}) {
  const sentences = splitSentences(text, "letter");
  return { status: "ok", meta: { provider: "openai_compatible", model: "grok-example", independent: true, promptVersion: "v1", latencyMs: 1 }, judgment: {
    contract: "materials.judge.v1", documents: [{ document: "letter", textHash: hashRenderedText(text),
      ratings: dimensions.map((dimension) => ({ dimension, score: dimension === "role_relevance" ? roleScore : dimension === "voice" ? voiceScore : 4, reason: "Assessed.", sentenceIds: sentences.map((sentence) => sentence.id) })),
      sentences: sentences.map((sentence) => ({ id: sentence.id, status, reason: status === "unsupported" ? "No claim supports the result." : "The claim supports this.", citations: status === "supported" ? [{ sourceId, quote }] : [] })),
      issues: [], qualificationGaps: [],
    }],
  } };
}

function verdict(text, ledger, judge = judgeFor(text)) {
  return buildQaRecord({ document: "letter", runId: "fictional-run", finalText: text, textHash: hashRenderedText(text),
    gates: runHardGates({ document: "letter", finalText: text, ledger, draft: validDraft }), judge });
}

it("A1: a tool supported after claim 40 cannot FAIL; an absent tool still FAILs", () => {
  const claims = Array.from({ length: 40 }, (_, index) => ({ id: `claim-${index + 1}`, text: `Built workflow ${index + 1}.` }));
  claims.push({ id: "claim-41", text: "Used Gemini for the dispatch forecast." });
  assert.equal(verdict("I used Gemini for the dispatch forecast.", { claims }).disposition, "READY");
  assert.equal(verdict("I used Kafka for the dispatch forecast.", { claims }).disposition, "FAIL");
});

it("A2: semantic support with a real claim clears lexical noise; missing or unknown evidence cannot make READY", async () => {
  const text = "I built a route forecasting model for dispatch.";
  const ledger = { claims: [{ id: "claim:1", text: "Created dispatch predictions based on driver logs." }] };
  const source = { posting: [{ id: "posting:1", text: "Fictional Labs seeks route forecasting." }], claims: ledger.claims, voice: "Use direct prose.", research: [] };
  const pin = { provider: "openai_compatible", model: "judge-example", apiKey: "example-key", baseUrl: "https://api.x.ai/v1" };
  const judgeWith = async (reply) => judgeMaterials({ writer: pin,
    documents: [{ document: "letter", text, textHash: hashRenderedText(text), sentences: splitSentences(text, "letter") }], sources: source,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply.judgment) } }] }) }),
  });
  const grounded = await judgeWith(judgeFor(text, { quote: "dispatch predictions based on driver logs" }));
  assert.equal(grounded.status, "ok");
  assert.equal(verdict(text, ledger, grounded).disposition, "READY");
  const missing = judgeFor(text, { quote: "dispatch predictions based on driver logs" });
  missing.judgment.documents[0].sentences[0].citations = [];
  assert.equal(verdict(text, ledger, await judgeWith(missing)).disposition, "REVIEW");
  const unknown = judgeFor(text, { sourceId: "claim:missing", quote: "dispatch predictions based on driver logs" });
  assert.equal(verdict(text, ledger, await judgeWith(unknown)).disposition, "REVIEW");
  assert.equal(verdict(text, ledger, judgeFor(text, { status: "unsupported" })).disposition, "FAIL");
});

it("A3: one plain instead of is advisory only; a factual hard failure still FAILs", () => {
  const text = "I built a dispatch forecast instead of another spreadsheet.";
  const ledger = { claims: [{ id: "claim:1", text: "Built a dispatch forecast." }] };
  assert.equal(verdict(text, ledger).disposition, "READY");
  assert.ok(!advisoryEvidence({ document: "letter", finalText: text, ledger }).some((item) => /instead of/i.test(item.detail)));
  assert.equal(verdict(text, ledger, judgeFor(text, { status: "unsupported" })).disposition, "FAIL");
});

it("A4: posting overlap follows rendered prose and mismatched mapsTo labels never hard-fail", () => {
  const ledger = { claims: [{ id: "claim:1", text: "Built dispatch reporting and driver forecasting." }] };
  const posting = "Fictional Labs needs dispatch reporting and driver forecasting.";
  const selection = { kept: [{ claimId: "claim:1", mapsTo: ["unrelated-outcome-id"] }] };
  const covered = "I built dispatch reporting and driver forecasting.";
  const absent = "I can discuss the position.";
  const overlap = (text) => advisoryEvidence({ document: "letter", finalText: text, ledger, posting, selection })
    .find((item) => item.id === "posting_overlap")?.detail;
  assert.ok(Number(overlap(covered)?.split("/")[0]) > Number(overlap(absent)?.split("/")[0]));
  const gates = runHardGates({ document: "letter", finalText: covered, draft: validDraft, ledger, posting, selection });
  const matched = runHardGates({ document: "letter", finalText: covered, draft: validDraft, ledger, posting,
    selection: { kept: [{ claimId: "claim:1", mapsTo: ["matching-outcome-id"] }] } });
  assert.deepEqual(gates, matched);
  assert.equal(gates.some((gate) => gate.kind === "hard" && /coverage|mapsTo/i.test(gate.id)), false);
  const qaFor = (checks) => buildQaRecord({ document: "letter", runId: "fictional-run", finalText: covered,
    textHash: hashRenderedText(covered), gates: checks, judge: { status: "unavailable", meta: {} } });
  assert.equal(qaFor(gates).disposition, qaFor(matched).disposition);
  assert.equal(qaFor(gates).disposition, "REVIEW");
});
