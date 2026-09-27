/**
 * fit-profile-sync.js — POST the Fit Profile to the local JobBored API.
 *
 * N-B4-1: on a greenfield install the config URLs are empty, and the old
 * "is an API configured?" check skipped the POST, so ~/.jobbored/profile.json
 * was never written. The base now comes from
 * JobBoredProfileApi.getProfileApiBase(), and "" means a same-origin
 * POST /profile (the dev server proxies it), never "skip" (R7).
 *
 * N-B4-2: a 4xx is the server refusing the profile. It is always returned as
 * { ok:false, reason:"rejected" } with the server's own message — never
 * swallowed as a local save.
 *
 * Result: { ok, synced, status, reason, message } (+ errors on "rejected").
 *   synced            ok:true,  synced:true   the server stored it
 *   local_only        ok:true,  synced:false  no JobBored API answered here
 *                                             (network failure, a static
 *                                             host's 404/405, the dev
 *                                             server's 502/504 "API not
 *                                             running", a non-JSON 200)
 *   rejected          ok:false                any other 4xx, or ok:false
 *   server_error      ok:false                5xx
 *
 * Classic-global IIFE. Attaches window.JobBoredFitProfileSync. Load after
 * profile-api-base.js and before any beat that calls it.
 */
(function (root) {
  "use strict";

  var LOCAL_ONLY_MESSAGE =
    "Saved on this device. Start JobBored on your computer to use it for drafting.";
  var TIMEOUT_MS = 15000;
  // dev-server.mjs answers these when its /profile proxy can't reach the API.
  var PROXY_UNREACHABLE = { profile_api_unreachable: true, profile_api_timeout: true };

  function resolveBase() {
    var api = root && root.JobBoredProfileApi;
    if (api && typeof api.getProfileApiBase === "function") {
      return String(api.getProfileApiBase() || "").replace(/\/+$/, "");
    }
    return "";
  }

  function result(ok, synced, status, reason, message) {
    return { ok: ok, synced: synced, status: status, reason: reason, message: message };
  }

  function localOnly(status) {
    return result(true, false, status, "local_only", LOCAL_ONLY_MESSAGE);
  }

  // A declared non-JSON type (a static host's HTML) is never parsed; an
  // absent header still gets a parse attempt.
  function declaresNonJson(response) {
    var headers = response && response.headers;
    var type = headers && typeof headers.get === "function" ? headers.get("content-type") : null;
    return type != null && !/json/i.test(String(type));
  }

  async function readJsonBody(response) {
    if (!response || typeof response.json !== "function" || declaresNonJson(response)) {
      return null;
    }
    try {
      var body = await response.json();
      return body && typeof body === "object" && !Array.isArray(body) ? body : null;
    } catch (_) {
      return null;
    }
  }

  function serverMessage(body) {
    if (!body) return "";
    if (Array.isArray(body.errors) && body.errors.length) {
      return body.errors
        .map(function (e) {
          if (!e || typeof e !== "object") return String(e || "");
          var at = e.instancePath ? String(e.instancePath) + " " : "";
          return at + String(e.message || "is invalid");
        })
        .join("; ");
    }
    var text = body.message || body.detail || body.error || body.reason;
    return typeof text === "string" ? text : "";
  }

  /* E4: the JobBored API transport. Attaches the hosted token when
     hosted-api-auth.js is loaded; otherwise window.fetch, called on window. */
  function apiFetch(url, init) {
    var auth = root && root.JobBoredHostedApiAuth;
    if (auth && typeof auth.apiFetch === "function") return auth.apiFetch(url, init);
    return root.fetch(url, init);
  }

  async function syncProfile(payload, options) {
    var opts = options || {};
    // window.fetch must be called on window: a detached call throws
    // "Illegal invocation", which would read as a network failure.
    var fetchImpl =
      opts.fetchImpl !== undefined
        ? opts.fetchImpl
        : root && typeof root.fetch === "function"
          ? function (url, init) {
              return apiFetch(url, init);
            }
          : null;
    if (typeof fetchImpl !== "function") return localOnly(0);

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, TIMEOUT_MS)
      : null;
    var response;
    try {
      response = await fetchImpl(resolveBase() + "/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });
    } catch (_) {
      return localOnly(0);
    } finally {
      if (timer) clearTimeout(timer);
    }

    var status = Number(response && response.status) || 0;
    var body = await readJsonBody(response);

    if (status >= 200 && status < 300) {
      if (body && body.ok === true) {
        return result(true, true, status, "synced", "Saved. Drafting will use this profile.");
      }
      // A 200 that isn't the profile API (a static host's HTML fallback).
      if (!body) return localOnly(status);
      return rejected(status, body);
    }
    if ((status === 404 || status === 405) && !(body && body.ok === false)) {
      return localOnly(status);
    }
    if ((status === 502 || status === 504) && body && PROXY_UNREACHABLE[body.error]) {
      return localOnly(status);
    }
    if (status >= 400 && status < 500) return rejected(status, body);
    return result(
      false,
      false,
      status,
      "server_error",
      serverMessage(body) ||
        "JobBored couldn't save your profile (HTTP " + status + "). Try again.",
    );
  }

  function rejected(status, body) {
    var out = result(
      false,
      false,
      status,
      "rejected",
      serverMessage(body) || "JobBored refused this profile (HTTP " + status + ").",
    );
    out.errors = body && Array.isArray(body.errors) ? body.errors : [];
    return out;
  }

  var api = Object.freeze({
    syncProfile: syncProfile,
    LOCAL_ONLY_MESSAGE: LOCAL_ONLY_MESSAGE,
  });

  if (root) root.JobBoredFitProfileSync = api;
})(typeof window !== "undefined" ? window : globalThis);
