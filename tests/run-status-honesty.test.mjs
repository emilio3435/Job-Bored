import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Run-status honesty — long-running jobs (discovery runs, materials
   drafts) must always show a truthful live/terminal status.

   1. The run-* classes renderDiscoveryRunStatus() puts on #discoveryBtn
      must actually have CSS, and stale run-* classes must be cleared
      before the next one is applied (a leftover run-failed must not
      restyle an idle or running button).
   2. diagnoseDownstreamChain must not prescribe ngrok remediation to
      users whose saved webhook is a remote https endpoint (Tailscale
      *.ts.net, *.workers.dev, generic https) with no tunnel transport.
   3. A persisted terminal run outcome must be surfaced exactly once
      after reload (toast + pipeline refresh), then acknowledged.
   4. The materials queue must not fake progress: a dead worker shows a
      STALLED? pill, and an unreachable API shows an honest header
      instead of frozen rows with a climbing timer.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);
const runTrackerJs = readFileSync(
  join(repoRoot, "discovery-run-tracker.js"),
  "utf8",
);
const materialsQueueJs = readFileSync(
  join(repoRoot, "materials-queue.js"),
  "utf8",
);
const roleMaterialsJs = readFileSync(join(repoRoot, "role-materials.js"), "utf8");
const jbV2Css = readFileSync(join(repoRoot, "jb-v2.css"), "utf8");

function makeEl() {
  const attrs = new Map();
  const classes = new Set();
  return {
    classes,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
    },
    setAttribute: (n, v) => attrs.set(n, String(v)),
    removeAttribute: (n) => attrs.delete(n),
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    hasAttribute: (n) => attrs.has(n),
    click() {
      this.clicked = (this.clicked || 0) + 1;
    },
  };
}

/**
 * Mount discovery-status-handoff.js in a VM with a mutable tracker state
 * and a recording host. `trackerState` is shared by reference so tests can
 * mutate it between calls (mirrors the singleton tracker).
 */
function loadStatus(trackerState, hostOverrides = {}) {
  const toasts = [];
  const acknowledged = [];
  const loads = [];
  const btn = makeEl();
  const runsBtn = makeEl();
  const window = { location: { search: "", pathname: "/", hash: "" } };
  const document = {
    getElementById: (id) =>
      id === "discoveryBtn" ? btn : id === "runsBtn" ? runsBtn : makeEl(),
  };
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
  };
  vm.createContext(ctx);
  vm.runInContext(statusHandoffJs, ctx, {
    filename: "discovery-status-handoff.js",
  });
  const status = window.JobBoredDiscovery.status;
  const TERMINAL = ["completed", "empty", "partial", "failed"];
  window.JobBoredDiscovery.runTracker = {
    discoveryRunTracker: {
      getState: () => ({ ...trackerState }),
      isActive: () =>
        ["pending", "running", "polling_error"].includes(trackerState.status),
      isTerminal: () => TERMINAL.includes(trackerState.status),
      resumeFromStatusPollingFailure: () => {},
      acknowledgeTerminalOutcome: () => {
        acknowledged.push(trackerState.status);
        trackerState.terminalAcknowledged = true;
      },
    },
  };
  status.host = {
    showToast: (msg, tone, sticky, action) =>
      toasts.push({ msg, tone, sticky, action }),
    isSignedIn: () => true,
    getDiscoveryWebhookUrl: () => "",
    loadAllData: async () => {
      loads.push(true);
    },
    ...hostOverrides,
  };
  return { status, toasts, btn, runsBtn, acknowledged, loads };
}

