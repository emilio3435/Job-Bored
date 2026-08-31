import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const markPath = join(repoRoot, "mark-submitted.js");

function loadMarkSubmitted() {
  assert.equal(existsSync(markPath), true, "mark-submitted.js must exist (F3C-APPLY01-MARK)");
  const source = readFileSync(markPath, "utf8");
  const win = {};
  vm.runInNewContext(
    source,
    { window: win, globalThis: win, Date, Number, Math, String, Array, Object, JSON, console },
    { filename: "mark-submitted.js" },
  );
  assert.ok(win.JobBoredMarkSubmitted, "mark-submitted.js must attach window.JobBoredMarkSubmitted");
  return win.JobBoredMarkSubmitted;
}

describe("F3C-APPLY01-MARK — explicit Mark submitted confirmation", () => {
  it("rejects drag-only Applied claims without a confirmation payload", () => {
    const api = loadMarkSubmitted();
    assert.equal(typeof api.confirm, "function");

    const dragOnly = api.confirm(
      { jobKey: "1", status: "Researching" },
      { fromStage: "researching", toStage: "applied" },
      {
        transitionApplied() {
          throw new Error("F1-A adapter must not run for drag-only Applied");
        },
      },
    );

    assert.equal(dragOnly.ok, false);
    assert.match(String(dragOnly.error || ""), /confirm|payload|submittedAt|source/i);
  });

  it("requires submittedAt, source, and a receipt or checklist before calling F1-A", () => {
    const api = loadMarkSubmitted();
    const calls = [];
    const job = { jobKey: "42", title: "Staff", company: "Acme", status: "Researching" };

    const missingDate = api.confirm(job, { source: "greenhouse", checklist: ["tailored resume"] }, {
      transitionApplied: (payload) => calls.push(payload),
    });
    assert.equal(missingDate.ok, false);

    const missingSource = api.confirm(job, { submittedAt: "2026-05-20", checklist: ["tailored resume"] }, {
      transitionApplied: (payload) => calls.push(payload),
    });
    assert.equal(missingSource.ok, false);

    const missingEvidence = api.confirm(job, { submittedAt: "2026-05-20", source: "greenhouse" }, {
      transitionApplied: (payload) => calls.push(payload),
    });
    assert.equal(missingEvidence.ok, false);
    assert.equal(calls.length, 0, "F1-A adapter stays idle until the confirmation payload is complete");
  });

  it("forwards a complete confirmation payload to the F1-A transition adapter and returns undo", () => {
    const api = loadMarkSubmitted();
    const calls = [];
    const job = { jobKey: "42", title: "Staff", company: "Acme", status: "Researching" };
    const payload = {
      submittedAt: "2026-05-20T15:04:00-06:00",
      source: "greenhouse",
      receipt: "https://boards.greenhouse.io/acme/confirmation/99",
      checklist: ["tailored resume", "cover letter"],
      followUpDate: "2026-05-27",
    };

    const result = api.confirm(job, payload, {
      transitionApplied(jobArg, confirmed) {
        calls.push({ jobArg, confirmed });
        return { ok: true, undo: { jobKey: jobArg.jobKey, previousStatus: "Researching" } };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].jobArg.jobKey, "42");
    assert.equal(calls[0].confirmed.submittedAt, payload.submittedAt);
    assert.equal(calls[0].confirmed.source, "greenhouse");
    assert.equal(calls[0].confirmed.receipt, payload.receipt);
    assert.deepEqual(calls[0].confirmed.checklist, payload.checklist);
    assert.ok(result.undo, "Mark submitted must return an undo handle");

    const undone = [];
    const undoResult = api.undo(result.undo, {
      restore(handle) {
        undone.push(handle);
        return { ok: true };
      },
    });
    assert.equal(undoResult.ok, true);
    assert.equal(undone.length, 1);
  });

  it("fails closed when the F1-A transition adapter is missing", () => {
    const api = loadMarkSubmitted();
    const result = api.confirm(
      { jobKey: "7", status: "Researching" },
      {
        submittedAt: "2026-05-20",
        source: "linkedin",
        checklist: ["submitted via ATS"],
      },
      {},
    );
    assert.equal(result.ok, false);
    assert.match(String(result.error || ""), /adapter|transition/i);
  });
});
