import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadRunsTab() {
  const source = await readFile(join(repoRoot, "runs-tab.js"), "utf8");
  const document = {
    readyState: "loading",
    addEventListener() {},
    getElementById() {
      return null;
    },
    createElement() {
      return { style: {}, setAttribute() {}, appendChild() {} };
    },
  };
  const window = {};
  const context = {
    window,
    document,
    navigator: { userAgent: "test" },
    console,
    URL,
    setInterval,
    clearInterval,
    fetch: async () => {
      throw new Error("fetch not stubbed");
    },
  };
  vm.runInNewContext(source, context, { filename: "runs-tab.js" });
  return window.JobBoredRunsLog;
}

function asPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("parseDiscoveryRunsValues", () => {
  it("maps sheet rows into typed run objects in input order", async () => {
    const mod = await loadRunsTab();
    const rows = [
      [
        "2026-04-21T15:12:03Z",
        "manual",
        "success",
        47,
        12,
        3,
        "worker@v0.4.1",
        "gh-1234-abcd",
        "",
      ],
      [
        "2026-04-21T16:00:00Z",
        "scheduled-github",
        "failure",
        5,
        1,
        0,
        "worker@v0.4.1",
        "gh-5678",
        "timeout on acme.com",
      ],
    ];
    const runs = mod.parseDiscoveryRunsValues(rows);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].trigger, "manual");
    assert.equal(runs[0].durationS, 47);
    assert.equal(runs[0].companiesSeen, 12);
    assert.equal(runs[0].leadsWritten, 3);
    assert.equal(runs[1].status, "failure");
    assert.equal(runs[1].error, "timeout on acme.com");
  });

  it("skips rows missing Run At / Trigger / Status", async () => {
    const mod = await loadRunsTab();
    const rows = [
      ["", "manual", "success", 1, 1, 1, "w", "v", ""],
      ["2026-04-21T10:00:00Z", "", "success", 1, 1, 1, "w", "v", ""],
      ["2026-04-21T10:00:00Z", "manual", "success", 1, 1, 1, "w", "v", ""],
    ];
    const runs = mod.parseDiscoveryRunsValues(rows);
    assert.equal(runs.length, 1);
  });

  it("returns [] for non-array input", async () => {
    const mod = await loadRunsTab();
    assert.deepEqual(asPlain(mod.parseDiscoveryRunsValues(null)), []);
    assert.deepEqual(asPlain(mod.parseDiscoveryRunsValues({})), []);
  });
});

describe("sortRuns", () => {
  it("sorts descending by runAt when direction='desc'", async () => {
    const mod = await loadRunsTab();
    const runs = [
      { runAt: "2026-04-21T10:00:00Z", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, source: "", variationKey: "", error: "" },
      { runAt: "2026-04-21T16:00:00Z", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, source: "", variationKey: "", error: "" },
      { runAt: "2026-04-21T12:00:00Z", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, source: "", variationKey: "", error: "" },
    ];
    const sorted = mod.sortRuns(runs, "runAt", "desc");
    assert.equal(sorted[0].runAt, "2026-04-21T16:00:00Z");
    assert.equal(sorted[2].runAt, "2026-04-21T10:00:00Z");
  });

  it("sorts numerically on leadsWritten", async () => {
    const mod = await loadRunsTab();
    const runs = [
      { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 2, source: "", variationKey: "", error: "" },
      { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 10, source: "", variationKey: "", error: "" },
      { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, source: "", variationKey: "", error: "" },
    ];
    const sorted = mod.sortRuns(runs, "leadsWritten", "asc");
    assert.deepEqual(sorted.map((r) => r.leadsWritten), [0, 2, 10]);
  });
});

