/**
 * HOLES MATQ — M4: a number written out in words is still a number, and a
 * résumé line may only use its own claim's numbers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criticHardChecks } from "../server/materials-critic.mjs";
import { extractMetrics } from "../server/materials-ledger-build.mjs";
import { numerals, tagDraftMetrics } from "../server/materials-metric-tag.mjs";

const LEDGER = {
  employers: [{ id: "e1", name: "Northwind" }, { id: "e2", name: "Contoso Media" }],
  claims: [
    { id: "c1", employerId: "e1", text: "Grew revenue 20% across the Austin book.", metrics: [{ token: "20%" }] },
    { id: "c2", employerId: "e2", text: "Grew the book to $10M+.", metrics: [{ token: "$10M+" }] },
    { id: "c3", employerId: "e1", text: "Raised $3M in partner funding.", metrics: [{ token: "$3M" }] },
    { id: "c4", employerId: "e1", text: "Grew paid search 40% year over year.", metrics: [{ token: "40%" }] },
    { id: "c5", employerId: "e1", text: "Hired 5 reps for the new desk.", metrics: [{ token: "5" }] },
    { id: "c6", employerId: "e1", text: "Grew pipeline 2x in one year.", metrics: [{ token: "2x" }] },
  ],
};

/** @param {{ claimId: string, text: string }} bullet @param {Array<{ sentence: string, claimIds: string[] }>} [sourceRefs] */
function check(bullet, sourceRefs = []) {
  const results = criticHardChecks({ document: "resume", draft: { statement: "", bullets: [bullet], earlier: [] }, ledger: LEDGER, sourceRefs, finalText: bullet.text });
  return Object.fromEntries(results.map((result) => [result.id, result.pass]));
}

describe("M4 spelled-out numbers are checked like digits", () => {
  it("M4-1 numerals reads spelled-out percents, money, multiples and counts", () => {
    assert.deepEqual(numerals("Grew revenue forty percent."), ["40%"]);
    assert.deepEqual(numerals("Raised three million dollars."), ["$3M"]);
    assert.deepEqual(numerals("Raised $3 million and grew 40 percent."), ["$3M", "40%"]);
    assert.deepEqual(numerals("Tripled pipeline and hired a dozen reps."), ["3x", "12"]);
    assert.deepEqual(numerals("Hired twenty-five sellers."), ["25"]);
  });

  it("M4-2 ordinary prose with number words yields no numerals", () => {
    assert.deepEqual(numerals("One of the first hires; worked as one team on a one-on-one cadence for two years."), []);
  });

  it("M4-3 a spelled-out figure the claim does not carry fails both gates", () => {
    const result = check({ claimId: "c1", text: "Grew revenue forty percent across the Austin book." });
    assert.equal(result.metric_mismatch, false);
    assert.equal(result.invented_fact, false);
  });

  it("M4-4 a spelled-out figure the claim carries passes", () => {
    assert.equal(check({ claimId: "c3", text: "Raised three million dollars in partner funding." }).metric_mismatch, true);
    assert.equal(check({ claimId: "c4", text: "Grew paid search 40 percent year over year." }).metric_mismatch, true);
    assert.equal(check({ claimId: "c5", text: "Hired five reps for the new desk." }).metric_mismatch, true);
    assert.equal(check({ claimId: "c6", text: "Doubled pipeline in one year." }).metric_mismatch, true);
  });

  it("M4-5 an exaggerated multiple or count fails", () => {
    assert.equal(check({ claimId: "c6", text: "Tripled pipeline in one year." }).metric_mismatch, false);
    assert.equal(check({ claimId: "c5", text: "Hired a dozen reps for the new desk." }).metric_mismatch, false);
  });

  it("M4-6 the ledger reads spelled-out figures in claims, so drafts can trace them", () => {
    assert.deepEqual(extractMetrics("Cut churn forty percent and raised $3 million.").map((metric) => metric.token), ["40%", "$3M"]);
  });
});

describe("M4 a résumé line uses only its own claim's numbers", () => {
  it("M4-7 a writer sourceRef cannot lend a bullet another claim's metric", () => {
    const text = "Grew the book to $10M+.";
    const result = check({ claimId: "c1", text }, [{ sentence: text, claimIds: ["c2"] }]);
    assert.equal(result.metric_mismatch, false);
  });

  it("M4-8 an earlier line that borrows another claim's number is metric_borrowed", () => {
    const { issues } = tagDraftMetrics({ draft: { statement: "", bullets: [], earlier: [{ claimId: "c1", text: "Grew the book to $10M+." }] }, ledger: LEDGER });
    assert.deepEqual(issues.map((issue) => issue.code), ["metric_borrowed"]);
  });
});

describe("M4 spelled figures are read without inventing any (review round)", () => {
  it("M4-9 durations and proper nouns never become counts", () => {
    for (const text of ["ten years leading teams", "six months onboarding clients", "oversaw Four Seasons properties", "advised Big Four clients", "sold across Six Flags locations"]) {
      assert.deepEqual(numerals(text), [], text);
    }
    assert.deepEqual(numerals("Twelve reps joined the desk."), ["12"]);
  });

  it("M4-10 idioms with doubled are not multiples", () => {
    assert.deepEqual(numerals("Doubled as interim manager."), []);
    assert.deepEqual(numerals("Doubled-down on partnerships."), []);
    assert.deepEqual(numerals("Doubled in size within a year."), ["2x"]);
  });

  it("M4-11 dozens and hundreds read at their value", () => {
    assert.deepEqual(numerals("Handled half a dozen accounts."), ["6"]);
    assert.deepEqual(numerals("Hired two dozen reps."), ["24"]);
    assert.deepEqual(numerals("Signed fifteen hundred users."), ["1500"]);
  });

  it("M4-12 tagDraftMetrics compares figures by value, so five thousand traces to 5,000", () => {
    const { issues } = tagDraftMetrics({ draft: { statement: "Grew to five thousand subscribers." }, ledger: { claims: [{ id: "c1", metrics: [{ token: "5,000" }] }] } });
    assert.deepEqual(issues, []);
  });

  it("M4-13 a long comma run reads in linear time", () => {
    const started = Date.now();
    numerals("1,".repeat(20000));
    assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
  });
});
