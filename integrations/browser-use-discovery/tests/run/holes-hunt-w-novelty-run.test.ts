// HOLES HUNT (docs/INTERFACE-HUNTS.md §6): runDiscovery reserves its
// exploration share of the ATS company slots, runs never-tried companies
// early, records every slot's yield in the ledger and reports it as
// lifecycle.exploration.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
  type DiscoveryExplorationSlot,
  type IntentCoverageRecord,
} from "../../src/contracts.ts";
import { mergeDiscoveryConfig } from "../../src/config.ts";
import { runDiscovery } from "../../src/run/run-discovery.ts";
import { createDiscoveryMemoryStore } from "../../src/state/discovery-memory-store.ts";
import { createRunDiscoveryMemoryStore } from "../../src/state/run-discovery-memory-store.ts";

const NOW = "2026-10-02T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

// Hermetic: never score against the developer's ~/.jobbored/profile.json.
const originalProfilePath = process.env.JOBBORED_PROFILE_PATH;
process.env.JOBBORED_PROFILE_PATH = join(tmpdir(), "holes-hunt-no-profile", "absent.json");
test.after(() => {
  if (originalProfilePath === undefined) delete process.env.JOBBORED_PROFILE_PATH;
  else process.env.JOBBORED_PROFILE_PATH = originalProfilePath;
});

const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`holes-hunt: network blocked (${String(input)})`);
  }) as typeof fetch;
});
test.after(() => {
  globalThis.fetch = originalFetch;
});

const COMPANIES = ["Acme", "Globex", "Initech", "Hooli", "Umbrella"];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

type NoveltyKind = "company" | "surface" | "provider" | "facet";
type Candidate = {
  companyKey: string;
  name: string;
  source: "candidate_catalog" | "listing_fingerprints" | "company_registry";
};

/** A NoveltyMemory double that records what the run asked and wrote. */
function fakeNoveltyMemory(input: {
  tried?: Partial<Record<NoveltyKind, string[]>>;
  candidates?: Candidate[];
  failRecord?: boolean;
  failTried?: boolean;
}) {
  const triedQueries: Array<[NoveltyKind, string[]]> = [];
  const candidateQueries: Array<Record<string, unknown>> = [];
  const recorded: Array<{
    runId: string;
    recordedAt: string;
    share: number;
    slots: readonly DiscoveryExplorationSlot[];
  }> = [];
  const memory = {
    listTriedNoveltyKeys(kind: NoveltyKind, keys: readonly string[]) {
      if (input.failTried) throw new Error("ledger unavailable");
      triedQueries.push([kind, [...keys]]);
      return new Set(keys.filter((key) => (input.tried?.[kind] || []).includes(key)));
    },
    // Deliberately ignores excludeCompanyKeys: the run must not trust the
    // pool to have honoured its own exclusions.
    listNoveltyCandidates(query: Record<string, unknown>) {
      candidateQueries.push(query);
      return [...(input.candidates || [])];
    },
    recordNoveltySlots(record: (typeof recorded)[number]) {
      if (input.failRecord) throw new Error("disk full");
      recorded.push(record);
    },
    listNoveltySlots() {
      return [];
    },
  };
  return { memory, triedQueries, candidateQueries, recorded };
}

