// JobBored discovery relay.
// Proxies browser-safe discovery requests to the user's current local tunnel.
// Request bodies are forwarded but never logged.
//
// HOLES S6: fails closed, like the deployed relay (templates/cloudflare-worker).
// Without SHARED_SECRET every relayed route answers 401, and only the browser
// origins listed in ALLOWED_ORIGINS get CORS; there is no wildcard.

const BASE_CORS_HEADERS = {
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
  vary: "Origin",
};

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// The caller's origin is echoed back only when it is listed.
function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  if (origin && allowedOrigins(env).includes(origin)) {
    return { ...BASE_CORS_HEADERS, "access-control-allow-origin": origin };
  }
  return { ...BASE_CORS_HEADERS };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...cors,
    },
  });
}

function normalizeTarget(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/g, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/g, "");
}

function timingSafeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function hasValidBearer(request, secret) {
  const header = request.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(presented) && timingSafeEqual(presented, secret);
}

function copyResponseHeaders(upstream, cors) {
  const headers = new Headers(cors);
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  return headers;
}

async function forward(request, upstreamUrl, cors) {
  const headers = {};
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers["content-type"] = contentType;
  }

  const init = {
    method: request.method,
    headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const upstream = await fetch(upstreamUrl, init);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: copyResponseHeaders(upstream, cors),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.headers.get("origin") && !cors["access-control-allow-origin"]) {
      return json({ ok: false, reason: "origin_not_allowed" }, 403, cors);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "jobbored-discovery-relay" }, 200, cors);
    }

    const secret = String(env.SHARED_SECRET || "").trim();
    if (!secret) {
      return json({ ok: false, reason: "relay_secret_not_configured" }, 401, cors);
    }
    if (!hasValidBearer(request, secret)) {
      return json({ ok: false, reason: "unauthorized" }, 401, cors);
    }

    let target;
    try {
      target = normalizeTarget(env.DISCOVERY_TARGET);
    } catch (_) {
      return json({ ok: false, reason: "invalid_discovery_target" }, 500, cors);
    }
    if (!target) {
      return json({ ok: false, reason: "missing_discovery_target" }, 500, cors);
    }

    if (request.method === "POST" && url.pathname === "/discovery") {
      return forward(request, `${target}/discovery`, cors);
    }

    if (request.method === "GET" && url.pathname.startsWith("/runs/")) {
      const runId = url.pathname.slice("/runs/".length);
      if (!runId || runId.includes("/")) {
        return json({ ok: false, reason: "invalid_run_id" }, 404, cors);
      }
      return forward(
        request,
        `${target}/runs/${encodeURIComponent(decodeURIComponent(runId))}${url.search}`,
        cors,
      );
    }

    return json({ ok: false, reason: "not_found" }, 404, cors);
  },
};
