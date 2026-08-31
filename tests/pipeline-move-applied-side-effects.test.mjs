/**
 * PIPE-04: a confirmed Applied transition must reuse the canonical side-effect
 * table so Status M, Applied Date N, and Follow-up P share one batch request.
 * Mutation check: a direct Pipeline!M PUT, a second request, or a flowing-writes
 * row re-resolution makes this test fail.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sheetsSource = readFileSync(join(repoRoot, "sheets-writeback.js"), "utf8");
const submissionPath = join(repoRoot, "submission-flow.js");

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

class FixedDate extends Date {
  constructor(value) {
    super(value === undefined ? "2026-08-31T12:00:00.000Z" : value);
  }

  static now() {
    return new FixedDate().getTime();
  }
}

function createEventTarget(events) {
  return {
    addEventListener() {},
    dispatchEvent(event) {
      events.push({ type: event.type, detail: { ...event.detail } });
      return true;
    },
  };
}

it("PIPE-04 writes M+N+P once through sheets-writeback side effects", async () => {
  const fetchCalls = [];
  const events = [];
  const jobs = [{
    _rawIndex: 5,
    title: "Infrastructure Engineer",
    status: "Researching",
    appliedDate: null,
    followUpDate: null,
  }];
  const documentTarget = createEventTarget(events);
  const windowTarget = createEventTarget(events);
  const host = {
    clearSessionAuthState() {},
    getAccessToken: () => "test-token",
    getActiveSheetId: () => "sheet-123",
    getPipelineData: () => jobs,
    getSheetId: () => "sheet-123",
    refreshAccessTokenSilently: async () => false,
    renderBrief() {},
    renderPipeline() {},
    renderStats() {},
    showSheetAccessGate() {},
    showToast() { return () => {}; },
  };
  windowTarget.JobBoredApp = { core: { host } };
  windowTarget.JobBoredA11y = {
    dialog: {
      confirm: async () => ({
        confirmed: true,
        values: {
          appliedDate: "2026-08-31",
          source: "Company portal",
          receiptNote: "Checklist complete",
          followUpDate: "2026-09-07",
        },
      }),
    },
    toast: () => () => {},
  };

  const context = {
    CustomEvent: TestCustomEvent,
    Date: FixedDate,
    Object,
    Promise,
    String,
    console,
    document: documentTarget,
    encodeURIComponent,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    window: windowTarget,
  };
  vm.runInNewContext(sheetsSource, context, { filename: "sheets-writeback.js" });
  if (existsSync(submissionPath)) {
    vm.runInNewContext(readFileSync(submissionPath, "utf8"), context, {
      filename: "submission-flow.js",
    });
  }
  assert.ok(
    windowTarget.JobBoredSubmission,
    "PIPE-04: submission adapter must delegate into sheets-writeback",
  );

  const result = await windowTarget.JobBoredSubmission.confirmApplied(0, {
    fromStage: "Researching",
  });

  assert.equal(result.confirmed, true);
  assert.equal(fetchCalls.length, 1, "confirmed Applied must use one request");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.match(fetchCalls[0].url, /\/values:batchUpdate$/);
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.deepEqual(
    body.data.map((entry) => entry.range),
    ["Pipeline!M7", "Pipeline!N7", "Pipeline!P7"],
  );
  assert.deepEqual(
    body.data.map((entry) => entry.values[0][0]),
    ["Applied", "2026-08-31", "2026-09-07"],
  );
  assert.equal(jobs[0].status, "Applied");
  assert.equal(jobs[0].appliedDate, "2026-08-31");
  assert.equal(jobs[0].followUpDate, "2026-09-07");
  assert.ok(events.some((event) =>
    event.type === "jb:write:succeeded" &&
    event.detail.kind === "pipeline:move"
  ));
});
