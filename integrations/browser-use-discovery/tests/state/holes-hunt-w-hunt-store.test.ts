// HOLES HUNT-W: saved hunts persist in worker-state.sqlite, and a search key
// names one search across daily rotation (docs/INTERFACE-HUNTS.md §2, §7).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { DiscoverySearchPlan } from "../../src/contracts.ts";
import {
  applyHuntTweaks,
  buildSearchKey,
  buildSearchLabel,
  normalizeHuntSearchPlan,
  openHuntStore,
  type HuntRecord,
} from "../../src/state/hunt-store.ts";

async function withDir(fn: (path: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "hunt-store-"));
  try {
    await fn(join(dir, "worker-state.sqlite"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function plan(overrides: Partial<DiscoverySearchPlan> = {}): DiscoverySearchPlan {
  return {
    planVersion: 1,
    generatedAt: "2026-10-01T08:00:00.000Z",
    seed: "seed-a",
    selected: { role: "Product Designer", skill: "Figma", industry: "Fintech", location: "Remote" },
    facets: {
      roles: ["Product Designer", "UX Designer"],
      locations: ["Remote", "Chicago"],
      seniority: ["Senior"],
    },
    query: {
      targetRoles: "Product Designer, UX Designer, Interaction Designer",
      locations: "Remote",
      seniority: "Senior",
      remotePolicy: "remote",
      keywordsInclude: "Figma, Fintech, design systems",
      keywordsExclude: "intern",
      sourcePreset: "browser_plus_ats",
    },
    ...overrides,
  };
}

function hunt(overrides: Partial<HuntRecord> = {}): HuntRecord {
  return {
    id: "hunt_0123456789abcdef0123456789abcdef",
    name: "Product designer",
    status: "active",
    searchPlan: plan(),
    tweaks: {},
    explorationShare: 0.3,
    schedule: { kind: "daily", hour: 8, minute: 0 },
    timezone: "America/Chicago",
    sheetId: "sheet_hunt",
    sourceRunId: "run_source",
    createdAt: "2026-10-02T09:00:00.000Z",
    updatedAt: "2026-10-02T09:00:00.000Z",
    nextRunAt: "2026-10-03T13:00:00.000Z",
    queuedAt: null,
    queuedTrigger: null,
    lastRunAt: null,
    lastRunId: null,
    lastError: null,
    ...overrides,
  };
}

test("HUNT-W: a saved hunt and its run log survive a worker restart", async () => {
  await withDir((path) => {
    const first = openHuntStore(path);
    first.insert(hunt());
    first.recordRun({
      huntId: hunt().id,
      runId: "run_one",
      trigger: "scheduled-hunt",
      dispatchedAt: "2026-10-03T13:00:05.000Z",
    });
    first.close();

    const reopened = openHuntStore(path);
    try {
      assert.deepEqual(reopened.get(hunt().id), hunt());
      assert.deepEqual(reopened.listRuns(hunt().id), [
        { huntId: hunt().id, runId: "run_one", trigger: "scheduled-hunt", dispatchedAt: "2026-10-03T13:00:05.000Z" },
      ]);
      assert.equal(reopened.count(), 1);
    } finally {
      reopened.close();
    }
    const raw = new DatabaseSync(path);
    try {
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      assert.ok(tables.includes("hunts"));
      assert.ok(tables.includes("hunt_runs"));
    } finally {
      raw.close();
    }
  });
});

test("HUNT-W: hunts list newest first, update replaces, delete drops the hunt and its runs", async () => {
  await withDir((path) => {
    const store = openHuntStore(path);
    try {
      const older = hunt({ id: "hunt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", createdAt: "2026-10-01T00:00:00.000Z" });
      const newer = hunt({ id: "hunt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", createdAt: "2026-10-02T00:00:00.000Z" });
      store.insert(older);
      store.insert(newer);
      assert.deepEqual(store.list().map((entry) => entry.id), [newer.id, older.id]);

      store.update({ ...older, status: "paused", nextRunAt: null, queuedAt: "2026-10-02T01:00:00.000Z", queuedTrigger: "hunt" });
      assert.equal(store.get(older.id)?.status, "paused");
      assert.equal(store.get(older.id)?.queuedTrigger, "hunt");

      store.recordRun({ huntId: older.id, runId: "run_x", trigger: "hunt", dispatchedAt: "2026-10-02T02:00:00.000Z" });
      store.recordRun({ huntId: older.id, runId: "run_y", trigger: "hunt", dispatchedAt: "2026-10-02T03:00:00.000Z" });
      assert.deepEqual(store.listRuns(older.id).map((run) => run.runId), ["run_y", "run_x"]);
      assert.deepEqual(store.listRuns(older.id, 1).map((run) => run.runId), ["run_y"]);

      assert.equal(store.delete(older.id), true);
      assert.equal(store.get(older.id), null);
      assert.deepEqual(store.listRuns(older.id), []);
      assert.equal(store.delete(older.id), false);
    } finally {
      store.close();
    }
  });
});

test("HUNT-W: the search key ignores rotation picks, order and case, and moves with a tweak", () => {
  const today = plan();
  const tomorrow = plan({
    seed: "seed-b",
    selected: { role: "UX Designer", skill: "Prototyping", industry: "Health", location: "Chicago" },
    query: {
      ...plan().query,
      targetRoles: "ux designer, Product Designer, Visual Designer",
      locations: "Chicago",
      keywordsInclude: "Prototyping, Health, DESIGN SYSTEMS",
    },
  });
  assert.equal(buildSearchKey(today), buildSearchKey(tomorrow));
  assert.match(buildSearchKey(today), /^sk_[0-9a-f]{16}$/);

  const tweaked = applyHuntTweaks(today, { locations: "Austin", keywordsExclude: "intern, contract" });
  assert.notEqual(buildSearchKey(tweaked), buildSearchKey(today));
  assert.equal(tweaked.query?.locations, "Austin");
  assert.deepEqual(tweaked.facets?.locations, ["Austin"]);
  assert.equal(tweaked.query?.keywordsExclude, "intern, contract");
  // The base plan is never mutated by a tweak.
  assert.equal(today.query?.locations, "Remote");

  const includes = applyHuntTweaks(today, { keywordsInclude: "Figma" });
  assert.equal(includes.query?.keywordsInclude, "Figma");
  assert.equal(includes.selected?.skill, undefined);
  assert.equal(buildSearchLabel(today), "product designer, ux designer · remote, chicago · senior");
});

test("HUNT-W: a stored search plan keeps only plan fields", () => {
  const normalized = normalizeHuntSearchPlan({
    ...plan(),
    googleAccessToken: "never-stored",
    query: { ...plan().query, extra: "dropped" },
    facets: { roles: ["Designer", 7] },
  });
  assert.ok(normalized);
  assert.equal("googleAccessToken" in normalized, false);
  assert.equal("extra" in (normalized.query || {}), false);
  assert.deepEqual(normalized.facets, { roles: ["Designer"] });
  assert.equal(normalizeHuntSearchPlan({ planVersion: 2 }), null);
  assert.equal(normalizeHuntSearchPlan("plan"), null);
});
