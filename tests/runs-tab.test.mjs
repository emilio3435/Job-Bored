import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadRunsTab() {
  const source = await readFile(join(repoRoot, "runs-tab.js"), "utf8");
  const storage = new Map();
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
  const document = {
    readyState: "loading",
    addEventListener() {},
    getElementById() {
      return null;
    },
    createElement() {
      return { style: {}, setAttribute() {}, appendChild() {} };
    },
  };
  const window = {};
  const context = {
    window,
    document,
    navigator: { userAgent: "test" },
    console,
    URL,
    localStorage,
    setInterval,
    clearInterval,
    fetch: async () => {
      throw new Error("fetch not stubbed");
    },
  };
  vm.runInNewContext(source, context, { filename: "runs-tab.js" });
  return window.JobBoredRunsLog;
}

/**
 * Build a fake-DOM harness rich enough to exercise initRunsTab() end to end.
 * Just a bag of query-able element stubs — the tests drive it by invoking
 * the captured document-level event listeners and reading innerHTML.
 */
function makeFakeDom() {
  const docListeners = new Map();

  function makeEl(id, extras = {}) {
    const el = {
      id,
      innerHTML: "",
      _className: "",
      _attrs: {},
      _listeners: new Map(),
      style: {},
      children: extras.children || [],
      setAttribute(name, value) { this._attrs[name] = String(value); },
      getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; },
      removeAttribute(name) { delete this._attrs[name]; },
      addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const arr = this._listeners.get(type);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i !== -1) arr.splice(i, 1);
      },
      dispatch(type, event) {
        const arr = this._listeners.get(type) || [];
        for (const fn of arr) fn(event);
      },
      querySelector(sel) {
        if (sel === ".runs-table-wrap") return extras.tableWrap || null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === "[data-runs-filter-group]") return extras.filterGroups || [];
        if (sel === ".runs-filter-chip") return extras.chips || [];
        return [];
      },
      closest() { return null; },
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() { return false; },
      },
    };
    Object.defineProperty(el, "className", {
      get() { return this._className; },
      set(v) { this._className = String(v); },
    });
    return el;
  }

  const tbody = makeEl("runsTableBody");
  // tableWrap holds the real <table> markup so initRunsTab can capture its
  // originalTableWrapHtml and restore after empty-state renders.
  const tableWrap = makeEl("__tableWrap", {});
  tableWrap.innerHTML =
    '<table class="runs-table" id="runsTable"><thead></thead>' +
    '<tbody id="runsTableBody"></tbody></table>';
  // querySelector on tableWrap returns the persistent table/tbody so the
  // controller can re-hydrate after the empty state wipes them.
  const table = makeEl("runsTable");
  tableWrap.querySelector = function (sel) {
    if (sel === "#runsTable") return table;
    if (sel === "#runsTableBody") return tbody;
    return null;
  };
  const modal = makeEl("runsModal", {
    tableWrap,
    filterGroups: [],
    chips: [],
  });
  const openBtn = makeEl("runsBtn");
  const closeBtn = makeEl("runsModalClose");
  const refreshBtn = makeEl("runsRefreshBtn");
  const statusEl = makeEl("runsStatus");

  const byId = new Map([
    ["runsModal", modal],
    ["runsBtn", openBtn],
    ["runsModalClose", closeBtn],
    ["runsRefreshBtn", refreshBtn],
    ["runsStatus", statusEl],
    ["runsTableBody", tbody],
    ["runsTable", table],
  ]);

  const document = {
    readyState: "complete",
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = docListeners.get(type);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    dispatchDoc(type, event) {
      const arr = docListeners.get(type) || [];
      for (const fn of arr) fn(event);
    },
    getElementById(id) {
      return byId.get(id) || null;
    },
    createElement() {
      return {
        style: {},
        setAttribute() {},
        appendChild() {},
        classList: { add() {}, remove() {} },
      };
    },
  };

  return { document, modal, openBtn, tbody, tableWrap, statusEl, docListeners };
}

