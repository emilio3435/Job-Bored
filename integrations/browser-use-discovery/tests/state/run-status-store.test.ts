import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { DiscoveryRunStatusPayload } from "../../src/contracts.ts";
import {
  buildAcceptedRunStatus,
  buildCompletedRunStatus,
  buildRunningRunStatus,
  createDiscoveryRunStatusStore,
} from "../../src/state/run-status-store.ts";
import type { RunDiscoveryResult } from "../../src/run/run-discovery.ts";

interface TestRunProgress {
  phase: "exploit" | "write";
  sequence: number;
  checkpointedAt: string;
  budget?: {
    totalMs: number;
    remainingMs: number;
    remainingRatio: number;
    exhausted: boolean;
    shouldReducePageLimits: boolean;
    pageLimitMultiplier: number;
    skippedCompanies: string[];
  };
}

interface TestDurableRunStatus extends DiscoveryRunStatusPayload {
  progress: TestRunProgress;
}

async function makeRunDirectory(): Promise<{
  tempDirectory: string;
  runDirectory: string;
}> {
  const tempDirectory = await mkdtemp(
    join(tmpdir(), "job-bored-run-status-"),
  );
  return {
    tempDirectory,
    runDirectory: join(tempDirectory, "runs"),
  };
}

function buildAccepted(runId: string): DiscoveryRunStatusPayload {
  return buildAcceptedRunStatus({
    runId,
    trigger: "manual",
    request: {
      sheetId: "sheet_123",
      variationKey: `variation_${runId}`,
      requestedAt: "2026-08-30T12:00:00.000Z",
    },
    acceptedAt: "2026-08-30T12:00:01.000Z",
  });
}

test("run status snapshots rehydrate complete phase and budget state in a fresh store", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const running = buildRunningRunStatus(
      buildAccepted("run_rehydrate"),
      "2026-08-30T12:00:02.000Z",
    );
    const expected: TestDurableRunStatus = {
      ...running,
      progress: {
        phase: "exploit",
        sequence: 4,
        checkpointedAt: "2026-08-30T12:00:04.000Z",
        budget: {
          totalMs: 60_000,
          remainingMs: 42_000,
          remainingRatio: 0.7,
          exhausted: false,
          shouldReducePageLimits: false,
          pageLimitMultiplier: 1,
          skippedCompanies: ["Budget Co"],
        },
      },
    };

    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(expected);
    writer.close();

    const reader = createDiscoveryRunStatusStore(runDirectory);
    assert.deepEqual(reader.get("run_rehydrate"), expected);
    reader.close();

    const snapshotFiles = (await readdir(runDirectory)).filter((name) =>
      name.endsWith(".json"),
    );
    assert.equal(snapshotFiles.length, 1);
    const snapshot = JSON.parse(
      await readFile(join(runDirectory, snapshotFiles[0]), "utf8"),
    ) as { schemaVersion?: unknown; status?: unknown };
    assert.equal(snapshot.schemaVersion, 1);
    assert.deepEqual(snapshot.status, expected);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("worker restart terminalizes an in-flight write checkpoint as an explicit failed status", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const running = buildRunningRunStatus(
      buildAccepted("run_interrupted"),
      "2026-08-30T12:00:02.000Z",
    );
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put({
      ...running,
      progress: {
        phase: "write",
        sequence: 5,
        checkpointedAt: "2026-08-30T12:00:05.000Z",
      },
    } as TestDurableRunStatus);
    writer.close();

    const restarted = createDiscoveryRunStatusStore(runDirectory);
    assert.equal(
      restarted.markNonTerminalRunsAbandoned?.(
        "2026-08-30T12:05:00.000Z",
      ),
      1,
    );
    const endpointPayload = restarted.get("run_interrupted");
    restarted.close();

    assert.equal(endpointPayload?.status, "failed");
    assert.equal(endpointPayload?.terminal, true);
    assert.equal(endpointPayload?.completedAt, "2026-08-30T12:05:00.000Z");
    assert.match(endpointPayload?.message || "", /worker restarted/i);
    assert.match(endpointPayload?.error || "", /write phase/i);
    assert.deepEqual(
      (endpointPayload as TestDurableRunStatus | null)?.progress,
      {
        phase: "write",
        sequence: 5,
        checkpointedAt: "2026-08-30T12:00:05.000Z",
      },
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("a truncated run snapshot does not crash boot and becomes a queryable failure", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(buildAccepted("run_corrupt"));
    writer.close();

    const [snapshotFile] = (await readdir(runDirectory)).filter((name) =>
      name.endsWith(".json"),
    );
    assert.ok(snapshotFile);
    await writeFile(
      join(runDirectory, snapshotFile),
      '{"schemaVersion":1,"runId":"run_corrupt","status":',
      "utf8",
    );

    const restarted = createDiscoveryRunStatusStore(runDirectory);
    const endpointPayload = restarted.get("run_corrupt");
    restarted.close();

    assert.equal(endpointPayload?.status, "failed");
    assert.equal(endpointPayload?.terminal, true);
    assert.match(endpointPayload?.message || "", /snapshot.*corrupt/i);
    assert.match(endpointPayload?.error || "", /could not be parsed/i);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("terminal snapshots remain queryable without recovery mutation", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const result = {
      run: {
        runId: "run_completed",
        trigger: "manual",
        request: {
          event: "discovery.request",
          schemaVersion: 1,
          sheetId: "sheet_123",
          variationKey: "variation_completed",
          requestedAt: "2026-08-30T12:00:00.000Z",
        },
        config: { sheetId: "sheet_123" },
      },
      lifecycle: {
        runId: "run_completed",
        trigger: "manual",
        startedAt: "2026-08-30T12:00:02.000Z",
        completedAt: "2026-08-30T12:01:00.000Z",
        state: "empty",
        companyCount: 0,
        detectionCount: 0,
        listingCount: 0,
        normalizedLeadCount: 0,
        loopCounters: {
          atsScoutCount: 0,
          browserScoutCount: 0,
          scoredSurfaces: 0,
          selectedExploitTargets: 0,
          exploitSuppressions: 0,
          hintMetrics: 0,
          thirdPartyBlocks: 0,
          junkHostSuppressions: 0,
          duplicateSuppressions: 0,
          crossLaneDuplicates: 0,
        },
      },
      extractionResults: [],
      sourceSummary: [],
      writeResult: {
        sheetId: "sheet_123",
        appended: 0,
        updated: 0,
        skippedDuplicates: 0,
        skippedBlacklist: 0,
        warnings: [],
      },
      warnings: [],
    } as RunDiscoveryResult;
    const expected = buildCompletedRunStatus(result, {
      acceptedAt: "2026-08-30T12:00:01.000Z",
      startedAt: "2026-08-30T12:00:02.000Z",
    });

    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(expected);
    writer.close();

    const restarted = createDiscoveryRunStatusStore(runDirectory);
    assert.equal(
      restarted.markNonTerminalRunsAbandoned?.(
        "2026-08-30T12:05:00.000Z",
      ),
      0,
    );
    const wireSafeExpected = JSON.parse(
      JSON.stringify(expected),
    ) as DiscoveryRunStatusPayload;
    assert.deepEqual(restarted.get("run_completed"), wireSafeExpected);
    restarted.close();
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
