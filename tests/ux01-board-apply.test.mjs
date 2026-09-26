/**
 * UX01 lane D — Board & Apply (C5, C15, C16, C17, C19).
 *
 * Every probe below fails on feat/ux-zero-to-one before lane D:
 *   - TR-02  the planner ignored applyCells' false and reported success.
 *   - TR-06  the Applied dialog's date, follow-up, source and receipt were dropped.
 *   - TR-01  a planner move never synced the local row or emitted jb:write:succeeded.
 *   - TR-10  no move offered Undo; applyUndo had no caller.
 *   - AX-03  a cancelled Applied dialog still announced "Moved to Applied".
 *   - TR-11  the dossier and Today wrote Status only, bypassing the planner.
 *   - MP-04  confirmApplied had no prefill API for the return-from-posting prompt.
 *   - FD-01  a URL-ingest failure left no way to save the role.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

class TestCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

const ROW = Object.freeze({
  sheetRow: 7,
  status: "Researching",
  notes: "",
  appliedDate: "",
  followUpDate: "",
  lastContact: "",
  dismissedAt: "",
});

/** Load planner + adapter (+ optional submission-flow) into one window. */
function loadStack({ applyCells, withSubmission = false, dialogResult, jobs } = {}) {
  const events = [];
  const cellsWritten = [];
  const toasts = [];
  const localPatches = [];
  const document = {
    dispatchEvent(event) {
      events.push({ type: event.type, detail: event.detail });
      return true;
    },
    addEventListener() {},
  };
  const window = {
    document,
    dispatchEvent() { return true; },
    JobBored: { getPipelineJobs: () => jobs || [{ title: "Staff Engineer", company: "Acme" }] },
    JobBoredApp: {
      pipelineController: {
        applyPipelineCellPatches(jobKey, patches) {
          localPatches.push({ jobKey, patches });
          return true;
        },
      },
    },
    JobBoredA11y: {
      dialog: {
        confirm: async (spec) => {
          window.__dialogSpec = spec;
          return dialogResult || { confirmed: false, values: {} };
        },
      },
      toast(message, type, opts) {
        toasts.push({ message, type, opts });
        return () => {};
      },
      live: { announce() {} },
    },
  };
  const ctx = {
    window,
    document,
    CustomEvent: TestCustomEvent,
    console,
    Promise,
    Date,
    setTimeout,
    clearTimeout,
    globalThis: window,
  };
  vm.runInNewContext(read("pipeline-transitions.js"), ctx, { filename: "pipeline-transitions.js" });
  vm.runInNewContext(read("pipeline-transition-adapter.js"), ctx, { filename: "pipeline-transition-adapter.js" });
  window.JobBoredPipelineTransitionAdapter.host = {
    getRow: (jobKey) => (String(jobKey) === "0" ? { ...ROW } : null),
    patchApi: {
      applyCells: async (patches) => {
        cellsWritten.push(patches);
        return applyCells ? applyCells(patches) : true;
      },
    },
  };
  if (withSubmission) {
    window.JobBoredSubmission = {
      host: {
        sheetsWrite: {
          todayStr: () => "2026-09-25",
          futureDateStr: () => "2026-10-02",
          updateJobStatus: async () => { throw new Error("legacy writer must not run when the planner can"); },
        },
      },
    };
    vm.runInNewContext(read("submission-flow.js"), ctx, { filename: "submission-flow.js" });
  }
  return { window, events, cellsWritten, toasts, localPatches };
}

