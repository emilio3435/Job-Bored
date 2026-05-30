import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "flowing-writes.js"), "utf8");

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatchEvent(event) {
      const list = listeners.get(event.type) || [];
      for (const listener of list) listener.call(this, event);
      return true;
    },
  };
}

function loadRuntime(options = {}) {
  const calls = [];
  const documentEvents = [];
  const editJobFieldCalls = [];
  const warnings = [];
  const windowTarget = createEventTarget();
  const documentTarget = createEventTarget();
  documentTarget.addEventListener("jb:write:succeeded", (event) => {
    documentEvents.push({ type: event.type, detail: { ...event.detail } });
  });

  windowTarget.JobBored = {
    getAccessToken: () => "test-token",
    getSheetId: () => "sheet-123",
  };
  // The four identity fields (title/company/location/salary) route to the
  // app-side writer, which owns pipelineData + getSheetRow + the atomic
  // value+lock batch + revert. Installing it only when requested lets the
  // base column-write cases assert against the legacy writeColumn path.
  if (options.withEditJobField) {
    windowTarget.JobBored.editJobField = (jobKey, field, value) => {
      editJobFieldCalls.push({ jobKey, field, value });
    };
  }
  windowTarget.showToast = () => {};

  const context = {
    CustomEvent: TestCustomEvent,
    Date,
    Number,
    Object,
    Promise,
    RegExp,
    String,
    console: { error() {}, log() {}, warn(...args) { warnings.push(args.join(" ")); } },
    document: documentTarget,
    encodeURIComponent,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    },
    parseInt,
    window: windowTarget,
  };

  vm.runInNewContext(source, context, { filename: "flowing-writes.js" });
  return { calls, documentEvents, editJobFieldCalls, warnings, window: windowTarget };
}

async function waitForCall(calls) {
  for (let i = 0; i < 20; i++) {
    if (calls.length) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function requestRange(call) {
  const url = new URL(call.url);
  const encodedRange = url.pathname.split("/").at(-1);
  return decodeURIComponent(encodedRange);
}

describe("role writeback bridge", () => {
  const cases = [
    {
      field: "stage",
      value: "phone-screen",
      expectedRange: "Pipeline!M7",
      expectedValue: "Phone Screen",
      // Stage writes emit the legacy pipeline:move kind for symmetry with
      // the kanban drag-and-drop write path.
      expectedKind: "pipeline:move",
    },
    {
      field: "heardBack",
      value: "2026-05-19",
      expectedRange: "Pipeline!R7",
      expectedValue: "2026-05-19",
      expectedKind: "heardBack",
    },
    {
      field: "reply",
      value: "2026-05-19",
      expectedRange: "Pipeline!S7",
      expectedValue: "Yes",
      expectedKind: "reply",
    },
    {
      field: "followupAt",
      value: "2026-05-22",
      expectedRange: "Pipeline!P7",
      expectedValue: "2026-05-22",
      expectedKind: "followupAt",
    },
    {
      field: "passed",
      value: true,
      expectedRange: "Pipeline!M7",
      expectedValue: "Passed",
      expectedKind: "passed",
    },
  ];

  for (const c of cases) {
    it(`writes ${c.field} to the expected Pipeline column`, async () => {
      const runtime = loadRuntime();

      runtime.window.dispatchEvent(
        new TestCustomEvent("jb:role:writeback", {
          detail: { jobKey: 7, field: c.field, value: c.value },
        }),
      );
      await waitForCall(runtime.calls);

      assert.equal(runtime.calls.length, 1);
      const [call] = runtime.calls;
      assert.equal(call.options.method, "PUT");
      assert.equal(
        call.options.headers.Authorization,
        "Bearer test-token",
      );
      assert.equal(requestRange(call), c.expectedRange);
      assert.equal(new URL(call.url).searchParams.get("valueInputOption"), "RAW");
      assert.deepEqual(JSON.parse(call.options.body), {
        values: [[c.expectedValue]],
      });
      assert.equal(runtime.documentEvents.length, 1);
      assert.equal(runtime.documentEvents[0].type, "jb:write:succeeded");
      assert.equal(runtime.documentEvents[0].detail.jobKey, 7);
      assert.equal(runtime.documentEvents[0].detail.kind, c.expectedKind);
    });
  }
});

/* ------------------------------------------------------------------
   Identity-field routing (title / company / location / salary)
   ------------------------------------------------------------------
   WHY: these four fields are NOT single-cell column writes like the
   CRM fields above. A title/company/location/salary edit must persist
   the value AND atomically write the Edit-Lock column (Y) so the next
   discovery run does not re-clobber the user's rename. That logic lives
   in app.js editJobField (it owns pipelineData, getSheetRow, the atomic
   B/C/D/G + Y batch, and the revert). The bridge's only job is to route
   these four fields to window.JobBored.editJobField with (jobKey, field,
   value) — NEVER to writeColumn, which knows nothing about the lock.
   ------------------------------------------------------------------ */
describe("role writeback bridge — identity fields route to editJobField", () => {
  const fieldCases = [
    { field: "title", value: "Staff Engineer" },
    { field: "company", value: "Linear" },
    { field: "location", value: "Remote" },
    { field: "salary", value: "$200k" },
  ];

  for (const c of fieldCases) {
    it(`routes ${c.field} to window.JobBored.editJobField, not a column write`, async () => {
      const runtime = loadRuntime({ withEditJobField: true });

      runtime.window.dispatchEvent(
        new TestCustomEvent("jb:role:writeback", {
          detail: { jobKey: 7, field: c.field, value: c.value },
        }),
      );
      await waitForCall(runtime.editJobFieldCalls);

      // Exactly one editJobField call carrying field + value through.
      assert.equal(runtime.editJobFieldCalls.length, 1);
      assert.deepEqual(runtime.editJobFieldCalls[0], {
        jobKey: 7,
        field: c.field,
        value: c.value,
      });
      // It must NOT fall through to the legacy single-cell column writer:
      // that path has no lock awareness and would silently leave Y unset.
      assert.equal(runtime.calls.length, 0);
      assert.equal(runtime.documentEvents.length, 0);
    });
  }

  it("still warns (does not route) on an unknown field", async () => {
    const runtime = loadRuntime({ withEditJobField: true });

    runtime.window.dispatchEvent(
      new TestCustomEvent("jb:role:writeback", {
        detail: { jobKey: 7, field: "haircolor", value: "blue" },
      }),
    );
    await waitForCall(runtime.warnings);

    assert.equal(runtime.editJobFieldCalls.length, 0);
    assert.equal(runtime.calls.length, 0);
    assert.ok(
      runtime.warnings.some((w) => /unknown field/i.test(w) && /haircolor/.test(w)),
      "an unrecognized writeback field must warn rather than silently route",
    );
  });
});
