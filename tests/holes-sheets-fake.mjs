/**
 * HOLES lane SHEETS — an in-memory Google Sheets v4 backend plus a vm loader
 * for sheets-writeback.js / sheets-read-load.js. Not a test file (no
 * `.test.` in the name); the holes-sheets-*.test.mjs files import it.
 *
 * The fake answers the handful of endpoints the browser modules call:
 *   GET  values/{range}            GET  values:batchGet?ranges=…
 *   PUT  values/{range}            POST values:batchUpdate
 *   POST values/{range}:append     POST {id}:batchUpdate (addSheet,
 *   GET  {id}?fields=…                  deleteDimension, updateSpreadsheetProperties)
 * with Google's shapes: trailing empty cells and rows are dropped from
 * reads, and a range on a missing tab is HTTP 400 "Unable to parse range".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const HEADERS = [
  "Date Found", "Title", "Company", "Location", "Link", "Source", "Salary",
  "Fit Score", "Priority", "Tags", "Fit Assessment", "Contact", "Status",
  "Applied Date", "Notes", "Follow-up Date", "Talking Points", "Last contact",
  "Did they reply?", "Logo URL", "Search Match", "Favorite", "Dismissed At",
  "Approval Status", "Edit Lock", "Work Mode",
];

export const COL = Object.freeze({
  title: 1, company: 2, location: 3, link: 4, salary: 6, status: 12,
  appliedDate: 13, notes: 14, followUpDate: 15, lastHeardFrom: 17,
  responseFlag: 18, favorite: 21, dismissedAt: 22, editLock: 24,
});

/** One Pipeline row with the given fields at their schema positions. */
export function pipelineRow(fields) {
  const row = new Array(HEADERS.length).fill("");
  row[0] = fields.dateFound || "2026-09-01";
  for (const [key, index] of Object.entries(COL)) {
    if (fields[key] != null) row[index] = String(fields[key]);
  }
  return row;
}

function letterToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "Pipeline!B2:E" → { sheet, c0, r0, c1, r1 } (0-based, r1/c1 null = open). */
export function parseA1(range) {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!([A-Z]+)?(\d+)?(?::([A-Z]+)?(\d+)?)?$/i.exec(
    String(range),
  );
  if (!m) throw new Error(`fake: unparseable range ${range}`);
  const sheet = (m[1] != null ? m[1].replace(/''/g, "'") : m[2]).trim();
  const c0 = m[3] ? letterToIndex(m[3]) : 0;
  const r0 = m[4] ? Number(m[4]) - 1 : 0;
  const hasEnd = m[5] != null || m[6] != null;
  const c1 = hasEnd ? (m[5] ? letterToIndex(m[5]) : null) : m[3] ? c0 : null;
  const r1 = hasEnd ? (m[6] ? Number(m[6]) - 1 : null) : m[4] ? r0 : null;
  return { sheet, c0, r0, c1, r1 };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errorResponse(status, message) {
  return jsonResponse(status, { error: { code: status, message } });
}

/**
 * createFakeSheets({ Pipeline: [[...header], [...row], …], Blacklist: [...] })
 */
export function createFakeSheets(initialTabs = {}, opts = {}) {
  const tabs = new Map();
  let nextSheetId = 100;
  for (const [title, rows] of Object.entries(initialTabs)) {
    tabs.set(title, { sheetId: nextSheetId++, rows: rows.map((r) => r.slice()) });
  }
  const requests = [];
  const interceptors = [];
  const spreadsheetTitle = opts.title || "JobBored Pipeline";
  let readOnly = !!opts.readOnly;

  function tab(name) {
    const t = tabs.get(name);
    if (!t) {
      const err = new Error(`Unable to parse range: ${name}`);
      err.status = 400;
      throw err;
    }
    return t;
  }

  function readRange(range) {
    const a = parseA1(range);
    const t = tab(a.sheet);
    const lastRow = t.rows.length - 1;
    const r1 = a.r1 == null ? lastRow : Math.min(a.r1, lastRow);
    const out = [];
    for (let r = a.r0; r <= r1; r++) {
      const row = t.rows[r] || [];
      const end = a.c1 == null ? row.length - 1 : a.c1;
      const cells = [];
      for (let c = a.c0; c <= end; c++) cells.push(row[c] == null ? "" : String(row[c]));
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      out.push(cells);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  function writeRange(range, values) {
    const a = parseA1(range);
    const t = tab(a.sheet);
    values.forEach((rowValues, i) => {
      const r = a.r0 + i;
      while (t.rows.length <= r) t.rows.push([]);
      const row = t.rows[r];
      rowValues.forEach((value, j) => {
        const c = a.c0 + j;
        while (row.length <= c) row.push("");
        row[c] = value == null ? "" : String(value);
      });
    });
  }

  function appendRows(range, values) {
    const a = parseA1(range);
    const t = tab(a.sheet);
    let last = t.rows.length - 1;
    while (last >= 0 && !(t.rows[last] || []).some((c) => String(c || "") !== "")) last--;
    const start = last + 1;
    values.forEach((rowValues, i) => {
      const row = new Array(a.c0).fill("").concat(rowValues.map((v) => (v == null ? "" : String(v))));
      t.rows[start + i] = row;
    });
  }

  function valuesResponse(range) {
    const values = readRange(range);
    return values.length ? { range, values } : { range };
  }

  async function handle(url, init) {
    const u = new URL(url);
    const method = String((init && init.method) || "GET").toUpperCase();
    const body = init && init.body ? JSON.parse(init.body) : null;
    const path = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ""));
    const writes = method !== "GET";
    try {
      if (method === "GET" && path === "/values:batchGet") {
        const ranges = u.searchParams.getAll("ranges");
        return jsonResponse(200, { valueRanges: ranges.map(valuesResponse) });
      }
      if (method === "GET" && path.startsWith("/values/")) {
        return jsonResponse(200, valuesResponse(path.slice("/values/".length)));
      }
      if (method === "GET" && (path === "" || path === "/")) {
        return jsonResponse(200, {
          spreadsheetId: "sheet-123",
          properties: { title: spreadsheetTitle },
          sheets: [...tabs.entries()].map(([title, t]) => ({
            properties: { sheetId: t.sheetId, title },
          })),
        });
      }
      if (writes && readOnly) {
        return errorResponse(403, "The caller does not have permission");
      }
      if (method === "POST" && path === "/values:batchUpdate") {
        for (const d of body.data || []) writeRange(d.range, d.values);
        return jsonResponse(200, { totalUpdatedCells: (body.data || []).length });
      }
      if (method === "PUT" && path.startsWith("/values/")) {
        writeRange(path.slice("/values/".length), body.values);
        return jsonResponse(200, { updatedCells: 1 });
      }
      if (method === "POST" && path.startsWith("/values/") && path.endsWith(":append")) {
        appendRows(path.slice("/values/".length, -":append".length), body.values);
        return jsonResponse(200, { updates: { updatedRows: body.values.length } });
      }
      if (method === "POST" && path === ":batchUpdate") {
        for (const req of body.requests || []) {
          if (req.addSheet) {
            tabs.set(req.addSheet.properties.title, { sheetId: nextSheetId++, rows: [] });
          } else if (req.deleteDimension) {
            const r = req.deleteDimension.range;
            const entry = [...tabs.values()].find((t) => t.sheetId === r.sheetId);
            if (!entry) return errorResponse(400, "No grid with id");
            entry.rows.splice(r.startIndex, r.endIndex - r.startIndex);
          } else if (req.updateSpreadsheetProperties) {
            // A no-op the account needs edit rights for.
          }
        }
        return jsonResponse(200, { replies: [] });
      }
      return errorResponse(404, `fake: no route for ${method} ${path}`);
    } catch (err) {
      return errorResponse(err.status || 500, err.message);
    }
  }

  async function fetchImpl(url, init) {
    const entry = {
      url: String(url),
      method: String((init && init.method) || "GET").toUpperCase(),
      body: init && init.body ? JSON.parse(init.body) : null,
    };
    requests.push(entry);
    for (const intercept of interceptors) {
      const res = await intercept(entry);
      if (res) return res;
    }
    return handle(String(url), init);
  }

  return {
    fetch: fetchImpl,
    requests,
    /** Next request matching `pred` gets `status` (once, unless `times`). */
    failWhen(pred, status = 500, message = "Backend error", times = 1) {
      let left = times;
      interceptors.push(async (entry) => {
        if (left <= 0 || !pred(entry)) return null;
        left -= 1;
        return errorResponse(status, message);
      });
    },
    intercept(fn) {
      interceptors.push(fn);
    },
    rows(name = "Pipeline") {
      return tab(name).rows;
    },
    hasTab(name) {
      return tabs.has(name);
    },
    setReadOnly(value) {
      readOnly = !!value;
    },
    /** Sort the Pipeline data rows (header stays) by a key function. */
    sortPipeline(keyFn) {
      const t = tab("Pipeline");
      const [header, ...data] = t.rows;
      data.sort((a, b) => (keyFn(a) < keyFn(b) ? -1 : keyFn(a) > keyFn(b) ? 1 : 0));
      t.rows = [header, ...data];
    },
    deletePipelineRow(predicate) {
      const t = tab("Pipeline");
      t.rows = t.rows.filter((row, i) => i === 0 || !predicate(row));
    },
    writes() {
      return requests.filter((r) => r.method !== "GET");
    },
  };
}

class TestCustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/**
 * Load sheets-writeback.js (and sheets-read-load.js for its pure helpers)
 * in one vm context, over a host that reads pipelineData from `state`.
 */
export function loadWriteback(fake, options = {}) {
  const toasts = [];
  const events = [];
  const timers = [];
  const state = { data: [], token: "test-token" };
  const host = {
    getActiveSheetId: () => "sheet-123",
    getSheetId: () => "sheet-123",
    getAccessToken: () => state.token,
    refreshAccessTokenSilently: async () => false,
    clearSessionAuthState() {
      state.token = "";
    },
    getPipelineData: () => state.data,
    setPipelineData: (v) => {
      state.data = v;
    },
    renderPipeline() {},
    renderStats() {},
    renderBrief() {},
    renderExpiredReviewButton() {},
    refreshDrawerIfOpen() {},
    showSheetAccessGate() {},
    showToast: (message, type, persistent, action) => {
      const t = { message, type, action, dismissed: false };
      toasts.push(t);
      return () => {
        t.dismissed = true;
      };
    },
    ...(options.host || {}),
  };
  const windowTarget = {
    JobBoredApp: { core: { host } },
    navigator: { onLine: true },
    addEventListener() {},
    dispatchEvent(ev) {
      events.push(ev);
      return true;
    },
  };
  const documentTarget = {
    dispatchEvent(ev) {
      events.push(ev);
      return true;
    },
    getElementById: () => null,
    createElement: () => ({ setAttribute() {}, addEventListener() {}, appendChild() {} }),
    head: { appendChild() {} },
  };
  const context = vm.createContext({
    window: windowTarget,
    document: documentTarget,
    navigator: windowTarget.navigator,
    fetch: (url, init) => fake.fetch(url, init),
    URL,
    URLSearchParams,
    console: { log() {}, info() {}, warn() {}, error() {} },
    CustomEvent: TestCustomEvent,
    localStorage: memoryStorage(),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    Date,
    Promise,
    JSON,
  });
  for (const file of ["sheets-read-load.js", "sheets-writeback.js"]) {
    vm.runInContext(readFileSync(join(repoRoot, file), "utf8"), context, { filename: file });
  }
  const app = windowTarget.JobBoredApp;
  /** Parse the fake's current Pipeline into pipelineData, like a load. */
  function load() {
    state.data = app.sheetsRead.parsePipelineCSV(fake.rows("Pipeline").map((r) => r.slice()));
    return state.data;
  }
  return {
    app,
    sw: app.sheetsWrite,
    sr: app.sheetsRead,
    host,
    state,
    toasts,
    events,
    timers,
    load,
    indexOf(link) {
      return state.data.findIndex((j) => j.link === link);
    },
  };
}

/** The Pipeline row (array) whose Link is `link`, from the fake. */
export function rowByLink(fake, link) {
  return fake.rows("Pipeline").find((row, i) => i > 0 && row[COL.link] === link) || null;
}

function fakeElement(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    dataset: {},
    style: {},
    hidden: false,
    textContent: "",
    listeners: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === "id") doc._ids.set(String(v), this);
    },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); },
    click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
    replaceChildren() { this.children = []; },
    remove() {},
  };
  return el;
}

