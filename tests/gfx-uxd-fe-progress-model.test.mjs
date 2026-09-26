/* GFX UXD-FE — the live-run progress model.
 *
 * Pins the AGREED CONTRACT (UXD-FE / UXD-BE, 2026-09-26) on the reader side:
 * the tracker keeps the worker's `progress` object, measures freshness on the
 * reader's clock from the last observed `sequence` change, and derives one
 * view that every live surface renders. Nothing here may invent a number.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// vm-realm arrays fail deepStrictEqual on prototype; compare plain data.
const plain = (v) => JSON.parse(JSON.stringify(v));
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const runTrackerJs = readFileSync(join(repoRoot, "discovery-run-tracker.js"), "utf8");

function loadRunTracker() {
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
  return { api: ctx.window.JobBoredDiscovery.runTracker, stored };
}

const CONTRACT_EXAMPLE = {
  phase: "scout",
  sequence: 14,
  checkpointedAt: "2026-09-26T21:00:00.000Z",
  heartbeatAt: "2026-09-26T21:00:00.000Z",
  counters: {
    companiesTotal: 3,
    companiesDone: 1,
    boardsDetected: 12,
    listingsSeen: 214,
    listingsProcessed: 90,
    leadsQualified: 4,
    matcherCalls: 8,
    queriesTotal: 5,
    queriesDone: 2,
  },
  current: { kind: "company", label: "Figma" },
  sources: [
    { id: "ats", state: "running", done: 1, total: 3 },
    { id: "serpapi_google_jobs", state: "running", done: 2, total: 5 },
  ],
};

function runningPayload(progress, extra = {}) {
  return {
    runId: "run_abc",
    status: "running",
    terminal: false,
    message: "",
    startedAt: "2026-09-26T20:56:00.000Z",
    ...(progress ? { progress } : {}),
    ...extra,
  };
}

function trackerAt(api, nowIso) {
  const t = new api.DiscoveryRunTracker("k_" + Math.random());
  t._now = () => Date.parse(nowIso);
  return t;
}

describe("UXD-FE progress model: the tracker keeps the contract progress", () => {
  it("UXD-FE-1 stores the sanitized progress object from GET /runs/:id", () => {
    const { api } = loadRunTracker();
    const t = trackerAt(api, "2026-09-26T21:00:02.000Z");
    t.beginTracking({ runId: "run_abc", statusPath: "/runs/run_abc" });
    t.updateFromStatusResponse(runningPayload(CONTRACT_EXAMPLE));
    const s = t.getState();
    assert.equal(s.progress.phase, "scout");
    assert.equal(s.progress.sequence, 14);
    assert.equal(s.progress.counters.listingsSeen, 214);
    assert.equal(s.progress.current.label, "Figma");
    assert.equal(s.progress.sources.length, 2);
    assert.equal(s.progressObservedAt, "2026-09-26T21:00:02.000Z");
    assert.equal(s.progressHeartbeatSeen, true);
  });

  it("UXD-FE-2 observation age moves only when sequence changes (reader clock)", () => {
    const { api } = loadRunTracker();
    const t = trackerAt(api, "2026-09-26T21:00:02.000Z");
    t.beginTracking({ runId: "run_abc", statusPath: "/runs/run_abc" });
    t.updateFromStatusResponse(runningPayload(CONTRACT_EXAMPLE));
    t._now = () => Date.parse("2026-09-26T21:00:40.000Z");
    t.updateFromStatusResponse(runningPayload(CONTRACT_EXAMPLE));
    assert.equal(t.getState().progressObservedAt, "2026-09-26T21:00:02.000Z");
    t._now = () => Date.parse("2026-09-26T21:00:44.000Z");
    t.updateFromStatusResponse(runningPayload({ ...CONTRACT_EXAMPLE, sequence: 15 }));
    assert.equal(t.getState().progressObservedAt, "2026-09-26T21:00:44.000Z");
  });

  it("UXD-FE-3 a new run starts with no progress", () => {
    const { api } = loadRunTracker();
    const t = trackerAt(api, "2026-09-26T21:00:02.000Z");
    t.beginTracking({ runId: "run_abc" });
    t.updateFromStatusResponse(runningPayload(CONTRACT_EXAMPLE));
    t.beginTracking({ runId: "run_def" });
    assert.equal(t.getState().progress, null);
    assert.equal(t.getState().progressObservedAt, "");
  });

  it("UXD-FE-4 the sanitizer drops unknown, negative, non-integer and URL-shaped data", () => {
    const { api } = loadRunTracker();
    const clean = api.sanitizeRunProgress({
      phase: "scout",
      sequence: 3,
      checkpointedAt: "x",
      counters: { listingsSeen: -1, boardsDetected: 2.5, leadsQualified: 7, secret: 9 },
      current: { kind: "company", label: "https://evil.example/board?key=abc" },
      sources: Array.from({ length: 12 }, (_, i) => ({ id: "s" + i, state: "running" })),
    });
    assert.deepEqual(plain(Object.keys(clean.counters)), ["leadsQualified"]);
    assert.equal(clean.current, null);
    assert.equal(clean.sources.length, 8);
    assert.equal(api.sanitizeRunProgress(null), null);
    assert.equal(api.sanitizeRunProgress({ phase: "scout" }), null, "sequence is required");
  });
});

describe("UXD-FE progress model: deriveLiveRunView", () => {
  function viewFor({ progress, observedAt, now, status = "running", heartbeat = true }) {
    const { api } = loadRunTracker();
    const state = {
      status,
      runId: "run_abc",
      startedAt: "2026-09-26T20:56:00.000Z",
      initiatedAt: "2026-09-26T20:55:58.000Z",
      progress: progress ? api.sanitizeRunProgress(progress) : null,
      progressObservedAt: observedAt || "",
      progressHeartbeatSeen: heartbeat,
      pollErrorCount: 0,
      statusUnavailable: false,
    };
    return { api, view: api.deriveLiveRunView(state, Date.parse(now)) };
  }

  it("UXD-FE-5 fresh (<=30s): working, phase steps, elapsed from startedAt", () => {
    const { view } = viewFor({
      progress: CONTRACT_EXAMPLE,
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:00:20.000Z",
    });
    assert.equal(view.mode, "live");
    assert.equal(view.health.key, "working");
    assert.match(view.health.text, /Updated 20s ago/);
    assert.equal(view.elapsedText, "4m 20s");
    assert.deepEqual(
      plain(view.steps.map((s) => s.state)),
      ["current", "todo", "todo", "todo", "todo"],
    );
    assert.equal(view.headline, "Checking Figma");
  });

  it("UXD-FE-6 30s..120s since the last change reads as quiet, never broken", () => {
    const { view } = viewFor({
      progress: CONTRACT_EXAMPLE,
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:01:10.000Z",
    });
    assert.equal(view.health.key, "quiet");
    assert.match(view.health.text, /Still working/);
    assert.match(view.health.text, /1m 10s/);
    assert.doesNotMatch(view.health.text, /stopped|stalled|broken/i);
  });

  it("UXD-FE-7 >120s with a heartbeat-bearing worker says it may have stopped", () => {
    const { view } = viewFor({
      progress: CONTRACT_EXAMPLE,
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:02:30.000Z",
    });
    assert.equal(view.health.key, "stalled");
    assert.match(view.health.text, /No word from the worker for 2m 30s/);
    assert.match(view.health.text, /may have stopped/);
  });

  it("UXD-FE-8 without heartbeatAt the view never claims a stall", () => {
    const noHeartbeat = { ...CONTRACT_EXAMPLE };
    delete noHeartbeat.heartbeatAt;
    const { view } = viewFor({
      progress: noHeartbeat,
      heartbeat: false,
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:09:00.000Z",
    });
    assert.notEqual(view.health.key, "stalled");
    assert.match(view.health.text, /No new step for 9m/);
    assert.doesNotMatch(view.health.text, /stopped/);
  });

  it("UXD-FE-9 lanes render n of N only from totals the worker sent", () => {
    const { view } = viewFor({
      progress: CONTRACT_EXAMPLE,
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:00:05.000Z",
    });
    assert.deepEqual(
      plain(view.lanes.map((l) => [l.label, l.text])),
      [
        ["Company job boards", "1 of 3"],
        ["Google Jobs", "2 of 5"],
      ],
    );
    const counters = Object.fromEntries(view.counters.map((c) => [c.key, c.value]));
    assert.equal(counters.listingsSeen, 214);
    assert.equal(counters.leadsQualified, 4);
  });

  it("UXD-FE-10 counters the worker did not send are not shown (no invented zeros)", () => {
    const { view } = viewFor({
      progress: { phase: "scout", sequence: 2, checkpointedAt: "x", counters: { listingsSeen: 0 } },
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:00:05.000Z",
    });
    assert.deepEqual(plain(view.counters.map((c) => [c.key, c.value])), [["listingsSeen", 0]]);
    assert.deepEqual(plain(view.lanes), []);
    assert.equal(view.headline, "Looking for jobs");
  });

  it("UXD-FE-11 lanes fall back to counters when sources[] is absent", () => {
    const p = { ...CONTRACT_EXAMPLE };
    delete p.sources;
    const { view } = viewFor({
      progress: p,
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:00:05.000Z",
    });
    assert.deepEqual(
      plain(view.lanes.map((l) => [l.label, l.text])),
      [
        ["Companies", "1 of 3"],
        ["Google Jobs searches", "2 of 5"],
      ],
    );
  });

  it("UXD-FE-12 no progress object = legacy view: elapsed only, no phase, no counters", () => {
    const { view } = viewFor({ progress: null, now: "2026-09-26T21:00:05.000Z" });
    assert.equal(view.mode, "legacy");
    assert.deepEqual(plain(view.steps), []);
    assert.deepEqual(plain(view.counters), []);
    assert.deepEqual(plain(view.lanes), []);
    assert.equal(view.elapsedText, "4m 5s");
    assert.match(view.health.text, /doesn't send step-by-step progress/);
  });

  it("UXD-FE-13 terminal and idle runs hide the live view", () => {
    for (const status of ["idle", "completed", "empty", "partial", "failed"]) {
      const { view } = viewFor({
        status,
        progress: CONTRACT_EXAMPLE,
        observedAt: "2026-09-26T21:00:00.000Z",
        now: "2026-09-26T21:00:05.000Z",
      });
      assert.equal(view.mode, "hidden", status);
    }
  });

  it("UXD-FE-14 later phases mark earlier steps done; unknown phase marks none current", () => {
    const { view } = viewFor({
      progress: { ...CONTRACT_EXAMPLE, phase: "write" },
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:00:05.000Z",
    });
    assert.deepEqual(plain(view.steps.map((s) => s.state)), ["done", "done", "done", "current", "todo"]);
    const unknown = viewFor({
      progress: { ...CONTRACT_EXAMPLE, phase: "teleport", current: undefined },
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:00:05.000Z",
    }).view;
    assert.ok(unknown.steps.every((s) => s.state === "todo"));
    assert.equal(unknown.headline, "Working");
  });

  it("UXD-FE-15 polling trouble overrides health with the reconnect copy", () => {
    const { view } = viewFor({
      status: "polling_error",
      progress: CONTRACT_EXAMPLE,
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:00:05.000Z",
    });
    assert.equal(view.health.key, "reconnecting");
    assert.match(view.health.text, /Reconnecting/);
  });

  it("UXD-FE-16 summary is one plain sentence for the button label", () => {
    const { view } = viewFor({
      progress: CONTRACT_EXAMPLE,
      observedAt: "2026-09-26T21:00:00.000Z",
      now: "2026-09-26T21:00:05.000Z",
    });
    assert.equal(
      view.summary,
      "Discovery running: checking Figma. 214 listings found so far. Updated 5s ago.",
    );
  });
});

describe("UXD-FE progress model: renderLiveRunProgressHtml", () => {
  function render(progress, now = "2026-09-26T21:00:05.000Z", variant = "card") {
    const { api } = loadRunTracker();
    const state = {
      status: "running",
      runId: "run_abc",
      startedAt: "2026-09-26T20:56:00.000Z",
      progress: progress ? api.sanitizeRunProgress(progress) : null,
      progressObservedAt: "2026-09-26T21:00:00.000Z",
      progressHeartbeatSeen: true,
    };
    return api.renderLiveRunProgressHtml(api.deriveLiveRunView(state, Date.parse(now)), {
      variant,
    });
  }

  it("UXD-FE-17 phase line is an ordered list with aria-current on the live step", () => {
    const html = render(CONTRACT_EXAMPLE);
    assert.match(html, /<ol class="jb-live-run__steps"/);
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
    assert.match(html, /data-health="working"/);
    assert.match(html, /<dl class="jb-live-run__counters"/);
  });

  it("UXD-FE-18 the progress block is not itself a live region (it ticks every second)", () => {
    const html = render(CONTRACT_EXAMPLE);
    assert.doesNotMatch(html, /aria-live|role="status"|role="alert"/);
  });

  it("UXD-FE-19 labels from the worker are escaped", () => {
    const html = render({ ...CONTRACT_EXAMPLE, current: { kind: "company", label: "<b>Acme</b>" } });
    assert.doesNotMatch(html, /<b>Acme/);
    assert.match(html, /&lt;b&gt;Acme/);
  });

  it("UXD-FE-20 stalled state is carried in text, not only colour", () => {
    const html = render(CONTRACT_EXAMPLE, "2026-09-26T21:03:00.000Z");
    assert.match(html, /data-health="stalled"/);
    assert.match(html, /may have stopped/);
  });

  it("UXD-FE-21 hidden view renders nothing", () => {
    const { api } = loadRunTracker();
    const html = api.renderLiveRunProgressHtml(
      api.deriveLiveRunView({ status: "idle" }, Date.now()),
      { variant: "card" },
    );
    assert.equal(html, "");
  });
});
