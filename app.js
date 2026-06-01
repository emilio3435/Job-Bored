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
// --- Discovery status handoff (extracted to discovery-status-handoff.js) ---
function statusApi(name, ...args) {
  return window.JobBoredDiscovery.status[name](...args);
}
const PENDING_DISCOVERY_SETUP_KEY =
  window.JobBoredDiscovery.status.PENDING_DISCOVERY_SETUP_KEY;
function isManagedAppsScriptDeployState(...args) {
  return statusApi("isManagedAppsScriptDeployState", ...args);
}
function isAppsScriptPublicAccessReady(...args) {
  return statusApi("isAppsScriptPublicAccessReady", ...args);
}
function openAppsScriptRemediationFlowInSettings(...args) {
  return statusApi("openAppsScriptRemediationFlowInSettings", ...args);
}
function showAppsScriptPublicAccessRemediationFromState(...args) {
  return statusApi("showAppsScriptPublicAccessRemediationFromState", ...args);
}
async function diagnoseDownstreamChain(...args) {
  return statusApi("diagnoseDownstreamChain", ...args);
}
function setAppsScriptDeployStatus(...args) {
  return statusApi("setAppsScriptDeployStatus", ...args);
}
function clearAppsScriptDeployStatus(...args) {
  return statusApi("clearAppsScriptDeployStatus", ...args);
}
function hasPendingDiscoverySetup(...args) {
  return statusApi("hasPendingDiscoverySetup", ...args);
}
function queuePendingDiscoverySetup(...args) {
  return statusApi("queuePendingDiscoverySetup", ...args);
}
async function resumePendingDiscoverySetupIfNeeded(...args) {
  return statusApi("resumePendingDiscoverySetupIfNeeded", ...args);
}
function stripSetupDiscoveryParam(...args) {
  return statusApi("stripSetupDiscoveryParam", ...args);
}
function focusDiscoveryWebhookFieldInSettings(...args) {
  return statusApi("focusDiscoveryWebhookFieldInSettings", ...args);
}
async function openSettingsForDiscoveryWebhook(...args) {
  return statusApi("openSettingsForDiscoveryWebhook", ...args);
}
async function requestDiscoverySetup(...args) {
  return statusApi("requestDiscoverySetup", ...args);
}
function buildRunStatusUrl(...args) {
  return statusApi("buildRunStatusUrl", ...args);
}
function canSynthesizeRunStatusPath(...args) {
  return statusApi("canSynthesizeRunStatusPath", ...args);
}
function resolveAcceptedRunStatusPath(...args) {
  return statusApi("resolveAcceptedRunStatusPath", ...args);
}
function isLikelyNgrokUrl(...args) {
  return statusApi("isLikelyNgrokUrl", ...args);
}
function getDiscoveryStatusPollingWebhookUrl(...args) {
  return statusApi("getDiscoveryStatusPollingWebhookUrl", ...args);
}
function buildDiscoveryStatusPollHeaders(...args) {
  return statusApi("buildDiscoveryStatusPollHeaders", ...args);
}
async function pollRunStatus(...args) {
  return statusApi("pollRunStatus", ...args);
}
function retryDiscoveryStatusConnection(...args) {
  return statusApi("retryDiscoveryStatusConnection", ...args);
}
function shouldRefreshPipelineAfterDiscoveryRun(...args) {
  return statusApi("shouldRefreshPipelineAfterDiscoveryRun", ...args);
}
async function refreshPipelineAfterDiscoveryRun(...args) {
  return statusApi("refreshPipelineAfterDiscoveryRun", ...args);
}
async function startDiscoveryStatusPolling(...args) {
  return statusApi("startDiscoveryStatusPolling", ...args);
}
function stopDiscoveryStatusPolling(...args) {
  return statusApi("stopDiscoveryStatusPolling", ...args);
}
function resumeDiscoveryStatusPollingIfNeeded(...args) {
  return statusApi("resumeDiscoveryStatusPollingIfNeeded", ...args);
}
function renderDiscoveryRunStatus(...args) {
  return statusApi("renderDiscoveryRunStatus", ...args);
}
async function handleDiscoverySetupDeepLink(...args) {
  return statusApi("handleDiscoverySetupDeepLink", ...args);
}
function runPostAccessBootstrapOnce(...args) {
  return statusApi("runPostAccessBootstrapOnce", ...args);
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

// --- Discovery engine state (extracted to discovery-engine-state.js) ---

function getSettingsFieldValue(id) {
  return window.JobBoredDiscovery.engineState.getSettingsFieldValue(id);
}

function getSettingsSheetIdValue() {
  return window.JobBoredDiscovery.engineState.getSettingsSheetIdValue();
}

function getSettingsOAuthClientIdValue() {
  return window.JobBoredDiscovery.engineState.getSettingsOAuthClientIdValue();
}

function hasUnsavedOAuthClientIdChange(candidateId) {
  return window.JobBoredDiscovery.engineState.hasUnsavedOAuthClientIdChange(
    candidateId,
  );
}

function getDiscoveryEngineStateStore() {
  return window.JobBoredDiscovery.engineState.getDiscoveryEngineStateStore();
}

function normalizeDiscoveryWebhookIdentity(raw) {
  return window.JobBoredDiscovery.engineState.normalizeDiscoveryWebhookIdentity(
    raw,
  );
}

function getDiscoveryWebhookUrlForSettingsPreview() {
  return window.JobBoredDiscovery.engineState.getDiscoveryWebhookUrlForSettingsPreview();
}

function getManagedAppsScriptWebhookIdentity() {
  return window.JobBoredDiscovery.engineState.getManagedAppsScriptWebhookIdentity();
}

function getSavedDiscoveryEngineStateForUrl(rawUrl) {
  return window.JobBoredDiscovery.engineState.getSavedDiscoveryEngineStateForUrl(
    rawUrl,
  );
}

function getEffectiveDiscoveryEngineStatus(rawUrl) {
  return window.JobBoredDiscovery.engineState.getEffectiveDiscoveryEngineStatus(
    rawUrl,
  );
}

function buildDiscoveryStatusActions(status) {
  return window.JobBoredDiscovery.engineState.buildDiscoveryStatusActions(status);
}

async function saveDiscoveryEngineStatePatch(patch) {
  return window.JobBoredDiscovery.engineState.saveDiscoveryEngineStatePatch(
    patch,
  );
}

async function recordDiscoveryEngineState(rawUrl, state, source) {
  return window.JobBoredDiscovery.engineState.recordDiscoveryEngineState(
    rawUrl,
    state,
    source,
  );
}

// --- Discovery readiness (extracted to discovery-readiness.js) ---

function refreshDiscoveryUiState(...args) {
  return window.JobBoredDiscovery.readiness.refreshDiscoveryUiState(...args);
}

function inferLocalWebhookPort(...args) {
  return window.JobBoredDiscovery.readiness.inferLocalWebhookPort(...args);
}
function buildDiscoveryTunnelTargetUrl(...args) {
  return window.JobBoredDiscovery.readiness.buildDiscoveryTunnelTargetUrl(...args);
}
function getDiscoveryLocalWebhookHealthUrl(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryLocalWebhookHealthUrl(...args);
}
function getCloudflareRelayTargetInfo(...args) {
  return window.JobBoredDiscovery.readiness.getCloudflareRelayTargetInfo(...args);
}
function getDiscoveryWizardRoot(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardRoot(...args);
}
function getDiscoveryWizardShellApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardShellApi(...args);
}
function getDiscoveryWizardProbesApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardProbesApi(...args);
}
function getDiscoveryWizardLocalApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardLocalApi(...args);
}
function getDiscoveryWizardRelayApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardRelayApi(...args);
}
function getDiscoveryWizardVerifyApi(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardVerifyApi(...args);
}
function mapDiscoveryWizardFlow(...args) {
  return window.JobBoredDiscovery.readiness.mapDiscoveryWizardFlow(...args);
}
function getDiscoveryLocalEngineKind(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryLocalEngineKind(...args);
}
function getDiscoveryLocalEngineLabel(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryLocalEngineLabel(...args);
}
function getDiscoveryLocalEngineSummary(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryLocalEngineSummary(...args);
}
function getDiscoveryRecoveryCopy(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryRecoveryCopy(...args);
}
function getDiscoveryReadinessSnapshot(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryReadinessSnapshot(...args);
}
function getDiscoverySettingsView(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoverySettingsView(...args);
}
function getDiscoveryEmptyStateView(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryEmptyStateView(...args);
}
async function refreshDiscoveryReadinessSnapshot(...args) {
  return window.JobBoredDiscovery.readiness.refreshDiscoveryReadinessSnapshot(...args);
}
async function buildDiscoveryWebhookPayload(...args) {
  return window.JobBoredDiscovery.readiness.buildDiscoveryWebhookPayload(...args);
}
function getDiscoveryRequestGoogleAccessToken(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryRequestGoogleAccessToken(...args);
}
async function getFreshDiscoveryRequestGoogleAccessToken(...args) {
  return window.JobBoredDiscovery.readiness.getFreshDiscoveryRequestGoogleAccessToken(...args);
}
function showDiscoveryVerificationToast(...args) {
  return window.JobBoredDiscovery.readiness.showDiscoveryVerificationToast(...args);
}
async function verifyDiscoveryWebhookWithSharedModel(...args) {
  return window.JobBoredDiscovery.readiness.verifyDiscoveryWebhookWithSharedModel(...args);
}
function getDiscoveryWizardDefaultDrafts(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardDefaultDrafts(...args);
}
function createDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.createDiscoveryWizardRuntime(...args);
}
function getDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardRuntime(...args);
}
function updateDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.updateDiscoveryWizardRuntime(...args);
}
function clearDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.clearDiscoveryWizardRuntime(...args);
}
function setDiscoveryWizardRuntime(...args) {
  return window.JobBoredDiscovery.readiness.setDiscoveryWizardRuntime(...args);
}
function getDiscoveryWizardStepIds(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardStepIds(...args);
}
function getDiscoveryWizardStepsBefore(...args) {
  return window.JobBoredDiscovery.readiness.getDiscoveryWizardStepsBefore(...args);
}
async function persistDiscoveryWizardState(...args) {
  return window.JobBoredDiscovery.readiness.persistDiscoveryWizardState(...args);
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
  return window.JobBoredDiscovery.engineState.getDiscoveryEngineStateFromVerificationResult(
    result,
  );
}


