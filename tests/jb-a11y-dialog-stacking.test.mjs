/**
 * tests/jb-a11y-dialog-stacking.test.mjs
 *
 * Claim A11Y-02 (stacking half) — stacked dialogs must not leak.
 *
 * WHY this pin exists: the T0 audit found a concrete leak. settings-modal.js
 * inerts <body> CHILDREN at open time (settings-modal.js:49-67). The Fit Profile
 * wizard then creates #fitProfileWizard and appends it to <body> AFTER that
 * snapshot (fit-profile-wizard.js:986-998), so:
 *
 *   1. the new dialog was never in the inert set (fine, it must stay live), but
 *   2. the settings modal itself was never inerted either — it is a body child
 *      that the snapshot deliberately skipped — so a screen-reader user can Tab
 *      straight back into the modal underneath the wizard, and
 *   3. closing the wizard returns focus to the settings modal's ORIGINAL opener
 *      (the header gear), dumping the user out of the still-open modal.
 *
 * The locked API (T0-SUBSTRATE.md §2) fixes this with a LIFO stack that
 * RE-SCANS body children on each open and explicitly inerts the parent dialog.
 * These are behavioral claims, so this file executes the real jb-a11y.js in the
 * hand-rolled DOM (tests/fixtures/jb-a11y-dom.mjs) rather than pinning source.
 *
 * Claim classification (mirrored in JB-A11Y.md):
 *   - vm-SIMULATED here: the inert set per depth, re-scan of late-appended
 *     nodes, focus handoff between stack levels, interleaved (out-of-order)
 *     close handling, Escape targeting the top of the stack only.
 *   - NEEDS-BROWSER: that the user agent actually blocks Tab/pointer/AT into an
 *     inert subtree, and that focus is visibly indicated at each depth.
 *
 * Mutation check: revert the primitive to a one-shot open-time snapshot (the
 * settings-modal.js behavior) and "dialog B inerts dialog A" fails; drop the
 * per-depth restore target and "closing B restores focus INTO A" fails.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadA11y } from "./fixtures/jb-a11y-dom.mjs";

/**
 * Reproduce the audited shape: a page, a settings-style dialog A already in the
 * DOM, and a wizard-style dialog B that is created and appended to <body> only
 * AFTER A has opened.
 */
function stackedScene() {
  const h = loadA11y();
  const page = h.make("div", { id: "appRoot" });
  const gear = h.make("button", { id: "gearBtn" }, page);

  const dialogA = h.make("div", { id: "settingsModal" });
  const aClose = h.make("button", { id: "settingsModalClose" }, dialogA);
  const aLaunch = h.make("button", { id: "settingsOpenFitProfile" }, dialogA);

  return { h, page, gear, dialogA, aClose, aLaunch };
}

/** Late-append a wizard dialog, exactly as fit-profile-wizard.js does. */
function appendLateDialog(h, id) {
  const dialogB = h.make("div", { id });
  const bClose = h.make("button", { id: id + "Close" }, dialogB);
  return { dialogB, bClose };
}