async function bootInitRunsTab({
  fetchImpl,
  sheetId = "sheet-1",
  accessToken = "tok",
  storedJobRunState = null,
} = {}) {
  const source = await readFile(join(repoRoot, "runs-tab.js"), "utf8");
  const dom = makeFakeDom();
  const storage = new Map();
  if (storedJobRunState) {
    storage.set(
      "command_center_discovery_run_state",
      JSON.stringify(storedJobRunState),
    );
  }
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
  const window = {
    JobBored: {
      getSheetId: () => sheetId,
      getAccessToken: () => accessToken,
    },
  };
  const timers = [];
  const context = {
    window,
    document: dom.document,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    Element: class {},
    navigator: { userAgent: "test" },
    console,
    URL,
    localStorage,
    setInterval: (fn, ms) => {
      const id = timers.length;
      timers.push({ fn, ms });
      return id;
    },
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    fetch: fetchImpl || (async () => {
      throw new Error("fetch not stubbed");
    }),
  };
  vm.runInNewContext(source, context, { filename: "runs-tab.js" });
  // initRunsTab() runs via readyState !== "loading" — all listeners are
  // registered against openBtn + document. Simulate an open click.
  dom.openBtn.dispatch("click", {});
  // Flush any pending microtasks from loadRuns().
  await new Promise((resolve) => setImmediate(resolve));
  return { dom, window, context, localStorageRaw: storage };
}

function asPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("parseDiscoveryRunsValues", () => {
  it("maps sheet rows into typed run objects in input order", async () => {
    const mod = await loadRunsTab();
    const rows = [
      [
        "2026-04-21T15:12:03Z",
        "manual",
        "success",
        47,
        12,
        3,
        "worker@v0.4.1",
        "gh-1234-abcd",
        "",
      ],
      [
        "2026-04-21T16:00:00Z",
        "scheduled-github",
        "failure",
        5,
        1,
        0,
        "worker@v0.4.1",
        "gh-5678",
        "timeout on acme.com",
      ],
    ];
    const runs = mod.parseDiscoveryRunsValues(rows);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].trigger, "manual");
    assert.equal(runs[0].durationS, 47);
    assert.equal(runs[0].companiesSeen, 12);
    assert.equal(runs[0].leadsWritten, 3);
    assert.equal(runs[0].leadsUpdated, 0);
    assert.equal(runs[1].status, "failure");
    assert.equal(runs[1].error, "timeout on acme.com");
  });

  it("parses the extended 10-column shape with leadsUpdated", async () => {
    const mod = await loadRunsTab();
    const rows = [
      [
        "2026-04-21T15:12:03Z",
        "manual",
        "success",
        47,
        12,
        3,
        9,
        "worker@v0.4.1",
        "gh-1234-abcd",
        "",
      ],
    ];
    const runs = mod.parseDiscoveryRunsValues(rows);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].leadsWritten, 3);
    assert.equal(runs[0].leadsUpdated, 9);
    assert.equal(runs[0].source, "worker@v0.4.1");
  });

  it("skips rows missing Run At / Trigger / Status", async () => {
    const mod = await loadRunsTab();
    const rows = [
      ["", "manual", "success", 1, 1, 1, "w", "v", ""],
      ["2026-04-21T10:00:00Z", "", "success", 1, 1, 1, "w", "v", ""],
      ["2026-04-21T10:00:00Z", "manual", "success", 1, 1, 1, "w", "v", ""],
    ];
    const runs = mod.parseDiscoveryRunsValues(rows);
    assert.equal(runs.length, 1);
  });

  it("returns [] for non-array input", async () => {
    const mod = await loadRunsTab();
    assert.deepEqual(asPlain(mod.parseDiscoveryRunsValues(null)), []);
    assert.deepEqual(asPlain(mod.parseDiscoveryRunsValues({})), []);
  });
});

describe("displayVariationKey", () => {
  it("hides the sheetId fallback for worker@profile rows", async () => {
    const mod = await loadRunsTab();
    assert.equal(
      mod.__test.displayVariationKey(
        { source: "worker@profile", variationKey: "sheet-opt-b" },
        "sheet-opt-b",
      ),
      "",
    );
    assert.equal(
      mod.__test.displayVariationKey(
        { source: "worker", variationKey: "sheet-opt-b" },
        "sheet-opt-b",
      ),
      "sheet-opt-b",
    );
  });
});

