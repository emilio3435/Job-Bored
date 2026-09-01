/**
 * tests/jb-a11y-dialog-containment.test.mjs
 *
 * Claim A11Y-01b (source half) — the two audited dialog surfaces must ADOPT the
 * shared primitive rather than keep hand-rolling (or omitting) containment.
 *
 * WHY source-shape pins here and not behavior? These two files are 1512 and 1771
 * lines of app code wired to Sheets, hash routing, IndexedDB and the discovery
 * worker; executing them in a hand-rolled DOM would prove nothing about a11y and
 * would break on the first unrelated dependency. The BEHAVIOR of the primitive
 * they call is proven for real in tests/jb-a11y-dialog-behavior.test.mjs and
 * tests/jb-a11y-dialog-stacking.test.mjs. What is left to guarantee is the
 * WIRING: that these surfaces route through the audited primitive instead of
 * regrowing their own. That is exactly what a source pin is for, and it is the
 * established idiom in this repo (tests/wizards-modal-a11y-focus.test.mjs pins
 * settings-modal.js / first-run-wizard.js / onboarding-wizard.js the same way).
 *
 * Scope note (T0 fence): fit-profile-wizard.js is migrated by lane P0-F and is
 * pinned as ADOPTED below. discovery-drawer.js is owned by lane P0-B this
 * phase, so its adoption is pinned as a documented GAP with the exact recipe in
 * the P0-F lane report — the pin records today's truth (no restore, no inert)
 * so nobody mistakes the drawer for fixed.
 *
 * Mutation check: revert fit-profile-wizard.js's ensureWizardRoot/openWizard to
 * the pre-migration shape and the adoption assertions fail; the drawer-gap
 * assertions fail the moment P0-B lands its migration, which is the signal to
 * promote them (the recipe is in the lane report).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { repoRoot, stripComments } from "./fixtures/jb-a11y-dom.mjs";

const fitProfileJs = readFileSync(
  join(repoRoot, "fit-profile-wizard.js"),
  "utf8",
);
const drawerJs = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");
// Negative pins (e.g. "not v2-scoped") must match code, not the header comment
// that explains the rule.
const a11yJs = stripComments(readFileSync(join(repoRoot, "jb-a11y.js"), "utf8"));

describe("jb-a11y.js — the primitive owns the containment mechanics", () => {
  it("lifts the settings-modal inert pattern into the shared dialog", () => {
    assert.match(
      a11yJs,
      /\.inert\s*=\s*true/,
      "the primitive must inert background nodes (settings-modal.js:49-67 pattern)",
    );
    assert.match(
      a11yJs,
      /\.inert\s*=\s*false/,
      "and must release them again — a leaked inert set makes the app dead",
    );
    assert.match(
      a11yJs,
      /focus\(\{\s*preventScroll:\s*true\s*\}\)/,
      "focus moves must pass { preventScroll: true } (settings-modal.js:617-630)",
    );
    assert.match(
      a11yJs,
      /addEventListener\(\s*["']keydown["']/,
      "Escape-to-close needs a document keydown listener",
    );
    assert.match(
      a11yJs,
      /["']Escape["']/,
      "the keydown handler must test for the Escape key by name",
    );
  });

  it("keeps a LIFO stack rather than a single open dialog", () => {
    assert.match(
      a11yJs,
      /stack/i,
      "A11Y-02 requires a dialog stack, not one module-scope 'current dialog'",
    );
  });

  it("is NOT scoped to body.jb-v2 — legacy modals depend on it", () => {
    assert.equal(
      /body\.jb-v2/.test(a11yJs),
      false,
      "jb-a11y.js must never gate on the v2 flag: the settings modal and the " +
        "wizards render in the legacy view, which is the audit's main user path",
    );
  });
});

describe("fit-profile-wizard.js — ADOPTED (this lane's migration)", () => {
  it("opens through JobBoredA11y.dialog.open instead of a bare appendChild", () => {
    const openWizard = fitProfileJs.slice(
      fitProfileJs.indexOf("function openWizard"),
      fitProfileJs.indexOf("function closeWizard"),
    );
    assert.ok(openWizard, "openWizard must exist to be audited");
    assert.match(
      openWizard,
      /dialog\.open\(\s*wizardEls\.root/,
      "openWizard must hand the wizard root to the shared dialog primitive — " +
        "before this lane it appended a role=dialog node with zero containment " +
        "(fit-profile-wizard.js:986-998)",
    );
    assert.match(
      openWizard,
      /opener:/,
      "openWizard must pass the captured opener so close() can restore focus",
    );
  });

  it("holds the dialog handle and closes through it", () => {
    assert.match(
      fitProfileJs,
      /wizardDialogHandle/,
      "the module must keep the dialog handle so closeWizard can release " +
        "inert + restore focus instead of just hiding the node",
    );
    const closeWizard = fitProfileJs.slice(
      fitProfileJs.indexOf("function closeWizard"),
      fitProfileJs.indexOf("/* \u2500\u2500 Hash routing"),
    );
    assert.match(
      closeWizard,
      /wizardDialogHandle/,
      "closeWizard must read the handle",
    );
    assert.match(
      closeWizard,
      /\.close\(\)/,
      "closeWizard must close via the handle — that is what releases inert and " +
        "restores focus; hiding the node alone leaves the page inert forever",
    );
  });

  it("feature-detects the primitive so a missing script degrades, never throws", () => {
    assert.match(
      fitProfileJs,
      /window\.JobBoredA11y/,
      "the wizard must read the global, not assume a bundler import",
    );
    assert.match(
      fitProfileJs,
      /function a11y\s*\(\)/,
      "a lazy a11y() accessor keeps script order safe (jb-a11y.js may load later)",
    );
  });

  it("no longer relies on document.body.style.overflow alone for modality", () => {
    assert.match(
      fitProfileJs,
      /JobBoredA11y/,
      "modality now comes from inert via the primitive; the overflow lock is " +
        "cosmetic scroll containment only",
    );
  });
});

describe("discovery-drawer.js — DOCUMENTED GAP (owned by lane P0-B)", () => {
  // These assertions pin TODAY'S TRUTH so the gap cannot be quietly forgotten.
  // They are expected to be flipped (to `assert.match`) in the same commit that
  // lands P0-B's drawer.open adoption — the exact recipe is in
  // evidence/t0/p0-f/LANE-REPORT-p0-f.md section "Hand-off recipes".
  it("still has no focus restore in closeDiscoveryDrawer", () => {
    const close = drawerJs.slice(drawerJs.indexOf("function closeDiscoveryDrawer"));
    const body = close.slice(0, close.indexOf("\n}\n") + 3);
    assert.ok(body.length > 0, "closeDiscoveryDrawer must exist to be audited");
    assert.equal(
      /focus\(/.test(body),
      false,
      "AUDIT GAP (A11Y-01b): closeDiscoveryDrawer restores no focus. When P0-B " +
        "adopts JobBoredA11y.drawer.open this assertion flips to a positive pin " +
        "for the handle-based close.",
    );
  });

  it("still has no inert containment while the drawer is open", () => {
    assert.equal(
      /\.inert\s*=/.test(drawerJs),
      false,
      "AUDIT GAP (A11Y-01b): the discovery drawer never inerts the page behind " +
        "it, so Tab walks straight out into the dashboard underneath.",
    );
  });

  it("uses the legacy detail-open body class the primitive's drawer reproduces", () => {
    assert.match(
      drawerJs,
      /classList\.(add|remove)\(["']detail-open["']\)/,
      "drawer.open/close must keep the 'detail-open' contract this file relies " +
        "on — the primitive reproduces it so the migration is behavior-preserving",
    );
    assert.match(
      a11yJs,
      /["']detail-open["']/,
      "the primitive must own the detail-open class for drawer.open",
    );
  });
});

describe("out-of-fence surfaces stay untouched this phase", () => {
  // tests/wizards-modal-a11y-focus.test.mjs regex-pins the internal focus wiring
  // of this module. Migrating it requires updating those pins in the same
  // change (F3-D follow-up), so P0-F deliberately leaves it alone.
  // (first-run-wizard.js and onboarding-wizard.js left this list with the
  // wizards themselves — ONE-FLOW-ONBOARDING-SPEC §7.)
  for (const file of ["settings-modal.js"]) {
    it(`${file} still owns its own focus wiring (pins in wizards-modal-a11y-focus stay green)`, () => {
      const src = readFileSync(join(repoRoot, file), "utf8");
      assert.equal(
        /JobBoredA11y/.test(src),
        false,
        `${file} must NOT adopt the primitive in T0 — tests/wizards-modal-a11y-focus.test.mjs ` +
          "pins its internal identifiers and would go red without an atomic pin update",
      );
    });
  }
});