describe("JobBoredA11y.dialog — LIFO stack, the A11Y-02 leak", () => {
  it("inerts a parent dialog when a second dialog opens over it", () => {
    const { h, gear, dialogA } = stackedScene();
    gear.focus();
    h.api.dialog.open(dialogA);
    const { dialogB } = appendLateDialog(h, "fitProfileWizard");

    assert.equal(
      dialogA.inert,
      false,
      "precondition: the parent dialog is live while it is the only dialog",
    );

    h.api.dialog.open(dialogB);

    assert.equal(
      dialogA.inert,
      true,
      "A11Y-02: opening dialog B must inert dialog A — settings-modal.js's " +
        "open-time snapshot could never do this, so the modal stayed tabbable",
    );
    assert.equal(
      dialogB.inert,
      false,
      "the top-of-stack dialog must never inert itself",
    );
  });

  it("re-scans body children so a dialog appended after A opened is covered", () => {
    const { h, dialogA } = stackedScene();
    h.api.dialog.open(dialogA);

    // A decorative overlay that appears while A is open (a toast host, a coach
    // bubble). A's open-time snapshot cannot know about it.
    const lateSibling = h.make("div", { id: "lateOverlay" });
    assert.equal(
      lateSibling.inert,
      false,
      "precondition: the late sibling is live (A's snapshot predates it)",
    );

    const { dialogB } = appendLateDialog(h, "fitProfileWizard");
    h.api.dialog.open(dialogB);

    assert.equal(
      lateSibling.inert,
      true,
      "each open must RE-SCAN body children — nodes appended after the previous " +
        "dialog opened would otherwise stay reachable behind the top dialog",
    );
  });

  it("closing B restores focus INTO A, not to A's original opener", () => {
    const { h, gear, dialogA, aClose, aLaunch } = stackedScene();
    gear.focus();
    h.api.dialog.open(dialogA);
    assert.equal(
      h.document.activeElement,
      aClose,
      "precondition: opening A moved focus into A",
    );

    // The user tabs to the launch button inside A, then opens B from it.
    aLaunch.focus();
    const { dialogB, bClose } = appendLateDialog(h, "fitProfileWizard");
    const handleB = h.api.dialog.open(dialogB);
    assert.equal(
      h.document.activeElement,
      bClose,
      "precondition: opening B moved focus into B",
    );

    handleB.close();

    assert.equal(
      h.document.activeElement,
      aLaunch,
      "A11Y-02: closing B must return focus to the control INSIDE A that opened " +
        "it — today the wizard has no restore at all and focus lands on <body>",
    );
    assert.notEqual(
      h.document.activeElement,
      gear,
      "closing B must NOT jump the user out to A's own opener (the header gear)",
    );
  });

  it("un-inerts A when B closes, so the parent dialog becomes usable again", () => {
    const { h, dialogA } = stackedScene();
    h.api.dialog.open(dialogA);
    const { dialogB } = appendLateDialog(h, "fitProfileWizard");
    const handleB = h.api.dialog.open(dialogB);
    assert.equal(dialogA.inert, true, "precondition: A is inert under B");

    handleB.close();
    assert.equal(
      dialogA.inert,
      false,
      "closing the top dialog must hand control back to the parent dialog",
    );
  });

  it("keeps the background inert while any dialog remains open", () => {
    const { h, page, dialogA } = stackedScene();
    const handleA = h.api.dialog.open(dialogA);
    const { dialogB } = appendLateDialog(h, "fitProfileWizard");
    const handleB = h.api.dialog.open(dialogB);

    handleB.close();
    assert.equal(
      page.inert,
      true,
      "the page must stay inert while dialog A is still open",
    );

    handleA.close();
    assert.equal(
      page.inert,
      false,
      "the page must become live again only when the stack drains",
    );
  });

  it("Escape closes only the top of the stack", () => {
    const { h, dialogA, page } = stackedScene();
    const closed = [];
    h.api.dialog.open(dialogA, { onClose: () => closed.push("A") });
    const { dialogB } = appendLateDialog(h, "fitProfileWizard");
    h.api.dialog.open(dialogB, { onClose: () => closed.push("B") });

    h.press("Escape");
    assert.deepEqual(
      closed,
      ["B"],
      "one Escape must close exactly the top dialog, never the whole stack",
    );
    assert.equal(
      page.inert,
      true,
      "the background stays inert because dialog A is still open",
    );

    h.press("Escape");
    assert.deepEqual(
      closed,
      ["B", "A"],
      "the next Escape closes the now-top dialog",
    );
    assert.equal(page.inert, false, "the stack has drained; the page is live");
  });

  it("reports increasing depth in the opened events", () => {
    const { h, dialogA } = stackedScene();
    h.api.dialog.open(dialogA);
    const { dialogB } = appendLateDialog(h, "fitProfileWizard");
    h.api.dialog.open(dialogB);

    const depths = h.events
      .filter((e) => e.type === "jb:a11y:dialog:opened")
      .map((e) => e.detail.depth);
    assert.deepEqual(
      depths,
      [1, 2],
      "jb:a11y:dialog:opened must report stack depth so observers can tell " +
        "a nested dialog from a fresh one",
    );
  });
});

describe("JobBoredA11y.dialog — interleaved (out-of-order) close", () => {
  it("closing the PARENT first leaves the child dialog live and the page inert", () => {
    const { h, page, dialogA } = stackedScene();
    const handleA = h.api.dialog.open(dialogA);
    const { dialogB } = appendLateDialog(h, "fitProfileWizard");
    const handleB = h.api.dialog.open(dialogB);

    // Legit in this app: a hash-route change can close settings while the
    // wizard it launched is still on screen.
    handleA.close();

    assert.equal(
      dialogB.inert,
      false,
      "closing a non-top dialog must not inert the dialog still on screen",
    );
    assert.equal(
      page.inert,
      true,
      "the page must remain inert while the child dialog is still open",
    );

    handleB.close();
    assert.equal(
      page.inert,
      false,
      "the page becomes live only after the last dialog closes, whatever the order",
    );
  });

  it("Escape after an out-of-order close targets the surviving dialog", () => {
    const { h, dialogA } = stackedScene();
    const closed = [];
    const handleA = h.api.dialog.open(dialogA, {
      onClose: () => closed.push("A"),
    });
    const { dialogB } = appendLateDialog(h, "fitProfileWizard");
    h.api.dialog.open(dialogB, { onClose: () => closed.push("B") });

    handleA.close();
    h.press("Escape");
    assert.deepEqual(
      closed,
      ["A", "B"],
      "the stack must be repaired after an out-of-order close, so Escape still " +
        "finds the real top dialog instead of a stale entry",
    );
  });

  it("does not steal focus out of the top dialog when a background dialog closes", () => {
    const { h, gear, dialogA, aLaunch } = stackedScene();
    gear.focus();
    const handleA = h.api.dialog.open(dialogA);
    aLaunch.focus();
    const { dialogB, bClose } = appendLateDialog(h, "fitProfileWizard");
    const handleB = h.api.dialog.open(dialogB);
    assert.equal(h.document.activeElement, bClose, "precondition: focus is in B");

    handleA.close();
    assert.equal(
      h.document.activeElement,
      bClose,
      "closing a BACKGROUND dialog must leave focus where the user is — " +
        "restoring A's opener here would yank the user out of the open wizard",
    );

    handleB.close();
    assert.equal(
      h.document.activeElement,
      aLaunch,
      "closing the dialog that actually holds focus still restores its own opener",
    );
  });
});
