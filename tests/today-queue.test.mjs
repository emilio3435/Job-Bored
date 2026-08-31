import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const todayQueuePath = join(repoRoot, "today-queue.js");
const dawnDataPath = join(repoRoot, "dawn-data.js");

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

function loadTodayQueue() {
  assert.equal(existsSync(todayQueuePath), true, "today-queue.js must exist (F3C-UX01-TODAY)");
  const source = readFileSync(todayQueuePath, "utf8");
  const win = {};
  vm.runInNewContext(
    source,
    { window: win, globalThis: win, Date, Number, Math, String, Array, Object, isNaN, console },
    { filename: "today-queue.js" },
  );
  assert.ok(win.JobBoredTodayQueue, "today-queue.js must attach window.JobBoredTodayQueue");
  return win.JobBoredTodayQueue;
}

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

function loadDawnWithToday(doc) {
  const todaySrc = readFileSync(todayQueuePath, "utf8");
  const dawnSrc = readFileSync(dawnDataPath, "utf8");
  const win = {};
  const ctx = {
    window: win,
    document: doc,
    Date,
    Number,
    Object,
    String,
    Math,
    Array,
    parseInt,
    isNaN,
    console,
  };
  vm.runInNewContext(todaySrc, ctx, { filename: "today-queue.js" });
  vm.runInNewContext(dawnSrc, ctx, { filename: "dawn-data.js" });
  return win.JobBoredDawn.data;
}

/** dawn-data.js alone, with window.JobBoredToday stubbed (or absent). The real
 *  today-data.js is the Today lane's file; this pins the handoff contract. */
function loadDawnWithTodayData(doc, todayGlobal) {
  const dawnSrc = readFileSync(dawnDataPath, "utf8");
  const win = {};
  if (todayGlobal) win.JobBoredToday = todayGlobal;
  vm.runInNewContext(
    dawnSrc,
    { window: win, document: doc, Date, Number, Object, String, Math, Array, parseInt, isNaN, console },
    { filename: "dawn-data.js" },
  );
  return win.JobBoredDawn.data;
}

describe("F3C-UX01-TODAY — default Today queue membership", () => {
  it("selects overdue follow-up, waiting-on-reply, and stale-application work", () => {
    const api = loadTodayQueue();
    assert.equal(typeof api.select, "function", "JobBoredTodayQueue.select must be a function");

    const jobs = [
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
        jobKey: "stale-1",
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
    ];

    const result = api.select(jobs, { now: NOW });
    assert.ok(result && Array.isArray(result.items), "select() must return { items }");

    const kindsByKey = Object.fromEntries(result.items.map((item) => [item.jobKey, item.kind]));
    assert.equal(kindsByKey["overdue-1"], "overdue-follow-up");
    assert.equal(kindsByKey["waiting-1"], "waiting-on-reply");
    assert.equal(kindsByKey["stale-1"], "stale-application");
    assert.equal(kindsByKey["fresh-1"], undefined, "fresh applied work is not Today work");
    assert.equal(kindsByKey["closed-1"], undefined, "rejected rows are not Today work");

    const kinds = new Set(result.items.map((item) => item.kind));
    assert.equal(kinds.has("overdue-follow-up"), true);
    assert.equal(kinds.has("waiting-on-reply"), true);
    assert.equal(kinds.has("stale-application"), true);
  });

  it("waiting-on-reply excludes jobs that already replied", () => {
    const api = loadTodayQueue();
    const result = api.select(
      [
        {
          jobKey: "replied-1",
          status: "Applied",
          appliedDate: daysAgo(21),
          responseFlag: "Yes",
        },
      ],
      { now: NOW },
    );
    assert.equal(
      result.items.some((item) => item.jobKey === "replied-1" && item.kind === "waiting-on-reply"),
      false,
    );
  });

  /* R2 reconciliation: the Today queue has ONE ranking engine —
     JobBoredToday.data (today-data.js). dawn-data.buildToday keeps the VM's
     `today` slot so nothing reading the VM has to change, but it no longer
     classifies anything itself: two engines meant the daily brief could call a
     card "stale" while the Today section called the same card "reply".

     Membership and band ordering are pinned against the real engine in
     tests/today-queue-ranking.test.mjs (Today lane). What belongs HERE is the
     handoff: that the VM slot is fed by that engine, that it is fed the card
     membership fields the engine classifies on, and that it degrades to an
     empty list rather than to a second opinion. */
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
    // The engine classifies on these four fields; dropping any of them from the
    // handoff makes the whole queue silently empty instead of failing.
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
    // Same absence guard the JobBoredTodayQueue lookup had: a missing script
    // means no Today list, never a fallback ranking nobody can see the rules of.
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
