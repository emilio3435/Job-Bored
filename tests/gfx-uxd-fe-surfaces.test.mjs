/* GFX UXD-FE — the three homes of live run progress.
 *
 *   1. Runs modal: the live job-discovery row gains a progress row.
 *   2. #discoveryBtn: its label carries one honest sentence and a health
 *      attribute; phase changes and stalls are announced once, politely.
 *   3. Discovery drawer: reopening it mid-run shows the run, not a blank form.
 *
 * Each surface renders the tracker's one view-model (AGREED CONTRACT,
 * UXD-FE / UXD-BE 2026-09-26), so "no progress" degrades the same way
 * everywhere.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");
const runTrackerJs = read("discovery-run-tracker.js");
const runsTabJs = read("runs-tab.js");
const statusHandoffJs = read("discovery-status-handoff.js");
const drawerJs = read("discovery-drawer.js");

const PROGRESS = {
  phase: "scout",
  sequence: 14,
  checkpointedAt: "2026-09-26T21:00:00.000Z",
  heartbeatAt: "2026-09-26T21:00:00.000Z",
  counters: { companiesTotal: 3, companiesDone: 1, listingsSeen: 214, leadsQualified: 4 },
  current: { kind: "company", label: "Figma" },
};

function loadTrackerApi() {
  const stored = new Map();
  const ctx = {
    window: {},
    document: undefined,
    localStorage: {
      getItem: (k) => (stored.has(k) ? stored.get(k) : null),
      setItem: (k, v) => stored.set(k, String(v)),
      removeItem: (k) => stored.delete(k),
    },
    setTimeout,
    clearTimeout,
    AbortController,
  };
  vm.createContext(ctx);
  vm.runInContext(runTrackerJs, ctx, { filename: "discovery-run-tracker.js" });
  return ctx.window.JobBoredDiscovery.runTracker;
}

function trackerState(overrides = {}) {
  const now = new Date();
  return {
    status: "running",
    runId: "run_abc",
    statusPath: "/runs/run_abc",
    trigger: "manual",
    initiatedAt: new Date(now.getTime() - 65_000).toISOString(),
    startedAt: new Date(now.getTime() - 64_000).toISOString(),
    progress: PROGRESS,
    progressObservedAt: new Date(now.getTime() - 3_000).toISOString(),
    progressHeartbeatSeen: true,
    pollErrorCount: 0,
    ...overrides,
  };
}

function loadRunsTab() {
  const window = { JobBoredDiscovery: { runTracker: loadTrackerApi() } };
  const ctx = {
    window,
    document: {
      readyState: "loading",
      addEventListener() {},
      getElementById: () => null,
    },
    navigator: { userAgent: "test" },
    console,
    URL,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(runsTabJs, ctx, { filename: "runs-tab.js" });
  return window.JobBoredRunsLog.__test;
}

describe("UXD-FE surfaces: Runs modal live row", () => {
  it("UXD-FE-22 the normalized live run keeps the progress fields", () => {
    const t = loadRunsTab();
    const run = t.normalizeJobDiscoveryRunState({ state: trackerState() });
    assert.equal(run.progress.sequence, 14);
    assert.equal(run.progressHeartbeatSeen, true);
    assert.ok(run.progressObservedAt);
    assert.ok(run.startedAt);
  });

  it("UXD-FE-23 a live run renders a full-width progress row under its row", () => {
    const t = loadRunsTab();
    const run = t.normalizeJobDiscoveryRunState({ state: trackerState() });
    const html = t.renderLiveJobRunRowHtml(run);
    assert.match(html, /<tr class="runs-live-progress-row" data-live-run-progress="1"><td colspan="4">/);
    assert.match(html, /jb-live-run--row/);
    assert.match(html, /Checking Figma/);
    assert.match(html, /1 of 3/);
    assert.match(html, /Listings found/);
    assert.doesNotMatch(html, />Live</, "the frozen word 'Live' is replaced by real elapsed time");
  });

  it("UXD-FE-24 a legacy run (no progress) shows elapsed and an honest note, no numbers", () => {
    const t = loadRunsTab();
    const run = t.normalizeJobDiscoveryRunState({
      state: trackerState({ progress: null, progressObservedAt: "" }),
    });
    const html = t.renderLiveJobRunRowHtml(run);
    assert.match(html, /data-live-run-progress/);
    assert.match(html, /doesn&#39;t send step-by-step progress/);
    assert.doesNotMatch(html, /jb-live-run__steps|jb-live-run__counters|jb-live-run__lanes/);
  });

  it("UXD-FE-25 a terminal live row carries no progress row", () => {
    const t = loadRunsTab();
    const run = t.normalizeJobDiscoveryRunState({
      state: trackerState({ status: "completed" }),
    });
    assert.doesNotMatch(t.renderLiveJobRunRowHtml(run), /data-live-run-progress/);
  });

  it("UXD-FE-26 without the tracker module the row falls back to today's markup", () => {
    const window = {};
    const ctx = {
      window,
      document: { readyState: "loading", addEventListener() {}, getElementById: () => null },
      navigator: { userAgent: "test" },
      console,
      URL,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      setInterval,
      clearInterval,
    };
    vm.runInNewContext(runsTabJs, ctx, { filename: "runs-tab.js" });
    const t = window.JobBoredRunsLog.__test;
    const run = t.normalizeJobDiscoveryRunState({ state: trackerState() });
    const html = t.renderLiveJobRunRowHtml(run);
    assert.doesNotMatch(html, /data-live-run-progress/);
    assert.match(html, /runs-row--in-progress/);
  });
});

function makeEl() {
  const attrs = new Map();
  const classes = new Set();
  return {
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
    },
    setAttribute: (n, v) => attrs.set(n, String(v)),
    removeAttribute: (n) => attrs.delete(n),
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    click() {},
  };
}

function loadStatus(getState) {
  const btn = makeEl();
  const announced = [];
  const toasts = [];
  const trackerApi = loadTrackerApi();
  const window = {
    JobBoredA11y: { live: { announce: (msg, opts) => announced.push({ msg, opts }) } },
  };
  const ctx = {
    window,
    document: { getElementById: (id) => (id === "discoveryBtn" ? btn : null) },
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(statusHandoffJs, ctx, { filename: "discovery-status-handoff.js" });
  window.JobBoredDiscovery.runTracker = {
    ...trackerApi,
    discoveryRunTracker: {
      getState: getState,
      isActive: () => ["pending", "running", "polling_error"].includes(getState().status),
      isTerminal: () => false,
    },
  };
  const status = window.JobBoredDiscovery.status;
  status.host = {
    showToast: (...args) => toasts.push(args),
    isSignedIn: () => true,
    getDiscoveryWebhookUrl: () => "",
  };
  return { status, btn, announced, toasts };
}

describe("UXD-FE surfaces: #discoveryBtn", () => {
  it("UXD-FE-27 the button label is the view's one-sentence summary", () => {
    let state = trackerState();
    const { status, btn } = loadStatus(() => state);
    status.syncDiscoveryLiveProgress();
    assert.match(btn.getAttribute("aria-label"), /^Discovery running: checking Figma\. 214 listings found so far\./);
    assert.equal(btn.getAttribute("title"), btn.getAttribute("aria-label"));
    assert.equal(btn.getAttribute("data-run-health"), "working");
  });

  it("UXD-FE-28 a stalled heartbeat worker flips the health attribute and says so", () => {
    const state = trackerState({
      progressObservedAt: new Date(Date.now() - 180_000).toISOString(),
    });
    const { status, btn } = loadStatus(() => state);
    status.syncDiscoveryLiveProgress();
    assert.equal(btn.getAttribute("data-run-health"), "stalled");
    assert.match(btn.getAttribute("aria-label"), /may have stopped/);
  });

  it("UXD-FE-29 phase changes and stalls are announced once each, never every poll", () => {
    let state = trackerState();
    const { status, announced } = loadStatus(() => state);
    status.syncDiscoveryLiveProgress();
    status.syncDiscoveryLiveProgress();
    state = trackerState({ progress: { ...PROGRESS, phase: "score", sequence: 15, current: undefined } });
    status.syncDiscoveryLiveProgress();
    status.syncDiscoveryLiveProgress();
    state = trackerState({
      progress: { ...PROGRESS, phase: "score", sequence: 15, current: undefined },
      progressObservedAt: new Date(Date.now() - 200_000).toISOString(),
    });
    status.syncDiscoveryLiveProgress();
    status.syncDiscoveryLiveProgress();
    assert.deepEqual(
      announced.map((a) => a.msg),
      [
        "Discovery: looking for jobs.",
        "Discovery: scoring what turned up.",
        "Discovery: no word from the worker for 3m 20s. It may have stopped.",
      ],
    );
    assert.ok(announced.every((a) => !a.opts || !a.opts.assertive));
  });

  it("UXD-FE-34 a legacy run keeps today's button label (no invented progress)", () => {
    const state = trackerState({ status: "pending", progress: null, progressObservedAt: "" });
    const { status, btn } = loadStatus(() => state);
    btn.setAttribute("aria-label", "Discovery started — searching for new roles…");
    status.syncDiscoveryLiveProgress();
    assert.equal(btn.getAttribute("aria-label"), "Discovery started — searching for new roles…");
    assert.equal(btn.getAttribute("data-run-health"), "starting");
  });

  it("UXD-FE-30 idle/terminal clears the health attribute", () => {
    let state = trackerState();
    const { status, btn } = loadStatus(() => state);
    status.syncDiscoveryLiveProgress();
    state = { status: "idle" };
    status.syncDiscoveryLiveProgress();
    assert.equal(btn.getAttribute("data-run-health"), null);
  });

  it("UXD-FE-31 the poll loop re-syncs the live view after every status answer", () => {
    const start = statusHandoffJs.indexOf("async function startDiscoveryStatusPolling(");
    const end = statusHandoffJs.indexOf("/** Stop any active polling loop", start);
    const body = statusHandoffJs.slice(start, end);
    const update = body.indexOf("tracker.updateFromStatusResponse(statusData)");
    const sync = body.indexOf("syncDiscoveryLiveProgress()", update);
    assert.ok(update > 0 && sync > update, "sync must follow each status update");
  });
});

class FakeNode {
  constructor(tag, cls = "") {
    this.tagName = tag.toUpperCase();
    this.className = cls;
    this.attrs = new Map();
    this.hidden = false;
    this.innerHTML = "";
    this.parentNode = null;
    this.nextSibling = null;
    this.inserted = [];
  }
  setAttribute(n, v) {
    this.attrs.set(n, String(v));
  }
  getAttribute(n) {
    return this.attrs.has(n) ? this.attrs.get(n) : null;
  }
  insertAdjacentElement(where, el) {
    this.inserted.push({ where, el });
    el.parentNode = this;
    return el;
  }
}

function loadDrawer(getState) {
  const head = new FakeNode("header", "discovery-drawer__head");
  const drawerEl = new FakeNode("div");
  drawerEl.style = { display: "flex" };
  let mount = null;
  drawerEl.querySelector = (sel) => {
    if (sel === ".discovery-drawer__head") return head;
    if (sel === "[data-discovery-live-run]") return mount;
    return null;
  };
  const document = {
    getElementById: (id) => (id === "discoveryDrawer" ? drawerEl : null),
    createElement: (tag) => {
      mount = new FakeNode(tag);
      return mount;
    },
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    readyState: "complete",
  };
  const trackerApi = loadTrackerApi();
  const window = {
    JobBoredDiscovery: {
      runTracker: {
        ...trackerApi,
        discoveryRunTracker: { getState: getState },
      },
    },
  };
  const ctx = { window, document, console, setTimeout, clearTimeout, setInterval, clearInterval, URL };
  vm.createContext(ctx);
  vm.runInContext(drawerJs, ctx, { filename: "discovery-drawer.js" });
  return { drawer: window.JobBoredDiscovery.drawer, head, getMount: () => mount };
}

describe("UXD-FE surfaces: discovery drawer", () => {
  it("UXD-FE-32 reopening the drawer mid-run shows the run under the header", () => {
    let state = trackerState();
    const { drawer, head, getMount } = loadDrawer(() => state);
    drawer.syncDiscoveryDrawerLiveRun();
    const mount = getMount();
    assert.ok(mount, "a mount is created");
    assert.equal(head.inserted[0].where, "afterend");
    assert.equal(mount.className, "dp-live-run");
    assert.equal(mount.hidden, false);
    assert.match(mount.innerHTML, /jb-live-run--card/);
    assert.match(mount.innerHTML, /Checking Figma/);
    assert.equal(mount.getAttribute("aria-label"), "Discovery run in progress");
    // The run ends: the one-second tick must stop with it.
    state = { status: "idle" };
    drawer.syncDiscoveryDrawerLiveRun();
  });

  it("UXD-FE-33 no live run hides the card and leaves no stale numbers", () => {
    let state = trackerState();
    const { drawer, getMount } = loadDrawer(() => state);
    drawer.syncDiscoveryDrawerLiveRun();
    state = { status: "completed", runId: "run_abc" };
    drawer.syncDiscoveryDrawerLiveRun();
    assert.equal(getMount().hidden, true);
    assert.equal(getMount().innerHTML, "");
  });
});
