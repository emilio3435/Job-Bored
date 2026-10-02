import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createControlledFetch,
  flush,
  loadDiscoveryTab,
  runStatusBody,
} from "./holes-disco-harness.mjs";

/* HOLES DISCO — the production poll loop (startDiscoveryStatusPolling), driven
   through the real tracker and a fake clock. D17: these replace the tests
   that called pollRunStatus/updateFromStatusResponse by hand and never ran
   the loop itself. */

function startRun(tab, runId, extra = {}) {
  tab.tracker.beginTracking({
    runId,
    statusPath: `/runs/${runId}`,
    pollAfterMs: 2000,
    webhookUrl: tab.webhookUrl,
    trigger: "manual",
    ...extra,
  });
  void tab.status.startDiscoveryStatusPolling(tab.webhookUrl);
}

function pollsFor(net, runId) {
  return net.calls.filter((c) => c.url.includes(`/runs/${runId}`));
}

describe("D1 · a poll error followed by a good poll", () => {
  it("returns the run to running and goes back to the normal cadence", async () => {
    const net = createControlledFetch();
    const tab = loadDiscoveryTab({ fetch: net.fetch });
    startRun(tab, "run_a");

    await tab.clock.advance(2000);
    net.fail(pollsFor(net, "run_a")[0]);
    await flush();
    assert.equal(tab.tracker.getState().status, "polling_error");

    await tab.clock.advance(1000);
    net.respond(pollsFor(net, "run_a")[1], 200, runStatusBody("run_a"));
    await flush();

    assert.equal(tab.tracker.getState().status, "running");
    assert.equal(tab.tracker.getState().pollErrorCount, 0);
    // Next poll waits pollAfterMs — not the 500 ms error back-off.
    assert.deepEqual(tab.clock.pending(), [2000]);
    const view = tab.runTracker.deriveLiveRunView(tab.tracker.getState(), tab.clock.now());
    assert.notEqual(view.health.key, "reconnecting");
  });

  it("does not hammer the worker every 500 ms after recovering", async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(String(url));
      if (urls.length === 1) throw new TypeError("Failed to fetch");
      return {
        ok: true,
        status: 200,
        json: async () => runStatusBody("run_a"),
      };
    };
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab, "run_a");
    await tab.clock.advance(2000); // poll 1 fails
    await tab.clock.advance(1000); // poll 2 (after the 1 s back-off) recovers
    assert.equal(urls.length, 2);

    // Ten healthy seconds at pollAfterMs=2000 is five polls, not twenty.
    await tab.clock.advance(10000);
    assert.equal(urls.length, 2 + 5);
  });
});

describe("D2 · a new run ends the old poll loop", () => {
  it("leaves exactly one loop polling after a run starts mid-poll", async () => {
    const urls = [];
    let holdFirst;
    const fetchImpl = (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        // Run A's first poll is still in flight when run B starts.
        return new Promise((resolve) => {
          holdFirst = () =>
            resolve({ ok: true, status: 200, json: async () => runStatusBody("run_a") });
        });
      }
      const runId = String(url).includes("run_b") ? "run_b" : "run_a";
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => runStatusBody(runId),
      });
    };
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab, "run_a");
    await tab.clock.advance(2000);
    assert.equal(urls.length, 1);

    startRun(tab, "run_b");
    holdFirst();
    await flush();

    await tab.clock.advance(10000);
    const runBPolls = urls.filter((u) => u.includes("/runs/run_b")).length;
    assert.equal(runBPolls, 5, `one loop at 2 s over 10 s, saw ${runBPolls}`);
    assert.equal(urls.filter((u) => u.includes("/runs/run_a")).length, 1);
  });

  it("never lets the old run's failed poll mark the new run", async () => {
    const net = createControlledFetch();
    const tab = loadDiscoveryTab({ fetch: net.fetch });
    startRun(tab, "run_a");
    await tab.clock.advance(2000);
    const stale = pollsFor(net, "run_a")[0];

    startRun(tab, "run_b");
    net.fail(stale, "Failed to fetch");
    await flush();

    const state = tab.tracker.getState();
    assert.equal(state.runId, "run_b");
    assert.equal(state.status, "pending");
    assert.equal(state.pollErrorCount, 0);
  });
});