describe("sortRuns", () => {
  it("sorts descending by runAt when direction='desc'", async () => {
    const mod = await loadRunsTab();
    const runs = [
      { runAt: "2026-04-21T10:00:00Z", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
      { runAt: "2026-04-21T16:00:00Z", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
      { runAt: "2026-04-21T12:00:00Z", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
    ];
    const sorted = mod.sortRuns(runs, "runAt", "desc");
    assert.equal(sorted[0].runAt, "2026-04-21T16:00:00Z");
    assert.equal(sorted[2].runAt, "2026-04-21T10:00:00Z");
  });

  it("sorts numerically on leadsWritten", async () => {
    const mod = await loadRunsTab();
    const runs = [
      { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 2, leadsUpdated: 0, source: "", variationKey: "", error: "" },
      { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 10, leadsUpdated: 0, source: "", variationKey: "", error: "" },
      { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
    ];
    const sorted = mod.sortRuns(runs, "leadsWritten", "asc");
    assert.deepEqual(sorted.map((r) => r.leadsWritten), [0, 2, 10]);
  });
});

describe("filterRuns", () => {
  const sample = [
    { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
    { runAt: "t", trigger: "scheduled-local", status: "failure", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "x" },
    { runAt: "t", trigger: "scheduled-github", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
    { runAt: "t", trigger: "cli", status: "partial", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
  ];

  it("all/all returns every row", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "all", status: "all" });
    assert.equal(result.length, 4);
  });

  it("trigger='scheduled' matches both scheduled-local and scheduled-github", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "scheduled", status: "all" });
    const triggers = result.map((r) => r.trigger).sort();
    assert.deepEqual(triggers, ["scheduled-github", "scheduled-local"]);
  });

  it("status='failure' filters to failures only", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "all", status: "failure" });
    assert.equal(result.length, 1);
    assert.equal(result[0].trigger, "scheduled-local");
  });

  it("status='success' excludes partial runs", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "all", status: "success" });
    assert.equal(result.length, 2);
    for (const run of result) assert.equal(run.status, "success");
  });

  it("trigger='manual' excludes scheduled and cli", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "manual", status: "all" });
    assert.equal(result.length, 1);
    assert.equal(result[0].trigger, "manual");
  });
});

describe("fetchDiscoveryRuns", () => {
  function makeResponse(status, payload, text) {
    return new Response(
      text !== undefined ? text : JSON.stringify(payload),
      {
        status,
        headers: { "content-type": "application/json" },
      },
    );
  }

  it("returns {ok:false, reason:'signed_out'} when no access token provided", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "", {
      fetchImpl: async () => {
        throw new Error("should not fetch when signed out");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "signed_out");
  });

  it("returns {ok:true, runs:[], reason:'missing_tab'} when Sheets returns 400 parse-range error", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "tok", {
      fetchImpl: async () =>
        makeResponse(
          400,
          null,
          '{"error":{"code":400,"message":"Unable to parse range: DiscoveryRuns!A2:J"}}',
        ),
    });
    assert.equal(result.ok, true);
    assert.equal(result.runs.length, 0);
    assert.equal(result.reason, "missing_tab");
  });

  it("returns {ok:true, runs:[], reason:'empty'} when the tab exists but has no rows", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "tok", {
      fetchImpl: async () => makeResponse(200, { values: [] }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.runs.length, 0);
    assert.equal(result.reason, "empty");
  });

  it("returns newest-first runs on success", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "tok", {
      fetchImpl: async () =>
        makeResponse(200, {
          values: [
            [
              "2026-04-21T10:00:00Z",
              "manual",
              "success",
              30,
              5,
              1,
              "worker",
              "var-1",
              "",
            ],
            [
              "2026-04-21T12:00:00Z",
              "scheduled-github",
              "failure",
              60,
              10,
              0,
              "worker",
              "var-2",
              "boom",
            ],
            [
              "2026-04-21T11:00:00Z",
              "manual",
              "success",
              45,
              8,
              2,
              "worker",
              "var-3",
              "",
            ],
          ],
        }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.runs.length, 3);
    assert.equal(result.runs[0].runAt, "2026-04-21T12:00:00Z");
    assert.equal(result.runs[2].runAt, "2026-04-21T10:00:00Z");
  });

  it("returns {ok:false, reason:'unauthorized'} on HTTP 401", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "tok", {
      fetchImpl: async () => makeResponse(401, { error: "nope" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unauthorized");
  });

  it("sends Bearer token and hits the DiscoveryRuns!A2:J range with UNFORMATTED_VALUE", async () => {
    const mod = await loadRunsTab();
    let seen = null;
    await mod.fetchDiscoveryRuns("sheet-abc", "tok-xyz", {
      fetchImpl: async (url, init) => {
        seen = { url: String(url), headers: init && init.headers };
        return makeResponse(200, { values: [] });
      },
    });
    assert.ok(seen);
    assert.match(seen.url, /\/spreadsheets\/sheet-abc\/values\//);
    // `!` is an unreserved char per encodeURIComponent, so the range stays as
    // "DiscoveryRuns!A2%3AJ" (colon is percent-encoded, bang is not).
    assert.match(seen.url, /DiscoveryRuns!A2%3AJ/);
    assert.match(seen.url, /valueRenderOption=UNFORMATTED_VALUE/);
    assert.equal(seen.headers.Authorization, "Bearer tok-xyz");
  });
});

describe("renderGhostRowHtml (ghost row markup)", () => {
  it("returns a runs-row--in-progress <tr> with a data-runs-ghost marker and an in_progress status badge", async () => {
    const mod = await loadRunsTab();
    const html = mod.__test.renderGhostRowHtml({ runAt: "2026-04-21T20:00:00Z" });
    assert.match(html, /class="runs-row runs-row--in-progress"/);
    assert.match(html, /data-runs-ghost="1"/);
    assert.match(html, /runs-status-badge--in_progress/);
    // The non-status cells are em-dashes per the brief.
    assert.match(html, /<span class="runs-dash">—<\/span>/);
    // The manual trigger label.
    assert.match(html, /Manual/);
  });

  it("defaults to the current time when no runAt is supplied", async () => {
    const mod = await loadRunsTab();
    const before = Date.now();
    const html = mod.__test.renderGhostRowHtml({});
    const after = Date.now();
    // Extract the ISO string from the title attribute of the first cell.
    const match = html.match(/title="([^"]+)"/);
    assert.ok(match, "expected a title with the ISO timestamp");
    const ts = Date.parse(match[1]);
    assert.ok(ts >= before - 1000 && ts <= after + 1000);
  });
});