describe("FIX 1 — run-* button classes are honest and styled", () => {
  it("clears stale run-* classes before applying the next status class", () => {
    const state = { status: "running", runId: "run_abc12345" };
    const env = loadStatus(state);
    env.status.renderDiscoveryRunStatus();
    assert.ok(env.btn.classes.has("run-running"));

    state.status = "failed";
    state.errorMessage = "boom";
    env.status.renderDiscoveryRunStatus();
    assert.ok(env.btn.classes.has("run-failed"));
    assert.ok(
      !env.btn.classes.has("run-running"),
      "stale run-running must be removed when the run fails",
    );
  });

  it("clears every terminal run-* class when the tracker goes idle", () => {
    const state = { status: "failed", runId: "run_abc12345", errorMessage: "x" };
    const env = loadStatus(state);
    env.status.renderDiscoveryRunStatus();
    assert.ok(env.btn.classes.has("run-failed"));

    state.status = "idle";
    state.runId = "";
    env.status.renderDiscoveryRunStatus();
    assert.equal(
      [...env.btn.classes].filter((c) => c.startsWith("run-")).length,
      0,
      "idle button must carry no run-* classes (stale terminal restyle)",
    );
  });

  it("jb-v2.css styles the active-run and terminal-flash button states", () => {
    assert.match(jbV2Css, /\.btn-discovery\.run-pending/);
    assert.match(jbV2Css, /\.btn-discovery\.run-running/);
    assert.match(jbV2Css, /\.btn-discovery\.run-completed/);
    assert.match(jbV2Css, /\.btn-discovery\.run-partial/);
    assert.match(jbV2Css, /\.btn-discovery\.run-failed/);
    assert.match(jbV2Css, /\.btn-discovery\.run-empty/);
    assert.match(
      jbV2Css,
      /prefers-reduced-motion/,
      "run-state animation must respect reduced motion",
    );
  });
});

describe("FIX 2 — diagnosis honors the saved webhook kind", () => {
  function diagnose(snapshot, transport = {}, hostOverrides = {}) {
    const env = loadStatus(
      { status: "idle", runId: "" },
      {
        getDiscoveryWizardProbesApi: () => ({
          readDiscoveryTransportSetupState: () => transport,
          probeNgrokTunnels: async () => "",
          probeHealthUrl: async () => false,
        }),
        ...hostOverrides,
      },
    );
    return env.status.diagnoseDownstreamChain(snapshot);
  }

  it("a Tailscale webhook gets a worker-unreachable summary, not 'Fix tunnel'", async () => {
    const diagnosis = await diagnose({
      savedWebhookUrl: "https://mybox.tailnet-1234.ts.net/webhook",
    });
    assert.match(diagnosis.summary, /mybox\.tailnet-1234\.ts\.net/);
    assert.match(diagnosis.summary, /unreachable/i);
    assert.doesNotMatch(diagnosis.summary, /ngrok/i);
    assert.ok(diagnosis.primaryFix, "must still offer a primary action");
    assert.notEqual(
      diagnosis.primaryFix.id,
      "diag_fix_tunnel",
      "ngrok remediation cannot help a Tailscale webhook",
    );
  });

  it("a workers.dev webhook with no tunnel transport gets the same honest summary", async () => {
    const diagnosis = await diagnose({
      savedWebhookUrl: "https://jobbored-relay.example.workers.dev/webhook",
    });
    assert.match(diagnosis.summary, /jobbored-relay\.example\.workers\.dev/);
    assert.notEqual(diagnosis.primaryFix.id, "diag_fix_tunnel");
  });

  it("keeps the ngrok fix when the transport actually uses a tunnel", async () => {
    const diagnosis = await diagnose(
      { savedWebhookUrl: "https://jobbored-relay.example.workers.dev/webhook" },
      { tunnelPublicUrl: "https://abc123.ngrok-free.app" },
    );
    assert.match(diagnosis.summary, /ngrok tunnel is not running/i);
    assert.equal(diagnosis.primaryFix.id, "diag_fix_tunnel");
  });

  it("keeps the local-server fix when a local webhook is configured and down", async () => {
    const diagnosis = await diagnose({
      savedWebhookUrl: "https://jobbored-relay.example.workers.dev/webhook",
      localWebhookUrl: "http://localhost:8644/webhook",
    });
    assert.equal(diagnosis.primaryFix.id, "diag_fix_local_server");
  });
});

