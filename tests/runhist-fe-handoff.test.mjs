/* RUNHIST FE — the worker side of the history: GET /runs and GET /runs/:id
 * through discovery-status-handoff.js, and the per-source rejection read
 * that replaces the dead writeResult.rejectionSummary read. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { detailRunA, jsonResponse, listPage1, read } from "./runhist-fe-fixtures.mjs";

function loadHandoff({ webhookUrl = "http://127.0.0.1:18644/webhook", secret = "", fetchImpl, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  const toasts = [];
  const window = {
    JobBoredDiscovery: {
      runTracker: {
        discoveryRunTracker: { getState: () => ({ runId: "run_a" }) },
      },
      status: {},
    },
  };
  window.JobBoredDiscovery.status.host = {
    getDiscoveryWebhookUrl: () => webhookUrl,
    normalizeDiscoveryWebhookIdentity: (u) => String(u || "").trim(),
    isLocalDashboardOrigin: () => false,
    isLocalWebhookCandidateUrl: () => true,
    getConfigCore: () => ({ getDiscoveryWebhookSecret: () => secret }),
    showToast: (message, tone) => toasts.push({ message, tone }),
  };
  const ctx = {
    window,
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null },
    console: { ...console, info() {} },
    URL,
    URLSearchParams,
    AbortController,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    fetch: fetchImpl || (async () => { throw new Error("fetch not stubbed"); }),
  };
  vm.runInNewContext(read("discovery-status-handoff.js"), ctx, {
    filename: "discovery-status-handoff.js",
  });
  return { status: window.JobBoredDiscovery.status, toasts };
}

describe("runhist-fe · fetchRunHistoryPage", () => {
  it("GETs /runs on the worker origin with limit and cursor", async () => {
    const seen = [];
    const { status } = loadHandoff({
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init });
        return jsonResponse(200, listPage1());
      },
    });
    const page = await status.fetchRunHistoryPage({ limit: 25, before: "cursor_0" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "http://127.0.0.1:18644/runs?limit=25&before=cursor_0");
    assert.equal(seen[0].init.method, "GET");
    assert.equal(page.ok, true);
    assert.equal(page.runs.length, 2);
    assert.equal(page.nextBefore, "cursor_1");
  });

  it("sends the webhook secret header only when one is configured", async () => {
    const heads = [];
    const fetchImpl = async (url, init) => {
      heads.push(init.headers);
      return jsonResponse(200, listPage1());
    };
    await loadHandoff({ fetchImpl }).status.fetchRunHistoryPage({});
    await loadHandoff({ fetchImpl, secret: "example-secret" }).status.fetchRunHistoryPage({});
    assert.equal("x-discovery-secret" in heads[0], false);
    assert.equal(heads[1]["x-discovery-secret"], "example-secret");
  });

  it("no worker configured: no request, reason no_worker", async () => {
    let called = false;
    const { status } = loadHandoff({
      webhookUrl: "",
      fetchImpl: async () => { called = true; return jsonResponse(200, listPage1()); },
    });
    const page = await status.fetchRunHistoryPage({});
    assert.equal(called, false);
    assert.deepEqual({ ok: page.ok, reason: page.reason }, { ok: false, reason: "no_worker" });
  });

  it("classifies failures: 401, 404 (older worker), network, timeout, bad body", async () => {
    const cases = [
      [async () => jsonResponse(401, { ok: false }), "unauthorized"],
      [async () => jsonResponse(404, { ok: false }), "no_history_endpoint"],
      [async () => { throw new TypeError("Failed to fetch"); }, "unreachable"],
      [async () => jsonResponse(200, { ok: true, runs: "nope" }), "invalid"],
    ];
    for (const [fetchImpl, reason] of cases) {
      const page = await loadHandoff({ fetchImpl }).status.fetchRunHistoryPage({});
      assert.equal(page.ok, false);
      assert.equal(page.reason, reason);
    }
    const hang = (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const page = await loadHandoff({ fetchImpl: hang }).status.fetchRunHistoryPage({ timeoutMs: 20 });
    assert.equal(page.reason, "timeout");
  });
});

describe("runhist-fe · fetchRunDetail", () => {
  it("resolves the summary's statusPath against the worker and returns the payload", async () => {
    let seenUrl = "";
    const { status } = loadHandoff({
      fetchImpl: async (url) => {
        seenUrl = String(url);
        return jsonResponse(200, detailRunA());
      },
    });
    const res = await status.fetchRunDetail("/runs/run_a?statusToken=tok");
    assert.equal(seenUrl, "http://127.0.0.1:18644/runs/run_a?statusToken=tok");
    assert.equal(res.ok, true);
    assert.equal(res.detail.runStats.fit.avg, 6.8);
  });

  it("a pruned run is run_not_found", async () => {
    const { status } = loadHandoff({ fetchImpl: async () => jsonResponse(404, { ok: false, code: "run_not_found" }) });
    const res = await status.fetchRunDetail("/runs/run_zz");
    assert.equal(res.ok, false);
    assert.equal(res.reason, "run_not_found");
  });
});

describe("runhist-fe · retry write", () => {
  it("POSTs with the fresh dashboard token and webhook secret", async () => {
    const seen = [];
    const { status } = loadHandoff({
      secret: "example-secret",
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init });
        return jsonResponse(200, { ok: true, run: { runId: "run_a", status: "completed" } });
      },
    });
    const result = await status.retryRunWrite("run_a", "fresh-token");
    assert.equal(result.ok, true);
    assert.equal(seen[0].url, "http://127.0.0.1:18644/runs/run_a/retry-write");
    assert.equal(seen[0].init.method, "POST");
    assert.equal(seen[0].init.headers["x-discovery-secret"], "example-secret");
    assert.deepEqual(JSON.parse(seen[0].init.body), { googleAccessToken: "fresh-token" });
  });

  it("uses a write-sized timeout and re-reads status after an aborted POST", async () => {
    const timers = [];
    const seen = [];
    const { status } = loadHandoff({
      secret: "example-secret",
      setTimeoutImpl: (callback, delay) => {
        timers.push({ callback, delay });
        return timers.length;
      },
      clearTimeoutImpl: () => {},
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init });
        if (init.method === "POST") {
          return new Promise((_, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")));
            timers[0].callback();
          });
        }
        return jsonResponse(200, { ok: true, runId: "run_a", terminal: true, status: "completed" });
      },
    });
    const result = await status.retryRunWrite("run_a", "fresh-token");
    assert.ok(timers[0].delay >= 120_000, "write retry needs more than the 4 s history budget");
    assert.equal(timers[1].delay, 4000, "status re-read keeps the history budget");
    assert.deepEqual(seen.map((call) => call.init.method), ["POST", "GET"]);
    assert.equal(seen[1].url, "http://127.0.0.1:18644/runs/run_a");
    assert.equal(seen[1].init.headers["x-discovery-secret"], "example-secret");
    assert.equal(result.ok, true);
    assert.equal(result.run.status, "completed");
  });

  it("does not report a failed write when status is still unresolved after abort", async () => {
    const timers = [];
    const { status } = loadHandoff({
      setTimeoutImpl: (callback) => { timers.push(callback); return timers.length; },
      clearTimeoutImpl: () => {},
      fetchImpl: async (_url, init) => {
        if (init.method === "GET") {
          return jsonResponse(200, { ok: true, runId: "run_a", status: "write_failed" });
        }
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          timers[0]();
        });
      },
    });
    const result = await status.retryRunWrite("run_a", "fresh-token");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "status_unknown");
  });
});

describe("runhist-fe · rejection read uses the worker's per-source summaries", () => {
  it("sums sources[].rejectionSummary.rejectionReasons", () => {
    const { status } = loadHandoff();
    const counts = status.collectRunRejectionCounts(detailRunA());
    assert.equal(counts.skip_title_match, 210);
    assert.equal(counts.location_outside_acceptable, 120);
    assert.equal(counts.headline_mismatch, 140);
  });

  it("surfaces the Fit Profile filter toast from a real worker payload", () => {
    const { status, toasts } = loadHandoff();
    status.surfacePreFilterRejectionsFromStatus(detailRunA());
    assert.equal(toasts.length, 1);
    assert.match(toasts[0].message, /^330 listings filtered by your Fit Profile: /);
    assert.match(toasts[0].message, /210 by skip-title/);
    assert.match(toasts[0].message, /120 by location/);
  });

  it("no longer reads writeResult.rejectionSummary, which the worker never sends", () => {
    const { status, toasts } = loadHandoff();
    status.surfacePreFilterRejectionsFromStatus({
      writeResult: { appended: 1, rejectionSummary: { skip_title_match: 4 } },
      sources: [],
    });
    assert.equal(toasts.length, 0);
    assert.doesNotMatch(read("discovery-status-handoff.js"), /writeResult\.rejectionSummary/);
  });
});
