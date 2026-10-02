/**
 * HOLES BOARD — Today (today.js) and the Daily Brief (dawn.js) mounted in a
 * small DOM (tests/holes-board-dom.mjs), with their data seams stubbed:
 * JobBoredToday.data.getTodayQueue(), JobBoredDawn.data.getDawnViewModel()
 * and JobBored.getPipelineJobs().
 *
 * Each describe block names the finding it pins. DOM nodes are compared with
 * assert.ok(a === b): strict deepEqual walks the circular node graph.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createBoardEnv } from "./holes-board-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(join(repoRoot, name), "utf8");
const todayJs = read("today.js");
const dawnJs = read("dawn.js");
const companyCapJs = read("company-cap.js");

/** Fire the body-class observers the way a browser would after a class flip. */
function flipBody(env, cls) {
  env.document.body.className = cls;
  for (const mo of env.observers.slice()) {
    if (mo.targets.some((t) => t.target === env.document.body)) mo.cb([]);
  }
  env.flush();
}

function emit(env, type, detail) {
  env.fire(env.document, type, { detail });
  env.flush();
}

/* ------------------------------- Today -------------------------------- */

function mountToday({ bodyClass = "jb-v2", jobs = [] } = {}) {
  const env = createBoardEnv({ bodyClass, html: '<section data-region="today"></section>' });
  const w = env.window;
  w.JobBoredToday = { data: { getTodayQueue: () => ({ items: [], counts: {}, empty: true }) } };
  w.JobBored = { getPipelineJobs: () => jobs };
  vm.runInNewContext(todayJs, w, { filename: "today.js" });
  env.flush();
  const region = env.document.querySelector('[data-region="today"]');
  return { ...env, region };
}

const todayText = (t) => t.region.textContent;

