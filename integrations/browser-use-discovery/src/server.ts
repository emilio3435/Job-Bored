import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createSourceAdapterRegistry } from "./browser/source-adapters.ts";
import {
  formatBrowserRuntimeReadinessWarning,
  validateBrowserRuntimeReadiness,
} from "./browser/runtime-readiness.ts";
import {
  loadRuntimeConfig,
  loadStoredWorkerConfig,
  mergeDiscoveryConfig,
} from "./config.ts";
import { createGroundedSearchClient } from "./grounding/grounded-search.ts";
import { buildCorsHeaders, isOriginAllowed } from "./http/origin-guard.ts";
import { createGeminiMatchClient } from "./match/job-matcher.ts";
import { runDiscovery } from "./run/run-discovery.ts";
import {
  formatSheetsCredentialReadinessWarning,
  validateSheetsCredentialReadiness,
} from "./sheets/credential-readiness.ts";
import { createPipelineWriter } from "./sheets/pipeline-writer.ts";
import {
  buildRunStatusPath,
  createDiscoveryRunStatusStore,
} from "./state/run-status-store.ts";
import { handleDiscoveryWebhook } from "./webhook/handle-discovery-webhook.ts";
import { createBrowserUseSessionManager } from "./browser/session.ts";

const runtimeConfig = loadRuntimeConfig(process.env);
const sessionManager = createBrowserUseSessionManager(runtimeConfig);
const groundedSearchClient = runtimeConfig.geminiApiKey
  ? createGroundedSearchClient(runtimeConfig)
  : null;
const matchClient = runtimeConfig.geminiApiKey
  ? createGeminiMatchClient(runtimeConfig)
  : null;
const sourceAdapterRegistry = createSourceAdapterRegistry(sessionManager);
const pipelineWriter = createPipelineWriter(runtimeConfig);
const runStatusStore = createDiscoveryRunStatusStore(
  runtimeConfig.stateDatabasePath,
);
const RUN_STATUS_TEMPLATE = "/runs/{runId}";

