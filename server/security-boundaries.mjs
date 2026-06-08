import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

const MAX_SCRAPE_REDIRECTS = 5;

const DEFAULT_LOCAL_BROWSER_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "https://localhost:8080",
];

export function normalizeAllowedBrowserOrigins(
  raw,
  { listenHost = "" } = {},
) {
  const explicit = normalizeList(raw);
  if (explicit.length) return explicit;
  return isLocalListenHost(listenHost) ? [...DEFAULT_LOCAL_BROWSER_ORIGINS] : [];
}

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

function buildRequestOrigin(host, protocol) {
  const normalizedHost = cleanString(host);
  const normalizedProtocol = cleanString(protocol).replace(/:$/, "");
  if (!normalizedHost || !normalizedProtocol) return "";
  return `${normalizedProtocol}://${normalizedHost}`;
}

function isLocalListenHost(value) {
  const host = cleanString(value).toLowerCase();
  return (
    !host ||
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1"
  );
}

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

function isPrivateIpLiteral(value) {
  const ipVersion = isIP(value);
  if (ipVersion === 4) return isPrivateIpv4(value);
  if (ipVersion === 6) return isPrivateIpv6(value);
  return null;
}

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
export async function validateScrapeTargetWithDns(rawUrl, { lookupImpl = dnsLookup } = {}) {
  const base = validateScrapeTarget(rawUrl);
  if (!base.ok) return base;
  const { hostname } = new URL(base.url);
  if (await resolvedAddressesArePrivate(hostname, { lookupImpl })) {
    return { ok: false, error: "Local and private-network scrape targets are not allowed" };
  }
  return base;
}

// Fetch that re-validates every redirect hop against the SSRF allowlist.
// Mirrors `redirect: "follow"` semantics without trusting redirect targets.
// Hop validation is synchronous/lexical so callers stay hermetic; set
// `resolveDns: true` (or pass a `lookupImpl`) to additionally resolve each hop.
export async function safeFetch(
  rawUrl,
  init = {},
  {
    fetchImpl = globalThis.fetch,
    lookupImpl,
    resolveDns = false,
    maxRedirects = MAX_SCRAPE_REDIRECTS,
  } = {},
) {
  const wantDns = resolveDns || typeof lookupImpl === "function";
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const target = wantDns
      ? await validateScrapeTargetWithDns(currentUrl, { lookupImpl: lookupImpl || dnsLookup })
      : validateScrapeTarget(currentUrl);
    if (!target.ok) throw new Error(target.error);
    const response = await fetchImpl(target.url, { ...init, redirect: "manual" });
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

function normalizeList(value) {
  return [...new Set(
    cleanString(value)
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}
