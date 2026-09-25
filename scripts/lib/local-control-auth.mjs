/**
 * Local control-plane handshake for the dashboard dev server `/__proxy/*`.
 *
 * TCP-peer loopback is necessary but not sufficient: a same-machine browser
 * tab at https://evil.example still connects from 127.0.0.1. Authorization
 * requires an exact Origin allowlist for the listen port, and CORS must
 * echo that origin — never `*`.
 */

const LOOPBACK_PEERS = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "localhost",
]);

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
