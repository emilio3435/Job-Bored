import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const flowingWritesSrc = readFileSync(join(repoRoot, "flowing-writes.js"), "utf8");

function makeCard(attrs) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    querySelector(selector) {
      if (selector !== "a[href]" || !attrs.href) return null;
      return { getAttribute: (name) => (name === "href" ? attrs.href : null) };
    },
  };
}

function loadWrites({ getPipelineSheetRow, cards = [], sheetLinks = [] } = {}) {
  const fetchCalls = [];
  const events = [];
  const listeners = Object.create(null);
  const document = {
    addEventListener(type, fn) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    dispatchEvent(event) {
      events.push(event);
      for (const fn of listeners[event.type] || []) fn(event);
      return true;
    },
    querySelectorAll(selector) {
      const match = /\[data-stable-key="([^"]+)"\]/.exec(selector);
      if (!match) return [];
      return cards.filter((card) => card.getAttribute("data-stable-key") === match[1]);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const window = {
    JobBored: {
      getAccessToken: () => "token",
      getSheetId: () => "sheet-id",
    },
  };
  if (getPipelineSheetRow) {
    window.JobBored.getPipelineSheetRow = getPipelineSheetRow;
  }
  const context = {
    window,
    document,
    CustomEvent,
    Date,
    Number,
    Object,
    String,
    parseInt,
    console,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (options.method === "PUT") {
        return { ok: true, json: async () => ({ updatedRange: url }) };
      }
      return {
        ok: true,
        json: async () => ({
          values: [["Link"], ...sheetLinks.map((link) => [link])],
        }),
      };
    },
  };
  vm.runInNewContext(flowingWritesSrc, context);
  return { writes: window.JobBoredFlowing.writes, fetchCalls, events };
}

describe("flowing-writes stage row resolution", () => {
  it("resolves numeric UI jobKey through app pipeline row mapping before row fallback", async () => {
    const { writes, fetchCalls } = loadWrites({
      getPipelineSheetRow: (jobKey) => (String(jobKey) === "1" ? 7 : null),
    });

    const row = await writes._internal.resolveSheetRow("1");

    assert.equal(row, 7);
    assert.equal(fetchCalls.length, 0, "app row mapping should not need a Sheets lookup");
  });

  it("does not treat numeric UI jobKey 2 as literal sheet row when app mapping exists", async () => {
    const { writes } = loadWrites({
      getPipelineSheetRow: (jobKey) => (String(jobKey) === "2" ? 9 : null),
    });

    assert.equal(await writes._internal.resolveSheetRow("2"), 9);
  });

  it("keeps literal sheet-row fallback for non-UI programmatic callers", async () => {
    const { writes } = loadWrites();

    assert.equal(await writes._internal.resolveSheetRow("12"), 12);
  });

  it("falls back through hidden legacy data-job-url when the v2 card matches first", async () => {
    const { writes, fetchCalls } = loadWrites({
      cards: [
        makeCard({ "data-stable-key": "1" }),
        makeCard({
          "data-stable-key": "1",
          "data-job-url": "https://example.com/jobs/b",
        }),
      ],
      sheetLinks: ["https://example.com/jobs/a", "https://example.com/jobs/b"],
    });

    assert.equal(await writes._internal.resolveSheetRow("1"), 3);
    assert.equal(fetchCalls.length, 1, "URL fallback should read Pipeline column E once");
  });

  it("writes stage moves to the resolved app row", async () => {
    const { writes, fetchCalls, events } = loadWrites({
      getPipelineSheetRow: (jobKey) => (String(jobKey) === "1" ? 7 : null),
    });

    await writes.moveStage({ jobKey: "1", fromStage: "researching", toStage: "applied" });

    const putCall = fetchCalls.find((call) => call.options.method === "PUT");
    assert.ok(putCall, "stage move should issue a Sheets update");
    assert.match(putCall.url, /\/values\/Pipeline!M7\?/);
    assert.deepEqual(JSON.parse(putCall.options.body), { values: [["Applied"]] });
    assert.ok(
      events.some((event) => event.type === "jb:write:succeeded" && event.detail.kind === "pipeline:move"),
      "stage move should emit success",
    );
  });

  it("writes discovered moves back to the New sheet status", async () => {
    const { writes, fetchCalls } = loadWrites({
      getPipelineSheetRow: (jobKey) => (String(jobKey) === "1" ? 7 : null),
    });

    await writes.moveStage({ jobKey: "1", fromStage: "applied", toStage: "new" });

    const putCall = fetchCalls.find((call) => call.options.method === "PUT");
    assert.ok(putCall, "stage move should issue a Sheets update");
    assert.match(putCall.url, /\/values\/Pipeline!M7\?/);
    assert.deepEqual(JSON.parse(putCall.options.body), { values: [["New"]] });
  });

  it("writes expired moves to the Expired sheet status", async () => {
    const { writes, fetchCalls } = loadWrites({
      getPipelineSheetRow: (jobKey) => (String(jobKey) === "1" ? 7 : null),
    });

    await writes.moveStage({ jobKey: "1", fromStage: "researching", toStage: "expired" });

    const putCall = fetchCalls.find((call) => call.options.method === "PUT");
    assert.ok(putCall, "stage move should issue a Sheets update");
    assert.match(putCall.url, /\/values\/Pipeline!M7\?/);
    assert.deepEqual(JSON.parse(putCall.options.body), { values: [["Expired"]] });
  });
});
