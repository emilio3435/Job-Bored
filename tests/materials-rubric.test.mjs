import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreRubric } from "../server/materials-rubric.mjs";

const EXTRACT = {
  jdHash: "sha256:1",
  outcomes: [
    { id: "o1", text: "Own pipeline math", weight: 0.9 },
    { id: "o2", text: "Ship streaming ingestion", weight: 0.8 },
  ],
  nouns: [
    { term: "pipeline", weight: 1.0 },
    { term: "streaming", weight: 0.9 },
    { term: "ingestion", weight: 0.8 },
    { term: "warehouse", weight: 0.7 },
  ],
  stack: { required: ["Kafka", "Postgres"], preferred: [] },
};

const LEDGER = {
  ledgerHash: "sha256:2",
  employers: [
    { id: "northwind", name: "Northwind" },
    { id: "example-app", name: "Example App" },
  ],
  claims: [
    { id: "resume-b1", text: "Owned pipeline math.", metrics: [{ token: "30%" }], tools: [] },
    { id: "resume-b2", text: "Shipped streaming ingestion with Kafka.", metrics: [], tools: ["Kafka"] },
  ],
  toolInventory: [{ tool: "Kafka", level: "owned", evidence: "resume-b2", transferFrom: [] }],
};

const SELECTION = {
  kept: [
    { claimId: "resume-b1", mapsTo: ["o1", "pipeline"] },
    { claimId: "resume-b2", mapsTo: ["o2", "streaming", "ingestion"] },
  ],
  omittedEmployers: [{ employerId: "example-app", reason: "not featured", justified: true }],
};

const DRAFT = {
  statement: "Platform engineer for pipeline and streaming work.",
  bullets: [
    { claimId: "resume-b1", text: "Owned pipeline math, lifting quality 30%." },
    { claimId: "resume-b2", text: "Shipped streaming ingestion with Kafka for the warehouse." },
  ],
  earlier: [],
  letter: { thesis: "t", analyticsProof: "a", aiOpsProof: "o", nextStep: "n" },
};

describe("materials rubric (slice 5)", () => {
  it("scores six rows 0..2 with a total", () => {
    const { rows, total } = scoreRubric({ extract: EXTRACT, selection: SELECTION, ledger: LEDGER, draft: DRAFT, delintSpans: [] });
    assert.equal(rows.length, 6);
    for (const row of rows) {
      assert.ok(row.score >= 0 && row.score <= 2, `${row.id} in range`);
      assert.equal(row.max, 2);
    }
    assert.equal(total, rows.reduce((n, r) => n + r.score, 0));
    assert.ok(total >= 10, `strong package scores READY-level: ${total}`);
  });

  it("penalizes invented tools, uncovered outcomes, and dirty delint", () => {
    const bad = scoreRubric({
      extract: EXTRACT,
      selection: { kept: [{ claimId: "resume-b1", mapsTo: ["o1"] }], omittedEmployers: [] },
      ledger: LEDGER,
      draft: {
        ...DRAFT,
        bullets: [{ claimId: "resume-b1", text: "Owned pipeline math with Flink and Spark." }],
      },
      delintSpans: [{ code: "banned_filler", severity: "fail", field: "statement" }],
    });
    const byId = Object.fromEntries(bad.rows.map((r) => [r.id, r]));
    assert.equal(byId.transfer_honesty.score, 0);
    assert.ok(byId.outcome_coverage.score <= 1);
    assert.equal(byId.delint_clean.score, 0);
    assert.ok(bad.total < 10);
  });
});