function makeRun(options: {
  companies?: string[];
  /** Listings per company name on its (single) greenhouse board. */
  listings?: Record<string, number>;
  noveltyMemory?: unknown;
  explorationShare?: number;
  explorationShareForRun?: (runId: string) => number | null;
  discoveryMemoryStore?: unknown;
  request?: Record<string, unknown>;
  storedConfig?: Record<string, unknown>;
  runId?: string;
}) {
  const detected: string[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  let seq = 0;
  const dependencies = {
    runtimeConfig: { runMode: "hosted", allowedOrigins: [], port: 0, host: "127.0.0.1" },
    sourceAdapterRegistry: {
      adapters: [],
      detectBoards: async ({ company }: { company: { name: string } }) => {
        detected.push(company.name);
        return [
          {
            matched: true,
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            boardUrl: `https://boards.greenhouse.io/${slug(company.name)}`,
            canonicalUrl: `https://boards.greenhouse.io/${slug(company.name)}`,
            boardToken: slug(company.name),
            confidence: 1,
            warnings: [],
          },
        ];
      },
      collectListings: async (_run: unknown, detections: Array<{ boardToken: string }>) =>
        detections.flatMap((detection) => {
          const name = Object.keys(options.listings || {}).find(
            (company) => slug(company) === detection.boardToken,
          );
          if (!name) return [];
          return Array.from({ length: options.listings?.[name] || 0 }, (_, index) => ({
            sourceId: "greenhouse",
            sourceLabel: "Greenhouse",
            company: name,
            // One role per listing: no dedupe rule folds a company's listings.
            title: index === 0 ? "Backend Engineer" : `Backend Engineer, Team ${index + 1}`,
            location: "Remote",
            url: `https://boards.greenhouse.io/${slug(name)}/jobs/${index + 1}`,
            compensationText: "$180k-$220k",
            tags: ["node"],
            descriptionText: `Build node typescript services at ${name}. Remote.`,
          }));
        }),
    },
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
      sheetId: "sheet_novelty",
      mode: "hosted",
      timezone: "UTC",
      companies: (options.companies || COMPANIES).map((name) => ({ name })),
      includeKeywords: ["node"],
      excludeKeywords: [],
      targetRoles: ["Backend Engineer"],
      locations: ["Remote"],
      remotePolicy: "",
      seniority: "",
      maxLeadsPerRun: 25,
      enabledSources: ["greenhouse"],
      schedule: { enabled: false, cron: "" },
      sourcePreset: "ats_only",
      ...(options.storedConfig || {}),
    }),
    mergeDiscoveryConfig,
    now: () => new Date(NOW),
    randomId: (prefix: string) => `${prefix}_${++seq}`,
    log: (event: string, details: Record<string, unknown>) => logs.push([event, details]),
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.discoveryMemoryStore ? { discoveryMemoryStore: options.discoveryMemoryStore } : {}),
    ...(options.noveltyMemory ? { noveltyMemory: options.noveltyMemory } : {}),
    ...(options.explorationShare !== undefined ? { explorationShare: options.explorationShare } : {}),
    ...(options.explorationShareForRun ? { explorationShareForRun: options.explorationShareForRun } : {}),
  };
  const request = {
    event: DISCOVERY_WEBHOOK_EVENT,
    schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
    sheetId: "sheet_novelty",
    variationKey: "v",
    requestedAt: NOW,
    discoveryProfile: {
      targetRoles: "Backend Engineer",
      keywordsInclude: "node",
      sourcePreset: "ats_only",
    },
    ...(options.request || {}),
  };
  return {
    run: () => runDiscovery(request as never, "manual", dependencies as never),
    detected,
    logs,
  };
}

function coverage(companyKey: string, runId: string, seen: number, written: number, days: number): IntentCoverageRecord {
  const startedAt = new Date(Date.parse(NOW) - days * DAY_MS).toISOString();
  return {
    intentKey: "intent:seeded",
    companyKey,
    runId,
    sourceLane: "ats_provider",
    surfacesSeen: 0,
    listingsSeen: seen,
    listingsWritten: written,
    startedAt,
    completedAt: startedAt,
  };
}

function snapshotStore(intentCoverage: IntentCoverageRecord[]) {
  return {
    loadSnapshot: () => ({
      intentKey: "intent:seeded",
      companies: [],
      careerSurfaces: [],
      deadLinks: [],
      listingFingerprints: [],
      intentCoverage,
      roleFamilies: [],
    }),
  };
}

const TRIED_FOUR = { company: ["acme", "globex", "initech", "hooli"] };

