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

// ---------------------------------------------------------------------------
// Pipeline row derivations — pure helpers for redesign FE lanes.
// Kept in sync with the browser copy in discovery-shared-helpers.js.
// See docs/redesign/handoffs/be-data-deploy.md §Answers for the contract.
// ---------------------------------------------------------------------------

const STAGE_AGE_APPLIED_STATUSES = [
  "applied",
  "phone screen",
  "interviewing",
  "offer",
];

function parsePipelineDate(raw) {
  const s = asString(raw);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function daysBetween(earlier, later) {
  const MS_PER_DAY = 24 * 3600 * 1000;
  const a = new Date(earlier);
  a.setHours(0, 0, 0, 0);
  const b = new Date(later);
  b.setHours(0, 0, 0, 0);
  const delta = Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
  return delta < 0 ? 0 : delta;
}

function deriveStageAge(job, now) {
  if (!job || typeof job !== "object") {
    return { days: null, source: null };
  }
  const nowDate = now instanceof Date ? now : new Date();
  const status = asString(job.status).toLowerCase();
  const useApplied = STAGE_AGE_APPLIED_STATUSES.includes(status);

  if (useApplied) {
    const d = parsePipelineDate(job.appliedDate);
    if (d) {
      return { days: daysBetween(d, nowDate), source: "appliedDate" };
    }
  }
  const fallback = parsePipelineDate(job.dateFound || job.dateFoundRaw);
  if (fallback) {
    return { days: daysBetween(fallback, nowDate), source: "dateFound" };
  }
  return { days: null, source: null };
}

function deriveFollowUpState(job, now) {
  if (!job || typeof job !== "object") return { state: "none" };
  const raw = asString(job.followUpDate);
  if (!raw) return { state: "none" };
  const due = parsePipelineDate(raw);
  if (!due) return { state: "invalid" };
  const nowDate = now instanceof Date ? now : new Date();
  const nowMidnight = new Date(nowDate);
  nowMidnight.setHours(0, 0, 0, 0);
  const dueMidnight = new Date(due);
  dueMidnight.setHours(0, 0, 0, 0);

  const MS_PER_DAY = 24 * 3600 * 1000;
  const MS_PER_HOUR = 3600 * 1000;

  if (dueMidnight.getTime() < nowMidnight.getTime()) {
    return {
      state: "overdue",
      daysOverdue: Math.floor(
        (nowMidnight.getTime() - dueMidnight.getTime()) / MS_PER_DAY,
      ),
    };
  }
  const hoursUntil = Math.max(
    0,
    Math.floor((due.getTime() - nowDate.getTime()) / MS_PER_HOUR),
  );
  if (hoursUntil <= 48) {
    return { state: "due-soon", hoursUntil };
  }
  return {
    state: "scheduled",
    daysUntil: Math.floor(
      (dueMidnight.getTime() - nowMidnight.getTime()) / MS_PER_DAY,
    ),
  };
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
  parsePipelineDate,
  deriveStageAge,
  deriveFollowUpState,
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
  parsePipelineDate,
  deriveStageAge,
  deriveFollowUpState,
};
