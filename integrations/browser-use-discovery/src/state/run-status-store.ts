import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  DiscoveryRunFilterStats,
  DiscoveryRunLifecycle,
  DiscoveryRunStatus,
  DiscoveryRunStatusPayload,
  DiscoverySourceSummary,
  DiscoveryWebhookRequestV1,
  TriggerKind,
} from "../contracts.ts";
import type { RunDiscoveryResult } from "../run/run-discovery.ts";
import { resolveDiscoveryRunLogError } from "../sheets/discovery-runs-writer.ts";
import {
  RUN_PROGRESS_PHASES,
  type DiscoveryRunProgress,
} from "../run/run-progress.ts";

const DEFAULT_ACCEPTED_MESSAGE = "Discovery accepted — worker queued the run.";
const DEFAULT_RUNNING_MESSAGE = "Discovery is running.";
const DEFAULT_FAILED_MESSAGE = "Discovery failed — worker could not finish the run.";

const RUN_STATUS_SNAPSHOT_SCHEMA_VERSION = 1;
const RUN_STATUS_FILE_SUFFIX = ".json";
const RUN_STATUS_VALUES = [
  "accepted",
  "running",
  "completed",
  "partial",
  "empty",
  "write_failed",
  "failed",
] as const satisfies readonly DiscoveryRunStatus[];
const RUN_STATUS_VALUE_SET = new Set<string>(RUN_STATUS_VALUES);
const RUN_PROGRESS_PHASE_SET = new Set<string>(RUN_PROGRESS_PHASES);
type DurableDiscoveryRunStatus = (typeof RUN_STATUS_VALUES)[number];

export interface DurableDiscoveryRunStatusPayload
  extends DiscoveryRunStatusPayload {
  status: DurableDiscoveryRunStatus;
  progress?: DiscoveryRunProgress;
}

export interface DiscoveryRunStatusStoreOptions {
  log?(event: string, details: Record<string, unknown>): void;
}

export interface DiscoveryRunStatusStore {
  put(payload: DurableDiscoveryRunStatusPayload): void;
  finishWriteRetry(payload: DurableDiscoveryRunStatusPayload): void;
  get(runId: string): DurableDiscoveryRunStatusPayload | null;
  list(options?: { limit?: number; before?: string }): DiscoveryRunListPage | null;
  markNonTerminalRunsAbandoned?(abandonedAt: string): number;
  close(): void;
}

export type DiscoveryRunListSummary = {
  runId: string;
  status: DiscoveryRunStatus;
  sheetStatus?: "success" | "partial" | "failure";
  trigger: TriggerKind;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  statusPath: string;
  headline: { written?: number; updated?: number; candidates?: number; fitAvg?: number };
  /**
   * DISCAT D9: lifecycle.filterStats from the snapshot (top 20 keywords), so
   * the Runs panel can state what the filters removed without a detail fetch.
   * Absent on runs from before DISCAT.
   */
  filterStats?: DiscoveryRunFilterStats;
};

export type DiscoveryRunListPage = {
  runs: DiscoveryRunListSummary[];
  nextBefore: string | null;
};

export interface RunStatusSnapshotV1 {
  schemaVersion: typeof RUN_STATUS_SNAPSHOT_SCHEMA_VERSION;
  runId: string;
  writtenAt: string;
  status: DurableDiscoveryRunStatusPayload;
}

export function buildRunStatusPath(runId: string): string {
  return `/runs/${encodeURIComponent(String(runId || "").trim())}`;
}

export function buildAcceptedRunStatus(input: {
  runId: string;
  trigger: TriggerKind;
  request: Pick<
    DiscoveryWebhookRequestV1,
    "sheetId" | "variationKey" | "requestedAt"
  >;
  acceptedAt: string;
}): DiscoveryRunStatusPayload {
  return {
    runId: input.runId,
    status: "accepted",
    terminal: false,
    message: DEFAULT_ACCEPTED_MESSAGE,
    trigger: input.trigger,
    request: { ...input.request },
    acceptedAt: input.acceptedAt,
    updatedAt: input.acceptedAt,
    warnings: [],
    sources: [],
  };
}

