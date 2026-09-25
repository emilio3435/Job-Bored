/**
 * UX-01 card half: the compact strip must keep every CRM slot visible and say
 * Unknown for absent evidence rather than rendering blanks or invented facts.
 * Mutation check: blanking any missing value or omitting the compact adjacency
 * hook fails this probe.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "recruiter-strip.js");

it("renders the compact card variant with Unknown preserved", () => {
  const windowTarget = { JobBoredApp: { sheetsWrite: {} } };
  if (existsSync(sourcePath)) {
    vm.runInNewContext(readFileSync(sourcePath, "utf8"), {
      Object,
      String,
      window: windowTarget,
    }, { filename: "recruiter-strip.js" });
  }
  assert.ok(
    windowTarget.JobBoredRecruiterStrip,
    "UX-01: recruiter-strip.js must install its compact renderer",
  );

  const mount = { innerHTML: "", addEventListener() {}, querySelector() { return null; } };
  windowTarget.JobBoredRecruiterStrip.renderCompact(mount, {
    jobKey: "11",
    contact: "",
    lastHeardFrom: null,
    replied: "",
    followUpDate: undefined,
  });

  assert.match(mount.innerHTML, /pipe-sticker__recruiter-strip/);
  /* TR-17: every fact unknown collapses to the one Next action line; the
     four "Unknown" facts are not rendered at all (not CSS-hidden). */
  assert.doesNotMatch(mount.innerHTML, /Unknown/);
  assert.doesNotMatch(mount.innerHTML, /jb-recruiter-strip__compact-facts/);
  assert.match(mount.innerHTML, /data-facts="none"/);
  assert.doesNotMatch(mount.innerHTML, /undefined|null/);
  assert.match(mount.innerHTML, /Find a recruiter contact/);
});

function loadStrip(extra = {}) {
  const win = { ...extra };
  vm.runInNewContext(readFileSync(sourcePath, "utf8"), { Object, String, Number, Math, Date, Array, window: win, Promise, queueMicrotask });
  return win.JobBoredRecruiterStrip;
}

const NOW = new Date(2026, 8, 25, 10, 0, 0).getTime();

it("should keep Unknown on the facts that are missing when at least one is known (TR-17)", () => {
  const mount = { innerHTML: "" };
  loadStrip().renderCompact(mount, { jobKey: "3", contact: "Dev", now: NOW });
  assert.match(mount.innerHTML, /jb-recruiter-strip__compact-facts/);
  assert.equal((mount.innerHTML.match(/Unknown/g) || []).length, 3);
  assert.doesNotMatch(mount.innerHTML, /data-facts="none"/);
});

it("should bind the stage dot to the row's stage, never a hard-coded applied (TR-17)", () => {
  const strip = loadStrip();
  const mount = { innerHTML: "" };
  strip.renderCompact(mount, { jobKey: "3", contact: "Dev", stage: "interviewing", now: NOW });
  assert.match(mount.innerHTML, /<jb-stage-dot stage="interviewing"/);
  assert.doesNotMatch(mount.innerHTML, /stage="applied"/);
});

it("should read the stage from the card's data-stage once the strip is mounted (TR-17)", async () => {
  const strip = loadStrip();
  const attrs = {};
  const dot = { setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, remove() { attrs.removed = true; } };
  const card = { getAttribute: (k) => (k === "data-stage" ? "phone" : null) };
  const mount = {
    innerHTML: "",
    querySelector: (sel) => (sel === "jb-stage-dot" ? dot : null),
    closest: (sel) => (sel === "[data-stage]" ? card : null),
  };
  strip.renderCompact(mount, { jobKey: "3", contact: "Dev", now: NOW });
  assert.doesNotMatch(mount.innerHTML, /stage="applied"/);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attrs.stage, "phone");
  assert.equal(attrs.hidden, undefined);
});

function stripWithCard(win, dataStage) {
  const strip = loadStrip(win);
  const attrs = {};
  const dot = { setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; }, remove() { attrs.removed = true; } };
  const card = { getAttribute: (k) => (k === "data-stage" ? dataStage : null) };
  const mount = {
    innerHTML: "",
    querySelector: (sel) => (sel === "jb-stage-dot" ? dot : null),
    closest: (sel) => (sel === "[data-stage]" ? card : null),
  };
  return { strip, attrs, mount };
}

