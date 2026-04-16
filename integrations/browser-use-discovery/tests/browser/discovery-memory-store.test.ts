import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildUrlKey,
  createDiscoveryMemoryStore,
} from "../../src/state/discovery-memory-store.ts";

test("discovery memory store creates required tables without touching discovery_run_status", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-memory-store-"));
  const databasePath = join(tempDir, "worker-state.sqlite");

  try {
    const bootstrap = new DatabaseSync(databasePath);
    bootstrap.exec(`
      CREATE TABLE discovery_run_status (
        run_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    bootstrap
      .prepare(`
        INSERT INTO discovery_run_status (run_id, payload_json, updated_at)
        VALUES (?, ?, ?)
      `)
      .run(
        "run_existing",
        JSON.stringify({ status: "accepted" }),
        "2026-04-13T00:00:00.000Z",
      );
    bootstrap.close();

    const store = createDiscoveryMemoryStore(databasePath);
    store.close();

    const inspect = new DatabaseSync(databasePath);
    const tables = inspect
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
      `)
      .all() as { name: string }[];
    const tableNames = new Set(tables.map((row) => row.name));
    assert.ok(tableNames.has("discovery_run_status"));
    assert.ok(tableNames.has("company_registry"));
    assert.ok(tableNames.has("career_surfaces"));
    assert.ok(tableNames.has("host_suppressions"));
    assert.ok(tableNames.has("dead_link_cache"));
    assert.ok(tableNames.has("listing_fingerprints"));
    assert.ok(tableNames.has("intent_coverage"));

    const existingRow = inspect
      .prepare(`
        SELECT payload_json
        FROM discovery_run_status
        WHERE run_id = ?
      `)
      .get("run_existing") as { payload_json: string } | undefined;
    assert.equal(existingRow?.payload_json, JSON.stringify({ status: "accepted" }));
    inspect.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("dead link cooldowns persist and suppress retries until next_retry_at", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-memory-store-"));
  const databasePath = join(tempDir, "worker-state.sqlite");

  try {
    const store = createDiscoveryMemoryStore(databasePath);
    const url = "https://jobs.example.com/openings/backend-engineer?ref=home";

    const first = store.upsertDeadLink({
      url,
      finalUrl: "https://jobs.example.com/openings/backend-engineer",
      reasonCode: "http_404",
      httpStatus: 404,
      lastTitle: "Not found",
      lastSeenAt: "2026-04-13T00:00:00.000Z",
      nextRetryAt: "2026-04-20T00:00:00.000Z",
    });
    assert.equal(first.failureCount, 1);
    assert.equal(first.urlKey, buildUrlKey(url));
    assert.equal(first.finalUrl, "https://jobs.example.com/openings/backend-engineer");
    assert.equal(store.isDeadLinkCoolingDown(url, "2026-04-15T00:00:00.000Z"), true);
    assert.equal(store.isDeadLinkCoolingDown(url, "2026-04-21T00:00:00.000Z"), false);

    const second = store.upsertDeadLink({
      url,
      reasonCode: "timeout",
      lastSeenAt: "2026-04-14T00:00:00.000Z",
    });
    assert.equal(second.failureCount, 2);
    assert.equal(second.nextRetryAt, "2026-04-20T00:00:00.000Z");
    assert.equal(second.finalUrl, "https://jobs.example.com/openings/backend-engineer");
    assert.equal(store.getDeadLink(url)?.reasonCode, "timeout");

    store.clearDeadLink(url);
    assert.equal(store.getDeadLink(url), null);
    assert.equal(store.isDeadLinkCoolingDown(url, "2026-04-15T00:00:00.000Z"), false);
    store.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("listing fingerprints persist across reopen and keep location in semantic identity", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-memory-store-"));
  const databasePath = join(tempDir, "worker-state.sqlite");

  try {
    const store = createDiscoveryMemoryStore(databasePath);
    const first = store.upsertListingFingerprint({
      companyKey: "acme-ai",
      titleKey: "backend engineer",
      locationKey: "new york, ny",
      remoteBucket: "hybrid",
      canonicalUrl: "https://jobs.example.com/roles/backend-engineer?utm_source=board",
      externalJobId: "role-123",
      employmentType: "full_time",
      contentHash: "hash-nyc-v1",
      seenAt: "2026-04-13T00:00:00.000Z",
      writtenAt: "2026-04-13T00:10:00.000Z",
      runId: "run_001",
      sheetId: "sheet_001",
      sourceIds: ["greenhouse"],
    });

    const semanticOnlyUpdate = store.upsertListingFingerprint({
      companyKey: "acme-ai",
      titleKey: "backend engineer",
      locationKey: "new york, ny",
      remoteBucket: "hybrid",
      seenAt: "2026-04-13T02:00:00.000Z",
      sourceIds: ["careers_page"],
    });

    const differentLocation = store.upsertListingFingerprint({
      companyKey: "acme-ai",
      titleKey: "backend engineer",
      locationKey: "san francisco, ca",
      remoteBucket: "hybrid",
      seenAt: "2026-04-13T03:00:00.000Z",
      sourceIds: ["careers_page"],
    });

    assert.equal(semanticOnlyUpdate.fingerprintKey, first.fingerprintKey);
    assert.equal(
      semanticOnlyUpdate.canonicalUrlKey,
      buildUrlKey("https://jobs.example.com/roles/backend-engineer?utm_source=board"),
    );
    assert.equal(semanticOnlyUpdate.externalJobId, "role-123");
    assert.equal(semanticOnlyUpdate.writeCount, 1);
    assert.deepEqual(semanticOnlyUpdate.sourceIds.sort(), [
      "careers_page",
      "greenhouse",
    ]);
    assert.notEqual(differentLocation.fingerprintKey, first.fingerprintKey);

    store.close();

    const reopened = createDiscoveryMemoryStore(databasePath);
    const persisted = reopened.findListingFingerprint({
      canonicalUrl:
        "https://jobs.example.com/roles/backend-engineer?utm_source=board",
      externalJobId: "role-123",
    });
    assert.ok(persisted);
    assert.equal(persisted?.fingerprintKey, first.fingerprintKey);
    assert.equal(persisted?.locationKey, "new york, ny");
    assert.equal(persisted?.writeCount, 1);
    assert.deepEqual(persisted?.sourceIds.sort(), [
      "careers_page",
      "greenhouse",
    ]);
    reopened.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("discovery memory store reports table counts for planner and dedupe health", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-memory-store-"));
  const databasePath = join(tempDir, "worker-state.sqlite");

  try {
    const store = createDiscoveryMemoryStore(databasePath);
    assert.deepEqual(store.getCounts(), {
      companyRegistry: 0,
      careerSurfaces: 0,
      hostSuppressions: 0,
      deadLinkCache: 0,
      listingFingerprints: 0,
      intentCoverage: 0,
      scoutObservations: 0,
    });

    store.upsertCompany({
      companyKey: "acme-ai",
      displayName: "Acme AI",
      domains: ["acme.ai"],
      roleTags: ["growth marketing"],
      lastSeenAt: "2026-04-13T00:00:00.000Z",
    });
    store.upsertCareerSurface({
      companyKey: "acme-ai",
      surfaceType: "provider_board",
      providerType: "greenhouse",
      canonicalUrl: "https://boards.greenhouse.io/acmeai",
      verifiedStatus: "verified",
      lastVerifiedAt: "2026-04-13T00:05:00.000Z",
    });
    store.upsertDeadLink({
      url: "https://acme.ai/careers/missing-role",
      reasonCode: "http_404",
      lastSeenAt: "2026-04-13T00:10:00.000Z",
    });
    store.upsertHostSuppression({
      host: "https://boards.greenhouse.io/acme-ai/jobs/123?utm_source=linkedin",
      qualityScore: 0.75,
      junkExtractionIncrement: 1,
      canonicalResolutionFailureIncrement: 2,
      suppressionIncrement: 1,
      lastSeenAt: "2026-04-13T00:12:00.000Z",
      lastReasonCode: "junk_extraction",
      nextRetryAt: "2026-04-20T00:00:00.000Z",
      cooldownUntil: "2026-04-18T00:00:00.000Z",
    });
    store.upsertListingFingerprint({
      companyKey: "acme-ai",
      titleKey: "growth marketing manager",
      locationKey: "remote",
      remoteBucket: "remote",
      seenAt: "2026-04-13T00:15:00.000Z",
      sourceIds: ["greenhouse"],
    });
    store.writeIntentCoverage({
      intentKey: "preset=browser_plus_ats|roles=growth-marketing",
      companyKey: "acme-ai",
      runId: "run_health_counts",
      sourceLane: "ats_provider",
      surfacesSeen: 1,
      listingsSeen: 1,
      listingsWritten: 1,
      startedAt: "2026-04-13T00:20:00.000Z",
      completedAt: "2026-04-13T00:25:00.000Z",
    });

    assert.deepEqual(store.getCounts(), {
      companyRegistry: 1,
      careerSurfaces: 1,
      hostSuppressions: 1,
      deadLinkCache: 1,
      listingFingerprints: 1,
      intentCoverage: 1,
      scoutObservations: 0,
    });

    store.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("host suppression records normalize hosts and survive reopen", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-memory-store-"));
  const databasePath = join(tempDir, "worker-state.sqlite");

  try {
    const store = createDiscoveryMemoryStore(databasePath);
    const first = store.upsertHostSuppression({
      host: "https://jobs.example.com/open-roles?utm_source=linkedin",
      qualityScore: 0.8,
      junkExtractionIncrement: 1,
      canonicalResolutionFailureIncrement: 2,
      suppressionIncrement: 3,
      lastSeenAt: "2026-04-13T00:00:00.000Z",
      lastReasonCode: "canonical_resolution_failure",
      nextRetryAt: "2026-04-14T00:00:00.000Z",
      cooldownUntil: "2026-04-15T00:00:00.000Z",
    });
    const second = store.upsertHostSuppression({
      host: "jobs.example.com",
      qualityDelta: -0.1,
      suppressionIncrement: 1,
      lastSeenAt: "2026-04-13T01:00:00.000Z",
      lastReasonCode: "junk_extraction",
    });

    assert.equal(first.hostKey, "jobs.example.com");
    assert.equal(first.host, "jobs.example.com");
    assert.equal(first.qualityScore, 0.8);
    assert.equal(first.junkExtractionCount, 1);
    assert.equal(first.canonicalResolutionFailureCount, 2);
    assert.equal(first.suppressionCount, 3);
    assert.equal(second.qualityScore, 0.7);
    assert.equal(second.suppressionCount, 4);
    assert.equal(
      store.isHostSuppressed("https://jobs.example.com/roles/backend", "2026-04-13T12:00:00.000Z"),
      true,
    );
    assert.equal(
      store.isHostSuppressed("https://jobs.example.com/roles/backend", "2026-04-16T00:00:00.000Z"),
      false,
    );

    store.close();

    const reopened = createDiscoveryMemoryStore(databasePath);
    const persisted = reopened.getHostSuppression(
      "https://jobs.example.com/roles/backend?ref=board",
    );
    assert.ok(persisted);
    assert.equal(persisted?.hostKey, "jobs.example.com");
    assert.equal(persisted?.qualityScore, 0.7);
    assert.equal(persisted?.junkExtractionCount, 1);
    assert.equal(persisted?.canonicalResolutionFailureCount, 2);
    assert.equal(persisted?.suppressionCount, 4);
    assert.equal(persisted?.lastReasonCode, "junk_extraction");
    assert.equal(persisted?.nextRetryAt, "2026-04-14T00:00:00.000Z");
    assert.equal(persisted?.cooldownUntil, "2026-04-15T00:00:00.000Z");
    assert.equal(
      reopened.isHostSuppressed("jobs.example.com", "2026-04-13T12:00:00.000Z"),
      true,
    );
    reopened.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("planner snapshot still returns verified career surfaces when no companies are registered", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-memory-store-"));
  const databasePath = join(tempDir, "worker-state.sqlite");

  try {
    const store = createDiscoveryMemoryStore(databasePath);
    store.upsertCareerSurface({
      companyKey: "acme-ai",
      surfaceType: "provider_board",
      providerType: "greenhouse",
      canonicalUrl: "https://boards.greenhouse.io/acmeai",
      verifiedStatus: "verified",
      lastVerifiedAt: "2026-04-14T00:05:00.000Z",
      lastSuccessAt: "2026-04-14T00:06:00.000Z",
    });

    const snapshot = store.loadPlannerSnapshot({
      intentKey: "preset=browser_plus_ats|roles=data-analyst",
      now: "2026-04-14T00:10:00.000Z",
    });

    assert.equal(snapshot.companies.length, 0);
    assert.equal(snapshot.careerSurfaces.length, 1);
    assert.equal(snapshot.careerSurfaces[0]?.companyKey, "acme-ai");
    assert.equal(snapshot.careerSurfaces[0]?.providerType, "greenhouse");
    store.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("scout observations persist with run/surface identity and are queryable", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "job-bored-memory-store-"));
  const databasePath = join(tempDir, "worker-state.sqlite");

  try {
    const store = createDiscoveryMemoryStore(databasePath);

    // Write scout observations for a run
    const obs1 = store.writeScoutObservation({
      observationRef: "https://boards.greenhouse.io/acmeai",
      runId: "run_abc",
      surfaceId: "surface_greenhouse_acme",
      companyRef: "acme-ai",
      sourceId: "greenhouse",
      sourceLane: "ats_provider",
      surfaceType: "provider_board",
      canonicalUrl: "https://boards.greenhouse.io/acmeai",
      providerType: "greenhouse",
      host: "boards.greenhouse.io",
      finalUrl: "https://boards.greenhouse.io/acmeai",
      boardToken: "acmeai",
      observedAt: "2026-04-14T10:00:00.000Z",
      listingsSeen: 5,
      success: true,
      failureReason: "",
    });

    const obs2 = store.writeScoutObservation({
      observationRef: "https://careers.acme.ai/jobs",
      runId: "run_abc",
      surfaceId: "surface_careers_acme",
      companyRef: "acme-ai",
      sourceId: "grounded_web",
      sourceLane: "company_surface",
      surfaceType: "employer_careers",
      canonicalUrl: "https://careers.acme.ai/jobs",
      providerType: "",
      host: "careers.acme.ai",
      finalUrl: "https://careers.acme.ai/jobs",
      boardToken: "",
      observedAt: "2026-04-14T10:01:00.000Z",
      listingsSeen: 3,
      success: true,
      failureReason: "",
    });

    const obs3 = store.writeScoutObservation({
      observationRef: "https://boards.greenhouse.io/acmeai-run2",
      runId: "run_def",
      surfaceId: "surface_greenhouse_acme",
      companyRef: "acme-ai",
      sourceId: "greenhouse",
      sourceLane: "ats_provider",
      surfaceType: "provider_board",
      canonicalUrl: "https://boards.greenhouse.io/acmeai",
      providerType: "greenhouse",
      host: "boards.greenhouse.io",
      finalUrl: "https://boards.greenhouse.io/acmeai",
      boardToken: "acmeai",
      observedAt: "2026-04-15T10:00:00.000Z",
      listingsSeen: 0,
      success: false,
      failureReason: "timeout",
    });

    // Verify initial counts
    assert.deepEqual(store.getCounts(), {
      companyRegistry: 0,
      careerSurfaces: 0,
      hostSuppressions: 0,
      deadLinkCache: 0,
      listingFingerprints: 0,
      intentCoverage: 0,
      scoutObservations: 3,
    });

    // Query by runId
    const run1Obs = store.listScoutObservations({ runId: "run_abc" });
    assert.equal(run1Obs.length, 2);
    assert.ok(run1Obs.every((o) => o.runId === "run_abc"));

    const run2Obs = store.listScoutObservations({ runId: "run_def" });
    assert.equal(run2Obs.length, 1);
    assert.equal(run2Obs[0].runId, "run_def");

    // Query by surfaceId
    const surfaceObs = store.listScoutObservations({ surfaceId: "surface_greenhouse_acme" });
    assert.equal(surfaceObs.length, 2);
    assert.ok(surfaceObs.every((o) => o.surfaceId === "surface_greenhouse_acme"));

    // Query by companyKey
    const companyObs = store.listScoutObservations({ companyRef: "acme-ai" });
    assert.equal(companyObs.length, 3);

    // Query by success status
    const successObs = store.listScoutObservations({ success: true });
    assert.equal(successObs.length, 2);
    assert.ok(successObs.every((o) => o.success === true));

    const failedObs = store.listScoutObservations({ success: false });
    assert.equal(failedObs.length, 1);
    assert.equal(failedObs[0].failureReason, "timeout");

    // Verify written records have correct values
    assert.equal(obs1.observationRef, "https://boards.greenhouse.io/acmeai");
    assert.equal(obs1.runId, "run_abc");
    assert.equal(obs1.surfaceId, "surface_greenhouse_acme");
    assert.equal(obs1.companyRef, "acme-ai");
    assert.equal(obs1.sourceId, "greenhouse");
    assert.equal(obs1.sourceLane, "ats_provider");
    assert.equal(obs1.listingsSeen, 5);
    assert.equal(obs1.success, true);

    assert.equal(obs3.observationRef, "https://boards.greenhouse.io/acmeai-run2");
    assert.equal(obs3.success, false);
    assert.equal(obs3.failureReason, "timeout");

    store.close();

    // Verify persistence across reopen
    const reopened = createDiscoveryMemoryStore(databasePath);
    const persistedObs = reopened.listScoutObservations({ runId: "run_abc" });
    assert.equal(persistedObs.length, 2);

    const persistedRun2 = reopened.listScoutObservations({ runId: "run_def" });
    assert.equal(persistedRun2.length, 1);
    assert.equal(persistedRun2[0].success, false);
    assert.equal(persistedRun2[0].failureReason, "timeout");

    // Query with limit
    const limitedObs = reopened.listScoutObservations({ limit: 1 });
    assert.equal(limitedObs.length, 1);

    reopened.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
