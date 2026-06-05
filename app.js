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
// --- Discovery run tracker (extracted to discovery-run-tracker.js) ---
const DISCOVERY_RUN_TRACKER_KEY =
  window.JobBoredDiscovery.runTracker.DISCOVERY_RUN_TRACKER_KEY;
// Discovery run tracker, relay helper, and status handoff forwarders live in app-compat.js.

// Set by performSettingsClearOverrides before reload so the next interactive
// sign-in forces Google's consent screen instead of silently re-issuing a
// token from the prior consent grant. One-shot: cleared after the next signIn.
const FORCE_CONSENT_PROMPT_KEY = "command_center_force_consent_prompt";

// Config override forwarders live in app-compat.js.

// ============================================
// CONFIG VALIDATION
// ============================================

// Config validation forwarders live in app-compat.js.

// --- App config core (extracted to app-config-core.js) ---
const configCore = window.JobBoredApp.configCore;
const GOOGLE_SHEETS_SCOPE = configCore.GOOGLE_SHEETS_SCOPE;
const DISCOVERY_ENGINE_STATE_NONE = configCore.DISCOVERY_ENGINE_STATE_NONE;
const DISCOVERY_ENGINE_STATE_STUB_ONLY =
  configCore.DISCOVERY_ENGINE_STATE_STUB_ONLY;
const DISCOVERY_ENGINE_STATE_UNVERIFIED =
  configCore.DISCOVERY_ENGINE_STATE_UNVERIFIED;
const DISCOVERY_ENGINE_STATE_CONNECTED = configCore.DISCOVERY_ENGINE_STATE_CONNECTED;
const STARTER_PIPELINE_HEADERS = configCore.STARTER_PIPELINE_HEADERS;
const STARTER_PIPELINE_HEADER_RANGE = configCore.STARTER_PIPELINE_HEADER_RANGE;

// --- Discovery engine state (extracted to discovery-engine-state.js) ---

// Discovery engine-state and readiness forwarders live in app-compat.js.

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

// Discovery verification-state forwarder lives in app-compat.js.

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


// Scraper, ATS, and Apps Script deploy forwarders live in app-compat.js.

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


// Scraper setup-guide forwarder lives in app-compat.js.

// ============================================
// STATE
// ============================================

let SHEET_ID = null;

let dataLoadFailed = false;
let dashboardDataHydrated = false;
let initialSheetAccessResolved = false;
let pendingSetupStarterSheetCreate = false;

// Pipeline controller and auth-session forwarders live in app-compat.js.

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


// Sheet setup, write-back, and discovery-run forwarders live in app-compat.js.

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
    checkInfraSetupGate,
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
    isFirstRunWizardVisible,
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

// Discovery wizard and setup-modal forwarders live in app-compat.js.

// ============================================
// RENDERING
// ============================================

// Compatibility forwarders for extracted app modules live in app-compat.js.

// ============================================
// INITIALIZATION
// ============================================

// App bootstrap init forwarder lives in app-compat.js.

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

// Discovery drawer and ingest URL forwarders live in app-compat.js.