export function buildRunningRunStatus(
  current: DiscoveryRunStatusPayload,
  startedAt: string,
): DiscoveryRunStatusPayload {
  return {
    ...current,
    status: "running",
    terminal: false,
    message: DEFAULT_RUNNING_MESSAGE,
    startedAt,
    updatedAt: startedAt,
  };
}

export function buildCompletedRunStatus(
  result: RunDiscoveryResult,
  timing: {
    acceptedAt: string;
    startedAt: string;
  },
): DiscoveryRunStatusPayload {
  const requestSheetId = String(
    result.run.config.sheetId || result.run.request.sheetId || "",
  ).trim();
  const error = resolveDiscoveryRunLogError({
    status: result.lifecycle.state,
    writeError: result.writeResult.writeError,
    reasonMessage: result.lifecycle.reasonMessage,
    warnings: result.warnings,
  });
  return {
    runId: result.run.runId,
    status: result.writeResult.writeError ? "write_failed" : result.lifecycle.state,
    terminal: true,
    message: result.writeResult.writeError
      ? `Discovery found leads, but couldn't write them to Google Sheets. ${result.writeResult.writeError.message} Retry this run's write after fixing the connection.`
      : buildCompletedMessage(result.lifecycle),
    trigger: result.run.trigger,
    request: {
      sheetId: requestSheetId,
      variationKey: result.run.request.variationKey,
      requestedAt: result.run.request.requestedAt,
    },
    acceptedAt: timing.acceptedAt,
    startedAt: timing.startedAt,
    completedAt: result.lifecycle.completedAt,
    updatedAt: result.lifecycle.completedAt,
    lifecycle: {
      ...result.lifecycle,
      startedAt: timing.startedAt,
    },
    writeResult: result.writeResult,
    ...(result.runStats ? { runStats: result.runStats } : {}),
    warnings: [...result.warnings],
    ...(error ? { error } : {}),
    sources: result.sourceSummary.map(cloneSourceSummary),
    // Expose resolved control-plane snapshot for VAL-API-001..005 validation.
    // These fields are only present at terminal state after config resolution.
    ultraPlanTuning: result.run.config.ultraPlanTuning,
    groundedSearchTuning: result.run.config.groundedSearchTuning,
    profileSnapshot: result.run.config.profileSnapshot,
    searchPlan: result.run.config.searchPlan,
  };
}

export function buildFailedRunStatus(
  current: DiscoveryRunStatusPayload,
  error: unknown,
  failedAt: string,
): DiscoveryRunStatusPayload {
  const startedMs = Date.parse(current.startedAt || current.acceptedAt);
  const failedMs = Date.parse(failedAt);
  const discoveryRun = current.request.variationKey !== "ingest_url" && !current.runId.startsWith("ingest_");
  return {
    ...current,
    status: "failed",
    terminal: true,
    message: DEFAULT_FAILED_MESSAGE,
    completedAt: failedAt,
    updatedAt: failedAt,
    error: formatError(error),
    ...(discoveryRun && Number.isFinite(startedMs) && Number.isFinite(failedMs)
      ? { runStats: { schemaVersion: 1 as const, durationMs: Math.max(0, failedMs - startedMs) } }
      : {}),
  };
}

