// HOLES HUNT-FE: the offline hitlist must cluster and rank exactly like the
// worker's GET /hunts/hitlist (docs/INTERFACE-HUNTS.md §3.3, §7), or a saved
// hunt and its past runs stop matching when the worker comes back.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const hitlist = require("../hunts-hitlist.js");

// Vectors from HUNT-W's buildSearchKey/buildSearchLabel
// (integrations/browser-use-discovery/src/state/hunt-store.ts @ c09236a7).
const ROTATED = {
  planVersion: 1,
  generatedAt: "2026-09-30T08:00:00.000Z",
  seed: "a1",
  selected: {
    role: "Product designer",
    skill: "Figma",
    industry: "SaaS",
    companyType: "startup",
    location: "Remote",
  },
  facets: {
    roles: ["Product designer", "UX Designer"],
    locations: ["Remote", "Chicago"],
    seniority: ["Senior"],
  },
  query: {
    targetRoles: "Product designer, UX Designer, Design Systems Designer",
    locations: "Remote",
    seniority: "Senior",
    remotePolicy: "Remote  only",
    keywordsInclude: "Figma, SaaS, startup, Design systems",
    keywordsExclude: "agency; intern",
    sourcePreset: "ats_only",
  },
};
const QUERY_ONLY = {
  planVersion: 1,
  generatedAt: "2026-09-30T08:00:00.000Z",
  seed: "b2",
  query: {
    targetRoles: "Analytics engineer\nData engineer",
    locations: "Austin;Remote",
    seniority: "",
    keywordsInclude: "dbt, SQL",
    keywordsExclude: "",
    remotePolicy: "",
    sourcePreset: "",
  },
};

test("HUNT-FE-HIT-1: the client search key and label match the worker's", async () => {
  assert.equal(await hitlist.searchKeyOf(ROTATED), "sk_22819704278edfea");
  assert.equal(await hitlist.searchKeyOf(QUERY_ONLY), "sk_73cf9e7e9d5380ae");
  assert.equal(
    hitlist.searchLabelOf(ROTATED),
    "product designer, ux designer · remote, chicago · senior",
  );
  assert.equal(
    hitlist.searchLabelOf(QUERY_ONLY),
    "analytics engineer, data engineer · austin, remote",
  );
});

test("HUNT-FE-HIT-2: daily rotation picks do not split one search into many", async () => {
  const tomorrow = {
    ...ROTATED,
    seed: "a2",
    selected: { ...ROTATED.selected, skill: "Prototyping", industry: "Health" },
    query: {
      ...ROTATED.query,
      keywordsInclude: "Prototyping, Health, startup, DESIGN SYSTEMS",
    },
  };
  assert.equal(await hitlist.searchKeyOf(tomorrow), await hitlist.searchKeyOf(ROTATED));
  const tweaked = {
    ...ROTATED,
    facets: { ...ROTATED.facets, locations: ["Austin"] },
    query: { ...ROTATED.query, locations: "Austin" },
  };
  assert.notEqual(await hitlist.searchKeyOf(tweaked), await hitlist.searchKeyOf(ROTATED));
});

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

function run(id, completedAt, plan, headline, status = "completed") {
  return { runId: id, status, completedAt, searchPlan: plan, headline };
}

