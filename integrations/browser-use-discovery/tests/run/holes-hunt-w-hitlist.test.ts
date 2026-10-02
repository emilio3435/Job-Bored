// HOLES HUNT-W: the hitlist clusters past runs by normalized searchPlan and
// ranks the clusters by yield (leads written, mean fit) and recency, marking
// the repeating ones (docs/INTERFACE-HUNTS.md §3.3, §7).
import assert from "node:assert/strict";
import test from "node:test";

import type { DiscoverySearchPlan } from "../../src/contracts.ts";
import type { DiscoveryRunListSummary } from "../../src/state/run-status-store.ts";
import { buildSearchKey, type HuntRecord } from "../../src/state/hunt-store.ts";
import { buildHitlist } from "../../src/webhook/handle-hunts.ts";

const NOW = new Date("2026-10-02T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function designerPlan(day: number): DiscoverySearchPlan {
  // The dashboard rotates one adjacent title, one location and one include
  // pick per day; the search itself stays the same.
  const picks = [["Figma", "Fintech"], ["Prototyping", "Health"]][day % 2];
  return {
    planVersion: 1,
    generatedAt: new Date(NOW.getTime() - day * DAY).toISOString(),
    seed: `seed-${day}`,
    selected: { skill: picks[0], industry: picks[1] },
    facets: { roles: ["Product Designer"], locations: ["Remote", "Chicago"], seniority: ["Senior"] },
    query: {
      targetRoles: day % 2 ? "Product Designer, UX Designer" : "Product Designer, Visual Designer",
      locations: day % 2 ? "Chicago" : "Remote",
      seniority: "Senior",
      keywordsInclude: `${picks[0]}, ${picks[1]}, design systems`,
    },
  };
}

function plan(roles: string): DiscoverySearchPlan {
  return { planVersion: 1, generatedAt: NOW.toISOString(), seed: roles, query: { targetRoles: roles } };
}

function run(
  runId: string,
  searchPlan: DiscoverySearchPlan | null,
  daysAgo: number,
  headline: DiscoveryRunListSummary["headline"],
  status: DiscoveryRunListSummary["status"] = "completed",
): DiscoveryRunListSummary {
  const at = new Date(NOW.getTime() - daysAgo * DAY).toISOString();
  return {
    runId,
    status,
    trigger: "manual",
    startedAt: at,
    completedAt: at,
    statusPath: `/runs/${runId}`,
    headline,
    ...(searchPlan ? { searchPlan, searchKey: buildSearchKey(searchPlan) } : {}),
  };
}

test("HUNT-W: runs of one search cluster together across daily rotation and repeat", () => {
  const { clusters, runsConsidered } = buildHitlist({
    runs: [
      run("run_d1", designerPlan(1), 1, { written: 4, updated: 2, fitAvg: 7 }),
      run("run_d2", designerPlan(2), 2, { written: 6, updated: 1, fitAvg: 9 }),
      run("run_pm", plan("Product Manager"), 1, { written: 3, updated: 0 }),
    ],
    hunts: [],
    now: NOW,
    limit: 20,
  });
  assert.equal(runsConsidered, 3);
  assert.equal(clusters.length, 2);
  const designer = clusters.find((cluster) => cluster.runCount === 2);
  assert.ok(designer);
  assert.equal(designer.repeating, true);
  assert.equal(designer.key, buildSearchKey(designerPlan(1)));
  assert.equal(designer.leadsWritten, 10);
  assert.equal(designer.leadsUpdated, 3);
  assert.equal(designer.meanFit, 8);
  assert.equal(designer.lastRunId, "run_d1");
  assert.deepEqual(designer.searchPlan, designerPlan(1));
  assert.equal(designer.label, "product designer · remote, chicago · senior");
  assert.deepEqual(designer.trend.map((point) => [point.runId, point.written, point.updated, point.fitAvg]), [
    ["run_d1", 4, 2, 7],
    ["run_d2", 6, 1, 9],
  ]);
  const pm = clusters.find((cluster) => cluster.runCount === 1);
  assert.equal(pm?.repeating, false);
  assert.equal(pm?.meanFit, null);
});

