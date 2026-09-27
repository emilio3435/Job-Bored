// DISCAT C3: near-miss role-family learning (D8) and per-run filter stats (D9).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../../src/contracts.ts";
import { mergeDiscoveryConfig } from "../../src/config.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";
import { createDiscoveryMemoryStore } from "../../src/state/discovery-memory-store.ts";
import { createRunDiscoveryMemoryStore } from "../../src/state/run-discovery-memory-store.ts";
import {
  buildCompletedRunStatus,
  createDiscoveryRunStatusStore,
} from "../../src/state/run-status-store.ts";

const NOW = "2026-09-27T12:00:00.000Z";

const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`discat-c3: network blocked (${String(input)})`);
  }) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = originalFetch;
});

type Listing = {
  company: string;
  title: string;
  url: string;
  location?: string;
  descriptionText?: string;
};

const COMPANIES = ["Acme", "Globex"];

function listing(
  company: string,
  title: string,
  id: string,
  extra: Partial<Listing> = {},
): Listing {
  return {
    company,
    title,
    url: `https://boards.greenhouse.io/${company.toLowerCase()}/jobs/${id}`,
    location: "Remote",
    descriptionText: `Work at ${company}. Remote.`,
    ...extra,
  };
}

function makeRun(options: { listings: Listing[]; store?: unknown; locations?: string[] }) {
  const logs: Array<[string, Record<string, unknown>]> = [];
  let seq = 0;
  const dependencies = {
    runtimeConfig: {
      runMode: "hosted",
      allowedOrigins: [],
      port: 0,
      host: "127.0.0.1",
    },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async ({ company }: { company: { name: string } }) => [
        {
          matched: true,
          sourceId: "greenhouse",
          sourceLabel: "Greenhouse",
          boardUrl: `https://boards.greenhouse.io/${company.name.toLowerCase()}`,
          canonicalUrl: `https://boards.greenhouse.io/${company.name.toLowerCase()}`,
          boardToken: company.name.toLowerCase(),
          confidence: 1,
          warnings: [],
        },
      ],
      collectListings: async (_run: unknown, dets: Array<{ boardUrl: string }>) =>
        dets.flatMap((d) => {
          const slug = String(d.boardUrl.split("/").pop());
          return options.listings
            .filter((entry) => entry.company.toLowerCase() === slug)
            .map((entry) => ({
              sourceId: "greenhouse",
              sourceLabel: "Greenhouse",
              sourceLane: "ats_provider",
              tags: [],
              ...entry,
            }));
        }),
    },
    // The AI matcher rejects every listing it is asked about on the role
    // component, so an AI-eligible listing becomes a headline_mismatch.
    matchClient: {
      evaluate: async ({ baseline }: { baseline: Record<string, unknown> }) => ({
        ...baseline,
        decision: "reject",
        overallScore: 0.1,
        hardRejectReason: "",
        componentScores: {
          role: 0,
          location: 1,
          remote: 1,
          seniority: 1,
          negative: 1,
        },
        reasons: ["stub rejects on role"],
        modelVersion: "stub",
      }),
    },
    pipelineWriter: {
      write: async (sheetId: string, leads: Array<Record<string, unknown>>) => ({
        sheetId,
        appended: leads.length,
        updated: 0,
        skippedDuplicates: 0,
        skippedBlacklist: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_c3",
      mode: "hosted",
      timezone: "UTC",
      companies: COMPANIES.map((name) => ({ name })),
      includeKeywords: [],
      excludeKeywords: ["sales engineer", "php"],
      targetRoles: ["Backend Engineer"],
      locations: options.locations || [],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 10,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      sourcePreset: "ats_only",
    }),
    mergeDiscoveryConfig,
    now: () => new Date(NOW),
    randomId: (prefix: string) => `${prefix}_${++seq}`,
    log: (event: string, details: Record<string, unknown>) =>
      logs.push([event, details]),
    discoveryMemoryStore: options.store,
  };
  const request = {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_c3",
    variationKey: "v",
    requestedAt: NOW,
    discoveryProfile: {
      targetRoles: "Backend Engineer",
      keywordsExclude: "sales engineer, php",
      sourcePreset: "ats_only",
    },
  };
  return {
    run: () => runDiscovery(request as never, "manual", dependencies as never),
    logs,
  };
}

