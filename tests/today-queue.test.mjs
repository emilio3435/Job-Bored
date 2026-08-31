/* F3C-UX01-TODAY — default Today queue membership.
   ------------------------------------------------------------------
   Originally written against today-queue.js (window.JobBoredTodayQueue),
   a membership selector with three kinds: overdue-follow-up /
   waiting-on-reply / stale-application. That engine is gone; the Today
   capability has one implementation now, today-data.js
   (window.JobBoredToday.data.getTodayQueue), which ranks into five bands.

   What this file still proves, retargeted at the surviving engine:
     - overdue follow-up work IS selected as Today work
     - a long-silent application IS selected as Today work
     - fresh applications are NOT Today work
     - terminal (rejected/expired) rows are NOT Today work
     - every selected item carries exactly one contracted intent

   One assertion deliberately FLIPS. The old rule filed an Applied row that
   had already replied under "stale-application" (revive-or-close). The
   surviving rule files any replied row in the top "reply" band ("they
   replied — you owe an answer"). That is a truthful-feedback adoption, not
   a weakening: the row is still selected, still actionable, and now ranks
   above work nobody is waiting on. This file pins the new rule so a silent
   regression back to "replied means stale" fails here.

   Dropped, not weakened: the "today-queue.js exists on disk" and
   "window.JobBoredTodayQueue has this shape" assertions died with the file.
   The Dawn `today[]` handoff is kept from R2 as a second describe below. */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { makeEnv } from "./fixtures/jb-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const NOW = new Date("2026-05-20T12:00:00.000Z");

