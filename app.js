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

window.JobBoredDiscovery = Object.assign(window.JobBoredDiscovery || {}, {
  buildPayload: buildDiscoveryWebhookPayload,
});


// Discovery readiness bridge. discovery-readiness.js loads BEFORE app.js.
window.JobBoredDiscovery.readiness = window.JobBoredDiscovery.readiness || {};
window.JobBoredDiscovery.readiness.host = {
  getSHEET_ID() {
    return SHEET_ID;
  },
  getDashboardDataHydrated() {
    return dashboardDataHydrated;
  },
  parseGoogleSheetId,
  getDiscoveryWebhookUrl,
  getDiscoveryTransportSetupState,
  normalizeDiscoveryLocalWebhookUrl,
  normalizeDiscoveryTunnelPublicUrl,
  isLocalDashboardOrigin,
  isLikelyAppsScriptWebAppUrl,
  isLikelyCloudflareWorkerUrl,
  isAppsScriptPublicAccessReady,
  isManagedAppsScriptDeployState,
  syncDiscoveryButtonState,
  renderDiscoveryEngineStatusUi,
  renderDiscoverySetupWizard,
  renderPipelineDailyBrief,
  renderPipeline,
  getAccessToken,
  getTokenExpiresAt,
  refreshAccessTokenSilently,
  getEffectiveFitProfileFields,
  generateDiscoveryVariationKey(...args) {
    return window.JobBoredDiscovery.runOrchestration.generateDiscoveryVariationKey(
      ...args,
    );
  },
  getDiscoveryWebhookSecret,
  refreshDiscoveryWebhookSecretFromBootstrapForEndpoint,
  showToast,
  copyTextToClipboard,
  requestDiscoverySetup,
};

// Discovery engine state bridge. discovery-engine-state.js loads BEFORE app.js
// and reads host lazily for settings getters and persistence side effects.
window.JobBoredDiscovery = window.JobBoredDiscovery || {};
window.JobBoredDiscovery.engineState = window.JobBoredDiscovery.engineState || {};
window.JobBoredDiscovery.engineState.host = {
  parseGoogleSheetId,
  getOAuthClientId,
  getDiscoveryWebhookUrl,
  refreshDiscoveryUiState,
  refreshDiscoveryReadinessSnapshot,
};

// Discovery status handoff bridge. discovery-status-handoff.js loads BEFORE app.js.
window.JobBoredDiscovery.status = window.JobBoredDiscovery.status || {};
window.JobBoredDiscovery.status.host = {
  getConfigCore() {
    return configCore;
  },
  getDiscoveryWizardProbesApi,
  getDiscoveryWizardRelayApi,
  buildDiscoveryTunnelTargetUrl,
  inferCloudflareWorkerNameFromOpenWorkerUrl,
  getSuggestedCloudflareRelayWorkerName,
  getSettingsSheetIdValue,
  getDiscoveryWebhookUrl,
  buildDiscoveryRelayDeployCommandForTarget,
  getDiscoveryRelaySuggestedOrigin,
  isOnboardingWizardVisible,
  openDiscoverySetupWizard,
  getDiscoveryWizardRecommendedFlow,
  getDiscoveryReadinessSnapshot,
  checkOnboardingGate,
  normalizeDiscoveryWebhookIdentity,
  isLocalWebhookCandidateUrl,
  isLocalDashboardOrigin,
  getDiscoveryTransportSetupState,
  normalizeDiscoveryLocalWebhookUrl,
  getDiscoveryLocalEngineKind,
  isLikelyCloudflareWorkerUrl,
  loadAllData,
  renderAppsScriptDeployUi,
  showToast,
};

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

// Apps Script deploy bridge. apps-script-deploy.js loads BEFORE app.js.
window.JobBoredDiscovery.appsScriptDeploy =
  window.JobBoredDiscovery.appsScriptDeploy || {};
window.JobBoredDiscovery.appsScriptDeploy.host = {
  getSettingsOAuthClientIdValue,
  hasUnsavedOAuthClientIdChange,
  getGisLoaded,
  getUserEmailFromAuth,
  getSettingsSheetIdValue,
  isFetchNetworkError,
  mergeStoredConfigOverridePatch,
  recordDiscoveryEngineState,
  syncDiscoveryButtonState,
  renderDiscoveryEngineStatusUi,
  getDiscoveryReadinessSnapshot,
  getGisInitStartedAt() {
    return typeof gisInitStartedAt !== "undefined" && gisInitStartedAt
      ? gisInitStartedAt
      : 0;
  },
};

// Discovery setup modals bridge. discovery-setup-modals.js loads BEFORE app.js.
window.JobBoredDiscovery.setupModals =
  window.JobBoredDiscovery.setupModals || {};
