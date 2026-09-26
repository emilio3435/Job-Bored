import type { WorkerRuntimeConfig } from "../config.ts";
import {
  DID_THEY_REPLY_VALUES,
  PIPELINE_PATCH_FIELD_KEYS,
  PIPELINE_STATUS_VALUES,
  PipelineAmbiguousMatchError,
  PipelinePatchValidationError,
  type DidTheyReply,
  type PipelinePatchInput,
  type PipelinePatchResult,
  type PipelineStatus,
} from "../sheets/pipeline-patcher.ts";
import { isIsoDate } from "../sheets/pipeline-transitions.ts";
import { PipelineHeaderMismatchError } from "../sheets/sheets-client.ts";
import {
  hasValidWebhookSecret,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";

export type HandlePipelineUpdateDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  patchPipeline: (sheetId: string, input: PipelinePatchInput) => Promise<PipelinePatchResult>;
  log?: (event: string, details?: Record<string, unknown>) => void;
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): WebhookResponseLike {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

/**
 * Error body with the api-error.v1 fields (spec §7.5: error, code, detail,
 * nextStep, retryable). `ok` and `message` stay for v1 callers.
 */
function errorResponse(
  status: number,
  params: { code: string; error: string; detail?: string; nextStep: string; retryable: boolean },
  headers: Record<string, string> = {},
): WebhookResponseLike {
  return jsonResponse(
    status,
    {
      ok: false,
      message: params.error,
      error: params.error,
      code: params.code,
      ...(params.detail ? { detail: params.detail } : {}),
      nextStep: params.nextStep,
      retryable: params.retryable,
    },
    headers,
  );
}

function invalid(message: string): WebhookResponseLike {
  return errorResponse(400, {
    code: "invalid_request",
    error: message,
    nextStep: "Fix the request body; see schemas/pipeline-update-request.v2.schema.json.",
    retryable: false,
  });
}

type ParseResult =
  | { ok: true; sheetId: string; input: PipelinePatchInput }
  | { ok: false; message: string };

const PIPELINE_UPDATE_EVENT = "command-center.pipeline-update";
const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2]);
const V1_FIELD_KEYS = new Set<string>(PIPELINE_PATCH_FIELD_KEYS.filter((key) => key !== "source"));
const V2_FIELD_KEYS = new Set<string>(PIPELINE_PATCH_FIELD_KEYS);

