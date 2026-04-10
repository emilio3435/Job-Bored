import { isIP } from "node:net";

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

function isPrivateNetworkHostname(value) {
  const hostname = cleanString(value).replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (!hostname) return true;
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const [a, b] = hostname.split(".").map((part) => Number(part));
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (ipVersion === 6) {
    return (
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe80:")
    );
  }
  return false;
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
