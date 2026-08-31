/**
 * tests/jb-a11y-fit-profile-labels.test.mjs
 *
 * Claim A11Y-02 (labels half) — every Fit Profile field must be
 * PROGRAMMATICALLY labeled, not just visually labeled.
 *
 * WHY this pin exists: fit-profile-wizard.js builds eight `fp-field__label`
 * nodes with `el("label", { class: "fp-field__label" }, "…")` (lines 491, 509,
 * 538, 567, 872, 879, 929, 952 at the audited base). None carries `for`, and
 * none wraps its control, so a screen reader announces "edit text, blank" for
 * the primary narrative, the salary floor, the seniority select, and the rest.
 * wizard-dom.js appendWizardInput (:92-126) already gets this right — the fix is
 * to route these sites through the shared field helper instead.
 *
 * Two halves, deliberately:
 *   1. vm-SIMULATED — field.build / field.associate really produce a valid
 *      pairing (htmlFor↔id for labelable controls, aria-labelledby + role=group
 *      for composite widgets like the chip inputs and the radio group).
 *   2. SOURCE-PINNED — fit-profile-wizard.js actually calls them, at every site,
 *      with no bare `fp-field__label` left behind. This is a count-based pin:
 *      adding a NEW unassociated field regresses the count and fails.
 *
 * NEEDS-BROWSER (not claimed green here): that a real screen reader reads the
 * computed accessible name, and that clicking the label focuses the control.
 *
 * Mutation check: reintroduce one bare `el("label", { class: "fp-field__label" })`
 * and the source count pin fails; break the htmlFor/id pairing inside
 * field.build and the behavioral half fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadA11y, repoRoot } from "./fixtures/jb-a11y-dom.mjs";

const fitProfileJs = readFileSync(
  join(repoRoot, "fit-profile-wizard.js"),
  "utf8",
);

/** The eight audited field labels, by their visible text. */
const AUDITED_FIELD_LABELS = [
  "Target roles",
  "Target seniority",
  "Years of relevant experience",
  "Primary narrative",
  "Work mode",
  "Acceptable locations",
  "Salary floor (USD/year)",
  "Work authorization",
  "Skip titles",
];

describe("JobBoredA11y.field.build — label/control pairing", () => {
  it("returns {wrap, input} and pairs htmlFor with a generated id", () => {
    const h = loadA11y();
    const { wrap, input } = h.api.field.build({ label: "Primary narrative" });

    assert.ok(wrap, "field.build must return the wrapper element");
    assert.ok(input, "field.build must return the control element");

    const label = wrap.querySelector("label");
    assert.ok(label, "field.build must emit a <label>");
    assert.ok(input.id, "the control must receive an id even when none was given");
    assert.equal(
      label.getAttribute("for"),
      input.id,
      "label[for] must equal the control id — this is the whole point of A11Y-02",
    );
    assert.equal(
      label.textContent,
      "Primary narrative",
      "the visible label text must be preserved verbatim",
    );
  });

  it("honours an explicit id, matching wizard-dom.js appendWizardInput's shape", () => {
    const h = loadA11y();
    const { wrap, input } = h.api.field.build({
      label: "Salary floor (USD/year)",
      id: "fpSalaryFloor",
      type: "number",
      value: "180000",
    });
    assert.equal(input.id, "fpSalaryFloor", "an explicit id must be used as given");
    assert.equal(
      wrap.querySelector("label").getAttribute("for"),
      "fpSalaryFloor",
      "label[for] must follow the explicit id",
    );
    assert.equal(input.getAttribute("type"), "number", "opts.type must reach the input");
    assert.equal(input.value, "180000", "opts.value must seed the control");
  });

  it("generates unique ids so two builds never collide", () => {
    const h = loadA11y();
    const a = h.api.field.build({ label: "One" });
    const b = h.api.field.build({ label: "Two" });
    assert.notEqual(
      a.input.id,
      b.input.id,
      "duplicate ids would silently re-point one label at the other's control",
    );
  });

  it("emits a textarea for multiline and wires the hint via aria-describedby", () => {
    const h = loadA11y();
    const { wrap, input } = h.api.field.build({
      label: "Primary narrative",
      multiline: true,
      hint: "This goes verbatim into the LLM scoring prompt.",
    });
    assert.equal(
      input.tagName,
      "TEXTAREA",
      "multiline: true must produce a textarea (appendWizardInput parity)",
    );
    const hint = wrap.querySelector(".jb-a11y-field__hint");
    assert.ok(hint, "opts.hint must render a hint node");
    assert.equal(
      input.getAttribute("aria-describedby"),
      hint.id,
      "the hint must be programmatically attached, not just visually adjacent",
    );
  });

  it("calls onInput with the control's string value", () => {
    const h = loadA11y();
    const seen = [];
    const { input } = h.api.field.build({
      label: "Years",
      onInput: (v) => seen.push(v),
    });
    input.value = "12";
    input.dispatchEvent(new h.window.CustomEvent("input", { bubbles: true }));
    assert.deepEqual(
      seen,
      ["12"],
      "onInput must receive the value as a string (appendWizardInput contract)",
    );
  });
});