window.JobBoredDiscovery.setupModals.host = {
  normalizeDiscoveryWebhookIdentity,
  parseGoogleSheetId,
  showToast,
  buildDiscoveryWebhookPayload,
  verifyDiscoveryWebhookWithSharedModel,
  getDiscoveryEngineStateFromVerificationResult,
  recordDiscoveryEngineState,
  refreshDiscoveryReadinessSnapshot,
  showDiscoveryVerificationToast,
  refreshDiscoveryUiState,
  normalizeDiscoveryLocalWebhookUrl,
  normalizeDiscoveryTunnelPublicUrl,
  buildDiscoveryTunnelTargetUrl,
  getDiscoveryLocalWebhookHealthUrl,
  inferLocalWebhookPort,
  getDiscoveryTransportSetupState,
  hydrateDiscoveryTransportSetupFromLocalBootstrap,
  isLocalDashboardOrigin,
  writeDiscoveryTransportSetupState,
  buildDiscoveryRelayDeployCommandForTarget,
  createDiscoveryRelayCopyCommandToastAction,
  getSettingsFieldValue,
  getDiscoveryWebhookUrl,
  getDiscoveryRelaySuggestedOrigin,
  getDiscoveryRelayWorkerName,
  getSettingsSheetIdValue,
  isLikelyCloudflareWorkerUrl,
  isLikelyAppsScriptWebAppUrl,
  buildCloudflareRelayAgentPrompt,
  buildCloudflareRelayCorsSnippet,
  showAppsScriptPublicAccessRemediationFromState,
  isSettingsModalOpen,
  openCommandCenterSettingsModal,
  isManagedAppsScriptDeployState,
  isAppsScriptPublicAccessReady,
  requestDiscoverySetup,
  copyTextToClipboard,
  mergeStoredConfigOverridePatch,
  syncDiscoveryButtonState,
  focusDiscoveryWebhookFieldInSettings,
  getConfigCore() {
    return configCore;
  },
};

// Discovery run orchestration bridge. discovery-run-orchestration.js loads BEFORE app.js.
window.JobBoredDiscovery.runOrchestration =
  window.JobBoredDiscovery.runOrchestration || {};
window.JobBoredDiscovery.runOrchestration.host = {
  getDiscoveryTransportSetupState,
  getCloudflareRelayTargetInfo,
  buildDiscoveryTunnelTargetUrl,
  isLocalDashboardOrigin,
  getDiscoveryWebhookUrl,
  normalizeDiscoveryWebhookIdentity,
  getDiscoveryWizardVerifyApi,
  isLikelyCloudflareWorkerUrl,
  isLikelyAppsScriptWebAppUrl,
  isLikelyNgrokWebhookUrl,
  sameDiscoveryUrlOrigin,
  hydrateDiscoveryTransportSetupFromLocalBootstrap,
  getDiscoveryReadinessSnapshot,
  refreshDiscoveryReadinessSnapshot,
  writeDiscoveryTransportSetupState,
  setDiscoveryWizardMessage,
  showToast,
  warnDiscoverySourceReadinessBeforeRun,
  requestDiscoverySetup,
  buildDiscoveryWebhookPayload,
  getSHEET_ID() {
    return SHEET_ID;
  },
  verifyDiscoveryWebhookWithSharedModel,
  getDiscoveryEngineStateFromVerificationResult,
  recordDiscoveryEngineState,
  showDiscoveryVerificationToast,
  handleAppsScriptBrowserCorsFailure,
};

// Discovery drawer bridge. discovery-drawer.js loads BEFORE app.js.
window.JobBoredDiscovery.drawer = window.JobBoredDiscovery.drawer || {};
window.JobBoredDiscovery.drawer.host = {
  getDiscoveryReadinessSnapshot,
  getDiscoverySettingsView,
  getDiscoveryWebhookUrl,
  isLocalDashboardOrigin,
  getDiscoveryTransportSetupState,
  hydrateDiscoveryTransportSetupFromLocalBootstrap,
  getDiscoveryLocalWebhookHealthUrl,
  isLocalWebhookCandidateUrl,
  showToast,
  triggerDiscoveryRun,
  getJobPostingScrapeUrl,
  getUserContent,
  buildCandidateProfileExcerpt,
  callDiscoveryAiGemini,
  callDiscoveryAiOpenAI,
  callDiscoveryAiAnthropic,
  parseJsonSafeForSuggestions,
  openSettingsForDiscoveryWebhook,
  syncDiscoveryButtonState,
};

// Ingest URL flow bridge. ingest-url-flow.js loads BEFORE app.js.
window.JobBoredDiscovery.ingestUrlFlow =
  window.JobBoredDiscovery.ingestUrlFlow || {};
window.JobBoredDiscovery.ingestUrlFlow.host = {
  getPipelineData() {
    return pipelineData;
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
  getSHEET_ID() {
    return SHEET_ID;
  },
  getAccessToken,
  getOAuthClientId,
  getSheetId,
  getDiscoveryWebhookSecret,
  showSheetAccessGate,
  clearPersistedRuntimeOAuthSession,
  getFreshDiscoveryRequestGoogleAccessToken,
  refreshDiscoveryWebhookSecretFromBootstrapForEndpoint,
  resolveDiscoveryRunWebhookUrl,
  isFetchNetworkError,
  getDiscoveryWizardVerifyApi,
  showDiscoveryVerificationToast,
  showToast,
  sheetsValuesAppend,
  loadAllData,
  updateMultipleCells,
  normalizeLeadUrlClient,
  getSheetRow,
  syncPipelineFilterControls,
  notifyPipelineFiltersChanged,
  renderPipeline,
  fetchJobPostingEnrichment,
  resolveCompanyLogoUrl,
  isPlaceholderLogoUrl,
  isIngestSheetAuthFailure,
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
  window.JobBoredDiscovery.status.resetPostAccessBootstrap();
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

document.addEventListener("DOMContentLoaded", () => {
  initCommandCenterSettings();
  initSetupAndSheetAccessActions();
  initScraperSetupGuide();
  initDiscoverySetupGuide();
  initPipelineEmptyAndBriefActions();
  initIngestUrlFlow();
  init();
});