async function preloadDiscoveryUiState() {
  const appsScriptStore = getAppsScriptDeployStateStore();
  if (appsScriptStore) {
    try {
      configCore.appsScriptDeployStateCache =
        await appsScriptStore.getAppsScriptDeployState();
    } catch (err) {
      console.warn("[JobBored] Apps Script deploy state preload:", err);
    }
  }
  await window.JobBoredDiscovery.engineState.preloadDiscoveryEngineState();
  await refreshDiscoveryReadinessSnapshot({ force: true, rerender: false });
  refreshDiscoveryUiState();
}



// ============================================
// DISCOVERY SETUP WIZARD
// ============================================


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

function getAppsScriptDeployStateStore(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.getAppsScriptDeployStateStore(...args);
}
async function populateAppsScriptDeployStateIntoSettingsForm(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.populateAppsScriptDeployStateIntoSettingsForm(...args);
}
function refreshSerpApiCalloutStatus(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.refreshSerpApiCalloutStatus(...args);
}
function renderAppsScriptDeployUi(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.renderAppsScriptDeployUi(...args);
}
async function deployAppsScriptStubFromSettings(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.deployAppsScriptStubFromSettings(...args);
}
async function recheckAppsScriptPublicAccessFromSettings(...args) {
  return window.JobBoredDiscovery.appsScriptDeploy.recheckAppsScriptPublicAccessFromSettings(...args);
}



