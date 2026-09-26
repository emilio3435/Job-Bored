/**
 * The plain-text ATS twins (server/materials-ats-text.mjs) come from the
 * render model, never from the HTML, so they are identical in every family.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverLetterText, resumeText, resumeWordCount, wrapText } from "../server/materials-ats-text.mjs";
import { retargetModel, runsToText } from "../server/materials-render.mjs";
import { resolveFamily } from "../server/materials-templates.mjs";
import { fullRenderModel } from "./fixtures/materials-render-fixture.mjs";

describe("ATS text twins", () => {
  const model = fullRenderModel("signal");

  it("should be byte-identical across every template family", () => {
    const resumes = new Set();
    const letters = new Set();
    for (const family of ["signal", "dossier", "editorial"]) {
      const m = retargetModel(model, resolveFamily(family));
      resumes.add(resumeText(m));
      letters.add(coverLetterText(m));
    }
    assert.equal(resumes.size, 1);
    assert.equal(letters.size, 1);
  });

  it("should open on the name and carry the statement and every bullet", () => {
    const txt = resumeText(model);
    assert.ok(txt.startsWith(`${model.identity.name}\n${model.identity.target}\n`));
    const flat = txt.replace(/\s+/g, " ");
    assert.ok(flat.includes(runsToText(model.documents.resume.statement.runs).replace(/\s+/g, " ")));
    for (const section of model.documents.resume.sections) {
      for (const entry of section.entries || []) {
        for (const bullet of entry.bullets || []) {
          assert.ok(flat.includes(runsToText(bullet.runs).replace(/\s+/g, " ")), `bullet ${bullet.claimId}`);
        }
      }
    }
  });

  it("should leave out chrome that only restates the body (readout captions)", () => {
    const txt = resumeText(model);
    assert.doesNotMatch(txt, /VERIFIED FIGURES/);
    assert.doesNotMatch(txt, /forecast scenarios run/);
  });

  it("should carry every letter paragraph and the rail, and no pull quote or headline", () => {
    const letter = model.documents.coverLetter;
    const txt = coverLetterText(model);
    const flat = txt.replace(/\s+/g, " ");
    for (const p of letter.paragraphs) assert.ok(flat.includes(p.text), `paragraph ${p.id}`);
    for (const group of letter.rail) for (const line of group.lines) assert.ok(flat.includes(line));
    assert.ok(!flat.includes(letter.headline), "the headline is chrome, not letter text");
    assert.equal(flat.split(letter.pullQuote.text).length - 1, 1, "the pull quote appears once, in its paragraph");
  });

  it("should wrap at the model's width with a hanging bullet indent", () => {
    const wrapped = wrapText("one two three four five six seven eight nine ten", 20, "- ", "  ");
    for (const line of wrapped.split("\n")) assert.ok(line.length <= 20, line);
    assert.ok(wrapped.startsWith("- one"));
    assert.ok(wrapped.split("\n")[1].startsWith("  "));
    for (const line of resumeText(model).split("\n")) {
      assert.ok(line.length <= 78 || !line.includes(" "), `over 78: ${line}`);
    }
  });

  it("should count visible words for the fit stage's word budget", () => {
    assert.ok(resumeWordCount(model) > 250);
  });
});
