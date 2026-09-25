/**
 * UX01 C20 / MP-07: Mark submitted offers "Add to calendar" for the
 * follow-up date, built through JobBoredToday.data.buildIcs (feature-detected)
 * and handed over as an .ics download.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "submission-flow.js"), "utf8");

function loadRuntime({ withIcs = true, followUpDate = "2026-10-02", jobs } = {}) {
  const toastCalls = [];
  const icsCalls = [];
  const blobs = [];
  const anchors = [];
  const revoked = [];
  const windowTarget = {
    addEventListener() {},
    dispatchEvent() { return true; },
    JobBoredA11y: {
      dialog: {
        async confirm() {
          return {
            confirmed: true,
            values: { appliedDate: "2026-09-25", source: "Company portal", receiptNote: "", followUpDate },
          };
        },
      },
      toast(message, type, options) {
        toastCalls.push({ message, type, options });
        return () => {};
      },
    },
    JobBoredApp: {
      sheetsWrite: {
        todayStr: () => "2026-09-25",
        futureDateStr: () => "2026-10-02",
        async updateJobStatus() { return true; },
      },
    },
    JobBored: {
      getPipelineJobs: () => jobs || [{ title: "Staff Engineer", company: "Acme Co", link: "https://example.com/jobs/1" }],
    },
    URL: {
      createObjectURL(blob) { blobs.push(blob); return "blob:ics-1"; },
      revokeObjectURL(href) { revoked.push(href); },
    },
  };
  if (withIcs) {
    windowTarget.JobBoredToday = {
      data: {
        buildIcs(opts) {
          icsCalls.push(opts);
          return "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
        },
      },
    };
  }
  const body = { appendChild(el) { el.parentNode = body; }, removeChild(el) { el.parentNode = null; } };
  const documentTarget = {
    body,
    addEventListener() {},
    dispatchEvent() { return true; },
    createElement(tag) {
      const el = { tag, style: {}, clicked: 0, click() { this.clicked++; } };
      anchors.push(el);
      return el;
    },
  };
  class FakeBlob {
    constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; }
  }
  const context = {
    Blob: FakeBlob,
    CustomEvent: class { constructor(type, o = {}) { this.type = type; this.detail = o.detail; } },
    Date,
    Object,
    Promise,
    String,
    console,
    document: documentTarget,
    setTimeout(cb) { cb(); return 1; },
    window: windowTarget,
  };
  vm.runInNewContext(source, context, { filename: "submission-flow.js" });
  return { api: windowTarget.JobBoredSubmission, toastCalls, icsCalls, blobs, anchors, revoked };
}

function calendarToast(toastCalls) {
  return toastCalls.find((c) => c.options && c.options.action && c.options.action.label === "Add to calendar");
}

describe("MP-07 Mark submitted: Add to calendar", () => {
  it("offers Add to calendar for the follow-up date and downloads an .ics built by buildIcs", async () => {
    const rt = loadRuntime();
    const result = await rt.api.confirmApplied("0", { fromStage: "researching" });
    assert.equal(result.confirmed, true);

    const toast = calendarToast(rt.toastCalls);
    assert.ok(toast, "a toast should offer Add to calendar");
    assert.match(toast.message, /2026-10-02/);
    assert.equal(rt.icsCalls.length, 0, "nothing is built until the person asks");

    toast.options.action.onClick();

    assert.equal(rt.icsCalls.length, 1);
    const opts = rt.icsCalls[0];
    assert.equal(opts.date, "2026-10-02");
    assert.equal(opts.title, "Staff Engineer");
    assert.equal(opts.company, "Acme Co");
    assert.equal(opts.jobKey, "0");
    assert.equal(opts.summary, "Follow up");
    assert.equal(rt.blobs.length, 1);
    assert.match(rt.blobs[0].type, /^text\/calendar/);
    const a = rt.anchors.find((el) => el.tag === "a");
    assert.ok(a, "an anchor should carry the download");
    assert.equal(a.download, "jobbored-acme-co-follow-up.ics");
    assert.equal(a.href, "blob:ics-1");
    assert.equal(a.clicked, 1);
    assert.deepEqual(rt.revoked, ["blob:ics-1"]);
  });

  it("keeps Undo on the Applied toast", async () => {
    const rt = loadRuntime();
    await rt.api.confirmApplied("0", { fromStage: "researching" });
    assert.match(rt.toastCalls[0].message, /^Applied: /);
    assert.equal(calendarToast(rt.toastCalls) === rt.toastCalls[0], false);
  });

  it("does not offer Add to calendar when buildIcs is missing", async () => {
    const rt = loadRuntime({ withIcs: false });
    const result = await rt.api.confirmApplied("0", { fromStage: "researching" });
    assert.equal(result.confirmed, true);
    assert.equal(calendarToast(rt.toastCalls), undefined);
  });

  it("does not offer Add to calendar without a valid follow-up date", async () => {
    const rt = loadRuntime({ followUpDate: "soon" });
    await rt.api.confirmApplied("0", { fromStage: "researching" });
    assert.equal(calendarToast(rt.toastCalls), undefined);
  });
});
