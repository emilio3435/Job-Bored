/**
 * discovery-shared-helpers.js
 *
 * Canonical URL normalization and classification helpers shared across
 * browser-based discovery wizard scripts, Node.js bootstrap/verify scripts,
 * and the main app.
 *
 * IMPORTANT: These functions are intentionally duplicated verbatim across
 * surfaces to keep each surface independently runnable without a shared
 * module system. When changing any function here, propagate the same
 * change to all copies listed in COPIES. The canonical implementation
 * is this file — update COPIES when refactoring.
 *
 * COPIES:
 *   - discovery-wizard-local.js     :: local.* helpers
 *   - discovery-wizard-probes.js    :: probes.* helpers
 *   - discovery-wizard-relay.js     :: relay.* helpers
 *   - discovery-wizard-verify.js   :: verify.* helpers
 *   - scripts/verify-discovery-webhook.mjs
 *   - app.js                       :: top-level isLikely* functions
 */

(function () {
  "use strict";

  const root =
    window.JobBoredDiscoveryHelpers || (window.JobBoredDiscoveryHelpers = {});

  // ---------------------------------------------------------------------------
  // Core string helpers
  // ---------------------------------------------------------------------------

  function asString(raw, fallback = "") {
    const value = raw == null ? "" : String(raw).trim();
    return value || fallback;
  }

  // ---------------------------------------------------------------------------
  // URL normalization
  // ---------------------------------------------------------------------------

  /**
   * Canonical URL normalization: strips hash and query string, returns empty
   * string for invalid input. Consistent across all copies.
   */
  function normalizeUrl(raw) {
    const s = asString(raw);
    if (!s) return "";
    try {
      const url = new URL(s);
      url.hash = "";
      url.search = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  // ---------------------------------------------------------------------------
  // Host classification helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns true for 127.0.0.1, localhost, ::1, and private IPv4 ranges.
   * Used to detect local-only URLs that should not be saved as webhooks.
   */
  function isLocalHost(hostname) {
    const host = asString(hostname)
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1")
      return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  }

  /**
   * True for Apps Script exec/dev web app URLs.
   * Pattern: https://script.google.com/macros/s/{id}/(exec|dev)/
   */
  function isLikelyAppsScriptWebAppUrl(raw) {
    const s = asString(raw);
    if (!s) return false;
    try {
      const url = new URL(s);
      return (
        url.protocol === "https:" &&
        /(^|\.)script\.google\.com$/i.test(url.hostname) &&
        /\/macros\/s\/[^/]+\/(?:exec|dev)\/?$/i.test(url.pathname)
      );
    } catch (_) {
      return /https:\/\/script\.google\.com\/macros\/s\/[^/]+\/(?:exec|dev)\/?/i.test(
        s,
      );
    }
  }

  /**
   * True for Cloudflare Worker URLs:
   *   - *.workers.dev
   *   - *.cloudflareworkers.com
   */
  function isLikelyCloudflareWorkerUrl(raw) {
    const s = asString(raw);
    if (!s) return false;
    try {
      const url = new URL(s);
      return (
        url.protocol === "https:" &&
        (/\.workers\.dev$/i.test(url.hostname) ||
          /(^|\.)cloudflareworkers\.com$/i.test(url.hostname))
      );
    } catch (_) {
      return /workers\.dev/i.test(s);
    }
  }

  /**
   * True for URLs whose host is a localhost or private IP address.
   * Used to flag local-only endpoints that cannot receive webhooks from
   * remote or cloud-hosted clients.
   */
  function isLocalWebhookUrl(raw) {
    const s = asString(raw);
    if (!s) return false;
    try {
      const url = new URL(s);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
      return isLocalHost(url.hostname);
    } catch (_) {
      return false;
    }
  }

  /**
   * True when the URL path ends in /forward (Cloudflare Worker /forward suffix).
   * Such URLs require auth headers the browser cannot supply, so they are
   * invalid as browser-facing webhook endpoints.
   */
  function isWorkerForwardUrl(raw) {
    const url = normalizeUrl(raw);
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return /\/forward\/?$/i.test(parsed.pathname.replace(/\/+$/, "/"));
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Webhook-kind classification
  // ---------------------------------------------------------------------------

  /**
   * Maps a saved webhook URL to one of:
   *   "none"           — no URL
   *   "local_http"     — localhost / private IP
   *   "apps_script_stub" — Apps Script exec/dev URL
   *   "worker"         — Cloudflare Worker URL
   *   "generic_https"  — any other HTTPS URL
   */
  function classifySavedWebhookKind(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) return "none";
    try {
      const parsed = new URL(url);
      if (isLocalHost(parsed.hostname)) return "local_http";
      if (isLikelyWorkerUrl(url)) return "worker";
      if (isLikelyAppsScriptWebAppUrl(url)) return "apps_script_stub";
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return "generic_https";
      }
    } catch (_) {
      // fall through
    }
    return "none";
  }

  // Alias kept for backward compatibility with existing callers
  const classifyWebhookUrl = classifySavedWebhookKind;

  /**
   * Alias for isLikelyCloudflareWorkerUrl — kept for callers that use the
   * shorter name.
   */
  function isLikelyWorkerUrl(raw) {
    return isLikelyCloudflareWorkerUrl(raw);
  }

  // ---------------------------------------------------------------------------
  // Local health URL helpers
  // ---------------------------------------------------------------------------

  /**
   * Converts a local webhook URL to its /health endpoint by replacing the
   * pathname. Returns empty string if the input cannot be parsed as a URL.
   */
  function buildLocalHealthUrl(localWebhookUrl) {
    const local = normalizeUrl(localWebhookUrl);
    if (!local) return "";
    try {
      const url = new URL(local);
      url.pathname = "/health";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  /**
   * Returns a proxy URL for health checks against localhost targets.
   * In the dashboard dev-server context, /__proxy/local-health proxies
   * to the actual localhost port to avoid CORS issues.
   */
  function localHealthProxyUrl(healthUrl) {
    try {
      const parsed = new URL(healthUrl);
      const host = parsed.hostname;
      if (
        host === "127.0.0.1" ||
        host === "localhost" ||
        host === "[::1]" ||
        host === "::1"
      ) {
        const port =
          parsed.port || (parsed.protocol === "https:" ? "443" : "80");
        return `/__proxy/local-health?port=${port}`;
      }
    } catch (_) {}
    return healthUrl;
  }

  // ---------------------------------------------------------------------------
  // Shared constant for default discovery worker port
  // ---------------------------------------------------------------------------

  const DEFAULT_LOCAL_PORT = "8644";

  // ---------------------------------------------------------------------------
  // Port inference
  // ---------------------------------------------------------------------------

  /**
   * Extracts the port number from a URL string, returning the explicit port
   * or inferring 80/443 from the scheme. Falls back to defaultPort.
   */
  function inferPortFromUrl(raw, fallback = DEFAULT_LOCAL_PORT) {
    const url = normalizeUrl(raw);
    if (!url) return asString(fallback, DEFAULT_LOCAL_PORT);
    try {
      const parsed = new URL(url);
      if (parsed.port) return parsed.port;
      return parsed.protocol === "https:" ? "443" : "80";
    } catch (_) {
      return asString(fallback, DEFAULT_LOCAL_PORT);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  Object.assign(root, {
    // Core
    asString,
    normalizeUrl,
    isLocalHost,
    // Classification
    isLikelyAppsScriptWebAppUrl,
    isLikelyCloudflareWorkerUrl,
    isLikelyWorkerUrl,
    isLocalWebhookUrl,
    isWorkerForwardUrl,
    classifySavedWebhookKind,
    classifyWebhookUrl,
    // Local health
    buildLocalHealthUrl,
    localHealthProxyUrl,
    // Utilities
    DEFAULT_LOCAL_PORT,
    inferPortFromUrl,
  });

  if (typeof window !== "undefined") {
    window.JobBoredDiscoveryHelpers = root;
  }

  // Also export as ES module for Node.js consumers (scripts/)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root;
  }
})();
