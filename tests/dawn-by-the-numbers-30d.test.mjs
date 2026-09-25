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

function makeCard({ key, index, stage, title, company, found = null, applied = null }) {
  return {
    className: `kanban-card kanban-card--stage-${stage}`,
    getAttribute(name) {
      if (name === "data-stable-key") return key;
      if (name === "data-index") return String(index);
      if (name === "data-found-at") return found;
      if (name === "data-applied-at") return applied;
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
    makeCard({ key: "n1", index: 1, stage: "new", title: "Role 1", company: "A", found: "2026-05-10" }),
    makeCard({ key: "n2", index: 2, stage: "new", title: "Role 2", company: "B", found: "2026-03-01" }),
    makeCard({ key: "a1", index: 3, stage: "applied", title: "Role 3", company: "C", found: "2026-05-01", applied: "2026-05-12" }),
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
  /* UX01 TR-18: the funnel is a snapshot of where roles sit now, so the two
     "last 30 days" tiles are counted from Date Found and Applied Date, and
     the two stock tiles say they are "now". */
  it("should count roles surfaced and applications from their dates, not the current stage", () => {
    const api = loadDawnData(makeDoc());
    const vm = api.getDawnViewModel({ doc: makeDoc(), now: new Date("2026-05-20T12:00:00Z") });
    const stats = Object.fromEntries(vm.byTheNumbers.map((row) => [row.label, row]));

    assert.equal(stats["roles surfaced"].value, 2, "found 05-10 and 05-01 are in; 03-01 is not");
    assert.equal(stats["roles surfaced"].delta, "last 30 days");
    assert.equal(stats.application.value, 1, "one Applied Date in the window, singular label");
    assert.equal(stats.interviews.value, 2);
    assert.equal(stats.interviews.delta, "in play now");
    assert.equal(stats["offer live"].value, 1);
    assert.equal(stats["offer live"].delta, "open now");
    assert.equal(
      vm.funnel30d.find((row) => row.kind === "phone_screen").count +
        vm.funnel30d.find((row) => row.kind === "interview").count,
      stats.interviews.value,
    );
  });

  it("should make the deck repeat the tiles instead of a second count", () => {
    const api = loadDawnData(makeDoc());
    const vm = api.getDawnViewModel({ doc: makeDoc(), now: new Date("2026-05-20T12:00:00Z") });
    assert.match(vm.deckCopy, /^2 new roles in the last 30 days/);
    assert.doesNotMatch(vm.deckCopy, /99|fresh roles/);
  });

  it("should label the funnel as a snapshot and keep the 30-day heading off it", () => {
    assert.ok(dawnRendererSrc.includes("BY THE NUMBERS"), "the numbers card keeps its heading");
    assert.ok(dawnRendererSrc.includes("PIPELINE · IN STAGE NOW"), "the funnel says it is a snapshot");
    assert.equal(dawnRendererSrc.includes("FUNNEL · LAST 30 DAYS"), false, "the snapshot is not a 30-day funnel");
    assert.equal(dawnRendererSrc.includes("BY THE NUMBERS · 7 DAYS"), false, "old weekly heading should not remain");
  });
});

describe("Dawn lead follows the one next-step engine (TR-14)", () => {
  it("should lead with the role Today says is waiting on you, and name that step", () => {
    const todaySrc = readFileSync(join(repoRoot, "today-data.js"), "utf8");
    const cards = [
      {
        className: "kanban-card kanban-card--stage-new",
        getAttribute: (n) => ({ "data-stable-key": "0", "data-index": "0", "data-fit": "10" })[n] ?? null,
        querySelector: (sel) => (sel === ".kanban-card__title" ? textElement("Shiny") : sel === ".kanban-card__company" ? textElement("Echo") : null),
      },
      {
        className: "kanban-card kanban-card--stage-applied",
        getAttribute: (n) => ({ "data-stable-key": "1", "data-index": "1", "data-fit": "2", "data-replied": "Yes" })[n] ?? null,
        querySelector: (sel) => (sel === ".kanban-card__title" ? textElement("Replied") : sel === ".kanban-card__company" ? textElement("Acme") : null),
      },
    ];
    const doc = {
      implementation: null,
      getElementById: () => null,
      querySelectorAll: (sel) => (sel === ".kanban-card[data-stable-key]" ? cards : []),
    };
    const win = {};
    const ctx = { window: win, document: doc, Date, Number, Object, String, parseInt, console };
    vm.runInNewContext(dawnDataSrc, ctx);
    vm.runInNewContext(todaySrc, ctx);
    const vmodel = win.JobBoredDawn.data.getDawnViewModel({ doc, now: new Date("2026-05-20T12:00:00Z") });
    assert.equal(vmodel.leads[0].company, "Acme", "the owed reply leads, not the higher fit");
    assert.equal(vmodel.leads[0].facts[0].label, "NEXT");
    assert.match(vmodel.leads[0].facts[0].value, /owe an answer/);
  });
});
