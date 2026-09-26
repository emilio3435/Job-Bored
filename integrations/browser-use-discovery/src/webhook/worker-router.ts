import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { checkLoopbackRequestHost } from "../../../../server/security-boundaries.mjs";
import type { WorkerRuntimeConfig } from "../config.ts";
import {
  BodyTooLargeError,
  MAX_BODY_BYTES,
  readBody as defaultReadBody,
} from "../http/body-limit.ts";
import { buildCorsHeaders, isOriginAllowed } from "../http/origin-guard.ts";
import type { DiscoveryRunStatusStore } from "../state/run-status-store.ts";
import { withApiErrorEnvelope } from "./api-error.ts";
import {
  hasValidWebhookSecret,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";
import type { RunCancelRegistry } from "./run-async-lifecycle.ts";
import { hasValidRunStatusToken, parseRunStatusPath } from "./run-status-auth.ts";

/**
 * BEAUDIT A14: the worker's HTTP request listener, side-effect free.
 *
 * server.ts used to define the router inline next to module-level side
 * effects (config load, store open, listen), so no test could boot it; A1
 * (`GET //` killed the worker) lived exactly there. This module takes every
 * collaborator as a dependency, so tests mount it on `node:http` port 0.
 *
 * It also holds the route table (one dispatch helper instead of five copies
 * of the read-body/log/413/500 block), the `/runs/:id` routes including
 * `POST /runs/:id/cancel` (A21), and the api-error.v1 funnel (E7, A13): every
 * error body leaves through `withApiErrorEnvelope`, and an unknown path gets
 * a JSON 404.
 */

export type RouteLog = (event: string, details?: Record<string, unknown>) => void;
export type RouteHandler = (
  request: WebhookRequestLike,
  log: RouteLog,
) => Promise<WebhookResponseLike>;

export interface WorkerRouteHandlers {
  discovery: RouteHandler;
  discoveryProfile: RouteHandler;
  pipelineUpdate: RouteHandler;
  ingestUrl: RouteHandler;
  cleanupExpired: RouteHandler;
}

export interface WorkerRouterDependencies {
  runtimeConfig: Pick<
    WorkerRuntimeConfig,
    "runMode" | "allowedOrigins" | "allowedHosts" | "webhookSecret"
  >;
  runStatusStore: Pick<DiscoveryRunStatusStore, "get">;
  cancelRegistry?: RunCancelRegistry;
  buildHealthPayload(): Promise<unknown>;
  handlers: WorkerRouteHandlers;
  logEvent(event: string, details: Record<string, unknown>): void;
  readBody?(request: IncomingMessage): Promise<string>;
}

/** The POST route table: path -> handler key and a label for error text. */
export const WORKER_POST_ROUTES: Readonly<
  Record<string, { handler: keyof WorkerRouteHandlers; label: string }>
> = {
  "/": { handler: "discovery", label: "discovery" },
  "/webhook": { handler: "discovery", label: "discovery" },
  "/discovery": { handler: "discovery", label: "discovery" },
  "/discovery-profile": { handler: "discoveryProfile", label: "discovery-profile" },
  "/pipeline-update": { handler: "pipelineUpdate", label: "pipeline-update" },
  "/ingest-url": { handler: "ingestUrl", label: "ingest-url" },
  "/cleanup-expired": { handler: "cleanupExpired", label: "cleanup-expired" },
};

const RUN_CANCEL_PATH = /^\/runs\/([^/]+)\/cancel$/;

/**
 * BEAUDIT A1 (SEC-05): `new URL("//", base)` throws ERR_INVALID_URL. Parse
 * inside a guard so a raw path is a 400, never an unhandled rejection that
 * kills the worker and every in-flight run.
 */
export function parseWorkerRequestUrl(rawUrl: string | undefined): URL | null {
  // A request target must be origin-form. `//host/path` would otherwise be
  // read as a network-path reference that swaps the authority.
  if (String(rawUrl || "/").startsWith("//")) return null;
  try {
    return new URL(rawUrl || "/", "http://127.0.0.1");
  } catch {
    return null;
  }
}

function getHeaderValue(header: string | string[] | undefined): string {
  if (Array.isArray(header)) return header[0] || "";
  return String(header || "");
}

function headersForHandler(
  headers: IncomingMessage["headers"],
): Record<string, string | string[] | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value : (value ?? undefined),
    ]),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Adds the api-error.v1 envelope to a JSON handler body when it is an error. */
