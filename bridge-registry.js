(function () {
  "use strict";

  const app = (window.JobBoredApp = window.JobBoredApp || {});

  function getConfigCore(host) {
    return host.getConfigCore();
  }

  function registerAllBridges(host) {
    const discovery = (window.JobBoredDiscovery =
      window.JobBoredDiscovery || {});
    const wizard = (window.JobBoredDiscoveryWizard =
      window.JobBoredDiscoveryWizard || {});

    discovery.buildPayload = host.buildDiscoveryWebhookPayload;

    discovery.readiness = discovery.readiness || {};
    discovery.readiness.host = {
      getSHEET_ID: host.getSHEET_ID,
      getDashboardDataHydrated: host.getDashboardDataHydrated,
      parseGoogleSheetId: host.parseGoogleSheetId,
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      getDiscoveryTransportSetupState: host.getDiscoveryTransportSetupState,
      normalizeDiscoveryLocalWebhookUrl: host.normalizeDiscoveryLocalWebhookUrl,
      normalizeDiscoveryTunnelPublicUrl: host.normalizeDiscoveryTunnelPublicUrl,
      isLocalDashboardOrigin: host.isLocalDashboardOrigin,
      isLikelyAppsScriptWebAppUrl: host.isLikelyAppsScriptWebAppUrl,
      isLikelyCloudflareWorkerUrl: host.isLikelyCloudflareWorkerUrl,
      isAppsScriptPublicAccessReady: host.isAppsScriptPublicAccessReady,
      isManagedAppsScriptDeployState: host.isManagedAppsScriptDeployState,
      syncDiscoveryButtonState: host.syncDiscoveryButtonState,
      renderDiscoveryEngineStatusUi: host.renderDiscoveryEngineStatusUi,
      renderDiscoverySetupWizard: host.renderDiscoverySetupWizard,
      renderPipelineDailyBrief: host.renderPipelineDailyBrief,
      renderPipeline: host.renderPipeline,
      getAccessToken: host.getAccessToken,
      getTokenExpiresAt: host.getTokenExpiresAt,
      refreshAccessTokenSilently: host.refreshAccessTokenSilently,
      getEffectiveFitProfileFields: host.getEffectiveFitProfileFields,
      generateDiscoveryVariationKey(...args) {
        return discovery.runOrchestration.generateDiscoveryVariationKey(
          ...args,
        );
      },
      getDiscoveryWebhookSecret: host.getDiscoveryWebhookSecret,
      refreshDiscoveryWebhookSecretFromBootstrapForEndpoint:
        host.refreshDiscoveryWebhookSecretFromBootstrapForEndpoint,
      showToast: host.showToast,
      copyTextToClipboard: host.copyTextToClipboard,
      requestDiscoverySetup: host.requestDiscoverySetup,
    };

    discovery.engineState = discovery.engineState || {};
    discovery.engineState.host = {
      parseGoogleSheetId: host.parseGoogleSheetId,
      getOAuthClientId: host.getOAuthClientId,
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      refreshDiscoveryUiState: host.refreshDiscoveryUiState,
      refreshDiscoveryReadinessSnapshot: host.refreshDiscoveryReadinessSnapshot,
    };

    discovery.status = discovery.status || {};
    discovery.status.host = {
      getConfigCore() {
        return getConfigCore(host);
      },
      getDiscoveryWizardProbesApi: host.getDiscoveryWizardProbesApi,
      getDiscoveryWizardRelayApi: host.getDiscoveryWizardRelayApi,
      buildDiscoveryTunnelTargetUrl: host.buildDiscoveryTunnelTargetUrl,
      inferCloudflareWorkerNameFromOpenWorkerUrl:
        host.inferCloudflareWorkerNameFromOpenWorkerUrl,
      getSuggestedCloudflareRelayWorkerName:
        host.getSuggestedCloudflareRelayWorkerName,
      getSettingsSheetIdValue: host.getSettingsSheetIdValue,
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      buildDiscoveryRelayDeployCommandForTarget:
        host.buildDiscoveryRelayDeployCommandForTarget,
      getDiscoveryRelaySuggestedOrigin: host.getDiscoveryRelaySuggestedOrigin,
      isOnboardingWizardVisible: host.isOnboardingWizardVisible,
      openDiscoverySetupWizard: host.openDiscoverySetupWizard,
      getDiscoveryWizardRecommendedFlow:
        host.getDiscoveryWizardRecommendedFlow,
      getDiscoveryReadinessSnapshot: host.getDiscoveryReadinessSnapshot,
      checkOnboardingGate: host.checkOnboardingGate,
      checkInfraSetupGate: host.checkInfraSetupGate,
      isFirstRunWizardVisible: host.isFirstRunWizardVisible,
      normalizeDiscoveryWebhookIdentity: host.normalizeDiscoveryWebhookIdentity,
      isLocalWebhookCandidateUrl: host.isLocalWebhookCandidateUrl,
      isLocalDashboardOrigin: host.isLocalDashboardOrigin,
      getDiscoveryTransportSetupState: host.getDiscoveryTransportSetupState,
      normalizeDiscoveryLocalWebhookUrl: host.normalizeDiscoveryLocalWebhookUrl,
      getDiscoveryLocalEngineKind: host.getDiscoveryLocalEngineKind,
      isLikelyCloudflareWorkerUrl: host.isLikelyCloudflareWorkerUrl,
      loadAllData: host.loadAllData,
      renderAppsScriptDeployUi: host.renderAppsScriptDeployUi,
      showToast: host.showToast,
    };

    app.configOverrides = app.configOverrides || {};
    app.configOverrides.host = {
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      getDiscoveryWebhookSecret: host.getDiscoveryWebhookSecret,
      normalizeDiscoveryWebhookIdentity: host.normalizeDiscoveryWebhookIdentity,
      isLocalWebhookCandidateUrl: host.isLocalWebhookCandidateUrl,
      buildDiscoveryTunnelTargetUrl: host.buildDiscoveryTunnelTargetUrl,
      inferCloudflareWorkerNameFromOpenWorkerUrl:
        host.inferCloudflareWorkerNameFromOpenWorkerUrl,
    };

    discovery.relayHelpers = discovery.relayHelpers || {};
    discovery.relayHelpers.host = {
      copyTextToClipboard: host.copyTextToClipboard,
      getSettingsSheetIdValue: host.getSettingsSheetIdValue,
      getSettingsFieldValue: host.getSettingsFieldValue,
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      normalizeDiscoveryWebhookIdentity: host.normalizeDiscoveryWebhookIdentity,
    };

    discovery.appsScriptDeploy = discovery.appsScriptDeploy || {};
    discovery.appsScriptDeploy.host = {
      getSettingsOAuthClientIdValue: host.getSettingsOAuthClientIdValue,
      hasUnsavedOAuthClientIdChange: host.hasUnsavedOAuthClientIdChange,
      getGisLoaded: host.getGisLoaded,
      getUserEmailFromAuth: host.getUserEmailFromAuth,
      getSettingsSheetIdValue: host.getSettingsSheetIdValue,
      isFetchNetworkError: host.isFetchNetworkError,
      mergeStoredConfigOverridePatch: host.mergeStoredConfigOverridePatch,
      recordDiscoveryEngineState: host.recordDiscoveryEngineState,
      syncDiscoveryButtonState: host.syncDiscoveryButtonState,
      renderDiscoveryEngineStatusUi: host.renderDiscoveryEngineStatusUi,
      getDiscoveryReadinessSnapshot: host.getDiscoveryReadinessSnapshot,
      getGisInitStartedAt: host.getGisInitStartedAt,
    };

    discovery.setupModals = discovery.setupModals || {};
    discovery.setupModals.host = {
      normalizeDiscoveryWebhookIdentity: host.normalizeDiscoveryWebhookIdentity,
      parseGoogleSheetId: host.parseGoogleSheetId,
      showToast: host.showToast,
      buildDiscoveryWebhookPayload: host.buildDiscoveryWebhookPayload,
      verifyDiscoveryWebhookWithSharedModel:
        host.verifyDiscoveryWebhookWithSharedModel,
      getDiscoveryEngineStateFromVerificationResult:
        host.getDiscoveryEngineStateFromVerificationResult,
      recordDiscoveryEngineState: host.recordDiscoveryEngineState,
      refreshDiscoveryReadinessSnapshot: host.refreshDiscoveryReadinessSnapshot,
      showDiscoveryVerificationToast: host.showDiscoveryVerificationToast,
      refreshDiscoveryUiState: host.refreshDiscoveryUiState,
      normalizeDiscoveryLocalWebhookUrl: host.normalizeDiscoveryLocalWebhookUrl,
      normalizeDiscoveryTunnelPublicUrl: host.normalizeDiscoveryTunnelPublicUrl,
      buildDiscoveryTunnelTargetUrl: host.buildDiscoveryTunnelTargetUrl,
      getDiscoveryLocalWebhookHealthUrl: host.getDiscoveryLocalWebhookHealthUrl,
      inferLocalWebhookPort: host.inferLocalWebhookPort,
      getDiscoveryTransportSetupState: host.getDiscoveryTransportSetupState,
      hydrateDiscoveryTransportSetupFromLocalBootstrap:
        host.hydrateDiscoveryTransportSetupFromLocalBootstrap,
      isLocalDashboardOrigin: host.isLocalDashboardOrigin,
      writeDiscoveryTransportSetupState: host.writeDiscoveryTransportSetupState,
      buildDiscoveryRelayDeployCommandForTarget:
        host.buildDiscoveryRelayDeployCommandForTarget,
      createDiscoveryRelayCopyCommandToastAction:
        host.createDiscoveryRelayCopyCommandToastAction,
      getSettingsFieldValue: host.getSettingsFieldValue,
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      getDiscoveryRelaySuggestedOrigin: host.getDiscoveryRelaySuggestedOrigin,
      getDiscoveryRelayWorkerName: host.getDiscoveryRelayWorkerName,
      getSettingsSheetIdValue: host.getSettingsSheetIdValue,
      isLikelyCloudflareWorkerUrl: host.isLikelyCloudflareWorkerUrl,
      isLikelyAppsScriptWebAppUrl: host.isLikelyAppsScriptWebAppUrl,
      buildCloudflareRelayAgentPrompt: host.buildCloudflareRelayAgentPrompt,
      buildCloudflareRelayCorsSnippet: host.buildCloudflareRelayCorsSnippet,
      showAppsScriptPublicAccessRemediationFromState:
        host.showAppsScriptPublicAccessRemediationFromState,
      isSettingsModalOpen: host.isSettingsModalOpen,
      openCommandCenterSettingsModal: host.openCommandCenterSettingsModal,
      isManagedAppsScriptDeployState: host.isManagedAppsScriptDeployState,
      isAppsScriptPublicAccessReady: host.isAppsScriptPublicAccessReady,
      requestDiscoverySetup: host.requestDiscoverySetup,
      copyTextToClipboard: host.copyTextToClipboard,
      mergeStoredConfigOverridePatch: host.mergeStoredConfigOverridePatch,
      syncDiscoveryButtonState: host.syncDiscoveryButtonState,
      focusDiscoveryWebhookFieldInSettings:
        host.focusDiscoveryWebhookFieldInSettings,
      getConfigCore() {
        return getConfigCore(host);
      },
    };

    app.bootstrap = app.bootstrap || {};
    app.bootstrap.host = {
      requestDiscoverySetup: host.requestDiscoverySetup,
      triggerDiscoveryRun: host.triggerDiscoveryRun,
      getPipelineData: host.getPipelineData,
      renderAreaWidget: host.renderAreaWidget,
      openJobDetail: host.openJobDetail,
      openDiscoveryPathsModal: host.openDiscoveryPathsModal,
      getSheetId: host.getSheetId,
      setSHEET_ID: host.setSHEET_ID,
      getSHEET_ID: host.getSHEET_ID,
      setInitialSheetAccessResolved: host.setInitialSheetAccessResolved,
      resetPostAccessBootstrap() {
        return discovery.status.resetPostAccessBootstrap();
      },
      initAuthUserMenu: host.initAuthUserMenu,
      initResumeMaterialsFeature: host.initResumeMaterialsFeature,
      initDiscoveryDrawer: host.initDiscoveryDrawer,
      initDiscoverySubtabs: host.initDiscoverySubtabs,
      initDiscoveryButton: host.initDiscoveryButton,
      getOAuthClientId: host.getOAuthClientId,
      getAccessToken: host.getAccessToken,
      showSheetAccessGate: host.showSheetAccessGate,
      initAuth: host.initAuth,
      checkInfraSetupGate: host.checkInfraSetupGate,
      renderSetupStarterSheetUi: host.renderSetupStarterSheetUi,
      loadPersistedRuntimeOAuthSession: host.loadPersistedRuntimeOAuthSession,
      loadPersistedOAuthSession: host.loadPersistedOAuthSession,
      getConfig: host.getConfig,
      setDashboardSheetLinks: host.setDashboardSheetLinks,
      preloadDiscoveryUiState: host.preloadDiscoveryUiState,
      resumeDiscoveryStatusPollingIfNeeded:
        host.resumeDiscoveryStatusPollingIfNeeded,
      setCurrentSort: host.setCurrentSort,
      renderPipeline: host.renderPipeline,
      setCurrentSearch: host.setCurrentSearch,
      setPipelineViewFilters: host.setPipelineViewFilters,
      getFavoritesOnly: host.getFavoritesOnly,
      getShowDismissed: host.getShowDismissed,
      syncPipelineFilterControls: host.syncPipelineFilterControls,
      initExpiredReviewUi: host.initExpiredReviewUi,
      loadAllData: host.loadAllData,
      closeAuthUserMenu: host.closeAuthUserMenu,
      closeMaterialsModal: host.closeMaterialsModal,
      closeCommandCenterSettingsModal: host.closeCommandCenterSettingsModal,
      initCommandCenterSettings: host.initCommandCenterSettings,
      initSetupAndSheetAccessActions: host.initSetupAndSheetAccessActions,
      initScraperSetupGuide: host.initScraperSetupGuide,
      initDiscoverySetupGuide: host.initDiscoverySetupGuide,
      initIngestUrlFlow: host.initIngestUrlFlow,
    };

    discovery.runOrchestration = discovery.runOrchestration || {};
    discovery.runOrchestration.host = {
      getDiscoveryTransportSetupState: host.getDiscoveryTransportSetupState,
      getCloudflareRelayTargetInfo: host.getCloudflareRelayTargetInfo,
      buildDiscoveryTunnelTargetUrl: host.buildDiscoveryTunnelTargetUrl,
      isLocalDashboardOrigin: host.isLocalDashboardOrigin,
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      normalizeDiscoveryWebhookIdentity: host.normalizeDiscoveryWebhookIdentity,
      getDiscoveryWizardVerifyApi: host.getDiscoveryWizardVerifyApi,
      isLikelyCloudflareWorkerUrl: host.isLikelyCloudflareWorkerUrl,
      isLikelyAppsScriptWebAppUrl: host.isLikelyAppsScriptWebAppUrl,
      isLikelyNgrokWebhookUrl: host.isLikelyNgrokWebhookUrl,
      sameDiscoveryUrlOrigin: host.sameDiscoveryUrlOrigin,
      hydrateDiscoveryTransportSetupFromLocalBootstrap:
        host.hydrateDiscoveryTransportSetupFromLocalBootstrap,
      getDiscoveryReadinessSnapshot: host.getDiscoveryReadinessSnapshot,
      refreshDiscoveryReadinessSnapshot: host.refreshDiscoveryReadinessSnapshot,
      writeDiscoveryTransportSetupState: host.writeDiscoveryTransportSetupState,
      setDiscoveryWizardMessage: host.setDiscoveryWizardMessage,
      showToast: host.showToast,
      warnDiscoverySourceReadinessBeforeRun:
        host.warnDiscoverySourceReadinessBeforeRun,
      requestDiscoverySetup: host.requestDiscoverySetup,
      buildDiscoveryWebhookPayload: host.buildDiscoveryWebhookPayload,
      getSHEET_ID: host.getSHEET_ID,
      verifyDiscoveryWebhookWithSharedModel:
        host.verifyDiscoveryWebhookWithSharedModel,
      getDiscoveryEngineStateFromVerificationResult:
        host.getDiscoveryEngineStateFromVerificationResult,
      recordDiscoveryEngineState: host.recordDiscoveryEngineState,
      showDiscoveryVerificationToast: host.showDiscoveryVerificationToast,
      handleAppsScriptBrowserCorsFailure:
        host.handleAppsScriptBrowserCorsFailure,
    };

    discovery.drawer = discovery.drawer || {};
    discovery.drawer.host = {
      getDiscoveryReadinessSnapshot: host.getDiscoveryReadinessSnapshot,
      getDiscoverySettingsView: host.getDiscoverySettingsView,
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      isLocalDashboardOrigin: host.isLocalDashboardOrigin,
      getDiscoveryTransportSetupState: host.getDiscoveryTransportSetupState,
      hydrateDiscoveryTransportSetupFromLocalBootstrap:
        host.hydrateDiscoveryTransportSetupFromLocalBootstrap,
      getDiscoveryLocalWebhookHealthUrl: host.getDiscoveryLocalWebhookHealthUrl,
      isLocalWebhookCandidateUrl: host.isLocalWebhookCandidateUrl,
      showToast: host.showToast,
      triggerDiscoveryRun: host.triggerDiscoveryRun,
      getJobPostingScrapeUrl: host.getJobPostingScrapeUrl,
      getUserContent: host.getUserContent,
      buildCandidateProfileExcerpt: host.buildCandidateProfileExcerpt,
      callDiscoveryAiGemini(...args) {
        return discovery.drawer.callDiscoveryAiGemini(...args);
      },
      callDiscoveryAiOpenAI(...args) {
        return discovery.drawer.callDiscoveryAiOpenAI(...args);
      },
      callDiscoveryAiAnthropic(...args) {
        return discovery.drawer.callDiscoveryAiAnthropic(...args);
      },
      parseJsonSafeForSuggestions(...args) {
        return discovery.drawer.parseJsonSafeForSuggestions(...args);
      },
      openSettingsForDiscoveryWebhook: host.openSettingsForDiscoveryWebhook,
      syncDiscoveryButtonState: host.syncDiscoveryButtonState,
    };

    discovery.ingestUrlFlow = discovery.ingestUrlFlow || {};
    discovery.ingestUrlFlow.host = {
      getPipelineData: host.getPipelineData,
      getCurrentSearch: host.getCurrentSearch,
      setCurrentSearch: host.setCurrentSearch,
      getFavoritesOnly: host.getFavoritesOnly,
      setFavoritesOnly: host.setFavoritesOnly,
      getSHEET_ID: host.getSHEET_ID,
      getAccessToken: host.getAccessToken,
      getOAuthClientId: host.getOAuthClientId,
      getSheetId: host.getSheetId,
      getDiscoveryWebhookSecret: host.getDiscoveryWebhookSecret,
      showSheetAccessGate: host.showSheetAccessGate,
      clearPersistedRuntimeOAuthSession:
        host.clearPersistedRuntimeOAuthSession,
      getFreshDiscoveryRequestGoogleAccessToken:
        host.getFreshDiscoveryRequestGoogleAccessToken,
      refreshDiscoveryWebhookSecretFromBootstrapForEndpoint:
        host.refreshDiscoveryWebhookSecretFromBootstrapForEndpoint,
      resolveDiscoveryRunWebhookUrl: host.resolveDiscoveryRunWebhookUrl,
      isFetchNetworkError: host.isFetchNetworkError,
      getDiscoveryWizardVerifyApi: host.getDiscoveryWizardVerifyApi,
      showDiscoveryVerificationToast: host.showDiscoveryVerificationToast,
      showToast: host.showToast,
      sheetsValuesAppend: host.sheetsValuesAppend,
      loadAllData: host.loadAllData,
      updateMultipleCells: host.updateMultipleCells,
      normalizeLeadUrlClient: host.normalizeLeadUrlClient,
      getSheetRow: host.getSheetRow,
      syncPipelineFilterControls: host.syncPipelineFilterControls,
      notifyPipelineFiltersChanged: host.notifyPipelineFiltersChanged,
      renderPipeline: host.renderPipeline,
      fetchJobPostingEnrichment: host.fetchJobPostingEnrichment,
      resolveCompanyLogoUrl: host.resolveCompanyLogoUrl,
      isPlaceholderLogoUrl: host.isPlaceholderLogoUrl,
      isIngestSheetAuthFailure: host.isIngestSheetAuthFailure,
    };

    wizard.ui = wizard.ui || {};
    wizard.ui.host = {
      showToast: host.showToast,
      refreshDiscoveryReadinessSnapshot: host.refreshDiscoveryReadinessSnapshot,
      getDiscoveryWizardRuntime: host.getDiscoveryWizardRuntime,
      updateDiscoveryWizardRuntime: host.updateDiscoveryWizardRuntime,
      createDiscoveryWizardRuntime: host.createDiscoveryWizardRuntime,
      clearDiscoveryWizardRuntime: host.clearDiscoveryWizardRuntime,
      persistDiscoveryWizardState: host.persistDiscoveryWizardState,
      triggerDiscoveryRun: host.triggerDiscoveryRun,
      isOnboardingWizardVisible: host.isOnboardingWizardVisible,
      hideOnboardingWizard: host.hideOnboardingWizard,
      showOnboardingWizard: host.showOnboardingWizard,
      isSettingsModalOpen: host.isSettingsModalOpen,
      closeCommandCenterSettingsModal: host.closeCommandCenterSettingsModal,
      openCommandCenterSettingsModal: host.openCommandCenterSettingsModal,
      installKeepAliveOnce: host.installKeepAliveOnce,
      handleAppsScriptBrowserCorsFailure:
        host.handleAppsScriptBrowserCorsFailure,
      diagnoseDownstreamChain: host.diagnoseDownstreamChain,
      copyTextToClipboard: host.copyTextToClipboard,
      getSettingsSheetIdValue: host.getSettingsSheetIdValue,
      isLocalDashboardOrigin: host.isLocalDashboardOrigin,
      normalizeDiscoveryWebhookIdentity: host.normalizeDiscoveryWebhookIdentity,
      mapDiscoveryWizardFlow: host.mapDiscoveryWizardFlow,
      getDiscoveryWizardStepIds: host.getDiscoveryWizardStepIds,
      getDiscoveryWizardStepsBefore: host.getDiscoveryWizardStepsBefore,
      getDiscoveryWizardDefaultDrafts: host.getDiscoveryWizardDefaultDrafts,
      getDiscoveryReadinessSnapshot: host.getDiscoveryReadinessSnapshot,
      escapeHtml: host.escapeHtml,
      getDiscoveryWizardShellApi: host.getDiscoveryWizardShellApi,
      getDiscoveryWizardProbesApi: host.getDiscoveryWizardProbesApi,
      getDiscoveryWizardLocalApi: host.getDiscoveryWizardLocalApi,
      getDiscoveryWizardRelayApi: host.getDiscoveryWizardRelayApi,
      getDiscoveryWizardVerifyApi: host.getDiscoveryWizardVerifyApi,
      inferLocalWebhookPort: host.inferLocalWebhookPort,
      getDiscoveryLocalEngineKind: host.getDiscoveryLocalEngineKind,
      getDiscoveryLocalEngineLabel: host.getDiscoveryLocalEngineLabel,
      getDiscoveryLocalEngineSummary: host.getDiscoveryLocalEngineSummary,
      getDiscoveryRecoveryCopy: host.getDiscoveryRecoveryCopy,
      getDiscoverySettingsView: host.getDiscoverySettingsView,
      isLikelyCloudflareWorkerUrl: host.isLikelyCloudflareWorkerUrl,
      probeNgrokFromLocalApi: host.probeNgrokFromLocalApi,
      closeDiscoverySetupGuideModal: host.closeDiscoverySetupGuideModal,
      showDiscoveryVerificationToast: host.showDiscoveryVerificationToast,
      buildDiscoveryWebhookPayload: host.buildDiscoveryWebhookPayload,
      verifyDiscoveryWebhookWithSharedModel:
        host.verifyDiscoveryWebhookWithSharedModel,
      getDiscoveryEngineStateFromVerificationResult:
        host.getDiscoveryEngineStateFromVerificationResult,
      recordDiscoveryEngineState: host.recordDiscoveryEngineState,
      mergeStoredConfigOverridePatch: host.mergeStoredConfigOverridePatch,
      getDiscoveryWebhookUrl: host.getDiscoveryWebhookUrl,
      writeDiscoveryTransportSetupState: host.writeDiscoveryTransportSetupState,
      createDiscoveryRelayCopyCommandToastAction:
        host.createDiscoveryRelayCopyCommandToastAction,
      setDiscoveryWizardRuntime: host.setDiscoveryWizardRuntime,
      getActiveSheetId: host.getActiveSheetId,
      DISCOVERY_ENGINE_STATE_STUB_ONLY: host.DISCOVERY_ENGINE_STATE_STUB_ONLY,
      DISCOVERY_ENGINE_STATE_UNVERIFIED: host.DISCOVERY_ENGINE_STATE_UNVERIFIED,
    };

    app.brief = app.brief || {};
    app.brief.host = {
      escapeHtml(...args) {
        return app.utils.escapeHtml(...args);
      },
      getPipelineData: host.getPipelineData,
      normalizeResponseFlag: host.normalizeResponseFlag,
      responseLabelForDisplay: host.responseLabelForDisplay,
      openJobDetail: host.openJobDetail,
    };

    app.pipelineController = app.pipelineController || {};
    app.pipelineController.host = {
      renderPipeline: host.renderPipeline,
      renderStats: host.renderStats,
      renderBrief: host.renderBrief,
      refreshDrawerIfOpen: host.refreshDrawerIfOpen,
    };

    app.core = app.core || {};
    app.core.host = {
      showToast: host.showToast,
      escapeHtml(...args) {
        return app.utils.escapeHtml(...args);
      },
      safeHref(...args) {
        return app.utils.safeHref(...args);
      },
      getConfig: host.getConfig,
      getSheetId: host.getSheetId,
      getSHEET_ID: host.getSHEET_ID,
      setSHEET_ID: host.setSHEET_ID,
      getActiveSheetId: host.getActiveSheetId,
      getAccessToken: host.getAccessToken,
      getUserEmail: host.getUserEmailFromAuth,
      isSignedIn: host.isSignedIn,
      refreshAccessTokenSilently: host.refreshAccessTokenSilently,
      getPipelineData: host.getPipelineData,
      setPipelineData: host.setPipelineData,
      getPipelineRawRows: host.getPipelineRawRows,
      setPipelineRawRows: host.setPipelineRawRows,
      getPipelineViewFilters: host.getPipelineViewFilters,
      setPipelineViewFilters: host.setPipelineViewFilters,
      renderPipeline: host.renderPipeline,
      renderBrief: host.renderBrief,
      renderStats: host.renderStats,
      renderExpiredReviewButton: host.renderExpiredReviewButton,
      refreshDrawerIfOpen: host.refreshDrawerIfOpen,
      loadAllData: host.loadAllData,
      updateSheetCell: host.updateSheetCell,
      updateMultipleCells: host.updateMultipleCells,
      sheetsValuesAppend: host.sheetsValuesAppend,
      sheetsValuesGet: host.sheetsValuesGet,
      sheetsValuesUpdate: host.sheetsValuesUpdate,
      sheetsBatchUpdate: host.sheetsBatchUpdate,
      showSheetAccessGate(...args) {
        return app.setup.showSheetAccessGate(...args);
      },
      revealSetupScreenAfterAuth: host.revealSetupScreenAfterAuth,
      renderSetupStarterSheetUi: host.renderSetupStarterSheetUi,
      handleSetupCreateStarterSheet: host.handleSetupCreateStarterSheet,
      getPendingSetupStarterSheetCreate:
        host.getPendingSetupStarterSheetCreate,
      setPendingSetupStarterSheetCreate:
        host.setPendingSetupStarterSheetCreateRaw,
      getLastSheetAccessError(...args) {
        return app.setup.getLastSheetAccessError(...args);
      },
      maybeSyncSettingsModalModeAfterAuth(...args) {
        return app.settings.maybeSyncSettingsModalModeAfterAuth(...args);
      },
      refreshPersonalPreferencesPanel: host.refreshPersonalPreferencesPanel,
      showOnboardingWizard: host.showOnboardingWizard,
      checkOnboardingGate: host.checkOnboardingGate,
      openCommandCenterSettingsModal(...args) {
        return app.settings.openCommandCenterSettingsModal(...args);
      },
      closeCommandCenterSettingsModal(...args) {
        return app.settings.closeCommandCenterSettingsModal(...args);
      },
      getUserContent: host.getUserContent,
      getResumeBundle: host.getResumeBundle,
      getResumeGenerate: host.getResumeGenerate,
      runResumeGeneration: host.runResumeGeneration,
      getResumeIngest: host.getResumeIngest,
      closeAuthUserMenu: host.closeAuthUserMenu,
      fillDocumentTemplateSelect: host.fillDocumentTemplateSelect,
      fillVisualThemeSelect: host.fillVisualThemeSelect,
      dismissJob: host.dismissJob,
      getSheetRow: host.getSheetRow,
      getJobPostingScrapeUrl: host.getJobPostingScrapeUrl,
      isScraperUrlBlockedOnThisPage: host.isScraperUrlBlockedOnThisPage,
      buildCandidateProfileExcerpt: host.buildCandidateProfileExcerpt,
      getCachedEnrichmentForJob: host.getCachedEnrichmentForJob,
      cacheEnrichment: host.cacheEnrichment,
      applyEnrichmentCache: host.applyEnrichmentCache,
      getDraftsForJob: host.getDraftsForJob,
      refreshGeneratedDraftLibraryCache:
        host.refreshGeneratedDraftLibraryCache,
      getAtsScoringConfig: host.getAtsScoringConfig,
      getAtsScorecardApiUrl: host.getAtsScorecardApiUrl,
      renderResumeGenerateInsights: host.renderResumeGenerateInsights,
      getJobOpportunityKey: host.getJobOpportunityKey,
      openMaterialsModal: host.openMaterialsModal,
      getResumeIngestReady: host.getResumeIngestReady,
      normalizeProfileTextInput: host.normalizeProfileTextInput,
      readStoredConfigOverrides: host.readStoredConfigOverrides,
      mergeStoredConfigOverridePatch: host.mergeStoredConfigOverridePatch,
      resolveGeminiModel(...args) {
        return discovery.drawer.resolveGeminiModel(...args);
      },
      callDiscoveryAiGemini(...args) {
        return discovery.drawer.callDiscoveryAiGemini(...args);
      },
      callConfiguredAi(...args) {
        return discovery.drawer.callConfiguredAi(...args);
      },
      parseJsonSafeForSuggestions(...args) {
        return discovery.drawer.parseJsonSafeForSuggestions(...args);
      },
      resumePendingDiscoverySetupIfNeeded:
        host.resumePendingDiscoverySetupIfNeeded,
      normalizeDashboardTitle: host.normalizeDashboardTitle,
      parseGoogleSheetId(...args) {
        return app.configCore.parseGoogleSheetId(...args);
      },
      writeStoredConfigOverrides: host.writeStoredConfigOverrides,
      buildGreenfieldOverrideMask: host.buildGreenfieldOverrideMask,
      canUseLocalStorage: host.canUseLocalStorage,
      applyOAuthClientChange: host.applyOAuthClientChange,
      syncDiscoveryButtonState: host.syncDiscoveryButtonState,
      setDashboardSheetLinks() {
        return app.setup.setDashboardSheetLinks();
      },
      setSHEET_ID: host.setSHEET_ID,
      normalizeDiscoveryWebhookIdentity: host.normalizeDiscoveryWebhookIdentity,
      recordDiscoveryEngineState: host.recordDiscoveryEngineState,
      getManagedAppsScriptWebhookIdentity:
        host.getManagedAppsScriptWebhookIdentity,
      getSavedDiscoveryEngineStateForUrl:
        host.getSavedDiscoveryEngineStateForUrl,
      getDiscoveryEngineStateNone() {
        return host.DISCOVERY_ENGINE_STATE_NONE;
      },
      getDiscoveryEngineStateStubOnly() {
        return host.DISCOVERY_ENGINE_STATE_STUB_ONLY;
      },
      getDiscoveryEngineStateUnverified() {
        return host.DISCOVERY_ENGINE_STATE_UNVERIFIED;
      },
      clearSessionAuthState: host.clearSessionAuthState,
      clearPersistedOAuthSession: host.clearPersistedOAuthSession,
      clearPersistedRuntimeOAuthSession: host.clearPersistedRuntimeOAuthSession,
      getCommandCenterConfigOverrideKey() {
        return host.COMMAND_CENTER_CONFIG_OVERRIDE_KEY;
      },
      getDiscoveryTransportSetupKey() {
        return host.DISCOVERY_TRANSPORT_SETUP_KEY;
      },
      getDiscoveryRunTrackerKey() {
        return host.DISCOVERY_RUN_TRACKER_KEY;
      },
      getForceConsentPromptKey() {
        return host.FORCE_CONSENT_PROMPT_KEY;
      },
      populateAppsScriptDeployStateIntoSettingsForm:
        host.populateAppsScriptDeployStateIntoSettingsForm,
      renderAppsScriptDeployUi: host.renderAppsScriptDeployUi,
      renderDiscoveryEngineStatusUi: host.renderDiscoveryEngineStatusUi,
      deployAppsScriptStubFromSettings: host.deployAppsScriptStubFromSettings,
      recheckAppsScriptPublicAccessFromSettings:
        host.recheckAppsScriptPublicAccessFromSettings,
      copyTextToClipboard: host.copyTextToClipboard,
      probeTunnelStaleBadge: host.probeTunnelStaleBadge,
      requestDiscoverySetup: host.requestDiscoverySetup,
      resetAppsScriptDeployModalState() {
        const configCore = getConfigCore(host);
        configCore.appsScriptDeployStatus = null;
        configCore.appsScriptDeployStateCache = null;
      },
      getAppsScriptDeployStateCache() {
        return getConfigCore(host).appsScriptDeployStateCache;
      },
      clearAppsScriptDeployStatusIfIdle() {
        const configCore = getConfigCore(host);
        if (!configCore.appsScriptDeployBusy) {
          configCore.appsScriptDeployStatus = null;
        }
      },
      isAuthUserMenuOpen: host.isAuthUserMenuOpen,
      closeScraperSetupModal: host.closeScraperSetupModal,
      hideSettingsClearConfirmBar: host.hideSettingsClearConfirmBar,
      getOAuthClientId: host.getOAuthClientId,
      recordSheetAccessError(...args) {
        return app.setup.recordSheetAccessError(...args);
      },
      hasGrantedOauthScope: host.hasGrantedOauthScope,
      getGoogleSheetsScope() {
        return host.GOOGLE_SHEETS_SCOPE;
      },
      getStarterPipelineHeaders() {
        return host.STARTER_PIPELINE_HEADERS;
      },
      getStarterPipelineHeaderRange() {
        return host.STARTER_PIPELINE_HEADER_RANGE;
      },
      installDoctor: host.installDoctor,
      hasPendingDiscoverySetup: host.hasPendingDiscoverySetup,
      getDataLoadFailed: host.getDataLoadFailed,
      setDataLoadFailed: host.setDataLoadFailed,
      getDashboardDataHydrated: host.getDashboardDataHydrated,
      setDashboardDataHydrated: host.setDashboardDataHydrated,
      getInitialSheetAccessResolved: host.getInitialSheetAccessResolved,
      setInitialSheetAccessResolved: host.setInitialSheetAccessResolved,
      updateLastRefresh: host.updateLastRefresh,
      maybeAutoOpenExpiredReviewModal: host.maybeAutoOpenExpiredReviewModal,
      revealDashboardShell() {
        return app.setup.revealDashboardShell();
      },
      runPostAccessBootstrapOnce: host.runPostAccessBootstrapOnce,
      markJobViewed: host.markJobViewed,
      notifyPipelineRendered: host.notifyPipelineRendered,
      toggleFavorite: host.toggleFavorite,
      restoreJob: host.restoreJob,
      updateJobStatus: host.updateJobStatus,
      updateJobNotes: host.updateJobNotes,
      updateFollowUpDate: host.updateFollowUpDate,
      updateLastHeardFrom: host.updateLastHeardFrom,
      updateJobResponseFlag: host.updateJobResponseFlag,
      signIn: host.signIn,
      selectedResponseSheetValue: host.selectedResponseSheetValue,
      fetchJobPostingEnrichment: host.fetchJobPostingEnrichment,
    };

    Object.assign(app.core, {
      getSHEET_ID: host.getSHEET_ID,
      setSHEET_ID: host.setSHEET_ID,
      getPipelineData: host.getPipelineData,
      setPipelineData: host.setPipelineData,
      getPipelineRawRows: host.getPipelineRawRows,
      setPipelineRawRows: host.setPipelineRawRows,
      getAccessToken: host.getAccessToken,
      setAccessToken(value) {
        return app.auth.setAccessToken(value);
      },
      getUserEmail: host.getUserEmailFromAuth,
      setUserEmail(value) {
        return app.auth.setUserEmail(value);
      },
      getTokenExpiresAt: host.getTokenExpiresAt,
      setTokenExpiresAt(value) {
        return app.auth.setTokenExpiresAt(value);
      },
      getTokenClient: host.getTokenClient,
      setTokenClient(value) {
        return app.auth.setTokenClient(value);
      },
      getGisLoaded: host.getGisLoaded,
      setGisLoaded(value) {
        return app.auth.setGisLoaded(value);
      },
      getPendingSetupStarterSheetCreate:
        host.getPendingSetupStarterSheetCreate,
      setPendingSetupStarterSheetCreate:
        host.setPendingSetupStarterSheetCreate,
      getCurrentSort: host.getCurrentSort,
      setCurrentSort: host.setCurrentSort,
      getCurrentSearch: host.getCurrentSearch,
      setCurrentSearch: host.setCurrentSearch,
      getFavoritesOnly: host.getFavoritesOnly,
      setFavoritesOnly: host.setFavoritesOnly,
      getShowDismissed: host.getShowDismissed,
      setShowDismissed: host.setShowDismissed,
      getActiveDetailKey: host.getActiveDetailKey,
      setActiveDetailKey: host.setActiveDetailKey,
      getViewedJobKeys: host.getViewedJobKeys,
      getExpandedStages: host.getExpandedStages,
      getDataLoadFailed: host.getDataLoadFailed,
      getBriefActivityRange() {
        return app.brief.getBriefActivityRange();
      },
      setBriefActivityRange(range) {
        return app.brief.setBriefActivityRange(range);
      },
      getLastResumeGenerationSession() {
        return app.resumeGeneration.getLastResumeGenerationSession();
      },
      setLastResumeGenerationSession(value) {
        return app.resumeGeneration.setLastResumeGenerationSession(value);
      },
      getAtsScorecardState() {
        return app.materialsState.getAtsScorecardState();
      },
      setAtsScorecardState(next) {
        return app.materialsState.setAtsScorecardState(next);
      },
      getGeneratedDraftLibraryCache() {
        return app.materialsState.getGeneratedDraftLibraryCache();
      },
      setGeneratedDraftLibraryCache(next) {
        return app.materialsState.setGeneratedDraftLibraryCache(next);
      },
      getCandidateProfileMatchCache() {
        return app.keywordMatch.getCandidateProfileMatchCache();
      },
      setCandidateProfileMatchCache(next) {
        return app.keywordMatch.setCandidateProfileMatchCache(next);
      },
    });
  }

  app.bridgeRegistry = Object.assign(app.bridgeRegistry || {}, {
    registerAllBridges,
  });
})();