describe("C17 one planner for every move", () => {
  it("TR-02: the planner reports write_failed when the Sheet refuses the batch", async () => {
    const { window } = loadStack();
    const result = await window.JobBoredPipelineTransitions.applyTransition(
      { row: { ...ROW }, fromStage: "researching", toStage: "interviewing", now: new Date("2026-09-25T12:00:00Z") },
      { applyCells: async () => false },
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, "write_failed");
  });

  it("TR-02: the adapter rolls the card back with jb:write:failed when applyCells returns false", async () => {
    const { window, events } = loadStack({ applyCells: () => false });
    const result = await window.JobBoredPipelineTransitionAdapter.move({
      jobKey: "0", fromStage: "researching", toStage: "interviewing",
    });
    assert.equal(result.ok, false);
    const failed = events.find((e) => e.type === "jb:write:failed");
    assert.ok(failed, "a refused write must dispatch jb:write:failed");
    assert.equal(failed.detail.reason, "write_failed");
    assert.equal(events.some((e) => e.type === "jb:pipeline:move"), false, "no second writer");
  });

  it("TR-01: a successful move syncs the local row and emits jb:write:succeeded", async () => {
    const { window, events, localPatches } = loadStack();
    const result = await window.JobBoredPipelineTransitionAdapter.move({
      jobKey: "0", fromStage: "researching", toStage: "interviewing",
    });
    assert.equal(result.ok, true);
    assert.equal(localPatches.length, 1, "the planned cells must reach pipelineData");
    assert.ok(localPatches[0].patches.some((p) => p.column === "M" && p.value === "Interviewing"));
    const ok = events.find((e) => e.type === "jb:write:succeeded");
    assert.ok(ok, "board, Today and Dawn re-render on jb:write:succeeded");
    assert.equal(ok.detail.kind, "pipeline:move");
    assert.equal(ok.detail.jobKey, "0");
    assert.equal(ok.detail.toStage, "interviewing");
  });

  it("TR-10: every move offers Undo that writes the rollback cells", async () => {
    const { window, toasts, cellsWritten, localPatches } = loadStack();
    const result = await window.JobBoredPipelineTransitionAdapter.move({
      jobKey: "0", fromStage: "researching", toStage: "rejected",
    });
    assert.equal(typeof result.undo, "function", "the move result carries undo()");
    const toast = toasts.find((t) => /Rejected/.test(t.message));
    assert.ok(toast, "the move names the stage in a toast");
    assert.match(toast.message, /Staff Engineer/, "and names the role");
    assert.equal(toast.opts.action.label, "Undo");
    await toast.opts.action.onClick();
    const last = cellsWritten[cellsWritten.length - 1];
    assert.ok(last.some((p) => p.column === "M" && p.value === "Researching"), "Undo restores Status");
    assert.ok(localPatches.length >= 2, "Undo also re-syncs the local row");
  });
});

