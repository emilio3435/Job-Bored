import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { critiqueMaterials } from "../server/materials-critic.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const coverTemplate = readFileSync(
  join(here, "..", "integrations", "hermes-job-hunt", "cover-letter-template", "cover-letter.html"),
  "utf8",
);

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

  it("F2: template guidance comments never trip banned_filler", async () => {
    assert.match(coverTemplate, /proven track record/);
    const out = await critiqueMaterials({
      letterHtml: coverTemplate,
      resumeHtml: "<section data-section=\"summary\">Audacy</section><section data-section=\"experience\">Audacy</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "Clean prose with concrete nouns." }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "banned_filler"), false);
  });

  it("F2: filler in the writer letter still trips banned_filler", async () => {
    const out = await critiqueMaterials({
      letterHtml: letterOf(360),
      resumeHtml: "<section data-section=\"summary\">Audacy</section><section data-section=\"experience\">Audacy</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "I have a proven track record of wins." }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "banned_filler"), true);
  });

  it("slice 5: filler detection is pack-driven, not the five-phrase regex", async () => {
    const out = await critiqueMaterials({
      letterHtml: letterOf(360),
      resumeHtml: "<section data-section=\"summary\">Northwind</section><section data-section=\"experience\">Northwind</section>",
      jdText: jd,
      masterResumeHtml: "",
      keptEmployers: ["Northwind"],
      writerJson: { letter: { hook: "I am excited to apply for this distinctive opportunity." }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "banned_filler"), true);
  });

  it("slice 5: frozen facts narrow to kept claims, without an owner hardcode", async () => {
    const missing = await critiqueMaterials({
      letterHtml: letterOf(360),
      resumeHtml: "<section data-section=\"summary\">Work</section><section data-section=\"experience\">Work</section>",
      jdText: jd,
      masterResumeHtml: "",
      keptEmployers: ["Northwind"],
      writerJson: { letter: { hook: "Clean." }, resume: { roles: [] } },
    });
    assert.equal(missing.issues.some((i) => i.code === "frozen_fact_broken"), true);
    const bareMaster = await critiqueMaterials({
      letterHtml: letterOf(360),
      resumeHtml: "<section data-section=\"summary\">Work</section><section data-section=\"experience\">Work</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "Clean." }, resume: { roles: [] } },
    });
    assert.equal(bareMaster.issues.some((i) => i.code === "frozen_fact_broken"), false);
  });

  it("slice 5: numerals outside the ledger metrics are invented facts", async () => {
    const out = await critiqueMaterials({
      letterHtml: letterOf(360),
      resumeHtml: "<section data-section=\"summary\">Northwind</section><section data-section=\"experience\">Northwind</section>",
      jdText: jd,
      masterResumeHtml: "",
      keptEmployers: ["Northwind"],
      ledgerMetrics: ["$10M+"],
      writerJson: {
        letter: { hook: "Clean." },
        resume: { roles: [{ bullets: ["Grew the book 99% in a quarter."] }] },
      },
    });
    assert.equal(out.issues.some((i) => i.code === "invented_fact"), true);
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
