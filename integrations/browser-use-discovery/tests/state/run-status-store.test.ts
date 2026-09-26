import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { DiscoveryRunStatusPayload } from "../../src/contracts.ts";
import {
  buildAcceptedRunStatus,
  buildCompletedRunStatus,
  buildRunningRunStatus,
  createDiscoveryRunStatusStore,
  listRunStatusSnapshots,
} from "../../src/state/run-status-store.ts";
import type { DurableDiscoveryRunStatusPayload } from "../../src/state/run-status-store.ts";
import type { RunDiscoveryResult } from "../../src/run/run-discovery.ts";

interface TestRunProgress {
  phase: "exploit" | "write";
  sequence: number;
  checkpointedAt: string;
  budget?: {
    capturedAt?: string;
    totalMs: number;
    remainingMs: number;
    remainingRatio: number;
    exhausted: boolean;
    shouldReducePageLimits: boolean;
    pageLimitMultiplier: number;
    skippedCompanies: string[];
  };
}

async function getOnlySnapshotPath(runDirectory: string): Promise<string> {
  const snapshotFiles = (await readdir(runDirectory)).filter((name) =>
    name.endsWith(".json"),
  );
  assert.equal(snapshotFiles.length, 1);
  return join(runDirectory, snapshotFiles[0]);
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

async function snapshotDirectoryBytes(
  directory: string,
): Promise<Record<string, string>> {
  const contents: Record<string, string> = {};
  for (const name of (await readdir(directory)).sort()) {
    contents[name] = await readFile(join(directory, name), "utf8");
  }
  return contents;
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
          capturedAt: "2026-08-30T12:00:03.000Z",
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

test("a valid JSON snapshot with an invalid payload fails loud without crashing boot", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(buildAccepted("run_invalid_schema"));
    writer.close();

    const snapshotPath = await getOnlySnapshotPath(runDirectory);
    await writeFile(
      snapshotPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: "run_invalid_schema",
        writtenAt: "2026-08-30T12:00:01.000Z",
        status: {
          ...buildAccepted("run_invalid_schema"),
          status: "unknown",
        },
      })}\n`,
      "utf8",
    );

    const restarted = createDiscoveryRunStatusStore(runDirectory);
    const endpointPayload = restarted.get("run_invalid_schema");
    restarted.close();

    assert.equal(endpointPayload?.status, "failed");
    assert.equal(endpointPayload?.terminal, true);
    assert.match(endpointPayload?.error || "", /does not match schema/i);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("a snapshot whose runId disagrees with its filename fails loud under the filename runId", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(buildAccepted("run_filename"));
    writer.close();

    const snapshotPath = await getOnlySnapshotPath(runDirectory);
    const mismatchedStatus = buildAccepted("run_payload");
    await writeFile(
      snapshotPath,
      `${JSON.stringify({
        schemaVersion: 1,
        runId: "run_payload",
        writtenAt: mismatchedStatus.updatedAt,
        status: mismatchedStatus,
      })}\n`,
      "utf8",
    );

    const restarted = createDiscoveryRunStatusStore(runDirectory);
    const endpointPayload = restarted.get("run_filename");

    assert.equal(endpointPayload?.status, "failed");
    assert.match(endpointPayload?.error || "", /does not match its filename/i);
    assert.equal(restarted.get("run_payload"), null);
    restarted.close();
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("an unreadable snapshot remains a queryable failure when its repair write also fails", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(buildAccepted("run_unreadable"));
    writer.close();

    const snapshotPath = await getOnlySnapshotPath(runDirectory);
    await rm(snapshotPath);
    await mkdir(snapshotPath);
    const events: string[] = [];

    const restarted = createDiscoveryRunStatusStore(runDirectory, {
      log(event) {
        events.push(event);
      },
    });
    const endpointPayload = restarted.get("run_unreadable");
    restarted.close();

    assert.equal(endpointPayload?.status, "failed");
    assert.equal(endpointPayload?.terminal, true);
    assert.match(endpointPayload?.error || "", /could not be parsed/i);
    assert.ok(
      events.includes(
        "discovery.run_status.corrupt_snapshot_rewrite_failed",
      ),
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("an unreadable snapshot file fails loud without crashing boot", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(buildAccepted("run_unreadable_file"));
    writer.close();

    const snapshotPath = await getOnlySnapshotPath(runDirectory);
    await chmod(snapshotPath, 0o000);

    const restarted = createDiscoveryRunStatusStore(runDirectory);
    const endpointPayload = restarted.get("run_unreadable_file");
    restarted.close();

    assert.equal(endpointPayload?.status, "failed");
    assert.equal(endpointPayload?.terminal, true);
    assert.match(endpointPayload?.error || "", /could not be parsed/i);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("a newly created run-state directory is private to its owner", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const store = createDiscoveryRunStatusStore(runDirectory);
    store.close();

    assert.equal((await stat(runDirectory)).mode & 0o777, 0o700);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("boot ignores unrelated JSON filenames instead of creating phantom runs", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.close();
    await writeFile(join(runDirectory, "notes!.json"), "{}\n", "utf8");

    const restarted = createDiscoveryRunStatusStore(runDirectory);
    restarted.close();

    assert.deepEqual(await readdir(runDirectory), ["notes!.json"]);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("boot sweeps an orphaned atomic-write temporary file", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(buildAccepted("run_with_orphan"));
    writer.close();

    const snapshotPath = await getOnlySnapshotPath(runDirectory);
    const temporaryPath = `${snapshotPath}.tmp-123-456-deadbeef`;
    await writeFile(temporaryPath, await readFile(snapshotPath, "utf8"), "utf8");

    const restarted = createDiscoveryRunStatusStore(runDirectory);
    assert.equal(restarted.get("run_with_orphan")?.status, "accepted");
    restarted.close();

    assert.equal(
      (await readdir(runDirectory)).filter((name) => name.includes(".tmp-"))
        .length,
      0,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("put rejects invalid run status payloads", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const store = createDiscoveryRunStatusStore(runDirectory);
    const invalidPayload = {
      ...buildAccepted("run_invalid_put"),
      status: "unknown",
    } as unknown as DurableDiscoveryRunStatusPayload;

    assert.throws(
      () => store.put(invalidPayload),
      /run status payload is not JSON-safe/i,
    );
    store.close();
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("F1B-RUN01-IMMUT: a late running write must not replace a terminal status", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const store = createDiscoveryRunStatusStore(runDirectory);
    const accepted = buildAccepted("run_immutable");
    const running = buildRunningRunStatus(accepted, "2026-08-30T12:00:02.000Z");
    const failed = {
      ...running,
      status: "failed" as const,
      terminal: true,
      message: "Discovery failed — worker could not finish the run.",
      completedAt: "2026-08-30T12:01:00.000Z",
      updatedAt: "2026-08-30T12:01:00.000Z",
      error: "boom",
    };
    store.put(accepted);
    store.put(running);
    store.put(failed);
    store.put(
      buildRunningRunStatus(accepted, "2026-08-30T12:02:00.000Z"),
    );
    const afterLateRunning = store.get("run_immutable");
    assert.equal(afterLateRunning?.status, "failed");
    assert.equal(afterLateRunning?.terminal, true);
    assert.equal(afterLateRunning?.error, "boom");
    store.put({
      ...failed,
      status: "partial",
      message: "watchdog replaced the terminal row",
      error: "watchdog",
    });
    const afterWatchdog = store.get("run_immutable");
    assert.equal(afterWatchdog?.status, "failed");
    assert.equal(afterWatchdog?.error, "boom");
    store.close();
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
    writer.put({
      ...buildRunningRunStatus(
        buildAccepted("run_completed"),
        "2026-08-30T12:00:02.000Z",
      ),
      progress: {
        phase: "write",
        sequence: 5,
        checkpointedAt: "2026-08-30T12:00:05.000Z",
      },
    });
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

test("CANARY-1: listRunStatusSnapshots reads persisted snapshots without opening a writable store", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(
      buildRunningRunStatus(
        buildAccepted("run_listed_one"),
        "2026-08-30T12:00:02.000Z",
      ) as DurableDiscoveryRunStatusPayload,
    );
    writer.put(
      buildRunningRunStatus(
        buildAccepted("run_listed_two"),
        "2026-08-30T12:00:03.000Z",
      ) as DurableDiscoveryRunStatusPayload,
    );
    writer.close();

    const listed = listRunStatusSnapshots(runDirectory);
    assert.deepEqual(
      listed.map((entry) => entry.runId).sort(),
      ["run_listed_one", "run_listed_two"],
    );
    const first = listed.find((entry) => entry.runId === "run_listed_one");
    assert.equal(first?.schemaVersion, 1);
    assert.equal(first?.status.status, "running");
    assert.equal(first?.status.request.sheetId, "sheet_123");
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("CANARY-1: listRunStatusSnapshots skips malformed entries and leaves the directory byte-for-byte untouched", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    const writer = createDiscoveryRunStatusStore(runDirectory);
    writer.put(
      buildRunningRunStatus(
        buildAccepted("run_good"),
        "2026-08-30T12:00:02.000Z",
      ) as DurableDiscoveryRunStatusPayload,
    );
    writer.close();

    const encode = (runId: string): string =>
      Buffer.from(runId, "utf8").toString("base64url");
    // A stray crash-leftover temp file the writable store would sweep away.
    const strayTemporary = join(
      runDirectory,
      `${encode("run_orphan")}.json.tmp-1-2-3`,
    );
    await writeFile(strayTemporary, "{}", "utf8");
    // A snapshot whose JSON is truncated.
    await writeFile(
      join(runDirectory, `${encode("run_truncated")}.json`),
      '{"schemaVersion":1,"runId":"run_trunc',
      "utf8",
    );
    // A snapshot that parses but fails the schema guard.
    await writeFile(
      join(runDirectory, `${encode("run_wrong_schema")}.json`),
      JSON.stringify({ schemaVersion: 99, runId: "run_wrong_schema" }),
      "utf8",
    );
    // A snapshot whose runId disagrees with its filename.
    await writeFile(
      join(runDirectory, `${encode("run_mismatch")}.json`),
      JSON.stringify({
        schemaVersion: 1,
        runId: "run_somethingelse",
        writtenAt: "2026-08-30T12:00:09.000Z",
        status: buildAccepted("run_somethingelse"),
      }),
      "utf8",
    );
    // A file that is not a snapshot at all.
    await writeFile(join(runDirectory, "README.txt"), "not a snapshot", "utf8");

    const before = await snapshotDirectoryBytes(runDirectory);
    const listed = listRunStatusSnapshots(runDirectory);
    const after = await snapshotDirectoryBytes(runDirectory);

    assert.deepEqual(
      listed.map((entry) => entry.runId),
      ["run_good"],
      "only the well-formed snapshot is returned",
    );
    assert.deepEqual(
      after,
      before,
      "listRunStatusSnapshots must not sweep, rewrite, or delete anything",
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("CANARY-1: listRunStatusSnapshots returns an empty list for a missing directory and never creates it", async () => {
  const { tempDirectory, runDirectory } = await makeRunDirectory();

  try {
    assert.deepEqual(listRunStatusSnapshots(runDirectory), []);
    assert.deepEqual(await readdir(tempDirectory), []);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