describe("FIX 3 — persisted terminal outcome is surfaced once after reload", () => {
  it("a stored failed run renders a sticky toast with the error and an Open runs action", () => {
    const state = {
      status: "failed",
      runId: "run_abc12345",
      statusPath: "/runs/run_abc12345",
      errorMessage: "Worker exploded mid-run",
      terminalAcknowledged: false,
    };
    const env = loadStatus(state);
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.equal(env.toasts.length, 1);
    assert.match(env.toasts[0].msg, /failed/i);
    assert.match(env.toasts[0].msg, /Worker exploded mid-run/);
    assert.equal(env.toasts[0].tone, "error");
    assert.equal(env.toasts[0].sticky, true);
    assert.equal(env.toasts[0].action.label, "Open runs");
    assert.deepEqual(env.acknowledged, ["failed"]);
  });

  it("a stored completed run toasts transiently and refreshes the pipeline", async () => {
    const state = {
      status: "completed",
      runId: "run_abc12345",
      statusPath: "/runs/run_abc12345",
      leadsWritten: 3,
      terminalAcknowledged: false,
    };
    const env = loadStatus(state);
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(env.toasts.length, 1);
    assert.notEqual(env.toasts[0].sticky, true);
    assert.equal(env.toasts[0].action.label, "Open runs");
    assert.equal(env.loads.length, 1, "lead-bearing outcome must refresh pipeline");
    assert.deepEqual(env.acknowledged, ["completed"]);
  });

  it("does NOT refresh the pipeline for a lead-free failed run", async () => {
    const state = {
      status: "failed",
      runId: "run_abc12345",
      statusPath: "/runs/run_abc12345",
      errorMessage: "nope",
      terminalAcknowledged: false,
    };
    const env = loadStatus(state);
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(env.loads.length, 0);
  });

  it("never re-toasts an already-acknowledged terminal outcome", () => {
    const state = {
      status: "failed",
      runId: "run_abc12345",
      statusPath: "/runs/run_abc12345",
      errorMessage: "Worker exploded mid-run",
      terminalAcknowledged: true,
    };
    const env = loadStatus(state);
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.equal(env.toasts.length, 0);
    assert.equal(env.acknowledged.length, 0);
  });

  it("surfaces a terminal outcome even when the run never had a statusPath", () => {
    const state = {
      status: "failed",
      runId: "run_abc12345",
      statusPath: "",
      errorMessage: "Trigger failed at network level",
      terminalAcknowledged: false,
    };
    const env = loadStatus(state);
    env.status.resumeDiscoveryStatusPollingIfNeeded();
    assert.equal(env.toasts.length, 1);
    assert.match(env.toasts[0].msg, /Trigger failed at network level/);
  });

  it("post-access bootstrap retries the resume (bootstrap runs pre-sign-in)", async () => {
    // app-bootstrap calls resume before the OAuth session restores, so the
    // signed-in gate no-ops it on every reload. runPostAccessBootstrapOnce
    // (fired after the first signed-in data load) must retry, or the stored
    // outcome never surfaces in a real session.
    const state = {
      status: "failed",
      runId: "run_abc12345",
      statusPath: "/runs/run_abc12345",
      errorMessage: "Worker exploded mid-run",
      terminalAcknowledged: false,
    };
    const env = loadStatus(state, {
      checkInfraSetupGate: async () => false,
      checkOnboardingGate: async () => {},
      isOnboardingWizardVisible: () => false,
      isFirstRunWizardVisible: () => false,
    });
    await env.status.runPostAccessBootstrapOnce();
    assert.equal(env.toasts.length, 1);
    assert.match(env.toasts[0].msg, /Worker exploded mid-run/);
    assert.deepEqual(env.acknowledged, ["failed"]);
  });

  it("the real tracker persists and acknowledges the terminal flag", () => {
    const stored = new Map();
    const ctx = {
      window: {},
      document: undefined,
      localStorage: {
        getItem: (k) => (stored.has(k) ? stored.get(k) : null),
        setItem: (k, v) => stored.set(k, String(v)),
        removeItem: (k) => stored.delete(k),
      },
    };
    vm.createContext(ctx);
    vm.runInContext(runTrackerJs, ctx, { filename: "discovery-run-tracker.js" });
    const api = ctx.window.JobBoredDiscovery.runTracker;
    const tracker = new api.DiscoveryRunTracker("test_run_state");
    tracker.beginTracking({ runId: "run_x", statusPath: "/runs/run_x" });
    tracker.updateFromStatusResponse({ terminal: true, status: "failed", error: "boom" });
    assert.equal(tracker.getState().terminalAcknowledged, false);
    tracker.acknowledgeTerminalOutcome();
    assert.equal(tracker.getState().terminalAcknowledged, true);
    // Round-trips through storage.
    const reloaded = new api.DiscoveryRunTracker("test_run_state");
    assert.equal(reloaded.getState().terminalAcknowledged, true);
  });
});

