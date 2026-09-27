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
  extraWindow = {},
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
    ...extraWindow,
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
    { runAt: "t", trigger: "scheduled-browser", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
    { runAt: "t", trigger: "scheduled-local", status: "failure", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "x" },
    { runAt: "t", trigger: "scheduled-github", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
    { runAt: "t", trigger: "scheduled-cloudflare", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
    { runAt: "t", trigger: "cli", status: "partial", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
  ];

  it("all/all returns every row", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "all", status: "all" });
    assert.equal(result.length, 6);
  });

  it("trigger='scheduled' matches scheduled origins", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "scheduled", status: "all" });
    const triggers = result.map((r) => r.trigger).sort();
    assert.deepEqual(triggers, [
      "scheduled-browser",
      "scheduled-cloudflare",
      "scheduled-github",
      "scheduled-local",
    ]);
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
    assert.equal(result.length, 4);
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

  it("sends Bearer token and hits the DiscoveryRuns!A1:K range (header + Run ID) with UNFORMATTED_VALUE", async () => {
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
    // "DiscoveryRuns!A1%3AK" (colon is percent-encoded, bang is not). RUNHIST
    // reads from the header row so the appended Run ID column maps by name.
    assert.match(seen.url, /DiscoveryRuns!A1%3AK/);
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

describe("live job-discovery run row", () => {
  it("normalizes active and terminal job discovery tracker state", async () => {
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
      completedAt: "2026-04-21T20:05:00Z",
      leadsWritten: 4,
    });
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.leadsWritten, 4);
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

    assert.match(
      dom.tbody.innerHTML,
      /data-runs-live="job-discovery"/,
      "terminal local run should stay visible while DiscoveryRuns is still empty",
    );
    assert.ok(
      fetchCalls > initialFetchCount,
      "terminal job-run event should refresh the sheet-backed run log",
    );
  });

  it("shows terminal local run state when DiscoveryRuns cannot be read", async () => {
    const { dom } = await bootInitRunsTab({
      storedJobRunState: {
        status: "completed",
        runId: "run_local_done",
        initiatedAt: "2026-04-21T20:00:00Z",
        completedAt: "2026-04-21T20:05:00Z",
        trigger: "manual",
        variationKey: "var-local",
        leadsWritten: 6,
      },
      fetchImpl: async () =>
        new Response("permission denied", {
          status: 403,
          headers: { "content-type": "text/plain" },
        }),
    });

    assert.match(dom.tbody.innerHTML, /data-runs-live="job-discovery"/);
    assert.match(dom.tbody.innerHTML, /Completed/);
    assert.match(dom.tbody.innerHTML, /var-local/);
    assert.match(dom.statusEl.textContent, /showing the local run state/i);
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

// DISCAT D9: one factual line under a finished run when a single exclude
// keyword removed at least a quarter of the listings the run saw.
describe("filter hint under a finished run", () => {
  const BIG = {
    listingsSeen: 1994,
    listingsRejected: 1665,
    byReason: { excluded_keyword: 1181, headline_mismatch: 484 },
    byExcludeKeyword: [
      { keyword: "sales engineer", count: 612 },
      { keyword: "php", count: 40 },
    ],
  };
  const SMALL = {
    listingsSeen: 1994,
    listingsRejected: 600,
    byReason: { excluded_keyword: 498 },
    byExcludeKeyword: [{ keyword: "sales engineer", count: 498 }],
  };
  const EXPECTED =
    'Your exclude keyword "sales engineer" filtered out 612 of 1,994 listings (31%).';

  it("states the keyword, the count and the share at or above 25%", async () => {
    const mod = await loadRunsTab();
    assert.equal(mod.__test.filterHintText(BIG), EXPECTED);
    assert.equal(
      mod.__test.filterHintText({
        listingsSeen: 4,
        byExcludeKeyword: [{ keyword: "php", count: 1 }],
      }),
      'Your exclude keyword "php" filtered out 1 of 4 listings (25%).',
    );
  });

  it("stays silent below 25% and when the stats are absent or malformed", async () => {
    const mod = await loadRunsTab();
    assert.equal(mod.__test.filterHintText(SMALL), "");
    assert.equal(mod.__test.filterHintText(undefined), "");
    assert.equal(mod.__test.filterHintText(null), "");
    assert.equal(mod.__test.filterHintText({ listingsSeen: 0, byExcludeKeyword: [] }), "");
    assert.equal(mod.__test.filterHintText({ byExcludeKeyword: "nope" }), "");
  });

  it("renders the hint row under a finished live run and not under a running one", async () => {
    const mod = await loadRunsTab();
    const done = mod.__test.normalizeJobDiscoveryRunState({
      status: "completed",
      runId: "run_hint",
      initiatedAt: "2026-09-27T10:00:00Z",
      filterStats: BIG,
    });
    const html = mod.__test.renderLiveJobRunRowHtml(done);
    assert.match(html, /class="runs-filter-hint-row"/);
    assert.ok(html.includes("Your exclude keyword &quot;sales engineer&quot; filtered out 612 of 1,994 listings (31%)."), html);

    const running = mod.__test.normalizeJobDiscoveryRunState({
      status: "running",
      runId: "run_hint",
      initiatedAt: "2026-09-27T10:00:00Z",
      filterStats: BIG,
    });
    assert.doesNotMatch(mod.__test.renderLiveJobRunRowHtml(running), /runs-filter-hint/);

    const small = mod.__test.normalizeJobDiscoveryRunState({
      status: "completed",
      runId: "run_small",
      initiatedAt: "2026-09-27T10:00:00Z",
      filterStats: SMALL,
    });
    assert.doesNotMatch(mod.__test.renderLiveJobRunRowHtml(small), /runs-filter-hint/);

    const legacy = mod.__test.normalizeJobDiscoveryRunState({
      status: "completed",
      runId: "run_old",
      initiatedAt: "2026-09-27T10:00:00Z",
    });
    assert.doesNotMatch(mod.__test.renderLiveJobRunRowHtml(legacy), /runs-filter-hint/);
  });

  it("keeps the hint under the run's row once DiscoveryRuns logs it, from the worker history", async () => {
    const detailCalls = [];
    const { dom } = await bootInitRunsTab({
      storedJobRunState: {
        status: "completed",
        runId: "run_logged",
        initiatedAt: "2026-09-27T11:04:20.000Z",
        trigger: "manual",
        variationKey: "var-hint",
        filterStats: BIG,
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            values: [
              RUNS_HEADER,
              ["2026-09-27T11:20:00.000Z", "manual", "success", 30, 2, 0, 0, "worker", "var-other", "", "run_other"],
              ["2026-09-27T11:08:47.000Z", "manual", "success", 30, 4, 0, 0, "worker", "var-hint", "", "run_logged"],
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      extraWindow: {
        JobBoredDiscovery: {
          status: historyStatusStub(
            [
              workerSummary("run_other", "2026-09-27T11:20:00.000Z"),
              workerSummary("run_logged", "2026-09-27T11:08:47.000Z", BIG),
            ],
            detailCalls,
          ),
        },
      },
    });
    const html = dom.tbody.innerHTML;
    assert.equal(/data-runs-live="job-discovery"/.test(html), false);
    assert.equal((html.match(/runs-filter-hint-row/g) || []).length, 1, html);
    assert.equal(detailCalls.length, 0, "the list summary carries filterStats; no per-run fetch");
    // Each run is its summary <tr>, then (for the matched run) the hint, then
    // its detail <tr> carrying the Run ID.
    const hintAt = html.indexOf("runs-filter-hint-row");
    const otherAt = html.indexOf('id="runs-detail-run-run_other"');
    const matchedAt = html.indexOf('id="runs-detail-run-run_logged"');
    assert.ok(otherAt >= 0 && otherAt < hintAt, "hint is not under the newer, unmatched run");
    assert.ok(hintAt < matchedAt, "hint sits inside the matched run's rows");
    assert.doesNotMatch(
      html.slice(hintAt, matchedAt),
      /<tr class="runs-row /,
      "no other run row between the hint and its run",
    );
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
    // Each row has 4 skeleton bars, one per visible column (UX01 FD-17).
    const bars = tbody.innerHTML.match(/runs-skeleton-bar/g);
    assert.ok(bars && bars.length === 4 * 4);
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

describe("F4C-RUN04-UI: 10-column contract, loading, keyboard sort/filter", () => {
  const CANONICAL_HEADERS = [
    "Run At",
    "Trigger",
    "Status",
    "Duration (s)",
    "Companies Seen",
    "Leads New",
    "Leads Updated",
    "Source",
    "Variation Key",
    "Error",
  ];

  it("keeps canonical 10-col success rows from putting variation/source/status into Error when Sheets omits the trailing empty cell", async () => {
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
      ],
    ];
    const runs = mod.parseDiscoveryRunsValues(rows);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "success");
    assert.equal(runs[0].leadsWritten, 3);
    assert.equal(runs[0].leadsUpdated, 9);
    assert.equal(runs[0].source, "worker@v0.4.1");
    assert.equal(runs[0].variationKey, "gh-1234-abcd");
    assert.equal(runs[0].error, "", "empty Error must stay empty; variation key must not shift into Error");
  });

  it("maps by header names when a header row is supplied (F1-B versioned contract)", async () => {
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
      ],
    ];
    const runs = mod.parseDiscoveryRunsValues(rows, { headers: CANONICAL_HEADERS });
    assert.equal(runs[0].leadsUpdated, 9);
    assert.equal(runs[0].error, "");
    assert.equal(runs[0].source, "worker@v0.4.1");
  });

  it("thead and summary rows agree on the 4 visible columns; the rest sit in the detail row", async () => {
    // UX01 FD-17: the Sheet keeps its 10 columns (parse tests above); the
    // table shows Run at, Status, New roles, Why and discloses the rest.
    const html = await readFile(join(repoRoot, "partials/discovery-runs-modal.html"), "utf8");
    const headerTags = html.match(/<th\b[^>]*>/g) || [];
    assert.equal(headerTags.length, 4, "headers and summary cells must agree (RUN-04)");
    assert.match(html, /data-runs-sort="leadsWritten"/);

    const mod = await loadRunsTab();
    const tbody = { innerHTML: "" };
    mod.__test.renderRunsTable(tbody, [
      {
        runAt: "2026-04-21T15:12:03Z",
        trigger: "manual",
        status: "success",
        durationS: 47,
        companiesSeen: 12,
        leadsWritten: 3,
        leadsUpdated: 9,
        source: "worker@v0.4.1",
        variationKey: "gh-1234-abcd",
        error: "",
      },
    ]);
    const summaryRow = tbody.innerHTML.split("</tr>")[0];
    const cells = summaryRow.match(/<td\b/g) || [];
    assert.equal(cells.length, 4);
    assert.doesNotMatch(
      tbody.innerHTML,
      /runs-why-cell[^>]*>gh-1234-abcd/,
      "success text / variation key must not land in the Why cell",
    );
    assert.match(tbody.innerHTML, /<dt>Updated<\/dt><dd>9<\/dd>/);
  });

  it("sortable headers are keyboard-activatable with Enter/Space", async () => {
    const html = await readFile(join(repoRoot, "partials/discovery-runs-modal.html"), "utf8");
    assert.match(
      html,
      /data-runs-sort="runAt"[^>]*tabindex="0"/,
      "sortable headers must be in the tab order",
    );
    const src = await readFile(join(repoRoot, "runs-tab.js"), "utf8");
    assert.match(
      src,
      /th\[data-runs-sort\][\s\S]{0,400}Enter/,
      "sort headers must activate from the keyboard, not click-only",
    );
    assert.match(src, /event\.key === ["'] ["']/);
  });

  it("status=partial filter keeps only partial rows and the modal exposes a Partial chip", async () => {
    const html = await readFile(join(repoRoot, "partials/discovery-runs-modal.html"), "utf8");
    assert.match(html, /data-runs-filter-status="partial"/);

    const mod = await loadRunsTab();
    const sample = [
      { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "" },
      { runAt: "t", trigger: "cli", status: "partial", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "one board failed" },
      { runAt: "t", trigger: "scheduled-local", status: "failure", durationS: 1, companiesSeen: 0, leadsWritten: 0, leadsUpdated: 0, source: "", variationKey: "", error: "x" },
    ];
    const result = mod.filterRuns(sample, { trigger: "all", status: "partial" });
    assert.equal(result.length, 1);
    assert.equal(result[0].status, "partial");
  });

  it("local terminal outcome is visible instead of a Loading skeleton while DiscoveryRuns fetch is in flight", async () => {
    const { dom } = await bootInitRunsTab({
      storedJobRunState: {
        status: "completed",
        runId: "run_local_done",
        initiatedAt: "2026-04-21T20:00:00Z",
        completedAt: "2026-04-21T20:05:00Z",
        trigger: "manual",
        variationKey: "var-local",
        leadsWritten: 6,
      },
      fetchImpl: () => new Promise(() => {}),
    });

    assert.equal(
      /runs-row--skeleton/.test(dom.tbody.innerHTML),
      false,
      "must not stay on Loading skeleton when a local terminal run exists",
    );
    assert.match(dom.tbody.innerHTML, /data-runs-live="job-discovery"/);
    assert.match(dom.tbody.innerHTML, /Completed/);
    assert.doesNotMatch(dom.statusEl.textContent, /Loading runs/i);
  });

  it("unmatched local terminal run remains visible when the sheet already has other rows", async () => {
    const { dom } = await bootInitRunsTab({
      storedJobRunState: {
        status: "completed",
        runId: "run_local_done",
        initiatedAt: "2026-04-21T20:00:00Z",
        trigger: "manual",
        variationKey: "var-unmatched",
        leadsWritten: 6,
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            values: [
              [
                "2026-04-20T10:00:00Z",
                "scheduled-github",
                "success",
                30,
                5,
                1,
                0,
                "worker",
                "other-var",
                "",
              ],
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    assert.match(
      dom.tbody.innerHTML,
      /data-runs-live="job-discovery"/,
      "local terminal outcomes must not drop just because unrelated sheet rows exist",
    );
    assert.match(dom.tbody.innerHTML, /var-unmatched/);
  });
});

describe("F4C-P2-ZERO: terminal zero ≠ unavailable ≠ partial", () => {
  it("missing numeric cells are unavailable, measured zero stays 0, partial stays partial", async () => {
    const mod = await loadRunsTab();
    const runs = mod.parseDiscoveryRunsValues([
      [
        "2026-04-21T15:12:03Z",
        "cli",
        "partial",
        "",
        "",
        "",
        0,
        "worker@v0.4.1",
        "vk-partial",
        "one board failed",
      ],
    ]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, "partial");
    assert.equal(runs[0].companiesSeenAvailability, "unavailable");
    assert.equal(runs[0].leadsWrittenAvailability, "unavailable");
    assert.equal(runs[0].leadsUpdatedAvailability, "zero");
    assert.equal(runs[0].leadsUpdated, 0);

    const tbody = { innerHTML: "" };
    mod.__test.renderRunsTable(tbody, runs);
    assert.match(tbody.innerHTML, /runs-status-badge--partial/);
    assert.match(
      tbody.innerHTML,
      /data-availability="unavailable"/,
      "unavailable metrics must not collapse into a bare 0",
    );
    assert.match(tbody.innerHTML, /data-availability="zero"/);
    assert.doesNotMatch(
      tbody.innerHTML,
      /data-availability="unavailable"[^>]*>0</,
      "unavailable must render an em-dash, not a measured zero",
    );
  });
});

describe("lane D · runs failure copy speaks user words (spec §8.4)", () => {
  it("translates machine reasons into errors that name the next action", async () => {
    const mod = await loadRunsTab();
    const tell = mod.__test.describeRunsFailure;
    assert.equal(
      tell("unauthorized"),
      "Your Google session ended — sign in again.",
    );
    assert.equal(
      tell("signed_out"),
      "Your Google session ended — sign in again.",
    );
    assert.match(tell("sheetId is required"), /connect one in Settings/);
    assert.match(
      tell("network error: Failed to fetch"),
      /Check your connection and try Reload/,
    );
    assert.match(tell("HTTP 400 - nope"), /Google Sheets rejected/);
    assert.match(
      tell("invalid JSON from Sheets API"),
      /couldn't read — try Reload/,
    );
  });

  it("leaves unknown reasons untouched (full detail survives)", async () => {
    const mod = await loadRunsTab();
    assert.equal(
      mod.__test.describeRunsFailure("something exotic"),
      "something exotic",
    );
  });
});

// DISCAT Fix-B: the hint names the single largest cause (a precise reason or
// an exclude keyword) and reaches sheet rows through the Run ID column.
describe("honest filter hint", () => {
  it("names a precise reason when it is the largest cause", async () => {
    const mod = await loadRunsTab();
    assert.equal(
      mod.__test.filterHintText({
        listingsSeen: 1994,
        listingsRejected: 1500,
        byReason: { remote_unknown: 1181, excluded_keyword: 40, headline_mismatch: 279 },
        byExcludeKeyword: [{ keyword: "php", count: 40 }],
      }),
      "1,181 of 1,994 listings (59%) were dropped because their remote status was unknown.",
    );
    assert.equal(
      mod.__test.filterHintText({
        listingsSeen: 100,
        byReason: { salary_below_floor: 30 },
        byExcludeKeyword: [],
      }),
      "30 of 100 listings (30%) were dropped because their published salary was below your floor.",
    );
  });

  it("never claims a keyword for an unattributed excluded_keyword count", async () => {
    const mod = await loadRunsTab();
    assert.equal(
      mod.__test.filterHintText({
        listingsSeen: 1994,
        byReason: { excluded_keyword: 1181 },
        byExcludeKeyword: [],
      }),
      "",
    );
  });

  it("ignores unknown reason codes and causes under 25%", async () => {
    const mod = await loadRunsTab();
    assert.equal(
      mod.__test.filterHintText({ listingsSeen: 100, byReason: { brand_new_code: 90 }, byExcludeKeyword: [] }),
      "",
    );
    assert.equal(
      mod.__test.filterHintText({ listingsSeen: 100, byReason: { remote_unknown: 24 }, byExcludeKeyword: [] }),
      "",
    );
  });

  it("has a plain-language label for every backend reason code", async () => {
    const mod = await loadRunsTab();
    for (const code of [
      "remote_unknown",
      "remote_policy_mismatch",
      "location_mismatch",
      "skip_title",
      "work_auth_mismatch",
      "salary_below_floor",
      "salary_missing",
      "headline_mismatch",
      "missing_required_fields",
      "matcher_rejected",
    ]) {
      const text = mod.__test.filterHintText({ listingsSeen: 4, byReason: { [code]: 2 }, byExcludeKeyword: [] });
      assert.match(text, /^2 of 4 listings \(50%\) were dropped because .+\.$/, code);
    }
  });
});

// DISCAT round 3 (D9): a keyword at or above 25% is never hidden behind a
// larger reason; the hint shows up to two lines.
describe("two-line filter hint", () => {
  const BOTH = {
    listingsSeen: 100,
    listingsRejected: 75,
    byReason: { remote_unknown: 40, excluded_keyword: 30, headline_mismatch: 5 },
    byExcludeKeyword: [
      { keyword: "sales engineer", count: 30 },
      { keyword: "php", count: 2 },
    ],
  };

  it("names both the largest reason and the largest keyword when each reaches 25%", async () => {
    const mod = await loadRunsTab();
    assert.equal(
      mod.__test.filterHintText(BOTH),
      "40 of 100 listings (40%) were dropped because their remote status was unknown.\n" +
        'Your exclude keyword "sales engineer" filtered out 30 of 100 listings (30%).',
    );
  });

  it("puts the larger cause first", async () => {
    const mod = await loadRunsTab();
    assert.equal(
      mod.__test.filterHintText({
        listingsSeen: 100,
        byReason: { location_mismatch: 26 },
        byExcludeKeyword: [{ keyword: "php", count: 50 }],
      }),
      'Your exclude keyword "php" filtered out 50 of 100 listings (50%).\n' +
        "26 of 100 listings (26%) were dropped because their location was outside the places you listed.",
    );
  });

  it("renders each hint line as its own paragraph", async () => {
    const mod = await loadRunsTab();
    const html = mod.__test.renderLiveJobRunRowHtml(
      mod.__test.normalizeJobDiscoveryRunState({
        status: "completed",
        runId: "run_two",
        initiatedAt: "2026-09-27T10:00:00Z",
        filterStats: BOTH,
      }),
    );
    assert.equal((html.match(/class="runs-filter-hint"/g) || []).length, 2, html);
    assert.equal((html.match(/runs-filter-hint-row/g) || []).length, 1, html);
  });
});

const RUNS_HEADER = ["Run At", "Trigger", "Status", "Duration (s)", "Companies Seen", "Leads New", "Leads Updated", "Source", "Variation Key", "Error", "Run ID"];

function workerSummary(runId, completedAt, filterStats) {
  return {
    runId,
    status: "partial",
    sheetStatus: "partial",
    trigger: "scheduled",
    startedAt: completedAt,
    completedAt,
    statusPath: `/runs/${runId}`,
    headline: { written: 0 },
    ...(filterStats ? { filterStats } : {}),
  };
}

// RUNHIST's worker history API surface (discovery-status-handoff.js).
function historyStatusStub(runs, detailCalls = []) {
  return {
    fetchRunHistoryPage: async () => ({ ok: true, runs, nextBefore: null }),
    fetchRunDetail: async (statusPath) => {
      detailCalls.push(statusPath);
      return { ok: false, reason: "unavailable" };
    },
  };
}

const REMOTE_STATS = {
  listingsSeen: 1994,
  listingsRejected: 1400,
  byReason: { remote_unknown: 1181 },
  byExcludeKeyword: [],
};

// DISCAT D9 on RUNHIST: GET /runs summaries carry filterStats, so the hint
// needs no fetch of its own.
describe("hint from the worker run history", () => {
  it("carries filterStats from a GET /runs summary onto the Run ID-joined row", async () => {
    const mod = await loadRunsTab();
    const sheet = mod.parseDiscoveryRunsValues(
      [["2026-09-27T10:00:00Z", "scheduled-local", "partial", 30, 4, 0, 0, "worker", "v1", "warn", "run_abc"]],
      { headers: RUNS_HEADER },
    );
    const merged = mod.mergeRunHistory(sheet, [
      workerSummary("run_abc", "2026-09-27T10:00:00Z", REMOTE_STATS),
      workerSummary("run_worker_only", "2026-09-26T10:00:00Z", REMOTE_STATS),
      workerSummary("run_pre_discat", "2026-09-25T10:00:00Z"),
    ]);
    assert.deepEqual(Array.from(merged, (r) => r.origin), ["both", "worker", "worker"]);
    assert.deepEqual(asPlain(merged[0].filterStats), REMOTE_STATS);
    assert.deepEqual(asPlain(merged[1].filterStats), REMOTE_STATS);
    assert.equal(merged[2].filterStats, null, "runs from before DISCAT carry nothing");
  });

  it("renders the hint under a scheduled run from the history, with no per-run fetch", async () => {
    const detailCalls = [];
    const summaries = [];
    for (let i = 0; i < 7; i += 1) {
      summaries.push(workerSummary(`run_${i}`, `2026-09-2${i}T10:00:00.000Z`, i === 6 ? REMOTE_STATS : undefined));
    }
    const { dom } = await bootInitRunsTab({
      fetchImpl: async (url) => {
        if (String(url).startsWith("https://sheets.googleapis.com/")) {
          return new Response(JSON.stringify({ values: [RUNS_HEADER] }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      extraWindow: { JobBoredDiscovery: { status: historyStatusStub(summaries, detailCalls) } },
    });
    const html = dom.tbody.innerHTML;
    assert.equal(detailCalls.length, 0, detailCalls.join("\n"));
    assert.equal((html.match(/runs-filter-hint-row/g) || []).length, 1, html);
    assert.ok(
      html.includes("1,181 of 1,994 listings (59%) were dropped because their remote status was unknown."),
      html,
    );
    const hintAt = html.indexOf("runs-filter-hint-row");
    assert.ok(hintAt < html.indexOf('id="runs-detail-run-run_6"'), "hint sits with the newest run's rows");
    assert.ok(html.indexOf('id="runs-detail-run-run_5"') > hintAt, "no hint under runs without filterStats");
  });
});