function daysAgo(n) {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysAhead(n) {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* stage-registry.js belongs to the boards lane and lands on a different
   branch; today-data.js carries a documented local fallback for its absence,
   so membership holds either way and the composed page is exercised once the
   registry merges. */
function selectToday(jobs) {
  const env = makeEnv({ bodyClass: "jb-v2", regions: ["today"] });
  env.JobBored = { getPipelineJobs: () => jobs };
  vm.runInNewContext(read("dawn-data.js"), env);
  if (existsSync(join(repoRoot, "stage-registry.js"))) {
    vm.runInNewContext(read("stage-registry.js"), env);
  }
  vm.runInNewContext(read("today-data.js"), env);
  const api = env.JobBoredToday.data;
  assert.equal(
    typeof api.getTodayQueue,
    "function",
    "JobBoredToday.data.getTodayQueue must be the one Today engine",
  );
  return api.getTodayQueue({ jobs, now: NOW });
}

describe("F3C-UX01-TODAY — default Today queue membership", () => {
  const JOBS = [
    {
      jobKey: "overdue-1",
      title: "Staff Engineer",
      company: "Acme",
      status: "Applied",
      followUpDate: daysAgo(2),
      appliedDate: daysAgo(5),
    },
    {
      jobKey: "waiting-1",
      title: "Backend",
      company: "Bravo",
      status: "Applied",
      appliedDate: daysAgo(10),
      responseFlag: "",
    },
    {
      jobKey: "replied-1",
      title: "Platform",
      company: "Charlie",
      status: "Applied",
      appliedDate: daysAgo(20),
      responseFlag: "Yes",
    },
    {
      jobKey: "fresh-1",
      title: "New Role",
      company: "Delta",
      status: "Applied",
      appliedDate: daysAgo(1),
      followUpDate: daysAhead(3),
    },
    {
      jobKey: "closed-1",
      title: "Closed",
      company: "Echo",
      status: "Rejected",
      followUpDate: daysAgo(4),
      appliedDate: daysAgo(30),
    },
    {
      jobKey: "expired-1",
      title: "Gone",
      company: "Foxtrot",
      status: "Expired",
      followUpDate: daysAgo(9),
      appliedDate: daysAgo(40),
    },
  ];

  /* items carry their source index as jobKey (app.js getPipelineSheetRow takes
     the same index), so map back through company to keep the test readable. */
  function byCompany(model) {
    return Object.fromEntries(model.items.map((item) => [item.company, item.reason]));
  }

  it("selects overdue follow-up and long-silent application work", () => {
    const reasons = byCompany(selectToday(JOBS));
    assert.equal(reasons.Acme, "follow-up", "an overdue follow-up is Today work");
    assert.equal(reasons.Bravo, "stale", "10 days of silence after applying is Today work");
  });

  it("files a replied application under reply, not staleness", () => {
    // The adopted rule. Replied + 20 days old used to read "stale-application";
    // it now reads "reply", and outranks everything nobody is waiting on.
    const model = selectToday(JOBS);
    assert.equal(byCompany(model).Charlie, "reply");
    assert.equal(
      model.items[0].company,
      "Charlie",
      "a reply you owe outranks the rest of the queue",
    );
    assert.match(
      model.items[0].headline,
      /replied/i,
      "and the surface says so in words",
    );
  });

  it("leaves fresh and terminal rows out of Today entirely", () => {
    const reasons = byCompany(selectToday(JOBS));
    assert.equal(reasons.Delta, undefined, "fresh applied work is not Today work");
    assert.equal(reasons.Echo, undefined, "rejected rows are not Today work");
    assert.equal(reasons.Foxtrot, undefined, "expired rows are not Today work");
  });

  it("counts what it selected so an empty band is visible, not silent", () => {
    const model = selectToday(JOBS);
    assert.equal(model.items.length, 3);
    assert.deepEqual(
      { ...model.counts },
      { reply: 1, prep: 0, "follow-up": 1, stale: 1, fit: 0 },
    );
    assert.equal(model.empty, false);
  });

  it("gives every selected row exactly one contracted intent, never a direct write", () => {
    const allowed = new Set(["jb:role:writeback", "jb:pipeline:move", "jb:role:open"]);
    const model = selectToday(JOBS);
    for (const item of model.items) {
      assert.ok(item.action, `${item.company} needs a next action`);
      assert.equal(Array.isArray(item.actions), false, "one action, not a menu");
      assert.ok(
        allowed.has(item.action.event),
        `${item.action.event} is not one of the contracted intents`,
      );
      assert.equal(item.action.detail.jobKey, item.jobKey);
    }
    // The follow-up row's action logs contact through the flowing-writes
    // bridge (Pipeline!R), which is the only sanctioned writer.
    const followUp = model.items.find((i) => i.reason === "follow-up");
    assert.equal(followUp.action.event, "jb:role:writeback");
    assert.equal(followUp.action.detail.field, "heardBack");
  });

  it("no longer ships a second Today engine", () => {
    assert.equal(
      existsSync(join(repoRoot, "today-queue.js")),
      false,
      "today-queue.js was the duplicate ranking engine — one capability, one implementation",
    );
    assert.equal(
      /JobBoredTodayQueue/.test(read("daily-brief.js")),
      false,
      "daily-brief.js must be back on its own local detectors",
    );
  });
});

/* R2 handoff cases kept at merge: dawn-data.buildToday must feed the
   canonical engine, not a second classifier. Helpers are the R2 card
   stubs so this describe does not depend on today-data.js being loaded. */
function makeCard(opts) {
  const attrs = {
    "data-stable-key": opts.key,
    "data-index": opts.index != null ? String(opts.index) : null,
    "data-fit": opts.fit != null ? String(opts.fit) : null,
    "data-found-at": opts.foundAt || null,
    "data-applied-at": opts.appliedAt || null,
    "data-follow-up": opts.followUp || null,
    "data-replied": opts.replied || null,
    "data-salary": opts.salary || null,
    "data-job-url": opts.jobUrl || null,
  };
  return {
    className: `kanban-card kanban-card--stage-${opts.stage}`,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    querySelector(selector) {
      if (selector === ".kanban-card__title") return { textContent: opts.title || "" };
      if (selector === ".kanban-card__company") return { textContent: opts.company || "" };
      return null;
    },
  };
}

function makeDoc(cards) {
  const stats = [1, 2, 3, 4].map(() => ({
    querySelector(selector) {
      if (selector === ".stat-card__value") return { textContent: "0" };
      if (selector === ".stat-card__sub") return { textContent: "" };
      return null;
    },
  }));
  return {
    getElementById(id) {
      if (id === "briefStats") {
        return { querySelectorAll: (selector) => (selector === ".stat-card" ? stats : []) };
      }
      if (id === "briefDate") return { textContent: "Wed, May 20, 2026" };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".kanban-card[data-stable-key]") return cards;
      return [];
    },
  };
}

function loadDawnWithTodayData(doc, todayGlobal) {
  const dawnSrc = read("dawn-data.js");
  const win = {};
  if (todayGlobal) win.JobBoredToday = todayGlobal;
  vm.runInNewContext(
    dawnSrc,
    { window: win, document: doc, Date, Number, Object, String, Math, Array, parseInt, isNaN, console },
    { filename: "dawn-data.js" },
  );
  return win.JobBoredDawn.data;
}

describe("Dawn view-model Today slot handoff (R2)", () => {
  it("builds the Dawn view-model Today slot from JobBoredToday.data, not a second engine", () => {
    const cards = [
      makeCard({
        key: "overdue-1",
        index: 1,
        stage: "applied",
        title: "Staff Engineer",
        company: "Acme",
        followUp: daysAgo(3),
        appliedAt: daysAgo(6),
      }),
      makeCard({
        key: "waiting-1",
        index: 2,
        stage: "applied",
        title: "Backend",
        company: "Bravo",
        appliedAt: daysAgo(9),
        replied: "yes",
      }),
    ];

    const calls = [];
    const queued = [
      { jobKey: 0, band: "follow-up", title: "Staff Engineer" },
      { jobKey: 1, band: "reply", title: "Backend" },
    ];
    const api = loadDawnWithTodayData(makeDoc(cards), {
      data: {
        getTodayQueue(opts) {
          calls.push(opts);
          return { items: queued, counts: {}, empty: false };
        },
      },
    });

    const vmObj = api.getDawnViewModel({ doc: makeDoc(cards), now: NOW });
    assert.ok(Array.isArray(vmObj.today), "getDawnViewModel() must expose today[] (F3C-UX01-TODAY)");
    assert.deepEqual(
      vmObj.today,
      queued,
      "the slot must be the canonical engine's items, not a locally re-ranked copy",
    );

    assert.equal(calls.length, 1, "the queue should be built once per view-model");
    const handed = calls[0];
    assert.equal(handed.now, NOW, "the engine must classify against the caller's clock");
    assert.ok(Array.isArray(handed.jobs) && handed.jobs.length === 2);
    const overdue = handed.jobs.find((j) => j.jobKey === "overdue-1");
    assert.ok(overdue, "every board card must reach the engine");
    assert.equal(overdue.status, "Applied", "the Sheet status label, not the CSS stage key");
    assert.equal(overdue.appliedDate, daysAgo(6));
    assert.equal(overdue.followUpDate, daysAgo(3));
    assert.equal(
      handed.jobs.find((j) => j.jobKey === "waiting-1").responseFlag,
      "yes",
      "the reply flag decides the top band and must survive the handoff",
    );
  });

  it("leaves the Today slot empty when today-data.js is not in the page", () => {
    const cards = [
      makeCard({
        key: "overdue-1",
        index: 1,
        stage: "applied",
        title: "Staff Engineer",
        company: "Acme",
        followUp: daysAgo(3),
        appliedAt: daysAgo(6),
      }),
    ];
    const api = loadDawnWithTodayData(makeDoc(cards), null);
    const vmObj = api.getDawnViewModel({ doc: makeDoc(cards), now: NOW });
    assert.ok(Array.isArray(vmObj.today));
    assert.equal(vmObj.today.length, 0, "no engine means no queue, not a fallback ranking");
  });
});
