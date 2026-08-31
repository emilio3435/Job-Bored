/**
 * F3D-P2-PHONE
 *
 * Fixtures and CSS coverage for 320 / 375 / 393 phone widths, with notes
 * the F4-D hermetic Playwright harness can consume. Soft-keyboard inset
 * is recorded; real-device proof stays BLOCKED (CRITICAL-AUDIT P2).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createFakeDom } from "./helpers/fake-dom.mjs";
import {
  assertJbA11yModuleExists,
  JB_A11Y_CSS,
  loadJobBoredA11y,
  PHONE_GEOMETRY_JSON,
} from "./helpers/load-jb-a11y.mjs";

const REQUIRED_WIDTHS = [320, 375, 393];

describe("F3D-P2-PHONE — 320/375/393 fixtures for F4-D", () => {
  it("ships the isolated jb-a11y primitive module", () => {
    assertJbA11yModuleExists();
  });

  it("exports PHONE_GEOMETRY_FIXTURES covering 320, 375, and 393", () => {
    const { document, window } = createFakeDom();
    const api = loadJobBoredA11y(document, window);
    const fixtures = Array.from(api.PHONE_GEOMETRY_FIXTURES || []);
    const widths = fixtures
      .map((f) => Number(f.width))
      .sort((a, b) => a - b);
    assert.deepEqual(widths, REQUIRED_WIDTHS);
    for (const fixture of fixtures) {
      assert.ok(fixture.id, "each fixture needs an id F4-D can name a project with");
      assert.ok(fixture.height > 0, "height is required for Playwright viewport");
      assert.ok(
        fixture.keyboardOpenInsetPx > 0,
        "record a soft-keyboard inset so F4-D can overlay it; real-device proof stays unverified",
      );
    }
  });

  it("writes a JSON fixture file F4-D can load without importing browser scripts", () => {
    assert.ok(
      existsSync(PHONE_GEOMETRY_JSON),
      "tests/fixtures/phone-geometry.json is missing — F4-D cannot share geometry",
    );
    const json = JSON.parse(readFileSync(PHONE_GEOMETRY_JSON, "utf8"));
    assert.equal(json.ownerLane, "F3-D");
    assert.equal(json.consumerLane, "F4-D");
    const widths = json.viewports.map((v) => v.width).sort((a, b) => a - b);
    assert.deepEqual(widths, REQUIRED_WIDTHS);
    assert.ok(
      Array.isArray(json.invariants) && json.invariants.length >= 3,
      "notes for F4-D must list the phone-geometry invariants",
    );
    assert.match(
      String(json.playwrightHint || ""),
      /viewport/i,
      "JSON must tell F4-D how to map fixtures onto Playwright projects",
    );
  });

  it("declares 320/375/393 max-width CSS so narrow geometry is an explicit contract", () => {
    const css = readFileSync(JB_A11Y_CSS, "utf8");
    for (const width of REQUIRED_WIDTHS) {
      assert.match(
        css,
        new RegExp(`@media\\s*\\(max-width:\\s*${width}px\\)`),
        `jb-a11y.css must include a ${width}px phone breakpoint`,
      );
    }
    assert.match(
      css,
      /env\(keyboard-inset-bottom,\s*var\(--jb-keyboard-inset,\s*0px\)\)/,
      "sticky Move-to / overlay actions must clear a recorded keyboard inset",
    );
  });
});