function renderDiscoveryEngineStatusUi() {
  window.JobBoredDiscovery.appsScriptDeploy.refreshSerpApiCalloutStatus();
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


function initScraperSetupGuide() {
  return window.JobBoredApp.scraperAts.initScraperSetupGuide();
}

// ============================================
// STATE
// ============================================

let SHEET_ID = null;

let dataLoadFailed = false;
let dashboardDataHydrated = false;
let initialSheetAccessResolved = false;
let pendingSetupStarterSheetCreate = false;

// Pipeline controller — extracted to pipeline-controller.js
function pipelineController() {
  return window.JobBoredApp.pipelineController;
}
function getPipelineData() {
  return pipelineController().getPipelineData();
}
function setPipelineData(data) {
  return pipelineController().setPipelineData(data);
}
function getPipelineRawRows() {
  return pipelineController().getPipelineRawRows();
}
function setPipelineRawRows(rows) {
  return pipelineController().setPipelineRawRows(rows);
}
function getCurrentSort() {
  return pipelineController().getCurrentSort();
}
function setCurrentSort(value) {
  return pipelineController().setCurrentSort(value);
}
function getCurrentSearch() {
  return pipelineController().getCurrentSearch();
}
function setCurrentSearch(value) {
  return pipelineController().setCurrentSearch(value);
}
function getFavoritesOnly() {
  return pipelineController().getFavoritesOnly();
}
function setFavoritesOnly(value) {
  return pipelineController().setFavoritesOnly(value);
}
function getShowDismissed() {
  return pipelineController().getShowDismissed();
}
function setShowDismissed(value) {
  return pipelineController().setShowDismissed(value);
}
function getActiveDetailKey() {
  return pipelineController().getActiveDetailKey();
}
function setActiveDetailKey(value) {
  return pipelineController().setActiveDetailKey(value);
}
function getViewedJobKeys() {
  return pipelineController().getViewedJobKeys();
}
function getExpandedJobKeys() {
  return pipelineController().getExpandedJobKeys();
}
function getExpandedStages() {
  return pipelineController().getExpandedStages();
}
function getStageOrder() {
  return pipelineController().getStageOrder();
}
function getStageArchive() {
  return pipelineController().getStageArchive();
}
function markJobViewed(stableKey) {
  return pipelineController().markJobViewed(stableKey);
}
function getPipelineViewFilters() {
  return pipelineController().getPipelineViewFilters();
}
function syncPipelineFilterControls() {
  return pipelineController().syncPipelineFilterControls();
}
function notifyPipelineFiltersChanged() {
  return pipelineController().notifyPipelineFiltersChanged();
}
function notifyPipelineRendered() {
  return pipelineController().notifyPipelineRendered();
}
function setPipelineViewFilters(nextFilters = {}) {
  return pipelineController().setPipelineViewFilters(nextFilters);
}
function applyPipelineStageWrite(jobKey, statusLabel) {
  return pipelineController().applyPipelineStageWrite(jobKey, statusLabel);
}
function applyPipelineNotesWrite(jobKey, body) {
  return pipelineController().applyPipelineNotesWrite(jobKey, body);
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
    return getPipelineData();
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



function generateDiscoveryVariationKey(...args) {
  return window.JobBoredDiscovery.runOrchestration.generateDiscoveryVariationKey(...args);
}

function getDiscoveryRunWebhookUrlCandidates(...args) {
  return window.JobBoredDiscovery.runOrchestration.getDiscoveryRunWebhookUrlCandidates(...args);
}

function isLocalWebhookCandidateUrl(...args) {
  return window.JobBoredDiscovery.runOrchestration.isLocalWebhookCandidateUrl(...args);
}

function getDiscoveryRunWebhookCandidateProbe(...args) {
  return window.JobBoredDiscovery.runOrchestration.getDiscoveryRunWebhookCandidateProbe(...args);
}

async function scoreDiscoveryRunWebhookCandidates(...args) {
  return window.JobBoredDiscovery.runOrchestration.scoreDiscoveryRunWebhookCandidates(...args);
}

async function resolveDiscoveryRunWebhookUrl(...args) {
  return window.JobBoredDiscovery.runOrchestration.resolveDiscoveryRunWebhookUrl(...args);
}

async function ensureLocalDiscoveryAutoSetupForRun(...args) {
  return window.JobBoredDiscovery.runOrchestration.ensureLocalDiscoveryAutoSetupForRun(...args);
}

/** Notify automation (Hermes, n8n, etc.) to run another discovery pass (varied query). */
async function triggerDiscoveryRun(...args) {
  return window.JobBoredDiscovery.runOrchestration.triggerDiscoveryRun(...args);
}

function registerBridgeHosts() {
  window.JobBoredApp.bridgeRegistry.registerAllBridges({
    COMMAND_CENTER_CONFIG_OVERRIDE_KEY,
    DISCOVERY_TRANSPORT_SETUP_KEY,
    DISCOVERY_RUN_TRACKER_KEY,
    FORCE_CONSENT_PROMPT_KEY,
    DISCOVERY_ENGINE_STATE_NONE,
    DISCOVERY_ENGINE_STATE_STUB_ONLY,
    DISCOVERY_ENGINE_STATE_UNVERIFIED,
    GOOGLE_SHEETS_SCOPE,
    STARTER_PIPELINE_HEADERS,
    STARTER_PIPELINE_HEADER_RANGE,
    getConfigCore() {
      return configCore;
    },
    getSHEET_ID() {
      return SHEET_ID;
    },
    setSHEET_ID(value) {
      SHEET_ID = value;
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
    getDataLoadFailed() {
      return dataLoadFailed;
    },
    setDataLoadFailed(value) {
      dataLoadFailed = value;
    },
    getPendingSetupStarterSheetCreate() {
      return pendingSetupStarterSheetCreate;
    },
    setPendingSetupStarterSheetCreate(value) {
      pendingSetupStarterSheetCreate = !!value;
    },
    setPendingSetupStarterSheetCreateRaw(value) {
      pendingSetupStarterSheetCreate = value;
    },
    getGisInitStartedAt() {
      return typeof gisInitStartedAt !== "undefined" && gisInitStartedAt
        ? gisInitStartedAt
        : 0;
    },
    applyOAuthClientChange,
    buildCandidateProfileExcerpt,
    buildCloudflareRelayAgentPrompt,
    buildCloudflareRelayCorsSnippet,
    buildDiscoveryRelayDeployCommandForTarget,
    buildDiscoveryTunnelTargetUrl,
    buildDiscoveryWebhookPayload,
    cacheEnrichment,
    canUseLocalStorage,
    checkOnboardingGate,
    clearDiscoveryWizardRuntime,
    clearPersistedOAuthSession,
    clearPersistedRuntimeOAuthSession,
    clearSessionAuthState,
    closeAuthUserMenu,
    closeCommandCenterSettingsModal,
    closeDiscoverySetupGuideModal,
    closeMaterialsModal,
    closeScraperSetupModal,
    copyTextToClipboard,
    createDiscoveryRelayCopyCommandToastAction,
    createDiscoveryWizardRuntime,
    deployAppsScriptStubFromSettings,
    diagnoseDownstreamChain,
    dismissJob,
    escapeHtml,
    fetchJobPostingEnrichment,
    fillDocumentTemplateSelect,
    fillVisualThemeSelect,
    focusDiscoveryWebhookFieldInSettings,
    getAccessToken,
    getActiveDetailKey,
    getActiveSheetId,
    getAtsScorecardApiUrl,
    getAtsScoringConfig,
    getCachedEnrichmentForJob,
    getCloudflareRelayTargetInfo,
    getConfig,
    getCurrentSearch,
    getCurrentSort,
    getDiscoveryEngineStateFromVerificationResult,
    getDiscoveryLocalEngineKind,
    getDiscoveryLocalEngineLabel,
    getDiscoveryLocalEngineSummary,
    getDiscoveryLocalWebhookHealthUrl,
    getDiscoveryReadinessSnapshot,
    getDiscoveryRecoveryCopy,
    getDiscoveryRelaySuggestedOrigin,
    getDiscoveryRelayWorkerName,
    getDiscoverySettingsView,
    getDiscoveryTransportSetupState,
    getDiscoveryWebhookSecret,
    getDiscoveryWebhookUrl,
    getDiscoveryWizardDefaultDrafts,
    getDiscoveryWizardLocalApi,
    getDiscoveryWizardProbesApi,
    getDiscoveryWizardRecommendedFlow,
    getDiscoveryWizardRelayApi,
    getDiscoveryWizardRoot,
    getDiscoveryWizardRuntime,
    getDiscoveryWizardShellApi,
    getDiscoveryWizardStepIds,
    getDiscoveryWizardStepsBefore,
    getDiscoveryWizardVerifyApi,
    getDraftsForJob,
    getEffectiveFitProfileFields,
    getFavoritesOnly,
    getFreshDiscoveryRequestGoogleAccessToken,
    getGisLoaded,
    getJobOpportunityKey,
    getJobPostingScrapeUrl,
    getManagedAppsScriptWebhookIdentity,
    getOAuthClientId,
    getPipelineData,
    getPipelineRawRows,
    getPipelineViewFilters,
    getResumeBundle,
    getResumeGenerate,
    getResumeIngest,
    getResumeIngestReady,
    getSavedDiscoveryEngineStateForUrl,
    getSettingsFieldValue,
    getSettingsOAuthClientIdValue,
    getSettingsSheetIdValue,
    getSheetId,
    getSheetRow,
    getShowDismissed,
    getSuggestedCloudflareRelayWorkerName,
    getTokenClient,
    getTokenExpiresAt,
    getUserContent,
    getUserEmailFromAuth,
    getViewedJobKeys,
    getExpandedStages,
    handleAppsScriptBrowserCorsFailure,
    handleSetupCreateStarterSheet,
    hasGrantedOauthScope,
    hasPendingDiscoverySetup,
    hasUnsavedOAuthClientIdChange,
    hideOnboardingWizard,
    hideSettingsClearConfirmBar,
    hydrateDiscoveryTransportSetupFromLocalBootstrap,
    inferCloudflareWorkerNameFromOpenWorkerUrl,
    inferLocalWebhookPort,
    initAuth,
    initAuthUserMenu,
    initCommandCenterSettings,
    initDiscoveryButton,
    initDiscoveryDrawer,
    initDiscoverySetupGuide,
    initDiscoverySubtabs,
    initExpiredReviewUi,
    initIngestUrlFlow,
    initResumeMaterialsFeature,
    initScraperSetupGuide,
    initSetupAndSheetAccessActions,
    installDoctor,
    installKeepAliveOnce,
    isAppsScriptPublicAccessReady,
    isAuthUserMenuOpen,
    isFetchNetworkError,
    isIngestSheetAuthFailure,
    isLikelyAppsScriptWebAppUrl,
    isLikelyCloudflareWorkerUrl,
    isLikelyNgrokWebhookUrl,
    isLocalDashboardOrigin,
    isLocalWebhookCandidateUrl,
    isManagedAppsScriptDeployState,
    isOnboardingWizardVisible,
    isPlaceholderLogoUrl,
    isScraperUrlBlockedOnThisPage,
    isSettingsModalOpen,
    isSignedIn,
    loadAllData,
    loadPersistedOAuthSession,
    loadPersistedRuntimeOAuthSession,
    mapDiscoveryWizardFlow,
    markJobViewed,
    maybeAutoOpenExpiredReviewModal,
    mergeStoredConfigOverridePatch,
    normalizeDashboardTitle,
    normalizeDiscoveryLocalWebhookUrl,
    normalizeDiscoveryTunnelPublicUrl,
    normalizeDiscoveryWebhookIdentity,
    normalizeLeadUrlClient,
    normalizeProfileTextInput,
    normalizeResponseFlag,
    notifyPipelineFiltersChanged,
    notifyPipelineRendered,
    openCommandCenterSettingsModal,
    openDiscoveryPathsModal,
    openDiscoverySetupWizard,
    openJobDetail,
    openMaterialsModal,
    openSettingsForDiscoveryWebhook,
    parseGoogleSheetId,
    persistDiscoveryWizardState,
    populateAppsScriptDeployStateIntoSettingsForm,
    preloadDiscoveryUiState,
    probeNgrokFromLocalApi,
    probeTunnelStaleBadge,
    readStoredConfigOverrides,
    recheckAppsScriptPublicAccessFromSettings,
    recordDiscoveryEngineState,
    refreshAccessTokenSilently,
    refreshDiscoveryReadinessSnapshot,
    refreshDiscoveryUiState,
    refreshDiscoveryWebhookSecretFromBootstrapForEndpoint,
    refreshDrawerIfOpen,
    refreshGeneratedDraftLibraryCache,
    refreshPersonalPreferencesPanel,
    renderAreaWidget,
    renderAppsScriptDeployUi,
    renderBrief,
    renderDiscoveryEngineStatusUi,
    renderDiscoverySetupWizard,
    renderExpiredReviewButton,
    renderPipeline,
    renderPipelineDailyBrief,
    renderResumeGenerateInsights,
    renderSetupStarterSheetUi,
    renderStats,
    requestDiscoverySetup,
    resolveCompanyLogoUrl,
    resolveDiscoveryRunWebhookUrl,
    responseLabelForDisplay,
    restoreJob,
    resumeDiscoveryStatusPollingIfNeeded,
    resumePendingDiscoverySetupIfNeeded,
    revealSetupScreenAfterAuth,
    runPostAccessBootstrapOnce,
    sameDiscoveryUrlOrigin,
    selectedResponseSheetValue,
    setActiveDetailKey,
    setCurrentSearch,
    setCurrentSort,
    setDiscoveryWizardMessage,
    setDiscoveryWizardRuntime,
    setFavoritesOnly,
    setPipelineData,
    setPipelineRawRows,
    setPipelineViewFilters,
    setShowDismissed,
    setDashboardSheetLinks,
    sheetsBatchUpdate,
    sheetsValuesAppend,
    sheetsValuesGet,
    sheetsValuesUpdate,
    showDiscoveryVerificationToast,
    showAppsScriptPublicAccessRemediationFromState,
    showOnboardingWizard,
    showSheetAccessGate,
    showToast,
    signIn,
    syncDiscoveryButtonState,
    syncPipelineFilterControls,
    toggleFavorite,
    triggerDiscoveryRun,
    updateDiscoveryWizardRuntime,
    updateFollowUpDate,
    updateJobNotes,
    updateJobResponseFlag,
    updateJobStatus,
    updateLastHeardFrom,
    updateLastRefresh,
    updateMultipleCells,
    updateSheetCell,
    verifyDiscoveryWebhookWithSharedModel,
    warnDiscoverySourceReadinessBeforeRun,
    writeDiscoveryTransportSetupState,
    writeStoredConfigOverrides,
    applyEnrichmentCache,
  });
}

registerBridgeHosts();

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

// --- Discovery setup modals (extracted to discovery-setup-modals.js) ---
async function testDiscoveryWebhookFromSettings(...args) {
  return window.JobBoredDiscovery.setupModals.testDiscoveryWebhookFromSettings(
    ...args,
  );
}
function openDiscoveryPathsModal(...args) {
  return window.JobBoredDiscovery.setupModals.openDiscoveryPathsModal(...args);
}
function closeDiscoveryPathsModal(...args) {
  return window.JobBoredDiscovery.setupModals.closeDiscoveryPathsModal(...args);
}
function openDiscoverySetupGuideModal(...args) {
  return window.JobBoredDiscovery.setupModals.openDiscoverySetupGuideModal(
    ...args,
  );
}
function closeDiscoverySetupGuideModal(...args) {
  return window.JobBoredDiscovery.setupModals.closeDiscoverySetupGuideModal(
    ...args,
  );
}
function renderDiscoveryLocalTunnelSetupUi(...args) {
  return window.JobBoredDiscovery.setupModals.renderDiscoveryLocalTunnelSetupUi(
    ...args,
  );
}
function populateDiscoveryLocalTunnelModal(...args) {
  return window.JobBoredDiscovery.setupModals.populateDiscoveryLocalTunnelModal(
    ...args,
  );
}
async function openDiscoveryLocalTunnelModal(...args) {
  return window.JobBoredDiscovery.setupModals.openDiscoveryLocalTunnelModal(
    ...args,
  );
}
async function probeNgrokFromLocalApi(...args) {
  return window.JobBoredDiscovery.setupModals.probeNgrokFromLocalApi(...args);
}
async function probeAndShowTunnelStaleBanner(...args) {
  return window.JobBoredDiscovery.setupModals.probeAndShowTunnelStaleBanner(
    ...args,
  );
}
function closeDiscoveryLocalTunnelModal(...args) {
  return window.JobBoredDiscovery.setupModals.closeDiscoveryLocalTunnelModal(
    ...args,
  );
}
async function probeTunnelStaleBadge(...args) {
  return window.JobBoredDiscovery.setupModals.probeTunnelStaleBadge(...args);
}
function saveDiscoveryLocalTunnelSetup(...args) {
  return window.JobBoredDiscovery.setupModals.saveDiscoveryLocalTunnelSetup(
    ...args,
  );
}
function populateCloudflareRelaySetupModal(...args) {
  return window.JobBoredDiscovery.setupModals.populateCloudflareRelaySetupModal(
    ...args,
  );
}
async function openCloudflareRelaySetupModal(...args) {
  return window.JobBoredDiscovery.setupModals.openCloudflareRelaySetupModal(
    ...args,
  );
}
function closeCloudflareRelaySetupModal(...args) {
  return window.JobBoredDiscovery.setupModals.closeCloudflareRelaySetupModal(
    ...args,
  );
}
async function openCloudflareRelaySetupFromAppsScriptFailure(...args) {
  return window.JobBoredDiscovery.setupModals.openCloudflareRelaySetupFromAppsScriptFailure(
    ...args,
  );
}
async function applyCloudflareRelayWorkerUrl(...args) {
  return window.JobBoredDiscovery.setupModals.applyCloudflareRelayWorkerUrl(
    ...args,
  );
}
async function handleAppsScriptBrowserCorsFailure(...args) {
  return window.JobBoredDiscovery.setupModals.handleAppsScriptBrowserCorsFailure(
    ...args,
  );
}
function initDiscoverySetupGuide(...args) {
  return window.JobBoredDiscovery.setupModals.initDiscoverySetupGuide(...args);
}

// ============================================
// RENDERING
// ============================================

// Compatibility forwarders for extracted app modules live in app-compat.js.

// ============================================
// INITIALIZATION
// ============================================

function init(...args) {
  return window.JobBoredApp.bootstrap.init(...args);
}


/**
 * Normalize a source preset value to a valid enum string or empty.
 * @param {unknown} raw
 * @returns {"" | "browser_only" | "ats_only" | "browser_plus_ats"}
 */

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


// Discovery drawer — thin wrappers (implementation in discovery-drawer.js)
function normalizeSourcePreset(raw) {
  return window.JobBoredDiscovery.drawer.normalizeSourcePreset(raw);
}

function syncSourcePresetUi(preset) {
  return window.JobBoredDiscovery.drawer.syncSourcePresetUi(preset);
}

function getEffectiveFitProfileFields() {
  return window.JobBoredDiscovery.drawer.getEffectiveFitProfileFields();
}

function openDiscoveryDrawer(options) {
  return window.JobBoredDiscovery.drawer.openDiscoveryDrawer(options);
}

function closeDiscoveryDrawer() {
  return window.JobBoredDiscovery.drawer.closeDiscoveryDrawer();
}

function isDiscoveryDrawerOpen() {
  return window.JobBoredDiscovery.drawer.isDiscoveryDrawerOpen();
}

function initDiscoveryDrawer() {
  return window.JobBoredDiscovery.drawer.initDiscoveryDrawer();
}

function initDiscoverySubtabs() {
  return window.JobBoredDiscovery.drawer.initDiscoverySubtabs();
}

function initDiscoveryButton() {
  return window.JobBoredDiscovery.drawer.initDiscoveryButton();
}

async function warnDiscoverySourceReadinessBeforeRun() {
  return window.JobBoredDiscovery.drawer.warnDiscoverySourceReadinessBeforeRun();
}

async function refreshDiscoveryDrawerSourceReadiness() {
  return window.JobBoredDiscovery.drawer.refreshDiscoveryDrawerSourceReadiness();
}

async function generateDiscoverySuggestions(scrapedJob) {
  return window.JobBoredDiscovery.drawer.generateDiscoverySuggestions(scrapedJob);
}

function normalizeStratum(raw) {
  return window.JobBoredDiscovery.drawer.normalizeStratum(raw);
}

function applyStratumToDrawer(stratum) {
  return window.JobBoredDiscovery.drawer.applyStratumToDrawer(stratum);
}

function sanitizeCompanyEntries(arr) {
  return window.JobBoredDiscovery.drawer.sanitizeCompanyEntries(arr);
}



// ============================================
// INGEST URL — delegated to ingest-url-flow.js
// ============================================

function isParseableUrl(...args) {
  return window.JobBoredDiscovery.ingestUrlFlow.isParseableUrl(...args);
}
async function ingestJobUrl(...args) {
  return window.JobBoredDiscovery.ingestUrlFlow.ingestJobUrl(...args);
}
function initIngestUrlFlow(...args) {
  return window.JobBoredDiscovery.ingestUrlFlow.initIngestUrlFlow(...args);
}
