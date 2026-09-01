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
  return String(headers.origin || headers.Origin || "").trim();
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
