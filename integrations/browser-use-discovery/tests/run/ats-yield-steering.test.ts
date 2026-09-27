import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type CompanyTarget,
  type IntentCoverageRecord,
} from "../../src/contracts.ts";
import { mergeDiscoveryConfig } from "../../src/config.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";
import { SheetWriteError } from "../../src/sheets/pipeline-writer.ts";
import {
  ATS_COOLDOWN_DAYS,
  buildCompanyYieldStats,
  mergeAtsCompanyTargets,
  planAtsCompanyOrder,
} from "../../src/run/ats-yield-steering.ts";
// DISCAT C2: ATS boards are steered by past yield and listed once per run.
const NOW = "2026-09-25T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`discat-c2: network blocked (${String(input)})`);
  }) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = originalFetch;
});

function makeRequest() {
  return {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_probe",
    variationKey: "v",
    requestedAt: NOW,
    discoveryProfile: {
      targetRoles: "Backend Engineer",
      keywordsInclude: "node",
      sourcePreset: "ats_only",
    },
  };
}

function makeDeps(input: {
  companies: string[];
  enabledSources: string[];
  sourceAdapterRegistry: unknown;
  discoveryMemoryStore: unknown;
}) {
  const logs: Array<[string, Record<string, unknown>]> = [];
  let seq = 0;
  const dependencies = {
    runtimeConfig: { runMode: "hosted", allowedOrigins: [], port: 0, host: "127.0.0.1" },
    sourceAdapterRegistry: input.sourceAdapterRegistry,
    pipelineWriter: {
      write: async (sheetId: string, leads: unknown[]) => ({
        sheetId,
        appended: leads.length,
        updated: 0,
        skippedDuplicates: 0,
        skippedBlacklist: 0,
        warnings: [],
      }),
    },
    loadStoredWorkerConfig: async () => ({
      sheetId: "sheet_probe",
      mode: "hosted",
      timezone: "UTC",
      companies: input.companies.map((name) => ({ name })),
      includeKeywords: ["node"],
      excludeKeywords: [],
      targetRoles: ["Backend Engineer"],
      locations: ["Remote"],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 10,
      enabledSources: input.enabledSources,
      schedule: { enabled: false, cron: "" },
      sourcePreset: "ats_only",
    }),
    mergeDiscoveryConfig,
    now: () => new Date(NOW),
    randomId: (prefix: string) => `${prefix}_${++seq}`,
    log: (event: string, details: Record<string, unknown>) => logs.push([event, details]),
    discoveryMemoryStore: input.discoveryMemoryStore,
  };
  return { dependencies, logs };
}
const DAY_MS = 24 * 60 * 60 * 1000;

function coverage(
  companyKey: string,
  runId: string,
  listingsSeen: number,
  listingsWritten: number,
  daysAgo: number,
): IntentCoverageRecord {
  const startedAt = new Date(NOW_MS - daysAgo * DAY_MS).toISOString();
  return {
    intentKey: "intent:seeded",
    companyKey,
    runId,
    sourceLane: "ats_provider",
    surfacesSeen: 0,
    listingsSeen,
    listingsWritten,
    startedAt,
    completedAt: startedAt,
  };
}

function names(companies: readonly CompanyTarget[]): string[] {
  return companies.map((company) => company.name);
}

function snapshotWith(input: {
  companies?: Array<Record<string, unknown>>;
  careerSurfaces?: Array<Record<string, unknown>>;
  intentCoverage?: IntentCoverageRecord[];
}) {
  return {
    loadSnapshot: () => ({
      intentKey: "intent:seeded",
      companies: input.companies || [],
      careerSurfaces: input.careerSurfaces || [],
      deadLinks: [],
      listingFingerprints: [],
      intentCoverage: input.intentCoverage || [],
      roleFamilies: [],
    }),
  };
}

function registryRow(companyKey: string, displayName: string, atsHints: Record<string, string>) {
  return {
    companyKey,
    displayName,
    normalizedName: displayName.toLowerCase(),
    aliasesJson: "[]",
    domainsJson: "[]",
    atsHintsJson: JSON.stringify(atsHints),
    geoTagsJson: "[]",
    roleTagsJson: "[]",
  };
}

function surfaceRow(companyKey: string, providerType: string, boardToken: string) {
  return {
    surfaceId: `${providerType}:${boardToken}`,
    companyKey,
    surfaceType: "provider_board",
    providerType,
    canonicalUrl: `https://boards.example/${providerType}/${boardToken}`,
    boardToken,
  };
}

