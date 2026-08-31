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

  root.JobBoredHostedApiAuth = {
    getHostedApiToken: getHostedApiToken,
    applyHostedApiAuthHeaders: applyHostedApiAuthHeaders,
    applyHostedApiAuth: applyHostedApiAuth,
  };
})(typeof window !== "undefined" ? window : globalThis);