describe("filterRuns", () => {
  const sample = [
    { runAt: "t", trigger: "manual", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, source: "", variationKey: "", error: "" },
    { runAt: "t", trigger: "scheduled-local", status: "failure", durationS: 1, companiesSeen: 0, leadsWritten: 0, source: "", variationKey: "", error: "x" },
    { runAt: "t", trigger: "scheduled-github", status: "success", durationS: 1, companiesSeen: 0, leadsWritten: 0, source: "", variationKey: "", error: "" },
    { runAt: "t", trigger: "cli", status: "partial", durationS: 1, companiesSeen: 0, leadsWritten: 0, source: "", variationKey: "", error: "" },
  ];

  it("all/all returns every row", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "all", status: "all" });
    assert.equal(result.length, 4);
  });

  it("trigger='scheduled' matches both scheduled-local and scheduled-github", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "scheduled", status: "all" });
    const triggers = result.map((r) => r.trigger).sort();
    assert.deepEqual(triggers, ["scheduled-github", "scheduled-local"]);
  });

  it("status='failure' filters to failures only", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "all", status: "failure" });
    assert.equal(result.length, 1);
    assert.equal(result[0].trigger, "scheduled-local");
  });

  it("status='success' excludes partial runs", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "all", status: "success" });
    assert.equal(result.length, 2);
    for (const run of result) assert.equal(run.status, "success");
  });

  it("trigger='manual' excludes scheduled and cli", async () => {
    const mod = await loadRunsTab();
    const result = mod.filterRuns(sample, { trigger: "manual", status: "all" });
    assert.equal(result.length, 1);
    assert.equal(result[0].trigger, "manual");
  });
});

describe("fetchDiscoveryRuns", () => {
  function makeResponse(status, payload, text) {
    return new Response(
      text !== undefined ? text : JSON.stringify(payload),
      {
        status,
        headers: { "content-type": "application/json" },
      },
    );
  }

  it("returns {ok:false, reason:'signed_out'} when no access token provided", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "", {
      fetchImpl: async () => {
        throw new Error("should not fetch when signed out");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "signed_out");
  });

  it("returns {ok:true, runs:[], reason:'missing_tab'} when Sheets returns 400 parse-range error", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "tok", {
      fetchImpl: async () =>
        makeResponse(
          400,
          null,
          '{"error":{"code":400,"message":"Unable to parse range: DiscoveryRuns!A2:I"}}',
        ),
    });
    assert.equal(result.ok, true);
    assert.equal(result.runs.length, 0);
    assert.equal(result.reason, "missing_tab");
  });

  it("returns {ok:true, runs:[], reason:'empty'} when the tab exists but has no rows", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "tok", {
      fetchImpl: async () => makeResponse(200, { values: [] }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.runs.length, 0);
    assert.equal(result.reason, "empty");
  });

  it("returns newest-first runs on success", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "tok", {
      fetchImpl: async () =>
        makeResponse(200, {
          values: [
            [
              "2026-04-21T10:00:00Z",
              "manual",
              "success",
              30,
              5,
              1,
              "worker",
              "var-1",
              "",
            ],
            [
              "2026-04-21T12:00:00Z",
              "scheduled-github",
              "failure",
              60,
              10,
              0,
              "worker",
              "var-2",
              "boom",
            ],
            [
              "2026-04-21T11:00:00Z",
              "manual",
              "success",
              45,
              8,
              2,
              "worker",
              "var-3",
              "",
            ],
          ],
        }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.runs.length, 3);
    assert.equal(result.runs[0].runAt, "2026-04-21T12:00:00Z");
    assert.equal(result.runs[2].runAt, "2026-04-21T10:00:00Z");
  });

  it("returns {ok:false, reason:'unauthorized'} on HTTP 401", async () => {
    const mod = await loadRunsTab();
    const result = await mod.fetchDiscoveryRuns("sheet-1", "tok", {
      fetchImpl: async () => makeResponse(401, { error: "nope" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unauthorized");
  });

  it("sends Bearer token and hits the DiscoveryRuns!A2:I range with UNFORMATTED_VALUE", async () => {
    const mod = await loadRunsTab();
    let seen = null;
    await mod.fetchDiscoveryRuns("sheet-abc", "tok-xyz", {
      fetchImpl: async (url, init) => {
        seen = { url: String(url), headers: init && init.headers };
        return makeResponse(200, { values: [] });
      },
    });
    assert.ok(seen);
    assert.match(seen.url, /\/spreadsheets\/sheet-abc\/values\//);
    // `!` is an unreserved char per encodeURIComponent, so the range stays as
    // "DiscoveryRuns!A2%3AI" (colon is percent-encoded, bang is not).
    assert.match(seen.url, /DiscoveryRuns!A2%3AI/);
    assert.match(seen.url, /valueRenderOption=UNFORMATTED_VALUE/);
    assert.equal(seen.headers.Authorization, "Bearer tok-xyz");
  });
});
