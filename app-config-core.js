/* ============================================
   COMMAND CENTER v2 — App Config Core
   Extracted from app.js (app-config-core cut).

   Classic-global IIFE under window.JobBoredApp.configCore — NOT an ES module.
   Loaded BEFORE app.js. Sheet ID parsing, config getters, OAuth/discovery
   accessors, Google/API constants, and discovery runtime caches.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const configCore = root.configCore || (root.configCore = {});

  function host() {
    return window.JobBoredApp.core && window.JobBoredApp.core.host;
  }

  const MIN_PLAUSIBLE_GOOGLE_SHEET_ID_LENGTH = 20;

  function isPlausibleGoogleSheetId(value) {
    return (
      typeof value === "string" &&
      /^[a-zA-Z0-9_-]+$/.test(value) &&
      value.length >= MIN_PLAUSIBLE_GOOGLE_SHEET_ID_LENGTH &&
      value !== "YOUR_SHEET_ID_HERE"
    );
  }

  function parseGoogleSheetId(raw) {
    if (raw == null || typeof raw !== "string") return null;
    const s = raw.trim();
    if (!s) return null;
    const fromPath = s.match(
      /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$|\?|#)/,
    );
    if (fromPath && isPlausibleGoogleSheetId(fromPath[1])) return fromPath[1];
    const compact = s.replace(/\s/g, "");
    if (isPlausibleGoogleSheetId(compact)) {
      return compact;
    }
    return null;
  }

  /** Default dashboard label; legacy templates used "Command Center". */
  function normalizeDashboardTitle(raw) {
    const t = raw != null ? String(raw).trim() : "";
    if (!t) return "JobBored";
    if (t.toLowerCase() === "command center") return "JobBored";
    return t;
  }

  function getConfig() {
    const cfg = window.COMMAND_CENTER_CONFIG;
    if (!cfg) return null;
    const sheetId = parseGoogleSheetId(String(cfg.sheetId || ""));
    if (!sheetId || sheetId === "YOUR_SHEET_ID_HERE") return null;
    return {
      ...cfg,
      sheetId,
      title: normalizeDashboardTitle(cfg.title),
    };
  }

  function getSheetId() {
    const params = new URLSearchParams(window.location.search);
    const urlSheet = params.get("sheet");
    if (urlSheet) {
      const id = parseGoogleSheetId(urlSheet);
      if (id) return id;
    }

    const cfg = getConfig();
    return cfg ? cfg.sheetId : null;
  }

  // Live read of the resolved SHEET_ID module var (distinct from getSheetId,
  // which derives from URL/config). Reads through the core host bridge once
  // app.js publishes SHEET_ID accessors.
  function getActiveSheetId() {
    const h = host();
    return h && typeof h.getSHEET_ID === "function" ? h.getSHEET_ID() : null;
  }

  function getOAuthClientId() {
    const cfg = window.COMMAND_CENTER_CONFIG || {};
    const id = String(cfg.oauthClientId || "").trim();
    if (!id || id === "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com") {
      return null;
    }
    return id;
  }

  /** Optional POST target for "Run discovery" (browser-use worker / Hermes / n8n / Apps Script). */
  function getDiscoveryWebhookUrl() {
    const cfg = getConfig();
    const u = cfg && cfg.discoveryWebhookUrl;
    if (!u || typeof u !== "string") return "";
    const t = u.trim();
    return t.length > 0 ? t : "";
  }

  /**
   * Optional shared secret for the discovery webhook. When set, the dashboard
   * forwards it as the `x-discovery-secret` header so receivers that fail-closed
   * on empty secrets (e.g. the browser-use worker) accept the request.
   */
  function getDiscoveryWebhookSecret() {
    const cfg = getConfig();
    const s = cfg && cfg.discoveryWebhookSecret;
    if (!s || typeof s !== "string") return "";
    const t = s.trim();
    return t.length > 0 ? t : "";
  }

  const APPS_SCRIPT_API_BASE = "https://script.googleapis.com/v1";
  const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
  const GOOGLE_USERINFO_EMAIL_SCOPE =
    "https://www.googleapis.com/auth/userinfo.email";
  const GOOGLE_USERINFO_PROFILE_SCOPE =
    "https://www.googleapis.com/auth/userinfo.profile";
  const GOOGLE_SIGNIN_SCOPES = [
    GOOGLE_SHEETS_SCOPE,
    GOOGLE_USERINFO_EMAIL_SCOPE,
    GOOGLE_USERINFO_PROFILE_SCOPE,
  ].join(" ");
  const APPS_SCRIPT_DEPLOY_SCOPES = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
  ];
  const APPS_SCRIPT_MANAGED_BY = "command-center";
  const APPS_SCRIPT_PROJECT_TITLE = "Command Center discovery webhook";
  const APPS_SCRIPT_WEBAPP_ACCESS = "ANYONE_ANONYMOUS";
  const APPS_SCRIPT_WEBAPP_EXECUTE_AS = "USER_DEPLOYING";
  const APPS_SCRIPT_PUBLIC_ACCESS_READY = "ready";
  const APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION = "needs_remediation";
  const DISCOVERY_ENGINE_STATE_NONE = "none";
  const DISCOVERY_ENGINE_STATE_STUB_ONLY = "stub_only";
  const DISCOVERY_ENGINE_STATE_UNVERIFIED = "unverified";
  const DISCOVERY_ENGINE_STATE_CONNECTED = "connected";
  const GIS_INIT_STUCK_MS = 8000;
  const STARTER_PIPELINE_HEADERS = [
    "Date Found",
    "Title",
    "Company",
    "Location",
    "Link",
    "Source",
    "Salary",
    "Fit Score",
    "Priority",
    "Tags",
    "Fit Assessment",
    "Contact",
    "Status",
    "Applied Date",
    "Notes",
    "Follow-up Date",
    "Talking Points",
    "Last contact",
    "Did they reply?",
    "Logo URL",
    "Match Score",
    "Favorite",
    "Dismissed At",
    "Approval Status",
    "Edit Lock",
  ];
  const STARTER_PIPELINE_HEADER_RANGE = `Pipeline!A1:${String.fromCharCode("A".charCodeAt(0) + STARTER_PIPELINE_HEADERS.length - 1)}1`;

  configCore.appsScriptDeployStateCache = null;
  configCore.appsScriptDeployBusy = false;
  configCore.appsScriptDeployStatus = null;
  configCore.discoveryEngineStateCache = null;
  configCore.discoveryReadinessSnapshotCache = null;
  configCore.discoveryReadinessSnapshotPromise = null;
  configCore.discoveryWizardRuntime = null;

  Object.assign(configCore, {
    MIN_PLAUSIBLE_GOOGLE_SHEET_ID_LENGTH,
    APPS_SCRIPT_API_BASE,
    GOOGLE_SHEETS_SCOPE,
    GOOGLE_USERINFO_EMAIL_SCOPE,
    GOOGLE_USERINFO_PROFILE_SCOPE,
    GOOGLE_SIGNIN_SCOPES,
    APPS_SCRIPT_DEPLOY_SCOPES,
    APPS_SCRIPT_MANAGED_BY,
    APPS_SCRIPT_PROJECT_TITLE,
    APPS_SCRIPT_WEBAPP_ACCESS,
    APPS_SCRIPT_WEBAPP_EXECUTE_AS,
    APPS_SCRIPT_PUBLIC_ACCESS_READY,
    APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION,
    DISCOVERY_ENGINE_STATE_NONE,
    DISCOVERY_ENGINE_STATE_STUB_ONLY,
    DISCOVERY_ENGINE_STATE_UNVERIFIED,
    DISCOVERY_ENGINE_STATE_CONNECTED,
    GIS_INIT_STUCK_MS,
    STARTER_PIPELINE_HEADERS,
    STARTER_PIPELINE_HEADER_RANGE,
    isPlausibleGoogleSheetId,
    parseGoogleSheetId,
    normalizeDashboardTitle,
    getConfig,
    getSheetId,
    getActiveSheetId,
    getOAuthClientId,
    getDiscoveryWebhookUrl,
    getDiscoveryWebhookSecret,
  });
})();
