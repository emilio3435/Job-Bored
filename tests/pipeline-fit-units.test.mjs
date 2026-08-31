/**
 * F2A-PIPE03-FIT: fit values 1–10 are not rendered as percents;
 * unknown is distinct from zero.
 *
 * Production change that would make this fail: lattice.js labeling a
 * 1–10 score as "Fit N%", dawn-data.js coercing missing/0 onto the
 * 1–10 band, or formatFitLabel emitting a percent.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dawnDataSrc = readFileSync(join(repoRoot, "dawn-data.js"), "utf8");
const latticeJs = readFileSync(join(repoRoot, "lattice.js"), "utf8");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");
const companyCapJs = readFileSync(join(repoRoot, "company-cap.js"), "utf8");

function loadDawn() {
  const win = {};
  vm.runInNewContext(
    dawnDataSrc,
    {
      window: win,
      document: { implementation: null, getElementById() { return null; }, querySelectorAll() { return []; } },
      Date,
      Number,
      Object,
      String,
      parseInt,
      Math,
      isFinite,
      console,
    },
    { filename: "dawn-data.js" },
  );
  return win.JobBoredDawn.data;
}

function loadCap() {
  const win = {};
  vm.runInNewContext(companyCapJs, { window: win, console, Date }, { filename: "company-cap.js" });
  return win.JobBoredCompanyCap;
}

describe("F2A-PIPE03-FIT: normalize 1–10 units; unknown ≠ 0", () => {
  it("exposes normalizeFitUnits that keeps 1–10, maps percents, and separates unknown from zero", () => {
    const api = loadDawn();
    assert.equal(typeof api.normalizeFitUnits, "function", "dawn-data.js must export normalizeFitUnits on the fit VM");
    const n = api.normalizeFitUnits;
    function unitsEqual(actual, expected, message) {
      // VM-created objects fail deepStrictEqual across realms; compare fields.
      assert.equal(actual && actual.value, expected.value, message);
      assert.equal(actual && actual.unknown, expected.unknown, message);
    }

    unitsEqual(n(8), { value: 8, unknown: false });
    unitsEqual(n("8"), { value: 8, unknown: false });
    unitsEqual(n(10), { value: 10, unknown: false });
    unitsEqual(n(1), { value: 1, unknown: false });

    unitsEqual(n(0), { value: 0, unknown: false }, "explicit 0 is not unknown");
    unitsEqual(n(null), { value: null, unknown: true });
    unitsEqual(n(undefined), { value: null, unknown: true });
    unitsEqual(n(""), { value: null, unknown: true });
    unitsEqual(n("n/a"), { value: null, unknown: true });

    // 83 as a 0–100 percent saturates the 1–10 band if clamped; it must
    // convert to units (8) instead of becoming 10.
    unitsEqual(n(83), { value: 8, unknown: false });
    unitsEqual(n(0.8), { value: 8, unknown: false });
  });

  it("formatFitLabel renders 1–10 units, never percents, and unknown not zero", () => {
    const api = loadDawn();
    assert.equal(typeof api.formatFitLabel, "function", "dawn-data.js must export formatFitLabel");
    assert.equal(api.formatFitLabel(8), "8/10");
    assert.equal(api.formatFitLabel({ value: 8, unknown: false }), "8/10");
    assert.equal(api.formatFitLabel(null), "unknown");
    assert.equal(api.formatFitLabel({ value: null, unknown: true }), "unknown");
    assert.equal(api.formatFitLabel({ value: 0, unknown: false }), "0/10");
    assert.equal(api.formatFitLabel(8).includes("%"), false);
    assert.notEqual(api.formatFitLabel(null), "0");
    assert.notEqual(api.formatFitLabel(null), "0/10");
  });

  it("card VM keeps missing fit as null (not 0) and explicit 0 as 0", () => {
    const api = loadDawn();
    const missing = api._internal.readCard({
      getAttribute(name) {
        if (name === "data-stable-key") return "M";
        return null;
      },
      className: "kanban-card kanban-card--stage-new",
      querySelector() {
        return null;
      },
    });
    assert.equal(missing.fitScore, null, "missing data-fit must stay unknown, not 0");

    const zero = api._internal.readCard({
      getAttribute(name) {
        if (name === "data-stable-key") return "Z";
        if (name === "data-fit") return "0";
        return null;
      },
      className: "kanban-card kanban-card--stage-new",
      querySelector() {
        return null;
      },
    });
    assert.equal(zero.fitScore, 0, "explicit 0 must not be coerced onto the 1–10 band");

    const eight = api._internal.readCard({
      getAttribute(name) {
        if (name === "data-stable-key") return "E";
        if (name === "data-fit") return "8";
        return null;
      },
      className: "kanban-card kanban-card--stage-new",
      querySelector() {
        return null;
      },
    });
    assert.equal(eight.fitScore, 8);
  });

  it("Lattice no longer labels 1–10 fit as a percent", () => {
    assert.equal(
      /Fit "\s*\+\s*pct\s*\+\s*"%/.test(latticeJs),
      false,
      'lattice.js must not render label: "Fit " + pct + "%" — 1–10 units are not percents',
    );
    assert.match(
      latticeJs,
      /Fit .*\/10|"Fit "\s*\+\s*.*\s*\+\s*"\/10"/,
      "lattice.js fit label must use /10 units when a score is present",
    );
  });

  it("Pipeline sticker already uses units and unknown, never a percent label", () => {
    assert.match(pipelineJs, /fitNum == null \? "unknown"/);
    assert.match(pipelineJs, /fitNum \+ " of 10"/);
    assert.equal(pipelineJs.includes('Fit " + pct + "%"'), false);
  });

  it("company-cap ranking treats unknown as -Infinity and 0 as 0", () => {
    const cap = loadCap();
    assert.equal(cap.fitScoreOf({ fitScore: null }), -Infinity);
    assert.equal(cap.fitScoreOf({ fitScore: 0 }), 0);
    assert.notEqual(cap.fitScoreOf({ fitScore: 0 }), cap.fitScoreOf({ fitScore: null }));
  });
});
