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
   apiFetch(), which attaches the hosted token — only to the API's own
   origin (configured API base, local API default, or the page origin);
   any other origin gets a plain fetch. It returns the fetch
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

  /* Callers fall back to this local API base when nothing is configured
     (profile-api-base.js, settings-modal.js, role-materials.js, ...). */
  var LOCAL_API_BASE = "http://127.0.0.1:3847";

  function pageHref(scope) {
    var loc = scope && scope.location;
    if (loc && typeof loc.href === "string" && loc.href) return loc.href;
    return "";
  }

  /* Absolute http(s) origin without the URL API (non-browser hosts). */
  function parseAbsoluteOrigin(s) {
    var m = /^(https?):\/\/([^/?#\\]+)/i.exec(s);
    if (!m) return "";
    var scheme = m[1].toLowerCase();
    var hostPort = m[2].replace(/^[^@]*@/, "").toLowerCase();
    if (scheme === "http") hostPort = hostPort.replace(/:80$/, "");
    if (scheme === "https") hostPort = hostPort.replace(/:443$/, "");
    return scheme + "://" + hostPort;
  }

  function originOf(raw, baseHref) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    if (typeof URL !== "function") {
      var direct = parseAbsoluteOrigin(s);
      if (direct) return direct;
      if (!baseHref || /^[a-z][a-z0-9+.-]*:/i.test(s)) return "";
      if (s.indexOf("//") === 0) {
        var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(baseHref);
        return scheme ? parseAbsoluteOrigin(scheme[1] + ":" + s) : "";
      }
      return parseAbsoluteOrigin(baseHref);
    }
    try {
      var u = baseHref ? new URL(s, baseHref) : new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.origin;
    } catch (_) {
      return "";
    }
  }

  function requestUrlOf(input) {
    if (input == null) return "";
    if (typeof input === "string") return input;
    if (typeof input === "object" && typeof input.url === "string") return input.url;
    if (typeof input === "object" && typeof input.href === "string") return input.href;
    return String(input);
  }

  /* The origins the hosted token may travel to: the page's own origin, every
     configured JobBored API base the callers read (jobBoredApiUrl,
     jobPostingScrapeUrl, atsScoringServerUrl), and the local API default. */
  function trustedApiOrigins(scope) {
    var href = pageHref(scope);
    var cfg = (scope && scope.COMMAND_CENTER_CONFIG) || {};
    var out = [];
    function add(raw) {
      var o = originOf(raw, href);
      if (o && out.indexOf(o) === -1) out.push(o);
    }
    if (scope && scope.location && scope.location.origin) add(scope.location.origin);
    add(cfg.jobBoredApiUrl);
    add(cfg.jobPostingScrapeUrl);
    if (String(cfg.atsScoringMode || "server").toLowerCase() !== "webhook") {
      add(cfg.atsScoringServerUrl);
    }
    add(LOCAL_API_BASE);
    return out;
  }

  /* True when `input` targets the JobBored API's own origin. A relative URL
     resolves against location.href; with no page location it can only reach
     the page's own origin, so it counts as same-origin. */
  function isJobBoredApiRequest(input, scope) {
    var raw = String(requestUrlOf(input) || "").trim();
    if (!raw) return false;
    var href = pageHref(scope);
    var target = originOf(raw, href);
    if (!target) {
      var absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.indexOf("//") === 0;
      return !href && !absolute;
    }
    return trustedApiOrigins(scope).indexOf(target) !== -1;
  }

  /* The one API transport. Attaches the hosted token only when one is
     configured AND the request targets the JobBored API's own origin; any
     other origin gets a plain fetch with the caller's init untouched, so the
     token never leaks to a job page, a user webhook, or a CDN. Returns the
     fetch Response untouched — it never rewrites error bodies, so `code`
     reaches the caller exactly as the server sent it. */
  function apiFetch(input, init) {
    var scope = globalScope();
    var fetchImpl =
      scope && typeof scope.fetch === "function"
        ? scope.fetch
        : typeof fetch === "function"
          ? fetch
          : null;
    if (!fetchImpl) return Promise.reject(new Error("fetch unavailable"));
    if (!isJobBoredApiRequest(input, scope)) return fetchImpl(input, init);
    var token = resolveApiToken();
    var base = init && typeof init === "object" ? Object.assign({}, init) : {};
    /* A Request carries its own headers; an init.headers would replace them,
       so seed from the Request when the caller passed none. */
    if (
      token &&
      base.headers == null &&
      input &&
      typeof input === "object" &&
      input.headers &&
      typeof input.headers.forEach === "function"
    ) {
      base.headers = input.headers;
    }
    return fetchImpl(input, applyHostedApiAuth(base, token));
  }

  root.JobBoredHostedApiAuth = {
    getHostedApiToken: getHostedApiToken,
    applyHostedApiAuthHeaders: applyHostedApiAuthHeaders,
    applyHostedApiAuth: applyHostedApiAuth,
    resolveApiToken: resolveApiToken,
    isJobBoredApiRequest: function (input) {
      return isJobBoredApiRequest(input, globalScope());
    },
    apiFetch: apiFetch,
  };
})(typeof window !== "undefined" ? window : globalThis);
