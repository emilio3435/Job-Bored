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
  DiscoveryRunLifecycle,
  DiscoveryRunStatusPayload,
  DiscoverySourceSummary,
  DiscoveryWebhookRequestV1,
  TriggerKind,
} from "../contracts.ts";
import type { RunDiscoveryResult } from "../run/run-discovery.ts";
import type { DiscoveryRunProgress } from "../run/run-progress.ts";

const DEFAULT_ACCEPTED_MESSAGE = "Discovery accepted — worker queued the run.";
const DEFAULT_RUNNING_MESSAGE = "Discovery is running.";
const DEFAULT_FAILED_MESSAGE = "Discovery failed — worker could not finish the run.";

const RUN_STATUS_SNAPSHOT_SCHEMA_VERSION = 1;
const RUN_STATUS_FILE_SUFFIX = ".json";
const RUN_STATUS_VALUES = new Set<string>([
  "accepted",
  "running",
  "completed",
  "partial",
  "empty",
  "failed",
]);

export interface DurableDiscoveryRunStatusPayload
  extends DiscoveryRunStatusPayload {
  progress?: DiscoveryRunProgress;
}

export interface DiscoveryRunStatusStore {
  put(payload: DurableDiscoveryRunStatusPayload): void;
  get(runId: string): DurableDiscoveryRunStatusPayload | null;
  markNonTerminalRunsAbandoned?(abandonedAt: string): number;
  close(): void;
}

interface RunStatusSnapshotV1 {
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
  return {
    runId: result.run.runId,
    status: result.lifecycle.state,
    terminal: true,
    message: buildCompletedMessage(result.lifecycle),
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
    warnings: [...result.warnings],
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
  return {
    ...current,
    status: "failed",
    terminal: true,
    message: DEFAULT_FAILED_MESSAGE,
    completedAt: failedAt,
    updatedAt: failedAt,
    error: formatError(error),
  };
}

export function createDiscoveryRunStatusStore(
  snapshotDirectory: string,
): DiscoveryRunStatusStore {
  const resolvedDirectory = String(snapshotDirectory || "").trim();
  const persistenceEnabled =
    resolvedDirectory.length > 0 && resolvedDirectory !== ":memory:";
  const statuses = new Map<string, DurableDiscoveryRunStatusPayload>();
  if (persistenceEnabled) {
    mkdirSync(resolvedDirectory, { recursive: true });
    loadRunStatusSnapshots(resolvedDirectory, statuses);
  }

  function put(payload: DurableDiscoveryRunStatusPayload): void {
    const runId = String(payload.runId || "").trim();
    if (!runId) {
      throw new Error("Run status payload requires a runId.");
    }
    const existing = statuses.get(runId);
    const updatedAt =
      String(
        payload.updatedAt || payload.completedAt || payload.acceptedAt,
      ).trim() || new Date().toISOString();
    const merged: DurableDiscoveryRunStatusPayload = {
      ...payload,
      runId,
      updatedAt,
      ...(existing?.progress && !payload.progress
        ? { progress: existing.progress }
        : {}),
    };
    const wireSafePayload = toWireSafeRunStatus(merged);
    statuses.set(runId, wireSafePayload);
    if (persistenceEnabled) {
      writeRunStatusSnapshot(resolvedDirectory, wireSafePayload);
    }
  }

  return {
    put,
    get(runId) {
      return statuses.get(String(runId || "").trim()) || null;
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
          status: "failed",
          terminal: true,
          message: "Discovery worker restarted before this run completed.",
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

function loadRunStatusSnapshots(
  snapshotDirectory: string,
  statuses: Map<string, DurableDiscoveryRunStatusPayload>,
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
      writeRunStatusSnapshot(snapshotDirectory, failure);
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
  try {
    const encoded = filename.slice(0, -RUN_STATUS_FILE_SUFFIX.length);
    return Buffer.from(encoded, "base64url").toString("utf8").trim();
  } catch {
    return "";
  }
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
    RUN_STATUS_VALUES.has(value.status) &&
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
    ["initializing", "scout", "score", "exploit", "write", "learn"].includes(
      value.phase,
    ) &&
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
