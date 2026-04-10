import { randomUUID, timingSafeEqual } from "node:crypto";

import type {
  DiscoveryWebhookAck,
  DiscoveryRunStatusPayload,
  DiscoveryWebhookRequestV1,
  StoredWorkerConfig,
} from "../contracts.ts";
import type {
  RunDiscoveryDependencies,
} from "../run/run-discovery.ts";
import {
  buildAcceptedRunStatus,
  buildCompletedRunStatus,
  buildFailedRunStatus,
  buildRunningRunStatus,
  buildRunStatusPath,
  type DiscoveryRunStatusStore,
} from "../state/run-status-store.ts";
import { validateSheetsCredentialReadiness } from "../sheets/credential-readiness.ts";

export type WebhookRequestLike = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
};

export type WebhookResponseLike = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type HandleWebhookDependencies = {
  runSynchronously?: boolean;
  asyncPollAfterMs?: number;
  now?(): Date;
  log?(event: string, details: Record<string, unknown>): void;
  runStatusPathForRun?(runId: string): string;
  runStatusStore?: DiscoveryRunStatusStore;
  runDiscovery(
    request: DiscoveryWebhookRequestV1,
    trigger: "manual",
    dependencies: RunDiscoveryDependencies,
  ): Promise<RunDiscoveryResult>;
  runDependencies: RunDiscoveryDependencies;
};

