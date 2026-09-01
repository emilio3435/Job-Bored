/**
 * APPLY-01 audit ownership gate: date/source/receipt/checklist evidence needs a
 * canonical durable home and Undo semantics. The Pipeline schema owns no such
 * field today, so this executable TODO stays assertion-red until that ownership
 * contract lands. It must never be converted into a fake Sheet column/store.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "submission-flow.js");

it("persists and can remove the canonical submission evidence record", {
  todo: "blocked on the canonical-ownership gate; no legal Sheet column or IndexedDB store",
}, async () => {
  const records = [];
  const windowTarget = {
    JobBoredA11y: {
      dialog: {
        confirm: async () => ({
          confirmed: true,
          values: {
            appliedDate: "2026-08-31",
            source: "Company portal",
            receiptNote: "Receipt R-17; checklist complete",
            followUpDate: "2026-09-07",
          },
        }),
      },
      toast: () => () => {},
    },
    JobBoredApp: {
      sheetsWrite: {
        todayStr: () => "2026-08-31",
        futureDateStr: () => "2026-09-07",
        updateJobStatus: async () => true,
      },
    },
    // Hypothetical gate-owned adapter. P0-D deliberately does not consume it.
    JobBoredSubmissionRecords: {
      save(record) { records.push(record); },
      remove(jobKey) {
        const index = records.findIndex((record) => record.jobKey === jobKey);
        if (index >= 0) records.splice(index, 1);
      },
    },
  };
  const documentTarget = { dispatchEvent() { return true; } };
  class TestCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  if (existsSync(sourcePath)) {
    vm.runInNewContext(readFileSync(sourcePath, "utf8"), {
      CustomEvent: TestCustomEvent,
      Date,
      Object,
      Promise,
      String,
      console,
      document: documentTarget,
      setTimeout(callback) { callback(); return 1; },
      window: windowTarget,
    }, { filename: "submission-flow.js" });
  }
  assert.ok(windowTarget.JobBoredSubmission);

  await windowTarget.JobBoredSubmission.confirmApplied("9", {
    fromStage: "researching",
  });

  assert.deepEqual(records, [{
    jobKey: "9",
    appliedDate: "2026-08-31",
    source: "Company portal",
    receiptNote: "Receipt R-17; checklist complete",
    followUpDate: "2026-09-07",
  }]);
});
