import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  SOURCE_PRESET_VALUES,
} from "../contracts.ts";
import type {
  DiscoveryWebhookAck,
  DiscoveryRunStatusPayload,
  DiscoveryWebhookRequestV1,
  SourcePreset,
  StoredWorkerConfig,
} from "../contracts.ts";
import type { RunDiscoveryDependencies } from "../run/run-discovery.ts";
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
  /**
   * Optional factory used when the request body carries a per-run
   * `googleAccessToken`. Lets the handler build a fresh pipeline writer that
   * authenticates with the user's request-time token instead of the global
   * service account / OAuth credential. When omitted, the handler reuses
   * `runDependencies.pipelineWriter` and the per-request token is ignored.
   */
  createPipelineWriterForRequest?(
    runtimeConfigOverride: RunDiscoveryDependencies["runtimeConfig"],
  ): RunDiscoveryDependencies["pipelineWriter"];
  /**
   * Maximum duration in milliseconds for an async run before it is forcibly
   * terminalized. Defaults to 5 minutes (300000ms) if not specified.
   * This guarantees that async runs cannot stall indefinitely in running state.
   */
  maxRunDurationMs?: number;
};

// Default maximum async run duration: 5 minutes
const DEFAULT_MAX_RUN_DURATION_MS = 5 * 60 * 1000;

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

  const authCheck = hasValidWebhookSecret(
    dependencies.runDependencies.runtimeConfig.webhookSecret,
    request.headers,
  );
  if (!authCheck.valid) {
    return jsonResponse(401, {
      ok: false,
      message: "Unauthorized discovery webhook request.",
      auth: {
        category: authCheck.category,
        detail: authCheck.detail,
        ...(authCheck.remediation ? { remediation: authCheck.remediation } : {}),
      },
    });
  }

  const parsed = parseWebhookRequest(request.bodyText);
  if (!parsed.ok) {
    return jsonResponse(400, {
      ok: false,
      message: parsed.message,
      ...(parsed.detail ? { detail: parsed.detail } : {}),
      ...(parsed.remediation ? { remediation: parsed.remediation } : {}),
    });
  }

  const runId =
    dependencies.runDependencies.runId ||
    createRunId(dependencies.runDependencies.randomId);
  const now = dependencies.now || (() => new Date());
  const acceptedAt = now().toISOString();
  const statusPathBuilder =
    dependencies.runStatusPathForRun || buildRunStatusPath;
  const statusPath = statusPathBuilder(runId);
  const pollAfterMs = Math.max(1000, dependencies.asyncPollAfterMs || 2000);
  const baseRunLogger = dependencies.runDependencies.log;

  // Per-request Google access token (the dashboard's GIS sign-in path). Held
  // ONLY in this scope; never persisted, never logged, stripped from the
  // request object handed downstream so it cannot leak through run.request.
  const requestGoogleAccessToken =
    typeof parsed.request.googleAccessToken === "string"
      ? parsed.request.googleAccessToken.trim()
      : "";
  const requestForRun: DiscoveryWebhookRequestV1 = requestGoogleAccessToken
    ? (() => {
        const { googleAccessToken: _omitToken, ...rest } = parsed.request;
        return rest as DiscoveryWebhookRequestV1;
      })()
    : parsed.request;

  const baseRunDependencies: RunDiscoveryDependencies = {
    ...dependencies.runDependencies,
    runId,
    log: (event: string, details: Record<string, unknown>) => {
      baseRunLogger?.(event, details);
      dependencies.log?.(event, details);
    },
  };
  const runDependencies: RunDiscoveryDependencies =
    requestGoogleAccessToken && dependencies.createPipelineWriterForRequest
      ? (() => {
          const overrideRuntimeConfig = {
            ...baseRunDependencies.runtimeConfig,
            googleAccessToken: requestGoogleAccessToken,
          };
          return {
            ...baseRunDependencies,
            runtimeConfig: overrideRuntimeConfig,
            pipelineWriter: dependencies.createPipelineWriterForRequest(
              overrideRuntimeConfig,
            ),
          };
        })()
      : baseRunDependencies;

  const runMode = dependencies.runSynchronously ? "sync" : "async";
  const preflight = await validateDiscoveryPreflight(
    parsed.request,
    runDependencies,
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
        requestForRun,
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
      return jsonResponse(200, {
        ok: true,
        kind: "completed_sync",
        runId,
        message: completedStatus.message,
        statusPath,
        outcome: completedStatus,
      } satisfies DiscoveryWebhookAck);
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
  const maxRunDurationMs =
    dependencies.maxRunDurationMs ?? DEFAULT_MAX_RUN_DURATION_MS;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let runCompleted = false;

  // Safety terminalization: if the run doesn't complete within maxRunDurationMs,
  // force terminalize with partial status and a timeout warning.
  const scheduleSafetyTerminalization = () => {
    safetyTimer = setTimeout(() => {
      if (!runCompleted) {
        runCompleted = true;
        const currentStatus =
          dependencies.runStatusStore?.get(runId) ?? acceptedStatus;
        dependencies.runStatusStore?.put({
          ...currentStatus,
          status: "partial",
          terminal: true,
          message:
            "Discovery run exceeded maximum duration and was force-terminalized.",
          completedAt: now().toISOString(),
          updatedAt: now().toISOString(),
          warnings: [
            ...(currentStatus.warnings || []),
            `Run force-terminalized after ${maxRunDurationMs}ms timeout. Some sources may not have completed.`,
          ],
        });
        dependencies.log?.("discovery.run.force_terminalized", {
          runId,
          mode: runMode,
          maxRunDurationMs,
          reason: "safety_timeout",
        });
      }
    }, maxRunDurationMs);
  };

  const clearSafetyTerminalization = () => {
    if (safetyTimer !== null) {
      clearTimeout(safetyTimer);
      safetyTimer = null;
    }
  };

  void dependencies
    .runDiscovery(requestForRun, "manual", runDependencies)
    .then((result) => {
      runCompleted = true;
      clearSafetyTerminalization();
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
      runCompleted = true;
      clearSafetyTerminalization();
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
  // Schedule safety terminalization for async runs
  scheduleSafetyTerminalization();

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
  request: DiscoveryWebhookRequestV1,
  runDependencies: RunDiscoveryDependencies,
): Promise<DiscoveryPreflightFailure | null> {
  let storedConfig: StoredWorkerConfig;
  try {
    storedConfig = await runDependencies.loadStoredWorkerConfig(request.sheetId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 500,
      message: "Discovery worker config could not be loaded.",
      detail: message,
    };
  }

  // NOTE: Empty companies array is now allowed (unrestricted company scope).
  // VAL-API-010: Empty companies config must not hard-fail preflight when intent is non-blank.
  // VAL-API-011: Blank-intent guardrail still fails closed when companies is empty,
  // even under unrestricted company scope. This catches the case where discoveryProfile
  // is absent or both targetRoles and keywordsInclude are blank.

  const companiesEmpty =
    !Array.isArray(storedConfig.companies) || storedConfig.companies.length === 0;

  if (companiesEmpty) {
    // Check if intent is blank
    const profile = request.discoveryProfile;
    const rawTargetRoles = profile?.targetRoles;
    const rawKeywordsInclude = profile?.keywordsInclude;
    const targetRolesBlank =
      rawTargetRoles == null ||
      (typeof rawTargetRoles === "string" && !rawTargetRoles.trim());
    const keywordsBlank =
      rawKeywordsInclude == null ||
      (typeof rawKeywordsInclude === "string" && !rawKeywordsInclude.trim());

    if (targetRolesBlank && keywordsBlank) {
      // Blank intent with empty companies → explicit 400 failure
      return {
        status: 400,
        message:
          "Discovery intent cannot be blank when no target companies are configured.",
        detail:
          "Either provide target companies in the worker config, or provide explicit search intent (targetRoles or keywordsInclude) to run unrestricted discovery.",
        remediation:
          "Use the AI Suggester tab to generate role keywords, or add at least one company to the worker config, or provide explicit targetRoles (e.g., 'Senior Engineer') or keywordsInclude (e.g., 'AI,python') in your discoveryProfile.",
      };
    }
    // Non-blank intent with empty companies → allowed (unrestricted discovery)
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

  if (!String(request.sheetId || "").trim()) {
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
  | { ok: false; message: string; detail?: string; remediation?: string } {
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
  const googleAccessToken = stringValue(payload.googleAccessToken);

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

  // Validate sourcePreset enum when provided inside discoveryProfile.
  if (isPlainObject(discoveryProfile)) {
    if ("sourcePreset" in discoveryProfile) {
      const sourcePreset = discoveryProfile.sourcePreset;
      if (typeof sourcePreset !== "string") {
        return {
          ok: false,
          message:
            "discoveryProfile.sourcePreset must be a string when present.",
        };
      }
      if (
        !(SOURCE_PRESET_VALUES as readonly string[]).includes(sourcePreset)
      ) {
        return {
          ok: false,
          message: `discoveryProfile.sourcePreset must be one of: ${SOURCE_PRESET_VALUES.join(", ")}. Received: "${sourcePreset}".`,
        };
      }
    }

    // Reject contradictory legacy enabledSources alongside explicit sourcePreset.
    if (
      "sourcePreset" in discoveryProfile &&
      "enabledSources" in discoveryProfile
    ) {
      return {
        ok: false,
        message:
          "discoveryProfile.sourcePreset and discoveryProfile.enabledSources are mutually exclusive. Use sourcePreset as the canonical source selection field.",
      };
    }

    // VAL-API-006/VAL-API-008: Run intent must be request-authoritative.
    // If discoveryProfile is provided, at least one of targetRoles or keywordsInclude
    // must be non-blank. Blank intent fails with explicit guidance to use AI Suggester.
    // NOTE: We only validate when discoveryProfile is explicitly provided.
    // When discoveryProfile is absent, we allow the request to proceed (the preflight
    // and later intent-gating in the execution path will handle it).
    const profile = discoveryProfile as Record<string, unknown>;
    const rawTargetRoles = profile.targetRoles;
    const rawKeywordsInclude = profile.keywordsInclude;
    const targetRolesBlank =
      rawTargetRoles == null ||
      (typeof rawTargetRoles === "string" && !rawTargetRoles.trim());
    const keywordsBlank =
      rawKeywordsInclude == null ||
      (typeof rawKeywordsInclude === "string" && !rawKeywordsInclude.trim());

    if (targetRolesBlank && keywordsBlank) {
      return {
        ok: false,
        message:
          "discoveryProfile.targetRoles and discoveryProfile.keywordsInclude cannot both be blank or missing.",
        detail:
          "Discovery intent requires at least one search criteria. Neither targetRoles nor keywordsInclude was provided, or both were blank.",
        remediation:
          "Use the AI Suggester tab to generate role keywords, or provide explicit targetRoles (e.g., 'Senior Engineer') or keywordsInclude (e.g., 'AI,python') values in your discoveryProfile.",
      };
    }

    // VAL-API-004: Validate ultraPlanTuning control-plane fields.
    // Malformed control-plane fields fail closed with explicit 400 errors.
    if ("ultraPlanTuning" in profile) {
      const ultraPlanTuning = profile.ultraPlanTuning;
      if (ultraPlanTuning != null && typeof ultraPlanTuning !== "object") {
        return {
          ok: false,
          message:
            "discoveryProfile.ultraPlanTuning must be an object when present.",
        };
      }
      if (typeof ultraPlanTuning === "object" && ultraPlanTuning !== null) {
        const tuning = ultraPlanTuning as Record<string, unknown>;
        // Validate boolean fields
        for (const field of [
          "multiQueryEnabled",
          "retryBroadeningEnabled",
          "parallelCompanyProcessingEnabled",
        ]) {
          if (field in tuning && typeof tuning[field] !== "boolean") {
            return {
              ok: false,
              message: `discoveryProfile.ultraPlanTuning.${field} must be a boolean when present. Received: ${JSON.stringify(tuning[field])}`,
            };
          }
        }
        // Reject unknown keys
        const knownKeys = new Set([
          "multiQueryEnabled",
          "retryBroadeningEnabled",
          "parallelCompanyProcessingEnabled",
        ]);
        for (const key of Object.keys(tuning)) {
          if (!knownKeys.has(key)) {
            return {
              ok: false,
              message: `discoveryProfile.ultraPlanTuning contains unknown field "${key}". Known fields: ${[...knownKeys].join(", ")}.`,
            };
          }
        }
      }
    }

    // VAL-API-004: Validate groundedSearchTuning control-plane fields.
    // Malformed control-plane fields fail closed with explicit 400 errors.
    if ("groundedSearchTuning" in profile) {
      const groundedSearchTuning = profile.groundedSearchTuning;
      if (groundedSearchTuning != null && typeof groundedSearchTuning !== "object") {
        return {
          ok: false,
          message:
            "discoveryProfile.groundedSearchTuning must be an object when present.",
        };
      }
      if (typeof groundedSearchTuning === "object" && groundedSearchTuning !== null) {
        const tuning = groundedSearchTuning as Record<string, unknown>;
        // Validate numeric fields
        for (const field of [
          "maxResultsPerCompany",
          "maxPagesPerCompany",
          "maxRuntimeMs",
          "maxTokensPerQuery",
        ]) {
          if (
            field in tuning &&
            (typeof tuning[field] !== "number" || !Number.isFinite(tuning[field]))
          ) {
            return {
              ok: false,
              message: `discoveryProfile.groundedSearchTuning.${field} must be a finite number when present. Received: ${JSON.stringify(tuning[field])}`,
            };
          }
        }
        // Reject unknown keys
        const knownKeys = new Set([
          "maxResultsPerCompany",
          "maxPagesPerCompany",
          "maxRuntimeMs",
          "maxTokensPerQuery",
        ]);
        for (const key of Object.keys(tuning)) {
          if (!knownKeys.has(key)) {
            return {
              ok: false,
              message: `discoveryProfile.groundedSearchTuning contains unknown field "${key}". Known fields: ${[...knownKeys].join(", ")}.`,
            };
          }
        }
      }
    }
  }
  if (
    payload.googleAccessToken != null &&
    typeof payload.googleAccessToken !== "string"
  ) {
    return {
      ok: false,
      message: "googleAccessToken must be a string when present.",
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
              normalizeDiscoveryProfile(discoveryProfile) as DiscoveryWebhookRequestV1["discoveryProfile"],
          }
        : {}),
      ...(googleAccessToken ? { googleAccessToken } : {}),
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

function normalizeDiscoveryProfile(
  raw: Record<string, unknown>,
): DiscoveryWebhookRequestV1["discoveryProfile"] {
  const out: NonNullable<DiscoveryWebhookRequestV1["discoveryProfile"]> = {};
  if (typeof raw.sourcePreset === "string") {
    out.sourcePreset = raw.sourcePreset as SourcePreset;
  }
  if (typeof raw.targetRoles === "string") out.targetRoles = raw.targetRoles;
  if (typeof raw.locations === "string") out.locations = raw.locations;
  if (typeof raw.remotePolicy === "string") out.remotePolicy = raw.remotePolicy;
  if (typeof raw.seniority === "string") out.seniority = raw.seniority;
  if (typeof raw.keywordsInclude === "string")
    out.keywordsInclude = raw.keywordsInclude;
  if (typeof raw.keywordsExclude === "string")
    out.keywordsExclude = raw.keywordsExclude;
  if (typeof raw.maxLeadsPerRun === "string")
    out.maxLeadsPerRun = raw.maxLeadsPerRun;

  // Normalize ultraPlanTuning if present
  if (isPlainObject(raw.ultraPlanTuning)) {
    const tuning = raw.ultraPlanTuning as Record<string, unknown>;
    const normalizedTuning: NonNullable<DiscoveryWebhookRequestV1["discoveryProfile"]>["ultraPlanTuning"] = {};
    if (typeof tuning.multiQueryEnabled === "boolean") {
      normalizedTuning.multiQueryEnabled = tuning.multiQueryEnabled;
    }
    if (typeof tuning.retryBroadeningEnabled === "boolean") {
      normalizedTuning.retryBroadeningEnabled = tuning.retryBroadeningEnabled;
    }
    if (typeof tuning.parallelCompanyProcessingEnabled === "boolean") {
      normalizedTuning.parallelCompanyProcessingEnabled = tuning.parallelCompanyProcessingEnabled;
    }
    if (Object.keys(normalizedTuning).length > 0) {
      out.ultraPlanTuning = normalizedTuning;
    }
  }

  // Normalize groundedSearchTuning if present
  if (isPlainObject(raw.groundedSearchTuning)) {
    const tuning = raw.groundedSearchTuning as Record<string, unknown>;
    const normalizedTuning: NonNullable<DiscoveryWebhookRequestV1["discoveryProfile"]>["groundedSearchTuning"] = {};
    if (typeof tuning.maxResultsPerCompany === "number" && Number.isFinite(tuning.maxResultsPerCompany)) {
      normalizedTuning.maxResultsPerCompany = tuning.maxResultsPerCompany;
    }
    if (typeof tuning.maxPagesPerCompany === "number" && Number.isFinite(tuning.maxPagesPerCompany)) {
      normalizedTuning.maxPagesPerCompany = tuning.maxPagesPerCompany;
    }
    if (typeof tuning.maxRuntimeMs === "number" && Number.isFinite(tuning.maxRuntimeMs)) {
      normalizedTuning.maxRuntimeMs = tuning.maxRuntimeMs;
    }
    if (typeof tuning.maxTokensPerQuery === "number" && Number.isFinite(tuning.maxTokensPerQuery)) {
      normalizedTuning.maxTokensPerQuery = tuning.maxTokensPerQuery;
    }
    if (Object.keys(normalizedTuning).length > 0) {
      out.groundedSearchTuning = normalizedTuning;
    }
  }

  return out;
}

function createRunId(randomId?: ((prefix: string) => string) | null): string {
  if (typeof randomId === "function") return randomId("run");
  return `run_${randomUUID().replace(/-/g, "")}`;
}

type WebhookAuthCheckResult =
  | { valid: true }
  | {
      valid: false;
      category:
        | "no_secret_configured"
        | "missing_secret_header"
        | "secret_mismatch";
      detail: string;
      remediation?: string;
    };

/**
 * Validates the webhook secret and returns detailed auth failure information.
 * VAL-OBS-004: Authentication failures are explicitly categorized
 */
function hasValidWebhookSecret(
  configuredSecret: string,
  headers: Record<string, string | string[] | undefined>,
): WebhookAuthCheckResult {
  const expected = stringValue(configuredSecret);
  // Fail closed: when no secret is configured, reject all requests to avoid
  // silently degrading into an open permissive webhook.
  if (!expected) {
    return {
      valid: false,
      category: "no_secret_configured",
      detail: "Webhook secret is not configured on the worker.",
      remediation:
        "Set BROWSER_USE_DISCOVERY_WEBHOOK_SECRET (or DISCOVERY_WEBHOOK_SECRET) to a secure random value and configure the same value on the dashboard.",
    };
  }
  const provided = readHeader(headers, "x-discovery-secret");
  if (!provided) {
    return {
      valid: false,
      category: "missing_secret_header",
      detail: "x-discovery-secret header is missing from the request.",
      remediation:
        "Include the x-discovery-secret header with the configured webhook secret value.",
    };
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return {
      valid: false,
      category: "secret_mismatch",
      detail: "The provided x-discovery-secret does not match the configured secret.",
      remediation:
        "Verify that the x-discovery-secret header value matches the configured webhook secret.",
    };
  }
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
    return {
      valid: false,
      category: "secret_mismatch",
      detail: "The provided x-discovery-secret does not match the configured secret.",
      remediation:
        "Verify that the x-discovery-secret header value matches the configured webhook secret.",
    };
  }
  return { valid: true };
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
