/* UX01 C20 — one next-step engine (TR-12–15, TR-18, MP-07).

   today-data.js is the single source of "what should I do next" for a role.
   These tests pin the behaviour the audit asked for:
     - "Due in 48 h" and "Offer open" bands (TR-15)
     - a reply stops being owed once it is answered (TR-13)
     - Done clears the row: it writes Last contact AND pushes the follow-up
       (TR-12), and a scheduled follow-up keeps a quiet row out of the queue
     - Snooze, Mark answered and Add to calendar ride existing columns (MP-07)
     - nextStepFor is the one answer every surface reads (TR-14)
     - buildIcs emits a valid all-day RFC 5545 event */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { makeEnv } from "./fixtures/jb-dom.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const NOW = new Date(2026, 8, 25, 10, 0, 0).getTime(); // Fri Sep 25 2026, local
const DAY = 24 * 60 * 60 * 1000;
function localIso(offsetDays) {
  const d = new Date(NOW + offsetDays * DAY);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function load(jobs) {
  const env = makeEnv({ bodyClass: "jb-v2", regions: ["today"] });
  env.JobBored = { getPipelineJobs: () => jobs };
  vm.runInNewContext(read("dawn-data.js"), env);
  if (existsSync(join(repoRoot, "stage-registry.js"))) {
    vm.runInNewContext(read("stage-registry.js"), env);
  }
  vm.runInNewContext(read("today-data.js"), env);
  return env.JobBoredToday.data;
}

function queue(jobs) {
  return load(jobs).getTodayQueue({ jobs, now: NOW });
}

describe("C20 — Due in 48 h and Offer open bands (TR-15)", () => {
  it("should file an Applied follow-up due tomorrow under due, not leave it hidden", () => {
    const model = queue([
      { title: "Product Engineer", company: "Juniper", status: "Applied",
        appliedDate: localIso(-6), followUpDate: localIso(1) },
    ]);
    assert.equal(model.items.length, 1);
    assert.equal(model.items[0].reason, "due");
    assert.match(model.items[0].headline, /tomorrow/);
    assert.equal(model.counts.due, 1);
  });

  it("should leave a follow-up three days out off the queue", () => {
    const model = queue([
      { title: "Later", company: "Kilo", status: "Applied",
        appliedDate: localIso(-2), followUpDate: localIso(3) },
    ]);
    assert.equal(model.items.length, 0);
  });

  it("should show an open offer with its decision date", () => {
    const model = queue([
      { title: "Payments UI", company: "Brightline", status: "Offer", followUpDate: localIso(6) },
    ]);
    assert.equal(model.items[0].reason, "offer");
    assert.match(model.items[0].headline, /decide by/i);
    assert.match(model.items[0].detail, /6 days left/);
    assert.equal(model.items[0].action.label, "Open offer");
  });

  it("should rank overdue > due > offer > stale", () => {
    const model = queue([
      { title: "Quiet", company: "Q", status: "Applied", appliedDate: localIso(-30) },
      { title: "Offer", company: "O", status: "Offer", followUpDate: localIso(4) },
      { title: "Due", company: "D", status: "Applied", appliedDate: localIso(-5), followUpDate: localIso(0) },
      { title: "Late", company: "L", status: "Applied", appliedDate: localIso(-9), followUpDate: localIso(-2) },
    ]);
    assert.deepEqual(Array.from(model.items, (i) => i.reason), ["follow-up", "due", "offer", "stale"]);
  });
});

describe("C20 — rows can be cleared in place (TR-12, TR-13, MP-07)", () => {
  it("should make Done write Last contact today and push the follow-up a week", () => {
    const item = queue([
      { title: "Late", company: "L", status: "Applied", appliedDate: localIso(-9), followUpDate: localIso(-2) },
    ]).items[0];
    assert.equal(item.action.id, "done");
    assert.equal(item.action.event, "jb:role:writeback");
    assert.equal(item.action.detail.field, "heardBack");
    assert.equal(item.action.detail.value, localIso(0));
    assert.equal(item.action.also.length, 1);
    assert.equal(item.action.also[0].detail.field, "followupAt");
    assert.equal(item.action.also[0].detail.value, localIso(7));
  });

  it("should drop the row once Done's two writes land on it", () => {
    const row = { title: "Late", company: "L", status: "Applied", appliedDate: localIso(-9), followUpDate: localIso(-2) };
    const item = queue([row]).items[0];
    Object.assign(row, item.action.patch);
    assert.equal(queue([row]).items.length, 0, "a scheduled follow-up clears the row");
  });

  it("should keep a quiet application out of the queue once a follow-up is scheduled", () => {
    const model = queue([
      { title: "Quiet", company: "Q", status: "Applied", appliedDate: localIso(-30), followUpDate: localIso(5) },
    ]);
    assert.equal(model.items.length, 0);
  });

  it("should stop counting a reply as owed after Mark answered", () => {
    const row = { title: "FE", company: "Tidewater", status: "Phone Screen", responseFlag: "Yes",
      lastHeardFrom: localIso(-3) };
    const item = queue([row]).items[0];
    assert.equal(item.reason, "reply");
    const answered = item.more.find((a) => a.id === "mark-answered");
    assert.ok(answered, "a reply row offers Mark answered");
    assert.equal(answered.detail.field, "heardBack");
    assert.equal(answered.also[0].detail.field, "followupAt");
    Object.assign(row, answered.patch);
    const after = queue([row]).items;
    assert.equal(after.filter((i) => i.reason === "reply").length, 0, "no longer owed");
  });

  it("should take a snoozed reply out of the reply band when Last contact is blank", () => {
    const row = { title: "FE", company: "Tidewater", status: "Applied", responseFlag: "Yes" };
    const item = queue([row]).items[0];
    assert.equal(item.reason, "reply");
    const snooze = item.more.find((a) => a.id === "snooze");
    assert.ok(snooze, "a reply row offers Snooze");
    // Snooze "In 2 days" writes Follow-up Date only.
    row.followUpDate = localIso(2);
    const after = queue([row]).items;
    assert.equal(after.filter((i) => i.reason === "reply").length, 0, "snoozed reply leaves the band");
  });

  it("should keep a reply owed when Last contact is blank and the follow-up is past", () => {
    const row = { title: "FE", company: "Tidewater", status: "Applied", responseFlag: "Yes",
      followUpDate: localIso(-1) };
    assert.equal(queue([row]).items[0].reason, "reply");
  });

  it("should offer Snooze presets and a calendar file on a due row", () => {
    const item = queue([
      { title: "Due", company: "D", status: "Applied", appliedDate: localIso(-5), followUpDate: localIso(1) },
    ]).items[0];
    const ids = Array.from(item.more, (a) => a.id);
    assert.deepEqual(ids, ["snooze", "calendar"]);
    const snooze = item.more[0];
    assert.equal(snooze.field, "followupAt");
    assert.deepEqual(Array.from(snooze.presets, (p) => p.days), [2, 7]);
    assert.equal(item.more[1].date, localIso(1));
  });

  it("should keep one primary action per item", () => {
    for (const item of queue([
      { title: "A", company: "A", status: "Applied", responseFlag: "Yes" },
      { title: "B", company: "B", status: "Offer" },
      { title: "C", company: "C", status: "New", fitScore: 8 },
    ]).items) {
      assert.ok(item.action && item.action.label);
      assert.equal(Array.isArray(item.actions), false);
    }
  });
});

describe("C20 — one next-step source (TR-14)", () => {
  it("should answer nextStepFor with the same band Today files the row under", () => {
    const row = { title: "FE", company: "Orbital", status: "Interviewing", responseFlag: "Yes" };
    const api = load([row]);
    const step = api.nextStepFor(row, { now: NOW });
    assert.equal(step.reason, "reply");
    assert.equal(step.headline, api.getTodayQueue({ jobs: [row], now: NOW }).items[0].headline);
  });

  it("should return null when nothing is waiting", () => {
    const api = load([]);
    assert.equal(api.nextStepFor({ title: "x", status: "Rejected" }, { now: NOW }), null);
    assert.equal(api.nextStepFor(null), null);
  });
});

describe("C20 — Add to calendar builds an RFC 5545 all-day event", () => {
  it("should emit VCALENDAR with DATE-valued start and next-day end, CRLF lines", () => {
    const api = load([]);
    const ics = api.buildIcs({ date: "2026-09-26", title: "Product, Engineer", company: "Juniper; Bank",
      jobKey: "4", now: NOW });
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /\r\nDTSTART;VALUE=DATE:20260926\r\n/);
    assert.match(ics, /\r\nDTEND;VALUE=DATE:20260927\r\n/);
    assert.match(ics, /SUMMARY:Follow up: Product\\, Engineer — Juniper\\; Bank/);
    assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
    assert.equal(ics.includes("\n") && !/[^\r]\n/.test(ics), true, "every line ends CRLF");
  });

  it("should refuse a missing or malformed date", () => {
    const api = load([]);
    assert.equal(api.buildIcs({ date: "" }), "");
    assert.equal(api.buildIcs({ date: "next week" }), "");
  });
});
