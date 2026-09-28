/*
 * Characterization for the legacy resume-read projection only. Materials
 * ledger ingestion no longer calls this heuristic parser; its model path and
 * quote validation are covered in materials-resume-structure-model.test.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { parseHeaderLine, parseResumeStructure } from "../server/materials-resume-structure.mjs";

const GOLDEN = readFileSync(new URL("./fixtures/resumes/unbulleted-realshape.txt", import.meta.url), "utf8");

describe("legacy resume-read parser characterization (not Materials ingest)", () => {
  it("retains the read-only projection for the fictional resume fixture", () => {
    const structure = parseResumeStructure(GOLDEN);
    assert.equal(structure.employers.length, 5);
    assert.equal(structure.employers[0].name, "Brightwave Media (formerly Tidewater Radio)");
    assert.deepEqual(
      structure.employers[0].roles.map((role) => [role.title, role.start, role.end]),
      [
        ["Digital Sales Manager", "May 2021", "2026"],
        ["Account Executive → Senior Account Executive", "May 2019", "May 2021"],
        ["Digital Campaign Coordinator", "Sep 2017", "Apr 2019"],
      ],
    );
  });

  it("drops a short line and rejoins a wrapped bullet for read projection", () => {
    const structure = parseResumeStructure([
      "EXPERIENCE",
      "Acme Corp — Sales Manager, 2020 – 2024",
      "Portland team",
      "Rebuilt the renewal process and lifted retention to 91% across 200 accounts.",
      "- Led digital strategy for a $12M annual book and kept Austin a top-5 national market in",
      "digital revenue for three straight years.",
    ].join("\n"));
    assert.deepEqual(
      structure.employers[0].claims.map((claim) => claim.text),
      [
        "Rebuilt the renewal process and lifted retention to 91% across 200 accounts.",
        "Led digital strategy for a $12M annual book and kept Austin a top-5 national market in digital revenue for three straight years.",
      ],
    );
  });

  it("recognizes header forms without assigning text to a ledger", () => {
    const h = parseHeaderLine(
      "Digital Marketing Strategist, Summit Ridge Lending Inc. — Ran search campaigns and blog content for loan officers and real-estate partners across 6 states. 2015 – 2016",
    );
    assert.equal(h?.title, "Digital Marketing Strategist");
    assert.equal(h?.name, "Summit Ridge Lending Inc.");
    assert.match(h?.description || "", /^Ran search campaigns/);
    assert.deepEqual([h?.start, h?.end], ["2015", "2016"]);
    assert.equal(parseHeaderLine("Led the rebuild of the renewal process for 200 accounts."), null);
  });

  it("does not feed text-only resumes through the rules structure path in the ledger builder", () => {
    assert.throws(
      () => buildLedger({ profile: null, resumeText: GOLDEN }),
      (error) => error.code === "resume_structure_required",
    );
  });
});
