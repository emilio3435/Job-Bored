/**
 * LIFECYCLE-1 (browser half) — run-status poll responses are classified
 * before they are retried.
 *
 * `pollRunStatus` used to call `markPollError` for EVERY non-ok response.
 * After MAX_POLL_ERRORS the UI said "Lost the status connection after
 * multiple attempts. The discovery run may still be running." — a false
 * statement for a 404 (the worker has no record of the run) or a 401 (the
 * status token is rejected). Those answers do not change on retry, so the
 * poller must stop at once and say something true.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusHandoffJs = readFileSync(
  join(repoRoot, "discovery-status-handoff.js"),
  "utf8",
);
const runTrackerJs = readFileSync(
  join(repoRoot, "discovery-run-tracker.js"),
  "utf8",
);

const TRACKER_STATE = {
  runId: "run_probe",
  statusPath: "/runs/run_probe",
  status: "running",
  pollErrorCount: 0,
};

function makeEl() {
  const attributes = {};
  return {
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute: (name, value) => {
      attributes[name] = value;
    },
    removeAttribute: (name) => {
      delete attributes[name];
    },
    attributes,
    style: {},
    click() {},
  };
}

/**
 * Mount discovery-status-handoff.js over a recording fake tracker (the shape
 * the scout probe used) so we can see exactly which tracker entry point a
 * poll response routes to, and what the user is told.
 */
function loadStatus({ fetchImpl, trackerState = TRACKER_STATE } = {}) {
  const pollErrors = [];
  const connectionLost = [];
  const endpointTerminal = [];
  const toasts = [];
  const btn = makeEl();
  const window = { location: { search: "", pathname: "/", hash: "" } };
  const document = {
    getElementById: (id) => (id === "discoveryBtn" ? btn : makeEl()),
  };
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    fetch: fetchImpl,
  };
  vm.createContext(ctx);
  vm.runInContext(statusHandoffJs, ctx, {
    filename: "discovery-status-handoff.js",
  });
  const tracker = {
    getState: () => ({ ...trackerState }),
    isActive: () => true,
    isTerminal: () => false,
    markPollError: (message) => pollErrors.push(message),
    markStatusConnectionLost: (message) => connectionLost.push(message),
    markStatusEndpointTerminal: (message) => endpointTerminal.push(message),
    updateFromStatusResponse: () => {},
  };
  window.JobBoredDiscovery.runTracker = { discoveryRunTracker: tracker };
  window.JobBoredDiscovery.status.host = {
    showToast: (message, tone, sticky, action) =>
      toasts.push({ message, tone, sticky, action }),
    isSignedIn: () => true,
    getDiscoveryWebhookUrl: () => "http://127.0.0.1:8644/webhook",
    normalizeDiscoveryWebhookIdentity: (u) => String(u || ""),
    isLocalWebhookCandidateUrl: () => true,
    isLocalDashboardOrigin: () => false,
    loadAllData: async () => {},
  };
  return {
    status: window.JobBoredDiscovery.status,
    tracker,
    pollErrors,
    connectionLost,
    endpointTerminal,
    toasts,
  };
}

/** A real tracker over an in-memory localStorage, for state assertions. */
function loadRealTracker() {
  const store = new Map();
  const window = {};
  const ctx = {
    window,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(runTrackerJs, ctx, {
    filename: "discovery-run-tracker.js",
  });
  const { DiscoveryRunTracker } = window.JobBoredDiscovery.runTracker;
  return new DiscoveryRunTracker("test_discovery_run_state");
}

describe("LIFECYCLE-1 — classifyRunStatusPollResponse", () => {
  const classify = loadStatus().status.classifyRunStatusPollResponse;

  it("LIFECYCLE-1: 2xx is ok", () => {
    assert.equal(classify(200), "ok");
    assert.equal(classify(204), "ok");
  });

  it("LIFECYCLE-1: transient transport failures are retryable", () => {
    for (const status of [0, 408, 425, 429, 500, 502, 503, 504]) {
      assert.equal(
        classify(status),
        "retryable",
        `HTTP ${status} must be retryable`,
      );
    }
  });

  it("LIFECYCLE-1: answers that will not change on retry are terminal", () => {
    for (const status of [401, 403, 404, 405, 410]) {
      assert.equal(
        classify(status),
        "terminal",
        `HTTP ${status} must be terminal`,
      );
    }
  });

  it("LIFECYCLE-1: an unknown or missing status stays retryable", () => {
    assert.equal(classify(undefined), "retryable");
    assert.equal(classify("nonsense"), "retryable");
    assert.equal(classify(418), "retryable");
  });
});

describe("LIFECYCLE-1 — pollRunStatus routes by classification", () => {
  it("LIFECYCLE-1: a 503 from /runs/:id is retryable and burns one retry", async () => {
    const env = loadStatus({
      fetchImpl: async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    });
    await env.status.pollRunStatus("http://127.0.0.1:8644/webhook");
    assert.deepEqual(env.pollErrors, ["Status endpoint returned HTTP 503"]);
    assert.deepEqual(env.endpointTerminal, []);
  });

  it("LIFECYCLE-1: a network error is retryable", async () => {
    const env = loadStatus({
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
    });
    await env.status.pollRunStatus("http://127.0.0.1:8644/webhook");
    assert.equal(env.pollErrors.length, 1);
    assert.match(env.pollErrors[0], /Network error fetching status/);
    assert.deepEqual(env.endpointTerminal, []);
  });

  it("LIFECYCLE-1: a 404 from /runs/:id is terminal and must not burn a retry", async () => {
    const env = loadStatus({
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, message: "Run not found" }),
      }),
    });
    await env.status.pollRunStatus("http://127.0.0.1:8644/webhook");
    assert.deepEqual(
      env.pollErrors,
      [],
      "404 (run not found) is not retryable — retrying it 3x and then claiming 'the run may still be running' is a false statement",
    );
    assert.equal(env.endpointTerminal.length, 1);
    assert.match(env.endpointTerminal[0], /404/);
    assert.doesNotMatch(env.endpointTerminal[0], /may still be running/i);
  });

  it("LIFECYCLE-1: a 401 from /runs/:id is terminal and names the status token", async () => {
    const env = loadStatus({
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, message: "Unauthorized" }),
      }),
    });
    await env.status.pollRunStatus("http://127.0.0.1:8644/webhook");
    assert.deepEqual(env.pollErrors, []);
    assert.equal(env.endpointTerminal.length, 1);
    assert.match(env.endpointTerminal[0], /status token/i);
    assert.doesNotMatch(env.endpointTerminal[0], /may still be running/i);
  });

  it("LIFECYCLE-1: a tracker without the terminal entry point still gets honest copy", async () => {
    const env = loadStatus({
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      }),
    });
    delete env.tracker.markStatusEndpointTerminal;
    await env.status.pollRunStatus("http://127.0.0.1:8644/webhook");
    assert.deepEqual(env.pollErrors, []);
    assert.equal(env.connectionLost.length, 1);
    assert.doesNotMatch(env.connectionLost[0], /may still be running/i);
  });
});