describe("D4 · per-poll timeout", () => {
  it("aborts a status request that hangs and retries instead of stalling", async () => {
    const net = createControlledFetch();
    const tab = loadDiscoveryTab({ fetch: net.fetch });
    startRun(tab, "run_a");
    await tab.clock.advance(2000);
    const hung = pollsFor(net, "run_a")[0];
    assert.equal(hung.settled, false);

    await tab.clock.advance(tab.runTracker.DEFAULT_PER_POLL_TIMEOUT_MS);
    assert.equal(hung.aborted, true, "the hung request was aborted");
    const state = tab.tracker.getState();
    assert.equal(state.status, "polling_error");
    assert.match(state.errorMessage, /timed out/);

    // …and the loop carries on: the retry goes out after the back-off.
    await tab.clock.advance(1000);
    assert.equal(pollsFor(net, "run_a").length, 2);
  });
});

describe("D4 · overall deadline = maxRunDurationMs + grace (§0.4, §0.11)", () => {
  const HOUR = 60 * 60 * 1000;

  function autoFetch(bodyFor) {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => bodyFor(urls.length) };
    };
    return { urls, fetchImpl };
  }

  it("keeps watching a quiet run well past the old 15-minute cutoff", async () => {
    const { urls, fetchImpl } = autoFetch(() => runStatusBody("run_a"));
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab, "run_a", { pollAfterMs: 60000 });
    await tab.clock.advance(2 * HOUR);
    const before = urls.length;
    await tab.clock.advance(60000);
    assert.equal(urls.length, before + 1, "still polling two hours in");
    assert.equal(tab.tracker.getState().status, "running");
  });

  it("stops watching a silent run once maxRunDurationMs + grace has passed, and settles it", async () => {
    const { urls, fetchImpl } = autoFetch(() => runStatusBody("run_a"));
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab, "run_a", { pollAfterMs: 60000 });
    const limit =
      tab.runTracker.DEFAULT_MAX_RUN_DURATION_MS + tab.runTracker.RUN_DEADLINE_GRACE_MS;
    assert.equal(tab.runTracker.DEFAULT_MAX_RUN_DURATION_MS, 3 * HOUR);
    await tab.clock.advance(limit + 2 * 60000);
    const settledAt = urls.length;
    await tab.clock.advance(10 * 60000);
    assert.equal(urls.length, settledAt, "no polls after the deadline");
    const state = tab.tracker.getState();
    assert.equal(state.deadlineExceeded, true);
    assert.equal(tab.tracker.isActive(), false, "a settled run blocks nothing");
    assert.ok(
      tab.toasts.some((t) => /time limit/i.test(t.message)),
      "the user is told why watching stopped",
    );
  });

  it("never cuts off a run that is still reporting progress past the deadline", async () => {
    let seq = 0;
    const { urls, fetchImpl } = autoFetch(() => {
      seq += 1;
      return runStatusBody("run_a", {
        progress: { phase: "scout", sequence: seq, checkpointedAt: "2026-10-02T12:00:00.000Z" },
      });
    });
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab, "run_a", { pollAfterMs: 60000 });
    const limit =
      tab.runTracker.DEFAULT_MAX_RUN_DURATION_MS + tab.runTracker.RUN_DEADLINE_GRACE_MS;
    await tab.clock.advance(limit + 10 * 60000);
    const before = urls.length;
    await tab.clock.advance(60000);
    assert.equal(urls.length, before + 1, "fresh progress keeps the browser watching");
    assert.equal(tab.tracker.isActive(), true);
  });
});

