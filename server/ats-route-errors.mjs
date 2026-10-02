/**
 * HOLES P9: what POST /api/ats-scorecard answers when scoring fails. Every
 * provider failure used to be the same 502 "Upstream provider request
 * failed"; each class now has its own status, api-error code, message and
 * next step, so the dashboard can tell a bad key from a rate limit from an
 * outage. The provider metadata fields the dashboard already reads
 * (provider, upstreamStatus, errorClass, providerCode) are kept.
 */
import { providerDisplayName } from "./ai/provider.mjs";

const SETTINGS = "Settings → AI";

/** @param {unknown} error */
function providerMetadata(error) {
  if (!error || typeof error !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (error);
  const provider = typeof record.provider === "string" ? record.provider : "";
  const upstreamStatus =
    typeof record.upstreamStatus === "number" && Number.isInteger(record.upstreamStatus)
      ? record.upstreamStatus
      : null;
  const retryable = typeof record.retryable === "boolean" ? record.retryable : null;
  const classification = typeof record.classification === "string" ? record.classification : "";
  const providerCode = typeof record.providerCode === "string" ? record.providerCode : "";
  if (!provider && upstreamStatus == null && retryable == null && !classification && !providerCode) {
    return null;
  }
  return { provider, upstreamStatus, retryable, classification, providerCode };
}

/**
 * @param {NonNullable<ReturnType<typeof providerMetadata>>} meta
 * @returns {{ status: number, code: string, error: string, nextStep?: string, retryable: boolean }}
 */
function providerFailure(meta) {
  // An unknown name reads as "LLM provider".
  const name = providerDisplayName(/** @type {import("./ai/provider.mjs").ProviderName | ""} */ (meta.provider));
  const http = meta.upstreamStatus != null ? ` (HTTP ${meta.upstreamStatus})` : "";
  if (meta.classification === "cancelled") {
    return { status: 499, code: "request_cancelled", error: "The ATS request was cancelled before it finished.", retryable: true };
  }
  if (meta.classification === "config") {
    return { status: 503, code: "llm_not_configured", error: "No AI provider is configured for ATS scoring.", nextStep: `Add a provider and key in ${SETTINGS}.`, retryable: false };
  }
  if (meta.classification === "rate_limit") {
    return { status: 429, code: "provider_rate_limited", error: `${name} is rate-limiting requests${http}.`, nextStep: `Wait a minute and try again, or switch models in ${SETTINGS}.`, retryable: true };
  }
  if (meta.classification === "output_limit") {
    return { status: 502, code: "provider_output_limit", error: "The model hit its output limit before finishing the scorecard.", nextStep: `Pick a model with a larger output budget in ${SETTINGS}.`, retryable: false };
  }
  const status = meta.upstreamStatus;
  if (status === 401 || status === 403) {
    return { status: 502, code: "provider_auth_failed", error: `${name} rejected the API key${http}.`, nextStep: `Check the key in ${SETTINGS}.`, retryable: false };
  }
  if (status === 404) {
    return { status: 502, code: "provider_model_not_found", error: `${name} could not find the model${http}.`, nextStep: `Check the model name in ${SETTINGS}.`, retryable: false };
  }
  if (status != null && status >= 400 && status < 500) {
    return { status: 502, code: "provider_rejected_request", error: `${name} rejected the request${http}.`, nextStep: `Try a different model in ${SETTINGS}.`, retryable: false };
  }
  if (status != null && status >= 500) {
    return { status: 502, code: "provider_unavailable", error: `${name} is having trouble${http}.`, nextStep: "Try again in a minute.", retryable: true };
  }
  if (meta.providerCode === "timeout") {
    return { status: 504, code: "provider_timeout", error: `${name} did not answer in time.`, nextStep: "Try again; a smaller model answers faster.", retryable: true };
  }
  if (meta.providerCode === "network_error") {
    return { status: 502, code: "provider_unreachable", error: `Could not reach ${name}.`, nextStep: `Check the connection, or the provider's base URL in ${SETTINGS}.`, retryable: true };
  }
  return { status: 502, code: "upstream_error", error: `The ${name} request failed${http}.`, retryable: meta.retryable ?? true };
}

/**
 * @param {unknown} error what analyzeAtsScorecard threw
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
export function atsFailureResponse(error) {
  const meta = providerMetadata(error);
  if (meta) {
    const failure = providerFailure(meta);
    return {
      status: failure.status,
      body: {
        error: failure.error,
        code: failure.code,
        ...(failure.nextStep ? { nextStep: failure.nextStep } : {}),
        retryable: failure.retryable,
        ...(meta.provider ? { provider: meta.provider } : {}),
        ...(meta.upstreamStatus != null ? { upstreamStatus: meta.upstreamStatus } : {}),
        ...(meta.classification ? { errorClass: meta.classification } : {}),
        ...(meta.providerCode ? { providerCode: meta.providerCode } : {}),
      },
    };
  }
  const message = String(/** @type {{ message?: unknown } | null | undefined} */ (error)?.message ?? error ?? "");
  if (/returned malformed JSON after retry/i.test(message)) {
    return {
      status: 502,
      body: { error: "The model returned malformed JSON twice.", code: "provider_malformed_output", nextStep: `Retry, or try a different model in ${SETTINGS}.`, retryable: true },
    };
  }
  if (message === 'Invalid event. Expected "command-center.ats-scorecard".') {
    return { status: 400, body: { error: message, code: "invalid_request", retryable: false } };
  }
  return { status: 500, body: { error: "ATS scoring failed.", code: "internal_error" } };
}