describe("B2 · Today reads SHEETS' jb:data:* events", () => {
  it("should keep a loading signal sent before body.jb-v2 and show loading, not the first-run card", () => {
    const t = mountToday({ bodyClass: "" });
    emit(t, "jb:data:loading", { generation: 1 });
    flipBody(t, "jb-v2");
    assert.match(todayText(t), /Loading your pipeline/);
    assert.doesNotMatch(todayText(t), /Your pipeline is empty/);
  });

  it("should say the read failed on jb:data:failed", () => {
    const t = mountToday();
    emit(t, "jb:data:loading", { generation: 1 });
    emit(t, "jb:data:failed", { generation: 1, status: 500, message: "boom" });
    assert.match(todayText(t), /didn't load/);
  });

  it("should still accept today's jb:data:load-failed name", () => {
    const t = mountToday();
    emit(t, "jb:data:load-failed", {});
    assert.match(todayText(t), /didn't load/);
  });

  it("should ignore a loaded event from a generation older than the newest loading", () => {
    const t = mountToday();
    emit(t, "jb:data:loading", { generation: 2 });
    emit(t, "jb:data:loaded", { generation: 1, rowCount: 0 });
    assert.match(todayText(t), /Loading your pipeline/, "generation 1 is stale once 2 started");
    emit(t, "jb:data:loaded", { generation: 2, rowCount: 0 });
    assert.match(todayText(t), /Your pipeline is empty/);
  });
});

/* ------------------------------- Dawn --------------------------------- */

function lead(key, over = {}) {
  return { key, index: Number(key), title: `Role ${key}`, company: "Acme", stage: "researching", fitScore: 5, jobUrl: "", facts: [], nextStep: null, ...over };
}

function mountDawn({ bodyClass = "jb-v2", leads = [], jobs = null, withCap = false, html = "" } = {}) {
  const env = createBoardEnv({ bodyClass, html: `${html}<section data-region="dawn"></section>` });
  const w = env.window;
  const state = { leads, vmCalls: 0 };
  w.JobBoredDawn = {
    data: {
      getDawnViewModel() {
        state.vmCalls += 1;
        return { byTheNumbers: [], funnel30d: [], leads: state.leads };
      },
    },
  };
  w.JobBored = { getPipelineJobs: () => jobs || state.leads };
  if (withCap) vm.runInNewContext(companyCapJs, w, { filename: "company-cap.js" });
  vm.runInNewContext(dawnJs, w, { filename: "dawn.js" });
  env.flush();
  const region = env.document.querySelector('[data-region="dawn"]');
  return { ...env, region, state };
}

const leadKeys = (d) => d.region.querySelectorAll("[data-leads-stepper] [data-lead-key]").map((n) => n.getAttribute("data-lead-key"));
const activeKey = (d) => {
  const a = d.region.querySelector('[data-leads-stepper] [data-stepper-active="true"]');
  return a ? a.getAttribute("data-lead-key") : null;
};
const rerender = (d) => emit(d, "jb:pipeline:rendered");

describe("B2 · the Daily Brief reads SHEETS' jb:data:* events", () => {
  it("should say the read failed on jb:data:failed", () => {
    const d = mountDawn({ jobs: [] });
    emit(d, "jb:data:failed", { generation: 1, status: 500, message: "boom" });
    assert.match(d.region.textContent, /pipeline didn't load/);
  });

  it("should ignore a loaded event from a generation older than the newest loading", () => {
    const d = mountDawn({ jobs: [] });
    emit(d, "jb:data:loading", { generation: 3 });
    emit(d, "jb:data:loaded", { generation: 2, rowCount: 0 });
    assert.match(d.region.textContent, /Loading your pipeline/);
    emit(d, "jb:data:loaded", { generation: 3, rowCount: 0 });
    assert.match(d.region.textContent, /No active roles/);
  });
});

describe("B7 · the Daily Brief keeps the active lead and focus across a rebuild", () => {
  it("should keep the stepped-to lead active and focus on the chevron after new data", () => {
    const d = mountDawn({ leads: [lead("1"), lead("2"), lead("3")] });
    const next = d.region.querySelector('[data-leads-step="next"]');
    next.focus();
    d.fire(next, "click");
    assert.equal(activeKey(d), "2");
    d.state.leads = [lead("1", { title: "Renamed" }), lead("2"), lead("3")];
    rerender(d);
    const nextAfter = d.region.querySelector('[data-leads-step="next"]');
    assert.ok(nextAfter !== next, "the rebuild replaced the node");
    assert.equal(activeKey(d), "2", "the active lead is the same role");
    assert.ok(d.document.activeElement === nextAfter, "focus is on the new chevron");
  });

  it("should put focus back on the same lead's action button", () => {
    const d = mountDawn({ leads: [lead("1"), lead("2")] });
    d.region.querySelector('[data-lead-action="mark-expired"][data-key="2"]').focus();
    d.state.leads = [lead("0"), lead("1"), lead("2")];
    rerender(d);
    const f = d.document.activeElement;
    assert.equal(f.getAttribute("data-lead-action"), "mark-expired");
    assert.equal(f.getAttribute("data-key"), "2");
  });

  it("should follow a focused queue row to its lead's new position", () => {
    const d = mountDawn({ leads: [lead("1"), lead("2"), lead("3")] });
    d.region.querySelector('[data-leads-jump="2"]').focus(); // lead 3
    d.state.leads = [lead("3"), lead("1"), lead("2")];
    rerender(d);
    assert.equal(d.document.activeElement.getAttribute("data-leads-jump"), "0");
  });
});

describe("B9 · the Daily Brief re-renders on state signals, not legacy mutations", () => {
  it("should not observe #briefStats or #briefHeadline", () => {
    const d = mountDawn({ leads: [lead("1")], html: '<div id="briefStats"></div><p id="briefHeadline"></p>' });
    const watched = d.observers.flatMap((mo) => mo.targets.map((t) => t.target));
    assert.ok(!watched.includes(d.document.getElementById("briefStats")), "#briefStats is not observed");
    assert.ok(!watched.includes(d.document.getElementById("briefHeadline")), "#briefHeadline is not observed");
  });

  it("should re-read the view model on jb:write:succeeded", () => {
    const d = mountDawn({ leads: [lead("1")] });
    const before = d.state.vmCalls;
    emit(d, "jb:write:succeeded", { jobKey: "1" });
    assert.ok(d.state.vmCalls > before);
  });
});

describe("R5 · the Daily Brief caps only New and Researching leads, with a Show all toggle", () => {
  it("should never hide a later-stage lead behind the company cap", () => {
    const leads = ["1", "2", "3", "4", "5"].map((k) => lead(k, { stage: "applied" }));
    const d = mountDawn({ leads, withCap: true });
    assert.deepEqual(leadKeys(d), ["1", "2", "3", "4", "5"]);
    assert.equal(d.region.querySelector("[data-leads-show-all]"), null);
  });

  it("should cap triage leads and toggle Show all / Show fewer, keeping focus on the toggle", () => {
    const leads = [
      lead("1", { fitScore: 9 }), lead("2", { fitScore: 8 }), lead("3", { fitScore: 7, stage: "new" }),
      lead("4", { fitScore: 6 }), lead("5", { fitScore: 5, stage: "interviewing" }),
    ];
    const d = mountDawn({ leads, withCap: true });
    assert.deepEqual(leadKeys(d), ["1", "2", "3", "5"], "the fourth triage Acme lead is capped; the interviewing one is not");
    const toggle = d.region.querySelector("[data-leads-show-all]");
    assert.ok(toggle && toggle.tagName.toLowerCase() === "button", "the note is a button");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.match(toggle.textContent, /Show all \(\+1 from Acme hidden\)/);
    toggle.focus();
    d.fire(toggle, "click");
    d.flush();
    assert.deepEqual(leadKeys(d), ["1", "2", "3", "4", "5"]);
    const after = d.region.querySelector("[data-leads-show-all]");
    assert.equal(after.getAttribute("aria-expanded"), "true");
    assert.equal(after.textContent, "Show fewer");
    assert.ok(d.document.activeElement === after, "focus stays on the toggle");
    d.fire(after, "click");
    d.flush();
    assert.deepEqual(leadKeys(d), ["1", "2", "3", "5"]);
  });
});
