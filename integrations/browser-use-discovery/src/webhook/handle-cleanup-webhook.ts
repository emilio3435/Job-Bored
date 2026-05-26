/**
 * POST /cleanup-expired — synchronous expired-job cleanup pass.
 *
 * Mirrors the discovery webhook's auth + per-request googleAccessToken pattern,
 * but runs the cleanup classifier synchronously and returns counts plus the
 * full result list so the dashboard can render the review modal immediately.
 */
import type { WorkerRuntimeConfig } from "../config.ts";
import { runExpiredJobCleanup, type ExpiredCleanupResult } from "../cleanup/expired-job-cleanup.ts";
import {
  hasValidWebhookSecret,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";

export type HandleCleanupExpiredDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  runCleanup?: typeof runExpiredJobCleanup;
  log?(event: string, details: Record<string, unknown>): void;
};

type CleanupRequestBody = {
  sheetId?: string;
  dryRun?: boolean;
  maxRows?: number;
  timeoutMs?: number;
  googleAccessToken?: string;
};

export async function handleCleanupExpiredWebhook(
  request: WebhookRequestLike,
  dependencies: HandleCleanupExpiredDependencies,
): Promise<WebhookResponseLike> {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return jsonResponse(
      405,
      { ok: false, message: "Method not allowed" },
      { allow: "POST,OPTIONS" },
    );
  }

  const authCheck = hasValidWebhookSecret(
    dependencies.runtimeConfig.webhookSecret,
    request.headers,
  );
  if (!authCheck.valid) {
    return jsonResponse(401, {
      ok: false,
      message: "Unauthorized cleanup-expired request.",
      auth: {
        category: authCheck.category,
        detail: authCheck.detail,
        ...(authCheck.remediation ? { remediation: authCheck.remediation } : {}),
      },
    });
  }

  let body: CleanupRequestBody = {};
  if (request.bodyText && request.bodyText.trim().length > 0) {
    try {
      body = JSON.parse(request.bodyText) as CleanupRequestBody;
    } catch (_) {
      return jsonResponse(400, {
        ok: false,
        message: "Request body must be JSON.",
      });
    }
  }

  const sheetId = String(body.sheetId || "").trim();
  if (!sheetId) {
    return jsonResponse(400, {
      ok: false,
      message: "sheetId is required.",
    });
  }

  // Strip per-request googleAccessToken from logging payloads by isolating it
  // in a per-call runtime config; the rest of the runtime stays untouched.
  const perRequestRuntimeConfig: WorkerRuntimeConfig = body.googleAccessToken
    ? {
        ...dependencies.runtimeConfig,
        googleAccessToken: String(body.googleAccessToken),
      }
    : dependencies.runtimeConfig;

  const dryRun = body.dryRun !== false;
  const log = dependencies.log;
  log?.("cleanup-expired.request", { sheetId, dryRun });

  try {
    const runCleanup = dependencies.runCleanup || runExpiredJobCleanup;
    const result: ExpiredCleanupResult = await runCleanup({
      sheetId,
      runtimeConfig: perRequestRuntimeConfig,
      options: {
        dryRun,
        maxRows: Number.isInteger(body.maxRows) && body.maxRows! > 0 ? body.maxRows : undefined,
        timeoutMs:
          Number.isInteger(body.timeoutMs) && body.timeoutMs! > 0
            ? body.timeoutMs
            : undefined,
      },
    });

    log?.("cleanup-expired.complete", {
      sheetId,
      dryRun: result.dryRun,
      checked: result.checked,
      open: result.open,
      needsReview: result.needsReview,
      skipped: result.skipped,
      wouldExpire: result.wouldExpire,
      updated: result.updated,
    });

    return jsonResponse(200, {
      ok: true,
      sheetId: result.sheetId,
      sheetName: result.sheetName,
      dryRun: result.dryRun,
      checked: result.checked,
      open: result.open,
      needsReview: result.needsReview,
      skipped: result.skipped,
      wouldExpire: result.wouldExpire,
      updated: result.updated,
      results: result.results,
    });
  } catch (error) {
    log?.("cleanup-expired.failed", {
      sheetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(500, {
      ok: false,
      message: "Cleanup failed.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function jsonResponse(
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): WebhookResponseLike {
  return {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}
