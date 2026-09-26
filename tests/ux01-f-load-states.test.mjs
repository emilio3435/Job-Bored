/**
 * UX01 lane F · C21 — a failed load never looks empty.
 *
 * Drives sheets-read-load.js in a vm with a hand-rolled DOM (repo
 * convention: no jsdom) and asserts the behaviour a stranger sees:
 *   - the first good load emits jb:data:loaded {rows} on window AND document;
 *   - a later failed refresh keeps the last good rows (the legacy #jobCards
 *     board is not wiped), emits jb:data:load-failed {status, lastSyncedAt},
 *     and shows a Retry banner with plain copy naming the account;
 *   - describeLoadFailure maps 403 / 404 / offline / 401 to plain words.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "sheets-read-load.js"), "utf8");

const HEADERS = ["Date Found", "Title", "Company", "Location", "Link"];
const ROW = ["2026-09-01", "Staff Engineer", "Acme", "Remote", "https://example.com/a"];

function makeEl(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    attributes: {},
    dataset: {},
    style: {},
    hidden: false,
    textContent: "",
    innerHTML: "",
    className: "",
    listeners: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
    },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === "id") { this.id = String(v); doc._ids.set(String(v), this); }
    },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) doc._ids.set(child.id, child);
      return child;
    },
    insertBefore(child, ref) {
      child.parentNode = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(child); else this.children.splice(i, 0, child);
      if (child.id) doc._ids.set(child.id, child);
      return child;
    },
    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    },
    click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {} }); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    replaceChildren() { this.children = []; },
    remove() {},
  };
  return el;
}

function textOf(el) {
  return [el.textContent, ...el.children.map(textOf)].join(" ");
}

function findAll(el, pred, out = []) {
  if (pred(el)) out.push(el);
  for (const c of el.children) findAll(c, pred, out);
  return out;
}

function createHarness() {
  const doc = { _ids: new Map(), listeners: {} };
  doc.createElement = (tag) => makeEl(tag, doc);
  doc.body = makeEl("body", doc);
  doc.head = makeEl("head", doc);
  doc.documentElement = makeEl("html", doc);
  const today = makeEl("section", doc);
  today.setAttribute("data-region", "today");
  doc.body.appendChild(today);
  const jobCards = makeEl("div", doc);
  jobCards.setAttribute("id", "jobCards");
  jobCards.innerHTML = "<article>Staff Engineer</article>";
  doc.body.appendChild(jobCards);
  for (const id of ["errorState", "errorOpenDirect", "errorViewSheet", "errorStateHint"]) {
    const el = makeEl("div", doc);
    el.setAttribute("id", id);
    doc.body.appendChild(el);
  }
  doc.getElementById = (id) => doc._ids.get(id) || null;
  doc.querySelector = (sel) => (sel === '[data-region="today"]' ? today : null);
  doc.addEventListener = (type, fn) => {
    (doc.listeners[type] || (doc.listeners[type] = [])).push(fn);
  };
  const docEvents = [];
  doc.dispatchEvent = (ev) => { docEvents.push(ev); return true; };

  const winEvents = [];
  const winListeners = {};
  let mode = "ok";
  const calls = { setPipelineData: [], gates: [], toasts: [] };
  let initialResolved = false;
  const host = {
    getOAuthClientId: () => "client-id",
    getAccessToken: () => "token",
    getActiveSheetId: () => "sheet-123",
    getInitialSheetAccessResolved: () => initialResolved,
    setInitialSheetAccessResolved: (v) => { initialResolved = v; },
    setPipelineRawRows() {},
    setPipelineData: (v) => calls.setPipelineData.push(v),
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
    getLastSheetAccessError: () => "The caller does not have permission",
    refreshAccessTokenSilently: async () => false,
    clearSessionAuthState() {},
    showToast: (...a) => calls.toasts.push(a),
  };
  class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  }
  const windowEl = {
    JobBoredApp: { core: { host }, auth: { getUserEmail: () => "user@example.com" } },
    location: { href: "http://localhost/" },
    navigator: { onLine: true },
    addEventListener(type, fn) { (winListeners[type] || (winListeners[type] = [])).push(fn); },
    dispatchEvent(ev) { winEvents.push(ev); return true; },
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {}, info() {} },
    document: doc,
    window: windowEl,
    navigator: windowEl.navigator,
    CustomEvent,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    Date,
    fetch: async (url) => {
      if (mode === "ok" && String(url).includes("sheets.googleapis.com")) {
        return { ok: true, status: 200, json: async () => ({ values: [HEADERS, ROW] }) };
      }
      if (mode === "offline") throw new TypeError("Failed to fetch");
      return {
        ok: false,
        status: mode === "404" ? 404 : 403,
        json: async () => ({ error: { message: "The caller does not have permission" } }),
        text: async () => "",
      };
    },
  });
  vm.runInContext(source, context, { filename: "sheets-read-load.js" });
  // JSONP fallback appends a <script>; fail it straight away.
  doc.head.appendChild = (el) => { if (typeof el.onerror === "function") el.onerror(); return el; };
  return {
    doc,
    calls,
    winEvents,
    docEvents,
    winListeners,
    sheetsRead: windowEl.JobBoredApp.sheetsRead,
    setMode(m) { mode = m; },
    jobCards,
  };
}

describe("UX01 C21 — load states", () => {
  it("emits jb:data:loaded {rows} on window and document after the first good load", async () => {
    const hz = createHarness();
    const ok = await hz.sheetsRead.loadAllData();
    assert.equal(ok, true);
    const w = hz.winEvents.find((e) => e.type === "jb:data:loaded");
    const d = hz.docEvents.find((e) => e.type === "jb:data:loaded");
    assert.ok(w, "window got jb:data:loaded");
    assert.ok(d, "document got jb:data:loaded");
    assert.equal(w.detail.rows.length, 1);
    assert.equal(w.detail.first, true);
    assert.equal(typeof w.detail.lastSyncedAt, "number");
    assert.equal(hz.sheetsRead.getLoadState().dataLoaded, true);
  });

  it("keeps the last good rows and shows a Retry banner when a refresh gets 403", async () => {
    const hz = createHarness();
    await hz.sheetsRead.loadAllData();
    const lastGood = hz.calls.setPipelineData.at(-1);
    hz.setMode("403");
    const ok = await hz.sheetsRead.loadAllData();
    assert.equal(ok, false);
    // No empty board: pipeline data was not replaced and #jobCards was not wiped.
    assert.equal(hz.calls.setPipelineData.at(-1), lastGood);
    assert.match(hz.jobCards.innerHTML, /Staff Engineer/);
    const failed = hz.winEvents.find((e) => e.type === "jb:data:load-failed");
    assert.ok(failed, "window got jb:data:load-failed");
    assert.ok(hz.docEvents.find((e) => e.type === "jb:data:load-failed"));
    assert.equal(failed.detail.status, 403);
    assert.equal(typeof failed.detail.lastSyncedAt, "number");
    const banner = hz.doc.getElementById("jbSyncBanner");
    assert.ok(banner, "banner rendered");
    assert.equal(banner.hidden, false);
    const text = textOf(banner);
    assert.match(text, /user@example\.com can.t open this Sheet/);
    const retry = findAll(banner, (el) => el.tagName === "BUTTON" && /Retry/.test(el.textContent));
    assert.equal(retry.length, 1, "one Retry button");
    // Retry re-runs the load; once it succeeds the banner goes away.
    hz.setMode("ok");
    retry[0].click();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(banner.hidden, true);
  });

  it("says you are offline instead of printing a Google error when the network is down", async () => {
    const hz = createHarness();
    await hz.sheetsRead.loadAllData();
    hz.setMode("offline");
    await hz.sheetsRead.loadAllData();
    const failed = hz.winEvents.find((e) => e.type === "jb:data:load-failed");
    assert.equal(failed.detail.status, 0);
    assert.equal(failed.detail.kind, "offline");
    assert.match(textOf(hz.doc.getElementById("jbSyncBanner")), /offline/i);
  });

  it("maps statuses to plain copy", () => {
    const hz = createHarness();
    const d = hz.sheetsRead.describeLoadFailure;
    assert.match(d({ status: 403, email: "a@example.com" }).title, /a@example\.com can.t open this Sheet/);
    assert.match(d({ status: 403 }).title, /This Google account can.t open this Sheet/);
    assert.match(d({ status: 404 }).title, /doesn.t exist/);
    assert.match(d({ status: 0, kind: "offline" }).title, /offline/i);
    assert.match(d({ status: 401 }).title, /session ended/i);
    for (const s of [403, 404, 500, 401]) {
      const c = d({ status: s });
      assert.doesNotMatch(c.title + c.detail, /caller|HTTP|API|status/i);
    }
  });

  it("formats the last-synced label in plain words", () => {
    const hz = createHarness();
    const f = hz.sheetsRead.formatSyncedAgo;
    const now = 1_000_000_000;
    assert.equal(f(now - 5_000, now), "Synced just now");
    assert.equal(f(now - 120_000, now), "Synced 2 min ago");
    assert.equal(f(now - 2 * 3_600_000, now), "Synced 2 h ago");
    assert.equal(f(0, now), "Not synced yet");
  });

  it("retries when the browser comes back online", async () => {
    const hz = createHarness();
    await hz.sheetsRead.loadAllData();
    assert.ok((hz.winListeners.online || []).length >= 1, "online listener");
    assert.ok((hz.winListeners.offline || []).length >= 1, "offline listener");
  });
});