describe("C15 Applied writes what was typed", () => {
  const typed = {
    confirmed: true,
    values: {
      "jb-submission-applied-date": "2026-09-20",
      "jb-submission-source": "Referral from Sam",
      "jb-submission-receipt-note": "Confirmation #A1B2",
      "jb-submission-follow-up-date": "2026-10-09",
    },
  };

  it("TR-06: date, follow-up, source and receipt reach the Sheet through the planner", async () => {
    const { window, cellsWritten } = loadStack({ withSubmission: true, dialogResult: typed });
    const result = await window.JobBoredSubmission.confirmApplied("0", { fromStage: "researching" });
    assert.equal(result.confirmed, true);
    assert.equal(cellsWritten.length, 1, "one atomic batch");
    const byCol = Object.fromEntries(cellsWritten[0].map((p) => [p.column, p.value]));
    assert.equal(byCol.M, "Applied");
    assert.equal(byCol.N, "2026-09-20");
    assert.equal(byCol.P, "2026-10-09");
    assert.match(byCol.O, /Referral from Sam/);
    assert.match(byCol.O, /Confirmation #A1B2/);
  });

  it("TA-19: writes immediately and names the role with an Undo", async () => {
    const { window, toasts, cellsWritten } = loadStack({ withSubmission: true, dialogResult: typed });
    await window.JobBoredSubmission.confirmApplied("0", { fromStage: "researching" });
    const toast = toasts.find((t) => t.opts && t.opts.action && t.opts.action.label === "Undo");
    assert.ok(toast, "Applied offers Undo");
    assert.match(toast.message, /Staff Engineer/);
    assert.match(toast.message, /Acme/);
    assert.doesNotMatch(toast.message, /Saving in 10 seconds/);
    await toast.opts.action.onClick();
    const last = cellsWritten[cellsWritten.length - 1];
    assert.ok(last.some((p) => p.column === "M" && p.value === "Researching"), "Undo restores the stage");
  });

  it("AX-03: a cancelled Applied move resolves cancelled through the adapter, writing nothing", async () => {
    const { window, cellsWritten, events } = loadStack({
      withSubmission: true,
      dialogResult: { confirmed: false, values: {} },
    });
    const result = await window.JobBoredPipelineTransitionAdapter.move({
      jobKey: "0", fromStage: "researching", toStage: "applied",
    });
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.equal(cellsWritten.length, 0);
    assert.equal(events.some((e) => e.type === "jb:pipeline:move"), false, "no hand-off loop");
    assert.ok(events.some((e) => e.type === "jb:write:failed" && e.detail.reason === "cancelled"));
  });

  it("AX-03: the stage menu says the move was cancelled, not that it happened", async () => {
    const src = read("jb-a11y.js");
    assert.match(src, /Move cancelled; still in /);
    assert.doesNotMatch(
      src,
      /\/\/ Optimistic announce, then revert copy on failure/,
      "the menu must announce after the write settles",
    );
  });
});

describe("C16 prefill API", () => {
  it("MP-04: confirmApplied({dataIndex, prefill}) opens the dialog with source and date filled", async () => {
    const { window } = loadStack({ withSubmission: true, dialogResult: { confirmed: false, values: {} } });
    const result = await window.JobBoredSubmission.confirmApplied({
      dataIndex: 0,
      prefill: { source: "Company careers page", date: "2026-09-24" },
    });
    assert.equal(result.confirmed, false);
    const fields = Object.fromEntries(window.__dialogSpec.fields.map((f) => [f.id, f.value]));
    assert.equal(fields["jb-submission-source"], "Company careers page");
    assert.equal(fields["jb-submission-applied-date"], "2026-09-24");
    assert.match(window.__dialogSpec.body + window.__dialogSpec.title, /Acme/, "the dialog names the company");
  });
});

describe("TR-11 the dossier and Today share the planner", () => {
  it("flowing-writes.moveStage routes through the transition adapter when it can plan", async () => {
    const { window, cellsWritten, events } = loadStack();
    let fetched = 0;
    const ctx = {
      window,
      document: window.document,
      CustomEvent: TestCustomEvent,
      console,
      Promise,
      fetch: async () => { fetched += 1; return { ok: true, json: async () => ({}) }; },
    };
    vm.runInNewContext(read("flowing-writes.js"), ctx, { filename: "flowing-writes.js" });
    await window.JobBoredFlowing.writes.moveStage({ jobKey: "0", fromStage: "applied", toStage: "interviewing" });
    assert.equal(fetched, 0, "no Status-only PUT");
    assert.equal(cellsWritten.length, 1);
    const cols = cellsWritten[0].map((p) => p.column);
    assert.ok(cols.includes("M") && cols.includes("P"), "Status and follow-up in one batch");
    assert.ok(events.some((e) => e.type === "jb:write:succeeded"));
  });
});

describe("C5 URL failure opens prefilled manual entry", () => {
  it("FD-01: ingest-url-flow exposes JobBoredIngest.openManual with prefill", () => {
    const src = read("ingest-url-flow.js");
    assert.match(src, /window\.JobBoredIngest\s*=/);
    assert.match(src, /openManual/);
  });

  it("FD-01: the pipeline URL modal hands failures to JobBoredIngest.openManual", () => {
    const src = read("pipeline.js");
    assert.match(src, /JobBoredIngest[\s\S]{0,120}openManual/);
    assert.match(src, /data-pipeline-url-manual/, "the URL modal offers Add manually (FD-02)");
    assert.doesNotMatch(src, /ask Gemini to fill/, "FD-22: provider-neutral copy");
    assert.doesNotMatch(src, /pipe-url-modal__eyebrow">Manual add/, "FD-22: no Manual add eyebrow");
  });
});

describe("C17/C19 card and board semantics", () => {
  const src = read("pipeline.js");
  const css = read("pipeline.css");
  it("AX-13: the card article is not a button; the title is a real Open dossier button", () => {
    assert.doesNotMatch(src, /el\.setAttribute\("role", "button"\)/);
    assert.match(src, /Open dossier: /);
    assert.doesNotMatch(src, / — open letter/);
  });
  it("AX-14: the board is not an empty list; columns stay named regions", () => {
    assert.doesNotMatch(src, /class="pipe-board" role="list"/);
    assert.match(src, /'<section class="pipe-col" data-stage="/);
  });
  it("TR-03: a drag marks the card before the tap handler can open the dossier", () => {
    assert.match(src, /drag\.moved = true;\s*\n\s*drag\.card\.__pipeJustDragged = true;/);
  });
  it("AX-04/AX-10: cards keep a focus ring and are never dimmed by opacity", () => {
    assert.match(css, /\.pipe-sticker__open:focus-visible/);
    assert.doesNotMatch(css, /opacity: 0\.78/);
  });
  it("C19: list view under 760 px with a Board toggle", () => {
    assert.match(src, /data-pipeline-view=/);
    assert.match(css, /\[data-view="list"\]/);
  });
});

/* ------------------------------------------------------------------------
 * Conformance pass against the mockup (2026-09-25). Each probe below was red
 * on 15cc958 (lane D + lane C merged) before the fix.
 * ---------------------------------------------------------------------- */

describe("conformance C17: a failed move names the role and the stage, with Retry", () => {
  it("SS-07: a refused planner write toasts the role, the stage it stayed in, and Retry", async () => {
    let calls = 0;
    const { window, toasts, events } = loadStack({
      applyCells: () => {
        calls += 1;
        return calls > 1; // first write refused, the retry lands
      },
    });
    const result = await window.JobBoredPipelineTransitionAdapter.move({
      jobKey: "0", fromStage: "researching", toStage: "interviewing",
    });
    assert.equal(result.ok, false);
    const failToast = toasts.find((t) => t.type === "error");
    assert.ok(failToast, "a failed move must show a toast, not only a live-region line");
    assert.match(failToast.message, /Staff Engineer at Acme/, "names the role");
    assert.match(failToast.message, /Researching/, "names the stage it stayed in");
    assert.equal(failToast.opts.action.label, "Retry");
    const failed = events.find((e) => e.type === "jb:write:failed");
    assert.equal(failed.detail.announced, true, "the board must not stack a second toast");
    await failToast.opts.action.onClick();
    assert.equal(calls, 2, "Retry re-issues the same move through the planner");
    assert.ok(events.some((e) => e.type === "jb:write:succeeded"), "the retried move lands");
  });

  it("SS-07: a cancelled Applied dialog is not a failure toast", async () => {
    const { window, toasts } = loadStack({
      withSubmission: true,
      dialogResult: { confirmed: false, values: {} },
    });
    await window.JobBoredPipelineTransitionAdapter.move({
      jobKey: "0", fromStage: "researching", toStage: "applied",
    });
    assert.equal(toasts.some((t) => t.type === "error"), false);
  });

  it("SS-07: the board's own failure toast names the role too, and skips moves the adapter announced", () => {
    const src = read("pipeline.js");
    assert.match(src, /detail\.announced/);
    assert.doesNotMatch(src, /"Couldn't save the move\. It is still in "/);
  });
});

describe("conformance C15: Applied dialog", () => {
  it("TR-06/TA-04: the primary reads Mark applied, matching the stage it sets", async () => {
    const { window } = loadStack({ withSubmission: true, dialogResult: { confirmed: false, values: {} } });
    await window.JobBoredSubmission.confirmApplied("0", { fromStage: "researching" });
    assert.equal(window.__dialogSpec.confirmLabel, "Mark applied");
  });

  it("TR-06/TA-04: the dialog's primary is the kit's filled navy button, the cancel its secondary", () => {
    const src = read("jb-a11y.js");
    assert.match(src, /jb-a11y-dialog__btn--confirm[^"]*jb-btn jb-btn--primary|jb-btn jb-btn--primary[^"]*jb-a11y-dialog__btn--confirm/);
    assert.match(src, /jb-a11y-dialog__btn--cancel[^"]*jb-btn jb-btn--secondary|jb-btn jb-btn--secondary[^"]*jb-a11y-dialog__btn--cancel/);
    const css = read("jb-a11y.css");
    assert.doesNotMatch(css, /\.jb-a11y-dialog__btn--confirm\s*\{[^}]*mint-soft/, "no pale mint primary");
  });

  it("TA-21: a Sent with it group lists the role's materials, preselected", async () => {
    const { window } = loadStack({ withSubmission: true, dialogResult: { confirmed: false, values: {} } });
    await window.JobBoredSubmission.confirmApplied({
      dataIndex: 0,
      prefill: {
        materials: [
          { id: "resume", label: "Tailored resume v2" },
          { id: "cover_letter", label: "Cover letter v1" },
        ],
      },
    });
    const group = window.__dialogSpec.checks;
    assert.ok(group, "the dialog spec carries a checkbox group");
    assert.equal(group.label, "Sent with it");
    assert.deepEqual(JSON.parse(JSON.stringify(group.items.map((i) => [i.label, i.checked]))), [
      ["Tailored resume v2", true],
      ["Cover letter v1", true],
    ]);
  });

  it("TA-21: the checked materials are recorded in Notes with the application", async () => {
    const { window, cellsWritten } = loadStack({
      withSubmission: true,
      dialogResult: {
        confirmed: true,
        values: {
          "jb-submission-source": "Greenhouse",
          "jb-submission-sent-resume": "true",
          "jb-submission-sent-cover_letter": "false",
        },
      },
    });
    await window.JobBoredSubmission.confirmApplied({
      dataIndex: 0,
      fromStage: "researching",
      prefill: {
        materials: [
          { id: "resume", label: "Tailored resume v2" },
          { id: "cover_letter", label: "Cover letter v1" },
        ],
      },
    });
    const byCol = Object.fromEntries(cellsWritten[0].map((p) => [p.column, p.value]));
    assert.match(byCol.O, /sent: Tailored resume v2/);
    assert.doesNotMatch(byCol.O, /Cover letter v1/, "an unchecked file is not recorded");
  });

  it("TA-21: without a prefill, the dialog asks the board for the role's materials", () => {
    const src = read("submission-flow.js");
    assert.match(src, /JobBoredPipeline[\s\S]{0,80}materialsFor/);
    assert.match(read("pipeline.js"), /materialsFor\s*=/);
  });
});

describe("conformance C5: an unreadable link opens a plain warn banner", () => {
  const COPY = "We couldn't read that page from here. Fill in the rest and it goes straight to your Sheet.";
  it("FD-01/FR-04: the URL modal's failure path hands over the plain copy, not the transport error", () => {
    const src = read("pipeline.js");
    assert.ok(src.includes(COPY), "the mockup's sentence");
    assert.doesNotMatch(src, /Couldn't read the posting automatically \(" \+/, "no error text spliced in");
  });
  it("FD-01: the manual modal shows that copy in a jb-banner warn, not paragraph text", () => {
    const partial = read("partials/ingest-manual-modal.html");
    assert.match(partial, /class="jb-banner[^"]*"[^>]*data-tone="warn"|data-tone="warn"[^>]*class="jb-banner/);
    const flow = read("ingest-url-flow.js");
    assert.match(flow, /tone/);
    assert.doesNotMatch(flow, /CORS|Cloudflare Access|stale tunnel/, "no network jargon reaches the manual form");
  });
});

describe("conformance C19: six active columns and a Closed row", () => {
  const src = read("pipeline.js");
  const css = read("pipeline.css");
  it("TR-09: Rejected, Passed and Expired render in a Closed chip row, not as board columns", () => {
    assert.match(src, /pipe-closed/);
    assert.match(src, /CLOSED_STAGES/);
    assert.doesNotMatch(css, /var\(--pipe-col-rejected\)\s*\n\s*var\(--pipe-col-passed\)/);
  });
  it("TR-16: a resting card shows one place · pay line", () => {
    assert.match(src, /pipe-sticker__meta/);
    assert.match(css, /\.pipe-sticker__meta/);
  });
});
