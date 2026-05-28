import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");

function loadPipelineInternals() {
  const marker = "  function stageLabel(stageKey) {";
  const instrumented = pipelineJs.replace(
    marker,
    "  root.__pipelineTest = { sortCards: sortCards, capCardsByFit: capCardsByFit };\n\n" + marker,
  );
  assert.notEqual(instrumented, pipelineJs, "pipeline.js instrumentation marker moved");

  const win = {};
  const doc = {
    readyState: "loading",
    addEventListener() {},
    body: null,
    querySelector() { return null; },
  };
  vm.runInNewContext(
    instrumented,
    { window: win, document: doc, console, setTimeout, Date, Number, isFinite, Object },
    { filename: "pipeline.js" },
  );
  return win.__pipelineTest;
}

function figmaCards(count, baseScore = 90) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ jobKey: "figma-" + i, company: "Figma", fitScore: baseScore - i });
  }
  return out;
}

describe("v2 pipeline per-company hard cap", () => {
  it("drops everything past the top 3 by fit for a single company", () => {
    const { capCardsByFit } = loadPipelineInternals();
    const capped = capCardsByFit(figmaCards(25));
    assert.equal(capped.length, 3, "Only 3 Figma cards survive the cap");
    const keptKeys = capped.map((c) => c.jobKey).sort();
    assert.deepEqual(
      keptKeys,
      ["figma-0", "figma-1", "figma-2"],
      "Survivors are the 3 highest-fit Figma cards",
    );
  });

  it("Top 3 are picked by fitScore even when the input order is scrambled", () => {
    const { capCardsByFit } = loadPipelineInternals();
    const capped = capCardsByFit([
      { jobKey: "fig-low", company: "Figma", fitScore: 10 },
      { jobKey: "fig-high", company: "Figma", fitScore: 99 },
      { jobKey: "fig-mid1", company: "Figma", fitScore: 50 },
      { jobKey: "fig-mid2", company: "Figma", fitScore: 60 },
      { jobKey: "fig-mid3", company: "Figma", fitScore: 55 },
    ]);
    const keptKeys = capped.map((c) => c.jobKey).sort();
    assert.deepEqual(
      keptKeys,
      ["fig-high", "fig-mid2", "fig-mid3"],
      "The three highest fit scores survive regardless of input order",
    );
  });

  it("Companies at or under the cap are left untouched", () => {
    const { capCardsByFit } = loadPipelineInternals();
    const capped = capCardsByFit([
      { jobKey: "stripe-1", company: "Stripe", fitScore: 70 },
      { jobKey: "linear-1", company: "Linear", fitScore: 65 },
      { jobKey: "linear-2", company: "Linear", fitScore: 60 },
    ]);
    assert.equal(capped.length, 3, "All 3 cards survive when no company exceeds the cap");
  });

  it("Cap is applied per company, so over-cap companies do not affect others", () => {
    const { capCardsByFit } = loadPipelineInternals();
    const capped = capCardsByFit([
      ...figmaCards(10, 90),
      { jobKey: "stripe-1", company: "Stripe", fitScore: 70 },
      { jobKey: "linear-1", company: "Linear", fitScore: 65 },
    ]);
    assert.equal(capped.length, 5, "Top 3 Figma + Stripe + Linear = 5");
    const companies = capped.map((c) => c.company).sort();
    assert.deepEqual(
      companies,
      ["Figma", "Figma", "Figma", "Linear", "Stripe"],
      "Only Figma loses cards; Stripe and Linear are untouched",
    );
  });

  it("Cards with no company are never capped", () => {
    const { capCardsByFit } = loadPipelineInternals();
    const capped = capCardsByFit([
      { jobKey: "a", company: "", fitScore: 90 },
      { jobKey: "b", company: "", fitScore: 80 },
      { jobKey: "c", company: "", fitScore: 70 },
      { jobKey: "d", company: "", fitScore: 60 },
      { jobKey: "e", company: "", fitScore: 50 },
    ]);
    assert.equal(capped.length, 5, "Blank-company cards are not subject to the cap");
  });

  it("Case and whitespace differences count as the same company", () => {
    const { capCardsByFit } = loadPipelineInternals();
    const capped = capCardsByFit([
      { jobKey: "a", company: "Figma",   fitScore: 99 },
      { jobKey: "b", company: "figma",   fitScore: 90 },
      { jobKey: "c", company: "  Figma ", fitScore: 85 },
      { jobKey: "d", company: "FIGMA",   fitScore: 70 },
      { jobKey: "e", company: "figma",   fitScore: 50 },
    ]);
    assert.equal(capped.length, 3, "Different cases of 'Figma' collapse into one capped group");
    const keptKeys = capped.map((c) => c.jobKey).sort();
    assert.deepEqual(
      keptKeys,
      ["a", "b", "c"],
      "Top 3 by fit survive across case-variant company strings",
    );
  });

  it("Capped output feeds sortCards cleanly — column count reflects only survivors", () => {
    const { capCardsByFit, sortCards } = loadPipelineInternals();
    const cards = [
      ...figmaCards(25, 95),
      { jobKey: "stripe-1", company: "Stripe", fitScore: 70 },
    ];
    const ordered = sortCards(capCardsByFit(cards), "fit");
    assert.equal(ordered.length, 4, "Pipeline column would render 4 cards, not 26");
    assert.equal(ordered[0].jobKey, "figma-0", "Best Figma still ranks first under Fit sort");
    assert.equal(
      ordered.filter((c) => c.company === "Figma").length,
      3,
      "Only 3 Figma cards in the rendered column",
    );
  });
});