/**
 * Detection is name-driven, like the real provider registry: every target
 * for a company resolves to the same boards whichever hint it came in with.
 */
function boardsByCompany(boards: Record<string, Array<[string, string]>>) {
  const listed: string[] = [];
  const detected: string[] = [];
  const registry = {
    adapters: [],
    detectBoards: async ({ company }: { company: CompanyTarget }) => {
      detected.push(company.name);
      const key = company.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return (boards[key] || []).map(([sourceId, token]) => ({
        matched: true,
        sourceId,
        sourceLabel: sourceId,
        boardUrl: `https://boards.example/${sourceId}/${token}`,
        canonicalUrl: `https://boards.example/${sourceId}/${token}`,
        boardToken: token,
        confidence: 1,
        warnings: [],
      }));
    },
    collectListings: async (
      _run: unknown,
      detections: Array<{ sourceId: string; boardToken: string }>,
    ) => {
      for (const detection of detections) {
        listed.push(`${detection.sourceId}:${detection.boardToken}`);
      }
      return [];
    },
  };
  return { registry, listed, detected };
}

test("D7: the same board reached through a config seed, a registry row and career surfaces is listed once", async () => {
  const { registry, listed } = boardsByCompany({
    scaleai: [
      ["greenhouse", "scaleai"],
      ["ashby", "scale"],
    ],
  });
  const { dependencies, logs } = makeDeps({
    companies: ["Scale AI"],
    enabledSources: ["greenhouse", "ashby"],
    sourceAdapterRegistry: registry,
    discoveryMemoryStore: snapshotWith({
      companies: [registryRow("scale-ai", "Scale Ai", { greenhouse: "scaleai" })],
      careerSurfaces: [
        surfaceRow("scale-ai", "greenhouse", "scaleai"),
        surfaceRow("scale-ai", "ashby", "scale-ai"),
        surfaceRow("scale-ai", "ashby", "scale"),
      ],
    }),
  });
  const result = await runDiscovery(
    makeRequest(),
    "manual",
    dependencies as never,
  );
  assert.deepEqual(
    listed.filter((key) => key === "greenhouse:scaleai"),
    ["greenhouse:scaleai"],
    `greenhouse:scaleai must be listed once (listed=${JSON.stringify(listed)})`,
  );
  assert.equal(listed.filter((key) => key === "ashby:scale").length, 1);
  const skipped = logs.find(([event]) => event === "discovery.run.ats_board_duplicate_skipped");
  assert.ok(skipped, "the dedupe must log discovery.run.ats_board_duplicate_skipped");
  // All three copies fold into one target, so no board is skipped as
  // already listed; the fold is reported as merged targets.
  assert.ok(
    Number(skipped[1].mergedTargets) >= 1,
    `mergedTargets must be positive (${JSON.stringify(skipped[1])})`,
  );
  assert.equal(skipped[1].count, 0);
  const loopCounters = result.lifecycle.loopCounters as unknown as Record<string, number>;
  assert.ok(
    loopCounters.atsTargetsMerged >= 1,
    `loopCounters must expose the merge (${JSON.stringify(loopCounters)})`,
  );
  assert.equal(loopCounters.atsBoardDuplicatesSkipped, 0);
});

test("D7: two boards of one company are both listed", async () => {
  const { registry, listed } = boardsByCompany({
    figma: [
      ["greenhouse", "figma"],
      ["greenhouse", "figmainternships"],
    ],
  });
  const { dependencies, logs } = makeDeps({
    companies: ["Figma"],
    enabledSources: ["greenhouse"],
    sourceAdapterRegistry: registry,
    discoveryMemoryStore: snapshotWith({
      careerSurfaces: [
        surfaceRow("figma", "greenhouse", "figma"),
        surfaceRow("figma", "greenhouse", "figmainternships"),
      ],
    }),
  });
  const result = await runDiscovery(makeRequest(), "manual", dependencies as never);
  assert.deepEqual(
    [...listed].sort(),
    ["greenhouse:figma", "greenhouse:figmainternships"],
  );
  // The config seed and the surfaces merged into one target, but no board
  // was skipped: the merge is reported on its own, not as a skipped board.
  const loopCounters = result.lifecycle.loopCounters as unknown as Record<string, number>;
  assert.equal(loopCounters.atsBoardDuplicatesSkipped, 0, JSON.stringify(loopCounters));
  assert.ok(loopCounters.atsTargetsMerged >= 1, JSON.stringify(loopCounters));
  const logged = logs.find(([event]) => event === "discovery.run.ats_board_duplicate_skipped");
  assert.ok(logged, "merged targets are still logged");
  assert.equal(logged[1].count, 0);
  assert.ok(Number(logged[1].mergedTargets) >= 1);
});

