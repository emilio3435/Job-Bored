import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { detectGarbledResume } from "../server/materials-resume-source.mjs";

/* ============================================================
   RESJ K3 review fix K3-FP (Grok, 1caa65dc): a capital that is
   a real token of its own ("C for", "Gen X and", "Plan B",
   "tier B") is not PDF split-glyph damage. Before the fix, a clean
   resume with a few of them scored 12–16 and was flagged, and
   PUT /profile/resume refused it. "S ummary" still scores.
   Both detectors change together. Fictional text only.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadBrowserDetector() {
  const window = {};
  const ctx = { window, document: {}, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(repoRoot, "resume-ingest.js"), "utf8"), ctx, { filename: "resume-ingest.js" });
  return window.CommandCenterResumeIngest.detectGarbledText;
}

const HEADER = "Jordan Rivera\nGrowth Marketing Leader\nAustin, TX | jordan.rivera@example.com\n\nExperience\n";

const REAL_CAPITALS = {
  "three 'C for' lines": `${HEADER}- Rated grade C for vendor risk and fixed it in a quarter.
- Moved plan C for the launch up two weeks.
- Scored C for tone in the audit, then rewrote the voice guide.
`,
  "'Gen X and', 'Plan B', 'tier B'": `${HEADER}- Built campaigns for Gen X and millennial buyers.
- Wrote Plan B for the holiday season when the budget moved.
- Grew tier B accounts 40% with a lifecycle series.
- Owned Plan B launches and Gen X outreach across tier B markets.
`,
};

describe("a capital that is a real token is not split-word damage (K3-FP)", () => {
  const browser = loadBrowserDetector();
  for (const [name, text] of Object.entries(REAL_CAPITALS)) {
    it(`should not flag ${name}, in the server or the browser`, () => {
      const server = detectGarbledResume(text);
      assert.equal(server.garbled, false, `server score ${server.score}`);
      assert.ok(server.score < 6, `server score ${server.score} stays low`);
      assert.deepEqual(JSON.parse(JSON.stringify(browser(text))), server, "the two detectors agree");
    });
  }

  it("should still score a capital split off its word", () => {
    const split = "S ummary Nine years in marketing. E xperience Director of Growth. S kills Paid search.";
    const server = detectGarbledResume(split);
    assert.equal(server.signals.splitWords, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(browser(split))), server);
  });

  it("should still flag the materials garbled fixture", () => {
    const text = readFileSync(join(repoRoot, "tests", "fixtures", "materials-garbled-resume.txt"), "utf8");
    assert.equal(detectGarbledResume(text).garbled, true);
    assert.equal(browser(text).garbled, true);
  });
});
