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
  // Pipeline row derivations — pure helpers for redesign FE lanes
  // ---------------------------------------------------------------------------
  //
  // The Pipeline sheet contract (schemas/pipeline-row.v1.json) does **not**
  // include a `statusChangedAt` or `lastUpdatedAt` column. Adding one would be
  // a breaking change to an existing user-owned sheet. The redesign FE lanes
  // (fe-kanban "days in current stage", fe-dashboard "follow-up state") must
  // derive these signals from the columns that already exist, with a stable
  // fallback chain documented here.
  //
  // Fallback chain for stage age (best → worst):
  //   1. Applied / Phone Screen / Interviewing / Offer
  //        → `appliedDate` (sheet col N). updateJobStatus side-effects set
  //          this the first time the row enters the "applied" funnel.
  //   2. Any other status (New / Researching / Rejected / Passed) or when
  //      appliedDate is blank
  //        → `dateFound` (sheet col A). This is the best approximation of
  //          "when we first saw this role," which collapses to "days since
  //          discovery" for stages before Applied.
  //   3. If neither date is parseable → null (caller should render "—").
  //
  // This is an approximation: a role that sat as "Researching" for two weeks
  // and was moved to "Applied" today will report `daysInStage === 0` (correct,
  // because appliedDate === today). A role that skipped straight from "New"
  // to "Interviewing" without "Applied" being set by hand will report days
  // since `dateFound`, which overstates the stage age. Both failure modes are
  // acceptable for an "at-a-glance" card signal.
  //
  // See docs/redesign/handoffs/be-data-deploy.md for the full answer table
  // and docs/INTERFACE-DISCOVERY-RUNS.md for the runs-log read path.

  const STAGE_AGE_APPLIED_STATUSES = [
    "applied",
    "phone screen",
    "interviewing",
    "offer",
  ];

  /**
   * Parse a pipeline date string ("YYYY-MM-DD" or ISO) to a Date, or null.
   * Intentionally lenient: the sheet historically accepted free-form dates
   * and the dashboard must not throw on junk input.
   */
  function parsePipelineDate(raw) {
    const s = asString(raw);
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  /**
   * Derive "days in current stage" for a pipeline row.
   *
   * Returns an object:
   *   { days: number|null, source: "appliedDate"|"dateFound"|null }
   *
   * `days` is a non-negative integer (calendar days) or null when no
   * parseable timestamp is available. `source` identifies which field was
   * used so the UI can annotate the value (e.g. "since applied" vs
   * "since discovery").
   *
   * The `now` parameter is injectable for deterministic tests.
   */
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
        return {
          days: daysBetween(d, nowDate),
          source: "appliedDate",
        };
      }
    }

    const fallback = parsePipelineDate(job.dateFound || job.dateFoundRaw);
    if (fallback) {
      return {
        days: daysBetween(fallback, nowDate),
        source: "dateFound",
      };
    }
    return { days: null, source: null };
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

  /**
   * Derive follow-up state for a pipeline row.
   *
   * Returns one of:
   *   { state: "none" }                         — no follow-up date set
   *   { state: "overdue",  daysOverdue: n }     — followUpDate < today
   *   { state: "due-soon", hoursUntil: n }      — 0 ≤ now..followUpDate ≤ 48h
   *   { state: "scheduled", daysUntil: n }      — followUpDate > 48h from now
   *   { state: "invalid" }                      — cell is non-empty but unparseable
   *
   * Purely derived from `followUpDate` (schema col P). The Pipeline schema
   * does not persist a "did I send the follow-up?" flag; that signal is
   * indirect via the surrounding status transitions (updateJobStatus clears
   * followUpDate on Offer / Rejected / Passed).
   */
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
    // Pipeline row derivations (redesign — FE lanes)
    parsePipelineDate,
    deriveStageAge,
    deriveFollowUpState,
  });

  if (typeof window !== "undefined") {
    window.JobBoredDiscoveryHelpers = root;
  }

  // Also export as ES module for Node.js consumers (scripts/)
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root;
  }
})();
