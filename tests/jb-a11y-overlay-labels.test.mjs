/**
 * F3D-A11Y02-LABEL
 *
 * Fit Profile controls need programmatic names. Overlay ownership must be
 * singular. Stacked dialogs must keep the trap on the top layer.
 *
 * WHY: Fit Profile target-role inputs are placeholder-only (no aria-label /
 * <label>). Each wizard owns its own inert list, so a second overlay cannot
 * trap the first (CRITICAL-AUDIT A11Y-02).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeDom, keyEvent } from "./helpers/fake-dom.mjs";
import {
  assertJbA11yModuleExists,
  loadJobBoredA11y,
} from "./helpers/load-jb-a11y.mjs";

describe("F3D-A11Y02-LABEL — programmatic labels + overlay owner + stacked traps", () => {
  it("ships the isolated jb-a11y primitive module", () => {
    assertJbA11yModuleExists();
  });

  it("gives Fit Profile fields a programmatic accessible name", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    const role = document.createElement("input");
    api.labelFitProfileControl(role, "targetRole");
    assert.equal(role.getAttribute("aria-label"), "Target role");

    const narrative = document.createElement("textarea");
    api.labelFitProfileControl(narrative, "narrative");
    assert.equal(narrative.getAttribute("aria-label"), "Primary narrative");

    const notes = document.createElement("textarea");
    api.labelFitProfileControl(notes, "notes");
    assert.equal(notes.getAttribute("aria-label"), "Notes");
  });

  it("ensureControlLabel prefers aria-labelledby when an id is supplied", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    const input = document.createElement("input");
    api.ensureControlLabel(input, { labelledBy: "fpWizardTitle" });
    assert.equal(input.getAttribute("aria-labelledby"), "fpWizardTitle");
    assert.equal(input.getAttribute("aria-label"), null);
  });

  it("keeps a single overlay owner: only the top dialog is interactive", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    const owner = api.createOverlayOwner(document);

    const first = document.createElement("div");
    const firstBtn = document.createElement("button");
    first.appendChild(firstBtn);
    document.body.appendChild(first);

    const second = document.createElement("div");
    const secondBtn = document.createElement("button");
    second.appendChild(secondBtn);
    document.body.appendChild(second);

    owner.open({ root: first, initialFocus: firstBtn, label: "Fit Profile" });
    assert.equal(owner.depth(), 1);
    assert.equal(owner.top().root, first);

    owner.open({ root: second, initialFocus: secondBtn, label: "Confirm" });
    assert.equal(owner.depth(), 2);
    assert.equal(first.inert, true, "lower dialog must be inert while stacked");
    assert.equal(second.inert, false);
    assert.equal(document.activeElement, secondBtn);
  });

  it("closing the top stacked dialog restores focus into the lower dialog, not the page", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    const owner = api.createOverlayOwner(document);

    const pageBtn = document.createElement("button");
    pageBtn.id = "page";
    document.body.appendChild(pageBtn);
    pageBtn.focus();

    const first = document.createElement("div");
    const firstBtn = document.createElement("button");
    first.appendChild(firstBtn);
    document.body.appendChild(first);

    const second = document.createElement("div");
    const secondBtn = document.createElement("button");
    second.appendChild(secondBtn);
    document.body.appendChild(second);

    owner.open({ root: first, initialFocus: firstBtn, label: "Fit Profile" });
    owner.open({ root: second, initialFocus: secondBtn, label: "Stacked" });
    owner.close();
    assert.equal(owner.depth(), 1);
    assert.equal(first.inert, false);
    assert.equal(document.activeElement, firstBtn);
    assert.notEqual(document.activeElement, pageBtn);

    const esc = keyEvent("Escape");
    owner.handleKeydown(esc);
    assert.equal(owner.depth(), 0);
    assert.equal(document.activeElement, pageBtn);
  });
});