function envelopeResponseBody(status: number, bodyText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
  const enveloped = withApiErrorEnvelope(status, parsed);
  return enveloped === parsed ? bodyText : JSON.stringify(enveloped);
}

export function createWorkerRequestListener(
  deps: WorkerRouterDependencies,
): (request: IncomingMessage, response: ServerResponse) => void {
  const readBody = deps.readBody || defaultReadBody;
  return (request, response) => {
    handleWorkerRequest(deps, readBody, request, response).catch(
      (error: unknown) => {
        // Catch-all: a handler bug answers 500 and never rethrows.
        console.error(
          "[browser-use-discovery] request handler failed:",
          formatError(error),
        );
        try {
          if (!response.headersSent) {
            response.writeHead(500, {
              "content-type": "application/json; charset=utf-8",
            });
            response.end(
              JSON.stringify(
                withApiErrorEnvelope(500, { ok: false, message: "Internal error." }),
              ),
            );
          } else {
            response.end();
          }
        } catch {
          // The socket is already gone; nothing left to answer.
        }
      },
    );
  };
}

async function handleWorkerRequest(
  deps: WorkerRouterDependencies,
  readBody: (request: IncomingMessage) => Promise<string>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const { runtimeConfig, logEvent } = deps;
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const origin = getHeaderValue(request.headers.origin);
  const corsHeaders = buildCorsHeaders(runtimeConfig.allowedOrigins, origin);

  const sendJson = (
    status: number,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): void => {
    response.statusCode = status;
    for (const [key, value] of Object.entries({
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    })) {
      response.setHeader(key, value);
    }
    response.end(JSON.stringify(withApiErrorEnvelope(status, body)));
  };

  // BEAUDIT E1: the shared loopback Host guard. A DNS-rebound page reaches
  // 127.0.0.1 with its own name in Host; only loopback names on this port and
  // the configured tunnel hosts get through. The guard applies to the local
  // run mode; a hosted worker sits behind a reverse proxy that connects over
  // 127.0.0.1 with its public Host, and the webhook secret gates it instead.
  const hostCheck =
    runtimeConfig.runMode === "local"
      ? checkLoopbackRequestHost(request, {
          tunnelHosts: runtimeConfig.allowedHosts || [],
        })
      : ({ ok: true } as const);
  if (!hostCheck.ok) {
    sendJson(hostCheck.status, {
      ok: false,
      code: hostCheck.code,
      message: hostCheck.error,
    });
    return;
  }
  const requestUrl = parseWorkerRequestUrl(request.url);
  if (!requestUrl) {
    sendJson(
      400,
      { ok: false, code: "malformed_url", message: "Malformed request URL." },
      corsHeaders,
    );
    return;
  }
  const requestPath = requestUrl.pathname;
  const method = (request.method || "GET").toUpperCase();

  logEvent("http.request.received", {
    requestId,
    method,
    path: requestPath,
    origin: origin || undefined,
  });

  const finishJson = (
    status: number,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): void => {
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status,
      durationMs: Date.now() - startedAt,
    });
    sendJson(status, body, extraHeaders);
  };

  if (origin && !isOriginAllowed(runtimeConfig.allowedOrigins, origin)) {
    finishJson(
      403,
      { ok: false, code: "origin_not_allowed", message: "Origin not allowed for browser access." },
      corsHeaders,
    );
    return;
  }

  if (method === "OPTIONS") {
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status: 204,
      durationMs: Date.now() - startedAt,
    });
    response.statusCode = 204;
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.setHeader(key, value);
    }
    response.end();
    return;
  }

  if (requestPath === "/health") {
    finishJson(200, await deps.buildHealthPayload(), corsHeaders);
    return;
  }

  const cancelMatch = RUN_CANCEL_PATH.exec(requestPath);
  if (cancelMatch) {
    await handleRunCancel(deps, request, method, cancelMatch[1], finishJson, corsHeaders);
    return;
  }

  if (requestPath.startsWith("/runs/")) {
    if (method !== "GET") {
      finishJson(
        405,
        { ok: false, message: "Method not allowed" },
        { ...corsHeaders, allow: "GET,OPTIONS" },
      );
      return;
    }
    const parsedRunStatusPath = parseRunStatusPath(requestPath);
    if (!parsedRunStatusPath.ok) {
      finishJson(parsedRunStatusPath.status, parsedRunStatusPath.body, corsHeaders);
      return;
    }
    const { runId } = parsedRunStatusPath;
    if (runtimeConfig.runMode === "hosted") {
      const tokenAuthorized = hasValidRunStatusToken({
        webhookSecret: runtimeConfig.webhookSecret,
        runId,
        providedToken:
          requestUrl.searchParams.get("statusToken") ||
          getHeaderValue(request.headers["x-run-status-token"]),
      });
      const secretAuthorized = hasValidWebhookSecret(
        runtimeConfig.webhookSecret,
        headersForHandler(request.headers),
      ).valid;
      if (!tokenAuthorized && !secretAuthorized) {
        finishJson(
          401,
          { ok: false, message: "Unauthorized run status request." },
          corsHeaders,
        );
        return;
      }
    }
    const payload = deps.runStatusStore.get(runId);
    if (!payload) {
      finishJson(
        404,
        { ok: false, code: "run_not_found", message: "Run not found" },
        corsHeaders,
      );
      return;
    }
    finishJson(200, { ok: true, ...payload }, corsHeaders);
    return;
  }

  const route = Object.prototype.hasOwnProperty.call(WORKER_POST_ROUTES, requestPath)
    ? WORKER_POST_ROUTES[requestPath]
    : null;
  if (!route) {
    finishJson(
      404,
      {
        ok: false,
        code: "not_found",
        message: "Not found",
        detail: `No worker route for ${method} ${requestPath}.`,
      },
      corsHeaders,
    );
    return;
  }

  if (method !== "POST") {
    finishJson(
      405,
      { ok: false, message: "Method not allowed" },
      { ...corsHeaders, allow: "POST,OPTIONS" },
    );
    return;
  }

  const preAuth = hasValidWebhookSecret(
    runtimeConfig.webhookSecret,
    headersForHandler(request.headers),
  );
  if (!preAuth.valid) {
    logEvent("http.request.unauthorized", {
      requestId,
      method,
      path: requestPath,
      category: preAuth.category,
    });
    finishJson(
      401,
      {
        ok: false,
        message: preAuth.detail || "Unauthorized",
        auth: {
          category: preAuth.category,
          detail: preAuth.detail,
          ...(preAuth.remediation ? { remediation: preAuth.remediation } : {}),
        },
      },
      corsHeaders,
    );
    return;
  }

  const routeLog: RouteLog = (event, details) =>
    logEvent(event, { requestId, method, path: requestPath, ...(details || {}) });

  try {
    const bodyText = await readBody(request);
    logEvent("http.request.body", {
      requestId,
      method,
      path: requestPath,
      bytes: Buffer.byteLength(bodyText, "utf8"),
      contentType: getHeaderValue(request.headers["content-type"]) || undefined,
    });
    const result = await deps.handlers[route.handler](
      { method, headers: headersForHandler(request.headers), bodyText },
      routeLog,
    );
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status: result.status,
      durationMs: Date.now() - startedAt,
    });
    response.statusCode = result.status;
    for (const [key, value] of Object.entries({ ...corsHeaders, ...result.headers })) {
      response.setHeader(key, value);
    }
    response.end(envelopeResponseBody(result.status, result.body));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      logEvent("http.request.rejected", {
        requestId,
        method,
        path: requestPath,
        reason: "body_too_large",
        limit: MAX_BODY_BYTES,
      });
      finishJson(
        413,
        {
          ok: false,
          code: "payload_too_large",
          message: "Request body exceeds the configured limit.",
          nextStep: `Send a body under ${MAX_BODY_BYTES} bytes.`,
        },
        corsHeaders,
      );
      return;
    }
    logEvent("http.request.failed", {
      requestId,
      method,
      path: requestPath,
      durationMs: Date.now() - startedAt,
      error: formatError(error),
    });
    finishJson(
      500,
      {
        ok: false,
        code: "internal_error",
        message: `Internal error handling ${route.label} request.`,
        detail: formatError(error),
      },
      corsHeaders,
    );
  }
}

