import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dawnDataSrc = readFileSync(join(repoRoot, "dawn-data.js"), "utf8");
const dawnRendererSrc = readFileSync(join(repoRoot, "dawn.js"), "utf8");

function textElement(text) {
  return { textContent: String(text || "") };
}

function makeStat(value, sub) {
  return {
    querySelector(selector) {
      if (selector === ".stat-card__value") return textElement(value);
      if (selector === ".stat-card__sub") return textElement(sub);
      return null;
    },
  };
}

function makeCard({ key, index, stage, title, company }) {
  return {
    className: `kanban-card kanban-card--stage-${stage}`,
    getAttribute(name) {
      if (name === "data-stable-key") return key;
      if (name === "data-index") return String(index);
      return null;
    },
    querySelector(selector) {
      if (selector === ".kanban-card__title") return textElement(title);
      if (selector === ".kanban-card__company") return textElement(company);
      return null;
    },
  };
}

function makeDoc() {
  const stats = [
    makeStat("99", "weekly hero should not drive By the numbers"),
    makeStat("88", "weekly hero should not drive By the numbers"),
    makeStat("77", "weekly hero should not drive By the numbers"),
    makeStat("66", "weekly hero should not drive By the numbers"),
  ];
  const cards = [
    makeCard({ key: "n1", index: 1, stage: "new", title: "Role 1", company: "A" }),
    makeCard({ key: "n2", index: 2, stage: "new", title: "Role 2", company: "B" }),
    makeCard({ key: "a1", index: 3, stage: "applied", title: "Role 3", company: "C" }),
    makeCard({ key: "p1", index: 4, stage: "phone-screen", title: "Role 4", company: "D" }),
    makeCard({ key: "i1", index: 5, stage: "interviewing", title: "Role 5", company: "E" }),
    makeCard({ key: "o1", index: 6, stage: "offer", title: "Role 6", company: "F" }),
  ];
  return {
    implementation: null,
    getElementById(id) {
      if (id === "briefStats") {
        return { querySelectorAll: (selector) => (selector === ".stat-card" ? stats : []) };
      }
      if (id === "briefDate") return textElement("Wed, May 20, 2026");
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".kanban-card[data-stable-key]") return cards;
      return [];
    },
  };
}

function loadDawnData(doc) {
  const win = {};
  vm.runInNewContext(dawnDataSrc, {
    window: win,
    document: doc,
    Date,
    Number,
    Object,
    String,
    parseInt,
    console,
  });
  return win.JobBoredDawn.data;
}

describe("Dawn By the numbers 30-day alignment", () => {
  it("derives By the numbers from the same rows as the 30-day funnel", () => {
    const api = loadDawnData(makeDoc());
    const vm = api.getDawnViewModel({ doc: makeDoc(), now: new Date("2026-05-20T12:00:00Z") });
    const stats = Object.fromEntries(vm.byTheNumbers.map((row) => [row.label, row]));

    assert.equal(stats["roles surfaced"].value, 2);
    assert.equal(stats.applications.value, 1);
    assert.equal(stats.interviews.value, 2);
    assert.equal(stats["offer live"].value, 1);
    assert.equal(vm.funnel30d.find((row) => row.kind === "discovered").count, stats["roles surfaced"].value);
    assert.equal(vm.funnel30d.find((row) => row.kind === "applied").count, stats.applications.value);
    assert.equal(
      vm.funnel30d.find((row) => row.kind === "phone_screen").count +
        vm.funnel30d.find((row) => row.kind === "interview").count,
      stats.interviews.value,
    );
    assert.equal(vm.funnel30d.find((row) => row.kind === "offer").count, stats["offer live"].value);
  });

  it("labels the renderer section with the same 30-day window", () => {
    assert.ok(
      dawnRendererSrc.includes("BY THE NUMBERS · LAST 30 DAYS"),
      "By the numbers heading should match the funnel window",
    );
    assert.equal(
      dawnRendererSrc.includes("BY THE NUMBERS · 7 DAYS"),
      false,
      "old weekly heading should not remain",
    );
  });
});
