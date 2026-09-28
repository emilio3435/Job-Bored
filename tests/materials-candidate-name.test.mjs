import { test } from "node:test";
import assert from "node:assert/strict";

import { candidateNameFromText, stripNickname } from "../server/materials-resume-source.mjs";
import { buildRenderModelFromWriter } from "../server/materials-render-model-adapter.mjs";

test("should drop a quoted nickname from the resume's name line", () => {
  assert.equal(candidateNameFromText("JORDAN “JO” RIVERA\n\nDigital Sales Leader"), "JORDAN RIVERA");
  assert.equal(candidateNameFromText('Robert "Bob" Smith\nEngineer'), "Robert Smith");
  assert.equal(candidateNameFromText("Ana (Annie) Ruiz\nAnalyst"), "Ana Ruiz");
  assert.equal(candidateNameFromText("Jordan ‘Jo’ Avila"), "Jordan Avila");
});

test("should keep apostrophes and plain names untouched", () => {
  assert.equal(stripNickname("Conan O'Brien"), "Conan O'Brien");
  assert.equal(stripNickname("D'Angelo Russell"), "D'Angelo Russell");
  assert.equal(stripNickname("Jordan Avila"), "Jordan Avila");
  assert.equal(stripNickname(""), "");
});

test("should never render a nickname in the resume or letter render model", () => {
  const resumeText = "JORDAN “JO” RIVERA\n\nRevenue Operations Lead • Automation Maker\n\nAustin, CO • user@example.com";
  const fromSource = buildRenderModelFromWriter({
    writerJson: { resume: { header: { name: "", headline: "Digital Sales Leader" } }, letter: {} },
    resumeText,
    family: "signal",
    nowIso: "2026-09-27T00:00:00.000Z",
  });
  const fromHeader = buildRenderModelFromWriter({
    writerJson: { resume: { header: { name: "JORDAN “JO” RIVERA", headline: "Digital Sales Leader" } }, letter: {} },
    resumeText,
    family: "signal",
    nowIso: "2026-09-27T00:00:00.000Z",
  });
  for (const model of [fromSource, fromHeader]) {
    const serialized = JSON.stringify(model);
    assert.doesNotMatch(serialized, /\bJO\b/i, "the nickname must not reach any rendered field");
    assert.doesNotMatch(serialized, /[“”]/u, "no quoted nickname remnants");
    assert.match(serialized, /JORDAN RIVERA/);
  }
});