export async function handleDiscoveryWebhook(
  request: WebhookRequestLike,
  dependencies: HandleWebhookDependencies,
): Promise<WebhookResponseLike> {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return jsonResponse(
      405,
      {
        ok: false,
        message: "Method not allowed",
      },
      {
        allow: "POST,OPTIONS",
      },
    );
  }

  if (
    !hasValidWebhookSecret(
      dependencies.runDependencies.runtimeConfig.webhookSecret,
      request.headers,
    )
  ) {
    return jsonResponse(401, {
      ok: false,
      message: "Unauthorized discovery webhook request.",
    });
  }

  const parsed = parseWebhookRequest(request.bodyText);
  if (!parsed.ok) {
    return jsonResponse(400, {
      ok: false,
      message: parsed.message,
    });
  }

  const runId =
    dependencies.runDependencies.runId ||
    createRunId(dependencies.runDependencies.randomId);
  const now = dependencies.now || (() => new Date());
  const acceptedAt = now().toISOString();
  const statusPathBuilder = dependencies.runStatusPathForRun || buildRunStatusPath;
  const statusPath = statusPathBuilder(runId);
  const pollAfterMs = Math.max(1000, dependencies.asyncPollAfterMs || 2000);
  const baseRunLogger = dependencies.runDependencies.log;
  const runDependencies = {
    ...dependencies.runDependencies,
    runId,
    log: (event: string, details: Record<string, unknown>) => {
      baseRunLogger?.(event, details);
      dependencies.log?.(event, details);
    },
  };
  const runMode = dependencies.runSynchronously ? "sync" : "async";
  const preflight = await validateDiscoveryPreflight(
    parsed.request.sheetId,
    dependencies.runDependencies,
  );
  if (preflight) {
    dependencies.log?.("discovery.run.preflight_failed", {
      runId,
      mode: runMode,
      sheetId: parsed.request.sheetId,
      variationKey: parsed.request.variationKey,
      message: preflight.message,
    });
    return jsonResponse(preflight.status, {
      ok: false,
      message: preflight.message,
      ...(preflight.detail ? { detail: preflight.detail } : {}),
      ...(preflight.remediation ? { remediation: preflight.remediation } : {}),
    });
  }

  dependencies.log?.("discovery.request.validated", {
    runId,
    mode: runMode,
    sheetId: parsed.request.sheetId,
    variationKey: parsed.request.variationKey,
  });

  const acceptedStatus = buildAcceptedRunStatus({
    runId,
    trigger: "manual",
    request: {
      sheetId: parsed.request.sheetId,
      variationKey: parsed.request.variationKey,
      requestedAt: parsed.request.requestedAt,
    },
    acceptedAt,
  });
  dependencies.runStatusStore?.put(acceptedStatus);

  if (dependencies.runSynchronously) {
    const startedAt = now().toISOString();
    dependencies.runStatusStore?.put(
      buildRunningRunStatus(acceptedStatus, startedAt),
    );
    try {
      dependencies.log?.("discovery.run.started", {
        runId,
        mode: runMode,
        sheetId: parsed.request.sheetId,
        variationKey: parsed.request.variationKey,
      });
      const result = await dependencies.runDiscovery(
        parsed.request,
        "manual",
        runDependencies,
      );
      const completedStatus = buildCompletedRunStatus(result, {
        acceptedAt,
        startedAt,
      });
      dependencies.runStatusStore?.put(completedStatus);
      dependencies.log?.("discovery.run.completed", {
        runId,
        mode: runMode,
        state: result.lifecycle.state,
        companyCount: result.lifecycle.companyCount,
        listingCount: result.lifecycle.listingCount,
        normalizedLeadCount: result.lifecycle.normalizedLeadCount,
        appended: result.writeResult.appended,
        updated: result.writeResult.updated,
        warnings: result.warnings.length,
        sourceSummary: result.sourceSummary.map((entry) => ({
          sourceId: entry.sourceId,
          warningCount: entry.warnings.length,
          ...(entry.warnings.length ? { warnings: entry.warnings } : {}),
        })),
      });
      return jsonResponse(
        200,
        {
          ok: true,
          kind: "completed_sync",
          runId,
          message: completedStatus.message,
          statusPath,
          outcome: completedStatus,
        } satisfies DiscoveryWebhookAck,
      );
    } catch (error) {
      dependencies.runStatusStore?.put(
        buildFailedRunStatus(acceptedStatus, error, now().toISOString()),
      );
      dependencies.log?.("discovery.run.failed", {
        runId,
        mode: runMode,
        error: error instanceof Error ? error.message : String(error),
      });
      return jsonResponse(500, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  dependencies.log?.("discovery.run.accepted", {
    runId,
    mode: runMode,
    sheetId: parsed.request.sheetId,
    variationKey: parsed.request.variationKey,
  });

  const startedAt = now().toISOString();
  void dependencies
    .runDiscovery(parsed.request, "manual", runDependencies)
    .then((result) => {
      dependencies.runStatusStore?.put(
        buildCompletedRunStatus(result, {
          acceptedAt,
          startedAt,
        }),
      );
      dependencies.log?.("discovery.run.completed", {
        runId,
        mode: runMode,
        state: result.lifecycle.state,
        companyCount: result.lifecycle.companyCount,
        listingCount: result.lifecycle.listingCount,
        normalizedLeadCount: result.lifecycle.normalizedLeadCount,
        appended: result.writeResult.appended,
        updated: result.writeResult.updated,
        warnings: result.warnings.length,
        sourceSummary: result.sourceSummary.map((entry) => ({
          sourceId: entry.sourceId,
          warningCount: entry.warnings.length,
          ...(entry.warnings.length ? { warnings: entry.warnings } : {}),
        })),
      });
    })
    .catch((error) => {
      dependencies.runStatusStore?.put(
        buildFailedRunStatus(
          buildRunningRunStatus(acceptedStatus, startedAt),
          error,
          now().toISOString(),
        ),
      );
      const message = error instanceof Error ? error.message : String(error);
      dependencies.log?.("discovery.run.failed", {
        runId,
        mode: runMode,
        error: message,
      });
      console.error("[browser-use-discovery] async discovery failed:", message);
    });
  dependencies.runStatusStore?.put(
    buildRunningRunStatus(acceptedStatus, startedAt),
  );

  return jsonResponse(202, {
    ok: true,
    kind: "accepted_async",
    runId,
    message: acceptedStatus.message,
    statusPath,
    pollAfterMs,
  });
}

export function formatWebhookAck(ack: DiscoveryWebhookAck): string {
  return JSON.stringify(ack);
}

type DiscoveryPreflightFailure = {
  status: number;
  message: string;
  detail?: string;
  remediation?: string;
};

async function validateDiscoveryPreflight(
  sheetId: string,
  runDependencies: RunDiscoveryDependencies,
): Promise<DiscoveryPreflightFailure | null> {
  let storedConfig: StoredWorkerConfig;
  try {
    storedConfig = await runDependencies.loadStoredWorkerConfig(sheetId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 500,
      message: "Discovery worker config could not be loaded.",
      detail: message,
    };
  }

  if (
    !Array.isArray(storedConfig.companies) ||
    !storedConfig.companies.length
  ) {
    const configPath = String(
      runDependencies.runtimeConfig.workerConfigPath || "",
    ).trim();
    return {
      status: 409,
      message: "Discovery worker has no target companies configured.",
      detail: configPath
        ? `Add at least one company entry in ${configPath}, then retry.`
        : "Add at least one company entry to the worker config, then retry.",
      remediation:
        'Create a worker config JSON with a `companies` array. Each entry should look like {"name":"Acme","boardHints":{"greenhouse":"acme"}}.',
    };
  }

  const sheetsCredentialReadiness = await validateSheetsCredentialReadiness(
    runDependencies.runtimeConfig,
    {
      now: runDependencies.now,
    },
  );
  if (!sheetsCredentialReadiness.configured) {
    return {
      status: 409,
      message:
        sheetsCredentialReadiness.message ||
        "Discovery worker has no Google Sheets credential configured.",
      ...(sheetsCredentialReadiness.detail
        ? { detail: sheetsCredentialReadiness.detail }
        : {}),
      ...(sheetsCredentialReadiness.remediation
        ? { remediation: sheetsCredentialReadiness.remediation }
        : {}),
    };
  }

  if (
    !String(sheetId || "").trim()
  ) {
    if (
      runDependencies.runtimeConfig.runMode === "local" &&
      String(storedConfig.sheetId || "").trim()
    ) {
      return null;
    }
    return {
      status: 400,
      message: "sheetId is required.",
      detail: String(storedConfig.sheetId || "").trim()
        ? "Hosted worker requests must include sheetId explicitly; local worker config defaults are only accepted in local mode."
        : "Provide `sheetId` in the webhook payload, or set `sheetId` in the local worker config before retrying.",
    };
  }

  return null;
}
function parseWebhookRequest(
  bodyText: string,
):
  | { ok: true; request: DiscoveryWebhookRequestV1 }
  | { ok: false; message: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(String(bodyText || ""));
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  if (!isPlainObject(payload)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }

  const event = stringValue(payload.event);
  const schemaVersion = Number(payload.schemaVersion);
  const sheetId = stringValue(payload.sheetId);
  const variationKey = stringValue(payload.variationKey);
  const requestedAt = stringValue(payload.requestedAt);
  const discoveryProfile = payload.discoveryProfile;

  if (event !== "command-center.discovery") {
    return { ok: false, message: "event must be command-center.discovery." };
  }
  if (schemaVersion !== 1) {
    return { ok: false, message: "schemaVersion must be 1." };
  }
  if (!variationKey) {
    return { ok: false, message: "variationKey is required." };
  }
  if (!requestedAt || Number.isNaN(Date.parse(requestedAt))) {
    return {
      ok: false,
      message: "requestedAt must be a valid ISO timestamp.",
    };
  }
  if (
    discoveryProfile != null &&
    (typeof discoveryProfile !== "object" || Array.isArray(discoveryProfile))
  ) {
    return {
      ok: false,
      message: "discoveryProfile must be an object when present.",
    };
  }

  return {
    ok: true,
    request: {
      event: "command-center.discovery",
      schemaVersion: 1,
      sheetId,
      variationKey,
      requestedAt,
      ...(discoveryProfile
        ? {
            discoveryProfile:
              discoveryProfile as DiscoveryWebhookRequestV1["discoveryProfile"],
          }
        : {}),
    },
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): WebhookResponseLike {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createRunId(randomId?: ((prefix: string) => string) | null): string {
  if (typeof randomId === "function") return randomId("run");
  return `run_${randomUUID().replace(/-/g, "")}`;
}

function hasValidWebhookSecret(
  configuredSecret: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const expected = stringValue(configuredSecret);
  // Fail closed: when no secret is configured, reject all requests to avoid
  // silently degrading into an open permissive webhook.
  if (!expected) return false;
  const provided = readHeader(headers, "x-discovery-secret");
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const wanted = String(key || "").toLowerCase();
  for (const [headerName, headerValue] of Object.entries(headers || {})) {
    if (String(headerName || "").toLowerCase() !== wanted) continue;
    if (Array.isArray(headerValue)) {
      return stringValue(headerValue[0]);
    }
    return stringValue(headerValue);
  }
  return "";
}
