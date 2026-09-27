/* RUNHIST FE fixtures — shaped exactly like the AGREED CONTRACT (FE ⇄ BE,
 * 2026-09-27): GET /runs summaries and a terminal GET /runs/:id with
 * `runStats`. Every other runhist-fe-*.test.mjs imports from here. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const read = (f) => readFileSync(join(repoRoot, f), "utf8");

export const SHEET_HEADER = [
  "Run At", "Trigger", "Status", "Duration (s)", "Companies Seen",
  "Leads New", "Leads Updated", "Source", "Variation Key", "Error", "Run ID",
];

/** Sheet values as returned for DiscoveryRuns!A1:K (header row first). */
export function sheetValues() {
  return [
    SHEET_HEADER,
    // Joined with worker run_a (Sheet counts are older/coarser).
    ["2026-09-27T05:08:32.000Z", "manual", "success", 512, 3, 8, 3, "worker", "v-a", "", "run_a"],
    // Sheet-only, pre-Run-ID row (legacy 10 cells).
    ["2026-09-20T14:00:00.000Z", "scheduled-local", "success", 300, 2, 4, 0, "worker", "v-old", ""],
    // Sheet row whose run the worker no longer holds (pruned / remote).
    ["2026-09-25T09:00:00.000Z", "manual", "partial", 90, 1, 1, 0, "worker", "v-c", "One source timed out", "run_c"],
  ];
}

export function listPage1() {
  return {
    ok: true,
    runs: [
      {
        runId: "run_d",
        status: "failed",
        trigger: "scheduled",
        startedAt: "2026-09-27T06:00:00.000Z",
        completedAt: "2026-09-27T06:00:40.000Z",
        durationMs: 40000,
        statusPath: "/runs/run_d",
        headline: {},
      },
      {
        runId: "run_a",
        status: "completed",
        trigger: "manual",
        startedAt: "2026-09-27T05:00:00.000Z",
        completedAt: "2026-09-27T05:08:32.000Z",
        durationMs: 512000,
        statusPath: "/runs/run_a",
        headline: { written: 9, updated: 3, candidates: 28, fitAvg: 6.8 },
      },
    ],
    nextBefore: "cursor_1",
  };
}

export function listPage2() {
  return {
    ok: true,
    runs: [
      {
        runId: "run_e",
        status: "empty",
        trigger: "manual",
        startedAt: "2026-09-18T08:00:00.000Z",
        completedAt: "2026-09-18T08:02:00.000Z",
        durationMs: 120000,
        statusPath: "/runs/run_e",
        headline: { written: 0 },
      },
    ],
    nextBefore: null,
  };
}

/** Terminal GET /runs/run_a with the full runStats block. */
export function detailRunA() {
  return {
    ok: true,
    runId: "run_a",
    status: "completed",
    terminal: true,
    message: "Discovery run completed.",
    trigger: "manual",
    request: { sheetId: "sheet_example", variationKey: "v-a", requestedAt: "2026-09-27T04:59:58.000Z" },
    acceptedAt: "2026-09-27T04:59:59.000Z",
    updatedAt: "2026-09-27T05:08:32.000Z",
    startedAt: "2026-09-27T05:00:00.000Z",
    completedAt: "2026-09-27T05:08:32.000Z",
    warnings: [],
    sources: [
      {
        sourceId: "ats",
        querySummary: "3 companies",
        pagesVisited: 39,
        leadsSeen: 525,
        leadsAccepted: 20,
        leadsRejected: 460,
        warnings: [],
        rejectionSummary: {
          totalRejected: 460,
          rejectionReasons: { skip_title_match: 200, location_outside_acceptable: 120, headline_mismatch: 140 },
          rejectionSamples: [],
        },
      },
      {
        sourceId: "serpapi_google_jobs",
        querySummary: "5 queries",
        pagesVisited: 5,
        leadsSeen: 14,
        leadsAccepted: 8,
        leadsRejected: 10,
        warnings: [],
        rejectionSummary: {
          totalRejected: 10,
          rejectionReasons: { skip_title_match: 10 },
          rejectionSamples: [],
        },
      },
    ],
    runStats: {
      schemaVersion: 1,
      durationMs: 512000,
      funnel: {
        companiesSearched: 3,
        boardsDetected: 39,
        queriesRun: 5,
        listingsSeen: 539,
        listingsProcessed: 539,
        duplicatesInRun: 41,
        rejected: 470,
        rejectedTopReasons: [
          { reason: "skip_title_match", count: 210 },
          { reason: "headline_mismatch", count: 140 },
          { reason: "location_outside_acceptable", count: 120 },
        ],
        candidates: 28,
        written: 9,
        updated: 3,
      },
      fit: {
        scored: 28, avg: 6.8, median: 7, min: 3, max: 9, scale: 10,
        histogram: [0, 0, 0, 1, 2, 3, 5, 7, 6, 3, 1],
      },
      sources: [
        {
          id: "ats", label: "Company job boards",
          searched: { companies: 3, boards: 39 },
          seen: 525, accepted: 20, rejected: 460, duplicates: 38, timeouts: 1, state: "done",
        },
        {
          id: "serpapi_google_jobs", label: "Google Jobs",
          searched: { queries: 5 },
          seen: 14, accepted: 8, rejected: 10, duplicates: 3, state: "done",
        },
      ],
      timeline: [
        { phase: "scout", startedAt: "2026-09-27T05:00:00.000Z", durationMs: 300000 },
        { phase: "score", startedAt: "2026-09-27T05:05:00.000Z", durationMs: 150000 },
        { phase: "write", startedAt: "2026-09-27T05:07:30.000Z", durationMs: 62000 },
      ],
      matcherCalls: 41,
      searched: {
        companies: ["Figma", "Notion", "Linear"],
        queries: [
          "senior product manager remote",
          "product lead fintech",
          "group pm platform",
          "staff product manager ai",
          "principal pm developer tools",
        ],
        truncated: false,
      },
    },
  };
}

/** An older terminal run: no runStats at all. */
export function detailLegacy() {
  const d = detailRunA();
  delete d.runStats;
  d.runId = "run_d";
  d.status = "failed";
  return d;
}

/** A sparse runStats: only a few measured fields. */
export function detailSparse() {
  return {
    ...detailRunA(),
    runStats: {
      schemaVersion: 1,
      funnel: { listingsSeen: 12, written: 0 },
    },
  };
}

export function manyCompanies(n) {
  return Array.from({ length: n }, (_, i) => `Company ${i + 1}`);
}

/** Load runs-tab.js into a vm context with no DOM (pure API only). */
export function loadRunsLog(extra = {}) {
  const window = extra.window || {};
  const context = {
    window,
    document: {
      readyState: "loading",
      addEventListener() {},
      getElementById() { return null; },
    },
    console,
    URL,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ...extra.context,
  };
  vm.runInNewContext(read("runs-tab.js"), context, { filename: "runs-tab.js" });
  return window.JobBoredRunsLog;
}

export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