test("HUNT-W run: the run reserves its share, explores a never-tried company first and reports each slot's yield", async () => {
  const novelty = fakeNoveltyMemory({
    tried: TRIED_FOUR,
    candidates: [{ companyKey: "wayneenterprises", name: "Wayne Enterprises", source: "candidate_catalog" }],
  });
  const { run, detected } = makeRun({
    noveltyMemory: novelty.memory,
    listings: { Acme: 1, Globex: 1, Umbrella: 2, "Wayne Enterprises": 1 },
  });
  const result = await run();

  // 5 planned x 0.3 = round(1.5) = 2 reserved: never-tried Umbrella first,
  // then one candidate, round(1 / 0.3) = 3 positions later.
  assert.deepEqual(detected, ["Umbrella", "Acme", "Globex", "Wayne Enterprises", "Initech", "Hooli"]);
  const exploration = result.lifecycle.exploration;
  assert.ok(exploration, "lifecycle.exploration must be reported");
  assert.equal(exploration.share, 0.3);
  assert.equal(exploration.reservedSlots, 2);
  assert.equal(exploration.slotCount, 6);
  assert.deepEqual(
    exploration.slots.map((slot) => [slot.index, slot.kind, slot.key, slot.mode, slot.listingsSeen, slot.leadsWritten]),
    [
      [0, "company", "umbrella", "explore", 2, 2],
      [1, "company", "acme", "exploit", 1, 1],
      [2, "company", "globex", "exploit", 1, 1],
      [3, "company", "wayneenterprises", "explore", 1, 1],
      [4, "company", "initech", "exploit", 0, 0],
      [5, "company", "hooli", "exploit", 0, 0],
      // The run's facet combination is one more slot carrying the whole run.
      [6, "facet", exploration.slots[6]?.key, "explore", 5, 5],
    ],
  );
  assert.match(String(exploration.slots[6]?.key), /^intent:[0-9a-f]{16}$/);
  assert.deepEqual(exploration.totals, {
    explore: { slots: 2, listingsSeen: 3, leadsWritten: 3 },
    exploit: { slots: 4, listingsSeen: 2, leadsWritten: 2 },
  });

  assert.equal(novelty.recorded.length, 1);
  assert.deepEqual(novelty.recorded[0], {
    runId: result.run.runId,
    recordedAt: NOW,
    share: 0.3,
    slots: exploration.slots,
  });
  assert.equal(novelty.candidateQueries.length, 1);
  const query = novelty.candidateQueries[0];
  assert.equal(query.sheetId, "sheet_novelty");
  assert.equal(query.now, NOW);
  assert.ok(Number(query.limit) >= 2);
  for (const key of ["acme", "globex", "initech", "hooli", "umbrella"]) {
    assert.ok(
      (query.excludeCompanyKeys as string[]).includes(key),
      `planned ${key} must be excluded from the pool (${JSON.stringify(query.excludeCompanyKeys)})`,
    );
  }
});

test("HUNT-W run: explorationShareForRun overrides the configured share, which overrides the default", async () => {
  const seenRunIds: string[] = [];
  const candidates: Candidate[] = [
    { companyKey: "wayneenterprises", name: "Wayne Enterprises", source: "candidate_catalog" },
    { companyKey: "starkindustries", name: "Stark Industries", source: "company_registry" },
  ];
  const hunt = fakeNoveltyMemory({ tried: TRIED_FOUR, candidates });
  const huntRun = await makeRun({
    runId: "run_hunt",
    noveltyMemory: hunt.memory,
    explorationShare: 0.1,
    explorationShareForRun: (runId) => {
      seenRunIds.push(runId);
      return 0.6;
    },
  }).run();
  assert.deepEqual(seenRunIds, ["run_hunt"]);
  assert.equal(huntRun.lifecycle.exploration?.share, 0.6);
  // round(0.6 x 5) = 3: Umbrella plus both candidates.
  assert.equal(huntRun.lifecycle.exploration?.reservedSlots, 3);
  assert.equal(huntRun.lifecycle.exploration?.totals.explore.slots, 3);
  assert.equal(hunt.recorded[0]?.share, 0.6);

  const plain = fakeNoveltyMemory({ tried: TRIED_FOUR, candidates });
  const plainRun = await makeRun({
    noveltyMemory: plain.memory,
    explorationShare: 0.1,
    explorationShareForRun: () => null,
  }).run();
  assert.equal(plainRun.lifecycle.exploration?.share, 0.1);
  // max(1, round(0.5)) = 1, and never-tried Umbrella already fills it.
  assert.equal(plainRun.lifecycle.exploration?.reservedSlots, 1);
  assert.equal(plainRun.lifecycle.exploration?.slotCount, 5);
});

