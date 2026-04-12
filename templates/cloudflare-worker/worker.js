/**
 * Command Center — POST relay to a user-configured webhook (e.g. Apps Script /exec).
 * No npm deps; deploy with Wrangler. See README.md.
 */
function cors(env) {
  const o = env.CORS_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Forward-Secret, X-Discovery-Secret",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(env) },
  });
}

export default {
  async fetch(request, env) {
    const h = cors(env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: h });
    }

    const target = env.TARGET_URL || url.searchParams.get("target");
    if (!target) {
      return json({ error: "Missing TARGET_URL secret or ?target=" }, 400, env);
    }

    if (env.FORWARD_SECRET) {
      if (url.pathname !== "/forward") {
        return new Response("Not found", { status: 404, headers: h });
      }
      const auth = request.headers.get("Authorization");
      const tok = auth?.startsWith("Bearer ")
        ? auth.slice(7)
        : request.headers.get("X-Forward-Secret");
      if (tok !== env.FORWARD_SECRET) {
        return json({ error: "Unauthorized" }, 401, env);
      }
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: h });
    }

    const body = await request.text();

    // Upstream headers:
    // 1. Propagate Content-Type from the browser.
    // 2. If DISCOVERY_SECRET is set on the Worker, inject it as
    //    x-discovery-secret so fail-closed receivers (e.g. the browser-use
    //    discovery worker) accept the request — the browser never sees it.
    // 3. Otherwise, forward any x-discovery-secret the browser sent, so
    //    dashboards that already ship the secret client-side still work.
    const upstreamHeaders = {
      "Content-Type": request.headers.get("Content-Type") || "application/json",
    };
    if (env.DISCOVERY_SECRET) {
      upstreamHeaders["x-discovery-secret"] = env.DISCOVERY_SECRET;
    } else {
      const forwarded = request.headers.get("x-discovery-secret");
      if (forwarded) {
        upstreamHeaders["x-discovery-secret"] = forwarded;
      }
    }

    const upstream = await fetch(target, {
      method: "POST",
      headers: upstreamHeaders,
      body,
    });

    const text = await upstream.text();
    const ct = upstream.headers.get("Content-Type") || "application/json";
    return new Response(text, {
      status: upstream.status,
      headers: { ...h, "Content-Type": ct },
    });
  },
};
