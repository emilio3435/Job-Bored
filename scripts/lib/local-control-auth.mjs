/**
 * Local control-plane handshake for the dashboard dev server `/__proxy/*`.
 *
 * TCP-peer loopback is necessary but not sufficient: a same-machine browser
 * tab at https://evil.example still connects from 127.0.0.1. Authorization
 * requires an exact Origin allowlist for the listen port, and CORS must
 * echo that origin — never `*`.
 */

import { spawnSync } from "node:child_process";

const LOOPBACK_PEERS = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
]);
const TAILNET_STATUS_TTL_MS = 5000;
const requestTailnetResolvers = new WeakMap();

function readTailscaleStatus() {
  try {
    const result = spawnSync("tailscale", ["status", "--json"], {
      encoding: "utf8",
      timeout: 1000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return null;
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** Status is the local daemon's own node and user table, never request data. */
export function createTailnetStatusResolver({
  readStatus = readTailscaleStatus,
  now = Date.now,
  ttlMs = TAILNET_STATUS_TTL_MS,
} = {}) {
  let expiresAt = -Infinity;
  let cached = { ok: false };
  return () => {
    const time = now();
    if (time < expiresAt) return cached;
    expiresAt = time + ttlMs;
    try {
      const status = readStatus();
      const dnsName = String(status?.Self?.DNSName || "")
        .replace(/\.$/, "")
        .toLowerCase();
      const userId = status?.Self?.UserID;
      const ownerLogin =
        userId == null ? "" : status?.User?.[String(userId)]?.LoginName;
      if (
        /^(?:[a-z0-9-]+\.)+ts\.net$/.test(dnsName) &&
        typeof ownerLogin === "string" &&
        ownerLogin.trim() &&
        ownerLogin === ownerLogin.trim()
      ) {
        cached = { ok: true, dnsName, ownerLogin };
        return cached;
      }
    } catch {
      // An absent or failing daemon is never a source of trust.
    }
    cached = { ok: false };
    return cached;
  };
}

const defaultTailnetStatus = createTailnetStatusResolver();

/** Per-server test seam. No request header can set this WeakMap entry. */
export function bindTailnetStatusResolver(req, resolver) {
  if (typeof resolver === "function") requestTailnetResolvers.set(req, resolver);
}

function readTailnetOrigin(req) {
  const headers = req?.headers || {};
  const explicit = headers.origin ?? headers.Origin;
  if (explicit != null) return typeof explicit === "string" ? explicit.trim() : "";
  if (String(headers["sec-fetch-site"] || "").trim().toLowerCase() !== "same-origin") return "";
  const referer = headers.referer ?? headers.Referer;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return "";
    }
  }
  // Serve terminates HTTPS, then connects to this HTTP loopback listener.
  // Browsers omit Origin and Referer on a same-origin GET under no-referrer.
  return `https://${String(headers.host || headers.Host || "").trim()}`;
}

export function isLoopbackPeer(remoteAddress) {
  return LOOPBACK_PEERS.has(String(remoteAddress || ""));
}

export function readRequestOrigin(req) {
  const headers = req && req.headers ? req.headers : {};
  const explicit = String(headers.origin || headers.Origin || "").trim();
  if (explicit) return explicit;
  // A same-origin GET from the dashboard's own tab carries no Origin header
  // (browsers attach Origin only to CORS and non-GET requests). It does
  // carry `Sec-Fetch-Site: same-origin` plus a same-origin Referer, so that
  // pair — and only that pair — stands in for Origin. A bare client that
  // sends neither (curl) stays unauthorized.
  const site = String(headers["sec-fetch-site"] || "").trim().toLowerCase();
  if (site !== "same-origin") return "";
  const referer = String(headers.referer || headers.Referer || "").trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* fall through to Host */
    }
  }
  // The dev server sends `Referrer-Policy: no-referrer`, so a real browser's
  // same-origin GET carries Sec-Fetch-Site and Host — and no Referer at all
  // (reproduced in Chromium, sixbeats B1). Host + the socket's scheme is the
  // origin the browser is asserting; isTrustedLocalOrigin still decides.
  const host = String(headers.host || headers.Host || "").trim();
  if (!host) return "";
  const scheme = req && req.socket && req.socket.encrypted ? "https" : "http";
  try {
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return "";
  }
}

export function localControlOrigins({ port, tls = false } = {}) {
  const listenPort = Number(port);
  if (!Number.isInteger(listenPort) || listenPort <= 0) return [];
  const scheme = tls ? "https" : "http";
  return [
    `${scheme}://127.0.0.1:${listenPort}`,
    `${scheme}://localhost:${listenPort}`,
    `${scheme}://[::1]:${listenPort}`,
  ];
}

export function isTrustedLocalOrigin(origin, { port, tls = false } = {}) {
  const raw = String(origin || "").trim();
  if (!raw) return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.origin !== raw) return false;
  const allowed = new Set(localControlOrigins({ port, tls }));
  return allowed.has(parsed.origin);
}

export function authorizeLocalControlRequest(req, options = {}) {
  const port = options.port ?? req?.socket?.localPort;
  const tls =
    options.tls ?? Boolean(req && req.socket && req.socket.encrypted);
  const origin = readRequestOrigin(req);
  const peer = req?.socket?.remoteAddress || "";

  if (!isLoopbackPeer(peer)) {
    return { ok: false, origin, reason: "forbidden_peer" };
  }
  const host = String(req?.headers?.host || req?.headers?.Host || "").trim();
  if (host.toLowerCase().replace(/:\d+$/, "").endsWith(".ts.net")) {
    const tailnetOrigin = readTailnetOrigin(req);
    const site = String(req?.headers?.["sec-fetch-site"] || "").trim().toLowerCase();
    if (site && site !== "same-origin") {
      return { ok: false, origin: tailnetOrigin, reason: "untrusted_origin" };
    }
    const resolveStatus =
      options.tailnetStatusResolver ||
      requestTailnetResolvers.get(req) ||
      defaultTailnetStatus;
    let status;
    try {
      status = resolveStatus();
    } catch {
      status = null;
    }
    if (!status?.ok) {
      return { ok: false, origin: tailnetOrigin, reason: "tailscale_unavailable" };
    }
    if (host !== status.dnsName || tailnetOrigin !== `https://${status.dnsName}`) {
      return { ok: false, origin: tailnetOrigin, reason: "untrusted_origin" };
    }
    const login = req?.headers?.["tailscale-user-login"];
    if (typeof login !== "string" || login !== status.ownerLogin) {
      return { ok: false, origin: tailnetOrigin, reason: "tailnet_owner_required" };
    }
    return { ok: true, origin: tailnetOrigin, reason: "ok", tailnetOwner: true };
  }
  if (!origin) {
    return { ok: false, origin, reason: "missing_origin" };
  }
  if (!isTrustedLocalOrigin(origin, { port, tls })) {
    return { ok: false, origin, reason: "untrusted_origin" };
  }
  return { ok: true, origin, reason: "ok" };
}

export function buildLocalControlCorsHeaders(req, extra = {}) {
  const auth = authorizeLocalControlRequest(req);
  const headers = {
    vary: "Origin",
    ...extra,
  };
  if (auth.ok) {
    headers["access-control-allow-origin"] = auth.origin;
  }
  return headers;
}

export function localControlPreflightHeaders(req) {
  return buildLocalControlCorsHeaders(req, {
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  });
}
