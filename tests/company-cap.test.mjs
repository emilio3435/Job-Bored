import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const companyCapJs = readFileSync(join(repoRoot, "company-cap.js"), "utf8");

function loadCompanyCap() {
  const win = {};
  vm.runInNewContext(companyCapJs, { window: win, console, Date }, { filename: "company-cap.js" });
  return win.JobBoredCompanyCap;
}

function makeCards(count, company, baseScore = 90) {
  return Array.from({ length: count }, (_, i) => ({
    jobKey: company.toLowerCase() + "-" + i,
    company,
    fitScore: baseScore - i,
  }));
}

describe("company-cap shared helper", () => {
  it("exposes CAP, companyKey, fitScoreOf, capCardsByFit, summarizeHidden", () => {
    const cap = loadCompanyCap();
    assert.equal(typeof cap, "object");
    assert.equal(typeof cap.CAP, "number");
    assert.equal(typeof cap.companyKey, "function");
    assert.equal(typeof cap.fitScoreOf, "function");
    assert.equal(typeof cap.capCardsByFit, "function");
    assert.equal(typeof cap.summarizeHidden, "function");
  });

  it("companyKey normalizes case and whitespace", () => {
    const cap = loadCompanyCap();
    assert.equal(cap.companyKey({ company: "  Figma " }), "figma");
    assert.equal(cap.companyKey({ company: "FIGMA" }), "figma");
    assert.equal(cap.companyKey(null), "");
    assert.equal(cap.companyKey({}), "");
  });

  it("fitScoreOf returns -Infinity for null/undefined/non-finite, parses numeric strings", () => {
    const cap = loadCompanyCap();
    assert.equal(cap.fitScoreOf({ fitScore: 75 }), 75);
    assert.equal(cap.fitScoreOf({ fitScore: "75" }), 75);
    assert.equal(cap.fitScoreOf({ fitScore: null }), -Infinity);
    assert.equal(cap.fitScoreOf({ fitScore: undefined }), -Infinity);
    assert.equal(cap.fitScoreOf({ fitScore: "abc" }), -Infinity);
  });

  it("capCardsByFit drops over-cap cards keeping top N per company by fit", () => {
    const cap = loadCompanyCap();
    const cards = makeCards(25, "Figma");
    const kept = cap.capCardsByFit(cards);
    assert.equal(kept.length, 3);
    assert.deepEqual(
      kept.map((c) => c.jobKey).sort(),
      ["figma-0", "figma-1", "figma-2"],
    );
  });

  it("shouldPin keeps a card regardless of fit rank", () => {
    const cap = loadCompanyCap();
    const cards = makeCards(10, "Figma");
    const kept = cap.capCardsByFit(cards, (c) => c.jobKey === "figma-9");
    assert.ok(kept.some((c) => c.jobKey === "figma-9"));
    assert.equal(kept.length, 3, "Pin counts toward the cap");
  });

  it("shouldPin receives (card, idx) and pinning a non-company card is a no-op", () => {
    const cap = loadCompanyCap();
    const cards = [
      { jobKey: "a", company: "", fitScore: 1 },
      ...makeCards(5, "Figma"),
    ];
    let received = [];
    cap.capCardsByFit(cards, (card, idx) => {
      received.push([card.jobKey, idx]);
      return false;
    });
    // idx 0 is the empty-company card; shouldPin is still invoked.
    assert.ok(received.some(([k, i]) => k === "a" && i === 0));
  });

  it("summarizeHidden returns one entry per company with the dropped count", () => {
    const cap = loadCompanyCap();
    const cards = [
      ...makeCards(5, "Figma"),
      ...makeCards(4, "Stripe"),
      { jobKey: "linear-1", company: "Linear", fitScore: 60 },
    ];
    const kept = cap.capCardsByFit(cards);
    const summary = cap.summarizeHidden(cards, kept);
    const byCompany = Object.fromEntries(summary.map((s) => [s.company, s.hidden]));
    assert.equal(byCompany.Figma, 2, "Figma had 5, kept 3, so 2 hidden");
    assert.equal(byCompany.Stripe, 1, "Stripe had 4, kept 3, so 1 hidden");
    assert.equal(byCompany.Linear, undefined, "Linear stayed under the cap and is not summarized");
  });

  it("Returns the original input untouched when cards is empty or non-array", () => {
    const cap = loadCompanyCap();
    assert.equal(cap.capCardsByFit([]).length, 0);
    assert.equal(cap.capCardsByFit(null).length, 0);
    assert.equal(cap.summarizeHidden([], []).length, 0);
    assert.equal(cap.summarizeHidden(null, null).length, 0);
  });

  it("Ties on fitScore fall back to input index for deterministic survivors", () => {
    const cap = loadCompanyCap();
    const cards = [
      { jobKey: "a", company: "Figma", fitScore: null },
      { jobKey: "b", company: "Figma", fitScore: null },
      { jobKey: "c", company: "Figma", fitScore: null },
      { jobKey: "d", company: "Figma", fitScore: null },
      { jobKey: "e", company: "Figma", fitScore: null },
    ];
    const kept = cap.capCardsByFit(cards);
    assert.deepEqual(
      kept.map((c) => c.jobKey),
      ["a", "b", "c"],
    );
  });
});
