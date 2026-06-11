// Pin test: a11y focus + keyboard + accessible names across the first-run
// wizard, onboarding wizard, settings modal, and the inputs surfaced by the
// /tmp/qsweep2/a11y-audit.mjs round-2 audit.
//
// Why source-shape pins? The wiring is browser-only (focus, keydown, inert),
// loaded by the dev server at runtime — a regression would silently drop the
// trap and dump Tab back into the login gate. These pins fail loudly at the
// source level before that ships. The live browser run (qsweep2 audit + the
// hand screenshot at /tmp/qsweep2/focus-trap-after.png) covers the behavior.
//
// Mutation check: every describe block has a deliberately tight phrase that
// breaks if someone removes the wiring (e.g. drops `applyFirstRunInertBackground`
// from showFirstRunWizard, or strips the aria-label off the OAuth inputs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const firstRunJs = readFileSync(
  join(repoRoot, "first-run-wizard.js"),
  "utf8",
);
const onboardingJs = readFileSync(
  join(repoRoot, "onboarding-wizard.js"),
  "utf8",
);
const settingsJs = readFileSync(join(repoRoot, "settings-modal.js"), "utf8");
const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");
const profileMaterialsHtml = readFileSync(
  join(repoRoot, "partials", "profile-materials-modal.html"),
  "utf8",
);
const discoveryDrawerHtml = readFileSync(
  join(repoRoot, "partials", "discovery-drawer.html"),
  "utf8",
);
const resumeGenerationModalsHtml = readFileSync(
  join(repoRoot, "partials", "resume-generation-modals.html"),
  "utf8",
);

