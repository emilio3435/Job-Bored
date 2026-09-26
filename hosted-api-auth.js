/* ============================================================
   hosted-api-auth.js — packaged browser caller auth for scraper API
   ------------------------------------------------------------
   AUTH-03: hosted/container server/index.mjs requires JOBBORED_API_TOKEN
   (Authorization: Bearer or X-Api-Token). Packaged fetches must attach
   that token when configured. No-token hosted calls stay denied by F0-D.

   Exposes window.JobBoredHostedApiAuth:
     getHostedApiToken(config)
     applyHostedApiAuthHeaders(headers, token)
     applyHostedApiAuth(init, token)
     apiFetch(input, init)

   E4: every packaged browser call to the JobBored API goes through
   apiFetch(), which attaches the hosted token. It returns the fetch
   Response untouched: error bodies and their `code` pass through
   unchanged, so callers keep matching the lowercase form lane E sends.

   Integrator: load before posting-enrichment.js, discovery-drawer.js,
   role-materials.js, pipeline.js, materials-queue.js, ats-scorecard.js.
   ============================================================ */
(function (root) {
  "use strict";

  function getHostedApiToken(config) {
    if (!config || typeof config !== "object") return "";
    var raw =
      config.jobBoredApiToken ||
      config.hostedApiToken ||
      config.apiAccessToken ||
      "";
    return String(raw).trim();
  }

  function applyHostedApiAuthHeaders(headers, token) {
    var next = {};
    if (headers && typeof headers === "object") {
      if (typeof headers.forEach === "function") {
        headers.forEach(function (value, key) {
          next[key] = value;
        });
      } else {
        Object.keys(headers).forEach(function (key) {
          next[key] = headers[key];
        });
      }
    }
    var t = String(token || "").trim();
    if (!t) return next;
    next.Authorization = "Bearer " + t;
    next["X-Api-Token"] = t;
    return next;
  }

  function applyHostedApiAuth(init, token) {
    var base = init && typeof init === "object" ? Object.assign({}, init) : {};
    base.headers = applyHostedApiAuthHeaders(base.headers, token);
    return base;
  }

  function globalScope() {
    if (typeof window !== "undefined" && window) return window;
    if (typeof globalThis !== "undefined") return globalThis;
    return {};
  }

  /* The token lives in COMMAND_CENTER_CONFIG under one of three alias keys.
     app-config-core's getJobBoredApiToken is the canonical reader when it is
     loaded; otherwise read the config directly. Resolved per call so script
     order never matters. */
  function resolveApiToken() {
    var scope = globalScope();
    try {
      var app = scope.JobBoredApp || null;
      var core = app && app.configCore;
      if (core && typeof core.getJobBoredApiToken === "function") {
        var viaCore = core.getJobBoredApiToken();
        if (viaCore) return String(viaCore).trim();
      }
    } catch (_) {
      /* fall through to the direct read */
    }
    return getHostedApiToken(scope.COMMAND_CENTER_CONFIG);
  }

  /* The one API transport. Attaches the hosted token when one is configured
     and returns the fetch Response untouched — it never rewrites error
     bodies, so `code` reaches the caller exactly as the server sent it. */
  function apiFetch(input, init) {
    var scope = globalScope();
    var fetchImpl =
      scope && typeof scope.fetch === "function"
        ? scope.fetch
        : typeof fetch === "function"
          ? fetch
          : null;
    if (!fetchImpl) return Promise.reject(new Error("fetch unavailable"));
    return fetchImpl(input, applyHostedApiAuth(init, resolveApiToken()));
  }

  root.JobBoredHostedApiAuth = {
    getHostedApiToken: getHostedApiToken,
    applyHostedApiAuthHeaders: applyHostedApiAuthHeaders,
    applyHostedApiAuth: applyHostedApiAuth,
    resolveApiToken: resolveApiToken,
    apiFetch: apiFetch,
  };
})(typeof window !== "undefined" ? window : globalThis);
