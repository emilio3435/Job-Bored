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
   The kanban-card-sourced Dawn `today[]` slot is dawn-data.js's, which this
   lane does not own — see LANE-REPORT-r3 §5. */

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
