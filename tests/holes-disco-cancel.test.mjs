import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { flush, jsonResponse, loadDiscoveryTab, runStatusBody } from "./holes-disco-harness.mjs";

/* HOLES DISCO D7 — the worker's POST /runs/:id/cancel, reachable from the
   dashboard. The UI halves (live card, Runs row) have their own tests. */

const CANCELLED = runStatusBody("run_c", {
  status: "failed",
  terminal: true,
  error: "Cancelled by user.",
  message: "Discovery run cancelled by user.",
  completedAt: "2026-10-02T12:01:00.000Z",
});

function workerFetch(cancelAnswer) {
  const calls = [];
  const fetchImpl = (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/runs/run_c/cancel")) return cancelAnswer(init);
    return Promise.resolve(jsonResponse(200, runStatusBody("run_c")));
  };
  return { calls, fetchImpl };
}

function startRun(tab) {
  tab.tracker.beginTracking({
    runId: "run_c",
    statusPath: "/runs/run_c",
    pollAfterMs: 2000,
    webhookUrl: tab.webhookUrl,
  });
  void tab.status.startDiscoveryStatusPolling(tab.webhookUrl);
}

describe("D7 · cancelling a run", () => {
  it("POSTs the cancel with the webhook secret and settles the run as cancelled", async () => {
    const { calls, fetchImpl } = workerFetch(async () =>
      jsonResponse(200, { ok: true, runId: "run_c", cancelled: true, stopConfirmed: true, run: CANCELLED }),
    );
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab);
    await tab.clock.advance(2000);
    tab.toasts.length = 0;

    const result = await tab.status.cancelDiscoveryRun("run_c");
    assert.equal(result.ok, true);
    const post = calls.find((c) => c.url.endsWith("/runs/run_c/cancel"));
    assert.equal(post.init.method, "POST");
    assert.equal(post.init.headers["x-discovery-secret"], "test-secret");

    const state = tab.tracker.getState();
    assert.equal(state.status, "failed");
    assert.equal(state.errorMessage, "Cancelled by user.");
    assert.deepEqual(
      tab.toasts.map((t) => t.message),
      ["Discovery run cancelled."],
    );

    // The poll loop is done with this run.
    const polls = calls.length;
    await tab.clock.advance(10000);
    assert.equal(calls.length, polls);
  });

  it("waits out the worker's 15 s settle window instead of giving up at 4 s", async () => {
    let release;
    const { calls, fetchImpl } = workerFetch(
      (init) =>
        new Promise((resolve, reject) => {
          release = () =>
            resolve(
              jsonResponse(200, { ok: true, runId: "run_c", cancelled: true, stopConfirmed: true, run: CANCELLED }),
            );
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab);
    const pending = tab.status.cancelDiscoveryRun("run_c");
    await flush();
    await tab.clock.advance(16000);
    release();
    const result = await pending;
    assert.equal(result.ok, true, `cancel gave up early: ${JSON.stringify(result)}`);
    assert.ok(calls.some((c) => c.url.endsWith("/cancel")));
  });

  it("takes the real outcome when the run had already finished", async () => {
    const done = runStatusBody("run_c", {
      status: "completed",
      terminal: true,
      writeResult: { appended: 2, updated: 0 },
    });
    const { fetchImpl } = workerFetch(async () =>
      jsonResponse(409, { ok: false, code: "run_already_terminal", run: done }),
    );
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab);
    const result = await tab.status.cancelDiscoveryRun("run_c");
    assert.equal(result.ok, true);
    assert.equal(tab.tracker.getState().status, "completed");
    assert.equal(tab.tracker.getState().leadsWritten, 2);
  });

  it("says so, and keeps watching, when the worker can't cancel this run", async () => {
    const { calls, fetchImpl } = workerFetch(async () =>
      jsonResponse(409, { ok: false, code: "run_not_cancellable", message: "not running here" }),
    );
    const tab = loadDiscoveryTab({ fetch: fetchImpl });
    startRun(tab);
    const result = await tab.status.cancelDiscoveryRun("run_c");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_cancellable");
    assert.ok(tab.toasts.some((t) => /can't be cancelled/i.test(t.message)));
    assert.equal(tab.tracker.getState().status, "pending");
    const before = calls.length;
    await tab.clock.advance(2000);
    assert.equal(calls.length, before + 1, "still polling the run");
  });
});
