/**
 * BEAUDIT E7 / A13: the api-error.v1 envelope for every worker route.
 *
 * `schemas/api-error.v1.schema.json`: `{ error, code, detail?, nextStep?,
 * retryable }`. Worker error bodies keep their legacy `ok: false` and
 * `message` (and route-specific fields such as `reason`, `auth` or
 * `remediation`) so existing dashboard readers keep working; the envelope
 * fields are added next to them.
 *
 * `/ingest-url` extraction outcomes are answered with HTTP 200 and
 * `ok: false` (the dashboard switches on `reason`); they carry the envelope
 * too, with `code` equal to `reason`.
 */

export const API_ERROR_SCHEMA_VERSION = 1;

export interface ApiErrorV1 {
  error: string;
  code: string;
  detail?: string;
  nextStep?: string;
  retryable: boolean;
}

export const STATUS_CODES: Record<number, string> = {
  400: "invalid_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  413: "payload_too_large",
  421: "misdirected_request",
  429: "rate_limited",
  500: "internal_error",
  502: "upstream_error",
  503: "unavailable",
  504: "upstream_timeout",
};

/** Reasons a caller can fix by simply trying again later. */
const RETRYABLE_CODES = new Set([
  "rate_limited",
  "internal_error",
  "upstream_error",
  "unavailable",
  "upstream_timeout",
  "scrape_failed",
  "worker_error",
]);

export function codeForStatus(status: number): string {
  return STATUS_CODES[status] || (status >= 500 ? "internal_error" : "invalid_request");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Adds the api-error.v1 fields to an error body. A body that is not an error
 * (`ok` is not `false`, and the status is below 400) comes back unchanged.
 */
export function withApiErrorEnvelope(status: number, body: unknown): unknown {
  if (!isRecord(body)) return body;
  if (body.ok !== false && status < 400) return body;
  if (body.ok === true) return body;
  const auth = isRecord(body.auth) ? body.auth : {};
  const code =
    text(body.code) ||
    text(body.reason) ||
    (status >= 400 ? codeForStatus(status) : "request_failed");
  const error =
    text(body.error) || text(body.message) || "The request could not be completed.";
  const detail = text(body.detail) || text(auth.detail);
  const nextStep =
    text(body.nextStep) ||
    text(body.remediation) ||
    text(auth.remediation) ||
    text(body.hint);
  const retryable =
    typeof body.retryable === "boolean"
      ? body.retryable
      : RETRYABLE_CODES.has(code) || status >= 500;
  return {
    ...body,
    ok: false,
    message: text(body.message) || error,
    error,
    code,
    ...(detail ? { detail } : {}),
    ...(nextStep ? { nextStep } : {}),
    retryable,
  };
}

/** Builds a fresh worker error body (legacy fields plus the envelope). */
export function buildApiError(
  status: number,
  input: {
    message: string;
    code?: string;
    detail?: string;
    nextStep?: string;
    retryable?: boolean;
    extra?: Record<string, unknown>;
  },
): Record<string, unknown> {
  return withApiErrorEnvelope(status, {
    ...(input.extra || {}),
    ok: false,
    message: input.message,
    ...(input.code ? { code: input.code } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.nextStep ? { nextStep: input.nextStep } : {}),
    ...(typeof input.retryable === "boolean" ? { retryable: input.retryable } : {}),
  }) as Record<string, unknown>;
}