/**
 * BEAUDIT A21: `POST /runs/:runId/cancel`, authenticated with the webhook
 * secret. Aborts a live async run of this worker process and writes its
 * terminal `failed` status ("cancelled by user") plus its DiscoveryRuns row.
 */
async function handleRunCancel(
  deps: WorkerRouterDependencies,
  request: IncomingMessage,
  method: string,
  rawRunId: string,
  finishJson: (status: number, body: unknown, extraHeaders?: Record<string, string>) => void,
  corsHeaders: Record<string, string>,
): Promise<void> {
  if (method !== "POST") {
    finishJson(
      405,
      { ok: false, message: "Method not allowed" },
      { ...corsHeaders, allow: "POST,OPTIONS" },
    );
    return;
  }
  const auth = hasValidWebhookSecret(
    deps.runtimeConfig.webhookSecret,
    headersForHandler(request.headers),
  );
  if (!auth.valid) {
    finishJson(
      401,
      {
        ok: false,
        message: "Unauthorized run cancel request.",
        auth: {
          category: auth.category,
          detail: auth.detail,
          ...(auth.remediation ? { remediation: auth.remediation } : {}),
        },
      },
      corsHeaders,
    );
    return;
  }
  let runId = "";
  try {
    runId = decodeURIComponent(rawRunId).trim();
  } catch {
    runId = "";
  }
  if (!runId) {
    finishJson(400, { ok: false, code: "invalid_run_id", message: "Run id is malformed." }, corsHeaders);
    return;
  }
  const current = deps.runStatusStore.get(runId);
  if (!current) {
    finishJson(404, { ok: false, code: "run_not_found", message: "Run not found" }, corsHeaders);
    return;
  }
  if (current.terminal) {
    finishJson(
      409,
      {
        ok: false,
        code: "run_already_terminal",
        message: `Run already finished as ${current.status}.`,
        retryable: false,
        run: current,
      },
      corsHeaders,
    );
    return;
  }
  const outcome = deps.cancelRegistry
    ? await deps.cancelRegistry.cancel(runId, "Cancelled by user.")
    : ({ ok: false, reason: "not_running" } as const);
  if (!outcome.ok && outcome.reason === "status_not_saved") {
    // The run was stopped but its cancelled status did not persist: polling
    // still says `running`, so this is not a durable cancel (A21 repair).
    finishJson(
      503,
      {
        ok: false,
        code: "cancel_status_not_saved",
        message: "The run was stopped, but its cancelled status could not be saved.",
        detail: outcome.stopConfirmed
          ? "The run has stopped."
          : "The run had not fully stopped when the cancel gave up waiting.",
        nextStep: "Retry the cancel; if it keeps failing, check the worker's disk and state database.",
        retryable: true,
      },
      corsHeaders,
    );
    return;
  }
  if (!outcome.ok) {
    finishJson(
      409,
      {
        ok: false,
        code: "run_not_cancellable",
        message: "This run is not running in this worker process, so it cannot be cancelled.",
        nextStep: "Wait for the run to finish; a worker restart marks it failed.",
        retryable: false,
      },
      corsHeaders,
    );
    return;
  }
  finishJson(
    200,
    {
      ok: true,
      runId,
      cancelled: outcome.cancelled,
      stopConfirmed: outcome.stopConfirmed,
      run: outcome.status || deps.runStatusStore.get(runId),
    },
    corsHeaders,
  );
}