export function createDiscoveryRunStatusStore(
  snapshotDirectory: string,
  options: DiscoveryRunStatusStoreOptions = {},
): DiscoveryRunStatusStore {
  const resolvedDirectory = String(snapshotDirectory || "").trim();
  const persistenceEnabled =
    resolvedDirectory.length > 0 && resolvedDirectory !== ":memory:";
  const statuses = new Map<string, DurableDiscoveryRunStatusPayload>();
  if (persistenceEnabled) {
    mkdirSync(resolvedDirectory, { recursive: true, mode: 0o700 });
    sweepTemporaryRunStatusSnapshots(resolvedDirectory, options);
    loadRunStatusSnapshots(resolvedDirectory, statuses, options);
  }

  function put(payload: DurableDiscoveryRunStatusPayload): void {
    const runId = String(payload.runId || "").trim();
    if (!runId) {
      throw new Error("Run status payload requires a runId.");
    }
    const existing = statuses.get(runId);
    if (existing?.terminal) {
      options.log?.("discovery.run_status.terminal_immutable_ignored", {
        runId,
        existingStatus: existing.status,
        ignoredStatus: payload.status,
      });
      return;
    }
    const updatedAt =
      String(
        payload.updatedAt || payload.completedAt || payload.acceptedAt,
      ).trim() || new Date().toISOString();
    const merged: DurableDiscoveryRunStatusPayload = {
      ...payload,
      runId,
      updatedAt,
      ...(payload.status === "write_failed" && existing?.selectedLeads && !payload.selectedLeads
        ? { selectedLeads: existing.selectedLeads }
        : {}),
      ...(existing?.progress && !payload.progress && !payload.terminal
        ? { progress: existing.progress }
        : {}),
    };
    const wireSafePayload = toWireSafeRunStatus(merged);
    // BEAUDIT A2: disk first, so a failed write never leaves memory terminal.
    if (persistenceEnabled) {
      writeRunStatusSnapshot(resolvedDirectory, wireSafePayload);
    }
    statuses.set(runId, wireSafePayload);
  }

  return {
    put,
    finishWriteRetry(payload) {
      const runId = String(payload.runId || "").trim();
      const existing = statuses.get(runId);
      if (existing?.status !== "write_failed" || !existing.selectedLeads?.length) {
        throw new Error("Run has no saved write to retry.");
      }
      const updated: DurableDiscoveryRunStatusPayload = {
        ...payload,
        runId,
        ...(payload.status === "write_failed" ? { selectedLeads: existing.selectedLeads } : { selectedLeads: undefined }),
      };
      const wireSafePayload = toWireSafeRunStatus(updated);
      if (persistenceEnabled) writeRunStatusSnapshot(resolvedDirectory, wireSafePayload);
      statuses.set(runId, wireSafePayload);
    },
    get(runId) {
      return statuses.get(String(runId || "").trim()) || null;
    },
    list({ limit = 25, before = "" } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
      const cursor = before ? decodeRunListCursor(before) : null;
      if (before && !cursor) return null;
      const ordered = [...statuses.values()]
        .filter((status) => status.request.variationKey !== "ingest_url" && !status.runId.startsWith("ingest_"))
        .map((status) => ({
          status,
          at: Date.parse(status.startedAt || status.acceptedAt) || 0,
        }))
        .sort((left, right) => right.at - left.at || right.status.runId.localeCompare(left.status.runId));
      const remaining = cursor
        ? ordered.filter(({ status, at }) => at < cursor.at || (at === cursor.at && status.runId < cursor.runId))
        : ordered;
      const page = remaining.slice(0, limit);
      return {
        runs: page.map(({ status }) => summarizeRun(status)),
        nextBefore: remaining.length > limit && page.length
          ? encodeRunListCursor(page[page.length - 1].at, page[page.length - 1].status.runId)
          : null,
      };
    },
    markNonTerminalRunsAbandoned(abandonedAt) {
      const recoveredAt =
        String(abandonedAt || "").trim() || new Date().toISOString();
      let recoveredCount = 0;
      for (const current of statuses.values()) {
        if (current.terminal) continue;
        const phase = current.progress?.phase || current.status;
        const reason =
          `Discovery worker restarted mid-run during the ${phase} phase. ` +
          "Automatic replay is disabled because the interrupted step may have external side effects.";
        const warnings = current.warnings.includes(reason)
          ? current.warnings
          : [...current.warnings, reason];
        put({
          ...current,
          status: current.selectedLeads?.length ? "write_failed" : "failed",
          terminal: true,
          message: current.selectedLeads?.length
            ? "Discovery found leads, but the worker restarted before the Sheet write outcome was known. Retry this run's write."
            : "Discovery worker restarted before this run completed.",
          completedAt: recoveredAt,
          updatedAt: recoveredAt,
          warnings,
          error: reason,
        });
        recoveredCount += 1;
      }
      return recoveredCount;
    },
    close() {},
  };
}