test("D7: merging keeps the richest metadata and unions board hints", () => {
  const merged = mergeAtsCompanyTargets([
    { name: "Scale Ai", companyKey: "scale-ai", boardHints: { ashby: "scale" } },
    {
      name: "Scale AI",
      companyKey: "scaleai",
      domains: ["scale.com"],
      aliases: ["Scale"],
      boardHints: { greenhouse: "scaleai" },
    },
    { name: "Figma", companyKey: "figma", boardHints: { greenhouse: "figma" } },
  ]);
  assert.equal(merged.mergedCount, 1);
  assert.deepEqual(names(merged.companies), ["Scale AI", "Figma"]);
  const scale = merged.companies[0];
  assert.deepEqual(scale.domains, ["scale.com"]);
  assert.equal(scale.boardHints?.greenhouse, "scaleai");
  assert.equal(scale.boardHints?.ashby, "scale");
});

test("D6: yield ordering puts a proven company first", () => {
  const stats = buildCompanyYieldStats([
    coverage("figma", "run_2", 300, 9, 1),
    coverage("notion", "run_2", 100, 0, 1),
    coverage("figma", "run_1", 300, 3, 2),
  ]);
  const figma = stats.get("figma");
  assert.equal(figma?.runs, 2);
  assert.equal(figma?.listingsSeen, 600);
  assert.equal(figma?.listingsWritten, 12);
  const plan = planAtsCompanyOrder(
    [{ name: "Notion" }, { name: "Figma" }],
    stats,
    NOW_MS,
  );
  assert.deepEqual(names(plan.companies), ["Figma", "Notion"]);
});

test("D6: yield history reads only the most recent 10 rows per company", () => {
  const rows: IntentCoverageRecord[] = [];
  for (let run = 0; run < 12; run += 1) {
    // Ten recent zero-yield runs, then two old productive ones.
    rows.push(coverage("acme", `run_${run}`, 10, run >= 10 ? 10 : 0, run));
  }
  const acme = buildCompanyYieldStats(rows).get("acme");
  assert.equal(acme?.runs, 10);
  assert.equal(acme?.listingsWritten, 0);
});

test("D6: a zero-yield company cools down and the exploration slot still admits one", () => {
  const stats = buildCompanyYieldStats([
    coverage("scaleai", "run_2", 203, 0, 1),
    coverage("scaleai", "run_1", 203, 0, 2),
    coverage("notion", "run_2", 128, 0, 3),
    coverage("notion", "run_1", 128, 0, 4),
    coverage("thetradedesk", "run_2", 60, 0, 3),
    coverage("thetradedesk", "run_1", 60, 0, 5),
    coverage("figma", "run_2", 300, 6, 1),
  ]);
  const plan = planAtsCompanyOrder(
    [{ name: "Scale AI" }, { name: "Notion" }, { name: "The Trade Desk" }, { name: "Figma" }],
    stats,
    NOW_MS,
  );
  // Scale AI and Notion qualify (2 runs, >=150 seen, 0 written). Notion was
  // last tried longest ago (3 days vs 1), so it takes the exploration slot.
  // The Trade Desk has seen only 120 listings, so it stays in the plan.
  assert.deepEqual(plan.cooledDown.map((c) => c.name), ["Scale AI"]);
  assert.equal(plan.explorationAdmitted?.name, "Notion");
  assert.ok(names(plan.companies).includes("Notion"));
  assert.ok(!names(plan.companies).includes("Scale AI"));
  assert.equal(names(plan.companies)[0], "Figma");
});

test("D6: the exploration slot rotates to the oldest-last-tried cooled company", () => {
  const stats = buildCompanyYieldStats([
    coverage("a", "run_3", 200, 0, 1),
    coverage("a", "run_2", 200, 0, 2),
    coverage("b", "run_3", 200, 0, 5),
    coverage("b", "run_1", 200, 0, 6),
  ]);
  const plan = planAtsCompanyOrder([{ name: "A" }, { name: "B" }], stats, NOW_MS);
  assert.equal(plan.explorationAdmitted?.name, "B");
  assert.deepEqual(plan.cooledDown.map((c) => c.name), ["A"]);
});

