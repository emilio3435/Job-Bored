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

export function trustedRequestOriginParts(req: {
  get?: (name: string) => unknown;
  headers?: Record<string, unknown>;
  secure?: boolean;
  protocol?: unknown;
}): {
  requestOrigin: string;
  requestHost: string;
  requestProtocol: string;
};

export function redactSecrets(value: unknown): string;

export function resolveAllowedBrowserOrigin(
  requestOrigin: unknown,
  options?: {
    allowedOrigins?: string[];
    requestHost?: unknown;
    requestProtocol?: unknown;
    loopbackPort?: unknown;
  },
): string;

export function isAllowedLoopbackHost(
  hostHeader: unknown,
  port: unknown,
  scheme?: unknown,
): boolean;

export function isLoopbackAddress(address: unknown): boolean;

export function isAllowedTunnelHost(hostHeader: unknown, allowedHosts: unknown): boolean;

export function checkLoopbackRequestHost(
  req: {
    headers?: Record<string, unknown>;
    socket?: { localAddress?: unknown; localPort?: unknown; encrypted?: unknown } | null;
  },
  options?: { allowedHosts?: unknown; tunnelHosts?: unknown },
):
  | { ok: true }
  | { ok: false; status: 403; code: "HOST_NOT_ALLOWED"; error: string };

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
