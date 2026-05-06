/**
 * Command Center — POST relay to a user-configured webhook (e.g. Apps Script /exec).
 * No npm deps; deploy with Wrangler. See README.md.
 */
function cors(env) {
  const o = env.CORS_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Forward-Secret, X-Discovery-Secret",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Read-only paths the relay forwards as GET to the upstream worker. Today
 * this is just async run-status polling: the dashboard receives an
 * `accepted_async` response with `statusPath: "/runs/<id>"` and polls it
 * against the Worker URL. POST stays the only method allowed for everything
 * else — the relay must not become a generic open proxy.
 */
function isRelayReadOnlyPath(pathname) {
  if (typeof pathname !== "string") return false;
  return pathname === "/runs" || pathname.startsWith("/runs/");
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

    // Path-preserving forwarding. The relay used to collapse every request to
    // TARGET_URL's own path, which made /discovery-profile (and any future
    // sibling endpoint) land on /webhook. Now:
    //   - No FORWARD_SECRET: the incoming path is preserved against TARGET_URL's
    //     origin. Root (`/`) falls back to TARGET_URL as-is for backward compat.
    //   - With FORWARD_SECRET: callers POST /forward (legacy, maps to the
    //     configured TARGET_URL path) or /forward/<subpath> (maps to
    //     <TARGET_URL origin>/<subpath>). Anything else is 404.
    let upstreamPath = url.pathname;
    let useTargetPath = false;

    if (env.FORWARD_SECRET) {
      if (url.pathname === "/forward") {
        useTargetPath = true;
      } else if (url.pathname.startsWith("/forward/")) {
        upstreamPath = url.pathname.slice("/forward".length); // leading / preserved
      } else {
        return new Response("Not found", { status: 404, headers: h });
      }
      const auth = request.headers.get("Authorization");
      const tok = auth?.startsWith("Bearer ")
        ? auth.slice(7)
        : request.headers.get("X-Forward-Secret");
      if (tok !== env.FORWARD_SECRET) {
        return json({ error: "Unauthorized" }, 401, env);
      }
    } else if (url.pathname === "" || url.pathname === "/") {
      // Root request: forward verbatim to TARGET_URL (legacy behavior).
      useTargetPath = true;
    }

    // GET is allowed only for the read-only run-status path. Every other
    // GET is rejected. POST is allowed everywhere it was before.
    const isReadOnlyGet =
      request.method === "GET" && isRelayReadOnlyPath(url.pathname);
    if (request.method !== "POST" && !isReadOnlyGet) {
      return new Response("Method Not Allowed", { status: 405, headers: h });
    }

    const body = isReadOnlyGet ? undefined : await request.text();

    // Resolve the final upstream URL. Preserve the incoming path+search
    // against TARGET_URL's origin unless we're in legacy fall-back mode.
    let upstream_url;
    if (useTargetPath) {
      upstream_url = target;
    } else {
      const parsedTarget = new URL(target);
      parsedTarget.pathname = upstreamPath;
      parsedTarget.search = url.search;
      upstream_url = parsedTarget.toString();
    }

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

    const upstream = await fetch(upstream_url, {
      method: isReadOnlyGet ? "GET" : "POST",
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

  // Cron trigger — fires on the schedule configured in wrangler.toml
  // `[triggers]` section. Posts a `mode:"refresh"` request to the worker's
  // /discovery-profile endpoint so the stored candidateProfile gets replayed
  // daily against Gemini; newly-discovered companies dedupe against the
  // StoredWorkerConfig.negativeCompanyKeys list. Requires the same TARGET_URL
  // + DISCOVERY_SECRET secrets as the fetch path.
  async scheduled(event, env, ctx) {
    const target = env.TARGET_URL;
    if (!target) {
      console.error("[cron] TARGET_URL secret not set — skipping refresh");
      return;
    }
    let upstream_url;
    try {
      const parsed = new URL(target);
      parsed.pathname = "/discovery-profile";
      parsed.search = "";
      upstream_url = parsed.toString();
    } catch (err) {
      console.error("[cron] TARGET_URL parse failed:", err && err.message);
      return;
    }

    const sheetId = env.REFRESH_SHEET_ID || "";
    const body = JSON.stringify({
      event: "discovery.profile.request",
      schemaVersion: 1,
      mode: "refresh",
      sheetId: sheetId || undefined,
    });

    const upstreamHeaders = {
      "Content-Type": "application/json",
    };
    if (env.DISCOVERY_SECRET) {
      upstreamHeaders["x-discovery-secret"] = env.DISCOVERY_SECRET;
    }

    try {
      const response = await fetch(upstream_url, {
        method: "POST",
        headers: upstreamHeaders,
        body,
      });
      const statusLine = `[cron ${event.cron}] refresh -> ${upstream_url} HTTP ${response.status}`;
      if (response.ok) {
        console.log(statusLine);
      } else {
        const text = await response.text().catch(() => "");
        console.error(`${statusLine} body=${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.error(
        `[cron ${event.cron}] refresh failed:`,
        err && err.message,
      );
    }
  },
};
