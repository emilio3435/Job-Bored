/**
 * UX01 DS-05 / C3: Today's and the Brief's primary actions wear the C3 kit
 * (jb-ui.css .jb-btn--primary): the one navy fill, --jb-action, never a mint
 * pill or a raw navy. Static analysis; no DOM in this repo's unit tier.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function ruleBody(css, selector) {
  const at = css.indexOf(selector + " {");
  assert.notEqual(at, -1, "missing rule " + selector);
  return css.slice(at, css.indexOf("}", at));
}

it("should give Today's primary action the kit's primary fill and radius (DS-05)", () => {
  const css = readFileSync(join(repoRoot, "today.css"), "utf8");
  const body = ruleBody(css, 'body.jb-v2 [data-region="today"] .today-item__action');
  assert.match(body, /background: var\(--jb-action\)/);
  assert.match(body, /color: var\(--jb-on-action\)/);
  assert.match(body, /border-radius: var\(--jb-radius-md\)/);
  assert.match(body, /min-height: 2\.75rem/, "Today keeps its 44px touch target");
});

it("should give the Brief's primary action the kit's navy fill, not a mint pill (DS-05)", () => {
  const css = readFileSync(join(repoRoot, "dawn.css"), "utf8");
  const primary = ruleBody(css, 'body.jb-v2 [data-region="dawn"] .brief-btn--primary');
  assert.match(primary, /background: var\(--jb-action\)/);
  assert.match(primary, /color: var\(--jb-on-action\)/);
  assert.doesNotMatch(primary, /--jb-mint/);
  const base = ruleBody(css, 'body.jb-v2 [data-region="dawn"] .brief-btn');
  assert.match(base, /border-radius: var\(--jb-radius-md\)/);
  assert.doesNotMatch(base, /--jb-radius-pill/);
});
