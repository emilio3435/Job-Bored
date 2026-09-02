import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const jbTextSource = readFileSync(join(repoRoot, "jb-text.js"), "utf8");
const insightsSource = readFileSync(
  join(repoRoot, "job-posting-insights.js"),
  "utf8",
);

function loadInsights() {
  const window = {
    CommandCenterResumeGenerate: {
      getResumeGenerationConfig: () => ({}),
    },
  };
  const context = vm.createContext({
    window,
    URL,
    console: { log() {}, warn() {}, error() {} },
  });
  vm.runInContext(jbTextSource, context, { filename: "jb-text.js" });
  vm.runInContext(insightsSource, context, {
    filename: "job-posting-insights.js",
  });
  return window.CommandCenterJobPostingInsights;
}

const insights = loadInsights();
const normalize = (value) =>
  JSON.parse(JSON.stringify(insights._normalizeEnrichmentJson(value)));
const loose = (key, value) =>
  JSON.parse(JSON.stringify(insights._parseLooseFieldValue(key, value)));

describe("normalizeEnrichmentJson", () => {
  it("demotes markdown and strips glyphs across fields", () => {
    const out = normalize({
      inferredTitle: "**Senior** PM",
      inferredCompany: "Acme",
      inferredLocation: "Denver,\nCO",
      postingSummary: "We move **fast**.\n\nAnd *carefully*.",
      roleInOneLine: "Owns the\nroadmap",
      mustHaves: ["- 5+ years", { text: "Go & Rust" }],
      responsibilities: ["1. Ship", "2. Operate"],
      niceToHaves: [],
      toolsAndStack: ["`k8s`"],
      atsFitScore: "88",
      atsFitRationale: "Strong *match*",
      fitAngle: "You shipped **X**",
      talkingPoints: ["• Ask about Y"],
      extraKeywords: [],
    });
    assert.equal(out.inferredTitle, "Senior PM");
    assert.equal(out.inferredLocation, "Denver, CO");
    assert.equal(out.postingSummary, "We move fast.\n\nAnd carefully.");
    assert.equal(out.roleInOneLine, "Owns the roadmap");
    assert.deepEqual(out.mustHaves, ["5+ years", "Go & Rust"]);
    assert.deepEqual(out.responsibilities, ["Ship", "Operate"]);
    assert.deepEqual(out.toolsAndStack, ["k8s"]);
    assert.equal(out.atsFitRationale, "Strong match");
    assert.deepEqual(out.talkingPoints, ["Ask about Y"]);
  });
});

describe("parseLooseFieldValue", () => {
  it("no longer shreds comma-bearing single items", () => {
    assert.deepEqual(loose("mustHaves", "Experience in Denver, CO area"), [
      "Experience in Denver, CO area",
    ]);
  });

  it("still splits real enumerations", () => {
    assert.deepEqual(
      loose("toolsAndStack", "React, TypeScript, Node, Postgres"),
      ["React", "TypeScript", "Node", "Postgres"],
    );
    assert.deepEqual(loose("mustHaves", "A\nB\nC"), ["A", "B", "C"]);
  });
});
