import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { critiqueMaterials } from "../server/materials-critic.mjs";

const jd = `${"digital marketing strategy advancement alumni pipeline ".repeat(20)} unique-keyword-xyz`;

function letterOf(words) {
  return `<html><body><article class="page"><p>${Array(words).fill("word").join(" ")}</p></article></body></html>`;
}

describe("critiqueMaterials", () => {
  it("fails a 200-word letter", async () => {
    const out = await critiqueMaterials({
      letterHtml: letterOf(200),
      resumeHtml: "<section data-section=\"summary\">x</section><section data-section=\"experience\">y</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "word" }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "cover_letter_too_short"), true);
  });

  it("flags banned filler", async () => {
    const html = `<html><body><article class="page"><p>${"word ".repeat(360)} I am passionate about leverage.</p></article></body></html>`;
    const out = await critiqueMaterials({
      letterHtml: html,
      resumeHtml: "<section data-section=\"summary\">Audacy</section><section data-section=\"experience\">Audacy</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "I am passionate about leverage." }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "banned_filler"), true);
  });

  it("fails HTML smuggled in a slot", async () => {
    const out = await critiqueMaterials({
      letterHtml: letterOf(360),
      resumeHtml: "<section data-section=\"summary\">Audacy</section><section data-section=\"experience\">Audacy</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "<style>body{}</style>" }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "html_in_slot"), true);
    assert.equal(out.status, "fail");
  });
});
