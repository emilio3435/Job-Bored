import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { detectGarbledResume } from "../server/materials-resume-source.mjs";

/* ============================================================
   RESJ K3 review round 2 (Grok, ca540673): one split-word rule
   in both detectors.

   K3-FN (P1): after round 1, a split "S ummary" mid-line plus
   line-start "E xperience", "S kills", "E ducation" scored 9 and
   passed, then overwrote resume.txt.
   K3-FP (P2): "C programming", "R programming for …" skill lines
   scored 12 and PUT /profile/resume refused them.

   Rule: a capital + space + lowercase run counts as split-word
   damage when the joined form is a known resume word ("Summary",
   "Experience", "Skills", "Managed"), wherever it sits. Anything
   else (a lone capital before a whole word: "C programming",
   "Plan B", "C for") is a real token. Fictional text only.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadBrowserDetector() {
  const window = {};
  const ctx = { window, document: {}, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(repoRoot, "resume-ingest.js"), "utf8"), ctx, { filename: "resume-ingest.js" });
  return window.CommandCenterResumeIngest.detectGarbledText;
}
const browser = loadBrowserDetector();

/** @param {string} text */
function both(text) {
  const server = detectGarbledResume(text);
  assert.deepEqual(JSON.parse(JSON.stringify(browser(text))), server, "the two detectors agree");
  return server;
}

const MISSED_SPLIT = `Ada Lovelace
Staff Data Engineer
London | ada@example.com S ummary Builds data platforms for analytics teams.
E xperience
Staff Data Engineer, Northwind Analytics, 2019 to 2025
- Moved the warehouse to a streaming design.
S kills
Python, SQL, Airflow, dbt
E ducation
B.Sc. Mathematics, Lakeview State University
`;

const SKILL_LINES = `Jane Marie Doe
Embedded Software Engineer
Austin, TX | jane.doe@example.com

Skills
C programming
C development for embedded devices
R programming for experiment analysis
C libraries used across the fleet
`;

describe("split-word damage is scored wherever it sits (K3-FN, P1)", () => {
  it("should flag a split 'S ummary' mid-line with split headings at line starts", () => {
    const r = both(MISSED_SPLIT);
    assert.equal(r.signals.splitWords, 4);
    assert.equal(r.garbled, true, `score ${r.score}`);
  });

  it("should still flag the materials garbled fixture", () => {
    const r = both(readFileSync(join(repoRoot, "tests", "fixtures", "materials-garbled-resume.txt"), "utf8"));
    assert.equal(r.garbled, true);
  });

  it("should score split verbs and headings, not only the first line", () => {
    const r = both("Jordan Rivera\nM anaged a team of six. L ed the launch.\nP rofile\n");
    assert.equal(r.signals.splitWords, 3);
  });
});

describe("a lone capital before a whole word is a real token (K3-FP, P2)", () => {
  it("should pass 'C programming' and 'R programming for …' skill lines", () => {
    const r = both(SKILL_LINES);
    assert.equal(r.signals.splitWords, 0);
    assert.equal(r.garbled, false, `score ${r.score}`);
  });

  for (const text of [
    "Jordan Rivera\nRated grade C for vendor risk.\nWrote Plan B for the season.\nGrew tier B accounts.\nGen X and millennial buyers.\n",
    "JANE MARIE DOE\nProduct Designer\n",
    "José Álvarez\nΑλέξανδρος Παππάς\nИван Петров\nNguyễn Văn An\n李娜\n",
  ]) {
    it(`should score 0 for ${JSON.stringify(text.split("\n")[1] || text.slice(0, 20))}`, () => {
      assert.equal(both(text).score, 0);
    });
  }
});