test("HUNT-FE-HIT-3: past runs cluster by search, rank by yield and recency, and mark repeats and saved hunts", async () => {
  const keyA = await hitlist.searchKeyOf(ROTATED);
  const runs = [
    run("run_a1", "2026-09-28T08:00:00.000Z", ROTATED, { written: 2, updated: 1, fitAvg: 6 }),
    run("run_b1", "2026-10-01T08:00:00.000Z", QUERY_ONLY, { written: 1, updated: 0 }),
    run("run_a3", "2026-10-02T08:00:00.000Z", ROTATED, { written: 6, updated: 2, fitAvg: 8 }),
    run("run_a2", "2026-09-30T08:00:00.000Z", ROTATED, { written: 4, updated: 3 }, "partial"),
    run("run_failed", "2026-10-02T09:00:00.000Z", ROTATED, { written: 9 }, "failed"),
    run("run_live", "2026-10-02T10:00:00.000Z", ROTATED, { written: 9 }, "running"),
    { runId: "run_noplan", status: "completed", completedAt: "2026-10-02T11:00:00.000Z", headline: { written: 9 } },
  ];
  const result = await hitlist.deriveHitlist(runs, {
    now: NOW,
    hunts: [{ id: "hunt_a", searchKey: keyA }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.runsConsidered, 4, "only terminal runs with a plan count");
  assert.equal(result.clusters.length, 2);
  const [a, b] = result.clusters;
  assert.equal(a.key, keyA);
  assert.equal(a.runCount, 3);
  assert.equal(a.repeating, true);
  assert.equal(a.leadsWritten, 12);
  assert.equal(a.leadsUpdated, 6);
  assert.equal(a.meanFit, 7);
  assert.equal(a.lastRunId, "run_a3");
  assert.equal(a.lastRunAt, "2026-10-02T08:00:00.000Z");
  assert.deepEqual(
    a.trend.map((point) => point.runId),
    ["run_a3", "run_a2", "run_a1"],
    "trend is newest first",
  );
  assert.equal(a.trend[0].fitAvg, 8);
  assert.equal("fitAvg" in a.trend[1], false);
  assert.equal(a.huntId, "hunt_a");
  assert.equal(a.label, "product designer, ux designer · remote, chicago · senior");
  const days = (NOW - Date.parse(a.lastRunAt)) / 86400000;
  const expected = (12 / 3) * (0.5 + 7 / 10) * 0.5 ** (days / 14);
  assert.equal(a.score, Math.round(expected * 1e4) / 1e4, "score rounds to 4 places, as the worker's");
  assert.equal(b.repeating, false);
  assert.equal(b.huntId, null);
  assert.equal(b.meanFit, null);
});

test("HUNT-FE-HIT-4: a worker-provided searchKey wins, ties go to repeating clusters, and limit caps the list", async () => {
  const runs = [
    { ...run("r1", "2026-10-01T00:00:00.000Z", QUERY_ONLY, { written: 0 }), searchKey: "sk_once" },
    { ...run("r2", "2026-09-01T00:00:00.000Z", ROTATED, { written: 0 }), searchKey: "sk_twice" },
    { ...run("r3", "2026-09-02T00:00:00.000Z", ROTATED, { written: 0 }), searchKey: "sk_twice" },
  ];
  const result = await hitlist.deriveHitlist(runs, { now: NOW });
  assert.deepEqual(
    result.clusters.map((c) => c.key),
    ["sk_twice", "sk_once"],
    "equal zero scores: the repeating cluster ranks first",
  );
  const capped = await hitlist.deriveHitlist(runs, { now: NOW, limit: 1 });
  assert.equal(capped.clusters.length, 1);
});

test("HUNT-FE-HIT-5: the trend reads newer runs against older ones", () => {
  const points = (values) => values.map((written) => ({ written }));
  assert.equal(hitlist.trendDirection(points([5, 4, 1, 0])), "up");
  assert.equal(hitlist.trendDirection(points([0, 1, 4, 5])), "down");
  assert.equal(hitlist.trendDirection(points([2, 2, 2])), "flat");
  assert.equal(hitlist.trendDirection(points([3])), "new");
  assert.equal(hitlist.trendDirection([]), "new");
});

test("HUNT-FE-HIT-6: run yield reads worker headlines and cached records alike", () => {
  assert.deepEqual(hitlist.runYield({ headline: { written: 3, updated: 2, fitAvg: 7.5 } }), {
    written: 3,
    updated: 2,
    fitAvg: 7.5,
  });
  assert.deepEqual(hitlist.runYield({ written: "4", updated: null }), {
    written: 4,
    updated: 0,
    fitAvg: null,
  });
});
