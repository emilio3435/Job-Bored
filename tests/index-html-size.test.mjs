import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { expandIndexIncludes } from "../scripts/lib/expand-index-includes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("index.html decomposition", () => {
  it("keeps on-disk index.html under 2000 lines", () => {
    const source = readFileSync(join(repoRoot, "index.html"), "utf8");
    const lines = source.split("\n").length;
    assert.ok(lines < 2000, `index.html is ${lines} lines; target is <2000`);
  });

  it("expands partial includes into full dashboard markup", () => {
    const expanded = expandIndexIncludes(
      readFileSync(join(repoRoot, "index.html"), "utf8"),
      repoRoot,
    );
    assert.match(expanded, /id="onboardingWizard"/);
    assert.match(expanded, /id="runsModal"/);
    assert.match(expanded, /id="expiredReviewModal"/);
    assert.match(expanded, /id="settingsModal"/);
    assert.match(expanded, /id="scraperSetupModal"/);
    assert.match(expanded, /id="materialsModal"/);
    assert.match(expanded, /id="linkedInCaptureModal"/);
    assert.match(expanded, /id="resumeGenerateModal"/);
    assert.match(expanded, /id="draftNotesModal"/);
    assert.match(expanded, /id="discoveryDrawer"/);
    assert.match(expanded, /id="discoveryPathsModal"/);
    assert.match(expanded, /id="ingestManualModal"/);
    assert.ok(
      expanded.split("\n").length > 5500,
      "expanded markup should retain full modal surface area",
    );
  });
});
