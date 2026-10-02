import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

import { flush, loadDiscoveryTab, readRepoFile } from "./holes-disco-harness.mjs";

/* HOLES DISCO — the Runs modal: one writer for the tracker's storage key
   (D12) and Cancel on the live row (D7). runs-tab.js runs against the same
   window, tracker and storage as a real tab. */

function fakeEl(id) {
  const listeners = new Map();
  return {
    id,
    innerHTML: "",
    className: "",
    style: {},
    _attrs: {},
    setAttribute(n, v) {
      this._attrs[n] = String(v);
    },
    getAttribute(n) {
      return n in this._attrs ? this._attrs[n] : null;
    },
    removeAttribute(n) {
      delete this._attrs[n];
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
}

/** Boot runs-tab.js inside a discovery tab and open the Runs modal. */
async function openRunsModal(tab, { sheetValues = [] } = {}) {
  const els = new Map();
  for (const id of ["runsModal", "runsBtn", "runsModalClose", "runsRefreshBtn", "runsStatus"]) {
    els.set(id, fakeEl(id));
  }
  const tbody = fakeEl("runsTableBody");
  const table = fakeEl("runsTable");
  const tableWrap = fakeEl("tableWrap");
  tableWrap.innerHTML = '<table id="runsTable"><tbody id="runsTableBody"></tbody></table>';
  tableWrap.querySelector = (sel) => (sel === "#runsTable" ? table : sel === "#runsTableBody" ? tbody : null);
  els.get("runsModal").querySelector = (sel) => (sel === ".runs-table-wrap" ? tableWrap : null);
  els.set("runsTableBody", tbody);
  els.set("runsTable", table);

  const { ctx, document } = tab;
  ctx.Element = class Element {};
  ctx.navigator = { userAgent: "test" };
  ctx.JobBored = { getSheetId: () => "sheet-1", getAccessToken: () => "token" };
  document.readyState = "complete";
  const realGet = document.getElementById;
  document.getElementById = (id) => els.get(id) || realGet(id);
  const sheetFetch = async (url) => {
    if (String(url).includes("sheets.googleapis.com")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ values: sheetValues }),
        text: async () => JSON.stringify({ values: sheetValues }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
  ctx.fetch = sheetFetch;
  vm.runInContext(readRepoFile("runs-tab.js"), ctx, { filename: "runs-tab.js" });
  els.get("runsBtn").dispatch("click", {});
  await flush();
  return { tbody, tableWrap, els, ctx };
}

describe("D12 · the Runs tab clears the stored run through the tracker", () => {
  it("drops the tracker's in-memory run too, so it can't be written back", async () => {
    const tab = loadDiscoveryTab();
    tab.tracker.beginTracking({
      runId: "run_stale_1",
      statusPath: "/runs/run_stale_1",
      webhookUrl: tab.webhookUrl,
      variationKey: "83c18c8789eb1b30",
    });
    await openRunsModal(tab, {
      sheetValues: [
        ["2026-10-02T12:04:00.000Z", "manual", "partial", 12, 3, 0, "worker", "83c18c8789eb1b30", ""],
      ],
    });
    assert.equal(tab.tracker.getState().runId, "", "the tracker forgot the settled run");
    // A later write from the tracker must not resurrect the stale run.
    tab.tracker.markPollError("late");
    const stored = JSON.parse(tab.storage.getItem("command_center_discovery_run_state") || "{}");
    assert.equal(stored.runId || "", "");
  });
});

describe("D7 · Cancel on the Runs row", () => {
  function runningRun(tab) {
    tab.tracker.beginTracking({ runId: "run_live", statusPath: "/runs/run_live", webhookUrl: tab.webhookUrl });
    tab.tracker.markRunning();
  }

  it("renders Cancel run on a live row the worker is running", async () => {
    const tab = loadDiscoveryTab();
    runningRun(tab);
    const { tbody } = await openRunsModal(tab);
    assert.match(tbody.innerHTML, /data-runs-cancel-run="run_live"/);
  });

  it("offers no Cancel for a run the browser can't follow", async () => {
    const tab = loadDiscoveryTab();
    tab.tracker.beginTracking({
      runId: "run_untracked",
      statusPath: "",
      statusUnavailable: true,
      webhookUrl: tab.webhookUrl,
    });
    const { tbody } = await openRunsModal(tab);
    assert.doesNotMatch(tbody.innerHTML, /data-runs-cancel-run/);
  });

  it("cancels through the status API when the row's button is clicked", async () => {
    const tab = loadDiscoveryTab();
    runningRun(tab);
    const asked = [];
    tab.status.cancelDiscoveryRun = async (runId) => {
      asked.push(runId);
      return { ok: true };
    };
    const { tableWrap, ctx } = await openRunsModal(tab);
    const button = Object.assign(Object.create(ctx.Element.prototype), fakeEl("cancel"));
    button.setAttribute("data-runs-cancel-run", "run_live");
    button.closest = (sel) => (sel === "[data-runs-cancel-run]" ? button : null);
    tableWrap.dispatch("click", { target: button });
    await flush();
    assert.deepEqual(asked, ["run_live"]);
  });
});
