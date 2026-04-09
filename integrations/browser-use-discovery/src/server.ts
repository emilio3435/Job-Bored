import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { createSourceAdapterRegistry } from "./browser/source-adapters.ts";
import {
  loadRuntimeConfig,
  loadStoredWorkerConfig,
  mergeDiscoveryConfig,
} from "./config.ts";
import { runDiscovery } from "./run/run-discovery.ts";
import { createPipelineWriter } from "./sheets/pipeline-writer.ts";
import { handleDiscoveryWebhook } from "./webhook/handle-discovery-webhook.ts";
import { createBrowserUseSessionManager } from "./browser/session.ts";

const runtimeConfig = loadRuntimeConfig(process.env);
const sessionManager = createBrowserUseSessionManager(runtimeConfig);
const sourceAdapterRegistry = createSourceAdapterRegistry(sessionManager);
const pipelineWriter = createPipelineWriter(runtimeConfig);

const sharedRunDependencies = {
  runtimeConfig,
  sourceAdapterRegistry,
  pipelineWriter,
  loadStoredWorkerConfig: (sheetId: string) =>
    loadStoredWorkerConfig(runtimeConfig, sheetId),
  mergeDiscoveryConfig,
  now: () => new Date(),
  randomId: (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`,
};

function getHeaderValue(header: string | string[] | undefined): string {
  if (Array.isArray(header)) {
    return header[0] || "";
  }
  return String(header || "");
}

function buildCorsHeaders(originHeader: string): Record<string, string> {
  const allowAnyOrigin = runtimeConfig.allowedOrigins.includes("*");
  const allowOrigin = allowAnyOrigin
    ? "*"
    : runtimeConfig.allowedOrigins.includes(originHeader)
      ? originHeader
      : runtimeConfig.allowedOrigins[0] || "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-discovery-secret",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
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
  response.writeHead(status, {
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

const server = createServer(async (request, response) => {
  const requestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const origin = getHeaderValue(request.headers.origin);
  const corsHeaders = buildCorsHeaders(origin);
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

  if (method === "OPTIONS") {
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status: 204,
      durationMs: Date.now() - startedAt,
    });
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  if (requestPath === "/health") {
    finishJson(
      200,
      {
        status: "ok",
        service: "browser-use-discovery-worker",
        mode: runtimeConfig.runMode,
        asyncAckByDefault: runtimeConfig.asyncAckByDefault,
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
            Array.isArray(value) ? value : value ?? undefined,
          ]),
        ),
        bodyText,
      },
      {
        runSynchronously: !runtimeConfig.asyncAckByDefault,
        runDiscovery,
        runDependencies: sharedRunDependencies,
        log: (event, details) =>
          logEvent(event, {
            requestId,
            method,
            path: requestPath,
            ...details,
          }),
      },
    );
    logEvent("http.request.completed", {
      requestId,
      method,
      path: requestPath,
      status: result.status,
      durationMs: Date.now() - startedAt,
    });
    response.writeHead(result.status, {
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
