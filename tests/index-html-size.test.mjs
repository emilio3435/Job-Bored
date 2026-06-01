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

  it("loads decomposed discovery styles in cascade order", () => {
    const source = readFileSync(join(repoRoot, "index.html"), "utf8");
    const links = [
      "css/legacy-discovery-setup-wizard.css",
      "css/legacy-profile-modal.css",
      "css/legacy-settings-profile.css",
      "css/legacy-discovery-runs.css",
      "css/legacy-discovery-drawer.css",
      "css/legacy-fit-profile-overlay.css",
      "css/legacy-discovery-coachmark.css",
    ];
    assert.equal(source.includes("css/legacy-discovery.css"), false);
    let previous = -1;
    for (const href of links) {
      const index = source.indexOf(`href="${href}"`);
      assert.notEqual(index, -1, `${href} link should exist`);
      assert.ok(index > previous, `${href} should preserve discovery CSS order`);
      previous = index;
    }
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
