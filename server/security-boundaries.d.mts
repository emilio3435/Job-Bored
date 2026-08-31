export type ScrapeTargetValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type LookupAll = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export function normalizeAllowedBrowserOrigins(
  raw: unknown,
  options?: { listenHost?: unknown },
): string[];

export function resolveAllowedBrowserOrigin(
  requestOrigin: unknown,
  options?: {
    allowedOrigins?: string[];
    requestHost?: unknown;
    requestProtocol?: unknown;
  },
): string;

export function validateScrapeTarget(rawUrl: unknown): ScrapeTargetValidation;

export function validateScrapeTargetWithDns(
  rawUrl: unknown,
  options?: { lookupImpl?: LookupAll; signal?: AbortSignal },
): Promise<ScrapeTargetValidation>;

export function safeFetch(
  rawUrl: string,
  init?: RequestInit,
  options?: {
    fetchImpl?: typeof fetch;
    lookupImpl?: LookupAll;
    resolveDns?: boolean;
    maxRedirects?: number;
  },
): Promise<Response>;
