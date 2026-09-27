/* RUNHIST FE — the Runs list is a durable history: worker GET /runs merged
 * with the Sheet's DiscoveryRuns rows, joined by Run ID, newest first,
 * deduplicated, paged, and still useful when the worker is down. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  jsonResponse,
  listPage1,
  listPage2,
  loadRunsLog,
  sheetValues,
  detailRunA,
} from "./runhist-fe-fixtures.mjs";

function sheetResult() {
  const log = loadRunsLog();
  const values = sheetValues();
  return log.parseDiscoveryRunsValues(values.slice(1), { headers: values[0] });
}

describe("runhist-fe · Sheet read carries Run ID", () => {
  it("reads DiscoveryRuns!A1:K and maps the Run ID column by header", async () => {
    const log = loadRunsLog();
    let seenUrl = "";
    const result = await log.fetchDiscoveryRuns("sheet-abc", "tok", {
      fetchImpl: async (url) => {
        seenUrl = String(url);
        return jsonResponse(200, { values: sheetValues() });
      },
    });
    assert.match(seenUrl, /DiscoveryRuns!A1%3AK/);
    assert.equal(result.ok, true);
    assert.equal(result.runs.length, 3, "the header row is not a run");
    const byVar = Object.fromEntries(result.runs.map((r) => [r.variationKey, r]));
    assert.equal(byVar["v-a"].runId, "run_a");
    assert.equal(byVar["v-c"].runId, "run_c");
    assert.equal(byVar["v-old"].runId, "", "pre-Run-ID rows stay blank");
  });

  it("still parses header-less positional rows, including an 11th Run ID cell", () => {
    const log = loadRunsLog();
    const rows = log.parseDiscoveryRunsValues([
      ["2026-09-27T05:08:32.000Z", "manual", "success", 512, 3, 8, 3, "worker", "v-a", "", "run_a"],
      ["2026-09-20T14:00:00.000Z", "manual", "success", 30, 5, 1, "worker", "var-1", ""],
    ]);
    assert.equal(rows[0].runId, "run_a");
    assert.equal(rows[1].runId, "");
    assert.equal(rows[1].source, "worker");
  });
});

describe("runhist-fe · mergeRunHistory joins by Run ID", () => {
  it("merges worker summaries with Sheet rows, newest first, worker winning on counts", () => {
    const log = loadRunsLog();
    const merged = log.mergeRunHistory(sheetResult(), listPage1().runs);
    assert.deepEqual(
      merged.map((r) => r.runId || r.variationKey),
      ["run_d", "run_a", "run_c", "v-old"],
    );
    const a = merged[1];
    assert.equal(a.origin, "both");
    assert.equal(a.leadsWritten, 9, "worker headline beats the Sheet's 8");
    assert.equal(a.leadsUpdated, 3);
    assert.equal(a.statusPath, "/runs/run_a");
    assert.equal(a.variationKey, "v-a", "Sheet fills fields the worker list lacks");
    assert.equal(a.status, "success");
  });

  it("lists worker-only and Sheet-only rows with their coarse fields", () => {
    const log = loadRunsLog();
    const merged = log.mergeRunHistory(sheetResult(), listPage1().runs);
    const d = merged.find((r) => r.runId === "run_d");
    assert.equal(d.origin, "worker");
    assert.equal(d.status, "failure", "worker 'failed' maps to the Sheet's vocabulary");
    assert.equal(d.trigger, "scheduled-local");
    assert.equal(d.durationS, 40);
    assert.equal(d.leadsWrittenAvailability, "unavailable", "empty headline is not 0");
    const c = merged.find((r) => r.runId === "run_c");
    assert.equal(c.origin, "sheet");
    assert.equal(c.statusPath, "");
    assert.equal(c.error, "One source timed out");
  });

  it("deduplicates repeated worker runs and identical Sheet rows", () => {
    const log = loadRunsLog();
    const sheet = sheetResult();
    const dupSheet = sheet.concat([{ ...sheet[1] }]);
    const workers = listPage1().runs.concat([listPage1().runs[1]]);
    const merged = log.mergeRunHistory(dupSheet, workers);
    assert.equal(merged.length, 4);
    assert.equal(merged.filter((r) => r.runId === "run_a").length, 1);
    assert.equal(merged.filter((r) => r.variationKey === "v-old").length, 1);
  });

  it("maps every terminal worker status onto the Sheet vocabulary", () => {
    const log = loadRunsLog();
    const s = (status) => log.mergeRunHistory([], [{ runId: "x", status, trigger: "manual", completedAt: "2026-09-27T00:00:00Z", statusPath: "/runs/x", headline: {} }])[0].status;
    assert.equal(s("completed"), "success");
    assert.equal(s("empty"), "success");
    assert.equal(s("partial"), "partial");
    assert.equal(s("failed"), "failure");
    assert.equal(s("running"), "in_progress");
  });
});

describe("runhist-fe · createRunHistory loads, pages and degrades", () => {
  function sources(overrides = {}) {
    const calls = { sheet: 0, worker: [], detail: [] };
    const api = {
      loadSheet: async () => {
        calls.sheet += 1;
        return { ok: true, runs: sheetResult() };
      },
      loadWorkerPage: async (opts) => {
        calls.worker.push(opts);
        return opts && opts.before === "cursor_1" ? listPage2() : listPage1();
      },
      loadWorkerDetail: async (statusPath) => {
        calls.detail.push(statusPath);
        return { ok: true, detail: detailRunA() };
      },
      ...overrides,
    };
    return { api, calls };
  }

  it("fetches the worker and the Sheet in parallel and merges them", async () => {
    const log = loadRunsLog();
    let workerStartedBeforeSheetResolved = false;
    let sheetResolved = false;
    const { api } = sources({
      loadSheet: async () => {
        await new Promise((r) => setTimeout(r, 5));
        sheetResolved = true;
        return { ok: true, runs: sheetResult() };
      },
      loadWorkerPage: async () => {
        workerStartedBeforeSheetResolved = !sheetResolved;
        return listPage1();
      },
    });
    const history = log.createRunHistory(api);
    const view = await history.load();
    assert.equal(workerStartedBeforeSheetResolved, true);
    assert.equal(view.worker, "ok");
    assert.equal(view.runs.length, 4);
    assert.equal(view.hasMore, true, "nextBefore means more history");
  });

  it("show more fetches the next worker page with the opaque cursor", async () => {
    const log = loadRunsLog();
    const { api, calls } = sources();
    const history = log.createRunHistory(api);
    await history.load();
    const view = await history.loadMore();
    assert.equal(calls.worker[1].before, "cursor_1");
    assert.equal(view.runs.at(-1).runId, "run_e");
    assert.equal(view.hasMore, false);
  });

  it("show more reveals the next display page before asking the worker", async () => {
    const log = loadRunsLog();
    const many = Array.from({ length: 30 }, (_, i) => ({
      runAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
      trigger: "manual",
      status: "success",
      runId: "",
      variationKey: "v" + i,
    }));
    const { api, calls } = sources({
      loadSheet: async () => ({ ok: true, runs: many }),
      loadWorkerPage: async (opts) => {
        calls.worker.push(opts);
        return { ok: true, runs: [], nextBefore: null };
      },
    });
    const history = log.createRunHistory({ ...api, pageSize: 25 });
    const first = await history.load();
    assert.equal(first.runs.length, 25);
    assert.equal(first.total, 30);
    assert.equal(first.hasMore, true);
    const second = await history.loadMore();
    assert.equal(second.runs.length, 30);
    assert.equal(second.hasMore, false);
    assert.equal(calls.worker.length, 1, "no cursor, no second worker call");
  });

  it("worker unreachable: the Sheet history still lists, with a quiet note", async () => {
    const log = loadRunsLog();
    const { api } = sources({
      loadWorkerPage: async () => ({ ok: false, reason: "unreachable" }),
    });
    const view = await log.createRunHistory(api).load();
    assert.equal(view.worker, "unavailable");
    assert.equal(view.runs.length, 3);
    assert.ok(view.runs.every((r) => r.origin === "sheet"));
    assert.match(view.note, /Sheet/);
    assert.doesNotMatch(view.note, /error|failed/i);
  });

  it("Sheet unreadable but worker up: the worker history still lists", async () => {
    const log = loadRunsLog();
    const { api } = sources({
      loadSheet: async () => ({ ok: false, reason: "unauthorized" }),
    });
    const view = await log.createRunHistory(api).load();
    assert.equal(view.runs.length, 2);
    assert.equal(view.sheet, "unavailable");
  });

  it("both down: reports failure with the Sheet's reason", async () => {
    const log = loadRunsLog();
    const { api } = sources({
      loadSheet: async () => ({ ok: false, reason: "unauthorized" }),
      loadWorkerPage: async () => ({ ok: false, reason: "unreachable" }),
    });
    const view = await log.createRunHistory(api).load();
    assert.equal(view.ok, false);
    assert.equal(view.reason, "unauthorized");
  });

  it("detail loads lazily, once per run, and never for Sheet-only rows", async () => {
    const log = loadRunsLog();
    const { api, calls } = sources();
    const history = log.createRunHistory(api);
    const view = await history.load();
    assert.equal(calls.detail.length, 0, "nothing fetched until a run is opened");
    const a = view.runs.find((r) => r.runId === "run_a");
    const first = await history.detail(a);
    const again = await history.detail(a);
    assert.equal(calls.detail.length, 1);
    assert.deepEqual(calls.detail, ["/runs/run_a"]);
    assert.equal(first.ok, true);
    assert.equal(again.detail.runStats.funnel.written, 9);
    const c = view.runs.find((r) => r.runId === "run_c");
    const sheetOnly = await history.detail(c);
    assert.equal(sheetOnly.ok, false);
    assert.equal(calls.detail.length, 1);
  });

  it("a failed detail load is not cached, so Retry fetches again", async () => {
    const log = loadRunsLog();
    let n = 0;
    const { api } = sources({
      loadWorkerDetail: async () => {
        n += 1;
        return n === 1 ? { ok: false, reason: "unreachable" } : { ok: true, detail: detailRunA() };
      },
    });
    const history = log.createRunHistory(api);
    const view = await history.load();
    const a = view.runs.find((r) => r.runId === "run_a");
    assert.equal((await history.detail(a)).ok, false);
    assert.equal((await history.detail(a)).ok, true);
    assert.equal(n, 2);
  });
});
