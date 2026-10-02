import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { jsonResponse, loadDiscoveryTab, runStatusBody } from "./holes-disco-harness.mjs";

/* HOLES DISCO §0.11 (D4): a run is no longer cut at 50 min to fit the
   dashboard's Google sign-in. A run that outlives it ends write_failed with
   its leads kept, and the tab that watched it refreshes the sign-in and
   retries the write once, so a long run still lands on the board. */

const EXPIRED_WRITE =
  "The Google sign-in from the dashboard expired during the run; reopen the dashboard and press Retry write.";

function writeFailedBody(runId, writeError = EXPIRED_WRITE) {
  return runStatusBody(runId, {
    status: "write_failed",
    terminal: true,
    message: `Discovery found leads, but couldn't write them to Google Sheets. ${writeError} Retry this run's write after fixing the connection.`,
    error: `Sheet write failed during write phase: ${writeError}`,
  });
}

function workerDouble(runId, { statusBody, retryStatus = 200 }) {
  const retries = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    if (href.endsWith(`/runs/${runId}/retry-write`)) {
      retries.push(JSON.parse(String(init.body || "{}")));
      if (retryStatus !== 200) return jsonResponse(retryStatus, { ok: false });
      return jsonResponse(200, {
        ok: true,
        runId,
        run: runStatusBody(runId, {
          status: "completed",
          terminal: true,
          message: "Discovery write retried successfully.",
          writeResult: { appended: 4, updated: 0 },
        }),
      });
    }
    if (href.includes(`/runs/${runId}`)) return jsonResponse(200, statusBody);
    return jsonResponse(404, {});
  };
  return { fetchImpl, retries };
}

function watchRun(tab, runId) {
  tab.tracker.beginTracking({
    runId,
    statusPath: `/runs/${runId}`,
    pollAfterMs: 2000,
    webhookUrl: tab.webhookUrl,
    trigger: "manual",
  });
  void tab.status.startDiscoveryStatusPolling(tab.webhookUrl);
}

function withSignIn(tab, token) {
  const asks = [];
  tab.discovery.readiness = {
    getFreshDiscoveryRequestGoogleAccessToken: async (options) => {
      asks.push(options);
      return token;
    },
  };
  return asks;
}

describe("§0.11 · a run that outlived the dashboard's Google sign-in", () => {
  it("refreshes the sign-in, retries the write once and lands the leads", async () => {
    const worker = workerDouble("run_a", { statusBody: writeFailedBody("run_a") });
    const tab = loadDiscoveryTab({ fetch: worker.fetchImpl });
    const asks = withSignIn(tab, "fresh-token");
    watchRun(tab, "run_a");

    await tab.clock.advance(2000);

    assert.equal(asks.length, 1);
    assert.equal(asks[0].force, true, "a forced, silent refresh");
    assert.deepEqual(worker.retries, [{ googleAccessToken: "fresh-token" }]);
    const state = tab.tracker.getState();
    assert.equal(state.status, "completed");
    assert.equal(state.leadsWritten, 4);
    assert.equal(tab.loads.length, 1, "the board reloads with the written leads");
    assert.ok(
      !tab.toasts.some((t) => /couldn't write/i.test(t.message)),
      "no write-failure toast for a write that landed",
    );
    // §0.7: the token only travels in the retry request.
    for (const value of tab.storage.map.values()) {
      assert.ok(!String(value).includes("fresh-token"), "token never stored");
    }

    await tab.clock.advance(10000);
    assert.equal(worker.retries.length, 1, "retried once");
  });

  it("leaves the run write_failed for Retry write when the sign-in can't refresh", async () => {
    const worker = workerDouble("run_a", { statusBody: writeFailedBody("run_a") });
    const tab = loadDiscoveryTab({ fetch: worker.fetchImpl });
    withSignIn(tab, "");
    watchRun(tab, "run_a");

    await tab.clock.advance(2000);

    assert.equal(worker.retries.length, 0);
    assert.equal(tab.tracker.getState().status, "write_failed");
  });

  it("keeps the run write_failed and asks no more when the retry fails", async () => {
    const worker = workerDouble("run_a", {
      statusBody: writeFailedBody("run_a"),
      retryStatus: 500,
    });
    const tab = loadDiscoveryTab({ fetch: worker.fetchImpl });
    withSignIn(tab, "fresh-token");
    watchRun(tab, "run_a");

    await tab.clock.advance(12000);

    assert.equal(worker.retries.length, 1);
    assert.equal(tab.tracker.getState().status, "write_failed");
  });

  it("does not touch the sign-in for a write that failed for another reason", async () => {
    const worker = workerDouble("run_a", {
      statusBody: writeFailedBody("run_a", "HTTP 403: The caller does not have permission."),
    });
    const tab = loadDiscoveryTab({ fetch: worker.fetchImpl });
    const asks = withSignIn(tab, "fresh-token");
    watchRun(tab, "run_a");

    await tab.clock.advance(2000);

    assert.equal(asks.length, 0);
    assert.equal(worker.retries.length, 0);
    assert.equal(tab.tracker.getState().status, "write_failed");
  });
});
