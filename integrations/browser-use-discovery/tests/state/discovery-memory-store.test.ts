import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildAcceptedRunStatus,
  createDiscoveryRunStatusStore,
} from "../../src/state/run-status-store.ts";
import {
  buildSemanticKey,
  buildUrlKey,
  createDiscoveryMemoryStore,
} from "../../src/state/discovery-memory-store.ts";

async function makeTempDbPath(): Promise<{ tempDir: string; dbPath: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-discovery-memory-"));
  return {
    tempDir,
    dbPath: join(tempDir, "worker-state.sqlite"),
  };
}

test("discovery memory store creates normalized tables without disturbing discovery_run_status", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();

  try {
    const runStatusStore = createDiscoveryRunStatusStore(dbPath);
    runStatusStore.put(
      buildAcceptedRunStatus({
        runId: "run_123",
        trigger: "manual",
        request: {
          sheetId: "sheet_123",
          variationKey: "var_123",
          requestedAt: "2026-04-10T08:00:00.000Z",
        },
        acceptedAt: "2026-04-10T08:00:05.000Z",
      }),
    );
    runStatusStore.close();

    const memoryStore = createDiscoveryMemoryStore(dbPath);
    memoryStore.close();

    const database = new DatabaseSync(dbPath);
    try {
      const tables = database
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
            ORDER BY name
          `,
        )
        .all() as Array<{ name: string }>;

      assert.deepEqual(
        tables.map((row) => row.name).filter((name) =>
          [
            "career_surfaces",
            "company_registry",
            "dead_link_cache",
            "discovery_run_status",
            "host_suppressions",
            "intent_coverage",
            "listing_fingerprints",
          ].includes(name),
        ),
        [
          "career_surfaces",
          "company_registry",
          "dead_link_cache",
          "discovery_run_status",
          "host_suppressions",
          "intent_coverage",
          "listing_fingerprints",
        ],
      );
    } finally {
      database.close();
    }

    const runStatusReader = createDiscoveryRunStatusStore(dbPath);
    try {
      const payload = runStatusReader.get("run_123");
      assert.equal(payload?.runId, "run_123");
      assert.equal(payload?.status, "accepted");
    } finally {
      runStatusReader.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("company registry, surface outcomes, and intent coverage load back through the planner snapshot API", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();

  try {
    const store = createDiscoveryMemoryStore(dbPath);
    try {
      const companyAfterSuccess = store.upsertCompany({
        companyKey: "acme-ai",
        displayName: "Acme AI",
        aliases: ["AcmeAI"],
        domains: ["acme.ai"],
        atsHints: { greenhouse: "acme-ai" },
        geoTags: ["remote-us"],
        roleTags: ["platform"],
        confidence: 0.91,
        lastSeenAt: "2026-04-10T10:00:00.000Z",
        successIncrement: 1,
        lastSuccessAt: "2026-04-10T10:00:00.000Z",
      });
      const companyAfterFailure = store.upsertCompany({
        companyKey: "acme-ai",
        displayName: "Acme AI",
        domains: ["careers.acme.ai"],
        lastSeenAt: "2026-04-11T11:00:00.000Z",
        failureIncrement: 1,
        cooldownUntil: "2026-04-15T00:00:00.000Z",
      });

      const verifiedSurface = store.markCareerSurfaceSuccess({
        companyKey: "acme-ai",
        surfaceType: "ats_board",
        providerType: "greenhouse",
        canonicalUrl: "https://boards.greenhouse.io/acme-ai/",
        finalUrl: "https://boards.greenhouse.io/acme-ai?utm_source=linkedin",
        sourceLane: "ats_first",
        checkedAt: "2026-04-10T10:00:00.000Z",
        metadata: { detector: "public_api" },
      });

      const failedSurface = store.markCareerSurfaceFailure({
        companyKey: "acme-ai",
        surfaceType: "careers_page",
        providerType: "company_site",
        canonicalUrl: "https://careers.acme.ai/jobs",
        sourceLane: "company_surface",
        checkedAt: "2026-04-11T11:00:00.000Z",
        failureReason: "404_not_found",
        cooldownUntil: "2026-04-15T00:00:00.000Z",
        metadata: { httpStatus: 404 },
      });

      const coverage = store.writeIntentCoverage({
        intentKey: "platform|remote-us|staff",
        companyKey: "acme-ai",
        runId: "run_456",
        sourceLane: "ats_first",
        surfacesSeen: 2,
        listingsSeen: 7,
        listingsWritten: 3,
        startedAt: "2026-04-11T10:55:00.000Z",
        completedAt: "2026-04-11T11:05:00.000Z",
      });

      const snapshot = store.loadPlannerSnapshot({
        intentKey: "platform|remote-us|staff",
        companyKeys: ["acme-ai"],
        now: "2026-04-13T09:00:00.000Z",
        includeCoolingDownCompanies: true,
        includeCoolingDownSurfaces: true,
        includeUnverifiedSurfaces: true,
      });

      assert.equal(companyAfterSuccess.successCount, 1);
      assert.equal(companyAfterFailure.failureCount, 1);
      assert.equal(companyAfterFailure.cooldownUntil, "2026-04-15T00:00:00.000Z");

      assert.equal(verifiedSurface.verifiedStatus, "verified");
      assert.equal(verifiedSurface.host, "boards.greenhouse.io");
      assert.deepEqual(verifiedSurface.metadata, { detector: "public_api" });

      assert.equal(failedSurface.verifiedStatus, "failed");
      assert.equal(failedSurface.failureReason, "404_not_found");
      assert.equal(failedSurface.failureStreak, 1);
      assert.equal(failedSurface.cooldownUntil, "2026-04-15T00:00:00.000Z");

      assert.equal(coverage.listingsWritten, 3);
      assert.equal(snapshot.companies.length, 1);
      assert.equal(snapshot.careerSurfaces.length, 2);
      assert.equal(snapshot.intentCoverage.length, 1);

      const [company] = snapshot.companies;
      assert.equal(company.companyKey, "acme-ai");
      assert.equal(company.successCount, 1);
      assert.equal(company.failureCount, 1);
      assert.equal(company.lastSuccessAt, "2026-04-10T10:00:00.000Z");
      assert.equal(company.cooldownUntil, "2026-04-15T00:00:00.000Z");
      assert.deepEqual(company.domains, ["acme.ai", "careers.acme.ai"]);
      assert.deepEqual(company.atsHints, { greenhouse: ["acme-ai"] });

      const failedSnapshotSurface = snapshot.careerSurfaces.find(
        (surface) => surface.surfaceId === failedSurface.surfaceId,
      );
      assert.ok(failedSnapshotSurface);
      assert.deepEqual(failedSnapshotSurface?.metadata, { httpStatus: 404 });
    } finally {
      store.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("dead-link records track retry cooldowns and can be cleared", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();

  try {
    const store = createDiscoveryMemoryStore(dbPath);
    try {
      const first = store.upsertDeadLink({
        url: "https://jobs.example.com/open-roles?utm_source=linkedin",
        reasonCode: "http_error",
        httpStatus: 429,
        lastTitle: "Open roles",
        lastSeenAt: "2026-04-10T09:00:00.000Z",
        nextRetryAt: "2026-04-18T00:00:00.000Z",
      });
      const second = store.upsertDeadLink({
        url: "https://jobs.example.com/open-roles",
        reasonCode: "http_error",
        httpStatus: 503,
        lastSeenAt: "2026-04-11T09:00:00.000Z",
        nextRetryAt: "2026-04-20T00:00:00.000Z",
      });

      assert.equal(first.urlKey, buildUrlKey("https://jobs.example.com/open-roles"));
      assert.equal(second.failureCount, 2);
      assert.equal(second.httpStatus, 503);
      assert.equal(
        store.isDeadLinkCoolingDown(
          "https://jobs.example.com/open-roles",
          "2026-04-16T00:00:00.000Z",
        ),
        true,
      );
      assert.equal(
        store.getDeadLink("https://jobs.example.com/open-roles")?.nextRetryAt,
        "2026-04-20T00:00:00.000Z",
      );

      store.clearDeadLink("https://jobs.example.com/open-roles");
      assert.equal(store.getDeadLink("https://jobs.example.com/open-roles"), null);
    } finally {
      store.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upsertListingFingerprint preserves semantic identity and merges cross-run source evidence", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();

  try {
    const store = createDiscoveryMemoryStore(dbPath);
    try {
      const semanticKey = buildSemanticKey({
        companyKey: "acme-ai",
        titleKey: "staff platform engineer",
        locationKey: "remote us",
        remoteBucket: "remote",
      });
      const first = store.upsertListingFingerprint({
        companyKey: "acme-ai",
        titleKey: "staff platform engineer",
        locationKey: "remote us",
        canonicalUrl: "https://boards.greenhouse.io/acme-ai/jobs/123?utm_source=linkedin",
        externalJobId: "123",
        remoteBucket: "remote",
        employmentType: "full_time",
        contentHash: "hash-v1",
        seenAt: "2026-04-10T08:00:00.000Z",
        runId: "run_a",
        sourceIds: ["greenhouse"],
      });

      const second = store.upsertListingFingerprint({
        companyKey: "acme-ai",
        titleKey: "staff platform engineer",
        locationKey: "remote us",
        canonicalUrl: "https://boards.greenhouse.io/acme-ai/jobs/123",
        externalJobId: "123",
        remoteBucket: "remote",
        employmentType: "full_time",
        contentHash: "hash-v2",
        seenAt: "2026-04-12T08:00:00.000Z",
        writtenAt: "2026-04-12T09:00:00.000Z",
        runId: "run_b",
        sheetId: "sheet_123",
        sourceIds: ["lever", "greenhouse"],
      });

      const found = store.findListingFingerprint({
        companyKey: "acme-ai",
        titleKey: "staff platform engineer",
        locationKey: "remote us",
        remoteBucket: "remote",
      });

      assert.ok(semanticKey);
      assert.equal(first.fingerprintKey, second.fingerprintKey);
      assert.equal(second.firstSeenAt, "2026-04-10T08:00:00.000Z");
      assert.equal(second.lastSeenAt, "2026-04-12T08:00:00.000Z");
      assert.equal(second.lastWrittenAt, "2026-04-12T09:00:00.000Z");
      assert.equal(second.writeCount, 1);
      assert.equal(second.lastRunId, "run_b");
      assert.equal(second.lastSheetId, "sheet_123");
      assert.deepEqual(second.sourceIds, ["greenhouse", "lever"]);
      assert.equal(
        second.canonicalUrlKey,
        "https://boards.greenhouse.io/acme-ai/jobs/123",
      );
      assert.equal(second.semanticKey, semanticKey);
      assert.equal(found?.fingerprintKey, second.fingerprintKey);
    } finally {
      store.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
