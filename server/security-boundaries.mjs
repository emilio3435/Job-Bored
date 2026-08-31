import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

const MAX_SCRAPE_REDIRECTS = 5;
const PLATFORM_FETCH = globalThis.fetch;

/** @typedef {(hostname: string, options: { all: true }) => Promise<import("node:dns").LookupAddress[]>} LookupAll */
/** @typedef {{ ok: true, url: string } | { ok: false, error: string }} ScrapeTargetValidation */

const DEFAULT_LOCAL_BROWSER_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "https://localhost:8080",
];

/**
 * @param {unknown} raw
 * @param {{ listenHost?: unknown }} [options]
 */
export function normalizeAllowedBrowserOrigins(
  raw,
  { listenHost = "" } = {},
) {
  const explicit = normalizeList(raw);
  if (explicit.length) return explicit;
  return isLocalListenHost(listenHost) ? [...DEFAULT_LOCAL_BROWSER_ORIGINS] : [];
}

/**
 * @param {unknown} requestOrigin
 * @param {{ allowedOrigins?: string[], requestHost?: unknown, requestProtocol?: unknown }} [options]
 */
export function resolveAllowedBrowserOrigin(
  requestOrigin,
  {
    allowedOrigins = [],
    requestHost = "",
    requestProtocol = "http",
  } = {},
) {
  const origin = cleanString(requestOrigin);
  if (!origin) return "";
  if (allowedOrigins.includes("*")) return "*";
  if (allowedOrigins.includes(origin)) return origin;
  const sameOrigin = buildRequestOrigin(requestHost, requestProtocol);
  return sameOrigin && origin === sameOrigin ? origin : "";
}

/**
 * @param {unknown} rawUrl
 * @returns {ScrapeTargetValidation}
 */
export function validateScrapeTarget(rawUrl) {
  const urlText = cleanString(rawUrl);
  let parsedUrl;
  try {
    parsedUrl = new URL(urlText);
  } catch {
    return {
      ok: false,
      error: "Invalid URL",
    };
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return {
      ok: false,
      error: "Only http(s) URLs allowed",
    };
  }
  if (isPrivateNetworkHostname(parsedUrl.hostname)) {
    return {
      ok: false,
      error: "Local and private-network scrape targets are not allowed",
    };
  }
  return {
    ok: true,
    url: parsedUrl.href,
  };
}

/**
 * @param {unknown} host
 * @param {unknown} protocol
 */
function buildRequestOrigin(host, protocol) {
  const normalizedHost = cleanString(host);
  const normalizedProtocol = cleanString(protocol).replace(/:$/, "");
  if (!normalizedHost || !normalizedProtocol) return "";
  return `${normalizedProtocol}://${normalizedHost}`;
}

/** @param {unknown} value */
function isLocalListenHost(value) {
  const host = cleanString(value).toLowerCase();
  return (
    !host ||
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1"
  );
}

/** @param {string} ip */
function isPrivateIpv4(ip) {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast/reserved
  );
}

