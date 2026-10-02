// HOLES HUNT (docs/INTERFACE-HUNTS.md §6): the exploration ledger lives in
// the discovery memory store (worker-state.sqlite): novelty_ledger keeps
// what was ever tried, novelty_slots keeps each run's slots and yield.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { DiscoveryExplorationSlot } from "../../src/contracts.ts";
import { createDiscoveryMemoryStore } from "../../src/state/discovery-memory-store.ts";

const NOW = "2026-10-02T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY_MS).toISOString();
}

async function withStore(
  fn: (
    store: ReturnType<typeof createDiscoveryMemoryStore>,
    databasePath: string,
  ) => void | Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "holes-hunt-novelty-"));
  const databasePath = join(dir, "worker-state.sqlite");
  const store = createDiscoveryMemoryStore(databasePath);
  try {
    await fn(store, databasePath);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function readRows(databasePath: string, sql: string, ...params: Array<string | number>) {
  const database = new DatabaseSync(databasePath);
  try {
    return database.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  } finally {
    database.close();
  }
}

function catalogEntry(fingerprintKey: string, companyKey: string, company?: string) {
  return {
    fingerprintKey,
    companyKey,
    title: "Backend Engineer",
    url: `https://boards.example/${companyKey}/${fingerprintKey}`,
    sourceId: "grounded_web",
    status: company ? ("backlog" as const) : ("rejected" as const),
    rejectReason: company ? "" : "excluded_keyword",
    rejectDetail: "",
    fitScore: company ? 7 : null,
    matchScore: null,
    leadPayload: company ? { company, title: "Backend Engineer" } : null,
  };
}

function fingerprint(companyKey: string, seenAt: string) {
  return {
    companyKey,
    titleKey: "backend engineer",
    locationKey: "remote",
    remoteBucket: "remote",
    canonicalUrl: `https://jobs.example/${companyKey.replace(/\s+/g, "-")}/1`,
    seenAt,
    runId: "run_seen",
    sheetId: "sheet_a",
  };
}

function slot(overrides: Partial<DiscoveryExplorationSlot> & Pick<DiscoveryExplorationSlot, "index" | "key">): DiscoveryExplorationSlot {
  return {
    kind: "company",
    label: overrides.key,
    mode: "explore",
    listingsSeen: 0,
    leadsWritten: 0,
    ...overrides,
  };
}

test("HUNT-W ledger: novelty_ledger and novelty_slots exist with their primary keys", async () => {
  await withStore((_store, databasePath) => {
    const columns = (table: string) =>
      readRows(databasePath, `PRAGMA table_info(${table})`).map((column) => [
        String(column.name),
        Number(column.pk),
      ]);
    assert.deepEqual(columns("novelty_ledger"), [
      ["entity_kind", 1],
      ["entity_key", 2],
      ["first_tried_at", 0],
      ["last_tried_at", 0],
      ["tries", 0],
      ["explore_tries", 0],
      ["listings_seen", 0],
      ["leads_written", 0],
      ["last_run_id", 0],
    ]);
    const slotColumns = columns("novelty_slots");
    assert.deepEqual(
      slotColumns.filter(([, pk]) => pk > 0),
      [["run_id", 1], ["slot_index", 2]],
    );
    for (const name of [
      "kind", "entity_key", "label", "provider", "mode",
      "listings_seen", "leads_written", "recorded_at",
    ]) {
      assert.ok(
        slotColumns.some(([column]) => column === name),
        `novelty_slots must carry ${name} (${JSON.stringify(slotColumns)})`,
      );
    }
  });
});

test("HUNT-W ledger: candidates come from this sheet's catalog, listing fingerprints and the company registry, newest first", async () => {
  await withStore((store) => {
    store.recordCandidateCatalog({
      runId: "run_old",
      sheetId: "sheet_a",
      observedAt: daysAgo(3),
      entries: [catalogEntry("k1", "acmecorp", "Acme Corp")],
    });
    store.recordCandidateCatalog({
      runId: "run_older",
      sheetId: "sheet_a",
      observedAt: daysAgo(9),
      entries: [catalogEntry("k2", "globex")],
    });
    // Another sheet's catalog is not this run's to explore.
    store.recordCandidateCatalog({
      runId: "run_other_sheet",
      sheetId: "sheet_b",
      observedAt: daysAgo(1),
      entries: [catalogEntry("k3", "initech", "Initech")],
    });
    store.upsertListingFingerprint(fingerprint("hooli inc", daysAgo(2)));
    store.upsertCompany({
      companyKey: "umbrella-corp",
      displayName: "Umbrella Corp",
      lastSeenAt: daysAgo(5),
    });
    store.upsertCompany({
      companyKey: "soylent",
      displayName: "Soylent",
      lastSeenAt: daysAgo(7),
      cooldownUntil: daysAgo(1),
    });

    const candidates = store.listNoveltyCandidates({
      sheetId: "sheet_a",
      now: NOW,
      limit: 10,
      excludeCompanyKeys: [],
    });
    assert.deepEqual(candidates, [
      { companyKey: "hooliinc", name: "Hooli Inc", source: "listing_fingerprints" },
      { companyKey: "acmecorp", name: "Acme Corp", source: "candidate_catalog" },
      { companyKey: "umbrella-corp", name: "Umbrella Corp", source: "company_registry" },
      // An expired cooldown no longer holds a company back.
      { companyKey: "soylent", name: "Soylent", source: "company_registry" },
      // A rejected row keeps no lead payload: the name falls back to the
      // humanized key, as it does for a fingerprint.
      { companyKey: "globex", name: "Globex", source: "candidate_catalog" },
    ]);
    assert.deepEqual(
      store
        .listNoveltyCandidates({ sheetId: "sheet_a", now: NOW, limit: 2, excludeCompanyKeys: [] })
        .map((entry) => entry.companyKey),
      ["hooliinc", "acmecorp"],
    );
  });
});

test("HUNT-W ledger: tried, cooling and excluded companies are never candidates", async () => {
  await withStore((store) => {
    store.recordCandidateCatalog({
      runId: "run_old",
      sheetId: "sheet_a",
      observedAt: daysAgo(3),
      entries: [
        catalogEntry("k1", "acmecorp", "Acme Corp"),
        catalogEntry("k2", "globex", "Globex"),
        catalogEntry("k3", "cyberdyne", "Cyberdyne"),
        catalogEntry("k4", "initech", "Initech"),
        catalogEntry("k5", "hooli", "Hooli"),
      ],
    });
    // Intent coverage keys can be slugs; they compare normalized.
    store.writeIntentCoverage({
      intentKey: "intent:any",
      companyKey: "acme-corp",
      runId: "run_old",
      sourceLane: "grounded_web",
      listingsSeen: 4,
      startedAt: daysAgo(3),
    });
    store.recordNoveltySlots({
      runId: "run_old",
      recordedAt: daysAgo(3),
      share: 0.3,
      slots: [slot({ index: 0, key: "globex", label: "Globex" })],
    });
    // A registry row that is cooling down holds the company back everywhere.
    store.upsertCompany({
      companyKey: "cyberdyne",
      displayName: "Cyberdyne",
      cooldownUntil: new Date(Date.parse(NOW) + DAY_MS).toISOString(),
    });
    const candidates = store.listNoveltyCandidates({
      sheetId: "sheet_a",
      now: NOW,
      limit: 10,
      excludeCompanyKeys: ["initech"],
    });
    assert.deepEqual(candidates.map((entry) => entry.companyKey), ["hooli"]);
  });
});

test("HUNT-W ledger: intent coverage, exploit outcomes and the ledger make keys tried; a fingerprint alone does not", async () => {
  await withStore((store) => {
    store.writeIntentCoverage({
      intentKey: "intent:seen",
      companyKey: "scale-ai",
      runId: "run_1",
      sourceLane: "ats_provider",
      listingsSeen: 12,
      startedAt: daysAgo(2),
    });
    store.upsertListingFingerprint(fingerprint("hooli inc", daysAgo(2)));
    store.writeExploitOutcome({
      runId: "run_1",
      intentKey: "intent:seen",
      surfaceId: "greenhouse:acme",
      companyKey: "acme",
      sourceId: "greenhouse",
      sourceLane: "ats_provider",
      surfaceType: "provider_board",
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
      observedAt: daysAgo(2),
    });
    assert.deepEqual(
      [...store.listTriedNoveltyKeys("company", ["scaleai", "figma", "hooliinc"])],
      ["scaleai"],
      "coverage marks a company tried; a fingerprint is a candidate source, not a try",
    );
    assert.deepEqual(
      [...store.listTriedNoveltyKeys("facet", ["intent:seen", "intent:new"])],
      ["intent:seen"],
    );
    assert.deepEqual(
      [...store.listTriedNoveltyKeys("surface", ["greenhouse:acme", "lever:acme"])],
      ["greenhouse:acme"],
    );
    assert.deepEqual(
      [...store.listTriedNoveltyKeys("provider", ["greenhouse", "workday"])],
      ["greenhouse"],
    );
    assert.deepEqual([...store.listTriedNoveltyKeys("company", [])], []);

    store.recordNoveltySlots({
      runId: "run_2",
      recordedAt: daysAgo(1),
      share: 0.3,
      slots: [
        slot({ index: 0, key: "figma", label: "Figma", provider: "lever" }),
        slot({ index: 1, kind: "surface", key: "ashby:hooli", label: "Hooli" }),
        slot({ index: 2, kind: "facet", key: "intent:new", label: "Backend" }),
      ],
    });
    assert.deepEqual([...store.listTriedNoveltyKeys("company", ["figma", "hooliinc"])], ["figma"]);
    assert.deepEqual([...store.listTriedNoveltyKeys("surface", ["ashby:hooli"])], ["ashby:hooli"]);
    assert.deepEqual([...store.listTriedNoveltyKeys("provider", ["lever", "workday"])], ["lever"]);
    assert.deepEqual([...store.listTriedNoveltyKeys("facet", ["intent:new"])], ["intent:new"]);
  });
});

test("HUNT-W ledger: recordNoveltySlots round-trips through listNoveltySlots", async () => {
  await withStore((store) => {
    const slots: DiscoveryExplorationSlot[] = [
      slot({ index: 0, key: "acme", label: "Acme", provider: "greenhouse", listingsSeen: 4, leadsWritten: 1 }),
      slot({ index: 1, kind: "surface", key: "lever:globex", label: "Globex", provider: "lever", mode: "exploit", listingsSeen: 2 }),
      slot({ index: 2, kind: "facet", key: "intent:abc", label: "Backend Engineer", listingsSeen: 6, leadsWritten: 1 }),
    ];
    store.recordNoveltySlots({ runId: "run_1", recordedAt: NOW, share: 0.3, slots });
    assert.deepEqual(store.listNoveltySlots("run_1"), slots);
    assert.deepEqual(store.listNoveltySlots("run_unknown"), []);
  });
});

test("HUNT-W ledger: ledger counters add up across runs, and a re-recorded run counts once", async () => {
  await withStore((store, databasePath) => {
    store.recordNoveltySlots({
      runId: "run_1",
      recordedAt: daysAgo(2),
      share: 0.3,
      slots: [slot({ index: 0, key: "acme", label: "Acme", provider: "greenhouse", listingsSeen: 4, leadsWritten: 1 })],
    });
    store.recordNoveltySlots({
      runId: "run_2",
      recordedAt: daysAgo(1),
      share: 0.5,
      slots: [
        slot({ index: 0, key: "globex", label: "Globex", provider: "greenhouse", listingsSeen: 5 }),
        slot({ index: 1, key: "acme", label: "Acme", provider: "greenhouse", mode: "exploit", listingsSeen: 3, leadsWritten: 2 }),
      ],
    });
    // Recording run_1 again (a retry) must not count it twice.
    store.recordNoveltySlots({
      runId: "run_1",
      recordedAt: daysAgo(2),
      share: 0.3,
      slots: [slot({ index: 0, key: "acme", label: "Acme", provider: "greenhouse", listingsSeen: 4, leadsWritten: 1 })],
    });
    const ledger = readRows(
      databasePath,
      "SELECT * FROM novelty_ledger ORDER BY entity_kind, entity_key",
    ).map((row) => ({ ...row }));
    assert.deepEqual(ledger, [
      {
        entity_kind: "company",
        entity_key: "acme",
        first_tried_at: daysAgo(2),
        last_tried_at: daysAgo(1),
        tries: 2,
        explore_tries: 1,
        listings_seen: 7,
        leads_written: 3,
        last_run_id: "run_2",
      },
      {
        entity_kind: "company",
        entity_key: "globex",
        first_tried_at: daysAgo(1),
        last_tried_at: daysAgo(1),
        tries: 1,
        explore_tries: 1,
        listings_seen: 5,
        leads_written: 0,
        last_run_id: "run_2",
      },
      {
        entity_kind: "provider",
        entity_key: "greenhouse",
        first_tried_at: daysAgo(2),
        last_tried_at: daysAgo(1),
        tries: 3,
        explore_tries: 2,
        listings_seen: 12,
        leads_written: 3,
        last_run_id: "run_2",
      },
    ]);
    assert.equal(store.listNoveltySlots("run_1").length, 1);
    assert.equal(store.listNoveltySlots("run_2").length, 2);
  });
});