test("HUNT-W run: cooled-down and blocked candidates never join the run", async () => {
  const novelty = fakeNoveltyMemory({
    tried: { company: ["acme", "globex", "scaleai", "notion"] },
    candidates: [
      { companyKey: "scaleai", name: "Scale AI", source: "candidate_catalog" },
      { companyKey: "wayneenterprises", name: "Wayne Enterprises", source: "company_registry" },
      { companyKey: "starkindustries", name: "Stark Industries", source: "listing_fingerprints" },
    ],
  });
  const { run, detected } = makeRun({
    companies: ["Scale AI", "Notion", "Acme", "Globex"],
    noveltyMemory: novelty.memory,
    explorationShare: 1,
    request: { companyBlocklist: ["Wayne Enterprises"] },
    // Scale AI and Notion qualify for the zero-yield cooldown; Notion was
    // tried longest ago, so it is the one cooled company admitted.
    discoveryMemoryStore: snapshotStore([
      coverage("scaleai", "run_2", 1015, 0, 1),
      coverage("scaleai", "run_1", 203, 0, 1),
      coverage("notion", "run_2", 256, 0, 2),
      coverage("notion", "run_1", 128, 0, 3),
    ]),
  });
  const result = await run();
  assert.ok(!detected.includes("Scale AI"), `a cooled company is never re-added (${detected})`);
  assert.ok(!detected.includes("Wayne Enterprises"), `a blocked company is never added (${detected})`);
  assert.ok(detected.includes("Stark Industries"));
  assert.ok(
    (novelty.candidateQueries[0]?.excludeCompanyKeys as string[]).includes("scaleai"),
    "the pool query excludes the cooled company too",
  );
  assert.equal(result.lifecycle.exploration?.slotCount, 4);
});

test("HUNT-W run: a company the user skipped is never explored", async () => {
  const novelty = fakeNoveltyMemory({
    tried: TRIED_FOUR,
    candidates: [
      { companyKey: "wayneenterprises", name: "Wayne Enterprises", source: "candidate_catalog" },
      { companyKey: "starkindustries", name: "Stark Industries", source: "company_registry" },
    ],
  });
  const { run, detected } = makeRun({
    noveltyMemory: novelty.memory,
    explorationShare: 0.6,
    storedConfig: { negativeCompanyKeys: ["wayneenterprises"] },
  });
  await run();
  assert.ok(!detected.includes("Wayne Enterprises"), `a skipped company is never explored (${detected})`);
  assert.ok(detected.includes("Stark Industries"));
});

test("HUNT-W run: without noveltyMemory the run keeps its order, adds nothing and still reports exploration", async () => {
  const { run, detected } = makeRun({
    listings: { Acme: 1 },
    discoveryMemoryStore: snapshotStore([
      coverage("acme", "run_1", 10, 1, 1),
      coverage("globex", "run_1", 10, 0, 1),
    ]),
  });
  const result = await run();
  // The D6 yield order, untouched: proven Acme, the unknowns, zero-yield Globex.
  assert.deepEqual(detected, ["Acme", "Initech", "Hooli", "Umbrella", "Globex"]);
  const exploration = result.lifecycle.exploration;
  assert.ok(exploration);
  assert.equal(exploration.reservedSlots, 2);
  assert.equal(exploration.slotCount, 5);
  assert.deepEqual(
    exploration.slots.map((slot) => [slot.label, slot.mode]),
    [
      ["Acme", "exploit"],
      ["Initech", "explore"],
      ["Hooli", "explore"],
      ["Umbrella", "explore"],
      ["Globex", "exploit"],
      [exploration.slots[5]?.label, "explore"],
    ],
  );
  assert.equal(exploration.slots[0]?.listingsSeen, 1);
});