function summarizeRun(status: DurableDiscoveryRunStatusPayload): DiscoveryRunListSummary {
  const startedMs = Date.parse(status.startedAt || status.acceptedAt);
  const completedMs = Date.parse(status.completedAt || "");
  const measuredDuration = status.runStats?.durationMs ??
    (Number.isFinite(startedMs) && Number.isFinite(completedMs)
      ? Math.max(0, completedMs - startedMs) : undefined);
  const funnel = status.runStats?.funnel;
  return {
    runId: status.runId,
    status: status.status,
    ...(status.terminal ? { sheetStatus: status.status === "partial" ? "partial" : status.status === "failed" || status.status === "write_failed" ? "failure" : "success" } : {}),
    trigger: status.trigger,
    ...(status.startedAt ? { startedAt: status.startedAt } : {}),
    ...(status.completedAt ? { completedAt: status.completedAt } : {}),
    ...(measuredDuration !== undefined ? { durationMs: measuredDuration } : {}),
    statusPath: buildRunStatusPath(status.runId),
    headline: {
      ...((funnel?.written ?? status.writeResult?.appended) !== undefined
        ? { written: funnel?.written ?? status.writeResult?.appended } : {}),
      ...((funnel?.updated ?? status.writeResult?.updated) !== undefined
        ? { updated: funnel?.updated ?? status.writeResult?.updated } : {}),
      ...((funnel?.candidates ?? status.lifecycle?.normalizedLeadCount) !== undefined
        ? { candidates: funnel?.candidates ?? status.lifecycle?.normalizedLeadCount } : {}),
      ...(status.runStats?.fit?.avg !== undefined ? { fitAvg: status.runStats.fit.avg } : {}),
    },
    ...(status.lifecycle?.filterStats ? { filterStats: status.lifecycle.filterStats } : {}),
  };
}

function encodeRunListCursor(at: number, runId: string): string {
  return Buffer.from(JSON.stringify({ at, runId }), "utf8").toString("base64url");
}

function decodeRunListCursor(value: string): { at: number; runId: string } | null {
  if (value.length > 512) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(parsed) || !Number.isFinite(parsed.at) || typeof parsed.runId !== "string" || !parsed.runId) return null;
    return encodeRunListCursor(parsed.at as number, parsed.runId) === value
      ? { at: parsed.at as number, runId: parsed.runId } : null;
  } catch {
    return null;
  }
}

/**
 * Read-only listing of persisted run-status snapshots (CANARY-1 / spec LD-6).
 *
 * Unlike `createDiscoveryRunStatusStore`, this performs NO mutation: it never
 * creates the directory, never sweeps `.tmp-` leftovers, and never rewrites a
 * corrupt snapshot. Entries that cannot be decoded, parsed, or validated are
 * skipped so an operator-facing reader can never be broken by one bad file.
 */
export function listRunStatusSnapshots(
  directory: string,
): RunStatusSnapshotV1[] {
  const resolvedDirectory = String(directory || "").trim();
  if (!resolvedDirectory) return [];
  let filenames: string[];
  try {
    filenames = readdirSync(resolvedDirectory);
  } catch {
    return [];
  }
  const snapshots: RunStatusSnapshotV1[] = [];
  for (const filename of filenames) {
    if (!filename.endsWith(RUN_STATUS_FILE_SUFFIX)) continue;
    const runIdFromFilename = decodeRunIdFromSnapshotFilename(filename);
    if (!runIdFromFilename) continue;
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(join(resolvedDirectory, filename), "utf8"),
      );
      if (!isRunStatusSnapshot(parsed)) continue;
      if (parsed.runId !== runIdFromFilename) continue;
      snapshots.push(parsed);
    } catch {
      continue;
    }
  }
  return snapshots;
}