describe("first-run wizard — focus + inert + restore", () => {
  it("saves the opener and applies inert to background siblings on show", () => {
    assert.match(
      firstRunJs,
      /let lastOpener = null/,
      "module-scope lastOpener must be declared",
    );
    assert.match(
      firstRunJs,
      /let inertedSiblings = \[\]/,
      "module-scope inertedSiblings cache must be declared",
    );
    assert.match(
      firstRunJs,
      /function applyFirstRunInertBackground/,
      "applyFirstRunInertBackground helper must exist",
    );
    assert.match(
      firstRunJs,
      /lastOpener = document\.activeElement/,
      "showFirstRunWizard must save the previously-focused element",
    );
    assert.match(
      firstRunJs,
      /applyFirstRunInertBackground\(w\)/,
      "showFirstRunWizard must inert the background when first shown",
    );
    assert.match(
      firstRunJs,
      /focusFirstRunOpenTarget\(/,
      "showFirstRunWizard must auto-focus the active step's target",
    );
  });

  it("hides release inert and restores focus to the opener", () => {
    assert.match(
      firstRunJs,
      /releaseFirstRunInertBackground\(\)/,
      "hideFirstRunWizard must release the inert mark on background siblings",
    );
    assert.match(
      firstRunJs,
      /lastOpener\.focus\(\{ preventScroll: true \}\)/,
      "hideFirstRunWizard must restore focus to the opener with preventScroll",
    );
  });

  it("focuses #firstRunCreateSheetBtn on step 1 and the first provider radio on step 2", () => {
    // The brief's documented targets — break-the-name test fails if anyone
    // edits the focus map silently.
    assert.match(
      firstRunJs,
      /getEl\("firstRunCreateSheetBtn"\)/,
      "step 1 must focus the Create Sheet primary CTA",
    );
    assert.match(
      firstRunJs,
      /getEl\("firstRunProviderOpenRouter"\)/,
      "step 2 must focus the first provider radio (OpenRouter is the cold-start preselect)",
    );
  });
});

describe("onboarding wizard — focus + inert + Escape", () => {
  it("declares opener cache, inert cache, and Escape handler holder at module scope", () => {
    assert.match(onboardingJs, /let onboardingLastOpener = null/);
    assert.match(onboardingJs, /let onboardingInertedSiblings = \[\]/);
    assert.match(onboardingJs, /let onboardingEscapeHandler = null/);
  });

  it("saves the opener, applies inert, and registers Escape on show", () => {
    assert.match(
      onboardingJs,
      /onboardingLastOpener = document\.activeElement/,
      "showOnboardingWizard must capture document.activeElement",
    );
    assert.match(
      onboardingJs,
      /applyOnboardingInertBackground\(w\)/,
      "showOnboardingWizard must inert background siblings",
    );
    assert.match(
      onboardingJs,
      /onboardingEscapeHandler = \(e\) => \{[\s\S]*?e\.key === "Escape"/,
      "showOnboardingWizard must install an Escape keydown handler",
    );
    assert.match(
      onboardingJs,
      /\.btn-materials-upload/,
      "showOnboardingWizard must target the upload label (.btn-materials-upload) on open",
    );
  });

  it("releases inert, removes the Escape listener, and restores focus on hide", () => {
    assert.match(
      onboardingJs,
      /releaseOnboardingInertBackground\(\)/,
      "hideOnboardingWizard must release the inert mark",
    );
    assert.match(
      onboardingJs,
      /document\.removeEventListener\("keydown", onboardingEscapeHandler\)/,
      "hideOnboardingWizard must remove the Escape keydown listener",
    );
    assert.match(
      onboardingJs,
      /onboardingLastOpener\.focus\(\{ preventScroll: true \}\)/,
      "hideOnboardingWizard must restore focus to the opener",
    );
  });
});

describe("settings modal — focus + inert + Escape", () => {
  it("declares opener cache, inert cache, and Escape holder at module scope", () => {
    assert.match(settingsJs, /let settingsLastOpener = null/);
    assert.match(settingsJs, /let settingsInertedSiblings = \[\]/);
    assert.match(settingsJs, /let settingsEscapeHandler = null/);
  });

  it("saves the opener, applies inert, registers Escape, and focuses the close button on open", () => {
    assert.match(
      settingsJs,
      /settingsLastOpener = document\.activeElement/,
      "openCommandCenterSettingsModal must capture document.activeElement BEFORE closeAuthUserMenu",
    );
    assert.match(
      settingsJs,
      /applySettingsInertBackground\(modal\)/,
      "openCommandCenterSettingsModal must inert background siblings",
    );
    assert.match(
      settingsJs,
      /settingsEscapeHandler = \(e\) => \{[\s\S]*?e\.key === "Escape"/,
      "openCommandCenterSettingsModal must install an Escape keydown handler",
    );
    assert.match(
      settingsJs,
      /document\.getElementById\("settingsModalClose"\)/,
      "openCommandCenterSettingsModal must target #settingsModalClose for auto-focus",
    );
  });

  it("releases inert, removes the Escape listener, and restores focus on close", () => {
    assert.match(
      settingsJs,
      /releaseSettingsInertBackground\(\)/,
      "closeCommandCenterSettingsModal must release the inert mark",
    );
    assert.match(
      settingsJs,
      /document\.removeEventListener\("keydown", settingsEscapeHandler\)/,
      "closeCommandCenterSettingsModal must remove the Escape keydown listener",
    );
    assert.match(
      settingsJs,
      /settingsLastOpener\.focus\(\{ preventScroll: true \}\)/,
      "closeCommandCenterSettingsModal must restore focus to the opener",
    );
  });
});

describe("accessible names — login gate OAuth inputs", () => {
  it("both OAuth Client ID inputs carry aria-label='Google OAuth Client ID'", () => {
    // Use aria-label (not aria-labelledby) because the visible H1 is shared
    // between the two inputs — labelledby would name them identically and
    // confuse screen readers (audit-results.json formFieldsMissingLabels).
    const mainInput = indexHtml.match(
      /id="sheetAccessGateOAuthClientIdInput"[^>]*aria-label="Google OAuth Client ID"/,
    );
    assert.ok(
      mainInput,
      "#sheetAccessGateOAuthClientIdInput must have aria-label='Google OAuth Client ID'",
    );
    const altInput = indexHtml.match(
      /id="sheetAccessGateOAuthClientIdInputAlt"[^>]*aria-label="Google OAuth Client ID"/,
    );
    assert.ok(
      altInput,
      "#sheetAccessGateOAuthClientIdInputAlt must have aria-label='Google OAuth Client ID'",
    );
  });
});

describe("accessible names — dashboard search + sort", () => {
  it("#searchInput has aria-label='Search pipeline'", () => {
    assert.match(
      indexHtml,
      /id="searchInput"[\s\S]*?aria-label="Search pipeline"/,
    );
  });
  it("#sortSelect has aria-label='Sort pipeline by'", () => {
    assert.match(
      indexHtml,
      /id="sortSelect"[^>]*aria-label="Sort pipeline by"/,
    );
  });
});

describe("accessible names — profile materials modal inputs", () => {
  for (const id of [
    "materialsPasteText",
    "materialsLinkedInText",
    "sampleTitle",
    "sampleTags",
    "sampleText",
    "materialsAiDumpText",
  ]) {
    it(`#${id} carries an aria-label`, () => {
      assert.match(
        profileMaterialsHtml,
        new RegExp(`id="${id}"[\\s\\S]*?aria-label="`),
        `#${id} must have an aria-label so screen readers announce its purpose`,
      );
    });
  }
});

describe("accessible names — discovery drawer + resume-generation modal inputs", () => {
  for (const id of [
    "dpCompanyAllowlistInput",
    "dpCompanyBlocklistInput",
    "dpJobUrl",
  ]) {
    it(`#${id} carries an aria-label`, () => {
      assert.match(
        discoveryDrawerHtml,
        new RegExp(`id="${id}"[\\s\\S]*?aria-label="`),
        `#${id} must have an aria-label`,
      );
    });
  }
  it("#draftNotesInput carries an aria-label (lives in resume-generation-modals.html)", () => {
    assert.match(
      resumeGenerationModalsHtml,
      /id="draftNotesInput"[\s\S]*?aria-label="/,
    );
  });
});
