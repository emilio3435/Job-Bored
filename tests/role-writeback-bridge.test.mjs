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

function loadRuntime() {
  const calls = [];
  const documentEvents = [];
  const windowTarget = createEventTarget();
  const documentTarget = createEventTarget();
  documentTarget.addEventListener("jb:write:succeeded", (event) => {
    documentEvents.push({ type: event.type, detail: { ...event.detail } });
  });

  windowTarget.JobBored = {
    getAccessToken: () => "test-token",
    getSheetId: () => "sheet-123",
  };
  windowTarget.showToast = () => {};

  const context = {
    CustomEvent: TestCustomEvent,
    Date,
    Number,
    Object,
    Promise,
    RegExp,
    String,
    console: { error() {}, log() {}, warn() {} },
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
  return { calls, documentEvents, window: windowTarget };
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