describe("FIX 4 — materials queue does not fake progress", () => {
  function loadQueue({ fetchImpl }) {
    const region = makeEl();
    region.__innerHTML = "";
    Object.defineProperty(region, "innerHTML", {
      get() {
        return region.__innerHTML;
      },
      set(v) {
        region.__innerHTML = String(v);
      },
    });
    region.addEventListener = () => {};
    const timers = [];
    const doc = {
      readyState: "complete",
      querySelector: (sel) =>
        sel.indexOf("materials-queue") !== -1 ? region : null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    };
    const ctx = {
      window: {
        COMMAND_CENTER_CONFIG: { jobPostingScrapeUrl: "http://127.0.0.1:9" },
      },
      document: doc,
      console,
      fetch: fetchImpl,
      setTimeout: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimeout: () => {},
      setInterval: () => 0,
      Date,
      Promise,
    };
    ctx.window.fetch = fetchImpl;
    vm.createContext(ctx);
    vm.runInContext(materialsQueueJs, ctx, { filename: "materials-queue.js" });
    return { region, timers };
  }

  function queueItem(updatedAtMsAgo, phase = "drafting") {
    return {
      slug: "acme-engineer",
      company: "Acme",
      title: "Engineer",
      feature: "both",
      progress: {
        phase,
        startedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - updatedAtMsAgo).toISOString(),
        elapsedSeconds: 900,
      },
    };
  }

  function okFetch(queue) {
    return () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ queue }),
      });
  }

  it("renders STALLED? when the heartbeat is older than ~10 minutes on a non-terminal phase", async () => {
    const { region } = loadQueue({
      fetchImpl: okFetch([queueItem(15 * 60 * 1000, "drafting")]),
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.match(region.innerHTML, /STALLED\?/);
    assert.match(region.innerHTML, /data-phase="stalled"/);
  });

  it("keeps the live phase pill when the heartbeat is fresh", async () => {
    const { region } = loadQueue({
      fetchImpl: okFetch([queueItem(30 * 1000, "drafting")]),
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.match(region.innerHTML, /DRAFTING/);
    assert.doesNotMatch(region.innerHTML, /STALLED\?/);
  });

  it("does not mark terminal phases as stalled", async () => {
    const { region } = loadQueue({
      fetchImpl: okFetch([queueItem(15 * 60 * 1000, "failed")]),
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.doesNotMatch(region.innerHTML, /STALLED\?/);
    assert.match(region.innerHTML, /FAILED/);
  });

  it("replaces frozen rows with an honest header after 3 consecutive fetch failures", async () => {
    let fail = false;
    const fetchImpl = () =>
      fail
        ? Promise.reject(new Error("ECONNREFUSED"))
        : Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ queue: [queueItem(1000, "drafting")] }),
          });
    const { region, timers } = loadQueue({ fetchImpl });
    await new Promise((r) => setTimeout(r, 0));
    assert.match(region.innerHTML, /DRAFTING/, "healthy rows render first");

    fail = true;
    for (let i = 0; i < 3; i += 1) {
      timers[timers.length - 1]();
      await new Promise((r) => setTimeout(r, 0));
    }
    assert.match(region.innerHTML, /Can't reach the materials server/);
    assert.doesNotMatch(
      region.innerHTML,
      /DRAFTING/,
      "frozen rows must not keep masquerading as progress",
    );
  });
});

describe("FIX 4 — role-materials honest copy and timeout", () => {
  it("the failed-phase copy no longer points at Telegram", () => {
    assert.doesNotMatch(roleMaterialsJs, /Check Telegram/);
    assert.match(
      roleMaterialsJs,
      /Open the request again or check the worker logs\./,
    );
  });

  it("the 30-minute polling cap renders an honest message instead of going silent", () => {
    const start = roleMaterialsJs.indexOf("function startPolling(");
    assert.notEqual(start, -1);
    const end = roleMaterialsJs.indexOf(
      "/* -------------------- top-level orchestration",
      start,
    );
    const pollSource = roleMaterialsJs.slice(start, end);
    assert.match(
      pollSource,
      /Still no result after 30 minutes — the drafting worker may be down\./,
    );
    assert.match(pollSource, /renderError\(/);
  });
});
