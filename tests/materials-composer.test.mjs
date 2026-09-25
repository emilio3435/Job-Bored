import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { composeCoverLetter, composeResume } from "../server/materials-composer.mjs";

const letterTpl = readFileSync(new URL("./fixtures/materials/mini-letter.html", import.meta.url), "utf8");
const resumeTpl = readFileSync(new URL("./fixtures/materials/mini-resume.html", import.meta.url), "utf8");

describe("composeCoverLetter", () => {
  it("fills slots and leaves CSS alone", () => {
    const html = composeCoverLetter(letterTpl, {
      company: "EAB",
      role: "Senior Director",
      hook: "I build systems that decide where the next dollar goes.",
      whyThem: "Advancement needs operators who can ship.",
    });
    assert.match(html, /EAB/);
    assert.match(html, /Senior Director/);
    assert.match(html, /\.keep\{color:navy\}/);
    assert.doesNotMatch(html, /\[Company\]/);
  });
});

describe("composeResume", () => {
  it("fills an existing data-role and does not invent roles", () => {
    const html = composeResume(resumeTpl, {
      summary: { opener: "Operator.", body: "Paid media + AI systems." },
      roles: [
        { id: "audacy-dsm", bullets: ["Grew Denver to top-3 nationally."] },
        { id: "does-not-exist", bullets: ["invented"] },
      ],
    });
    assert.match(html, /Grew Denver to top-3 nationally/);
    assert.doesNotMatch(html, /invented/);
    assert.doesNotMatch(html, /data-role="does-not-exist"/);
    assert.match(html, /\.keep\{color:navy\}/);
  });
});