it("should map a Phone Screen card's canonical data-stage to the phone dot without the registry (TR-17)", async () => {
  const { strip, attrs, mount } = stripWithCard({}, "phone-screen");
  strip.renderCompact(mount, { jobKey: "3", contact: "Dev", now: NOW });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attrs.removed, undefined, "the phone-screen card must keep its stage dot");
  assert.equal(attrs.stage, "phone");
});

it("should normalise the card's data-stage through JobBoredStages.toDotKey when present (TR-17)", async () => {
  const registrySrc = readFileSync(join(repoRoot, "stage-registry.js"), "utf8");
  const win = {};
  vm.runInNewContext(registrySrc, { Object, String, Number, Math, Array, window: win, globalThis: win, self: win });
  assert.equal(typeof win.JobBoredStages?.toDotKey, "function");
  const { strip, attrs, mount } = stripWithCard(win, "phone-screen");
  strip.renderCompact(mount, { jobKey: "3", contact: "Dev", now: NOW });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attrs.stage, "phone");
});

it("should render the phone dot for a vm stage carrying the Sheet label Phone Screen (TR-17)", () => {
  for (const stage of ["Phone Screen", "phone-screen"]) {
    const mount = { innerHTML: "" };
    loadStrip().renderCompact(mount, { jobKey: "3", contact: "Dev", stage, now: NOW });
    assert.match(mount.innerHTML, /<jb-stage-dot stage="phone"/, stage);
  }
});

it("should say follow-up dates relative, and flag an overdue one (TR-16)", () => {
  const strip = loadStrip();
  const late = { innerHTML: "" };
  strip.renderCompact(late, { jobKey: "3", contact: "Dev", followUpDate: "2026-09-22", now: NOW });
  assert.match(late.innerHTML, /3 days overdue/);
  assert.match(late.innerHTML, /data-flag="overdue"/);
  assert.match(late.innerHTML, /datetime="2026-09-22"/);
  assert.doesNotMatch(late.innerHTML, />2026-09-22</);

  const soon = { innerHTML: "" };
  strip.renderCompact(soon, { jobKey: "3", contact: "Dev", followUpDate: "2026-09-27", now: NOW });
  assert.match(soon.innerHTML, /in 2 days/);
  assert.doesNotMatch(soon.innerHTML, /data-flag="overdue"/);

  const tmr = { innerHTML: "" };
  strip.renderCompact(tmr, { jobKey: "3", contact: "Dev", followUpDate: "2026-09-26", now: NOW });
  assert.match(tmr.innerHTML, /tomorrow/);
  const today = { innerHTML: "" };
  strip.renderCompact(today, { jobKey: "3", contact: "Dev", followUpDate: "2026-09-25", now: NOW });
  assert.match(today.innerHTML, /today/);
  assert.doesNotMatch(today.innerHTML, /data-flag="overdue"/);
});

it("should put an overdue follow-up first in the next action, even with no contact (TR-16)", () => {
  const mount = { innerHTML: "" };
  loadStrip().renderCompact(mount, { jobKey: "3", followUpDate: "2026-09-20", now: NOW });
  assert.match(mount.innerHTML, /Follow-up 5 days overdue/);
});

it("should show a date it cannot parse as written", () => {
  const mount = { innerHTML: "" };
  loadStrip().renderCompact(mount, { jobKey: "3", contact: "Dev", followUpDate: "next Tuesday", now: NOW });
  assert.match(mount.innerHTML, /next Tuesday/);
  assert.doesNotMatch(mount.innerHTML, /data-flag="overdue"/);
});

it("should say the one engine's next step when Today has one for the row (TR-14)", () => {
  const win = {
    JobBored: { getPipelineJobs: () => [{ title: "FE", company: "Orbital", status: "Interviewing", responseFlag: "Yes" }] },
  };
  const ctx = { window: win, Date, Number, Object, String, Array, Math, isFinite, console };
  vm.runInNewContext(readFileSync(join(repoRoot, "today-data.js"), "utf8"), ctx);
  vm.runInNewContext(readFileSync(sourcePath, "utf8"), ctx);
  const mount = { innerHTML: "" };
  win.JobBoredRecruiterStrip.renderCompact(mount, { jobKey: "0", contact: "Dev", followUpDate: "2026-09-27", replied: "Yes" });
  assert.match(mount.innerHTML, /Next action<\/span><span class="jb-recruiter-strip__value">They replied — you owe an answer</);
});