function loadRunStatusSnapshots(
  snapshotDirectory: string,
  statuses: Map<string, DurableDiscoveryRunStatusPayload>,
  options: DiscoveryRunStatusStoreOptions,
): void {
  for (const filename of readdirSync(snapshotDirectory)) {
    if (!filename.endsWith(RUN_STATUS_FILE_SUFFIX)) continue;
    const runIdFromFilename = decodeRunIdFromSnapshotFilename(filename);
    if (!runIdFromFilename) continue;
    const pathname = join(snapshotDirectory, filename);
    try {
      const parsed: unknown = JSON.parse(readFileSync(pathname, "utf8"));
      if (!isRunStatusSnapshot(parsed)) {
        throw new Error("snapshot does not match schema version 1");
      }
      if (parsed.runId !== runIdFromFilename) {
        throw new Error("snapshot runId does not match its filename");
      }
      statuses.set(parsed.runId, parsed.status);
    } catch (error) {
      const failedAt = new Date().toISOString();
      const failure = buildCorruptSnapshotRunStatus(
        runIdFromFilename,
        failedAt,
        error,
      );
      statuses.set(runIdFromFilename, failure);
      try {
        writeRunStatusSnapshot(snapshotDirectory, failure);
      } catch (writeError) {
        options.log?.(
          "discovery.run_status.corrupt_snapshot_rewrite_failed",
          {
            runId: runIdFromFilename,
            filename,
            error: formatError(writeError),
          },
        );
      }
    }
  }
}

function sweepTemporaryRunStatusSnapshots(
  snapshotDirectory: string,
  options: DiscoveryRunStatusStoreOptions,
): void {
  const temporaryMarker = `${RUN_STATUS_FILE_SUFFIX}.tmp-`;
  for (const filename of readdirSync(snapshotDirectory)) {
    const markerIndex = filename.indexOf(temporaryMarker);
    if (markerIndex <= 0) continue;
    const snapshotFilename = filename.slice(
      0,
      markerIndex + RUN_STATUS_FILE_SUFFIX.length,
    );
    if (!decodeRunIdFromSnapshotFilename(snapshotFilename)) continue;
    try {
      unlinkSync(join(snapshotDirectory, filename));
    } catch (error) {
      options.log?.("discovery.run_status.temp_cleanup_failed", {
        filename,
        error: formatError(error),
      });
    }
  }
}

