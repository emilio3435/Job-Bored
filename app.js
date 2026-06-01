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

// --- Config overrides (extracted to config-overrides.js) ---
const COMMAND_CENTER_CONFIG_OVERRIDE_KEY =
  window.JobBoredApp.configOverrides.COMMAND_CENTER_CONFIG_OVERRIDE_KEY;
const DISCOVERY_TRANSPORT_SETUP_KEY =
  window.JobBoredApp.configOverrides.DISCOVERY_TRANSPORT_SETUP_KEY;
const DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH =
  window.JobBoredApp.configOverrides.DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH;
// --- Discovery run tracker (extracted to discovery-run-tracker.js) ---
const DISCOVERY_RUN_TRACKER_KEY =
  window.JobBoredDiscovery.runTracker.DISCOVERY_RUN_TRACKER_KEY;
const discoveryRunTracker =
  window.JobBoredDiscovery.runTracker.discoveryRunTracker;
function dispatchDiscoveryRunTrackerEvent(state) {
  return window.JobBoredDiscovery.runTracker.dispatchDiscoveryRunTrackerEvent(
    state,
  );
}
// --- Apps Script / relay helpers (extracted to apps-script-relay-helpers.js) ---
const relayHelpers = window.JobBoredDiscovery.relayHelpers;
function getAppsScriptEditorUrl(...args) {
  return relayHelpers.getAppsScriptEditorUrl(...args);
}
function formatAppsScriptWebAppAccessLabel(...args) {
  return relayHelpers.formatAppsScriptWebAppAccessLabel(...args);
}
function formatAppsScriptExecuteAsLabel(...args) {
  return relayHelpers.formatAppsScriptExecuteAsLabel(...args);
}
function buildAppsScriptPublicAccessRemediationStatus(...args) {
  return relayHelpers.buildAppsScriptPublicAccessRemediationStatus(...args);
}
function isLikelyAppsScriptWebAppUrl(...args) {
  return relayHelpers.isLikelyAppsScriptWebAppUrl(...args);
}
function isLikelyCloudflareWorkerUrl(...args) {
  return relayHelpers.isLikelyCloudflareWorkerUrl(...args);
}
function buildCloudflareRelayCorsSnippet(...args) {
  return relayHelpers.buildCloudflareRelayCorsSnippet(...args);
}
function sanitizeCloudflareWorkerName(...args) {
  return relayHelpers.sanitizeCloudflareWorkerName(...args);
}
function inferCloudflareRelaySuffixFromTarget(...args) {
  return relayHelpers.inferCloudflareRelaySuffixFromTarget(...args);
}
function getSuggestedCloudflareRelayWorkerName(...args) {
  return relayHelpers.getSuggestedCloudflareRelayWorkerName(...args);
}
function inferCloudflareWorkerNameFromOpenWorkerUrl(...args) {
  return relayHelpers.inferCloudflareWorkerNameFromOpenWorkerUrl(...args);
}
function quoteShellArg(...args) {
  return relayHelpers.quoteShellArg(...args);
}
function buildCloudflareRelayDeployCommand(...args) {
  return relayHelpers.buildCloudflareRelayDeployCommand(...args);
}
function getDiscoveryRelaySuggestedOrigin(...args) {
  return relayHelpers.getDiscoveryRelaySuggestedOrigin(...args);
}
function getDiscoveryRelayWorkerName(...args) {
  return relayHelpers.getDiscoveryRelayWorkerName(...args);
}
function buildDiscoveryRelayDeployCommandForTarget(...args) {
  return relayHelpers.buildDiscoveryRelayDeployCommandForTarget(...args);
}
function createDiscoveryRelayCopyCommandToastAction(...args) {
  return relayHelpers.createDiscoveryRelayCopyCommandToastAction(...args);
}
function buildCloudflareRelayAgentPrompt(...args) {
  return relayHelpers.buildCloudflareRelayAgentPrompt(...args);
}
function describeCloudflareAccessProtectedWebhook(...args) {
  return relayHelpers.describeCloudflareAccessProtectedWebhook(...args);
}
function describeAppsScriptHtmlAccessIssue(...args) {
  return relayHelpers.describeAppsScriptHtmlAccessIssue(...args);
}
function isAppsScriptWebhookStubResponse(...args) {
  return relayHelpers.isAppsScriptWebhookStubResponse(...args);
}
function isAsyncDiscoveryAcceptedResponse(...args) {
  return relayHelpers.isAsyncDiscoveryAcceptedResponse(...args);
}
function buildDiscoverySuccessToast(...args) {
  return relayHelpers.buildDiscoverySuccessToast(...args);
}
// Set by performSettingsClearOverrides before reload so the next interactive
// sign-in forces Google's consent screen instead of silently re-issuing a
// token from the prior consent grant. One-shot: cleared after the next signIn.
const FORCE_CONSENT_PROMPT_KEY = "command_center_force_consent_prompt";

const COMMAND_CENTER_OVERRIDE_KEYS =
  window.JobBoredApp.configOverrides.COMMAND_CENTER_OVERRIDE_KEYS;

function readStoredConfigOverrides() {
  // localStorage.getItem(COMMAND_CENTER_CONFIG_OVERRIDE_KEY)
  return window.JobBoredApp.configOverrides.readStoredConfigOverrides();
}

function applyConfigOverridesToWindowConfig(overrides) {
  return window.JobBoredApp.configOverrides.applyConfigOverridesToWindowConfig(
    overrides,
  );
}

function writeStoredConfigOverrides(overrides) {
  return window.JobBoredApp.configOverrides.writeStoredConfigOverrides(
    overrides,
  );
}

function mergeStoredConfigOverridePatch(patch) {
  return window.JobBoredApp.configOverrides.mergeStoredConfigOverridePatch(
    patch,
  );
}

/** Merge values saved in this browser (localStorage) onto config from config.js. */
function applyStoredConfigOverrides() {
  return window.JobBoredApp.configOverrides.applyStoredConfigOverrides();
}

function readDiscoveryTransportSetupState() {
  return window.JobBoredApp.configOverrides.readDiscoveryTransportSetupState();
}

function normalizeDiscoveryLocalWebhookUrl(raw) {
  return window.JobBoredApp.configOverrides.normalizeDiscoveryLocalWebhookUrl(
    raw,
  );
}

function normalizeDiscoveryTunnelPublicUrl(raw) {
  return window.JobBoredApp.configOverrides.normalizeDiscoveryTunnelPublicUrl(
    raw,
  );
}

function getDiscoveryTransportSetupState() {
  return window.JobBoredApp.configOverrides.getDiscoveryTransportSetupState();
}

function writeDiscoveryTransportSetupState(patch) {
  return window.JobBoredApp.configOverrides.writeDiscoveryTransportSetupState(
    patch,
  );
}

function isLocalDashboardOrigin() {
  return window.JobBoredApp.configOverrides.isLocalDashboardOrigin();
}

function getBootstrapDiscoveryWebhookSecret(data) {
  return window.JobBoredApp.configOverrides.getBootstrapDiscoveryWebhookSecret(
    data,
  );
}

function isLikelyNgrokWebhookUrl(raw) {
  return window.JobBoredApp.configOverrides.isLikelyNgrokWebhookUrl(raw);
}

function discoveryUrlOrigin(raw) {
  return window.JobBoredApp.configOverrides.discoveryUrlOrigin(raw);
}

function sameDiscoveryUrlOrigin(a, b) {
  return window.JobBoredApp.configOverrides.sameDiscoveryUrlOrigin(a, b);
}

function isBootstrapManagedDiscoveryEndpoint(data, endpointUrl) {
  return window.JobBoredApp.configOverrides.isBootstrapManagedDiscoveryEndpoint(
    data,
    endpointUrl,
  );
}

function writeDiscoveryWebhookSecretOverride(secret) {
  return window.JobBoredApp.configOverrides.writeDiscoveryWebhookSecretOverride(
    secret,
  );
}

function autofillDiscoveryWebhookSecretFromBootstrap(data, options = {}) {
  return window.JobBoredApp.configOverrides.autofillDiscoveryWebhookSecretFromBootstrap(
    data,
    options,
  );
}

async function refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(
  endpointUrl,
) {
  return window.JobBoredApp.configOverrides.refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(
    endpointUrl,
  );
}

// ====== [discovery-autodetect lane: relay URL auto-fill] ======
function autofillDiscoveryWebhookUrlFromBootstrap(data) {
  // Reads data.relay.workerUrl; checks getDiscoveryWebhookUrl(); if (existing) return false; /^https?:\/\//i
  return window.JobBoredApp.configOverrides.autofillDiscoveryWebhookUrlFromBootstrap(
    data,
  );
}
// ====== [/discovery-autodetect lane] ======

async function hydrateDiscoveryTransportSetupFromLocalBootstrap() {
  // autofillDiscoveryWebhookSecretFromBootstrap(data); autofillDiscoveryWebhookUrlFromBootstrap(data)
  return window.JobBoredApp.configOverrides.hydrateDiscoveryTransportSetupFromLocalBootstrap();
}

// ============================================
// CONFIG VALIDATION
// ============================================

function isPlausibleGoogleSheetId(...args) {
  return window.JobBoredApp.configCore.isPlausibleGoogleSheetId(...args);
}

function parseGoogleSheetId(...args) {
  return window.JobBoredApp.configCore.parseGoogleSheetId(...args);
}

/** Default dashboard label; legacy templates used "Command Center". */
function normalizeDashboardTitle(...args) {
  return window.JobBoredApp.configCore.normalizeDashboardTitle(...args);
}

function getConfig() {
  return window.JobBoredApp.configCore.getConfig();
}

function getSheetId(...args) {
  return window.JobBoredApp.configCore.getSheetId(...args);
}

// Live read of the resolved SHEET_ID module var (distinct from getSheetId,
// which derives from URL/config). Exposed via the UI host bridge so wizard
// orchestration that moved to discovery-wizard-ui.js can read the current value.
function getActiveSheetId(...args) {
  return window.JobBoredApp.configCore.getActiveSheetId(...args);
}

function getOAuthClientId(...args) {
  return window.JobBoredApp.configCore.getOAuthClientId(...args);
}

/** Optional POST target for &ldquo;Run discovery&rdquo; (browser-use worker / Hermes / n8n / Apps Script). */
function getDiscoveryWebhookUrl(...args) {
  return window.JobBoredApp.configCore.getDiscoveryWebhookUrl(...args);
}

/**
 * Optional shared secret for the discovery webhook. When set, the dashboard
 * forwards it as the `x-discovery-secret` header so receivers that fail-closed
 * on empty secrets (e.g. the browser-use worker) accept the request.
 */
function getDiscoveryWebhookSecret(...args) {
  return window.JobBoredApp.configCore.getDiscoveryWebhookSecret(...args);
}

// --- App config core (extracted to app-config-core.js) ---
const configCore = window.JobBoredApp.configCore;
const APPS_SCRIPT_API_BASE = configCore.APPS_SCRIPT_API_BASE;
const GOOGLE_SHEETS_SCOPE = configCore.GOOGLE_SHEETS_SCOPE;
const GOOGLE_USERINFO_EMAIL_SCOPE = configCore.GOOGLE_USERINFO_EMAIL_SCOPE;
const GOOGLE_USERINFO_PROFILE_SCOPE = configCore.GOOGLE_USERINFO_PROFILE_SCOPE;
const GOOGLE_SIGNIN_SCOPES = configCore.GOOGLE_SIGNIN_SCOPES;
const APPS_SCRIPT_DEPLOY_SCOPES = configCore.APPS_SCRIPT_DEPLOY_SCOPES;
const APPS_SCRIPT_MANAGED_BY = configCore.APPS_SCRIPT_MANAGED_BY;
const APPS_SCRIPT_PROJECT_TITLE = configCore.APPS_SCRIPT_PROJECT_TITLE;
const APPS_SCRIPT_WEBAPP_ACCESS = configCore.APPS_SCRIPT_WEBAPP_ACCESS;
const APPS_SCRIPT_WEBAPP_EXECUTE_AS = configCore.APPS_SCRIPT_WEBAPP_EXECUTE_AS;
const APPS_SCRIPT_PUBLIC_ACCESS_READY = configCore.APPS_SCRIPT_PUBLIC_ACCESS_READY;
const APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION =
  configCore.APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION;
const DISCOVERY_ENGINE_STATE_NONE = configCore.DISCOVERY_ENGINE_STATE_NONE;
const DISCOVERY_ENGINE_STATE_STUB_ONLY =
  configCore.DISCOVERY_ENGINE_STATE_STUB_ONLY;
const DISCOVERY_ENGINE_STATE_UNVERIFIED =
  configCore.DISCOVERY_ENGINE_STATE_UNVERIFIED;
const DISCOVERY_ENGINE_STATE_CONNECTED = configCore.DISCOVERY_ENGINE_STATE_CONNECTED;
const GIS_INIT_STUCK_MS = configCore.GIS_INIT_STUCK_MS;
const STARTER_PIPELINE_HEADERS = configCore.STARTER_PIPELINE_HEADERS;
const STARTER_PIPELINE_HEADER_RANGE = configCore.STARTER_PIPELINE_HEADER_RANGE;

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
    !configCore.appsScriptDeployStateCache ||
    typeof configCore.appsScriptDeployStateCache.webAppUrl !== "string"
  ) {
    return "";
  }
  return normalizeDiscoveryWebhookIdentity(
    configCore.appsScriptDeployStateCache.webAppUrl,
  );
}

