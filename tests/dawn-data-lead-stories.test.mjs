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

function makeCard(opts) {
  const attrs = {
    "data-stable-key": opts.key,
    "data-index": opts.index != null ? String(opts.index) : null,
    "data-fit": opts.fit != null ? String(opts.fit) : null,
    "data-found-at": opts.foundAt || null,
    "data-salary": opts.salary || null,
    "data-job-url": opts.jobUrl || null,
  };
  return {
    className: `kanban-card kanban-card--stage-${opts.stage}`,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    querySelector(selector) {
      if (selector === ".kanban-card__title") return textElement(opts.title);
      if (selector === ".kanban-card__company") return textElement(opts.company);
      return null;
    },
  };
}

function makeDoc(cards) {
  const stats = [
    makeStat("99", "weekly hero should not drive lead carousel"),
    makeStat("88", "weekly hero should not drive lead carousel"),
    makeStat("77", "weekly hero should not drive lead carousel"),
    makeStat("66", "weekly hero should not drive lead carousel"),
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

describe("Dawn lead-story carousel (ATS-scored)", () => {
  it("returns up to 5 active-stage leads sorted by data-fit desc", () => {
    const cards = [
      makeCard({ key: "n1", index: 10, stage: "new",          title: "Role A", company: "Acme",   fit: 4, foundAt: "2026-05-18" }),
      makeCard({ key: "n2", index: 11, stage: "new",          title: "Role B", company: "Bravo",  fit: 9, foundAt: "2026-05-19" }),
      makeCard({ key: "r1", index: 12, stage: "researching",  title: "Role C", company: "Charlie",fit: 7, foundAt: "2026-05-15" }),
      makeCard({ key: "a1", index: 13, stage: "applied",      title: "Role D", company: "Delta",  fit: 8, foundAt: "2026-05-10", salary: "$180k" }),
      makeCard({ key: "p1", index: 14, stage: "phone-screen", title: "Role E", company: "Echo",   fit: 6 }),
      makeCard({ key: "i1", index: 15, stage: "interviewing", title: "Role F", company: "Fox",    fit: 10 }),
      makeCard({ key: "o1", index: 16, stage: "offer",        title: "Role G", company: "Golf",   fit: 9 }),
      makeCard({ key: "x1", index: 17, stage: "rejected",     title: "Role H", company: "Hotel",  fit: 10 }),
      makeCard({ key: "n3", index: 18, stage: "new",          title: "Role I", company: "India",  fit: 8 }),
    ];
    const doc = makeDoc(cards);
    const api = loadDawnData(doc);
    const vmObj = api.getDawnViewModel({ doc, now: new Date("2026-05-20T12:00:00Z") });
    assert.ok(Array.isArray(vmObj.leads), "leads should be an array");
    assert.equal(vmObj.leads.length, 5);
    const orderedFits = Array.from(vmObj.leads, (l) => l.fitScore);
    assert.equal(JSON.stringify(orderedFits), JSON.stringify([10, 9, 8, 8, 7]));
    // Offer + Rejected are excluded from leads.
    const keys = Array.from(vmObj.leads, (l) => l.key);
    assert.equal(keys.includes("o1"), false, "offer stage is not part of the lead carousel");
    assert.equal(keys.includes("x1"), false, "rejected stage is not part of the lead carousel");
  });

  it("includes per-card facts: stage, fit/10, days ago, and salary if present", () => {
    const cards = [
      makeCard({
        key: "a1",
        index: 13,
        stage: "applied",
        title: "Senior Engineer",
        company: "Delta",
        fit: 8,
        foundAt: "2026-05-10",
        salary: "$180k",
      }),
    ];
    const doc = makeDoc(cards);
    const api = loadDawnData(doc);
    const vmObj = api.getDawnViewModel({ doc, now: new Date("2026-05-20T12:00:00Z") });
    const lead = vmObj.leads[0];
    const labels = Array.from(lead.facts, (f) => f.label);
    assert.deepEqual(labels, ["STAGE", "FIT", "FOUND", "SALARY"]);
    const byLabel = Object.fromEntries(Array.from(lead.facts, (f) => [f.label, f.value]));
    assert.equal(byLabel.STAGE, "Applied");
    assert.equal(byLabel.FIT, "8/10");
    assert.equal(byLabel.FOUND, "10 days ago");
    assert.equal(byLabel.SALARY, "$180k");
  });

  it("renders an empty leads array when there are no active roles", () => {
    const cards = [
      makeCard({ key: "o1", index: 1, stage: "offer", title: "X", company: "Y", fit: 9 }),
      makeCard({ key: "x1", index: 2, stage: "rejected", title: "X", company: "Y", fit: 9 }),
    ];
    const doc = makeDoc(cards);
    const api = loadDawnData(doc);
    const vmObj = api.getDawnViewModel({ doc, now: new Date("2026-05-20T12:00:00Z") });
    assert.equal(vmObj.leads.length, 0);
  });

  it("drops the legacy stories / buildStories / Also Today plumbing", () => {
    assert.equal(dawnDataSrc.includes("buildStories"), false, "buildStories should be removed");
    assert.equal(dawnRendererSrc.includes("storyHtml"), false, "storyHtml should be removed");
    assert.equal(dawnRendererSrc.includes("Also today"), false, "Also today markup should be removed");
    assert.equal(dawnRendererSrc.includes("dawn:open-job"), false, "dawn:open-job event should be removed");
    assert.equal(dawnRendererSrc.includes("dawn:scroll-to-stage"), false, "dawn:scroll-to-stage event should be removed");
    assert.equal(dawnRendererSrc.includes("forwardClickToLegacyCard"), false, "forwardClickToLegacyCard should be removed");
    assert.equal(dawnRendererSrc.includes("scrollToStage"), false, "scrollToStage should be removed");
  });

  it("the renderer wires lead actions to JobBoredFlowing.openRole.set and jb:role:action resume-cover", () => {
    assert.ok(
      dawnRendererSrc.includes("JobBoredFlowing"),
      "the lead carousel should call into the dossier opener",
    );
    assert.ok(
      dawnRendererSrc.includes("resume-cover"),
      "Draft cover letter should dispatch jb:role:action resume-cover",
    );
    assert.ok(
      dawnRendererSrc.includes('data-region="letter"'),
      "Draft cover letter should scroll to the letter region",
    );
  });
});
