/**
 * discovery-shared-helpers.mjs
 *
 * Node.js-compatible canonical URL normalization and classification helpers
 * shared across bootstrap/verify scripts and the browser wizard scripts.
 *
 * This module is the canonical source for these helpers in Node.js contexts.
 * Browser contexts use discovery-shared-helpers.js instead (which exposes
 * the same functions on window.JobBoredDiscoveryHelpers).
 */

const DEFAULT_LOCAL_PORT = "8644";

function asString(raw, fallback = "") {
  const value = raw == null ? "" : String(raw).trim();
  return value || fallback;
}

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
    return /https:\/\/script\.google\.com\/macros\/s\/[^/]+\/(?:exec|dev)\/?/i.test(s);
  }
}

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

function isLikelyWorkerUrl(raw) {
  return isLikelyCloudflareWorkerUrl(raw);
}

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

function isLocalWebhookUrl(raw) {
  const s = asString(raw);
  if (!s) return false;
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch (_) {
    return false;
  }
}

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

export {
  DEFAULT_LOCAL_PORT,
  asString,
  isLocalHost,
  normalizeUrl,
  isLikelyAppsScriptWebAppUrl,
  isLikelyCloudflareWorkerUrl,
  isLikelyWorkerUrl,
  isWorkerForwardUrl,
  isLocalWebhookUrl,
  buildLocalHealthUrl,
  localHealthProxyUrl,
  inferPortFromUrl,
};

export default {
  DEFAULT_LOCAL_PORT,
  asString,
  isLocalHost,
  normalizeUrl,
  isLikelyAppsScriptWebAppUrl,
  isLikelyCloudflareWorkerUrl,
  isLikelyWorkerUrl,
  isWorkerForwardUrl,
  isLocalWebhookUrl,
  buildLocalHealthUrl,
  localHealthProxyUrl,
  inferPortFromUrl,
};
