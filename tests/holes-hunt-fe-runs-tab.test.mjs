// HOLES HUNT-FE: every Runs row with a worker run id carries a "Save as
// hunt" switch (spec §2 HUNT.2, §3: HUNT adds only that action to
// runs-tab.js), the Scheduled filter finds hunt runs (INTERFACE-HUNTS §8),
// and a hunt's searchPlanOverride reaches the payload builder through
// triggerDiscoveryRun (§1: one pass-through line) and readiness (§1b.3).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

function makeEl(id) {
  const listeners = new Map();
  return {
    id,
    innerHTML: "",
    style: {},
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
}

function loadRunsTab(huntsUi) {
  const tbody = makeEl("runsTableBody");
  const table = makeEl("runsTable");
  const tableWrap = makeEl("__tableWrap");
  tableWrap.innerHTML = '<table class="runs-table" id="runsTable"><thead></thead><tbody id="runsTableBody"></tbody></table>';
  tableWrap.querySelector = (sel) => (sel === "#runsTable" ? table : sel === "#runsTableBody" ? tbody : null);
  const modal = makeEl("runsModal");
  modal.querySelector = (sel) => (sel === ".runs-table-wrap" ? tableWrap : null);
  const openBtn = makeEl("runsBtn");
  const byId = new Map([
    ["runsModal", modal],
    ["runsBtn", openBtn],
    ["runsModalClose", makeEl("runsModalClose")],
    ["runsRefreshBtn", makeEl("runsRefreshBtn")],
    ["runsStatus", makeEl("runsStatus")],
    ["runsTableBody", tbody],
    ["runsTable", table],
  ]);
  const document = {
    readyState: "complete",
    addEventListener() {},
    removeEventListener() {},
    getElementById: (id) => byId.get(id) || null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } }),
  };
  const window = {
    JobBored: { getSheetId: () => "sheet-1", getAccessToken: () => "" },
    JobBoredDiscovery: { status: { fetchRunHistoryPage: async () => ({ ok: true, runs: [] }) } },
    ...(huntsUi ? { JobBoredHuntsUI: huntsUi } : {}),
  };
  const storage = new Map();
  const context = {
    window,
    document,
    CustomEvent: class {},
    Element: class {},
    navigator: { userAgent: "test" },
    console,
    URL,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({ values: [] }) }),
  };
  vm.runInNewContext(read("runs-tab.js"), context, { filename: "runs-tab.js" });
  openBtn.dispatch("click", {});
  return { mod: window.JobBoredRunsLog, tableWrap, context };
}

const RUN = {
  runId: "run_7f3a",
  runAt: "2026-10-02T08:00:00Z",
  trigger: "scheduled-hunt",
  status: "success",
  leadsWritten: 3,
};

test("HUNT-FE-RUNS-1: each Runs row with a run id carries the Save-as-hunt switch from hunts-ui", () => {
  const seen = [];
  const { mod } = loadRunsTab({
    runToggleHtml(run) {
      seen.push(run.runId);
      return run.runId ? ' <button role="switch" data-runs-save-hunt="' + run.runId + '">Save as hunt</button>' : "";
    },
  });
  const tbody = { innerHTML: "" };
  mod.__test.renderRunsTable(tbody, [RUN, { ...RUN, runId: "", trigger: "manual" }]);
  assert.deepEqual(seen, ["run_7f3a", ""]);
  assert.match(tbody.innerHTML, /<td class="runs-why-cell">[\s\S]*data-runs-save-hunt="run_7f3a"[\s\S]*?<\/td>/);
  assert.equal((tbody.innerHTML.match(/data-runs-save-hunt=/g) || []).length, 1);

  const without = loadRunsTab(null);
  const plain = { innerHTML: "" };
  without.mod.__test.renderRunsTable(plain, [RUN]);
  assert.doesNotMatch(plain.innerHTML, /data-runs-save-hunt/, "no hunts-ui loaded: no switch");
});

test("HUNT-FE-RUNS-2: clicking the switch hands the run id and the button to hunts-ui", async () => {
  const calls = [];
  const { tableWrap, context } = loadRunsTab({
    runToggleHtml: () => "",
    toggleRunHunt(runId, button) {
      calls.push({ runId, button });
      return Promise.resolve(true);
    },
  });
  const button = new context.Element();
  button.getAttribute = (name) => (name === "data-runs-save-hunt" ? "run_7f3a" : null);
  button.closest = (selector) => (selector === "[data-runs-save-hunt]" ? button : null);
  tableWrap.dispatch("click", { target: button });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runId, "run_7f3a");
  assert.equal(calls[0].button, button);
});

test("HUNT-FE-RUNS-3: the Scheduled filter finds scheduled hunt runs (INTERFACE-HUNTS §8)", () => {
  const { mod } = loadRunsTab(null);
  const rows = [
    { runAt: "t", trigger: "scheduled-hunt", status: "success" },
    { runAt: "t", trigger: "hunt", status: "success" },
    { runAt: "t", trigger: "manual", status: "success" },
  ];
  const scheduled = mod.filterRuns(rows, { trigger: "scheduled", status: "all" });
  assert.deepEqual(scheduled.map((r) => r.trigger), ["scheduled-hunt"]);
});

test("HUNT-FE-RUNS-4: triggerDiscoveryRun forwards opts.hunt and readiness hands it to the shared builder", () => {
  const orchestration = read("discovery-run-orchestration.js");
  assert.ok(
    /h\("buildDiscoveryWebhookPayload", h\("getSHEET_ID"\), \{\s*trigger: runTrigger,\s*hunt: runOptions\.hunt,\s*\}\)/.test(
      orchestration,
    ),
    "triggerDiscoveryRun passes runOptions.hunt to the payload builder",
  );
  const readiness = read("discovery-readiness.js");
  const call = readiness.slice(readiness.indexOf("sharedBuilder.buildDiscoveryWebhookPayload({"));
  const body = call.slice(0, call.indexOf("});"));
  assert.ok(/\bhunt: payloadOptions\.hunt,/.test(body), "readiness passes payloadOptions.hunt");
});
