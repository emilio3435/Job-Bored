// DISCAT C1: the candidate catalog table in the discovery memory store.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CandidateCatalogEntry } from "../../src/contracts.ts";
import { createDiscoveryMemoryStore } from "../../src/state/discovery-memory-store.ts";
import { DatabaseSync } from "node:sqlite";

async function withStore(
  fn: (store: ReturnType<typeof createDiscoveryMemoryStore>) => void | Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "discat-catalog-"));
  const store = createDiscoveryMemoryStore(join(dir, "worker-state.sqlite"));
  try {
    await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function entry(
  fingerprintKey: string,
  overrides: Partial<CandidateCatalogEntry> = {},
): CandidateCatalogEntry {
  return {
    fingerprintKey,
    companyKey: "acme",
    title: "Backend Engineer",
    url: `https://boards.greenhouse.io/acme/jobs/${fingerprintKey}`,
    sourceId: "greenhouse",
    status: "rejected",
    rejectReason: "",
    rejectDetail: "",
    fitScore: null,
    matchScore: null,
    leadPayload: null,
    ...overrides,
  };
}

test("should insert catalog rows and bump seen_count only once per run", async () => {
  await withStore((store) => {
    const first = store.recordCandidateCatalog({
      runId: "run_1",
      sheetId: "sheet_a",
      observedAt: "2026-09-20T00:00:00.000Z",
      entries: [
        entry("k1", { rejectReason: "excluded_keyword", rejectDetail: "php" }),
        entry("k2", { status: "backlog", fitScore: 6, leadPayload: { title: "x" } }),
      ],
    });
    assert.equal(first.recorded, 2);
    // Same run again (idempotent re-record) does not bump seen_count.
    store.recordCandidateCatalog({
      runId: "run_1",
      sheetId: "sheet_a",
      observedAt: "2026-09-20T00:00:00.000Z",
      entries: [entry("k1", { rejectReason: "excluded_keyword" })],
    });
    store.recordCandidateCatalog({
      runId: "run_2",
      sheetId: "sheet_a",
      observedAt: "2026-09-21T00:00:00.000Z",
      entries: [entry("k1", { rejectReason: "headline_mismatch" })],
    });
    const listed = store.listCandidates({ limit: 10 });
    const k1 = listed.rows.find((row) => row.fingerprintKey === "k1");
    assert.ok(k1);
    assert.equal(k1.seenCount, 2);
    assert.equal(k1.firstSeenAt, "2026-09-20T00:00:00.000Z");
    assert.equal(k1.lastSeenAt, "2026-09-21T00:00:00.000Z");
    assert.equal(k1.lastRunId, "run_2");
    assert.equal(k1.rejectReason, "headline_mismatch");
    assert.equal(listed.counts.rejected, 1);
    assert.equal(listed.counts.backlog, 1);
    assert.equal(listed.total, 2);
    assert.equal(store.getCounts().candidateCatalog, 2);
  });
});

test("should never regress a written or promoted row to rejected or backlog", async () => {
  await withStore((store) => {
    store.recordCandidateCatalog({
      runId: "run_1",
      sheetId: "sheet_a",
      observedAt: "2026-09-20T00:00:00.000Z",
      entries: [
        entry("w", { status: "written" }),
        entry("b", { status: "backlog", leadPayload: { title: "b" } }),
      ],
    });
    store.markCandidatesPromoted({
      sheetId: "sheet_a",
      runId: "run_2",
      promotedAt: "2026-09-21T00:00:00.000Z",
      fingerprintKeys: ["b"],
    });
    store.recordCandidateCatalog({
      runId: "run_3",
      sheetId: "sheet_a",
      observedAt: "2026-09-22T00:00:00.000Z",
      entries: [
        entry("w", { status: "rejected", rejectReason: "excluded_keyword" }),
        entry("b", { status: "backlog", leadPayload: { title: "b2" } }),
      ],
    });
    const rows = store.listCandidates({ limit: 10 }).rows;
    assert.equal(rows.find((row) => row.fingerprintKey === "w")?.status, "written");
    assert.equal(rows.find((row) => row.fingerprintKey === "w")?.rejectReason, "");
    assert.equal(rows.find((row) => row.fingerprintKey === "b")?.status, "promoted");
    // A backlog row re-seen as rejected (filters changed) is no longer promotable.
    store.recordCandidateCatalog({
      runId: "run_4",
      sheetId: "sheet_a",
      observedAt: "2026-09-23T00:00:00.000Z",
      entries: [entry("n", { status: "backlog", leadPayload: { title: "n" } })],
    });
    store.recordCandidateCatalog({
      runId: "run_5",
      sheetId: "sheet_a",
      observedAt: "2026-09-24T00:00:00.000Z",
      entries: [entry("n", { status: "rejected", rejectReason: "headline_mismatch" })],
    });
    assert.equal(
      store.listCandidates({ status: "rejected", limit: 10 }).rows[0]?.fingerprintKey,
      "n",
    );
  });
});

test("should list fresh backlog best score first, excluding keys and other sheets", async () => {
  await withStore((store) => {
    store.recordCandidateCatalog({
      runId: "run_1",
      sheetId: "sheet_a",
      observedAt: "2026-09-20T00:00:00.000Z",
      entries: [
        entry("low", { status: "backlog", fitScore: 3, leadPayload: { title: "low" } }),
        entry("high", { status: "backlog", matchScore: 9, fitScore: 5, leadPayload: { title: "high" } }),
        entry("mid", { status: "backlog", matchScore: 7, leadPayload: { title: "mid" } }),
        entry("gone", { status: "backlog", matchScore: 10, leadPayload: { title: "gone" } }),
      ],
    });
    store.recordCandidateCatalog({
      runId: "run_old",
      sheetId: "sheet_a",
      observedAt: "2026-09-01T00:00:00.000Z",
      entries: [entry("stale", { status: "backlog", matchScore: 10, leadPayload: { title: "stale" } })],
    });
    store.recordCandidateCatalog({
      runId: "run_b",
      sheetId: "sheet_b",
      observedAt: "2026-09-20T00:00:00.000Z",
      entries: [entry("other", { status: "backlog", matchScore: 10, leadPayload: { title: "other" } })],
    });
    const backlog = store.listBacklogCandidates({
      sheetId: "sheet_a",
      seenSince: "2026-09-10T00:00:00.000Z",
      excludeFingerprintKeys: ["gone"],
      // Fix-A: known fit below 5 never promotes.
      minFitScore: 5,
      limit: 2,
    });
    assert.deepEqual(
      backlog.map((row) => row.fingerprintKey),
      ["high", "mid"],
    );
    assert.deepEqual(backlog[0].leadPayload, { title: "high" });
  });
});

test("should expire stale backlog, prune rows older than 90 days, and cap the table", async () => {
  await withStore((store) => {
    store.recordCandidateCatalog({
      runId: "run_old",
      sheetId: "sheet_a",
      observedAt: "2026-05-01T00:00:00.000Z",
      entries: [entry("ancient"), entry("ancient_written", { status: "written" })],
    });
    store.recordCandidateCatalog({
      runId: "run_mid",
      sheetId: "sheet_a",
      observedAt: "2026-09-01T00:00:00.000Z",
      entries: [entry("r1")],
    });
    store.recordCandidateCatalog({
      runId: "run_mid2",
      sheetId: "sheet_a",
      observedAt: "2026-09-05T00:00:00.000Z",
      entries: [
        entry("old_backlog", { status: "backlog", leadPayload: { title: "x" } }),
      ],
    });
    store.recordCandidateCatalog({
      runId: "run_new",
      sheetId: "sheet_a",
      observedAt: "2026-09-26T00:00:00.000Z",
      entries: [entry("r2"), entry("fresh_backlog", { status: "backlog", leadPayload: { title: "y" } })],
    });
    const result = store.pruneCandidateCatalog({
      now: "2026-09-27T00:00:00.000Z",
      maxRows: 3,
    });
    assert.equal(result.expired, 1);
    // 2 aged out (>90d) + 1 over the 3-row cap (oldest last_seen first).
    assert.equal(result.deleted, 3);
    const keys = store
      .listCandidates({ limit: 10 })
      .rows.map((row) => row.fingerprintKey)
      .sort();
    assert.deepEqual(keys, ["fresh_backlog", "old_backlog", "r2"]);
    const expired = store.listCandidates({ status: "expired", limit: 10 }).rows;
    assert.equal(expired[0]?.fingerprintKey, "old_backlog");
    assert.equal(expired[0]?.leadPayload, null);
  });
});

test("should batch-upsert listing fingerprints and skip rows missing required keys", async () => {
  await withStore((store) => {
    const result = store.upsertListingFingerprints([
      {
        companyKey: "acme",
        titleKey: "backend engineer",
        locationKey: "remote",
        canonicalUrlKey: "url:https://boards.greenhouse.io/acme/jobs/1",
        remoteBucket: "remote",
        seenAt: "2026-09-20T00:00:00.000Z",
        runId: "run_1",
        sheetId: "sheet_a",
        sourceIds: ["greenhouse"],
      },
      {
        companyKey: "",
        titleKey: "backend engineer",
        locationKey: "remote",
        remoteBucket: "remote",
      },
    ]);
    assert.deepEqual(result, { upserted: 1, skipped: 1 });
    assert.equal(store.getCounts().listingFingerprints, 1);
  });
});

test("should list backlog only for the requested intent key", async () => {
  await withStore((store) => {
    const observedAt = "2026-09-20T00:00:00.000Z";
    store.recordCandidateCatalog({
      runId: "run_1",
      sheetId: "sheet_a",
      intentKey: "intent:a",
      observedAt,
      entries: [entry("k1", { status: "backlog", leadPayload: { title: "a" } })],
    });
    store.recordCandidateCatalog({
      runId: "run_2",
      sheetId: "sheet_a",
      intentKey: "intent:b",
      observedAt,
      entries: [entry("k2", { status: "backlog", leadPayload: { title: "b" } })],
    });
    const keys = (intentKey: string) =>
      store
        .listBacklogCandidates({
          sheetId: "sheet_a",
          seenSince: "2026-09-01T00:00:00.000Z",
          intentKey,
          limit: 10,
        })
        .map((row) => row.fingerprintKey);
    assert.deepEqual(keys("intent:a"), ["k1"]);
    assert.deepEqual(keys("intent:b"), ["k2"]);
    assert.deepEqual(keys("intent:c"), []);
  });
});

test("should add the intent_key column to a catalog created before it existed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "discat-catalog-migrate-"));
  const path = join(dir, "worker-state.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE candidate_catalog (
        sheet_id TEXT NOT NULL,
        fingerprint_key TEXT NOT NULL,
        company_key TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        source_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        reject_reason TEXT NOT NULL DEFAULT '',
        reject_detail TEXT NOT NULL DEFAULT '',
        fit_score REAL,
        match_score REAL,
        lead_json TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        last_run_id TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (sheet_id, fingerprint_key)
      );
      INSERT INTO candidate_catalog (sheet_id, fingerprint_key, status, lead_json,
        first_seen_at, last_seen_at)
      VALUES ('sheet_a', 'old', 'backlog', '{"title":"old"}',
        '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z');
    `);
    legacy.close();
    const store = createDiscoveryMemoryStore(path);
    try {
      const query = {
        sheetId: "sheet_a",
        seenSince: "2026-09-01T00:00:00.000Z",
        limit: 10,
      };
      // A pre-migration row has no intent, so it never matches one.
      assert.deepEqual(store.listBacklogCandidates({ ...query, intentKey: "intent:a" }), []);
      store.recordCandidateCatalog({
        runId: "run_1",
        sheetId: "sheet_a",
        intentKey: "intent:a",
        observedAt: "2026-09-21T00:00:00.000Z",
        entries: [entry("new", { status: "backlog", leadPayload: { title: "new" } })],
      });
      assert.deepEqual(
        store
          .listBacklogCandidates({ ...query, intentKey: "intent:a" })
          .map((row) => row.fingerprintKey),
        ["new"],
      );
    } finally {
      store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- DISCAT Fix-A (C1): backlog ranks like fresh selection, novelty lookup,
// and bounded listing_fingerprints.

test("should rank backlog by fit score before match score and apply the fit floor", async () => {
  await withStore((store) => {
    store.recordCandidateCatalog({
      runId: "run_1",
      sheetId: "sheet_a",
      observedAt: "2026-09-20T00:00:00.000Z",
      entries: [
        entry("hardware", { status: "backlog", fitScore: 1, matchScore: 9, leadPayload: { title: "Hardware Engineer" } }),
        entry("sales", { status: "backlog", fitScore: 9, matchScore: 6, leadPayload: { title: "Digital Sales Director" } }),
        entry("unscored", { status: "backlog", fitScore: null, matchScore: 10, leadPayload: { title: "Unscored" } }),
        entry("ok", { status: "backlog", fitScore: 6, matchScore: 2, leadPayload: { title: "Ok" } }),
      ],
    });
    const unfloored = store.listBacklogCandidates({
      sheetId: "sheet_a",
      seenSince: "2026-09-10T00:00:00.000Z",
      limit: 10,
    });
    assert.deepEqual(
      unfloored.map((row) => row.fingerprintKey),
      ["sales", "ok", "hardware", "unscored"],
      "known fit first, best fit first; unknown fit last",
    );
    const floored = store.listBacklogCandidates({
      sheetId: "sheet_a",
      seenSince: "2026-09-10T00:00:00.000Z",
      minFitScore: 5,
      limit: 10,
    });
    assert.deepEqual(
      floored.map((row) => row.fingerprintKey),
      ["sales", "ok", "unscored"],
      "low-fit backlog is never listed; unknown fit stays eligible",
    );
  });
});

test("should report which fingerprint keys this sheet already wrote or promoted", async () => {
  await withStore((store) => {
    store.recordCandidateCatalog({
      runId: "run_1",
      sheetId: "sheet_a",
      observedAt: "2026-09-20T00:00:00.000Z",
      entries: [
        entry("w", { status: "written" }),
        entry("p", { status: "backlog", leadPayload: { title: "p" } }),
        entry("b", { status: "backlog", leadPayload: { title: "b" } }),
        entry("r"),
      ],
    });
    store.markCandidatesPromoted({
      sheetId: "sheet_a",
      runId: "run_2",
      promotedAt: "2026-09-21T00:00:00.000Z",
      fingerprintKeys: ["p"],
    });
    store.recordCandidateCatalog({
      runId: "run_b",
      sheetId: "sheet_b",
      observedAt: "2026-09-20T00:00:00.000Z",
      entries: [entry("other", { status: "written" })],
    });
    const written = store.listWrittenCandidateKeys({
      sheetId: "sheet_a",
      fingerprintKeys: ["w", "p", "b", "r", "other", "missing"],
    });
    assert.deepEqual([...written].sort(), ["p", "w"]);
  });
});

test("should prune listing fingerprints unseen for 90 days during catalog retention", async () => {
  await withStore((store) => {
    const fingerprint = (id: string, seenAt: string) => ({
      companyKey: "acme",
      titleKey: `backend engineer ${id}`,
      locationKey: "remote",
      canonicalUrlKey: `url:https://boards.greenhouse.io/acme/jobs/${id}`,
      remoteBucket: "remote",
      seenAt,
      runId: `run_${id}`,
      sheetId: "sheet_a",
      sourceIds: ["greenhouse"],
    });
    store.upsertListingFingerprints([
      fingerprint("old", "2026-05-01T00:00:00.000Z"),
      fingerprint("new", "2026-09-20T00:00:00.000Z"),
    ]);
    assert.equal(store.getCounts().listingFingerprints, 2);
    const result = store.pruneCandidateCatalog({ now: "2026-09-27T00:00:00.000Z" });
    assert.equal(result.fingerprintsDeleted, 1);
    assert.equal(store.getCounts().listingFingerprints, 1);
  });
});