// Expand an IPv6 literal into eight 16-bit groups, or return null if unparseable.
/** @param {string} value */
function expandIpv6Groups(value) {
  let text = value;
  let tail = "";
  const lastColon = text.lastIndexOf(":");
  // Handle IPv4-embedded forms like ::ffff:127.0.0.1
  if (text.slice(lastColon + 1).includes(".")) {
    const ipv4 = text.slice(lastColon + 1);
    const octets = ipv4.split(".").map((n) => Number(n));
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return null;
    }
    tail = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    text = `${text.slice(0, lastColon + 1)}${tail}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  let groups;
  if (rest === null) {
    groups = head;
  } else {
    const missing = 8 - head.length - rest.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill("0"), ...rest];
  }
  if (groups.length !== 8) return null;
  const numeric = groups.map((g) => parseInt(g || "0", 16));
  if (numeric.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return numeric;
}

/** @param {string} value */
function isPrivateIpv6(value) {
  const groups = expandIpv6Groups(value);
  if (!groups) return true; // fail closed on anything we cannot parse
  const allZeroExceptLast = groups.slice(0, 7).every((g) => g === 0);
  if (allZeroExceptLast && (groups[7] === 1 || groups[7] === 0)) return true; // ::1 and ::
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — check embedded IPv4
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    const a = groups[6] >> 8;
    const b = groups[6] & 0xff;
    const c = groups[7] >> 8;
    const d = groups[7] & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }
  const first = groups[0];
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 unique-local
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10 link-local
  return false;
}

/** @param {string} value */
function isPrivateIpLiteral(value) {
  const ipVersion = isIP(value);
  if (ipVersion === 4) return isPrivateIpv4(value);
  if (ipVersion === 6) return isPrivateIpv6(value);
  return null;
}

/** @param {unknown} value */
function isPrivateNetworkHostname(value) {
  const hostname = cleanString(value)
    .replace(/^\[(.*)\]$/, "$1")
    .toLowerCase()
    // Strip a single FQDN trailing dot ("localhost." resolves to loopback
    // but would otherwise slip past the equality/suffix checks below).
    .replace(/\.$/, "");
  if (!hostname) return true;
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }
  const literal = isPrivateIpLiteral(hostname);
  if (literal !== null) return literal;
  return false;
}

// Resolve a hostname and confirm every returned address is publicly routable.
// Fails closed: resolution errors are treated as a blocked target.
/**
 * @param {string} hostname
 * @param {{ lookupImpl?: LookupAll }} [options]
 */
async function resolvedAddressesArePrivate(hostname, { lookupImpl = dnsLookup } = {}) {
  if (isIP(hostname)) return isPrivateNetworkHostname(hostname);
  let addresses;
  try {
    addresses = await lookupImpl(hostname, { all: true });
  } catch {
    return true;
  }
  if (!Array.isArray(addresses) || addresses.length === 0) return true;
  return addresses.some(({ address }) => {
    const priv = isPrivateIpLiteral(String(address));
    return priv === null ? false : priv;
  });
}

// Full validation incl. DNS resolution. Use before fetching a user-supplied URL.
/**
 * @param {unknown} rawUrl
 * @param {{ lookupImpl?: LookupAll, signal?: AbortSignal }} [options]
 * @returns {Promise<ScrapeTargetValidation>}
 */
export async function validateScrapeTargetWithDns(
  rawUrl,
  { lookupImpl = dnsLookup, signal } = {},
) {
  throwIfAborted(signal);
  const base = validateScrapeTarget(rawUrl);
  if (!base.ok) return base;
  const { hostname } = new URL(base.url);
  const blocked = await abortable(
    resolvedAddressesArePrivate(hostname, { lookupImpl }),
    signal,
  );
  if (blocked) {
    return { ok: false, error: "Local and private-network scrape targets are not allowed" };
  }
  return base;
}

// Fetch that re-validates every redirect hop against the SSRF allowlist
// and pins DNS at connect time so a public preflight cannot rebind onto
// loopback/metadata. Platform fetch (the `fetch` captured at module load)
// is fail-closed: resolve every hop and pin the connect. Injected `fetchImpl`
// or a test that patches `globalThis.fetch` stays hermetic unless the caller
// passes `lookupImpl` / `resolveDns: true`.
/**
 * @param {string} rawUrl
 * @param {RequestInit} [init]
 * @param {{ fetchImpl?: typeof globalThis.fetch, lookupImpl?: LookupAll, resolveDns?: boolean, maxRedirects?: number }} [options]
 */
export async function safeFetch(
  rawUrl,
  init = {},
  {
    fetchImpl = globalThis.fetch,
    lookupImpl,
    resolveDns,
    maxRedirects = MAX_SCRAPE_REDIRECTS,
  } = {},
) {
  const signal = init && init.signal ? init.signal : undefined;
  const injectedFetch = fetchImpl !== PLATFORM_FETCH;
  const resolver = lookupImpl || dnsLookup;
  const wantDns = (resolveDns ?? !injectedFetch) || typeof lookupImpl === "function";
  const usePinnedTransport = !injectedFetch;
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    throwIfAborted(signal);
    const target = wantDns
      ? await validateScrapeTargetWithDns(currentUrl, { lookupImpl: resolver, signal })
      : validateScrapeTarget(currentUrl);
    if (!target.ok) throw new Error(target.error);
    const response = usePinnedTransport
      ? await pinnedFetch(target.url, init, resolver)
      : await abortable(fetchImpl(target.url, { ...init, redirect: "manual" }), signal);
    const status = Number(response && response.status);
    if (status >= 300 && status < 400 && response.headers && typeof response.headers.get === "function") {
      const location = response.headers.get("location");
      if (!location) return response;
      currentUrl = new URL(location, target.url).href;
      continue;
    }
    return response;
  }
  throw new Error("Too many redirects");
}

/** @param {AbortSignal | undefined} signal */
function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortError(signal);
}

/**
 * @param {AbortSignal | undefined} signal
 * @returns {Error}
 */
function abortError(signal) {
  const reason = signal && "reason" in signal ? signal.reason : undefined;
  if (reason instanceof Error) return reason;
  if (typeof DOMException === "function") {
    return new DOMException(
      reason == null ? "This operation was aborted" : String(reason),
      "AbortError",
    );
  }
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<T>}
 */
function abortable(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * @param {unknown} headers
 * @returns {Record<string, string>}
 */
function headersToObject(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!headers) return out;
  if (typeof Headers === "function" && headers instanceof Headers) {
    for (const [key, value] of headers.entries()) out[key] = value;
    return out;
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (!entry || entry.length < 2) continue;
      out[String(entry[0])] = String(entry[1]);
    }
    return out;
  }
  if (typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) {
      if (value == null) continue;
      out[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  }
  return out;
}

/**
 * Connect-time lookup: resolve, then refuse any private/unparseable address
 * before TCP. This is the DNS pin — a later rebind cannot be connected to.
 *
 * @param {LookupAll} lookupImpl
 * @param {AbortSignal | undefined} signal
 */
function createConnectLookup(lookupImpl, signal) {
  /**
   * @param {string} hostname
   * @param {unknown} optionsOrCb
   * @param {((...args: any[]) => void) | undefined} [maybeCallback]
   */
  return (hostname, optionsOrCb, maybeCallback) => {
    /** @type {Record<string, unknown>} */
    let options = {};
    /** @type {(...args: any[]) => void} */
    let cb = maybeCallback || (() => {});
    if (typeof optionsOrCb === "function") {
      cb = /** @type {(...args: any[]) => void} */ (optionsOrCb);
    } else if (optionsOrCb && typeof optionsOrCb === "object") {
      options = /** @type {Record<string, unknown>} */ (optionsOrCb);
    }
    const all = Boolean(options.all);
    Promise.resolve()
      .then(async () => {
        throwIfAborted(signal);
        if (isPrivateNetworkHostname(hostname)) {
          throw new Error("Local and private-network scrape targets are not allowed");
        }
        if (isIP(hostname)) {
          return [{ address: hostname, family: isIP(hostname) }];
        }
        const addresses = await abortable(lookupImpl(hostname, { all: true }), signal);
        if (!Array.isArray(addresses) || addresses.length === 0) {
          throw new Error("Local and private-network scrape targets are not allowed");
        }
        for (const row of addresses) {
          const address = String(row && row.address || "");
          const priv = isPrivateIpLiteral(address);
          if (priv !== false) {
            throw new Error("Local and private-network scrape targets are not allowed");
          }
        }
        return addresses.map((row) => ({
          address: String(row.address),
          family: Number(row.family) || (String(row.address).includes(":") ? 6 : 4),
        }));
      })
      .then((addresses) => {
        if (all) cb(null, addresses);
        else cb(null, addresses[0].address, addresses[0].family);
      })
      .catch((error) => cb(error));
  };
}

/**
 * @param {string} urlText
 * @param {RequestInit} init
 * @param {LookupAll} lookupImpl
 * @returns {Promise<Response>}
 */
function pinnedFetch(urlText, init, lookupImpl) {
  const parsed = new URL(urlText);
  const requestFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  const signal = init && init.signal ? init.signal : undefined;
  throwIfAborted(signal);
  const headers = headersToObject(init.headers);
  const method = String(init.method || "GET").toUpperCase();

  return new Promise((resolve, reject) => {
    let settled = false;
    /** @param {(value: any) => void} fn @param {any} value */
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = requestFn(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        lookup: createConnectLookup(lookupImpl, signal),
        signal,
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          /** @type {Array<[string, string]>} */
          const headerInit = [];
          for (const [key, value] of Object.entries(res.headers)) {
            if (value == null) continue;
            headerInit.push([key, Array.isArray(value) ? value.join(", ") : String(value)]);
          }
          const response = new Response(Buffer.concat(chunks), {
            status: res.statusCode || 0,
            statusText: res.statusMessage || "",
            headers: headerInit,
          });
          Object.defineProperty(response, "url", { value: parsed.href });
          finish(resolve, response);
        });
        res.on("error", (error) => finish(reject, error));
      },
    );
    req.on("error", (error) => {
      if (signal && signal.aborted) {
        finish(reject, abortError(signal));
        return;
      }
      finish(reject, error);
    });
    try {
      if (init.body && method !== "GET" && method !== "HEAD") {
        if (typeof init.body === "string" || Buffer.isBuffer(init.body)) {
          req.write(init.body);
        } else {
          req.destroy();
          finish(reject, new Error("Unsupported request body"));
          return;
        }
      }
      req.end();
    } catch (error) {
      req.destroy();
      finish(reject, error);
    }
  });
}

/** @param {unknown} value */
function normalizeList(value) {
  return [...new Set(
    cleanString(value)
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

/** @param {unknown} value */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}
