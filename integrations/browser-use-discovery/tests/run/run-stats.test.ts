import assert from "node:assert/strict";
import test from "node:test";

import { buildRunStats } from "../../src/run/run-stats.ts";

test("RUNHIST stats aggregate measured funnel, candidate fit, sources, and phase time", () => {
  const stats = buildRunStats({
    startedAt: "2026-09-27T00:00:00.000Z",
    completedAt: "2026-09-27T00:00:10.000Z",
    funnel: {
      companiesSearched: 2,
      boardsDetected: 3,
      listingsSeen: 6,
      listingsProcessed: 6,
      duplicatesInRun: 1,
      rejected: 2,
      candidates: 3,
      written: 2,
      updated: 1,
    },
    rejectionReasons: { title_mismatch: 2, location_mismatch: 1 },
    candidateFitScores: [0, 7, 10, null],
    sources: [{ id: "ats", label: "Company boards", seen: 6, accepted: 4, rejected: 2, timeouts: 1, state: "partial" }],
    timeline: [
      { phase: "scout", startedAt: "2026-09-27T00:00:00.000Z" },
      { phase: "write", startedAt: "2026-09-27T00:00:07.000Z" },
    ],
    matcherCalls: 4,
    searchedCompanies: ["Figma", "https://user:secret@example.com/jobs", "Notion"],
    searchedQueries: ["senior pm remote", "https://example.com/?token=secret"],
  });

  assert.equal(stats.durationMs, 10_000);
  assert.deepEqual(stats.funnel?.rejectedTopReasons, [
    { reason: "title_mismatch", count: 2 },
    { reason: "location_mismatch", count: 1 },
  ]);
  assert.equal(stats.funnel?.duplicatesVsSheet, undefined);
  assert.deepEqual(stats.fit, {
    scored: 3, avg: 5.67, median: 7, min: 0, max: 10, scale: 10,
    histogram: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  });
  assert.deepEqual(stats.timeline?.map(({ phase, durationMs }) => ({ phase, durationMs })), [
    { phase: "scout", durationMs: 7000 },
    { phase: "write", durationMs: 3000 },
  ]);
  assert.deepEqual(stats.searched, {
    companies: ["Figma", "Notion"], queries: ["senior pm remote"], truncated: true,
  });
});

test("RUNHIST empty run keeps measured zeros and omits unscored fit", () => {
  const stats = buildRunStats({
    startedAt: "2026-09-27T00:00:00.000Z",
    completedAt: "2026-09-27T00:00:01.000Z",
    funnel: { listingsSeen: 0, candidates: 0, written: 0, updated: 0 },
    candidateFitScores: [],
    sources: [],
    timeline: [],
    searchedCompanies: [],
    searchedQueries: [],
  });
  assert.equal(stats.funnel?.listingsSeen, 0);
  assert.equal(stats.fit, undefined);
  assert.equal(stats.matcherCalls, undefined);
});

test("RUNHIST timeout-heavy observation preserves partial counts without inventing missing fields", () => {
  const stats = buildRunStats({
    startedAt: "2026-09-27T00:00:00.000Z",
    completedAt: "2026-09-27T00:01:00.000Z",
    funnel: { companiesSearched: 3, boardsDetected: 1, listingsSeen: 0, written: 0 },
    candidateFitScores: [],
    sources: [{ id: "ats", label: "Company boards", seen: 0, timeouts: 3, state: "partial" }],
    timeline: [{ phase: "scout", startedAt: "2026-09-27T00:00:00.000Z" }],
    searchedCompanies: ["TimeoutCo"],
    searchedQueries: [],
  });
  assert.equal(stats.sources?.[0]?.timeouts, 3);
  assert.equal(stats.funnel?.listingsProcessed, undefined);
  assert.equal(stats.funnel?.duplicatesVsSheet, undefined);
  assert.equal(stats.fit, undefined);
});

test("RUNHIST searched labels stay bounded and candidate median handles even scores", () => {
  const stats = buildRunStats({
    startedAt: "2026-09-27T00:00:00.000Z",
    completedAt: "2026-09-27T00:00:01.000Z",
    candidateFitScores: [2, 8],
    searchedCompanies: Array.from({ length: 60 }, (_, index) => `Company ${index}`),
  });
  assert.equal(stats.fit?.median, 5);
  assert.equal(stats.fit?.avg, 5);
  assert.equal(stats.searched?.companies.length, 50);
  assert.equal(stats.searched?.truncated, true);
});
