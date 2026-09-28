import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { detectGarbledResume } from "../server/materials-resume-source.mjs";
import { validateResumeSync } from "../server/profile-resume-sync.mjs";

/* ============================================================
   RESJ K3 review round 3 (Grok, 65bf6599).

   K3-LEN (P1): split section headings were density-scaled, so four
   of them in an 843-word resume (density 1.42) or six in 986 words
   (1.83) passed and PUT /profile/resume replaced the saved file.
   Ruling: two or more split section headings from the allowlist
   ("S ummary", "E xperience", "A wards") are garbled at any length;
   everything else keeps the density score.

   K3-AI (P2): headings that start with A or I ("A wards",
   "I nterests") never matched the capital class. They do now,
   while "Type A", "Grade A", "A/B testing" and "I managed" stay
   clean. Both detectors, pinned equal. Fictional text only.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const REALSHAPE = readFileSync(join(repoRoot, "tests", "fixtures", "resumes", "unbulleted-realshape.txt"), "utf8");

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

const PADDING =
  "Partnered with finance on quarterly planning and kept every forecast inside a two percent band while the team doubled. ";

/** @param {string} text */
function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

describe("split section headings are decisive at any length (K3-LEN, P1)", () => {
  it("should flag the realshape resume with four split headings", () => {
    const text = `${REALSHAPE}\nS ummary\nE xperience\nS kills\nE ducation\n`;
    assert.ok(wordCount(text) > 840);
    const r = both(text);
    assert.equal(r.garbled, true, `score ${r.score}, words ${r.words}`);
    assert.equal(validateResumeSync({ resumeText: text }).ok, false, "PUT /profile/resume refuses it");
  });

  it("should flag six split headings padded to about 986 words", () => {
    let text = `${REALSHAPE}\nS ummary\nE xperience\nS kills\nE ducation\nP rojects\nA wards\n`;
    while (wordCount(text) < 986) text += PADDING;
    assert.ok(wordCount(text) >= 986 && wordCount(text) < 1010, `words ${wordCount(text)}`);
    const r = both(text);
    assert.equal(r.garbled, true, `score ${r.score}, words ${r.words}`);
  });

  it("should still save the clean realshape resume", () => {
    const r = both(REALSHAPE);
    assert.equal(r.garbled, false, `score ${r.score}`);
    assert.equal(validateResumeSync({ resumeText: REALSHAPE }).ok, true);
  });

  it("should keep one split heading density-scored, not decisive", () => {
    const r = both(`${REALSHAPE}\nS ummary\n`);
    assert.equal(r.garbled, false, `score ${r.score}`);
  });
});

describe("headings that start with A or I are caught too (K3-AI, P2)", () => {
  it("should flag a resume split at 'A bout', 'A wards', 'I nterests', 'I mproved'", () => {
    const text = "Jordan Rivera\nGrowth Marketing Leader\nA bout\nGrowth leader.\nA wards\nMarketer of the year.\nI nterests\nRunning.\nI mproved retention.\n";
    const r = both(text);
    assert.equal(r.signals.splitWords, 4);
    assert.equal(r.garbled, true);
  });

  it("should leave 'Type A', 'Grade A', 'A/B testing' and 'I managed' clean", () => {
    const text =
      "Jordan Rivera\nGrowth Marketing Leader\n- Type A personality on a Grade A work team.\n- Ran A/B testing on every launch.\n- I managed the lifecycle program.\n";
    const r = both(text);
    assert.equal(r.score, 0);
  });
});