function parseRequest(bodyText: string | undefined): ParseResult {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(bodyText || "") as Record<string, unknown>;
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  if (!record || typeof record !== "object") {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  if (record.event !== PIPELINE_UPDATE_EVENT) {
    return { ok: false, message: "event must be command-center.pipeline-update." };
  }
  const schemaVersion = record.schemaVersion;
  if (typeof schemaVersion !== "number" || !SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    return { ok: false, message: "schemaVersion must be 2 (1 is still accepted)." };
  }
  const sheetId = typeof record.sheetId === "string" ? record.sheetId.trim() : "";
  if (!sheetId) {
    return { ok: false, message: "sheetId is required." };
  }
  const job = (record.job ?? {}) as Record<string, unknown>;
  const url = typeof job.url === "string" ? job.url.trim() : "";
  const company = typeof job.company === "string" ? job.company.trim() : "";
  const title = typeof job.title === "string" ? job.title.trim() : "";
  if (!url && !(company && title)) {
    return { ok: false, message: "job.url, or both job.company and job.title, are required." };
  }
  const rawFields = (record.fields ?? {}) as Record<string, unknown>;
  const allowed = schemaVersion === 2 ? V2_FIELD_KEYS : V1_FIELD_KEYS;
  const unknownFields = Object.keys(rawFields).filter((key) => !allowed.has(key));
  if (unknownFields.length) {
    return { ok: false, message: `Unknown pipeline-update field(s): ${unknownFields.join(", ")}.` };
  }
  const fields: PipelinePatchInput["fields"] = {};
  if ("stage" in rawFields) {
    const stage = rawFields.stage;
    if (typeof stage !== "string" || !PIPELINE_STATUS_VALUES.includes(stage as PipelineStatus)) {
      return { ok: false, message: `stage must be one of: ${PIPELINE_STATUS_VALUES.join(", ")}.` };
    }
    fields.stage = stage as PipelineStatus;
  }
  if ("didTheyReply" in rawFields) {
    const reply = rawFields.didTheyReply;
    if (typeof reply !== "string" || !DID_THEY_REPLY_VALUES.includes(reply as DidTheyReply)) {
      return { ok: false, message: `didTheyReply must be one of: ${DID_THEY_REPLY_VALUES.join(", ")}.` };
    }
    fields.didTheyReply = reply as DidTheyReply;
  }
  for (const key of ["contact", "note", "lastContact", "appliedDate", "source"] as const) {
    if (key in rawFields) {
      if (typeof rawFields[key] !== "string") {
        return { ok: false, message: `${key} must be a string.` };
      }
      fields[key] = rawFields[key] as string;
    }
  }
  for (const key of ["appliedDate", "lastContact"] as const) {
    const value = fields[key];
    if (value !== undefined && value !== "" && !isIsoDate(value)) {
      return { ok: false, message: `${key} must be a date written as YYYY-MM-DD.` };
    }
  }
  if (schemaVersion === 2 && fields.stage === "Applied") {
    if (!fields.appliedDate) {
      return { ok: false, message: "stage Applied requires appliedDate (YYYY-MM-DD)." };
    }
    if (!(fields.source || "").trim()) {
      return { ok: false, message: "stage Applied requires source (where the application went in)." };
    }
  }
  if (Object.keys(fields).length === 0) {
    return { ok: false, message: "fields must include at least one updatable field." };
  }
  return { ok: true, sheetId, input: { job: { url, company, title }, fields } };
}

export async function handlePipelineUpdateWebhook(
  request: WebhookRequestLike,
  dependencies: HandlePipelineUpdateDependencies,
): Promise<WebhookResponseLike> {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return errorResponse(
      405,
      { code: "method_not_allowed", error: "Method not allowed", nextStep: "Send a POST.", retryable: false },
      { allow: "POST,OPTIONS" },
    );
  }
  const auth = hasValidWebhookSecret(dependencies.runtimeConfig.webhookSecret, request.headers);
  if (!auth.valid) {
    return errorResponse(401, {
      code: "unauthorized",
      error: "Unauthorized pipeline-update request.",
      nextStep: "Send the worker's webhook secret in x-discovery-secret.",
      retryable: false,
    });
  }
  const parsed = parseRequest(request.bodyText);
  if (!parsed.ok) {
    return invalid(parsed.message);
  }
  let result: PipelinePatchResult;
  try {
    result = await dependencies.patchPipeline(parsed.sheetId, parsed.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof PipelinePatchValidationError) {
      return invalid(message);
    }
    if (error instanceof PipelineHeaderMismatchError) {
      return errorResponse(409, {
        code: "header_mismatch",
        error: "The Pipeline header no longer matches the schema.",
        detail: `Column ${error.column} is ${error.found ? `'${error.found}'` : "empty"}; expected '${error.expected}'.`,
        nextStep: "Restore the header row or re-run setup.",
        retryable: false,
      });
    }
    if (error instanceof PipelineAmbiguousMatchError) {
      return errorResponse(409, {
        code: "ambiguous_match",
        error: "The job matches more than one Pipeline row.",
        detail: `Rows ${error.rowNumbers.join(", ")} match by ${error.matchedBy === "url" ? "Link" : "company and title"}.`,
        nextStep: "Merge or delete the duplicate rows, or send the job's exact url.",
        retryable: false,
      });
    }
    dependencies.log?.("pipeline-update.error", { message });
    return errorResponse(502, {
      code: "sheet_write_failed",
      error: "Failed to update pipeline.",
      detail: message,
      nextStep: "Retry shortly; check the worker's Google credential if it keeps failing.",
      retryable: true,
    });
  }
  if (!result.matched) {
    return errorResponse(404, {
      code: "not_found",
      error: "No matching pipeline row.",
      nextStep: "Check job.url, or send company and title exactly as the Sheet has them.",
      retryable: false,
    });
  }
  return jsonResponse(200, {
    ok: true,
    updated: true,
    matched: true,
    matchedBy: result.matchedBy,
    row: result.rowNumber,
    rowNumber: result.rowNumber,
  });
}
