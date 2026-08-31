/**
 * F2-A named red claims:
 *   F2A-PIPE01-ONE  — Pipeline is the only v2 board; Lattice is off.
 *   F2A-PIPE01-RACE — modules that return early when !body.jb-v2 at
 *                     interactive must remount once the class is added.
 *
 * The boot helper is the isolated remount contract. index.html wiring
 * is orchestrator-owned; these tests load the helper in a VM and do
 * not require the script tag to land.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = join(repoRoot, "jb-v2-boot-contract.js");

function makeClassList(initial) {
  const set = new Set(String(initial || "").split(/\s+/).filter(Boolean));
  return {
    contains(name) {
      return set.has(name);
    },
    add(name) {
      set.add(name);
    },
    remove(name) {
      set.delete(name);
    },
    toString() {
      return [...set].join(" ");
    },
  };
}

function loadBoot({ className = "" } = {}) {
  assert.equal(
    existsSync(helperPath),
    true,
    "F2A-PIPE01-RACE: jb-v2-boot-contract.js must exist so Pipeline/Scribe can remount after body.jb-v2 is added",
  );
  const body = {
    classList: makeClassList(className),
    get className() {
      return this.classList.toString();
    },
  };
  const document = {
    body,
    readyState: "complete",
    addEventListener() {},
    querySelector(sel) {
      return { id: sel, innerHTML: sel.includes("lattice") ? "LATTICE-BOARD" : "EMPTY" };
    },
  };
  const window = { document };
  vm.runInNewContext(readFileSync(helperPath, "utf8"), {
    window,
    document,
    console,
    MutationObserver: undefined,
  });
  assert.ok(
    window.JobBoredV2Boot,
    "F2A-PIPE01-RACE: helper must expose window.JobBoredV2Boot",
  );
  return { boot: window.JobBoredV2Boot, document, window };
}

describe("F2A-PIPE01-ONE: one canonical v2 board", () => {
  it("names Pipeline as the canonical board and Lattice as the losing renderer", () => {
    const { boot } = loadBoot({ className: "jb-v2" });
    assert.equal(boot.CANONICAL_BOARD, "pipeline");
    assert.equal(boot.LOSING_BOARD, "lattice");
  });

  it("plans Pipeline+Scribe on and Lattice off when body.jb-v2 is present", () => {
    const { boot, document } = loadBoot({ className: "jb-v2" });
    const plan = boot.planMounts(document);
    assert.equal(plan.pipeline, true, "Pipeline must mount as the canonical v2 board");
    assert.equal(plan.scribe, true, "Scribe must remount with the v2 class");
    assert.equal(plan.lattice, false, "Lattice must not remain a competing v2 board");
    assert.equal(plan.chrome, true, "flowing chrome activation rides the same class");
  });

  it("plans every v2 surface off when the class is absent", () => {
    const { boot, document } = loadBoot({ className: "" });
    const plan = boot.planMounts(document);
    assert.equal(plan.pipeline, false);
    assert.equal(plan.scribe, false);
    assert.equal(plan.lattice, false);
    assert.equal(plan.chrome, false);
  });

  it("remount calls lattice.unmount even when Pipeline mounts", () => {
    const { boot, document } = loadBoot({ className: "jb-v2" });
    const calls = [];
    boot.remount(document, {
      pipeline: {
        mount() {
          calls.push("pipeline.mount");
        },
        unmount() {
          calls.push("pipeline.unmount");
        },
      },
      scribe: {
        mount() {
          calls.push("scribe.mount");
        },
        unmount() {
          calls.push("scribe.unmount");
        },
      },
      lattice: {
        mount() {
          calls.push("lattice.mount");
        },
        unmount() {
          calls.push("lattice.unmount");
        },
      },
    });
    assert.ok(calls.includes("pipeline.mount"), "canonical board must mount");
    assert.ok(calls.includes("scribe.mount"), "scribe must remount with the class");
    assert.ok(calls.includes("lattice.unmount"), "losing board must unmount");
    assert.equal(calls.includes("lattice.mount"), false, "Lattice must not mount as a competing board");
  });
});

describe("F2A-PIPE01-RACE: remount after late body.jb-v2", () => {
  it("replays mount when the class appears after an interactive early-return", () => {
    const { boot, document } = loadBoot({ className: "" });
    const calls = [];
    const adapters = {
      pipeline: {
        mount() {
          calls.push("pipeline.mount");
        },
        unmount() {
          calls.push("pipeline.unmount");
        },
      },
      scribe: {
        mount() {
          calls.push("scribe.mount");
        },
        unmount() {
          calls.push("scribe.unmount");
        },
      },
      lattice: {
        mount() {
          calls.push("lattice.mount");
        },
        unmount() {
          calls.push("lattice.unmount");
        },
      },
    };

    // Interactive: class not present yet (the known jb-v2 race).
    boot.remount(document, adapters);
    assert.equal(
      calls.includes("pipeline.mount"),
      false,
      "must not mount Pipeline while body.jb-v2 is missing",
    );
    assert.equal(
      calls.includes("scribe.mount"),
      false,
      "must not mount Scribe while body.jb-v2 is missing",
    );

    // DOMContentLoaded / settings toggle adds the class after early return.
    document.body.classList.add("jb-v2");
    boot.remount(document, adapters);

    assert.ok(
      calls.includes("pipeline.mount"),
      "F2A-PIPE01-RACE: Pipeline must remount once body.jb-v2 is added",
    );
    assert.ok(
      calls.includes("scribe.mount"),
      "F2A-PIPE01-RACE: Scribe must remount once body.jb-v2 is added",
    );
    assert.ok(
      calls.includes("lattice.unmount"),
      "F2A-PIPE01-RACE: Lattice stays unwired after the class appears",
    );
    assert.equal(calls.includes("lattice.mount"), false);
  });
});