describe("renderRunsTable", () => {
  it("suppresses profile sheet ids in the variation column", async () => {
    const mod = await loadRunsTab();
    const tbody = { innerHTML: "" };
    mod.__test.renderRunsTable(
      tbody,
      [
        {
          runAt: "2026-04-21T15:12:03Z",
          trigger: "cli",
          status: "success",
          durationS: 47,
          companiesSeen: 12,
          leadsWritten: 0,
          leadsUpdated: 0,
          source: "worker@profile",
          variationKey: "sheet-opt-b",
          error: "",
        },
      ],
      { sheetId: "sheet-opt-b" },
    );
    assert.match(tbody.innerHTML, /runs-source-cell/);
    assert.match(tbody.innerHTML, /worker@profile/);
    assert.match(tbody.innerHTML, /runs-variation-cell/);
    assert.match(tbody.innerHTML, /runs-dash/);
    assert.doesNotMatch(tbody.innerHTML, /sheet-opt-b/);
  });
});

describe("live job-discovery run row", () => {
  it("normalizes active job discovery tracker state and rejects terminal state", async () => {
    const mod = await loadRunsTab();
    const active = mod.__test.normalizeJobDiscoveryRunState({
      status: "running",
      runId: "run_123",
      initiatedAt: "2026-04-21T20:00:00Z",
      variationKey: "var-1",
    });
    assert.equal(active.runId, "run_123");
    assert.equal(active.status, "running");
    assert.equal(active.variationKey, "var-1");

    const terminal = mod.__test.normalizeJobDiscoveryRunState({
      status: "completed",
      runId: "run_123",
    });
    assert.equal(terminal, null);
  });

  it("renders an active job-discovery run from localStorage when the modal opens", async () => {
    const { dom } = await bootInitRunsTab({
      storedJobRunState: {
        status: "running",
        runId: "run_live_1",
        initiatedAt: "2026-04-21T20:00:00Z",
        trigger: "manual",
        variationKey: "var-live",
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });

    assert.match(dom.tbody.innerHTML, /data-runs-live="job-discovery"/);
    assert.match(dom.tbody.innerHTML, /Job discovery/);
    assert.match(dom.tbody.innerHTML, /var-live/);
  });

  it("updates the live job row from tracker events and refreshes after terminal events", async () => {
    let fetchCalls = 0;
    const { dom } = await bootInitRunsTab({
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const initialFetchCount = fetchCalls;

    dom.document.dispatchDoc("jobbored:job-discovery-run-updated", {
      detail: {
        state: {
          status: "running",
          runId: "run_event_1",
          initiatedAt: "2026-04-21T20:00:00Z",
          variationKey: "var-event",
        },
      },
    });
    assert.match(dom.tbody.innerHTML, /data-runs-live="job-discovery"/);
    assert.match(dom.tbody.innerHTML, /var-event/);

    dom.document.dispatchDoc("jobbored:job-discovery-run-updated", {
      detail: {
        state: {
          status: "completed",
          runId: "run_event_1",
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(
      /data-runs-live="job-discovery"/.test(dom.tbody.innerHTML),
      false,
    );
    assert.ok(
      fetchCalls > initialFetchCount,
      "terminal job-run event should refresh the sheet-backed run log",
    );
  });

  it("suppresses stale live rows when the sheet already has a matching terminal run", async () => {
    const { dom } = await bootInitRunsTab({
      storedJobRunState: {
        status: "running",
        runId: "run_stale_1",
        initiatedAt: "2026-04-22T11:04:20.000Z",
        trigger: "manual",
        variationKey: "83c18c8789eb1b30",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            values: [
              [
                "2026-04-22T11:08:47.000Z",
                "manual",
                "partial",
                267,
                25,
                0,
                "worker",
                "83c18c8789eb1b30",
                "",
              ],
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    });

    assert.equal(
      /data-runs-live="job-discovery"/.test(dom.tbody.innerHTML),
      false,
    );
    assert.match(dom.tbody.innerHTML, /runs-row--partial/);
  });
});

describe("renderSkeletonRows", () => {
  it("writes N loading rows with runs-row--skeleton markers", async () => {
    const mod = await loadRunsTab();
    const tbody = { innerHTML: "" };
    mod.__test.renderSkeletonRows(tbody, 4);
    const matches = tbody.innerHTML.match(/runs-row--skeleton/g);
    assert.ok(matches, "skeleton rows should be present");
    assert.equal(matches.length, 4);
    // Each row has 10 skeleton bars (one per column).
    const bars = tbody.innerHTML.match(/runs-skeleton-bar/g);
    assert.ok(bars && bars.length === 4 * 10);
  });
});

describe("discovery-run events (ghost row lifecycle)", () => {
  it("renders the ghost row in the tbody when jobbored:discovery-run-started fires while the modal is open", async () => {
    const { dom } = await bootInitRunsTab({
      fetchImpl: async () =>
        new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    // Empty state should be visible first — no ghost row yet.
    assert.equal(
      /data-runs-ghost="1"/.test(dom.tbody.innerHTML),
      false,
      "no ghost row before the event fires",
    );

    dom.document.dispatchDoc("jobbored:discovery-run-started", {
      detail: { trigger: "manual" },
    });

    assert.match(dom.tbody.innerHTML, /data-runs-ghost="1"/);
    assert.match(dom.tbody.innerHTML, /runs-status-badge--in_progress/);
  });

  it("removes the ghost row and triggers a fresh fetchDiscoveryRuns on jobbored:discovery-run-finished", async () => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      // First call (initial load): empty sheet.
      // After the finished event: one completed row.
      if (fetchCalls === 1) {
        return new Response(JSON.stringify({ values: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          values: [
            [
              "2026-04-21T20:05:00Z",
              "manual",
              "success",
              42,
              7,
              3,
              "worker",
              "var-k",
              "",
            ],
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const { dom } = await bootInitRunsTab({ fetchImpl });
    const initialFetchCount = fetchCalls;

    dom.document.dispatchDoc("jobbored:discovery-run-started", {
      detail: { trigger: "manual" },
    });
    assert.match(dom.tbody.innerHTML, /data-runs-ghost="1"/);

    dom.document.dispatchDoc("jobbored:discovery-run-finished", {
      detail: { trigger: "manual", ok: true },
    });
    // loadRuns() is async — flush pending microtasks so the fetch resolves
    // and the rerender paints the real row.
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(
      fetchCalls > initialFetchCount,
      "finished event should trigger an immediate fetchDiscoveryRuns",
    );
    assert.equal(
      /data-runs-ghost="1"/.test(dom.tbody.innerHTML),
      false,
      "ghost row should be gone after finished event + refetch",
    );
    assert.match(dom.tbody.innerHTML, /runs-status-badge--success/);
  });

  it("ignores discovery-run events when the modal is closed (no render, no fetch)", async () => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ values: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const { dom } = await bootInitRunsTab({ fetchImpl });
    // Close the modal — simulates the "modal closed when user clicks Run" path.
    dom.modal._listeners.get("click") || [];
    // Easiest: directly call the close handler wired to closeBtn.
    const closeBtn = dom.document.getElementById("runsModalClose");
    closeBtn.dispatch("click", {});
    const fetchesBefore = fetchCalls;

    dom.document.dispatchDoc("jobbored:discovery-run-started", { detail: {} });
    assert.equal(
      /data-runs-ghost="1"/.test(dom.tbody.innerHTML),
      false,
      "no ghost row should render while the modal is closed",
    );

    dom.document.dispatchDoc("jobbored:discovery-run-finished", { detail: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      fetchCalls,
      fetchesBefore,
      "no extra fetch should fire while the modal is closed",
    );
  });
});
