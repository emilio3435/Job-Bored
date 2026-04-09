import type {
  DiscoveryWebhookAck,
  DiscoveryWebhookRequestV1,
} from "../contracts.ts";
import type {
  RunDiscoveryDependencies,
  RunDiscoveryResult,
} from "../run/run-discovery.ts";

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
  log?(event: string, details: Record<string, unknown>): void;
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

  const parsed = parseWebhookRequest(request.bodyText);
  if (!parsed.ok) {
    return jsonResponse(400, {
      ok: false,
      message: parsed.message,
    });
  }

  const runId =
    dependencies.runDependencies.runId ||
    dependencies.runDependencies.randomId("run");
  const runDependencies = {
    ...dependencies.runDependencies,
    runId,
  };
  const runMode = dependencies.runSynchronously ? "sync" : "async";

  dependencies.log?.("discovery.request.validated", {
    runId,
    mode: runMode,
    sheetId: parsed.request.sheetId,
    variationKey: parsed.request.variationKey,
  });

  if (dependencies.runSynchronously) {
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
      });
      return jsonResponse(
        200,
        formatWebhookAckFromResult(result, "completed_sync"),
      );
    } catch (error) {
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

  void dependencies.runDiscovery(parsed.request, "manual", runDependencies)
    .then((result) => {
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
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      dependencies.log?.("discovery.run.failed", {
        runId,
        mode: runMode,
        error: message,
      });
      console.error("[browser-use-discovery] async discovery failed:", message);
    });

  return jsonResponse(202, {
    ok: true,
    kind: "accepted_async",
    runId,
    message: "Discovery accepted — worker queued the run",
  });
}

export function formatWebhookAck(ack: DiscoveryWebhookAck): string {
  return JSON.stringify(ack);
}

function formatWebhookAckFromResult(
  result: RunDiscoveryResult,
  kind: DiscoveryWebhookAck["kind"],
): DiscoveryWebhookAck {
  const message =
    kind === "completed_sync"
      ? result.lifecycle.state === "empty"
        ? "Discovery completed — no matching leads were found."
        : result.warnings.length
          ? "Discovery completed with warnings — worker processed the run."
          : "Discovery completed — worker processed the run."
      : "Discovery accepted — worker queued the run";
  return {
    ok: true,
    kind,
    runId: result.run.runId,
    message,
  };
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
  if (!sheetId) {
    return { ok: false, message: "sheetId is required." };
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