function getSavedDiscoveryEngineStateForUrl(rawUrl) {
  const target = normalizeDiscoveryWebhookIdentity(rawUrl);
  if (!target) return null;
  const saved =
    configCore.discoveryEngineStateCache &&
    typeof configCore.discoveryEngineStateCache === "object" &&
    typeof configCore.discoveryEngineStateCache.state === "string"
      ? configCore.discoveryEngineStateCache
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
  if (configCore.discoveryWizardRuntime) {
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
    configCore.discoveryEngineStateCache = next;
    refreshDiscoveryUiState();
    void refreshDiscoveryReadinessSnapshot({ force: true });
    return next;
  }
  try {
    configCore.discoveryEngineStateCache = await store.saveDiscoveryEngineState(next);
  } catch (err) {
    console.warn("[JobBored] discovery engine state:", err);
    configCore.discoveryEngineStateCache = next;
  }
  refreshDiscoveryUiState();
  void refreshDiscoveryReadinessSnapshot({ force: true });
  return configCore.discoveryEngineStateCache;
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
      configCore.appsScriptDeployStateCache =
        await stores.appsScript.getAppsScriptDeployState();
    } catch (err) {
      console.warn("[JobBored] Apps Script deploy state preload:", err);
    }
  }
  if (stores.discovery) {
    try {
      configCore.discoveryEngineStateCache =
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

function openAppsScriptRemediationFlowInSettings() {
  const details = document.getElementById("settingsAppsScriptDetails");
  if (details) details.open = true;
  const statusCard = document.getElementById("settingsAppsScriptStatus");
  if (statusCard && typeof statusCard.scrollIntoView === "function") {
    statusCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function showAppsScriptPublicAccessRemediationFromState() {
  const state = configCore.appsScriptDeployStateCache;
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
    isAppsScriptPublicAccessReady(configCore.appsScriptDeployStateCache) &&
    configCore.appsScriptDeployStateCache &&
    typeof configCore.appsScriptDeployStateCache.webAppUrl === "string"
      ? configCore.appsScriptDeployStateCache.webAppUrl.trim()
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
  if (!configCore.appsScriptDeployStateCache) return "none";
  if (
    isManagedAppsScriptDeployState(configCore.appsScriptDeployStateCache) &&
    isAppsScriptPublicAccessReady(configCore.appsScriptDeployStateCache)
  ) {
    return "stub_only";
  }
  return isManagedAppsScriptDeployState(configCore.appsScriptDeployStateCache)
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

function getDiscoveryRecoveryCopy(snapshot) {
  const probesApi =
    window.JobBoredDiscoveryWizard && window.JobBoredDiscoveryWizard.probes;
  if (probesApi && typeof probesApi.buildRecoveryCopy === "function") {
    return probesApi.buildRecoveryCopy(snapshot);
  }
  const recovery = String((snapshot && snapshot.localRecoveryState) || "ok");
  const detailMap = {
    needs_full_restart:
      "Your computer restarted, so the local worker and tunnel need to be brought back up.",
    worker_down:
      "The local discovery worker is not responding. It may need to be restarted.",
    tunnel_down:
      "The public ngrok tunnel is not running, so the saved Worker URL cannot reach your local worker right now.",
    tunnel_rotated:
      "ngrok gave your local setup a new public URL, so the relay behind your saved Worker URL needs to be redeployed.",
  };
  const detail =
    detailMap[recovery] ||
    "Part of the local discovery chain is down after a restart.";
  return {
    title:
      recovery === "tunnel_rotated"
        ? "Public tunnel changed"
        : "Local setup needs recovery",
    detail,
    compactDetail: detail,
    actionHint:
      "Click Fix setup to restart what is down and redeploy the relay if needed.",
    detectBody: [detail],
  };
}

function buildFallbackSettingsDiscoveryView(snapshot) {
  const status = getEffectiveDiscoveryEngineStatus(snapshot.savedWebhookUrl);
  const kind = String(snapshot.savedWebhookKind || "none");
  const appsScriptState = String(snapshot.appsScriptState || "none");
  const recovery = snapshot.localRecoveryState || "ok";
  const recoveryCopy = getDiscoveryRecoveryCopy(snapshot);
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
      title: recoveryCopy.title,
      detail: recoveryCopy.compactDetail,
      chipLabel: "Needs recovery",
      chipTone: "warning",
      runDiscoveryEnabled: false,
      primaryActionLabel: "Fix setup",
      primaryActionHint: recoveryCopy.actionHint,
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
  const recoveryCopy = getDiscoveryRecoveryCopy(snapshot);
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
      title: recoveryCopy.title,
      body: `${recoveryCopy.compactDetail} Use Fix setup to recover it.`,
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
      !(hasSavedExternalEndpoint && !isLocalDashboardOrigin()) &&
      (hasLocalPathSignals ||
        (savedWebhookKind === "worker" && isLocalDashboardOrigin()))
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
  return configCore.discoveryReadinessSnapshotCache || buildFallbackReadinessSnapshot();
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
  if (configCore.discoveryReadinessSnapshotPromise && !options.force) {
    return configCore.discoveryReadinessSnapshotPromise;
  }
  const buildFallback = () => buildFallbackReadinessSnapshot();
  const probes = getDiscoveryWizardProbesApi();
  configCore.discoveryReadinessSnapshotPromise = Promise.resolve()
    .then(async () => {
      if (probes && typeof probes.buildReadinessSnapshot === "function") {
        return probes.buildReadinessSnapshot();
      }
      return buildFallback();
    })
    .then((snapshot) => {
      configCore.discoveryReadinessSnapshotCache =
        snapshot && typeof snapshot === "object" ? snapshot : buildFallback();
      return configCore.discoveryReadinessSnapshotCache;
    })
    .catch((err) => {
      console.warn("[JobBored] discovery readiness snapshot:", err);
      configCore.discoveryReadinessSnapshotCache = buildFallback();
      return configCore.discoveryReadinessSnapshotCache;
    })
    .finally(() => {
      configCore.discoveryReadinessSnapshotPromise = null;
    });
  const next = await configCore.discoveryReadinessSnapshotPromise;
  if (options.rerender !== false) {
    refreshDiscoveryUiState();
  }
  return next;
}

function readDiscoveryScheduleStateForPayload(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return {
      enabled: parsed.enabled === true,
      hour: Number.isInteger(parsed.hour) ? parsed.hour : undefined,
      minute: Number.isInteger(parsed.minute) ? parsed.minute : undefined,
    };
  } catch (_) {
    return {};
  }
}

function readDiscoveryScheduleContextForPayload() {
  return {
    local: readDiscoveryScheduleStateForPayload("settings_profile_schedule_local"),
    github: readDiscoveryScheduleStateForPayload("settings_profile_schedule_cloud"),
  };
}

async function buildDiscoveryWebhookPayload(sheetIdOverride, options) {
  const payloadOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  const trigger = String(payloadOptions.trigger || "manual").trim() || "manual";
  const resolvedSheetId =
    parseGoogleSheetId(String(sheetIdOverride || "")) || SHEET_ID || "";
  let discoveryProfile = {};
  let activeResume = null;
  let preferences = null;
  try {
    const UC = window.CommandCenterUserContent;
    if (UC && typeof UC.openDb === "function") {
      await UC.openDb();
    }
    if (UC) {
      if (typeof UC.getDiscoveryProfile === "function") {
        discoveryProfile = await UC.getDiscoveryProfile();
      }
      if (typeof UC.getActiveResume === "function") {
        activeResume = await UC.getActiveResume();
      }
      if (typeof UC.getPreferences === "function") {
        preferences = await UC.getPreferences();
      }
    }
  } catch (e) {
    console.warn("[JobBored] discovery profile:", e);
  }
  // Hand the user's existing GIS access token to the worker so it can write
  // to Google Sheets without holding any persistent credential of its own.
  // This is the "no hoops" path: if the user is signed in to the dashboard,
  // discovery just works — no service account, no .env wiring, no Hermes
  // archaeology. The worker treats this token as the highest-precedence
  // credential and falls back to its env config if it's absent or stale.
  // We declare the key unconditionally so JSON.stringify drops it when
  // empty (keeps the contract scanner happy and the wire format unchanged).
  const dashboardGoogleAccessToken =
    await getFreshDiscoveryRequestGoogleAccessToken();
  const requestedAt = new Date().toISOString();

  // ====== [discovery-autodetect lane: contract sanitization] ======
  // Per the discovery webhook contract, sourcePreset must either be omitted or
  // be one of the enum values. Fresh greenfield profiles can contain
  // sourcePreset:""; strip that key before the payload reaches the worker.
  if (
    discoveryProfile &&
    typeof discoveryProfile === "object" &&
    Object.prototype.hasOwnProperty.call(discoveryProfile, "sourcePreset")
  ) {
    const sp = discoveryProfile.sourcePreset;
    const trimmed = typeof sp === "string" ? sp.trim() : sp;
    if (trimmed === "" || trimmed == null || typeof trimmed !== "string") {
      const sanitized = { ...discoveryProfile };
      delete sanitized.sourcePreset;
      discoveryProfile = sanitized;
    } else if (trimmed !== sp) {
      discoveryProfile = { ...discoveryProfile, sourcePreset: trimmed };
    }
  }
  // ====== [/discovery-autodetect lane] ======

  // Compose `mergedUserProfile` — the run-time view of the master Fit Profile
  // with per-run drawer overrides applied. Tasks #3 and #6 consume this field;
  // the legacy `discoveryProfile` keeps working in parallel.
  const mergedUserProfile = buildMergedUserProfileForPayload();

  const sharedBuilder = window.JobBoredDiscoveryPayload;
  if (
    sharedBuilder &&
    typeof sharedBuilder.buildDiscoveryWebhookPayload === "function"
  ) {
    const built = sharedBuilder.buildDiscoveryWebhookPayload({
      sheetId: resolvedSheetId,
      discoveryProfile,
      resume: activeResume,
      preferences,
      schedule: readDiscoveryScheduleContextForPayload(),
      requestedAt,
      variationKey: payloadOptions.variationKey || generateDiscoveryVariationKey(),
      trigger,
      googleAccessToken: dashboardGoogleAccessToken || "",
    });
    if (built && typeof built === "object") {
      built.mergedUserProfile = mergedUserProfile;
    }
    return built;
  }

  return {
    event: "command-center.discovery",
    schemaVersion: 1,
    sheetId: resolvedSheetId,
    variationKey: payloadOptions.variationKey || generateDiscoveryVariationKey(),
    requestedAt,
    trigger,
    discoveryProfile,
    mergedUserProfile,
    googleAccessToken: dashboardGoogleAccessToken || undefined,
  };
}

/**
 * Deep-clone the loaded master Fit Profile and apply per-run drawer overrides.
 * Returns null when no master profile is loaded — Task #3/#6 consumers should
 * fall back to `discoveryProfile` in that case.
 */
function buildMergedUserProfileForPayload() {
  const baseProfile = discoveryRunProfileState.baseProfile;
  if (!baseProfile) return null;
  const merged = JSON.parse(JSON.stringify(baseProfile));
  const eff = getEffectiveFitProfileFields();
  if (!eff) return merged;
  merged.identity = merged.identity || {};
  merged.hardConstraints = merged.hardConstraints || {};
  if (eff.targetRoles) merged.identity.targetRoles = eff.targetRoles;
  if (eff.targetSeniority)
    merged.identity.targetSeniority = eff.targetSeniority;
  if (eff.workMode) merged.hardConstraints.workMode = eff.workMode;
  if (eff.acceptableLocations)
    merged.hardConstraints.acceptableLocations = eff.acceptableLocations;
  if (eff.wants) merged.wants = eff.wants;
  if (eff.avoids) merged.avoids = eff.avoids;
  return merged;
}

/**
 * Returns the dashboard's current Google access token IFF the user is signed
 * in AND the token has at least 60 seconds of lifetime left. Anything less
 * isn't worth sending — discovery runs typically take 20–60s and a token that
 * expires mid-run will fail at the Sheets write step.
 */
function getDiscoveryRequestGoogleAccessToken() {
  if (!getAccessToken() || typeof getAccessToken() !== "string") return "";
  const trimmed = getAccessToken().trim();
  if (!trimmed) return "";
  if (Number.isFinite(getTokenExpiresAt())) {
    const remainingMs = Number(getTokenExpiresAt()) - Date.now();
    if (remainingMs < 60_000) return "";
  }
  return trimmed;
}

async function getFreshDiscoveryRequestGoogleAccessToken(options = {}) {
  if (options && options.force === true) {
    const refreshed = await refreshAccessTokenSilently().catch(() => false);
    return refreshed ? getDiscoveryRequestGoogleAccessToken() : "";
  }
  const current = getDiscoveryRequestGoogleAccessToken();
  if (current) return current;
  if (!getAccessToken() || !Number.isFinite(getTokenExpiresAt())) return "";
  const remainingMs = Number(getTokenExpiresAt()) - Date.now();
  if (remainingMs >= 60_000) return "";
  const refreshed = await refreshAccessTokenSilently().catch(() => false);
  return refreshed ? getDiscoveryRequestGoogleAccessToken() : "";
}

function isIngestSheetAuthFailure(data) {
  if (!data || typeof data !== "object" || data.ok !== false) return false;
  const text = [
    data.reason,
    data.message,
    data.detail,
    data.error,
  ]
    .map((value) => String(value || ""))
    .join(" ");
  return /UNAUTHENTICATED|invalid authentication credentials|Expected OAuth 2 access token|Google session expired/i.test(
    text,
  );
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
  if (!result.ok && result.kind === "auth_required") {
    // The browser-use worker fail-closed because the secret is missing or
    // wrong. The fix is "run bootstrap and reload" — give the user a copy
    // button for the command so they don't have to retype it.
    action = {
      label: "Copy bootstrap command",
      onClick: () => {
        copyTextToClipboard(
          result.suggestedCommand || "npm run discovery:bootstrap-local",
        );
      },
    };
  } else if (!result.ok && isLocalDashboardOrigin()) {
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
          void requestDiscoverySetup({
            entryPoint: "settings",
            flow: "local_agent",
            startStep: "tunnel",
            allowWhileOnboarding: true,
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
  const initialSecret =
    typeof options.secret === "string" && options.secret.trim()
      ? options.secret.trim()
      : getDiscoveryWebhookSecret();
  if (verifyApi && typeof verifyApi.verifyDiscoveryEndpoint === "function") {
    const runVerification = (secret) =>
      verifyApi.verifyDiscoveryEndpoint(url, {
        payload,
        context: options.context || "test_webhook",
        sheetId: options.sheetId || "",
        timeoutMs: options.timeoutMs || 15000,
        secret,
      });

    const result = await runVerification(initialSecret);
    if (!result || result.ok || result.kind !== "auth_required") {
      return result;
    }

    const refreshedSecret =
      await refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(url);
    if (!refreshedSecret || refreshedSecret === initialSecret) {
      return result;
    }

    return runVerification(refreshedSecret);
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
  if (!configCore.discoveryWizardRuntime) {
    configCore.discoveryWizardRuntime = createDiscoveryWizardRuntime();
  }
  return configCore.discoveryWizardRuntime;
}

function updateDiscoveryWizardRuntime(patch = {}) {
  const current = getDiscoveryWizardRuntime();
  configCore.discoveryWizardRuntime = createDiscoveryWizardRuntime({
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
  return configCore.discoveryWizardRuntime;
}

function clearDiscoveryWizardRuntime() {
  configCore.discoveryWizardRuntime = null;
}

function setDiscoveryWizardRuntime(runtime) {
  configCore.discoveryWizardRuntime = runtime;
  return configCore.discoveryWizardRuntime;
}

/**
 * Resolve the user's local repo root from bootstrap state. Returns "" if
 * unknown — callers should fall back gracefully (e.g. omit the cd prefix).
 */
/**
 * Build a "cd <repo> && <cmd>" combined command so the user can paste it into
 * any Terminal window — no need to navigate to the repo first. Quotes the
 * path to handle spaces. Returns the bare command if repoRoot is unknown.
 */
/**
 * Trigger a download of a macOS .command script that opens Terminal in the
 * repo and runs the given command. macOS-only delight: double-click and go.
 * On other OSes the file just won't open (Terminal-specific extension).
 */
/**
 * Append a "run-in-terminal" block: combined cd+command with a Copy button
 * AND (on capable browsers) a "Download .command" delight button that opens
 * Terminal in the repo and runs the command on double-click. Includes an
 * inline instruction so users know what to do — addresses the "copy buttons
 * with no context" feedback.
 */
/**
 * Heuristic: classify a suggested URL so we can render a context-rich action
 * instead of a bare "Copy URL". We look at the result.kind first (set by the
 * worker code paths that create these results), then fall back to URL shape.
 */
/**
 * Render a recovery cluster after a failed step action: Try again + Copy AI
 * prompt + Skip. Only appended when the latest result for this step failed.
 * Skip writes the wizard state to "skipped" for the step and advances.
 */
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

function getDiscoveryWizardStepsBefore(flow, targetStep) {
  const ids = getDiscoveryWizardStepIds(flow);
  const idx = ids.indexOf(targetStep);
  return idx > 0 ? ids.slice(0, idx) : [];
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
    const onLocalhost =
      typeof window !== "undefined" &&
      window.location &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "[::1]" ||
        window.location.hostname === "::1");
    diagnosis.primaryFix = {
      id: "diag_fix_update_tunnel_and_relay",
      label: onLocalhost
        ? "Auto-fix: redeploy relay & re-test"
        : "Update tunnel & save ngrok, then redeploy",
      detail: onLocalhost
        ? "One click. Calls the local helper to redeploy the relay against the live ngrok URL, then re-runs the test."
        : "Click to save the Live ngrok URL, then run the deploy command shown below from your Job-Bored repo (same Worker name = update in place).",
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
  configCore.appsScriptDeployStatus = {
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
  configCore.appsScriptDeployStatus = null;
  renderAppsScriptDeployUi();
}

const PENDING_DISCOVERY_SETUP_KEY = "pendingDiscoverySetup";

function hasPendingDiscoverySetup() {
  try {
    return sessionStorage.getItem(PENDING_DISCOVERY_SETUP_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function queuePendingDiscoverySetup() {
  try {
    sessionStorage.setItem(PENDING_DISCOVERY_SETUP_KEY, "1");
    return true;
  } catch (_) {
    return false;
  }
}

async function resumePendingDiscoverySetupIfNeeded() {
  if (!hasPendingDiscoverySetup()) return false;
  try {
    sessionStorage.removeItem(PENDING_DISCOVERY_SETUP_KEY);
  } catch (_) {
    /* ignore */
  }
  await openSettingsForDiscoveryWebhook();
  return true;
}

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
  return requestDiscoverySetup({
    entryPoint: "settings",
    flow: getDiscoveryWizardRecommendedFlow(getDiscoveryReadinessSnapshot()),
    allowWhileOnboarding: true,
  });
}

async function requestDiscoverySetup(options = {}) {
  const {
    stripSetupParam = false,
    allowWhileOnboarding = false,
    ...wizardOptions
  } = options;
  if (isOnboardingWizardVisible() && !allowWhileOnboarding) {
    queuePendingDiscoverySetup();
    if (stripSetupParam) {
      stripSetupDiscoveryParam();
    }
    return { deferred: true };
  }
  await openDiscoverySetupWizard(wizardOptions);
  if (stripSetupParam) {
    stripSetupDiscoveryParam();
  }
  return { deferred: false };
}

// ============================================
// DISCOVERY RUN STATUS POLLING
// ============================================

const MAX_POLL_ERRORS = 3;
const STATUS_POLL_DEBOUNCE_MS = 500;

/**
 * Build the full status URL from a relative statusPath.
 * Handles explicit statusPath or constructs from runId + base webhook URL.
 * @param {string} statusPath  e.g. "/runs/run_abc" or "/runs/run_abc?worker=local"
 * @param {string} webhookUrl  the configured discovery webhook base URL
 * @returns {string}  fully qualified status fetch URL
 */
function buildRunStatusUrl(statusPath, webhookUrl) {
  const path = String(statusPath || "").trim();
  if (!path) return "";
  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    const base = new URL(String(webhookUrl || ""));
    if (path.startsWith("/")) {
      return new URL(path, base.origin).toString();
    }
    const baseDir = base.href.endsWith("/")
      ? base.href
      : base.href.replace(/\/[^/]*$/, "/");
    return new URL(path, baseDir).toString();
  } catch (_) {
    return "";
  }
}

function canSynthesizeRunStatusPath(webhookUrl) {
  const normalized = normalizeDiscoveryWebhookIdentity(webhookUrl);
  if (!normalized) return false;
  return isLocalWebhookCandidateUrl(normalized);
}

function resolveAcceptedRunStatusPath(result, webhookUrl) {
  const explicit = String(
    (result && (result.statusPath || result.status_path)) || "",
  ).trim();
  if (explicit) return explicit;
  const runId = String((result && result.runId) || "").trim();
  if (!runId || !canSynthesizeRunStatusPath(webhookUrl)) return "";
  return "/runs/" + encodeURIComponent(runId);
}

function isLikelyNgrokUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  try {
    const url = new URL(s);
    return /(^|\.)ngrok(?:-free)?\.app$/i.test(url.hostname);
  } catch (_) {
    return /ngrok(?:-free)?\.app/i.test(s);
  }
}

function getDiscoveryStatusPollingWebhookUrl(webhookUrl) {
  const fallback = normalizeDiscoveryWebhookIdentity(webhookUrl);
  if (!isLocalDashboardOrigin()) return fallback;

  const transport = getDiscoveryTransportSetupState();
  const localWebhookUrl = normalizeDiscoveryLocalWebhookUrl(
    transport.localWebhookUrl,
  );
  if (!localWebhookUrl) return fallback;

  const localEngineKind = getDiscoveryLocalEngineKind({
    localWebhookUrl,
  });
  if (localEngineKind !== "browser_use_worker") return fallback;

  const publicTunnelTarget = normalizeDiscoveryWebhookIdentity(
    buildDiscoveryTunnelTargetUrl(localWebhookUrl, transport.tunnelPublicUrl),
  );
  if (
    publicTunnelTarget &&
    fallback &&
    fallback !== publicTunnelTarget &&
    !isLikelyCloudflareWorkerUrl(fallback)
  ) {
    return fallback;
  }

  return localWebhookUrl;
}

function buildDiscoveryStatusPollHeaders(statusUrl) {
  return {
    Accept: "application/json",
    ...(isLikelyNgrokUrl(statusUrl)
      ? { "ngrok-skip-browser-warning": "true" }
      : {}),
  };
}

/**
 * Fetch and process a single status poll for the active run.
 * Returns the parsed status body or null on error.
 * @param {string} webhookUrl
 * @returns {Promise<object|null>}
 */
async function pollRunStatus(webhookUrl) {
  const tracker = discoveryRunTracker;
  const state = tracker.getState();
  if (!state.runId || !state.statusPath) return null;

  const statusUrl = buildRunStatusUrl(state.statusPath, webhookUrl);
  if (!statusUrl) return null;

  let response;
  try {
    response = await fetch(statusUrl, {
      method: "GET",
      mode: "cors",
      headers: buildDiscoveryStatusPollHeaders(statusUrl),
    });
  } catch (err) {
    tracker.markPollError(
      `Network error fetching status: ${err && err.message ? err.message : String(err)}`,
    );
    return null;
  }

  if (!response.ok) {
    tracker.markPollError(
      `Status endpoint returned HTTP ${response.status}`,
    );
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    tracker.markPollError("Status response was not valid JSON");
    return null;
  }

  return data;
}

function retryDiscoveryStatusConnection() {
  const state = discoveryRunTracker.getState();
  if (!state.runId || !state.statusPath) return;
  discoveryRunTracker.resumeFromPollError();
  renderDiscoveryRunStatus();
  void startDiscoveryStatusPolling(state.webhookUrl || getDiscoveryWebhookUrl());
}

function shouldRefreshPipelineAfterDiscoveryRun(state) {
  const status = String((state && state.status) || "").toLowerCase();
  return (
    status === "completed" ||
    status === "partial" ||
    Number((state && state.leadsWritten) || 0) > 0
  );
}

async function refreshPipelineAfterDiscoveryRun(state) {
  if (!shouldRefreshPipelineAfterDiscoveryRun(state)) return false;
  if (typeof loadAllData !== "function") return false;
  try {
    await loadAllData();
    return true;
  } catch (err) {
    console.warn("[JobBored] post-discovery refresh failed:", err);
    return false;
  }
}

const PRE_FILTER_REASON_LABELS = {
  skip_title_match: "skip-title",
  work_mode_mismatch: "work-mode",
  location_outside_acceptable: "location",
  work_auth_mismatch: "work-auth",
  salary_below_floor: "salary floor",
  salary_missing_but_required: "salary missing",
};

// Tracks the last rejection summary we've toasted so polling doesn't re-fire
// the same banner every tick. Keyed by runId so a new run resets it.
let _lastSurfacedRejectionKey = "";

/**
 * If the run status payload surfaces pre-filter rejections from the Fit
 * Profile pipeline, render a one-line banner summarizing what was filtered.
 * Tolerant of the upstream shape — looks at writeResult.rejectionSummary,
 * preFilterSummary, and similar field names so it works regardless of where
 * Task #3 chooses to land the data.
 */
function surfacePreFilterRejectionsFromStatus(statusData) {
  if (!statusData || typeof statusData !== "object") return;
  const summary =
    (statusData.writeResult && statusData.writeResult.rejectionSummary) ||
    statusData.preFilterSummary ||
    statusData.rejectionSummary ||
    null;
  if (!summary) return;

  // Accept either a map (reason → count) or an array of {reason, count}.
  const counts = {};
  if (Array.isArray(summary)) {
    for (const entry of summary) {
      if (!entry || typeof entry !== "object") continue;
      const reason = String(entry.reason || "");
      const count = Number(entry.count) || 1;
      if (reason in PRE_FILTER_REASON_LABELS) {
        counts[reason] = (counts[reason] || 0) + count;
      }
    }
  } else if (typeof summary === "object") {
    for (const [reason, count] of Object.entries(summary)) {
      if (reason in PRE_FILTER_REASON_LABELS) {
        const n = Number(count) || 0;
        if (n > 0) counts[reason] = n;
      }
    }
  }

  const reasons = Object.keys(counts);
  if (reasons.length === 0) return;

  // Dedupe — only surface once per (runId, shape) combination.
  const runId = String(
    (discoveryRunTracker.getState() || {}).runId || "",
  );
  const key =
    runId +
    "|" +
    reasons
      .map((r) => `${r}:${counts[r]}`)
      .sort()
      .join(",");
  if (key === _lastSurfacedRejectionKey) return;
  _lastSurfacedRejectionKey = key;

  const total = reasons.reduce((acc, r) => acc + counts[r], 0);
  const parts = reasons
    .map((r) => `${counts[r]} by ${PRE_FILTER_REASON_LABELS[r]}`)
    .join(", ");
  const message = `${total} listings filtered by your Fit Profile: ${parts}`;
  if (typeof showToast === "function") {
    showToast(message, "info", true);
  } else {
    console.info("[JobBored] " + message);
  }
}

/**
 * Main polling loop — call once after an accepted_async response.
 * Automatically stops when the run reaches a terminal state or polling errors exceed limit.
 *
 * @param {string} webhookUrl  discovery webhook URL (used to resolve relative statusPath)
 */
async function startDiscoveryStatusPolling(webhookUrl) {
  const tracker = discoveryRunTracker;
  const pollingWebhookUrl = getDiscoveryStatusPollingWebhookUrl(webhookUrl);

  // Cancel any in-flight polling session before starting fresh
  if (tracker._pollTimer) {
    clearTimeout(tracker._pollTimer);
    tracker._pollTimer = null;
  }

  async function poll() {
    const state = tracker.getState();

    // If we've reached terminal or been cleared, stop
    if (!state.runId || state.status === "idle") {
      return;
    }

    const statusData = await pollRunStatus(pollingWebhookUrl);
    if (statusData) {
      tracker.updateFromStatusResponse(statusData);
      surfacePreFilterRejectionsFromStatus(statusData);
    }

    const updated = tracker.getState();

    if (updated.status === "polling_error") {
      if (updated.pollErrorCount >= MAX_POLL_ERRORS) {
        tracker.markStatusConnectionLost(
          "Lost the status connection after multiple attempts. The discovery run may still be running.",
        );
        renderDiscoveryRunStatus();
        return;
      }
      // Exponential-ish back-off: 1s, 2s, 4s
      const backoff = Math.min(4000, 500 * Math.pow(2, updated.pollErrorCount));
      tracker._pollTimer = setTimeout(poll, backoff);
      return;
    }

    if (tracker.isTerminal()) {
      await refreshPipelineAfterDiscoveryRun(updated);
      renderDiscoveryRunStatus();
      return;
    }

    // Normal: wait pollAfterMs then poll again
    const interval = Number.isFinite(updated.pollAfterMs)
      ? Math.max(STATUS_POLL_DEBOUNCE_MS, updated.pollAfterMs)
      : 2000;
    tracker._pollTimer = setTimeout(poll, interval);
  }

  // Kick off the first poll after the advertised pollAfterMs
  const state = tracker.getState();
  const firstDelay = Math.max(
    STATUS_POLL_DEBOUNCE_MS,
    Number.isFinite(state.pollAfterMs) ? state.pollAfterMs : 2000,
  );
  tracker._pollTimer = setTimeout(poll, firstDelay);
}

/** Stop any active polling loop without clearing run state */
function stopDiscoveryStatusPolling() {
  if (discoveryRunTracker._pollTimer) {
    clearTimeout(discoveryRunTracker._pollTimer);
    discoveryRunTracker._pollTimer = null;
  }
}

function resumeDiscoveryStatusPollingIfNeeded() {
  const state = discoveryRunTracker.getState();
  if (!state.runId) return;
  if (!state.statusPath) {
    if (state.statusUnavailable && discoveryRunTracker.isActive()) {
      renderDiscoveryRunStatus();
    }
    return;
  }
  if (state.status === "failed") {
    discoveryRunTracker.resumeFromStatusPollingFailure();
  }
  const next = discoveryRunTracker.getState();
  if (!discoveryRunTracker.isActive()) return;
  renderDiscoveryRunStatus();
  void startDiscoveryStatusPolling(next.webhookUrl || getDiscoveryWebhookUrl());
}

/**
 * Render current run status into the discovery status bar (toast area / status chip).
 * Called after every tracker state change so the user sees live progress.
 */
function renderDiscoveryRunStatus() {
  const state = discoveryRunTracker.getState();
  const openBtn = document.getElementById("discoveryBtn");

  if (state.status === "idle") {
    if (openBtn) {
      openBtn.classList.remove("loading", "run-pending", "run-running", "run-terminal");
      openBtn.removeAttribute("aria-label");
    }
    return;
  }

  // Apply CSS class for visual state on the button
  if (openBtn) {
    openBtn.classList.add("run-" + state.status);
    openBtn.classList.remove("loading");
  }

  // Build status message
  let statusMessage = "";
  let statusTone = "info";

  switch (state.status) {
    case "pending":
      statusMessage = state.statusUnavailable
        ? `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} accepted, but this worker did not return a status URL. Check Pipeline or Runs for the final result.`
        : `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} accepted — checking status…`;
      statusTone = "info";
      break;
    case "running":
      statusMessage = `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} in progress…`;
      statusTone = "info";
      break;
    case "polling_error":
      statusMessage =
        state.pollErrorCount >= MAX_POLL_ERRORS
          ? `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} accepted, but JobBored lost the status connection. The worker may still be running.`
          : `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} — retrying status connection…`;
      statusTone = "warning";
      break;
    case "completed":
      statusMessage = "Discovery complete — new roles will appear in your sheet.";
      statusTone = "success";
      break;
    case "empty":
      statusMessage = "Discovery finished — no new roles found this run.";
      statusTone = "info";
      break;
    case "partial":
      statusMessage =
        "Discovery finished with partial results. " +
        (state.errorMessage ? state.errorMessage + ". " : "") +
        "Check the worker logs for details.";
      statusTone = "warning";
      break;
    case "failed":
      statusMessage =
        "Discovery run failed. " +
        (state.errorMessage ? state.errorMessage : "Check the worker logs.");
      statusTone = "error";
      break;
    default:
      statusMessage = "";
  }

  if (openBtn && statusMessage) {
    openBtn.setAttribute("aria-label", statusMessage);
    // Also surface in a toast for non-terminal states
    if (state.status !== "idle") {
      // Use a transient toast (non-blocking) for live updates
      const retryAction =
        state.status === "polling_error" &&
        state.statusPath &&
        state.pollErrorCount >= MAX_POLL_ERRORS
          ? { label: "Retry status", onClick: retryDiscoveryStatusConnection }
          : state.status === "pending" && state.statusUnavailable
            ? {
                label: "Open runs",
                onClick: () => {
                  document.getElementById("runsBtn")?.click();
                },
              }
          : undefined;
      showToast(
        statusMessage,
        statusTone,
        (state.status === "polling_error" &&
          state.pollErrorCount >= MAX_POLL_ERRORS) ||
          (state.status === "pending" && state.statusUnavailable),
        retryAction,
      );
    }
  }
}

// ============================================
// DISCOVERY SETUP WIZARD
// ============================================

async function handleDiscoverySetupDeepLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup") !== "discovery") return false;
  await requestDiscoverySetup({
    entryPoint: "deep_link",
    stripSetupParam: true,
  });
  return true;
}

function runPostAccessBootstrapOnce() {
  if (postAccessBootstrapDone) return postAccessBootstrapPromise;
  postAccessBootstrapDone = true;
  postAccessBootstrapPromise = (async () => {
    await checkOnboardingGate();
    await handleDiscoverySetupDeepLink();
  })();
  return postAccessBootstrapPromise;
}

// Scraper / ATS config — extracted to scraper-ats-config.js (JobBoredApp.scraperAts)
function getJobPostingScrapeUrl() {
  return window.JobBoredApp.scraperAts.getJobPostingScrapeUrl();
}
function getAtsScoringConfig() {
  return window.JobBoredApp.scraperAts.getAtsScoringConfig();
}
function getAtsScorecardApiUrl() {
  return window.JobBoredApp.scraperAts.getAtsScorecardApiUrl();
}
function isScraperUrlBlockedOnThisPage(...args) {
  return window.JobBoredApp.scraperAts.isScraperUrlBlockedOnThisPage(...args);
}
function openScraperSetupModal() {
  return window.JobBoredApp.scraperAts.openScraperSetupModal();
}
function closeScraperSetupModal() {
  return window.JobBoredApp.scraperAts.closeScraperSetupModal();
}
function copyTextToClipboard(...args) {
  return window.JobBoredApp.scraperAts.copyTextToClipboard(...args);
}
async function runScraperConnectionTest() {
  return window.JobBoredApp.scraperAts.runScraperConnectionTest();
}
function isFetchNetworkError(...args) {
  return window.JobBoredApp.scraperAts.isFetchNetworkError(...args);
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
    !getGisLoaded() ||
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
        login_hint: getUserEmailFromAuth() || undefined,
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
        prompt: getUserEmailFromAuth() ? "" : "select_account",
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
    configCore.appsScriptDeployStateCache = null;
    renderAppsScriptDeployUi();
    return;
  }
  try {
    configCore.appsScriptDeployStateCache = await store.getAppsScriptDeployState();
  } catch (err) {
    console.warn("[JobBored] Apps Script deploy state:", err);
    configCore.appsScriptDeployStateCache = null;
    configCore.appsScriptDeployStatus = {
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

// Layer 5 Tier 1: read-only status refresh for the SerpApi Google Jobs
// onboarding callout. Hits the worker's /health endpoint (same host as the
// saved webhook URL) and updates the [data-configured] attribute on the
// callout so CSS can swap colors + the status badge text reflects reality.
// Silent on network errors — the callout stays in its "Checking…" state
// rather than throwing console noise the user can't act on.
function refreshSerpApiCalloutStatus() {
  const el = document.getElementById("settingsSerpApiCallout");
  const badge = document.getElementById("settingsSerpApiCalloutStatus");
  if (!el || !badge) return;
  const snapshot = getDiscoveryReadinessSnapshot();
  const webhookUrl = (snapshot && snapshot.savedWebhookUrl) || "";
  // Only attempt the probe for locally-reachable workers. A Cloudflare
  // relay hides the real /health from the browser, so skip the probe in
  // that case and leave the callout neutral.
  const isLocalHost = /(^|\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/i.test(
    webhookUrl,
  );
  if (!webhookUrl || !isLocalHost) {
    el.dataset.configured = "unknown";
    badge.textContent = "Worker status unknown";
    return;
  }
  const healthUrl = (() => {
    try {
      const u = new URL(webhookUrl);
      u.pathname = "/health";
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch (_) {
      return "";
    }
  })();
  if (!healthUrl) {
    el.dataset.configured = "unknown";
    badge.textContent = "Worker status unknown";
    return;
  }
  fetch(healthUrl, { method: "GET", mode: "cors" })
    .then(async (r) => (r.ok ? r.json() : null))
    .then((payload) => {
      const flag =
        payload && payload.readiness && payload.readiness.serpApiGoogleJobs;
      if (!flag) {
        el.dataset.configured = "unknown";
        badge.textContent = "Worker too old to report";
        return;
      }
      if (flag.configured) {
        el.dataset.configured = "yes";
        badge.textContent = "✓ Configured";
      } else {
        el.dataset.configured = "no";
        badge.textContent = "Not configured";
      }
    })
    .catch(() => {
      el.dataset.configured = "unknown";
      badge.textContent = "Worker unreachable";
    });
}

function renderDiscoveryEngineStatusUi() {
  refreshSerpApiCalloutStatus();
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
      void requestDiscoverySetup({
        entryPoint: "settings",
        allowWhileOnboarding: true,
      });
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

  const state = configCore.appsScriptDeployStateCache;
  const hasManaged = isManagedAppsScriptDeployState(state);
  const publicAccessReady = isAppsScriptPublicAccessReady(state);
  const scriptId =
    state && typeof state.scriptId === "string" ? state.scriptId.trim() : "";
  const webAppUrl =
    state && typeof state.webAppUrl === "string" ? state.webAppUrl.trim() : "";
  const clientId = getSettingsOAuthClientIdValue();
  const sheetId = getSettingsSheetIdValue();
  const needsOAuthReload = hasUnsavedOAuthClientIdChange(clientId);

  deployBtn.textContent = configCore.appsScriptDeployBusy
    ? "Deploying..."
    : hasManaged
      ? "Re-deploy managed Apps Script"
      : "Deploy Google Apps Script stub";
  deployBtn.disabled =
    configCore.appsScriptDeployBusy ||
    !clientId ||
    !sheetId ||
    needsOAuthReload ||
    !getGisLoaded();

  if (!clientId) {
    deployBtn.title = "Add an OAuth Client ID above first";
  } else if (needsOAuthReload) {
    deployBtn.title =
      "Save Settings so the page reloads with this OAuth client";
  } else if (!sheetId) {
    deployBtn.title = "Paste a spreadsheet URL or Sheet ID above first";
  } else if (!getGisLoaded()) {
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
      !hasManaged || publicAccessReady || configCore.appsScriptDeployBusy || !scriptId;
    recheckBtn.disabled =
      configCore.appsScriptDeployBusy || !getGisLoaded() || !clientId || needsOAuthReload;
    if (!clientId) {
      recheckBtn.title = "Add an OAuth Client ID above first";
    } else if (needsOAuthReload) {
      recheckBtn.title =
        "Save Settings so the page reloads with this OAuth client";
    } else if (!getGisLoaded()) {
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
  let effectiveStatus = configCore.appsScriptDeployStatus;

  if (configCore.appsScriptDeployStatus && configCore.appsScriptDeployStatus.message) {
    tone = configCore.appsScriptDeployStatus.tone || "info";
    message = configCore.appsScriptDeployStatus.message;
    detail = configCore.appsScriptDeployStatus.detail || "";
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
  } else if (!getGisLoaded()) {
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
  if (configCore.appsScriptDeployBusy) return;

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

  configCore.appsScriptDeployBusy = true;
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
      configCore.appsScriptDeployStateCache,
    )
      ? configCore.appsScriptDeployStateCache
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
      ownerEmail: getUserEmailFromAuth() || "",
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
    configCore.appsScriptDeployStateCache = nextState;

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
    configCore.appsScriptDeployBusy = false;
    renderAppsScriptDeployUi();
  }
}

async function recheckAppsScriptPublicAccessFromSettings() {
  if (configCore.appsScriptDeployBusy) return;
  const state = configCore.appsScriptDeployStateCache;
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

  configCore.appsScriptDeployBusy = true;
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
    configCore.appsScriptDeployStateCache = nextState;

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
    configCore.appsScriptDeployBusy = false;
    renderAppsScriptDeployUi();
  }
}

function initScraperSetupGuide() {
  return window.JobBoredApp.scraperAts.initScraperSetupGuide();
}

// ============================================
// STATE
// ============================================

let SHEET_ID = null;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

let pipelineData = [];
let pipelineRawRows = []; // Keep raw rows for row index mapping
let currentSort = "fit";
let currentSearch = "";
let favoritesOnly = false;
let showDismissed = false;
let dataLoadFailed = false;
let dashboardDataHydrated = false;
let initialSheetAccessResolved = false;
let pendingSetupStarterSheetCreate = false;
let postAccessBootstrapDone = false;
let postAccessBootstrapPromise = Promise.resolve();

/** Pipeline indices with expanded detail panel — preserved across re-renders */
const expandedJobKeys = new Set();

/** Stable keys that have been opened in the detail drawer — persisted to localStorage */
const viewedJobKeys = new Set(
  JSON.parse(localStorage.getItem("jb_viewedKeys") || "[]").map(Number),
);

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
  "Expired",
];
const STAGE_ARCHIVE = new Set(["Rejected", "Passed", "Expired"]);
/** Which stage lanes are expanded; defaults to active (non-archive) stages */
const expandedStages = new Set(
  STAGE_ORDER.filter((s) => !STAGE_ARCHIVE.has(s)),
);
/** Stable key of the job currently shown in the detail drawer, or -1 */
let activeDetailKey = -1;

function getPipelineViewFilters() {
  return {
    favoritesOnly,
    showDismissed,
  };
}

function syncPipelineFilterControls() {
  if (typeof document === "undefined") return;
  const favChip = document.getElementById("favoritesOnlyChip");
  if (favChip) {
    favChip.classList.toggle("active", favoritesOnly);
    favChip.setAttribute("aria-pressed", String(favoritesOnly));
  }
  const dismissedChip = document.getElementById("showDismissedChip");
  if (dismissedChip) {
    dismissedChip.classList.toggle("active", showDismissed);
    dismissedChip.setAttribute("aria-pressed", String(showDismissed));
  }
}

function notifyPipelineFiltersChanged() {
  try {
    if (typeof document === "undefined" || typeof CustomEvent !== "function") {
      return;
    }
    document.dispatchEvent(
      new CustomEvent("jb:pipeline:filters-changed", {
        detail: getPipelineViewFilters(),
      }),
    );
  } catch (_) {
    /* Filter notifications are best-effort for optional v2 surfaces. */
  }
}

function notifyPipelineRendered() {
  try {
    if (typeof document === "undefined" || typeof CustomEvent !== "function") {
      return;
    }
    document.dispatchEvent(new CustomEvent("jb:pipeline:rendered"));
  } catch (_) {
    /* Render notifications are best-effort for optional v2 surfaces. */
  }
}

function setPipelineViewFilters(nextFilters = {}) {
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(nextFilters, "favoritesOnly")) {
    const next = !!nextFilters.favoritesOnly;
    if (favoritesOnly !== next) {
      favoritesOnly = next;
      changed = true;
    }
  }
  if (Object.prototype.hasOwnProperty.call(nextFilters, "showDismissed")) {
    const next = !!nextFilters.showDismissed;
    if (showDismissed !== next) {
      showDismissed = next;
      changed = true;
    }
  }
  syncPipelineFilterControls();
  if (changed) {
    renderPipeline();
    notifyPipelineFiltersChanged();
  }
  return getPipelineViewFilters();
}

function applyPipelineStageWrite(jobKey, statusLabel) {
  const idx = Number(jobKey);
  if (!Number.isInteger(idx) || idx < 0 || !pipelineData[idx]) return false;
  const nextStatus = String(statusLabel || "").trim();
  if (!nextStatus) return false;
  pipelineData[idx].status = nextStatus;
  renderPipeline();
  renderStats();
  renderBrief();
  refreshDrawerIfOpen(idx);
  return true;
}

function applyPipelineNotesWrite(jobKey, body) {
  const idx = Number(jobKey);
  if (!Number.isInteger(idx) || idx < 0 || !pipelineData[idx]) return false;
  pipelineData[idx].notes = body == null ? "" : String(body);
  renderPipeline();
  renderBrief();
  refreshDrawerIfOpen(idx);
  return true;
}

// Auth session — extracted to auth-session.js (JobBoredApp.auth)
function getAccessToken() {
  return window.JobBoredApp.auth.getAccessToken();
}
function getUserEmailFromAuth() {
  return window.JobBoredApp.auth.getUserEmail();
}
function getTokenExpiresAt() {
  return window.JobBoredApp.auth.getTokenExpiresAt();
}
function getGisLoaded() {
  return window.JobBoredApp.auth.getGisLoaded();
}
function getTokenClient() {
  return window.JobBoredApp.auth.getTokenClient();
}
function showToast(...args) {
  return window.JobBoredApp.auth.showToast(...args);
}
function canUseLocalStorage(...args) {
  return window.JobBoredApp.auth.canUseLocalStorage(...args);
}
function canUseSessionStorage(...args) {
  return window.JobBoredApp.auth.canUseSessionStorage(...args);
}
function applyOAuthClientChange(...args) {
  return window.JobBoredApp.auth.applyOAuthClientChange(...args);
}
function initAuth(...args) {
  return window.JobBoredApp.auth.initAuth(...args);
}
function handleTokenResponse(...args) {
  return window.JobBoredApp.auth.handleTokenResponse(...args);
}
function fetchUserEmail(...args) {
  return window.JobBoredApp.auth.fetchUserEmail(...args);
}
function signIn(...args) {
  return window.JobBoredApp.auth.signIn(...args);
}
function signOut(...args) {
  return window.JobBoredApp.auth.signOut(...args);
}
function setupAuthUI(...args) {
  return window.JobBoredApp.auth.setupAuthUI(...args);
}
function closeAuthUserMenu(...args) {
  return window.JobBoredApp.auth.closeAuthUserMenu(...args);
}
function isAuthUserMenuOpen(...args) {
  return window.JobBoredApp.auth.isAuthUserMenuOpen(...args);
}
function toggleAuthUserMenu(...args) {
  return window.JobBoredApp.auth.toggleAuthUserMenu(...args);
}
function initAuthUserMenu(...args) {
  return window.JobBoredApp.auth.initAuthUserMenu(...args);
}
async function installDoctor(...args) {
  return window.JobBoredApp.auth.installDoctor(...args);
}
async function installKeepAliveOnce(...args) {
  return window.JobBoredApp.auth.installKeepAliveOnce(...args);
}
async function refreshKeepAlivePill(...args) {
  return window.JobBoredApp.auth.refreshKeepAlivePill(...args);
}
async function refreshWorkerAutostartPill(...args) {
  return window.JobBoredApp.auth.refreshWorkerAutostartPill(...args);
}
async function toggleWorkerAutostart(...args) {
  return window.JobBoredApp.auth.toggleWorkerAutostart(...args);
}
function setAuthAvatarDisplay(...args) {
  return window.JobBoredApp.auth.setAuthAvatarDisplay(...args);
}
function updateAuthUI(...args) {
  return window.JobBoredApp.auth.updateAuthUI(...args);
}
function isSignedIn(...args) {
  return window.JobBoredApp.auth.isSignedIn(...args);
}
function persistOAuthSession(...args) {
  return window.JobBoredApp.auth.persistOAuthSession(...args);
}
function clearPersistedOAuthSession(...args) {
  return window.JobBoredApp.auth.clearPersistedOAuthSession(...args);
}
function clearPersistedRuntimeOAuthSession(...args) {
  return window.JobBoredApp.auth.clearPersistedRuntimeOAuthSession(...args);
}
function clearSessionAuthState(...args) {
  return window.JobBoredApp.auth.clearSessionAuthState(...args);
}
function loadPersistedOAuthSession(...args) {
  return window.JobBoredApp.auth.loadPersistedOAuthSession(...args);
}
function loadPersistedRuntimeOAuthSession(...args) {
  return window.JobBoredApp.auth.loadPersistedRuntimeOAuthSession(...args);
}
function refreshAccessTokenSilently(...args) {
  return window.JobBoredApp.auth.refreshAccessTokenSilently(...args);
}
function restoreOAuthSession(...args) {
  return window.JobBoredApp.auth.restoreOAuthSession(...args);
}
function normalizeOauthScopes(...args) {
  return window.JobBoredApp.auth.normalizeOauthScopes(...args);
}
function hasGrantedOauthScope(...args) {
  return window.JobBoredApp.auth.hasGrantedOauthScope(...args);
}

// Minimal external accessor for modules that need the live access token
// without grabbing internal symbols. Kept tiny on purpose — just getters,
// no setters. Used by runs-tab.js to read the DiscoveryRuns sheet tab.
// Guarded for vm-sliced test contexts that don't define `window`.
if (typeof window !== "undefined") {
  window.JobBored = window.JobBored || {};
  window.JobBored.getAccessToken = function () {
    return getAccessToken();
  };
  window.JobBored.getSheetId = function () {
    return typeof SHEET_ID === "string" ? SHEET_ID : "";
  };
  window.JobBored.getPipelineSheetRow = function (dataIndex) {
    const idx = Number(dataIndex);
    if (!Number.isInteger(idx) || idx < 0) return null;
    return getSheetRow(idx);
  };
  window.JobBored.getPipelineJobs = function () {
    return pipelineData;
  };
  window.JobBored.getPipelineViewFilters = getPipelineViewFilters;
  window.JobBored.setPipelineViewFilters = setPipelineViewFilters;
  window.JobBored.toggleFavorite = toggleFavorite;
  window.JobBored.editJobField = editJobField;
  window.JobBored.applyPipelineStageWrite = applyPipelineStageWrite;
  window.JobBored.applyPipelineNotesWrite = applyPipelineNotesWrite;
  window.JobBored.ingestJobUrl = ingestJobUrl;
  window.JobBored.isParseableJobUrl = isParseableUrl;
}


// ============================================
// SHEET ACCESS / SETUP — delegated to sheet-access-setup.js
// ============================================

function showSheetAccessGate(...args) {
  return window.JobBoredApp.setup.showSheetAccessGate(...args);
}

function recordSheetAccessError(...args) {
  return window.JobBoredApp.setup.recordSheetAccessError(...args);
}

function hideSheetAccessGate(...args) {
  return window.JobBoredApp.setup.hideSheetAccessGate(...args);
}

function revealPipelineSetupStepsScreen(...args) {
  return window.JobBoredApp.setup.revealPipelineSetupStepsScreen(...args);
}

function revealSetupScreenAfterAuth(...args) {
  return window.JobBoredApp.setup.revealSetupScreenAfterAuth(...args);
}

function revealDashboardShell(...args) {
  return window.JobBoredApp.setup.revealDashboardShell(...args);
}

function renderSetupStarterSheetUi(...args) {
  return window.JobBoredApp.setup.renderSetupStarterSheetUi(...args);
}

async function createBlankStarterSheet(...args) {
  return window.JobBoredApp.setup.createBlankStarterSheet(...args);
}

async function handleSetupCreateStarterSheet(...args) {
  return window.JobBoredApp.setup.handleSetupCreateStarterSheet(...args);
}

function setDashboardSheetLinks(...args) {
  return window.JobBoredApp.setup.setDashboardSheetLinks(...args);
}

// ============================================
// WRITE-BACK — delegated to sheets-writeback.js
// ============================================

function normalizeLeadUrlClient(...args) {
  return window.JobBoredApp.sheetsWrite.normalizeLeadUrlClient(...args);
}

async function updateSheetCell(...args) {
  return window.JobBoredApp.sheetsWrite.updateSheetCell(...args);
}

async function updateMultipleCells(...args) {
  return window.JobBoredApp.sheetsWrite.updateMultipleCells(...args);
}

async function sheetsBatchUpdate(...args) {
  return window.JobBoredApp.sheetsWrite.sheetsBatchUpdate(...args);
}

async function sheetsValuesAppend(...args) {
  return window.JobBoredApp.sheetsWrite.sheetsValuesAppend(...args);
}

async function sheetsValuesGet(...args) {
  return window.JobBoredApp.sheetsWrite.sheetsValuesGet(...args);
}

async function sheetsValuesUpdate(...args) {
  return window.JobBoredApp.sheetsWrite.sheetsValuesUpdate(...args);
}

async function ensureBlacklistTab(...args) {
  return window.JobBoredApp.sheetsWrite.ensureBlacklistTab(...args);
}

async function appendBlacklistRow(...args) {
  return window.JobBoredApp.sheetsWrite.appendBlacklistRow(...args);
}

async function deleteBlacklistRowByUrl(...args) {
  return window.JobBoredApp.sheetsWrite.deleteBlacklistRowByUrl(...args);
}

async function toggleFavorite(...args) {
  return window.JobBoredApp.sheetsWrite.toggleFavorite(...args);
}

async function dismissJob(...args) {
  return window.JobBoredApp.sheetsWrite.dismissJob(...args);
}

async function restoreJob(...args) {
  return window.JobBoredApp.sheetsWrite.restoreJob(...args);
}

async function markStatusExpired(...args) {
  return window.JobBoredApp.sheetsWrite.markStatusExpired(...args);
}

async function editJobField(...args) {
  return window.JobBoredApp.sheetsWrite.editJobField(...args);
}

function getSheetRow(...args) {
  return window.JobBoredApp.sheetsWrite.getSheetRow(...args);
}

function todayStr(...args) {
  return window.JobBoredApp.sheetsWrite.todayStr(...args);
}

function futureDateStr(...args) {
  return window.JobBoredApp.sheetsWrite.futureDateStr(...args);
}

function getStatusSideEffects(...args) {
  return window.JobBoredApp.sheetsWrite.getStatusSideEffects(...args);
}

function emitPipelineMoveSucceeded(...args) {
  return window.JobBoredApp.sheetsWrite.emitPipelineMoveSucceeded(...args);
}

async function updateJobStatus(...args) {
  return window.JobBoredApp.sheetsWrite.updateJobStatus(...args);
}

async function updateJobNotes(...args) {
  return window.JobBoredApp.sheetsWrite.updateJobNotes(...args);
}

async function updateFollowUpDate(...args) {
  return window.JobBoredApp.sheetsWrite.updateFollowUpDate(...args);
}

async function updateLastHeardFrom(...args) {
  return window.JobBoredApp.sheetsWrite.updateLastHeardFrom(...args);
}

async function updateJobResponseFlag(...args) {
  return window.JobBoredApp.sheetsWrite.updateJobResponseFlag(...args);
}


function generateDiscoveryVariationKey() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getDiscoveryRunWebhookUrlCandidates(snapshot) {
  const state = snapshot && typeof snapshot === "object" ? snapshot : {};
  const transport = getDiscoveryTransportSetupState();
  const relayInfo = getCloudflareRelayTargetInfo();
  const snapshotTunnelTargetUrl = buildDiscoveryTunnelTargetUrl(
    state.localWebhookUrl,
    state.tunnelPublicUrl,
  );
  const localTunnelTargetUrl = buildDiscoveryTunnelTargetUrl(
    transport.localWebhookUrl,
    transport.tunnelPublicUrl,
  );
  const allowDirectLocal =
    isLocalDashboardOrigin() &&
    (state.savedWebhookKind === "local_http" ||
      state.localWebhookReady === true ||
      !!transport.localWebhookUrl);
  return [
    { url: getDiscoveryWebhookUrl(), source: "configured" },
    { url: state.savedWebhookUrl, source: "snapshot_saved" },
    { url: snapshotTunnelTargetUrl, source: "snapshot_tunnel_target" },
    { url: state.relayTargetUrl, source: "snapshot_relay_target" },
    { url: relayInfo && relayInfo.url, source: "relay_info" },
    { url: localTunnelTargetUrl, source: "local_tunnel_target" },
    {
      url: allowDirectLocal ? state.localWebhookUrl : "",
      source: "snapshot_local",
    },
    {
      url: allowDirectLocal ? transport.localWebhookUrl : "",
      source: "transport_local",
    },
  ];
}

function isLocalWebhookCandidateUrl(raw) {
  const normalized = normalizeDiscoveryWebhookIdentity(raw);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    const host = String(url.hostname || "")
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch (_) {
    return false;
  }
}

function getDiscoveryRunWebhookCandidateProbe(candidate, snapshot) {
  const src = candidate && typeof candidate === "object" ? candidate : {};
  const url = normalizeDiscoveryWebhookIdentity(src.url || candidate);
  if (!url) {
    return { ok: false, url: "", source: src.source || "", score: -1 };
  }

  const verifyApi = getDiscoveryWizardVerifyApi();
  if (verifyApi && typeof verifyApi.classifyEndpointInput === "function") {
    const inputProblem = verifyApi.classifyEndpointInput(url);
    if (inputProblem && inputProblem.kind === "invalid_endpoint") {
      return {
        ok: false,
        url,
        source: src.source || "",
        score: -1,
        reason: inputProblem.message || "invalid_endpoint",
      };
    }
  }

  const state = snapshot && typeof snapshot === "object" ? snapshot : {};
  const local = isLocalWebhookCandidateUrl(url);
  const worker = isLikelyCloudflareWorkerUrl(url);
  const appsScript = isLikelyAppsScriptWebAppUrl(url);
  const hostedHttps = /^https:\/\//i.test(url) && !local;
  const source = String(src.source || "");
  let score = 10;

  if (local && !isLocalDashboardOrigin()) {
    return {
      ok: false,
      url,
      source,
      score: -1,
      reason: "local_only_on_hosted_dashboard",
    };
  }

  if (source.includes("local") && local && state.localWebhookReady) score += 90;
  else if (source.includes("local") && local) score += 20;
  if (source === "configured") score += 35;
  if (source === "snapshot_saved") score += 25;
  if (worker) score += isLocalDashboardOrigin() ? 45 : 80;
  else if (hostedHttps) score += isLocalDashboardOrigin() ? 35 : 65;
  if (source.includes("relay")) score += 20;
  if (source.includes("tunnel")) score += isLocalDashboardOrigin() ? 30 : 15;
  if (source === "snapshot_tunnel_target" && state.tunnelLive) score += 45;
  if (appsScript) score -= 20;

  const recovery = String(state.localRecoveryState || "ok");
  if (recovery !== "ok" && (local || source.includes("tunnel"))) {
    score -= 60;
  }
  if (
    state.tunnelLive &&
    state.tunnelPublicUrl &&
    isLikelyNgrokWebhookUrl(url) &&
    !sameDiscoveryUrlOrigin(url, state.tunnelPublicUrl)
  ) {
    score -= 120;
  }
  if (!isLocalDashboardOrigin() && (worker || hostedHttps)) {
    score += 20;
  }

  return { ok: true, url, source, score };
}

async function scoreDiscoveryRunWebhookCandidates(candidates, snapshot) {
  const seen = new Set();
  const scored = [];
  for (const candidate of candidates || []) {
    const probe = getDiscoveryRunWebhookCandidateProbe(candidate, snapshot);
    if (!probe.ok || !probe.url || seen.has(probe.url)) continue;
    seen.add(probe.url);
    scored.push(probe);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function resolveDiscoveryRunWebhookUrl() {
  await hydrateDiscoveryTransportSetupFromLocalBootstrap();
  let snapshot = getDiscoveryReadinessSnapshot();
  try {
    snapshot = await refreshDiscoveryReadinessSnapshot({
      force: true,
      rerender: false,
    });
    if (snapshot && snapshot.tunnelLive && snapshot.tunnelPublicUrl) {
      const transportPatch = { tunnelPublicUrl: snapshot.tunnelPublicUrl };
      if (snapshot.localWebhookUrl) {
        transportPatch.localWebhookUrl = snapshot.localWebhookUrl;
      }
      writeDiscoveryTransportSetupState(transportPatch);
    }
  } catch (err) {
    console.warn("[JobBored] discovery run readiness:", err);
  }

  const scored = await scoreDiscoveryRunWebhookCandidates(
    getDiscoveryRunWebhookUrlCandidates(snapshot),
    snapshot,
  );
  return scored.length ? scored[0].url : "";
}

async function ensureLocalDiscoveryAutoSetupForRun() {
  if (!isLocalDashboardOrigin()) return false;
  let shouldRunSetup = true;
  try {
    const stateResp = await fetch("/__proxy/discovery-state", {
      method: "GET",
      cache: "no-store",
    });
    const state = await stateResp.json().catch(() => null);
    if (
      stateResp.ok &&
      state &&
      state.recommendation === "ready" &&
      (!state.worker || state.worker.originAllowed !== false)
    ) {
      return true;
    }
    shouldRunSetup = !!(
      state &&
      (state.recommendation === "auto_recoverable" ||
        state.recoverableHint === "origin_not_allowed" ||
        (state.worker && state.worker.originAllowed === false))
    );
  } catch (_) {
    shouldRunSetup = true;
  }
  if (!shouldRunSetup) return false;
  setDiscoveryWizardMessage(
    "Setting up local discovery from this dev server...",
    "info",
  );
  showToast("Setting up local discovery...", "info");
  try {
    const resp = await fetch("/__proxy/fix-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body || !body.ok) {
      return false;
    }
    await hydrateDiscoveryTransportSetupFromLocalBootstrap();
    await refreshDiscoveryReadinessSnapshot({
      force: true,
      rerender: false,
    });
    showToast("Local discovery setup is ready.", "success");
    return true;
  } catch (err) {
    console.warn("[JobBored] local discovery auto setup failed:", err);
    return false;
  }
}

/** Notify automation (Hermes, n8n, etc.) to run another discovery pass (varied query). */
async function triggerDiscoveryRun(options) {
  const runOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  const runTrigger = String(runOptions.trigger || "manual").trim() || "manual";
  if (isLocalDashboardOrigin()) {
    await ensureLocalDiscoveryAutoSetupForRun();
    await warnDiscoverySourceReadinessBeforeRun();
  }
  let hook = await resolveDiscoveryRunWebhookUrl();
  if (!hook && (await ensureLocalDiscoveryAutoSetupForRun())) {
    await warnDiscoverySourceReadinessBeforeRun();
    hook = await resolveDiscoveryRunWebhookUrl();
  }
  if (!hook) {
    void requestDiscoverySetup({
      entryPoint: "run_discovery",
      allowWhileOnboarding: true,
      skipAutodetect: true,
    });
    return { ok: false, reason: "no_url" };
  }
  try {
    const payload = await buildDiscoveryWebhookPayload(SHEET_ID, {
      trigger: runTrigger,
    });
    // Guardrail: verify intent is present before sending webhook request
    const profile = payload && payload.discoveryProfile;
    const targetRoles = (profile && profile.targetRoles || "").trim();
    const keywordsInclude = (profile && profile.keywordsInclude || "").trim();
    if (!targetRoles && !keywordsInclude) {
      showToast(
        "Add target roles or keywords to include, or use the AI Suggest tab to generate them.",
        "warning",
        true,
      );
      return { ok: false, reason: "blank_intent" };
    }
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

      // Extract run tracking metadata from accepted_async responses and start polling
      if (result.kind === "accepted_async" && result.runId) {
        const webhookUrl = String(hook || "").trim();
        const statusPath = resolveAcceptedRunStatusPath(result, webhookUrl);
        discoveryRunTracker.beginTracking({
          runId: result.runId,
          statusPath,
          pollAfterMs: Number.isFinite(result.pollAfterMs) ? result.pollAfterMs : 2000,
          webhookUrl,
          trigger: runTrigger,
          variationKey: payload.variationKey || "",
          requestedAt: payload.requestedAt || "",
          statusUnavailable: !statusPath,
        });
        // Show initial pending feedback immediately
        renderDiscoveryRunStatus();
        // Start async polling — will update tracker state on each response
        if (statusPath) {
          void startDiscoveryStatusPolling(webhookUrl);
        }
      }

      return { ok: true, kind: result.kind };
    }
    if (
      (result.kind === "network_error" || result.kind === "invalid_endpoint") &&
      (await handleAppsScriptBrowserCorsFailure(hook, result.kind))
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

window.JobBoredDiscovery = Object.assign(window.JobBoredDiscovery || {}, {
  triggerRun: triggerDiscoveryRun,
  triggerScheduledRun(options) {
    return triggerDiscoveryRun(
      Object.assign({}, options || {}, {
        trigger: (options && options.trigger) || "scheduled-browser",
      }),
    );
  },
  buildPayload: buildDiscoveryWebhookPayload,
});

// Config overrides bridge. config-overrides.js loads BEFORE app.js and reads
// host lazily for bootstrap hydration helpers that depend on later app.js defs.
window.JobBoredApp.configOverrides = window.JobBoredApp.configOverrides || {};
window.JobBoredApp.configOverrides.host = {
  getDiscoveryWebhookUrl,
  getDiscoveryWebhookSecret,
  normalizeDiscoveryWebhookIdentity,
  isLocalWebhookCandidateUrl,
  buildDiscoveryTunnelTargetUrl,
  inferCloudflareWorkerNameFromOpenWorkerUrl,
};

// Apps Script / relay helpers bridge. apps-script-relay-helpers.js loads BEFORE
// app.js; settings/webhook deps are published here after hoisted wrappers exist.
window.JobBoredDiscovery.relayHelpers =
  window.JobBoredDiscovery.relayHelpers || {};
window.JobBoredDiscovery.relayHelpers.host = {
  copyTextToClipboard,
  getSettingsSheetIdValue,
  getSettingsFieldValue,
  getDiscoveryWebhookUrl,
  normalizeDiscoveryWebhookIdentity,
};

// Discovery setup-wizard UI bridge. discovery-wizard-ui.js loads BEFORE app.js,
// so it cannot capture these references at its own load time — app.js publishes
// them here (after every helper is hoisted) and the UI file reads
// `window.JobBoredDiscoveryWizard.ui.host` lazily inside each function.
window.JobBoredDiscoveryWizard = window.JobBoredDiscoveryWizard || {};
window.JobBoredDiscoveryWizard.ui = window.JobBoredDiscoveryWizard.ui || {};
window.JobBoredDiscoveryWizard.ui.host = {
  showToast,
  refreshDiscoveryReadinessSnapshot,
  getDiscoveryWizardRuntime,
  updateDiscoveryWizardRuntime,
  createDiscoveryWizardRuntime,
  clearDiscoveryWizardRuntime,
  persistDiscoveryWizardState,
  triggerDiscoveryRun,
  isOnboardingWizardVisible,
  hideOnboardingWizard,
  showOnboardingWizard,
  isSettingsModalOpen,
  closeCommandCenterSettingsModal,
  openCommandCenterSettingsModal,
  installKeepAliveOnce,
  handleAppsScriptBrowserCorsFailure,
  diagnoseDownstreamChain,
  copyTextToClipboard,
  getSettingsSheetIdValue,
  isLocalDashboardOrigin,
  normalizeDiscoveryWebhookIdentity,
  mapDiscoveryWizardFlow,
  getDiscoveryWizardStepIds,
  getDiscoveryWizardStepsBefore,
  getDiscoveryWizardDefaultDrafts,
  getDiscoveryReadinessSnapshot,
  escapeHtml,
  getDiscoveryWizardShellApi,
  getDiscoveryWizardProbesApi,
  getDiscoveryWizardLocalApi,
  getDiscoveryWizardRelayApi,
  getDiscoveryWizardVerifyApi,
  inferLocalWebhookPort,
  getDiscoveryLocalEngineKind,
  getDiscoveryLocalEngineLabel,
  getDiscoveryLocalEngineSummary,
  getDiscoveryRecoveryCopy,
  getDiscoverySettingsView,
  isLikelyCloudflareWorkerUrl,
  probeNgrokFromLocalApi,
  // Phase 1b: orchestration-layer deps (render/open/handle moved into the UI file).
  closeDiscoverySetupGuideModal,
  showDiscoveryVerificationToast,
  buildDiscoveryWebhookPayload,
  verifyDiscoveryWebhookWithSharedModel,
  getDiscoveryEngineStateFromVerificationResult,
  recordDiscoveryEngineState,
  mergeStoredConfigOverridePatch,
  getDiscoveryWebhookUrl,
  writeDiscoveryTransportSetupState,
  createDiscoveryRelayCopyCommandToastAction,
  setDiscoveryWizardRuntime,
  getActiveSheetId,
  DISCOVERY_ENGINE_STATE_STUB_ONLY,
  DISCOVERY_ENGINE_STATE_UNVERIFIED,
};

// Daily Brief bridge. daily-brief.js loads BEFORE app.js and reads host lazily.
window.JobBoredApp = window.JobBoredApp || {};
window.JobBoredApp.brief = window.JobBoredApp.brief || {};
window.JobBoredApp.brief.host = {
  escapeHtml(...args) {
    return window.JobBoredApp.utils.escapeHtml(...args);
  },
  getPipelineData() {
    return pipelineData;
  },
  normalizeResponseFlag,
  responseLabelForDisplay,
  openJobDetail,
};

// Core bridge for extracted modules — host delegates + mutable-state accessors (Phase 1; no body moves).
window.JobBoredApp.core = window.JobBoredApp.core || {};
window.JobBoredApp.core.host = {
  showToast(...args) {
    return showToast(...args);
  },
  escapeHtml(...args) {
    return window.JobBoredApp.utils.escapeHtml(...args);
  },
  safeHref(...args) {
    return window.JobBoredApp.utils.safeHref(...args);
  },
  getConfig() {
    return getConfig();
  },
  getSheetId() {
    return getSheetId();
  },
  getActiveSheetId() {
    return getActiveSheetId();
  },
  getAccessToken() {
    return getAccessToken();
  },
  getUserEmail() {
    return getUserEmailFromAuth();
  },
  isSignedIn() {
    return isSignedIn();
  },
  refreshAccessTokenSilently() {
    return refreshAccessTokenSilently();
  },
  getPipelineData() {
    return pipelineData;
  },
  setPipelineData(data) {
    pipelineData = data;
  },
  getPipelineRawRows() {
    return pipelineRawRows;
  },
  setPipelineRawRows(rows) {
    pipelineRawRows = rows;
  },
  getPipelineViewFilters() {
    return getPipelineViewFilters();
  },
  setPipelineViewFilters(next) {
    return setPipelineViewFilters(next);
  },
  renderPipeline() {
    return renderPipeline();
  },
  renderBrief(...args) {
    return renderBrief(...args);
  },
  renderStats(...args) {
    return renderStats(...args);
  },
  renderExpiredReviewButton(...args) {
    return renderExpiredReviewButton(...args);
  },
  refreshDrawerIfOpen(...args) {
    return refreshDrawerIfOpen(...args);
  },
  loadAllData() {
    return loadAllData();
  },
  updateSheetCell(...args) {
    return updateSheetCell(...args);
  },
  updateMultipleCells(...args) {
    return updateMultipleCells(...args);
  },
  sheetsValuesAppend(...args) {
    return sheetsValuesAppend(...args);
  },
  sheetsValuesGet(...args) {
    return sheetsValuesGet(...args);
  },
  sheetsValuesUpdate(...args) {
    return sheetsValuesUpdate(...args);
  },
  sheetsBatchUpdate(...args) {
    return sheetsBatchUpdate(...args);
  },
  showSheetAccessGate(...args) {
    return window.JobBoredApp.setup.showSheetAccessGate(...args);
  },
  revealSetupScreenAfterAuth(...args) {
    return revealSetupScreenAfterAuth(...args);
  },
  renderSetupStarterSheetUi(...args) {
    return renderSetupStarterSheetUi(...args);
  },
  handleSetupCreateStarterSheet(...args) {
    return handleSetupCreateStarterSheet(...args);
  },
  getPendingSetupStarterSheetCreate() {
    return pendingSetupStarterSheetCreate;
  },
  setPendingSetupStarterSheetCreate(value) {
    pendingSetupStarterSheetCreate = !!value;
  },
  getLastSheetAccessError(...args) {
    return window.JobBoredApp.setup.getLastSheetAccessError(...args);
  },
  maybeSyncSettingsModalModeAfterAuth(...args) {
    return window.JobBoredApp.settings.maybeSyncSettingsModalModeAfterAuth(...args);
  },
  refreshPersonalPreferencesPanel(...args) {
    return refreshPersonalPreferencesPanel(...args);
  },
  showOnboardingWizard(...args) {
    return showOnboardingWizard(...args);
  },
  openCommandCenterSettingsModal(...args) {
    return window.JobBoredApp.settings.openCommandCenterSettingsModal(...args);
  },
  closeCommandCenterSettingsModal(...args) {
    return window.JobBoredApp.settings.closeCommandCenterSettingsModal(...args);
  },
  getUserContent() {
    return getUserContent();
  },
  getResumeBundle() {
    return getResumeBundle();
  },
  getResumeGenerate() {
    return getResumeGenerate();
  },
  getResumeIngest() {
    return getResumeIngest();
  },
  closeAuthUserMenu() {
    return closeAuthUserMenu();
  },
  fillDocumentTemplateSelect(...args) {
    return fillDocumentTemplateSelect(...args);
  },
  fillVisualThemeSelect(...args) {
    return fillVisualThemeSelect(...args);
  },
  dismissJob(...args) {
    return dismissJob(...args);
  },
  getSheetRow(...args) {
    return getSheetRow(...args);
  },
  getJobPostingScrapeUrl() {
    return getJobPostingScrapeUrl();
  },
  isScraperUrlBlockedOnThisPage(...args) {
    return isScraperUrlBlockedOnThisPage(...args);
  },
  buildCandidateProfileExcerpt(...args) {
    return buildCandidateProfileExcerpt(...args);
  },
  getCachedEnrichmentForJob(...args) {
    return getCachedEnrichmentForJob(...args);
  },
  cacheEnrichment(...args) {
    return cacheEnrichment(...args);
  },
  applyEnrichmentCache(...args) {
    return applyEnrichmentCache(...args);
  },
  getDraftsForJob(...args) {
    return getDraftsForJob(...args);
  },
  refreshGeneratedDraftLibraryCache(...args) {
    return refreshGeneratedDraftLibraryCache(...args);
  },
  getAtsScoringConfig() {
    return getAtsScoringConfig();
  },
  getAtsScorecardApiUrl() {
    return getAtsScorecardApiUrl();
  },
  renderResumeGenerateInsights(...args) {
    return renderResumeGenerateInsights(...args);
  },
  getJobOpportunityKey(...args) {
    return getJobOpportunityKey(...args);
  },
  openMaterialsModal(...args) {
    return openMaterialsModal(...args);
  },
  getResumeIngestReady(...args) {
    return getResumeIngestReady(...args);
  },
  normalizeProfileTextInput(...args) {
    return normalizeProfileTextInput(...args);
  },
  readStoredConfigOverrides() {
    return readStoredConfigOverrides();
  },
  mergeStoredConfigOverridePatch(...args) {
    return mergeStoredConfigOverridePatch(...args);
  },
  resolveGeminiModel(...args) {
    return resolveGeminiModel(...args);
  },
  callDiscoveryAiGemini(...args) {
    return callDiscoveryAiGemini(...args);
  },
  parseJsonSafeForSuggestions(...args) {
    return parseJsonSafeForSuggestions(...args);
  },
  resumePendingDiscoverySetupIfNeeded(...args) {
    return resumePendingDiscoverySetupIfNeeded(...args);
  },
  normalizeDashboardTitle(...args) {
    return normalizeDashboardTitle(...args);
  },
  parseGoogleSheetId(...args) {
    return window.JobBoredApp.configCore.parseGoogleSheetId(...args);
  },
  writeStoredConfigOverrides(...args) {
    return writeStoredConfigOverrides(...args);
  },
  canUseLocalStorage() {
    return canUseLocalStorage();
  },
  applyOAuthClientChange(...args) {
    return applyOAuthClientChange(...args);
  },
  syncDiscoveryButtonState() {
    return syncDiscoveryButtonState();
  },
  setDashboardSheetLinks() {
    return window.JobBoredApp.setup.setDashboardSheetLinks();
  },
  setSHEET_ID(value) {
    SHEET_ID = value;
  },
  normalizeDiscoveryWebhookIdentity(...args) {
    return normalizeDiscoveryWebhookIdentity(...args);
  },
  recordDiscoveryEngineState(...args) {
    return recordDiscoveryEngineState(...args);
  },
  getManagedAppsScriptWebhookIdentity() {
    return getManagedAppsScriptWebhookIdentity();
  },
  getSavedDiscoveryEngineStateForUrl(...args) {
    return getSavedDiscoveryEngineStateForUrl(...args);
  },
  getDiscoveryEngineStateNone() {
    return DISCOVERY_ENGINE_STATE_NONE;
  },
  getDiscoveryEngineStateStubOnly() {
    return DISCOVERY_ENGINE_STATE_STUB_ONLY;
  },
  getDiscoveryEngineStateUnverified() {
    return DISCOVERY_ENGINE_STATE_UNVERIFIED;
  },
  clearSessionAuthState() {
    return clearSessionAuthState();
  },
  clearPersistedOAuthSession() {
    return clearPersistedOAuthSession();
  },
  clearPersistedRuntimeOAuthSession() {
    return clearPersistedRuntimeOAuthSession();
  },
  getCommandCenterConfigOverrideKey() {
    return COMMAND_CENTER_CONFIG_OVERRIDE_KEY;
  },
  getDiscoveryTransportSetupKey() {
    return DISCOVERY_TRANSPORT_SETUP_KEY;
  },
  getDiscoveryRunTrackerKey() {
    return DISCOVERY_RUN_TRACKER_KEY;
  },
  getForceConsentPromptKey() {
    return FORCE_CONSENT_PROMPT_KEY;
  },
  populateAppsScriptDeployStateIntoSettingsForm() {
    return populateAppsScriptDeployStateIntoSettingsForm();
  },
  renderAppsScriptDeployUi() {
    return renderAppsScriptDeployUi();
  },
  renderDiscoveryEngineStatusUi() {
    return renderDiscoveryEngineStatusUi();
  },
  deployAppsScriptStubFromSettings() {
    return deployAppsScriptStubFromSettings();
  },
  recheckAppsScriptPublicAccessFromSettings() {
    return recheckAppsScriptPublicAccessFromSettings();
  },
  copyTextToClipboard(...args) {
    return copyTextToClipboard(...args);
  },
  probeTunnelStaleBadge() {
    return probeTunnelStaleBadge();
  },
  requestDiscoverySetup(...args) {
    return requestDiscoverySetup(...args);
  },
  resetAppsScriptDeployModalState() {
    configCore.appsScriptDeployStatus = null;
    configCore.appsScriptDeployStateCache = null;
  },
  getAppsScriptDeployStateCache() {
    return configCore.appsScriptDeployStateCache;
  },
  clearAppsScriptDeployStatusIfIdle() {
    if (!configCore.appsScriptDeployBusy) configCore.appsScriptDeployStatus = null;
  },
  isAuthUserMenuOpen() {
    return isAuthUserMenuOpen();
  },
  closeScraperSetupModal() {
    return closeScraperSetupModal();
  },
  hideSettingsClearConfirmBar() {
    return hideSettingsClearConfirmBar();
  },
  getOAuthClientId() {
    return getOAuthClientId();
  },
  recordSheetAccessError(...args) {
    return window.JobBoredApp.setup.recordSheetAccessError(...args);
  },
  hasGrantedOauthScope(...args) {
    return hasGrantedOauthScope(...args);
  },
  getGoogleSheetsScope() {
    return GOOGLE_SHEETS_SCOPE;
  },
  getStarterPipelineHeaders() {
    return STARTER_PIPELINE_HEADERS;
  },
  getStarterPipelineHeaderRange() {
    return STARTER_PIPELINE_HEADER_RANGE;
  },
  installDoctor() {
    return installDoctor();
  },
  hasPendingDiscoverySetup() {
    return hasPendingDiscoverySetup();
  },
  getDataLoadFailed() {
    return dataLoadFailed;
  },
  setDataLoadFailed(value) {
    dataLoadFailed = value;
  },
  getDashboardDataHydrated() {
    return dashboardDataHydrated;
  },
  setDashboardDataHydrated(value) {
    dashboardDataHydrated = value;
  },
  getInitialSheetAccessResolved() {
    return initialSheetAccessResolved;
  },
  setInitialSheetAccessResolved(value) {
    initialSheetAccessResolved = value;
  },
  updateLastRefresh() {
    return updateLastRefresh();
  },
  maybeAutoOpenExpiredReviewModal(...args) {
    return maybeAutoOpenExpiredReviewModal(...args);
  },
  revealDashboardShell() {
    return window.JobBoredApp.setup.revealDashboardShell();
  },
  runPostAccessBootstrapOnce() {
    return runPostAccessBootstrapOnce();
  },
  markJobViewed(...args) {
    return markJobViewed(...args);
  },
  notifyPipelineRendered(...args) {
    return notifyPipelineRendered(...args);
  },
  toggleFavorite(...args) {
    return toggleFavorite(...args);
  },
  restoreJob(...args) {
    return restoreJob(...args);
  },
  updateJobStatus(...args) {
    return updateJobStatus(...args);
  },
  updateJobNotes(...args) {
    return updateJobNotes(...args);
  },
  updateFollowUpDate(...args) {
    return updateFollowUpDate(...args);
  },
  updateLastHeardFrom(...args) {
    return updateLastHeardFrom(...args);
  },
  updateJobResponseFlag(...args) {
    return updateJobResponseFlag(...args);
  },
  signIn(...args) {
    return signIn(...args);
  },
  selectedResponseSheetValue(...args) {
    return selectedResponseSheetValue(...args);
  },
  fetchJobPostingEnrichment(...args) {
    return fetchJobPostingEnrichment(...args);
  },
};

Object.assign(window.JobBoredApp.core, {
  getSHEET_ID() {
    return SHEET_ID;
  },
  setSHEET_ID(value) {
    SHEET_ID = value;
  },
  getPipelineData() {
    return pipelineData;
  },
  setPipelineData(data) {
    pipelineData = data;
  },
  getPipelineRawRows() {
    return pipelineRawRows;
  },
  setPipelineRawRows(rows) {
    pipelineRawRows = rows;
  },
  getAccessToken() {
    return getAccessToken();
  },
  setAccessToken(value) {
    return window.JobBoredApp.auth.setAccessToken(value);
  },
  getUserEmail() {
    return getUserEmailFromAuth();
  },
  setUserEmail(value) {
    return window.JobBoredApp.auth.setUserEmail(value);
  },
  getTokenExpiresAt() {
    return getTokenExpiresAt();
  },
  setTokenExpiresAt(value) {
    return window.JobBoredApp.auth.setTokenExpiresAt(value);
  },
  getTokenClient() {
    return getTokenClient();
  },
  setTokenClient(value) {
    return window.JobBoredApp.auth.setTokenClient(value);
  },
  getGisLoaded() {
    return getGisLoaded();
  },
  setGisLoaded(value) {
    return window.JobBoredApp.auth.setGisLoaded(value);
  },
  getPendingSetupStarterSheetCreate() {
    return pendingSetupStarterSheetCreate;
  },
  setPendingSetupStarterSheetCreate(value) {
    pendingSetupStarterSheetCreate = value;
  },
  getCurrentSort() {
    return currentSort;
  },
  setCurrentSort(value) {
    currentSort = value;
  },
  getCurrentSearch() {
    return currentSearch;
  },
  setCurrentSearch(value) {
    currentSearch = value;
  },
  getFavoritesOnly() {
    return favoritesOnly;
  },
  setFavoritesOnly(value) {
    favoritesOnly = value;
  },
  getShowDismissed() {
    return showDismissed;
  },
  setShowDismissed(value) {
    showDismissed = value;
  },
  getActiveDetailKey() {
    return activeDetailKey;
  },
  setActiveDetailKey(value) {
    activeDetailKey = value;
  },
  getViewedJobKeys() {
    return viewedJobKeys;
  },
  getExpandedStages() {
    return expandedStages;
  },
  getDataLoadFailed() {
    return dataLoadFailed;
  },
  getBriefActivityRange() {
    return window.JobBoredApp.brief.getBriefActivityRange();
  },
  setBriefActivityRange(range) {
    return window.JobBoredApp.brief.setBriefActivityRange(range);
  },
  getLastResumeGenerationSession() {
    return window.JobBoredApp.resumeGeneration.getLastResumeGenerationSession();
  },
  setLastResumeGenerationSession(value) {
    return window.JobBoredApp.resumeGeneration.setLastResumeGenerationSession(value);
  },
  getAtsScorecardState() {
    return window.JobBoredApp.materialsState.getAtsScorecardState();
  },
  setAtsScorecardState(next) {
    return window.JobBoredApp.materialsState.setAtsScorecardState(next);
  },
  getGeneratedDraftLibraryCache() {
    return window.JobBoredApp.materialsState.getGeneratedDraftLibraryCache();
  },
  setGeneratedDraftLibraryCache(next) {
    return window.JobBoredApp.materialsState.setGeneratedDraftLibraryCache(next);
  },
  getCandidateProfileMatchCache() {
    return window.JobBoredApp.keywordMatch.getCandidateProfileMatchCache();
  },
  setCandidateProfileMatchCache(next) {
    return window.JobBoredApp.keywordMatch.setCandidateProfileMatchCache(next);
  },
});

// Thin delegating wrappers for wizard functions that now live in
// discovery-wizard-ui.js but are still called by bare name from app.js code
// that stays here. Each preserves one external call site without rewiring it:
//   getDiscoveryWizardRecommendedFlow -> openSettingsForDiscoveryWebhook
//   renderDiscoverySetupWizard        -> refreshDiscoveryUiState
//   openDiscoverySetupWizard          -> requestDiscoverySetup (+ keeps the
//                                        async(options) entry-point symbol)
//   setDiscoveryWizardMessage         -> ensureLocalDiscoveryAutoSetupForRun
function getDiscoveryWizardRecommendedFlow(...args) {
  return window.JobBoredDiscoveryWizard.ui.getDiscoveryWizardRecommendedFlow(
    ...args,
  );
}
function renderDiscoverySetupWizard(...args) {
  return window.JobBoredDiscoveryWizard.ui.renderDiscoverySetupWizard(...args);
}
async function openDiscoverySetupWizard(options = {}) {
  return window.JobBoredDiscoveryWizard.ui.openSetupWizard(options);
}
function setDiscoveryWizardMessage(...args) {
  return window.JobBoredDiscoveryWizard.ui.setDiscoveryWizardMessage(...args);
}

/**
 * POST a test payload from the Settings form (same shape as Run discovery).
 * Uses unsaved field values so you can test before Save.
 */
async function testDiscoveryWebhookFromSettings() {
  const urlEl = document.getElementById("settingsDiscoveryWebhookUrl");
  const secretEl = document.getElementById("settingsDiscoveryWebhookSecret");
  const sheetEl = document.getElementById("settingsSheetId");
  const url = normalizeDiscoveryWebhookIdentity(urlEl && urlEl.value.trim());
  const secret = secretEl ? String(secretEl.value || "").trim() : "";
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
      secret,
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
      (result.kind === "network_error" || result.kind === "invalid_endpoint") &&
      (await handleAppsScriptBrowserCorsFailure(url, result.kind))
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
    bannerDetail.textContent = `Run ngrok http ${port} to restart the public tunnel to your local worker, then click Detect.`;
    bannerAction.style.display = "none";
    return;
  }

  if (storedUrl && liveUrl !== storedUrl) {
    banner.style.display = "flex";
    banner.className = "tunnel-stale-banner";
    bannerTitle.textContent = "Public tunnel changed.";
    bannerDetail.textContent = [
      "ngrok gave your local setup a new public URL.",
      `Previous tunnel: ${storedUrl}`,
      `Current tunnel: ${liveUrl}`,
      "Use the current tunnel URL here, then redeploy the Cloudflare relay. Keep the same Worker URL saved in JobBored.",
    ].join("\n");
    bannerAction.textContent = "Use current URL";
    bannerAction.style.display = "";
    bannerAction.onclick = () => {
      const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
      if (tunnelInput) tunnelInput.value = liveUrl;
      renderDiscoveryLocalTunnelSetupUi();
      saveDiscoveryLocalTunnelSetup(true);
      const relayBtn = document.getElementById("discoveryLocalTunnelRelayBtn");
      if (relayBtn && typeof relayBtn.focus === "function") relayBtn.focus();
      showToast(
        "Tunnel URL updated. Redeploy the Cloudflare relay so it points at the new tunnel. Keep the same Worker URL saved in JobBored.",
        "info",
      );
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

async function handleAppsScriptBrowserCorsFailure(
  url,
  resultKind = "network_error",
) {
  if (!isLikelyAppsScriptWebAppUrl(url)) return false;
  const isNetworkLikeFailure =
    (resultKind === "network_error" &&
      isManagedAppsScriptDeployState(configCore.appsScriptDeployStateCache)) ||
    (resultKind === "invalid_endpoint" &&
      isManagedAppsScriptDeployState(configCore.appsScriptDeployStateCache));
  if (!isNetworkLikeFailure) return false;
  if (
    isManagedAppsScriptDeployState(configCore.appsScriptDeployStateCache) &&
    !isAppsScriptPublicAccessReady(configCore.appsScriptDeployStateCache)
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
      void requestDiscoverySetup({
        entryPoint: "settings",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("settingsDiscoveryLocalSetupBtn")
    ?.addEventListener("click", () => {
      void requestDiscoverySetup({
        entryPoint: "settings",
        flow: "local_agent",
        startStep: "bootstrap",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("settingsDiscoveryRelayBtn")
    ?.addEventListener("click", () => {
      void requestDiscoverySetup({
        entryPoint: "settings",
        flow: "local_agent",
        startStep: "relay_deploy",
        allowWhileOnboarding: true,
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
      void requestDiscoverySetup({
        entryPoint: "guide",
        flow: "local_agent",
        startStep: "bootstrap",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("discoverySetupGuideRelayBtn")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
      void requestDiscoverySetup({
        entryPoint: "guide",
        flow: "local_agent",
        startStep: "relay_deploy",
        allowWhileOnboarding: true,
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
      void requestDiscoverySetup({
        entryPoint: "help",
        allowWhileOnboarding: true,
      });
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


// ============================================
// RENDERING
// ============================================

// --- Pipeline render (extracted to pipeline-render.js) ---
function renderAll(...args) {
  return window.JobBoredApp.pipelineRender.renderAll(...args);
}
function renderStats(...args) {
  return window.JobBoredApp.pipelineRender.renderStats(...args);
}
function animateNumber(...args) {
  return window.JobBoredApp.pipelineRender.animateNumber(...args);
}
function normalizeStatusStr(...args) {
  return window.JobBoredApp.pipelineRender.normalizeStatusStr(...args);
}
function isInboxJob(...args) {
  return window.JobBoredApp.pipelineRender.isInboxJob(...args);
}
function stageToCssKey(...args) {
  return window.JobBoredApp.pipelineRender.stageToCssKey(...args);
}
function renderRoleFactsHtml(...args) {
  return window.JobBoredApp.pipelineRender.renderRoleFactsHtml(...args);
}
function groupByStage(...args) {
  return window.JobBoredApp.pipelineRender.groupByStage(...args);
}
function renderKanbanCard(...args) {
  return window.JobBoredApp.pipelineRender.renderKanbanCard(...args);
}
function applyLegacyKanbanCap(...args) {
  return window.JobBoredApp.pipelineRender.applyLegacyKanbanCap(...args);
}
function renderLegacyKanbanHiddenAffordance(...args) {
  return window.JobBoredApp.pipelineRender.renderLegacyKanbanHiddenAffordance(...args);
}
function renderStageLane(...args) {
  return window.JobBoredApp.pipelineRender.renderStageLane(...args);
}
function renderPipelineBoard(...args) {
  return window.JobBoredApp.pipelineRender.renderPipelineBoard(...args);
}
function handleDetailEscape(...args) {
  return window.JobBoredApp.pipelineRender.handleDetailEscape(...args);
}
function renderStageStepper(...args) {
  return window.JobBoredApp.pipelineRender.renderStageStepper(...args);
}
function renderDrawerContent(...args) {
  return window.JobBoredApp.pipelineRender.renderDrawerContent(...args);
}
function openJobDetail(...args) {
  return window.JobBoredApp.pipelineRender.openJobDetail(...args);
}
function closeJobDetail(...args) {
  return window.JobBoredApp.pipelineRender.closeJobDetail(...args);
}
function refreshDrawerIfOpen(...args) {
  return window.JobBoredApp.pipelineRender.refreshDrawerIfOpen(...args);
}
function updateTrackIndicator(...args) {
  return window.JobBoredApp.pipelineRender.updateTrackIndicator(...args);
}
function updateNavVisibility(...args) {
  return window.JobBoredApp.pipelineRender.updateNavVisibility(...args);
}
function attachBoardListeners(...args) {
  return window.JobBoredApp.pipelineRender.attachBoardListeners(...args);
}
function filterAndSortJobs(...args) {
  return window.JobBoredApp.pipelineRender.filterAndSortJobs(...args);
}
function renderPipeline(...args) {
  return window.JobBoredApp.pipelineRender.renderPipeline(...args);
}
function renderCardActions(...args) {
  return window.JobBoredApp.pipelineRender.renderCardActions(...args);
}
function attachCardListeners(...args) {
  return window.JobBoredApp.pipelineRender.attachCardListeners(...args);
}



// --- Daily Brief (delegates to daily-brief.js) ---
function renderBrief(...args) {
  return window.JobBoredApp.brief.renderBrief(...args);
}

function renderAreaWidget(...args) {
  return window.JobBoredApp.brief.renderAreaWidget(...args);
}

function renderPipelineDailyBrief(...args) {
  return window.JobBoredApp.brief.renderPipelineDailyBrief(...args);
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


// ============================================
// UTILITY
// ============================================

function escapeHtml(...args) {
  return window.JobBoredApp.utils.escapeHtml(...args);
}

function safeHref(...args) {
  return window.JobBoredApp.utils.safeHref(...args);
}

// --- Expired review UI (extracted to expired-review-ui.js) ---
function getExpiredReviewItems(...args) {
  return window.JobBoredApp.expiredReview.getExpiredReviewItems(...args);
}
function renderExpiredReviewButton(...args) {
  return window.JobBoredApp.expiredReview.renderExpiredReviewButton(...args);
}
function renderExpiredReviewModal(...args) {
  return window.JobBoredApp.expiredReview.renderExpiredReviewModal(...args);
}
function openExpiredReviewModal(...args) {
  return window.JobBoredApp.expiredReview.openExpiredReviewModal(...args);
}
function closeExpiredReviewModal(...args) {
  return window.JobBoredApp.expiredReview.closeExpiredReviewModal(...args);
}
function maybeAutoOpenExpiredReviewModal(...args) {
  return window.JobBoredApp.expiredReview.maybeAutoOpenExpiredReviewModal(...args);
}
function initExpiredReviewUi(...args) {
  return window.JobBoredApp.expiredReview.initExpiredReviewUi(...args);
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

function getAtsScorecardState() {
  return window.JobBoredApp.materialsState.getAtsScorecardState();
}

function getGeneratedDraftLibraryCache() {
  return window.JobBoredApp.materialsState.getGeneratedDraftLibraryCache();
}

function setAtsScorecardState(next) {
  return window.JobBoredApp.materialsState.setAtsScorecardState(next);
}

function getUserContent() {
  return window.JobBoredApp.materialsState.getUserContent();
}

function getResumeBundle() {
  return window.JobBoredApp.materialsState.getResumeBundle();
}

function getResumeGenerate() {
  return window.JobBoredApp.materialsState.getResumeGenerate();
}

function getResumeIngest() {
  return window.JobBoredApp.materialsState.getResumeIngest();
}

async function getResumeIngestReady(maxWaitMs) {
  return window.JobBoredApp.materialsState.getResumeIngestReady(maxWaitMs);
}

function getJobOpportunityKey(job) {
  return window.JobBoredApp.materialsState.getJobOpportunityKey(job);
}

function getDraftFeatureLabel(feature) {
  return window.JobBoredApp.materialsState.getDraftFeatureLabel(feature);
}

function getDraftModeLabel(mode) {
  return window.JobBoredApp.materialsState.getDraftModeLabel(mode);
}

function formatDraftSavedAt(iso) {
  return window.JobBoredApp.materialsState.formatDraftSavedAt(iso);
}

function rebuildGeneratedDraftLibraryCache(rows) {
  return window.JobBoredApp.materialsState.rebuildGeneratedDraftLibraryCache(
    rows,
  );
}

async function refreshGeneratedDraftLibraryCache() {
  return window.JobBoredApp.materialsState.refreshGeneratedDraftLibraryCache();
}

function scheduleGeneratedDraftLibraryRefresh(shouldRender) {
  return window.JobBoredApp.materialsState.scheduleGeneratedDraftLibraryRefresh(
    shouldRender,
  );
}

function getDraftsForJob(job, feature) {
  return window.JobBoredApp.materialsState.getDraftsForJob(job, feature);
}

function getDraftByIdFromCache(id) {
  return window.JobBoredApp.materialsState.getDraftByIdFromCache(id);
}

function renderDraftDeckPanel(...args) {
  return window.JobBoredApp.resumeGeneration.renderDraftDeckPanel(...args);
}

function renderDraftLibraryCardHtml(...args) {
  return window.JobBoredApp.resumeGeneration.renderDraftLibraryCardHtml(...args);
}

function getResumeGenerateDraftTextForInsights(...args) {
  return window.JobBoredApp.resumeGeneration.getResumeGenerateDraftTextForInsights(...args);
}

function scheduleResumeGenerateAtsRefresh(...args) {
  return window.JobBoredApp.resumeGeneration.scheduleResumeGenerateAtsRefresh(...args);
}

function renderDraftHistoryItemHtml(...args) {
  return window.JobBoredApp.resumeGeneration.renderDraftHistoryItemHtml(...args);
}

function renderResumeGenerateInsights(...args) {
  return window.JobBoredApp.resumeGeneration.renderResumeGenerateInsights(...args);
}

function openDraftNotesModal(...args) {
  return window.JobBoredApp.resumeGeneration.openDraftNotesModal(...args);
}

async function reviseLetterDraftForJob(...args) {
  return window.JobBoredApp.resumeGeneration.reviseLetterDraftForJob(...args);
}

function closeDraftNotesModal(...args) {
  return window.JobBoredApp.resumeGeneration.closeDraftNotesModal(...args);
}

async function openResumeGenerateModal(...args) {
  return window.JobBoredApp.resumeGeneration.openResumeGenerateModal(...args);
}

function closeResumeGenerateModal(...args) {
  return window.JobBoredApp.resumeGeneration.closeResumeGenerateModal(...args);
}

async function runResumeGeneration(...args) {
  return window.JobBoredApp.resumeGeneration.runResumeGeneration(...args);
}

async function refineLastResumeGeneration(...args) {
  return window.JobBoredApp.resumeGeneration.refineLastResumeGeneration(...args);
}

async function openSavedDraftVersion(...args) {
  return window.JobBoredApp.resumeGeneration.openSavedDraftVersion(...args);
}

async function openLatestSavedDraftForJob(...args) {
  return window.JobBoredApp.resumeGeneration.openLatestSavedDraftForJob(...args);
}

function buildDraftNotesPrefill(...args) {
  return window.JobBoredApp.resumeGeneration.buildDraftNotesPrefill(...args);
}


async function buildCandidateProfileExcerpt(UC, maxChars) {
  return window.JobBoredApp.materialsState.buildCandidateProfileExcerpt(
    UC,
    maxChars,
  );
}

if (typeof window !== "undefined") {
  window.openDraftNotesModal = openDraftNotesModal;
  window.reviseLetterDraftForJob = reviseLetterDraftForJob;
  window.getDraftsForJob = getDraftsForJob;
  window.openSavedDraftVersion = openSavedDraftVersion;
  window.getPipelineJobByIndex = function (idx) {
    var n = Number(idx);
    if (!Number.isFinite(n)) return null;
    return pipelineData[n] || null;
  };
  window.runResumeGeneration = runResumeGeneration;
  window.buildDraftNotesPrefill = buildDraftNotesPrefill;
  window.getWorkshopProfileSummary = async function () {
    return window.JobBoredApp.resumeGeneration.getWorkshopProfileSummary();
  };
}


// --- Keyword / profile-match (extracted to keyword-profile-match.js) ---
// Thin delegating wrappers keep bare-name call sites in app.js working.
// Module owns the candidateProfileMatchCache + all analysis logic under
// window.JobBoredApp.keywordMatch.
function renderProfileMatchBadgeHtml(job, dataIndex) {
  return window.JobBoredApp.keywordMatch.renderProfileMatchBadgeHtml(
    job,
    dataIndex,
  );
}

function openProfileMatchModal(job, dataIndex) {
  return window.JobBoredApp.keywordMatch.openProfileMatchModal(job, dataIndex);
}

function renderMatchItemsHtml(terms, itemClassName) {
  return window.JobBoredApp.keywordMatch.renderMatchItemsHtml(
    terms,
    itemClassName,
  );
}

function refreshCandidateProfileMatchCache() {
  return window.JobBoredApp.keywordMatch.refreshCandidateProfileMatchCache();
}

function scheduleCandidateProfileMatchRefresh(shouldRender) {
  return window.JobBoredApp.keywordMatch.scheduleCandidateProfileMatchRefresh(
    shouldRender,
  );
}

// --- ATS scorecard (extracted to ats-scorecard.js) ---
function computeAtsScorecardCacheKey(...args) {
  return window.JobBoredApp.ats.computeAtsScorecardCacheKey(...args);
}

function buildAtsScorecardRequestPayload(...args) {
  return window.JobBoredApp.ats.buildAtsScorecardRequestPayload(...args);
}

function startAtsScorecardAnalysis(...args) {
  return window.JobBoredApp.ats.startAtsScorecardAnalysis(...args);
}

function sanitizeAtsText(...args) {
  return window.JobBoredApp.ats.sanitizeAtsText(...args);
}

function formatAtsDimensionSummary(...args) {
  return window.JobBoredApp.ats.formatAtsDimensionSummary(...args);
}

function renderAtsScorecardGroupsHtml(...args) {
  return window.JobBoredApp.ats.renderAtsScorecardGroupsHtml(...args);
}


// --- Sheets read/load (extracted to sheets-read-load.js) ---
function loadAllData(...args) {
  return window.JobBoredApp.sheetsRead.loadAllData(...args);
}
function applyFavoriteCache(...args) {
  return window.JobBoredApp.sheetsRead.applyFavoriteCache(...args);
}
function favoriteCacheKeyForJob(...args) {
  return window.JobBoredApp.sheetsRead.favoriteCacheKeyForJob(...args);
}
function setPendingFavorite(...args) {
  return window.JobBoredApp.sheetsRead.setPendingFavorite(...args);
}
function clearPendingFavorite(...args) {
  return window.JobBoredApp.sheetsRead.clearPendingFavorite(...args);
}

// --- Posting enrichment (extracted to posting-enrichment.js) ---
function cacheEnrichment(...args) {
  return window.JobBoredApp.postingEnrichment.cacheEnrichment(...args);
}
function getCachedEnrichmentForJob(...args) {
  return window.JobBoredApp.postingEnrichment.getCachedEnrichmentForJob(...args);
}
function applyEnrichmentCache(...args) {
  return window.JobBoredApp.postingEnrichment.applyEnrichmentCache(...args);
}
async function fetchJobPostingEnrichment(...args) {
  return window.JobBoredApp.postingEnrichment.fetchJobPostingEnrichment(...args);
}
async function fallbackEnrichmentFromSheetOnly(...args) {
  return window.JobBoredApp.postingEnrichment.fallbackEnrichmentFromSheetOnly(...args);
}
function isUsableCachedEnrichment(...args) {
  return window.JobBoredApp.postingEnrichment.isUsableCachedEnrichment(...args);
}

// --- Company logo (extracted to company-logo.js) ---
function renderLogoHtml(...args) {
  return window.JobBoredApp.companyLogo.renderLogoHtml(...args);
}
function isPlaceholderLogoUrl(...args) {
  return window.JobBoredApp.companyLogo.isPlaceholderLogoUrl(...args);
}
async function resolveCompanyLogoUrl(...args) {
  return window.JobBoredApp.companyLogo.resolveCompanyLogoUrl(...args);
}

// --- Profile materials (extracted to profile-materials.js) ---
function profileApplyResumeFile(...args) {
  return window.JobBoredApp.profileMaterials.profileApplyResumeFile(...args);
}
async function profileApplySampleFiles(...args) {
  return window.JobBoredApp.profileMaterials.profileApplySampleFiles(...args);
}
function bindProfileDropzone(...args) {
  return window.JobBoredApp.profileMaterials.bindProfileDropzone(...args);
}
function renderLinkedInProfileMeta(...args) {
  return window.JobBoredApp.profileMaterials.renderLinkedInProfileMeta(...args);
}
function renderAdditionalContextMeta(...args) {
  return window.JobBoredApp.profileMaterials.renderAdditionalContextMeta(...args);
}
function normalizeProfileTextInput(...args) {
  return window.JobBoredApp.profileMaterials.normalizeProfileTextInput(...args);
}
function collectLinkedInCaptureSections(...args) {
  return window.JobBoredApp.profileMaterials.collectLinkedInCaptureSections(...args);
}
function buildLinkedInCaptureProfileText(...args) {
  return window.JobBoredApp.profileMaterials.buildLinkedInCaptureProfileText(...args);
}
function getLinkedInCaptureCompleteness(...args) {
  return window.JobBoredApp.profileMaterials.getLinkedInCaptureCompleteness(...args);
}
function updateLinkedInCapturePreview(...args) {
  return window.JobBoredApp.profileMaterials.updateLinkedInCapturePreview(...args);
}
function openLinkedInCaptureModal(...args) {
  return window.JobBoredApp.profileMaterials.openLinkedInCaptureModal(...args);
}
function closeLinkedInCaptureModal(...args) {
  return window.JobBoredApp.profileMaterials.closeLinkedInCaptureModal(...args);
}
function applyPreferencesFromData(...args) {
  return window.JobBoredApp.profileMaterials.applyPreferencesFromData(...args);
}
async function refreshPersonalPreferencesPanel(...args) {
  return window.JobBoredApp.profileMaterials.refreshPersonalPreferencesPanel(...args);
}
async function refreshMaterialsUI(...args) {
  return window.JobBoredApp.profileMaterials.refreshMaterialsUI(...args);
}
function openMaterialsModal(...args) {
  return window.JobBoredApp.profileMaterials.openMaterialsModal(...args);
}
function closeMaterialsModal(...args) {
  return window.JobBoredApp.profileMaterials.closeMaterialsModal(...args);
}


// --- Onboarding wizard (extracted to onboarding-wizard.js) ---
function isOnboardingWizardVisible(...args) {
  return window.JobBoredApp.onboarding.isOnboardingWizardVisible(...args);
}
function hideOnboardingWizard(...args) {
  return window.JobBoredApp.onboarding.hideOnboardingWizard(...args);
}
function showOnboardingWizard(...args) {
  return window.JobBoredApp.onboarding.showOnboardingWizard(...args);
}
function updateOnboardingProgressUI(...args) {
  return window.JobBoredApp.onboarding.updateOnboardingProgressUI(...args);
}
function syncOnboardingToneCards(...args) {
  return window.JobBoredApp.onboarding.syncOnboardingToneCards(...args);
}
function renderOnboardingSummary(...args) {
  return window.JobBoredApp.onboarding.renderOnboardingSummary(...args);
}
function updateOnboardingMascotPose(...args) {
  return window.JobBoredApp.onboarding.updateOnboardingMascotPose(...args);
}
function setOnboardingStep(...args) {
  return window.JobBoredApp.onboarding.setOnboardingStep(...args);
}
function updateOnboardingContinue2Enabled(...args) {
  return window.JobBoredApp.onboarding.updateOnboardingContinue2Enabled(...args);
}
function updateOnboardingNext3Enabled(...args) {
  return window.JobBoredApp.onboarding.updateOnboardingNext3Enabled(...args);
}
async function checkOnboardingGate(...args) {
  return window.JobBoredApp.onboarding.checkOnboardingGate(...args);
}
function ensureResumeDraftFromPasteStep(...args) {
  return window.JobBoredApp.onboarding.ensureResumeDraftFromPasteStep(...args);
}
function initOnboardingWizard(...args) {
  return window.JobBoredApp.onboarding.initOnboardingWizard(...args);
}


// --- Settings modal (extracted to settings-modal.js) ---
function isSettingsModalOpen(...args) {
  return window.JobBoredApp.settings.isSettingsModalOpen(...args);
}
function fillOneResumeModelSelect(...args) {
  return window.JobBoredApp.settings.fillOneResumeModelSelect(...args);
}
function fillResumeModelSelectsFromConfig(...args) {
  return window.JobBoredApp.settings.fillResumeModelSelectsFromConfig(...args);
}
async function populateDiscoveryProfileIntoSettingsForm(...args) {
  return window.JobBoredApp.settings.populateDiscoveryProfileIntoSettingsForm(...args);
}
function populateCommandCenterSettingsForm(...args) {
  return window.JobBoredApp.settings.populateCommandCenterSettingsForm(...args);
}
function updateSettingsProviderPanels(...args) {
  return window.JobBoredApp.settings.updateSettingsProviderPanels(...args);
}
function isSettingsFullExperienceUnlocked(...args) {
  return window.JobBoredApp.settings.isSettingsFullExperienceUnlocked(...args);
}
function maybeSyncSettingsModalModeAfterAuth(...args) {
  return window.JobBoredApp.settings.maybeSyncSettingsModalModeAfterAuth(...args);
}
function syncSettingsModalMode(...args) {
  return window.JobBoredApp.settings.syncSettingsModalMode(...args);
}
function maybeApplyPhasedSettingsDefaultOAuthClientId(...args) {
  return window.JobBoredApp.settings.maybeApplyPhasedSettingsDefaultOAuthClientId(...args);
}
async function openCommandCenterSettingsModal(...args) {
  return window.JobBoredApp.settings.openCommandCenterSettingsModal(...args);
}
function hideSettingsClearConfirmBar(...args) {
  return window.JobBoredApp.settings.hideSettingsClearConfirmBar(...args);
}
function showSettingsClearConfirmBar(...args) {
  return window.JobBoredApp.settings.showSettingsClearConfirmBar(...args);
}
function closeCommandCenterSettingsModal(...args) {
  return window.JobBoredApp.settings.closeCommandCenterSettingsModal(...args);
}
async function saveCommandCenterSettingsFromForm(...args) {
  return window.JobBoredApp.settings.saveCommandCenterSettingsFromForm(...args);
}
async function performSettingsClearOverrides(...args) {
  return window.JobBoredApp.settings.performSettingsClearOverrides(...args);
}
function initCommandCenterSettings(...args) {
  return window.JobBoredApp.settings.initCommandCenterSettings(...args);
}


function initSetupAndSheetAccessActions(...args) {
  return window.JobBoredApp.setup.initSetupAndSheetAccessActions(...args);
}

function initPipelineEmptyAndBriefActions() {
  document
    .getElementById("emptyStateActions")
    ?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-empty-action]");
      if (!b) return;
      const a = b.getAttribute("data-empty-action");
      if (a === "settings" || a === "open_setup") {
        void requestDiscoverySetup({
          entryPoint: "empty_state",
          allowWhileOnboarding: true,
        });
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
        window.JobBoredApp.brief.setBriefActivityRange(rangeBtn.dataset.range);
        const el = document.getElementById("briefInsights");
        if (el && pipelineData.length)
          el.innerHTML = renderAreaWidget(
            pipelineData,
            window.JobBoredApp.brief.getBriefActivityRange(),
          );
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
        void requestDiscoverySetup({
          entryPoint: "brief",
          allowWhileOnboarding: true,
        });
      }
      if (a === "run_discovery") {
        void triggerDiscoveryRun();
      }
      if (a === "agent" || a === "paths") openDiscoveryPathsModal();
    });
}

function initResumeMaterialsFeature(...args) {
  return window.JobBoredApp.materials.initResumeMaterialsFeature(...args);
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
  // Check config
  SHEET_ID = getSheetId();
  initialSheetAccessResolved = false;
  postAccessBootstrapDone = false;
  postAccessBootstrapPromise = Promise.resolve();
  initAuthUserMenu();

  // Wire the onboarding wizard + resume materials handlers UNCONDITIONALLY,
  // BEFORE the no-SHEET_ID early return below.
  //
  // Why: greenfield first-time users land here with no SHEET_ID, see the
  // onboarding modal, drop a resume — but until this call ran, the
  // file-input change listener wasn't bound, so the upload silently did
  // nothing. The user experienced this as "I have to refresh the page in
  // order for the file selector to put the file visibly into the UX" —
  // because by the time they refreshed, sign-in had set SHEET_ID and the
  // listener finally got bound on the second pass.
  //
  // initResumeMaterialsFeature is internally idempotent and has no sheet
  // dependency: it opens IndexedDB and wires modal/file listeners. Safe
  // to run pre-SHEET_ID.
  initResumeMaterialsFeature();
  initDiscoveryDrawer();
  initDiscoverySubtabs();
  initDiscoveryButton();

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

  document.getElementById("setupScreen").style.display = "none";
  /* Refresh flicker fix:
     - If we have a valid runtime token cached in localStorage, the
       dashboard is going to render in milliseconds. Show it RIGHT NOW
       (not after silent-restore + data load) so the page doesn't go
       blank between paint and revealDashboardShell(). The dashboard
       briefly shows whatever was last rendered/empty until loadAllData
       repaints — far less jarring than a flash of the login gate or
       a flash of nothing at all.
     - If we only have METADATA persisted (no valid runtime token),
       silent-restore is about to fire; still skip the gate "loading"
       splash so we don't flicker the login illustration on refresh.
     - If we have nothing persisted, show the gate "loading" splash
       so the user has something to look at on a true cold start.
     If silent-restore fails downstream, the error paths in
     initAuth/handleTokenResponse open the gate with the right mode. */
  const hasRuntimeToken = !!loadPersistedRuntimeOAuthSession();
  const hasPersistedSession = !!loadPersistedOAuthSession();
  if (hasRuntimeToken) {
    /* Eager reveal — silent-restore will finish in <500ms, then
       loadAllData repaints. Until then the dashboard shell is visible
       with last-known DOM state (or its first-paint defaults). */
    document.getElementById("dashboard").style.display = "block";
  } else {
    document.getElementById("dashboard").style.display = "none";
    if (!hasPersistedSession) {
      showSheetAccessGate("loading");
    }
  }

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

  void preloadDiscoveryUiState();
  resumeDiscoveryStatusPollingIfNeeded();

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

  // Pipeline filter chips — favorites-only + show-dismissed
  const favChip = document.getElementById("favoritesOnlyChip");
  if (favChip) {
    favChip.addEventListener("click", () => {
      setPipelineViewFilters({ favoritesOnly: !favoritesOnly });
    });
  }
  const dismissedChip = document.getElementById("showDismissedChip");
  if (dismissedChip) {
    dismissedChip.addEventListener("click", () => {
      setPipelineViewFilters({ showDismissed: !showDismissed });
    });
  }
  syncPipelineFilterControls();
  initExpiredReviewUi();

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
      void requestDiscoverySetup({
        entryPoint: "toolbar",
        allowWhileOnboarding: true,
      });
    });

  // Init auth
  initAuth();

  // initResumeMaterialsFeature was hoisted above the no-SHEET_ID early
  // return so greenfield users can actually use the onboarding wizard's
  // file upload. Calling it again here would double-bind every listener
  // (addEventListener doesn't dedupe), so don't.

  loadAllData();

  setInterval(loadAllData, REFRESH_INTERVAL);
}

/**
 * Normalize a source preset value to a valid enum string or empty.
 * @param {unknown} raw
 * @returns {"" | "browser_only" | "ats_only" | "browser_plus_ats"}
 */
function normalizeSourcePreset(raw) {
  const SOURCE_PRESET_VALUES = Object.freeze([
    "browser_only",
    "ats_only",
    "browser_plus_ats",
  ]);
  const v = raw == null ? "" : String(raw).trim();
  if (SOURCE_PRESET_VALUES.includes(v)) return v;
  return "";
}

/**
 * Sync the source preset radio-group UI in the discovery prefs modal to
 * reflect the given normalized preset value. Highlights the active option.
 * @param {"" | "browser_only" | "ats_only" | "browser_plus_ats"} preset
 */
function syncSourcePresetUi(preset) {
  const VALID_PRESETS = ["browser_only", "ats_only", "browser_plus_ats"];
  const resolved = VALID_PRESETS.includes(preset) ? preset : "browser_plus_ats";
  document.querySelectorAll('input[name="dpSourcePreset"]').forEach((el) => {
    const isActive = el.value === resolved;
    el.checked = isActive;
    const option = el.closest(".dp-source-preset-option");
    if (option) {
      option.classList.toggle("dp-source-preset-option--active", isActive);
    }
  });
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
    openBtn.disabled = false;
    openBtn.removeAttribute("aria-disabled");
    openBtn.title =
      "Stub webhook only — click to tailor discovery, then connect a real engine before running.";
  } else {
    // No endpoint configured — keep button enabled so clicking opens the setup wizard.
    openBtn.disabled = false;
    openBtn.removeAttribute("aria-disabled");
    openBtn.title = view.primaryActionLabel
      ? `${view.primaryActionLabel} — click to open discovery setup.`
      : "Configure discovery in Settings, or click to open the setup wizard.";
  }
}

/**
 * In-memory state for the company targeting chips (allow/block).
 * Persisted into IndexedDB as part of the discoveryProfile on Run/Save.
 */
const discoveryDrawerState = {
  allow: [],
  block: [],
  /** Cached AI strata results so re-applying doesn't re-call the LLM. */
  strata: null,
};

// ────────────────────────────────────────────────────────────────────────────
// Per-run profile-driven preferences. Cleared when the discovery drawer closes.
// Never persisted — edits here do NOT write back to the master Fit Profile.
// The master profile lives at ~/.jobbored/profile.json and is served by
// GET /profile. The drawer treats it as a read-only source for defaults.
// ────────────────────────────────────────────────────────────────────────────
let discoveryRunProfileState = {
  baseProfile: null,      // UserProfile from GET /profile, or null when none
  perRunOverrides: {},    // Only fields the user explicitly edited this session
  fetchedAt: null,
};

/**
 * Load the master Fit Profile from GET /profile. Returns the profile or null.
 * Resilient to the endpoint being unavailable (treats as "no profile" state).
 */
async function loadMasterFitProfile() {
  try {
    const resp = await fetch("/profile", { method: "GET" });
    if (resp && resp.ok) {
      const data = await resp.json().catch(() => null);
      if (data && data.ok && data.profile) {
        discoveryRunProfileState = {
          baseProfile: data.profile,
          perRunOverrides: {},
          fetchedAt: new Date().toISOString(),
        };
        return data.profile;
      }
    }
  } catch (e) {
    console.warn("loadMasterFitProfile failed:", e);
  }
  discoveryRunProfileState = {
    baseProfile: null,
    perRunOverrides: {},
    fetchedAt: new Date().toISOString(),
  };
  return null;
}

/**
 * Returns the effective Fit Profile fields for THIS run only — base values
 * shadowed by any per-run overrides the user made in the drawer. Returns null
 * when no master profile is loaded (legacy free-form mode).
 */
function getEffectiveFitProfileFields() {
  const base = discoveryRunProfileState.baseProfile;
  const ov = discoveryRunProfileState.perRunOverrides;
  if (!base) return null;
  const identity = base.identity || {};
  const hc = base.hardConstraints || {};
  return {
    targetRoles: ov.targetRoles ?? (identity.targetRoles || []),
    targetSeniority: ov.targetSeniority ?? identity.targetSeniority,
    workMode: ov.workMode ?? hc.workMode,
    acceptableLocations:
      ov.acceptableLocations ?? (hc.acceptableLocations || []),
    wants: ov.wants ?? (base.wants || []),
    avoids: ov.avoids ?? (base.avoids || []),
  };
}

/**
 * Record (or clear) a per-run override for a single Fit Profile field.
 * If `value` is the same as the original base value, the override is removed
 * so getEffectiveFitProfileFields() falls through to the base profile.
 */
function setRunOverride(field, value, originalValue) {
  const same =
    Array.isArray(value) && Array.isArray(originalValue)
      ? value.length === originalValue.length &&
        value.every((v, i) => v === originalValue[i])
      : value === originalValue;
  if (same || value === undefined) {
    delete discoveryRunProfileState.perRunOverrides[field];
  } else {
    discoveryRunProfileState.perRunOverrides[field] = value;
  }
  const badge = document.querySelector(
    `[data-run-override-badge="${field}"]`,
  );
  if (badge) {
    badge.classList.toggle(
      "is-modified",
      field in discoveryRunProfileState.perRunOverrides,
    );
  }
}

// Map UserProfile.hardConstraints.workMode → legacy remotePolicy string
function workModeToRemotePolicy(workMode) {
  switch (workMode) {
    case "remote_only":
      return "remote";
    case "hybrid_ok":
      return "hybrid";
    case "onsite_ok":
      return "onsite";
    case "any":
    default:
      return "";
  }
}

// Map legacy remotePolicy string → UserProfile workMode (reverse direction)
function remotePolicyToWorkMode(remotePolicy) {
  const v = String(remotePolicy || "").trim().toLowerCase();
  if (!v) return "any";
  if (/remote/.test(v)) return "remote_only";
  if (/hybrid/.test(v)) return "hybrid_ok";
  if (/on[-\s]?site/.test(v)) return "onsite_ok";
  return "any";
}

// Map TargetSeniority enum → human-readable string for legacy payload field
function targetSeniorityToHuman(seniority) {
  switch (seniority) {
    case "intern":
      return "Intern";
    case "entry":
      return "Entry";
    case "ic_mid":
      return "Mid";
    case "ic_senior":
      return "Senior";
    case "ic_staff":
      return "Staff";
    case "ic_principal":
      return "Principal";
    case "manager":
      return "Manager";
    case "director":
      return "Director";
    case "head":
      return "Head";
    case "vp":
      return "VP";
    case "c_level":
      return "C-level";
    case "any":
    default:
      return "";
  }
}

/**
 * Render the empty-state banner shown when no master Fit Profile exists.
 * Inserts (or removes) a banner inside the discovery drawer body.
 */
function renderFitProfileEmptyState(profile) {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const body = drawer.querySelector(".discovery-drawer__body");
  if (!body) return;
  let banner = body.querySelector(".fit-profile-empty-banner");
  if (profile) {
    if (banner) banner.remove();
    // Restore visibility of fit-profile-driven inputs
    body
      .querySelectorAll("[data-fit-profile-input]")
      .forEach((el) => (el.hidden = false));
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "fit-profile-empty-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML =
      '<span class="fit-profile-empty-banner__text">Set up your Fit Profile so JobBored can score jobs accurately.</span>' +
      '<a class="fit-profile-empty-banner__cta" href="#/onboarding/fit-profile">Set up Fit Profile</a>';
    body.insertBefore(banner, body.firstChild);
  }
  // When no profile, hide the fields the profile would have populated
  body
    .querySelectorAll("[data-fit-profile-input]")
    .forEach((el) => (el.hidden = true));
}

/**
 * Pre-fill the existing drawer inputs from the master Fit Profile. Also
 * attaches "Reset to profile" affordances + modified-badge holders so the
 * user can see which fields they edited this run.
 */
function prefillDrawerFromFitProfile(profile) {
  if (!profile) return;
  const identity = profile.identity || {};
  const hc = profile.hardConstraints || {};

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value || "";
  };

  setText("dpTargetRoles", (identity.targetRoles || []).join(", "));
  setText("dpLocations", (hc.acceptableLocations || []).join(", "));
  setText("dpRemotePolicy", workModeToRemotePolicy(hc.workMode));
  setText("dpSeniority", targetSeniorityToHuman(identity.targetSeniority));

  attachRunOverrideAffordance("dpTargetRoles", "targetRoles", () =>
    (identity.targetRoles || []).join(", "),
  );
  attachRunOverrideAffordance("dpLocations", "acceptableLocations", () =>
    (hc.acceptableLocations || []).join(", "),
  );
  attachRunOverrideAffordance("dpRemotePolicy", "workMode", () =>
    workModeToRemotePolicy(hc.workMode),
  );
  attachRunOverrideAffordance("dpSeniority", "targetSeniority", () =>
    targetSeniorityToHuman(identity.targetSeniority),
  );

  // Wire change handlers that translate UI strings → UserProfile shapes.
  bindOverrideChange("dpTargetRoles", (val) => {
    const arr = String(val || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setRunOverride("targetRoles", arr, identity.targetRoles || []);
  });
  bindOverrideChange("dpLocations", (val) => {
    const arr = String(val || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setRunOverride(
      "acceptableLocations",
      arr,
      hc.acceptableLocations || [],
    );
  });
  bindOverrideChange("dpRemotePolicy", (val) => {
    const mode = remotePolicyToWorkMode(val);
    setRunOverride("workMode", mode, hc.workMode);
  });
  bindOverrideChange("dpSeniority", (val) => {
    // Free-text seniority — only treat exact case-insensitive matches as
    // recognized enum overrides; otherwise leave the base value untouched.
    const human = String(val || "").trim().toLowerCase();
    const baseHuman = (targetSeniorityToHuman(identity.targetSeniority) || "")
      .toLowerCase();
    if (!human || human === baseHuman) {
      setRunOverride("targetSeniority", undefined, identity.targetSeniority);
      return;
    }
    setRunOverride("targetSeniority", val, identity.targetSeniority);
  });
}

/**
 * Inserts a tiny "↻ Reset to profile" link + modified badge after the input
 * with id `inputId`. Idempotent — replaces any prior affordance.
 */
function attachRunOverrideAffordance(inputId, field, getBaseValue) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.setAttribute("data-fit-profile-input", field);

  // Remove any prior affordance row so re-opening the drawer doesn't stack.
  const prior = input.parentElement
    ? input.parentElement.querySelector(
        `[data-run-override-row="${field}"]`,
      )
    : null;
  if (prior) prior.remove();

  const row = document.createElement("div");
  row.className = "fit-profile-run-override-row";
  row.setAttribute("data-run-override-row", field);

  const badge = document.createElement("span");
  badge.className = "fit-profile-run-override-badge";
  badge.setAttribute("data-run-override-badge", field);
  badge.textContent = "modified for this run";
  row.appendChild(badge);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "fit-profile-run-override-reset";
  reset.textContent = "↻ Reset to profile";
  reset.addEventListener("click", () => {
    const baseValue = getBaseValue();
    input.value = baseValue;
    setRunOverride(field, undefined, baseValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  row.appendChild(reset);

  input.insertAdjacentElement("afterend", row);
}

/**
 * Bind an input/change handler that pipes the input's current value into
 * `handler`. Removes any prior handler we installed (tracked via dataset).
 */
function bindOverrideChange(inputId, handler) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.__fpOverrideHandler) {
    input.removeEventListener("input", input.__fpOverrideHandler);
  }
  const fn = () => handler(input.value);
  input.__fpOverrideHandler = fn;
  input.addEventListener("input", fn);
}

/**
 * Render the collapsible "Tuning from your Fit Profile" section that exposes
 * wants/avoids editing for this run only. Idempotent.
 */
function renderTuningFromProfile(profile) {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const body = drawer.querySelector(".discovery-drawer__body");
  if (!body) return;

  let section = body.querySelector(".fit-profile-tuning-section");
  if (!profile) {
    if (section) section.remove();
    return;
  }
  if (!section) {
    section = document.createElement("details");
    section.className = "fit-profile-tuning-section";
    section.setAttribute("data-fit-profile-input", "tuning");
    section.innerHTML = `
      <summary>Tuning from your Fit Profile</summary>
      <p class="fit-profile-tuning-section__lede">
        Edits here apply to this run only. Your master Fit Profile is unchanged.
      </p>
      <label class="field-label" for="dpRunWants">Wants (one per line)</label>
      <textarea id="dpRunWants" class="modal-input modal-textarea" rows="4"></textarea>
      <div class="fit-profile-run-override-row" data-run-override-row="wants">
        <span class="fit-profile-run-override-badge" data-run-override-badge="wants">modified for this run</span>
        <button type="button" class="fit-profile-run-override-reset" data-reset="wants">↻ Reset to profile</button>
      </div>
      <label class="field-label" for="dpRunAvoids">Avoids (one per line)</label>
      <textarea id="dpRunAvoids" class="modal-input modal-textarea" rows="4"></textarea>
      <div class="fit-profile-run-override-row" data-run-override-row="avoids">
        <span class="fit-profile-run-override-badge" data-run-override-badge="avoids">modified for this run</span>
        <button type="button" class="fit-profile-run-override-reset" data-reset="avoids">↻ Reset to profile</button>
      </div>
    `;
    body.appendChild(section);
  }

  const baseWants = Array.isArray(profile.wants) ? profile.wants : [];
  const baseAvoids = Array.isArray(profile.avoids) ? profile.avoids : [];

  const wantsEl = section.querySelector("#dpRunWants");
  const avoidsEl = section.querySelector("#dpRunAvoids");
  if (wantsEl) wantsEl.value = baseWants.join("\n");
  if (avoidsEl) avoidsEl.value = baseAvoids.join("\n");

  const linesOf = (v) =>
    String(v || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  if (wantsEl) {
    bindOverrideChange("dpRunWants", (val) =>
      setRunOverride("wants", linesOf(val), baseWants),
    );
  }
  if (avoidsEl) {
    bindOverrideChange("dpRunAvoids", (val) =>
      setRunOverride("avoids", linesOf(val), baseAvoids),
    );
  }

  section
    .querySelectorAll(".fit-profile-run-override-reset")
    .forEach((btn) => {
      const field = btn.getAttribute("data-reset");
      btn.onclick = () => {
        if (field === "wants" && wantsEl) {
          wantsEl.value = baseWants.join("\n");
          setRunOverride("wants", undefined, baseWants);
        } else if (field === "avoids" && avoidsEl) {
          avoidsEl.value = baseAvoids.join("\n");
          setRunOverride("avoids", undefined, baseAvoids);
        }
      };
    });
}

function discoveryDrawerEl() {
  return document.getElementById("discoveryDrawer");
}

function isDiscoveryDrawerOpen() {
  const d = discoveryDrawerEl();
  return !!d && d.style.display === "flex";
}

function sanitizeCompanyEntries(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 50) break;
  }
  return out;
}

function renderCompanyChips(listKind) {
  const containerId =
    listKind === "block" ? "dpCompanyBlocklistChips" : "dpCompanyAllowlistChips";
  const emptyId =
    listKind === "block" ? "dpCompanyBlocklistEmpty" : "dpCompanyAllowlistEmpty";
  const container = document.getElementById(containerId);
  const empty = document.getElementById(emptyId);
  if (!container) return;
  const items = discoveryDrawerState[listKind] || [];
  // Remove all chips except the empty placeholder
  Array.from(container.querySelectorAll(".dp-chip")).forEach((el) =>
    el.remove(),
  );
  if (items.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const name of items) {
    const chip = document.createElement("span");
    chip.className = "dp-chip";
    chip.dataset.list = listKind;
    const label = document.createElement("span");
    label.className = "dp-chip__label";
    label.textContent = name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "dp-chip__remove";
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.dataset.action = "remove-chip";
    remove.dataset.list = listKind;
    remove.dataset.value = name;
    remove.textContent = "×";
    chip.appendChild(label);
    chip.appendChild(remove);
    container.appendChild(chip);
  }
}

function addCompanyChip(listKind, value) {
  const t = String(value || "").trim();
  if (!t) return;
  const list = discoveryDrawerState[listKind];
  if (!Array.isArray(list)) return;
  const key = t.toLowerCase();
  if (list.some((x) => x.toLowerCase() === key)) return;
  list.push(t);
  if (list.length > 50) list.length = 50;
  renderCompanyChips(listKind);
}

function removeCompanyChip(listKind, value) {
  const t = String(value || "").trim().toLowerCase();
  const list = discoveryDrawerState[listKind];
  if (!Array.isArray(list)) return;
  const idx = list.findIndex((x) => x.toLowerCase() === t);
  if (idx >= 0) list.splice(idx, 1);
  renderCompanyChips(listKind);
}

function setDiscoveryReadinessChip(state, label) {
  const chip = document.getElementById("discoveryDrawerReadiness");
  if (!chip) return;
  chip.dataset.state = state || "unknown";
  chip.textContent = label || "";
}

function refreshDiscoveryDrawerStatusChip() {
  try {
    const snap = getDiscoveryReadinessSnapshot();
    const view = getDiscoverySettingsView(snap);
    const hasWebhook = !!getDiscoveryWebhookUrl();
    if (view && view.runDiscoveryEnabled && hasWebhook) {
      setDiscoveryReadinessChip("ready", "Discovery ready");
    } else if (hasWebhook) {
      setDiscoveryReadinessChip("partial", "Setup partially configured");
    } else {
      setDiscoveryReadinessChip("unconfigured", "Discovery not configured");
    }
  } catch (_) {
    setDiscoveryReadinessChip("unknown", "Checking setup…");
  }
}

function getLocalDiscoveryWorkerHealthUrlForSources() {
  if (!isLocalDashboardOrigin()) return "";
  const snap = getDiscoveryReadinessSnapshot();
  const transport = getDiscoveryTransportSetupState();
  const savedWebhookUrl = getDiscoveryWebhookUrl();
  const localWebhookUrl =
    transport.localWebhookUrl ||
    (snap && snap.localWebhookUrl) ||
    (isLocalWebhookCandidateUrl(savedWebhookUrl) ? savedWebhookUrl : "");
  return getDiscoveryLocalWebhookHealthUrl(localWebhookUrl);
}

async function fetchLocalDiscoveryWorkerSourceReadiness() {
  if (isLocalDashboardOrigin()) {
    await hydrateDiscoveryTransportSetupFromLocalBootstrap();
  }
  const healthUrl = getLocalDiscoveryWorkerHealthUrlForSources();
  if (!healthUrl) return null;
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload && payload.readiness && typeof payload.readiness === "object"
      ? payload.readiness
      : null;
  } catch (_) {
    return null;
  }
}

function getDiscoverySourceReadinessIssues(readiness) {
  if (!readiness || typeof readiness !== "object") return [];
  const issues = [];
  const groundedWeb = readiness.groundedWeb;
  if (
    groundedWeb &&
    groundedWeb.enabled &&
    groundedWeb.ready === false
  ) {
    issues.push("Gemini API key");
  }
  const serpApi = readiness.serpApiGoogleJobs;
  if (
    serpApi &&
    serpApi.enabled &&
    (serpApi.configured === false || serpApi.ready === false)
  ) {
    issues.push("SerpApi key");
  }
  return issues;
}

function renderDiscoveryDrawerSourceReadiness(issues) {
  const notice = document.getElementById("discoveryDrawerLastRun");
  if (!notice) return;
  if (!issues.length) {
    notice.hidden = true;
    notice.textContent = "";
    return;
  }
  setDiscoveryReadinessChip("partial", "Source config missing");
  notice.hidden = false;
  notice.textContent = `Missing source config: ${issues.join(", ")}. Discovery can still run with fewer sources.`;
}

async function refreshDiscoveryDrawerSourceReadiness() {
  const readiness = await fetchLocalDiscoveryWorkerSourceReadiness();
  if (!readiness) return [];
  const issues = getDiscoverySourceReadinessIssues(readiness);
  renderDiscoveryDrawerSourceReadiness(issues);
  return issues;
}

async function warnDiscoverySourceReadinessBeforeRun() {
  const readiness = await fetchLocalDiscoveryWorkerSourceReadiness();
  if (!readiness) return [];
  const issues = getDiscoverySourceReadinessIssues(readiness);
  if (issues.length) {
    showToast(
      `Discovery is missing ${issues.join(", ")}. This run will continue with fewer sources.`,
      "warning",
      true,
    );
  }
  return issues;
}

function openDiscoveryDrawer() {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
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
      ? Promise.resolve(UC.getDiscoveryProfile()).catch((err) => {
          console.warn("[JobBored] discovery profile preload:", err);
          return {};
        })
      : Promise.resolve({});
  prefilled.then(async (p) => {
    Object.entries(fieldMap).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.value = (p && p[key]) || "";
    });
    const gwEl = document.getElementById("dpGroundedWeb");
    if (gwEl) gwEl.checked = !p || p.groundedWebEnabled !== false;
    const preset = normalizeSourcePreset(
      p && p.sourcePreset ? p.sourcePreset : "",
    );
    syncSourcePresetUi(preset || "browser_plus_ats");
    discoveryDrawerState.allow = sanitizeCompanyEntries(
      p && Array.isArray(p.companyAllowlist) ? p.companyAllowlist : [],
    );
    discoveryDrawerState.block = sanitizeCompanyEntries(
      p && Array.isArray(p.companyBlocklist) ? p.companyBlocklist : [],
    );
    renderCompanyChips("allow");
    renderCompanyChips("block");
    refreshDiscoveryDrawerStatusChip();
    void refreshDiscoveryDrawerSourceReadiness();
    drawer.hidden = false;
    drawer.style.display = "flex";
    document.body.classList.add("detail-open");

    // Load the master Fit Profile and overlay it on the drawer. When present,
    // its fields become the source of truth and the legacy IndexedDB values
    // above are visually overwritten. When absent, an empty-state banner is
    // shown so the user can complete onboarding.
    try {
      const masterProfile = await loadMasterFitProfile();
      renderFitProfileEmptyState(masterProfile);
      if (masterProfile) {
        prefillDrawerFromFitProfile(masterProfile);
        renderTuningFromProfile(masterProfile);
      } else {
        renderTuningFromProfile(null);
      }
    } catch (e) {
      console.warn("[JobBored] Fit Profile overlay failed:", e);
    }
    // Surface AI provider availability when opening the drawer.
    checkDiscoveryAiAvailability();
    const first = document.getElementById("dpTargetRoles");
    if (first) first.focus();
    // First-run coach: auto-fires once per browser, gated by localStorage.
    try {
      const coach = window.JobBoredDiscoveryCoach;
      if (coach && typeof coach.start === "function") {
        coach.start({ force: false });
      }
    } catch (err) {
      console.warn("[JobBored] discovery coach start:", err);
    }
  });
}

function closeDiscoveryDrawer() {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  drawer.style.display = "none";
  drawer.hidden = true;
  document.body.classList.remove("detail-open");
  // Per-run profile state dies with the drawer. This is the no-write-back
  // rule — anything the user edited this run does NOT persist.
  discoveryRunProfileState = {
    baseProfile: null,
    perRunOverrides: {},
    fetchedAt: null,
  };
}

function checkDiscoveryAiAvailability() {
  const hint = document.getElementById("dpAiHint");
  const suggestBtn = document.getElementById("dpSuggestBtn");
  const Insights = window.CommandCenterJobPostingInsights;
  const canUse =
    Insights && Insights.canEnrichWithLLM && Insights.canEnrichWithLLM();
  if (hint) hint.hidden = !!canUse;
  if (suggestBtn) suggestBtn.disabled = !canUse;
}

/**
 * Generate Safe / Adjacent / Stretch search variants from the candidate profile.
 * Returns { safe, adjacent, stretch } where each entry is a search-intent
 * shape: { targetRoles, locations, remotePolicy, seniority, keywordsInclude,
 *   keywordsExclude, sourcePreset, companyAllowlist, rationale }.
 *
 * scrapedJob is optional context only — it does not gate generation.
 */
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
    "You are an expert career advisor. Generate THREE distinct discovery search variants " +
    "(safe, adjacent, stretch) from the candidate's profile and optional job context. " +
    "Return ONLY valid JSON of shape: " +
    "{ \"safe\": Variant, \"adjacent\": Variant, \"stretch\": Variant } where Variant is " +
    "{ targetRoles: string (comma-separated role titles), " +
    "locations: string (comma-separated cities/regions), " +
    "remotePolicy: string, seniority: string, " +
    "keywordsInclude: string (comma-separated), keywordsExclude: string (comma-separated), " +
    "sourcePreset: one of 'browser_only' | 'ats_only' | 'browser_plus_ats', " +
    "companyAllowlist: string[] (5-15 real, currently-hiring companies that match this stratum; never invent), " +
    "rationale: string (1-2 sentences) }. " +
    "Definitions: safe = closest to the candidate's current target. adjacent = nearby role families " +
    "and industries. stretch = ambitious or non-obvious paths the candidate could realistically reach. " +
    "Always populate companyAllowlist with at least 5 plausible companies per stratum.";

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
    "Generate three distinct search variants (safe, adjacent, stretch) for this candidate.",
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
      { json: true },
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
    safe: normalizeStratum(parsed && parsed.safe),
    adjacent: normalizeStratum(parsed && parsed.adjacent),
    stretch: normalizeStratum(parsed && parsed.stretch),
  };
}

/**
 * Coerce a raw stratum payload from the LLM into a safe shape that the
 * drawer can consume without throwing on missing/wrong-typed fields.
 */
function normalizeStratum(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const str = (k) => (typeof o[k] === "string" ? o[k].trim() : "");
  const allowedPresets = new Set([
    "browser_only",
    "ats_only",
    "browser_plus_ats",
  ]);
  const presetRaw = typeof o.sourcePreset === "string" ? o.sourcePreset.trim() : "";
  const sourcePreset = allowedPresets.has(presetRaw) ? presetRaw : "";
  return {
    targetRoles: str("targetRoles"),
    locations: str("locations"),
    remotePolicy: str("remotePolicy"),
    seniority: str("seniority"),
    keywordsInclude: str("keywordsInclude"),
    keywordsExclude: str("keywordsExclude"),
    sourcePreset,
    companyAllowlist: sanitizeCompanyEntries(
      Array.isArray(o.companyAllowlist) ? o.companyAllowlist : [],
    ),
    rationale: str("rationale"),
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

/**
 * Single source of truth for which Gemini model the app uses.
 *
 * Resolution order (high → low):
 *   1. Explicit caller arg (when a feature wants to pin a model — rare)
 *   2. localStorage override (Settings → Resume → Gemini model field)
 *   3. config.js → window.COMMAND_CENTER_CONFIG.resumeGeminiModel
 *   4. Hardcoded fallback (only hit if both config files are missing)
 *
 * If a Gemini model gets retired, this is the ONLY place to update the
 * default. Every Gemini call site must route through here — do not embed
 * model name strings or "gemini-…" fallbacks elsewhere in app.js.
 */
function resolveGeminiModel(explicit) {
  if (explicit && typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  try {
    const overrides =
      typeof readStoredConfigOverrides === "function"
        ? readStoredConfigOverrides()
        : {};
    if (overrides && typeof overrides.resumeGeminiModel === "string" && overrides.resumeGeminiModel.trim()) {
      return overrides.resumeGeminiModel.trim();
    }
  } catch (_) {
    /* localStorage may be unavailable in private/embedded contexts. */
  }
  const cfg = (typeof window !== "undefined" && window.COMMAND_CENTER_CONFIG) || {};
  if (typeof cfg.resumeGeminiModel === "string" && cfg.resumeGeminiModel.trim()) {
    return cfg.resumeGeminiModel.trim();
  }
  return "gemini-3.5-flash";
}

async function callDiscoveryAiGemini(system, user, apiKey, model, opts) {
  const resolvedModel = resolveGeminiModel(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // Detect 2.5+ family — those models burn "thinking tokens" against the
  // output budget, so a 2048-cap on a long-system-prompt JSON response can
  // silently produce zero visible characters with finishReason=MAX_TOKENS.
  // Also pin response MIME to JSON whenever the caller marks the request
  // as JSON-only — this dramatically improves reliability vs. free-form
  // prose responses that have to be regex-extracted later.
  const wantJson = !!(opts && opts.json);
  const isThinkingModel = /^gemini-(2\.[5-9]|3(\.\d+)?)/.test(resolvedModel);
  const generationConfig = {
    maxOutputTokens: isThinkingModel ? 8192 : 2048,
    temperature: 0.5,
  };
  if (wantJson) generationConfig.responseMimeType = "application/json";
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig,
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error?.message || `Gemini HTTP ${resp.status}`);
  }
  const candidate = data.candidates?.[0];
  const text =
    candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text.trim()) {
    // Surface the real reason instead of a generic "Empty response".
    // Common cases: MAX_TOKENS (thinking eats the budget), SAFETY,
    // RECITATION, or upstream finish reasons that need the user to retry
    // with different input rather than silently fail.
    const reason = candidate?.finishReason || data.promptFeedback?.blockReason;
    if (reason === "MAX_TOKENS") {
      throw new Error(
        "Gemini hit the output token cap before producing visible text. Try Show me more, or shorten your resume.",
      );
    }
    if (reason === "SAFETY" || reason === "RECITATION") {
      throw new Error(
        `Gemini blocked the response (${reason}). Try Show me more, or remove sensitive content from your resume.`,
      );
    }
    if (reason) throw new Error(`Gemini returned no text (${reason}).`);
    throw new Error("Empty response from Gemini");
  }
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

/**
 * Discovery drawer sub-tab controller. Mirrors the WAI-ARIA tabs pattern
 * used by settings-tabs.js but scoped to the drawer (Search · Sources ·
 * Automation · Connection · History).
 *
 * Exposed on window.JobBoredDiscoveryDrawerSubtabs so adapter code
 * (settings-discovery-adapters.js) can deep-link into a sub-tab when
 * opening the drawer in response to a Settings-era flow (e.g. Cloudflare
 * relay return, Apps Script remediation, webhook focus).
 */
const DISCOVERY_SUBTAB_ORDER = [
  "search",
  "sources",
  "automation",
  "connection",
  "history",
];
let activeDiscoverySubtab = "search";

function setDiscoveryDrawerSubtab(subtab, opts) {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const id = String(subtab || "search");
  if (DISCOVERY_SUBTAB_ORDER.indexOf(id) === -1) return;
  DISCOVERY_SUBTAB_ORDER.forEach((tid) => {
    const btn = drawer.querySelector(`#dd-tab-${tid}`);
    const panel = drawer.querySelector(`#dd-panel-${tid}`);
    if (btn) {
      btn.setAttribute("aria-selected", tid === id ? "true" : "false");
      btn.setAttribute("tabindex", tid === id ? "0" : "-1");
    }
    if (panel) panel.hidden = tid !== id;
  });
  activeDiscoverySubtab = id;
  const silent = opts && opts.silent;
  if (!silent) {
    const activeBtn = drawer.querySelector(`#dd-tab-${id}`);
    if (activeBtn) activeBtn.focus();
  }
}

function initDiscoverySubtabs() {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const tablist = drawer.querySelector("#discoverySubtabs");
  if (!tablist) return;
  if (tablist.dataset.subtabBound === "true") return;
  tablist.dataset.subtabBound = "true";
  const buttons = tablist.querySelectorAll('[role="tab"]');
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-subtab");
      if (id) setDiscoveryDrawerSubtab(id);
    });
    btn.addEventListener("keydown", (e) => {
      const idx = DISCOVERY_SUBTAB_ORDER.indexOf(activeDiscoverySubtab);
      if (idx === -1) return;
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % DISCOVERY_SUBTAB_ORDER.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next =
          (idx - 1 + DISCOVERY_SUBTAB_ORDER.length) %
          DISCOVERY_SUBTAB_ORDER.length;
      } else if (e.key === "Home") {
        next = 0;
      } else if (e.key === "End") {
        next = DISCOVERY_SUBTAB_ORDER.length - 1;
      }
      if (next >= 0) {
        e.preventDefault();
        setDiscoveryDrawerSubtab(DISCOVERY_SUBTAB_ORDER[next]);
      }
    });
  });
  // Open the runs log and setup doctor from the History sub-tab.
  const openRunsBtn = drawer.querySelector("#discoveryDrawerOpenRunsBtn");
  if (openRunsBtn && openRunsBtn.dataset.bound !== "true") {
    openRunsBtn.dataset.bound = "true";
    openRunsBtn.addEventListener("click", () => {
      closeDiscoveryDrawer();
      const runsBtn = document.getElementById("runsBtn");
      if (runsBtn) runsBtn.click();
    });
  }
  const openDoctorBtn = drawer.querySelector("#discoveryDrawerOpenDoctorBtn");
  if (openDoctorBtn && openDoctorBtn.dataset.bound !== "true") {
    openDoctorBtn.dataset.bound = "true";
    openDoctorBtn.addEventListener("click", () => {
      closeDiscoveryDrawer();
      const doctorBtn = document.getElementById("setupDoctorBtn");
      if (doctorBtn) doctorBtn.click();
    });
  }
  setDiscoveryDrawerSubtab("search", { silent: true });
}

window.JobBoredDiscoveryDrawerSubtabs = {
  setActiveSubtab: setDiscoveryDrawerSubtab,
  getActiveSubtab: () => activeDiscoverySubtab,
  ORDER: DISCOVERY_SUBTAB_ORDER.slice(),
};

function initDiscoveryDrawer() {
  const drawer = discoveryDrawerEl();
  const runBtn = document.getElementById("discoveryPrefsRun");
  if (!drawer) return;

  // Close on backdrop, close button, cancel button, or any data-action="close-discovery-drawer"
  drawer.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.dataset && target.dataset.action === "close-discovery-drawer") {
      closeDiscoveryDrawer();
      return;
    }
    const close = target.closest('[data-action="close-discovery-drawer"]');
    if (close) closeDiscoveryDrawer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isDiscoveryDrawerOpen()) closeDiscoveryDrawer();
  });

  /* ---- First-run coach: "?" button restarts the walkthrough ---- */
  const coachBtn = document.getElementById("discoveryDrawerCoachBtn");
  if (coachBtn && coachBtn.dataset.bound !== "true") {
    coachBtn.dataset.bound = "true";
    coachBtn.addEventListener("click", () => {
      try {
        const coach = window.JobBoredDiscoveryCoach;
        if (coach && typeof coach.start === "function") {
          coach.start({ force: true });
        }
      } catch (err) {
        console.warn("[JobBored] discovery coach restart:", err);
      }
    });
  }

  /* ---- Source preset mutual-exclusivity ---- */
  document
    .querySelectorAll('input[name="dpSourcePreset"]')
    .forEach((el) => {
      el.addEventListener("change", () => {
        const checked = document.querySelector(
          'input[name="dpSourcePreset"]:checked',
        );
        syncSourcePresetUi(checked ? normalizeSourcePreset(checked.value) : "");
      });
    });

  /* ---- Company chip controls (allow + block) ---- */
  function bindChipInput(inputId, addBtnId, listKind) {
    const input = document.getElementById(inputId);
    const addBtn = document.getElementById(addBtnId);
    function commit() {
      if (!input) return;
      const v = input.value;
      if (v && v.trim()) {
        addCompanyChip(listKind, v);
        input.value = "";
      }
    }
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      });
    }
    if (addBtn) addBtn.addEventListener("click", commit);
  }
  bindChipInput("dpCompanyAllowlistInput", "dpCompanyAllowlistAddBtn", "allow");
  bindChipInput("dpCompanyBlocklistInput", "dpCompanyBlocklistAddBtn", "block");

  // Chip remove handler — delegated for both lists.
  drawer.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('[data-action="remove-chip"]');
    if (!btn) return;
    const list = btn.getAttribute("data-list");
    const value = btn.getAttribute("data-value");
    if (!list || !value) return;
    if (list === "allow" || list === "block") removeCompanyChip(list, value);
  });

  /* ---- Scrape job listing (optional context for AI ideas) ---- */
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

  /* ---- AI ideation: generate Safe / Adjacent / Stretch strata ---- */
  const suggestBtn = document.getElementById("dpSuggestBtn");
  if (suggestBtn) {
    suggestBtn.addEventListener("click", async () => {
      suggestBtn.disabled = true;
      const originalLabel = suggestBtn.textContent;
      suggestBtn.textContent = "Analyzing...";
      const grid = document.getElementById("dpStrataGrid");
      const status = document.getElementById("dpSuggestStatus");
      if (status) {
        status.textContent = "Generating ideas…";
        status.hidden = false;
      }
      try {
        const strata = await generateDiscoverySuggestions(scrapedJobData);
        discoveryDrawerState.strata = strata;
        renderStrataCards(strata);
        if (grid) grid.hidden = false;
        if (status) status.hidden = true;
      } catch (err) {
        if (status) {
          status.textContent = `AI ideas failed: ${err.message || err}`;
          status.hidden = false;
        }
        showToast(`AI ideas failed: ${err.message || err}`, "error");
      } finally {
        suggestBtn.disabled = false;
        suggestBtn.textContent = originalLabel;
      }
    });
  }

  /* ---- Apply a stratum to the drawer fields ---- */
  drawer.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const applyBtn = target.closest('[data-action="apply-stratum"]');
    if (!applyBtn) return;
    const card = applyBtn.closest("[data-stratum]");
    if (!card) return;
    const key = card.getAttribute("data-stratum");
    const strata = discoveryDrawerState.strata;
    if (!strata || !strata[key]) return;
    applyStratumToDrawer(strata[key]);
    showToast(`Applied "${key}" search variant`, "success");
  });

  /* ---- Run discovery (saves drawer fields, dispatches webhook) ---- */
  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      const UC = window.CommandCenterUserContent;
      const val = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : "";
      };

      const finalTargetRoles = val("dpTargetRoles").trim();
      const finalKeywordsInclude = val("dpKeywordsInclude").trim();

      if (!finalTargetRoles && !finalKeywordsInclude) {
        showToast(
          "Add target roles or keywords, or pick an AI idea above.",
          "warning",
          true,
        );
        const grid = document.getElementById("dpStrataGrid");
        if (grid && grid.hidden) {
          // Auto-trigger AI generation when intent is blank.
          const sb = document.getElementById("dpSuggestBtn");
          if (sb && !sb.disabled) sb.click();
        }
        return;
      }

      const gwEl = document.getElementById("dpGroundedWeb");
      const groundedWebEnabled = gwEl ? gwEl.checked : true;
      const selectedPresetEl = document.querySelector(
        'input[name="dpSourcePreset"]:checked',
      );
      const sourcePreset = selectedPresetEl
        ? normalizeSourcePreset(selectedPresetEl.value)
        : "";
      const companyAllowlist = sanitizeCompanyEntries(
        discoveryDrawerState.allow,
      );
      const companyBlocklist = sanitizeCompanyEntries(
        discoveryDrawerState.block,
      );

      if (UC && typeof UC.saveDiscoveryProfile === "function") {
        // When the master Fit Profile is the source of truth, strip the
        // fit-profile-driven fields (targetRoles, locations, remotePolicy,
        // seniority) from the IndexedDB save. This prevents per-run edits
        // from drifting the local cache away from ~/.jobbored/profile.json.
        // Legacy fields (sourcePreset, maxLeadsPerRun, etc.) still persist.
        const hasMasterProfile = !!discoveryRunProfileState.baseProfile;
        const savePayload = hasMasterProfile
          ? {
              keywordsInclude: finalKeywordsInclude,
              keywordsExclude: val("dpKeywordsExclude"),
              maxLeadsPerRun: val("dpMaxLeads"),
              groundedWebEnabled,
              sourcePreset,
              companyAllowlist,
              companyBlocklist,
            }
          : {
              targetRoles: finalTargetRoles,
              locations: val("dpLocations"),
              remotePolicy: val("dpRemotePolicy"),
              seniority: val("dpSeniority"),
              keywordsInclude: finalKeywordsInclude,
              keywordsExclude: val("dpKeywordsExclude"),
              maxLeadsPerRun: val("dpMaxLeads"),
              groundedWebEnabled,
              sourcePreset,
              companyAllowlist,
              companyBlocklist,
            };
        await UC.saveDiscoveryProfile(savePayload);
      }
      closeDiscoveryDrawer();
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

/**
 * Paint the three AI strata cards from a normalized strata payload.
 */
function renderStrataCards(strata) {
  const keys = ["safe", "adjacent", "stretch"];
  for (const key of keys) {
    const card = document.querySelector(
      `.dp-stratum-card[data-stratum="${key}"]`,
    );
    if (!card) continue;
    const v = (strata && strata[key]) || normalizeStratum({});
    const set = (field, value) => {
      const el = card.querySelector(`[data-field="${field}"]`);
      if (el) el.textContent = value || "—";
    };
    set("rationale", v.rationale);
    set("targetRoles", v.targetRoles);
    set("locations", v.locations);
    set("keywordsInclude", v.keywordsInclude);
    set(
      "companies",
      Array.isArray(v.companyAllowlist) && v.companyAllowlist.length
        ? v.companyAllowlist.slice(0, 8).join(", ")
        : "—",
    );
  }
}

/**
 * Replace the drawer intent fields and company chips with the selected stratum.
 * The user can still edit before running.
 */
function applyStratumToDrawer(stratum) {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || "";
  };
  setVal("dpTargetRoles", stratum.targetRoles);
  setVal("dpLocations", stratum.locations);
  setVal("dpRemotePolicy", stratum.remotePolicy);
  setVal("dpSeniority", stratum.seniority);
  setVal("dpKeywordsInclude", stratum.keywordsInclude);
  setVal("dpKeywordsExclude", stratum.keywordsExclude);
  if (stratum.sourcePreset) {
    syncSourcePresetUi(normalizeSourcePreset(stratum.sourcePreset));
  }
  // Auto-include companies (replace allowlist with the stratum's selection).
  discoveryDrawerState.allow = sanitizeCompanyEntries(
    Array.isArray(stratum.companyAllowlist) ? stratum.companyAllowlist : [],
  );
  renderCompanyChips("allow");
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

  openBtn.addEventListener("click", () => {
    openDiscoveryDrawer();
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

// ============================================
// INGEST URL — paste-a-job-URL flow
// ============================================

const INGEST_URL_TIMEOUT_MS = 60000;
const INGEST_URL_ASYNC_TIMEOUT_MS = 10 * 60 * 1000;
const INGEST_URL_ASYNC_POLL_MS = 3000;
const INGEST_URL_BLOCKED_HOST_LABELS = {
  "linkedin.com": "LinkedIn",
  "indeed.com": "Indeed",
  "glassdoor.com": "Glassdoor",
  "ziprecruiter.com": "ZipRecruiter",
};

function resolveIngestUrlEndpoint(baseUrl) {
  const base = String(baseUrl || "").trim();
  if (!base) return "";
  try {
    const u = new URL(base);
    const path = (u.pathname || "").replace(/\/+$/, "");
    const replaced = path.replace(
      /\/(?:webhook|discovery|discovery-profile|ingest-url)$/i,
      "/ingest-url",
    );
    if (replaced !== path) {
      u.pathname = replaced;
    } else if (path === "") {
      u.pathname = "/ingest-url";
    } else {
      u.pathname = path + "/ingest-url";
    }
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch (_) {
    return base.replace(/\/+$/, "") + "/ingest-url";
  }
}

function isParseableUrl(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function aggregatorLabelForHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^www\./, "");
  for (const key in INGEST_URL_BLOCKED_HOST_LABELS) {
    if (h === key || h.endsWith("." + key)) {
      return INGEST_URL_BLOCKED_HOST_LABELS[key];
    }
  }
  return host || "this site";
}

function reportIngestProgress(onProgress, progress, label, step) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress({
      progress: Math.max(0, Math.min(100, Number(progress) || 0)),
      label: String(label || ""),
      step: step || "",
    });
  } catch (_) {
    // Progress callbacks are UI sugar; ingest should not depend on them.
  }
}

function getDuplicatePipelineIndexFromIngest(url, data) {
  const rowNumber = Number(data && data.rowNumber);
  if (Number.isFinite(rowNumber) && rowNumber >= 2) {
    const fromRow = rowNumber - 2;
    if (pipelineData[fromRow]) return fromRow;
  }
  const normalized = normalizeLeadUrlClient(url || "");
  if (!normalized) return -1;
  return pipelineData.findIndex((job) => {
    if (!job || !job.link) return false;
    return normalizeLeadUrlClient(job.link) === normalized;
  });
}

function focusPipelineJobByIndex(dataIndex) {
  if (!Number.isInteger(dataIndex) || dataIndex < 0) return false;
  const pipelineApi = window.JobBoredPipeline;
  if (pipelineApi && typeof pipelineApi.focusJob === "function") {
    try {
      if (pipelineApi.focusJob(String(dataIndex))) return true;
    } catch (_) {
      /* fall through */
    }
  }
  const selectors = [
    `[data-stable-key="${String(dataIndex).replace(/"/g, '\\"')}"]`,
    `[data-index="${String(dataIndex).replace(/"/g, '\\"')}"]`,
  ];
  for (const selector of selectors) {
    const card = document.querySelector(selector);
    if (!card) continue;
    card.classList.add("duplicate-focus", "is-highlighted");
    card.setAttribute("data-selected", "true");
    try {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) {
      card.scrollIntoView();
    }
    setTimeout(() => {
      card.classList.remove("duplicate-focus", "is-highlighted");
    }, 2400);
    return true;
  }
  return false;
}

function clearPipelineRevealFilters() {
  if (typeof document === "undefined") return false;
  let rendered = false;
  if (currentSearch) {
    currentSearch = "";
    rendered = true;
  }
  const legacySearch = document.getElementById("searchInput");
  if (legacySearch && legacySearch.value) legacySearch.value = "";

  if (favoritesOnly) {
    favoritesOnly = false;
    rendered = true;
    syncPipelineFilterControls();
    notifyPipelineFiltersChanged();
  }

  let v2SearchChanged = false;
  document.querySelectorAll("[data-pipeline-search]").forEach((input) => {
    if (input && input.value) {
      input.value = "";
      v2SearchChanged = true;
    }
  });
  document.querySelectorAll('[data-region="pipeline"]').forEach((region) => {
    if (region && region.__pipeState && region.__pipeState.search) {
      region.__pipeState.search = "";
      v2SearchChanged = true;
    }
  });

  if (rendered && typeof renderPipeline === "function") {
    renderPipeline();
  }
  if (
    v2SearchChanged &&
    window.JobBoredPipeline &&
    typeof window.JobBoredPipeline.scheduleRender === "function"
  ) {
    window.JobBoredPipeline.scheduleRender();
  }
  return rendered || v2SearchChanged;
}

function revealPipelineJobByIndex(dataIndex) {
  const idx = Number(dataIndex);
  if (!Number.isInteger(idx) || idx < 0 || !pipelineData[idx]) return false;
  clearPipelineRevealFilters();
  const focused = focusPipelineJobByIndex(idx);
  if (!focused && typeof setTimeout === "function") {
    setTimeout(() => {
      focusPipelineJobByIndex(idx);
    }, 120);
  }
  return focused;
}

function createIngestVerificationError(result, endpointUrl, fallbackMessage) {
  const message =
    (result && result.message) ||
    fallbackMessage ||
    "Could not reach the discovery worker.";
  const err = new Error(message);
  err.discoveryVerificationResult = result || null;
  err.endpointUrl = endpointUrl || "";
  return err;
}

function classifyIngestEndpointFailure({
  endpointUrl,
  status,
  data,
  responseText,
  responseUrl,
}) {
  const verifyApi = getDiscoveryWizardVerifyApi();
  if (verifyApi && typeof verifyApi.summarizeResult === "function") {
    return verifyApi.summarizeResult({
      context: "ingest_url",
      status,
      data,
      responseText,
      responseUrl: responseUrl || endpointUrl,
      endpointUrl,
    });
  }
  return {
    ok: false,
    kind: status === 401 ? "auth_required" : "invalid_endpoint",
    engineState: "none",
    httpStatus: Number(status) || 0,
    message:
      status === 401
        ? "The discovery worker needs a webhook secret."
        : "The ingest endpoint returned an error.",
    detail: responseText || "",
    layer: "upstream",
  };
}

function classifyIngestNetworkFailure(endpointUrl, err) {
  const verifyApi = getDiscoveryWizardVerifyApi();
  if (verifyApi && typeof verifyApi.createVerificationResult === "function") {
    return verifyApi.createVerificationResult({
      ok: false,
      kind: "network_error",
      engineState: "none",
      httpStatus: 0,
      message: "Can't reach the endpoint.",
      detail:
        "The browser lost the ingest connection. Likely causes: CORS, Cloudflare Access, a stale tunnel, or the worker being offline. Tried: " +
        endpointUrl,
      layer: "browser",
    });
  }
  return {
    ok: false,
    kind: "network_error",
    engineState: "none",
    httpStatus: 0,
    message: "Can't reach the endpoint.",
    detail: err && err.message ? err.message : String(err || ""),
    layer: "browser",
  };
}

function formatDiscoveryVerificationError(result, fallback) {
  if (!result || typeof result !== "object") return fallback || "";
  const detail =
    result.detail && result.detail !== result.message ? " " + result.detail : "";
  return String(result.message || fallback || "Discovery endpoint failed") + detail;
}

function showIngestDiscoveryError(err) {
  const result = err && err.discoveryVerificationResult;
  if (!result) return false;
  showDiscoveryVerificationToast(result, {
    context: "ingest_url",
    endpointUrl: err.endpointUrl || "",
  });
  return true;
}

async function appendManualPipelineRowDirect(manual) {
  const src = manual && typeof manual === "object" ? manual : {};
  const title = String(src.title || "").trim();
  const company = String(src.company || "").trim();
  const location = String(src.location || "").trim();
  const url = String(src.url || "").trim();
  const description = String(src.description || "").trim();
  const fitScore = Number.isFinite(Number(src.fitScore))
    ? Math.max(0, Math.min(10, Number(src.fitScore)))
    : "";

  if (!SHEET_ID) throw new Error("missing_sheet");
  if (!getAccessToken()) {
    showSheetAccessGate("signin");
    throw new Error("signed_out");
  }
  if (!title) throw new Error("missing_title");
  if (!company) throw new Error("missing_company");
  if (url && !isParseableUrl(url)) throw new Error("invalid_url");

  const existingIndex = url
    ? getDuplicatePipelineIndexFromIngest(url, { rowNumber: NaN })
    : -1;
  if (existingIndex >= 0) {
    return {
      ok: false,
      reason: "duplicate",
      rowNumber: getSheetRow(existingIndex),
    };
  }

  const row = [
    new Date().toISOString().slice(0, 10),
    title,
    company,
    location,
    url,
    "Manual",
    "",
    fitScore === "" ? "" : String(fitScore),
    "",
    "",
    "",
    "",
    "New",
    "",
    description,
    "",
    "",
    "",
    "",
    "",
  ];
  await sheetsValuesAppend("Pipeline!A:T", [row]);
  if (typeof loadAllData === "function") {
    await loadAllData().catch(() => {});
  }
  return {
    ok: true,
    strategy: "manual_sheet_append",
    lead: { title, company, location, url },
  };
}

async function ingestJobUrl(url, options = {}) {
  const value = String(url || "").trim();
  const onProgress = options && options.onProgress;
  if (!isParseableUrl(value)) {
    throw new Error("invalid_url");
  }

  reportIngestProgress(onProgress, 10, "Sending the URL to the ingest worker", "worker");
  const data = await handleIngestUrlSubmit(value, options.manual, {
    onProgress,
  });
  reportIngestProgress(onProgress, 44, "Adding the opportunity to Pipeline", "pipeline");

  const handled = handleIngestUrlResponse(data, value, {
    awaitAutoEnrich: true,
    onProgress,
  });
  if (handled && typeof handled.then === "function") {
    await handled;
  }
  if (data && data.ok === false) {
    return data;
  }

  reportIngestProgress(onProgress, 100, "Pipeline updated", "done");
  return data;
}

/**
 * POST to the worker's /ingest-url endpoint.
 * @param {string} url — pasted job URL
 * @param {object} [manualOverride] — { title, company, location, description, fitScore }
 * @returns {Promise<object>} parsed response
 */
async function handleIngestUrlSubmit(url, manualOverride, options = {}) {
  const webhook = await resolveDiscoveryRunWebhookUrl();
  if (!webhook) {
    if (manualOverride && typeof manualOverride === "object") {
      return appendManualPipelineRowDirect({ ...manualOverride, url });
    }
    throw new Error("missing_discovery_webhook");
  }

  const endpoint = resolveIngestUrlEndpoint(webhook);
  if (!endpoint) {
    showToast("Invalid discovery webhook URL", "error");
    throw new Error("invalid_endpoint");
  }

  let activeDiscoverySecret = getDiscoveryWebhookSecret();
  function buildDiscoveryWorkerHeaders() {
    const headers = { "content-type": "application/json" };
    if (activeDiscoverySecret) {
      headers["x-discovery-secret"] = activeDiscoverySecret;
    }
    return headers;
  }

  async function buildRequestBody(options = {}) {
    const body = {
      event: "ingest.url.request",
      schemaVersion: 1,
      url: String(url || "").trim(),
    };
    if (!manualOverride) {
      body.async = true;
    }
    const sheetId = getSheetId();
    if (sheetId) body.sheetId = sheetId;
    const dashboardGoogleAccessToken =
      await getFreshDiscoveryRequestGoogleAccessToken({
        force: options.forceGoogleTokenRefresh === true,
      });
    if (dashboardGoogleAccessToken) {
      body.googleAccessToken = dashboardGoogleAccessToken;
    }
    if (manualOverride && typeof manualOverride === "object") {
      body.manual = {
        title: String(manualOverride.title || "").trim(),
        company: String(manualOverride.company || "").trim(),
        location: String(manualOverride.location || "").trim(),
        description: String(manualOverride.description || "").trim(),
        fitScore: Number.isFinite(manualOverride.fitScore)
          ? manualOverride.fitScore
          : 5,
      };
    }
    return body;
  }

  async function postRequestBody(body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      INGEST_URL_TIMEOUT_MS,
    );
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: buildDiscoveryWorkerHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const responseText = await res.text().catch(() => "");
      let data = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch (_) {
        data = null;
      }
      if (!res.ok && !data) {
        throw createIngestVerificationError(
          classifyIngestEndpointFailure({
            endpointUrl: endpoint,
            status: res.status,
            data,
            responseText,
            responseUrl: res.url || endpoint,
          }),
          endpoint,
          "Ingest endpoint returned HTTP " + res.status,
        );
      }
      if (!res.ok && isIngestSheetAuthFailure(data)) {
        return data;
      }
      if (!res.ok) {
        throw createIngestVerificationError(
          classifyIngestEndpointFailure({
            endpointUrl: endpoint,
            status: res.status,
            data,
            responseText,
            responseUrl: res.url || endpoint,
          }),
          endpoint,
          data && data.message
            ? data.message
            : "Ingest endpoint returned HTTP " + res.status,
        );
      }
      return data;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error("timeout");
      }
      if (err && err.discoveryVerificationResult) {
        throw err;
      }
      if (isFetchNetworkError(err)) {
        throw createIngestVerificationError(
          classifyIngestNetworkFailure(endpoint, err),
          endpoint,
          "Could not reach the ingest endpoint.",
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function resolveAsyncIngestResponse(data) {
    if (
      !data ||
      data.ok !== true ||
      data.kind !== "accepted_async" ||
      !data.runId
    ) {
      return data;
    }

    const statusPath = resolveAcceptedRunStatusPath(data, endpoint);
    const statusUrl = buildRunStatusUrl(statusPath, endpoint);
    if (!statusUrl) {
      throw new Error("timeout");
    }

    const pollAfterMs = Math.max(
      1000,
      Number(data.pollAfterMs) || INGEST_URL_ASYNC_POLL_MS,
    );
    const deadline = Date.now() + INGEST_URL_ASYNC_TIMEOUT_MS;
    let pollErrors = 0;
    reportIngestProgress(
      options.onProgress,
      32,
      "Browser Use is reading the posting",
      "scrape",
    );

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollAfterMs));
      let res;
      try {
        res = await fetch(statusUrl, {
          method: "GET",
          mode: "cors",
          headers: buildDiscoveryStatusPollHeaders(statusUrl),
        });
      } catch (err) {
        pollErrors += 1;
        if (pollErrors >= MAX_POLL_ERRORS) {
          throw createIngestVerificationError(
            classifyIngestNetworkFailure(statusUrl, err),
            statusUrl,
            "Could not reach the ingest status endpoint.",
          );
        }
        continue;
      }
      if (!res.ok) {
        pollErrors += 1;
        if (pollErrors >= MAX_POLL_ERRORS) {
          throw createIngestVerificationError(
            classifyIngestEndpointFailure({
              endpointUrl: statusUrl,
              status: res.status,
              data: null,
              responseText: await res.text().catch(() => ""),
              responseUrl: res.url || statusUrl,
            }),
            statusUrl,
            "Ingest status endpoint returned HTTP " + res.status,
          );
        }
        continue;
      }
      pollErrors = 0;
      const status = await res.json().catch(() => null);
      const state = String((status && status.status) || "").toLowerCase();
      const terminal =
        !!(status && status.terminal) ||
        state === "completed" ||
        state === "partial" ||
        state === "empty" ||
        state === "failed";
      if (!terminal) {
        reportIngestProgress(
          options.onProgress,
          52,
          "Still reading the posting",
          "scrape",
        );
        continue;
      }
      if (status && status.ingestResult) {
        return status.ingestResult;
      }
      if (state === "failed") {
        throw new Error((status && (status.error || status.message)) || "worker_error");
      }
      throw new Error("worker_error");
    }

    throw new Error("timeout");
  }

  const initialBody = await buildRequestBody();
  let data;
  try {
    data = await resolveAsyncIngestResponse(await postRequestBody(initialBody));
  } catch (err) {
    if (
      err &&
      err.discoveryVerificationResult &&
      err.discoveryVerificationResult.kind === "auth_required"
    ) {
      const refreshedSecret =
        await refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(endpoint);
      if (refreshedSecret && refreshedSecret !== activeDiscoverySecret) {
        activeDiscoverySecret = refreshedSecret;
        data = await resolveAsyncIngestResponse(await postRequestBody(initialBody));
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
  if (isIngestSheetAuthFailure(data)) {
    const retryBody = await buildRequestBody({
      forceGoogleTokenRefresh: true,
    });
    if (retryBody.googleAccessToken) {
      data = await resolveAsyncIngestResponse(await postRequestBody(retryBody));
    }
    if (isIngestSheetAuthFailure(data)) {
      clearPersistedRuntimeOAuthSession();
      if (getOAuthClientId()) showSheetAccessGate("signin");
      data = {
        ...data,
        message:
          "Google session expired while adding this job. Sign in again, then click Add to Pipeline.",
      };
    }
  }
  return data;
}

function getIngestManualModalEls() {
  return {
    modal: document.getElementById("ingestManualModal"),
    form: document.getElementById("ingestManualForm"),
    explain: document.getElementById("ingestManualModalExplain"),
    error: document.getElementById("ingestManualModalError"),
    urlField: document.getElementById("ingestManualUrl"),
    title: document.getElementById("ingestManualTitle"),
    company: document.getElementById("ingestManualCompany"),
    location: document.getElementById("ingestManualLocation"),
    description: document.getElementById("ingestManualDescription"),
    fit: document.getElementById("ingestManualFitScore"),
    fitLabel: document.getElementById("ingestManualFitScoreValue"),
    submit: document.getElementById("ingestManualSubmit"),
    cancel: document.getElementById("ingestManualCancel"),
    close: document.getElementById("ingestManualModalClose"),
  };
}

function setIngestManualModalError(message) {
  const els = getIngestManualModalEls();
  if (!els.error) return;
  if (!message) {
    els.error.style.display = "none";
    els.error.textContent = "";
    return;
  }
  els.error.style.display = "";
  els.error.textContent = message;
}

function openIngestManualModal({ url, message }) {
  const els = getIngestManualModalEls();
  if (!els.modal || !els.form) return;
  els.form.reset();
  if (els.urlField) els.urlField.value = url || "";
  if (els.fit) els.fit.value = "5";
  if (els.fitLabel) els.fitLabel.textContent = "5";
  if (els.explain) {
    els.explain.textContent =
      message || "We couldn't auto-scrape this URL — fill in what you can.";
  }
  setIngestManualModalError("");
  els.modal.style.display = "flex";
  if (els.title) {
    setTimeout(() => els.title.focus(), 0);
  }
}

function closeIngestManualModal() {
  const els = getIngestManualModalEls();
  if (els.modal) els.modal.style.display = "none";
  setIngestManualModalError("");
}

async function refreshPipelineAfterIngest(options = {}) {
  const url = String((options && options.url) || "").trim();
  const data = options && typeof options.data === "object" ? options.data : {};
  const onProgress = options && options.onProgress;
  const shouldLocate =
    !!url || Number.isFinite(Number(data && data.rowNumber));
  const attempts = shouldLocate ? 4 : 1;
  let idx = -1;

  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (typeof loadAllData === "function") {
        await loadAllData();
      }
      if (shouldLocate) {
        idx = getDuplicatePipelineIndexFromIngest(url, data);
        if (idx >= 0) {
          revealPipelineJobByIndex(idx);
          return true;
        }
      }
      if (attempt < attempts - 1) {
        reportIngestProgress(onProgress, 88, "Refreshing Pipeline", "refresh");
        await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 500));
      }
    }
  } catch (err) {
    console.warn("[JobBored] post-ingest refresh failed:", err);
    return false;
  }

  return false;
}

// Auto-enrich a freshly-ingested row so the card doesn't live on as
// "View / linkedin.com" placeholders. Reuses fetchJobPostingEnrichment (the
// same scraper + LLM pipeline the drawer runs on click) then patches the
// sheet's Title/Company/Location cells when the LLM inferred better values.
// All errors are non-fatal — row stays in Pipeline regardless, user can edit
// manually or wait for drawer-open enrichment to retry.
async function autoEnrichIngestedRow(url, persistedLead, options = {}) {
  if (!url) return;
  const onProgress = options && options.onProgress;

  // Collect every URL candidate we know about. The backend normalizes URLs
  // before writing (strips utm_*, trailing slashes, etc.) so the raw pasted
  // `url` often ≠ `pipelineData[i].link`. Try both and fall back to a loose
  // hostname+path match if strict matching misses.
  const trim = (value) => String(value || "").trim();
  const candidates = [
    trim(url),
    trim(persistedLead && (persistedLead.url || persistedLead.link)),
    trim(persistedLead && persistedLead.canonicalUrl),
    trim(persistedLead && persistedLead.finalUrl),
  ].filter(Boolean);
  if (candidates.length === 0) return;

  function looseUrlKey(value) {
    try {
      const u = new URL(value);
      // Hostname without www + pathname without trailing slash. Ignores
      // protocol, query, hash. Good enough to match "https://www.linkedin.com/
      // jobs/view/123?utm_source=foo" and "https://linkedin.com/jobs/view/123".
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      const path = u.pathname.replace(/\/+$/, "");
      return host + path;
    } catch {
      return "";
    }
  }
  const looseKeys = candidates.map(looseUrlKey).filter(Boolean);

  function findRowIndex() {
    for (const cand of candidates) {
      const strictIdx = pipelineData.findIndex(
        (job) => job && trim(job.link) === cand,
      );
      if (strictIdx >= 0) return strictIdx;
    }
    for (const key of looseKeys) {
      const looseIdx = pipelineData.findIndex(
        (job) => job && looseUrlKey(job.link || "") === key,
      );
      if (looseIdx >= 0) return looseIdx;
    }
    return -1;
  }

  try {
    // 1. Wait for pipeline to refresh so the new row is in pipelineData.
    //    Google Sheets has eventual consistency on read-after-write, so
    //    retry up to 4x with short backoff (total ~6s) before giving up.
    reportIngestProgress(onProgress, 54, "Finding the new Pipeline row", "refresh");
    let idx = -1;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (typeof loadAllData === "function") {
        await loadAllData().catch(() => {});
      }
      idx = findRowIndex();
      if (idx >= 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 500));
    }
    if (idx < 0) {
      console.warn(
        "[JobBored] auto-enrich: row not found after 4 retries. URL candidates:",
        candidates,
      );
      reportIngestProgress(onProgress, 88, "Refreshing Pipeline", "refresh");
      void refreshPipelineAfterIngest();
      return;
    }
    revealPipelineJobByIndex(idx);

    // 2. Visible progress signal — takes 3-8s typically.
    if (typeof showToast === "function") {
      showToast("Fetching job details…", "info");
    }
    reportIngestProgress(
      onProgress,
      70,
      "Scraping the posting and asking Gemini for details",
      "enrich",
    );

    // 3. Fire the same enrichment the drawer uses. Populates
    //    pipelineData[idx]._postingEnrichment with inferredTitle/Company/
    //    Location + the full LLM bundle (which ALSO writes to localStorage
    //    cache keyed by job.link, so the drawer picks it up instantly on
    //    open regardless of subsequent loadAllData() re-hydrations).
    await fetchJobPostingEnrichment(idx).catch((err) => {
      console.warn("[JobBored] auto-enrich enrichment call:", err);
    });

    const job = pipelineData[idx];
    const enr = job && job._postingEnrichment;
    if (!enr) {
      reportIngestProgress(onProgress, 88, "Refreshing Pipeline", "refresh");
      void refreshPipelineAfterIngest();
      return;
    }

    // 5. Compute cell updates. Only replace placeholders ("View", "Linkedin",
    //    "Job at <host>", empty) — never overwrite values the user has
    //    typed/edited since paste.
    const sheetRow = typeof getSheetRow === "function" ? getSheetRow(idx) : null;
    if (!sheetRow) return;

    const isPlaceholderTitle = (value) => {
      const v = String(value || "").trim();
      if (!v) return true;
      if (/^view$/i.test(v)) return true;
      if (/^job at /i.test(v)) return true;
      // URL-slug-derived titles land as Title Case with no real role noun.
      // Leave them alone unless inferred title is clearly richer.
      return false;
    };
    const isPlaceholderCompany = (value) => {
      const v = String(value || "").trim();
      if (!v) return true;
      if (/^unknown company$/i.test(v)) return true;
      // Aggregator-hostname names we wrote as URL-only fallbacks.
      const aggr = /^(linkedin|indeed|glassdoor|ziprecruiter|monster|simplyhired|careerbuilder|wellfound|google|angel|dice|builtin)$/i;
      return aggr.test(v);
    };

    const inferredTitle = String(enr.inferredTitle || "").trim();
    const inferredCompany = String(enr.inferredCompany || "").trim();
    const inferredLocation = String(enr.inferredLocation || "").trim();

    const updates = [];
    reportIngestProgress(onProgress, 84, "Updating inferred job details", "write");
    if (inferredTitle && isPlaceholderTitle(job.title)) {
      updates.push({ range: `Pipeline!B${sheetRow}`, value: inferredTitle });
      job.title = inferredTitle;
    }
    if (inferredCompany && isPlaceholderCompany(job.company)) {
      updates.push({ range: `Pipeline!C${sheetRow}`, value: inferredCompany });
      job.company = inferredCompany;
    }
    if (inferredLocation && !String(job.location || "").trim()) {
      updates.push({ range: `Pipeline!D${sheetRow}`, value: inferredLocation });
      job.location = inferredLocation;
    }
    // Replace the aggregator-hostname favicon the worker wrote at ingest
    // time (e.g. LinkedIn/Indeed favicon) with a company-specific logo
    // resolved via Clearbit autocomplete. Fires in parallel with the
    // other updates so the sheet write batches together.
    //
    // Gating: we update the logo when EITHER the company name was just
    // promoted (definite stale-logo signal — ignore the placeholder
    // regex entirely), OR the existing Logo URL cell still matches a
    // known aggregator-favicon pattern. User-edited logos (custom hosts
    // outside the aggregator regex) stay untouched when the company
    // didn't change.
    const companyPromotedThisRun = updates.some(
      (u) => u.range === `Pipeline!C${sheetRow}`,
    );
    const shouldUpdateLogo =
      inferredCompany &&
      (companyPromotedThisRun || isPlaceholderLogoUrl(job.logoUrl));
    console.info("[JobBored] auto-enrich logo check:", {
      inferredCompany,
      existingLogoUrl: job.logoUrl,
      companyPromotedThisRun,
      isPlaceholder: isPlaceholderLogoUrl(job.logoUrl),
      shouldUpdateLogo,
    });
    if (shouldUpdateLogo) {
      const newLogoUrl = await resolveCompanyLogoUrl(inferredCompany);
      console.info("[JobBored] auto-enrich resolved logo:", newLogoUrl);
      if (newLogoUrl) {
        updates.push({ range: `Pipeline!T${sheetRow}`, value: newLogoUrl });
        job.logoUrl = newLogoUrl;
        // In-memory bump so the next renderPipeline reflects the real
        // logo even before the sheet round-trip completes. Without
        // this, the card can stay as the LinkedIn "in" icon for ~2s
        // while the sheet write + re-read propagates.
        if (typeof renderPipeline === "function") renderPipeline();
      }
    }

    if (updates.length === 0) {
      // Nothing to promote — drawer enrichment did run and is cached, so
      // drawer open will be instant next time. Just re-render so the card
      // picks up any _postingEnrichment-derived display tweaks.
      if (typeof renderPipeline === "function") renderPipeline();
      reportIngestProgress(onProgress, 92, "Pipeline refreshed", "refresh");
      return;
    }

    const ok = await updateMultipleCells(updates).catch(() => false);
    if (!ok) {
      // Non-fatal — the row is already in the sheet, just with placeholders.
      // Re-render anyway so the in-memory title/company update is visible
      // locally, even if it doesn't persist to Sheets.
      if (typeof renderPipeline === "function") renderPipeline();
      reportIngestProgress(onProgress, 92, "Pipeline refreshed", "refresh");
      return;
    }

    // Sheet patched. Refresh again so the pipeline reflects the real values.
    reportIngestProgress(onProgress, 92, "Refreshing Pipeline", "refresh");
    if (typeof loadAllData === "function") {
      await loadAllData().catch(() => {});
    }
    if (typeof showToast === "function") {
      showToast("Details filled in: " + inferredTitle, "success");
    }
  } catch (err) {
    console.warn("[JobBored] autoEnrichIngestedRow:", err);
  }
}

function handleIngestUrlResponse(data, url, options = {}) {
  if (!data || typeof data !== "object") {
    showToast("Unexpected response from worker", "error", true);
    return data;
  }
  if (data.ok === true) {
    const title =
      (data.lead && (data.lead.title || data.lead.role)) || "job";
    const strategy = (data && data.strategy) || "";
    const verb =
      data.updated === true || data.appended === false ? "Updated" : "Added";
    showToast(verb + ": " + title, "success");
    closeIngestManualModal();
    // For url_only rows we only have URL-derived placeholder title/company.
    // Fire the drawer enrichment pipeline now (scrape + LLM) and promote the
    // sheet row's B/C/D cells with the LLM-inferred real values. Other
    // strategies (ats_api / jsonld / cheerio_dom / manual_fill) already have
    // clean fields — just refresh.
    if (strategy === "url_only") {
      const enrich = autoEnrichIngestedRow(url, data.lead, {
        onProgress: options.onProgress,
      });
      if (options.awaitAutoEnrich) {
        return enrich.then(() => data);
      }
      void enrich;
    } else {
      reportIngestProgress(options.onProgress, 82, "Refreshing Pipeline", "refresh");
      const refresh = refreshPipelineAfterIngest({
        url,
        data,
        onProgress: options.onProgress,
      });
      if (options.awaitAutoEnrich) {
        return refresh.then(() => data);
      }
      void refresh;
    }
    return data;
  }
  if (data.ok === false) {
    switch (data.reason) {
      case "blocked_aggregator":
      case "scrape_failed": {
        const hint =
          (typeof data.hint === "string" && data.hint.trim()) ||
          (typeof data.message === "string" && data.message.trim()) ||
          "We couldn't read a complete posting from this URL.";
        const label =
          data.reason === "blocked_aggregator"
            ? aggregatorLabelForHost(data.host) + " did not expose a complete posting. "
            : "";
        showToast(label + hint, "warning", true);
        return data;
      }
      case "duplicate": {
        const row = data.rowNumber;
        const suffix = Number.isFinite(row) && row >= 2 ? " (row " + row + ")" : "";
        const existingIndex = getDuplicatePipelineIndexFromIngest(url, data);
        const focused = focusPipelineJobByIndex(existingIndex);
        showToast(
          "Already in Pipeline" + suffix + (focused ? " — focused the existing card." : ""),
          "info",
        );
        closeIngestManualModal();
        return data;
      }
      case "invalid_url":
      case "private_network": {
        showToast(
          data.message || "Could not ingest URL: " + data.reason,
          "error",
        );
        return data;
      }
      case "low_quality_extraction": {
        showToast(
          data.message ||
            "The worker could not read a complete posting from that link.",
          "warning",
          true,
        );
        return data;
      }
      default: {
        showToast(
          data.message || "Unexpected response from worker",
          "error",
          true,
        );
        return data;
      }
    }
  }
  showToast("Unexpected response from worker", "error", true);
  return data;
}

function setIngestSubmitLoading(button, loading) {
  if (!button) return;
  if (loading) {
    button.disabled = true;
    button.dataset.originalLabel = button.textContent || "";
    button.textContent = "Adding…";
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }
}

function setIngestSubmitProgressLabel(button, update) {
  if (!button || !update || typeof update !== "object") return;
  const step = String(update.step || "");
  if (step === "scrape") {
    button.textContent = "Reading posting...";
  } else if (step === "refresh") {
    button.textContent = "Refreshing...";
  } else if (step === "pipeline" || step === "write") {
    button.textContent = "Adding...";
  }
}

async function submitIngestFromToolbar() {
  const input = document.getElementById("ingestUrlInput");
  const button = document.getElementById("ingestUrlSubmit");
  if (!input) return;
  const url = String(input.value || "").trim();
  if (!url) {
    showToast("Paste a job URL first", "error");
    input.focus();
    return;
  }
  if (!isParseableUrl(url)) {
    showToast("That doesn't look like a valid http(s) URL", "error");
    input.focus();
    if (typeof input.select === "function") input.select();
    return;
  }
  setIngestSubmitLoading(button, true);
  try {
    const data = await handleIngestUrlSubmit(url, undefined, {
      onProgress: (update) => setIngestSubmitProgressLabel(button, update),
    });
    handleIngestUrlResponse(data, url);
    if (data && data.ok === true) {
      input.value = "";
    }
  } catch (err) {
    if (err && err.message === "missing_discovery_webhook") {
      showToast(
        "No ingest worker is connected. Use Add manually, or connect a discovery worker.",
        "warning",
        true,
        {
          label: "Add manually",
          onClick: () => {
            openIngestManualModal({
              url,
              message:
                "No ingest worker is connected. Fill in the details and JobBored will append the row directly to Pipeline.",
            });
          },
        },
      );
    } else if (err && err.message === "timeout") {
      showToast("Ingest timed out — try again", "error");
    } else if (err && err.message === "invalid_endpoint") {
      // toast already shown
    } else if (showIngestDiscoveryError(err)) {
      // Verifier copy + action already shown.
    } else {
      console.error("[JobBored] ingest-url submit failed:", err);
      showToast("Network error — could not reach worker", "error");
    }
  } finally {
    setIngestSubmitLoading(button, false);
  }
}

async function submitIngestFromManualModal() {
  const els = getIngestManualModalEls();
  if (!els.form) return;
  const url = (els.urlField && els.urlField.value.trim()) || "";
  const title = (els.title && els.title.value.trim()) || "";
  const company = (els.company && els.company.value.trim()) || "";
  const location = (els.location && els.location.value.trim()) || "";
  const description =
    (els.description && els.description.value.trim()) || "";
  const fitScoreRaw = els.fit ? Number(els.fit.value) : 5;
  const fitScore = Number.isFinite(fitScoreRaw) ? fitScoreRaw : 5;

  setIngestManualModalError("");
  if (!title) {
    setIngestManualModalError("Title is required.");
    if (els.title) els.title.focus();
    return;
  }
  if (!company) {
    setIngestManualModalError("Company is required.");
    if (els.company) els.company.focus();
    return;
  }
  if (url && !isParseableUrl(url)) {
    setIngestManualModalError("URL is invalid.");
    return;
  }

  setIngestSubmitLoading(els.submit, true);
  try {
    const manualPayload = {
      title,
      company,
      location,
      description,
      fitScore,
    };
    const data = url
      ? await handleIngestUrlSubmit(url, manualPayload)
      : await appendManualPipelineRowDirect(manualPayload);
    if (data && data.ok === true) {
      handleIngestUrlResponse(data, url);
      const toolbarInput = document.getElementById("ingestUrlInput");
      if (toolbarInput) toolbarInput.value = "";
      return;
    }
    if (data && data.ok === false && data.reason === "duplicate") {
      handleIngestUrlResponse(data, url);
      return;
    }
    setIngestManualModalError(
      (data && data.message) ||
        "Worker rejected the manual entry. Check the fields and try again.",
    );
  } catch (err) {
    if (err && err.message === "missing_discovery_webhook") {
      try {
        const direct = await appendManualPipelineRowDirect({
          title,
          company,
          location,
          description,
          fitScore,
          url,
        });
        handleIngestUrlResponse(direct, url);
        return;
      } catch (directErr) {
        setIngestManualModalError(
          directErr && directErr.message === "signed_out"
            ? "Sign in with Google so JobBored can append this row to Pipeline."
            : "Could not append directly to Pipeline.",
        );
      }
    } else if (err && err.message === "timeout") {
      setIngestManualModalError("Request timed out. Try again.");
    } else if (err && err.message === "signed_out") {
      setIngestManualModalError(
        "Sign in with Google so JobBored can append this row to Pipeline.",
      );
    } else if (err && err.message === "missing_sheet") {
      setIngestManualModalError(
        "Connect your Pipeline sheet before adding manual rows.",
      );
    } else if (err && err.discoveryVerificationResult) {
      setIngestManualModalError(
        formatDiscoveryVerificationError(
          err.discoveryVerificationResult,
          "Could not reach the ingest worker.",
        ),
      );
      showIngestDiscoveryError(err);
    } else {
      console.error("[JobBored] manual-fill submit failed:", err);
      setIngestManualModalError("Network error — could not reach worker.");
    }
  } finally {
    setIngestSubmitLoading(els.submit, false);
  }
}

function initIngestUrlFlow() {
  const form = document.getElementById("ingestUrlForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitIngestFromToolbar();
    });
  }

  const els = getIngestManualModalEls();
  if (els.form) {
    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      submitIngestFromManualModal();
    });
  }
  if (els.fit && els.fitLabel) {
    els.fit.addEventListener("input", () => {
      els.fitLabel.textContent = String(els.fit.value);
    });
  }
  if (els.cancel) {
    els.cancel.addEventListener("click", () => closeIngestManualModal());
  }
  if (els.close) {
    els.close.addEventListener("click", () => closeIngestManualModal());
  }
  // Explicit "Add manually" escape hatch in the hero card footnote. Lets
  // users skip URL paste entirely (e.g. posting only exists on a site we
  // can't link to, or they want to track a job they heard about verbally).
  const manualOpenBtn = document.getElementById("ingestManualModalOpenBtn");
  if (manualOpenBtn) {
    manualOpenBtn.addEventListener("click", () => {
      openIngestManualModal({
        url: "",
        message:
          "No URL handy? Fill in the basics and we'll track it in your Pipeline.",
      });
    });
  }
  if (els.modal) {
    els.modal.addEventListener("click", (e) => {
      if (e.target === els.modal) closeIngestManualModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.modal.style.display === "flex") {
        closeIngestManualModal();
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initCommandCenterSettings();
  initSetupAndSheetAccessActions();
  initScraperSetupGuide();
  initDiscoverySetupGuide();
  initPipelineEmptyAndBriefActions();
  initIngestUrlFlow();
  init();
});