function openStore() {
  const dir = mkdtempSync(join(tmpdir(), "discat-c3-"));
  const raw = createDiscoveryMemoryStore(join(dir, "worker-state.sqlite"));
  return {
    dir,
    raw,
    store: createRunDiscoveryMemoryStore(raw),
    close: () => {
      raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// "Platform Engineer" shares the backend_platform_engineering family with
// "Backend Engineer" but misses the headline. Off-target locations make the
// deterministic matcher unsure, so the stub AI matcher is asked and rejects it
// on role. The deterministic matcher rejects "Account Executive" outright.
const NEAR_MISS_LOCATIONS = ["Berlin"];
const NEAR_MISSES = [
  listing("Acme", "Platform Engineer", "1", { location: "Remote - Japan", descriptionText: "Remote." }),
  listing("Acme", "Platform Engineer", "2", { location: "Remote - Japan", descriptionText: "Remote team." }),
];
const UNRELATED = [listing("Globex", "Account Executive", "3", { descriptionText: "Quota." })];
const EXCLUDED = [
  listing("Acme", "Sales Engineer", "10"),
  listing("Globex", "Senior Sales Engineer", "11"),
  listing("Globex", "Sales Engineer, PHP", "12"),
];
const WRITTEN = [listing("Acme", "Backend Engineer", "20")];

test("should add one near miss per role family per run and ignore non-family mismatches", async () => {
  const { raw, store, close } = openStore();
  try {
    const harness = makeRun({ listings: [...NEAR_MISSES, ...UNRELATED], store, locations: NEAR_MISS_LOCATIONS });
    const result = await harness.run();
    assert.equal(
      result.lifecycle.filterStats?.byReason.headline_mismatch,
      3,
      JSON.stringify(result.lifecycle.filterStats),
    );

    const families = raw.listRoleFamilies();
    const platform = families.filter((family) => family.baseRole === "platform engineer");
    assert.equal(platform.length, 1, JSON.stringify(families));
    assert.equal(platform[0].nearMissCount, 1, "two listings of one family count once");
    assert.equal(platform[0].confirmedCount, 0);
    assert.deepEqual(platform[0].roleVariants, [], "rejected titles are not variants");
    assert.equal(
      families.some((family) => family.baseRole === "account executive"),
      false,
      "a mismatch outside every target family is not a near miss",
    );

    // A second run adds one more near miss to the same family.
    await makeRun({ listings: [...NEAR_MISSES, ...UNRELATED], store, locations: NEAR_MISS_LOCATIONS }).run();
    const again = raw
      .listRoleFamilies()
      .filter((family) => family.baseRole === "platform engineer");
    assert.equal(again[0].nearMissCount, 2);
  } finally {
    close();
  }
});

test("should dedupe near misses per family in the store call", () => {
  const { raw, close } = openStore();
  try {
    const learned = raw.learnRoleFamilyNearMisses({
      listings: [
        { title: "Platform Engineer", companyKey: "acme", sourceLane: "ats_provider" },
        { title: "Senior Platform Engineer", companyKey: "acme", sourceLane: "ats_provider" },
        { title: "Platform Engineer", companyKey: "globex", sourceLane: "ats_provider" },
      ],
    });
    assert.equal(learned.familiesIncremented, 2);
    const counts = raw
      .listRoleFamilies({ baseRole: "platform engineer" })
      .map((family) => [family.companyKey, family.nearMissCount])
      .sort();
    assert.deepEqual(counts, [
      ["acme", 1],
      ["globex", 1],
    ]);
  } finally {
    close();
  }
});

test("should compute filter stats per exclude keyword and reason out of listings seen", async () => {
  const harness = makeRun({ listings: [...EXCLUDED, ...WRITTEN, ...UNRELATED] });
  const result = await harness.run();
  const stats = result.lifecycle.filterStats;
  assert.ok(stats, "lifecycle.filterStats is present");
  assert.equal(stats.listingsSeen, 5);
  assert.equal(stats.listingsRejected, 4);
  assert.deepEqual(stats.byReason, { excluded_keyword: 3, headline_mismatch: 1 });
  assert.deepEqual(stats.byExcludeKeyword, [
    { keyword: "sales engineer", count: 3 },
    { keyword: "php", count: 1 },
  ]);
});

test("should persist filter stats on the terminal run status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discat-c3-status-"));
  try {
    const result = await makeRun({ listings: [...EXCLUDED, ...WRITTEN] }).run();
    const statusStore = createDiscoveryRunStatusStore(dir);
    statusStore.put(
      buildCompletedRunStatus(result, { acceptedAt: NOW, startedAt: NOW }),
    );
    const reloaded = createDiscoveryRunStatusStore(dir).get(result.run.runId);
    assert.deepEqual(reloaded?.lifecycle?.filterStats, {
      listingsSeen: 4,
      listingsRejected: 3,
      byReason: { excluded_keyword: 3 },
      byExcludeKeyword: [
        { keyword: "sales engineer", count: 3 },
        { keyword: "php", count: 1 },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