function writeRunStatusSnapshot(
  snapshotDirectory: string,
  status: DurableDiscoveryRunStatusPayload,
): void {
  const pathname = join(
    snapshotDirectory,
    encodeRunIdForSnapshotFilename(status.runId),
  );
  const temporaryPathname = `${pathname}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const snapshot: RunStatusSnapshotV1 = {
    schemaVersion: RUN_STATUS_SNAPSHOT_SCHEMA_VERSION,
    runId: status.runId,
    writtenAt: status.updatedAt,
    status,
  };
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openSync(temporaryPathname, "wx", 0o600);
    writeFileSync(fileDescriptor, `${JSON.stringify(snapshot)}\n`, "utf8");
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = null;
    renameSync(temporaryPathname, pathname);
    syncDirectory(snapshotDirectory);
  } catch (error) {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
    if (existsSync(temporaryPathname)) unlinkSync(temporaryPathname);
    throw error;
  }
}

function syncDirectory(pathname: string): void {
  let fileDescriptor: number | null = null;
  try {
    fileDescriptor = openSync(pathname, "r");
    fsyncSync(fileDescriptor);
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
  }
}

function encodeRunIdForSnapshotFilename(runId: string): string {
  return `${Buffer.from(runId, "utf8").toString("base64url")}${RUN_STATUS_FILE_SUFFIX}`;
}

function decodeRunIdFromSnapshotFilename(filename: string): string {
  const encoded = filename.slice(0, -RUN_STATUS_FILE_SUFFIX.length);
  const decoded = Buffer.from(encoded, "base64url").toString("utf8").trim();
  return decoded && encodeRunIdForSnapshotFilename(decoded) === filename
    ? decoded
    : "";
}

function toWireSafeRunStatus(
  payload: DurableDiscoveryRunStatusPayload,
): DurableDiscoveryRunStatusPayload {
  const parsed: unknown = JSON.parse(JSON.stringify(payload));
  if (!isRunStatusPayload(parsed)) {
    throw new Error("Run status payload is not JSON-safe.");
  }
  return parsed;
}

function buildCorruptSnapshotRunStatus(
  runId: string,
  failedAt: string,
  error: unknown,
): DurableDiscoveryRunStatusPayload {
  const detail = error instanceof Error ? error.message : String(error);
  const reason = `Persisted run snapshot could not be parsed: ${detail}`;
  return {
    runId,
    status: "failed",
    terminal: true,
    message: "Discovery run snapshot was corrupt after worker restart.",
    trigger: "manual",
    request: {
      sheetId: "",
      variationKey: "",
      requestedAt: "",
    },
    acceptedAt: failedAt,
    completedAt: failedAt,
    updatedAt: failedAt,
    warnings: [reason],
    sources: [],
    error: reason,
  };
}

function isRunStatusSnapshot(value: unknown): value is RunStatusSnapshotV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === RUN_STATUS_SNAPSHOT_SCHEMA_VERSION &&
    typeof value.runId === "string" &&
    typeof value.writtenAt === "string" &&
    isRunStatusPayload(value.status)
  );
}

function buildCompletedMessage(lifecycle: DiscoveryRunLifecycle): string {
  if (lifecycle.state === "empty") {
    return "Discovery completed — no matching leads were found.";
  }
  if (lifecycle.state === "partial") {
    return "Discovery completed with warnings — worker processed the run.";
  }
  return "Discovery completed — worker processed the run.";
}

function cloneSourceSummary(
  source: DiscoverySourceSummary,
): DiscoverySourceSummary {
  return {
    ...source,
    warnings: [...(source.warnings || [])],
    ...(source.rejectionSummary
      ? {
          rejectionSummary: {
            totalRejected: source.rejectionSummary.totalRejected,
            rejectionReasons: { ...source.rejectionSummary.rejectionReasons },
            rejectionSamples: source.rejectionSummary.rejectionSamples.map(
              (sample) => ({ ...sample }),
            ),
          },
        }
      : {}),
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRunStatusPayload(
  value: unknown,
): value is DurableDiscoveryRunStatusPayload {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.status === "string" &&
    RUN_STATUS_VALUE_SET.has(value.status) &&
    typeof value.terminal === "boolean" &&
    typeof value.message === "string" &&
    (value.trigger === "manual" || value.trigger === "scheduled") &&
    isRunStatusRequest(value.request) &&
    typeof value.acceptedAt === "string" &&
    typeof value.updatedAt === "string" &&
    isStringArray(value.warnings) &&
    Array.isArray(value.sources) &&
    (value.progress === undefined || isRunProgress(value.progress))
  );
}

function isRunStatusRequest(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.sheetId === "string" &&
    typeof value.variationKey === "string" &&
    typeof value.requestedAt === "string"
  );
}

function isRunProgress(value: unknown): value is DiscoveryRunProgress {
  return (
    isRecord(value) &&
    typeof value.phase === "string" &&
    RUN_PROGRESS_PHASE_SET.has(value.phase) &&
    typeof value.sequence === "number" &&
    Number.isInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.checkpointedAt === "string" &&
    (value.budget === undefined || isRunBudgetProgress(value.budget))
  );
}

function isRunBudgetProgress(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.capturedAt === undefined || typeof value.capturedAt === "string") &&
    typeof value.totalMs === "number" &&
    typeof value.remainingMs === "number" &&
    typeof value.remainingRatio === "number" &&
    typeof value.exhausted === "boolean" &&
    typeof value.shouldReducePageLimits === "boolean" &&
    typeof value.pageLimitMultiplier === "number" &&
    isStringArray(value.skippedCompanies)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