test("D6: a cooldown expires after the cooldown window", () => {
  const old = ATS_COOLDOWN_DAYS + 1;
  const stats = buildCompanyYieldStats([
    coverage("a", "run_2", 200, 0, old),
    coverage("a", "run_1", 200, 0, old + 1),
    coverage("b", "run_2", 200, 0, 1),
    coverage("b", "run_1", 200, 0, 2),
  ]);
  const plan = planAtsCompanyOrder([{ name: "A" }, { name: "B" }], stats, NOW_MS);
  assert.deepEqual(plan.cooledDown, []);
  assert.deepEqual(names(plan.companies).sort(), ["A", "B"]);
});

test("D6: a new company is not starved behind zero-yield history", () => {
  const stats = buildCompanyYieldStats([
    coverage("figma", "run_1", 400, 4, 1),
    coverage("notion", "run_1", 100, 0, 1),
  ]);
  const plan = planAtsCompanyOrder(
    [{ name: "Notion" }, { name: "Brand New Co" }, { name: "Figma" }],
    stats,
    NOW_MS,
  );
  assert.deepEqual(names(plan.companies), ["Figma", "Brand New Co", "Notion"]);
  assert.equal(plan.priorYield, 0.5 * 0.005);
});

test("D6: a run skips a cooled ATS company, logs it and counts it", async () => {
  const { registry, detected } = boardsByCompany({
    scaleai: [["greenhouse", "scaleai"]],
    notion: [["greenhouse", "notion"]],
    figma: [["greenhouse", "figma"]],
  });
  const { dependencies, logs } = makeDeps({
    companies: ["Scale AI", "Notion", "Figma"],
    enabledSources: ["greenhouse"],
    sourceAdapterRegistry: registry,
    discoveryMemoryStore: snapshotWith({
      intentCoverage: [
        coverage("scaleai", "run_2", 1015, 0, 1),
        coverage("scaleai", "run_1", 203, 0, 1),
        coverage("notion", "run_2", 256, 0, 2),
        coverage("notion", "run_1", 128, 0, 3),
        coverage("figma", "run_2", 489, 4, 1),
      ],
    }),
  });
  const result = await runDiscovery(
    makeRequest(),
    "manual",
    dependencies as never,
  );
  assert.deepEqual(detected, ["Figma", "Notion"]);
  const cooldown = logs.find(([event]) => event === "discovery.run.ats_company_cooldown");
  assert.ok(cooldown, "cooldown must be logged");
  assert.deepEqual(cooldown[1].skipped, ["scaleai"]);
  assert.equal(cooldown[1].explorationAdmitted, "notion");
  const loopCounters = result.lifecycle.loopCounters as unknown as Record<string, number>;
  assert.equal(loopCounters.atsCompaniesCooledDown, 1);
});

test("D7: one board reached through two different company keys is listed once", async () => {
  const { registry, listed } = boardsByCompany({
    scaleai: [["greenhouse", "scaleai"]],
    scale: [["greenhouse", "scaleai"]],
  });
  const { dependencies, logs } = makeDeps({
    companies: ["Scale AI", "Scale"],
    enabledSources: ["greenhouse"],
    sourceAdapterRegistry: registry,
    discoveryMemoryStore: snapshotWith({}),
  });
  await runDiscovery(makeRequest(), "manual", dependencies as never);
  assert.deepEqual(listed, ["greenhouse:scaleai"]);
  const skipped = logs.find(([event]) => event === "discovery.run.ats_board_duplicate_skipped");
  assert.deepEqual(skipped?.[1].skippedBoards, ["greenhouse:scaleai"]);
  assert.equal(skipped?.[1].count, 1);
});

