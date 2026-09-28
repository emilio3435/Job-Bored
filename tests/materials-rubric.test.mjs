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
  it("scores the resume's eight rows 0..2 with a total, max and threshold", () => {
    const { rows, total, max, threshold } = scoreRubric({
      document: "resume",
      extract: EXTRACT,
      selection: SELECTION,
      ledger: LEDGER,
      draft: DRAFT,
      delintSpans: [],
      fill: { ratio: 0.95, basis: "measured" },
    });
    assert.deepEqual(rows.map((r) => r.id), [
      "outcome_coverage", "noun_fidelity", "proof_density", "transfer_honesty",
      "omission_record", "delint_clean", "metric_dropped", "underfill",
    ]);
    for (const row of rows) {
      assert.ok(row.score >= 0 && row.score <= 2, `${row.id} in range`);
      assert.equal(row.max, 2);
    }
    assert.equal(total, rows.reduce((n, r) => n + r.score, 0));
    assert.equal(max, 16);
    assert.equal(threshold, 14, "10 of every 12 points");
    assert.ok(total >= threshold, `strong package scores READY-level: ${total}`);
  });

  it("penalizes invented tools, uncovered outcomes, and dirty delint", () => {
    const bad = scoreRubric({
      document: "resume",
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
    assert.ok(bad.total < bad.threshold);
  });
});

describe("voice v6: letter rows recalibrated for short letters", () => {
  const nouns = ["streaming audio", "podcasts", "ctv", "attribution", "audience targeting", "rich media"].map((term) => ({ term }));
  const score = (text, document = "letter") =>
    scoreRubric({ document, extract: { outcomes: [], nouns }, selection: { kept: [] }, ledger: { claims: [], toolInventory: [] }, draft: document === "letter" ? { letter: { hook: text } } : { statement: text, bullets: [] }, company: "Acme" }).rows;
  const row = (rows, id) => rows.find((r) => r.id === id);

  it("should give a letter full noun marks at 4 posting nouns and one mark at 2", () => {
    assert.equal(row(score("Acme sells streaming audio, podcasts, CTV and attribution."), "noun_fidelity").score, 2);
    assert.equal(row(score("Acme sells streaming audio and podcasts."), "noun_fidelity").score, 1);
    assert.equal(row(score("Acme sells radio."), "noun_fidelity").score, 0);
  });

  it("should keep the resume's noun ratio unchanged", () => {
    assert.equal(row(score("streaming audio, podcasts, CTV and attribution.", "resume"), "noun_fidelity").score, 1, "4 of 6 is under the resume's 0.7 ratio");
  });

  it("should not dock a letter that names no tool, and still zero an invented one", () => {
    assert.equal(row(score("Acme sells radio."), "transfer_honesty").score, 2);
    assert.equal(row(score("Acme sells radio.", "resume"), "transfer_honesty").score, 1);
    assert.equal(row(score("I built it on Kafka for Acme."), "transfer_honesty").score, 0);
  });
});
