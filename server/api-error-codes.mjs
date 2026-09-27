/**
 * The one exported home of the local API's generic error codes (W2SQ-E).
 *
 * Every error code the local API (server/index.mjs, :3847) emits is
 * lower_snake_case, matching the worker's STATUS_CODES in
 * integrations/browser-use-discovery/src/webhook/api-error.ts. Import this
 * map instead of inlining a code literal so the convention test
 * (tests/error-code-convention.test.mjs) sees every value in one place.
 */

/** @type {Record<number, string>} */
export const API_ERROR_STATUS_CODES = {
  400: "bad_request",
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
  503: "service_unavailable",
  504: "upstream_timeout",
};

/** @param {number} status */
export function codeForStatus(status) {
  return (
    API_ERROR_STATUS_CODES[status] ||
    (status >= 500 ? "internal_error" : "bad_request")
  );
}
