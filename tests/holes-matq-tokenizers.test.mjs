/**
 * HOLES MATQ — M6: short tools and acronyms (SQL, AWS, dbt, GA4, ML, AI, BI)
 * are terms, so the rubric's posting overlap and the claim scorer count them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advisoryEvidence } from "../server/materials-rubric.mjs";
import { outcomeCoverage } from "../server/materials-claim-score.mjs";

const POSTING = "We need SQL, AWS, dbt and GA4 experience.";

/** @param {string} body */
const overlap = (body) => advisoryEvidence({ document: "resume", finalText: body, posting: POSTING })
  .find((item) => item.id === "posting_overlap")?.detail;

describe("M6 short tools are terms", () => {
  it("M6-1 the posting overlap counts SQL, AWS, dbt and GA4", () => {
    assert.equal(overlap("I used SQL, AWS, dbt and GA4 daily."), "4/6 posting terms appear in the document");
    assert.equal(overlap("I enjoy long walks."), "0/6 posting terms appear in the document");
  });

  it("M6-2 claim coverage reads two-letter acronyms", () => {
    assert.equal(outcomeCoverage("Built ML, AI and BI models for finance.", "ML AI BI"), 1);
    assert.equal(outcomeCoverage("Rebuilt the finance close calendar.", "ML AI BI"), 0);
  });
});