test("HUNT-W run: a run without ATS lanes omits exploration and records nothing", async () => {
  const novelty = fakeNoveltyMemory({ tried: TRIED_FOUR });
  const { run, detected } = makeRun({
    noveltyMemory: novelty.memory,
    storedConfig: { enabledSources: ["grounded_web"], sourcePreset: "browser_only" },
    request: {
      discoveryProfile: {
        targetRoles: "Backend Engineer",
        keywordsInclude: "node",
        sourcePreset: "browser_only",
      },
    },
  });
  const result = await run();
  assert.deepEqual(detected, []);
  assert.equal(result.lifecycle.exploration, undefined);
  assert.deepEqual(novelty.triedQueries, []);
  assert.deepEqual(novelty.recorded, []);
});

test("HUNT-W run: a failing ledger write is logged and never fails the run", async () => {
  const novelty = fakeNoveltyMemory({ tried: TRIED_FOUR, failRecord: true });
  const { run, logs } = makeRun({ noveltyMemory: novelty.memory, listings: { Acme: 1 } });
  const result = await run();
  assert.equal(result.lifecycle.state, "completed");
  assert.ok(result.lifecycle.exploration, "the run still reports its slots");
  const failure = logs.find(([event]) => event === "discovery.run.novelty_record_failed");
  assert.ok(failure, "the failed ledger write must be logged");
  assert.match(String(failure[1].error), /disk full/);
});

test("HUNT-W run: a failing novelty plan is logged and the run keeps its order", async () => {
  const novelty = fakeNoveltyMemory({ failTried: true });
  const { run, detected, logs } = makeRun({ noveltyMemory: novelty.memory });
  const result = await run();
  assert.deepEqual(detected, COMPANIES);
  assert.equal(result.lifecycle.exploration, undefined);
  assert.ok(logs.some(([event]) => event === "discovery.run.novelty_plan_failed"));
  assert.deepEqual(novelty.recorded, []);
});

test("HUNT-W run: with the real memory store, the next identical run exploits what this one explored", async () => {
  const dir = mkdtempSync(join(tmpdir(), "holes-hunt-novelty-run-"));
  const raw = createDiscoveryMemoryStore(join(dir, "worker-state.sqlite"));
  try {
    // A registry company with no ATS hints is never planned: a candidate.
    raw.upsertCompany({ companyKey: "stark-industries", displayName: "Stark Industries", lastSeenAt: NOW });
    const shared = {
      companies: ["Acme", "Globex"],
      listings: { Acme: 1, Globex: 1, "Stark Industries": 1 },
      discoveryMemoryStore: createRunDiscoveryMemoryStore(raw),
      noveltyMemory: raw,
    };
    const first = makeRun({ ...shared, runId: "run_first" });
    const firstResult = await first.run();
    assert.deepEqual(first.detected, ["Acme", "Globex"]);
    assert.deepEqual(
      firstResult.lifecycle.exploration?.slots.map((slot) => [slot.key, slot.mode]),
      [["acme", "explore"], ["globex", "explore"], [firstResult.lifecycle.exploration?.slots[2]?.key, "explore"]],
    );
    assert.deepEqual(raw.listNoveltySlots("run_first"), firstResult.lifecycle.exploration?.slots);

    const second = makeRun({ ...shared, runId: "run_second" });
    const secondResult = await second.run();
    // Both planned companies are tried now, so the registry candidate
    // takes the reserved slot and runs first.
    assert.deepEqual(second.detected, ["Stark Industries", "Acme", "Globex"]);
    assert.deepEqual(
      secondResult.lifecycle.exploration?.slots.map((slot) => [slot.key, slot.mode, slot.leadsWritten]),
      [
        ["starkindustries", "explore", 1],
        ["acme", "exploit", 1],
        ["globex", "exploit", 1],
        [firstResult.lifecycle.exploration?.slots[2]?.key, "exploit", 3],
      ],
    );
    assert.deepEqual(
      [...raw.listTriedNoveltyKeys("company", ["starkindustries", "acme", "wonka"])],
      ["starkindustries", "acme"],
    );
  } finally {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
