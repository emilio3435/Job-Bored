import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  DiscoveryRunLifecycle,
  DiscoveryRunStatusPayload,
  DiscoverySourceSummary,
  DiscoveryWebhookRequestV1,
  TriggerKind,
} from "../contracts.ts";
import type { RunDiscoveryResult } from "../run/run-discovery.ts";

const DEFAULT_ACCEPTED_MESSAGE = "Discovery accepted — worker queued the run.";
const DEFAULT_RUNNING_MESSAGE = "Discovery is running.";
const DEFAULT_FAILED_MESSAGE = "Discovery failed — worker could not finish the run.";

export type DiscoveryRunStatusStore = {
  put(payload: DiscoveryRunStatusPayload): void;
  get(runId: string): DiscoveryRunStatusPayload | null;
  close(): void;
};

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
  databasePath: string,
): DiscoveryRunStatusStore {
  const resolvedPath = String(databasePath || "").trim() || ":memory:";
  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS discovery_run_status (
      run_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const putStatement = database.prepare(`
    INSERT INTO discovery_run_status (run_id, payload_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const getStatement = database.prepare(`
    SELECT payload_json
    FROM discovery_run_status
    WHERE run_id = ?
  `);

  return {
    put(payload) {
      const updatedAt =
        String(payload.updatedAt || payload.completedAt || payload.acceptedAt).trim() ||
        new Date().toISOString();
      const serialized = JSON.stringify({
        ...payload,
        updatedAt,
      });
      putStatement.run(payload.runId, serialized, updatedAt);
    },
    get(runId) {
      const row = getStatement.get(String(runId || "").trim()) as
        | { payload_json?: string }
        | undefined;
      if (!row?.payload_json) return null;
      try {
        const parsed = JSON.parse(row.payload_json);
        return isRunStatusPayload(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    close() {
      database.close();
    },
  };
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

function isRunStatusPayload(value: unknown): value is DiscoveryRunStatusPayload {
  return !!value && typeof value === "object" && typeof value.runId === "string";
}