test("D6: the memory snapshot keeps coverage whose key differs from the registry key only in punctuation", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDiscoveryMemoryStore } = await import(
    "../../src/state/discovery-memory-store.ts"
  );
  const dir = mkdtempSync(join(tmpdir(), "discat-c2-"));
  const store = createDiscoveryMemoryStore(join(dir, "mem.sqlite"));
  try {
    // The registry keys companies by slug ("scale-ai"); intent coverage keys
    // them by normalizeCompanyKey ("scaleai").
    store.upsertCompany({
      companyKey: "scale-ai",
      displayName: "Scale AI",
      normalizedName: "scale ai",
      atsHints: { greenhouse: ["scaleai"] },
      lastSeenAt: NOW,
      lastSuccessAt: NOW,
      successIncrement: 1,
    });
    store.writeIntentCoverage({
      intentKey: "intent:seeded",
      companyKey: "scaleai",
      runId: "run_1",
      sourceLane: "ats_provider",
      surfacesSeen: 0,
      listingsSeen: 203,
      listingsWritten: 0,
    });
    const snapshot = store.loadPlannerSnapshot({ intentKey: "intent:seeded", now: NOW });
    assert.deepEqual(
      snapshot.intentCoverage.map((row) => row.companyKey),
      ["scaleai"],
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("D6: intent coverage counts only leads the sheet actually wrote", async () => {
  const listingsByBoard: Record<string, { title: string; url: string }> = {
    figma: { title: "Backend Engineer", url: "https://boards.greenhouse.io/figma/jobs/1" },
    notion: { title: "Backend Engineer", url: "https://boards.greenhouse.io/notion/jobs/2" },
  };
  const registry = {
    adapters: [],
    detectBoards: async ({ company }: { company: CompanyTarget }) => {
      const token = company.name.toLowerCase();
      return listingsByBoard[token]
        ? [
            {
              matched: true,
              sourceId: "greenhouse",
              sourceLabel: "greenhouse",
              boardUrl: `https://boards.greenhouse.io/${token}`,
              canonicalUrl: `https://boards.greenhouse.io/${token}`,
              boardToken: token,
              confidence: 1,
              warnings: [],
            },
          ]
        : [];
    },
    collectListings: async (
      _run: unknown,
      detections: Array<{ boardToken: string }>,
    ) =>
      detections.map((detection) => ({
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        company: detection.boardToken === "figma" ? "Figma" : "Notion",
        location: "Remote",
        tags: ["node"],
        descriptionText: "Build node typescript services. Remote.",
        ...listingsByBoard[detection.boardToken],
      })),
  };
  const coverageWrites: Array<Record<string, unknown>> = [];
  const store = {
    ...snapshotWith({}),
    recordIntentCoverage: (record: Record<string, unknown>) => {
      coverageWrites.push(record);
    },
  };
  const { dependencies } = makeDeps({
    companies: ["Figma", "Notion"],
    enabledSources: ["greenhouse"],
    sourceAdapterRegistry: registry,
    discoveryMemoryStore: store,
  });
  // The sheet wrote Figma's lead and skipped Notion's as blacklisted.
  (dependencies as Record<string, unknown>).pipelineWriter = {
    write: async (sheetId: string) => ({
      sheetId,
      appended: 1,
      updated: 0,
      skippedDuplicates: 0,
      skippedBlacklist: 1,
      warnings: [],
      writtenLinks: [listingsByBoard.figma.url],
      skippedLinks: [{ url: listingsByBoard.notion.url, reason: "blacklisted" }],
    }),
  };
  await runDiscovery(makeRequest(), "manual", dependencies as never);
  const written = Object.fromEntries(
    coverageWrites.map((row) => [row.companyKey, row.listingsWritten]),
  );
  assert.deepEqual(written, { figma: 1, notion: 0 });
});

test("D6: intent coverage counts no written listings when the sheet write failed", async () => {
  const registry = {
    adapters: [],
    detectBoards: async () => [
      {
        matched: true,
        sourceId: "greenhouse",
        sourceLabel: "greenhouse",
        boardUrl: "https://boards.greenhouse.io/figma",
        canonicalUrl: "https://boards.greenhouse.io/figma",
        boardToken: "figma",
        confidence: 1,
        warnings: [],
      },
    ],
    collectListings: async () => [
      {
        sourceId: "greenhouse",
        sourceLabel: "Greenhouse",
        company: "Figma",
        title: "Backend Engineer",
        url: "https://boards.greenhouse.io/figma/jobs/1",
        location: "Remote",
        tags: ["node"],
        descriptionText: "Build node typescript services. Remote.",
      },
    ],
  };
  const coverageWrites: Array<Record<string, unknown>> = [];
  const store = {
    ...snapshotWith({}),
    recordIntentCoverage: (record: Record<string, unknown>) => {
      coverageWrites.push(record);
    },
  };
  const { dependencies } = makeDeps({
    companies: ["Figma"],
    enabledSources: ["greenhouse"],
    sourceAdapterRegistry: registry,
    discoveryMemoryStore: store,
  });
  (dependencies as Record<string, unknown>).pipelineWriter = {
    write: async () => {
      throw new SheetWriteError({
        phase: "append",
        message: "HTTP 500",
        sheetId: "sheet_probe",
        httpStatus: 500,
      });
    },
  };
  await runDiscovery(makeRequest(), "manual", dependencies as never);
  const figma = coverageWrites.find((row) => row.companyKey === "figma");
  assert.ok(figma, JSON.stringify(coverageWrites));
  assert.equal(figma.listingsWritten, 0);
});

// --- DISCAT Fix-A (C2): yield history is per company across intents, and
// cooldown spares companies whose listings passed the filters.

test("Fix-A: a company whose listings passed the filters but lost at selection never cools down", () => {
  const stats = buildCompanyYieldStats([
    { ...coverage("townsquaremedia", "run_2", 105, 0, 1), listingsAccepted: 3 },
    { ...coverage("townsquaremedia", "run_1", 105, 0, 2), listingsAccepted: 0 },
    { ...coverage("thetradedesk", "run_2", 99, 0, 1), listingsAccepted: 0 },
    { ...coverage("thetradedesk", "run_1", 99, 0, 3), listingsAccepted: 0 },
    { ...coverage("adweek", "run_2", 120, 0, 1), listingsAccepted: 0 },
    { ...coverage("adweek", "run_1", 120, 0, 2), listingsAccepted: 0 },
  ]);
  assert.equal(stats.get("townsquaremedia")?.listingsAccepted, 3);
  const plan = planAtsCompanyOrder(
    [{ name: "Townsquare Media" }, { name: "The Trade Desk" }, { name: "Adweek" }],
    stats,
    NOW_MS,
  );
  // All three have >= 2 runs, >= 150 seen and 0 written. Only the two with
  // zero accepted listings are cooldown candidates; The Trade Desk (tried
  // longest ago) takes the exploration slot.
  assert.equal(plan.explorationAdmitted?.name, "The Trade Desk");
  assert.deepEqual(plan.cooledDown.map((c) => c.name), ["Adweek"]);
  assert.ok(names(plan.companies).includes("Townsquare Media"));
});

test("Fix-A: the snapshot aggregates yield history per company across intent keys (Run 09 / Run 70 replay)", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDiscoveryMemoryStore } = await import(
    "../../src/state/discovery-memory-store.ts"
  );
  const { createRunDiscoveryMemoryStore } = await import(
    "../../src/state/run-discovery-memory-store.ts"
  );
  const dir = mkdtempSync(join(tmpdir(), "discat-fa-c2-"));
  const raw = createDiscoveryMemoryStore(join(dir, "mem.sqlite"));
  try {
    // Query rotation: run 09 and run 70 recorded under different intent keys.
    // Seen counts are the snapshot's coverage rows (REPORT-I3 / REPORT-I1).
    const INTENT_09 = "intent:run09";
    const INTENT_70 = "intent:run70";
    const rows: Array<[string, string, string, number, number, number, number]> = [
      // [intent, run, company, seen, written, accepted, daysAgo]
      [INTENT_09, "run_09", "scaleai", 1015, 5, 160, 2],
      [INTENT_09, "run_09", "figma", 489, 6, 130, 2],
      [INTENT_09, "run_09", "notion", 256, 1, 8, 2],
      [INTENT_09, "run_09", "thetradedesk", 99, 0, 0, 2],
      [INTENT_09, "run_09", "townsquaremedia", 105, 0, 2, 2],
      [INTENT_09, "run_09", "mediaocean", 2, 0, 0, 2],
      [INTENT_70, "run_70", "scaleai", 203, 2, 40, 1],
      [INTENT_70, "run_70", "figma", 163, 2, 41, 1],
      [INTENT_70, "run_70", "notion", 128, 1, 4, 1],
      [INTENT_70, "run_70", "thetradedesk", 99, 0, 0, 1],
      [INTENT_70, "run_70", "townsquaremedia", 105, 0, 1, 1],
    ];
    for (const [intentKey, runId, companyKey, seen, written, accepted, daysAgo] of rows) {
      const startedAt = new Date(NOW_MS - daysAgo * DAY_MS).toISOString();
      raw.writeIntentCoverage({
        intentKey,
        companyKey,
        runId,
        sourceLane: "ats_provider",
        surfacesSeen: 0,
        listingsSeen: seen,
        listingsWritten: written,
        startedAt,
        completedAt: startedAt,
      });
      if (accepted > 0) {
        raw.writeExploitOutcome({
          runId,
          intentKey,
          companyKey,
          sourceId: "greenhouse",
          sourceLane: "ats_provider",
          surfaceType: "provider_board",
          canonicalUrl: `https://boards.greenhouse.io/${companyKey}`,
          observedAt: startedAt,
          listingsSeen: seen,
          listingsAccepted: accepted,
          listingsRejected: seen - accepted,
          listingsWritten: written,
        });
      }
    }
    // The next run's rotated query has yet another intent key.
    const snapshot = await createRunDiscoveryMemoryStore(raw).loadSnapshot({
      run: { request: { requestedAt: NOW } } as never,
      intentKey: "intent:next-rotation",
    });
    const stats = buildCompanyYieldStats(snapshot.intentCoverage);
    assert.equal(stats.get("figma")?.runs, 2, "Figma history spans both intents");
    assert.equal(stats.get("figma")?.listingsSeen, 652);
    assert.equal(stats.get("figma")?.listingsWritten, 8);
    assert.equal(stats.get("scaleai")?.listingsSeen, 1218);
    assert.equal(stats.get("scaleai")?.listingsWritten, 7);
    assert.equal(stats.get("notion")?.listingsSeen, 384);
    assert.equal(stats.get("townsquaremedia")?.listingsAccepted, 3);
    assert.equal(stats.get("thetradedesk")?.listingsAccepted, 0);

    const plan = planAtsCompanyOrder(
      [
        { name: "Figma" },
        { name: "Scale AI" },
        { name: "Mediaocean" },
        { name: "Notion" },
        { name: "The Trade Desk" },
        { name: "Townsquare Media" },
      ],
      stats,
      NOW_MS,
    );
    // Aggregated yield: Figma 8/652 > Scale AI 7/1218 > Notion 2/384; zero
    // yields keep config order. The Trade Desk (2 runs, 198 seen, nothing
    // written or accepted) is the only cooldown candidate and takes the
    // exploration slot; Townsquare Media had accepted listings, so it is spared.
    assert.deepEqual(names(plan.companies), [
      "Figma",
      "Scale AI",
      "Notion",
      "Mediaocean",
      "The Trade Desk",
      "Townsquare Media",
    ]);
    assert.equal(plan.explorationAdmitted?.name, "The Trade Desk");
    assert.deepEqual(plan.cooledDown, []);
  } finally {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("D6: the snapshot's coverage window reads only the last 180 days of history", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDiscoveryMemoryStore } = await import(
    "../../src/state/discovery-memory-store.ts"
  );
  const dir = mkdtempSync(join(tmpdir(), "discat-c2-window-"));
  const raw = createDiscoveryMemoryStore(join(dir, "mem.sqlite"));
  try {
    const write = (runId: string, companyKey: string, daysAgo: number) => {
      const startedAt = new Date(NOW_MS - daysAgo * DAY_MS).toISOString();
      raw.writeIntentCoverage({
        intentKey: "intent:a",
        companyKey,
        runId,
        sourceLane: "ats_provider",
        surfacesSeen: 0,
        listingsSeen: 10,
        listingsWritten: 1,
        startedAt,
        completedAt: startedAt,
      });
    };
    write("run_old", "figma", 200);
    write("run_edge", "figma", 179);
    write("run_recent", "figma", 3);
    write("run_ancient", "notion", 400);
    for (let index = 0; index < 12; index += 1) write(`run_s${index}`, "scaleai", index + 1);
    const snapshot = raw.loadPlannerSnapshot({ intentKey: "intent:b", now: NOW });
    const runsOf = (company: string) =>
      snapshot.intentCoverage
        .filter((row) => row.companyKey === company)
        .map((row) => row.runId)
        .sort();
    assert.deepEqual(runsOf("figma"), ["run_edge", "run_recent"]);
    assert.deepEqual(runsOf("notion"), []);
    assert.equal(runsOf("scaleai").length, 10, "the per-company last-10 window still applies");
    assert.ok(!runsOf("scaleai").includes("run_s11"), "the oldest rows fall outside the window");
  } finally {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