describe("§0.4 · a slow status GET is not a lost connection (Grok DISCO review)", () => {
  const HOUR = 60 * 60 * 1000;

  it("keeps watching through repeated 8 s timeouts while the worker may still run", async () => {
    const net = createControlledFetch();
    const tab = loadDiscoveryTab({ fetch: net.fetch });
    startRun(tab, "run_a");
    // Five slow polls in a row — more than MAX_POLL_ERRORS (3).
    await tab.clock.advance(2000);
    for (let i = 0; i < 5; i += 1) {
      await tab.clock.advance(tab.runTracker.DEFAULT_PER_POLL_TIMEOUT_MS + 4000);
    }
    assert.ok(pollsFor(net, "run_a").length >= 6, "the loop is still polling");
    assert.equal(tab.tracker.isSettled(), false, "a slow worker is not a lost one");
    assert.equal(tab.tracker.isActive(), true);
    assert.ok(
      !tab.toasts.some((t) => /Lost the status connection/i.test(t.message)),
      "no lost-connection message for slow answers",
    );

    // …and the first answer after them returns the run to running.
    const last = pollsFor(net, "run_a").at(-1);
    net.respond(last, 200, runStatusBody("run_a"));
    await flush();
    assert.equal(tab.tracker.getState().status, "running");
  });

  it("settles a run whose status only ever times out once maxRunDurationMs + grace passes", async () => {
    const net = createControlledFetch();
    const tab = loadDiscoveryTab({ fetch: net.fetch });
    startRun(tab, "run_a", { pollAfterMs: 60000 });
    const limit =
      tab.runTracker.DEFAULT_MAX_RUN_DURATION_MS + tab.runTracker.RUN_DEADLINE_GRACE_MS;
    await tab.clock.advance(HOUR);
    assert.equal(tab.tracker.isActive(), true, "still watching an hour in");
    await tab.clock.advance(limit - HOUR + 2 * 60000);
    const settledAt = pollsFor(net, "run_a").length;
    await tab.clock.advance(10 * 60000);
    assert.equal(pollsFor(net, "run_a").length, settledAt, "no polls after the deadline");
    assert.equal(tab.tracker.getState().deadlineExceeded, true);
    assert.equal(tab.tracker.isActive(), false);
  });

  it("still gives up after MAX_POLL_ERRORS real errors (network failures)", async () => {
    const net = createControlledFetch();
    const tab = loadDiscoveryTab({ fetch: net.fetch });
    startRun(tab, "run_a");
    await tab.clock.advance(2000);
    for (let i = 0; i < 3; i += 1) {
      net.fail(pollsFor(net, "run_a").at(-1));
      await flush();
      await tab.clock.advance(4000);
    }
    assert.equal(tab.tracker.isSettled(), true);
  });
});

describe("§2 · wake() during an in-flight poll (Grok DISCO review)", () => {
  it("polls right after the in-flight request when the tab was shown during it", async () => {
    const net = createControlledFetch();
    const tab = loadDiscoveryTab({ fetch: net.fetch });
    startRun(tab, "run_a");
    await tab.clock.advance(2000);
    assert.equal(pollsFor(net, "run_a").length, 1);
    tab.document.setVisibility("hidden");
    await flush();
    tab.document.setVisibility("visible"); // wake() lands while poll 1 is in flight
    await flush();
    net.respond(pollsFor(net, "run_a")[0], 200, runStatusBody("run_a"));
    await flush();
    assert.equal(pollsFor(net, "run_a").length, 2, "polled at once, not a pollAfterMs later");
  });

  it("does not poll early when nothing woke it during the request", async () => {
    const net = createControlledFetch();
    const tab = loadDiscoveryTab({ fetch: net.fetch });
    startRun(tab, "run_a");
    await tab.clock.advance(2000);
    net.respond(pollsFor(net, "run_a")[0], 200, runStatusBody("run_a"));
    await flush();
    assert.equal(pollsFor(net, "run_a").length, 1);
    assert.deepEqual(tab.clock.pending(), [2000]);
  });
});
