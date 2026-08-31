/**
 * F3D-MOBILE01-MOVE
 *
 * Stage movement needs a visible 44px "Move to" action with keyboard and
 * screen-reader parity. Hover-only card actions and native drag are not
 * enough on a phone (CRITICAL-AUDIT MOBILE-01).
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

describe("F3D-MOBILE01-MOVE — visible 44px Move-to with keyboard/SR parity", () => {
  it("ships the isolated jb-a11y primitive module", () => {
    assertJbA11yModuleExists();
  });

  it("renders a visible Move to control that is a real button, not a hover-only title", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    const widget = api.createMoveToAction(document, { currentStage: "New" });
    document.body.appendChild(widget.root);
    assert.equal(widget.trigger.tagName, "BUTTON");
    assert.equal(widget.trigger.getAttribute("aria-label"), "Move to stage");
    assert.equal(widget.trigger.getAttribute("aria-haspopup"), "menu");
    assert.equal(widget.trigger.getAttribute("aria-expanded"), "false");
    assert.match(widget.trigger.textContent, /Move to/i);
    assert.equal(widget.trigger.hidden, false);
  });

  it("opens the stage menu from the keyboard (Enter) without requiring hover", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    let moved = null;
    const widget = api.createMoveToAction(document, {
      currentStage: "New",
      onMove(stage) {
        moved = stage;
      },
    });
    document.body.appendChild(widget.root);
    widget.trigger.focus();
    widget.handleKeydown(keyEvent("Enter"));
    assert.equal(widget.trigger.getAttribute("aria-expanded"), "true");
    assert.equal(widget.menu.hidden, false);
    assert.equal(widget.menu.getAttribute("role"), "menu");

    const items = widget.menu.querySelectorAll("button");
    assert.ok(items.length >= 8, "menu must list pipeline stages");
    for (const item of items) {
      assert.equal(item.getAttribute("role"), "menuitem");
    }

    widget.handleKeydown(keyEvent("ArrowDown"));
    widget.handleKeydown(keyEvent("Enter"));
    assert.ok(moved, "keyboard confirm must fire onMove");
    assert.notEqual(moved, "New");
  });

  it("pins 44px min touch targets in CSS and never hides the control behind :hover", () => {
    const css = readFileSync(JB_A11Y_CSS, "utf8");
    assert.match(
      css,
      /\.jb-move-to\s*\{[^}]*min-height:\s*44px/s,
      ".jb-move-to must be at least 44px tall",
    );
    assert.match(
      css,
      /\.jb-move-to\s*\{[^}]*min-width:\s*44px/s,
      ".jb-move-to must be at least 44px wide",
    );
    assert.doesNotMatch(
      css,
      /\.jb-move-to\s*\{[^}]*display:\s*none/s,
    );
    assert.doesNotMatch(
      css,
      /:hover[^{]*\.jb-move-to|\.jb-move-to[^{]*:\s*hover[^{]*display:\s*(?!none)/,
    );
    assert.equal(apiMinTouch(css), 44);
  });
});

function apiMinTouch(css) {
  const m = css.match(/--jb-touch-min:\s*(\d+)px/);
  assert.ok(m, "CSS must declare --jb-touch-min: 44px for F4-D to share");
  return Number(m[1]);
}