test("HUNT-W: clusters rank by leads per run, mean fit and recency", () => {
  const { clusters } = buildHitlist({
    runs: [
      // 8 leads/run, fit 8 (×1.3), yesterday.
      run("run_a1", plan("Designer"), 1, { written: 10, fitAvg: 8 }),
      run("run_a2", plan("Designer"), 3, { written: 6, fitAvg: 8 }),
      // 20 leads in one run, unmeasured fit (×1), but 30 days old.
      run("run_b1", plan("Engineer"), 30, { written: 20 }),
      // Repeats, but never writes anything.
      run("run_c1", plan("Writer"), 0, { written: 0, fitAvg: 9 }),
      run("run_c2", plan("Writer"), 1, { written: 0, fitAvg: 9 }),
    ],
    hunts: [],
    now: NOW,
    limit: 20,
  });
  assert.deepEqual(clusters.map((cluster) => cluster.lastRunId), ["run_a1", "run_b1", "run_c1"]);
  const expectedA = 8 * 1.3 * 0.5 ** (1 / 14);
  const expectedB = 20 * 1 * 0.5 ** (30 / 14);
  assert.ok(Math.abs(clusters[0].score - expectedA) < 1e-3, `score A ${clusters[0].score}`);
  assert.ok(Math.abs(clusters[1].score - expectedB) < 1e-3, `score B ${clusters[1].score}`);
  assert.equal(clusters[2].score, 0);
});

test("HUNT-W: equal scores put repeating searches first, then the newest", () => {
  const { clusters } = buildHitlist({
    runs: [
      run("run_once_new", plan("Analyst"), 0, { written: 0 }),
      run("run_twice_1", plan("Scientist"), 2, { written: 0 }),
      run("run_twice_2", plan("Scientist"), 3, { written: 0 }),
      run("run_once_old", plan("Architect"), 5, { written: 0 }),
    ],
    hunts: [],
    now: NOW,
    limit: 20,
  });
  assert.deepEqual(clusters.map((cluster) => cluster.lastRunId), ["run_twice_1", "run_once_new", "run_once_old"]);
});

test("HUNT-W: only finished runs that recorded a plan count", () => {
  const { clusters, runsConsidered } = buildHitlist({
    runs: [
      run("run_ok", plan("Designer"), 1, { written: 2 }),
      run("run_failed", plan("Designer"), 1, { written: 9 }, "failed"),
      run("run_running", plan("Designer"), 0, {}, "running"),
      run("run_held", plan("Designer"), 2, { written: 0 }, "write_failed"),
      run("run_noplan", null, 1, { written: 5 }),
    ],
    hunts: [],
    now: NOW,
    limit: 20,
  });
  assert.equal(runsConsidered, 2);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].runCount, 2);
  assert.equal(clusters[0].leadsWritten, 2);
});

test("HUNT-W: a cluster names the saved hunt with the same key, and limit caps the list", () => {
  const savedPlan = plan("Designer");
  const savedHunt = {
    id: "hunt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    searchPlan: savedPlan,
    tweaks: {},
  } as unknown as HuntRecord;
  const tweakedHunt = {
    id: "hunt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    searchPlan: plan("Engineer"),
    tweaks: { locations: "Austin" },
  } as unknown as HuntRecord;
  const { clusters } = buildHitlist({
    runs: [
      run("run_d", savedPlan, 1, { written: 5 }),
      run("run_e", plan("Engineer"), 1, { written: 4 }),
      run("run_w", plan("Writer"), 1, { written: 1 }),
    ],
    hunts: [savedHunt, tweakedHunt],
    now: NOW,
    limit: 2,
  });
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].huntId, savedHunt.id);
  // A tweaked hunt runs a different search, so the old cluster stays unsaved.
  assert.equal(clusters[1].huntId, null);
});
