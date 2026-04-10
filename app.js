/* ============================================
   COMMAND CENTER v2 — App Logic
   CSV read + Google Sheets API v4 write-back
   Google Identity Services (GIS) OAuth 2.0
   ============================================ */

(function ensureDiscoveryWizardLocalApiLoaded() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  try {
    const root =
      window.JobBoredDiscoveryWizard || (window.JobBoredDiscoveryWizard = {});
    if (root.local && typeof root.local.runLocalWizardAction === "function") {
      return;
    }
    const cur = document.currentScript;
    const fallbackSrc =
      cur && cur.src
        ? new URL("./discovery-wizard-local.js", cur.src).href
        : "discovery-wizard-local.js";
    const s = document.createElement("script");
    s.src = fallbackSrc;
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
  } catch (err) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[JobBored] could not load discovery-wizard-local.js:", err);
    }
  }
})();

const COMMAND_CENTER_CONFIG_OVERRIDE_KEY = "command_center_config_overrides";
const DISCOVERY_TRANSPORT_SETUP_KEY =
  "command_center_discovery_transport_setup";
const DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH = "discovery-local-bootstrap.json";

const COMMAND_CENTER_OVERRIDE_KEYS = [
  "sheetId",
  "oauthClientId",
  "title",
  "discoveryWebhookUrl",
  "resumeProvider",
  "resumeGeminiApiKey",
  "resumeGeminiModel",
  "resumeOpenAIApiKey",
  "resumeOpenAIModel",
  "resumeAnthropicApiKey",
  "resumeAnthropicModel",
  "resumeGenerationWebhookUrl",
  "jobPostingScrapeUrl",
  "atsScoringMode",
  "atsScoringServerUrl",
  "atsScoringWebhookUrl",
];

function readStoredConfigOverrides() {
  try {
    const raw = localStorage.getItem(COMMAND_CENTER_CONFIG_OVERRIDE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.warn("[JobBored] Stored config overrides:", e);
    return {};
  }
}

function applyConfigOverridesToWindowConfig(overrides) {
  if (
    !window.COMMAND_CENTER_CONFIG ||
    typeof window.COMMAND_CENTER_CONFIG !== "object"
  ) {
    window.COMMAND_CENTER_CONFIG = {};
  }
  const base = window.COMMAND_CENTER_CONFIG;
  const src = overrides && typeof overrides === "object" ? overrides : {};
  for (const k of COMMAND_CENTER_OVERRIDE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, k) && src[k] != null) {
      base[k] = src[k];
    }
  }
}

function writeStoredConfigOverrides(overrides) {
  const next = overrides && typeof overrides === "object" ? overrides : {};
  localStorage.setItem(
    COMMAND_CENTER_CONFIG_OVERRIDE_KEY,
    JSON.stringify(next),
  );
  applyConfigOverridesToWindowConfig(next);
  return next;
}

function mergeStoredConfigOverridePatch(patch) {
  const next = {
    ...readStoredConfigOverrides(),
  };
  const src = patch && typeof patch === "object" ? patch : {};
  for (const k of COMMAND_CENTER_OVERRIDE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, k) && src[k] != null) {
      next[k] = src[k];
    }
  }
  return writeStoredConfigOverrides(next);
}

/** Merge values saved in this browser (localStorage) onto config from config.js. */
function applyStoredConfigOverrides() {
  applyConfigOverridesToWindowConfig(readStoredConfigOverrides());
}

applyStoredConfigOverrides();

function readDiscoveryTransportSetupState() {
  try {
    const raw = localStorage.getItem(DISCOVERY_TRANSPORT_SETUP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.warn("[JobBored] Discovery transport setup:", e);
    return {};
  }
}

function normalizeDiscoveryLocalWebhookUrl(raw) {
  const s = raw != null ? String(raw).trim() : "";
  if (!s) return "";
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function normalizeDiscoveryTunnelPublicUrl(raw) {
  const s = raw != null ? String(raw).trim() : "";
  if (!s) return "";
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return "";
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function getDiscoveryTransportSetupState() {
  const raw = readDiscoveryTransportSetupState();
  return {
    localWebhookUrl: normalizeDiscoveryLocalWebhookUrl(raw.localWebhookUrl),
    tunnelPublicUrl: normalizeDiscoveryTunnelPublicUrl(raw.tunnelPublicUrl),
  };
}

function writeDiscoveryTransportSetupState(patch) {
  const current = readDiscoveryTransportSetupState();
  const src = patch && typeof patch === "object" ? patch : {};
  const next = {
    ...current,
  };

  if (Object.prototype.hasOwnProperty.call(src, "localWebhookUrl")) {
    next.localWebhookUrl = normalizeDiscoveryLocalWebhookUrl(
      src.localWebhookUrl,
    );
  }
  if (Object.prototype.hasOwnProperty.call(src, "tunnelPublicUrl")) {
    next.tunnelPublicUrl = normalizeDiscoveryTunnelPublicUrl(
      src.tunnelPublicUrl,
    );
  }

  localStorage.setItem(DISCOVERY_TRANSPORT_SETUP_KEY, JSON.stringify(next));
  return getDiscoveryTransportSetupState();
}

function isLocalDashboardOrigin() {
  if (typeof window === "undefined" || !window.location) return false;
  const host = String(window.location.hostname || "").toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  ) {
    return true;
  }
  const port = String(window.location.port || "");
  if (port === "8080") return true;
  return false;
}

async function hydrateDiscoveryTransportSetupFromLocalBootstrap() {
  if (!isLocalDashboardOrigin()) return getDiscoveryTransportSetupState();
  try {
    const res = await fetch(DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH, {
      cache: "no-store",
    });
    if (!res.ok) return getDiscoveryTransportSetupState();
    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return getDiscoveryTransportSetupState();
    }
    return writeDiscoveryTransportSetupState({
      localWebhookUrl: data.localWebhookUrl,
      tunnelPublicUrl: data.tunnelPublicUrl || data.ngrokPublicUrl,
    });
  } catch (_) {
    return getDiscoveryTransportSetupState();
  }
}

// ============================================
// CONFIG VALIDATION
// ============================================

/**
 * Extract a Google Sheet ID from a full spreadsheet URL or a raw ID paste.
 * Accepts e.g. https://docs.google.com/spreadsheets/d/SHEET_ID/edit?gid=0…
 */
function parseGoogleSheetId(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const fromPath = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$|\?|#)/);
  if (fromPath) return fromPath[1];
  const compact = s.replace(/\s/g, "");
  if (
    /^[a-zA-Z0-9_-]+$/.test(compact) &&
    compact.length >= 10 &&
    compact !== "YOUR_SHEET_ID_HERE"
  ) {
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

function getOAuthClientId() {
  const cfg = window.COMMAND_CENTER_CONFIG || {};
  const id = String(cfg.oauthClientId || "").trim();
  if (!id || id === "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com") {
    return null;
  }
  return id;
}

/** Optional POST target for &ldquo;Run discovery&rdquo; (browser-use worker / Hermes / n8n / Apps Script). */
function getDiscoveryWebhookUrl() {
  const cfg = getConfig();
  const u = cfg && cfg.discoveryWebhookUrl;
  if (!u || typeof u !== "string") return "";
  const t = u.trim();
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
];
const STARTER_PIPELINE_HEADER_RANGE = `Pipeline!A1:${String.fromCharCode("A".charCodeAt(0) + STARTER_PIPELINE_HEADERS.length - 1)}1`;

let appsScriptDeployStateCache = null;
let appsScriptDeployBusy = false;
let appsScriptDeployStatus = null;
let discoveryEngineStateCache = null;
let discoveryReadinessSnapshotCache = null;
let discoveryReadinessSnapshotPromise = null;
let discoveryWizardRuntime = null;

function getSettingsFieldValue(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || "") : "";
}

function getSettingsSheetIdValue() {
  const el = document.getElementById("settingsSheetId");
  const raw = el
    ? String(el.value || "")
    : String((window.COMMAND_CENTER_CONFIG || {}).sheetId || "");
  return parseGoogleSheetId(raw.trim());
}

function getSettingsOAuthClientIdValue() {
  const el = document.getElementById("settingsOAuthClientId");
  const raw = el
    ? String(el.value || "")
    : String((window.COMMAND_CENTER_CONFIG || {}).oauthClientId || "");
  const id = raw.trim();
  if (!id || id === "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com") {
    return "";
  }
  return id;
}

function hasUnsavedOAuthClientIdChange(candidateId) {
  const nextId =
    candidateId != null
      ? String(candidateId || "").trim()
      : getSettingsOAuthClientIdValue();
  const activeId = String(getOAuthClientId() || "").trim();
  return !!nextId && nextId !== activeId;
}

function getDiscoveryEngineStateStore() {
  const UC = window.CommandCenterUserContent;
  return UC &&
    typeof UC.getDiscoveryEngineState === "function" &&
    typeof UC.saveDiscoveryEngineState === "function"
    ? UC
    : null;
}

function normalizeDiscoveryWebhookIdentity(raw) {
  const s = raw != null ? String(raw).trim() : "";
  if (!s) return "";
  try {
    const url = new URL(s);
    url.hash = "";
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    }
    return url.toString();
  } catch (_) {
    return s.replace(/\/+$/, "");
  }
}

function getDiscoveryWebhookUrlForSettingsPreview() {
  const field = document.getElementById("settingsDiscoveryWebhookUrl");
  if (field) {
    return String(field.value || "").trim();
  }
  return getDiscoveryWebhookUrl();
}

function getManagedAppsScriptWebhookIdentity() {
  if (
    !appsScriptDeployStateCache ||
    typeof appsScriptDeployStateCache.webAppUrl !== "string"
  ) {
    return "";
  }
  return normalizeDiscoveryWebhookIdentity(
    appsScriptDeployStateCache.webAppUrl,
  );
}

function getSavedDiscoveryEngineStateForUrl(rawUrl) {
  const target = normalizeDiscoveryWebhookIdentity(rawUrl);
  if (!target) return null;
  const saved =
    discoveryEngineStateCache &&
    typeof discoveryEngineStateCache === "object" &&
    typeof discoveryEngineStateCache.state === "string"
      ? discoveryEngineStateCache
      : null;
  if (!saved) return null;
  const savedUrl = normalizeDiscoveryWebhookIdentity(saved.webhookUrl);
  if (!savedUrl || savedUrl !== target) return null;
  return saved;
}

function getEffectiveDiscoveryEngineStatus(rawUrl) {
  const hook = normalizeDiscoveryWebhookIdentity(rawUrl);
  if (!hook) {
    return {
      state: DISCOVERY_ENGINE_STATE_NONE,
      tone: "info",
      label: "No discovery webhook configured",
      detail:
        "Pipeline still works without a webhook. Add a real discovery endpoint only if you want the Run discovery button.",
    };
  }

  const saved = getSavedDiscoveryEngineStateForUrl(hook);
  if (saved && saved.state === DISCOVERY_ENGINE_STATE_CONNECTED) {
    return {
      state: DISCOVERY_ENGINE_STATE_CONNECTED,
      tone: "success",
      label: "Discovery endpoint connected",
      detail:
        "Run discovery will POST to your endpoint so your automation can add or update Pipeline rows.",
    };
  }

  if (saved && saved.state === DISCOVERY_ENGINE_STATE_STUB_ONLY) {
    return {
      state: DISCOVERY_ENGINE_STATE_STUB_ONLY,
      tone: "warning",
      label: "Webhook stub connected",
      detail:
        "This endpoint only verifies wiring or appends a [CC test] row. It does not add real job leads.",
    };
  }

  const managedAppsScriptUrl = getManagedAppsScriptWebhookIdentity();
  if (managedAppsScriptUrl && managedAppsScriptUrl === hook) {
    return {
      state: DISCOVERY_ENGINE_STATE_STUB_ONLY,
      tone: "warning",
      label: "Managed Apps Script stub connected",
      detail:
        "The dashboard-deployed Apps Script endpoint is a stub for webhook verification only. Connect a real discovery engine before using Run discovery.",
    };
  }

  return {
    state: DISCOVERY_ENGINE_STATE_UNVERIFIED,
    tone: "info",
    label: "Custom discovery endpoint configured",
    detail:
      "This app can POST to the URL, but it cannot prove the endpoint writes Pipeline rows yet. Make sure it is a real discovery engine, not the default stub.",
  };
}

function buildDiscoveryStatusActions(status) {
  switch (status.state) {
    case DISCOVERY_ENGINE_STATE_STUB_ONLY:
      return [
        {
          label: "Open real discovery paths",
          href: "docs/DISCOVERY-PATHS.md",
          primary: true,
        },
        {
          label: "Open agent discovery guide",
          href: "integrations/openclaw-command-center/README.md",
        },
        {
          label: "Apps Script stub walkthrough",
          href: "integrations/apps-script/WALKTHROUGH.md",
        },
      ];
    case DISCOVERY_ENGINE_STATE_UNVERIFIED:
      return [
        {
          label: "Open AGENT_CONTRACT",
          href: "AGENT_CONTRACT.md",
          primary: true,
        },
        {
          label: "Open discovery paths",
          href: "docs/DISCOVERY-PATHS.md",
        },
      ];
    case DISCOVERY_ENGINE_STATE_CONNECTED:
      return [
        {
          label: "Open AGENT_CONTRACT",
          href: "AGENT_CONTRACT.md",
          primary: true,
        },
        {
          label: "Open discovery paths",
          href: "docs/DISCOVERY-PATHS.md",
        },
      ];
    default:
      return [
        {
          label: "Open discovery paths",
          href: "docs/DISCOVERY-PATHS.md",
          primary: true,
        },
        {
          label: "Open agent discovery guide",
          href: "integrations/openclaw-command-center/README.md",
        },
      ];
  }
}

function refreshDiscoveryUiState() {
  syncDiscoveryButtonState();
  renderDiscoveryEngineStatusUi();
  if (discoveryWizardRuntime) {
    updateDiscoveryWizardRuntime({
      snapshot: getDiscoveryReadinessSnapshot(),
    });
    void renderDiscoverySetupWizard();
  }
  if (!dashboardDataHydrated) return;
  if (document.getElementById("briefInsights")) {
    renderPipelineDailyBrief();
  }
  if (document.getElementById("jobCards")) {
    renderPipeline();
  }
}

async function saveDiscoveryEngineStatePatch(patch) {
  const store = getDiscoveryEngineStateStore();
  const next =
    patch && typeof patch === "object"
      ? patch
      : { state: DISCOVERY_ENGINE_STATE_NONE };
  if (!store) {
    discoveryEngineStateCache = next;
    refreshDiscoveryUiState();
    void refreshDiscoveryReadinessSnapshot({ force: true });
    return next;
  }
  try {
    discoveryEngineStateCache = await store.saveDiscoveryEngineState(next);
  } catch (err) {
    console.warn("[JobBored] discovery engine state:", err);
    discoveryEngineStateCache = next;
  }
  refreshDiscoveryUiState();
  void refreshDiscoveryReadinessSnapshot({ force: true });
  return discoveryEngineStateCache;
}

async function recordDiscoveryEngineState(rawUrl, state, source) {
  const normalizedUrl = normalizeDiscoveryWebhookIdentity(rawUrl);
  if (!normalizedUrl) {
    return saveDiscoveryEngineStatePatch({
      state: DISCOVERY_ENGINE_STATE_NONE,
      webhookUrl: "",
      source: source || "",
      lastCheckedAt: new Date().toISOString(),
    });
  }
  return saveDiscoveryEngineStatePatch({
    state,
    webhookUrl: normalizedUrl,
    source: source || "",
    lastCheckedAt: new Date().toISOString(),
  });
}

async function preloadDiscoveryUiState() {
  const stores = {
    appsScript: getAppsScriptDeployStateStore(),
    discovery: getDiscoveryEngineStateStore(),
  };
  if (stores.appsScript) {
    try {
      appsScriptDeployStateCache =
        await stores.appsScript.getAppsScriptDeployState();
    } catch (err) {
      console.warn("[JobBored] Apps Script deploy state preload:", err);
    }
  }
  if (stores.discovery) {
    try {
      discoveryEngineStateCache =
        await stores.discovery.getDiscoveryEngineState();
    } catch (err) {
      console.warn("[JobBored] discovery engine state preload:", err);
    }
  }
  await refreshDiscoveryReadinessSnapshot({ force: true, rerender: false });
  refreshDiscoveryUiState();
}

function getWindowOriginLabel() {
  try {
    return window.location.origin || "";
  } catch (_) {
    return "";
  }
}

function buildAppsScriptGisNotReadyStatus(clientId) {
  const currentOrigin = getWindowOriginLabel();
  const needsReload = hasUnsavedOAuthClientIdChange(clientId);
  if (needsReload) {
    return {
      tone: "warning",
      message:
        "Save settings to load Google sign-in for this new OAuth client.",
      detail:
        "This page is still running with the previous OAuth config. Save Settings once so the app reloads with the new client ID, then open Settings again and deploy.",
      steps: [
        "Click Save in Settings. The page will reload.",
        "Open Settings again after reload and confirm Google sign-in is ready.",
        `In Google Cloud, make sure this OAuth client is a Web application and includes ${currentOrigin || "this site origin"} under Authorized JavaScript origins.`,
        "After sign-in is ready, Apps Script deploy also needs Google Apps Script API enabled in the same Google Cloud project.",
      ],
      actions: [
        {
          label: "Open OAuth clients in Cloud Console",
          href: "https://console.cloud.google.com/auth/clients",
        },
        {
          label: "Open Apps Script API in Cloud Console",
          href: "https://console.cloud.google.com/apis/library/script.googleapis.com",
        },
      ],
    };
  }

  return {
    tone:
      gisInitStartedAt && Date.now() - gisInitStartedAt >= GIS_INIT_STUCK_MS
        ? "warning"
        : "info",
    message:
      gisInitStartedAt && Date.now() - gisInitStartedAt >= GIS_INIT_STUCK_MS
        ? "Google sign-in did not finish loading."
        : "Google sign-in is still loading.",
    detail:
      gisInitStartedAt && Date.now() - gisInitStartedAt >= GIS_INIT_STUCK_MS
        ? "Google Identity Services did not finish initializing for this page. This is usually an OAuth client origin mismatch, a blocked Google script, or a browser popup/cookie/privacy setting."
        : "Try Deploy again in a moment.",
    steps:
      gisInitStartedAt && Date.now() - gisInitStartedAt >= GIS_INIT_STUCK_MS
        ? [
            "Hard refresh the page once.",
            `In Google Cloud, make sure this OAuth client is a Web application and includes ${currentOrigin || "this site origin"} under Authorized JavaScript origins.`,
            "Allow popups for this site and avoid embedded browser previews that block Google sign-in.",
            "If Sheets sign-in works but Apps Script deploy later fails, then enable Google Apps Script API in the same Google Cloud project.",
          ]
        : [],
    actions: [
      {
        label: "Open OAuth clients in Cloud Console",
        href: "https://console.cloud.google.com/auth/clients",
      },
      {
        label: "Open Apps Script API in Cloud Console",
        href: "https://console.cloud.google.com/apis/library/script.googleapis.com",
      },
    ],
  };
}

function isManagedAppsScriptDeployState(state) {
  return !!(
    state &&
    typeof state === "object" &&
    String(state.managedBy || "") === APPS_SCRIPT_MANAGED_BY &&
    String(state.scriptId || "").trim()
  );
}

function isAppsScriptPublicAccessReady(state) {
  if (!isManagedAppsScriptDeployState(state)) return false;
  const status = String(state.publicAccessState || "").trim();
  if (!status) {
    return !!String(state.webAppUrl || "").trim();
  }
  return status === APPS_SCRIPT_PUBLIC_ACCESS_READY;
}

function getAppsScriptEditorUrl(scriptId) {
  const id = String(scriptId || "").trim();
  if (!id) return "";
  return `https://script.google.com/home/projects/${encodeURIComponent(id)}/edit`;
}

function formatAppsScriptWebAppAccessLabel(raw) {
  switch (String(raw || "").trim()) {
    case "ANYONE_ANONYMOUS":
      return "Anyone";
    case "ANYONE":
      return "Anyone with Google account";
    case "DOMAIN":
      return "Anyone in your Google Workspace domain";
    case "MYSELF":
      return "Only me";
    default:
      return raw ? String(raw).trim() : "unknown";
  }
}

function formatAppsScriptExecuteAsLabel(raw) {
  switch (String(raw || "").trim()) {
    case "USER_DEPLOYING":
      return "Me";
    case "USER_ACCESSING":
      return "User accessing the web app";
    default:
      return raw ? String(raw).trim() : "unknown";
  }
}

function buildAppsScriptPublicAccessRemediationStatus(options) {
  const o = options && typeof options === "object" ? options : {};
  const scriptId = String(o.scriptId || "").trim();
  const webAppUrl = String(o.webAppUrl || "").trim();
  const deploymentAccess = String(o.deploymentAccess || "").trim();
  const deploymentExecuteAs = String(o.deploymentExecuteAs || "").trim();
  const failureKind = String(o.failureKind || "").trim();

  const accessLabel = formatAppsScriptWebAppAccessLabel(deploymentAccess);
  const executeAsLabel = formatAppsScriptExecuteAsLabel(deploymentExecuteAs);

  let detail =
    "JobBored needs anonymous access to this web app before it can use the URL or Cloudflare relay.";

  if (deploymentAccess && deploymentAccess !== APPS_SCRIPT_WEBAPP_ACCESS) {
    detail = `Google has “Who has access” set to ${accessLabel}, not “Anyone.” Change it in Deploy → Manage deployments.`;
  } else if (
    deploymentExecuteAs &&
    deploymentExecuteAs !== APPS_SCRIPT_WEBAPP_EXECUTE_AS
  ) {
    detail = `Google has “Execute as” set to ${executeAsLabel}, not “Me.” Change it in Deploy → Manage deployments.`;
  } else if (failureKind === "probe") {
    detail =
      "Google says the deployment is public, but an anonymous check still failed. Re-save the deployment or run the script once in the editor and approve access.";
  }

  const steps = [
    "Apps Script → Deploy → Manage deployments → edit the web app: Execute as “Me”, Who has access “Anyone”, then Save.",
    "Click Re-check public access below.",
  ];

  const actions = [];
  const editorUrl = getAppsScriptEditorUrl(scriptId);
  if (editorUrl) {
    actions.push({ label: "Open Apps Script project", href: editorUrl });
  }
  if (webAppUrl) {
    actions.push({
      label: "Open web app URL",
      href: webAppUrl,
      primary: true,
    });
  }

  return {
    tone: "error",
    message: "Web app isn’t publicly reachable yet",
    detail,
    steps,
    actions,
  };
}

function openAppsScriptRemediationFlowInSettings() {
  const details = document.getElementById("settingsAppsScriptDetails");
  if (details) details.open = true;
  const statusCard = document.getElementById("settingsAppsScriptStatus");
  if (statusCard && typeof statusCard.scrollIntoView === "function") {
    statusCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function showAppsScriptPublicAccessRemediationFromState() {
  const state = appsScriptDeployStateCache;
  if (!isManagedAppsScriptDeployState(state)) return false;
  if (isAppsScriptPublicAccessReady(state)) return false;

  const status = buildAppsScriptPublicAccessRemediationStatus({
    scriptId: state.scriptId,
    webAppUrl: state.webAppUrl,
    deploymentAccess: state.deploymentAccess || state.access,
    deploymentExecuteAs: state.deploymentExecuteAs || state.executeAs,
    failureKind: state.publicAccessIssue,
  });
  setAppsScriptDeployStatus(status.tone, status.message, status.detail, {
    actions: status.actions,
    steps: status.steps,
  });
  openAppsScriptRemediationFlowInSettings();
  return true;
}

function isLikelyAppsScriptWebAppUrl(raw) {
  const s = raw != null ? String(raw).trim() : "";
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

function isLikelyCloudflareWorkerUrl(raw) {
  const s = raw != null ? String(raw).trim() : "";
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

function inferLocalWebhookPort(raw) {
  const normalized = normalizeDiscoveryLocalWebhookUrl(raw);
  if (!normalized) return "8644";
  try {
    const url = new URL(normalized);
    if (url.port) return url.port;
    return url.protocol === "https:" ? "443" : "80";
  } catch (_) {
    return "8644";
  }
}

function buildDiscoveryTunnelTargetUrl(localWebhookUrl, tunnelPublicUrl) {
  const local = normalizeDiscoveryLocalWebhookUrl(localWebhookUrl);
  const tunnel = normalizeDiscoveryTunnelPublicUrl(tunnelPublicUrl);
  if (!local || !tunnel) return "";
  try {
    const localUrl = new URL(local);
    const tunnelUrl = new URL(tunnel);
    if (/\/webhooks\/[^/]+/i.test(tunnelUrl.pathname)) {
      tunnelUrl.search = "";
      tunnelUrl.hash = "";
      return tunnelUrl.toString();
    }
    tunnelUrl.pathname = localUrl.pathname || "/";
    tunnelUrl.search = "";
    tunnelUrl.hash = "";
    return tunnelUrl.toString();
  } catch (_) {
    return "";
  }
}

function getDiscoveryLocalWebhookHealthUrl(localWebhookUrl) {
  const local = normalizeDiscoveryLocalWebhookUrl(localWebhookUrl);
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

function getCloudflareRelayTargetInfo() {
  const currentWebhookUrl =
    getSettingsFieldValue("settingsDiscoveryWebhookUrl").trim() ||
    getDiscoveryWebhookUrl();
  const transportSetup = getDiscoveryTransportSetupState();
  const localTunnelTargetUrl = buildDiscoveryTunnelTargetUrl(
    transportSetup.localWebhookUrl,
    transportSetup.tunnelPublicUrl,
  );
  const managedWebAppUrl =
    isAppsScriptPublicAccessReady(appsScriptDeployStateCache) &&
    appsScriptDeployStateCache &&
    typeof appsScriptDeployStateCache.webAppUrl === "string"
      ? appsScriptDeployStateCache.webAppUrl.trim()
      : "";

  if (isLikelyAppsScriptWebAppUrl(currentWebhookUrl)) {
    return { url: currentWebhookUrl, source: "settings" };
  }
  if (isLikelyCloudflareWorkerUrl(currentWebhookUrl) && localTunnelTargetUrl) {
    return {
      url: localTunnelTargetUrl,
      source: "local_tunnel",
      localWebhookUrl: transportSetup.localWebhookUrl,
      tunnelPublicUrl: transportSetup.tunnelPublicUrl,
    };
  }
  if (currentWebhookUrl && !isLikelyCloudflareWorkerUrl(currentWebhookUrl)) {
    return { url: currentWebhookUrl, source: "settings" };
  }
  if (localTunnelTargetUrl) {
    return {
      url: localTunnelTargetUrl,
      source: "local_tunnel",
      localWebhookUrl: transportSetup.localWebhookUrl,
      tunnelPublicUrl: transportSetup.tunnelPublicUrl,
    };
  }
  if (isLikelyAppsScriptWebAppUrl(managedWebAppUrl)) {
    return { url: managedWebAppUrl, source: "managed" };
  }
  if (currentWebhookUrl) return { url: currentWebhookUrl, source: "settings" };
  if (managedWebAppUrl) return { url: managedWebAppUrl, source: "managed" };
  return { url: "", source: "" };
}

function buildCloudflareRelayCorsSnippet(origin) {
  const value =
    origin && origin !== "*" ? origin : "https://your-static-site.example";
  return `[vars]\nCORS_ORIGIN = "${value.replace(/"/g, '\\"')}"`;
}

function sanitizeCloudflareWorkerName(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 63).replace(/^-+|-+$/g, "");
}

function inferCloudflareRelaySuffixFromTarget(targetUrl) {
  const url = String(targetUrl || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const scriptIdMatch = parsed.pathname.match(/\/macros\/s\/([^/]+)/i);
    if (scriptIdMatch && scriptIdMatch[1]) {
      return scriptIdMatch[1].slice(-6).toLowerCase();
    }
    return parsed.hostname.replace(/[^a-z0-9]+/gi, "-").slice(0, 10);
  } catch (_) {
    return "";
  }
}

function getSuggestedCloudflareRelayWorkerName(targetUrl) {
  const suffix =
    inferCloudflareRelaySuffixFromTarget(targetUrl) ||
    String(getSettingsSheetIdValue() || "")
      .slice(-6)
      .toLowerCase() ||
    "main";
  return (
    sanitizeCloudflareWorkerName(`jobbored-discovery-relay-${suffix}`) ||
    "jobbored-discovery-relay"
  );
}

/** First label of *.workers.dev hostname, e.g. jobbored-discovery-relay-abc123. */
function inferCloudflareWorkerNameFromOpenWorkerUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (!/\.workers\.dev$/i.test(u.hostname)) return "";
    const first = u.hostname.split(".")[0];
    return sanitizeCloudflareWorkerName(first);
  } catch (_) {
    return "";
  }
}

function quoteShellArg(raw) {
  return `'${String(raw || "").replace(/'/g, `'\"'\"'`)}'`;
}

function buildCloudflareRelayDeployCommand(
  targetUrl,
  origin,
  workerName,
  sheetId,
) {
  const parts = ["npm run cloudflare-relay:deploy --"];
  if (targetUrl) {
    parts.push(`--target-url ${quoteShellArg(targetUrl)}`);
  }
  if (origin && origin !== "*") {
    parts.push(`--cors-origin ${quoteShellArg(origin)}`);
  }
  if (workerName) {
    parts.push(`--worker-name ${quoteShellArg(workerName)}`);
  }
  if (sheetId) {
    parts.push(`--sheet-id ${quoteShellArg(sheetId)}`);
  }
  return parts.join(" ");
}

function getDiscoveryRelaySuggestedOrigin() {
  return typeof window !== "undefined" &&
    window.location &&
    typeof window.location.origin === "string" &&
    /^https?:\/\//i.test(window.location.origin)
    ? window.location.origin.trim()
    : "";
}

function getDiscoveryRelayWorkerName(targetUrl, preferredWorkerUrl = "") {
  const currentWorkerUrl =
    normalizeDiscoveryWebhookIdentity(preferredWorkerUrl) ||
    normalizeDiscoveryWebhookIdentity(
      getSettingsFieldValue("settingsDiscoveryWebhookUrl").trim(),
    ) ||
    normalizeDiscoveryWebhookIdentity(getDiscoveryWebhookUrl());
  const explicitWorker =
    inferCloudflareWorkerNameFromOpenWorkerUrl(currentWorkerUrl);
  return explicitWorker || getSuggestedCloudflareRelayWorkerName(targetUrl);
}

function buildDiscoveryRelayDeployCommandForTarget(targetUrl, options = {}) {
  const normalizedTargetUrl = normalizeDiscoveryWebhookIdentity(targetUrl);
  if (!normalizedTargetUrl) return "";
  const explicitWorkerName = sanitizeCloudflareWorkerName(options.workerName);
  const workerName =
    explicitWorkerName ||
    getDiscoveryRelayWorkerName(
      normalizedTargetUrl,
      String(options.workerUrl || ""),
    );
  return buildCloudflareRelayDeployCommand(
    normalizedTargetUrl,
    String(options.origin || "").trim() || getDiscoveryRelaySuggestedOrigin(),
    workerName,
    String(options.sheetId || "").trim() || (getSettingsSheetIdValue() || ""),
  );
}

function createDiscoveryRelayCopyCommandToastAction(command) {
  const text = String(command || "").trim();
  if (!text) return null;
  return {
    label: "Copy command",
    onClick() {
      copyTextToClipboard(text);
    },
  };
}

function buildCloudflareRelayAgentPrompt(
  targetUrl,
  origin,
  workerName,
  sheetId,
) {
  if (!targetUrl) {
    return `We’re in the Job-Bored repo.\n\nStop: no Apps Script /exec URL is configured yet, so there is no downstream TARGET_URL for the Cloudflare relay.\n\nAsk the user to finish Apps Script deploy first, then rerun relay setup.`;
  }
  const deployCommand = buildCloudflareRelayDeployCommand(
    targetUrl,
    origin,
    workerName,
    sheetId,
  );
  const verifyLine = sheetId
    ? "5. Because the command includes `--sheet-id`, the helper should also run the webhook verification step automatically after deploy."
    : "5. After it succeeds, tell me to paste the Worker URL into Settings -> Discovery webhook URL and run Test webhook.";
  return `We’re in the Job-Bored repo. Set up the Cloudflare Worker relay for Command Center discovery.\n\nCurrent values:\n- TARGET_URL: ${targetUrl}\n- CORS_ORIGIN: ${origin || "*"}\n- Suggested worker name: ${workerName}\n\nDo this:\n1. Run this command from the repo root:\n   ${deployCommand}\n2. If Cloudflare auth is missing, let the helper script open \`wrangler login\` automatically. If that still cannot work, then tell me exactly whether you need \`npx wrangler login\` manually or \`CLOUDFLARE_API_TOKEN\` + \`CLOUDFLARE_ACCOUNT_ID\`.\n3. Return the deployed \`workers.dev\` URL only.\n4. Do not use \`/forward\` or \`FORWARD_SECRET\` for this dashboard path, and keep Cloudflare Access disabled on the open \`workers.dev\` URL.\n${verifyLine}\n\nIf the script stops at a one-time \`workers.dev\` subdomain prompt, tell me which path applies:\n- browser-login path: I should answer the prompt once in the terminal\n- API-token path: rerun with \`CLOUDFLARE_API_TOKEN\`; the helper can then reuse or create the account subdomain automatically.`;
}

function describeCloudflareAccessProtectedWebhook(status, text, responseUrl) {
  const body = String(text || "");
  const url = String(responseUrl || "");
  const combined = `${url}\n${body}`;
  if (
    !/cloudflare access|cloudflareaccess\.com|cdn-cgi\/access\/login|access\.cloudflare/i.test(
      combined,
    )
  ) {
    return "";
  }
  if (
    Number(status) !== 200 &&
    Number(status) !== 302 &&
    Number(status) !== 401 &&
    Number(status) !== 403
  ) {
    return "";
  }
  return "This Worker URL is protected by Cloudflare Access. Disable Cloudflare Access for the open workers.dev URL, then test again.";
}

function describeAppsScriptHtmlAccessIssue(status, text) {
  const body = String(text || "");
  if (Number(status) !== 403) return "";
  if (
    !/you need access/i.test(body) &&
    !/open the document directly/i.test(body) &&
    !/script\.google\.com\/macros\/edit\?lib=/i.test(body)
  ) {
    return "";
  }
  return 'Google is rejecting anonymous access to the Apps Script web app. Open the Apps Script deployment and confirm Execute as is "Me" and Who has access is "Anyone", then re-check public access.';
}

function isAppsScriptWebhookStubResponse(data) {
  return !!(
    data &&
    typeof data === "object" &&
    data.ok === true &&
    (data.service === "command-center-apps-script-stub" ||
      data.mode === "stub" ||
      (data.received === true &&
        data.realDiscoveryConfigured === false &&
        Object.prototype.hasOwnProperty.call(data, "appendedTestRow")))
  );
}

function isAsyncDiscoveryAcceptedResponse(data, status) {
  const httpStatus = Number(status);
  if (!data || typeof data !== "object") return false;
  if (data.ok === true) return false;
  if (httpStatus !== 202 && httpStatus !== 200) return false;
  return !!(
    String(data.status || "").toLowerCase() === "accepted" ||
    data.accepted === true ||
    String(data.event || "").toLowerCase() === "command-center.discovery" ||
    Object.prototype.hasOwnProperty.call(data, "delivery_id")
  );
}

function buildDiscoverySuccessToast(data, options) {
  const o = options && typeof options === "object" ? options : {};
  const isTest = !!o.isTest;
  const acceptedAsync = isAsyncDiscoveryAcceptedResponse(data, o.status);
  if (isAppsScriptWebhookStubResponse(data)) {
    if (data.appendedTestRow === true) {
      return {
        type: "info",
        persistent: true,
        message: isTest
          ? "Stub OK — appended a [CC test] row. This confirms webhook wiring only; it does not find real jobs."
          : "Stub received the request and appended a [CC test] row. This confirms webhook wiring only; no real job discovery is configured yet.",
      };
    }
    return {
      type: "info",
      persistent: true,
      message: isTest
        ? "Stub OK — endpoint is wired, but it will not add jobs. Set ENABLE_TEST_ROW=true for a smoke test, or replace the stub with real discovery logic."
        : "The current endpoint is the Apps Script stub. It accepted the request, but it does not add real job leads. Set ENABLE_TEST_ROW=true for a smoke test, or replace the stub with real discovery logic.",
    };
  }
  if (acceptedAsync) {
    return {
      type: "success",
      persistent: false,
      message: isTest
        ? "Webhook accepted — your automation queued the run"
        : "Discovery accepted — your automation queued the run",
    };
  }
  return {
    type: "success",
    persistent: false,
    message: isTest
      ? "Webhook OK — endpoint returned ok: true"
      : "Discovery started — new roles will appear in your sheet when your agent finishes",
  };
}

function getDiscoveryWizardRoot() {
  return window.JobBoredDiscoveryWizard || null;
}

function getDiscoveryWizardShellApi() {
  const root = getDiscoveryWizardRoot();
  return root && root.shell ? root.shell : null;
}

function getDiscoveryWizardProbesApi() {
  const root = getDiscoveryWizardRoot();
  return root && root.probes ? root.probes : null;
}

function getDiscoveryWizardLocalApi() {
  const root = getDiscoveryWizardRoot();
  const backup =
    typeof window !== "undefined" ? window.__JobBoredDiscoveryLocalApi : null;
  if (backup && typeof backup.runLocalWizardAction === "function") {
    if (root) {
      root.local = backup;
    }
    return backup;
  }
  if (
    root &&
    root.local &&
    typeof root.local.runLocalWizardAction === "function"
  ) {
    return root.local;
  }
  return null;
}

function getDiscoveryWizardRelayApi() {
  const root = getDiscoveryWizardRoot();
  return root && root.relay ? root.relay : null;
}

function getDiscoveryWizardVerifyApi() {
  const root = getDiscoveryWizardRoot();
  return root && root.verify ? root.verify : null;
}

function mapDiscoveryWizardFlow(rawFlow) {
  const flow = String(rawFlow || "").trim();
  if (flow === "existing_endpoint" || flow === "external_endpoint") {
    return "external_endpoint";
  }
  if (flow === "no_webhook") return "no_webhook";
  if (flow === "stub_only") return "stub_only";
  return "local_agent";
}

function getFallbackAppsScriptState() {
  if (!appsScriptDeployStateCache) return "none";
  if (
    isManagedAppsScriptDeployState(appsScriptDeployStateCache) &&
    isAppsScriptPublicAccessReady(appsScriptDeployStateCache)
  ) {
    return "stub_only";
  }
  return isManagedAppsScriptDeployState(appsScriptDeployStateCache)
    ? "unverified"
    : "none";
}

function classifySavedWebhookKindForFallback(rawUrl) {
  const probes = getDiscoveryWizardProbesApi();
  if (probes && typeof probes.classifySavedWebhookKind === "function") {
    return probes.classifySavedWebhookKind(rawUrl);
  }
  const url = normalizeDiscoveryWebhookIdentity(rawUrl);
  if (!url) return "none";
  if (
    normalizeDiscoveryLocalWebhookUrl(url) &&
    /^https?:\/\//i.test(normalizeDiscoveryLocalWebhookUrl(url))
  ) {
    return "local_http";
  }
  if (isLikelyAppsScriptWebAppUrl(url)) return "apps_script_stub";
  if (isLikelyCloudflareWorkerUrl(url)) return "worker";
  return /^https?:\/\//i.test(url) ? "generic_https" : "none";
}

function getDiscoveryLocalEngineKind(snapshot) {
  const state = snapshot && typeof snapshot === "object" ? snapshot : {};
  const explicit = String(state.localEngineKind || "")
    .trim()
    .toLowerCase();
  if (explicit === "browser_use_worker") return "browser_use_worker";
  if (explicit === "hermes") return "hermes";
  if (explicit === "other") return "other";

  const localWebhookUrl = normalizeDiscoveryLocalWebhookUrl(
    state.localWebhookUrl || "",
  );
  if (/\/webhook\/?$/i.test(localWebhookUrl)) return "browser_use_worker";
  if (/\/webhooks\/[^/]+/i.test(localWebhookUrl)) return "hermes";
  return localWebhookUrl ? "other" : "none";
}

function getDiscoveryLocalEngineLabel(snapshot) {
  const kind = getDiscoveryLocalEngineKind(snapshot);
  if (kind === "browser_use_worker") return "Browser-use worker";
  if (kind === "hermes") return "Hermes route";
  if (kind === "other") return "Local discovery service";
  return "";
}

function getDiscoveryLocalEngineSummary(snapshot) {
  const state = snapshot && typeof snapshot === "object" ? snapshot : {};
  const label = getDiscoveryLocalEngineLabel(state);
  if (!label) return "not confirmed";
  if (state.localWebhookUrl) return `${label} (${state.localWebhookUrl})`;
  return label;
}

function buildFallbackSettingsDiscoveryView(snapshot) {
  const status = getEffectiveDiscoveryEngineStatus(snapshot.savedWebhookUrl);
  const kind = String(snapshot.savedWebhookKind || "none");
  const appsScriptState = String(snapshot.appsScriptState || "none");
  const recovery = snapshot.localRecoveryState || "ok";
  const hasSavedExternalEndpoint =
    kind === "worker" || kind === "generic_https";
  const stubCurrent =
    status.state === DISCOVERY_ENGINE_STATE_STUB_ONLY ||
    kind === "apps_script_stub";

  if (
    recovery !== "ok" &&
    (status.state === DISCOVERY_ENGINE_STATE_CONNECTED ||
      hasSavedExternalEndpoint)
  ) {
    return {
      tone: "warning",
      title: "Local setup needs recovery",
      detail:
        "The local worker or tunnel is down. Click Fix setup to restore it.",
      chipLabel: "Needs recovery",
      chipTone: "warning",
      runDiscoveryEnabled: false,
      primaryActionLabel: "Fix setup",
      primaryActionHint:
        "One click restores the local worker, tunnel, and relay.",
    };
  }

  if (
    status.state === DISCOVERY_ENGINE_STATE_CONNECTED ||
    status.state === DISCOVERY_ENGINE_STATE_UNVERIFIED ||
    hasSavedExternalEndpoint
  ) {
    const verified = status.state === DISCOVERY_ENGINE_STATE_CONNECTED;
    return {
      tone: verified ? "success" : "warning",
      title: verified ? "Discovery is connected" : "Discovery endpoint saved",
      detail: verified
        ? "Run discovery will POST to the public endpoint already saved in JobBored."
        : "A public webhook is already saved. Test it if you changed the service.",
      chipLabel: verified ? "Connected" : "Ready to test",
      chipTone: verified ? "success" : "warning",
      runDiscoveryEnabled: true,
      primaryActionLabel: "Open discovery setup",
      primaryActionHint:
        "Use the wizard to review or change your discovery path.",
    };
  }

  if (kind === "local_http") {
    const engineLabel = getDiscoveryLocalEngineLabel(snapshot);
    return {
      tone: "info",
      title: engineLabel
        ? `${engineLabel} detected`
        : "Local receiver detected",
      detail: engineLabel
        ? `Complete the local server, tunnel, and relay steps to finish setup for ${engineLabel}.`
        : "Complete the server, tunnel, and relay steps to finish setup.",
      chipLabel: "Local path",
      chipTone: "info",
      runDiscoveryEnabled: false,
      primaryActionLabel: "Open discovery setup",
      primaryActionHint: "Continue the local setup path.",
    };
  }

  if (stubCurrent || appsScriptState === "stub_only") {
    return {
      tone: "warning",
      title: "Apps Script stub wired",
      detail:
        "This path can smoke-test webhook wiring, but it is not your real discovery engine.",
      chipLabel: "Stub only",
      chipTone: "warning",
      runDiscoveryEnabled: false,
      primaryActionLabel: "Open discovery setup",
      primaryActionHint: "Switch to a real webhook if you want Run discovery.",
    };
  }

  return {
    tone: "info",
    title: "No discovery webhook configured",
    detail:
      "Pipeline works without discovery. Use the wizard only if you want automated runs.",
    chipLabel: "No webhook",
    chipTone: "info",
    runDiscoveryEnabled: false,
    primaryActionLabel: "Open discovery setup",
    primaryActionHint:
      "Use the wizard to review or change your discovery path.",
  };
}

function buildFallbackEmptyStateDiscoveryView(snapshot) {
  const status = getEffectiveDiscoveryEngineStatus(snapshot.savedWebhookUrl);
  const kind = String(snapshot.savedWebhookKind || "none");
  const appsScriptState = String(snapshot.appsScriptState || "none");
  const recovery = snapshot.localRecoveryState || "ok";
  const hasSavedExternalEndpoint =
    kind === "worker" || kind === "generic_https";
  const stubCurrent =
    status.state === DISCOVERY_ENGINE_STATE_STUB_ONLY ||
    kind === "apps_script_stub";

  if (
    recovery !== "ok" &&
    (status.state === DISCOVERY_ENGINE_STATE_CONNECTED ||
      hasSavedExternalEndpoint)
  ) {
    return {
      title: "Local setup needs recovery",
      body: "The local discovery chain is down. Click Fix setup to restore it.",
      ctaLabel: "Fix setup",
      ctaAction: "open_setup",
    };
  }

  if (status.state === DISCOVERY_ENGINE_STATE_CONNECTED) {
    return {
      title: "Pipeline is ready",
      body: "No roles yet. When your automation runs, new rows will appear here. You can also run discovery on demand.",
      ctaLabel: "Run discovery now",
      ctaAction: "run_discovery",
    };
  }
  if (
    status.state === DISCOVERY_ENGINE_STATE_UNVERIFIED ||
    hasSavedExternalEndpoint
  ) {
    return {
      title: "Endpoint saved, verification pending",
      body: "A public webhook is already saved, but JobBored has not confirmed the full end-to-end path yet.",
      ctaLabel: "Open discovery setup",
      ctaAction: "open_setup",
    };
  }
  if (kind === "local_http") {
    const engineLabel = getDiscoveryLocalEngineLabel(snapshot);
    return {
      title: engineLabel
        ? `${engineLabel} not finished`
        : "Local discovery path not finished",
      body: engineLabel
        ? `${engineLabel} is known, but the public tunnel or Worker URL still needs to be finished.`
        : "Your local receiver is known, but the public tunnel or Worker URL still needs to be finished.",
      ctaLabel: "Continue setup",
      ctaAction: "open_setup",
    };
  }
  if (stubCurrent || appsScriptState === "stub_only") {
    return {
      title: "Stub-only wiring detected",
      body: "The current webhook confirms wiring only. Connect a real discovery engine before expecting new job leads.",
      ctaLabel: "Connect real discovery",
      ctaAction: "open_setup",
    };
  }
  return {
    title: "Pipeline is empty",
    body: "Pipeline works without discovery, but you can use the wizard if you want Run discovery or guided setup.",
    ctaLabel: "Open discovery setup",
    ctaAction: "open_setup",
  };
}

function buildFallbackReadinessSnapshot() {
  const transport = getDiscoveryTransportSetupState();
  const savedWebhookUrl = normalizeDiscoveryWebhookIdentity(
    getDiscoveryWebhookUrl(),
  );
  const savedWebhookKind = classifySavedWebhookKindForFallback(savedWebhookUrl);
  const relayTargetUrl = buildDiscoveryTunnelTargetUrl(
    transport.localWebhookUrl,
    transport.tunnelPublicUrl,
  );
  const engineStatus = getEffectiveDiscoveryEngineStatus(savedWebhookUrl);
  const appsScriptState = getFallbackAppsScriptState();
  const hasSavedExternalEndpoint =
    savedWebhookKind === "worker" || savedWebhookKind === "generic_https";
  const hasSavedStubEndpoint = savedWebhookKind === "apps_script_stub";
  const hasLocalPathSignals =
    savedWebhookKind === "local_http" ||
    !!transport.localWebhookUrl ||
    !!transport.tunnelPublicUrl;
  let recommendedFlow = "local_agent";
  let recommendedReason =
    "No public webhook is saved yet, so start with the path you want to use.";
  if (
    hasSavedExternalEndpoint ||
    engineStatus.state === DISCOVERY_ENGINE_STATE_CONNECTED
  ) {
    recommendedFlow = "existing_endpoint";
    recommendedReason =
      savedWebhookKind === "worker"
        ? "A Cloudflare Worker URL is already saved."
        : "A public HTTPS webhook is already saved.";
  } else if (hasLocalPathSignals) {
    recommendedFlow = "local_agent";
    recommendedReason =
      getDiscoveryLocalEngineKind({
        localWebhookUrl: transport.localWebhookUrl || "",
      }) === "hermes"
        ? "A local Hermes route was detected on this machine. It can work, but the browser-use worker is the recommended default."
        : "A local browser-use worker or local discovery path was detected on this machine.";
  } else if (hasSavedStubEndpoint) {
    recommendedFlow = "stub_only";
    recommendedReason =
      "Only the Apps Script stub is saved — good for testing.";
  } else if (appsScriptState === "stub_only") {
    recommendedFlow = "local_agent";
    recommendedReason =
      "An Apps Script stub exists, but it's not your main discovery path.";
  }
  const snapshot = {
    sheetConfigured: !!SHEET_ID,
    savedWebhookUrl,
    savedWebhookKind,
    localBootstrapAvailable: false,
    localWebhookUrl: transport.localWebhookUrl || "",
    localWebhookReady: false,
    tunnelPublicUrl: transport.tunnelPublicUrl || "",
    tunnelLive: false,
    tunnelReady: false,
    tunnelStale: false,
    relayTargetUrl,
    relayReady: savedWebhookKind === "worker",
    engineState: engineStatus.state,
    appsScriptState,
    recommendedFlow,
    recommendedReason,
    blockingIssue: !SHEET_ID
      ? "missing_sheet"
      : hasSavedStubEndpoint
        ? "stub_only"
        : "",
    localRecoveryState:
      hasLocalPathSignals || savedWebhookKind === "worker"
        ? "needs_full_restart"
        : "ok",
  };
  return {
    ...snapshot,
    views: {
      settings: buildFallbackSettingsDiscoveryView(snapshot),
      emptyState: buildFallbackEmptyStateDiscoveryView(snapshot),
    },
    wizardState: null,
  };
}

function getDiscoveryReadinessSnapshot() {
  return discoveryReadinessSnapshotCache || buildFallbackReadinessSnapshot();
}

function getDiscoverySettingsView(snapshot) {
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  if (
    state.views &&
    state.views.settings &&
    typeof state.views.settings === "object"
  ) {
    return state.views.settings;
  }
  const probes = getDiscoveryWizardProbesApi();
  if (probes && typeof probes.buildSettingsDiscoveryView === "function") {
    return probes.buildSettingsDiscoveryView(state);
  }
  return buildFallbackSettingsDiscoveryView(state);
}

function getDiscoveryEmptyStateView(snapshot) {
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  if (
    state.views &&
    state.views.emptyState &&
    typeof state.views.emptyState === "object"
  ) {
    return state.views.emptyState;
  }
  const probes = getDiscoveryWizardProbesApi();
  if (probes && typeof probes.buildEmptyStateDiscoveryView === "function") {
    return probes.buildEmptyStateDiscoveryView(state);
  }
  return buildFallbackEmptyStateDiscoveryView(state);
}

async function refreshDiscoveryReadinessSnapshot(options = {}) {
  if (discoveryReadinessSnapshotPromise && !options.force) {
    return discoveryReadinessSnapshotPromise;
  }
  const buildFallback = () => buildFallbackReadinessSnapshot();
  const probes = getDiscoveryWizardProbesApi();
  discoveryReadinessSnapshotPromise = Promise.resolve()
    .then(async () => {
      if (probes && typeof probes.buildReadinessSnapshot === "function") {
        return probes.buildReadinessSnapshot();
      }
      return buildFallback();
    })
    .then((snapshot) => {
      discoveryReadinessSnapshotCache =
        snapshot && typeof snapshot === "object" ? snapshot : buildFallback();
      return discoveryReadinessSnapshotCache;
    })
    .catch((err) => {
      console.warn("[JobBored] discovery readiness snapshot:", err);
      discoveryReadinessSnapshotCache = buildFallback();
      return discoveryReadinessSnapshotCache;
    })
    .finally(() => {
      discoveryReadinessSnapshotPromise = null;
    });
  const next = await discoveryReadinessSnapshotPromise;
  if (options.rerender !== false) {
    refreshDiscoveryUiState();
  }
  return next;
}

async function buildDiscoveryWebhookPayload(sheetIdOverride) {
  const resolvedSheetId =
    parseGoogleSheetId(String(sheetIdOverride || "")) || SHEET_ID || "";
  let discoveryProfile = {};
  try {
    const UC = window.CommandCenterUserContent;
    if (UC && typeof UC.getDiscoveryProfile === "function") {
      discoveryProfile = await UC.getDiscoveryProfile();
    }
  } catch (e) {
    console.warn("[JobBored] discovery profile:", e);
  }
  return {
    event: "command-center.discovery",
    schemaVersion: 1,
    sheetId: resolvedSheetId,
    variationKey: generateDiscoveryVariationKey(),
    requestedAt: new Date().toISOString(),
    discoveryProfile,
  };
}

function getDiscoveryEngineStateFromVerificationResult(result) {
  if (!result || result.ok !== true) return "";
  if (result.kind === "stub_only") return DISCOVERY_ENGINE_STATE_STUB_ONLY;
  if (result.kind === "accepted_async")
    return DISCOVERY_ENGINE_STATE_UNVERIFIED;
  if (result.kind === "connected_ok") return DISCOVERY_ENGINE_STATE_CONNECTED;
  return result.engineState || DISCOVERY_ENGINE_STATE_UNVERIFIED;
}

function showDiscoveryVerificationToast(result, options = {}) {
  if (!result || typeof result !== "object") return;
  const context = String(options.context || "test_webhook").trim();
  const isRun = context === "run_discovery";
  let type = "info";
  let persistent = false;
  if (result.ok) {
    if (result.kind === "stub_only") {
      type = "info";
      persistent = true;
    } else {
      type = "success";
    }
  } else {
    type = "error";
    persistent = true;
  }
  const detail =
    !result.ok && result.detail && result.detail !== result.message
      ? ` ${result.detail}`
      : "";
  const fallback = isRun
    ? "Discovery verification finished."
    : "Webhook verification finished.";

  let action;
  if (!result.ok && isLocalDashboardOrigin()) {
    const hasLocalTunnel = !!getDiscoveryTransportSetupState().tunnelPublicUrl;
    const endpointUrl = options.endpointUrl || "";
    const isTunnelFailure =
      result.layer === "downstream" ||
      (result.kind === "network_error" &&
        isLikelyCloudflareWorkerUrl(endpointUrl)) ||
      (result.kind === "network_error" && hasLocalTunnel) ||
      (/ngrok|tunnel|offline/i.test(result.detail || "") && hasLocalTunnel);
    if (isTunnelFailure) {
      action = {
        label: "Fix tunnel",
        onClick: () => {
          void openDiscoverySetupWizard({
            entryPoint: "settings",
            flow: "local_agent",
            startStep: "tunnel",
          });
        },
      };
    }
  }

  showToast(
    `${result.message || fallback}${detail}`.trim(),
    type,
    persistent,
    action,
  );
}

async function verifyDiscoveryWebhookWithSharedModel(
  url,
  payload,
  options = {},
) {
  const verifyApi = getDiscoveryWizardVerifyApi();
  if (verifyApi && typeof verifyApi.verifyDiscoveryEndpoint === "function") {
    return verifyApi.verifyDiscoveryEndpoint(url, {
      payload,
      context: options.context || "test_webhook",
      sheetId: options.sheetId || "",
      timeoutMs: options.timeoutMs || 15000,
    });
  }
  return {
    ok: false,
    kind: "invalid_endpoint",
    engineState: "none",
    httpStatus: 0,
    message: "Discovery verifier is not available.",
    detail: "Reload the page and try again.",
    layer: "browser",
  };
}

function getDiscoveryWizardDefaultDrafts(snapshot) {
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  return {
    endpointUrl: state.savedWebhookUrl || getDiscoveryWebhookUrl() || "",
    workerUrl: isLikelyCloudflareWorkerUrl(state.savedWebhookUrl)
      ? state.savedWebhookUrl
      : "",
  };
}

function createDiscoveryWizardRuntime(patch = {}) {
  const next = {
    entryPoint: "manual",
    snapshot: getDiscoveryReadinessSnapshot(),
    state: {
      version: 1,
      flow: "local_agent",
      currentStep: "detect",
      completedSteps: [],
      transportMode: "",
      lastProbeAt: "",
      lastVerifiedAt: "",
      result: "none",
      dismissedStubWarning: false,
    },
    activeStepId: "detect",
    drafts: getDiscoveryWizardDefaultDrafts(getDiscoveryReadinessSnapshot()),
    lastLocalResult: null,
    lastRelayResult: null,
    lastRelayModel: null,
    lastVerificationResult: null,
    lastDownstreamDiagnosis: null,
    lastWizardMessage: "",
    lastWizardMessageTone: "info",
    localBootstrapState: null,
    flowProgressCache: {},
    ...patch,
  };
  next.state = {
    ...(next.state || {}),
    flow: mapDiscoveryWizardFlow(next.state && next.state.flow),
  };
  next.activeStepId = next.activeStepId || next.state.currentStep || "detect";
  next.drafts = {
    ...getDiscoveryWizardDefaultDrafts(next.snapshot),
    ...(patch.drafts && typeof patch.drafts === "object" ? patch.drafts : {}),
  };
  return next;
}

function getDiscoveryWizardRuntime() {
  if (!discoveryWizardRuntime) {
    discoveryWizardRuntime = createDiscoveryWizardRuntime();
  }
  return discoveryWizardRuntime;
}

function updateDiscoveryWizardRuntime(patch = {}) {
  const current = getDiscoveryWizardRuntime();
  discoveryWizardRuntime = createDiscoveryWizardRuntime({
    ...current,
    ...patch,
    state: {
      ...(current.state || {}),
      ...(patch.state && typeof patch.state === "object" ? patch.state : {}),
    },
    drafts: {
      ...(current.drafts || {}),
      ...(patch.drafts && typeof patch.drafts === "object" ? patch.drafts : {}),
    },
    flowProgressCache: {
      ...(current.flowProgressCache || {}),
      ...(patch.flowProgressCache && typeof patch.flowProgressCache === "object"
        ? patch.flowProgressCache
        : {}),
    },
  });
  return discoveryWizardRuntime;
}

function createWizardNode(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function appendWizardParagraph(
  parent,
  text,
  className = "discovery-setup-wizard__copy",
) {
  if (!text) return null;
  const p = createWizardNode("p", className, text);
  parent.appendChild(p);
  return p;
}

function appendWizardList(parent, items) {
  const list = createWizardNode("ul", "discovery-setup-wizard__list");
  items.filter(Boolean).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });
  parent.appendChild(list);
  return list;
}

function appendWizardCodeBlock(parent, text, copyLabel = "Copy") {
  if (!text) return null;
  const row = createWizardNode("div", "scraper-setup-copyrow");
  const code = createWizardNode("pre", "scraper-setup-code", text);
  const button = createWizardNode("button", "btn-copy-scraper", copyLabel);
  button.type = "button";
  button.addEventListener("click", () => {
    copyTextToClipboard(text);
  });
  row.append(code, button);
  parent.appendChild(row);
  return row;
}

function appendWizardCallout(parent, text) {
  if (!text) return null;
  const card = createWizardNode("div", "discovery-setup-wizard__callout");
  appendWizardParagraph(card, text, "discovery-setup-wizard__callout-text");
  parent.appendChild(card);
  return card;
}

function appendWizardInput(parent, options) {
  const o = options && typeof options === "object" ? options : {};
  const wrap = createWizardNode("div", "discovery-wizard-field");
  const label = createWizardNode("label", "field-label", o.label || "");
  label.htmlFor = o.id;
  const input =
    o.multiline === true
      ? createWizardNode("textarea", "modal-input modal-textarea")
      : createWizardNode("input", "modal-input");
  input.id = o.id;
  if (o.multiline !== true) {
    input.type = o.type || "text";
  } else if (Number.isFinite(o.rows)) {
    input.rows = o.rows;
  } else {
    input.rows = 3;
  }
  input.placeholder = o.placeholder || "";
  input.value = o.value || "";
  input.addEventListener("input", (event) => {
    if (typeof o.onInput === "function") {
      o.onInput(String(event.target.value || ""));
    }
  });
  wrap.append(label, input);
  if (o.hint) {
    appendWizardParagraph(
      wrap,
      o.hint,
      "settings-field-hint settings-field-hint--compact",
    );
  }
  parent.appendChild(wrap);
  return input;
}

function appendWizardResultCard(parent, result, titleOverride) {
  if (!result || typeof result !== "object") return null;
  const tone =
    result.ok === true
      ? result.kind === "stub_only"
        ? "warning"
        : "success"
      : "warning";
  const card = createWizardNode(
    "div",
    `discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--${tone}`,
  );
  appendWizardParagraph(
    card,
    titleOverride || result.message || "Latest result",
    "discovery-setup-wizard__card-title",
  );
  if (result.detail) {
    appendWizardParagraph(card, result.detail, "discovery-setup-wizard__copy");
  }
  if (result.remediation) {
    const lines = result.remediation.split("\n").filter((l) => l.trim());
    if (lines.length > 1) {
      const intro = lines[0];
      const steps = lines.slice(1);
      appendWizardParagraph(
        card,
        intro,
        "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
      );
      const ol = createWizardNode(
        "ol",
        "discovery-setup-wizard__list discovery-setup-wizard__list--ordered",
      );
      steps.forEach((step) => {
        const li = document.createElement("li");
        li.textContent = step.replace(/^\d+\.\s*/, "");
        ol.appendChild(li);
      });
      card.appendChild(ol);
    } else {
      appendWizardParagraph(
        card,
        `Next step: ${result.remediation}`,
        "discovery-setup-wizard__copy",
      );
    }
  }
  if (result.suggestedUrl) {
    appendWizardCodeBlock(card, result.suggestedUrl, "Copy URL");
  }
  if (result.suggestedCommand) {
    appendWizardCodeBlock(card, result.suggestedCommand, "Copy command");
  }
  parent.appendChild(card);
  return card;
}

function buildDiscoveryWizardMessageCard(runtime) {
  if (!runtime.lastWizardMessage) return null;
  return {
    type: "card",
    title: runtime.lastWizardMessage,
    body:
      runtime.lastWizardMessageTone === "warning"
        ? "Fix the issue above, then continue."
        : "Settings updated.",
  };
}

function normalizeDiscoveryWizardAssistMode(raw, fallback = "") {
  const value = raw == null ? "" : String(raw).trim().toLowerCase();
  if (value === "agent" || value === "manual") return value;
  return fallback;
}

function getDiscoveryWizardAssistMode(stepId, fallback = "manual") {
  const runtime = getDiscoveryWizardRuntime();
  const assistModes =
    runtime &&
    runtime.drafts &&
    runtime.drafts.assistModes &&
    typeof runtime.drafts.assistModes === "object"
      ? runtime.drafts.assistModes
      : {};
  return normalizeDiscoveryWizardAssistMode(assistModes[stepId], fallback);
}

function setDiscoveryWizardAssistMode(stepId, mode) {
  const runtime = getDiscoveryWizardRuntime();
  const currentAssistModes =
    runtime &&
    runtime.drafts &&
    runtime.drafts.assistModes &&
    typeof runtime.drafts.assistModes === "object"
      ? runtime.drafts.assistModes
      : {};
  updateDiscoveryWizardRuntime({
    drafts: {
      assistModes: {
        ...currentAssistModes,
        [stepId]: normalizeDiscoveryWizardAssistMode(mode, "manual"),
      },
    },
  });
}

function appendWizardAssistChooser(parent, options) {
  const o = options && typeof options === "object" ? options : {};
  const stepId = o.stepId || "";
  const choices = Array.isArray(o.choices) ? o.choices.filter(Boolean) : [];
  if (!stepId || !choices.length) return null;
  const activeMode = getDiscoveryWizardAssistMode(stepId, o.defaultMode || "");
  const activeChoice =
    choices.find((choice) => choice.id === activeMode) ||
    choices.find((choice) => choice.id === o.defaultMode) ||
    choices[0];
  const card = createWizardNode(
    "div",
    "discovery-setup-wizard__summary-card discovery-setup-wizard__assist-card",
  );
  appendWizardParagraph(
    card,
    o.title || "Choose how you want to do this.",
    "discovery-setup-wizard__card-title",
  );
  if (o.intro) {
    appendWizardParagraph(card, o.intro, "discovery-setup-wizard__copy");
  }
  const actions = createWizardNode(
    "div",
    "discovery-setup-wizard__assist-actions",
  );
  choices.forEach((choice) => {
    const isActive = choice.id === activeChoice.id;
    const button = createWizardNode(
      "button",
      `discovery-setup-wizard__btn discovery-setup-wizard__btn--${
        isActive ? "secondary" : "ghost"
      }`,
      choice.label || choice.id,
    );
    button.type = "button";
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.addEventListener("click", () => {
      setDiscoveryWizardAssistMode(stepId, choice.id);
      void renderDiscoverySetupWizard();
    });
    actions.appendChild(button);
  });
  card.appendChild(actions);
  if (activeChoice.summary) {
    appendWizardParagraph(
      card,
      activeChoice.summary,
      "discovery-setup-wizard__assist-note",
    );
  }
  if (typeof activeChoice.render === "function") {
    const content = createWizardNode(
      "div",
      "discovery-setup-wizard__assist-content",
    );
    activeChoice.render(content);
    card.appendChild(content);
  }
  parent.appendChild(card);
  return card;
}

function buildDiscoveryBootstrapAgentPrompt(snapshot) {
  const port = inferLocalWebhookPort(snapshot.localWebhookUrl || "");
  return [
    "We are in the Job-Bored repo. Prepare the local discovery bootstrap for the wizard.",
    "",
    `Expected local port: ${port}`,
    "",
    "Do this:",
    "1. Run `npm run discovery:bootstrap-local` from the repo root.",
    "2. Prefer the browser-use discovery worker as the local engine. Only use Hermes/OpenClaw if the user intentionally wants the advanced path.",
    "3. If bootstrap needs an ngrok token, local worker start command, or any login step, stop and tell me exactly what is missing.",
    "4. Return the local webhook URL, health URL, ngrok URL, and public target URL you found.",
    "5. Do not edit `app.js` or `index.html`.",
  ].join("\n");
}

function buildDiscoveryLocalHealthAgentPrompt(snapshot) {
  const engineKind = getDiscoveryLocalEngineKind(snapshot);
  return [
    "We are in the Job-Bored repo. Fix the local discovery receiver so the wizard health check can pass.",
    "",
    `Current local webhook: ${snapshot.localWebhookUrl || "not detected yet"}`,
    "",
    "Do this:",
    engineKind === "hermes"
      ? "1. The current local path points at Hermes/OpenClaw. If that is intentional, run `hermes gateway run --replace`. Otherwise switch to the browser-use worker with `npm run discovery:worker:start-local`."
      : "1. Start the recommended local browser-use worker with `npm run discovery:worker:start-local`.",
    "2. Confirm the local `/health` endpoint responds successfully.",
    "3. If the local server still does not become healthy, tell me exactly which service, credential, or dependency is missing.",
    "4. Do not edit `app.js` or `index.html`.",
  ].join("\n");
}

function buildDiscoveryTunnelAgentPrompt(snapshot) {
  const port = inferLocalWebhookPort(snapshot.localWebhookUrl || "");
  return [
    "We are in the Job-Bored repo. Get the ngrok tunnel ready for the local discovery path.",
    "",
    `Expected local port: ${port}`,
    `Current local webhook: ${snapshot.localWebhookUrl || "not detected yet"}`,
    "",
    "Do this:",
    `1. Detect whether ngrok is already exposing port ${port}.`,
    `2. If not, run \`ngrok http ${port}\`.`,
    "3. Return the public HTTPS ngrok URL only, plus any blocker if ngrok auth is missing.",
    "4. Do not save the ngrok URL as the final dashboard webhook. It is only the downstream target behind the Worker.",
  ].join("\n");
}

function getDiscoveryWizardStepIds(flow) {
  const normalizedFlow = mapDiscoveryWizardFlow(flow);
  if (normalizedFlow === "external_endpoint") {
    return ["detect", "path_select", "existing_endpoint", "verify", "ready"];
  }
  if (normalizedFlow === "no_webhook") {
    return ["detect", "path_select", "no_webhook", "ready"];
  }
  if (normalizedFlow === "stub_only") {
    return ["detect", "path_select", "stub_only", "ready"];
  }
  const localApi = getDiscoveryWizardLocalApi();
  if (localApi && typeof localApi.getLocalStepIds === "function") {
    return localApi.getLocalStepIds();
  }
  return [
    "detect",
    "path_select",
    "bootstrap",
    "local_health",
    "tunnel",
    "relay_deploy",
    "verify",
    "ready",
  ];
}

function getDiscoveryWizardActionableStep(flow, snapshot) {
  const normalizedFlow = mapDiscoveryWizardFlow(flow);
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  if (normalizedFlow === "external_endpoint") return "existing_endpoint";
  if (normalizedFlow === "no_webhook") return "no_webhook";
  if (normalizedFlow === "stub_only") return "stub_only";
  if (state.relayReady && isLikelyCloudflareWorkerUrl(state.savedWebhookUrl)) {
    return "verify";
  }
  if (state.tunnelReady) return "relay_deploy";
  if (state.localWebhookReady) return "tunnel";
  if (state.localWebhookUrl) return "local_health";
  return "bootstrap";
}

function getDiscoveryWizardStepsBefore(flow, targetStep) {
  const ids = getDiscoveryWizardStepIds(flow);
  const idx = ids.indexOf(targetStep);
  return idx > 0 ? ids.slice(0, idx) : [];
}

function getDiscoveryWizardRecommendedFlow(snapshot) {
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  return mapDiscoveryWizardFlow(state.recommendedFlow);
}

function getDiscoveryWizardFlowLabel(flow) {
  if (flow === "external_endpoint") return "My own webhook";
  if (flow === "no_webhook") return "Manual / no webhook";
  if (flow === "stub_only") return "Stub only (testing)";
  return "Local worker (this computer)";
}

function getDiscoveryWizardStepTitle(flow) {
  return getDiscoveryWizardFlowLabel(flow);
}

function getDiscoveryWizardSavedEndpointLabel(kind) {
  if (kind === "worker") return "Cloudflare Worker";
  if (kind === "generic_https") return "HTTPS webhook";
  if (kind === "apps_script_stub") return "Apps Script stub";
  if (kind === "local_http") return "localhost (needs relay)";
  return "none";
}

function getDiscoveryWizardBlockingIssueLabel(issue) {
  if (issue === "missing_sheet") return "Pipeline sheet not configured.";
  if (issue === "stub_only") return "Only the Apps Script stub is saved.";
  if (issue === "local_health_unavailable") {
    return "Local server found but not responding.";
  }
  if (issue === "ngrok_missing") {
    return "Server is up but no tunnel running.";
  }
  if (issue === "relay_missing") {
    return "Relay not deployed yet.";
  }
  if (issue === "needs_recovery") {
    return "Local setup needs recovery after restart.";
  }
  return "";
}

function getDiscoveryWizardRecommendationReason(snapshot) {
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  if (state.recommendedReason) return state.recommendedReason;
  if (state.savedWebhookKind === "worker") {
    return "A Cloudflare Worker URL is already saved.";
  }
  if (state.savedWebhookKind === "generic_https") {
    return "A webhook URL is already saved.";
  }
  if (state.savedWebhookKind === "apps_script_stub") {
    return "Only the Apps Script stub is saved — upgrade to a real endpoint.";
  }
  if (
    state.savedWebhookKind === "local_http" ||
    state.localWebhookUrl ||
    state.tunnelPublicUrl ||
    state.localBootstrapAvailable
  ) {
    return getDiscoveryLocalEngineKind(state) === "hermes"
      ? "A local Hermes route was detected. It can work, but the browser-use worker is the recommended local discovery engine."
      : "A local browser-use worker or local discovery path was detected on this machine.";
  }
  return "No webhook saved yet — pick a path to get started.";
}

function getDiscoveryWizardOptionDetails(flow) {
  const normalizedFlow = mapDiscoveryWizardFlow(flow);
  if (normalizedFlow === "external_endpoint") {
    return {
      title: "My own webhook URL",
      bestWhen: "You already have a public HTTPS endpoint.",
      setupTime: "~2 min",
      effort: "Low",
      pro: "Fastest — just paste and verify.",
      tradeoff:
        "You own that endpoint. Any hosting cost comes from your provider, not from JobBored.",
    };
  }
  if (normalizedFlow === "no_webhook") {
    return {
      title: "No webhook (manual)",
      bestWhen: "You use cron, GitHub Actions, or n8n to run discovery.",
      setupTime: "~1 min",
      effort: "Low",
      pro: "No endpoint to maintain.",
      tradeoff: "No on-demand Run discovery button.",
    };
  }
  if (normalizedFlow === "stub_only") {
    return {
      title: "Stub only (testing)",
      bestWhen: "You just want to confirm webhook delivery works.",
      setupTime: "~2 min",
      effort: "Low",
      pro: "Quick wiring test.",
      tradeoff: "No real job results.",
    };
  }
  return {
    title: "Local discovery worker",
    bestWhen:
      "You want the recommended browser-use discovery worker on this machine.",
    setupTime: "~10 min",
    effort: "Medium",
    pro: "Best local path for real discovery.",
    tradeoff:
      "Needs a local worker + ngrok + relay. Hermes/OpenClaw remains an advanced custom path.",
  };
}

function buildDiscoveryWizardOptionCard(flow, snapshot) {
  const option = getDiscoveryWizardOptionDetails(flow);
  const recommended = getDiscoveryWizardRecommendedFlow(snapshot) === flow;
  const body = [];
  if (recommended) {
    body.push(getDiscoveryWizardRecommendationReason(snapshot));
  }
  body.push({
    type: "list",
    items: [
      `${option.bestWhen}`,
      `${option.setupTime} · ${option.effort} effort`,
      `${option.pro}`,
      `${option.tradeoff}`,
    ],
  });
  return {
    type: "card",
    kicker: recommended ? "Recommended" : "",
    title: option.title,
    body,
    flow,
  };
}

async function persistDiscoveryWizardState(patch = {}) {
  const probes = getDiscoveryWizardProbesApi();
  const current = getDiscoveryWizardRuntime();
  const next = {
    ...(current.state || {}),
    ...(patch && typeof patch === "object" ? patch : {}),
    flow: mapDiscoveryWizardFlow(
      patch && Object.prototype.hasOwnProperty.call(patch, "flow")
        ? patch.flow
        : current.state.flow,
    ),
  };
  if (probes && typeof probes.saveDiscoverySetupWizardState === "function") {
    try {
      const saved = await probes.saveDiscoverySetupWizardState(next);
      updateDiscoveryWizardRuntime({ state: saved });
      return saved;
    } catch (err) {
      console.warn("[JobBored] discovery wizard state:", err);
    }
  }
  updateDiscoveryWizardRuntime({ state: next });
  return next;
}

function buildDiscoveryPathSelectBody(runtime) {
  const snapshot = runtime.snapshot;
  return [
    {
      type: "option-grid",
      items: [
        buildDiscoveryWizardOptionCard("local_agent", snapshot),
        buildDiscoveryWizardOptionCard("external_endpoint", snapshot),
        buildDiscoveryWizardOptionCard("no_webhook", snapshot),
      ].filter(Boolean),
    },
  ].filter(Boolean);
}

function buildDiscoveryDetectBody(runtime) {
  const snapshot = runtime.snapshot;
  const recovery = snapshot.localRecoveryState || "ok";
  const recoverySentences = {
    needs_full_restart:
      "Your computer restarted, so the local worker and tunnel need to be brought back up.",
    worker_down:
      "The local discovery worker is not responding. It may need to be restarted.",
    tunnel_down:
      "The ngrok tunnel is not running. The public URL cannot reach the local worker.",
    tunnel_rotated:
      "The ngrok tunnel restarted with a new URL. The relay needs to be updated.",
  };
  const foundItems = [];
  const missingItems = [];
  const localEngineLabel = getDiscoveryLocalEngineLabel(snapshot);

  if (snapshot.sheetConfigured) {
    foundItems.push("Pipeline sheet connected");
  } else {
    missingItems.push("Pipeline sheet not set up");
  }

  if (snapshot.savedWebhookUrl) {
    foundItems.push(
      `Webhook URL saved (${getDiscoveryWizardSavedEndpointLabel(snapshot.savedWebhookKind)})`,
    );
  } else {
    missingItems.push("No webhook URL saved");
  }

  if (snapshot.localBootstrapAvailable) {
    foundItems.push("Local config file found");
  }

  if (snapshot.localWebhookUrl) {
    foundItems.push(
      localEngineLabel
        ? `Local engine detected (${localEngineLabel})`
        : "Local server detected",
    );
    if (!snapshot.localWebhookReady) {
      missingItems.push("Local server not responding — needs restart");
    }
  }

  if (snapshot.tunnelReady) {
    foundItems.push("ngrok tunnel active");
  } else if (snapshot.localWebhookReady) {
    missingItems.push("No ngrok tunnel running");
  }

  if (snapshot.relayReady || snapshot.savedWebhookKind === "worker") {
    foundItems.push("Cloudflare relay deployed");
  } else if (
    snapshot.tunnelReady ||
    snapshot.savedWebhookKind === "local_http"
  ) {
    missingItems.push("Relay not deployed yet");
  }

  if (snapshot.savedWebhookKind === "apps_script_stub") {
    missingItems.push("Saved URL is still the Apps Script stub");
  }

  if (!foundItems.length) {
    foundItems.push("Nothing detected yet — this is a fresh start");
  }

  if (!missingItems.length) {
    missingItems.push("Everything looks good");
  }

  const allItems = [
    ...foundItems.map((i) => `✓ ${i}`),
    ...missingItems.map((i) => `✗ ${i}`),
  ];
  const cards = [];
  if (recovery !== "ok") {
    cards.push({
      type: "card",
      title: "Recovery needed",
      body: [
        recoverySentences[recovery] ||
          "Part of the local discovery chain is down after a restart.",
      ],
    });
  }
  cards.push({
    type: "card",
    title: "Status",
    body: [{ type: "list", items: allItems }],
  });
  cards.push(buildDiscoveryWizardMessageCard(runtime));
  return cards.filter(Boolean);
}

function buildDiscoveryExistingEndpointBody(runtime) {
  const container = createWizardNode("div", "discovery-wizard-step-body");
  appendWizardParagraph(
    container,
    "Paste your public HTTPS webhook URL below.",
  );
  appendWizardInput(container, {
    id: "discoveryWizardExistingEndpointInput",
    label: "Webhook URL",
    type: "url",
    value: runtime.drafts.endpointUrl || "",
    placeholder: "https://your-endpoint.example/webhook",
    hint: "Must be a public HTTPS URL — localhost won't work here.",
    onInput(value) {
      updateDiscoveryWizardRuntime({ drafts: { endpointUrl: value } });
    },
  });
  if (runtime.lastVerificationResult) {
    appendWizardResultCard(container, runtime.lastVerificationResult);
  }
  return container;
}

function buildDiscoveryBootstrapBody(runtime) {
  const snapshot = runtime.snapshot;
  const result = runtime.lastLocalResult;
  const container = createWizardNode("div", "discovery-wizard-step-body");
  appendWizardParagraph(
    container,
    "This reads your local config file to auto-fill ports, URLs, and tunnel info.",
  );
  appendWizardList(container, [
    `Config file: ${snapshot.localBootstrapAvailable ? "found" : "missing"}`,
    `Local server: ${snapshot.localWebhookUrl || "not detected"}`,
    `Tunnel: ${snapshot.tunnelPublicUrl || "not detected"}`,
  ]);
  appendWizardAssistChooser(container, {
    stepId: "bootstrap",
    title: "Generate the config file:",
    intro: "",
    defaultMode: "agent",
    choices: [
      {
        id: "agent",
        label: "AI assistant",
        summary: "Paste this into your AI coding assistant.",
        render(content) {
          appendWizardCodeBlock(
            content,
            buildDiscoveryBootstrapAgentPrompt(snapshot),
            "Copy prompt",
          );
          appendWizardParagraph(
            content,
            "Then press Load config above.",
            "settings-field-hint settings-field-hint--compact",
          );
        },
      },
      {
        id: "manual",
        label: "Terminal",
        summary: "Run this in your project root.",
        render(content) {
          appendWizardCodeBlock(
            content,
            "npm run discovery:bootstrap-local",
            "Copy command",
          );
          appendWizardParagraph(
            content,
            "Then press Load config above.",
            "settings-field-hint settings-field-hint--compact",
          );
        },
      },
    ],
  });
  appendWizardResultCard(container, result, "Result");
  return container;
}

function buildDiscoveryLocalHealthBody(runtime) {
  const snapshot = runtime.snapshot;
  const localEngineLabel =
    getDiscoveryLocalEngineLabel(snapshot) || "local discovery server";
  const container = createWizardNode("div", "discovery-wizard-step-body");
  appendWizardParagraph(
    container,
    `Checking that ${localEngineLabel} is running on this computer.`,
  );
  appendWizardList(container, [
    `Server: ${snapshot.localWebhookUrl || "not found"}`,
    `Status: ${snapshot.localWebhookReady ? "healthy" : "not responding"}`,
  ]);
  if (!snapshot.localWebhookReady) {
    appendWizardAssistChooser(container, {
      stepId: "local_health",
      title: "Start or restart the server:",
      intro: "",
      defaultMode: "agent",
      choices: [
        {
          id: "agent",
          label: "AI assistant",
          summary:
            "Paste this into your AI coding assistant to diagnose and fix.",
          render(content) {
            appendWizardCodeBlock(
              content,
              buildDiscoveryLocalHealthAgentPrompt(snapshot),
              "Copy prompt",
            );
            appendWizardParagraph(
              content,
              "Then press Check health above.",
              "settings-field-hint settings-field-hint--compact",
            );
          },
        },
        {
          id: "manual",
          label: "Terminal",
          summary:
            getDiscoveryLocalEngineKind(snapshot) === "hermes"
              ? "Run the advanced Hermes path if that is intentional."
              : "Run the recommended local browser-use worker.",
          render(content) {
            appendWizardCodeBlock(
              content,
              getDiscoveryLocalEngineKind(snapshot) === "hermes"
                ? "hermes gateway run --replace"
                : "npm run discovery:worker:start-local",
              "Copy command",
            );
            if (getDiscoveryLocalEngineKind(snapshot) !== "hermes") {
              appendWizardParagraph(
                content,
                "Advanced only: if you intentionally use Hermes/OpenClaw instead, run `hermes gateway run --replace`.",
                "settings-field-hint settings-field-hint--compact",
              );
            }
            appendWizardParagraph(
              content,
              "Then press Check health above.",
              "settings-field-hint settings-field-hint--compact",
            );
          },
        },
      ],
    });
  }
  appendWizardResultCard(container, runtime.lastLocalResult, "Result");
  return container;
}

function buildDiscoveryTunnelBody(runtime) {
  const snapshot = runtime.snapshot;
  const localPort = inferLocalWebhookPort(snapshot.localWebhookUrl || "");
  const container = createWizardNode("div", "discovery-wizard-step-body");

  const stalePlaceholder = createWizardNode(
    "div",
    "tunnel-stale-banner-wizard-slot",
  );
  stalePlaceholder.id = "wizardTunnelStalePlaceholder";
  container.appendChild(stalePlaceholder);
  void probeAndShowWizardTunnelBanner(
    stalePlaceholder,
    snapshot.tunnelPublicUrl || "",
    localPort,
  );

  appendWizardParagraph(
    container,
    "ngrok creates a public URL that forwards to your local server.",
  );
  appendWizardList(container, [
    `Local server: ${snapshot.localWebhookUrl || "not found"}`,
    `Tunnel: ${snapshot.tunnelPublicUrl || "not detected"}`,
  ]);
  appendWizardAssistChooser(container, {
    stepId: "tunnel",
    title: "Start or detect the tunnel:",
    intro: "",
    defaultMode: "agent",
    choices: [
      {
        id: "agent",
        label: "AI assistant",
        summary: "Paste this into your AI coding assistant.",
        render(content) {
          appendWizardCodeBlock(
            content,
            buildDiscoveryTunnelAgentPrompt(snapshot),
            "Copy prompt",
          );
          appendWizardParagraph(
            content,
            "Then press Detect tunnel above.",
            "settings-field-hint settings-field-hint--compact",
          );
        },
      },
      {
        id: "manual",
        label: "Terminal",
        summary: "Run this in a separate terminal window.",
        render(content) {
          appendWizardCodeBlock(
            content,
            `ngrok http ${localPort}`,
            "Copy command",
          );
          appendWizardParagraph(
            content,
            "Then press Detect tunnel above.",
            "settings-field-hint settings-field-hint--compact",
          );
        },
      },
    ],
  });
  appendWizardResultCard(container, runtime.lastLocalResult, "Result");
  return container;
}

async function probeAndShowWizardTunnelBanner(slot, storedTunnelUrl, port) {
  if (!slot || !isLocalDashboardOrigin()) return;
  const storedNorm = (storedTunnelUrl || "").replace(/\/+$/, "");
  const liveUrl = await probeNgrokFromLocalApi();

  if (!liveUrl && !storedNorm) return;

  const banner = createWizardNode("div", "tunnel-stale-banner");

  const icon = createWizardNode("span", "tunnel-stale-banner__icon");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  banner.appendChild(icon);

  const body = createWizardNode("div", "tunnel-stale-banner__body");
  const title = createWizardNode("p", "tunnel-stale-banner__title");
  const detail = createWizardNode("p", "tunnel-stale-banner__detail");
  body.appendChild(title);
  body.appendChild(detail);
  banner.appendChild(body);

  if (!liveUrl) {
    banner.classList.add("tunnel-stale-banner--down");
    title.textContent = "No ngrok tunnel detected.";
    detail.textContent = `Run ngrok http ${port || "8644"} to start a tunnel, then click Detect tunnel.`;
  } else if (storedNorm && liveUrl !== storedNorm) {
    title.textContent = "ngrok URL changed since last run.";
    detail.textContent = `Old: ${storedNorm}\nLive: ${liveUrl}`;
    const action = createWizardNode(
      "button",
      "btn-modal-primary tunnel-stale-banner__action",
      "Detect tunnel",
    );
    action.type = "button";
    action.addEventListener("click", () => {
      void handleDiscoveryWizardAction("local_tunnel_detect");
    });
    banner.appendChild(action);
  } else {
    return;
  }

  slot.appendChild(banner);
}

function buildDiscoveryRelayBody(runtime) {
  const snapshot = runtime.snapshot;
  const relayApi = getDiscoveryWizardRelayApi();
  const model =
    relayApi && typeof relayApi.buildRelayWizardModel === "function"
      ? relayApi.buildRelayWizardModel(snapshot, {
          origin:
            (window.location && typeof window.location.origin === "string"
              ? window.location.origin
              : "") || "*",
          sheetId: getSettingsSheetIdValue() || "",
          workerUrl: runtime.drafts.workerUrl || "",
        })
      : null;
  updateDiscoveryWizardRuntime({ lastRelayModel: model });
  const container = createWizardNode("div", "discovery-wizard-step-body");
  appendWizardParagraph(
    container,
    "The Cloudflare relay gives you a permanent public URL. It forwards requests to your ngrok tunnel.",
  );
  appendWizardAssistChooser(container, {
    stepId: "relay_deploy",
    title: "Deploy the relay:",
    intro: "",
    defaultMode: "agent",
    choices: [
      {
        id: "agent",
        label: "AI assistant",
        summary:
          "Paste this into your AI coding assistant to deploy automatically.",
        render(content) {
          if (model && model.agentPrompt) {
            appendWizardCodeBlock(content, model.agentPrompt, "Copy prompt");
          } else {
            appendWizardCallout(
              content,
              "Complete the tunnel step first — the relay needs a target URL.",
            );
          }
          appendWizardParagraph(
            content,
            "Then paste the Worker URL below.",
            "settings-field-hint settings-field-hint--compact",
          );
        },
      },
      {
        id: "manual",
        label: "Terminal",
        summary: "Copy the command, paste it into Terminal, then press Enter.",
        render(content) {
          if (model && model.downstreamTargetUrl) {
            appendWizardCodeBlock(
              content,
              model.downstreamTargetUrl,
              "Copy target URL",
            );
          }
          if (model && model.deployCommand) {
            appendWizardCodeBlock(
              content,
              model.deployCommand,
              "Copy terminal command",
            );
          } else {
            appendWizardCallout(
              content,
              "Complete the tunnel step first — the relay needs a target URL.",
            );
          }
          appendWizardParagraph(
            content,
            "Copy the command, paste it into a terminal opened in the Job-Bored repo, press Enter, then paste the Worker URL below.",
            "settings-field-hint settings-field-hint--compact",
          );
        },
      },
    ],
  });
  appendWizardInput(container, {
    id: "discoveryWizardWorkerUrlInput",
    label: "Worker URL",
    type: "url",
    value: runtime.drafts.workerUrl || "",
    placeholder: "https://your-worker.your-subdomain.workers.dev/",
    hint: "The workers.dev URL from the deploy output — not the /forward path.",
    onInput(value) {
      updateDiscoveryWizardRuntime({ drafts: { workerUrl: value } });
    },
  });
  appendWizardResultCard(container, runtime.lastRelayResult, "Result");
  return container;
}

function buildDiagnosisChainItem(label, url, statusIcon, statusText) {
  const row = createWizardNode("div", "diag-chain-row");
  const icon = createWizardNode(
    "span",
    `diag-chain-icon diag-chain-icon--${statusIcon}`,
  );
  icon.textContent =
    statusIcon === "ok" ? "✓" : statusIcon === "warn" ? "!" : "✗";
  icon.setAttribute("aria-hidden", "true");
  const copy = createWizardNode("div", "diag-chain-copy");
  const lbl = createWizardNode("span", "diag-chain-label", label);
  copy.appendChild(lbl);
  if (url) {
    const urlEl = createWizardNode("code", "diag-chain-url", url);
    copy.appendChild(urlEl);
  }
  const status = createWizardNode(
    "span",
    `diag-chain-status diag-chain-status--${statusIcon}`,
    statusText,
  );
  copy.appendChild(status);
  row.append(icon, copy);
  return row;
}

function buildDiscoveryVerifyBody(runtime) {
  const snapshot = runtime.snapshot;
  const container = createWizardNode("div", "discovery-wizard-step-body");
  const result = runtime.lastVerificationResult;
  const diagnosis = runtime.lastDownstreamDiagnosis;
  const recovery = snapshot.localRecoveryState || "ok";
  const isDownstreamFailure =
    result && !result.ok && !!diagnosis && diagnosis.ran;

  const endpointUrl =
    snapshot.savedWebhookUrl ||
    runtime.drafts.workerUrl ||
    runtime.drafts.endpointUrl ||
    "missing";

  if (recovery !== "ok") {
    const recoverySentences = {
      needs_full_restart:
        "Your computer restarted, so the local worker and tunnel need to be brought back up.",
      worker_down:
        "The local discovery worker is not responding. It may need to be restarted.",
      tunnel_down:
        "The ngrok tunnel is not running. The public URL cannot reach the local worker.",
      tunnel_rotated:
        "The ngrok tunnel restarted with a new URL. The relay needs to be updated.",
    };
    const recoveryCard = createWizardNode(
      "div",
      "discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--recovery",
    );
    appendWizardParagraph(
      recoveryCard,
      "Recovery needed",
      "discovery-setup-wizard__card-title",
    );
    appendWizardParagraph(
      recoveryCard,
      recoverySentences[recovery] ||
        "Part of the local discovery chain is down after a restart.",
      "discovery-setup-wizard__copy",
    );
    appendWizardParagraph(
      recoveryCard,
      "Click Fix setup to restore the worker, tunnel, and relay in one step.",
      "discovery-setup-wizard__copy",
    );
    container.appendChild(recoveryCard);
    return container;
  }

  appendWizardParagraph(container, `Testing: ${endpointUrl}`);

  if (isDownstreamFailure && diagnosis && diagnosis.ran) {
    const diagCard = createWizardNode(
      "div",
      "discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--warning diag-card",
    );

    appendWizardParagraph(
      diagCard,
      "What went wrong",
      "discovery-setup-wizard__card-title",
    );
    appendWizardParagraph(
      diagCard,
      diagnosis.summary,
      "discovery-setup-wizard__copy diag-summary",
    );

    if (diagnosis.redeployCommand) {
      appendWizardParagraph(
        diagCard,
        "How to redeploy",
        "discovery-setup-wizard__card-title diag-redeploy-title",
      );
      appendWizardParagraph(
        diagCard,
        "Copy this command, paste it into a terminal opened in the Job-Bored repo, press Enter, then come back here and click Test again. It keeps the same Worker name and updates TARGET_URL to the live ngrok URL.",
        "discovery-setup-wizard__copy diag-redeploy-copy",
      );
      appendWizardCodeBlock(
        diagCard,
        diagnosis.redeployCommand,
        "Copy terminal command",
      );
    } else if (
      diagnosis.primaryFix &&
      diagnosis.primaryFix.id === "diag_fix_update_tunnel_and_relay"
    ) {
      appendWizardParagraph(
        diagCard,
        "How to redeploy",
        "discovery-setup-wizard__card-title diag-redeploy-title",
      );
      appendWizardParagraph(
        diagCard,
        "We could not build the deploy command (local webhook path or live tunnel URL missing). Open the Relay deploy step after saving the Live ngrok URL, or from the repo root run: npm run cloudflare-relay:deploy -- --target-url 'https://YOUR-NGROK-HOST/your-webhook-path' --worker-name 'your-existing-worker-name'",
        "discovery-setup-wizard__copy diag-redeploy-copy",
      );
    }

    const chain = createWizardNode("div", "diag-chain");
    chain.appendChild(
      buildDiagnosisChainItem("Relay", endpointUrl, "ok", "OK"),
    );
    const tunnelStatus = diagnosis.tunnel.status;
    chain.appendChild(
      buildDiagnosisChainItem(
        "Tunnel",
        diagnosis.tunnel.url || snapshot.tunnelPublicUrl || "",
        tunnelStatus === "active"
          ? "ok"
          : tunnelStatus === "stale_url"
            ? "warn"
            : "fail",
        tunnelStatus === "active"
          ? "OK"
          : tunnelStatus === "stale_url"
            ? "URL changed — redeploy"
            : "Down",
      ),
    );
    const localStatus = diagnosis.localServer.status;
    chain.appendChild(
      buildDiagnosisChainItem(
        "Server",
        diagnosis.localServer.url || snapshot.localWebhookUrl || "",
        localStatus === "running"
          ? "ok"
          : localStatus === "not_configured"
            ? "warn"
            : "fail",
        localStatus === "running"
          ? "OK"
          : localStatus === "not_configured"
            ? "Not configured"
            : "Down",
      ),
    );
    if (diagnosis.relay.targetMismatch) {
      chain.appendChild(
        buildDiagnosisChainItem(
          "Relay target",
          snapshot.relayTargetUrl || "",
          "warn",
          "Stale — redeploy with current ngrok URL",
        ),
      );
    }
    diagCard.appendChild(chain);

    const fixActions = createWizardNode("div", "diag-fix-actions");

    if (diagnosis.primaryFix) {
      const primaryBtn = createWizardNode(
        "button",
        "btn-modal-primary diag-fix-btn diag-fix-btn--primary",
        diagnosis.primaryFix.label,
      );
      primaryBtn.type = "button";
      primaryBtn.dataset.wizardAction = "action";
      primaryBtn.dataset.actionId = diagnosis.primaryFix.id;
      primaryBtn.dataset.stepId = "verify";
      primaryBtn.dataset.actionKind = "diagnosis_fix";
      if (diagnosis.primaryFix.detail) {
        primaryBtn.title = diagnosis.primaryFix.detail;
      }
      fixActions.appendChild(primaryBtn);
    }

    const secondaryFixes = [];
    if (
      !diagnosis.primaryFix ||
      diagnosis.primaryFix.id !== "diag_fix_local_server"
    ) {
      secondaryFixes.push({
        id: "diag_fix_local_server",
        label: "Check server",
      });
    }
    if (
      !diagnosis.primaryFix ||
      diagnosis.primaryFix.id !== "diag_fix_tunnel"
    ) {
      secondaryFixes.push({
        id: "diag_fix_tunnel",
        label: "Fix tunnel",
      });
    }
    if (
      !diagnosis.primaryFix ||
      (diagnosis.primaryFix.id !== "diag_fix_relay" &&
        diagnosis.primaryFix.id !== "diag_fix_update_tunnel_and_relay")
    ) {
      secondaryFixes.push({
        id: "diag_fix_relay",
        label: "Fix relay",
      });
    }
    secondaryFixes.push({
      id: "diag_rerun_diagnosis",
      label: "Re-check",
    });

    secondaryFixes.forEach((fix) => {
      const btn = createWizardNode(
        "button",
        "btn-modal-secondary diag-fix-btn",
        fix.label,
      );
      btn.type = "button";
      btn.dataset.wizardAction = "action";
      btn.dataset.actionId = fix.id;
      btn.dataset.stepId = "verify";
      btn.dataset.actionKind = "diagnosis_fix";
      fixActions.appendChild(btn);
    });

    diagCard.appendChild(fixActions);
    container.appendChild(diagCard);
  } else if (isDownstreamFailure && !diagnosis) {
    const loadingCard = createWizardNode(
      "div",
      "discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--warning",
    );
    appendWizardParagraph(
      loadingCard,
      "Diagnosing...",
      "discovery-setup-wizard__card-title",
    );
    appendWizardParagraph(
      loadingCard,
      "Checking your server, tunnel, and relay to find what's broken.",
      "discovery-setup-wizard__copy",
    );
    container.appendChild(loadingCard);
  }

  appendWizardResultCard(container, result);
  return container;
}

function buildDiscoveryNoWebhookBody(runtime) {
  return [
    {
      type: "card",
      title: "No webhook — that's fine.",
      body: [
        "You can still add jobs to Pipeline using GitHub Actions, cron, n8n, or Apps Script triggers. You can come back and add a webhook later.",
      ],
    },
    buildDiscoveryWizardMessageCard(runtime),
  ].filter(Boolean);
}

function buildDiscoveryStubOnlyBody(runtime) {
  return [
    {
      type: "card",
      title: "Stub mode — testing only.",
      body: [
        "The stub confirms webhook delivery works, but won't produce real job results. Switch to the Local or Webhook path when you're ready for real discovery.",
      ],
    },
    buildDiscoveryWizardMessageCard(runtime),
  ].filter(Boolean);
}

function buildDiscoveryReadyBody(runtime) {
  const snapshot = runtime.snapshot;
  const cards = [];
  cards.push({
    type: "card",
    title: "Connection summary",
    body: [
      `Engine: ${
        snapshot.localWebhookUrl
          ? getDiscoveryLocalEngineSummary(snapshot)
          : snapshot.savedWebhookKind === "generic_https" ||
              snapshot.savedWebhookKind === "worker"
            ? snapshot.savedWebhookUrl
            : snapshot.engineState === "stub_only"
              ? "stub only"
              : "not confirmed"
      }`,
      `Tunnel: ${snapshot.tunnelPublicUrl || "not needed"}`,
      `Webhook URL: ${snapshot.savedWebhookUrl || runtime.drafts.workerUrl || "not saved"}`,
    ],
  });
  if (runtime.lastVerificationResult) {
    cards.push({
      type: "card",
      title: runtime.lastVerificationResult.message || "Test result",
      body: [runtime.lastVerificationResult.detail || "Verification complete."],
    });
  }
  return cards;
}

function buildDiscoveryWizardSteps(runtime) {
  const flow = mapDiscoveryWizardFlow(runtime.state.flow);
  const steps = [];
  const detectRecovery =
    runtime.snapshot &&
    runtime.snapshot.localRecoveryState &&
    runtime.snapshot.localRecoveryState !== "ok";
  steps.push({
    id: "detect",
    label: "Status",
    title: detectRecovery
      ? "Local setup needs recovery"
      : "Current setup status",
    description: detectRecovery
      ? "The local worker or tunnel is down. Click Fix setup to restore everything."
      : "What's already connected and what still needs work.",
    body: () => buildDiscoveryDetectBody(getDiscoveryWizardRuntime()),
    actions: detectRecovery
      ? [
          {
            id: "wizard_fix_setup",
            label: "Fix setup",
            variant: "primary",
          },
        ]
      : [
          {
            id: "wizard_review_options",
            label: "Next: choose a path",
            variant: "primary",
          },
        ],
    secondaryActions: [
      ...(detectRecovery
        ? [
            {
              id: "wizard_review_options",
              label: "Choose a different path",
              variant: "secondary",
            },
          ]
        : []),
      {
        id: "wizard_refresh_detect",
        label: "Re-scan",
        variant: "secondary",
      },
      ...(detectRecovery
        ? [
            {
              id: "wizard_show_manual_steps",
              label: "Show manual steps",
              variant: "secondary",
            },
          ]
        : []),
    ],
  });
  steps.push({
    id: "path_select",
    label: "Path",
    title: "How do you want to connect discovery?",
    description: "Click a card to choose your setup path.",
    body: () => buildDiscoveryPathSelectBody(getDiscoveryWizardRuntime()),
    actions: [],
    secondaryActions: [],
  });

  if (flow === "external_endpoint") {
    steps.push({
      id: "existing_endpoint",
      label: "Endpoint",
      title: "Enter your webhook URL.",
      description: "Paste the public HTTPS URL you want JobBored to call.",
      body: () =>
        buildDiscoveryExistingEndpointBody(getDiscoveryWizardRuntime()),
      actions: [
        {
          id: "wizard_verify_existing_endpoint",
          label: "Save and verify",
          variant: "primary",
        },
      ],
    });
  } else if (flow === "no_webhook") {
    steps.push({
      id: "no_webhook",
      label: "Manual",
      title: "Keep discovery manual.",
      description:
        "You can still add jobs to Pipeline manually or via automation — just no on-demand button.",
      body: () => buildDiscoveryNoWebhookBody(getDiscoveryWizardRuntime()),
      actions: [
        {
          id: "wizard_complete_no_webhook",
          label: "Confirm — no webhook",
          variant: "primary",
        },
      ],
    });
  } else if (flow === "stub_only") {
    steps.push({
      id: "stub_only",
      label: "Stub",
      title: "Test-only mode.",
      description:
        "The stub confirms wiring works but won't produce real job results.",
      body: () => buildDiscoveryStubOnlyBody(getDiscoveryWizardRuntime()),
      actions: [
        {
          id: "wizard_complete_stub_only",
          label: "Confirm stub setup",
          variant: "primary",
        },
      ],
    });
  } else {
    steps.push({
      id: "bootstrap",
      label: "Config",
      title: detectRecovery ? "Fix local setup" : "Load local config.",
      description: detectRecovery
        ? "One click restores the local worker, tunnel, and relay."
        : "Reads your saved local setup so the wizard knows your ports, URLs, and tunnel info.",
      body: () => buildDiscoveryBootstrapBody(getDiscoveryWizardRuntime()),
      actions: detectRecovery
        ? [
            {
              id: "wizard_fix_setup",
              label: "Fix setup",
              variant: "primary",
            },
          ]
        : [
            {
              id: "local_bootstrap_refresh",
              label: "Load config",
              variant: "primary",
            },
          ],
      secondaryActions: detectRecovery
        ? [
            {
              id: "local_bootstrap_refresh",
              label: "Load config manually",
              variant: "secondary",
            },
          ]
        : [],
    });
    steps.push({
      id: "local_health",
      label: "Server",
      title: "Check local server.",
      description:
        "Makes sure your local discovery server is running and accepting requests.",
      body: () => buildDiscoveryLocalHealthBody(getDiscoveryWizardRuntime()),
      actions: [
        {
          id: "local_health_check",
          label: "Check health",
          variant: "primary",
        },
      ],
    });
    steps.push({
      id: "tunnel",
      label: "Tunnel",
      title: "Connect ngrok tunnel.",
      description: "ngrok makes your local server reachable from the internet.",
      body: () => buildDiscoveryTunnelBody(getDiscoveryWizardRuntime()),
      actions: [
        {
          id: "local_tunnel_detect",
          label: "Detect tunnel",
          variant: "primary",
        },
      ],
    });
    steps.push({
      id: "relay_deploy",
      label: "Relay",
      title: "Deploy the Cloudflare relay.",
      description:
        "The relay gives you a permanent URL that forwards to your ngrok tunnel.",
      body: () => buildDiscoveryRelayBody(getDiscoveryWizardRuntime()),
      actions: [
        {
          id: "relay_apply_worker_url",
          label: "Save Worker URL",
          variant: "primary",
        },
      ],
    });
  }

  const verifyDesc =
    flow === "external_endpoint"
      ? "Sends a test request to your webhook URL to confirm it responds correctly."
      : flow === "no_webhook"
        ? "Quick sanity check that your manual pipeline configuration is valid."
        : "Sends a test request through the relay → tunnel → server chain to confirm the full loop works.";
  steps.push({
    id: "verify",
    label: "Test",
    title: detectRecovery
      ? "Local setup needs recovery"
      : "Test the connection.",
    description: detectRecovery
      ? "The local worker or tunnel is down. Fix the setup first, then test."
      : verifyDesc,
    body: () => buildDiscoveryVerifyBody(getDiscoveryWizardRuntime()),
    actions: detectRecovery
      ? [
          {
            id: "wizard_fix_setup",
            label: "Fix setup",
            variant: "primary",
          },
        ]
      : [
          {
            id: "wizard_verify_current_endpoint",
            label: "Run test",
            variant: "primary",
          },
        ],
    secondaryActions: detectRecovery
      ? [
          {
            id: "wizard_verify_current_endpoint",
            label: "Run test anyway",
            variant: "secondary",
          },
        ]
      : [],
  });
  const readyDesc =
    flow === "external_endpoint"
      ? "Your webhook URL is verified. Run discovery on demand or close this wizard."
      : flow === "no_webhook"
        ? "Manual mode is active. Add jobs via Pipeline, cron, or automation."
        : "Local discovery worker path is connected. Run discovery on demand or close this wizard.";
  steps.push({
    id: "ready",
    label: "Done",
    title: "You're all set.",
    description: readyDesc,
    body: () => buildDiscoveryReadyBody(getDiscoveryWizardRuntime()),
    actions: [
      {
        id: "wizard_run_discovery_now",
        label: "Run discovery now",
        variant: "primary",
        disabled: !getDiscoverySettingsView(runtime.snapshot)
          .runDiscoveryEnabled,
      },
    ],
    secondaryActions: [
      {
        id: "wizard_finish_setup",
        label: "Close wizard",
        variant: "secondary",
      },
    ],
  });
  return steps.filter((step) =>
    getDiscoveryWizardStepIds(flow).includes(step.id),
  );
}

async function renderDiscoverySetupWizard() {
  const shell = getDiscoveryWizardShellApi();
  if (!shell || typeof shell.renderWizardShell !== "function") {
    await openCommandCenterSettingsModal();
    return null;
  }
  const runtime = getDiscoveryWizardRuntime();
  return shell.renderWizardShell({
    title: "Discovery setup wizard",
    lede: "Connect your job discovery pipeline in a few steps.",
    snapshot: runtime.snapshot,
    state: runtime.state,
    steps: buildDiscoveryWizardSteps(runtime),
    activeStepId: runtime.activeStepId,
    onAction: (actionId) => {
      void handleDiscoveryWizardAction(actionId).catch((err) => {
        console.error("[JobBored] discovery wizard action:", actionId, err);
        showToast(
          "That action failed. Check the browser console for details.",
          "error",
        );
      });
    },
    onNavigate: (stepId, detail) => {
      const current = getDiscoveryWizardRuntime();
      updateDiscoveryWizardRuntime({
        activeStepId: stepId,
        state: {
          ...(current.state || {}),
          ...(detail && detail.state ? detail.state : {}),
          currentStep: stepId,
        },
      });
      void persistDiscoveryWizardState({
        ...(detail && detail.state ? detail.state : {}),
        currentStep: stepId,
      });
    },
    onStateChange: (state) => {
      updateDiscoveryWizardRuntime({ state });
      void persistDiscoveryWizardState(state);
    },
    onClose: () => {
      discoveryWizardRuntime = null;
      void refreshDiscoveryReadinessSnapshot({ force: true });
    },
  });
}

async function openDiscoverySetupWizard(options = {}) {
  if (isOnboardingWizardVisible()) {
    try {
      sessionStorage.setItem(PENDING_DISCOVERY_SETUP_KEY, "1");
    } catch (_) {
      /* ignore */
    }
    return null;
  }
  if (isSettingsModalOpen()) {
    closeCommandCenterSettingsModal();
  }
  const helpModal = document.getElementById("discoveryHelpModal");
  if (helpModal) {
    helpModal.style.display = "none";
  }
  closeDiscoverySetupGuideModal();
  const snapshot = await refreshDiscoveryReadinessSnapshot({
    force: true,
    rerender: false,
  });
  const probes = getDiscoveryWizardProbesApi();
  let savedState = null;
  if (probes && typeof probes.getDiscoverySetupWizardState === "function") {
    try {
      savedState = await probes.getDiscoverySetupWizardState();
    } catch (err) {
      console.warn("[JobBored] load discovery wizard state:", err);
    }
  }
  const needsRecovery =
    snapshot.localRecoveryState && snapshot.localRecoveryState !== "ok";
  const initialFlow = mapDiscoveryWizardFlow(
    needsRecovery
      ? "local_agent"
      : options.flow ||
          (savedState && savedState.flow) ||
          snapshot.recommendedFlow,
  );
  const initialStep = needsRecovery
    ? "bootstrap"
    : options.startStep ||
      (savedState &&
      savedState.currentStep !== "path_select" &&
      getDiscoveryWizardStepIds(initialFlow).includes(savedState.currentStep)
        ? savedState.currentStep
        : "detect");
  const savedCompleted =
    savedState && Array.isArray(savedState.completedSteps)
      ? savedState.completedSteps
      : [];
  const implicitlyCompleted = getDiscoveryWizardStepsBefore(
    initialFlow,
    initialStep,
  );
  const mergedCompleted = [
    ...new Set([...savedCompleted, ...implicitlyCompleted]),
  ];
  discoveryWizardRuntime = createDiscoveryWizardRuntime({
    entryPoint: options.entryPoint || "manual",
    snapshot,
    state: {
      ...(savedState && typeof savedState === "object" ? savedState : {}),
      flow: initialFlow,
      currentStep: initialStep,
      completedSteps: mergedCompleted,
    },
    activeStepId: initialStep,
    drafts: {
      ...getDiscoveryWizardDefaultDrafts(snapshot),
      ...(options.drafts && typeof options.drafts === "object"
        ? options.drafts
        : {}),
    },
  });
  await persistDiscoveryWizardState({
    ...discoveryWizardRuntime.state,
    flow: initialFlow,
    currentStep: initialStep,
    completedSteps: mergedCompleted,
  });
  return renderDiscoverySetupWizard();
}

function getDiscoveryWizardCurrentStepContext() {
  const shell = getDiscoveryWizardShellApi();
  return shell &&
    shell.lastRender &&
    shell.lastRender.context &&
    typeof shell.lastRender.context === "object"
    ? shell.lastRender.context
    : null;
}

async function moveDiscoveryWizardToStep(stepId, patch = {}) {
  const runtime = updateDiscoveryWizardRuntime({
    activeStepId: stepId,
    state: {
      ...(getDiscoveryWizardRuntime().state || {}),
      ...(patch.state && typeof patch.state === "object" ? patch.state : {}),
      currentStep: stepId,
    },
    ...patch,
  });
  await persistDiscoveryWizardState({
    ...(runtime.state || {}),
    currentStep: stepId,
  });
  return renderDiscoverySetupWizard();
}

function setDiscoveryWizardMessage(message, tone = "info") {
  updateDiscoveryWizardRuntime({
    lastWizardMessage: message || "",
    lastWizardMessageTone: tone,
  });
}

async function handleDiscoveryWizardFlowSelection(flow) {
  const snapshot = await refreshDiscoveryReadinessSnapshot({
    force: true,
    rerender: false,
  });
  const mappedFlow = mapDiscoveryWizardFlow(flow);
  const runtime = getDiscoveryWizardRuntime();
  const currentState = runtime.state || {};

  const flowCache = { ...(runtime.flowProgressCache || {}) };
  if (currentState.flow) {
    flowCache[currentState.flow] = {
      completedSteps: [...(currentState.completedSteps || [])],
      currentStep: runtime.activeStepId || currentState.currentStep || "",
      drafts: { ...(runtime.drafts || {}) },
    };
  }

  const cached = flowCache[mappedFlow];
  const nextStep =
    cached && cached.currentStep
      ? cached.currentStep
      : getDiscoveryWizardActionableStep(mappedFlow, snapshot);
  const restoredSteps =
    cached && cached.completedSteps
      ? cached.completedSteps
      : getDiscoveryWizardStepsBefore(mappedFlow, nextStep);
  const restoredDrafts = cached && cached.drafts ? cached.drafts : undefined;

  setDiscoveryWizardMessage("");
  return moveDiscoveryWizardToStep(nextStep, {
    snapshot,
    flowProgressCache: flowCache,
    drafts: restoredDrafts,
    state: {
      flow: mappedFlow,
      completedSteps: [...restoredSteps],
    },
  });
}

async function diagnoseDownstreamChain(snapshot) {
  const probes = getDiscoveryWizardProbesApi();
  const diagnosis = {
    ran: true,
    timestamp: new Date().toISOString(),
    localServer: { status: "unknown", url: "", healthy: false },
    tunnel: { status: "unknown", url: "", active: false, stale: false },
    relay: { status: "unknown", targetMismatch: false },
    summary: "",
    primaryFix: null,
    redeployCommand: "",
    redeployTargetUrl: "",
  };

  const transport =
    probes && typeof probes.readDiscoveryTransportSetupState === "function"
      ? probes.readDiscoveryTransportSetupState()
      : {};
  const localUrl = snapshot.localWebhookUrl || transport.localWebhookUrl || "";
  diagnosis.localServer.url = localUrl;

  if (localUrl && probes && typeof probes.probeHealthUrl === "function") {
    const healthUrl = probes.buildLocalHealthUrl
      ? probes.buildLocalHealthUrl(localUrl)
      : localUrl.replace(/\/[^/]*$/, "/health");
    diagnosis.localServer.healthy = await probes.probeHealthUrl(healthUrl);
    diagnosis.localServer.status = diagnosis.localServer.healthy
      ? "running"
      : "unreachable";
  } else if (!localUrl) {
    diagnosis.localServer.status = "not_configured";
  }

  if (probes && typeof probes.probeNgrokTunnels === "function") {
    const liveNgrokUrl = await probes.probeNgrokTunnels();
    diagnosis.tunnel.url = liveNgrokUrl;
    diagnosis.tunnel.active = !!liveNgrokUrl;
    if (
      liveNgrokUrl &&
      snapshot.tunnelPublicUrl &&
      liveNgrokUrl !== snapshot.tunnelPublicUrl
    ) {
      diagnosis.tunnel.stale = true;
    }
    diagnosis.tunnel.status = liveNgrokUrl
      ? diagnosis.tunnel.stale
        ? "stale_url"
        : "active"
      : "not_running";
  }

  if (
    snapshot.relayTargetUrl &&
    diagnosis.tunnel.active &&
    diagnosis.tunnel.url
  ) {
    const savedTarget = snapshot.relayTargetUrl.replace(/\/+$/, "");
    const liveBase = diagnosis.tunnel.url.replace(/\/+$/, "");
    if (!savedTarget.startsWith(liveBase)) {
      diagnosis.relay.targetMismatch = true;
    }
    diagnosis.relay.status = diagnosis.relay.targetMismatch
      ? "target_stale"
      : "ok";
  }

  if (diagnosis.localServer.status === "unreachable") {
    diagnosis.summary = "Local server is down.";
    diagnosis.primaryFix = {
      id: "diag_fix_local_server",
      label: "Start server",
      detail:
        "Attempts to start the recommended local browser-use worker automatically.",
    };
  } else if (diagnosis.tunnel.status === "not_running") {
    diagnosis.summary = "ngrok tunnel is not running.";
    diagnosis.primaryFix = {
      id: "diag_fix_tunnel",
      label: "Fix tunnel",
      detail: "Go to the tunnel step to start ngrok.",
    };
  } else if (diagnosis.tunnel.stale || diagnosis.relay.targetMismatch) {
    const liveRaw = diagnosis.tunnel.url || "";
    const liveNorm = liveRaw.replace(/\/+$/, "") || "unknown";
    const tunnelOrigin = (u) => {
      try {
        const s = String(u || "").trim();
        if (!s) return "";
        const parsed = new URL(s);
        return `${parsed.protocol}//${parsed.host}`;
      } catch (_) {
        return String(u || "").replace(/\/+$/, "");
      }
    };
    const liveOrigin = liveRaw ? tunnelOrigin(liveRaw) : "";
    let oldDisplay = "";
    if (diagnosis.relay.targetMismatch && snapshot.relayTargetUrl) {
      const relayOrig = tunnelOrigin(snapshot.relayTargetUrl);
      if (relayOrig && liveOrigin && relayOrig !== liveOrigin) {
        oldDisplay = relayOrig;
      }
    }
    if (
      !oldDisplay &&
      diagnosis.tunnel.stale &&
      snapshot.tunnelPublicUrl &&
      liveOrigin
    ) {
      const pubOrig = tunnelOrigin(snapshot.tunnelPublicUrl);
      if (pubOrig && pubOrig !== liveOrigin) {
        oldDisplay = snapshot.tunnelPublicUrl.replace(/\/+$/, "");
      }
    }
    if (!oldDisplay) {
      oldDisplay =
        snapshot.tunnelPublicUrl ||
        (snapshot.relayTargetUrl
          ? tunnelOrigin(snapshot.relayTargetUrl)
          : "") ||
        "unknown";
    }
    diagnosis.summary = `ngrok URL changed \u2014 relay needs redeployment.\nOld: ${oldDisplay}\nLive: ${liveNorm}`;
    diagnosis.liveNgrokUrl = liveNorm;
    diagnosis.primaryFix = {
      id: "diag_fix_update_tunnel_and_relay",
      label: "Update tunnel & save ngrok, then redeploy",
      detail:
        "Click to save the Live ngrok URL, then run the deploy command shown below from your Job-Bored repo (same Worker name = update in place).",
    };

    if (liveNorm && liveNorm !== "unknown") {
      const relayApi = getDiscoveryWizardRelayApi();
      let redeployTarget = buildDiscoveryTunnelTargetUrl(
        snapshot.localWebhookUrl,
        liveNorm,
      );
      if (
        !redeployTarget &&
        relayApi &&
        typeof relayApi.buildDownstreamTargetUrl === "function"
      ) {
        const patched = {
          ...snapshot,
          tunnelPublicUrl: liveNorm,
          relayTargetUrl: "",
        };
        redeployTarget = relayApi.buildDownstreamTargetUrl(patched, {}) || "";
      }
      diagnosis.redeployTargetUrl = redeployTarget;
      const workerUrl =
        snapshot.savedWebhookUrl || getDiscoveryWebhookUrl() || "";
      const explicitWorker =
        inferCloudflareWorkerNameFromOpenWorkerUrl(workerUrl);
      const workerName =
        explicitWorker || getSuggestedCloudflareRelayWorkerName(redeployTarget);
      const sheetId = getSettingsSheetIdValue() || "";
      if (redeployTarget) {
        diagnosis.redeployCommand = buildDiscoveryRelayDeployCommandForTarget(
          redeployTarget,
          {
            origin: getDiscoveryRelaySuggestedOrigin(),
            workerName,
            workerUrl,
            sheetId,
          },
        );
      }
    }
  } else if (
    diagnosis.localServer.healthy &&
    diagnosis.tunnel.active &&
    !diagnosis.relay.targetMismatch
  ) {
    diagnosis.summary =
      "Everything looks connected — may have been a temporary issue.";
    diagnosis.primaryFix = {
      id: "diag_fix_reverify",
      label: "Try again",
      detail: "Re-run the test to see if it passes now.",
    };
  } else {
    diagnosis.summary =
      "Couldn't pinpoint the issue. Fix the first red item below.";
  }

  return diagnosis;
}

async function handleDiscoveryWizardVerification(url, context) {
  const payload = await buildDiscoveryWebhookPayload(
    context === "run_discovery"
      ? SHEET_ID
      : getSettingsSheetIdValue() || SHEET_ID,
  );
  const result = await verifyDiscoveryWebhookWithSharedModel(url, payload, {
    context,
    sheetId: getSettingsSheetIdValue() || SHEET_ID || "",
  });
  updateDiscoveryWizardRuntime({
    lastVerificationResult: result,
    lastDownstreamDiagnosis: null,
  });
  if (result.ok) {
    const engineState = getDiscoveryEngineStateFromVerificationResult(result);
    if (engineState) {
      await recordDiscoveryEngineState(
        url,
        engineState,
        context === "run_discovery"
          ? "wizard_run_discovery"
          : "wizard_verify_endpoint",
      );
    }
    if (url) {
      mergeStoredConfigOverridePatch({ discoveryWebhookUrl: url });
    }
    await refreshDiscoveryReadinessSnapshot({ force: true, rerender: false });
    const snapshot = getDiscoveryReadinessSnapshot();
    const flow =
      result.kind === "stub_only"
        ? "stub_only"
        : getDiscoveryWizardRuntime().state.flow;
    setDiscoveryWizardMessage(
      result.message,
      result.kind === "stub_only" ? "warning" : "info",
    );
    await persistDiscoveryWizardState({
      flow,
      currentStep: result.kind === "stub_only" ? "stub_only" : "ready",
      completedSteps: [
        ...((getDiscoveryWizardRuntime().state || {}).completedSteps || []),
        "verify",
      ],
      lastVerifiedAt: new Date().toISOString(),
      result:
        result.kind === "stub_only"
          ? "stub_only"
          : result.engineState || "connected",
    });
    updateDiscoveryWizardRuntime({
      snapshot,
      state: {
        ...(getDiscoveryWizardRuntime().state || {}),
        flow: mapDiscoveryWizardFlow(flow),
      },
    });
    showDiscoveryVerificationToast(result, { context });
    return moveDiscoveryWizardToStep(
      result.kind === "stub_only" ? "stub_only" : "ready",
      {
        snapshot,
        state: {
          flow: mapDiscoveryWizardFlow(flow),
        },
      },
    );
  }
  if (
    result.kind === "network_error" &&
    (await handleAppsScriptBrowserCorsFailure(url))
  ) {
    // Apps Script stub that is publicly accessible — CORS blocked the browser from
    // reading the response, but the endpoint did receive and accept the request.
    // Classify as stub_only so the wizard shows warning semantics, not a generic
    // network error, and the Run discovery path does not report full-connected success.
    result.kind = "stub_only";
    result.engineState = "stub_only";
    result.message =
      "Apps Script stub received the request. Wiring works, but the stub does not find real jobs.";
    result.detail =
      "Switch to a real discovery engine or set up a Cloudflare relay to enable real discovery.";
    setDiscoveryWizardMessage(result.message, "warning");
    return renderDiscoverySetupWizard();
  }
  const freshSnapshot = await refreshDiscoveryReadinessSnapshot({
    force: true,
    rerender: false,
  });

  const freshRecovery = freshSnapshot.localRecoveryState || "ok";
  if (freshRecovery !== "ok") {
    updateDiscoveryWizardRuntime({
      snapshot: freshSnapshot,
      lastDownstreamDiagnosis: null,
    });
    setDiscoveryWizardMessage(
      "The local chain is down. Click Fix setup to restore it.",
      "warning",
    );
    showDiscoveryVerificationToast(result, { context, endpointUrl: url });
    return renderDiscoverySetupWizard();
  }

  const hasLocalTunnel =
    isLocalDashboardOrigin() && !!freshSnapshot.tunnelPublicUrl;
  const isDiagnosableDownstreamFailure =
    result.layer === "downstream" &&
    [502, 503, 504].includes(Number(result.httpStatus) || 0);
  const isLikelyTunnelFailure =
    !isDiagnosableDownstreamFailure &&
    hasLocalTunnel &&
    (result.kind === "network_error" ||
      /ngrok|tunnel|offline|err_ngrok_/i.test(
        `${result.message || ""}\n${result.detail || ""}`,
      ));
  if (isDiagnosableDownstreamFailure || isLikelyTunnelFailure) {
    const diagnosis = await diagnoseDownstreamChain(freshSnapshot);
    updateDiscoveryWizardRuntime({
      snapshot: freshSnapshot,
      lastDownstreamDiagnosis: diagnosis,
    });
  } else {
    updateDiscoveryWizardRuntime({
      snapshot: freshSnapshot,
      lastDownstreamDiagnosis: null,
    });
  }
  showDiscoveryVerificationToast(result, { context, endpointUrl: url });
  setDiscoveryWizardMessage(result.message, "warning");
  return renderDiscoverySetupWizard();
}

async function handleDiscoveryWizardAction(actionId) {
  let runtime = getDiscoveryWizardRuntime();
  const shellContext = getDiscoveryWizardCurrentStepContext();
  const shell = getDiscoveryWizardShellApi();
  const snapshot = await refreshDiscoveryReadinessSnapshot({
    force: true,
    rerender: false,
  });
  updateDiscoveryWizardRuntime({ snapshot });
  runtime = getDiscoveryWizardRuntime();

  if (actionId === "wizard_back") {
    const previousStep =
      shellContext && shellContext.previousStep
        ? shellContext.previousStep.id
        : "";
    if (previousStep) {
      return moveDiscoveryWizardToStep(previousStep);
    }
    return null;
  }

  if (actionId === "wizard_next" || actionId === "wizard_finish_setup") {
    const nextStep =
      shellContext && shellContext.nextStep ? shellContext.nextStep.id : "";
    if (actionId === "wizard_finish_setup" || !nextStep) {
      if (shell && typeof shell.closeWizardShell === "function") {
        shell.closeWizardShell("finish");
      }
      return null;
    }
    return moveDiscoveryWizardToStep(nextStep);
  }

  if (actionId === "wizard_run_discovery_now") {
    const shellApi = getDiscoveryWizardShellApi();
    if (shellApi && typeof shellApi.closeWizardShell === "function") {
      shellApi.closeWizardShell("run-discovery");
    }
    return triggerDiscoveryRun();
  }

  if (actionId === "wizard_choose_flow_local") {
    return handleDiscoveryWizardFlowSelection("local_agent");
  }
  if (actionId === "wizard_choose_flow_existing") {
    return handleDiscoveryWizardFlowSelection("external_endpoint");
  }
  if (actionId === "wizard_choose_flow_no_webhook") {
    return handleDiscoveryWizardFlowSelection("no_webhook");
  }

  if (actionId === "wizard_refresh_detect") {
    setDiscoveryWizardMessage(
      "Refreshed discovery signals from the current repo and browser state.",
    );
    return moveDiscoveryWizardToStep("detect", {
      snapshot,
      state: {
        completedSteps: [
          ...((runtime.state || {}).completedSteps || []),
          "detect",
        ],
        lastProbeAt: new Date().toISOString(),
      },
    });
  }
  if (actionId === "wizard_fix_setup") {
    const probes = getDiscoveryWizardProbesApi();
    if (!probes || typeof probes.requestFixSetup !== "function") {
      setDiscoveryWizardMessage(
        "Fix setup is not available outside the local dev server.",
      );
      return renderDiscoverySetupWizard();
    }
    setDiscoveryWizardMessage(
      "Running Fix setup — starting worker and tunnel...",
    );
    await renderDiscoverySetupWizard();
    const result = await probes.requestFixSetup();
    if (result && result.ok) {
      if (result.needsAuth) {
        const authMsg = (result.phases || []).find(
          (p) => p.phase === "needs_cloudflare_auth",
        );
        setDiscoveryWizardMessage(
          (authMsg && authMsg.message) ||
            "Cloudflare auth needed. Run `npx wrangler login` in a terminal, then try again.",
        );
        return renderDiscoverySetupWizard();
      }
      const freshSnapshot = await refreshDiscoveryReadinessSnapshot({
        force: true,
        rerender: false,
      });
      updateDiscoveryWizardRuntime({ snapshot: freshSnapshot });
      const verifiedMsg = (result.phases || []).find(
        (p) => p.phase === "verified",
      );
      setDiscoveryWizardMessage(
        (verifiedMsg && verifiedMsg.message) || "Setup restored successfully.",
      );
      return moveDiscoveryWizardToStep("verify", {
        snapshot: freshSnapshot,
      });
    }
    const failedPhase = ((result && result.phases) || []).slice(-1)[0];
    setDiscoveryWizardMessage(
      (failedPhase && failedPhase.message) ||
        (result && result.message) ||
        "Fix setup failed. Check the terminal for details.",
    );
    return renderDiscoverySetupWizard();
  }
  if (actionId === "wizard_show_manual_steps") {
    setDiscoveryWizardMessage(
      "Showing manual steps. Follow bootstrap → server → tunnel → relay → verify.",
    );
    return moveDiscoveryWizardToStep("bootstrap", {
      snapshot,
      state: {
        flow: "local_agent",
        completedSteps: [
          ...((runtime.state || {}).completedSteps || []),
          "detect",
          "path_select",
        ],
      },
    });
  }
  if (actionId === "wizard_review_options") {
    setDiscoveryWizardMessage("");
    return moveDiscoveryWizardToStep("path_select", {
      snapshot,
      state: {
        completedSteps: [
          ...((runtime.state || {}).completedSteps || []),
          "detect",
        ],
      },
    });
  }
  if (actionId === "wizard_use_recommended_flow") {
    const recommendedFlow = getDiscoveryWizardRecommendedFlow(snapshot);
    const targetStep = getDiscoveryWizardActionableStep(
      recommendedFlow,
      snapshot,
    );
    const priorSteps = getDiscoveryWizardStepsBefore(
      recommendedFlow,
      targetStep,
    );
    setDiscoveryWizardMessage(
      `Continuing with the recommended path: ${getDiscoveryWizardStepTitle(recommendedFlow)}.`,
    );
    return moveDiscoveryWizardToStep(targetStep, {
      snapshot,
      state: {
        flow: recommendedFlow,
        completedSteps: [
          ...((runtime.state || {}).completedSteps || []),
          ...priorSteps,
        ],
      },
    });
  }
  if (actionId === "wizard_complete_no_webhook") {
    setDiscoveryWizardMessage(
      "Saved the no-webhook path. Run discovery will stay disabled on purpose.",
    );
    return moveDiscoveryWizardToStep("ready", {
      state: {
        flow: "no_webhook",
        completedSteps: [
          ...((runtime.state || {}).completedSteps || []),
          "detect",
          "no_webhook",
        ],
        result: "none",
      },
    });
  }
  if (actionId === "wizard_complete_stub_only") {
    if (runtime.snapshot.savedWebhookUrl) {
      await recordDiscoveryEngineState(
        runtime.snapshot.savedWebhookUrl,
        DISCOVERY_ENGINE_STATE_STUB_ONLY,
        "wizard_stub_only",
      );
    }
    await refreshDiscoveryReadinessSnapshot({ force: true, rerender: false });
    setDiscoveryWizardMessage(
      "Stub-only wiring stays available, but it is not real discovery-ready.",
      "warning",
    );
    return moveDiscoveryWizardToStep("ready", {
      snapshot: getDiscoveryReadinessSnapshot(),
      state: {
        flow: "stub_only",
        completedSteps: [
          ...((runtime.state || {}).completedSteps || []),
          "detect",
          "stub_only",
        ],
        result: "stub_only",
      },
    });
  }
  if (actionId === "wizard_verify_existing_endpoint") {
    const relayApi = getDiscoveryWizardRelayApi();
    const endpointUrl = normalizeDiscoveryWebhookIdentity(
      runtime.drafts.endpointUrl || runtime.snapshot.savedWebhookUrl || "",
    );
    if (
      relayApi &&
      typeof relayApi.buildExternalEndpointValidationResult === "function"
    ) {
      const validation = relayApi.buildExternalEndpointValidationResult(
        endpointUrl,
        runtime.snapshot,
      );
      updateDiscoveryWizardRuntime({ lastVerificationResult: validation });
      if (!validation.ok && validation.kind === "invalid_endpoint") {
        showDiscoveryVerificationToast(validation, { context: "test_webhook" });
        setDiscoveryWizardMessage(validation.message, "warning");
        return renderDiscoverySetupWizard();
      }
    }
    return handleDiscoveryWizardVerification(endpointUrl, "test_webhook");
  }

  if (
    actionId === "local_bootstrap_refresh" ||
    actionId === "local_health_check" ||
    actionId === "local_tunnel_detect" ||
    actionId === "local_relay_apply" ||
    actionId === "local_verify_end_to_end"
  ) {
    const localApi = getDiscoveryWizardLocalApi();
    if (!localApi || typeof localApi.runLocalWizardAction !== "function") {
      console.warn(
        "[JobBored] discovery wizard local API missing; check discovery-wizard-local.js loaded",
      );
      showToast(
        "Discovery local helpers failed to load. Try a hard refresh (cache clear).",
        "error",
      );
      return null;
    }
    const result = await localApi.runLocalWizardAction(actionId, {
      snapshot: runtime.snapshot,
      state: runtime.state,
      wizardState: runtime.state,
      bootstrapState: runtime.localBootstrapState,
    });
    if (
      actionId === "local_tunnel_detect" &&
      result.ok &&
      result.suggestedUrl
    ) {
      writeDiscoveryTransportSetupState({
        tunnelPublicUrl: result.suggestedUrl,
      });
    }
    updateDiscoveryWizardRuntime({
      lastLocalResult: result,
      localBootstrapState: result.bootstrap
        ? { available: true, data: result.bootstrap }
        : runtime.localBootstrapState,
    });
    setDiscoveryWizardMessage(
      result.message || "Updated the local discovery path.",
      result.ok ? "info" : "warning",
    );
    let nextStep = result.nextStepId || runtime.activeStepId;
    let statePatch = result.wizardStatePatch || {};
    const stayOnStepAfterSuccess =
      result.ok &&
      (actionId === "local_health_check" || actionId === "local_tunnel_detect");
    if (stayOnStepAfterSuccess) {
      nextStep = runtime.activeStepId;
      if (
        result.wizardStatePatch &&
        typeof result.wizardStatePatch === "object"
      ) {
        statePatch = {
          ...result.wizardStatePatch,
          currentStep: runtime.activeStepId,
        };
      }
    }
    const detailOneLine =
      result.detail && typeof result.detail === "string"
        ? result.detail.replace(/\s+/g, " ").trim().slice(0, 220)
        : "";
    const toastText = [
      result.message || "",
      detailOneLine,
      stayOnStepAfterSuccess
        ? "Use the step rail above when you are ready for the next step."
        : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    showToast(
      toastText || (result.ok ? "Done." : "Something went wrong."),
      result.ok ? "success" : "warning",
    );
    if (result.ok && result.wizardStatePatch) {
      await persistDiscoveryWizardState(statePatch);
    }
    await refreshDiscoveryReadinessSnapshot({ force: true, rerender: false });
    const nextSnapshot = getDiscoveryReadinessSnapshot();
    return moveDiscoveryWizardToStep(nextStep, {
      snapshot: nextSnapshot,
      state: statePatch,
    });
  }

  if (
    actionId === "relay_copy_deploy_command" ||
    actionId === "relay_copy_agent_prompt" ||
    actionId === "relay_apply_worker_url"
  ) {
    const relayApi = getDiscoveryWizardRelayApi();
    if (!relayApi || typeof relayApi.runRelayWizardAction !== "function") {
      return null;
    }
    const relayResult = await relayApi.runRelayWizardAction(actionId, {
      snapshot: runtime.snapshot,
      workerUrl: runtime.drafts.workerUrl || runtime.snapshot.savedWebhookUrl,
      sheetId: getSettingsSheetIdValue() || "",
      origin:
        (window.location && typeof window.location.origin === "string"
          ? window.location.origin
          : "") || "*",
    });
    updateDiscoveryWizardRuntime({ lastRelayResult: relayResult });
    if (relayResult && relayResult.text) {
      copyTextToClipboard(relayResult.text);
      showToast("Copied to clipboard", "success");
      setDiscoveryWizardMessage("Copied relay setup text to the clipboard.");
      return renderDiscoverySetupWizard();
    }
    if (actionId === "relay_apply_worker_url") {
      if (!relayResult.ok) {
        const result = {
          ok: false,
          kind: relayResult.kind || "invalid_endpoint",
          message: relayResult.message || "Worker URL validation failed.",
          detail: relayResult.detail || "",
        };
        updateDiscoveryWizardRuntime({ lastVerificationResult: result });
        showDiscoveryVerificationToast(result, { context: "test_webhook" });
        setDiscoveryWizardMessage(result.message, "warning");
        return renderDiscoverySetupWizard();
      }
      mergeStoredConfigOverridePatch({ discoveryWebhookUrl: relayResult.url });
      await recordDiscoveryEngineState(
        relayResult.url,
        DISCOVERY_ENGINE_STATE_UNVERIFIED,
        "wizard_relay_apply",
      );
      await refreshDiscoveryReadinessSnapshot({ force: true, rerender: false });
      setDiscoveryWizardMessage("Worker URL saved — ready to test.");
      return moveDiscoveryWizardToStep("verify", {
        snapshot: getDiscoveryReadinessSnapshot(),
        state: {
          completedSteps: [
            ...((runtime.state || {}).completedSteps || []),
            "relay_deploy",
          ],
        },
      });
    }
    return null;
  }

  if (actionId === "wizard_verify_current_endpoint") {
    updateDiscoveryWizardRuntime({ lastDownstreamDiagnosis: null });
    const endpointUrl = normalizeDiscoveryWebhookIdentity(
      getDiscoveryWebhookUrl() ||
        runtime.drafts.workerUrl ||
        runtime.drafts.endpointUrl ||
        runtime.snapshot.savedWebhookUrl ||
        "",
    );
    return handleDiscoveryWizardVerification(endpointUrl, "test_webhook");
  }

  if (actionId === "diag_rerun_diagnosis") {
    const freshSnapshot = await refreshDiscoveryReadinessSnapshot({
      force: true,
      rerender: false,
    });
    const diagnosis = await diagnoseDownstreamChain(freshSnapshot);
    updateDiscoveryWizardRuntime({
      snapshot: freshSnapshot,
      lastDownstreamDiagnosis: diagnosis,
    });
    setDiscoveryWizardMessage(
      diagnosis.summary || "Diagnosis complete.",
      diagnosis.primaryFix ? "warning" : "info",
    );
    return renderDiscoverySetupWizard();
  }

  if (actionId === "diag_fix_local_server") {
    const freshSnapshot = await refreshDiscoveryReadinessSnapshot({
      force: true,
      rerender: false,
    });
    const diagnosis = await diagnoseDownstreamChain(freshSnapshot);
    updateDiscoveryWizardRuntime({
      snapshot: freshSnapshot,
      lastDownstreamDiagnosis: diagnosis,
    });
    if (diagnosis.localServer.healthy) {
      showToast("Server is running.", "success");
      setDiscoveryWizardMessage(
        "Server is healthy — try the test again.",
        "info",
      );
    } else {
      showToast("Server still down — go to the Server step for help.", "error");
      setDiscoveryWizardMessage(
        "Server not responding. Use the Server step to start it.",
        "warning",
      );
      return moveDiscoveryWizardToStep("local_health");
    }
    return renderDiscoverySetupWizard();
  }

  if (actionId === "diag_fix_tunnel") {
    return moveDiscoveryWizardToStep("tunnel");
  }

  if (actionId === "diag_fix_relay") {
    return moveDiscoveryWizardToStep("relay_deploy");
  }

  if (actionId === "diag_fix_update_tunnel_and_relay") {
    const diagnosis = runtime.lastDownstreamDiagnosis;
    const liveUrl = diagnosis && diagnosis.liveNgrokUrl;
    if (liveUrl && liveUrl !== "unknown") {
      writeDiscoveryTransportSetupState({ tunnelPublicUrl: liveUrl });
      const deployCommand =
        diagnosis && diagnosis.redeployCommand ? diagnosis.redeployCommand : "";
      showToast(
        "Live ngrok URL saved. Copy the command, paste it into a terminal in the Job-Bored repo, press Enter, then Test again.",
        "warning",
        true,
        createDiscoveryRelayCopyCommandToastAction(deployCommand),
      );
    }
    return moveDiscoveryWizardToStep("relay_deploy");
  }

  if (actionId === "diag_fix_reverify") {
    updateDiscoveryWizardRuntime({ lastDownstreamDiagnosis: null });
    const endpointUrl = normalizeDiscoveryWebhookIdentity(
      getDiscoveryWebhookUrl() ||
        runtime.drafts.workerUrl ||
        runtime.drafts.endpointUrl ||
        runtime.snapshot.savedWebhookUrl ||
        "",
    );
    return handleDiscoveryWizardVerification(endpointUrl, "test_webhook");
  }

  return null;
}

function setAppsScriptDeployStatus(tone, message, detail) {
  const extra = arguments.length > 3 ? arguments[3] : null;
  const actions = Array.isArray(extra)
    ? extra
    : extra && typeof extra === "object" && Array.isArray(extra.actions)
      ? extra.actions
      : [];
  const steps =
    extra && typeof extra === "object" && Array.isArray(extra.steps)
      ? extra.steps.map((step) => String(step || "").trim()).filter(Boolean)
      : [];
  appsScriptDeployStatus = {
    tone: tone || "info",
    message: String(message || ""),
    detail: detail ? String(detail) : "",
    steps,
    actions: actions
      .map((action) => ({
        label:
          action && action.label != null ? String(action.label).trim() : "",
        href: action && action.href != null ? String(action.href).trim() : "",
        primary: !!(action && action.primary),
      }))
      .filter((action) => action.label && action.href),
  };
  renderAppsScriptDeployUi();
}

function clearAppsScriptDeployStatus() {
  appsScriptDeployStatus = null;
  renderAppsScriptDeployUi();
}

const PENDING_DISCOVERY_SETUP_KEY = "pendingDiscoverySetup";

function stripSetupDiscoveryParam() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup") !== "discovery") return;
  params.delete("setup");
  const q = params.toString();
  const path =
    window.location.pathname + (q ? "?" + q : "") + window.location.hash;
  history.replaceState(null, "", path);
}

function focusDiscoveryWebhookFieldInSettings() {
  const Adapters = window.JobBoredSettingsDiscoveryAdapters;
  if (Adapters) {
    Adapters.focusDiscoveryWebhookField();
    return;
  }
  const el = document.getElementById("settingsDiscoveryWebhookUrl");
  if (!el) return;
  el.focus();
  if (typeof el.select === "function") el.select();
}

async function openSettingsForDiscoveryWebhook() {
  return openDiscoverySetupWizard({
    entryPoint: "settings",
    flow: getDiscoveryWizardRecommendedFlow(getDiscoveryReadinessSnapshot()),
  });
}

async function handleDiscoverySetupDeepLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup") !== "discovery") return;

  if (isOnboardingWizardVisible()) {
    try {
      sessionStorage.setItem(PENDING_DISCOVERY_SETUP_KEY, "1");
    } catch (_) {
      /* ignore */
    }
    stripSetupDiscoveryParam();
    return;
  }

  await openDiscoverySetupWizard({ entryPoint: "deep_link" });
  stripSetupDiscoveryParam();
}

function runPostAccessBootstrapOnce() {
  if (postAccessBootstrapDone) return;
  postAccessBootstrapDone = true;
  void (async () => {
    await checkOnboardingGate();
    await handleDiscoverySetupDeepLink();
  })();
}

/**
 * Scraper API base URL (no trailing slash).
 * Explicit config wins. If unset and the dashboard is opened on localhost, defaults
 * to the local server so `npm start` works without editing config. On GitHub Pages
 * (HTTPS), leave config empty unless you deploy a scraper — see DEPLOY-SCRAPER.md.
 */
function getJobPostingScrapeUrl() {
  const cfg = window.COMMAND_CENTER_CONFIG;
  const raw = cfg && cfg.jobPostingScrapeUrl;
  if (raw != null && String(raw).trim() !== "") {
    return String(raw).trim().replace(/\/+$/, "");
  }
  if (typeof window === "undefined") return "";
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
    return "http://127.0.0.1:3847";
  }
  return "";
}

function getAtsScoringConfig() {
  const cfg = window.COMMAND_CENTER_CONFIG || {};
  const rawMode = String(cfg.atsScoringMode || "server").toLowerCase();
  const mode = rawMode === "webhook" ? "webhook" : "server";
  const serverUrl = String(cfg.atsScoringServerUrl || "").trim();
  const webhookUrl = String(cfg.atsScoringWebhookUrl || "").trim();
  return {
    mode,
    serverUrl,
    webhookUrl,
  };
}

function getAtsScorecardApiUrl() {
  const cfg = getAtsScoringConfig();
  if (cfg.mode === "webhook") return cfg.webhookUrl;
  if (cfg.serverUrl) {
    const trimmed = cfg.serverUrl.replace(/\/+$/, "");
    return /\/api\/ats-scorecard$/i.test(trimmed)
      ? trimmed
      : `${trimmed}/api/ats-scorecard`;
  }
  if (typeof window === "undefined") return "";
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") {
    return "http://127.0.0.1:3847/api/ats-scorecard";
  }
  return "/api/ats-scorecard";
}

/**
 * HTTPS pages (e.g. GitHub Pages) cannot fetch http://127.0.0.1 — mixed content.
 */
function isScraperUrlBlockedOnThisPage(baseUrl) {
  if (!baseUrl) return false;
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  try {
    const u = new URL(baseUrl, window.location.href);
    if (u.protocol !== "http:") return false;
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

const SCRAPER_HTTPS_BLOCKED_HINT =
  "HTTPS pages (e.g. GitHub Pages) cannot call http://127.0.0.1 — the browser blocks it. Deploy the scraper to a public HTTPS URL and paste it in Settings, or run the app locally with npm start. See DEPLOY-SCRAPER.md.";

function openScraperSetupModal() {
  const modal = document.getElementById("scraperSetupModal");
  const result = document.getElementById("scraperTestResult");
  if (result) {
    result.textContent = "";
    result.className = "scraper-test-result";
  }
  if (modal) {
    modal.style.display = "flex";
    document.getElementById("scraperSetupDoneBtn")?.focus();
  }
}

function closeScraperSetupModal() {
  const modal = document.getElementById("scraperSetupModal");
  if (modal) modal.style.display = "none";
}

function copyTextToClipboard(text) {
  const t = String(text || "");
  if (!t) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(
      () => showToast("Copied to clipboard", "success"),
      () => showToast("Could not copy — select and copy manually", "info"),
    );
  } else {
    showToast("Clipboard not available", "info");
  }
}

async function runScraperConnectionTest() {
  const el = document.getElementById("settingsJobPostingScrapeUrl");
  const raw = (el && el.value.trim()) || "";
  const base = (raw || getJobPostingScrapeUrl() || "").replace(/\/+$/, "");
  const out = document.getElementById("scraperTestResult");
  if (out) {
    out.textContent = "Checking…";
    out.className = "scraper-test-result";
  }
  if (!base) {
    if (out) {
      out.textContent =
        "No URL — paste a deployed HTTPS scraper, or open this app on localhost (npm start).";
      out.className = "scraper-test-result scraper-test-result--bad";
    }
    showToast(
      "Set a scraper URL in Settings or use the setup guide for local npm start.",
      "error",
    );
    return;
  }
  if (isScraperUrlBlockedOnThisPage(base)) {
    if (out) {
      out.textContent =
        "Blocked: this HTTPS page cannot reach a local HTTP scraper. See DEPLOY-SCRAPER.md.";
      out.className = "scraper-test-result scraper-test-result--bad";
    }
    showToast(SCRAPER_HTTPS_BLOCKED_HINT, "error", true);
    return;
  }
  const url = `${base}/health`;
  try {
    const r = await fetch(url, { method: "GET", mode: "cors" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (j.ok) {
      if (out) {
        out.textContent = "Server reachable";
        out.className = "scraper-test-result scraper-test-result--ok";
      }
      showToast("Scraper server is running", "success");
    } else {
      throw new Error("Unexpected response");
    }
  } catch (e) {
    let msg =
      e && e.message
        ? String(e.message)
        : "Could not reach server — is npm start running?";
    if (isFetchNetworkError(e)) {
      msg =
        "Can't connect — start the server: cd server && npm start (leave the terminal open).";
    }
    if (out) {
      out.textContent = msg;
      out.className = "scraper-test-result scraper-test-result--bad";
    }
  }
}

/** True for offline / connection refused / CORS-style fetch failures */
function isFetchNetworkError(err) {
  if (!err) return false;
  const msg = String(err.message || err || "");
  const name = err.name || "";
  return (
    name === "TypeError" ||
    msg === "Failed to fetch" ||
    msg.includes("NetworkError") ||
    msg.includes("Network request failed") ||
    msg.includes("Load failed") ||
    msg.includes("CONNECTION_REFUSED")
  );
}

async function sha256Hex(text) {
  if (
    typeof crypto === "undefined" ||
    !crypto.subtle ||
    typeof TextEncoder === "undefined"
  ) {
    return "";
  }
  const bytes = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function loadAppsScriptStubBundle() {
  let codeResp;
  let manifestResp;
  try {
    [codeResp, manifestResp] = await Promise.all([
      fetch("integrations/apps-script/Code.gs", { cache: "no-store" }),
      fetch("integrations/apps-script/appsscript.json", { cache: "no-store" }),
    ]);
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(
        "Could not load the local Apps Script stub files from this site.",
      );
    }
    throw err;
  }
  if (!codeResp.ok || !manifestResp.ok) {
    throw new Error(
      "Could not load integrations/apps-script/Code.gs or appsscript.json.",
    );
  }

  const [codeSource, manifestText] = await Promise.all([
    codeResp.text(),
    manifestResp.text(),
  ]);

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    throw new Error(
      "integrations/apps-script/appsscript.json is not valid JSON.",
    );
  }

  manifest = manifest && typeof manifest === "object" ? manifest : {};
  manifest.webapp = {
    access: APPS_SCRIPT_WEBAPP_ACCESS,
    executeAs: APPS_SCRIPT_WEBAPP_EXECUTE_AS,
  };
  const manifestSource = JSON.stringify(manifest, null, 2);
  const stubHash = await sha256Hex(`${codeSource}\n---\n${manifestSource}`);

  return {
    files: [
      {
        name: "Code",
        type: "SERVER_JS",
        source: codeSource,
      },
      {
        name: "appsscript",
        type: "JSON",
        source: manifestSource,
      },
    ],
    stubHash,
  };
}

function formatAppsScriptDeployGisError(err) {
  const errType =
    err && typeof err === "object" && err.type != null ? String(err.type) : "";
  const msg =
    err && typeof err === "object" && err.message != null
      ? String(err.message)
      : String(err || "");
  if (
    errType === "popup_failed_to_open" ||
    errType === "popup_closed" ||
    /popup/i.test(msg)
  ) {
    return "Google permission prompt could not open. Allow popups for this site and try again.";
  }
  return "Google did not grant the Apps Script deploy permissions.";
}

function requestAppsScriptDeployAccessToken() {
  const clientId = getSettingsOAuthClientIdValue();
  if (!clientId) {
    return Promise.reject(
      new Error("Add an OAuth Client ID above before deploying."),
    );
  }
  if (hasUnsavedOAuthClientIdChange(clientId)) {
    return Promise.reject(
      new Error(
        "Save Settings first so the page reloads with this OAuth client ID, then retry Deploy.",
      ),
    );
  }
  if (
    !gisLoaded ||
    typeof google === "undefined" ||
    !google.accounts ||
    !google.accounts.oauth2
  ) {
    return Promise.reject(
      new Error("Google sign-in is still loading. Try again in a moment."),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    let client;
    try {
      client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: APPS_SCRIPT_DEPLOY_SCOPES.join(" "),
        include_granted_scopes: true,
        login_hint: userEmail || undefined,
        callback: (tokenResponse) => {
          if (!tokenResponse || tokenResponse.error) {
            finish(
              reject,
              new Error(
                tokenResponse && tokenResponse.error_description
                  ? tokenResponse.error_description
                  : tokenResponse && tokenResponse.error
                    ? tokenResponse.error
                    : "Google did not return a deploy token.",
              ),
            );
            return;
          }
          if (
            google.accounts.oauth2.hasGrantedAllScopes &&
            !google.accounts.oauth2.hasGrantedAllScopes(
              tokenResponse,
              ...APPS_SCRIPT_DEPLOY_SCOPES,
            )
          ) {
            finish(
              reject,
              new Error(
                "Google did not grant all required Apps Script deploy scopes.",
              ),
            );
            return;
          }
          finish(resolve, tokenResponse.access_token);
        },
        error_callback: (err) => {
          finish(reject, new Error(formatAppsScriptDeployGisError(err)));
        },
      });
      client.requestAccessToken({
        prompt: userEmail ? "" : "select_account",
      });
    } catch (err) {
      finish(reject, err);
    }
  });
}

async function readAppsScriptApiError(resp) {
  const raw = await resp.text().catch(() => "");
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    data = null;
  }
  const message =
    (data &&
      data.error &&
      typeof data.error === "object" &&
      String(data.error.message || "").trim()) ||
    (data && typeof data.message === "string" && data.message.trim()) ||
    raw.trim() ||
    `HTTP ${resp.status}`;

  const detailTexts = [];
  const detailUrls = [];
  const details =
    data && data.error && Array.isArray(data.error.details)
      ? data.error.details
      : [];

  for (const item of details) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.message === "string" && item.message.trim()) {
      detailTexts.push(item.message.trim());
    }
    if (Array.isArray(item.links)) {
      for (const link of item.links) {
        if (
          link &&
          typeof link === "object" &&
          typeof link.url === "string" &&
          link.url.trim()
        ) {
          detailUrls.push(link.url.trim());
        }
      }
    }
  }

  const urlMatches = `${message}\n${detailTexts.join("\n")}`.match(
    /https:\/\/[^\s)"'<>]+/g,
  );
  if (urlMatches) detailUrls.push(...urlMatches);

  const uniqueUrls = Array.from(
    new Set(
      detailUrls.map((url) =>
        String(url || "")
          .replace(/[.,;:]+$/g, "")
          .trim(),
      ),
    ),
  ).filter(Boolean);

  const fullText = [message, ...detailTexts].filter(Boolean).join(" ");

  if (
    /User has not enabled the Apps Script API/i.test(fullText) ||
    /script\.google\.com\/home\/usersettings/i.test(fullText)
  ) {
    const settingsUrl =
      uniqueUrls.find((url) =>
        /script\.google\.com\/home\/usersettings/i.test(url),
      ) || "https://script.google.com/home/usersettings";
    const err = new Error(message);
    err.deployStatus = {
      tone: "error",
      message: "Enable Apps Script API access in Apps Script user settings.",
      detail:
        "Google says your account has not enabled Apps Script API access for script projects. Open Apps Script user settings, turn on Google Apps Script API access, wait a minute, then retry.",
      actions: [
        {
          label: "Open Apps Script user settings",
          href: settingsUrl,
        },
      ],
    };
    return err;
  }

  if (
    /SERVICE_DISABLED|API has not been used|Access Not Configured|enable it/i.test(
      fullText,
    )
  ) {
    const cloudUrl =
      uniqueUrls.find((url) => /script\.googleapis\.com/i.test(url)) ||
      "https://console.cloud.google.com/apis/library/script.googleapis.com";
    const err = new Error(message);
    err.deployStatus = {
      tone: "error",
      message:
        "Enable Google Apps Script API in the Google Cloud project behind this OAuth client.",
      detail:
        "Google is saying script.googleapis.com is still disabled for the Cloud project that owns this OAuth client ID. Enable it, wait a minute, then retry.",
      actions: [
        {
          label: "Open Apps Script API in Cloud Console",
          href: cloudUrl,
        },
        {
          label: "Open Apps Script user settings",
          href: "https://script.google.com/home/usersettings",
        },
      ],
    };
    return err;
  }

  if (/origin_mismatch/i.test(fullText)) {
    const err = new Error(message);
    err.deployStatus = {
      tone: "error",
      message: "This OAuth client does not allow the current site origin.",
      detail:
        "Add this site under Authorized JavaScript origins in Google Cloud Console, then retry the deploy.",
      actions: [
        {
          label: "Open OAuth clients in Cloud Console",
          href: "https://console.cloud.google.com/auth/clients",
        },
      ],
    };
    return err;
  }

  if (resp.status === 401) {
    const err = new Error(message);
    err.deployStatus = {
      tone: "error",
      message: "Google session expired while deploying.",
      detail: "Retry Deploy and complete the Google permission prompt again.",
      actions: [],
    };
    return err;
  }

  const err = new Error(message);
  err.deployStatus = {
    tone: "error",
    message: "Apps Script deploy failed.",
    detail: message,
    actions: uniqueUrls.length
      ? uniqueUrls.slice(0, 2).map((url) => ({
          label: /script\.google\.com/i.test(url)
            ? "Open Google guidance"
            : "Open related Google console page",
          href: url,
        }))
      : [],
  };
  return err;
}

async function appsScriptApiRequest(path, deployToken, init) {
  const opts = init && typeof init === "object" ? { ...init } : {};
  const headers = new Headers(opts.headers || {});
  headers.set("Authorization", `Bearer ${deployToken}`);
  headers.set("Accept", "application/json");
  if (opts.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const body =
    opts.body != null && typeof opts.body !== "string"
      ? JSON.stringify(opts.body)
      : opts.body;

  let resp;
  try {
    resp = await fetch(`${APPS_SCRIPT_API_BASE}${path}`, {
      ...opts,
      headers,
      body,
    });
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error(
        "Could not reach the Google Apps Script API from this browser.",
      );
    }
    throw err;
  }

  if (!resp.ok) {
    throw await readAppsScriptApiError(resp);
  }
  if (resp.status === 204) return null;
  return resp.json().catch(() => ({}));
}

function getAppsScriptDeployStateStore() {
  const UC = window.CommandCenterUserContent;
  return UC &&
    typeof UC.getAppsScriptDeployState === "function" &&
    typeof UC.saveAppsScriptDeployState === "function"
    ? UC
    : null;
}

async function populateAppsScriptDeployStateIntoSettingsForm() {
  const store = getAppsScriptDeployStateStore();
  if (!store) {
    appsScriptDeployStateCache = null;
    renderAppsScriptDeployUi();
    return;
  }
  try {
    appsScriptDeployStateCache = await store.getAppsScriptDeployState();
  } catch (err) {
    console.warn("[JobBored] Apps Script deploy state:", err);
    appsScriptDeployStateCache = null;
    appsScriptDeployStatus = {
      tone: "error",
      message: "Could not load saved Apps Script deploy state.",
      detail: err && err.message ? String(err.message) : "",
    };
  }
  renderAppsScriptDeployUi();
}

function extractWebAppUrlFromDeployment(deployment) {
  const webApp = extractWebAppEntryPointFromDeployment(deployment);
  return webApp.url;
}

function extractWebAppEntryPointFromDeployment(deployment) {
  const entryPoints = Array.isArray(deployment && deployment.entryPoints)
    ? deployment.entryPoints
    : [];
  for (const entryPoint of entryPoints) {
    const webApp =
      entryPoint &&
      entryPoint.entryPointType === "WEB_APP" &&
      entryPoint.webApp &&
      typeof entryPoint.webApp === "object"
        ? entryPoint.webApp
        : null;
    const config =
      webApp &&
      webApp.entryPointConfig &&
      typeof webApp.entryPointConfig === "object"
        ? webApp.entryPointConfig
        : null;
    if (webApp && typeof webApp.url === "string" && webApp.url.trim()) {
      return {
        url: webApp.url.trim(),
        access:
          config && typeof config.access === "string"
            ? config.access.trim()
            : "",
        executeAs:
          config && typeof config.executeAs === "string"
            ? config.executeAs.trim()
            : "",
      };
    }
  }
  return { url: "", access: "", executeAs: "" };
}

async function fetchAppsScriptDeployment(scriptId, deploymentId, deployToken) {
  return appsScriptApiRequest(
    `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
    deployToken,
    { method: "GET" },
  );
}

function buildAppsScriptPublicProbeUrl(webAppUrl, callbackName) {
  const url = new URL(webAppUrl);
  url.searchParams.set("commandCenterProbe", "1");
  url.searchParams.set("callback", callbackName);
  return url.toString();
}

async function probeAppsScriptWebAppPublicAccess(webAppUrl) {
  if (typeof document === "undefined" || !document.createElement) {
    return { ok: false, reason: "unsupported" };
  }
  return new Promise((resolve) => {
    let settled = false;
    const callbackName = `__jbAppsScriptProbe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement("script");
    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      try {
        delete window[callbackName];
      } catch (_) {
        window[callbackName] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(result);
    };
    const timeoutId = window.setTimeout(() => {
      cleanup({ ok: false, reason: "timeout" });
    }, 12000);

    window[callbackName] = (payload) => {
      window.clearTimeout(timeoutId);
      if (
        payload &&
        payload.ok === true &&
        payload.service === "command-center-apps-script-stub"
      ) {
        cleanup({ ok: true, payload });
        return;
      }
      cleanup({ ok: false, reason: "invalid-payload", payload });
    };

    script.async = true;
    script.src = buildAppsScriptPublicProbeUrl(webAppUrl, callbackName);
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      cleanup({ ok: false, reason: "load-error" });
    };
    (document.head || document.documentElement || document.body).appendChild(
      script,
    );
  });
}

async function verifyAppsScriptDeploymentPublicAccess(
  scriptId,
  deploymentId,
  deployToken,
  existingDeployment,
) {
  const deployment =
    existingDeployment &&
    existingDeployment.deploymentId &&
    String(existingDeployment.deploymentId).trim() ===
      String(deploymentId || "").trim()
      ? existingDeployment
      : await fetchAppsScriptDeployment(scriptId, deploymentId, deployToken);

  const webAppEntry = extractWebAppEntryPointFromDeployment(deployment);
  if (!webAppEntry.url) {
    throw new Error(
      "Google deployed the script but did not return a web app /exec URL.",
    );
  }

  const statePatch = {
    webAppUrl: webAppEntry.url,
    access: webAppEntry.access || "",
    executeAs: webAppEntry.executeAs || "",
    deploymentAccess: webAppEntry.access || "",
    deploymentExecuteAs: webAppEntry.executeAs || "",
    publicAccessCheckedAt: new Date().toISOString(),
  };

  if (
    webAppEntry.access !== APPS_SCRIPT_WEBAPP_ACCESS ||
    webAppEntry.executeAs !== APPS_SCRIPT_WEBAPP_EXECUTE_AS
  ) {
    return {
      ready: false,
      statePatch: {
        ...statePatch,
        publicAccessState: APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION,
        publicAccessIssue: "deployment-config",
      },
      deployStatus: buildAppsScriptPublicAccessRemediationStatus({
        scriptId,
        webAppUrl: webAppEntry.url,
        deploymentAccess: webAppEntry.access,
        deploymentExecuteAs: webAppEntry.executeAs,
        failureKind: "deployment-config",
      }),
    };
  }

  const probe = await probeAppsScriptWebAppPublicAccess(webAppEntry.url);
  if (!probe.ok) {
    return {
      ready: false,
      statePatch: {
        ...statePatch,
        publicAccessState: APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION,
        publicAccessIssue: "probe",
      },
      deployStatus: buildAppsScriptPublicAccessRemediationStatus({
        scriptId,
        webAppUrl: webAppEntry.url,
        deploymentAccess: webAppEntry.access,
        deploymentExecuteAs: webAppEntry.executeAs,
        failureKind: "probe",
      }),
    };
  }

  return {
    ready: true,
    statePatch: {
      ...statePatch,
      publicAccessState: APPS_SCRIPT_PUBLIC_ACCESS_READY,
      publicAccessIssue: "",
    },
    deployStatus: null,
  };
}

function renderDiscoveryEngineStatusUi() {
  const statusCard = document.getElementById("settingsDiscoveryEngineStatus");
  const statusTitle = document.getElementById(
    "settingsDiscoveryEngineStatusTitle",
  );
  const statusDetail = document.getElementById(
    "settingsDiscoveryEngineStatusDetail",
  );
  const statusActions = document.getElementById(
    "settingsDiscoveryEngineStatusActions",
  );
  const chip = document.getElementById("discoveryStatusChip");
  const note = document.getElementById("discoveryStatusNote");
  const snapshot = getDiscoveryReadinessSnapshot();
  const view = getDiscoverySettingsView(snapshot);
  const status = getEffectiveDiscoveryEngineStatus(
    snapshot.savedWebhookUrl || getDiscoveryWebhookUrlForSettingsPreview(),
  );
  const tone = String(view.tone || status.tone || "info");

  if (chip) {
    chip.hidden = !view.chipLabel;
    chip.className = `discovery-state-chip discovery-state-chip--${view.chipTone || tone}`;
    chip.textContent = view.chipLabel || "";
  }

  if (note) {
    const noteText = view.primaryActionHint || view.detail || "";
    if (!noteText) {
      note.hidden = true;
      note.textContent = "";
    } else {
      note.hidden = false;
      note.textContent = noteText;
    }
  }

  if (!statusCard || !statusTitle || !statusDetail || !statusActions) return;

  statusCard.className = `settings-apps-script-status settings-apps-script-status--${tone}`;
  statusTitle.textContent = view.title || status.label;
  statusDetail.textContent = view.detail || status.detail;
  statusActions.innerHTML = "";

  if (view.primaryActionLabel) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "settings-apps-script-status__action btn-discovery-setup";
    button.textContent = view.primaryActionLabel;
    if (view.primaryActionHint) {
      button.title = view.primaryActionHint;
    }
    button.addEventListener("click", () => {
      void openDiscoverySetupWizard({ entryPoint: "settings" });
    });
    statusActions.appendChild(button);
  }

  const actions = buildDiscoveryStatusActions(status);
  for (const action of actions) {
    const link = document.createElement("a");
    link.className = action.primary
      ? "settings-apps-script-status__action btn-discovery-setup"
      : "settings-apps-script-status__action btn-discovery-setup btn-discovery-setup--secondary";
    link.href = action.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = action.label;
    statusActions.appendChild(link);
  }
  statusActions.hidden = statusActions.childElementCount === 0;
}

function renderAppsScriptDeployUi() {
  const deployBtn = document.getElementById("settingsAppsScriptDeployBtn");
  const recheckBtn = document.getElementById("settingsAppsScriptRecheckBtn");
  const openBtn = document.getElementById("settingsAppsScriptOpenBtn");
  const copyBtn = document.getElementById("settingsAppsScriptCopyBtn");
  const statusCard = document.getElementById("settingsAppsScriptStatus");
  const statusTitle = document.getElementById("settingsAppsScriptStatusTitle");
  const statusDetail = document.getElementById(
    "settingsAppsScriptStatusDetail",
  );
  const statusSteps = document.getElementById("settingsAppsScriptStatusSteps");
  const statusUrlRow = document.getElementById("settingsAppsScriptUrlRow");
  const statusUrl = document.getElementById("settingsAppsScriptUrl");
  const statusActions = document.getElementById(
    "settingsAppsScriptStatusActions",
  );
  if (!deployBtn || !statusCard || !statusTitle || !statusDetail) return;

  const state = appsScriptDeployStateCache;
  const hasManaged = isManagedAppsScriptDeployState(state);
  const publicAccessReady = isAppsScriptPublicAccessReady(state);
  const scriptId =
    state && typeof state.scriptId === "string" ? state.scriptId.trim() : "";
  const webAppUrl =
    state && typeof state.webAppUrl === "string" ? state.webAppUrl.trim() : "";
  const clientId = getSettingsOAuthClientIdValue();
  const sheetId = getSettingsSheetIdValue();
  const needsOAuthReload = hasUnsavedOAuthClientIdChange(clientId);

  deployBtn.textContent = appsScriptDeployBusy
    ? "Deploying..."
    : hasManaged
      ? "Re-deploy managed Apps Script"
      : "Deploy Google Apps Script stub";
  deployBtn.disabled =
    appsScriptDeployBusy ||
    !clientId ||
    !sheetId ||
    needsOAuthReload ||
    !gisLoaded;

  if (!clientId) {
    deployBtn.title = "Add an OAuth Client ID above first";
  } else if (needsOAuthReload) {
    deployBtn.title =
      "Save Settings so the page reloads with this OAuth client";
  } else if (!sheetId) {
    deployBtn.title = "Paste a spreadsheet URL or Sheet ID above first";
  } else if (!gisLoaded) {
    deployBtn.title = "Google sign-in is still loading";
  } else {
    deployBtn.title = hasManaged
      ? "Upload the latest stub and refresh the managed web app deployment"
      : "Create and deploy a new managed Apps Script web app";
  }

  if (openBtn) {
    const href = getAppsScriptEditorUrl(scriptId);
    openBtn.hidden = !href;
    openBtn.href = href || "#";
  }
  if (recheckBtn) {
    recheckBtn.hidden =
      !hasManaged || publicAccessReady || appsScriptDeployBusy || !scriptId;
    recheckBtn.disabled =
      appsScriptDeployBusy || !gisLoaded || !clientId || needsOAuthReload;
    if (!clientId) {
      recheckBtn.title = "Add an OAuth Client ID above first";
    } else if (needsOAuthReload) {
      recheckBtn.title =
        "Save Settings so the page reloads with this OAuth client";
    } else if (!gisLoaded) {
      recheckBtn.title = "Google sign-in is still loading";
    } else {
      recheckBtn.title =
        "Re-read the managed deployment and rerun the anonymous public-access probe";
    }
  }
  if (copyBtn) {
    copyBtn.hidden = !webAppUrl;
    copyBtn.disabled = !webAppUrl;
  }
  if (statusActions) {
    statusActions.innerHTML = "";
  }
  if (statusSteps) {
    statusSteps.innerHTML = "";
    statusSteps.hidden = true;
  }

  let tone = "info";
  let message =
    "Create a new Apps Script stub in your Google Drive and save its /exec URL here.";
  let detail =
    "This keeps webhook verification in your account. Browser -> /exec requests may still need a proxy or server-side POST if CORS blocks them, and the stub still needs real discovery logic before it can add jobs.";
  let effectiveStatus = appsScriptDeployStatus;

  if (appsScriptDeployStatus && appsScriptDeployStatus.message) {
    tone = appsScriptDeployStatus.tone || "info";
    message = appsScriptDeployStatus.message;
    detail = appsScriptDeployStatus.detail || "";
  } else if (!clientId) {
    tone = "warning";
    message = "Add an OAuth Client ID above to deploy from the dashboard.";
    detail =
      "Use the same Google OAuth web client you use for Sheets access on this site.";
  } else if (!sheetId) {
    tone = "warning";
    message = "Paste a spreadsheet URL or Sheet ID above first.";
    detail =
      "The deploy flow saves the resulting /exec URL for the sheet you’re configuring.";
  } else if (needsOAuthReload) {
    effectiveStatus = buildAppsScriptGisNotReadyStatus(clientId);
    tone = effectiveStatus.tone;
    message = effectiveStatus.message;
    detail = effectiveStatus.detail;
  } else if (!gisLoaded) {
    effectiveStatus = buildAppsScriptGisNotReadyStatus(clientId);
    tone = effectiveStatus.tone;
    message = effectiveStatus.message;
    detail = effectiveStatus.detail;
  } else if (hasManaged && !publicAccessReady) {
    const remediation = buildAppsScriptPublicAccessRemediationStatus({
      scriptId,
      webAppUrl,
      deploymentAccess:
        state && typeof state.deploymentAccess === "string"
          ? state.deploymentAccess
          : state && typeof state.access === "string"
            ? state.access
            : "",
      deploymentExecuteAs:
        state && typeof state.deploymentExecuteAs === "string"
          ? state.deploymentExecuteAs
          : state && typeof state.executeAs === "string"
            ? state.executeAs
            : "",
      failureKind:
        state && typeof state.publicAccessIssue === "string"
          ? state.publicAccessIssue
          : "",
    });
    tone = remediation.tone;
    message = remediation.message;
    detail = remediation.detail;
    effectiveStatus = remediation;
  } else if (hasManaged) {
    tone = "success";
    message = "Managed Apps Script stub ready.";
    detail =
      "The saved web app URL passed the public-access check, but this managed deploy is still only a webhook stub. It can verify wiring, not discover real jobs.";
  }

  statusCard.className = `settings-apps-script-status settings-apps-script-status--${tone}`;
  statusTitle.textContent = message;
  statusDetail.textContent = detail;
  if (
    statusSteps &&
    effectiveStatus &&
    Array.isArray(effectiveStatus.steps) &&
    effectiveStatus.steps.length
  ) {
    for (const step of effectiveStatus.steps) {
      const item = document.createElement("li");
      item.textContent = step;
      statusSteps.appendChild(item);
    }
    statusSteps.hidden = false;
  }
  if (
    statusActions &&
    effectiveStatus &&
    Array.isArray(effectiveStatus.actions) &&
    effectiveStatus.actions.length
  ) {
    for (const action of effectiveStatus.actions) {
      const link = document.createElement("a");
      link.className = action.primary
        ? "settings-apps-script-status__action btn-discovery-setup"
        : "settings-apps-script-status__action btn-discovery-setup btn-discovery-setup--secondary";
      link.href = action.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = action.label;
      statusActions.appendChild(link);
    }
    statusActions.hidden = false;
  } else if (statusActions) {
    statusActions.hidden = true;
  }

  if (statusUrlRow && statusUrl) {
    const hideRawExecUrl = hasManaged && !publicAccessReady && webAppUrl;
    statusUrlRow.hidden = !webAppUrl || hideRawExecUrl;
    statusUrl.textContent = webAppUrl;
  }
  renderDiscoveryEngineStatusUi();
}

async function deployAppsScriptStubFromSettings() {
  if (appsScriptDeployBusy) return;

  const sheetId = getSettingsSheetIdValue();
  if (!sheetId) {
    setAppsScriptDeployStatus(
      "warning",
      "Paste a spreadsheet URL or Sheet ID above first.",
    );
    return;
  }

  const oauthClientId = getSettingsOAuthClientIdValue();
  if (!oauthClientId) {
    setAppsScriptDeployStatus(
      "warning",
      "Add an OAuth Client ID above before deploying.",
    );
    return;
  }

  appsScriptDeployBusy = true;
  renderAppsScriptDeployUi();

  try {
    setAppsScriptDeployStatus(
      "info",
      "Requesting Google Apps Script deploy permissions…",
    );
    const deployToken = await requestAppsScriptDeployAccessToken();

    setAppsScriptDeployStatus("info", "Loading the repo’s Apps Script stub…");
    const stub = await loadAppsScriptStubBundle();

    const existingState = isManagedAppsScriptDeployState(
      appsScriptDeployStateCache,
    )
      ? appsScriptDeployStateCache
      : null;

    let scriptId =
      existingState && existingState.scriptId
        ? String(existingState.scriptId).trim()
        : "";
    let deploymentId =
      existingState && existingState.deploymentId
        ? String(existingState.deploymentId).trim()
        : "";

    if (!scriptId) {
      setAppsScriptDeployStatus("info", "Creating a new Apps Script project…");
      const project = await appsScriptApiRequest("/projects", deployToken, {
        method: "POST",
        body: { title: APPS_SCRIPT_PROJECT_TITLE },
      });
      scriptId = String(
        project && project.scriptId ? project.scriptId : "",
      ).trim();
      if (!scriptId) {
        throw new Error(
          "Google created a project but did not return a scriptId.",
        );
      }
    }

    setAppsScriptDeployStatus("info", "Uploading Code.gs and appsscript.json…");
    await appsScriptApiRequest(
      `/projects/${encodeURIComponent(scriptId)}/content`,
      deployToken,
      {
        method: "PUT",
        body: { files: stub.files },
      },
    );

    setAppsScriptDeployStatus("info", "Creating a new script version…");
    const version = await appsScriptApiRequest(
      `/projects/${encodeURIComponent(scriptId)}/versions`,
      deployToken,
      {
        method: "POST",
        body: { description: "Command Center dashboard deploy" },
      },
    );
    const versionNumber =
      Number(version && version.versionNumber) > 0
        ? Number(version.versionNumber)
        : null;
    if (!versionNumber) {
      throw new Error(
        "Google created a version but did not return a version number.",
      );
    }

    let deployment;
    if (deploymentId) {
      setAppsScriptDeployStatus(
        "info",
        "Updating the managed web app deployment…",
      );
      deployment = await appsScriptApiRequest(
        `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
        deployToken,
        {
          method: "PUT",
          body: {
            deploymentConfig: {
              scriptId,
              versionNumber,
              manifestFileName: "appsscript",
              description: "Command Center dashboard deploy",
            },
          },
        },
      );
    } else {
      setAppsScriptDeployStatus("info", "Creating the web app deployment…");
      deployment = await appsScriptApiRequest(
        `/projects/${encodeURIComponent(scriptId)}/deployments`,
        deployToken,
        {
          method: "POST",
          body: {
            versionNumber,
            manifestFileName: "appsscript",
            description: "Command Center dashboard deploy",
          },
        },
      );
    }

    deploymentId = String(
      deployment && deployment.deploymentId ? deployment.deploymentId : "",
    ).trim();
    const webAppUrl = extractWebAppUrlFromDeployment(deployment);
    if (!deploymentId || !webAppUrl) {
      throw new Error(
        "Google deployed the script but did not return a web app /exec URL.",
      );
    }

    setAppsScriptDeployStatus(
      "info",
      "Checking that Google published the web app as public…",
      "Command Center will not save this /exec URL as ready until an anonymous public-access probe succeeds.",
    );
    const readiness = await verifyAppsScriptDeploymentPublicAccess(
      scriptId,
      deploymentId,
      deployToken,
      deployment,
    );

    const store = getAppsScriptDeployStateStore();
    let nextState = {
      managedBy: APPS_SCRIPT_MANAGED_BY,
      origin: window.location.origin || "",
      ownerEmail: userEmail || "",
      scriptId,
      deploymentId,
      webAppUrl,
      executeAs: APPS_SCRIPT_WEBAPP_EXECUTE_AS,
      access: APPS_SCRIPT_WEBAPP_ACCESS,
      projectTitle: APPS_SCRIPT_PROJECT_TITLE,
      lastVersionNumber: versionNumber,
      stubHash: stub.stubHash,
      lastDeployedAt: new Date().toISOString(),
      ...readiness.statePatch,
    };
    if (store) {
      nextState = await store.saveAppsScriptDeployState(nextState);
      if (readiness.ready && typeof store.saveAgentChecklist === "function") {
        await store.saveAgentChecklist({ webhookConfigured: true });
      }
    }
    appsScriptDeployStateCache = nextState;

    if (!readiness.ready) {
      setAppsScriptDeployStatus(
        readiness.deployStatus.tone || "error",
        readiness.deployStatus.message ||
          "Apps Script public-access check failed.",
        readiness.deployStatus.detail || "",
        {
          actions: Array.isArray(readiness.deployStatus.actions)
            ? readiness.deployStatus.actions
            : [],
          steps: Array.isArray(readiness.deployStatus.steps)
            ? readiness.deployStatus.steps
            : [],
        },
      );
      return;
    }

    const urlField = document.getElementById("settingsDiscoveryWebhookUrl");
    if (urlField) urlField.value = webAppUrl;
    mergeStoredConfigOverridePatch({
      sheetId,
      oauthClientId,
      discoveryWebhookUrl: webAppUrl,
    });
    await recordDiscoveryEngineState(
      webAppUrl,
      DISCOVERY_ENGINE_STATE_STUB_ONLY,
      "managed_apps_script_deploy",
    );
    syncDiscoveryButtonState();

    setAppsScriptDeployStatus(
      "success",
      "Apps Script stub deployed and webhook URL was saved.",
      "This confirms webhook wiring only. Use Test webhook for smoke tests, then connect a real discovery engine or replace the stub logic before expecting job rows.",
    );
  } catch (err) {
    console.error("[JobBored] Apps Script deploy:", err);
    const deployStatus =
      err && err.deployStatus && typeof err.deployStatus === "object"
        ? err.deployStatus
        : null;
    if (deployStatus) {
      setAppsScriptDeployStatus(
        deployStatus.tone || "error",
        deployStatus.message || "Apps Script deploy failed.",
        deployStatus.detail || (err && err.message ? String(err.message) : ""),
        Array.isArray(deployStatus.actions) ? deployStatus.actions : [],
      );
    } else {
      setAppsScriptDeployStatus(
        "error",
        "Apps Script deploy failed.",
        err && err.message ? String(err.message) : "Unknown error",
      );
    }
  } finally {
    appsScriptDeployBusy = false;
    renderAppsScriptDeployUi();
  }
}

async function recheckAppsScriptPublicAccessFromSettings() {
  if (appsScriptDeployBusy) return;
  const state = appsScriptDeployStateCache;
  if (!isManagedAppsScriptDeployState(state)) return;

  const scriptId =
    state && typeof state.scriptId === "string" ? state.scriptId.trim() : "";
  const deploymentId =
    state && typeof state.deploymentId === "string"
      ? state.deploymentId.trim()
      : "";
  const webAppUrl =
    state && typeof state.webAppUrl === "string" ? state.webAppUrl.trim() : "";
  if (!scriptId || !deploymentId) return;

  const sheetId = getSettingsSheetIdValue();
  const oauthClientId = getSettingsOAuthClientIdValue();
  if (!oauthClientId) {
    setAppsScriptDeployStatus(
      "warning",
      "Add an OAuth Client ID above before re-checking.",
    );
    return;
  }

  appsScriptDeployBusy = true;
  renderAppsScriptDeployUi();
  try {
    setAppsScriptDeployStatus(
      "info",
      "Re-checking Google web app public access…",
      "This does not redeploy code. It only re-reads the managed deployment and reruns the anonymous public-access probe.",
    );
    const deployToken = await requestAppsScriptDeployAccessToken();
    const readiness = await verifyAppsScriptDeploymentPublicAccess(
      scriptId,
      deploymentId,
      deployToken,
      null,
    );

    const store = getAppsScriptDeployStateStore();
    let nextState = {
      ...(state && typeof state === "object" ? state : {}),
      ...readiness.statePatch,
      webAppUrl: readiness.statePatch.webAppUrl || webAppUrl,
      lastDeployedAt:
        state && typeof state.lastDeployedAt === "string"
          ? state.lastDeployedAt
          : "",
    };

    if (store) {
      nextState = await store.saveAppsScriptDeployState(nextState);
      if (readiness.ready && typeof store.saveAgentChecklist === "function") {
        await store.saveAgentChecklist({ webhookConfigured: true });
      }
    }
    appsScriptDeployStateCache = nextState;

    if (!readiness.ready) {
      setAppsScriptDeployStatus(
        readiness.deployStatus.tone || "error",
        readiness.deployStatus.message ||
          "Apps Script public-access check failed.",
        readiness.deployStatus.detail || "",
        {
          actions: Array.isArray(readiness.deployStatus.actions)
            ? readiness.deployStatus.actions
            : [],
          steps: Array.isArray(readiness.deployStatus.steps)
            ? readiness.deployStatus.steps
            : [],
        },
      );
      return;
    }

    const finalWebAppUrl =
      readiness.statePatch.webAppUrl || nextState.webAppUrl || webAppUrl;
    const urlField = document.getElementById("settingsDiscoveryWebhookUrl");
    if (urlField) urlField.value = finalWebAppUrl;
    mergeStoredConfigOverridePatch({
      ...(sheetId ? { sheetId } : {}),
      ...(oauthClientId ? { oauthClientId } : {}),
      discoveryWebhookUrl: finalWebAppUrl,
    });
    await recordDiscoveryEngineState(
      finalWebAppUrl,
      DISCOVERY_ENGINE_STATE_STUB_ONLY,
      "managed_apps_script_recheck",
    );
    syncDiscoveryButtonState();

    setAppsScriptDeployStatus(
      "success",
      "Apps Script stub now passes the public-access check and webhook URL was saved.",
      "This still leaves discovery in stub-only mode. Use Test webhook for smoke tests, and connect a real discovery engine before expecting Pipeline rows.",
    );
  } catch (err) {
    console.error("[JobBored] Apps Script public access re-check:", err);
    const deployStatus =
      err && err.deployStatus && typeof err.deployStatus === "object"
        ? err.deployStatus
        : null;
    if (deployStatus) {
      setAppsScriptDeployStatus(
        deployStatus.tone || "error",
        deployStatus.message || "Apps Script public-access check failed.",
        deployStatus.detail || (err && err.message ? String(err.message) : ""),
        {
          actions: Array.isArray(deployStatus.actions)
            ? deployStatus.actions
            : [],
          steps: Array.isArray(deployStatus.steps) ? deployStatus.steps : [],
        },
      );
    } else {
      setAppsScriptDeployStatus(
        "error",
        "Apps Script public-access check failed.",
        err && err.message ? String(err.message) : "Unknown error",
      );
    }
  } finally {
    appsScriptDeployBusy = false;
    renderAppsScriptDeployUi();
  }
}

function initScraperSetupGuide() {
  document
    .getElementById("openScraperSetupFromSettings")
    ?.addEventListener("click", () => openScraperSetupModal());
  document
    .getElementById("scraperSetupModalClose")
    ?.addEventListener("click", closeScraperSetupModal);
  document
    .getElementById("scraperSetupDoneBtn")
    ?.addEventListener("click", closeScraperSetupModal);
  document
    .getElementById("scraperTestConnectionBtn")
    ?.addEventListener("click", () => runScraperConnectionTest());

  document
    .querySelectorAll(".btn-copy-scraper[data-copy-text]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-copy-text");
        if (text) copyTextToClipboard(text);
      });
    });

  const overlay = document.getElementById("scraperSetupModal");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeScraperSetupModal();
    });
  }
}

// ============================================
// STATE
// ============================================

let SHEET_ID = null;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

let pipelineData = [];
let pipelineRawRows = []; // Keep raw rows for row index mapping
/** Default: Inbox = New, Researching, or empty status (not yet in active stages). */
let currentFilter = "inbox";
let currentSort = "fit";
let currentSearch = "";
let dataLoadFailed = false;
let dashboardDataHydrated = false;
let initialSheetAccessResolved = false;
let pendingSetupStarterSheetCreate = false;
let postAccessBootstrapDone = false;

/** Pipeline indices with expanded detail panel — preserved across re-renders */
const expandedJobKeys = new Set();

/** Stable keys that have been opened in the detail drawer — persisted to localStorage */
const viewedJobKeys = new Set(
  JSON.parse(localStorage.getItem("jb_viewedKeys") || "[]").map(Number),
);

// ---- Enrichment cache ----
const ENRICHMENT_CACHE_KEY = "jb_enrichment_v1";
const ENRICHMENT_CACHE_MAX = 300;
const ENRICHMENT_CACHE_DESC_LIMIT = 8000; // chars kept for raw description

function _loadEnrichmentCache() {
  try {
    return JSON.parse(localStorage.getItem(ENRICHMENT_CACHE_KEY) || "{}");
  } catch (_) {
    return {};
  }
}

function _saveEnrichmentCache(cache) {
  // Prune to MAX entries by scrapedAt (oldest first)
  const entries = Object.entries(cache);
  if (entries.length > ENRICHMENT_CACHE_MAX) {
    entries.sort((a, b) => (a[1].scrapedAt || 0) - (b[1].scrapedAt || 0));
    const pruned = Object.fromEntries(
      entries.slice(entries.length - ENRICHMENT_CACHE_MAX),
    );
    try {
      localStorage.setItem(ENRICHMENT_CACHE_KEY, JSON.stringify(pruned));
    } catch (_) {}
  } else {
    try {
      localStorage.setItem(ENRICHMENT_CACHE_KEY, JSON.stringify(cache));
    } catch (_) {}
  }
}

/** Call after fetchJobPostingEnrichment succeeds to persist results. */
function cacheEnrichment(url, enrichment) {
  if (!url) return;
  const cache = _loadEnrichmentCache();
  // Store AI fields + trimmed description; skip huge raw text to save space
  cache[url] = {
    ...enrichment,
    description: enrichment.description
      ? String(enrichment.description).slice(0, ENRICHMENT_CACHE_DESC_LIMIT)
      : undefined,
  };
  _saveEnrichmentCache(cache);
}

/** Restore cached enrichments into pipelineData after a Sheet load. */
function applyEnrichmentCache(jobs) {
  const cache = _loadEnrichmentCache();
  if (!Object.keys(cache).length) return;
  for (const job of jobs) {
    if (!job.link || job._postingEnrichment) continue;
    const hit = cache[job.link];
    if (hit && hit.scrapedAt) job._postingEnrichment = hit;
  }
}

function markJobViewed(stableKey) {
  if (viewedJobKeys.has(stableKey)) return;
  viewedJobKeys.add(stableKey);
  try {
    localStorage.setItem("jb_viewedKeys", JSON.stringify([...viewedJobKeys]));
  } catch (_) {}
  // Live-update any visible kanban card without a full re-render
  const el = document.querySelector(
    `.kanban-card[data-stable-key="${stableKey}"]`,
  );
  if (el) el.classList.add("kanban-card--viewed");
}

// ---- Pipeline Board ----
const STAGE_ORDER = [
  "New",
  "Researching",
  "Applied",
  "Phone Screen",
  "Interviewing",
  "Offer",
  "Rejected",
  "Passed",
];
const STAGE_ARCHIVE = new Set(["Rejected", "Passed"]);
/** Which stage lanes are expanded; defaults to active (non-archive) stages */
const expandedStages = new Set(
  STAGE_ORDER.filter((s) => !STAGE_ARCHIVE.has(s)),
);
/** Stable key of the job currently shown in the detail drawer, or -1 */
let activeDetailKey = -1;

// Auth state — access token stays in memory; localStorage only keeps a restore marker
let accessToken = null;
let userEmail = null;
/** Profile photo URL from Google userinfo (optional). */
let userPictureUrl = null;
let grantedOauthScopes = "";
/** Epoch ms when accessToken is expected to expire (Google typically ~1h). */
let tokenExpiresAt = null;
let tokenClient = null;
let gisLoaded = false;
let gisInitStartedAt = 0;
let gisInitWatchdogTimer = null;

const OAUTH_SESSION_STORAGE_KEY = "command_center_oauth_session";

/** Pending GIS callback: interactive sign-in, silent session restore, or silent token refresh (401 / proactive). */
let oauthPendingOp = null;
let tokenRefreshTimer = null;

function canUseLocalStorage() {
  try {
    const k = "__command_center_ls_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

function normalizeOauthScopes(raw) {
  if (!raw) return "";
  return [...new Set(String(raw).trim().split(/\s+/).filter(Boolean))].join(
    " ",
  );
}

function hasGrantedOauthScope(scope) {
  const wanted = String(scope || "").trim();
  if (!wanted) return false;
  return normalizeOauthScopes(grantedOauthScopes)
    .split(/\s+/)
    .filter(Boolean)
    .includes(wanted);
}

function persistOAuthSession() {
  if (!canUseLocalStorage() || !tokenExpiresAt) return;
  const cid = getOAuthClientId();
  if (!cid) return;
  try {
    localStorage.setItem(
      OAUTH_SESSION_STORAGE_KEY,
      JSON.stringify({
        expiresAt: tokenExpiresAt,
        userEmail,
        userPictureUrl,
        grantedOauthScopes,
        oauthClientId: cid,
        hasOauthSession: true,
      }),
    );
  } catch (e) {
    // Quota or private mode
  }
}

function updatePersistedUserEmail() {
  persistOAuthSession();
}

function clearPersistedOAuthSession() {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.removeItem(OAUTH_SESSION_STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}

/** Drop auth state after expiry or failed refresh (does not revoke the token server-side). */
function clearSessionAuthState() {
  clearScheduledTokenRefresh();
  accessToken = null;
  userEmail = null;
  userPictureUrl = null;
  grantedOauthScopes = "";
  tokenExpiresAt = null;
  oauthPendingOp = null;
  pendingSetupStarterSheetCreate = false;
  clearPersistedOAuthSession();
  updateAuthUI();
}

function loadPersistedOAuthSession() {
  if (!canUseLocalStorage()) return null;
  const cid = getOAuthClientId();
  if (!cid) return null;
  try {
    const raw = localStorage.getItem(OAUTH_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (
      !o ||
      typeof o !== "object" ||
      o.hasOauthSession !== true ||
      typeof o.expiresAt !== "number" ||
      o.oauthClientId !== cid
    ) {
      clearPersistedOAuthSession();
      return null;
    }
    return o;
  } catch (e) {
    clearPersistedOAuthSession();
    return null;
  }
}

function clearScheduledTokenRefresh() {
  if (tokenRefreshTimer != null) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
}

function scheduleTokenRefresh() {
  clearScheduledTokenRefresh();
  if (!tokenExpiresAt || !tokenClient) return;
  // Refresh ~5 minutes before expiry
  const delay = Math.max(10_000, tokenExpiresAt - Date.now() - 5 * 60 * 1000);
  tokenRefreshTimer = setTimeout(async () => {
    tokenRefreshTimer = null;
    if (!accessToken) return;
    const ok = await refreshAccessTokenSilently();
    if (ok) scheduleTokenRefresh();
  }, delay);
}

/**
 * Ask GIS for a new access token without user interaction (uses Google session + prior consent).
 * @returns {Promise<boolean>}
 */
function refreshAccessTokenSilently() {
  if (!tokenClient) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const t = setTimeout(() => done(false), 25_000);
    oauthPendingOp = {
      kind: "silent-refresh",
      finish: (ok) => {
        clearTimeout(t);
        oauthPendingOp = null;
        done(ok);
      },
    };
    try {
      tokenClient.requestAccessToken({ prompt: "none" });
    } catch (e) {
      clearTimeout(t);
      oauthPendingOp = null;
      done(false);
    }
  });
}

function restoreOAuthSession() {
  const persisted = loadPersistedOAuthSession();
  if (!persisted || !tokenClient) return;

  oauthPendingOp = { kind: "silent-restore" };
  try {
    tokenClient.requestAccessToken({ prompt: "none" });
  } catch (e) {
    oauthPendingOp = null;
    clearPersistedOAuthSession();
  }
}

// ============================================
// TOAST SYSTEM
// ============================================

function showToast(message, type = "success", persistent = false, action) {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = {
    success: "\u2713",
    error: "\u2717",
    info: "i",
    warning: "\u26A0",
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  const dismiss = () => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 200);
  };

  if (action && action.label && typeof action.onClick === "function") {
    const btn = document.createElement("button");
    btn.className = "toast-action-btn";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      action.onClick();
      dismiss();
    });
    toast.querySelector(".toast-message").after(btn);
  }

  toast.querySelector(".toast-close").addEventListener("click", dismiss);

  container.appendChild(toast);

  // Auto-dismiss success/info toasts
  if (!persistent && type !== "error") {
    setTimeout(dismiss, 3000);
  }
}

// ============================================
// AUTH — Google Identity Services
// ============================================

function initAuth() {
  const clientId = getOAuthClientId();
  if (!clientId) {
    // No OAuth configured — hide auth section entirely
    const authSection = document.getElementById("authSection");
    if (authSection) authSection.style.display = "none";
    return;
  }
  gisInitStartedAt = Date.now();
  if (gisInitWatchdogTimer != null) {
    clearTimeout(gisInitWatchdogTimer);
    gisInitWatchdogTimer = null;
  }
  gisInitWatchdogTimer = setTimeout(() => {
    gisInitWatchdogTimer = null;
    if (!gisLoaded) renderAppsScriptDeployUi();
  }, GIS_INIT_STUCK_MS + 250);

  // Wait for GIS library to load
  function tryInit() {
    if (
      typeof google !== "undefined" &&
      google.accounts &&
      google.accounts.oauth2
    ) {
      gisLoaded = true;
      gisInitStartedAt = 0;
      if (gisInitWatchdogTimer != null) {
        clearTimeout(gisInitWatchdogTimer);
        gisInitWatchdogTimer = null;
      }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SIGNIN_SCOPES,
        include_granted_scopes: true,
        callback: handleTokenResponse,
        error_callback: (err) => {
          console.error("[JobBored] GIS error_callback:", err);
          if (oauthPendingOp?.kind === "silent-refresh") {
            oauthPendingOp.finish(false);
            return;
          }
          if (oauthPendingOp?.kind === "silent-restore") {
            clearPersistedOAuthSession();
            oauthPendingOp = null;
            // Do not clobber interactive sign-in: silent restore can fail after the user
            // already completed OAuth; showing the gate hides the setup/onboarding screen.
            if (!SHEET_ID && getOAuthClientId() && !accessToken) {
              showSheetAccessGate("signin");
            }
            return;
          }
          oauthPendingOp = null;
          const errType =
            err && typeof err === "object" && err.type != null
              ? String(err.type)
              : "";
          const isPopup =
            errType === "popup_failed" ||
            errType === "popup_closed" ||
            /popup/i.test(
              String(err && err.message != null ? err.message : err),
            );
          const msg = isPopup
            ? "Google sign-in couldn’t open a window. Allow popups for this site, turn off your popup blocker for localhost, and use a normal browser tab (embedded previews often block OAuth)."
            : "Google sign-in failed. Try again, allow third-party cookies for accounts.google.com if your browser blocks them, or open the app in Chrome/Edge.";
          showToast(msg, "error", true);
        },
      });
      setupAuthUI();
      restoreOAuthSession();
      renderSetupStarterSheetUi();
      renderAppsScriptDeployUi();
      maybeSyncSettingsModalModeAfterAuth();
    } else {
      // Retry in 200ms — GIS library is loaded async
      setTimeout(tryInit, 200);
    }
  }

  tryInit();
}

function handleTokenResponse(tokenResponse) {
  const pending = oauthPendingOp;
  const silentOp =
    pending &&
    (pending.kind === "silent-refresh" || pending.kind === "silent-restore");

  if (tokenResponse.error) {
    console.error("[JobBored] OAuth error:", tokenResponse.error);
    if (pending?.kind === "silent-refresh") {
      pending.finish(false);
    } else {
      if (pending?.kind === "silent-restore") {
        clearPersistedOAuthSession();
      }
      oauthPendingOp = null;
    }
    if (silentOp && !SHEET_ID && getOAuthClientId() && !accessToken) {
      showSheetAccessGate("signin");
    }
    if (!silentOp) {
      showToast(
        "Sign-in failed: " +
          (tokenResponse.error_description || tokenResponse.error),
        "error",
      );
    }
    return;
  }

  accessToken = tokenResponse.access_token;
  grantedOauthScopes = normalizeOauthScopes(
    tokenResponse.scope || GOOGLE_SIGNIN_SCOPES,
  );
  const expiresIn = Number(tokenResponse.expires_in) || 3600;
  tokenExpiresAt = Date.now() + expiresIn * 1000;
  persistOAuthSession();

  if (pending?.kind === "silent-refresh") {
    pending.finish(true);
    fetchUserEmail();
    updateAuthUI();
    maybeSyncSettingsModalModeAfterAuth();
    return;
  }

  if (pending?.kind === "silent-restore") {
    oauthPendingOp = null;
    fetchUserEmail();
    updateAuthUI();
    if (SHEET_ID) {
      loadAllData();
    } else {
      revealSetupScreenAfterAuth();
    }
    scheduleTokenRefresh();
    maybeSyncSettingsModalModeAfterAuth();
    return;
  }

  oauthPendingOp = null;

  fetchUserEmail();
  updateAuthUI();
  showToast("Signed in", "success");

  if (pendingSetupStarterSheetCreate) {
    pendingSetupStarterSheetCreate = false;
    scheduleTokenRefresh();
    if (!SHEET_ID) revealSetupScreenAfterAuth();
    void handleSetupCreateStarterSheet();
    maybeSyncSettingsModalModeAfterAuth();
    return;
  }

  if (SHEET_ID) {
    loadAllData();
  } else {
    revealSetupScreenAfterAuth();
  }
  scheduleTokenRefresh();
  maybeSyncSettingsModalModeAfterAuth();
}

async function fetchUserEmail() {
  if (!accessToken) return;
  const userInfoUrl = "https://www.googleapis.com/oauth2/v3/userinfo";
  try {
    let resp = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      userEmail = data.email || null;
      userPictureUrl =
        typeof data.picture === "string" && data.picture.trim()
          ? data.picture.trim()
          : null;
      updateAuthUI();
      updatePersistedUserEmail();
      return;
    }
    if (resp.status === 401) {
      const ok = await refreshAccessTokenSilently();
      if (!ok || !accessToken) return;
      resp = await fetch(userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        userEmail = data.email || null;
        userPictureUrl =
          typeof data.picture === "string" && data.picture.trim()
            ? data.picture.trim()
            : null;
        updateAuthUI();
        updatePersistedUserEmail();
      }
    }
  } catch (err) {
    console.warn("[JobBored] Could not fetch user email:", err.message);
  }
}

function signIn(options = {}) {
  if (!tokenClient) {
    showToast(
      "Google sign-in is not ready yet. Save your OAuth client and reload first.",
      "error",
      true,
    );
    return;
  }
  const request = {};
  const prompt =
    options && typeof options === "object" && options.prompt != null
      ? String(options.prompt)
      : "";
  if (prompt) request.prompt = prompt;
  tokenClient.requestAccessToken(request);
}

function signOut() {
  closeAuthUserMenu();
  if (accessToken) {
    try {
      google.accounts.oauth2.revoke(accessToken, () => {
        console.log("[JobBored] Token revoked");
      });
    } catch (e) {
      // Ignore revoke errors
    }
  }
  clearSessionAuthState();
  showToast("Signed out", "info");
  maybeSyncSettingsModalModeAfterAuth();
  if (SHEET_ID) {
    initialSheetAccessResolved = false;
    showSheetAccessGate(getOAuthClientId() ? "signin" : "loading");
    loadAllData();
  } else {
    const setup = document.getElementById("setupScreen");
    if (setup) setup.style.display = "none";
    if (getOAuthClientId()) {
      showSheetAccessGate("signin");
    } else {
      showSheetAccessGate("no-oauth");
    }
    renderSetupStarterSheetUi();
  }
}

function setupAuthUI() {
  const signInBtn = document.getElementById("signInBtn");
  const signOutBtn = document.getElementById("signOutBtn");

  if (signInBtn) signInBtn.addEventListener("click", signIn);
  if (signOutBtn) signOutBtn.addEventListener("click", signOut);
}

function closeAuthUserMenu() {
  const menu = document.getElementById("authUserMenu");
  const toggle = document.getElementById("authMenuToggle");
  if (menu && !menu.hidden) {
    menu.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }
}

function isAuthUserMenuOpen() {
  const menu = document.getElementById("authUserMenu");
  return !!(menu && !menu.hidden);
}

async function toggleAuthUserMenu() {
  const menu = document.getElementById("authUserMenu");
  const toggle = document.getElementById("authMenuToggle");
  if (!menu || !toggle) return;
  const willOpen = !!menu.hidden;
  if (willOpen) await refreshPersonalPreferencesPanel();
  menu.hidden = !willOpen;
  toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

let authUserMenuInitialized = false;

function initAuthUserMenu() {
  if (authUserMenuInitialized) return;
  const toggle = document.getElementById("authMenuToggle");
  const menu = document.getElementById("authUserMenu");
  if (!toggle || !menu) return;
  authUserMenuInitialized = true;

  toggle.addEventListener("click", async (e) => {
    e.stopPropagation();
    await toggleAuthUserMenu();
  });

  document.addEventListener(
    "click",
    (e) => {
      if (!isAuthUserMenuOpen()) return;
      const t = e.target;
      if (toggle.contains(t)) return;
      if (menu.contains(t)) return;
      closeAuthUserMenu();
    },
    true,
  );
}

function setAuthAvatarDisplay() {
  const slot = document.getElementById("authAvatarSlot");
  const img = document.getElementById("authAvatarImg");
  const fb = document.getElementById("authAvatarFallback");
  if (!slot || !img || !fb) return;

  if (!accessToken) {
    img.removeAttribute("src");
    img.hidden = true;
    img.alt = "";
    fb.textContent = "";
    slot.classList.remove("auth-avatar--show-fallback");
    slot.removeAttribute("title");
    slot.removeAttribute("role");
    slot.removeAttribute("aria-label");
    document.getElementById("authMenuToggle")?.removeAttribute("aria-label");
    return;
  }

  const tip = userEmail || "Signed in";
  slot.title = tip;
  slot.setAttribute("role", "presentation");
  slot.removeAttribute("aria-label");
  img.alt = "";
  const menuToggle = document.getElementById("authMenuToggle");
  if (menuToggle) {
    menuToggle.setAttribute(
      "aria-label",
      userEmail
        ? `Account menu — signed in as ${userEmail}`
        : "Account menu — personal preferences",
    );
  }

  const initial = (userEmail || "?").trim().charAt(0).toUpperCase() || "?";
  fb.textContent = initial;

  if (userPictureUrl) {
    img.onerror = () => {
      img.hidden = true;
      img.removeAttribute("src");
      slot.classList.add("auth-avatar--show-fallback");
    };
    img.onload = () => {
      img.hidden = false;
      slot.classList.remove("auth-avatar--show-fallback");
    };
    const next = userPictureUrl;
    if (img.getAttribute("src") !== next) {
      img.hidden = true;
      slot.classList.add("auth-avatar--show-fallback");
      img.src = next;
    } else if (img.complete && img.naturalWidth > 0) {
      img.hidden = false;
      slot.classList.remove("auth-avatar--show-fallback");
    }
  } else {
    img.removeAttribute("src");
    img.hidden = true;
    slot.classList.add("auth-avatar--show-fallback");
  }
}

function updateAuthUI() {
  const signInBtn = document.getElementById("signInBtn");
  const authUser = document.getElementById("authUser");

  if (accessToken) {
    signInBtn.style.display = "none";
    authUser.style.display = "flex";
    setAuthAvatarDisplay();
  } else {
    signInBtn.style.display = "flex";
    authUser.style.display = "none";
    setAuthAvatarDisplay();
  }
  renderSetupStarterSheetUi();
}

function isSignedIn() {
  return !!accessToken;
}

/** Rotating hero tips on the login gate (left panel). */
const LOGIN_GATE_TIPS = [
  {
    label: "Did you know?",
    headline: "Your pipeline, one glance",
    body: "Scan cards for stage, notes, and follow-ups without digging through rows.",
  },
  {
    label: "Did you know?",
    headline: "Write-back stays in your sheet",
    body: "Updates sync to Google Sheets — your spreadsheet remains the source of truth.",
  },
  {
    label: "Did you know?",
    headline: "Built for speed",
    body: "Filter, sort, and expand details only when you need the full story.",
  },
];

let loginGateTipTimer = null;

function stopLoginGateTipRotation() {
  if (loginGateTipTimer != null) {
    clearInterval(loginGateTipTimer);
    loginGateTipTimer = null;
  }
}

function applyLoginGateTip(index) {
  const tip = LOGIN_GATE_TIPS[index % LOGIN_GATE_TIPS.length];
  const labelEl = document.getElementById("sheetAccessGateTipLabel");
  const headEl = document.getElementById("sheetAccessGateTipHeadline");
  const bodyEl = document.getElementById("sheetAccessGateTipBody");
  if (!tip || !labelEl || !headEl || !bodyEl) return;
  labelEl.textContent = tip.label;
  headEl.textContent = tip.headline;
  bodyEl.textContent = tip.body;
}

function startLoginGateTipRotation() {
  stopLoginGateTipRotation();
  let i = Math.floor(Math.random() * LOGIN_GATE_TIPS.length);
  applyLoginGateTip(i);
  loginGateTipTimer = setInterval(() => {
    i = (i + 1) % LOGIN_GATE_TIPS.length;
    applyLoginGateTip(i);
  }, 52000);
}

function setDashboardSheetLinks() {
  const currentSheetId = getSheetId() || SHEET_ID;
  if (!currentSheetId) return;
  SHEET_ID = currentSheetId;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${currentSheetId}/edit`;
  const sheetLink = document.getElementById("sheetLink");
  const footerSheetLink = document.getElementById("footerSheetLink");
  if (sheetLink) sheetLink.href = sheetUrl;
  if (footerSheetLink) footerSheetLink.href = sheetUrl;
}

function syncLoginGateOAuthOriginDisplay() {
  const originEl = document.getElementById("sheetAccessGateOAuthOriginDisplay");
  if (originEl && typeof window !== "undefined" && window.location) {
    originEl.textContent = window.location.origin;
  }
}

function resetLoginGateOAuthWizardToChoice() {
  const choice = document.getElementById("sheetAccessGateOAuthChoice");
  const wizard = document.getElementById("sheetAccessGateOAuthWizard");
  const input = document.getElementById("sheetAccessGateOAuthClientIdInput");
  if (choice) choice.hidden = false;
  if (wizard) wizard.hidden = true;
  syncLoginGateOAuthOriginDisplay();
  if (input) {
    const stored = readStoredConfigOverrides().oauthClientId;
    const s = stored != null ? String(stored).trim() : "";
    input.value =
      s &&
      s !== "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com" &&
      /\.apps\.googleusercontent\.com$/i.test(s)
        ? s
        : "";
  }
}

function initLoginGateOAuthUi() {
  const openSettingsPrimary = document.getElementById(
    "sheetAccessGateBtnOpenSettings",
  );
  const createOAuth = document.getElementById("sheetAccessGateBtnCreateOAuth");
  const back = document.getElementById("sheetAccessGateOAuthWizardBack");
  const copyOrigin = document.getElementById("sheetAccessGateCopyOriginBtn");
  const save = document.getElementById("sheetAccessGateOAuthSaveBtn");

  if (openSettingsPrimary) {
    openSettingsPrimary.addEventListener("click", () => {
      const input = document.getElementById(
        "sheetAccessGateOAuthClientIdInput",
      );
      const raw = input && input.value ? String(input.value).trim() : "";
      if (
        raw &&
        /\.apps\.googleusercontent\.com$/i.test(raw) &&
        raw !== "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com"
      ) {
        mergeStoredConfigOverridePatch({ oauthClientId: raw });
      }
      void openCommandCenterSettingsModal();
    });
  }
  if (createOAuth) {
    createOAuth.addEventListener("click", () => {
      const choice = document.getElementById("sheetAccessGateOAuthChoice");
      const wizard = document.getElementById("sheetAccessGateOAuthWizard");
      syncLoginGateOAuthOriginDisplay();
      if (choice) choice.hidden = true;
      if (wizard) wizard.hidden = false;
      document.getElementById("sheetAccessGateOAuthClientIdInput")?.focus();
    });
  }
  if (back) {
    back.addEventListener("click", () => {
      resetLoginGateOAuthWizardToChoice();
    });
  }
  if (copyOrigin) {
    copyOrigin.addEventListener("click", async () => {
      const o = window.location.origin;
      try {
        await navigator.clipboard.writeText(o);
        showToast("Origin copied", "success");
      } catch (e) {
        showToast(
          "Could not copy — select the origin and copy manually",
          "error",
        );
      }
    });
  }
  if (save) {
    save.addEventListener("click", () => {
      const input = document.getElementById(
        "sheetAccessGateOAuthClientIdInput",
      );
      const raw = input && input.value ? String(input.value).trim() : "";
      if (
        !raw ||
        !/\.apps\.googleusercontent\.com$/i.test(raw) ||
        raw === "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com"
      ) {
        showToast(
          "Paste a valid Client ID ending in .apps.googleusercontent.com",
          "error",
          true,
        );
        return;
      }
      mergeStoredConfigOverridePatch({ oauthClientId: raw });
      showToast("OAuth client saved — reloading…", "success");
      setTimeout(() => window.location.reload(), 400);
    });
  }
}

function showSheetAccessGate(mode) {
  const screen = document.getElementById("sheetAccessGateScreen");
  const dashboard = document.getElementById("dashboard");
  const setup = document.getElementById("setupScreen");
  if (!screen || !dashboard) return;

  // Signed-in users without a pipeline sheet belong on the setup steps, not the login gate.
  // Many code paths call showSheetAccessGate() and would otherwise hide #setupScreen.
  if (!getSheetId() && accessToken && mode !== "no-oauth") {
    revealPipelineSetupStepsScreen();
    return;
  }

  screen.dataset.gateMode = mode;

  const mainFlow = document.getElementById("sheetAccessGateMainFlow");
  const oauthShell = document.getElementById("sheetAccessGateOAuthShell");
  const panelInner = document.getElementById("sheetAccessGatePanelInner");

  const title = document.getElementById("sheetAccessGateTitle");
  const detail = document.getElementById("sheetAccessGateDetail");
  const stepTitle = document.getElementById("sheetAccessGateStepTitle");
  const stepBody = document.getElementById("sheetAccessGateStepBody");
  const statusBlock = document.getElementById("sheetAccessGateStatusBlock");
  const signInBtn = document.getElementById("sheetAccessGateSignInBtn");
  const settingsBtn = document.getElementById("sheetAccessGateOpenSettingsBtn");
  const reloadBtn = document.getElementById("sheetAccessGateReloadBtn");
  const spinner = document.getElementById("sheetAccessGateSpinner");
  const foot = document.getElementById("sheetAccessGateFoot");

  let nextTitle = "Opening your workspace";
  let nextDetail = "";
  let nextStepTitle = "";
  let nextStepBody = "";
  let showSignIn = false;
  let footText = "Google sign-in";
  let showSpinner = mode === "loading";

  const showOAuthShell = mode === "no-oauth";

  stopLoginGateTipRotation();

  if (mode === "loading") {
    nextTitle = "Opening your workspace";
    nextDetail = "";
    nextStepTitle = "";
    nextStepBody = "";
    const canOAuth = !!getOAuthClientId();
    const needGoogleBtn = canOAuth && !accessToken;
    showSignIn = needGoogleBtn;
    showSpinner = !needGoogleBtn;
    footText = needGoogleBtn
      ? "Log in with Google to continue."
      : "Connecting to your sheet…";
    startLoginGateTipRotation();
  } else if (mode === "signin") {
    if (!SHEET_ID) {
      nextTitle = "Get started";
      footText =
        "Sign in with Google to create a starter sheet or connect your sheet.";
    } else {
      nextTitle = "Welcome back";
      footText = "Use the Google account that can access this sheet.";
    }
    nextDetail = "";
    nextStepTitle = "";
    nextStepBody = "";
    showSignIn = true;
    startLoginGateTipRotation();
  } else if (mode === "no-oauth") {
    nextTitle = "";
    nextDetail = "";
    nextStepTitle = "";
    nextStepBody = "";
    showSignIn = false;
    footText = "Choose an option or follow the guide to create a client ID.";
    resetLoginGateOAuthWizardToChoice();
    startLoginGateTipRotation();
  } else if (mode === "error") {
    nextTitle = "Couldn’t load this sheet";
    nextDetail = "Check the Sheet ID and permissions, then try again.";
    nextStepTitle = "";
    nextStepBody = "";
    showSignIn = !!getOAuthClientId() && !accessToken;
    footText = showSignIn
      ? "Sign in with the account that can open this sheet."
      : "Check Settings or your network and reload.";
    startLoginGateTipRotation();
  }

  if (mainFlow) mainFlow.hidden = !!showOAuthShell;
  if (oauthShell) oauthShell.hidden = !showOAuthShell;
  if (panelInner) {
    panelInner.classList.toggle(
      "login-gate__panel-inner--oauth",
      !!showOAuthShell,
    );
  }

  if (title) title.textContent = nextTitle;
  if (detail) detail.textContent = nextDetail;
  if (stepTitle) stepTitle.textContent = nextStepTitle;
  if (stepBody) stepBody.textContent = nextStepBody;
  if (signInBtn) signInBtn.hidden = !showSignIn;
  if (settingsBtn) settingsBtn.hidden = !!showOAuthShell;
  if (reloadBtn) reloadBtn.hidden = false;
  if (spinner) spinner.hidden = !showSpinner;
  if (foot) foot.textContent = footText;

  if (statusBlock) {
    const hasCallout =
      String(nextStepTitle || "").trim() || String(nextStepBody || "").trim();
    statusBlock.hidden = !hasCallout;
  }

  if (setup) setup.style.display = "none";
  dashboard.style.display = "none";
  screen.style.display = "flex";
}

function hideSheetAccessGate() {
  stopLoginGateTipRotation();
  const screen = document.getElementById("sheetAccessGateScreen");
  if (screen) screen.style.display = "none";
}

/** Show the starter Pipeline setup screen before the guided wizard takes over. */
function revealPipelineSetupStepsScreen() {
  const setup = document.getElementById("setupScreen");
  const dashboard = document.getElementById("dashboard");
  hideSheetAccessGate();
  if (setup) setup.style.display = "flex";
  if (dashboard) dashboard.style.display = "none";
  renderSetupStarterSheetUi();
}

/** No Sheet ID yet: after Google sign-in, show the starter-sheet setup steps. */
function revealSetupScreenAfterAuth() {
  if (getSheetId()) return;
  revealPipelineSetupStepsScreen();
}

function revealDashboardShell() {
  const setup = document.getElementById("setupScreen");
  const screen = document.getElementById("sheetAccessGateScreen");
  const dashboard = document.getElementById("dashboard");
  if (setup) setup.style.display = "none";
  if (screen) screen.style.display = "none";
  if (dashboard) dashboard.style.display = "block";
}

function renderSetupStarterSheetUi() {
  const btn = document.getElementById("setupCreateStarterSheetBtn");
  const status = document.getElementById("setupCreateStarterSheetStatus");
  if (!btn || !status) return;

  const hasClient = !!getOAuthClientId();
  if (!hasClient) {
    btn.disabled = false;
    btn.textContent = "Create blank starter sheet";
    status.textContent =
      "Complete OAuth setup on the sign-in screen, then reload this page.";
    return;
  }
  if (!gisLoaded) {
    btn.disabled = true;
    btn.textContent = "Loading Google sign-in…";
    status.textContent =
      "Reload once after signing in so Google sign-in can initialize.";
    return;
  }
  if (!accessToken) {
    btn.disabled = false;
    btn.textContent = "Sign in & create blank starter sheet";
    status.textContent =
      "This will open Google sign-in, then create a fresh Pipeline sheet with just the headers.";
    return;
  }

  if (getSheetId()) {
    btn.disabled = true;
    btn.textContent = "Starter sheet linked";
    status.textContent =
      "Your Pipeline sheet is saved. The guided setup wizard is the next step.";
    return;
  }

  btn.disabled = false;
  btn.textContent = "Create blank starter sheet";
  status.textContent =
    "Signed in and ready. This creates a fresh Pipeline sheet with only the required headers.";
}

async function createBlankStarterSheet(isRetry) {
  if (!accessToken) {
    showToast("Sign in with Google first to create a starter sheet.", "error");
    return null;
  }

  const title = `JobBored Pipeline ${new Date().toISOString().slice(0, 10)}`;
  try {
    const createResp = await fetch(
      "https://sheets.googleapis.com/v4/spreadsheets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: { title },
          sheets: [
            {
              properties: {
                title: "Pipeline",
                gridProperties: {
                  rowCount: 200,
                  columnCount: STARTER_PIPELINE_HEADERS.length,
                  frozenRowCount: 1,
                },
              },
            },
          ],
        }),
      },
    );

    if (createResp.status === 401) {
      if (!isRetry) {
        const ok = await refreshAccessTokenSilently();
        if (ok) return createBlankStarterSheet(true);
      }
      clearSessionAuthState();
      throw new Error(
        "Google session expired while creating the starter sheet.",
      );
    }

    if (!createResp.ok) {
      const err = await createResp.json().catch(() => ({}));
      const message = String(
        err.error?.message ||
          `Starter sheet creation failed (HTTP ${createResp.status}).`,
      );
      if (
        createResp.status === 403 &&
        /insufficient authentication scopes/i.test(message) &&
        !isRetry
      ) {
        pendingSetupStarterSheetCreate = true;
        showToast(
          "Google needs Sheets permission before JobBored can create a starter sheet. Approve the prompt and try again.",
          "info",
          true,
        );
        signIn({ prompt: "consent" });
        return null;
      }
      throw new Error(message);
    }

    const spreadsheet = await createResp.json();
    const spreadsheetId =
      spreadsheet && spreadsheet.spreadsheetId
        ? String(spreadsheet.spreadsheetId).trim()
        : "";
    const spreadsheetUrl =
      spreadsheet && spreadsheet.spreadsheetUrl
        ? String(spreadsheet.spreadsheetUrl).trim()
        : "";
    if (!spreadsheetId) {
      throw new Error(
        "Google created a sheet but did not return a spreadsheetId.",
      );
    }

    const headerResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(STARTER_PIPELINE_HEADER_RANGE)}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range: STARTER_PIPELINE_HEADER_RANGE,
          majorDimension: "ROWS",
          values: [STARTER_PIPELINE_HEADERS],
        }),
      },
    );

    if (!headerResp.ok) {
      const err = await headerResp.json().catch(() => ({}));
      throw new Error(
        err.error?.message ||
          `Starter sheet header setup failed (HTTP ${headerResp.status}).`,
      );
    }

    return { spreadsheetId, spreadsheetUrl };
  } catch (err) {
    console.error("[JobBored] Starter sheet:", err);
    showToast(
      String(err.message || err || "Could not create starter sheet"),
      "error",
      true,
    );
    return null;
  }
}

async function handleSetupCreateStarterSheet() {
  if (!getOAuthClientId()) {
    showToast(
      "Save a Google OAuth client in Settings first, then come back and create the sheet.",
      "error",
      true,
    );
    void openCommandCenterSettingsModal();
    return;
  }
  if (!gisLoaded || !tokenClient) {
    showToast(
      "Google sign-in is not ready yet. Save the OAuth client, reload, then try again.",
      "error",
      true,
    );
    return;
  }
  if (!accessToken || !hasGrantedOauthScope(GOOGLE_SHEETS_SCOPE)) {
    pendingSetupStarterSheetCreate = true;
    signIn({
      prompt: accessToken ? "consent" : "",
    });
    return;
  }

  const btn = document.getElementById("setupCreateStarterSheetBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Creating starter sheet…";
  }
  const created = await createBlankStarterSheet(false);
  renderSetupStarterSheetUi();
  if (!created) return;

  mergeStoredConfigOverridePatch({ sheetId: created.spreadsheetId });
  SHEET_ID = created.spreadsheetId;
  initialSheetAccessResolved = true;
  setDashboardSheetLinks();
  revealDashboardShell();
  runPostAccessBootstrapOnce();
  void loadAllData();
  if (created.spreadsheetUrl) {
    window.open(created.spreadsheetUrl, "_blank", "noopener");
  }
  showToast("Starter sheet created. Opening guided setup…", "success");
  await openDiscoverySetupWizard({ entryPoint: "starter_sheet_created" });
}

// ============================================
// WRITE-BACK — Google Sheets API v4
// ============================================

async function updateSheetCell(range, value, isRetry) {
  if (!accessToken) {
    showToast("Sign in with Google first", "error");
    return false;
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  try {
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        range: range,
        majorDimension: "ROWS",
        values: [[value]],
      }),
    });

    if (resp.status === 401) {
      if (!isRetry) {
        const refreshed = await refreshAccessTokenSilently();
        if (refreshed) return updateSheetCell(range, value, true);
      }
      clearSessionAuthState();
      renderPipeline();
      showToast("Session expired — please sign in again", "error");
      return false;
    }

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${resp.status}`;
      console.error("[JobBored] Sheet update failed:", errMsg);
      showToast("Update failed: " + errMsg, "error");
      return false;
    }

    return true;
  } catch (err) {
    console.error("[JobBored] Sheet update error:", err);
    showToast("Update failed — check your connection", "error");
    return false;
  }
}

function generateDiscoveryVariationKey() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Notify automation (Hermes, n8n, etc.) to run another discovery pass (varied query). */
async function triggerDiscoveryRun() {
  const hook = normalizeDiscoveryWebhookIdentity(getDiscoveryWebhookUrl());
  if (!hook) {
    void openDiscoverySetupWizard({ entryPoint: "run_discovery" });
    return { ok: false, reason: "no_url" };
  }
  try {
    const payload = await buildDiscoveryWebhookPayload(SHEET_ID);
    const result = await verifyDiscoveryWebhookWithSharedModel(hook, payload, {
      context: "run_discovery",
      sheetId: SHEET_ID || "",
    });
    if (result.ok) {
      const engineState = getDiscoveryEngineStateFromVerificationResult(result);
      if (engineState) {
        await recordDiscoveryEngineState(hook, engineState, "run_discovery");
      }
      await refreshDiscoveryReadinessSnapshot({ force: true, rerender: false });
      showDiscoveryVerificationToast(result, { context: "run_discovery" });
      return { ok: true, kind: result.kind };
    }
    if (
      result.kind === "network_error" &&
      (await handleAppsScriptBrowserCorsFailure(hook))
    ) {
      // Apps Script stub is publicly accessible — CORS blocked the browser from
      // reading the response, but the endpoint did receive the request.
      // Classify as stub_only so the Run discovery path preserves wiring-only
      // semantics and does not report full-connected success.
      result.kind = "stub_only";
      result.engineState = "stub_only";
      showDiscoveryVerificationToast(result, {
        context: "run_discovery",
        endpointUrl: hook,
      });
      return { ok: false, kind: "stub_only" };
    }
    showDiscoveryVerificationToast(result, {
      context: "run_discovery",
      endpointUrl: hook,
    });
    return { ok: false, reason: result.kind || "http" };
  } catch (err) {
    console.error("[JobBored] Discovery webhook:", err);
    showToast(String(err && err.message ? err.message : err), "error", true);
    return { ok: false, reason: "error" };
  }
}

/**
 * POST a test payload from the Settings form (same shape as Run discovery).
 * Uses unsaved field values so you can test before Save.
 */
async function testDiscoveryWebhookFromSettings() {
  const urlEl = document.getElementById("settingsDiscoveryWebhookUrl");
  const sheetEl = document.getElementById("settingsSheetId");
  const url = normalizeDiscoveryWebhookIdentity(urlEl && urlEl.value.trim());
  const sheetRaw = sheetEl && sheetEl.value.trim();
  const sheetId = parseGoogleSheetId(sheetRaw || "");
  if (!url) {
    showToast("Paste a discovery webhook URL first", "error");
    return;
  }
  if (!sheetId) {
    showToast("Set a valid Spreadsheet URL or Sheet ID above first", "error");
    return;
  }
  const testBtn = document.getElementById("settingsDiscoveryTestBtn");
  if (testBtn) testBtn.disabled = true;
  try {
    const payload = await buildDiscoveryWebhookPayload(sheetId);
    const result = await verifyDiscoveryWebhookWithSharedModel(url, payload, {
      context: "test_webhook",
      sheetId,
    });
    if (result.ok) {
      const engineState = getDiscoveryEngineStateFromVerificationResult(result);
      if (engineState) {
        await recordDiscoveryEngineState(url, engineState, "test_webhook");
      }
      await refreshDiscoveryReadinessSnapshot({ force: true, rerender: false });
      showDiscoveryVerificationToast(result, {
        context: "test_webhook",
        endpointUrl: url,
      });
      return;
    }
    if (
      result.kind === "network_error" &&
      (await handleAppsScriptBrowserCorsFailure(url))
    ) {
      // Apps Script stub is publicly accessible — CORS blocked the browser from
      // reading the response, but the endpoint did receive the request.
      // Classify as stub_only so Test webhook shows warning semantics, not
      // a generic network error.
      result.kind = "stub_only";
      result.engineState = "stub_only";
      result.message =
        "Apps Script stub received the request. Wiring works, but the stub does not find real jobs.";
      result.detail =
        "Switch to a real discovery engine or set up a Cloudflare relay to enable real discovery.";
      showDiscoveryVerificationToast(result, {
        context: "test_webhook",
        endpointUrl: url,
      });
      return;
    }
    showDiscoveryVerificationToast(result, {
      context: "test_webhook",
      endpointUrl: url,
    });
  } catch (err) {
    showToast(String(err.message || err || "Test failed"), "error");
  } finally {
    if (testBtn) testBtn.disabled = false;
    refreshDiscoveryUiState();
  }
}

function openDiscoveryPathsModal() {
  const m = document.getElementById("discoveryPathsModal");
  if (m) m.style.display = "flex";
  document.getElementById("discoveryPathsDoneBtn")?.focus();
}

function closeDiscoveryPathsModal() {
  const m = document.getElementById("discoveryPathsModal");
  if (m) m.style.display = "none";
}

function openDiscoverySetupGuideModal() {
  const m = document.getElementById("discoverySetupGuideModal");
  if (m) m.style.display = "flex";
  document.getElementById("discoverySetupGuideDoneBtn")?.focus();
}

function closeDiscoverySetupGuideModal() {
  const m = document.getElementById("discoverySetupGuideModal");
  if (m) m.style.display = "none";
}

function renderDiscoveryLocalTunnelSetupUi() {
  const statusCard = document.getElementById("discoveryLocalTunnelStatus");
  const statusTitle = document.getElementById(
    "discoveryLocalTunnelStatusTitle",
  );
  const statusDetail = document.getElementById(
    "discoveryLocalTunnelStatusDetail",
  );
  const localInput = document.getElementById("discoveryLocalWebhookUrl");
  const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
  const healthValue = document.getElementById("discoveryLocalWebhookHealthUrl");
  const tunnelCommand = document.getElementById(
    "discoveryLocalTunnelStartCommand",
  );
  const publicTargetValue = document.getElementById(
    "discoveryLocalTunnelTargetValue",
  );
  const copyHealthBtn = document.getElementById(
    "discoveryLocalTunnelCopyHealthBtn",
  );
  const copyTargetBtn = document.getElementById(
    "discoveryLocalTunnelCopyTargetBtn",
  );
  const copyStartBtn = document.getElementById(
    "discoveryLocalTunnelCopyStartBtn",
  );
  const openRelayBtn = document.getElementById("discoveryLocalTunnelRelayBtn");
  if (
    !statusCard ||
    !statusTitle ||
    !statusDetail ||
    !healthValue ||
    !tunnelCommand ||
    !publicTargetValue
  ) {
    return;
  }

  const localWebhookUrl = normalizeDiscoveryLocalWebhookUrl(
    localInput ? localInput.value : "",
  );
  const tunnelPublicUrl = normalizeDiscoveryTunnelPublicUrl(
    tunnelInput ? tunnelInput.value : "",
  );
  const publicTargetUrl = buildDiscoveryTunnelTargetUrl(
    localWebhookUrl,
    tunnelPublicUrl,
  );
  const healthUrl = getDiscoveryLocalWebhookHealthUrl(localWebhookUrl);
  const port = inferLocalWebhookPort(localWebhookUrl);

  let tone = "info";
  let title = "Start with your local discovery receiver.";
  let detail =
    "Recommended: use the browser-use worker on this machine. Paste the exact local webhook URL, then start ngrok on the same port and paste the public HTTPS forwarding URL. Advanced only: you can still use a Hermes/OpenClaw route.";

  if (localWebhookUrl && !tunnelPublicUrl) {
    tone = "warning";
    title = "Local receiver saved. Public tunnel still missing.";
    detail = `Your local receiver is on port ${port}. Run ngrok on that port, then paste the https:// forwarding URL here.`;
  } else if (!localWebhookUrl && tunnelPublicUrl) {
    tone = "warning";
    title = "Public tunnel saved. Local receiver path still missing.";
    detail =
      "Paste the exact local webhook URL too, so JobBored can build the public target path for the Cloudflare Worker.";
  } else if (publicTargetUrl) {
    tone = "success";
    title = "Public target ready for the Cloudflare relay.";
    detail =
      "Use the generated target below as TARGET_URL in the Worker helper. Keep Discovery webhook URL pointed at the Worker, not ngrok directly.";
  }

  statusCard.className = `settings-apps-script-status settings-apps-script-status--${tone}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;

  healthValue.textContent =
    healthUrl || "Paste your local webhook URL to generate /health.";
  tunnelCommand.textContent = `ngrok http ${port}`;
  if (copyStartBtn) {
    copyStartBtn.setAttribute("data-copy-text", tunnelCommand.textContent);
  }
  publicTargetValue.textContent =
    publicTargetUrl ||
    "Paste both the local webhook URL and the public ngrok URL to generate the target.";

  if (copyHealthBtn) copyHealthBtn.disabled = !healthUrl;
  if (copyTargetBtn) copyTargetBtn.disabled = !publicTargetUrl;
  if (openRelayBtn) openRelayBtn.disabled = !publicTargetUrl;
}

function populateDiscoveryLocalTunnelModal() {
  const state = getDiscoveryTransportSetupState();
  const localInput = document.getElementById("discoveryLocalWebhookUrl");
  const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
  if (localInput) localInput.value = state.localWebhookUrl || "";
  if (tunnelInput) tunnelInput.value = state.tunnelPublicUrl || "";
  renderDiscoveryLocalTunnelSetupUi();
}

async function openDiscoveryLocalTunnelModal() {
  await hydrateDiscoveryTransportSetupFromLocalBootstrap();
  populateDiscoveryLocalTunnelModal();
  const modal = document.getElementById("discoveryLocalTunnelModal");
  if (modal) modal.style.display = "flex";
  document.getElementById("discoveryLocalWebhookUrl")?.focus();
  void probeAndShowTunnelStaleBanner();
}

async function probeNgrokFromLocalApi() {
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller
      ? window.setTimeout(() => controller.abort(), 2500)
      : null;
    try {
      const res = await fetch("/__proxy/ngrok-tunnels", {
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
      });
      if (!res.ok) return "";
      const data = await res.json().catch(() => null);
      const tunnels = Array.isArray(data && data.tunnels) ? data.tunnels : [];
      for (const t of tunnels) {
        const url = String(t && (t.public_url || t.publicUrl || "")).trim();
        if (/^https:\/\//i.test(url)) return url.replace(/\/+$/, "");
      }
      const direct = String(
        data && (data.public_url || data.publicUrl || ""),
      ).trim();
      return /^https:\/\//i.test(direct) ? direct.replace(/\/+$/, "") : "";
    } finally {
      if (timeout != null) window.clearTimeout(timeout);
    }
  } catch (_) {
    return "";
  }
}

async function probeAndShowTunnelStaleBanner() {
  const banner = document.getElementById("tunnelStaleBanner");
  if (!banner) return;

  const bannerTitle = document.getElementById("tunnelStaleBannerTitle");
  const bannerDetail = document.getElementById("tunnelStaleBannerDetail");
  const bannerAction = document.getElementById("tunnelStaleBannerAction");
  if (!bannerTitle || !bannerDetail || !bannerAction) return;

  if (!isLocalDashboardOrigin()) {
    banner.style.display = "none";
    return;
  }

  const stored = getDiscoveryTransportSetupState();
  const storedUrl = (stored.tunnelPublicUrl || "").replace(/\/+$/, "");

  const liveUrl = await probeNgrokFromLocalApi();

  if (!liveUrl && !storedUrl) {
    banner.style.display = "none";
    return;
  }

  if (!liveUrl) {
    banner.style.display = "flex";
    banner.className = "tunnel-stale-banner tunnel-stale-banner--down";
    const port = inferLocalWebhookPort(stored.localWebhookUrl);
    bannerTitle.textContent = "No ngrok tunnel detected.";
    bannerDetail.textContent = `Run ngrok http ${port} to restart, then click Detect.`;
    bannerAction.style.display = "none";
    return;
  }

  if (storedUrl && liveUrl !== storedUrl) {
    banner.style.display = "flex";
    banner.className = "tunnel-stale-banner";
    bannerTitle.textContent = "Your ngrok URL changed since last save.";
    bannerDetail.textContent = `Old: ${storedUrl}\nLive: ${liveUrl}`;
    bannerAction.style.display = "";
    bannerAction.onclick = () => {
      const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
      if (tunnelInput) tunnelInput.value = liveUrl;
      renderDiscoveryLocalTunnelSetupUi();
      saveDiscoveryLocalTunnelSetup(true);
      banner.style.display = "none";
    };
    return;
  }

  banner.style.display = "none";
}

function closeDiscoveryLocalTunnelModal() {
  const modal = document.getElementById("discoveryLocalTunnelModal");
  if (modal) modal.style.display = "none";
}

async function probeTunnelStaleBadge() {
  const badge = document.getElementById("settingsTunnelStaleBadge");
  if (!badge || !isLocalDashboardOrigin()) {
    if (badge) badge.style.display = "none";
    return;
  }
  const stored = getDiscoveryTransportSetupState();
  if (!stored.tunnelPublicUrl) {
    badge.style.display = "none";
    return;
  }
  const liveUrl = await probeNgrokFromLocalApi();
  const storedNorm = stored.tunnelPublicUrl.replace(/\/+$/, "");
  const stale = !liveUrl || liveUrl !== storedNorm;
  badge.style.display = stale ? "inline-block" : "none";
}

function saveDiscoveryLocalTunnelSetup(openRelayAfterSave) {
  const localInput = document.getElementById("discoveryLocalWebhookUrl");
  const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
  if (!localInput || !tunnelInput) return;

  const localRaw = String(localInput.value || "").trim();
  const tunnelRaw = String(tunnelInput.value || "").trim();
  const localWebhookUrl = normalizeDiscoveryLocalWebhookUrl(localRaw);
  const tunnelPublicUrl = normalizeDiscoveryTunnelPublicUrl(tunnelRaw);

  if (localRaw && !localWebhookUrl) {
    showToast("Paste a valid http:// or https:// local webhook URL.", "error");
    localInput.focus();
    return;
  }
  if (tunnelRaw && !tunnelPublicUrl) {
    showToast("Paste a valid https:// ngrok forwarding URL.", "error");
    tunnelInput.focus();
    return;
  }

  const previousState = getDiscoveryTransportSetupState();
  const tunnelUrlChanged =
    tunnelPublicUrl &&
    previousState.tunnelPublicUrl &&
    tunnelPublicUrl !== previousState.tunnelPublicUrl;

  writeDiscoveryTransportSetupState({
    localWebhookUrl,
    tunnelPublicUrl,
  });
  renderDiscoveryLocalTunnelSetupUi();

  const shouldOpenRelay = openRelayAfterSave || tunnelUrlChanged;

  if (shouldOpenRelay) {
    const publicTargetUrl = buildDiscoveryTunnelTargetUrl(
      localWebhookUrl,
      tunnelPublicUrl,
    );
    if (!publicTargetUrl) {
      showToast(
        "Paste both the local webhook URL and the ngrok URL first.",
        "error",
      );
      return;
    }
    closeDiscoveryLocalTunnelModal();
    void openCloudflareRelaySetupModal();
    const deployCommand = buildDiscoveryRelayDeployCommandForTarget(
      publicTargetUrl,
      {},
    );
    showToast(
      tunnelUrlChanged
        ? "ngrok URL updated. Copy the command, paste it into a terminal in the Job-Bored repo, and press Enter."
        : "Local tunnel info saved. Copy the relay command, paste it into a terminal in the Job-Bored repo, and press Enter.",
      tunnelUrlChanged ? "warning" : "success",
      tunnelUrlChanged,
      createDiscoveryRelayCopyCommandToastAction(deployCommand),
    );
    return;
  }

  showToast("Local tunnel info saved in this browser.", "success");
}

function populateCloudflareRelaySetupModal() {
  const statusCard = document.getElementById("cloudflareRelayStatus");
  const statusTitle = document.getElementById("cloudflareRelayStatusTitle");
  const statusDetail = document.getElementById("cloudflareRelayStatusDetail");
  const targetValue = document.getElementById("cloudflareRelayTargetValue");
  const agentPrompt = document.getElementById("cloudflareRelayAgentPrompt");
  const deployCommand = document.getElementById("cloudflareRelayDeployCommand");
  const originValue = document.getElementById("cloudflareRelayOriginValue");
  const corsSnippet = document.getElementById("cloudflareRelayCorsSnippet");
  const workerInput = document.getElementById("cloudflareRelayWorkerUrl");
  const copyTargetBtn = document.getElementById("cloudflareRelayCopyTargetBtn");
  const copyPromptBtn = document.getElementById(
    "cloudflareRelayCopyAgentPromptBtn",
  );
  const copyCommandBtn = document.getElementById(
    "cloudflareRelayCopyDeployCommandBtn",
  );
  if (
    !statusCard ||
    !statusTitle ||
    !statusDetail ||
    !targetValue ||
    !agentPrompt ||
    !deployCommand ||
    !originValue ||
    !corsSnippet
  ) {
    return;
  }

  const targetInfo = getCloudflareRelayTargetInfo();
  const targetUrl = targetInfo.url;
  const currentWebhookUrl =
    getSettingsFieldValue("settingsDiscoveryWebhookUrl").trim() ||
    getDiscoveryWebhookUrl();
  const suggestedOrigin = getDiscoveryRelaySuggestedOrigin() || "*";
  const workerName = getDiscoveryRelayWorkerName(targetUrl, currentWebhookUrl);
  const sheetId = getSettingsSheetIdValue() || "";

  let tone = "info";
  let title = "Fastest path: let your coding agent deploy the relay.";
  let detail =
    "The local helper script handles Wrangler deploy + TARGET_URL secret upload. You only need Cloudflare auth when the agent asks for it.";

  if (!targetUrl) {
    tone = "warning";
    title = "No webhook URL detected yet.";
    detail =
      "Deploy Apps Script first, or paste its /exec URL into Discovery webhook URL.";
  } else if (
    isLikelyCloudflareWorkerUrl(currentWebhookUrl) &&
    targetInfo.source === "managed"
  ) {
    title = "Current webhook already looks like a Cloudflare Worker.";
    detail =
      "The target below comes from your managed Apps Script deploy. Use it as TARGET_URL if you are re-creating or rotating the relay.";
  } else if (targetInfo.source === "managed") {
    detail =
      "Using the managed Apps Script deploy URL from this browser as TARGET_URL.";
  } else if (targetInfo.source === "local_tunnel") {
    title = "Using your ngrok tunnel as the relay target.";
    detail =
      "The Worker will forward requests to your tunnel, which reaches your local server.";
  } else if (!isLikelyAppsScriptWebAppUrl(targetUrl)) {
    tone = "warning";
    title = "Current webhook URL does not look like Apps Script.";
    detail =
      "You can still use the Worker as a generic relay, but this path is mainly meant for Apps Script /exec CORS failures.";
  }

  statusCard.className = `settings-apps-script-status settings-apps-script-status--${tone}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;

  targetValue.textContent =
    targetUrl || "No Apps Script /exec URL detected yet.";
  if (copyTargetBtn) copyTargetBtn.disabled = !targetUrl;

  const deployCommandText = targetUrl
    ? buildDiscoveryRelayDeployCommandForTarget(targetUrl, {
        origin: suggestedOrigin,
        workerName,
        workerUrl: currentWebhookUrl,
        sheetId,
      })
    : "Deploy Apps Script first to generate a one-command Cloudflare relay setup.";
  agentPrompt.textContent = buildCloudflareRelayAgentPrompt(
    targetUrl,
    suggestedOrigin,
    workerName,
    sheetId,
  );
  deployCommand.textContent = deployCommandText;
  if (copyPromptBtn) copyPromptBtn.disabled = !targetUrl;
  if (copyCommandBtn) copyCommandBtn.disabled = !targetUrl;

  originValue.textContent = suggestedOrigin;
  corsSnippet.textContent = buildCloudflareRelayCorsSnippet(suggestedOrigin);

  if (workerInput) {
    workerInput.value = isLikelyCloudflareWorkerUrl(currentWebhookUrl)
      ? currentWebhookUrl
      : "";
  }
}

async function openCloudflareRelaySetupModal() {
  if (showAppsScriptPublicAccessRemediationFromState()) {
    showToast(
      "Fix Apps Script public access first. Cloudflare relay is not the next step until Google allows anonymous access.",
      "error",
      true,
    );
    return;
  }
  await hydrateDiscoveryTransportSetupFromLocalBootstrap();
  populateCloudflareRelaySetupModal();
  const m = document.getElementById("cloudflareRelaySetupModal");
  if (m) m.style.display = "flex";
  const promptBtn = document.getElementById(
    "cloudflareRelayCopyAgentPromptBtn",
  );
  if (promptBtn && !promptBtn.disabled) {
    promptBtn.focus();
    return;
  }
  document.getElementById("cloudflareRelayWorkerUrl")?.focus();
}

function closeCloudflareRelaySetupModal() {
  const m = document.getElementById("cloudflareRelaySetupModal");
  if (m) m.style.display = "none";
}

function isSettingsModalOpen() {
  const modal = document.getElementById("settingsModal");
  return !!(modal && modal.style.display === "flex");
}

async function openCloudflareRelaySetupFromAppsScriptFailure() {
  if (!isSettingsModalOpen()) {
    await openCommandCenterSettingsModal();
  }
  await openCloudflareRelaySetupModal();
}

async function applyCloudflareRelayWorkerUrl(testAfterApply) {
  const input = document.getElementById("cloudflareRelayWorkerUrl");
  const urlField = document.getElementById("settingsDiscoveryWebhookUrl");
  const workerUrl = input ? String(input.value || "").trim() : "";
  if (!input || !urlField) return;

  if (!workerUrl) {
    showToast("Paste your deployed Worker URL first", "error");
    input.focus();
    return;
  }

  let parsed;
  try {
    parsed = new URL(workerUrl);
  } catch (_) {
    showToast("Paste a valid https:// Worker URL", "error");
    input.focus();
    return;
  }

  if (parsed.protocol !== "https:") {
    showToast("Use an https:// Worker URL", "error");
    input.focus();
    return;
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith("/forward")) {
    showToast(
      "Use the open Worker URL, not /forward — the dashboard does not send custom auth headers yet.",
      "error",
      true,
    );
    input.focus();
    return;
  }

  const normalizedWorkerUrl = parsed.toString();

  urlField.value = normalizedWorkerUrl;
  mergeStoredConfigOverridePatch({
    discoveryWebhookUrl: normalizedWorkerUrl,
  });
  syncDiscoveryButtonState();
  closeCloudflareRelaySetupModal();

  if (testAfterApply) {
    showToast("Worker URL saved. Testing from this browser…", "info");
    await testDiscoveryWebhookFromSettings();
    return;
  }

  focusDiscoveryWebhookFieldInSettings();
  showToast("Worker URL saved in this browser.", "success");
}

async function handleAppsScriptBrowserCorsFailure(url) {
  if (!isLikelyAppsScriptWebAppUrl(url)) return false;
  if (
    isManagedAppsScriptDeployState(appsScriptDeployStateCache) &&
    !isAppsScriptPublicAccessReady(appsScriptDeployStateCache)
  ) {
    if (!isSettingsModalOpen()) {
      await openCommandCenterSettingsModal();
    }
    showAppsScriptPublicAccessRemediationFromState();
    showToast(
      "Apps Script is not publicly callable yet. Finish the remediation steps in Settings before using the relay.",
      "error",
      true,
    );
    return true;
  }
  // Apps Script is publicly accessible — treat as stub-only wiring confirmation.
  // The endpoint accepted the request but is not a real discovery engine.
  // Suppress the generic CORS/network error and let the caller treat this as stub_only.
  showToast(
    "Apps Script stub received the request. This is wiring-only — the stub does not find real jobs.",
    "warning",
    true,
  );
  return true;
}

function initDiscoverySetupGuide() {
  document
    .getElementById("settingsDiscoveryGuideBtn")
    ?.addEventListener("click", () => {
      void openDiscoverySetupWizard({ entryPoint: "settings" });
    });
  document
    .getElementById("settingsDiscoveryLocalSetupBtn")
    ?.addEventListener("click", () => {
      void openDiscoverySetupWizard({
        entryPoint: "settings",
        flow: "local_agent",
        startStep: "bootstrap",
      });
    });
  document
    .getElementById("settingsDiscoveryRelayBtn")
    ?.addEventListener("click", () => {
      void openDiscoverySetupWizard({
        entryPoint: "settings",
        flow: "local_agent",
        startStep: "relay_deploy",
      });
    });
  document
    .getElementById("settingsDiscoveryPathsBtn")
    ?.addEventListener("click", () => {
      openDiscoveryPathsModal();
    });
  document
    .getElementById("settingsDiscoveryTestBtn")
    ?.addEventListener("click", () => {
      void testDiscoveryWebhookFromSettings();
    });

  document
    .getElementById("discoveryPathsModalClose")
    ?.addEventListener("click", () => {
      closeDiscoveryPathsModal();
    });
  document
    .getElementById("discoveryPathsDoneBtn")
    ?.addEventListener("click", () => {
      closeDiscoveryPathsModal();
    });
  const pathsOverlay = document.getElementById("discoveryPathsModal");
  if (pathsOverlay) {
    pathsOverlay.addEventListener("click", (e) => {
      if (e.target === pathsOverlay) closeDiscoveryPathsModal();
    });
  }

  document
    .getElementById("discoverySetupGuideModalClose")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
    });
  document
    .getElementById("discoverySetupGuideDoneBtn")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
    });
  document
    .getElementById("discoverySetupGuideLocalBtn")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
      void openDiscoverySetupWizard({
        entryPoint: "guide",
        flow: "local_agent",
        startStep: "bootstrap",
      });
    });
  document
    .getElementById("discoverySetupGuideRelayBtn")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
      void openDiscoverySetupWizard({
        entryPoint: "guide",
        flow: "local_agent",
        startStep: "relay_deploy",
      });
    });
  const guideOverlay = document.getElementById("discoverySetupGuideModal");
  if (guideOverlay) {
    guideOverlay.addEventListener("click", (e) => {
      if (e.target === guideOverlay) closeDiscoverySetupGuideModal();
    });
  }

  document
    .getElementById("discoveryLocalTunnelModalClose")
    ?.addEventListener("click", () => {
      closeDiscoveryLocalTunnelModal();
    });
  document
    .getElementById("discoveryLocalTunnelDoneBtn")
    ?.addEventListener("click", () => {
      closeDiscoveryLocalTunnelModal();
    });
  document
    .getElementById("discoveryLocalTunnelSaveBtn")
    ?.addEventListener("click", () => {
      saveDiscoveryLocalTunnelSetup(false);
    });
  document
    .getElementById("discoveryLocalTunnelRelayBtn")
    ?.addEventListener("click", () => {
      saveDiscoveryLocalTunnelSetup(true);
    });
  document
    .getElementById("discoveryLocalTunnelCopyHealthBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("discoveryLocalWebhookHealthUrl");
      if (!text || !text.textContent) return;
      copyTextToClipboard(text.textContent);
    });
  document
    .getElementById("discoveryLocalTunnelCopyTargetBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("discoveryLocalTunnelTargetValue");
      if (!text || !text.textContent) return;
      copyTextToClipboard(text.textContent);
    });
  document
    .querySelectorAll(
      "#discoveryLocalTunnelModal .btn-copy-scraper[data-copy-text]",
    )
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-copy-text");
        if (text) copyTextToClipboard(text);
      });
    });
  document
    .getElementById("discoveryLocalWebhookUrl")
    ?.addEventListener("input", () => {
      renderDiscoveryLocalTunnelSetupUi();
    });
  document
    .getElementById("discoveryTunnelPublicUrl")
    ?.addEventListener("input", () => {
      renderDiscoveryLocalTunnelSetupUi();
    });
  document
    .getElementById("tunnelDetectBtn")
    ?.addEventListener("click", async () => {
      const btn = document.getElementById("tunnelDetectBtn");
      const hint = document.getElementById("tunnelDetectHint");
      const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
      if (!btn || !tunnelInput) return;

      btn.disabled = true;
      btn.textContent = "Detecting\u2026";
      try {
        const liveUrl = await probeNgrokFromLocalApi();
        if (liveUrl) {
          const oldVal = tunnelInput.value.trim().replace(/\/+$/, "");
          tunnelInput.value = liveUrl;
          renderDiscoveryLocalTunnelSetupUi();
          if (hint) {
            const changed = oldVal && oldVal !== liveUrl;
            hint.innerHTML = changed
              ? "<strong>Updated</strong> \u2014 ngrok URL was refreshed."
              : "<strong>Detected</strong> \u2014 ngrok tunnel found.";
            hint.classList.add("tunnel-detect-hint--updated");
            setTimeout(
              () => hint.classList.remove("tunnel-detect-hint--updated"),
              3000,
            );
          }
        } else {
          const port = inferLocalWebhookPort(
            document.getElementById("discoveryLocalWebhookUrl")?.value || "",
          );
          if (hint) {
            hint.innerHTML = `No tunnel found. Run <code class="modal-code">ngrok http ${port}</code> first.`;
          }
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "Detect";
      }
    });
  const localTunnelOverlay = document.getElementById(
    "discoveryLocalTunnelModal",
  );
  if (localTunnelOverlay) {
    localTunnelOverlay.addEventListener("click", (e) => {
      if (e.target === localTunnelOverlay) closeDiscoveryLocalTunnelModal();
    });
  }

  document
    .getElementById("cloudflareRelaySetupModalClose")
    ?.addEventListener("click", () => {
      closeCloudflareRelaySetupModal();
    });
  document
    .getElementById("cloudflareRelaySetupDoneBtn")
    ?.addEventListener("click", () => {
      closeCloudflareRelaySetupModal();
    });
  document
    .getElementById("cloudflareRelayCopyTargetBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayTargetValue");
      if (!text || !text.textContent) return;
      copyTextToClipboard(text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyAgentPromptBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayAgentPrompt");
      if (!text || !text.textContent) return;
      copyTextToClipboard(text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyDeployCommandBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayDeployCommand");
      if (!text || !text.textContent) return;
      copyTextToClipboard(text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyManualCommandsBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayCommandBlock");
      if (!text || !text.textContent) return;
      copyTextToClipboard(text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyCorsBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayCorsSnippet");
      if (!text || !text.textContent) return;
      copyTextToClipboard(text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyOriginBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayOriginValue");
      if (!text || !text.textContent) return;
      copyTextToClipboard(text.textContent);
    });
  document
    .getElementById("cloudflareRelayUseBtn")
    ?.addEventListener("click", () => {
      void applyCloudflareRelayWorkerUrl(false);
    });
  document
    .getElementById("cloudflareRelayUseAndTestBtn")
    ?.addEventListener("click", () => {
      void applyCloudflareRelayWorkerUrl(true);
    });
  const relayOverlay = document.getElementById("cloudflareRelaySetupModal");
  if (relayOverlay) {
    relayOverlay.addEventListener("click", (e) => {
      if (e.target === relayOverlay) closeCloudflareRelaySetupModal();
    });
  }

  document
    .querySelectorAll(
      "#discoverySetupGuideModal .btn-copy-scraper[data-copy-text]",
    )
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-copy-text");
        if (text) copyTextToClipboard(text);
      });
    });

  document
    .getElementById("discoveryHelpFullGuideBtn")
    ?.addEventListener("click", () => {
      const help = document.getElementById("discoveryHelpModal");
      if (help) help.style.display = "none";
      void openDiscoverySetupWizard({ entryPoint: "help" });
    });
  document
    .getElementById("discoveryHelpPathsBtn")
    ?.addEventListener("click", () => {
      const help = document.getElementById("discoveryHelpModal");
      if (help) help.style.display = "none";
      openDiscoveryPathsModal();
    });

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const relay = document.getElementById("cloudflareRelaySetupModal");
      if (relay && relay.style.display === "flex") {
        e.preventDefault();
        e.stopPropagation();
        closeCloudflareRelaySetupModal();
        return;
      }
      const guide = document.getElementById("discoverySetupGuideModal");
      if (guide && guide.style.display === "flex") {
        e.preventDefault();
        e.stopPropagation();
        closeDiscoverySetupGuideModal();
        return;
      }
      const localTunnel = document.getElementById("discoveryLocalTunnelModal");
      if (localTunnel && localTunnel.style.display === "flex") {
        e.preventDefault();
        e.stopPropagation();
        closeDiscoveryLocalTunnelModal();
        return;
      }
      const paths = document.getElementById("discoveryPathsModal");
      if (paths && paths.style.display === "flex") {
        e.preventDefault();
        e.stopPropagation();
        closeDiscoveryPathsModal();
      }
    },
    true,
  );
}

async function updateMultipleCells(updates, isRetry) {
  // updates: Array of { range, value }
  if (!accessToken) {
    showToast("Sign in with Google first", "error");
    return false;
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: updates.map((u) => ({
          range: u.range,
          majorDimension: "ROWS",
          values: [[u.value]],
        })),
      }),
    });

    if (resp.status === 401) {
      if (!isRetry) {
        const refreshed = await refreshAccessTokenSilently();
        if (refreshed) return updateMultipleCells(updates, true);
      }
      clearSessionAuthState();
      renderPipeline();
      showToast("Session expired — please sign in again", "error");
      return false;
    }

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${resp.status}`;
      showToast("Update failed: " + errMsg, "error");
      return false;
    }

    return true;
  } catch (err) {
    showToast("Update failed — check your connection", "error");
    return false;
  }
}

// Row index: the position in pipelineData maps to raw row index
// pipelineData[i] comes from pipelineRawRows[i], which is rows[i+1] (skip header)
// So sheet row = rawRowIndex + 2 (1-indexed, +1 for header)
function getSheetRow(dataIndex) {
  // dataIndex is the index into pipelineData
  // We need to map back to the original row in the raw CSV
  const job = pipelineData[dataIndex];
  if (!job || job._rawIndex == null) return null;
  return job._rawIndex + 2; // +1 for 0-based, +1 for header row
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function futureDateStr(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

// Smart status transitions — each status change may auto-update related fields
function getStatusSideEffects(newStatus, job, sheetRow) {
  const updates = [{ range: `Pipeline!M${sheetRow}`, value: newStatus }];
  const localUpdates = { status: newStatus };
  const today = todayStr();

  switch (newStatus) {
    case "Applied":
      // Set Applied Date to today if not already set
      if (!job.appliedDate) {
        updates.push({ range: `Pipeline!N${sheetRow}`, value: today });
        localUpdates.appliedDate = today;
      }
      // Set Follow-up Date to 5 business days out if not already set
      if (!job.followUpDate) {
        const followUp = futureDateStr(7);
        updates.push({ range: `Pipeline!P${sheetRow}`, value: followUp });
        localUpdates.followUpDate = followUp;
      }
      break;

    case "Phone Screen":
      // Set Applied Date if somehow skipped
      if (!job.appliedDate) {
        updates.push({ range: `Pipeline!N${sheetRow}`, value: today });
        localUpdates.appliedDate = today;
      }
      // Set Follow-up Date to 3 days out (tighter loop)
      const psFollowUp = futureDateStr(3);
      updates.push({ range: `Pipeline!P${sheetRow}`, value: psFollowUp });
      localUpdates.followUpDate = psFollowUp;
      break;

    case "Interviewing":
      // Set Applied Date if somehow skipped
      if (!job.appliedDate) {
        updates.push({ range: `Pipeline!N${sheetRow}`, value: today });
        localUpdates.appliedDate = today;
      }
      // Set Follow-up Date to 5 days out
      const intFollowUp = futureDateStr(5);
      updates.push({ range: `Pipeline!P${sheetRow}`, value: intFollowUp });
      localUpdates.followUpDate = intFollowUp;
      break;

    case "Offer":
      // Clear Follow-up Date (you got the offer)
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.followUpDate = null;
      break;

    case "Rejected":
      // Clear Follow-up Date
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.followUpDate = null;
      break;

    case "Passed":
      // Clear Follow-up Date
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.followUpDate = null;
      break;

    case "New":
      // Reverting — clear Applied Date and Follow-up Date
      updates.push({ range: `Pipeline!N${sheetRow}`, value: "" });
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.appliedDate = null;
      localUpdates.followUpDate = null;
      break;

    case "Researching":
      // No side effects
      break;
  }

  return { updates, localUpdates };
}

async function updateJobStatus(dataIndex, newStatus) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) {
    return false;
  }

  const job = pipelineData[dataIndex];
  const { updates, localUpdates } = getStatusSideEffects(
    newStatus,
    job,
    sheetRow,
  );

  const success = await updateMultipleCells(updates);

  if (success) {
    // Apply all local updates
    Object.assign(pipelineData[dataIndex], localUpdates);
    renderPipeline();
    renderStats();
    renderBrief();

    // Build a descriptive toast
    const extras = [];
    if (localUpdates.appliedDate) extras.push("applied date set");
    if (localUpdates.followUpDate)
      extras.push(`follow-up: ${localUpdates.followUpDate}`);
    if (localUpdates.followUpDate === null && newStatus !== "New")
      extras.push("follow-up cleared");
    const msg =
      extras.length > 0
        ? `${newStatus} — ${extras.join(", ")}`
        : `Updated to "${newStatus}"`;
    showToast(msg);
  }
  return success;
}

async function updateJobNotes(dataIndex, notes) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!O${sheetRow}`;
  const success = await updateSheetCell(range, notes);

  if (success) {
    pipelineData[dataIndex].notes = notes;
    renderBrief();
    showToast("Notes saved");
  }
}

async function updateFollowUpDate(dataIndex, date) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!P${sheetRow}`;
  const success = await updateSheetCell(range, date);

  if (success) {
    pipelineData[dataIndex].followUpDate = date || null;
    renderPipeline();
    renderBrief();
    showToast(date ? `Follow-up set: ${date}` : "Follow-up cleared");
  }
}

async function updateLastHeardFrom(dataIndex, value) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!R${sheetRow}`;
  const success = await updateSheetCell(range, value);

  if (success) {
    pipelineData[dataIndex].lastHeardFrom = value.trim() ? value.trim() : null;
    renderBrief();
    showToast("Last contact saved");
  }
}

async function updateJobResponseFlag(dataIndex, value) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!S${sheetRow}`;
  const success = await updateSheetCell(range, value);

  if (success) {
    pipelineData[dataIndex].responseFlag = value.trim() ? value.trim() : null;
    renderBrief();
    renderStats();
    showToast("Reply status saved");
  }
}

// ============================================
// LIGHTWEIGHT CSV PARSER
// ============================================

function parseCSV(text) {
  const rows = [];
  let current = "";
  let inQuotes = false;
  let row = [];
  let fieldStart = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (fieldStart && ch === '"') {
      inQuotes = true;
      fieldStart = false;
      continue;
    }

    fieldStart = false;

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ",") {
        row.push(current.trim());
        current = "";
        fieldStart = true;
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        row.push(current.trim());
        if (row.some((cell) => cell !== "")) {
          rows.push(row);
        }
        row = [];
        current = "";
        fieldStart = true;
        if (ch === "\r") i++;
      } else if (ch === "\r") {
        row.push(current.trim());
        if (row.some((cell) => cell !== "")) {
          rows.push(row);
        }
        row = [];
        current = "";
        fieldStart = true;
      } else {
        current += ch;
      }
    }
  }

  row.push(current.trim());
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }

  return rows;
}

// ============================================
// DATA FETCHING — JSONP (bypasses CORS/iframe restrictions)
// ============================================

let _jsonpCounter = 0;

function fetchSheetJSONP(sheetName) {
  return new Promise((resolve, reject) => {
    const callbackName = `__commandCenter_cb_${++_jsonpCounter}`;
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&sheet=${encodeURIComponent(sheetName)}`;

    console.log(`[JobBored] JSONP fetch: ${sheetName}`);

    const timeout = setTimeout(() => {
      cleanup();
      console.error(`[JobBored] JSONP timeout for ${sheetName}`);
      reject(new Error(`Timeout fetching ${sheetName}`));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      const el = document.getElementById(`jsonp-${callbackName}`);
      if (el) el.remove();
    }

    window[callbackName] = function (response) {
      cleanup();
      if (!response || !response.table) {
        reject(new Error(`Invalid response for ${sheetName}`));
        return;
      }
      console.log(
        `[JobBored] ${sheetName} loaded via JSONP (${response.table.rows ? response.table.rows.length : 0} rows)`,
      );
      resolve(response.table);
    };

    const script = document.createElement("script");
    script.id = `jsonp-${callbackName}`;
    script.src = url;
    script.onerror = () => {
      cleanup();
      console.error(`[JobBored] JSONP script error for ${sheetName}`);
      reject(new Error(`Script load failed for ${sheetName}`));
    };
    document.head.appendChild(script);
  });
}

function getCellValue(cell) {
  if (!cell) return null;
  if (cell.v === null || cell.v === undefined) return null;
  return cell.v;
}

function getCellFormatted(cell) {
  if (!cell) return null;
  if (cell.f) return cell.f;
  return getCellValue(cell);
}

function parseGvizDate(val) {
  if (!val) return null;
  if (typeof val === "string" && val.startsWith("Date(")) {
    const parts = val.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (parts)
      return new Date(
        parseInt(parts[1]),
        parseInt(parts[2]),
        parseInt(parts[3]),
      );
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Read sheet values with OAuth (works for private sheets — no publish step).
 * Returns null on hard failure; [] if the tab exists but has no cells.
 */
async function fetchSheetViaSheetsAPI(sheetName, isRetry) {
  if (!accessToken || !SHEET_ID) return null;
  const name = String(sheetName);
  const needsQuote = /[^A-Za-z0-9_]/.test(name) || /^\d/.test(name);
  const a1 = needsQuote ? `'${name.replace(/'/g, "''")}'!A:ZZ` : `${name}!A:ZZ`;
  const encRange = encodeURIComponent(a1);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}/values/${encRange}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (resp.status === 401) {
    if (!isRetry) {
      const ok = await refreshAccessTokenSilently();
      if (ok) return fetchSheetViaSheetsAPI(sheetName, true);
    }
    clearSessionAuthState();
    return null;
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error(
      "[JobBored] Sheets API read failed:",
      resp.status,
      err.error || err,
    );
    return null;
  }
  const data = await resp.json();
  return data.values != null ? data.values : [];
}

async function fetchSheetCSV(sheetName) {
  // 1) Signed in: Google Sheets API (private sheet in your Drive — no "publish to web")
  if (accessToken) {
    try {
      const apiRows = await fetchSheetViaSheetsAPI(sheetName);
      if (apiRows !== null) {
        return apiRows;
      }
    } catch (e) {
      console.warn("[JobBored] Sheets API read:", e);
    }
  }

  // 2) Public / published: JSONP (works inside iframes, no CORS issues)
  try {
    const table = await fetchSheetJSONP(sheetName);
    // Convert gviz table to CSV-like rows array for compatibility with existing parsers
    const headers = table.cols.map((c) => c.label || c.id);
    const rows = [headers];
    for (const row of table.rows || []) {
      const cells = [];
      for (let i = 0; i < headers.length; i++) {
        const cell = row.c ? row.c[i] : null;
        if (!cell || cell.v === null || cell.v === undefined) {
          cells.push("");
        } else if (typeof cell.v === "string" && cell.v.startsWith("Date(")) {
          const d = parseGvizDate(cell.v);
          cells.push(d ? d.toISOString().split("T")[0] : cell.f || "");
        } else if (cell.f) {
          cells.push(cell.f);
        } else {
          cells.push(String(cell.v));
        }
      }
      rows.push(cells);
    }
    return rows;
  } catch (err) {
    console.error(`[JobBored] JSONP failed for ${sheetName}:`, err.message);
  }

  // Fallback: try fetch CSV (works when not in iframe)
  const csvUrls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/pub?gid=0&single=true&output=csv`,
  ];

  for (const url of csvUrls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (!text || text.length < 10) continue;
      if (text.trim().startsWith("<!") || text.trim().startsWith("<html"))
        continue;
      console.log(`[JobBored] ${sheetName} loaded via CSV fallback`);
      return parseCSV(text);
    } catch (e) {
      continue;
    }
  }

  console.error(`[JobBored] All fetch attempts failed for ${sheetName}`);
  return null;
}

/**
 * Some discovery/LLM automations write run provenance into Pipeline column O (Notes).
 * That is not user notes — hide it in the UI; saving real notes still overwrites the cell.
 */
function isDiscoveryAutomationNotesString(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^Discovered\s+via\s+variationKey\b/i.test(t)) return true;
  if (
    /^Discovered\s+via\s+/i.test(t) &&
    /\bvariationKey\b/i.test(t) &&
    /\b(direct-source|direct\s+source)\b/i.test(t)
  ) {
    return true;
  }
  if (
    /^Discovered\s+via\s+/i.test(t) &&
    /\bvariationKey\b/i.test(t) &&
    /\bYC\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

function sanitizePipelineNotesFromSheet(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (isDiscoveryAutomationNotesString(s)) return "";
  return s;
}

function parsePipelineCSV(rows) {
  if (!rows || rows.length < 2) return [];

  const dataRows = rows.slice(1);
  const results = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const title = row[1] || null;
    const company = row[2] || null;

    if (!title && !company) continue;
    if (!company && !row[4] && !row[7]) continue;

    const fitScoreRaw = row[7];
    let fitScore = null;
    if (fitScoreRaw) {
      const parsed = parseFloat(fitScoreRaw);
      if (!isNaN(parsed)) fitScore = parsed;
    }

    let dateFound = null;
    const dateRaw = row[0] || null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) dateFound = d;
    }

    results.push({
      _rawIndex: i, // Index into dataRows (0-based), sheet row = i + 2
      dateFound: dateFound,
      dateFoundRaw: dateRaw,
      title: title ? title.trim() : null,
      company: company,
      location: row[3] || null,
      link: row[4] || null,
      source: row[5] || null,
      salary: row[6] || null,
      fitScore: fitScore,
      priority: row[8] || null,
      tags: row[9] || null,
      fitAssessment: row[10] || null,
      contact: row[11] || null,
      status: row[12] || null,
      appliedDate: row[13] || null,
      notes: sanitizePipelineNotesFromSheet(row[14]) || null,
      followUpDate: row[15] || null,
      talkingPoints: row[16] || null,
      lastHeardFrom:
        row[17] != null && String(row[17]).trim() !== ""
          ? String(row[17]).trim()
          : null,
      responseFlag:
        row[18] != null && String(row[18]).trim() !== ""
          ? String(row[18]).trim()
          : null,
      logoUrl: row[19] ? String(row[19]).trim() : null,
    });
  }

  return results;
}

// ============================================
// MAIN DATA LOADER
// ============================================

async function loadAllData() {
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) refreshBtn.classList.add("loading");

  try {
    const pipelineRows = await fetchSheetCSV("Pipeline");

    if (!pipelineRows) {
      if (!initialSheetAccessResolved) {
        if (!accessToken && getOAuthClientId()) {
          showSheetAccessGate("signin");
        } else if (!getOAuthClientId()) {
          showSheetAccessGate("no-oauth");
        } else {
          showSheetAccessGate("error");
        }
      } else {
        showErrorState();
      }
      dataLoadFailed = true;
      return false;
    }

    dataLoadFailed = false;
    hideErrorState();

    pipelineRawRows = pipelineRows;
    pipelineData = parsePipelineCSV(pipelineRows);
    applyEnrichmentCache(pipelineData);
    console.log(`[JobBored] Pipeline: ${pipelineData.length} jobs`);

    dashboardDataHydrated = true;
    renderAll();
    updateLastRefresh();
    if (!initialSheetAccessResolved) {
      if (getOAuthClientId() && !accessToken) {
        // OAuth is configured but user is signed out. If data loaded successfully
        // via JSONP (public sheet), allow read-only dashboard access. Only block
        // with sign-in gate when data failed to load.
        if (pipelineRows) {
          initialSheetAccessResolved = true;
          revealDashboardShell();
          runPostAccessBootstrapOnce();
        } else {
          showSheetAccessGate("signin");
        }
        return true;
      }
      initialSheetAccessResolved = true;
      revealDashboardShell();
      runPostAccessBootstrapOnce();
    }
    return true;
  } catch (err) {
    console.error("[JobBored] Error loading data:", err);
    if (!initialSheetAccessResolved) {
      showSheetAccessGate(
        !accessToken && getOAuthClientId() ? "signin" : "error",
      );
    } else {
      showErrorState();
    }
    dataLoadFailed = true;
    return false;
  } finally {
    if (refreshBtn) refreshBtn.classList.remove("loading");
  }
}

function showErrorState() {
  const jobCards = document.getElementById("jobCards");
  const errorState = document.getElementById("errorState");
  const errorOpenDirect = document.getElementById("errorOpenDirect");
  const errorViewSheet = document.getElementById("errorViewSheet");
  const errorHint = document.getElementById("errorStateHint");

  jobCards.innerHTML = "";
  errorState.style.display = "block";
  errorOpenDirect.href = window.location.href;
  errorViewSheet.href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  if (errorHint) {
    if (getOAuthClientId()) {
      errorHint.textContent =
        "Confirm you’re signed in with Google and the Sheet ID is correct.";
    } else {
      errorHint.textContent =
        "Publish the sheet for public read access, or add an OAuth client in Settings.";
    }
  }
}

function hideErrorState() {
  document.getElementById("errorState").style.display = "none";
}

// ============================================
// RENDERING
// ============================================

function renderAll() {
  renderPipeline();
  renderBrief();
}

function renderStats() {
  // Momentum metrics are now rendered as part of renderBrief()
}

function animateNumber(id, value) {
  const el = document.getElementById(id);
  if (el.textContent === "—" || el.textContent === "0") {
    el.textContent = value;
    return;
  }
  const start = parseInt(el.textContent) || 0;
  if (start === value) return;
  const duration = 400;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (value - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// --- Pipeline ---
function normalizeStatusStr(status) {
  return (status || "").trim().toLowerCase();
}

/** Inbox: not yet in downstream stages (New, Researching, or blank). */
function isInboxJob(job) {
  const s = normalizeStatusStr(job.status);
  if (!s) return true;
  return s === "new" || s === "researching";
}

// ---- Pipeline Board helpers ----

function stageToCssKey(stage) {
  return stage.toLowerCase().replace(/\s+/g, "-");
}

const _LOGO_CACHE = new Map();
const _LOGO_PENDING = new Set();

function _fetchCompanyLogo(name) {
  if (_LOGO_CACHE.has(name) || _LOGO_PENDING.has(name)) return;
  _LOGO_PENDING.add(name);
  fetch(
    "https://autocomplete.clearbit.com/v1/companies/suggest?query=" +
      encodeURIComponent(name),
  )
    .then(function (r) {
      return r.ok ? r.json() : [];
    })
    .then(function (results) {
      var url = "";
      if (Array.isArray(results) && results.length) {
        var hit = results[0];
        if (hit && hit.logo) {
          url = hit.logo;
        } else if (hit && hit.domain) {
          url =
            "https://www.google.com/s2/favicons?domain=" +
            encodeURIComponent(hit.domain) +
            "&sz=128";
        }
      }
      _LOGO_CACHE.set(name, url);
      _LOGO_PENDING.delete(name);
      if (url) _upgradePlaceholders(name, url);
    })
    .catch(function () {
      _LOGO_CACHE.set(name, "");
      _LOGO_PENDING.delete(name);
    });
}

function _upgradePlaceholders(companyName, logoUrl) {
  document
    .querySelectorAll(
      '.co-logo-wrap[data-company="' + CSS.escape(companyName) + '"]',
    )
    .forEach(function (wrap) {
      var fallback = wrap.querySelector(".co-logo--fallback");
      if (!fallback) return;
      var img = document.createElement("img");
      img.className = fallback.className
        .replace("co-logo--fallback", "")
        .trim();
      img.src = logoUrl;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = function () {
        img.remove();
      };
      fallback.before(img);
      fallback.remove();
    });
}

/**
 * Render a logo wrapper. Shows initials immediately. If a Clearbit result
 * is cached it renders an <img> directly; otherwise kicks off the async
 * lookup and upgrades the placeholder when it resolves.
 */
function renderLogoHtml(job, variant) {
  var companyName = (job.company || "").trim();
  var initial = (companyName || "?").charAt(0).toUpperCase();
  var sizeClass =
    variant === "drawer"
      ? "co-logo--lg"
      : variant === "kanban"
        ? "co-logo--sm"
        : "co-logo--md";
  var cachedUrl =
    safeHref(job.logoUrl) || safeHref(_LOGO_CACHE.get(companyName)) || "";
  var inner;

  if (cachedUrl) {
    inner =
      '<img class="co-logo ' +
      sizeClass +
      '" src="' +
      escapeHtml(cachedUrl) +
      '" alt="" loading="lazy" referrerpolicy="no-referrer">';
  } else {
    inner =
      '<span class="co-logo co-logo--fallback ' +
      sizeClass +
      '" aria-hidden="true">' +
      escapeHtml(initial) +
      "</span>";
    if (companyName) _fetchCompanyLogo(companyName);
  }

  return (
    '<span class="co-logo-wrap" data-company="' +
    escapeHtml(companyName) +
    '">' +
    inner +
    "</span>"
  );
}

/**
 * Location + salary — shared strip (list card, board card, drawer header).
 * @param {"card"|"kanban"|"drawer"} variant
 */
function renderRoleFactsHtml(job, variant = "card") {
  const rawSalary = String(job.salary ?? "").trim();
  const salaryStr =
    rawSalary.includes("<") ||
    rawSalary.includes("&lt;") ||
    rawSalary.includes("&gt;") ||
    rawSalary.length > 120
      ? ""
      : rawSalary;
  const showSalary = salaryStr && salaryStr.toLowerCase() !== "not listed";
  const loc = job.location ? String(job.location).trim() : "";
  if (!loc && !showSalary) return "";
  const mod =
    variant === "drawer"
      ? "role-facts--drawer"
      : variant === "kanban"
        ? "role-facts--kanban"
        : "role-facts--card";
  const parts = [];
  if (loc) {
    parts.push(
      `<div class="role-fact"><span class="role-fact__label">Location</span><span class="role-fact__value">${escapeHtml(loc)}</span></div>`,
    );
  }
  if (showSalary) {
    parts.push(
      `<div class="role-fact"><span class="role-fact__label">Salary</span><span class="role-fact__value role-fact__value--salary">${escapeHtml(salaryStr)}</span></div>`,
    );
  }
  return `<div class="role-facts ${mod}" role="group" aria-label="Location and compensation">${parts.join("")}</div>`;
}

function groupByStage(data) {
  const byStage = new Map(STAGE_ORDER.map((s) => [s, []]));
  for (const job of data) {
    const raw = (job.status || "").trim();
    const key =
      STAGE_ORDER.find((s) => s.toLowerCase() === raw.toLowerCase()) || "New";
    byStage.get(key).push(job);
  }
  return byStage;
}

function renderKanbanCard(job, index) {
  const dataIndex = pipelineData.indexOf(job);
  const stableKey = dataIndex >= 0 ? dataIndex : index;
  const title = job.title || "Untitled Role";
  const company = job.company || "Unknown Company";
  const roleFactsHtml = renderRoleFactsHtml(job, "kanban");
  const isViewed = viewedJobKeys.has(stableKey);

  // First 3 tags from the sheet Tags column
  const tagChips = job.tags
    ? job.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((t) => `<span class="kanban-card__tag">${escapeHtml(t)}</span>`)
        .join("")
    : "";

  const stageClass = `kanban-card--stage-${stageToCssKey((job.status || "new").trim() || "new")}`;

  return `
    <article class="kanban-card ${stageClass}${isViewed ? " kanban-card--viewed" : ""}" role="button" tabindex="0" data-action="open-detail" data-stable-key="${stableKey}" ${dataIndex >= 0 ? `data-index="${dataIndex}"` : ""} style="animation-delay:${index * 30}ms">
      ${isViewed ? `<span class="kanban-card__viewed-dot" aria-label="Previously viewed" title="Previously viewed"></span>` : ""}
      <div class="kanban-card__identity">
        ${renderLogoHtml(job, "kanban")}
        <div class="kanban-card__identity-text">
          <span class="kanban-card__title">${escapeHtml(title)}</span>
          <span class="kanban-card__company">${escapeHtml(company)}</span>
        </div>
      </div>
      ${roleFactsHtml}
      ${tagChips ? `<div class="kanban-card__tags">${tagChips}</div>` : ""}
    </article>`;
}

function renderStageLane(stage, jobs) {
  const isExpanded = expandedStages.has(stage);
  const isArchive = STAGE_ARCHIVE.has(stage);
  const cssKey = stageToCssKey(stage);

  return `
    <section class="stage-lane${isArchive ? " stage-lane--archive" : ""}${isExpanded ? " stage-lane--expanded" : ""}" data-stage="${escapeHtml(stage)}">
      <button type="button" class="stage-lane__header" data-action="toggle-stage" data-stage="${escapeHtml(stage)}">
        <span class="stage-dot stage-dot--${cssKey}" aria-hidden="true"></span>
        <span class="stage-lane__name">${escapeHtml(stage)}</span>
        <span class="stage-lane__count">${jobs.length}</span>
        <svg class="stage-lane__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="stage-lane__body">
        <div class="stage-lane__scroll-area">
          <button type="button" class="stage-lane__nav stage-lane__nav--prev" data-action="scroll-stage" data-dir="prev" data-stage="${escapeHtml(stage)}" aria-label="Scroll left" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="stage-lane__track" id="track-${cssKey}">
            ${jobs.map((job, i) => renderKanbanCard(job, i)).join("")}
          </div>
          <button type="button" class="stage-lane__nav stage-lane__nav--next" data-action="scroll-stage" data-dir="next" data-stage="${escapeHtml(stage)}" aria-label="Scroll right">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="stage-lane__indicator">
          <div class="stage-indicator-thumb" id="thumb-${cssKey}"></div>
        </div>
      </div>
    </section>`;
}

function renderPipelineBoard(data) {
  const byStage = groupByStage(data);
  const lanes = STAGE_ORDER.filter((stage) => byStage.get(stage).length > 0)
    .map((stage) => renderStageLane(stage, byStage.get(stage)))
    .join("");
  return lanes ? `<div class="pipeline-board">${lanes}</div>` : "";
}

// ---- Detail drawer ----

function handleDetailEscape(e) {
  if (e.key === "Escape") closeJobDetail();
}

function renderStageStepper(job, dataIndex) {
  const stages = [
    "New",
    "Researching",
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
  ];
  const normalized = (job.status || "").trim().toLowerCase();
  const curIdx = stages.findIndex((s) => s.toLowerCase() === normalized);
  const activeIdx = curIdx >= 0 ? curIdx : 0;
  const isTerminal = activeIdx >= 6; // Rejected or Passed

  return `<div class="stage-stepper-wrap">
    <button type="button" class="stage-stepper__chevron stage-stepper__chevron--left" data-action="scroll-stage" data-dir="-1" aria-label="Scroll left">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <div class="stage-stepper" role="group" aria-label="Pipeline stage">${stages
      .map((s, i) => {
        let cls = "stage-step";
        if (i === activeIdx) cls += " stage-step--active";
        else if (!isTerminal && i < activeIdx) cls += " stage-step--done";
        else if (isTerminal && i < 6 && i < activeIdx)
          cls += " stage-step--done";
        if (i >= 6) cls += " stage-step--terminal";
        const connector =
          i > 0
            ? `<span class="stage-step__line${i <= activeIdx && !isTerminal ? " stage-step__line--done" : ""}"></span>`
            : "";
        return `${connector}<button type="button" class="${cls}" data-action="stage-step" data-stage="${escapeHtml(s)}" data-index="${dataIndex}" title="Move to ${escapeHtml(s)}"><span class="stage-step__dot"></span><span class="stage-step__label">${escapeHtml(s)}</span></button>`;
      })
      .join("")}</div>
    <button type="button" class="stage-stepper__chevron stage-stepper__chevron--right" data-action="scroll-stage" data-dir="1" aria-label="Scroll right">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>`;
}

function renderDrawerContent(job, stableKey) {
  const dataIndex = pipelineData.indexOf(job);
  const enr = job._postingEnrichment;
  const draftLibraryHtml =
    dataIndex >= 0 ? renderDraftLibraryCardHtml(job, dataIndex) : "";

  // ── Stage stepper ──
  const stepperHtml = isSignedIn() ? renderStageStepper(job, dataIndex) : "";

  // ── Notes (prominent, left column) ──
  const notesHtml = isSignedIn()
    ? `<div class="drawer-notes">
    <label class="drawer-section__label" for="drawer-notes-${stableKey}">Notes</label>
    <textarea id="drawer-notes-${stableKey}" class="drawer-notes__input" data-action="notes" data-index="${dataIndex}" placeholder="Interview prep, recruiter name, next steps&#8230;">${escapeHtml(job.notes || "")}</textarea>
  </div>`
    : "";

  // ── AI / role content (reused from card logic) ──
  const sheetTags = job.tags
    ? job.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const tags = (() => {
    const m = new Map();
    const add = (raw) => {
      const t = String(raw || "").trim();
      if (t) {
        const k = t.toLowerCase();
        if (!m.has(k)) m.set(k, t);
      }
    };
    sheetTags.forEach(add);
    if (enr && Array.isArray(enr.skills)) enr.skills.forEach(add);
    if (enr && Array.isArray(enr.extraKeywords)) enr.extraKeywords.forEach(add);
    return [...m.values()];
  })();

  const hookText = (() => {
    const oneLine = enr && String(enr.roleInOneLine || "").trim();
    if (oneLine) return oneLine;
    const fitAngle = enr && String(enr.fitAngle || "").trim();
    if (fitAngle)
      return fitAngle.length > 120
        ? `${fitAngle.slice(0, 117).trim()}…`
        : fitAngle;
    const fitAssess = String(job.fitAssessment || "").trim();
    if (fitAssess)
      return fitAssess.length > 120
        ? `${fitAssess.slice(0, 117).trim()}…`
        : fitAssess;
    return "";
  })();
  const hookHtml = hookText
    ? `<p class="drawer-hook">${escapeHtml(hookText)}</p>`
    : "";

  const ctxHtml = job.dateFoundRaw
    ? `<p class="drawer-context drawer-context--date">${escapeHtml(job.dateFoundRaw)}</p>`
    : "";

  // AI Summary
  const aiText = String(enr?.postingSummary || "").trim();
  const aiHtml = aiText
    ? `<div class="drawer-ai-section"><span class="drawer-section__label">AI Summary</span><p class="drawer-ai-text">${escapeHtml(aiText)}</p></div>`
    : "";

  // Fit — always show full text, no truncation
  const fitAngle = enr && String(enr.fitAngle || "").trim();
  const fitAssessment = String(job.fitAssessment || "").trim();
  const fitText = fitAngle || fitAssessment;
  const fitHtml = fitText
    ? `<div class="drawer-ai-section"><span class="drawer-section__label">Fit</span><p class="drawer-ai-text">${escapeHtml(fitText)}</p></div>`
    : "";
  const profileMatchBadgeHtml = renderProfileMatchBadgeHtml(job, dataIndex);

  // Tags
  const SKILL_MAX = 14;
  const vis = tags.slice(0, SKILL_MAX);
  const extraN = tags.length - vis.length;
  const extraChips =
    extraN > 0
      ? tags
          .slice(SKILL_MAX)
          .map((t) => `<span class="skill-chip">${escapeHtml(t)}</span>`)
          .join("")
      : "";
  const tagsHtml =
    tags.length > 0
      ? `<div class="drawer-ai-section"><span class="drawer-section__label">Tags &amp; skills</span><div class="card-tags card-skills-tags" data-tags-wrap="${stableKey}">${vis.map((t) => `<span class="skill-chip">${escapeHtml(t)}</span>`).join("")}${extraN > 0 ? `<span class="card-tags-extra">${extraChips}</span><button type="button" class="tag-more-btn" data-action="toggle-tags" data-tags-key="${stableKey}" aria-expanded="false">+${extraN} more</button>` : ""}</div></div>`
      : "";

  // Must-haves
  const mustArr =
    enr && Array.isArray(enr.mustHaves)
      ? enr.mustHaves.map((x) => String(x).trim()).filter(Boolean)
      : [];
  const mustHtml = mustArr.length
    ? `<div class="drawer-ai-section"><span class="drawer-section__label">Must-haves</span><ul class="card-peek__list">${mustArr
        .slice(0, 8)
        .map(
          (r) =>
            `<li>${escapeHtml(r.length > 200 ? r.slice(0, 200) + "…" : r)}</li>`,
        )
        .join("")}</ul></div>`
    : "";

  // Source
  const srcHtml = job.source
    ? `<p class="card-peek__source">via ${escapeHtml(job.source)}</p>`
    : "";

  // Talking points
  const tpFromEnr =
    enr && Array.isArray(enr.talkingPoints) && enr.talkingPoints.length > 0
      ? enr.talkingPoints.map((p) => String(p).trim()).filter(Boolean)
      : null;
  const tpFromSheet = job.talkingPoints
    ? job.talkingPoints
        .split("\n")
        .map((l) => l.replace(/^[•\-\*]\s*/, "").trim())
        .filter(Boolean)
    : [];
  const tpLabel =
    tpFromEnr && tpFromEnr.length
      ? "Talking points (from posting + AI)"
      : "Talking points";
  const tpList = tpFromEnr && tpFromEnr.length ? tpFromEnr : tpFromSheet;
  const tpHtml =
    tpList.length > 0
      ? `<div class="drawer-ai-section"><span class="drawer-section__label"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ${escapeHtml(tpLabel)}</span><ul class="talking-points-list">${tpList.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul></div>`
      : "";

  // Structured lists
  const hasAiStructure =
    enr &&
    (String(enr.postingSummary || "").trim().length > 0 ||
      (Array.isArray(enr.mustHaves) && enr.mustHaves.length > 0));
  const listSec = (label, items, cls) => {
    const arr = Array.isArray(items)
      ? items.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (!arr.length) return "";
    return `<div class="posting-struct ${cls || ""}"><span class="posting-snippet-label">${escapeHtml(label)}</span><ul class="posting-req-list">${arr
      .slice(0, 12)
      .map(
        (r) =>
          `<li>${escapeHtml(r.length > 500 ? r.slice(0, 500) + "…" : r)}</li>`,
      )
      .join("")}</ul></div>`;
  };
  const structHtml =
    enr && hasAiStructure
      ? [
          listSec(
            "Responsibilities",
            enr.responsibilities,
            "posting-struct--resp",
          ),
          listSec("Nice-to-haves", enr.niceToHaves, "posting-struct--nice"),
          listSec("Tools & stack", enr.toolsAndStack, "posting-struct--tools"),
        ].join("")
      : "";

  // Enrichment loading skeleton (shown while auto-fetch is in flight)
  // _d() injects staggered animation-delay so bones shimmer in a cascade
  const _d = (ms) => `style="animation-delay:${ms}ms"`;
  const enrichmentSkeleton = `<div class="drawer-enrichment-skeleton" aria-busy="true" aria-label="Loading AI insights">

    <div class="enr-skel-card">
      <div class="enr-skel-card__head">
        <div class="enr-skel-bone enr-skel-card__arrow" ${_d(0)}></div>
        <div class="enr-skel-bone enr-skel-card__title" ${_d(40)}></div>
      </div>
      <div class="enr-skel-card__body">

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w92" ${_d(80)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w65" ${_d(120)}></div>
        </div>

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-section__label" ${_d(160)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w100" ${_d(200)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w92"  ${_d(240)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w83"  ${_d(280)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w56"  ${_d(320)}></div>
        </div>

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-section__label" ${_d(360)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w83" ${_d(400)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w65" ${_d(440)}></div>
        </div>

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-section__label" ${_d(480)}></div>
          <div class="enr-skel-chips">
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--sm" ${_d(520)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--md" ${_d(550)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--xs" ${_d(580)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--lg" ${_d(610)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--sm" ${_d(640)}></div>
            <div class="enr-skel-bone enr-skel-chip enr-skel-chip--xs" ${_d(670)}></div>
          </div>
        </div>

        <div class="enr-skel-section">
          <div class="enr-skel-bone enr-skel-section__label" ${_d(700)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w92" ${_d(730)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w74" ${_d(760)}></div>
          <div class="enr-skel-bone enr-skel-line enr-skel-line--w83" ${_d(790)}></div>
        </div>

      </div>
    </div>

    <div class="enr-skel-tp">
      <div class="enr-skel-bone enr-skel-tp__label" ${_d(820)}></div>
      <div class="enr-skel-tp__item">
        <div class="enr-skel-bone enr-skel-tp__bullet" ${_d(850)}></div>
        <div class="enr-skel-bone enr-skel-tp__text enr-skel-line--w83" ${_d(850)}></div>
      </div>
      <div class="enr-skel-tp__item">
        <div class="enr-skel-bone enr-skel-tp__bullet" ${_d(880)}></div>
        <div class="enr-skel-bone enr-skel-tp__text enr-skel-line--w92" ${_d(880)}></div>
      </div>
      <div class="enr-skel-tp__item">
        <div class="enr-skel-bone enr-skel-tp__bullet" ${_d(910)}></div>
        <div class="enr-skel-bone enr-skel-tp__text enr-skel-line--w65" ${_d(910)}></div>
      </div>
      <div class="enr-skel-tp__item">
        <div class="enr-skel-bone enr-skel-tp__bullet" ${_d(940)}></div>
        <div class="enr-skel-bone enr-skel-tp__text enr-skel-line--w74" ${_d(940)}></div>
      </div>
    </div>

  </div>`;

  const llmWarn =
    enr && enr.llmError
      ? `<p class="posting-llm-warn">${escapeHtml(enr.llmError)}</p>`
      : "";

  // ── Right column: compact property panel ──
  const normalized = (job.status || "").trim().toLowerCase();

  const followUpVal = job.followUpDate || "";
  const followUpIsOverdue = followUpVal && new Date(followUpVal) < new Date();

  const respSel = selectedResponseSheetValue(job);

  const stageOptions = STAGE_ORDER.map((s) => {
    const sel = s.toLowerCase() === normalized || (!normalized && s === "New");
    return `<option value="${escapeHtml(s)}"${sel ? " selected" : ""}>${escapeHtml(s)}</option>`;
  }).join("");

  const propsHtml = isSignedIn()
    ? `<div class="drawer-props">
    <div class="drawer-prop">
      <svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      <span class="drawer-prop__key">Stage</span>
      <select class="drawer-prop__val status-select" data-action="status-select" data-index="${dataIndex}">${stageOptions}</select>
    </div>
    <div class="drawer-prop">
      <svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="drawer-prop__key">Follow-up</span>
      <input type="date" class="drawer-prop__val followup-input" data-action="followup" data-index="${dataIndex}" value="${escapeHtml(followUpVal)}" />
      ${followUpIsOverdue ? '<span class="overdue-badge">overdue</span>' : ""}
    </div>
    <div class="drawer-prop">
      <svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span class="drawer-prop__key">Last contact</span>
      <input type="text" class="drawer-prop__val last-heard-input" data-action="last-heard" data-index="${dataIndex}" value="${escapeHtml(job.lastHeardFrom || "")}" placeholder="e.g. Jan 12" autocomplete="off" />
    </div>
    <div class="drawer-prop">
      <svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="drawer-prop__key">Reply</span>
      <select class="drawer-prop__val response-select" data-action="response-flag" data-index="${dataIndex}">
        <option value="">Not set</option>
        <option value="Yes"${respSel === "Yes" ? " selected" : ""}>Yes</option>
        <option value="No"${respSel === "No" ? " selected" : ""}>No</option>
        <option value="Unknown"${respSel === "Unknown" ? " selected" : ""}>Not sure</option>
      </select>
    </div>
    ${job.appliedDate ? `<div class="drawer-prop"><svg class="drawer-prop__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg><span class="drawer-prop__key">Applied</span><span class="drawer-prop__val drawer-prop__val--static">${escapeHtml(job.appliedDate)}</span></div>` : ""}
  </div>`
    : "";

  // Assemble
  const aboutHasContent = aiHtml || fitHtml || tagsHtml || mustHtml || srcHtml;
  const aboutSection = aboutHasContent
    ? `<details class="drawer-about" open><summary class="drawer-about__toggle">About this role</summary><div class="drawer-about__body">${hookHtml}${ctxHtml}${aiHtml}${fitHtml}${tagsHtml}${mustHtml}${srcHtml}</div></details>`
    : `${hookHtml}${ctxHtml}`;

  // While enrichment is in-flight and no cached data exists yet, show only the
  // skeleton — suppress talking points and structured sections so nothing
  // appears before LLM data is ready.
  const mainColContent =
    job._enrichmentLoading && !enr
      ? enrichmentSkeleton
      : `${aboutSection}${tpHtml}${structHtml}${llmWarn}`;

  return `<div class="drawer-content">
    ${stepperHtml}
    ${profileMatchBadgeHtml}
    <div class="drawer-columns">
      <div class="drawer-col drawer-col--main">
        ${mainColContent}
      </div>
      <div class="drawer-col drawer-col--props">
        ${propsHtml}
        <div class="drawer-inputs">
          ${notesHtml}
        </div>
        ${draftLibraryHtml}
      </div>
    </div>
  </div>`;
}

function openJobDetail(stableKey) {
  closeJobDetail();
  const job = pipelineData[stableKey];
  if (!job) return;
  activeDetailKey = stableKey;
  markJobViewed(stableKey);

  const overlay = document.createElement("div");
  overlay.className = "detail-overlay";
  overlay.id = "detailOverlay";
  const drawerActionsHtml = (() => {
    const coverBtn =
      stableKey >= 0
        ? `<button type="button" class="drawer-btn drawer-btn--cover" data-action="resume-cover" data-index="${stableKey}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Cover letter
        </button>`
        : "";
    const tailorBtn =
      stableKey >= 0
        ? `<button type="button" class="drawer-btn drawer-btn--tailor" data-action="resume-tailor" data-index="${stableKey}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Tailor resume
        </button>`
        : "";
    const viewBtn = safeHref(job.link)
      ? `<a href="${escapeHtml(safeHref(job.link))}" target="_blank" rel="noopener" class="drawer-btn drawer-btn--view">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          View posting
        </a>`
      : "";
    if (!viewBtn && !coverBtn && !tailorBtn) return "";
    return `<div class="detail-drawer__actions">${coverBtn}${tailorBtn}${viewBtn}</div>`;
  })();

  overlay.innerHTML = `
    <button class="detail-overlay__backdrop" data-action="close-detail" aria-label="Close detail panel"></button>
    <aside class="detail-drawer" role="complementary" aria-label="${escapeHtml(job.title || "Job detail")}">
      <div class="detail-drawer__head">
        ${renderLogoHtml(job, "drawer")}
        <div class="detail-drawer__head-main">
          <h2 class="detail-drawer__head-title">${escapeHtml(job.title || "Job detail")}</h2>
          ${
            job.company
              ? `<p class="detail-drawer__head-company">${escapeHtml(job.company)}</p>`
              : ""
          }
          ${renderRoleFactsHtml(job, "drawer")}
        </div>
        <button type="button" class="detail-drawer__close" data-action="close-detail" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${drawerActionsHtml}
      <div class="detail-drawer__body">
        ${renderDrawerContent(job, stableKey)}
      </div>
    </aside>`;

  document.body.appendChild(overlay);
  document.body.classList.add("detail-open");

  attachCardListeners();

  overlay.querySelectorAll('[data-action="close-detail"]').forEach((el) => {
    el.addEventListener("click", closeJobDetail);
  });
  document.addEventListener("keydown", handleDetailEscape);

  // Auto-fetch enrichment only when the scraper is configured and the job hasn't been scraped yet.
  // Guard against getJobPostingScrapeUrl() returning null to avoid a noisy toast on every open.
  if (
    job.link &&
    !job._postingEnrichment?.scrapedAt &&
    getJobPostingScrapeUrl()
  ) {
    fetchJobPostingEnrichment(stableKey).catch(() => {});
  }
}

function closeJobDetail() {
  const overlay = document.getElementById("detailOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", handleDetailEscape);
  document.body.classList.remove("detail-open");
  activeDetailKey = -1;
}

function refreshDrawerIfOpen(dataIndex) {
  const overlay = document.getElementById("detailOverlay");
  if (!overlay || activeDetailKey !== dataIndex) return;
  const job = pipelineData[dataIndex];
  if (!job) return;
  const body = overlay.querySelector(".detail-drawer__body");
  if (!body) return;

  // Capture scroll position so re-render doesn't jump
  const drawer = overlay.querySelector(".detail-drawer");
  const scrollTop = drawer ? drawer.scrollTop : 0;

  body.innerHTML = renderDrawerContent(job, dataIndex);

  attachCardListeners();

  // Re-wire close buttons that are inside the body (backdrop/head close are already wired)
  overlay.querySelectorAll('[data-action="close-detail"]').forEach((el) => {
    el.addEventListener("click", closeJobDetail);
  });

  if (drawer) drawer.scrollTop = scrollTop;
}

function updateTrackIndicator(track) {
  const cssKey = track.id.replace("track-", "");
  const thumb = document.getElementById(`thumb-${cssKey}`);
  const bar = thumb ? thumb.parentElement : null;
  if (!thumb || !bar) return;
  const { scrollLeft, scrollWidth, clientWidth } = track;
  if (scrollWidth <= clientWidth + 2) {
    bar.style.visibility = "hidden";
    return;
  }
  bar.style.visibility = "";
  const ratio = clientWidth / scrollWidth;
  const pos = scrollLeft / (scrollWidth - clientWidth);
  thumb.style.width = `${ratio * 100}%`;
  thumb.style.left = `${pos * (100 - ratio * 100)}%`;
}

function updateNavVisibility(track) {
  const lane = track.closest(".stage-lane");
  if (!lane) return;
  const { scrollLeft, scrollWidth, clientWidth } = track;
  const noScroll = scrollWidth <= clientWidth + 2;
  const atStart = scrollLeft < 2;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - 2;
  const prev = lane.querySelector(
    '[data-action="scroll-stage"][data-dir="prev"]',
  );
  const next = lane.querySelector(
    '[data-action="scroll-stage"][data-dir="next"]',
  );
  if (prev) prev.disabled = atStart || noScroll;
  if (next) next.disabled = atEnd || noScroll;
}

function attachBoardListeners() {
  // Stage collapse toggle + indicator init on expand
  document.querySelectorAll('[data-action="toggle-stage"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const stage = btn.dataset.stage;
      const lane = btn.closest(".stage-lane");
      if (!lane) return;
      const nowExpanded = lane.classList.toggle("stage-lane--expanded");
      if (nowExpanded) {
        expandedStages.add(stage);
        const track = document.getElementById(`track-${stageToCssKey(stage)}`);
        if (track) {
          updateTrackIndicator(track);
          updateNavVisibility(track);
        }
      } else {
        expandedStages.delete(stage);
      }
    });
  });

  // Horizontal chevron navigation
  document.querySelectorAll('[data-action="scroll-stage"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      // Board scroll buttons (inside a stage-lane with data-stage)
      if (btn.dataset.stage) {
        const track = document.getElementById(
          `track-${stageToCssKey(btn.dataset.stage)}`,
        );
        if (!track) return;
        const card = track.querySelector(".kanban-card");
        const step = card ? card.offsetWidth + 12 : 228;
        track.scrollBy({
          left: btn.dataset.dir === "next" ? step : -step,
          behavior: "smooth",
        });
        return;
      }
      // Drawer stepper chevrons (inside stage-stepper-wrap)
      const stepper = btn.closest(".stage-stepper-wrap");
      if (stepper) {
        const inner = stepper.querySelector(".stage-stepper");
        if (inner)
          inner.scrollBy({
            left: parseInt(btn.dataset.dir, 10) * 80,
            behavior: "smooth",
          });
      }
    });
  });

  // Scroll indicator + nav state on scroll
  document.querySelectorAll(".stage-lane__track").forEach((track) => {
    updateTrackIndicator(track);
    updateNavVisibility(track);
    track.addEventListener(
      "scroll",
      () => {
        updateTrackIndicator(track);
        updateNavVisibility(track);
      },
      { passive: true },
    );
  });

  // Detail drawer — click or keyboard Enter/Space on the card
  document.querySelectorAll('[data-action="open-detail"]').forEach((el) => {
    el.addEventListener("click", () => {
      const key = parseInt(el.dataset.stableKey, 10);
      if (!Number.isNaN(key)) openJobDetail(key);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const key = parseInt(el.dataset.stableKey, 10);
        if (!Number.isNaN(key)) openJobDetail(key);
      }
    });
  });
}

function getFilteredData() {
  let data = [...pipelineData];

  switch (currentFilter) {
    case "inbox":
      data = data.filter(isInboxJob);
      break;
    case "applied":
      data = data.filter((r) => {
        const s = normalizeStatusStr(r.status);
        return s.includes("applied");
      });
      break;
    case "interviewing":
      data = data.filter((r) => {
        const s = normalizeStatusStr(r.status);
        return s.includes("interview") || s.includes("phone");
      });
      break;
    case "negotiating":
      data = data.filter((r) => {
        const s = normalizeStatusStr(r.status);
        return s.includes("offer") || s.includes("negotiat");
      });
      break;
  }

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    data = data.filter((r) => {
      const searchable = [
        r.title,
        r.company,
        r.tags,
        r.location,
        r.source,
        r.notes,
        r.lastHeardFrom,
        r.responseFlag,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(q);
    });
  }

  switch (currentSort) {
    case "fit":
      data.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
      break;
    case "date":
      data.sort((a, b) => {
        const da = a.dateFound ? a.dateFound.getTime() : 0;
        const db = b.dateFound ? b.dateFound.getTime() : 0;
        return db - da;
      });
      break;
    case "company":
      data.sort((a, b) => (a.company || "").localeCompare(b.company || ""));
      break;
    case "priority":
      const priorityOrder = { "🔥": 0, "⚡": 1, "—": 2, "↓": 3 };
      data.sort(
        (a, b) =>
          (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2),
      );
      break;
  }

  return data;
}

function renderPipeline() {
  const container = document.getElementById("jobCards");
  const emptyState = document.getElementById("emptyState");
  const roleCountEl = document.getElementById("roleCount");

  // Board view: apply only search+sort, stages shown as collapsible lanes
  let data = [...pipelineData];

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    data = data.filter((r) => {
      return [
        r.title,
        r.company,
        r.tags,
        r.location,
        r.source,
        r.notes,
        r.lastHeardFrom,
        r.responseFlag,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }

  switch (currentSort) {
    case "fit":
      data.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
      break;
    case "date":
      data.sort((a, b) => {
        const da = a.dateFound ? a.dateFound.getTime() : 0;
        const db = b.dateFound ? b.dateFound.getTime() : 0;
        return db - da;
      });
      break;
    case "company":
      data.sort((a, b) => (a.company || "").localeCompare(b.company || ""));
      break;
    case "priority": {
      const priorityOrder = { "🔥": 0, "⚡": 1, "—": 2, "↓": 3 };
      data.sort(
        (a, b) =>
          (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2),
      );
      break;
    }
  }

  roleCountEl.textContent = `${data.length} of ${pipelineData.length}`;

  if (data.length === 0 && !dataLoadFailed) {
    container.innerHTML = "";
    emptyState.style.display = "block";
    const emptyTitle =
      document.getElementById("emptyStateTitle") ||
      emptyState.querySelector("h3");
    const emptyP =
      document.getElementById("emptyStateBody") ||
      emptyState.querySelector("p");
    const emptyActions = document.getElementById("emptyStateActions");
    if (emptyTitle && emptyP) {
      if (pipelineData.length === 0) {
        const discoveryView = getDiscoveryEmptyStateView(
          getDiscoveryReadinessSnapshot(),
        );
        emptyTitle.textContent = discoveryView.title || "No roles yet";
        emptyP.textContent =
          discoveryView.body || "Open discovery setup to connect automation.";
        if (emptyActions) {
          if (discoveryView.ctaLabel && discoveryView.ctaAction) {
            emptyActions.innerHTML = `<button type="button" class="btn-empty-cta" data-empty-action="${escapeHtml(discoveryView.ctaAction)}">${escapeHtml(discoveryView.ctaLabel)}</button>`;
            emptyActions.style.display = "flex";
            emptyActions.setAttribute("aria-hidden", "false");
          } else {
            emptyActions.innerHTML = "";
            emptyActions.style.display = "none";
            emptyActions.setAttribute("aria-hidden", "true");
          }
        }
      } else {
        emptyTitle.textContent = "No roles match";
        emptyP.textContent = "Clear the search box or try a different term.";
        if (emptyActions) {
          emptyActions.innerHTML = "";
          emptyActions.style.display = "none";
          emptyActions.setAttribute("aria-hidden", "true");
        }
      }
    }
    return;
  }

  emptyState.style.display = "none";
  if (data.length === 0) return;

  container.innerHTML = renderPipelineBoard(data);
  attachBoardListeners();
}

function renderJobCard(job, index) {
  const dataIndex = pipelineData.indexOf(job);
  const stableKey = dataIndex >= 0 ? dataIndex : index;

  const priorityClass =
    job.priority === "🔥"
      ? "priority-hot"
      : job.priority === "⚡"
        ? "priority-high"
        : "";

  const enr = job._postingEnrichment;
  const sheetTags = job.tags
    ? job.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const tags = (() => {
    const m = new Map();
    const add = (raw) => {
      const t = String(raw || "").trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (!m.has(k)) m.set(k, t);
    };
    sheetTags.forEach(add);
    if (enr && Array.isArray(enr.skills)) enr.skills.forEach(add);
    if (enr && Array.isArray(enr.extraKeywords)) enr.extraKeywords.forEach(add);
    return [...m.values()];
  })();

  const title = job.title || "Untitled Role";
  const company = job.company || "Unknown Company";

  // ---- Tier 1: Identity ----
  const stageLabel = (job.status || "").trim();
  const stagePillHtml = stageLabel
    ? ` <span class="card-stage-pill">${escapeHtml(stageLabel)}</span>`
    : "";

  const roleFactsHtml = renderRoleFactsHtml(job, "card");
  const dateFoundLineHtml = job.dateFoundRaw
    ? `<p class="card-context card-context--date">${escapeHtml(job.dateFoundRaw)}</p>`
    : "";

  // ---- Tier 1: Hook (one sentence) ----
  const hookText = (() => {
    const oneLine = enr && String(enr.roleInOneLine || "").trim();
    if (oneLine) return oneLine;
    const fitAngle = enr && String(enr.fitAngle || "").trim();
    if (fitAngle)
      return fitAngle.length > 120
        ? `${fitAngle.slice(0, 117).trim()}…`
        : fitAngle;
    const fitAssess = String(job.fitAssessment || "").trim();
    if (fitAssess)
      return fitAssess.length > 120
        ? `${fitAssess.slice(0, 117).trim()}…`
        : fitAssess;
    return "";
  })();
  const hookHtml = hookText
    ? `<p class="card-hook">${escapeHtml(hookText)}</p>`
    : "";

  // ---- Tier 2: Peek (<details> disclosure) ----
  const hasAiStructure =
    enr &&
    (String(enr.postingSummary || "").trim().length > 0 ||
      (Array.isArray(enr.mustHaves) && enr.mustHaves.length > 0));

  const peekHasContent =
    hasAiStructure ||
    tags.length > 0 ||
    (enr && Array.isArray(enr.mustHaves) && enr.mustHaves.length > 0) ||
    job.source;

  // AI summary (full)
  const aiSummaryText = String(enr?.postingSummary || "").trim();
  const aiSummaryHtml = aiSummaryText
    ? `<div class="card-peek__section">
        <span class="card-peek__label">AI Summary</span>
        <p class="card-peek__text">${escapeHtml(aiSummaryText)}</p>
      </div>`
    : "";

  // Fit verdict — only show in peek if the hook line isn't already sourced from the same text
  const fitAngle = enr && String(enr.fitAngle || "").trim();
  const fitAssessment = String(job.fitAssessment || "").trim();
  const fitText = fitAngle || fitAssessment;
  // hookText used roleInOneLine when available; only show full fit text if the hook was different
  const hookUsedFitText =
    !!(enr && String(enr.roleInOneLine || "").trim()) === false && !!fitText;
  const fitVerdictHtml =
    fitText && !hookUsedFitText
      ? `<div class="card-peek__section">
        <span class="card-peek__label">Fit</span>
        <p class="card-peek__text">${escapeHtml(fitText)}</p>
      </div>`
      : "";

  // Tags / skill chips
  const SKILL_SHOW_FIRST = 14;
  const skillVisible = tags.slice(0, SKILL_SHOW_FIRST);
  const skillExtraCount = tags.length - skillVisible.length;
  const skillExtraHtml =
    skillExtraCount > 0
      ? tags
          .slice(SKILL_SHOW_FIRST)
          .map((t) => `<span class="skill-chip">${escapeHtml(t)}</span>`)
          .join("")
      : "";
  const tagsHtml =
    tags.length > 0
      ? `<div class="card-peek__section">
        <span class="card-peek__label">Tags &amp; skills</span>
        <div class="card-tags card-skills-tags" data-tags-wrap="${stableKey}">
          ${skillVisible.map((t) => `<span class="skill-chip">${escapeHtml(t)}</span>`).join("")}
          ${
            skillExtraCount > 0
              ? `<span class="card-tags-extra">${skillExtraHtml}</span>
          <button type="button" class="tag-more-btn" data-action="toggle-tags" data-tags-key="${stableKey}" aria-expanded="false">+${skillExtraCount} more</button>`
              : ""
          }
        </div>
      </div>`
      : "";

  // Must-haves
  const mustHavesHtml = (() => {
    const arr =
      enr && Array.isArray(enr.mustHaves)
        ? enr.mustHaves.map((x) => String(x).trim()).filter(Boolean)
        : [];
    if (!arr.length) return "";
    return `<div class="card-peek__section">
      <span class="card-peek__label">Must-haves</span>
      <ul class="card-peek__list">${arr
        .slice(0, 8)
        .map(
          (r) =>
            `<li>${escapeHtml(r.length > 200 ? `${r.slice(0, 200)}…` : r)}</li>`,
        )
        .join("")}</ul>
    </div>`;
  })();

  // Source
  const sourceHtml = job.source
    ? `<p class="card-peek__source">via ${escapeHtml(job.source)}</p>`
    : "";

  const peekBodyHtml =
    aiSummaryHtml || fitVerdictHtml || tagsHtml || mustHavesHtml || sourceHtml
      ? `${aiSummaryHtml}${fitVerdictHtml}${tagsHtml}${mustHavesHtml}${sourceHtml}`
      : "";

  const peekHtml = peekHasContent
    ? `<details class="card-peek">
        <summary class="card-peek__toggle">More about this role</summary>
        <div class="card-peek__body">${peekBodyHtml}</div>
      </details>`
    : "";

  // ---- Tier 1: Action row ----
  const actionsHtml = renderCardActions(job, stableKey);

  const viewRoleBtn = safeHref(job.link)
    ? `<a href="${escapeHtml(safeHref(job.link))}" target="_blank" rel="noopener" class="card-action card-action--primary">
        View role
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>`
    : "";

  const resumeCoverBtn =
    dataIndex >= 0
      ? `<button type="button" class="card-action" data-action="resume-cover" data-index="${dataIndex}">Cover letter</button>`
      : "";

  const resumeTailorBtn =
    dataIndex >= 0
      ? `<button type="button" class="card-action" data-action="resume-tailor" data-index="${dataIndex}">Tailor resume</button>`
      : "";

  const actionsRowHtml =
    viewRoleBtn || resumeCoverBtn || resumeTailorBtn
      ? `<div class="card-actions-row">
        ${viewRoleBtn}
        ${resumeCoverBtn}
        ${resumeTailorBtn}
        <button
          type="button"
          class="card-action card-action--expand"
          data-action="toggle-card"
          data-stable-key="${stableKey}"
          ${dataIndex >= 0 ? `data-index="${dataIndex}"` : ""}
          aria-expanded="false"
          aria-controls="job-details-${stableKey}"
          aria-label="Show posting details and pipeline notes"
          title="Expand posting details and notes"
        >
          <svg class="details-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>`
      : "";

  // ---- Tier 3: Expand band (same structure, enriched content) ----

  // Talking points
  let talkingPointsHtml = "";
  const tpFromEnr =
    enr && Array.isArray(enr.talkingPoints) && enr.talkingPoints.length > 0
      ? enr.talkingPoints.map((p) => String(p).trim()).filter(Boolean)
      : null;
  const tpFromSheet = job.talkingPoints
    ? job.talkingPoints
        .split("\n")
        .map((l) => l.replace(/^[•\-\*]\s*/, "").trim())
        .filter(Boolean)
    : [];
  const tpLabel =
    tpFromEnr && tpFromEnr.length
      ? "Talking points (from posting + AI)"
      : "Talking points";
  const tpList = tpFromEnr && tpFromEnr.length ? tpFromEnr : tpFromSheet;
  if (tpList.length > 0) {
    talkingPointsHtml = `
        <div class="talking-points-block">
          <div class="talking-points-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            ${escapeHtml(tpLabel)}
          </div>
          <ul class="talking-points-list">
            ${tpList.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
          </ul>
        </div>
      `;
  }

  // Structured lists for expanded (responsibilities, nice-to-haves, tools/stack)
  const listSection = (label, items, cls) => {
    const arr = Array.isArray(items)
      ? items.map((x) => String(x).trim()).filter(Boolean)
      : [];
    if (!arr.length) return "";
    return `<div class="posting-struct ${cls || ""}"><span class="posting-snippet-label">${escapeHtml(label)}</span><ul class="posting-req-list">${arr
      .slice(0, 12)
      .map(
        (r) =>
          `<li>${escapeHtml(r.length > 500 ? `${r.slice(0, 500)}…` : r)}</li>`,
      )
      .join("")}</ul></div>`;
  };

  const structuredListsHtml =
    enr && hasAiStructure
      ? [
          listSection(
            "Responsibilities",
            enr.responsibilities,
            "posting-struct--resp",
          ),
          listSection("Nice-to-haves", enr.niceToHaves, "posting-struct--nice"),
          listSection(
            "Tools & stack",
            enr.toolsAndStack,
            "posting-struct--tools",
          ),
        ].join("")
      : "";

  // Meta info (contact, reply, heard) — only in Tier 3
  const contactChip =
    job.contact && job.contact !== "Not found"
      ? `<span class="meta-chip meta-chip--contact">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        ${escapeHtml(job.contact)}
      </span>`
      : "";

  const replyLabel = responseLabelForDisplay(job.responseFlag);
  const replyChip = replyLabel
    ? `<span class="meta-chip meta-chip--reply">Reply: ${escapeHtml(replyLabel)}</span>`
    : "";
  const heardChip = job.lastHeardFrom
    ? `<span class="meta-chip meta-chip--heard">Last contact: ${escapeHtml(job.lastHeardFrom)}</span>`
    : "";

  const contactRowHtml =
    contactChip || heardChip || replyChip
      ? `<div class="card-meta card-meta--chips card-meta--secondary">${contactChip}${heardChip}${replyChip}</div>`
      : "";

  const postingLlmWarn =
    enr && enr.llmError
      ? `<p class="posting-llm-warn">${escapeHtml(enr.llmError)}</p>`
      : "";

  // Expanded left column: LLM-structured lists + optional LLM error
  const expandedLeftExtra =
    structuredListsHtml || postingLlmWarn
      ? `<div class="expanded-extra">${structuredListsHtml}${postingLlmWarn}</div>`
      : "";
  const profileMatchHtml = renderProfileMatchSectionHtml(job);
  const draftLibraryHtml =
    dataIndex >= 0 ? renderDraftLibraryCardHtml(job, dataIndex) : "";

  return `
    <article class="job-card ${priorityClass}" data-stable-key="${stableKey}" style="animation-delay: ${index * 40}ms">
      <!-- Tier 1: Scan line -->
      <div class="card-identity">
        ${renderLogoHtml(job, "card")}
        <div class="card-identity__text">
          <h3 class="card-title">${escapeHtml(title)}</h3>
          <p class="card-company">${escapeHtml(company)}${stagePillHtml}</p>
        </div>
      </div>

      ${roleFactsHtml}
      ${dateFoundLineHtml}
      ${hookHtml}

      <!-- Tier 2: Peek disclosure -->
      ${peekHtml}

      <!-- Tier 1: Actions -->
      ${actionsRowHtml}

      <!-- Tier 3: Expand band -->
      <div class="job-card__details" id="job-details-${stableKey}">
        <div class="job-card__details-grid">
          <div class="details-column details-column--left">
            <div class="details-section-heading" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              Talking points
            </div>
            ${talkingPointsHtml || `<p class="details-placeholder">No talking points yet.</p>`}
            ${profileMatchHtml}
            ${expandedLeftExtra}
            ${contactRowHtml}
          </div>
          <div class="details-column details-column--right">
            <div class="details-section-heading" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              Pipeline &amp; notes
            </div>
            ${draftLibraryHtml}
            ${actionsHtml}
          </div>
        </div>
      </div>
    </article>
  `;
}
function renderCardActions(job, indexForNotesId) {
  const dataIndex = pipelineData.indexOf(job);

  if (!isSignedIn()) {
    return `
      <div class="card-actions card-actions--anon">
        <button type="button" class="btn-google-signin btn-google-signin--card" data-action="signin">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span>Continue with Google</span>
        </button>
      </div>
    `;
  }

  const statuses = [
    "New",
    "Researching",
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
  ];
  const normalized = (job.status || "").trim().toLowerCase();
  const hasStatusMatch = statuses.some((s) => s.toLowerCase() === normalized);

  const options = statuses
    .map((s) => {
      const isSel =
        (hasStatusMatch && s.toLowerCase() === normalized) ||
        (!hasStatusMatch && s === "New");
      return `<option value="${escapeHtml(s)}"${isSel ? " selected" : ""}>${escapeHtml(s)}</option>`;
    })
    .join("");

  const appliedDateHtml = job.appliedDate
    ? `
    <div class="action-meta">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      <span>Applied ${escapeHtml(job.appliedDate)}</span>
    </div>
  `
    : "";

  const followUpVal = job.followUpDate || "";
  const followUpIsOverdue = followUpVal && new Date(followUpVal) < new Date();
  const followUpHtml = `
    <div class="action-meta ${followUpIsOverdue ? "overdue" : ""}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <label class="followup-label" for="followup-${indexForNotesId}">Follow-up</label>
      <input type="date" id="followup-${indexForNotesId}" class="followup-input" data-action="followup" data-index="${dataIndex}" value="${escapeHtml(followUpVal)}" />
      ${followUpIsOverdue ? '<span class="overdue-badge">overdue</span>' : ""}
    </div>
  `;

  const respSel = selectedResponseSheetValue(job);
  const contactStatusHtml = `
    <div class="contact-status-row">
      <div class="contact-status-field">
        <label class="field-label" for="last-heard-${indexForNotesId}">Last contact</label>
        <input type="text" id="last-heard-${indexForNotesId}" class="last-heard-input" data-action="last-heard" data-index="${dataIndex}" value="${escapeHtml(job.lastHeardFrom || "")}" placeholder="e.g. Jan 12 or &ldquo;recruiter emailed&rdquo;" autocomplete="off" />
      </div>
      <div class="contact-status-field">
        <label class="field-label" for="response-${indexForNotesId}">Did they reply?</label>
        <select id="response-${indexForNotesId}" class="response-select" data-action="response-flag" data-index="${dataIndex}">
          <option value="">Not set</option>
          <option value="Yes"${respSel === "Yes" ? " selected" : ""}>Yes</option>
          <option value="No"${respSel === "No" ? " selected" : ""}>No</option>
          <option value="Unknown"${respSel === "Unknown" ? " selected" : ""}>Not sure</option>
        </select>
      </div>
    </div>
  `;

  return `
    <div class="card-actions">
      <div class="status-field">
        <label class="field-label" for="status-${dataIndex}-${indexForNotesId}">Pipeline stage</label>
        <select id="status-${dataIndex}-${indexForNotesId}" class="status-select" data-action="status-select" data-index="${dataIndex}">
          ${options}
        </select>
      </div>
      <div class="card-actions__tools">
        ${appliedDateHtml}
        ${followUpHtml}
      </div>
      ${contactStatusHtml}
      <div class="notes-wrapper">
        <label class="notes-label" for="notes-${dataIndex}-${indexForNotesId}">Notes</label>
        <textarea id="notes-${dataIndex}-${indexForNotesId}" class="notes-textarea" data-action="notes" data-index="${dataIndex}" placeholder="Interview prep, recruiter name, next step…">${escapeHtml(job.notes || "")}</textarea>
      </div>
    </div>
  `;
}

function attachCardListeners() {
  // Expand/collapse assessment
  document.querySelectorAll(".expand-btn[data-expand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.expand;
      const text = document.querySelector(`[data-expandable="${id}"]`);
      if (text) {
        text.classList.toggle("expanded");
        btn.textContent = text.classList.contains("expanded")
          ? "Show less"
          : "Show more";
      }
    });
  });

  // Card details panel + auto-fetch posting when opening (if never loaded)
  document.querySelectorAll('[data-action="toggle-card"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".job-card");
      if (!card) return;
      const k = parseInt(card.dataset.stableKey, 10);
      const expanded = card.classList.toggle("job-card--expanded");
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      btn.setAttribute(
        "aria-label",
        expanded
          ? "Hide posting details and pipeline notes"
          : "Show posting details and pipeline notes",
      );
      btn.setAttribute(
        "title",
        expanded
          ? "Hide details"
          : "Opens details; pulls posting from job URL when not loaded yet (Cheerio server).",
      );
      if (!Number.isNaN(k)) {
        if (expanded) expandedJobKeys.add(k);
        else expandedJobKeys.delete(k);
      }
      if (expanded) {
        const idx = parseInt(btn.dataset.index, 10);
        if (!Number.isNaN(idx) && pipelineData[idx]) {
          const j = pipelineData[idx];
          if (j.link && !j._postingEnrichment?.scrapedAt) {
            fetchJobPostingEnrichment(idx).catch(() => {});
          }
        }
      }
    });
  });

  // Extra tags "+N"
  document.querySelectorAll('[data-action="toggle-tags"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest("[data-tags-wrap]");
      if (!wrap) return;
      const on = wrap.classList.toggle("card-tags--expanded");
      btn.setAttribute("aria-expanded", on ? "true" : "false");
    });
  });

  // Pipeline stage select
  document.querySelectorAll('[data-action="status-select"]').forEach((sel) => {
    sel.addEventListener("change", async () => {
      const dataIndex = parseInt(sel.dataset.index, 10);
      const newStatus = sel.value;
      sel.disabled = true;
      const ok = await updateJobStatus(dataIndex, newStatus);
      if (!ok) sel.disabled = false;
    });
  });
  // Stage stepper clicks (drawer)
  document.querySelectorAll('[data-action="stage-step"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const dataIndex = parseInt(btn.dataset.index, 10);
      const newStage = btn.dataset.stage;
      btn.disabled = true;
      const ok = await updateJobStatus(dataIndex, newStage);
      if (ok) {
        refreshDrawerIfOpen(dataIndex);
        renderPipeline();
      }
      btn.disabled = false;
    });
  });

  // Profile match modal
  document
    .querySelectorAll('[data-action="open-profile-match"]')
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        if (!Number.isNaN(idx) && pipelineData[idx]) {
          openProfileMatchModal(pipelineData[idx], idx);
        }
      });
    });

  // Notes blur saves
  document.querySelectorAll('[data-action="notes"]').forEach((textarea) => {
    let originalValue = textarea.value;

    textarea.addEventListener("focus", () => {
      originalValue = textarea.value;
    });

    textarea.addEventListener("blur", async () => {
      const newValue = textarea.value.trim();
      if (newValue === originalValue.trim()) return; // No change

      const dataIndex = parseInt(textarea.dataset.index, 10);
      textarea.classList.add("saving");
      await updateJobNotes(dataIndex, newValue);
      textarea.classList.remove("saving");
      originalValue = newValue;
    });
  });

  // Follow-up date changes
  document.querySelectorAll('[data-action="followup"]').forEach((input) => {
    input.addEventListener("change", async () => {
      const dataIndex = parseInt(input.dataset.index, 10);
      await updateFollowUpDate(dataIndex, input.value);
    });
  });

  // Last contact (column R)
  document.querySelectorAll('[data-action="last-heard"]').forEach((input) => {
    let originalValue = input.value;
    input.addEventListener("focus", () => {
      originalValue = input.value;
    });
    input.addEventListener("blur", async () => {
      const newValue = input.value.trim();
      if (newValue === originalValue.trim()) return;
      const dataIndex = parseInt(input.dataset.index, 10);
      input.classList.add("saving");
      await updateLastHeardFrom(dataIndex, newValue);
      input.classList.remove("saving");
      originalValue = newValue;
    });
  });

  // Did they reply? (column S)
  document.querySelectorAll('[data-action="response-flag"]').forEach((sel) => {
    sel.addEventListener("change", async () => {
      const dataIndex = parseInt(sel.dataset.index, 10);
      sel.disabled = true;
      await updateJobResponseFlag(dataIndex, sel.value);
      sel.disabled = false;
    });
  });

  // Sign-in prompt clicks
  document.querySelectorAll('[data-action="signin"]').forEach((el) => {
    el.addEventListener("click", signIn);
  });

  document.querySelectorAll('[data-action="resume-cover"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const dataIndex = parseInt(btn.dataset.index, 10);
      if (!Number.isNaN(dataIndex))
        openDraftNotesModal(dataIndex, "cover_letter");
    });
  });

  document.querySelectorAll('[data-action="resume-tailor"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const dataIndex = parseInt(btn.dataset.index, 10);
      if (!Number.isNaN(dataIndex))
        openDraftNotesModal(dataIndex, "resume_update");
    });
  });

  document
    .querySelectorAll('[data-action="open-draft-version"]')
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const draftId = btn.dataset.draftId;
        if (draftId) void openSavedDraftVersion(draftId);
      });
    });

  document.querySelectorAll('[data-action="draft-tab"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const feature = btn.dataset.feature;
      const deck = btn.closest(".draft-deck");
      if (!deck) return;
      deck
        .querySelectorAll(".draft-deck__tab")
        .forEach((t) =>
          t.classList.toggle(
            "draft-deck__tab--active",
            t.dataset.feature === feature,
          ),
        );
      deck
        .querySelectorAll(".draft-deck__panel")
        .forEach((p) =>
          p.classList.toggle(
            "draft-deck__panel--active",
            p.dataset.feature === feature,
          ),
        );
      const activePanel = deck.querySelector(
        `.draft-deck__panel[data-feature="${feature}"]`,
      );
      const activeStack = activePanel?.querySelector(".draft-deck__stack");
      if (activePanel && activeStack) {
        updateDraftDeckState(
          activePanel,
          parseInt(activeStack.dataset.activeIdx || "0", 10),
        );
      }
    });
  });

  const updateDraftDeckState = (panel, targetIdx) => {
    if (!panel) return;
    const stack = panel.querySelector(".draft-deck__stack");
    if (!stack) return;
    const total = parseInt(stack.dataset.total || "0", 10);
    if (!total) return;
    const bounded = Math.max(0, Math.min(total - 1, targetIdx));
    stack.dataset.activeIdx = String(bounded);
    stack.querySelectorAll(".draft-deck__card").forEach((card) => {
      const rel = bounded - parseInt(card.dataset.deckIdx, 10);
      card.className = "draft-deck__card";
      if (rel === 0) {
        card.classList.add("draft-deck__card--front");
        card.tabIndex = 0;
      } else if (rel === 1) {
        card.classList.add("draft-deck__card--back-1");
        card.tabIndex = -1;
      } else if (rel === 2) {
        card.classList.add("draft-deck__card--back-2");
        card.tabIndex = -1;
      } else {
        card.classList.add("draft-deck__card--hidden");
        card.tabIndex = -1;
      }
    });
    const pos = panel.querySelector('[data-role="draft-position"]');
    if (pos) pos.textContent = `V${bounded + 1} of ${total}`;
    const prevBtn = panel.querySelector(
      '[data-action="draft-deck-shift"][data-dir="-1"]',
    );
    const nextBtn = panel.querySelector(
      '[data-action="draft-deck-shift"][data-dir="1"]',
    );
    if (prevBtn) prevBtn.disabled = bounded <= 0;
    if (nextBtn) nextBtn.disabled = bounded >= total - 1;
  };

  document
    .querySelectorAll('[data-action="draft-deck-shift"]')
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = btn.closest(".draft-deck__panel");
        if (!panel) return;
        const stack = panel.querySelector(".draft-deck__stack");
        if (!stack) return;
        const currentIdx = parseInt(stack.dataset.activeIdx || "0", 10);
        const dir = parseInt(btn.dataset.dir || "0", 10);
        if (!dir) return;
        updateDraftDeckState(panel, currentIdx + dir);
      });
    });

  document.querySelectorAll(".draft-deck__panel").forEach((panel) => {
    const stack = panel.querySelector(".draft-deck__stack");
    if (!stack) return;
    updateDraftDeckState(panel, parseInt(stack.dataset.activeIdx || "0", 10));
  });
}

// --- Daily Brief (pipeline-derived) ---
/** Local calendar days; appeal rank; stale applied = no forward progress (see SETUP.md). */
const BRIEF_STALE_APPLIED_DAYS = 14;
const BRIEF_WAITING_REPLY_MIN_DAYS = 7;

function localDateKey(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseBriefDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function priorityRank(p) {
  const order = { "🔥": 0, "⚡": 1, "—": 2, "↓": 3 };
  return order[p] ?? 2;
}

function rankByAppeal(jobs) {
  return [...jobs].sort((a, b) => {
    const fs = (b.fitScore ?? -1) - (a.fitScore ?? -1);
    if (fs !== 0) return fs;
    const po = priorityRank(a.priority) - priorityRank(b.priority);
    if (po !== 0) return po;
    return (a.company || "").localeCompare(b.company || "");
  });
}

function jobsFoundToday(jobs) {
  const todayKey = localDateKey(new Date());
  return jobs.filter(
    (j) => j.dateFound && localDateKey(j.dateFound) === todayKey,
  );
}

function startOfWeekMonday(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function appliedThisWeekCount(jobs) {
  const start = startOfWeekMonday(new Date());
  return jobs.filter((j) => {
    if (!j.appliedDate) return false;
    const ad = parseBriefDate(j.appliedDate);
    return ad && ad >= start;
  }).length;
}

function isStaleApplied(job) {
  const s = (job.status || "").toLowerCase();
  if (!s.includes("applied")) return false;
  if (
    s.includes("interview") ||
    s.includes("phone screen") ||
    s.includes("offer")
  )
    return false;
  if (s.includes("reject") || s.includes("passed")) return false;
  if (!job.appliedDate) return false;
  const ad = parseBriefDate(job.appliedDate);
  if (!ad) return false;
  const days = (Date.now() - ad.getTime()) / (24 * 3600 * 1000);
  return days >= BRIEF_STALE_APPLIED_DAYS;
}

function overdueFollowUps(jobs) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return jobs.filter((j) => {
    if (!j.followUpDate) return false;
    const fd = parseBriefDate(j.followUpDate);
    if (!fd) return false;
    fd.setHours(0, 0, 0, 0);
    return fd < now;
  });
}

function upcomingFollowUps48h(jobs) {
  const now = new Date();
  const end = new Date(now.getTime() + 48 * 3600 * 1000);
  return jobs.filter((j) => {
    if (!j.followUpDate) return false;
    const fd = parseBriefDate(j.followUpDate);
    if (!fd) return false;
    return fd >= now && fd <= end;
  });
}

function normalizeResponseFlag(val) {
  if (!val || !String(val).trim()) return "";
  const v = String(val).trim().toLowerCase();
  if (v === "yes" || v === "y") return "yes";
  if (v === "no" || v === "n") return "no";
  if (v === "unknown" || v === "?") return "unknown";
  return "";
}

/** Short label for chips and the brief (user-facing). */
function responseLabelForDisplay(flag) {
  const n = normalizeResponseFlag(flag);
  if (n === "yes") return "Yes";
  if (n === "no") return "No";
  if (n === "unknown") return "Not sure";
  if (flag && String(flag).trim()) return String(flag).trim();
  return "";
}

function selectedResponseSheetValue(job) {
  const n = normalizeResponseFlag(job.responseFlag);
  if (n === "yes") return "Yes";
  if (n === "no") return "No";
  if (n === "unknown") return "Unknown";
  return "";
}

function waitingOnReplyJobs(jobs) {
  return jobs.filter((j) => {
    const s = (j.status || "").toLowerCase();
    if (
      s.includes("interviewing") ||
      s.includes("offer") ||
      s.includes("reject") ||
      s.includes("passed") ||
      s === "new" ||
      s.includes("researching")
    ) {
      return false;
    }
    const waitingStage = s === "applied" || s.includes("phone screen");
    if (!waitingStage) return false;

    const flag = normalizeResponseFlag(j.responseFlag);
    if (flag === "yes") return false;
    if (flag === "no") return true;

    if (!j.appliedDate) return false;
    const ad = parseBriefDate(j.appliedDate);
    if (!ad) return false;
    const days = (Date.now() - ad.getTime()) / (24 * 3600 * 1000);
    return days >= BRIEF_WAITING_REPLY_MIN_DAYS;
  });
}

function pipelineStatusCounts(jobs) {
  const map = {};
  for (const j of jobs) {
    const k = (j.status || "Unknown").trim() || "Unknown";
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

function briefJobLine(job, extraHtml) {
  const title = escapeHtml(job.title || "Role");
  const co = escapeHtml(job.company || "");
  const extra = extraHtml || "";
  return `<li><strong>${title}</strong>${co ? ` — ${co}` : ""} ${extra}</li>`;
}

function briefJobLineWithLastHeard(job) {
  const heard = job.lastHeardFrom
    ? ` <span class="brief-meta">Last contact: ${escapeHtml(job.lastHeardFrom)}</span>`
    : "";
  const reply = responseLabelForDisplay(job.responseFlag)
    ? ` <span class="brief-meta">Reply: ${escapeHtml(responseLabelForDisplay(job.responseFlag))}</span>`
    : "";
  return briefJobLine(job, heard + reply);
}

// --- Brief: Headline ---

function briefHeadlineSentence(overdue, waiting, stale, todayJobs) {
  const ov = overdue.length;
  const wt = waiting.length;
  const st = stale.length;
  const nw = todayJobs.length;
  const urgent = ov + wt + st;

  if (!urgent && !nw)
    return "Nothing demands your attention today. The pipeline is steady&mdash;a good day to sharpen your story or reach out to someone new.";

  if (!urgent && nw)
    return `Your pipeline is clear and ${nw === 1 ? "a promising new opportunity has" : `<strong>${nw}</strong> fresh opportunities have`} surfaced since yesterday. A clean slate and new leads&mdash;today is yours to move fast.`;

  const threads = [];
  if (ov)
    threads.push(
      ov === 1
        ? "one follow-up has gone unanswered past its window"
        : `<strong>${ov}</strong> follow-ups have slipped past their window`,
    );
  if (wt)
    threads.push(
      wt === 1
        ? "one conversation is still waiting on you"
        : `<strong>${wt}</strong> conversations are still waiting on you`,
    );
  if (st)
    threads.push(
      st === 1
        ? "one application has gone quiet"
        : `<strong>${st}</strong> applications have gone quiet`,
    );

  let prose = threads[0];
  if (threads.length === 2) prose += ", and " + threads[1];
  else if (threads.length === 3)
    prose += ", " + threads[1] + ", and " + threads[2];

  prose = prose.charAt(0).toUpperCase() + prose.slice(1);

  if (nw)
    prose += `. On the bright side, ${nw === 1 ? "a new match" : `<strong>${nw}</strong> new matches`} arrived today&mdash;momentum is building.`;
  else prose += ". Clearing these will put you back in control of the pace.";

  return prose;
}

// --- Brief: Opportunity column ---

function briefDaysSince(dateStr) {
  const d = parseBriefDate(dateStr);
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
}

/** Rolling windows: last 7 calendar days vs the 7 days before that (local midnight). */
function getInsightDateWindows() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const recentEnd = new Date(today);
  recentEnd.setDate(recentEnd.getDate() + 1);
  const recentStart = new Date(today);
  recentStart.setDate(recentStart.getDate() - 7);
  const priorEnd = recentStart;
  const priorStart = new Date(recentStart);
  priorStart.setDate(priorStart.getDate() - 7);
  return { recentStart, recentEnd, priorStart, priorEnd };
}

function dateInWindow(d, start, end) {
  return d >= start && d < end;
}

function countDateFoundInWindow(jobs, start, end) {
  return jobs.filter((j) => {
    const d = parseBriefDate(j.dateFound);
    return d && dateInWindow(d, start, end);
  }).length;
}

function countAppliedInWindow(jobs, start, end) {
  return jobs.filter((j) => {
    const d = parseBriefDate(j.appliedDate);
    return d && dateInWindow(d, start, end);
  }).length;
}

function trendDeltaLabel(cur, prev) {
  const d = cur - prev;
  if (d === 0) return "same as prior week";
  if (d > 0) return `up ${d} vs prior week`;
  return `down ${-d} vs prior week`;
}

/** Short delta for insight tiles: +2, −1, 0 */
function trendDeltaShort(cur, prev) {
  const d = cur - prev;
  if (d === 0) return "0";
  if (d > 0) return `+${d}`;
  return `${d}`;
}

function trendPillClass(cur, prev) {
  const d = cur - prev;
  if (d > 0) return "insight-pill--up";
  if (d < 0) return "insight-pill--down";
  return "insight-pill--flat";
}

function medianDaysDiscoveryToApply(jobs) {
  const deltas = [];
  for (const j of jobs) {
    const df = parseBriefDate(j.dateFound);
    const da = parseBriefDate(j.appliedDate);
    if (!df || !da) continue;
    const days = Math.round((da - df) / (24 * 3600 * 1000));
    if (days >= 0) deltas.push(days);
  }
  if (deltas.length < 2) return null;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

function topSourcesInWindow(jobs, start, end, limit) {
  const map = {};
  for (const j of jobs) {
    const d = parseBriefDate(j.dateFound);
    if (!d || !dateInWindow(d, start, end)) continue;
    const src = (j.source || "").trim() || "Unknown";
    map[src] = (map[src] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

let briefActivityRange = "7d";

function getBreakdownForRange(jobs, range) {
  const totalDays = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 }[range] || 7;
  const groupSize = totalDays >= 30 ? 7 : 1;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daily = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const s = new Date(today);
    s.setDate(s.getDate() - i);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    daily.push({
      date: s,
      discovered: jobs.filter((j) => {
        const d = parseBriefDate(j.dateFound);
        return d && d >= s && d < e;
      }).length,
      applied: jobs.filter((j) => {
        const d = parseBriefDate(j.appliedDate);
        return d && d >= s && d < e;
      }).length,
    });
  }
  if (groupSize === 1) {
    const short = totalDays <= 7;
    return daily.map((d) => ({
      ...d,
      label: short
        ? d.date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2)
        : d.date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
    }));
  }
  const groups = [];
  for (let i = 0; i < daily.length; i += groupSize) {
    const ch = daily.slice(i, i + groupSize);
    groups.push({
      date: ch[0].date,
      label: ch[0].date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      discovered: ch.reduce((a, d) => a + d.discovered, 0),
      applied: ch.reduce((a, d) => a + d.applied, 0),
    });
  }
  return groups;
}

function niceAxisMax(v) {
  if (v <= 0) return 5;
  return (
    [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000].find(
      (t) => t >= v,
    ) || Math.ceil(v / 100) * 100
  );
}

function catmullRomPath(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)],
      p1 = pts[i],
      p2 = pts[i + 1],
      p3 = pts[Math.min(pts.length - 1, i + 2)];
    const t = 6;
    d += ` C ${p1.x + (p2.x - p0.x) / t},${p1.y + (p2.y - p0.y) / t} ${p2.x - (p3.x - p1.x) / t},${p2.y - (p3.y - p1.y) / t} ${p2.x},${p2.y}`;
  }
  return d;
}

function countStatusMatches(jobs, pred) {
  return jobs.filter(pred).length;
}

function buildBriefSuggestions(ctx) {
  const tips = [];
  const {
    staleLen,
    waitingLen,
    overdueLen,
    inboxCount,
    discRecent,
    appliedRecent,
    offers,
    total,
  } = ctx;
  if (total === 0) return tips;
  if (discRecent === 0 && total > 0)
    tips.push(
      "No new discoveries in the last 7 days — try a different discovery query or widen locations.",
    );
  if (inboxCount >= 8)
    tips.push(
      `Large inbox (${inboxCount} roles) — block time to triage so nothing goes stale.`,
    );
  if (staleLen > 0)
    tips.push(
      "Stale applications need a decision: follow up once, then close or move on.",
    );
  if (waitingLen >= 4)
    tips.push(
      "Several applications are waiting on replies — a single follow-up sweep can clear mental load.",
    );
  if (offers > 0)
    tips.push(
      "You have an active offer — compare deadlines and total comp before you sign.",
    );
  if (appliedRecent >= 5 && tips.length < 4)
    tips.push(
      "Heavy apply week — note which sources or companies reply so you can double down next week.",
    );
  if (overdueLen > 0 && tips.length < 4)
    tips.push(
      "Overdue follow-up dates are promises to yourself — reschedule or send one short note.",
    );
  return tips.slice(0, 4);
}

function renderBriefStats(ctx) {
  const {
    discRecent,
    discPrior,
    appRecent,
    appPrior,
    inLoop,
    offers,
    medianDays,
  } = ctx;

  function deltaClass(cur, prev) {
    const d = cur - prev;
    if (d > 0) return "stat-card__delta--up";
    if (d < 0) return "stat-card__delta--down";
    return "stat-card__delta--flat";
  }

  let html = "";

  html += `<div class="stat-card">
    <span class="stat-card__label">Found this week</span>
    <div class="stat-card__row">
      <span class="stat-card__value">${discRecent}</span>
      <span class="stat-card__delta ${deltaClass(discRecent, discPrior)}">${trendDeltaShort(discRecent, discPrior)}</span>
    </div>
    <span class="stat-card__sub">vs ${discPrior} prior week</span>
  </div>`;

  html += `<div class="stat-card">
    <span class="stat-card__label">Applied this week</span>
    <div class="stat-card__row">
      <span class="stat-card__value">${appRecent}</span>
      <span class="stat-card__delta ${deltaClass(appRecent, appPrior)}">${trendDeltaShort(appRecent, appPrior)}</span>
    </div>
    <span class="stat-card__sub">vs ${appPrior} prior week</span>
  </div>`;

  html += `<div class="stat-card">
    <span class="stat-card__label">In loop</span>
    <div class="stat-card__row">
      <span class="stat-card__value">${inLoop}</span>
    </div>
    <span class="stat-card__sub">interviewing + screens</span>
  </div>`;

  html += `<div class="stat-card">
    <span class="stat-card__label">Offers</span>
    <div class="stat-card__row">
      <span class="stat-card__value">${offers}</span>
    </div>
    <span class="stat-card__sub">${medianDays != null ? `${medianDays}d median find\u2009\u2192\u2009apply` : "full pipeline"}</span>
  </div>`;

  return html;
}

function renderDonutWidget(stages) {
  const total = stages.reduce((s, st) => s + st.count, 0);
  if (total === 0) return "";
  const filtered = stages.filter((s) => s.count > 0);
  let cumPct = 0;
  const segs = filtered.map((s) => {
    const p = (s.count / total) * 100;
    const f = cumPct;
    cumPct += p;
    return `${s.color} ${f}% ${cumPct}%`;
  });
  let h =
    '<h4 class="brief-widget__title">Pipeline</h4><div class="donut-layout">';
  h += `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${segs.join(",")})"></div>`;
  h += `<div class="donut-center"><span class="donut-center__val">${total}</span><span class="donut-center__lbl">total</span></div></div>`;
  h += '<div class="donut-legend">';
  for (const s of filtered)
    h += `<div class="donut-legend__item"><span class="donut-legend__dot" style="background:${s.color}"></span><span class="donut-legend__label">${escapeHtml(s.label)}</span><span class="donut-legend__val">${s.count}</span></div>`;
  h += "</div></div>";
  return h;
}

function renderAreaWidget(jobs, range) {
  const data = getBreakdownForRange(jobs, range);
  const maxRaw = Math.max(0, ...data.flatMap((d) => [d.discovered, d.applied]));
  const maxY = niceAxisMax(maxRaw);
  const L = 50,
    R = 490,
    T = 12,
    B = 160,
    W = R - L,
    H = B - T,
    n = data.length;
  const xS = n > 1 ? W / (n - 1) : 0;
  function pts(k) {
    return data.map((d, i) => ({ x: L + i * xS, y: B - (d[k] / maxY) * H }));
  }
  const dp = pts("discovered"),
    ap = pts("applied");
  function aD(p) {
    return p.length < 2
      ? ""
      : catmullRomPath(p) + ` L ${p[p.length - 1].x},${B} L ${p[0].x},${B} Z`;
  }
  const ranges = ["7d", "14d", "30d", "90d"];
  let h =
    '<div class="area-header"><h4 class="area-header__title">Activity</h4><div class="area-range">';
  for (const r of ranges)
    h += `<button class="area-range__btn${r === range ? " area-range__btn--active" : ""}" data-range="${r}">${r}</button>`;
  h += "</div></div>";
  h +=
    '<svg viewBox="0 0 500 190" class="area-svg" preserveAspectRatio="xMidYMid meet">';
  for (const g of [0, 0.5, 1]) {
    const y = B - g * H;
    h += `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" class="area-grid-line"/><text x="${L - 6}" y="${y + 3}" class="area-y-label">${Math.round(maxY * g)}</text>`;
  }
  h += `<path d="${aD(dp)}" class="area-fill--disc"/><path d="${aD(ap)}" class="area-fill--app"/>`;
  h += `<path d="${catmullRomPath(dp)}" class="area-line--disc"/><path d="${catmullRomPath(ap)}" class="area-line--app"/>`;
  for (let i = 0; i < n; i++) {
    h += `<circle cx="${dp[i].x}" cy="${dp[i].y}" r="3" class="area-dot--disc"><title>Found: ${data[i].discovered}</title></circle>`;
    h += `<circle cx="${ap[i].x}" cy="${ap[i].y}" r="3" class="area-dot--app"><title>Applied: ${data[i].applied}</title></circle>`;
  }
  const every = Math.max(1, Math.ceil(n / 7));
  for (let i = 0; i < n; i++) {
    if (i % every === 0 || i === n - 1)
      h += `<text x="${L + i * xS}" y="${B + 18}" class="area-x-label">${escapeHtml(data[i].label)}</text>`;
  }
  h += "</svg>";
  h +=
    '<div class="area-legend"><span class="area-legend__key"><span class="area-legend__dot area-legend__dot--disc"></span>Discovered</span><span class="area-legend__key"><span class="area-legend__dot area-legend__dot--app"></span>Applied</span></div>';
  return h;
}

function renderSourceWidget(sources, suggestions) {
  let h = "";
  if (sources.length > 0) {
    const mx = sources[0][1];
    h +=
      '<h4 class="brief-widget__title">Top sources <span style="font-weight:500;color:var(--text-faint);font-size:var(--text-xs)">7d</span></h4>';
    for (const [name, count] of sources) {
      const p = Math.max(4, (count / mx) * 100);
      h += `<div class="source-bars__row"><span class="source-bars__name">${escapeHtml(name)}</span><div class="source-bars__track"><div class="source-bars__fill" style="width:${p}%"></div></div><span class="source-bars__count">${count}</span></div>`;
    }
  }
  if (suggestions.length > 0) {
    h += `<div style="margin-top:auto;padding-top:var(--space-3);border-top:1px solid var(--divider)"><ul class="brief-tips__list">${suggestions
      .slice(0, 2)
      .map((t) => `<li>${escapeHtml(t)}</li>`)
      .join("")}</ul></div>`;
  }
  return h;
}

function _UNUSED_renderBriefCharts(ctx) {
  /* removed — replaced by renderDonutWidget, renderAreaWidget, renderSourceWidget */
  const { stages, dailyBreakdown, sources, suggestions } = ctx;

  let html = "";

  // Pipeline funnel
  const total = stages.reduce((s, st) => s + st.count, 0);
  if (total > 0) {
    html += '<div class="pipeline-funnel">';
    html += '<h4 class="pipeline-funnel__title">Pipeline distribution</h4>';
    html += '<div class="pipeline-funnel__bar">';
    for (const s of stages) {
      if (s.count === 0) continue;
      html += `<div class="pipeline-funnel__seg" style="flex:${s.count};background:${s.color}" title="${escapeHtml(s.label)}: ${s.count}"></div>`;
    }
    html += "</div>";
    html += '<div class="pipeline-funnel__legend">';
    for (const s of stages) {
      if (s.count === 0) continue;
      html += `<span class="pipeline-funnel__key"><span class="pipeline-funnel__dot" style="background:${s.color}"></span>${escapeHtml(s.label)} <strong>${s.count}</strong></span>`;
    }
    html += "</div></div>";
  }

  // 7-day activity chart
  const maxVal = Math.max(
    1,
    ...dailyBreakdown.map((d) => Math.max(d.discovered, d.applied)),
  );
  html += '<div class="activity-chart">';
  html += '<h4 class="activity-chart__title">7-day activity</h4>';
  html += '<div class="activity-chart__bars">';
  for (const d of dailyBreakdown) {
    const discH = Math.max(
      d.discovered > 0 ? 3 : 0,
      (d.discovered / maxVal) * 100,
    );
    const appH = Math.max(d.applied > 0 ? 3 : 0, (d.applied / maxVal) * 100);
    html += `<div class="activity-chart__col">
      <div class="activity-chart__pair">
        <div class="activity-chart__bar activity-chart__bar--disc" style="height:${discH}%" title="Found: ${d.discovered}"></div>
        <div class="activity-chart__bar activity-chart__bar--app" style="height:${appH}%" title="Applied: ${d.applied}"></div>
      </div>
      <span class="activity-chart__day">${d.label}</span>
    </div>`;
  }
  html += "</div>";
  html += '<div class="activity-chart__legend">';
  html +=
    '<span class="activity-chart__key"><span class="activity-chart__dot activity-chart__dot--disc"></span>Discovered</span>';
  html +=
    '<span class="activity-chart__key"><span class="activity-chart__dot activity-chart__dot--app"></span>Applied</span>';
  html += "</div></div>";

  // Source bars
  if (sources.length > 0) {
    const maxSrc = sources[0][1];
    html += '<div class="source-bars">';
    html +=
      '<h4 class="source-bars__title">Top sources <span class="source-bars__period">7d</span></h4>';
    for (const [name, count] of sources) {
      const pct = Math.max(4, (count / maxSrc) * 100);
      html += `<div class="source-bars__row">
        <span class="source-bars__name">${escapeHtml(name)}</span>
        <div class="source-bars__track"><div class="source-bars__fill" style="width:${pct}%"></div></div>
        <span class="source-bars__count">${count}</span>
      </div>`;
    }
    html += "</div>";
  }

  // Tips
  if (suggestions.length > 0) {
    const tips = suggestions.slice(0, 3);
    html += '<div class="brief-tips">';
    html += '<h4 class="brief-tips__title">Tips</h4>';
    html += `<ul class="brief-tips__list">${tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
    html += "</div>";
  }

  return html;
}

// --- Brief: Activity feed ---

function renderBriefFeed(overdue, upcoming, waiting, stale) {
  function keyOf(j) {
    return pipelineData.indexOf(j);
  }
  const items = [];
  for (const j of overdue) {
    const d = briefDaysSince(j.followUpDate);
    items.push({
      type: "urgent",
      title: `${j.title || "Role"} \u2014 ${j.company || ""}`,
      desc: "Follow-up overdue",
      meta: d != null ? `${d}d late` : "",
      pri: 0,
      days: d || 0,
      key: keyOf(j),
    });
  }
  for (const j of waiting) {
    const d = briefDaysSince(j.appliedDate);
    items.push({
      type: "waiting",
      title: `${j.title || "Role"} \u2014 ${j.company || ""}`,
      desc: "Awaiting reply",
      meta: d != null ? `${d}d ago` : "",
      pri: 1,
      days: d || 0,
      key: keyOf(j),
    });
  }
  for (const j of stale) {
    const d = briefDaysSince(j.appliedDate);
    items.push({
      type: "stale",
      title: `${j.title || "Role"} \u2014 ${j.company || ""}`,
      desc: "Going stale",
      meta: d != null ? `${d}d` : "",
      pri: 2,
      days: d || 0,
      key: keyOf(j),
    });
  }
  for (const j of upcoming.slice(0, 3)) {
    items.push({
      type: "upcoming",
      title: `${j.title || "Role"} \u2014 ${j.company || ""}`,
      desc: "Follow-up soon",
      meta: "48h",
      pri: 3,
      days: 0,
      key: keyOf(j),
    });
  }
  items.sort((a, b) => a.pri - b.pri || b.days - a.days);

  if (!items.length) {
    return '<div class="feed-clear"><div class="feed-clear__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div><p class="feed-clear__text">All clear</p><p class="feed-clear__sub">Nothing needs your attention right now.</p></div>';
  }
  const chevron =
    '<svg class="feed-item__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  let html = '<div class="feed-list">';
  const shown = items.slice(0, 12);
  for (const it of shown) {
    const keyAttr = it.key >= 0 ? ` data-stable-key="${it.key}"` : "";
    html += `<button type="button" class="feed-item feed-item--${it.type}" data-action="open-detail"${keyAttr}><div class="feed-item__dot"></div><div class="feed-item__body"><span class="feed-item__title">${escapeHtml(it.title)}</span><span class="feed-item__desc">${it.desc}</span></div><span class="feed-item__meta">${it.meta}</span>${chevron}</button>`;
  }
  if (items.length > 12)
    html += `<div class="feed-more">+${items.length - 12} more</div>`;
  html += "</div>";
  return html;
}

function _DEAD_renderBriefQueue(overdue, upcoming, waiting, stale) {
  const hasItems = overdue.length || waiting.length || stale.length;

  if (!hasItems) {
    let html = '<div class="queue-clear">';
    html +=
      '<div class="queue-clear__icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>';
    html +=
      '<p class="queue-clear__text">Nothing needs your attention right now.</p>';
    if (upcoming.length > 0) {
      html += `<p class="queue-clear__text" style="margin-top:var(--space-2)">Next follow-up in 48 h: <strong>${escapeHtml(upcoming[0].title || "Role")} &mdash; ${escapeHtml(upcoming[0].company || "")}</strong></p>`;
    }
    html += "</div>";
    return html;
  }

  let html = "";

  function renderQueueGroup(dotClass, label, jobs, metaFn, limit) {
    if (jobs.length === 0) return "";
    let g = '<div class="queue-group">';
    g += `<div class="queue-group__header"><span class="queue-group__dot ${dotClass}"></span><span class="queue-group__label">${label}</span><span class="queue-group__count">${jobs.length}</span></div>`;
    const shown = jobs.slice(0, limit || 3);
    for (const j of shown) {
      const meta = metaFn(j);
      g += `<div class="queue-item"><span class="queue-item__title">${escapeHtml(j.title || "Role")} &mdash; ${escapeHtml(j.company || "")}</span>${meta}</div>`;
    }
    const remaining = jobs.length - shown.length;
    if (remaining > 0) g += `<p class="queue-overflow">+${remaining} more</p>`;
    g += "</div>";
    return g;
  }

  html += renderQueueGroup(
    "queue-group__dot--urgent",
    "Follow-ups overdue",
    overdue,
    (j) => {
      const d = briefDaysSince(j.followUpDate);
      return d != null
        ? `<span class="queue-item__meta queue-item__meta--warn">${d}d late</span>`
        : "";
    },
  );

  if (upcoming.length > 0 && overdue.length > 0) {
    let upHtml =
      '<div class="queue-upcoming"><span class="queue-upcoming__label">Next 48 h: </span>';
    upHtml += upcoming
      .slice(0, 2)
      .map(
        (j) =>
          `${escapeHtml(j.title || "Role")} &mdash; ${escapeHtml(j.company || "")}`,
      )
      .join(", ");
    upHtml += "</div>";
    html += upHtml;
  }

  html += renderQueueGroup(
    "queue-group__dot--waiting",
    "Awaiting reply",
    waiting,
    (j) => {
      const d = briefDaysSince(j.appliedDate);
      return d != null ? `<span class="queue-item__meta">${d}d ago</span>` : "";
    },
  );

  html += renderQueueGroup(
    "queue-group__dot--stale",
    "Stale applications",
    stale,
    (j) => {
      const d = briefDaysSince(j.appliedDate);
      return d != null
        ? `<span class="queue-item__meta queue-item__meta--warn">${d}d</span>`
        : "";
    },
  );

  return html;
}

// --- Brief: orchestrator ---

function renderPipelineDailyBrief() {
  return pipelineData.length > 0;
}

function renderBrief() {
  const dateEl = document.getElementById("briefDate");
  const headlineEl = document.getElementById("briefHeadline");
  const insightsEl = document.getElementById("briefInsights");
  const actionEl = document.getElementById("briefAction");
  const followPanel = document.getElementById("briefFollowupPanel");
  const mainGrid = document.getElementById("briefMainGrid");
  const statsEl = document.getElementById("briefStats");

  const now = new Date();
  if (dateEl)
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const pipelineEl = document.getElementById("briefPipeline");
  const sourcesEl = document.getElementById("briefSources");

  if (!pipelineData.length) {
    if (headlineEl) headlineEl.innerHTML = "";
    if (actionEl) actionEl.innerHTML = "";
    if (statsEl) statsEl.innerHTML = "";
    if (pipelineEl) pipelineEl.innerHTML = "";
    if (sourcesEl) sourcesEl.innerHTML = "";
    if (followPanel) followPanel.hidden = true;
    if (mainGrid) mainGrid.classList.add("brief-dashboard--empty");
    const discoveryView = getDiscoveryEmptyStateView(
      getDiscoveryReadinessSnapshot(),
    );
    const actionHtml =
      discoveryView.ctaLabel && discoveryView.ctaAction
        ? `<p class="brief-empty-actions"><button type="button" class="btn-empty-cta" data-brief-action="${escapeHtml(discoveryView.ctaAction)}">${escapeHtml(discoveryView.ctaLabel)}</button></p>`
        : "";
    const bodyHtml = `<p>${escapeHtml(discoveryView.body || "No roles yet.")}</p>${actionHtml}`;
    if (insightsEl)
      insightsEl.innerHTML = `<div class="brief-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        ${bodyHtml}
      </div>`;
    return;
  }

  if (followPanel) followPanel.hidden = false;
  if (mainGrid) mainGrid.classList.remove("brief-dashboard--empty");

  const todayJobs = jobsFoundToday(pipelineData);
  const overdue = overdueFollowUps(pipelineData);
  const upcoming = upcomingFollowUps48h(pipelineData);
  const stale = pipelineData.filter(isStaleApplied);
  const waiting = waitingOnReplyJobs(pipelineData);

  const w = getInsightDateWindows();
  const discRecent = countDateFoundInWindow(
    pipelineData,
    w.recentStart,
    w.recentEnd,
  );
  const discPrior = countDateFoundInWindow(
    pipelineData,
    w.priorStart,
    w.priorEnd,
  );
  const appRecent = countAppliedInWindow(
    pipelineData,
    w.recentStart,
    w.recentEnd,
  );
  const appPrior = countAppliedInWindow(pipelineData, w.priorStart, w.priorEnd);

  const stn = (s) => (s || "").toLowerCase().trim();
  const offers = pipelineData.filter((j) =>
    stn(j.status).includes("offer"),
  ).length;
  const interviewing = pipelineData.filter((j) =>
    stn(j.status).includes("interviewing"),
  ).length;
  const phoneScreens = pipelineData.filter((j) =>
    stn(j.status).includes("phone screen"),
  ).length;
  const rejected = pipelineData.filter((j) =>
    stn(j.status).includes("rejected"),
  ).length;
  const passed = pipelineData.filter((j) => stn(j.status) === "passed").length;

  const inboxCount = pipelineData.filter((j) => {
    const s = stn(j.status);
    return !s || s === "new" || s === "researching";
  }).length;
  const appliedCount = pipelineData.filter(
    (j) => stn(j.status) === "applied",
  ).length;
  const researchingCount = pipelineData.filter(
    (j) => stn(j.status) === "researching",
  ).length;
  const newCount = inboxCount - researchingCount;

  const medianDays = medianDaysDiscoveryToApply(pipelineData);
  const sources = topSourcesInWindow(
    pipelineData,
    w.recentStart,
    w.recentEnd,
    5,
  );

  const suggestions = buildBriefSuggestions({
    staleLen: stale.length,
    waitingLen: waiting.length,
    overdueLen: overdue.length,
    inboxCount,
    discRecent,
    appliedRecent: appRecent,
    offers,
    total: pipelineData.length,
  });

  const inLoop = interviewing + phoneScreens;

  if (headlineEl)
    headlineEl.innerHTML = briefHeadlineSentence(
      overdue,
      waiting,
      stale,
      todayJobs,
    );

  if (statsEl)
    statsEl.innerHTML = renderBriefStats({
      discRecent,
      discPrior,
      appRecent,
      appPrior,
      inLoop,
      offers,
      medianDays,
    });

  const stages = [
    { label: "New", count: newCount, color: "var(--stage-rail-new)" },
    {
      label: "Researching",
      count: researchingCount,
      color: "var(--stage-rail-researching)",
    },
    {
      label: "Applied",
      count: appliedCount,
      color: "var(--stage-rail-applied)",
    },
    {
      label: "Phone Screen",
      count: phoneScreens,
      color: "var(--stage-rail-phone-screen)",
    },
    {
      label: "Interviewing",
      count: interviewing,
      color: "var(--stage-rail-interviewing)",
    },
    { label: "Offer", count: offers, color: "var(--stage-rail-offer)" },
    { label: "Rejected", count: rejected, color: "var(--stage-rail-rejected)" },
    { label: "Passed", count: passed, color: "var(--stage-rail-passed)" },
  ];

  if (pipelineEl) pipelineEl.innerHTML = renderDonutWidget(stages);
  if (insightsEl)
    insightsEl.innerHTML = renderAreaWidget(pipelineData, briefActivityRange);
  if (sourcesEl) sourcesEl.innerHTML = renderSourceWidget(sources, suggestions);
  if (actionEl)
    actionEl.innerHTML = renderBriefFeed(overdue, upcoming, waiting, stale);
}

// ============================================
// UTILITY
// ============================================

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(url) {
  if (!url) return "";
  var s = String(url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  return "";
}

function updateLastRefresh() {
  const el = document.getElementById("lastRefresh");
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  if (el) el.textContent = `Updated ${time}`;
}

// ============================================
// RESUME MATERIALS & GENERATION (IndexedDB + BYOK / webhook)
// ============================================

/** Staged resume during onboarding (before save). */
let onboardingResumeDraft = null;
/** How user supplied resume: "upload" | "paste" (for Back navigation from tone step). */
let onboardingResumePath = null;

const ONBOARDING_TOTAL_STEPS = 9;
let lastResumeGenerationSession = null;
let pendingDraftNotesRequest = null;
let candidateProfileMatchCache = {
  loaded: false,
  rawText: "",
  normalizedText: "",
  tokenSet: new Set(),
};
let generatedDraftLibraryCache = {
  loaded: false,
  byId: new Map(),
  byJobKey: new Map(),
  byJobFeature: new Map(),
};
let atsScorecardState = {
  cacheKey: "",
  status: "idle", // idle | loading | success | error
  result: null,
  error: "",
  payload: null,
};
let resumeGenerateAtsRefreshTimer = null;

function getUserContent() {
  return window.CommandCenterUserContent;
}

function getResumeBundle() {
  return window.CommandCenterResumeBundle;
}

function getResumeGenerate() {
  return window.CommandCenterResumeGenerate;
}

function getResumeIngest() {
  return window.CommandCenterResumeIngest;
}

function getJobOpportunityKey(job) {
  const UC = getUserContent();
  if (UC && typeof UC.makeJobOpportunityKey === "function") {
    return UC.makeJobOpportunityKey(job);
  }
  const o = job && typeof job === "object" ? job : {};
  return [
    String(o.link || o.url || "")
      .trim()
      .toLowerCase() ||
      [
        String(o.company || "")
          .trim()
          .toLowerCase(),
        String(o.title || "")
          .trim()
          .toLowerCase(),
        String(o.location || "")
          .trim()
          .toLowerCase(),
      ].join("::"),
  ].join("");
}

function getDraftFeatureLabel(feature) {
  return feature === "resume_update" ? "Resume" : "Cover letter";
}

function getDraftModeLabel(mode) {
  return mode === "refine" ? "Refined" : "Initial";
}

function formatDraftSavedAt(iso) {
  if (!iso) return "Saved";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Saved";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function rebuildGeneratedDraftLibraryCache(rows) {
  const byId = new Map();
  const byJobKey = new Map();
  const byJobFeature = new Map();
  (rows || []).forEach((draft) => {
    byId.set(draft.id, draft);
    const jobArr = byJobKey.get(draft.jobKey) || [];
    jobArr.push(draft);
    byJobKey.set(draft.jobKey, jobArr);
    const featureKey = `${draft.jobKey}::${draft.feature}`;
    const featureArr = byJobFeature.get(featureKey) || [];
    featureArr.push(draft);
    byJobFeature.set(featureKey, featureArr);
  });
  byJobKey.forEach((arr, key) => {
    arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    byJobKey.set(key, arr);
  });
  byJobFeature.forEach((arr, key) => {
    arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    byJobFeature.set(key, arr);
  });
  generatedDraftLibraryCache = {
    loaded: true,
    byId,
    byJobKey,
    byJobFeature,
  };
  return generatedDraftLibraryCache;
}

async function refreshGeneratedDraftLibraryCache() {
  const UC = getUserContent();
  if (!UC || typeof UC.listGeneratedDrafts !== "function") {
    return rebuildGeneratedDraftLibraryCache([]);
  }
  try {
    await UC.openDb();
    const drafts = await UC.listGeneratedDrafts();
    return rebuildGeneratedDraftLibraryCache(drafts);
  } catch (err) {
    console.warn("[JobBored] generated drafts:", err);
    return rebuildGeneratedDraftLibraryCache([]);
  }
}

function scheduleGeneratedDraftLibraryRefresh(shouldRender) {
  void refreshGeneratedDraftLibraryCache().then(() => {
    if (!shouldRender) return;
    renderPipeline();
    if (activeDetailKey >= 0) refreshDrawerIfOpen(activeDetailKey);
  });
}

function getDraftsForJob(job, feature) {
  const jobKey = getJobOpportunityKey(job);
  if (!jobKey) return [];
  if (feature) {
    return (
      generatedDraftLibraryCache.byJobFeature.get(`${jobKey}::${feature}`) || []
    );
  }
  return generatedDraftLibraryCache.byJobKey.get(jobKey) || [];
}

function getDraftByIdFromCache(id) {
  return generatedDraftLibraryCache.byId.get(id) || null;
}

async function buildCandidateProfileExcerpt(UC, maxChars) {
  const hardMax =
    Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 14000;
  const active = await UC.getActiveResume();
  const linkedIn =
    typeof UC.getLinkedInProfile === "function"
      ? await UC.getLinkedInProfile()
      : { text: "", updatedAt: "" };
  const additional =
    typeof UC.getAdditionalContext === "function"
      ? await UC.getAdditionalContext()
      : { text: "", updatedAt: "" };
  const resumeText =
    active && active.extractedText ? String(active.extractedText).trim() : "";
  const linkedInText =
    linkedIn && linkedIn.text ? String(linkedIn.text).trim() : "";
  const additionalText =
    additional && additional.text ? String(additional.text).trim() : "";

  const sections = [];
  if (resumeText) {
    sections.push(`Resume text:\n${resumeText}`);
  }
  if (linkedInText) {
    sections.push(`LinkedIn / online profile text:\n${linkedInText}`);
  }
  if (additionalText) {
    sections.push(`AI context dump (professional notes):\n${additionalText}`);
  }
  if (!sections.length) return "";
  const joined = sections.join("\n\n");
  if (joined.length <= hardMax) return joined;
  return joined.slice(0, hardMax);
}

const KEYWORD_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "using",
  "your",
  "our",
  "their",
  "you",
  "we",
  "will",
  "have",
  "has",
  "had",
  "this",
  "that",
  "these",
  "those",
  "years",
  "year",
  "plus",
  "strong",
  "ability",
  "abilities",
  "experience",
  "experienced",
  "knowledge",
  "understanding",
  "background",
  "preferred",
  "required",
  "requirement",
  "requirements",
]);

const KEYWORD_ALIAS_GROUPS = [
  ["javascript", "js"],
  ["typescript", "ts"],
  ["nodejs", "node js", "node.js"],
  ["react", "reactjs", "react.js"],
  ["ci cd", "ci/cd", "continuous integration", "continuous delivery"],
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"],
  ["kubernetes", "k8s"],
  ["postgresql", "postgres"],
  ["amazon web services", "aws"],
  ["google cloud platform", "gcp", "google cloud"],
  ["microsoft azure", "azure"],
];

function normalizeKeywordSearchText(text) {
  let s = String(text || "").toLowerCase();
  s = s.replace(/\bc\+\+\b/g, "cplusplus");
  s = s.replace(/\bc#\b/g, "csharp");
  s = s.replace(/\bci\/cd\b/g, "ci cd");
  s = s.replace(/\bnode\.js\b/g, "nodejs");
  s = s.replace(/\breact\.js\b/g, "react");
  s = s.replace(/&/g, " and ");
  s = s.replace(/[’']/g, "");
  s = s.replace(/[^a-z0-9+#.%/\-\s]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function buildKeywordSearchIndex(text) {
  const normalizedText = normalizeKeywordSearchText(text);
  return {
    rawText: String(text || ""),
    normalizedText,
    tokenSet: new Set(normalizedText.split(" ").filter(Boolean)),
  };
}

function keywordTextContainsPhrase(normalizedHaystack, normalizedNeedle) {
  const hay = ` ${String(normalizedHaystack || "")} `;
  const needle = ` ${String(normalizedNeedle || "").trim()} `;
  return !!needle.trim() && hay.includes(needle);
}

function searchIndexHasToken(searchIndex, token) {
  const tokenSet =
    searchIndex && searchIndex.tokenSet instanceof Set
      ? searchIndex.tokenSet
      : new Set();
  if (!token) return false;
  if (tokenSet.has(token)) return true;
  if (token.endsWith("ies") && tokenSet.has(`${token.slice(0, -3)}y`)) {
    return true;
  }
  if (token.endsWith("s") && tokenSet.has(token.slice(0, -1))) return true;
  if (tokenSet.has(`${token}s`)) return true;
  return false;
}

function getSignificantKeywordTokens(text) {
  return normalizeKeywordSearchText(text)
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length > 1 || /\d/.test(token))
    .filter((token) => !KEYWORD_STOP_WORDS.has(token));
}

function expandKeywordVariants(text) {
  const base = normalizeKeywordSearchText(text);
  const variants = new Set(base ? [base] : []);
  KEYWORD_ALIAS_GROUPS.forEach((group) => {
    const normalizedGroup = group
      .map((v) => normalizeKeywordSearchText(v))
      .filter(Boolean);
    if (
      normalizedGroup.some((variant) =>
        keywordTextContainsPhrase(base, variant),
      )
    ) {
      normalizedGroup.forEach((variant) => variants.add(variant));
    }
  });
  if (keywordTextContainsPhrase(base, "product manager")) {
    variants.add("product management");
  }
  if (keywordTextContainsPhrase(base, "product management")) {
    variants.add("product manager");
  }
  return [...variants];
}

function stripRequirementLeadIn(text) {
  return String(text || "")
    .replace(/^(must[-\s]?have|required|requirements?)\s*[:\-]\s*/i, "")
    .replace(
      /^(?:\d+\+?\s+years?\s+of\s+)?(?:experience|expertise|proficiency|knowledge|familiarity|background|ability|comfortable|comfort|track record)\s+(?:with|in|using|building|leading|managing|supporting|to)\s+/i,
      "",
    )
    .trim();
}

function collectSearchTermsFromTextItem(text, category) {
  const cleaned = String(text || "")
    .replace(/^[•*\-]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const phrases = new Set();
  const maybeAdd = (candidate) => {
    const label = String(candidate || "")
      .replace(/^[•*\-]\s*/, "")
      .replace(/^[,:;\-\s]+|[,:;\-\s]+$/g, "")
      .trim();
    if (!label) return;
    const normalized = normalizeKeywordSearchText(label);
    if (!normalized) return;
    const tokens = getSignificantKeywordTokens(label);
    const wordCount = normalized.split(" ").filter(Boolean).length;
    if (category === "requirements" && wordCount > 8 && tokens.length > 3) {
      return;
    }
    if (!tokens.length && wordCount > 3) return;
    phrases.add(label);
  };

  if (category !== "requirements" || cleaned.split(/\s+/).length <= 8) {
    maybeAdd(cleaned);
  }

  const stripped = stripRequirementLeadIn(cleaned);
  stripped
    .split(/[;,|]/)
    .flatMap((part) => part.split(/\b(?:and|or)\b/gi))
    .map((part) => part.trim())
    .forEach(maybeAdd);

  return [...phrases];
}

function collectJobKeywordGroups(job) {
  const enr = job && job._postingEnrichment;
  const empty = {
    mustHaves: [],
    skills: [],
    toolsAndStack: [],
    requirements: [],
    all: [],
  };
  if (!enr) return empty;
  const groups = {};
  const defs = [
    { key: "mustHaves", limit: 20 },
    { key: "skills", limit: 24 },
    { key: "toolsAndStack", limit: 24 },
    { key: "requirements", limit: 20 },
  ];
  defs.forEach(({ key, limit }) => {
    const map = new Map();
    const arr = Array.isArray(enr[key]) ? enr[key] : [];
    arr.forEach((item) => {
      collectSearchTermsFromTextItem(item, key).forEach((termLabel) => {
        const normalized = normalizeKeywordSearchText(termLabel);
        if (!normalized || map.has(normalized)) return;
        map.set(normalized, {
          label:
            termLabel.length > 72
              ? `${termLabel.slice(0, 69).trim()}…`
              : termLabel,
          fullLabel: termLabel,
          normalized,
          variants: expandKeywordVariants(termLabel),
          tokens: getSignificantKeywordTokens(termLabel),
          category: key,
        });
      });
    });
    groups[key] = [...map.values()].slice(0, limit);
  });
  groups.all = [
    ...groups.mustHaves,
    ...groups.skills,
    ...groups.toolsAndStack,
    ...groups.requirements,
  ];
  return groups;
}

function evaluateKeywordTerm(term, searchIndex) {
  const normalizedText =
    searchIndex && typeof searchIndex.normalizedText === "string"
      ? searchIndex.normalizedText
      : "";
  const variants =
    term && Array.isArray(term.variants) && term.variants.length
      ? term.variants
      : [term.normalized];
  const exact = variants.some((variant) =>
    keywordTextContainsPhrase(normalizedText, variant),
  );
  const tokenMatches = (term.tokens || []).filter((token) =>
    searchIndexHasToken(searchIndex, token),
  );
  let status = "missing";
  if (
    exact ||
    ((term.tokens || []).length && tokenMatches.length === term.tokens.length)
  ) {
    status = "found";
  } else if (
    tokenMatches.length &&
    tokenMatches.length >=
      Math.max(1, Math.ceil((term.tokens || []).length / 2))
  ) {
    status = "partial";
  }
  return {
    ...term,
    status,
  };
}

function analyzeKeywordGroupsAgainstText(groups, text) {
  const searchIndex = buildKeywordSearchIndex(text);
  const analyzed = {
    mustHaves: (groups.mustHaves || []).map((term) =>
      evaluateKeywordTerm(term, searchIndex),
    ),
    skills: (groups.skills || []).map((term) =>
      evaluateKeywordTerm(term, searchIndex),
    ),
    toolsAndStack: (groups.toolsAndStack || []).map((term) =>
      evaluateKeywordTerm(term, searchIndex),
    ),
    requirements: (groups.requirements || []).map((term) =>
      evaluateKeywordTerm(term, searchIndex),
    ),
  };
  const deduped = new Map();
  [
    ...analyzed.mustHaves,
    ...analyzed.skills,
    ...analyzed.toolsAndStack,
    ...analyzed.requirements,
  ].forEach((term) => {
    const prev = deduped.get(term.normalized);
    const rank =
      term.status === "found" ? 2 : term.status === "partial" ? 1 : 0;
    const prevRank = !prev
      ? -1
      : prev.status === "found"
        ? 2
        : prev.status === "partial"
          ? 1
          : 0;
    if (!prev || rank > prevRank) deduped.set(term.normalized, term);
  });
  const uniqueTerms = [...deduped.values()];
  const foundCount = uniqueTerms.filter(
    (term) => term.status === "found",
  ).length;
  const partialCount = uniqueTerms.filter(
    (term) => term.status === "partial",
  ).length;
  const missingTerms = uniqueTerms.filter((term) => term.status === "missing");
  const percentage = uniqueTerms.length
    ? Math.round(((foundCount + partialCount * 0.5) / uniqueTerms.length) * 100)
    : 0;
  return {
    groups: analyzed,
    uniqueTerms,
    foundCount,
    partialCount,
    missingTerms,
    totalTerms: uniqueTerms.length,
    percentage,
  };
}

function sortTermsForDisplay(terms) {
  const order = { missing: 0, partial: 1, found: 2 };
  return [...(terms || [])].sort((a, b) => {
    const statusDelta = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (statusDelta !== 0) return statusDelta;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });
}

function renderMatchItemsHtml(terms, itemClassName) {
  const cls = itemClassName || "match-checklist__item";
  return sortTermsForDisplay(terms)
    .map((term) => {
      const label = term.label || term.fullLabel || "";
      return `<li class="${cls} ${cls}--${escapeHtml(term.status)}"><span class="${cls}__status" aria-hidden="true"></span><span class="${cls}__label">${escapeHtml(label)}</span><span class="${cls}__meta">${term.status === "found" ? "Found" : term.status === "partial" ? "Partial" : "Missing"}</span></li>`;
    })
    .join("");
}

function renderProfileMatchBadgeHtml(job, dataIndex) {
  const groups = collectJobKeywordGroups(job);
  const hasTerms =
    groups.mustHaves.length ||
    groups.skills.length ||
    groups.toolsAndStack.length;
  if (!hasTerms) return "";

  if (!candidateProfileMatchCache.loaded) {
    return `<div class="profile-match-badge profile-match-badge--loading" aria-label="Profile match loading">
      <div class="profile-match-badge__ring profile-match-badge__ring--empty">
        <span class="profile-match-badge__pct">…</span>
      </div>
      <div class="profile-match-badge__text">
        <span class="profile-match-badge__label">Profile match</span>
        <span class="profile-match-badge__hint">Loading your profile…</span>
      </div>
    </div>`;
  }

  if (!candidateProfileMatchCache.rawText.trim()) {
    return `<div class="profile-match-badge profile-match-badge--empty" aria-label="Profile match unavailable">
      <div class="profile-match-badge__ring profile-match-badge__ring--empty">
        <span class="profile-match-badge__pct">–</span>
      </div>
      <div class="profile-match-badge__text">
        <span class="profile-match-badge__label">Profile match</span>
        <span class="profile-match-badge__hint">Add resume in Profile to see fit</span>
      </div>
    </div>`;
  }

  const analysis = analyzeKeywordGroupsAgainstText(
    {
      mustHaves: groups.mustHaves,
      skills: groups.skills,
      toolsAndStack: groups.toolsAndStack,
      requirements: [],
      all: [...groups.mustHaves, ...groups.skills, ...groups.toolsAndStack],
    },
    candidateProfileMatchCache.rawText,
  );
  const pct = analysis.percentage;
  const ringClass =
    pct >= 70
      ? "profile-match-badge__ring--high"
      : pct >= 40
        ? "profile-match-badge__ring--mid"
        : "profile-match-badge__ring--low";
  const hint =
    analysis.missingTerms.length > 0
      ? `${analysis.missingTerms.length} gap${analysis.missingTerms.length !== 1 ? "s" : ""} · click to review`
      : "Strong match · click to review";

  return `<button type="button" class="profile-match-badge" data-action="open-profile-match" data-index="${dataIndex}" aria-label="Profile match ${pct}% — click to see breakdown">
    <div class="profile-match-badge__ring ${ringClass}">
      <span class="profile-match-badge__pct">${pct}%</span>
    </div>
    <div class="profile-match-badge__text">
      <span class="profile-match-badge__label">Profile match</span>
      <span class="profile-match-badge__hint">${escapeHtml(hint)}</span>
    </div>
    <svg class="profile-match-badge__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
  </button>`;
}

function openProfileMatchModal(job, dataIndex) {
  const existing = document.getElementById("profileMatchModal");
  if (existing) existing.remove();

  const content = renderProfileMatchSectionHtml(job);
  if (!content) return;

  const title = escapeHtml(`${job.title || "Role"} · ${job.company || ""}`);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay profile-match-modal-overlay";
  overlay.id = "profileMatchModal";
  overlay.innerHTML = `
    <div class="profile-match-modal" role="dialog" aria-modal="true" aria-label="Profile match breakdown">
      <div class="profile-match-modal__head">
        <div class="profile-match-modal__title-group">
          <p class="profile-match-modal__kicker">Profile match</p>
          <h3 class="profile-match-modal__title">${title}</h3>
        </div>
        <button type="button" class="profile-match-modal__close" data-action="close-profile-match" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="profile-match-modal__body">
        ${content}
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay
    .querySelector('[data-action="close-profile-match"]')
    .addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
}

function renderProfileMatchSectionHtml(job) {
  const groups = collectJobKeywordGroups(job);
  const hasTerms =
    groups.mustHaves.length ||
    groups.skills.length ||
    groups.toolsAndStack.length;
  if (!hasTerms) return "";
  if (!candidateProfileMatchCache.loaded) {
    return `<section class="profile-match-card"><div class="profile-match-card__head"><div><p class="profile-match-card__kicker">Profile match</p><h4 class="profile-match-card__title">Comparing your profile to the role</h4></div></div><p class="profile-match-card__summary">Loading your resume, LinkedIn, and AI context…</p></section>`;
  }
  if (!candidateProfileMatchCache.rawText.trim()) {
    return `<section class="profile-match-card"><div class="profile-match-card__head"><div><p class="profile-match-card__kicker">Profile match</p><h4 class="profile-match-card__title">Comparing your profile to the role</h4></div></div><p class="profile-match-card__summary">Add resume, LinkedIn, or AI context in Profile to see the job-fit gap instantly.</p></section>`;
  }
  const analysis = analyzeKeywordGroupsAgainstText(
    {
      mustHaves: groups.mustHaves,
      skills: groups.skills,
      toolsAndStack: groups.toolsAndStack,
      requirements: [],
      all: [...groups.mustHaves, ...groups.skills, ...groups.toolsAndStack],
    },
    candidateProfileMatchCache.rawText,
  );
  const summary =
    analysis.totalTerms > 0
      ? `${analysis.foundCount} found · ${analysis.partialCount} partial · ${analysis.missingTerms.length} missing`
      : "No structured keywords available yet.";
  const missingPreview = analysis.missingTerms
    .slice(0, 4)
    .map((term) => term.label)
    .join(", ");
  return `<section class="profile-match-card"><div class="profile-match-card__head"><div><p class="profile-match-card__kicker">Profile match</p><h4 class="profile-match-card__title">Comparing your profile to the role</h4></div><div class="profile-match-card__score">${analysis.percentage}%</div></div><p class="profile-match-card__summary">${escapeHtml(summary)}</p>${missingPreview ? `<p class="profile-match-card__hint">Gap to close: ${escapeHtml(missingPreview)}</p>` : ""}<div class="profile-match-card__groups">${groups.mustHaves.length ? `<div class="profile-match-card__group"><p class="profile-match-card__group-label">Must-haves</p><ul class="match-checklist">${renderMatchItemsHtml(analysis.groups.mustHaves, "match-checklist__item")}</ul></div>` : ""}${groups.skills.length ? `<div class="profile-match-card__group"><p class="profile-match-card__group-label">Skills</p><ul class="match-checklist">${renderMatchItemsHtml(analysis.groups.skills, "match-checklist__item")}</ul></div>` : ""}${groups.toolsAndStack.length ? `<div class="profile-match-card__group"><p class="profile-match-card__group-label">Tools &amp; stack</p><ul class="match-checklist">${renderMatchItemsHtml(analysis.groups.toolsAndStack, "match-checklist__item")}</ul></div>` : ""}</div></section>`;
}

function renderDraftDeckPanel(job, feature) {
  if (!generatedDraftLibraryCache.loaded) {
    return `<p class="draft-deck__empty">…</p>`;
  }
  const drafts = getDraftsForJob(job, feature)
    .slice()
    .sort(
      (a, b) => Number(a.versionNumber || 0) - Number(b.versionNumber || 0),
    );
  if (!drafts.length) {
    return `<p class="draft-deck__empty">None yet — generate using the buttons above</p>`;
  }
  const activeIdx = drafts.length - 1; // newest version on top
  const cards = drafts
    .map((d, i) => {
      const rel = activeIdx - i; // 0=front, 1=back-1, 2=back-2, >2=hidden
      const depthClass =
        rel === 0
          ? "draft-deck__card--front"
          : rel === 1
            ? "draft-deck__card--back-1"
            : rel === 2
              ? "draft-deck__card--back-2"
              : "draft-deck__card--hidden";
      const vLabel = `V${Number(d.versionNumber || 0)}`;
      const modeLabel = d.mode === "refine" ? "Refined" : "Initial";
      const excerpt = (d.excerpt || "").slice(0, 110);
      return `<button type="button"
        class="draft-deck__card ${depthClass}"
        data-action="open-draft-version"
        data-draft-id="${escapeHtml(d.id)}"
        data-deck-idx="${i}"
        tabindex="${rel === 0 ? 0 : -1}">
        <span class="draft-deck__card-meta">${escapeHtml(vLabel)} · ${escapeHtml(modeLabel)}</span>
        <span class="draft-deck__card-date">${escapeHtml(formatDraftSavedAt(d.createdAt))}</span>
        <p class="draft-deck__card-excerpt">${escapeHtml(excerpt)}${(d.excerpt || "").length > 110 ? "…" : ""}</p>
      </button>`;
    })
    .join("");
  const nav =
    drafts.length > 1
      ? `<div class="draft-deck__nav">
          <button type="button" class="draft-deck__chevron" data-action="draft-deck-shift" data-dir="-1" aria-label="Previous version" title="Previous version">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="draft-deck__position" data-role="draft-position">V${activeIdx + 1} of ${drafts.length}</span>
          <button type="button" class="draft-deck__chevron" data-action="draft-deck-shift" data-dir="1" aria-label="Next version" title="Next version">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>`
      : "";
  return `<div class="draft-deck__stack" data-active-idx="${activeIdx}" data-total="${drafts.length}">${cards}</div>${nav}`;
}

function renderDraftLibraryCardHtml(job, dataIndex) {
  const clDrafts = generatedDraftLibraryCache.loaded
    ? getDraftsForJob(job, "cover_letter")
    : [];
  const reDrafts = generatedDraftLibraryCache.loaded
    ? getDraftsForJob(job, "resume_update")
    : [];
  const clCount = clDrafts.length;
  const reCount = reDrafts.length;
  const total = clCount + reCount;
  const countBadge =
    generatedDraftLibraryCache.loaded && total
      ? `<span class="draft-deck__count">${total}</span>`
      : "";
  return `<section class="draft-deck" data-index="${dataIndex}">
    <div class="draft-deck__head">
      <p class="draft-deck__kicker">Draft studio</p>
      ${countBadge}
    </div>
    <div class="draft-deck__tabs">
      <button type="button" class="draft-deck__tab draft-deck__tab--active" data-action="draft-tab" data-feature="cover_letter">
        Cover letter${clCount ? `<span class="draft-deck__tab-badge">${clCount}</span>` : ""}
      </button>
      <button type="button" class="draft-deck__tab" data-action="draft-tab" data-feature="resume_update">
        Resume${reCount ? `<span class="draft-deck__tab-badge">${reCount}</span>` : ""}
      </button>
    </div>
    <div class="draft-deck__panels">
      <div class="draft-deck__panel draft-deck__panel--active" data-feature="cover_letter">
        ${renderDraftDeckPanel(job, "cover_letter")}
      </div>
      <div class="draft-deck__panel" data-feature="resume_update">
        ${renderDraftDeckPanel(job, "resume_update")}
      </div>
    </div>
  </section>`;
}

async function refreshCandidateProfileMatchCache() {
  const UC = getUserContent();
  const Bundle = getResumeBundle();
  if (!UC || !Bundle || typeof Bundle.assembleProfile !== "function") {
    candidateProfileMatchCache = {
      loaded: true,
      rawText: "",
      normalizedText: "",
      tokenSet: new Set(),
    };
    return candidateProfileMatchCache;
  }
  try {
    await UC.openDb();
    const profile = await Bundle.assembleProfile(UC);
    const rawText = [
      profile.resumeText || "",
      profile.linkedinProfileText || "",
      profile.additionalContextText || "",
    ]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join("\n\n");
    candidateProfileMatchCache = {
      loaded: true,
      ...buildKeywordSearchIndex(rawText),
    };
  } catch (err) {
    console.warn("[JobBored] profile match cache:", err);
    candidateProfileMatchCache = {
      loaded: true,
      rawText: "",
      normalizedText: "",
      tokenSet: new Set(),
    };
  }
  return candidateProfileMatchCache;
}

function scheduleCandidateProfileMatchRefresh(shouldRender) {
  void refreshCandidateProfileMatchCache().then(() => {
    if (!shouldRender) return;
    renderPipeline();
    if (activeDetailKey >= 0) refreshDrawerIfOpen(activeDetailKey);
  });
}

async function fetchJobPostingEnrichment(dataIndex) {
  const job = pipelineData[dataIndex];
  if (!job || !job.link) {
    showToast("No job URL to scrape", "error");
    return;
  }
  const base = getJobPostingScrapeUrl();
  if (!base) {
    showToast(
      "Open the setup guide to start the Cheerio server and paste the URL.",
      "error",
    );
    openScraperSetupModal();
    return;
  }
  if (isScraperUrlBlockedOnThisPage(base)) {
    showToast(SCRAPER_HTTPS_BLOCKED_HINT, "error", true);
    openScraperSetupModal();
    return;
  }

  job._enrichmentLoading = true;
  refreshDrawerIfOpen(dataIndex);
  const _abortCtrl = new AbortController();
  const _abortTimer = setTimeout(() => _abortCtrl.abort(), 30_000);
  try {
    const res = await fetch(`${base}/api/scrape-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: job.link }),
      signal: _abortCtrl.signal,
    });
    clearTimeout(_abortTimer);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const scraped = {
      ...data,
      scrapedAt: Date.now(),
    };
    let merged = { ...scraped };
    if (
      window.CommandCenterJobPostingInsights &&
      window.CommandCenterJobPostingInsights.canEnrichWithLLM()
    ) {
      try {
        let profileExcerpt = "";
        const UC = getUserContent();
        if (UC) {
          await UC.openDb();
          profileExcerpt = await buildCandidateProfileExcerpt(UC, 14000);
        }
        const llm =
          await window.CommandCenterJobPostingInsights.enrichFromScrape(
            scraped,
            { title: job.title, company: job.company },
            profileExcerpt,
          );
        merged = {
          ...merged,
          postingSummary: llm.postingSummary,
          roleInOneLine: llm.roleInOneLine,
          mustHaves: llm.mustHaves,
          niceToHaves: llm.niceToHaves,
          responsibilities: llm.responsibilities,
          toolsAndStack: llm.toolsAndStack,
          fitAngle: llm.fitAngle,
          talkingPoints: llm.talkingPoints,
          extraKeywords: llm.extraKeywords,
        };
      } catch (e) {
        console.warn("[JobBored] Posting LLM enrich:", e);
        merged.llmError = e.message || "AI insight failed";
      }
    }
    job._postingEnrichment = merged;
    cacheEnrichment(job.link, merged);
    renderPipeline();
    showToast("Posting details loaded", "success");
  } catch (e) {
    console.error(e);
    if (isFetchNetworkError(e)) {
      showToast(
        `Can't reach the scraper at ${base}. From the project folder run: npm install && npm start — keep that terminal open, then try again.`,
        "error",
        true,
      );
      openScraperSetupModal();
    } else {
      showToast(e.message || "Could not fetch posting", "error");
    }
  } finally {
    clearTimeout(_abortTimer);
    delete job._enrichmentLoading;
    refreshDrawerIfOpen(dataIndex);
  }
}

/**
 * @param {File} file
 * @param {NonNullable<ReturnType<typeof getUserContent>>} UC
 */
async function profileApplyResumeFile(file, UC) {
  const ingest = getResumeIngest();
  if (!ingest) {
    showToast("Resume processing unavailable", "error");
    return;
  }
  try {
    const text = await ingest.extractTextFromFile(file);
    if (!String(text).trim()) {
      showToast("No text could be extracted from that file", "error");
      return;
    }
    const label =
      (file.name || "Resume").replace(/\.[^/.]+$/, "") || "My resume";
    await UC.setPrimaryResume({
      source: "file",
      rawMime: ingest.guessMime(file),
      label,
      extractedText: text,
    });
    await refreshMaterialsUI();
    showToast("Resume updated", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Could not read file", "error");
  }
}

/**
 * @param {FileList|File[]} fileList
 * @param {NonNullable<ReturnType<typeof getUserContent>>} UC
 */
async function profileApplySampleFiles(fileList, UC) {
  const ingest = getResumeIngest();
  if (!ingest) {
    showToast("File processing unavailable", "error");
    return;
  }
  const arr = Array.from(fileList || []).filter(Boolean);
  if (!arr.length) return;
  let added = 0;
  let failed = 0;
  for (const file of arr) {
    try {
      const text = await ingest.extractTextFromFile(file);
      if (!String(text).trim()) {
        failed++;
        continue;
      }
      const title =
        (file.name || "Sample").replace(/\.[^/.]+$/, "") || "Writing sample";
      await UC.addWritingSample({
        title,
        tags: [],
        extractedText: text,
      });
      added++;
    } catch (err) {
      console.warn(err);
      failed++;
    }
  }
  await refreshMaterialsUI();
  if (added === 1) showToast("Writing sample added", "success");
  else if (added > 1) showToast(`${added} samples added`, "success");
  if (!added && failed)
    showToast("Could not read those files — try PDF, Word, or .txt", "error");
  else if (failed && added) showToast("Some files could not be added", "info");
}

/**
 * @param {HTMLElement | null} zoneEl
 * @param {(files: FileList) => void} onFiles
 */
function bindProfileDropzone(zoneEl, onFiles) {
  if (!zoneEl) return;
  zoneEl.addEventListener("dragenter", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoneEl.classList.add("profile-dropzone--drag");
  });
  zoneEl.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rel = e.relatedTarget;
    if (rel && zoneEl.contains(/** @type {Node} */ (rel))) return;
    zoneEl.classList.remove("profile-dropzone--drag");
  });
  zoneEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  zoneEl.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoneEl.classList.remove("profile-dropzone--drag");
    const files = e.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
}

function renderLinkedInProfileMeta(text, updatedAt) {
  const chars = String(text || "").length;
  if (!chars) return "No LinkedIn profile text saved.";
  const updated = updatedAt ? new Date(updatedAt).toLocaleDateString() : "";
  return updated
    ? `${chars.toLocaleString()} chars saved · Updated ${updated}`
    : `${chars.toLocaleString()} chars saved`;
}

function renderAdditionalContextMeta(text, updatedAt) {
  const chars = String(text || "").length;
  if (!chars) return "No AI context dump saved.";
  const updated = updatedAt ? new Date(updatedAt).toLocaleDateString() : "";
  return updated
    ? `${chars.toLocaleString()} chars saved · Updated ${updated}`
    : `${chars.toLocaleString()} chars saved`;
}

const LINKEDIN_CAPTURE_FIELDS = [
  { id: "linkedInCaptureHeadline", label: "HEADLINE" },
  { id: "linkedInCaptureAbout", label: "ABOUT" },
  { id: "linkedInCaptureExperience", label: "EXPERIENCE" },
  { id: "linkedInCaptureSkills", label: "SKILLS" },
  { id: "linkedInCaptureEducation", label: "EDUCATION_AND_CERTIFICATIONS" },
  { id: "linkedInCaptureExtras", label: "EXTRA_HIGHLIGHTS" },
];

function normalizeProfileTextInput(raw) {
  const ingest = getResumeIngest();
  const text = raw != null ? String(raw) : "";
  return ingest && typeof ingest.normalizeExtractedText === "function"
    ? ingest.normalizeExtractedText(text)
    : text.trim();
}

function collectLinkedInCaptureSections() {
  return LINKEDIN_CAPTURE_FIELDS.map((f) => {
    const el = document.getElementById(f.id);
    return {
      label: f.label,
      text: normalizeProfileTextInput(el && el.value ? el.value : ""),
    };
  });
}

function buildLinkedInCaptureProfileText() {
  const sections = collectLinkedInCaptureSections().filter((s) => s.text);
  if (!sections.length) return "";
  const lines = [
    "LinkedIn profile capture (assisted)",
    `Captured at: ${new Date().toISOString()}`,
  ];
  sections.forEach((s) => {
    lines.push("");
    lines.push(s.label);
    lines.push(s.text);
  });
  return lines.join("\n");
}

function getLinkedInCaptureCompleteness() {
  const byId = {};
  collectLinkedInCaptureSections().forEach((s, i) => {
    byId[LINKEDIN_CAPTURE_FIELDS[i].id] = s.text;
  });
  const hasExperience = !!String(byId.linkedInCaptureExperience || "").trim();
  const hasSkills = !!String(byId.linkedInCaptureSkills || "").trim();
  return {
    hasExperience,
    hasSkills,
    canSave: hasExperience && hasSkills,
  };
}

function updateLinkedInCapturePreview() {
  const preview = document.getElementById("linkedInCapturePreview");
  const quality = document.getElementById("linkedInCaptureQuality");
  const saveBtn = document.getElementById("linkedInCaptureSaveBtn");
  const built = buildLinkedInCaptureProfileText();
  if (preview) preview.value = built;
  const c = getLinkedInCaptureCompleteness();
  if (saveBtn) saveBtn.disabled = !c.canSave;
  if (quality) {
    quality.classList.remove(
      "linkedincap-quality--ok",
      "linkedincap-quality--warn",
    );
    if (c.canSave) {
      quality.classList.add("linkedincap-quality--ok");
      quality.textContent =
        "Complete enough to save. Experience and Skills captured.";
    } else {
      quality.classList.add("linkedincap-quality--warn");
      quality.textContent =
        "Add both Experience and Skills before saving. These are required for high-quality tailoring.";
    }
  }
}

function openLinkedInCaptureModal() {
  const modal = document.getElementById("linkedInCaptureModal");
  if (!modal) return;
  const existing = document.getElementById("materialsLinkedInText");
  const extras = document.getElementById("linkedInCaptureExtras");
  if (
    existing &&
    extras &&
    extras.tagName === "TEXTAREA" &&
    !String(extras.value || "").trim() &&
    String(existing.value || "").trim()
  ) {
    extras.value = String(existing.value || "");
  }
  modal.style.display = "flex";
  updateLinkedInCapturePreview();
  document.getElementById("linkedInCaptureHeadline")?.focus();
}

function closeLinkedInCaptureModal() {
  const modal = document.getElementById("linkedInCaptureModal");
  if (modal) modal.style.display = "none";
}

/** Populate tone / templates / visual theme fields from stored preferences. */
function applyPreferencesFromData(prefs) {
  if (!prefs || typeof prefs !== "object") return;
  const toneEl = document.getElementById("prefTone");
  const mwEl = document.getElementById("prefMaxWords");
  const indEl = document.getElementById("prefIndustries");
  const avEl = document.getElementById("prefAvoid");
  const voEl = document.getElementById("prefVoice");
  const mergeEl = document.getElementById("prefMergePreference");
  if (toneEl) toneEl.value = prefs.tone || "warm";
  if (mwEl) mwEl.value = String(prefs.defaultMaxWords || 350);
  if (indEl) indEl.value = prefs.industriesToEmphasize || "";
  if (avEl) avEl.value = prefs.wordsToAvoid || "";
  if (voEl) voEl.value = prefs.voiceNotes || "";
  if (mergeEl) mergeEl.value = prefs.profileMergePreference || "merge";

  fillDocumentTemplateSelect(
    "prefCoverLetterTemplate",
    "cover_letter",
    prefs.coverLetterTemplateId,
  );
  fillDocumentTemplateSelect(
    "prefResumeTemplate",
    "resume_update",
    prefs.resumeTemplateId,
  );
  fillVisualThemeSelect("prefVisualTheme", prefs.visualThemeId);
}

async function refreshPersonalPreferencesPanel() {
  const UC = getUserContent();
  if (!UC) return;
  await UC.openDb();
  const prefs = await UC.getPreferences();
  applyPreferencesFromData(prefs);
}

async function refreshMaterialsUI() {
  const UC = getUserContent();
  const resumeMeta = document.getElementById("materialsResumeMeta");
  const resumeHero = document.getElementById("profileResumeDropHero");
  const resumeStatusWrap = document.getElementById("profileResumeStatusWrap");
  const resumeDropzone = document.getElementById("profileResumeDropzone");
  const listSamples = document.getElementById("materialsSamplesList");
  const linkedInTextEl = document.getElementById("materialsLinkedInText");
  const linkedInMetaEl = document.getElementById("materialsLinkedInMeta");
  const aiDumpTextEl = document.getElementById("materialsAiDumpText");
  const aiDumpMetaEl = document.getElementById("materialsAiDumpMeta");
  if (!UC || !listSamples) return;

  await UC.openDb();
  const primary = await UC.getActiveResume();
  const linkedInProfile =
    typeof UC.getLinkedInProfile === "function"
      ? await UC.getLinkedInProfile()
      : { text: "", updatedAt: "" };
  const additionalContext =
    typeof UC.getAdditionalContext === "function"
      ? await UC.getAdditionalContext()
      : { text: "", updatedAt: "" };
  const samples = await UC.listWritingSamples();
  const prefs = await UC.getPreferences();

  if (resumeMeta) {
    if (!primary || !String(primary.extractedText || "").trim()) {
      resumeMeta.innerHTML = "";
      if (resumeHero) resumeHero.hidden = false;
      if (resumeStatusWrap) resumeStatusWrap.hidden = true;
      if (resumeDropzone)
        resumeDropzone.classList.remove("profile-dropzone--has-file");
    } else {
      const created = primary.createdAt
        ? new Date(primary.createdAt).toLocaleDateString()
        : "";
      resumeMeta.innerHTML = `<strong>${escapeHtml(primary.label || "My resume")}</strong><span class="profile-meta-sep">·</span>${String(primary.extractedText || "").length.toLocaleString()} chars${created ? `<span class="profile-meta-sep">·</span>${escapeHtml(created)}` : ""}`;
      if (resumeHero) resumeHero.hidden = true;
      if (resumeStatusWrap) resumeStatusWrap.hidden = false;
      if (resumeDropzone)
        resumeDropzone.classList.add("profile-dropzone--has-file");
    }
  }

  listSamples.innerHTML =
    samples.length === 0
      ? ""
      : samples
          .map((s) => {
            const tags = (s.tags || []).join(", ");
            return `<div class="profile-sample-row" data-sample-id="${escapeHtml(s.id)}">
            <div class="profile-sample-row__main"><span class="profile-sample-title">${escapeHtml(s.title)}</span>${tags ? ` <span class="profile-sample-tags">${escapeHtml(tags)}</span>` : ""}</div>
            <button type="button" class="profile-sample-remove" data-delete-sample="${escapeHtml(s.id)}">Remove</button>
          </div>`;
          })
          .join("");

  applyPreferencesFromData(prefs);

  if (linkedInTextEl) {
    linkedInTextEl.value = linkedInProfile.text || "";
  }
  if (linkedInMetaEl) {
    linkedInMetaEl.textContent = renderLinkedInProfileMeta(
      linkedInProfile.text || "",
      linkedInProfile.updatedAt || "",
    );
  }
  if (aiDumpTextEl) {
    aiDumpTextEl.value = additionalContext.text || "";
  }
  if (aiDumpMetaEl) {
    aiDumpMetaEl.textContent = renderAdditionalContextMeta(
      additionalContext.text || "",
      additionalContext.updatedAt || "",
    );
  }

  listSamples.querySelectorAll("[data-delete-sample]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await UC.deleteWritingSample(btn.dataset.deleteSample);
      await refreshMaterialsUI();
      showToast("Sample removed", "info");
    });
  });
  scheduleCandidateProfileMatchRefresh(true);
}

function openMaterialsModal() {
  closeAuthUserMenu();
  const modal = document.getElementById("materialsModal");
  if (modal) {
    modal.style.display = "flex";
    refreshMaterialsUI();
    const closeBtn = document.getElementById("materialsModalClose");
    if (closeBtn) closeBtn.focus();
  }
}

function closeMaterialsModal() {
  const modal = document.getElementById("materialsModal");
  if (modal) {
    modal.style.display = "none";
    document.getElementById("materialsBtn")?.focus();
  }
}

function isOnboardingWizardVisible() {
  const w = document.getElementById("onboardingWizard");
  return w && w.style.display === "flex";
}

function hideOnboardingWizard() {
  const w = document.getElementById("onboardingWizard");
  if (w) w.style.display = "none";
}

function showOnboardingWizard() {
  const w = document.getElementById("onboardingWizard");
  if (!w) return;
  onboardingResumeDraft = null;
  onboardingResumePath = null;
  const paste = document.getElementById("onboardingPasteText");
  const status = document.getElementById("onboardingResumeStatus");
  const statusUp = document.getElementById("onboardingResumeStatusUpload");
  const fileIn = document.getElementById("onboardingFileInput");
  const toneHidden = document.getElementById("wizardPrefTone");
  const mw = document.getElementById("wizardPrefMaxWords");
  const voice = document.getElementById("wizardPrefVoice");
  if (paste) paste.value = "";
  if (status) {
    status.textContent = "";
    status.classList.remove("onboarding-status--error");
  }
  if (statusUp) {
    statusUp.textContent = "";
    statusUp.classList.remove("onboarding-status--error");
  }
  if (fileIn) fileIn.value = "";
  if (toneHidden) toneHidden.value = "warm";
  if (mw) mw.value = "350";
  if (voice) voice.value = "";
  const samplesIn = document.getElementById("onboardingSamplesFileInput");
  const samplesStatus = document.getElementById("onboardingSamplesStatus");
  const aiCtx = document.getElementById("onboardingAiContextText");
  if (samplesIn) samplesIn.value = "";
  if (samplesStatus) {
    samplesStatus.textContent = "";
    samplesStatus.classList.remove("onboarding-status--error");
  }
  if (aiCtx) aiCtx.value = "";
  syncOnboardingToneCards("warm");
  setOnboardingStep(1);
  w.style.display = "flex";
  document.getElementById("onboardingNext1")?.focus();
}

function updateOnboardingProgressUI(step) {
  const label = document.getElementById("onboardingStepLabel");
  const fill = document.getElementById("onboardingProgressBarFill");
  const bar = document.getElementById("onboardingProgressBar");
  if (label) {
    label.textContent = `Step ${step} of ${ONBOARDING_TOTAL_STEPS}`;
  }
  const pct = (step / ONBOARDING_TOTAL_STEPS) * 100;
  if (fill) fill.style.width = `${pct}%`;
  if (bar) bar.setAttribute("aria-valuenow", String(step));
}

function syncOnboardingToneCards(selectedTone) {
  document.querySelectorAll(".onboarding-tone-card").forEach((btn) => {
    const t = btn.getAttribute("data-tone");
    const on = t === selectedTone;
    btn.classList.toggle("onboarding-tone-card--selected", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const hidden = document.getElementById("wizardPrefTone");
  if (hidden) hidden.value = selectedTone;
}

function renderOnboardingSummary() {
  const ul = document.getElementById("onboardingSummary");
  if (!ul || !onboardingResumeDraft) return;
  const tone = document.getElementById("wizardPrefTone")?.value || "warm";
  const mw = document.getElementById("wizardPrefMaxWords")?.value || "350";
  const voice = (
    document.getElementById("wizardPrefVoice")?.value || ""
  ).trim();
  const label = onboardingResumeDraft.label || "My resume";
  const chars = String(onboardingResumeDraft.extractedText || "").length;
  const toneLabel =
    tone === "direct" ? "Direct" : tone === "formal" ? "Formal" : "Warm";
  let html = `<li><strong>Resume</strong>: ${escapeHtml(label)} (${chars.toLocaleString()} characters)</li>`;
  html += `<li><strong>Tone</strong>: ${escapeHtml(toneLabel)}</li>`;
  html += `<li><strong>Max words</strong>: ${escapeHtml(String(mw))}</li>`;
  if (voice) {
    html += `<li><strong>Voice notes</strong>: ${escapeHtml(voice)}</li>`;
  }
  const samplesIn = document.getElementById("onboardingSamplesFileInput");
  const sn = samplesIn && samplesIn.files ? samplesIn.files.length : 0;
  if (sn) {
    html += `<li><strong>Writing samples</strong>: ${sn} file(s) queued</li>`;
  }
  const aiEl = document.getElementById("onboardingAiContextText");
  const aiRaw = (aiEl && aiEl.value) || "";
  const aiNorm = normalizeProfileTextInput(aiRaw);
  if (aiNorm) {
    html += `<li><strong>AI context</strong>: ${aiNorm.length.toLocaleString()} characters</li>`;
  }
  ul.innerHTML = html;
}

function setOnboardingStep(step) {
  for (let i = 1; i <= ONBOARDING_TOTAL_STEPS; i++) {
    const p = document.getElementById(`onboardingPanel${i}`);
    if (p) p.style.display = i === step ? "block" : "none";
  }
  const title = document.getElementById("onboardingWizardTitle");
  const titles = {
    1: "Welcome",
    2: "Upload resume",
    3: "Paste resume",
    4: "Tone",
    5: "Length",
    6: "Voice",
    7: "Writing samples",
    8: "AI context",
    9: "Ready",
  };
  if (title) title.textContent = titles[step] || "Welcome";
  updateOnboardingProgressUI(step);
  if (step === 2) updateOnboardingContinue2Enabled();
  if (step === 3) updateOnboardingNext3Enabled();
  if (step === 9) renderOnboardingSummary();

  const focusMap = {
    1: "onboardingNext1",
    2: "onboardingPasteInstead",
    3: "onboardingPasteText",
    4: "onboardingNext4",
    5: "wizardPrefMaxWords",
    6: "wizardPrefVoice",
    7: "onboardingSamplesFileInput",
    8: "onboardingAiContextText",
    9: "onboardingFinish",
  };
  const fid = focusMap[step];
  if (fid) {
    requestAnimationFrame(() => {
      document.getElementById(fid)?.focus();
    });
  }
}

function updateOnboardingContinue2Enabled() {
  const btn = document.getElementById("onboardingContinue2");
  if (!btn) return;
  const hasDraft =
    onboardingResumeDraft &&
    String(onboardingResumeDraft.extractedText || "").trim();
  btn.disabled = !hasDraft;
}

function updateOnboardingNext3Enabled() {
  const btn = document.getElementById("onboardingNext3");
  if (!btn) return;
  const ingest = getResumeIngest();
  const pasteEl = document.getElementById("onboardingPasteText");
  const pasteRaw = (pasteEl && pasteEl.value) || "";
  const pasteText = ingest
    ? ingest.normalizeExtractedText(pasteRaw)
    : pasteRaw.trim();
  const hasDraft =
    onboardingResumeDraft &&
    String(onboardingResumeDraft.extractedText || "").trim();
  btn.disabled = !hasDraft && !pasteText;
}

async function checkOnboardingGate() {
  const UC = getUserContent();
  if (!UC) return;
  try {
    await UC.openDb();
    await UC.migrateOnboardingState();
    if (await UC.isOnboardingComplete()) return;
    showOnboardingWizard();
  } catch (e) {
    console.warn("[JobBored] Onboarding gate:", e);
  }
}

function ensureResumeDraftFromPasteStep() {
  const ingest = getResumeIngest();
  const pasteEl = document.getElementById("onboardingPasteText");
  const status = document.getElementById("onboardingResumeStatus");
  let d = onboardingResumeDraft;
  if (!d || !String(d.extractedText || "").trim()) {
    const raw = (pasteEl && pasteEl.value) || "";
    const t = ingest ? ingest.normalizeExtractedText(raw) : raw.trim();
    if (!t) {
      if (status) {
        status.textContent = "Paste your resume to continue.";
        status.classList.add("onboarding-status--error");
      }
      return false;
    }
    d = {
      source: "paste",
      rawMime: "text/plain",
      label: "My resume",
      extractedText: t,
    };
    onboardingResumeDraft = d;
  }
  if (status) {
    status.textContent = "";
    status.classList.remove("onboarding-status--error");
  }
  return true;
}

function initOnboardingWizard() {
  const fileIn = document.getElementById("onboardingFileInput");
  const pasteEl = document.getElementById("onboardingPasteText");

  document.getElementById("onboardingNext1")?.addEventListener("click", () => {
    setOnboardingStep(2);
  });

  document
    .getElementById("onboardingPasteInstead")
    ?.addEventListener("click", () => {
      onboardingResumePath = "paste";
      onboardingResumeDraft = null;
      const statusUp = document.getElementById("onboardingResumeStatusUpload");
      const fin = document.getElementById("onboardingFileInput");
      if (statusUp) {
        statusUp.textContent = "";
        statusUp.classList.remove("onboarding-status--error");
      }
      if (fin) fin.value = "";
      updateOnboardingContinue2Enabled();
      setOnboardingStep(3);
    });

  document.getElementById("onboardingBack2")?.addEventListener("click", () => {
    setOnboardingStep(1);
  });

  document
    .getElementById("onboardingContinue2")
    ?.addEventListener("click", () => {
      if (
        !onboardingResumeDraft ||
        !String(onboardingResumeDraft.extractedText || "").trim()
      ) {
        return;
      }
      onboardingResumePath = "upload";
      setOnboardingStep(4);
    });

  document.getElementById("onboardingBack3")?.addEventListener("click", () => {
    setOnboardingStep(2);
  });

  document.getElementById("onboardingNext3")?.addEventListener("click", () => {
    if (!ensureResumeDraftFromPasteStep()) return;
    onboardingResumePath = "paste";
    setOnboardingStep(4);
  });

  document.getElementById("onboardingBack4")?.addEventListener("click", () => {
    if (onboardingResumePath === "upload") setOnboardingStep(2);
    else setOnboardingStep(3);
  });

  document.getElementById("onboardingNext4")?.addEventListener("click", () => {
    setOnboardingStep(5);
  });

  document.getElementById("onboardingBack5")?.addEventListener("click", () => {
    setOnboardingStep(4);
  });

  document.getElementById("onboardingNext5")?.addEventListener("click", () => {
    setOnboardingStep(6);
  });

  document.getElementById("onboardingBack6")?.addEventListener("click", () => {
    setOnboardingStep(5);
  });

  document.getElementById("onboardingSkip6")?.addEventListener("click", () => {
    const vo = document.getElementById("wizardPrefVoice");
    if (vo) vo.value = "";
    setOnboardingStep(7);
  });

  document.getElementById("onboardingNext6")?.addEventListener("click", () => {
    setOnboardingStep(7);
  });

  document.getElementById("onboardingBack7")?.addEventListener("click", () => {
    setOnboardingStep(6);
  });

  document.getElementById("onboardingSkip7")?.addEventListener("click", () => {
    setOnboardingStep(8);
  });

  document.getElementById("onboardingNext7")?.addEventListener("click", () => {
    setOnboardingStep(8);
  });

  document.getElementById("onboardingBack8")?.addEventListener("click", () => {
    setOnboardingStep(7);
  });

  document.getElementById("onboardingSkip8")?.addEventListener("click", () => {
    setOnboardingStep(9);
  });

  document.getElementById("onboardingNext8")?.addEventListener("click", () => {
    setOnboardingStep(9);
  });

  document.getElementById("onboardingBack9")?.addEventListener("click", () => {
    setOnboardingStep(8);
  });

  document.querySelectorAll(".onboarding-tone-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tone");
      if (t) syncOnboardingToneCards(t);
    });
  });

  if (fileIn) {
    fileIn.addEventListener("change", async (e) => {
      const ingest = getResumeIngest();
      const status = document.getElementById("onboardingResumeStatusUpload");
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file || !ingest) return;
      try {
        const text = await ingest.extractTextFromFile(file);
        if (!text.trim()) {
          if (status) {
            status.textContent = "No text could be extracted from that file.";
            status.classList.add("onboarding-status--error");
          }
          return;
        }
        const label =
          (file.name || "Resume").replace(/\.[^/.]+$/, "") || "My resume";
        onboardingResumeDraft = {
          source: "file",
          rawMime: ingest.guessMime(file),
          label,
          extractedText: text,
        };
        if (status) {
          status.textContent = `Loaded “${label}” (${text.length.toLocaleString()} characters).`;
          status.classList.remove("onboarding-status--error");
        }
        updateOnboardingContinue2Enabled();
      } catch (err) {
        console.error(err);
        if (status) {
          status.textContent = err.message || "Could not read file.";
          status.classList.add("onboarding-status--error");
        }
      }
    });
  }

  if (pasteEl) {
    pasteEl.addEventListener("input", () => {
      updateOnboardingNext3Enabled();
      const status = document.getElementById("onboardingResumeStatus");
      if (status && status.classList.contains("onboarding-status--error")) {
        status.textContent = "";
        status.classList.remove("onboarding-status--error");
      }
    });
  }

  const onboardingSamplesIn = document.getElementById(
    "onboardingSamplesFileInput",
  );
  const onboardingSamplesStatus = document.getElementById(
    "onboardingSamplesStatus",
  );
  if (onboardingSamplesIn && onboardingSamplesStatus) {
    onboardingSamplesIn.addEventListener("change", () => {
      const n = onboardingSamplesIn.files
        ? onboardingSamplesIn.files.length
        : 0;
      onboardingSamplesStatus.textContent = n
        ? `${n} file(s) selected — will be added when you finish.`
        : "";
      onboardingSamplesStatus.classList.remove("onboarding-status--error");
    });
  }

  document
    .getElementById("onboardingFinish")
    ?.addEventListener("click", async () => {
      const UC = getUserContent();
      if (!UC || !onboardingResumeDraft) return;
      if (!String(onboardingResumeDraft.extractedText || "").trim()) {
        showToast("Resume text is missing — go back a step", "error");
        return;
      }
      const toneEl = document.getElementById("wizardPrefTone");
      const mwEl = document.getElementById("wizardPrefMaxWords");
      const voEl = document.getElementById("wizardPrefVoice");
      const maxWords = parseInt(mwEl && mwEl.value, 10);
      const finish = document.getElementById("onboardingFinish");
      if (finish) finish.disabled = true;
      try {
        await UC.setPrimaryResume(onboardingResumeDraft);
        const samplesInput = document.getElementById(
          "onboardingSamplesFileInput",
        );
        if (samplesInput && samplesInput.files && samplesInput.files.length) {
          await profileApplySampleFiles(samplesInput.files, UC);
        }
        const aiEl = document.getElementById("onboardingAiContextText");
        const aiNorm = normalizeProfileTextInput((aiEl && aiEl.value) || "");
        if (aiNorm && typeof UC.saveAdditionalContext === "function") {
          await UC.saveAdditionalContext({
            text: aiNorm,
            updatedAt: new Date().toISOString(),
          });
        }
        await UC.savePreferences({
          tone: (toneEl && toneEl.value) || "warm",
          defaultMaxWords:
            !Number.isNaN(maxWords) && maxWords > 0 ? maxWords : 350,
          industriesToEmphasize: "",
          wordsToAvoid: "",
          voiceNotes: (voEl && voEl.value.trim()) || "",
        });
        await UC.completeOnboarding();
        hideOnboardingWizard();
        try {
          if (sessionStorage.getItem(PENDING_DISCOVERY_SETUP_KEY) === "1") {
            sessionStorage.removeItem(PENDING_DISCOVERY_SETUP_KEY);
            void openSettingsForDiscoveryWebhook();
          }
        } catch (_) {
          /* ignore */
        }
        showToast(
          "You're all set — open Profile anytime to update.",
          "success",
        );
        scheduleCandidateProfileMatchRefresh(true);
        onboardingResumeDraft = null;
        onboardingResumePath = null;
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not save profile", "error");
      } finally {
        if (finish) finish.disabled = false;
      }
    });
}

function fillOneResumeModelSelect(selectId, optionList, currentValue) {
  const sel = document.getElementById(selectId);
  const opts =
    optionList ||
    (window.CommandCenterResumeModelOptions &&
      window.CommandCenterResumeModelOptions[
        selectId === "settingsResumeGeminiModel"
          ? "gemini"
          : selectId === "settingsResumeOpenAIModel"
            ? "openai"
            : "anthropic"
      ]);
  if (!sel || sel.tagName !== "SELECT" || !Array.isArray(opts)) return;
  const v =
    currentValue != null && String(currentValue).trim() !== ""
      ? String(currentValue).trim()
      : "";
  const values = new Set(opts.map((o) => o.value));
  sel.innerHTML = "";
  opts.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  });
  if (v && !values.has(v)) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = `${v} (saved)`;
    sel.appendChild(opt);
  }
  if (v && [...sel.options].some((o) => o.value === v)) {
    sel.value = v;
  } else if (opts[0]) {
    sel.value = opts[0].value;
  }
}

/**
 * @param {string} selectId
 * @param {'cover_letter'|'resume_update'} kind
 * @param {string} [currentId]
 */
function fillDocumentTemplateSelect(selectId, kind, currentId) {
  const DT = window.CommandCenterDocumentTemplates;
  if (!DT || !Array.isArray(DT.DOCUMENT_TEMPLATES)) return;
  const sel = document.getElementById(selectId);
  if (!sel || sel.tagName !== "SELECT") return;
  const list = DT.DOCUMENT_TEMPLATES.filter((t) => t.kind === kind);
  const defaultId = DT.getDefaultTemplateId(kind);
  let v =
    currentId != null && String(currentId).trim() !== ""
      ? String(currentId).trim()
      : defaultId;
  const values = new Set(list.map((t) => t.id));
  sel.innerHTML = "";
  list.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.label;
    if (t.description) opt.title = t.description;
    sel.appendChild(opt);
  });
  if (!values.has(v)) v = defaultId;
  sel.value = v;
}

/**
 * @param {string} selectId
 * @param {string} [currentId]
 */
function fillVisualThemeSelect(selectId, currentId) {
  const VT = window.CommandCenterVisualThemes;
  if (!VT || !Array.isArray(VT.VISUAL_THEMES)) return;
  const sel = document.getElementById(selectId);
  if (!sel || sel.tagName !== "SELECT") return;
  const list = VT.VISUAL_THEMES;
  const defaultId = VT.getDefaultVisualThemeId();
  let v =
    currentId != null && String(currentId).trim() !== ""
      ? String(currentId).trim()
      : defaultId;
  const resolved =
    VT.resolveVisualTheme && typeof VT.resolveVisualTheme === "function"
      ? VT.resolveVisualTheme(v)
      : { id: v };
  v = resolved.id;
  const values = new Set(list.map((t) => t.id));
  sel.innerHTML = "";
  list.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.label;
    if (t.description) opt.title = t.description;
    sel.appendChild(opt);
  });
  if (!values.has(v)) v = defaultId;
  sel.value = v;
}

async function resolveVisualThemeIdForModal() {
  const VT = window.CommandCenterVisualThemes;
  const fallback =
    VT && typeof VT.getDefaultVisualThemeId === "function"
      ? VT.getDefaultVisualThemeId()
      : "classic";
  try {
    const UC = getUserContent();
    if (!UC) return fallback;
    await UC.openDb();
    const prefs = await UC.getPreferences();
    const raw = prefs.visualThemeId || fallback;
    return VT && typeof VT.resolveVisualTheme === "function"
      ? VT.resolveVisualTheme(raw).id
      : raw;
  } catch (_) {
    return fallback;
  }
}

function fillResumeModelSelectsFromConfig(cfg) {
  const m = window.CommandCenterResumeModelOptions;
  if (!m) return;
  fillOneResumeModelSelect(
    "settingsResumeGeminiModel",
    m.gemini,
    cfg.resumeGeminiModel,
  );
  fillOneResumeModelSelect(
    "settingsResumeOpenAIModel",
    m.openai,
    cfg.resumeOpenAIModel,
  );
  fillOneResumeModelSelect(
    "settingsResumeAnthropicModel",
    m.anthropic,
    cfg.resumeAnthropicModel,
  );
}

async function populateDiscoveryProfileIntoSettingsForm() {
  const UC = window.CommandCenterUserContent;
  if (!UC || typeof UC.getDiscoveryProfile !== "function") return;
  const p = await UC.getDiscoveryProfile();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v != null ? String(v) : "";
  };
  set("settingsDiscoveryTargetRoles", p.targetRoles);
  set("settingsDiscoveryLocations", p.locations);
  set("settingsDiscoveryRemotePolicy", p.remotePolicy);
  set("settingsDiscoverySeniority", p.seniority);
  set("settingsDiscoveryKeywordsInclude", p.keywordsInclude);
  set("settingsDiscoveryKeywordsExclude", p.keywordsExclude);
  set("settingsDiscoveryMaxLeadsPerRun", p.maxLeadsPerRun);
  // Handle grounded_web checkbox
  const gwEl = document.getElementById("settingsDiscoveryGroundedWeb");
  if (gwEl) gwEl.checked = p.groundedWebEnabled !== false;
}

function populateCommandCenterSettingsForm() {
  const cfg = {
    ...(window.COMMAND_CENTER_CONFIG || {}),
    ...readStoredConfigOverrides(),
  };
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v != null ? String(v) : "";
  };
  const sidRaw = cfg.sheetId != null ? String(cfg.sheetId) : "";
  set("settingsSheetId", parseGoogleSheetId(sidRaw) || sidRaw);
  set("settingsOAuthClientId", cfg.oauthClientId);
  set("settingsTitle", normalizeDashboardTitle(cfg.title));
  set("settingsDiscoveryWebhookUrl", cfg.discoveryWebhookUrl);
  set("settingsJobPostingScrapeUrl", cfg.jobPostingScrapeUrl);
  const atsMode = String(cfg.atsScoringMode || "server").toLowerCase();
  set("settingsAtsScoringMode", atsMode === "webhook" ? "webhook" : "server");
  set("settingsAtsScoringServerUrl", cfg.atsScoringServerUrl);
  set("settingsAtsScoringWebhookUrl", cfg.atsScoringWebhookUrl);
  const prov = String(cfg.resumeProvider || "gemini").toLowerCase();
  const sel = document.getElementById("settingsResumeProvider");
  if (sel) {
    const pv = ["gemini", "openai", "anthropic", "webhook"].includes(prov)
      ? prov
      : "gemini";
    sel.value = pv;
  }
  fillResumeModelSelectsFromConfig(cfg);
  set("settingsResumeGeminiApiKey", cfg.resumeGeminiApiKey);
  set("settingsResumeOpenAIApiKey", cfg.resumeOpenAIApiKey);
  set("settingsResumeAnthropicApiKey", cfg.resumeAnthropicApiKey);
  set("settingsResumeGenerationWebhookUrl", cfg.resumeGenerationWebhookUrl);
  const err = document.getElementById("settingsFormError");
  if (err) {
    err.textContent = "";
    err.style.display = "none";
  }
  renderAppsScriptDeployUi();
}

function updateSettingsProviderPanels() {
  const sel = document.getElementById("settingsResumeProvider");
  const v = sel ? sel.value : "gemini";
  const gem = document.getElementById("settingsPanelGemini");
  const oai = document.getElementById("settingsPanelOpenAI");
  const ant = document.getElementById("settingsPanelAnthropic");
  const hook = document.getElementById("settingsPanelWebhook");
  if (gem) gem.style.display = v === "gemini" ? "block" : "none";
  if (oai) oai.style.display = v === "openai" ? "block" : "none";
  if (ant) ant.style.display = v === "anthropic" ? "block" : "none";
  if (hook) hook.style.display = v === "webhook" ? "block" : "none";
}

/** Default OAuth Web Client ID for phased Settings (before Google sign-in unlocks full settings). */
const DEFAULT_OAUTH_CLIENT_ID_FOR_PHASED_SETTINGS =
  "555157387171-o05ofv6ihjh3brknkvsm2hr7nup7e88a.apps.googleusercontent.com";

/** Settings should always expose sheet/discovery fields; actions that need auth already gate themselves. */
function isSettingsFullExperienceUnlocked() {
  return true;
}

function maybeSyncSettingsModalModeAfterAuth() {
  const m = document.getElementById("settingsModal");
  if (m && m.style.display === "flex") syncSettingsModalMode();
}

function syncSettingsModalMode() {
  const card = document.querySelector("#settingsModal .settings-modal");
  if (!card) return;
  const full = isSettingsFullExperienceUnlocked();
  card.classList.toggle("settings-modal--oauth-only", !full);
  const modalTitle = document.getElementById("settingsModalTitle");
  if (modalTitle) {
    modalTitle.textContent = full ? "JobBored settings" : "Google OAuth setup";
  }
  const oauthLab = document.getElementById("settingsOAuthClientIdLabel");
  if (oauthLab) {
    oauthLab.textContent = full
      ? "OAuth Client ID (optional)"
      : "OAuth Client ID";
  }
}

function maybeApplyPhasedSettingsDefaultOAuthClientId() {
  if (isSettingsFullExperienceUnlocked()) return;
  const el = document.getElementById("settingsOAuthClientId");
  if (!el) return;
  const v = String(el.value || "").trim();
  if (v) return;
  el.value = DEFAULT_OAUTH_CLIENT_ID_FOR_PHASED_SETTINGS;
}

async function openCommandCenterSettingsModal(opts) {
  closeAuthUserMenu();
  appsScriptDeployStatus = null;
  appsScriptDeployStateCache = null;
  hideSettingsClearConfirmBar();
  populateCommandCenterSettingsForm();
  maybeApplyPhasedSettingsDefaultOAuthClientId();
  if (isSettingsFullExperienceUnlocked()) {
    await populateDiscoveryProfileIntoSettingsForm();
    await populateAppsScriptDeployStateIntoSettingsForm();
  }
  updateSettingsProviderPanels();
  syncSettingsModalMode();
  const modal = document.getElementById("settingsModal");
  if (modal) modal.style.display = "flex";
  // Initialize settings tabs
  const TabSchema = window.JobBoredSettingsTabSchema;
  const Tabs = window.JobBoredSettingsTabs;
  if (Tabs && TabSchema && modal) {
    const defaultTab = (opts && opts.tab) || TabSchema.DEFAULT_TAB;
    Tabs.initSettingsTabs(modal, { defaultTab: defaultTab });
  }
  void probeTunnelStaleBadge();
}

function hideSettingsClearConfirmBar() {
  const bar = document.getElementById("settingsClearConfirmBar");
  if (bar) bar.hidden = true;
}

function showSettingsClearConfirmBar() {
  const bar = document.getElementById("settingsClearConfirmBar");
  if (!bar) return;
  bar.hidden = false;
  document.getElementById("settingsClearConfirmYes")?.focus();
}

function closeCommandCenterSettingsModal() {
  hideSettingsClearConfirmBar();
  const modal = document.getElementById("settingsModal");
  if (modal) modal.style.display = "none";
}

async function saveCommandCenterSettingsFromForm() {
  const err = document.getElementById("settingsFormError");
  if (err) {
    err.textContent = "";
    err.style.display = "none";
  }
  if (!isSettingsFullExperienceUnlocked()) {
    const oauthEl = document.getElementById("settingsOAuthClientId");
    const oauthClientIdInput = oauthEl ? oauthEl.value.trim() : "";
    if (!oauthClientIdInput) {
      if (err) {
        err.textContent = "Paste your Google OAuth Client ID.";
        err.style.display = "block";
      }
      return;
    }
    try {
      mergeStoredConfigOverridePatch({
        oauthClientId: oauthClientIdInput,
        title: normalizeDashboardTitle(
          (() => {
            const el = document.getElementById("settingsTitle");
            return el ? el.value.trim() : "";
          })(),
        ),
      });
    } catch (e) {
      if (err) {
        err.textContent = "Could not save OAuth settings. " + (e.message || "");
        err.style.display = "block";
      }
      return;
    }
    syncDiscoveryButtonState();
    showToast("OAuth client saved — reloading…", "success");
    setTimeout(() => window.location.reload(), 400);
    return;
  }
  const sheetEl = document.getElementById("settingsSheetId");
  const rawSheet = (sheetEl && sheetEl.value.trim()) || "";
  const sheetId = parseGoogleSheetId(rawSheet);
  const oauthClientIdInput = (() => {
    const el = document.getElementById("settingsOAuthClientId");
    return el ? el.value.trim() : "";
  })();
  if (!sheetId || sheetId === "YOUR_SHEET_ID_HERE") {
    if (oauthClientIdInput) {
      try {
        mergeStoredConfigOverridePatch({
          oauthClientId: oauthClientIdInput,
          title: normalizeDashboardTitle(
            (() => {
              const el = document.getElementById("settingsTitle");
              return el ? el.value.trim() : "";
            })(),
          ),
        });
      } catch (e) {
        if (err) {
          err.textContent =
            "Could not save OAuth settings. " + (e.message || "");
          err.style.display = "block";
        }
        return;
      }
      syncDiscoveryButtonState();
      showToast("OAuth client saved — reloading…", "success");
      setTimeout(() => window.location.reload(), 400);
      return;
    }
    if (err) {
      err.textContent =
        "Paste your spreadsheet’s full URL from the browser bar, or the Sheet ID only (the long id between /d/ and /edit).";
      err.style.display = "block";
    }
    const Tabs = window.JobBoredSettingsTabs;
    if (Tabs) Tabs.activateTabForField("settingsSheetId");
    return;
  }
  if (sheetEl) sheetEl.value = sheetId;
  const val = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  };
  const provEl = document.getElementById("settingsResumeProvider");
  const provider =
    provEl &&
    ["gemini", "openai", "anthropic", "webhook"].includes(provEl.value)
      ? provEl.value
      : "gemini";
  const payload = {
    sheetId,
    oauthClientId: val("settingsOAuthClientId"),
    title: normalizeDashboardTitle(val("settingsTitle")),
    discoveryWebhookUrl: val("settingsDiscoveryWebhookUrl"),
    jobPostingScrapeUrl: val("settingsJobPostingScrapeUrl"),
    atsScoringMode:
      val("settingsAtsScoringMode").toLowerCase() === "webhook"
        ? "webhook"
        : "server",
    atsScoringServerUrl: val("settingsAtsScoringServerUrl"),
    atsScoringWebhookUrl: val("settingsAtsScoringWebhookUrl"),
    resumeProvider: provider,
    resumeGeminiApiKey: val("settingsResumeGeminiApiKey"),
    resumeGeminiModel: val("settingsResumeGeminiModel") || "gemini-2.5-flash",
    resumeOpenAIApiKey: val("settingsResumeOpenAIApiKey"),
    resumeOpenAIModel: val("settingsResumeOpenAIModel") || "gpt-4o-mini",
    resumeAnthropicApiKey: val("settingsResumeAnthropicApiKey"),
    resumeAnthropicModel:
      val("settingsResumeAnthropicModel") || "claude-sonnet-4-6",
    resumeGenerationWebhookUrl: val("settingsResumeGenerationWebhookUrl"),
  };

  const UC = window.CommandCenterUserContent;
  if (UC && typeof UC.saveDiscoveryProfile === "function") {
    try {
      // Handle grounded_web checkbox
      const gwEl = document.getElementById("settingsDiscoveryGroundedWeb");
      const groundedWebEnabled = gwEl ? gwEl.checked : true;
      await UC.saveDiscoveryProfile({
        targetRoles: val("settingsDiscoveryTargetRoles"),
        locations: val("settingsDiscoveryLocations"),
        remotePolicy: val("settingsDiscoveryRemotePolicy"),
        seniority: val("settingsDiscoverySeniority"),
        keywordsInclude: val("settingsDiscoveryKeywordsInclude"),
        keywordsExclude: val("settingsDiscoveryKeywordsExclude"),
        maxLeadsPerRun: val("settingsDiscoveryMaxLeadsPerRun"),
        groundedWebEnabled,
      });
    } catch (e) {
      console.warn("[JobBored] save discovery profile:", e);
      if (err) {
        err.textContent =
          "Could not save discovery preferences. " + (e.message || "");
        err.style.display = "block";
      }
      return;
    }
  }

  try {
    writeStoredConfigOverrides(payload);
  } catch (e) {
    if (err) {
      err.textContent =
        "Could not save (storage may be full or disabled). " +
        (e.message || "");
      err.style.display = "block";
    }
    return;
  }
  SHEET_ID = sheetId;
  setDashboardSheetLinks();
  const savedWebhookUrl = normalizeDiscoveryWebhookIdentity(
    payload.discoveryWebhookUrl,
  );
  if (!savedWebhookUrl) {
    await recordDiscoveryEngineState(
      "",
      DISCOVERY_ENGINE_STATE_NONE,
      "settings_saved",
    );
  } else {
    const managedUrl = getManagedAppsScriptWebhookIdentity();
    const savedState = getSavedDiscoveryEngineStateForUrl(savedWebhookUrl);
    await recordDiscoveryEngineState(
      savedWebhookUrl,
      savedState && savedState.state
        ? savedState.state
        : managedUrl && managedUrl === savedWebhookUrl
          ? DISCOVERY_ENGINE_STATE_STUB_ONLY
          : DISCOVERY_ENGINE_STATE_UNVERIFIED,
      "settings_saved",
    );
  }
  syncDiscoveryButtonState();
  showToast("Settings saved — reloading…", "success");
  setTimeout(() => window.location.reload(), 400);
}

/** Clears localStorage overrides and reloads (no native dialog — avoids focus fights with the settings overlay). */
function performSettingsClearOverrides() {
  if (!canUseLocalStorage()) {
    showToast(
      "This browser blocked local storage — nothing was cleared.",
      "error",
      true,
    );
    return;
  }
  try {
    localStorage.removeItem(COMMAND_CENTER_CONFIG_OVERRIDE_KEY);
  } catch (_) {
    showToast("Could not clear saved settings (storage error).", "error", true);
    return;
  }
  hideSettingsClearConfirmBar();
  window.location.reload();
}

function initCommandCenterSettings() {
  const modal = document.getElementById("settingsModal");
  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    void openCommandCenterSettingsModal();
  });
  document
    .getElementById("setupOpenSettingsBtn")
    ?.addEventListener("click", () => {
      if (!getSheetId()) {
        showToast("Create or connect your Pipeline sheet first.", "info");
        return;
      }
      void openDiscoverySetupWizard({ entryPoint: "setup_screen" });
    });
  document
    .getElementById("setupOpenSettingsLaterBtn")
    ?.addEventListener("click", () => {
      void openCommandCenterSettingsModal();
    });
  document
    .getElementById("settingsModalClose")
    ?.addEventListener("click", () => {
      closeCommandCenterSettingsModal();
    });
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeCommandCenterSettingsModal();
    });
  }
  document
    .getElementById("settingsResumeProvider")
    ?.addEventListener("change", () => {
      updateSettingsProviderPanels();
    });
  document.getElementById("settingsSaveBtn")?.addEventListener("click", () => {
    void saveCommandCenterSettingsFromForm();
  });
  document.getElementById("settingsClearBtn")?.addEventListener("click", () => {
    showSettingsClearConfirmBar();
  });
  document
    .getElementById("settingsClearConfirmCancel")
    ?.addEventListener("click", () => {
      hideSettingsClearConfirmBar();
    });
  document
    .getElementById("settingsClearConfirmYes")
    ?.addEventListener("click", () => {
      performSettingsClearOverrides();
    });
  const sheetField = document.getElementById("settingsSheetId");
  if (sheetField) {
    sheetField.addEventListener("input", () => {
      if (!appsScriptDeployBusy) appsScriptDeployStatus = null;
      renderAppsScriptDeployUi();
    });
    sheetField.addEventListener("blur", () => {
      const id = parseGoogleSheetId(sheetField.value);
      if (id) sheetField.value = id;
      if (!appsScriptDeployBusy) appsScriptDeployStatus = null;
      renderAppsScriptDeployUi();
    });
  }
  document
    .getElementById("settingsOAuthClientId")
    ?.addEventListener("input", () => {
      if (!appsScriptDeployBusy) appsScriptDeployStatus = null;
      renderAppsScriptDeployUi();
    });
  document
    .getElementById("settingsDiscoveryWebhookUrl")
    ?.addEventListener("input", () => {
      renderDiscoveryEngineStatusUi();
    });
  document
    .getElementById("settingsDiscoveryWebhookUrl")
    ?.addEventListener("blur", () => {
      renderDiscoveryEngineStatusUi();
    });
  document
    .getElementById("settingsAppsScriptDeployBtn")
    ?.addEventListener("click", () => {
      void deployAppsScriptStubFromSettings();
    });
  document
    .getElementById("settingsAppsScriptRecheckBtn")
    ?.addEventListener("click", () => {
      void recheckAppsScriptPublicAccessFromSettings();
    });
  document
    .getElementById("settingsAppsScriptCopyBtn")
    ?.addEventListener("click", () => {
      const url =
        appsScriptDeployStateCache &&
        typeof appsScriptDeployStateCache.webAppUrl === "string"
          ? appsScriptDeployStateCache.webAppUrl.trim()
          : "";
      if (!url) {
        showToast("No managed Apps Script URL to copy yet", "info");
        return;
      }
      copyTextToClipboard(url);
    });
}

function initSetupAndSheetAccessActions() {
  document
    .getElementById("setupCreateStarterSheetBtn")
    ?.addEventListener("click", () => {
      void handleSetupCreateStarterSheet();
    });
  document
    .getElementById("sheetAccessGateSignInBtn")
    ?.addEventListener("click", () => {
      signIn();
    });
  document
    .getElementById("sheetAccessGateOpenSettingsBtn")
    ?.addEventListener("click", () => {
      const input = document.getElementById(
        "sheetAccessGateOAuthClientIdInput",
      );
      const raw = input && input.value ? String(input.value).trim() : "";
      if (
        raw &&
        /\.apps\.googleusercontent\.com$/i.test(raw) &&
        raw !== "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com"
      ) {
        mergeStoredConfigOverridePatch({ oauthClientId: raw });
      }
      void openCommandCenterSettingsModal();
    });
  document
    .getElementById("sheetAccessGateReloadBtn")
    ?.addEventListener("click", () => {
      window.location.reload();
    });
  initLoginGateOAuthUi();
  renderSetupStarterSheetUi();
}

function initPipelineEmptyAndBriefActions() {
  document
    .getElementById("emptyStateActions")
    ?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-empty-action]");
      if (!b) return;
      const a = b.getAttribute("data-empty-action");
      if (a === "settings" || a === "open_setup") {
        void openDiscoverySetupWizard({ entryPoint: "empty_state" });
      }
      if (a === "run_discovery") {
        void triggerDiscoveryRun();
      }
    });
  document
    .querySelector(".daily-brief-panel")
    ?.addEventListener("click", (e) => {
      const rangeBtn = e.target.closest("[data-range]");
      if (rangeBtn) {
        briefActivityRange = rangeBtn.dataset.range;
        const el = document.getElementById("briefInsights");
        if (el && pipelineData.length)
          el.innerHTML = renderAreaWidget(pipelineData, briefActivityRange);
        return;
      }
      const feedItem = e.target.closest(
        '[data-action="open-detail"][data-stable-key]',
      );
      if (feedItem) {
        const key = parseInt(feedItem.dataset.stableKey, 10);
        if (!Number.isNaN(key)) openJobDetail(key);
        return;
      }
      const b = e.target.closest("[data-brief-action]");
      if (!b) return;
      const a = b.getAttribute("data-brief-action");
      if (a === "settings" || a === "open_setup") {
        void openDiscoverySetupWizard({ entryPoint: "brief" });
      }
      if (a === "run_discovery") {
        void triggerDiscoveryRun();
      }
      if (a === "agent" || a === "paths") openDiscoveryPathsModal();
    });
}

/** Plain text → safe HTML for cover letter preview (paragraphs + line breaks). */
function formatCoverLetterPreviewHtml(text) {
  if (!text || !String(text).trim()) return "";
  return String(text)
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      const escaped = escapeHtml(block);
      const withBreaks = escaped.replace(/\n/g, "<br />");
      return `<p class="doc-preview__p">${withBreaks}</p>`;
    })
    .join("");
}

/** Plain text → safe HTML for resume preview (section headers + lines). */
function formatResumePreviewHtml(text) {
  if (!text || !String(text).trim()) return "";
  const lines = String(text).split("\n");
  const parts = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      parts.push('<div class="doc-preview__gap" aria-hidden="true"></div>');
      continue;
    }
    const esc = escapeHtml(line);
    const upper = t.toUpperCase();
    const isSection =
      t.length >= 3 &&
      t.length <= 56 &&
      t === upper &&
      /^[A-Z0-9\s&/\-–—:,.]+$/.test(t) &&
      !/\d{4}\s*[-–]\s*\d{4}/.test(t);
    if (isSection) {
      parts.push(`<h2 class="doc-preview__section">${esc}</h2>`);
    } else {
      parts.push(`<p class="doc-preview__resume-line">${esc}</p>`);
    }
  }
  return parts.join("");
}

function formatContextDateLabel(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString();
}

function buildGenerationContextUsed(profile) {
  if (!profile || typeof profile !== "object") return null;
  const sourceMeta =
    profile.sourceMeta && typeof profile.sourceMeta === "object"
      ? profile.sourceMeta
      : {};
  return {
    resume: {
      chars: String(profile.resumeText || "").length,
      updatedAt: sourceMeta.resumeUpdatedAt || "",
    },
    linkedIn: {
      chars: String(profile.linkedinProfileText || "").length,
      updatedAt: sourceMeta.linkedinUpdatedAt || "",
    },
    aiDump: {
      chars: String(profile.additionalContextText || "").length,
      updatedAt: sourceMeta.additionalContextUpdatedAt || "",
    },
  };
}

function renderGenerationContextUsed(el, contextUsed) {
  if (!el) return;
  if (!contextUsed) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const mk = (label, v) =>
    `<span class="doc-output-context__chip"><strong>${escapeHtml(label)}</strong>${Number(v.chars || 0).toLocaleString()} chars · ${escapeHtml(formatContextDateLabel(v.updatedAt || ""))}</span>`;
  el.innerHTML = [
    mk("Resume", contextUsed.resume || {}),
    mk("LinkedIn", contextUsed.linkedIn || {}),
    mk("AI dump", contextUsed.aiDump || {}),
  ].join("");
  el.hidden = false;
}

function renderDocMatchGroupHtml(title, terms) {
  if (!terms || !terms.length) return "";
  return `<div class="doc-match-group"><p class="doc-match-group__label">${escapeHtml(title)}</p><ul class="doc-match-list">${renderMatchItemsHtml(terms, "doc-match-item")}</ul></div>`;
}

function hashStringForCache(raw) {
  const s = String(raw || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function computeAtsScorecardCacheKey(text, job, feature) {
  const t = String(text || "").trim();
  const j = job && typeof job === "object" ? job : null;
  if (!t || !j) return "";
  const title = String(j.title || "").trim();
  const company = String(j.company || "").trim();
  if (!title || !company) return "";
  const enr =
    j._postingEnrichment && typeof j._postingEnrichment === "object"
      ? j._postingEnrichment
      : {};
  const jobKey = getJobOpportunityKey(j);
  const atsCfg = getAtsScoringConfig();
  const transportPart =
    atsCfg.mode === "webhook"
      ? `webhook|${String(atsCfg.webhookUrl || "").trim()}`
      : `server|${String(atsCfg.serverUrl || "").trim()}`;
  return [
    feature === "resume_update" ? "resume_update" : "cover_letter",
    jobKey,
    hashStringForCache(t),
    hashStringForCache(transportPart),
    hashStringForCache(
      `${title}|${company}|${String(enr.description || "")}|${String(
        (enr.requirements || []).join("||"),
      )}`,
    ),
  ].join("|");
}

function normalizeAtsScorecardResult(raw, fallbackModel) {
  const input = raw && typeof raw === "object" ? raw : {};
  const ds =
    input.dimensionScores && typeof input.dimensionScores === "object"
      ? input.dimensionScores
      : {};
  const toScore = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  };
  const toSeverity = (v) => {
    const x = String(v || "").toLowerCase();
    return x === "high" || x === "low" || x === "medium" ? x : "medium";
  };
  const toSourceType = (v) => {
    const x = String(v || "").toLowerCase();
    return ["resume", "cover_letter", "job", "profile"].includes(x)
      ? x
      : "profile";
  };
  return {
    schemaVersion: 1,
    overallScore: toScore(input.overallScore),
    dimensionScores: {
      requirementsCoverage: toScore(ds.requirementsCoverage),
      experienceRelevance: toScore(ds.experienceRelevance),
      impactClarity: toScore(ds.impactClarity),
      atsParseability: toScore(ds.atsParseability),
      toneFit: toScore(ds.toneFit),
    },
    topStrengths: Array.isArray(input.topStrengths)
      ? input.topStrengths
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 8)
      : [],
    criticalGaps: Array.isArray(input.criticalGaps)
      ? input.criticalGaps
          .map((x) => ({
            gap: String((x && x.gap) || "").trim(),
            whyItMatters: String((x && x.whyItMatters) || "").trim(),
            severity: toSeverity(x && x.severity),
          }))
          .filter((x) => x.gap && x.whyItMatters)
          .slice(0, 10)
      : [],
    evidence: Array.isArray(input.evidence)
      ? input.evidence
          .map((x) => ({
            claim: String((x && x.claim) || "").trim(),
            sourceSnippet: String((x && x.sourceSnippet) || "").trim(),
            sourceType: toSourceType(x && x.sourceType),
          }))
          .filter((x) => x.claim && x.sourceSnippet)
          .slice(0, 10)
      : [],
    rewriteSuggestions: Array.isArray(input.rewriteSuggestions)
      ? input.rewriteSuggestions
          .map((x) => ({
            targetSection: String((x && x.targetSection) || "").trim(),
            before: String((x && x.before) || "").trim(),
            after: String((x && x.after) || "").trim(),
            rationale: String((x && x.rationale) || "").trim(),
          }))
          .filter((x) => x.targetSection && x.after)
          .slice(0, 8)
      : [],
    confidence: (() => {
      const n = Number(input.confidence);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
    })(),
    model: String(input.model || fallbackModel || "unknown"),
  };
}

function buildAtsScorecardRequestPayload(text, job, session) {
  const clip = (v, max) =>
    String(v || "")
      .trim()
      .slice(0, max);
  const clipArr = (arr, maxItems, maxChars) =>
    Array.isArray(arr)
      ? arr
          .slice(0, maxItems)
          .map((x) => clip(x, maxChars))
          .filter(Boolean)
      : [];
  const bundle = session && session.bundle ? session.bundle : null;
  const feature =
    session && session.feature === "resume_update"
      ? "resume_update"
      : "cover_letter";
  const sourceJob = bundle && bundle.job ? bundle.job : job || {};
  const postingEnrichment =
    sourceJob && sourceJob.postingEnrichment
      ? sourceJob.postingEnrichment
      : job && job._postingEnrichment
        ? {
            description: job._postingEnrichment.description || "",
            requirements: Array.isArray(job._postingEnrichment.requirements)
              ? job._postingEnrichment.requirements
              : [],
            skills: Array.isArray(job._postingEnrichment.skills)
              ? job._postingEnrichment.skills
              : [],
            mustHaves: Array.isArray(job._postingEnrichment.mustHaves)
              ? job._postingEnrichment.mustHaves
              : [],
            responsibilities: Array.isArray(
              job._postingEnrichment.responsibilities,
            )
              ? job._postingEnrichment.responsibilities
              : [],
            toolsAndStack: Array.isArray(job._postingEnrichment.toolsAndStack)
              ? job._postingEnrichment.toolsAndStack
              : [],
          }
        : null;
  const payload = {
    event: "command-center.ats-scorecard",
    schemaVersion: 1,
    feature,
    docText: clip(text, 18000),
    job: {
      title: clip(
        (sourceJob && sourceJob.title) || (job && job.title) || "",
        300,
      ),
      company: clip(
        (sourceJob && sourceJob.company) || (job && job.company) || "",
        300,
      ),
      url: clip((sourceJob && sourceJob.url) || (job && job.link) || "", 3000),
      fitAssessment: clip(
        (sourceJob && sourceJob.fitAssessment) ||
          (job && job.fitAssessment) ||
          "",
        2500,
      ),
      talkingPoints: clip(
        (sourceJob && sourceJob.talkingPoints) ||
          (job && job.talkingPoints) ||
          "",
        2500,
      ),
      notes: clip(
        (sourceJob && sourceJob.notes) || (job && job.notes) || "",
        3000,
      ),
    },
  };
  if (postingEnrichment) {
    payload.job.postingEnrichment = {
      description: clip(postingEnrichment.description || "", 7000),
      requirements: clipArr(postingEnrichment.requirements, 35, 350),
      skills: clipArr(postingEnrichment.skills, 40, 180),
      mustHaves: clipArr(postingEnrichment.mustHaves, 20, 350),
      responsibilities: clipArr(postingEnrichment.responsibilities, 20, 350),
      toolsAndStack: clipArr(postingEnrichment.toolsAndStack, 24, 180),
    };
  }
  if (bundle && bundle.profile) {
    payload.profile = {
      candidateProfileText: clip(bundle.profile.candidateProfileText || "", 10000),
      resumeSourceText: clip(bundle.profile.resumeSourceText || "", 8000),
      linkedinProfileText: clip(bundle.profile.linkedinProfileText || "", 5000),
      additionalContextText: clip(
        bundle.profile.additionalContextText || "",
        5000,
      ),
    };
  }
  if (bundle && bundle.instructions) {
    payload.instructions = {
      userNotes: clip(bundle.instructions.userNotes || "", 1200),
      refinementFeedback: clip(
        bundle.instructions.refinementFeedback || "",
        1200,
      ),
    };
  }
  if (bundle && bundle.meta) {
    payload.meta = {};
    if (Object.prototype.hasOwnProperty.call(bundle.meta, "sheetId")) {
      payload.meta.sheetId = bundle.meta.sheetId ?? null;
    }
    if (bundle.meta.generatedAt) {
      payload.meta.generatedAt = String(bundle.meta.generatedAt).trim();
    }
  }
  return payload;
}

async function fetchAtsScorecard(payload) {
  const cfg = getAtsScoringConfig();
  const endpoint = getAtsScorecardApiUrl();
  if (!endpoint) {
    throw new Error(
      cfg.mode === "webhook"
        ? 'Set "ATS scorecard webhook URL" in Settings.'
        : 'Set "ATS scorecard server URL" in Settings or run local server.',
    );
  }
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await resp.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    data = null;
  }
  if (!resp.ok) {
    let fallback = `ATS scorecard failed (${resp.status})`;
    if (resp.status === 413) {
      fallback =
        "ATS request was too large for the endpoint. Reduce ATS payload size or increase server body limit.";
    }
    const cleanedRaw =
      raw && /<html|<!doctype/i.test(raw)
        ? fallback
        : sanitizeAtsText(raw).slice(0, 500);
    const msg =
      (data && (data.error || data.message)) || cleanedRaw || fallback;
    throw new Error(String(msg).slice(0, 500));
  }
  if (!data || typeof data !== "object") {
    throw new Error("ATS endpoint returned invalid JSON.");
  }
  return normalizeAtsScorecardResult(
    data,
    cfg.mode === "webhook" ? "webhook" : "server",
  );
}

function renderAtsBulletGroupHtml(title, rows) {
  if (!rows || !rows.length) return "";
  return `<div class="doc-match-group"><p class="doc-match-group__label">${escapeHtml(title)}</p><ul class="doc-match-list">${rows.join("")}</ul></div>`;
}

function sanitizeAtsText(raw) {
  let text = String(raw || "");
  if (!text) return "";
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

function renderAtsInsightRow(title, detail, meta, status) {
  const tone =
    status === "high"
      ? "missing"
      : status === "medium"
        ? "partial"
        : status === "low"
          ? "found"
          : status || "partial";
  const safeTitle = sanitizeAtsText(title);
  const safeDetail = sanitizeAtsText(detail);
  const safeMeta = sanitizeAtsText(meta);
  return `<li class="doc-match-item doc-match-item--${escapeHtml(tone)}"><span class="doc-match-item__status" aria-hidden="true"></span><span class="doc-match-item__label"><span class="doc-match-item__title">${escapeHtml(safeTitle)}</span>${safeDetail ? `<span class="doc-match-item__detail">${escapeHtml(safeDetail)}</span>` : ""}</span><span class="doc-match-item__meta">${escapeHtml(safeMeta || "")}</span></li>`;
}

function renderAtsScorecardGroupsHtml(scorecard) {
  const strengths = renderAtsBulletGroupHtml(
    "Top strengths",
    (scorecard.topStrengths || []).map((s) =>
      renderAtsInsightRow(s, "", "Strength", "found"),
    ),
  );
  const gaps = renderAtsBulletGroupHtml(
    "Critical gaps",
    (scorecard.criticalGaps || []).map((g) =>
      renderAtsInsightRow(
        g.gap,
        g.whyItMatters,
        g.severity || "medium",
        g.severity || "medium",
      ),
    ),
  );
  const suggestions = renderAtsBulletGroupHtml(
    "Rewrite suggestions",
    (scorecard.rewriteSuggestions || [])
      .slice(0, 4)
      .map((s) =>
        renderAtsInsightRow(
          s.targetSection,
          `After: ${s.after}${s.rationale ? ` · Why: ${s.rationale}` : ""}`,
          "Suggested line",
          "partial",
        ),
      ),
  );
  const evidence = renderAtsBulletGroupHtml(
    "Evidence checks",
    (scorecard.evidence || [])
      .slice(0, 4)
      .map((e) =>
        renderAtsInsightRow(
          e.claim,
          e.sourceSnippet,
          e.sourceType || "source",
          "found",
        ),
      ),
  );
  return [strengths, gaps, suggestions, evidence].filter(Boolean).join("");
}

function formatAtsDimensionSummary(scorecard) {
  const d = scorecard.dimensionScores || {};
  return [
    `Req ${Number(d.requirementsCoverage || 0)}%`,
    `Experience ${Number(d.experienceRelevance || 0)}%`,
    `Impact ${Number(d.impactClarity || 0)}%`,
    `Parseability ${Number(d.atsParseability || 0)}%`,
    `Tone ${Number(d.toneFit || 0)}%`,
  ].join(" · ");
}

function startAtsScorecardAnalysis(cacheKey, payload) {
  atsScorecardState = {
    ...atsScorecardState,
    cacheKey,
    status: "loading",
    result: null,
    error: "",
    payload,
  };
  void (async () => {
    try {
      const result = await fetchAtsScorecard(payload);
      if (atsScorecardState.cacheKey !== cacheKey) return;
      atsScorecardState = {
        ...atsScorecardState,
        status: "success",
        result,
        error: "",
      };
    } catch (err) {
      if (atsScorecardState.cacheKey !== cacheKey) return;
      atsScorecardState = {
        ...atsScorecardState,
        status: "error",
        result: null,
        error:
          err && err.message ? String(err.message) : "ATS scorecard failed",
      };
    }
    renderResumeGenerateInsights(
      payload.docText,
      lastResumeGenerationSession ? lastResumeGenerationSession.job : null,
    );
  })();
}

function getResumeGenerateDraftTextForInsights(fallbackBodyText) {
  const modal = document.getElementById("resumeGenerateModal");
  const ta = document.getElementById("resumeGenerateOutput");
  if (
    modal &&
    modal.style.display === "flex" &&
    ta &&
    modal.getAttribute("aria-busy") !== "true"
  ) {
    const v = String(ta.value || "").trim();
    if (v) return v;
  }
  return String(fallbackBodyText || "").trim();
}

function scheduleResumeGenerateAtsRefresh() {
  if (resumeGenerateAtsRefreshTimer) {
    clearTimeout(resumeGenerateAtsRefreshTimer);
  }
  resumeGenerateAtsRefreshTimer = setTimeout(() => {
    resumeGenerateAtsRefreshTimer = null;
    const ta = document.getElementById("resumeGenerateOutput");
    if (!ta || !lastResumeGenerationSession) return;
    renderResumeGenerateInsights(ta.value, lastResumeGenerationSession.job);
  }, 900);
}

function renderDraftHistoryItemHtml(draft, activeDraftId) {
  const metaBits = [
    `V${Number(draft.versionNumber || 0)}`,
    getDraftModeLabel(draft.mode),
    formatDraftSavedAt(draft.createdAt),
  ];
  const noteBits = [];
  if (draft.userNotes) noteBits.push("Has job notes");
  if (draft.refinementFeedback) noteBits.push("Includes refinement");
  const isActive = draft.id === activeDraftId;
  return `<button type="button" class="draft-history-item${isActive ? " draft-history-item--active" : ""}" data-action="open-saved-draft" data-draft-id="${escapeHtml(draft.id)}" aria-pressed="${isActive ? "true" : "false"}"><span class="draft-history-item__meta">${metaBits.map((bit) => `<span class="draft-history-item__chip">${escapeHtml(bit)}</span>`).join("")}</span><span class="draft-history-item__preview">${escapeHtml(draft.excerpt || "")}</span>${noteBits.length ? `<span class="draft-history-item__notes">${escapeHtml(noteBits.join(" · "))}</span>` : ""}</button>`;
}

function renderResumeGenerateInsights(bodyText, job) {
  const wrap = document.getElementById("resumeGenerateInsights");
  const atsCard = document.getElementById("resumeGenerateAtsCard");
  const atsScore = document.getElementById("resumeGenerateAtsScore");
  const atsSummary = document.getElementById("resumeGenerateAtsSummary");
  const atsHint = document.getElementById("resumeGenerateAtsHint");
  const atsGroups = document.getElementById("resumeGenerateAtsGroups");
  const historyCard = document.getElementById("resumeGenerateHistoryCard");
  const historyCount = document.getElementById("resumeGenerateHistoryCount");
  const historySummary = document.getElementById(
    "resumeGenerateHistorySummary",
  );
  const historyList = document.getElementById("resumeGenerateHistoryList");
  if (!wrap) return;

  const text = getResumeGenerateDraftTextForInsights(bodyText);
  if (!text) {
    wrap.hidden = true;
    if (atsCard) atsCard.hidden = true;
    if (historyCard) historyCard.hidden = true;
    return;
  }

  const session = lastResumeGenerationSession;
  const feature =
    session && session.feature === "resume_update"
      ? "resume_update"
      : "cover_letter";
  const cacheKey = computeAtsScorecardCacheKey(text, job, feature);
  const atsPayload = cacheKey
    ? buildAtsScorecardRequestPayload(text, job, session)
    : null;
  if (atsCard) {
    if (
      !cacheKey ||
      !atsPayload ||
      !atsPayload.job.title ||
      !atsPayload.job.company
    ) {
      atsCard.hidden = true;
    } else {
      if (atsScorecardState.cacheKey !== cacheKey) {
        startAtsScorecardAnalysis(cacheKey, atsPayload);
      }
      if (atsScorecardState.status === "loading") {
        if (atsScore) atsScore.textContent = "…";
        if (atsSummary) {
          atsSummary.textContent =
            "Analyzing this draft against the role with structured LLM scoring…";
        }
        if (atsHint) {
          atsHint.hidden = false;
          atsHint.textContent =
            "Scoring the latest text in the editor after generate or refine finishes.";
        }
        if (atsGroups) atsGroups.innerHTML = "";
      } else if (
        atsScorecardState.status === "success" &&
        atsScorecardState.result
      ) {
        const scorecard = atsScorecardState.result;
        if (atsScore) atsScore.textContent = `${scorecard.overallScore}%`;
        if (atsSummary) {
          const conf = Math.round(Number(scorecard.confidence || 0) * 100);
          atsSummary.textContent = `${formatAtsDimensionSummary(
            scorecard,
          )} · confidence ${conf}% · model ${scorecard.model}`;
        }
        if (atsHint) {
          const topGap = scorecard.criticalGaps && scorecard.criticalGaps[0];
          atsHint.textContent = topGap
            ? `Priority fix: ${sanitizeAtsText(topGap.gap)}`
            : "No critical gaps identified for this draft.";
          atsHint.hidden = false;
        }
        if (atsGroups) {
          atsGroups.innerHTML = renderAtsScorecardGroupsHtml(scorecard);
        }
      } else if (atsScorecardState.status === "error") {
        if (atsScore) atsScore.textContent = "—";
        if (atsSummary) {
          atsSummary.textContent =
            "Could not analyze this draft with ATS scorecard right now.";
        }
        if (atsHint) {
          atsHint.hidden = false;
          atsHint.textContent = atsScorecardState.error || "Unknown error";
        }
        if (atsGroups) {
          atsGroups.innerHTML =
            '<button type="button" class="btn-modal-secondary doc-insight-card__retry" data-action="retry-ats-scorecard">Retry analysis</button>';
        }
      }
      atsCard.hidden = false;
    }
  }

  const historyFeature =
    session && session.feature ? session.feature : "cover_letter";
  const historyDrafts = job ? getDraftsForJob(job, historyFeature) : [];
  if (historyCard) {
    if (historyDrafts.length) {
      if (historyCount) {
        historyCount.textContent = `${historyDrafts.length} version${historyDrafts.length === 1 ? "" : "s"}`;
      }
      if (historySummary) {
        historySummary.textContent =
          "Every generation and refine is auto-saved to this role. Pick any version to reopen or continue from.";
      }
      if (historyList) {
        historyList.innerHTML = historyDrafts
          .map((draft) =>
            renderDraftHistoryItemHtml(
              draft,
              session ? session.savedDraftId || "" : "",
            ),
          )
          .join("");
      }
      historyCard.hidden = false;
    } else {
      if (historyList) historyList.innerHTML = "";
      historyCard.hidden = true;
    }
  }

  wrap.hidden = !!(
    (!atsCard || atsCard.hidden) &&
    (!historyCard || historyCard.hidden)
  );
}

function syncResumeGenerateFooterState() {
  const modal = document.getElementById("resumeGenerateModal");
  const ta = document.getElementById("resumeGenerateOutput");
  const feedback = document.getElementById("resumeGenerateFeedback");
  const refine = document.getElementById("resumeGenerateRefine");
  const copy = document.getElementById("resumeGenerateCopy");
  const print = document.getElementById("resumeGeneratePrint");
  const busy = modal && modal.getAttribute("aria-busy") === "true";
  const hasBody = !!(ta && String(ta.value || "").trim());
  const canRefine = !!(
    !busy &&
    hasBody &&
    lastResumeGenerationSession &&
    lastResumeGenerationSession.bundle &&
    feedback &&
    String(feedback.value || "").trim()
  );
  if (feedback) feedback.disabled = !!busy || !hasBody;
  if (refine) refine.disabled = !canRefine;
  if (copy) copy.disabled = !!busy || !hasBody;
  if (print) print.disabled = !!busy || !hasBody;
}

function openDraftNotesModal(dataIndex, feature) {
  const modal = document.getElementById("draftNotesModal");
  const title = document.getElementById("draftNotesTitle");
  const target = document.getElementById("draftNotesTarget");
  const input = document.getElementById("draftNotesInput");
  const generate = document.getElementById("draftNotesGenerate");
  const job = pipelineData[dataIndex];
  if (!modal || !job) return;
  pendingDraftNotesRequest = { dataIndex, feature };
  if (title) {
    title.textContent =
      feature === "cover_letter"
        ? "Notes for this cover letter"
        : "Notes for this resume";
  }
  if (target) {
    target.textContent = `${job.title || "Role"} · ${job.company || "Company"}`;
  }
  if (input) input.value = "";
  if (generate) {
    generate.textContent =
      feature === "cover_letter" ? "Generate cover letter" : "Generate resume";
  }
  modal.style.display = "flex";
  input?.focus();
}

function closeDraftNotesModal() {
  const modal = document.getElementById("draftNotesModal");
  if (modal) modal.style.display = "none";
  pendingDraftNotesRequest = null;
}

/**
 * @param {string} title
 * @param {string} statusText
 * @param {string} bodyText
 * @param {boolean} isLoading
 * @param {"cover_letter"|"resume_update"} [docKind]
 * @param {{ resume: { chars: number, updatedAt: string }, linkedIn: { chars: number, updatedAt: string }, aiDump: { chars: number, updatedAt: string } } | null} [contextUsed]
 * @param {object | null} [jobForAnalysis]
 */
async function openResumeGenerateModal(
  title,
  statusText,
  bodyText,
  isLoading,
  docKind,
  contextUsed,
  jobForAnalysis,
) {
  const modal = document.getElementById("resumeGenerateModal");
  const kicker = document.getElementById("resumeGenerateKicker");
  const h = document.getElementById("resumeGenerateTitle");
  const meta = document.getElementById("resumeGenerateMeta");
  const st = document.getElementById("resumeGenerateStatus");
  const context = document.getElementById("resumeGenerateContextUsed");
  const ta = document.getElementById("resumeGenerateOutput");
  const preview = document.getElementById("resumeGeneratePreview");
  const skel = document.getElementById("resumeGenerateSkeleton");
  const page = document.getElementById("resumeGeneratePage");
  if (!modal || !h || !ta) return;

  const themeId = await resolveVisualThemeIdForModal();
  if (preview) preview.setAttribute("data-visual-theme", themeId);
  fillVisualThemeSelect("resumeGenerateVisualTheme", themeId);

  const kind = docKind === "resume_update" ? "resume_update" : "cover_letter";
  const isLetter = kind === "cover_letter";

  if (kicker) {
    kicker.textContent = isLetter ? "Cover letter" : "Résumé";
  }
  h.textContent = title;
  if (meta) {
    meta.textContent = isLetter
      ? "Letter-style preview · auto-saved per role · copy as plain text or print to PDF"
      : "Résumé-style layout · auto-saved per role · copy as plain text or print to PDF";
  }
  renderGenerationContextUsed(context, contextUsed || null);

  ta.value = bodyText || "";

  const hasBody = !!(bodyText && String(bodyText).trim());
  const isError = !isLoading && !!(statusText && !hasBody);

  if (st) {
    st.textContent = statusText || "";
    st.style.display = statusText ? "block" : "none";
    st.classList.toggle("doc-output-status--error", isError);
    st.classList.toggle(
      "doc-output-status--loading",
      !!(isLoading && statusText),
    );
  }

  modal.setAttribute("aria-busy", isLoading ? "true" : "false");
  modal.dataset.docKind = kind;

  if (isLoading) {
    atsScorecardState = {
      cacheKey: "",
      status: "idle",
      result: null,
      error: "",
      payload: null,
    };
    if (resumeGenerateAtsRefreshTimer) {
      clearTimeout(resumeGenerateAtsRefreshTimer);
      resumeGenerateAtsRefreshTimer = null;
    }
    if (skel) skel.hidden = false;
    if (preview) {
      preview.hidden = true;
      preview.innerHTML = "";
    }
    if (page) page.classList.add("doc-paper--loading");
    renderResumeGenerateInsights("", null);
  } else {
    if (skel) skel.hidden = true;
    if (page) page.classList.remove("doc-paper--loading");
    if (preview) {
      if (hasBody) {
        preview.hidden = false;
        preview.className =
          "doc-preview " +
          (isLetter ? "doc-preview--letter" : "doc-preview--resume");
        preview.setAttribute("data-visual-theme", themeId);
        preview.innerHTML = isLetter
          ? formatCoverLetterPreviewHtml(bodyText)
          : formatResumePreviewHtml(bodyText);
      } else {
        preview.hidden = true;
        preview.innerHTML = "";
      }
    }
    renderResumeGenerateInsights(
      bodyText,
      jobForAnalysis ||
        (lastResumeGenerationSession ? lastResumeGenerationSession.job : null),
    );
  }

  modal.style.display = "flex";
  syncResumeGenerateFooterState();
}

function closeResumeGenerateModal() {
  const modal = document.getElementById("resumeGenerateModal");
  if (modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-busy", "false");
  }
}

async function runResumeGeneration(dataIndex, feature, options) {
  const UC = getUserContent();
  const Bundle = getResumeBundle();
  const Gen = getResumeGenerate();
  if (!UC || !Bundle || !Gen) {
    showToast("Resume modules failed to load", "error");
    return;
  }

  const job = pipelineData[dataIndex];
  if (!job) {
    showToast("Job not found", "error");
    return;
  }

  if (
    typeof Gen.isResumeGenerationConfigured === "function" &&
    !Gen.isResumeGenerationConfigured()
  ) {
    showToast(
      'Set resumeGeminiApiKey in config.js for Gemini, or switch resumeProvider to "openai", "anthropic", or "webhook" (see SETUP.md).',
      "error",
      true,
    );
    return;
  }

  await UC.openDb();
  const active = await UC.getActiveResume();
  const linkedIn =
    typeof UC.getLinkedInProfile === "function"
      ? await UC.getLinkedInProfile()
      : { text: "" };
  const additional =
    typeof UC.getAdditionalContext === "function"
      ? await UC.getAdditionalContext()
      : { text: "" };
  const hasResume = !!(active && String(active.extractedText || "").trim());
  const hasLinkedIn = !!String(
    linkedIn && linkedIn.text ? linkedIn.text : "",
  ).trim();
  const hasAdditional = !!String(
    additional && additional.text ? additional.text : "",
  ).trim();
  if (!hasResume && !hasLinkedIn && !hasAdditional) {
    showToast(
      "Add resume, LinkedIn, or AI context in Profile first (best results use all three).",
      "error",
    );
    openMaterialsModal();
    return;
  }

  try {
    const userNotes =
      options && options.userNotes != null
        ? String(options.userNotes).trim()
        : "";
    const profile = await Bundle.assembleProfile(UC);
    const contextUsed = buildGenerationContextUsed(profile);
    const title =
      feature === "cover_letter" ? "Cover letter draft" : "Tailored resume";
    const feedbackEl = document.getElementById("resumeGenerateFeedback");
    if (feedbackEl) feedbackEl.value = "";
    await openResumeGenerateModal(
      title,
      "Generating…",
      "",
      true,
      feature,
      contextUsed,
      job,
    );
    const bundle = Bundle.buildResumeContextBundle(
      feature,
      job,
      profile,
      {
        maxWords: profile.preferences.defaultMaxWords,
        userNotes,
      },
      { sheetId: SHEET_ID },
    );
    lastResumeGenerationSession = {
      title,
      feature,
      bundle,
      contextUsed,
      job,
      savedDraftId: null,
      text: "",
    };
    const text = await Gen.generateFromBundle(bundle);
    let savedDraft = null;
    const UC2 = getUserContent();
    if (UC2 && typeof UC2.saveGeneratedDraft === "function") {
      try {
        savedDraft = await UC2.saveGeneratedDraft({
          feature,
          mode: "initial",
          text,
          job,
          userNotes,
        });
        await refreshGeneratedDraftLibraryCache();
        renderPipeline();
        if (activeDetailKey >= 0) refreshDrawerIfOpen(activeDetailKey);
      } catch (draftErr) {
        console.warn("[JobBored] save generated draft:", draftErr);
      }
    }
    lastResumeGenerationSession = {
      ...lastResumeGenerationSession,
      savedDraftId: savedDraft ? savedDraft.id : null,
      text,
    };
    await openResumeGenerateModal(
      title,
      "",
      text,
      false,
      feature,
      contextUsed,
      job,
    );
  } catch (err) {
    console.error("[JobBored] Resume generation:", err);
    const title =
      feature === "cover_letter" ? "Cover letter draft" : "Tailored resume";
    await openResumeGenerateModal(
      title,
      err.message || "Generation failed",
      "",
      false,
      feature,
      null,
      job,
    );
    showToast(err.message || "Generation failed", "error", true);
  }
}

async function refineLastResumeGeneration() {
  const Gen = getResumeGenerate();
  const feedbackEl = document.getElementById("resumeGenerateFeedback");
  const session = lastResumeGenerationSession;
  const ta = document.getElementById("resumeGenerateOutput");
  const editorDraft =
    ta && String(ta.value || "").trim() ? String(ta.value).trim() : "";
  const draftSource = editorDraft || (session && session.text) || "";
  const feedback =
    feedbackEl && feedbackEl.value != null
      ? String(feedbackEl.value).trim()
      : "";
  if (!Gen || !session || !session.bundle || !draftSource) {
    showToast("Generate a draft first", "error");
    return;
  }
  if (!feedback) {
    showToast("Add feedback before refining", "error");
    return;
  }
  try {
    lastResumeGenerationSession = {
      ...session,
      text: draftSource,
    };
    const nextBundle = {
      ...session.bundle,
      instructions: {
        ...(session.bundle.instructions || {}),
        refinementFeedback: feedback,
        previousDraft: draftSource,
      },
      meta: {
        ...(session.bundle.meta || {}),
        generatedAt: new Date().toISOString(),
      },
    };
    await openResumeGenerateModal(
      session.title,
      "Refining…",
      "",
      true,
      session.feature,
      session.contextUsed,
      session.job,
    );
    const nextText = await Gen.generateFromBundle(nextBundle);
    let savedDraft = null;
    const UC = getUserContent();
    if (UC && typeof UC.saveGeneratedDraft === "function") {
      try {
        savedDraft = await UC.saveGeneratedDraft({
          feature: session.feature,
          mode: "refine",
          text: nextText,
          job: session.job,
          parentDraftId: session.savedDraftId || null,
          userNotes:
            nextBundle.instructions && nextBundle.instructions.userNotes
              ? nextBundle.instructions.userNotes
              : "",
          refinementFeedback: feedback,
        });
        await refreshGeneratedDraftLibraryCache();
        renderPipeline();
        if (activeDetailKey >= 0) refreshDrawerIfOpen(activeDetailKey);
      } catch (draftErr) {
        console.warn("[JobBored] save refined draft:", draftErr);
      }
    }
    lastResumeGenerationSession = {
      ...session,
      bundle: nextBundle,
      savedDraftId: savedDraft ? savedDraft.id : session.savedDraftId || null,
      text: nextText,
    };
    if (feedbackEl) feedbackEl.value = "";
    await openResumeGenerateModal(
      session.title,
      "",
      nextText,
      false,
      session.feature,
      session.contextUsed,
      session.job,
    );
  } catch (err) {
    console.error("[JobBored] Resume refinement:", err);
    await openResumeGenerateModal(
      session.title,
      err.message || "Refinement failed",
      session.text,
      false,
      session.feature,
      session.contextUsed,
      session.job,
    );
    showToast(err.message || "Refinement failed", "error", true);
  }
}

async function openSavedDraftVersion(draftId) {
  const draft = getDraftByIdFromCache(draftId);
  if (!draft) {
    showToast("Saved draft not found", "error");
    return;
  }
  const job =
    pipelineData.find((row) => getJobOpportunityKey(row) === draft.jobKey) ||
    draft.jobSnapshot ||
    null;
  if (!job) {
    showToast("Job for this draft is no longer available", "error");
    return;
  }
  const UC = getUserContent();
  const Bundle = getResumeBundle();
  if (!UC || !Bundle) {
    showToast("Resume modules failed to load", "error");
    return;
  }
  try {
    await UC.openDb();
    const profile = await Bundle.assembleProfile(UC);
    const contextUsed = buildGenerationContextUsed(profile);
    const bundle = Bundle.buildResumeContextBundle(
      draft.feature,
      job,
      profile,
      {
        maxWords: profile.preferences.defaultMaxWords,
        userNotes: draft.userNotes || "",
      },
      { sheetId: SHEET_ID },
    );
    lastResumeGenerationSession = {
      title:
        draft.feature === "cover_letter"
          ? "Cover letter draft"
          : "Tailored resume",
      feature: draft.feature,
      bundle,
      contextUsed,
      job,
      savedDraftId: draft.id,
      text: draft.text,
    };
    const feedbackEl = document.getElementById("resumeGenerateFeedback");
    if (feedbackEl) feedbackEl.value = "";
    await openResumeGenerateModal(
      lastResumeGenerationSession.title,
      "",
      draft.text,
      false,
      draft.feature,
      contextUsed,
      job,
    );
  } catch (err) {
    console.error("[JobBored] open saved draft:", err);
    showToast(err.message || "Could not open saved draft", "error", true);
  }
}

async function openLatestSavedDraftForJob(dataIndex, feature) {
  const job = pipelineData[dataIndex];
  if (!job) {
    showToast("Job not found", "error");
    return;
  }
  const drafts = getDraftsForJob(job, feature);
  if (!drafts.length) {
    showToast(
      `No saved ${getDraftFeatureLabel(feature).toLowerCase()} yet`,
      "info",
    );
    return;
  }
  await openSavedDraftVersion(drafts[0].id);
}

function initResumeMaterialsFeature() {
  const UC = getUserContent();
  if (!UC) return;

  UC.openDb().catch((e) => console.warn("[JobBored] User content DB:", e));
  scheduleCandidateProfileMatchRefresh(true);
  scheduleGeneratedDraftLibraryRefresh(true);

  const materialsBtn = document.getElementById("materialsBtn");
  const materialsModal = document.getElementById("materialsModal");
  const materialsClose = document.getElementById("materialsModalClose");
  const materialsCloseX = document.getElementById("materialsModalCloseX");
  const profileResetWizardBtn = document.getElementById(
    "profileResetWizardBtn",
  );
  const fileInput = document.getElementById("materialsFileInput");
  const samplesFileInput = document.getElementById("materialsSamplesFileInput");
  const profileResumeBrowseBtn = document.getElementById(
    "profileResumeBrowseBtn",
  );
  const profileSamplesBrowseBtn = document.getElementById(
    "profileSamplesBrowseBtn",
  );
  const profileResumeDropzone = document.getElementById(
    "profileResumeDropzone",
  );
  const profileSamplesDropzone = document.getElementById(
    "profileSamplesDropzone",
  );
  const pasteBtn = document.getElementById("materialsPasteBtn");
  const linkedInAssistBtn = document.getElementById(
    "materialsLinkedInAssistBtn",
  );
  const linkedInSaveBtn = document.getElementById("materialsLinkedInSaveBtn");
  const linkedInClearBtn = document.getElementById("materialsLinkedInClearBtn");
  const linkedInTextEl = document.getElementById("materialsLinkedInText");
  const linkedInMetaEl = document.getElementById("materialsLinkedInMeta");
  const aiDumpTextEl = document.getElementById("materialsAiDumpText");
  const aiDumpMetaEl = document.getElementById("materialsAiDumpMeta");
  const aiDumpFileEl = document.getElementById("materialsAiDumpFile");
  const aiDumpSaveBtn = document.getElementById("materialsAiDumpSaveBtn");
  const aiDumpClearBtn = document.getElementById("materialsAiDumpClearBtn");
  const aiDumpCopyPromptBtn = document.getElementById(
    "materialsAiDumpCopyPromptBtn",
  );
  const aiDumpPromptEl = document.getElementById("materialsAiDumpPrompt");
  const linkedInCaptureModal = document.getElementById("linkedInCaptureModal");
  const linkedInCaptureClose = document.getElementById("linkedInCaptureClose");
  const linkedInCaptureCloseX = document.getElementById(
    "linkedInCaptureCloseX",
  );
  const linkedInCaptureSaveBtn = document.getElementById(
    "linkedInCaptureSaveBtn",
  );
  const sampleAddBtn = document.getElementById("sampleAddBtn");
  const savePrefsBtn = document.getElementById("materialsSavePrefsBtn");

  if (materialsBtn) {
    materialsBtn.addEventListener("click", () => openMaterialsModal());
  }
  if (materialsModal) {
    materialsModal.addEventListener("click", (e) => {
      if (e.target === materialsModal) closeMaterialsModal();
    });
  }
  if (materialsClose)
    materialsClose.addEventListener("click", closeMaterialsModal);
  if (materialsCloseX)
    materialsCloseX.addEventListener("click", closeMaterialsModal);

  if (profileResetWizardBtn) {
    profileResetWizardBtn.addEventListener("click", async () => {
      const ok = window.confirm(
        "Start the setup wizard again? Your resume and profile stay saved until you finish the new flow.",
      );
      if (!ok) return;
      if (!UC) return;
      try {
        await UC.openDb();
        await UC.resetOnboardingCompletion();
        closeMaterialsModal();
        closeCommandCenterSettingsModal();
        closeAuthUserMenu();
        showOnboardingWizard();
        showToast("Continue the steps below to finish setup.", "info");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not reset wizard", "error");
      }
    });
  }

  if (profileResumeBrowseBtn && fileInput) {
    profileResumeBrowseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });
  }
  if (profileSamplesBrowseBtn && samplesFileInput) {
    profileSamplesBrowseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      samplesFileInput.click();
    });
  }

  bindProfileDropzone(profileResumeDropzone, (files) => {
    const file = files[0];
    if (file) profileApplyResumeFile(file, UC);
  });
  bindProfileDropzone(profileSamplesDropzone, (files) => {
    profileApplySampleFiles(files, UC);
  });

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      await profileApplyResumeFile(f, UC);
    });
  }

  if (samplesFileInput) {
    samplesFileInput.addEventListener("change", async (e) => {
      const files = e.target.files;
      e.target.value = "";
      if (!files || !files.length) return;
      await profileApplySampleFiles(files, UC);
    });
  }

  if (pasteBtn) {
    pasteBtn.addEventListener("click", async () => {
      const ingest = getResumeIngest();
      const textEl = document.getElementById("materialsPasteText");
      const raw = (textEl && textEl.value) || "";
      const text = ingest ? ingest.normalizeExtractedText(raw) : raw.trim();
      if (!text) {
        showToast("Paste some resume text first", "error");
        return;
      }
      const label = "My resume";
      await UC.setPrimaryResume({
        source: "paste",
        rawMime: "text/plain",
        label,
        extractedText: text,
      });
      if (textEl) textEl.value = "";
      await refreshMaterialsUI();
      showToast("Resume updated from paste", "success");
    });
  }

  if (linkedInTextEl && linkedInMetaEl) {
    linkedInTextEl.addEventListener("input", () => {
      linkedInMetaEl.textContent = renderLinkedInProfileMeta(
        linkedInTextEl.value,
        "",
      );
    });
  }

  if (aiDumpTextEl && aiDumpMetaEl) {
    aiDumpTextEl.addEventListener("input", () => {
      aiDumpMetaEl.textContent = renderAdditionalContextMeta(
        aiDumpTextEl.value,
        "",
      );
    });
  }

  if (aiDumpCopyPromptBtn && aiDumpPromptEl) {
    aiDumpCopyPromptBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(aiDumpPromptEl.value || "");
        const orig = aiDumpCopyPromptBtn.textContent;
        aiDumpCopyPromptBtn.textContent = "Copied!";
        setTimeout(() => {
          aiDumpCopyPromptBtn.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy prompt to clipboard';
        }, 1500);
        showToast("Prompt copied — paste it into your chatbot", "success");
      } catch (err) {
        console.warn(err);
        showToast("Could not copy prompt", "info");
      }
    });
  }

  if (aiDumpFileEl) {
    aiDumpFileEl.addEventListener("change", async (e) => {
      const ingest = getResumeIngest();
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (!ingest) {
        showToast("File processing unavailable", "error");
        return;
      }
      try {
        const text = await ingest.extractTextFromFile(file);
        const normalized = normalizeProfileTextInput(text);
        if (!normalized) {
          showToast("No text could be extracted from that file", "error");
          return;
        }
        if (aiDumpTextEl) aiDumpTextEl.value = normalized;
        if (aiDumpMetaEl) {
          aiDumpMetaEl.textContent = renderAdditionalContextMeta(
            normalized,
            "",
          );
        }
        showToast("AI context loaded from file", "success");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Could not read file", "error");
      }
    });
  }

  if (aiDumpSaveBtn) {
    aiDumpSaveBtn.addEventListener("click", async () => {
      if (!UC || typeof UC.saveAdditionalContext !== "function") {
        showToast("AI context storage unavailable", "error");
        return;
      }
      const normalized = normalizeProfileTextInput(
        (aiDumpTextEl && aiDumpTextEl.value) || "",
      );
      if (!normalized) {
        showToast("Paste or upload AI context before saving", "error");
        return;
      }
      await UC.saveAdditionalContext({
        text: normalized,
        updatedAt: new Date().toISOString(),
      });
      await refreshMaterialsUI();
      showToast("AI context saved", "success");
    });
  }

  if (aiDumpClearBtn) {
    aiDumpClearBtn.addEventListener("click", async () => {
      if (!UC || typeof UC.clearAdditionalContext !== "function") {
        showToast("AI context storage unavailable", "error");
        return;
      }
      await UC.clearAdditionalContext();
      await refreshMaterialsUI();
      showToast("AI context cleared", "info");
    });
  }

  if (linkedInAssistBtn) {
    linkedInAssistBtn.addEventListener("click", () => {
      openLinkedInCaptureModal();
    });
  }

  LINKEDIN_CAPTURE_FIELDS.forEach((f) => {
    const el = document.getElementById(f.id);
    if (el) {
      el.addEventListener("input", updateLinkedInCapturePreview);
    }
  });

  if (linkedInCaptureModal) {
    linkedInCaptureModal.addEventListener("click", (e) => {
      if (e.target === linkedInCaptureModal) closeLinkedInCaptureModal();
    });
  }
  if (linkedInCaptureClose) {
    linkedInCaptureClose.addEventListener("click", closeLinkedInCaptureModal);
  }
  if (linkedInCaptureCloseX) {
    linkedInCaptureCloseX.addEventListener("click", closeLinkedInCaptureModal);
  }

  document.querySelectorAll("[data-li-clipboard-target]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.getAttribute("data-li-clipboard-target");
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target || target.tagName !== "TEXTAREA") return;
      try {
        const clip = await navigator.clipboard.readText();
        target.value = clip || "";
        updateLinkedInCapturePreview();
        showToast("Pasted from clipboard", "success");
      } catch (err) {
        console.warn(err);
        showToast(
          "Clipboard access blocked — paste manually (Cmd/Ctrl+V).",
          "info",
        );
      }
    });
  });

  if (linkedInCaptureSaveBtn) {
    linkedInCaptureSaveBtn.addEventListener("click", async () => {
      if (!UC || typeof UC.saveLinkedInProfile !== "function") {
        showToast("LinkedIn profile storage unavailable", "error");
        return;
      }
      const completeness = getLinkedInCaptureCompleteness();
      if (!completeness.canSave) {
        showToast("Capture Experience and Skills before saving", "error");
        updateLinkedInCapturePreview();
        return;
      }
      const text = buildLinkedInCaptureProfileText();
      if (!text) {
        showToast("Paste at least one LinkedIn section first", "error");
        return;
      }
      await UC.saveLinkedInProfile({
        text,
        updatedAt: new Date().toISOString(),
      });
      if (linkedInTextEl) linkedInTextEl.value = text;
      await refreshMaterialsUI();
      closeLinkedInCaptureModal();
      showToast("LinkedIn profile captured and saved", "success");
    });
  }

  if (linkedInSaveBtn) {
    linkedInSaveBtn.addEventListener("click", async () => {
      if (
        !UC ||
        typeof UC.saveLinkedInProfile !== "function" ||
        typeof UC.normalizeLinkedInProfile !== "function"
      ) {
        showToast("LinkedIn profile storage unavailable", "error");
        return;
      }
      const raw = (linkedInTextEl && linkedInTextEl.value) || "";
      const normalized = UC.normalizeLinkedInProfile({ text: raw });
      await UC.saveLinkedInProfile({
        text: normalized.text,
        updatedAt: new Date().toISOString(),
      });
      await refreshMaterialsUI();
      showToast("LinkedIn profile text saved", "success");
    });
  }

  if (linkedInClearBtn) {
    linkedInClearBtn.addEventListener("click", async () => {
      if (!UC || typeof UC.clearLinkedInProfile !== "function") {
        showToast("LinkedIn profile storage unavailable", "error");
        return;
      }
      await UC.clearLinkedInProfile();
      await refreshMaterialsUI();
      showToast("LinkedIn profile text cleared", "info");
    });
  }

  if (sampleAddBtn) {
    sampleAddBtn.addEventListener("click", async () => {
      const titleEl = document.getElementById("sampleTitle");
      const tagsEl = document.getElementById("sampleTags");
      const textEl = document.getElementById("sampleText");
      const title = (titleEl && titleEl.value.trim()) || "Writing sample";
      const tagsStr = (tagsEl && tagsEl.value) || "";
      const tags = tagsStr
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const raw = (textEl && textEl.value) || "";
      const ingest = getResumeIngest();
      const text = ingest ? ingest.normalizeExtractedText(raw) : raw.trim();
      if (!text) {
        showToast("Add sample text", "error");
        return;
      }
      await UC.addWritingSample({ title, tags, extractedText: text });
      if (textEl) textEl.value = "";
      if (tagsEl) tagsEl.value = "";
      if (titleEl) titleEl.value = "";
      await refreshMaterialsUI();
      showToast("Writing sample added", "success");
    });
  }

  if (savePrefsBtn) {
    savePrefsBtn.addEventListener("click", async () => {
      const toneEl = document.getElementById("prefTone");
      const mwEl = document.getElementById("prefMaxWords");
      const indEl = document.getElementById("prefIndustries");
      const avEl = document.getElementById("prefAvoid");
      const voEl = document.getElementById("prefVoice");
      const mergeEl = document.getElementById("prefMergePreference");
      const coverTplEl = document.getElementById("prefCoverLetterTemplate");
      const resumeTplEl = document.getElementById("prefResumeTemplate");
      const visualThemeEl = document.getElementById("prefVisualTheme");
      const DT = window.CommandCenterDocumentTemplates;
      const VT = window.CommandCenterVisualThemes;
      const maxWords = parseInt(mwEl && mwEl.value, 10);
      await UC.savePreferences({
        tone: (toneEl && toneEl.value) || "warm",
        defaultMaxWords:
          !Number.isNaN(maxWords) && maxWords > 0 ? maxWords : 350,
        industriesToEmphasize: (indEl && indEl.value) || "",
        wordsToAvoid: (avEl && avEl.value) || "",
        voiceNotes: (voEl && voEl.value) || "",
        profileMergePreference: (mergeEl && mergeEl.value) || "merge",
        coverLetterTemplateId:
          (coverTplEl && coverTplEl.value) ||
          (DT && typeof DT.getDefaultTemplateId === "function"
            ? DT.getDefaultTemplateId("cover_letter")
            : "cover_classic_paragraphs"),
        resumeTemplateId:
          (resumeTplEl && resumeTplEl.value) ||
          (DT && typeof DT.getDefaultTemplateId === "function"
            ? DT.getDefaultTemplateId("resume_update")
            : "resume_traditional_sections"),
        visualThemeId:
          (visualThemeEl && visualThemeEl.value) ||
          (VT && typeof VT.getDefaultVisualThemeId === "function"
            ? VT.getDefaultVisualThemeId()
            : "classic"),
      });
      closeAuthUserMenu();
      showToast("Preferences saved", "success");
    });
  }

  const genModal = document.getElementById("resumeGenerateModal");
  const genClose = document.getElementById("resumeGenerateClose");
  const genDone = document.getElementById("resumeGenerateDone");
  const genPrint = document.getElementById("resumeGeneratePrint");
  const genCopy = document.getElementById("resumeGenerateCopy");
  const genFeedback = document.getElementById("resumeGenerateFeedback");
  const genRefine = document.getElementById("resumeGenerateRefine");
  const genHistoryList = document.getElementById("resumeGenerateHistoryList");
  const draftNotesModal = document.getElementById("draftNotesModal");
  const draftNotesClose = document.getElementById("draftNotesModalClose");
  const draftNotesSkip = document.getElementById("draftNotesSkip");
  const draftNotesGenerate = document.getElementById("draftNotesGenerate");
  const closeGen = () => closeResumeGenerateModal();
  if (genClose) genClose.addEventListener("click", closeGen);
  if (genDone) genDone.addEventListener("click", closeGen);
  if (genModal) {
    genModal.addEventListener("click", (e) => {
      if (e.target === genModal) closeGen();
    });
  }
  if (genPrint) {
    genPrint.addEventListener("click", () => {
      window.print();
    });
  }
  if (genCopy) {
    genCopy.addEventListener("click", async () => {
      const ta = document.getElementById("resumeGenerateOutput");
      if (!ta || !ta.value) return;
      try {
        await navigator.clipboard.writeText(ta.value);
        showToast("Copied to clipboard", "success");
      } catch (_) {
        showToast("Could not copy — select text manually", "info");
      }
    });
  }
  if (genFeedback) {
    genFeedback.addEventListener("input", () =>
      syncResumeGenerateFooterState(),
    );
  }
  const genOutput = document.getElementById("resumeGenerateOutput");
  if (genOutput) {
    genOutput.addEventListener("input", () => {
      syncResumeGenerateFooterState();
      scheduleResumeGenerateAtsRefresh();
    });
  }
  if (genRefine) {
    genRefine.addEventListener("click", () => {
      void refineLastResumeGeneration();
    });
  }
  if (genHistoryList) {
    genHistoryList.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="open-saved-draft"]');
      if (!btn) return;
      const draftId = btn.getAttribute("data-draft-id");
      if (draftId) void openSavedDraftVersion(draftId);
    });
  }
  const atsGroups = document.getElementById("resumeGenerateAtsGroups");
  if (atsGroups) {
    atsGroups.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="retry-ats-scorecard"]');
      if (!btn) return;
      const session = lastResumeGenerationSession;
      if (!session || !session.job) return;
      const draft = getResumeGenerateDraftTextForInsights(session.text || "");
      if (!draft) return;
      const feature =
        session.feature === "resume_update" ? "resume_update" : "cover_letter";
      const cacheKey = computeAtsScorecardCacheKey(draft, session.job, feature);
      const payload = buildAtsScorecardRequestPayload(
        draft,
        session.job,
        session,
      );
      startAtsScorecardAnalysis(cacheKey, payload);
      renderResumeGenerateInsights(draft, session.job);
    });
  }
  if (draftNotesModal) {
    draftNotesModal.addEventListener("click", (e) => {
      if (e.target === draftNotesModal) closeDraftNotesModal();
    });
  }
  if (draftNotesClose) {
    draftNotesClose.addEventListener("click", closeDraftNotesModal);
  }
  if (draftNotesSkip) {
    draftNotesSkip.addEventListener("click", () => {
      const req = pendingDraftNotesRequest;
      closeDraftNotesModal();
      if (!req) return;
      void runResumeGeneration(req.dataIndex, req.feature, { userNotes: "" });
    });
  }
  if (draftNotesGenerate) {
    draftNotesGenerate.addEventListener("click", () => {
      const req = pendingDraftNotesRequest;
      const input = document.getElementById("draftNotesInput");
      const userNotes =
        input && input.value != null ? String(input.value).trim() : "";
      closeDraftNotesModal();
      if (!req) return;
      void runResumeGeneration(req.dataIndex, req.feature, { userNotes });
    });
  }

  const genThemeSel = document.getElementById("resumeGenerateVisualTheme");
  if (genThemeSel) {
    genThemeSel.addEventListener("change", async () => {
      const UC = getUserContent();
      const id = genThemeSel.value;
      const preview = document.getElementById("resumeGeneratePreview");
      if (preview) preview.setAttribute("data-visual-theme", id);
      if (!UC) return;
      try {
        await UC.openDb();
        await UC.savePreferences({ visualThemeId: id });
      } catch (e) {
        console.warn("[JobBored] save visual theme:", e);
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isOnboardingWizardVisible()) return;
    if (isAuthUserMenuOpen()) {
      closeAuthUserMenu();
      document.getElementById("authMenuToggle")?.focus();
      return;
    }
    if (linkedInCaptureModal && linkedInCaptureModal.style.display === "flex") {
      closeLinkedInCaptureModal();
      return;
    }
    const scraperModal = document.getElementById("scraperSetupModal");
    if (scraperModal && scraperModal.style.display === "flex") {
      closeScraperSetupModal();
      return;
    }
    const settingsModal = document.getElementById("settingsModal");
    if (settingsModal && settingsModal.style.display === "flex") {
      const clearBar = document.getElementById("settingsClearConfirmBar");
      if (clearBar && !clearBar.hidden) {
        hideSettingsClearConfirmBar();
        return;
      }
      closeCommandCenterSettingsModal();
      return;
    }
    if (draftNotesModal && draftNotesModal.style.display === "flex") {
      closeDraftNotesModal();
      return;
    }
    if (materialsModal && materialsModal.style.display === "flex") {
      closeMaterialsModal();
    }
    if (genModal && genModal.style.display === "flex") {
      closeResumeGenerateModal();
    }
  });

  initOnboardingWizard();
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
  // Check config
  SHEET_ID = getSheetId();
  initialSheetAccessResolved = false;
  postAccessBootstrapDone = false;
  initAuthUserMenu();

  if (!SHEET_ID) {
    // Login gate first; onboarding (blank sheet steps) appears after Google sign-in.
    document.getElementById("dashboard").style.display = "none";
    document.getElementById("setupScreen").style.display = "none";
    if (!getOAuthClientId()) {
      showSheetAccessGate("no-oauth");
    } else {
      showSheetAccessGate("loading");
    }
    initAuth();
    renderSetupStarterSheetUi();
    return;
  }

  // Hold the dashboard behind an access gate until the first read succeeds.
  document.getElementById("setupScreen").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  showSheetAccessGate("loading");

  // Dashboard wordmark vs custom title
  const cfg = getConfig();
  if (cfg) {
    const effectiveTitle = cfg.title;
    document.title = effectiveTitle + " — Job Search Dashboard";
    const logoEl = document.getElementById("logoHorizontal");
    const titleEl = document.getElementById("dashboardTitle");
    const defaultTitle = "JobBored";
    if (effectiveTitle === defaultTitle) {
      logoEl?.removeAttribute("hidden");
      titleEl?.setAttribute("hidden", "");
    } else {
      logoEl?.setAttribute("hidden", "");
      titleEl?.removeAttribute("hidden");
      if (titleEl) titleEl.textContent = effectiveTitle;
    }
  }

  // Set sheet links
  setDashboardSheetLinks();

  initDiscoveryPrefsModal();
  initDiscoveryButton();
  void preloadDiscoveryUiState();

  // Sort
  document.getElementById("sortSelect").addEventListener("change", (e) => {
    currentSort = e.target.value;
    renderPipeline();
  });

  // Search
  let searchTimeout;
  document.getElementById("searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentSearch = e.target.value.trim();
      renderPipeline();
    }, 200);
  });

  // Refresh
  document.getElementById("refreshBtn")?.addEventListener("click", () => {
    loadAllData();
  });

  document
    .getElementById("onboardingWizardBtn")
    ?.addEventListener("click", () => {
      closeAuthUserMenu();
      closeMaterialsModal();
      closeCommandCenterSettingsModal();
      hideOnboardingWizard();
      void openDiscoverySetupWizard({ entryPoint: "toolbar" });
    });

  // Init auth
  initAuth();

  initResumeMaterialsFeature();

  loadAllData();

  setInterval(loadAllData, REFRESH_INTERVAL);
}

function syncDiscoveryButtonState() {
  const openBtn = document.getElementById("discoveryBtn");
  if (!openBtn) return;
  const snapshot = getDiscoveryReadinessSnapshot();
  const view = getDiscoverySettingsView(snapshot);
  const status = getEffectiveDiscoveryEngineStatus(
    snapshot.savedWebhookUrl || getDiscoveryWebhookUrl(),
  );
  const localSetupDetected =
    snapshot.savedWebhookKind === "local_http" || !!snapshot.localWebhookUrl;
  const stubOnlyDetected =
    snapshot.engineState === DISCOVERY_ENGINE_STATE_STUB_ONLY ||
    snapshot.savedWebhookKind === "apps_script_stub";

  const needsRecovery =
    snapshot.localRecoveryState && snapshot.localRecoveryState !== "ok";

  if (needsRecovery) {
    openBtn.disabled = false;
    openBtn.removeAttribute("aria-disabled");
    openBtn.title = "Local discovery setup needs recovery — click to fix.";
  } else if (view.runDiscoveryEnabled) {
    openBtn.disabled = false;
    openBtn.removeAttribute("aria-disabled");
    openBtn.title =
      status.state === DISCOVERY_ENGINE_STATE_CONNECTED
        ? "Ask your automation to run another search pass"
        : "POST to your configured endpoint. Make sure it writes Pipeline rows.";
  } else if (stubOnlyDetected) {
    openBtn.disabled = true;
    openBtn.setAttribute("aria-disabled", "true");
    openBtn.title =
      "Stub webhook only — use Settings → Discovery to connect a real engine, or click Run discovery to open setup.";
  } else if (localSetupDetected) {
    openBtn.disabled = true;
    openBtn.setAttribute("aria-disabled", "true");
    openBtn.title =
      "Finish the local discovery path in Settings, or click here to continue setup.";
  } else {
    // No endpoint configured — keep button enabled so clicking opens the setup wizard.
    openBtn.disabled = false;
    openBtn.removeAttribute("aria-disabled");
    openBtn.title = view.primaryActionLabel
      ? `${view.primaryActionLabel} — click to open discovery setup.`
      : "Configure discovery in Settings, or click to open the setup wizard.";
  }
}

function openDiscoveryPrefsModal() {
  const modal = document.getElementById("discoveryPrefsModal");
  if (!modal) return;
  const UC = window.CommandCenterUserContent;
  const fieldMap = {
    targetRoles: "dpTargetRoles",
    locations: "dpLocations",
    remotePolicy: "dpRemotePolicy",
    seniority: "dpSeniority",
    keywordsInclude: "dpKeywordsInclude",
    keywordsExclude: "dpKeywordsExclude",
    maxLeadsPerRun: "dpMaxLeads",
  };
  const prefilled =
    UC && typeof UC.getDiscoveryProfile === "function"
      ? UC.getDiscoveryProfile()
      : Promise.resolve({});
  prefilled.then((p) => {
    Object.entries(fieldMap).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.value = (p && p[key]) || "";
    });
    // Handle grounded_web checkbox
    const gwEl = document.getElementById("dpGroundedWeb");
    if (gwEl) gwEl.checked = !p || p.groundedWebEnabled !== false;
    modal.style.display = "flex";
    const first = document.getElementById("dpTargetRoles");
    if (first) first.focus();
  });
}

function closeDiscoveryPrefsModal() {
  const modal = document.getElementById("discoveryPrefsModal");
  if (modal) modal.style.display = "none";
}

async function generateDiscoverySuggestions(scrapedJob) {
  const RG = window.CommandCenterResumeGenerate;
  if (!RG || typeof RG.getResumeGenerationConfig !== "function") {
    throw new Error("Resume generation module not loaded.");
  }
  const g = RG.getResumeGenerationConfig();
  const provider = g.provider || "gemini";

  const UC = getUserContent();
  if (!UC) throw new Error("User content store not available.");
  await UC.openDb();

  const profileExcerpt = await buildCandidateProfileExcerpt(UC, 12000);
  const discoveryProfile = UC.getDiscoveryProfile
    ? await UC.getDiscoveryProfile()
    : {};

  const jobContext = scrapedJob
    ? [
        "JOB LISTING (scraped):",
        `Title: ${scrapedJob.title || ""}`,
        `Company: ${scrapedJob.company || ""}`,
        `Location: ${scrapedJob.location || ""}`,
        `Description: ${String(scrapedJob.description || "").slice(0, 4000)}`,
        scrapedJob.requirements && scrapedJob.requirements.length
          ? `Requirements: ${scrapedJob.requirements.slice(0, 20).join("; ")}`
          : "",
        scrapedJob.skills && scrapedJob.skills.length
          ? `Skills: ${scrapedJob.skills.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const existingFilters = [
    discoveryProfile.targetRoles
      ? `Current target roles: ${discoveryProfile.targetRoles}`
      : "",
    discoveryProfile.locations
      ? `Current locations: ${discoveryProfile.locations}`
      : "",
    discoveryProfile.remotePolicy
      ? `Current remote policy: ${discoveryProfile.remotePolicy}`
      : "",
    discoveryProfile.seniority
      ? `Current seniority: ${discoveryProfile.seniority}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt =
    "You are an expert career advisor. Analyze the candidate's profile (resume, LinkedIn, AI context) " +
    "and optionally a scraped job listing, then suggest the best discovery search parameters. " +
    "Return ONLY valid JSON with these keys: " +
    "targetRoles (string, comma-separated role titles), " +
    "locations (string, comma-separated cities/regions), " +
    "remotePolicy (string, e.g. 'remote-first, hybrid'), " +
    "seniority (string, e.g. 'senior, staff'), " +
    "keywordsInclude (string, comma-separated positive keywords for search), " +
    "keywordsExclude (string, comma-separated negative keywords to filter out), " +
    "reasoning (string, 1-2 sentences explaining why these parameters fit the candidate). " +
    "Base suggestions on the candidate's actual experience, skills, and career trajectory. " +
    "If a job listing is provided, tune the suggestions to find similar roles.";

  const userParts = [
    "CANDIDATE PROFILE:",
    profileExcerpt || "(No resume or profile data available)",
    "",
  ];
  if (existingFilters) {
    userParts.push("EXISTING DISCOVERY FILTERS:", existingFilters, "");
  }
  if (jobContext) {
    userParts.push(jobContext, "");
  }
  userParts.push(
    "Suggest discovery search parameters that would find roles this candidate is well-suited for.",
    "Return JSON only.",
  );

  const userPrompt = userParts.join("\n");

  let text;
  if (provider === "gemini") {
    if (!g.resumeGeminiApiKey)
      throw new Error("Set a Gemini API key in Settings.");
    text = await callDiscoveryAiGemini(
      systemPrompt,
      userPrompt,
      g.resumeGeminiApiKey,
      g.resumeGeminiModel,
    );
  } else if (provider === "openai") {
    if (!g.resumeOpenAIApiKey)
      throw new Error("Set an OpenAI API key in Settings.");
    text = await callDiscoveryAiOpenAI(
      systemPrompt,
      userPrompt,
      g.resumeOpenAIApiKey,
      g.resumeOpenAIModel,
    );
  } else if (provider === "anthropic") {
    if (!g.resumeAnthropicApiKey)
      throw new Error("Set an Anthropic API key in Settings.");
    text = await callDiscoveryAiAnthropic(
      systemPrompt,
      userPrompt,
      g.resumeAnthropicApiKey,
      g.resumeAnthropicModel,
    );
  } else {
    throw new Error(
      "Switch to Gemini, OpenAI, or Anthropic in Settings for AI suggestions.",
    );
  }

  const parsed = parseJsonSafeForSuggestions(text);
  return {
    targetRoles: parsed.targetRoles || "",
    locations: parsed.locations || "",
    remotePolicy: parsed.remotePolicy || "",
    seniority: parsed.seniority || "",
    keywordsInclude: parsed.keywordsInclude || "",
    keywordsExclude: parsed.keywordsExclude || "",
    reasoning: parsed.reasoning || "",
  };
}

function parseJsonSafeForSuggestions(raw) {
  const s = String(raw || "").trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenceMatch ? fenceMatch[1].trim() : s;
  try {
    return JSON.parse(body);
  } catch (_) {
    const braceStart = body.indexOf("{");
    const braceEnd = body.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(body.slice(braceStart, braceEnd + 1));
      } catch (__) {}
    }
    return {};
  }
}

async function callDiscoveryAiGemini(system, user, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.0-flash")}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.5 },
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok)
    throw new Error(data.error?.message || `Gemini HTTP ${resp.status}`);
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
    "";
  if (!text.trim()) throw new Error("Empty response from Gemini");
  return text.trim();
}

async function callDiscoveryAiOpenAI(system, user, apiKey, model) {
  const m = model || "gpt-4o-mini";
  const limitKey = m.toLowerCase().startsWith("gpt-5")
    ? "max_completion_tokens"
    : "max_tokens";
  const body = {
    model: m,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    [limitKey]: 2048,
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok)
    throw new Error(data.error?.message || `OpenAI HTTP ${resp.status}`);
  const text = data.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new Error("Empty response from OpenAI");
  return text.trim();
}

async function callDiscoveryAiAnthropic(system, user, apiKey, model) {
  const body = {
    model: model || "claude-sonnet-4-6",
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: user }],
  };
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok)
    throw new Error(data.error?.message || `Anthropic HTTP ${resp.status}`);
  const text = Array.isArray(data.content)
    ? data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("")
    : "";
  if (!text.trim()) throw new Error("Empty response from Anthropic");
  return text.trim();
}

function initDiscoveryPrefsModal() {
  const modal = document.getElementById("discoveryPrefsModal");
  const runBtn = document.getElementById("discoveryPrefsRun");
  const cancelBtn = document.getElementById("discoveryPrefsCancel");
  const closeBtn = document.getElementById("discoveryPrefsClose");
  if (!modal) return;

  const closeModal = () => {
    modal.style.display = "none";
  };

  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.style.display === "flex") closeModal();
  });

  /* ---- Tab switching ---- */
  const tabManual = document.getElementById("dpTabManual");
  const tabAi = document.getElementById("dpTabAi");
  const panelManual = document.getElementById("dpPanelManual");
  const panelAi = document.getElementById("dpPanelAi");

  function switchTab(tab) {
    const isManual = tab === "manual";
    if (tabManual) {
      tabManual.classList.toggle("dp-tab--active", isManual);
      tabManual.setAttribute("aria-selected", String(isManual));
    }
    if (tabAi) {
      tabAi.classList.toggle("dp-tab--active", !isManual);
      tabAi.setAttribute("aria-selected", String(!isManual));
    }
    if (panelManual) {
      panelManual.classList.toggle("dp-panel--active", isManual);
      panelManual.hidden = !isManual;
    }
    if (panelAi) {
      panelAi.classList.toggle("dp-panel--active", !isManual);
      panelAi.hidden = isManual;
    }
    if (!isManual) checkAiAvailability();
  }

  if (tabManual) tabManual.addEventListener("click", () => switchTab("manual"));
  if (tabAi) tabAi.addEventListener("click", () => switchTab("ai"));

  /* ---- AI availability check ---- */
  function checkAiAvailability() {
    const hint = document.getElementById("dpAiHint");
    const suggestBtn = document.getElementById("dpSuggestBtn");
    const Insights = window.CommandCenterJobPostingInsights;
    const canUse =
      Insights && Insights.canEnrichWithLLM && Insights.canEnrichWithLLM();
    if (hint) hint.hidden = canUse;
    if (suggestBtn) suggestBtn.disabled = !canUse;
  }

  /* ---- Scrape job listing ---- */
  const scrapeBtn = document.getElementById("dpScrapeBtn");
  let scrapedJobData = null;

  if (scrapeBtn) {
    scrapeBtn.addEventListener("click", async () => {
      const urlInput = document.getElementById("dpJobUrl");
      const statusEl = document.getElementById("dpScrapeStatus");
      const url = urlInput ? urlInput.value.trim() : "";
      if (!url) {
        if (statusEl) {
          statusEl.textContent = "Paste a URL first.";
          statusEl.hidden = false;
        }
        return;
      }
      const base = getJobPostingScrapeUrl();
      if (!base) {
        if (statusEl) {
          statusEl.textContent =
            "No scraper configured. Set one in Settings or use localhost.";
          statusEl.hidden = false;
        }
        return;
      }
      scrapeBtn.disabled = true;
      scrapeBtn.textContent = "Scraping...";
      if (statusEl) {
        statusEl.textContent = "Fetching job listing...";
        statusEl.hidden = false;
      }
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30_000);
        const res = await fetch(`${base}/api/scrape-job`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        scrapedJobData = data;
        const title = data.title || "Untitled";
        const company = data.company || "";
        if (statusEl) {
          statusEl.textContent = `Scraped: ${title}${company ? " at " + company : ""}`;
          statusEl.hidden = false;
        }
      } catch (err) {
        scrapedJobData = null;
        if (statusEl) {
          statusEl.textContent = `Scrape failed: ${err.message || err}`;
          statusEl.hidden = false;
        }
      } finally {
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = "Scrape";
      }
    });
  }

  /* ---- AI Suggest ---- */
  const suggestBtn = document.getElementById("dpSuggestBtn");

  if (suggestBtn) {
    suggestBtn.addEventListener("click", async () => {
      suggestBtn.disabled = true;
      suggestBtn.textContent = "Analyzing...";
      const outputEl = document.getElementById("dpSuggestOutput");
      const reasoningEl = document.getElementById("dpSuggestReasoning");
      try {
        const result = await generateDiscoverySuggestions(scrapedJobData);
        const setField = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.value = val || "";
        };
        setField("dpSuggestedRoles", result.targetRoles);
        setField("dpSuggestedLocations", result.locations);
        setField("dpSuggestedRemote", result.remotePolicy);
        setField("dpSuggestedSeniority", result.seniority);
        setField("dpSuggestedInclude", result.keywordsInclude);
        setField("dpSuggestedExclude", result.keywordsExclude);
        if (reasoningEl) reasoningEl.textContent = result.reasoning || "";
        if (outputEl) outputEl.hidden = false;
      } catch (err) {
        showToast(`AI suggest failed: ${err.message || err}`, "error");
      } finally {
        suggestBtn.disabled = false;
        suggestBtn.textContent = "Generate suggestions";
      }
    });
  }

  /* ---- Apply suggestions to manual fields ---- */
  const applyBtn = document.getElementById("dpApplySuggestionsBtn");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      const copy = (srcId, destId) => {
        const src = document.getElementById(srcId);
        const dest = document.getElementById(destId);
        if (src && dest && src.value) dest.value = src.value;
      };
      copy("dpSuggestedRoles", "dpTargetRoles");
      copy("dpSuggestedLocations", "dpLocations");
      copy("dpSuggestedRemote", "dpRemotePolicy");
      copy("dpSuggestedSeniority", "dpSeniority");
      copy("dpSuggestedInclude", "dpKeywordsInclude");
      copy("dpSuggestedExclude", "dpKeywordsExclude");
      switchTab("manual");
      showToast("Suggestions applied to manual fields", "success");
    });
  }

  /* ---- Run now (saves from manual fields) ---- */
  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      const UC = window.CommandCenterUserContent;
      const val = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : "";
      };
      // Handle grounded_web checkbox
      const gwEl = document.getElementById("dpGroundedWeb");
      const groundedWebEnabled = gwEl ? gwEl.checked : true;
      if (UC && typeof UC.saveDiscoveryProfile === "function") {
        await UC.saveDiscoveryProfile({
          targetRoles: val("dpTargetRoles"),
          locations: val("dpLocations"),
          remotePolicy: val("dpRemotePolicy"),
          seniority: val("dpSeniority"),
          keywordsInclude: val("dpKeywordsInclude"),
          keywordsExclude: val("dpKeywordsExclude"),
          maxLeadsPerRun: val("dpMaxLeads"),
          groundedWebEnabled,
        });
      }
      closeModal();
      const openBtn = document.getElementById("discoveryBtn");
      if (openBtn) {
        openBtn.disabled = true;
        openBtn.classList.add("loading");
      }
      await triggerDiscoveryRun();
      if (openBtn) {
        openBtn.classList.remove("loading");
      }
      syncDiscoveryButtonState();
    });
  }
}

function initDiscoveryButton() {
  const modal = document.getElementById("discoveryHelpModal");
  const openBtn = document.getElementById("discoveryBtn");
  const closeBtn = document.getElementById("discoveryHelpClose");
  const openSettingsBtn = document.getElementById("discoveryHelpOpenSettings");
  if (!openBtn) return;

  function closeHelp(skipFocus) {
    if (modal) modal.style.display = "none";
    if (!skipFocus) openBtn.focus();
  }

  function openHelp() {
    if (modal) modal.style.display = "flex";
    const primary = document.getElementById("discoveryHelpOpenSettings");
    if (primary) primary.focus();
    else if (closeBtn) closeBtn.focus();
  }

  openBtn.addEventListener("click", async () => {
    if (
      !getDiscoverySettingsView(getDiscoveryReadinessSnapshot())
        .runDiscoveryEnabled
    ) {
      await openDiscoverySetupWizard({ entryPoint: "header" });
      return;
    }
    if (!getDiscoveryWebhookUrl()) {
      await openDiscoverySetupWizard({ entryPoint: "header" });
      return;
    }
    openDiscoveryPrefsModal();
  });

  if (closeBtn) closeBtn.addEventListener("click", () => closeHelp());
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", async () => {
      closeHelp(true);
      await openSettingsForDiscoveryWebhook();
    });
  }
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeHelp();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.style.display === "flex") closeHelp();
    });
  }

  syncDiscoveryButtonState();
}

document.addEventListener("DOMContentLoaded", () => {
  initCommandCenterSettings();
  initSetupAndSheetAccessActions();
  initScraperSetupGuide();
  initDiscoverySetupGuide();
  initPipelineEmptyAndBriefActions();
  init();
});
