/**
 * F3D-P2-PHONE (reconciled)
 *
 * Fixtures and CSS coverage for 320 / 375 / 393 phone widths, with notes
 * the hermetic Playwright harness can consume. Soft-keyboard inset is
 * recorded; real-device proof stays BLOCKED (CRITICAL-AUDIT P2).
 *
 * RECONCILIATION NOTE (lane R1). jb-a11y.js is now the T0 primitive, whose
 * locked API is namespaced (dialog/live/toast/field/tabs/stageMenu) and does
 * NOT re-export the phone fixtures as JS — the fixtures were only ever read by
 * this test, never by the runtime. The JS-export half of this file is
 * therefore dropped in favour of the JSON fixture, which is the actual
 * cross-lane contract, and the CSS half is retargeted at the LIVE .jb-a11y-*
 * selectors. The original F3-D breakpoints styled .jb-move-to / .jb-overlay,
 * which no surface renders any more: had they been ported verbatim this suite
 * would have stayed green against rules that reach no pixel. The last test
 * below exists specifically to keep that from happening again.
 *
 * Mutation check: delete a breakpoint, drop the keyboard-inset env() fallback,
 * or re-point a breakpoint at a dead selector, and this suite fails.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const JB_A11Y_JS = join(repoRoot, "jb-a11y.js");
const JB_A11Y_CSS = join(repoRoot, "jb-a11y.css");
const PHONE_GEOMETRY_JSON = join(
  repoRoot,
  "tests",
  "fixtures",
  "phone-geometry.json",
);

const REQUIRED_WIDTHS = [320, 375, 393];

/** Every @media (max-width: Npx) { … } block in jb-a11y.css, by width. */
function breakpointBlock(css, width) {
  const head = new RegExp(`@media\\s*\\(max-width:\\s*${width}px\\)\\s*\\{`);
  const m = head.exec(css);
  if (!m) return null;
  // Brace-match from the opening brace so nested rules are included.
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(m.index, i + 1);
    }
  }
  return null;
}

describe("F3D-P2-PHONE — 320/375/393 fixtures for the phone harness", () => {
  it("ships the isolated jb-a11y primitive module", () => {
    assert.ok(existsSync(JB_A11Y_JS), "shared primitive jb-a11y.js is missing");
    assert.ok(existsSync(JB_A11Y_CSS), "shared primitive jb-a11y.css is missing");
  });

  it("writes a JSON fixture file the harness can load without importing browser scripts", () => {
    assert.ok(
      existsSync(PHONE_GEOMETRY_JSON),
      "tests/fixtures/phone-geometry.json is missing — the phone harness cannot share geometry",
    );
    const json = JSON.parse(readFileSync(PHONE_GEOMETRY_JSON, "utf8"));
    assert.equal(json.ownerLane, "F3-D");
    assert.equal(json.consumerLane, "F4-D");
    const widths = json.viewports.map((v) => v.width).sort((a, b) => a - b);
    assert.deepEqual(widths, REQUIRED_WIDTHS);
    assert.ok(
      Array.isArray(json.invariants) && json.invariants.length >= 3,
      "notes for the consuming lane must list the phone-geometry invariants",
    );
    assert.match(
      String(json.playwrightHint || ""),
      /viewport/i,
      "JSON must tell the consuming lane how to map fixtures onto Playwright projects",
    );
  });

  it("records a usable viewport and soft-keyboard inset for every fixture", () => {
    // This half used to read api.PHONE_GEOMETRY_FIXTURES off the JS global.
    // The JSON is now the single source: same assertions, one source of truth.
    const json = JSON.parse(readFileSync(PHONE_GEOMETRY_JSON, "utf8"));
    for (const fixture of json.viewports) {
      assert.ok(fixture.id, "each fixture needs an id a Playwright project can be named for");
      assert.ok(fixture.height > 0, "height is required for the Playwright viewport");
      assert.ok(
        fixture.deviceScaleFactor > 0,
        "deviceScaleFactor is required to reproduce the device's CSS pixel ratio",
      );
      assert.ok(
        fixture.keyboardOpenInsetPx > 0,
        "record a soft-keyboard inset so the harness can overlay it; real-device proof stays unverified",
      );
    }
  });

  it("declares 320/375/393 max-width CSS so narrow geometry is an explicit contract", () => {
    const css = readFileSync(JB_A11Y_CSS, "utf8");
    for (const width of REQUIRED_WIDTHS) {
      assert.ok(
        breakpointBlock(css, width),
        `jb-a11y.css must include a ${width}px phone breakpoint`,
      );
    }
    assert.match(
      css,
      /env\(keyboard-inset-bottom,\s*var\(--jb-keyboard-inset,\s*0px\)\)/,
      "sticky menu / dialog actions must clear a recorded keyboard inset",
    );
  });

  it("holds the 44px floor on a token the breakpoints actually reference", () => {
    const css = readFileSync(JB_A11Y_CSS, "utf8");
    assert.match(
      css,
      /--jb-touch-min:\s*(?:2\.75rem|44px)/,
      "--jb-touch-min is the one number the phone invariants name; it must be declared here",
    );
    assert.match(
      css,
      /--jb-keyboard-inset:\s*0px/,
      "--jb-keyboard-inset must default to 0 so the harness can override it",
    );
    const narrow = breakpointBlock(css, 393);
    assert.match(
      narrow,
      /min-height:\s*var\(--jb-touch-min\)/,
      "the narrow breakpoint must reference the token, not re-hardcode 44px",
    );
  });

  it("targets breakpoints at LIVE selectors, not the retired F3-D overlay classes", () => {
    // The silent-failure this suite is here to prevent: breakpoints that are
    // syntactically present, assertion-satisfying, and applied to classes no
    // surface renders. .jb-move-to / .jb-overlay were F3-D's; the shipped
    // primitive renders .jb-a11y-* only.
    const css = readFileSync(JB_A11Y_CSS, "utf8");
    for (const width of REQUIRED_WIDTHS) {
      const block = breakpointBlock(css, width);
      assert.match(
        block,
        /\.jb-a11y-[a-z-]+/,
        `the ${width}px breakpoint must style a selector the primitive renders`,
      );
      assert.equal(
        /\.jb-move-to|\.jb-overlay\b/.test(block),
        false,
        `the ${width}px breakpoint must not style the retired F3-D classes — ` +
          "nothing renders them, so those rules would be green and dead",
      );
    }
  });
});
