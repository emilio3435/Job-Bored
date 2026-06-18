import type { WorkerRuntimeConfig } from "../config.ts";
import {
  DID_THEY_REPLY_VALUES,
  PIPELINE_STATUS_VALUES,
  type DidTheyReply,
  type PipelinePatchInput,
  type PipelinePatchResult,
  type PipelineStatus,
} from "../sheets/pipeline-patcher.ts";
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

type ParseResult =
  | { ok: true; sheetId: string; input: PipelinePatchInput }
  | { ok: false; message: string };

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
  for (const key of ["contact", "note", "lastContact", "appliedDate"] as const) {
    if (key in rawFields) {
      if (typeof rawFields[key] !== "string") {
        return { ok: false, message: `${key} must be a string.` };
      }
      fields[key] = rawFields[key] as string;
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
    return jsonResponse(405, { ok: false, message: "Method not allowed" }, { allow: "POST,OPTIONS" });
  }
  const auth = hasValidWebhookSecret(dependencies.runtimeConfig.webhookSecret, request.headers);
  if (!auth.valid) {
    return jsonResponse(401, { ok: false, message: "Unauthorized pipeline-update request." });
  }
  const parsed = parseRequest(request.bodyText);
  if (!parsed.ok) {
    return jsonResponse(400, { ok: false, message: parsed.message });
  }
  let result: PipelinePatchResult;
  try {
    result = await dependencies.patchPipeline(parsed.sheetId, parsed.input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.log?.("pipeline-update.error", { message });
    return jsonResponse(502, { ok: false, message: "Failed to update pipeline.", detail: message });
  }
  if (!result.matched) {
    return jsonResponse(404, { ok: false, message: "No matching pipeline row." });
  }
  return jsonResponse(200, { ok: true, updated: true, matchedBy: result.matchedBy, row: result.rowNumber });
}