/**
 * Load sheets-read-load.js with a hand-rolled DOM and a fetch the test
 * controls. `options.fetch(url, init)` answers every request.
 */
export function loadReader(options = {}) {
  const doc = { _ids: new Map() };
  doc.createElement = (tag) => fakeElement(tag, doc);
  doc.body = fakeElement("body", doc);
  doc.head = fakeElement("head", doc);
  doc.head.appendChild = (el) => {
    if (typeof el.onerror === "function") el.onerror(); // JSONP fallback fails fast
    return el;
  };
  doc.documentElement = fakeElement("html", doc);
  for (const id of ["errorState", "errorOpenDirect", "errorViewSheet", "errorStateHint", "jobCards"]) {
    fakeElement("div", doc).setAttribute("id", id);
  }
  doc.getElementById = (id) => doc._ids.get(id) || null;
  doc.querySelector = () => null;
  const events = [];
  doc.dispatchEvent = (ev) => {
    events.push({ target: "document", type: ev.type, detail: ev.detail });
    return true;
  };
  const state = { sheetId: "sheet-123", token: "test-token", data: null, resolved: true };
  const calls = { setPipelineData: [], gates: [] };
  const host = {
    getOAuthClientId: () => "client-id",
    getAccessToken: () => state.token,
    getActiveSheetId: () => state.sheetId,
    getInitialSheetAccessResolved: () => state.resolved,
    setInitialSheetAccessResolved: (v) => { state.resolved = v; },
    setPipelineRawRows() {},
    setPipelineData: (v) => { state.data = v; calls.setPipelineData.push(v); },
    getPipelineData: () => state.data || [],
    setDashboardDataHydrated() {},
    setDataLoadFailed() {},
    showSheetAccessGate: (m) => calls.gates.push(m),
    revealSetupScreenAfterAuth() {},
    revealDashboardShell() {},
    runPostAccessBootstrapOnce() {},
    applyEnrichmentCache() {},
    renderPipeline() {},
    renderBrief() {},
    updateLastRefresh() {},
    maybeAutoOpenExpiredReviewModal() {},
    hasGrantedOauthScope: () => true,
    getGoogleSheetsScope: () => "https://www.googleapis.com/auth/spreadsheets",
    recordSheetAccessError() {},
    refreshAccessTokenSilently: async () => false,
    clearSessionAuthState() { state.token = ""; },
    showToast() {},
    ...(options.host || {}),
  };
  const windowTarget = {
    JobBoredApp: { core: { host }, auth: { getUserEmail: () => "user@example.com" } },
    navigator: { onLine: true },
    addEventListener() {},
    dispatchEvent(ev) {
      events.push({ target: "window", type: ev.type, detail: ev.detail });
      return true;
    },
  };
  const context = vm.createContext({
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: doc,
    window: windowTarget,
    navigator: windowTarget.navigator,
    CustomEvent: TestCustomEvent,
    localStorage: memoryStorage(),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    Date,
    fetch: (url, init) => options.fetch(String(url), init),
  });
  vm.runInContext(readFileSync(join(repoRoot, "sheets-read-load.js"), "utf8"), context, {
    filename: "sheets-read-load.js",
  });
  return { sr: windowTarget.JobBoredApp.sheetsRead, host, state, calls, events, doc, win: windowTarget };
}

/** A promise plus its resolve, for holding a fetch open. */
export function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

/** A Sheets values response with the given rows. */
export function valuesOk(rows) {
  return { ok: true, status: 200, json: async () => ({ values: rows }) };
}
