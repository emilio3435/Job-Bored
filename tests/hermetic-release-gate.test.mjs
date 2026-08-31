/**
 * F4-D named red claims — hermetic browser gate, static composition
 * parity, and dead Letter/Workshop nav.
 *
 * These probes must fail on the audited base and pass only after the
 * isolated helpers in this lane land. They are node:test (no Playwright)
 * so they run in `npm test` without a browser.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { expandIndexIncludes } from "../scripts/lib/expand-index-includes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRoot(rel) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("F4D-HERMETIC: e2e suites must not touch Google/Sheets/user dirt", () => {
  it("boot-smoke imports the shared hermetic fixture harness", () => {
    const smoke = readRoot("tests/e2e-smoke/boot-smoke.spec.mjs");
    assert.match(
      smoke,
      /from ["']\.\.\/e2e-fixtures\/hermetic-harness\.mjs["']/,
      "F4D-HERMETIC: tests/e2e-smoke/boot-smoke.spec.mjs must import tests/e2e-fixtures/hermetic-harness.mjs",
    );
  });

  it("critical-journey imports the shared hermetic fixture harness", () => {
    const journey = readRoot("tests/e2e-journey/critical-journey.spec.mjs");
    assert.match(
      journey,
      /from ["']\.\.\/e2e-fixtures\/hermetic-harness\.mjs["']/,
      "F4D-HERMETIC: tests/e2e-journey/critical-journey.spec.mjs must import tests/e2e-fixtures/hermetic-harness.mjs",
    );
  });

  it("boot-smoke does not copy config.js into the repo", () => {
    const smoke = readRoot("tests/e2e-smoke/boot-smoke.spec.mjs");
    assert.doesNotMatch(
      smoke,
      /copyFileSync\(\s*CONFIG_EXAMPLE_PATH\s*,\s*CONFIG_PATH\s*\)/,
      "F4D-HERMETIC: e2e-smoke must not write config.js into the checkout",
    );
  });

  it("critical-journey does not copy config.js into the repo", () => {
    const journey = readRoot("tests/e2e-journey/critical-journey.spec.mjs");
    assert.doesNotMatch(
      journey,
      /copyFileSync\(\s*CONFIG_EXAMPLE_PATH\s*,\s*CONFIG_PATH\s*\)/,
      "F4D-HERMETIC: e2e-journey must not write config.js into the checkout",
    );
  });

  it("exposes a hermetic harness module with disposable auth and phone geometry", async () => {
    const harnessPath = join(repoRoot, "tests/e2e-fixtures/hermetic-harness.mjs");
    assert.equal(
      existsSync(harnessPath),
      true,
      "F4D-HERMETIC: tests/e2e-fixtures/hermetic-harness.mjs must exist",
    );
    const harness = await import(harnessPath);
    assert.equal(typeof harness.installHermeticNetworkFence, "function");
    assert.equal(typeof harness.stageSignedInDisposableAuth, "function");
    assert.equal(typeof harness.startHermeticApp, "function");
    assert.ok(harness.DISPOSABLE_AUTH?.sheetId, "disposable sheet id required");
    assert.equal(
      /googleapis\.com|accounts\.google/.test(harness.DISPOSABLE_AUTH.sheetId),
      false,
      "disposable sheet id must not look like a live Google resource",
    );
    const widths = (harness.PHONE_VIEWPORTS || []).map((v) => v.width).sort((a, b) => a - b);
    assert.deepEqual(
      widths,
      [320, 375, 393],
      "F3-D phone geometry share: harness must export 320/375/393 viewports",
    );
  });
});

describe("F4D-COMPOSE: static and local compositions share a protected surface", () => {
  it("expandIndexIncludes accepts a resolveIncludePath hook for F0-A containment", async () => {
    const source = readRoot("scripts/lib/expand-index-includes.mjs");
    assert.match(
      source,
      /resolveIncludePath/,
      "F4D-COMPOSE: expander must accept resolveIncludePath so F0-A can contain paths before expand",
    );
    const { createContainedIncludeResolver } = await import(
      "../scripts/lib/expand-index-includes.mjs"
    );
    const seen = [];
    const contained = createContainedIncludeResolver(repoRoot);
    expandIndexIncludes(readRoot("index.html"), repoRoot, 0, {
      resolveIncludePath(relPath, fromDir, options) {
        seen.push(relPath);
        return contained(relPath, fromDir, options);
      },
    });
    assert.ok(seen.some((p) => p.startsWith("partials/")), "hook must resolve partial includes");
    assert.throws(
      () => contained("../.env", repoRoot),
      /escapes assembly root/,
      "assembler resolver must not follow includes outside the repo",
    );
  });

  it("assembler and expander emit the same protected-surface ids", async () => {
    const { assembleIndex } = await import("../scripts/assemble-index.mjs");
    const { missingProtectedIds, PROTECTED_SURFACE_IDS } = await import(
      "../scripts/lib/index-protected-surface.mjs"
    );
    assert.ok(PROTECTED_SURFACE_IDS.length >= 10, "protected surface inventory must be explicit");
    const expanded = expandIndexIncludes(readRoot("index.html"), repoRoot);
    const assembled = assembleIndex(repoRoot);
    assert.deepEqual(
      missingProtectedIds(expanded),
      [],
      "expanded index.html must expose the protected surface",
    );
    assert.deepEqual(
      missingProtectedIds(assembled),
      [],
      "assembler output must expose the same protected surface",
    );
    assert.equal(assembled, expanded, "assemble-index must be expandIndexIncludes, not a fork");
  });

  it("assembler docs describe index.html + partials, not a stale index.template.html workflow", () => {
    const plan = readRoot("docs/refactor/PLAN-index-html-decompose.md");
    assert.doesNotMatch(
      plan,
      /change `partials\/\*\.html` or `index\.template\.html`/,
      "F4D-COMPOSE: PLAN-index-html-decompose.md still documents a deleted index.template.html edit workflow",
    );
  });
});

describe("F4D-P3-NAV: every chrome pill has a live data-region target", () => {
  it("flowing-chrome pills do not include the retired Letter/Workshop region", () => {
    const chromeJs = readRoot("flowing-chrome.js");
    const pillsBlock = chromeJs.match(/var PILLS = \[([\s\S]*?)\];/);
    assert.ok(pillsBlock, "PILLS array must exist");
    assert.doesNotMatch(
      pillsBlock[1],
      /id:\s*["']letter["']/,
      "F4D-P3-NAV: Letter pill is dead — PART 04 was removed; Dossier owns materials",
    );
    assert.doesNotMatch(
      pillsBlock[1],
      /label:\s*["']Workshop["']/,
      "F4D-P3-NAV: Workshop is not a current nav target",
    );
  });

  it("every chrome pill id exists as data-region in the expanded dashboard", () => {
    const chromeJs = readRoot("flowing-chrome.js");
    const expanded = expandIndexIncludes(readRoot("index.html"), repoRoot);
    const ids = [...chromeJs.matchAll(/\{\s*id:\s*"([^"]+)"\s*,\s*label:\s*"[^"]+"\s*,\s*num:/g)].map(
      (m) => m[1],
    );
    assert.ok(ids.length >= 3, "expected Brief / Pipeline / Dossier pills");
    const missing = ids.filter((id) => !expanded.includes(`data-region="${id}"`));
    assert.deepEqual(
      missing,
      [],
      `F4D-P3-NAV: chrome pills with no data-region host: ${missing.join(", ")}`,
    );
  });

  it("settings flowing-layout hint names live regions, not Letter", () => {
    const settings = readRoot("settings-jb-v2-tab.js");
    assert.doesNotMatch(
      settings,
      /Brief \/ Pipeline \/ Letter/,
      "F4D-P3-NAV: settings copy still advertises the retired Letter region",
    );
  });
});
