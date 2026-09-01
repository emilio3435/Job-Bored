// Pin test: a11y focus + keyboard + accessible names across the settings
// modal and the inputs surfaced by the /tmp/qsweep2/a11y-audit.mjs round-2
// audit. (The first-run and onboarding wizard blocks left with those
// wizards — ONE-FLOW-ONBOARDING-SPEC §7.)
//
// Why source-shape pins? The wiring is browser-only (focus, keydown, inert),
// loaded by the dev server at runtime — a regression would silently drop the
// trap and dump Tab back into the login gate. These pins fail loudly at the
// source level before that ships. The live browser run (qsweep2 audit + the
// hand screenshot at /tmp/qsweep2/focus-trap-after.png) covers the behavior.
//
// Mutation check: every describe block has a deliberately tight phrase that
// breaks if someone removes the wiring (e.g. drops the settings modal's inert
// cache, or strips the aria-label off the OAuth inputs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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

// The first-run and onboarding wizards owned their own focus/inert/Escape
// wiring, pinned here. Both are deleted (ONE-FLOW-ONBOARDING-SPEC §7): every
// onboarding surface is a beat rendered through discovery-wizard-shell.js
// now, and the shell's containment is pinned in
// tests/discovery-wizard-shell.test.mjs.

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

describe("accessible names — Beat 1's OAuth Client ID input", () => {
  it("carries aria-label='Google OAuth Client ID'", () => {
    // The login gate used to ship TWO of these inputs, in its own
    // create-a-Client-ID sub-wizard. §7 deleted that surface; Beat 1 owns
    // the step, and it builds its input in JS rather than markup.
    const beat = readFileSync(
      join(repoRoot, "oneflow-beat-google.js"),
      "utf8",
    );
    assert.match(beat, /"aria-label": "Google OAuth Client ID"/);
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

describe("shared overlay primitive — wizards consume one owner", () => {
  // RECONCILIATION NOTE (lane R1): this block used to pin the F3-D flat API
  // (createOverlayOwner / announceToast / labelFitProfileControl /
  // createMoveToAction). jb-a11y.js is now the T0 primitive with the locked
  // namespaced API, and the four rules below are the same four rules on the
  // shipped names. The rest of this file is untouched.
  const a11yJs = readFileSync(join(repoRoot, "jb-a11y.js"), "utf8");
  const fitProfileJs = readFileSync(
    join(repoRoot, "fit-profile-wizard.js"),
    "utf8",
  );

  it("exposes ONE dialog owner rather than a per-module inert list", () => {
    assert.match(
      a11yJs,
      /dialog:\s*\{|dialog\.open|open:\s*openDialog/,
      "wizards must share one dialog owner instead of each keeping its own inert list",
    );
    assert.match(
      a11yJs,
      /\.inert\s*=\s*true/,
      "the shared owner is what applies inert — that is the containment mechanism",
    );
    assert.match(
      a11yJs,
      /stack/i,
      "a LIFO stack is what makes stacked wizards close in the right order",
    );
  });

  it("announces global toasts through the shared live region", () => {
    assert.match(
      a11yJs,
      /live[\s\S]{0,80}announce/,
      "global toasts must be announcible through the shared live-region helper",
    );
    assert.match(
      a11yJs,
      /aria-live/,
      "the helper must own a real aria-live region, not just a log call",
    );
  });

  it("labels controls through the shared field helper", () => {
    assert.match(
      a11yJs,
      /associate/,
      "Fit Profile inputs must be labelable through the shared helper",
    );
    assert.match(
      fitProfileJs,
      /field\.associate\(/,
      "the Fit Profile wizard must actually consume it — an unused helper " +
        "leaves the audited labels anonymous exactly as before",
    );
  });

  it("gives board cards a shared touch-sized stage action", () => {
    assert.match(
      a11yJs,
      /stageMenu/,
      "board cards need a shared, keyboard-operable stage action constructor",
    );
    assert.match(
      a11yJs,
      /jb-a11y-touch-target/,
      "that action must carry the shared 44px touch-target class",
    );
  });

  it("is consumed by the fit-profile wizard, not merely shipped", () => {
    // The silent failure this pins: jb-a11y.js loads, every wizard keeps its
    // own (absent) containment, and nothing fails.
    assert.match(
      fitProfileJs,
      /window\.JobBoredA11y/,
      "the wizard must read the shared global",
    );
    assert.match(
      fitProfileJs,
      /dialog\.open\(\s*wizardEls\.root/,
      "the wizard root must be handed to the shared dialog owner",
    );
  });
});