describe("LIFECYCLE-1 — the user-visible message stops claiming the run continues", () => {
  it("LIFECYCLE-1: a terminal status endpoint renders the honest reason, not 'may still be running'", () => {
    const env = loadStatus({
      trackerState: {
        runId: "run_abc12345",
        statusPath: "/runs/run_abc12345",
        status: "polling_error",
        pollErrorCount: 3,
        statusUnavailable: true,
        statusEndpointTerminal: true,
        errorMessage:
          "The worker has no record of this run (HTTP 404). Status updates have stopped — check Runs or your sheet for the outcome.",
      },
    });
    env.status.renderDiscoveryRunStatus();

    assert.equal(env.toasts.length, 1);
    const [toast] = env.toasts;
    assert.doesNotMatch(toast.message, /may still be running/i);
    assert.match(toast.message, /no record of this run/i);
    assert.equal(toast.sticky, true);
  });

  it("LIFECYCLE-1: an exhausted retryable failure keeps the existing 'may still be running' copy", () => {
    const env = loadStatus({
      trackerState: {
        runId: "run_abc12345",
        statusPath: "/runs/run_abc12345",
        status: "polling_error",
        pollErrorCount: 3,
        statusUnavailable: true,
        errorMessage: "Status endpoint returned HTTP 503",
      },
    });
    env.status.renderDiscoveryRunStatus();

    assert.equal(env.toasts.length, 1);
    assert.match(env.toasts[0].message, /may still be running/i);
  });
});

describe("LIFECYCLE-1 — the tracker records a terminal status endpoint", () => {
  it("LIFECYCLE-1: markStatusEndpointTerminal stops polling without claiming the run continues", () => {
    const tracker = loadRealTracker();
    tracker.beginTracking({
      runId: "run_abc12345",
      statusPath: "/runs/run_abc12345",
      webhookUrl: "http://127.0.0.1:8644/webhook",
    });
    tracker.markStatusEndpointTerminal(
      "The worker has no record of this run (HTTP 404).",
    );

    const state = tracker.getState();
    assert.equal(state.status, "polling_error");
    assert.equal(state.statusEndpointTerminal, true);
    assert.equal(state.statusUnavailable, true);
    assert.ok(
      state.pollErrorCount >= 3,
      "a terminal status endpoint must not leave retries on the table",
    );
    assert.doesNotMatch(state.errorMessage, /may still be running/i);
  });

  it("LIFECYCLE-1: an explicit retry clears the terminal marker", () => {
    const tracker = loadRealTracker();
    tracker.beginTracking({
      runId: "run_abc12345",
      statusPath: "/runs/run_abc12345",
    });
    tracker.markStatusEndpointTerminal("gone");
    tracker.resumeFromPollError();

    const state = tracker.getState();
    assert.equal(state.status, "running");
    assert.equal(state.statusEndpointTerminal, false);
  });

  it("LIFECYCLE-1: a successful poll clears the terminal marker", () => {
    const tracker = loadRealTracker();
    tracker.beginTracking({
      runId: "run_abc12345",
      statusPath: "/runs/run_abc12345",
    });
    tracker.markStatusEndpointTerminal("gone");
    tracker.updateFromStatusResponse({
      runId: "run_abc12345",
      status: "running",
      terminal: false,
    });

    assert.equal(tracker.getState().statusEndpointTerminal, false);
  });

  it("LIFECYCLE-1: beginTracking starts a fresh run without the marker", () => {
    const tracker = loadRealTracker();
    tracker.beginTracking({ runId: "run_1", statusPath: "/runs/run_1" });
    tracker.markStatusEndpointTerminal("gone");
    tracker.beginTracking({ runId: "run_2", statusPath: "/runs/run_2" });

    assert.equal(tracker.getState().statusEndpointTerminal, false);
  });
});
