import {
  safeFetch as sharedSafeFetch,
  validateScrapeTarget,
  validateScrapeTargetWithDns,
} from "../../../../server/security-boundaries.mjs";

export { validateScrapeTarget, validateScrapeTargetWithDns };

type LookupAll = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupAll;
  resolveDns?: boolean;
  maxRedirects?: number;
}

/**
 * Worker-facing wrapper around the shared SSRF fetch primitive.
 * Platform fetch is fail-closed (DNS pin at connect). Injected `fetchImpl`
 * stays hermetic unless the caller passes `lookupImpl` or `resolveDns: true`.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  return sharedSafeFetch(url, init, options);
}
