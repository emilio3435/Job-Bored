/**
 * APPLY-01: moving a v2 card to Applied is not a fact until a person confirms it.
 * Mutation check: bypassing dialog.confirm, writing before it resolves, or failing
 * to emit the existing rollback event on cancel/Undo must fail this probe.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "submission-flow.js");

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function createEventTarget(record) {
  return {
    addEventListener() {},
    dispatchEvent(event) {
      record.push({ type: event.type, detail: { ...event.detail } });
      return true;
    },
  };
}

function loadRuntime({ dialogResult, runTimersImmediately = true } = {}) {
  const events = [];
  const sequence = [];
  const dialogCalls = [];
  const toastCalls = [];
  const writeCalls = [];
  const timers = [];
  const documentTarget = createEventTarget(events);
  const windowTarget = createEventTarget(events);

  windowTarget.JobBoredA11y = {
    dialog: {
      async confirm(options) {
        sequence.push("confirm");
        dialogCalls.push(options);
        return dialogResult || { confirmed: false, values: {} };
      },
    },
    toast(message, type, options) {
      sequence.push("toast");
      toastCalls.push({ message, type, options });
      return () => sequence.push("dismiss-toast");
    },
  };
  windowTarget.JobBoredApp = {
    sheetsWrite: {
      todayStr: () => "2026-08-31",
      futureDateStr: () => "2026-09-07",
      async updateJobStatus(...args) {
        sequence.push("write");
        writeCalls.push(args);
        return true;
      },
    },
  };

  const context = {
    CustomEvent: TestCustomEvent,
    Date,
    Object,
    Promise,
    String,
    console,
    document: documentTarget,
    setTimeout(callback) {
      if (runTimersImmediately) callback();
      else timers.push(callback);
      return timers.length;
    },
    window: windowTarget,
  };
  if (existsSync(sourcePath)) {
    vm.runInNewContext(readFileSync(sourcePath, "utf8"), context, {
      filename: "submission-flow.js",
    });
  }

  return {
    api: windowTarget.JobBoredSubmission,
    dialogCalls,
    events,
    sequence,
    timers,
    toastCalls,
    writeCalls,
  };
}

describe("APPLY-01 submission confirmation gate", () => {
  it("confirms before delegating the Applied write and captures the evidence fields", async () => {
    const runtime = loadRuntime({
      dialogResult: {
        confirmed: true,
        values: {
          appliedDate: "2026-08-31",
          source: "Company portal",
          receiptNote: "Receipt R-17; checklist complete",
          followUpDate: "2026-09-07",
        },
      },
    });
    assert.ok(runtime.api, "APPLY-01: submission-flow.js must install JobBoredSubmission");

    const result = await runtime.api.confirmApplied("4", { fromStage: "researching" });

    assert.deepEqual(runtime.sequence.slice(0, 2), ["confirm", "toast"]);
    assert.ok(
      runtime.sequence.indexOf("write") > runtime.sequence.indexOf("confirm"),
      "the Applied write must happen only after confirmation",
    );
    assert.equal(runtime.writeCalls.length, 1);
    assert.deepEqual(runtime.writeCalls[0], ["4", "Applied", "researching"]);
    assert.equal(result.confirmed, true);
    assert.deepEqual({ ...result.evidence }, {
      appliedDate: "2026-08-31",
      source: "Company portal",
      receiptNote: "Receipt R-17; checklist complete",
      followUpDate: "2026-09-07",
    });
    const labels = Array.from(runtime.dialogCalls[0].fields, (field) => field.label);
    assert.deepEqual(labels, [
      "Applied date",
      "Submission source",
      "Receipt or checklist note (optional)",
      "Follow-up date",
    ]);
  });

  it("cancels without writing and emits the pipeline rollback event", async () => {
    const runtime = loadRuntime({
      dialogResult: { confirmed: false, values: {} },
    });
    assert.ok(runtime.api, "APPLY-01: confirmation adapter must exist");

    const result = await runtime.api.confirmApplied("5", { fromStage: "researching" });

    assert.equal(result.confirmed, false);
    assert.equal(runtime.writeCalls.length, 0);
    assert.ok(runtime.events.some((event) =>
      event.type === "jb:write:failed" &&
      event.detail.jobKey === "5" &&
      event.detail.kind === "pipeline:move" &&
      event.detail.reason === "cancelled"
    ));
  });

  it("Undo restores the held move before the grace window can persist it", async () => {
    const runtime = loadRuntime({
      dialogResult: {
        confirmed: true,
        values: {
          appliedDate: "2026-08-31",
          source: "Email",
          receiptNote: "",
          followUpDate: "2026-09-07",
        },
      },
      runTimersImmediately: false,
    });
    assert.ok(runtime.api, "APPLY-01: confirmation adapter must exist");

    const pending = runtime.api.confirmApplied("6", { fromStage: "researching" });
    for (let i = 0; i < 10 && runtime.toastCalls.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(runtime.toastCalls.length, 1);
    runtime.toastCalls[0].options.action.onClick();
    runtime.timers.splice(0).forEach((timer) => timer());
    const result = await pending;

    assert.equal(result.confirmed, false);
    assert.equal(runtime.writeCalls.length, 0);
    assert.ok(runtime.events.some((event) =>
      event.type === "jb:write:failed" &&
      event.detail.jobKey === "6" &&
      event.detail.reason === "undone"
    ));
  });
});