describe("JobBoredA11y.field.associate — existing markup, including composites", () => {
  it("pairs a bare label with a labelable control via for/id", () => {
    const h = loadA11y();
    const label = h.make("label", { class: "fp-field__label" });
    label.textContent = "Target seniority";
    const select = h.make("select", { class: "fp-select" });

    h.api.field.associate(label, select);

    assert.ok(select.id, "associate must mint an id when the control has none");
    assert.equal(
      label.getAttribute("for"),
      select.id,
      "associate must set label[for] to the control id",
    );
  });

  it("uses aria-labelledby + role=group for composite widgets", () => {
    const h = loadA11y();
    const label = h.make("label", { class: "fp-field__label" });
    label.textContent = "Acceptable locations";
    // The chip input and the radio group are <div> containers, not labelable
    // controls — label[for] on a <div> is inert, so they need a group name.
    const chipInput = h.make("div", { class: "fp-chip-input" });

    h.api.field.associate(label, chipInput);

    assert.ok(label.id, "the label needs an id to be referenced");
    assert.equal(
      chipInput.getAttribute("aria-labelledby"),
      label.id,
      "a composite must be named by aria-labelledby — label[for] on a div is a no-op",
    );
    assert.equal(
      chipInput.getAttribute("role"),
      "group",
      "the composite must expose a group role so the name has something to attach to",
    );
    assert.equal(
      label.getAttribute("for"),
      null,
      "no for= may be emitted at a non-labelable target (it would be dead markup)",
    );
  });

  it("does not overwrite an accessible name the markup already declares", () => {
    const h = loadA11y();
    const label = h.make("label", {});
    label.textContent = "Work mode";
    const group = h.make("div", { "aria-labelledby": "someExistingTitle" });
    h.api.field.associate(label, group);
    assert.equal(
      group.getAttribute("aria-labelledby"),
      "someExistingTitle",
      "associate must not clobber an existing aria-labelledby",
    );
  });

  it("is a safe no-op on missing arguments", () => {
    const h = loadA11y();
    assert.doesNotThrow(
      () => {
        h.api.field.associate(null, null);
        h.api.field.associate(h.make("label", {}), null);
      },
      "associate must tolerate a render path that produced no control " +
        "(the wizard hides the locations field for remote_only)",
    );
  });
});

describe("fit-profile-wizard.js — every audited label is associated (source pin)", () => {
  it("has no bare fp-field__label construction outside the helper", () => {
    // The audited base built nine of these inline. After the migration the
    // ONLY place that constructs one is fieldLabel(), which associates it.
    // Any other occurrence is an unassociated label: the exact A11Y-02 defect.
    const pattern =
      /el\(\s*["']label["']\s*,\s*\{\s*class:\s*["']fp-field__label["']\s*\}/g;
    const sites = [];
    let m;
    while ((m = pattern.exec(fitProfileJs)) !== null) sites.push(m.index);

    assert.equal(
      sites.length,
      1,
      `exactly one fp-field__label construction may exist (inside fieldLabel); found ${sites.length}`,
    );

    const helperStart = fitProfileJs.indexOf("function fieldLabel");
    assert.ok(helperStart >= 0, "the fieldLabel helper must exist");
    const helperEnd = fitProfileJs.indexOf("\n  }", helperStart);
    assert.ok(
      sites[0] > helperStart && sites[0] < helperEnd,
      "the surviving fp-field__label construction must live INSIDE fieldLabel — " +
        "anywhere else means a field site rebuilt a bare, unassociated label",
    );
  });

  it("routes label creation through a single associating helper", () => {
    assert.match(
      fitProfileJs,
      /function fieldLabel\s*\(/,
      "a single fieldLabel(text, control) helper keeps the association " +
        "impossible to forget at a new field site",
    );
    assert.match(
      fitProfileJs,
      /field\.associate\(/,
      "fieldLabel must delegate to JobBoredA11y.field.associate",
    );
  });

  it("still renders every audited field label text (no silent field loss)", () => {
    for (const text of AUDITED_FIELD_LABELS) {
      assert.ok(
        fitProfileJs.includes(JSON.stringify(text)) ||
          fitProfileJs.includes("'" + text + "'"),
        `the "${text}" field must survive the migration — the point is to label ` +
          "the existing fields, not to drop any",
      );
    }
  });

  it("keeps a local fallback so a missing jb-a11y.js degrades to today's behavior", () => {
    const helper = fitProfileJs.slice(
      fitProfileJs.indexOf("function fieldLabel"),
      fitProfileJs.indexOf("function fieldLabel") + 900,
    );
    assert.match(
      helper,
      /if\s*\(!?\s*\w+\)|\?\?|&&/,
      "fieldLabel must guard on the primitive being present — jb-a11y.js is a " +
        "separate <script> and the wizard must not hard-crash without it",
    );
  });
});
