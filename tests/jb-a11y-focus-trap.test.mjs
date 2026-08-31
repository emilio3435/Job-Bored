/**
 * F3D-A11Y01-LIVE
 *
 * Global toasts must be announced via a live region. Dialogs must contain
 * focus and restore it to the opener on close.
 *
 * WHY: auth-session showToast writes into #toastContainer with no aria-live;
 * wizards each roll their own inert lists. A shared primitive is the
 * required outcome (CRITICAL-AUDIT A11Y-01).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createFakeDom, keyEvent } from "./helpers/fake-dom.mjs";
import {
  assertJbA11yModuleExists,
  JB_A11Y_CSS,
  loadJobBoredA11y,
} from "./helpers/load-jb-a11y.mjs";

describe("F3D-A11Y01-LIVE — live region + focus containment/restore", () => {
  it("ships the isolated jb-a11y primitive module", () => {
    assertJbA11yModuleExists();
  });

  it("announces a success toast through a polite live region", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    api.announceToast(document, { message: "Saved to Pipeline", type: "success" });
    const live = document.getElementById("jb-live-region");
    assert.ok(live, "must create #jb-live-region");
    assert.equal(live.getAttribute("role"), "status");
    assert.equal(live.getAttribute("aria-live"), "polite");
    assert.equal(live.getAttribute("aria-atomic"), "true");
    assert.equal(live.textContent, "Saved to Pipeline");
  });

  it("announces an error toast assertively so a screen reader interrupts", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    api.announceToast(document, { message: "Sheet write failed", type: "error" });
    const live = document.getElementById("jb-live-region");
    assert.equal(live.getAttribute("aria-live"), "assertive");
    assert.equal(live.getAttribute("role"), "alert");
    assert.equal(live.textContent, "Sheet write failed");
  });

  it("traps Tab inside an open dialog and wraps last → first", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    const opener = document.createElement("button");
    opener.id = "opener";
    document.body.appendChild(opener);
    opener.focus();

    const dialog = document.createElement("div");
    const first = document.createElement("button");
    first.id = "first";
    const last = document.createElement("button");
    last.id = "last";
    dialog.appendChild(first);
    dialog.appendChild(last);
    document.body.appendChild(dialog);

    const owner = api.createOverlayOwner(document);
    owner.open({ root: dialog, initialFocus: first, label: "Example dialog" });
    assert.equal(document.activeElement, first);
    assert.equal(dialog.getAttribute("role"), "dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");

    last.focus();
    const tab = keyEvent("Tab");
    const handled = owner.handleKeydown(tab);
    assert.equal(handled, true);
    assert.equal(tab.defaultPrevented, true);
    assert.equal(document.activeElement, first);
  });

  it("restores focus to the opener when the dialog closes", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    const opener = document.createElement("button");
    opener.id = "opener";
    document.body.appendChild(opener);
    opener.focus();

    const dialog = document.createElement("div");
    const closeBtn = document.createElement("button");
    dialog.appendChild(closeBtn);
    document.body.appendChild(dialog);

    const owner = api.createOverlayOwner(document);
    owner.open({ root: dialog, initialFocus: closeBtn, label: "Close me" });
    assert.notEqual(document.activeElement, opener);
    owner.close();
    assert.equal(document.activeElement, opener);
  });

  it("visually hides the live region in CSS so toasts stay on-screen without duplicate visible copy", () => {
    const css = readFileSync(JB_A11Y_CSS, "utf8");
    assert.match(css, /\.jb-live-region\s*\{[^}]*clip(?:-path)?:/s);
    assert.match(
      css,
      /@media\s*\(prefers-reduced-motion:\s*reduce\)/s,
      "overlay motion must yield to prefers-reduced-motion",
    );
  });
});
