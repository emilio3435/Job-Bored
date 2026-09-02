/**
 * SIXBEATS-2 NEW-13 — the 500-px-tall toast.
 *
 * On the Path B boot the discovery-secret error toast rendered in a ~355 px
 * column with almost every line holding a single word, covered the gate's
 * headline and its "Set up JobBored for this account" button, and let its own
 * "Copy bootstrap command" button overlap its text.
 *
 * The mechanism is the flex row: `.toast-action-btn` is `white-space: nowrap`
 * and `flex-shrink: 0`, so a long action label eats the row and squeezes
 * `.toast-message` (flex-basis 0) down to near its min-content width — one
 * word per line. Capping the width alone does not fix that; the message
 * needs a real basis, and the row needs permission to wrap.
 *
 * The geometry is measured for real in tests/e2e-visual/fuel-and-polish.spec.mjs;
 * this file holds the rule that makes it possible.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "./oneflow-l4-harness.mjs";

const css = readFileSync(join(repoRoot, "style.css"), "utf8");

function ruleFor(selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} must exist in style.css`);
  return css.slice(at, css.indexOf("}", at));
}

describe("SIXBEATS2 NEW-13 · a long toast wraps like prose, not like a column", () => {
  it("caps the toast at a readable measure and lets the row wrap", () => {
    const toast = ruleFor(".toast");
    const maxWidth = /max-width:\s*(\d+)px/.exec(toast);
    assert.ok(maxWidth, ".toast must carry an explicit max-width");
    assert.ok(
      Number(maxWidth[1]) <= 420,
      `a toast wider than 420px stops being a toast (got ${maxWidth[1]}px)`,
    );
    assert.match(
      toast,
      /flex-wrap:\s*wrap/,
      "a nowrap action button on an unwrappable row is what starved the message",
    );
  });

  it("gives the message a real basis and a break of last resort", () => {
    const message = ruleFor(".toast-message");
    assert.match(
      message,
      /flex:\s*1\s+1\s+\d+px/,
      "flex-basis 0 lets the message shrink to one word per line",
    );
    assert.match(message, /overflow-wrap:\s*(break-word|anywhere)/);
  });
});