const sharedRunDependencies = {
  runtimeConfig,
  sourceAdapterRegistry,
  browserSessionManager: sessionManager,
  groundedSearchClient,
  matchClient,
  pipelineWriter,
  loadStoredWorkerConfig: (sheetId: string) =>
    loadStoredWorkerConfig(runtimeConfig, sheetId),
  mergeDiscoveryConfig,
  now: () => new Date(),
  randomId: (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`,
};

/**
 * Used by the request handler when a discovery request carries its own
 * `googleAccessToken`. The override config is the global runtimeConfig with
 * `googleAccessToken` populated, so the writer authenticates as the
 * dashboard's signed-in user instead of the worker's persistent credential.
 */
function createPipelineWriterForRequest(
  runtimeConfigOverride: typeof runtimeConfig,
) {
  return createPipelineWriter(runtimeConfigOverride);
}

function getHeaderValue(header: string | string[] | undefined): string {
  if (Array.isArray(header)) {
    return header[0] || "";
  }
  return String(header || "");
}

async function readBody(
  request: import("node:http").IncomingMessage,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.statusCode = status;
  setHeaders(response, {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function logEvent(event: string, details: Record<string, unknown>): void {
  console.log(
    `[browser-use-discovery] ${JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...details,
    })}`,
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function setHeaders(
  response: import("node:http").ServerResponse,
  headers: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value);
  }
}

async function buildHealthPayload() {
  let storedConfig = null;
  let configError = "";
  try {
    storedConfig = await loadStoredWorkerConfig(runtimeConfig, "");
  } catch (error) {
    configError = formatError(error);
  }

  const enabledSources = Array.isArray(storedConfig?.enabledSources)
    ? storedConfig.enabledSources
    : [];
  const groundedWebEnabled = enabledSources.includes("grounded_web");
  const readinessWarnings: string[] = [];
  const sheetsCredentialReadiness =
    await validateSheetsCredentialReadiness(runtimeConfig);

  // VAL-OBS-001: Check browser runtime readiness
  const browserRuntimeReadiness =
    await validateBrowserRuntimeReadiness(runtimeConfig);

  if (configError) {
    readinessWarnings.push(`Worker config could not be loaded: ${configError}`);
  }
  if (
    !Array.isArray(storedConfig?.companies) ||
    !storedConfig?.companies.length
  ) {
    readinessWarnings.push(
      "Discovery worker has no target companies configured.",
    );
  }
  if (!sheetsCredentialReadiness.configured) {
    readinessWarnings.push(
      formatSheetsCredentialReadinessWarning(sheetsCredentialReadiness),
    );
  }

  // VAL-OBS-001: Browser runtime not ready
  if (!browserRuntimeReadiness.available) {
    readinessWarnings.push(
      formatBrowserRuntimeReadinessWarning(browserRuntimeReadiness),
    );
  }

  // VAL-OBS-002: Grounded-web readiness cause when enabled but not ready
  if (groundedWebEnabled && !groundedSearchClient) {
    const groundedWebCause = runtimeConfig.geminiApiKey
      ? "Grounded web source is enabled but the grounded search client is unavailable."
      : "Grounded web source is enabled but BROWSER_USE_DISCOVERY_GEMINI_API_KEY is not configured.";
    readinessWarnings.push(groundedWebCause);
  }

  return {
    status: "ok",
    service: "browser-use-discovery-worker",
    mode: runtimeConfig.runMode,
    asyncAckByDefault: runtimeConfig.asyncAckByDefault,
    routes: {
      health: "/health",
      webhook: "/webhook",
      discovery: "/discovery",
      runStatus: RUN_STATUS_TEMPLATE,
    },
    readiness: {
      ready: readinessWarnings.length === 0,
      configLoaded: !configError,
      configuredSheetId: !!String(storedConfig?.sheetId || "").trim(),
      companiesConfigured: Array.isArray(storedConfig?.companies)
        ? storedConfig.companies.length
        : 0,
      sheetsCredentialConfigured: sheetsCredentialReadiness.configured,
      enabledSources,
      browserRuntime: {
        configured: browserRuntimeReadiness.configured,
        available: browserRuntimeReadiness.available,
        ...(browserRuntimeReadiness.message
          ? { message: browserRuntimeReadiness.message }
          : {}),
        ...(browserRuntimeReadiness.detail
          ? { detail: browserRuntimeReadiness.detail }
          : {}),
        ...(browserRuntimeReadiness.remediation
          ? { remediation: browserRuntimeReadiness.remediation }
          : {}),
      },
      groundedWeb: {
        enabled: groundedWebEnabled,
        ready: !groundedWebEnabled || !!groundedSearchClient,
        ...(groundedWebEnabled && !groundedSearchClient
          ? {
              cause: runtimeConfig.geminiApiKey
                ? "Grounded search client unavailable despite API key configured."
                : "GEMINI_API_KEY not configured.",
              remediation: runtimeConfig.geminiApiKey
                ? "Check that the Gemini API key is valid and the service is accessible."
                : "Set BROWSER_USE_DISCOVERY_GEMINI_API_KEY to a valid API key.",
            }
          : {}),
      },
      warnings: readinessWarnings,
    },
  };
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const origin = getHeaderValue(request.headers.origin);
  const corsHeaders = buildCorsHeaders(runtimeConfig.allowedOrigins, origin);
  const requestPath = new URL(request.url || "/", "http://127.0.0.1").pathname;
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
    sendJson(response, status, body, extraHeaders);
  };

  if (origin && !isOriginAllowed(runtimeConfig.allowedOrigins, origin)) {
    finishJson(
      403,
      {
        ok: false,
        message: "Origin not allowed for browser access.",
      },
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
    setHeaders(response, corsHeaders);
    response.end();
    return;
  }

  if (requestPath === "/health") {
    finishJson(200, await buildHealthPayload(), corsHeaders);
    return;
  }

  if (requestPath.startsWith("/runs/")) {
    if (method !== "GET") {
      finishJson(
        405,
        {
          ok: false,
          message: "Method not allowed",
        },
        {
          ...corsHeaders,
          allow: "GET,OPTIONS",
        },
      );
      return;
    }

    const runId = decodeURIComponent(requestPath.slice("/runs/".length));
    const payload = runStatusStore.get(runId);
    if (!payload) {
      finishJson(
        404,
        {
          ok: false,
          message: "Run not found",
        },
        corsHeaders,
      );
      return;
    }

    finishJson(
      200,
      {
        ok: true,
        ...payload,
      },
      corsHeaders,
    );
    return;
  }

  if (!["/", "/webhook", "/discovery"].includes(requestPath)) {
    finishJson(
      404,
      {
        ok: false,
        message: "Not found",
      },
      corsHeaders,
    );
    return;
  }

  if (method !== "POST") {
    finishJson(
      405,
      {
        ok: false,
        message: "Method not allowed",
      },
      {
        ...corsHeaders,
        allow: "POST,OPTIONS",
      },
    );
    return;
  }

  try {
    const bodyText = await readBody(request);
    logEvent("http.request.body", {
      requestId,
      method,
      path: requestPath,
      bytes: Buffer.byteLength(bodyText, "utf8"),
      contentType: getHeaderValue(request.headers["content-type"]) || undefined,
    });
    const result = await handleDiscoveryWebhook(
      {
        method,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? value : (value ?? undefined),
          ]),
        ),
        bodyText,
      },
      {
        runSynchronously: !runtimeConfig.asyncAckByDefault,
        runStatusPathForRun: buildRunStatusPath,
        runStatusStore,
        runDiscovery,
        runDependencies: sharedRunDependencies,
        createPipelineWriterForRequest,
        log: (event, details) =>
          logEvent(event, {
            requestId,
            method,
            path: requestPath,
            ...details,
          }),
        // Default max duration for async runs is 5 minutes
        // This guarantees terminalization even if the run stalls
        maxRunDurationMs: 5 * 60 * 1000,
      },
    );
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status: result.status,
      durationMs: Date.now() - startedAt,
    });
    response.statusCode = result.status;
    setHeaders(response, {
      ...corsHeaders,
      ...result.headers,
    });
    response.end(result.body);
  } catch (error) {
    logEvent("http.request.failed", {
      requestId,
      method,
      path: requestPath,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    finishJson(
      500,
      {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      corsHeaders,
    );
  }
});

server.listen(runtimeConfig.port, runtimeConfig.host, () => {
  const host =
    runtimeConfig.host === "0.0.0.0" ? "127.0.0.1" : runtimeConfig.host;
  console.log(
    `[browser-use-discovery] listening on http://${host}:${runtimeConfig.port}`,
  );
});
