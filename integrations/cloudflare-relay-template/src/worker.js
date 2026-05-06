// JobBored discovery relay.
// Proxies browser-safe discovery requests to the user's current local tunnel.
// Request bodies are forwarded but never logged.

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
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

function hasValidBearer(request, env) {
  const secret = String(env.SHARED_SECRET || "").trim();
  if (!secret) return true;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${secret}`;
}

function copyResponseHeaders(upstream) {
  const headers = new Headers(CORS_HEADERS);
  const contentType = upstream.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  return headers;
}

async function forward(request, upstreamUrl) {
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
    headers: copyResponseHeaders(upstream),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "jobbored-discovery-relay" });
    }

    if (!hasValidBearer(request, env)) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }

    let target;
    try {
      target = normalizeTarget(env.DISCOVERY_TARGET);
    } catch (_) {
      return json({ ok: false, reason: "invalid_discovery_target" }, 500);
    }
    if (!target) {
      return json({ ok: false, reason: "missing_discovery_target" }, 500);
    }

    if (request.method === "POST" && url.pathname === "/discovery") {
      return forward(request, `${target}/discovery`);
    }

    if (request.method === "GET" && url.pathname.startsWith("/runs/")) {
      const runId = url.pathname.slice("/runs/".length);
      if (!runId || runId.includes("/")) {
        return json({ ok: false, reason: "invalid_run_id" }, 404);
      }
      return forward(
        request,
        `${target}/runs/${encodeURIComponent(decodeURIComponent(runId))}${url.search}`,
      );
    }

    return json({ ok: false, reason: "not_found" }, 404);
  },
};
