/**
 * Settings tab metadata and field-to-tab mapping.
 * Consumed by settings-tabs.js (controller) and app.js (validation routing).
 */
(function () {
  "use strict";

  const SETTINGS_TAB_IDS = Object.freeze({
    SETUP: "setup",
    SHEET: "sheet",
    DISCOVERY: "discovery",
    PROFILE: "profile",
    SCRAPING: "scraping",
    ATS_SCORING: "ats_scoring",
    AI_PROVIDERS: "ai_providers",
  });

  const TAB_ORDER = [
    SETTINGS_TAB_IDS.SETUP,
    SETTINGS_TAB_IDS.SHEET,
    SETTINGS_TAB_IDS.DISCOVERY,
    SETTINGS_TAB_IDS.PROFILE,
    SETTINGS_TAB_IDS.SCRAPING,
    SETTINGS_TAB_IDS.ATS_SCORING,
    SETTINGS_TAB_IDS.AI_PROVIDERS,
  ];

  const TAB_META = Object.freeze({
    [SETTINGS_TAB_IDS.SETUP]: {
      id: SETTINGS_TAB_IDS.SETUP,
      label: "Setup",
      panelId: "settings-panel-setup",
      buttonId: "settings-tab-setup",
    },
    [SETTINGS_TAB_IDS.SHEET]: {
      id: SETTINGS_TAB_IDS.SHEET,
      label: "Sheet",
      panelId: "settings-panel-sheet",
      buttonId: "settings-tab-sheet",
    },
    [SETTINGS_TAB_IDS.DISCOVERY]: {
      id: SETTINGS_TAB_IDS.DISCOVERY,
      label: "Discovery",
      panelId: "settings-panel-discovery",
      buttonId: "settings-tab-discovery",
    },
    [SETTINGS_TAB_IDS.PROFILE]: {
      id: SETTINGS_TAB_IDS.PROFILE,
      label: "Profile",
      panelId: "settings-panel-profile",
      buttonId: "settings-tab-profile",
    },
    [SETTINGS_TAB_IDS.SCRAPING]: {
      id: SETTINGS_TAB_IDS.SCRAPING,
      label: "Scraping",
      panelId: "settings-panel-scraping",
      buttonId: "settings-tab-scraping",
    },
    [SETTINGS_TAB_IDS.ATS_SCORING]: {
      id: SETTINGS_TAB_IDS.ATS_SCORING,
      label: "ATS Scoring",
      panelId: "settings-panel-ats-scoring",
      buttonId: "settings-tab-ats-scoring",
    },
    [SETTINGS_TAB_IDS.AI_PROVIDERS]: {
      id: SETTINGS_TAB_IDS.AI_PROVIDERS,
      label: "AI Providers",
      panelId: "settings-panel-ai-providers",
      buttonId: "settings-tab-ai-providers",
    },
  });

  /** Map every known field/control id → tab id */
  const FIELD_TAB_MAP = Object.freeze({
    // Setup
    settingsOAuthClientId: SETTINGS_TAB_IDS.SETUP,
    settingsOAuthClientIdLabel: SETTINGS_TAB_IDS.SETUP,
    profileResetWizardBtn: SETTINGS_TAB_IDS.SETUP,
    settingsClearConfirmBar: SETTINGS_TAB_IDS.SETUP,
    settingsClearBtn: SETTINGS_TAB_IDS.SETUP,
    settingsClearConfirmCancel: SETTINGS_TAB_IDS.SETUP,
    settingsClearConfirmYes: SETTINGS_TAB_IDS.SETUP,

    // Sheet
    settingsSheetId: SETTINGS_TAB_IDS.SHEET,
    settingsTitle: SETTINGS_TAB_IDS.SHEET,

    // Discovery
    settingsDiscoveryWebhookUrl: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryWebhookSecret: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryPathsBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryGuideBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryLocalSetupBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryRelayBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryTestBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryEngineStatus: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryEngineStatusTitle: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryEngineStatusDetail: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryEngineStatusActions: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptDetails: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptDeployBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptOpenBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptCopyBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptRecheckBtn: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptStatus: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptStatusTitle: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptStatusDetail: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptStatusSteps: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptUrlRow: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptUrl: SETTINGS_TAB_IDS.DISCOVERY,
    settingsAppsScriptStatusActions: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryTargetRoles: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryLocations: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryRemotePolicy: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoverySeniority: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryKeywordsInclude: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryKeywordsExclude: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryMaxLeadsPerRun: SETTINGS_TAB_IDS.DISCOVERY,
    settingsDiscoveryTestHint: SETTINGS_TAB_IDS.DISCOVERY,

    // Profile (Feature B / Layer 5)
    settingsProfileResumeFile: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileResumeText: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileResumeClear: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileResumeStatus: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileFormTargetRoles: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileFormSkills: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileFormSeniority: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileFormYears: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileFormLocations: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileFormRemotePolicy: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileFormIndustries: SETTINGS_TAB_IDS.PROFILE,
    settingsProfilePersist: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileRunBtn: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileError: SETTINGS_TAB_IDS.PROFILE,
    settingsProfileResults: SETTINGS_TAB_IDS.PROFILE,

    // Scraping
    settingsJobPostingScrapeUrl: SETTINGS_TAB_IDS.SCRAPING,
    openScraperSetupFromSettings: SETTINGS_TAB_IDS.SCRAPING,

    // ATS Scoring
    settingsAtsScoringMode: SETTINGS_TAB_IDS.ATS_SCORING,
    settingsAtsScoringServerUrl: SETTINGS_TAB_IDS.ATS_SCORING,
    settingsAtsScoringWebhookUrl: SETTINGS_TAB_IDS.ATS_SCORING,

    // AI Providers
    settingsResumeProvider: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsPanelGemini: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsResumeGeminiApiKey: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsResumeGeminiModel: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsPanelOpenAI: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsResumeOpenAIApiKey: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsResumeOpenAIModel: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsPanelAnthropic: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsResumeAnthropicApiKey: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsResumeAnthropicModel: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsPanelWebhook: SETTINGS_TAB_IDS.AI_PROVIDERS,
    settingsResumeGenerationWebhookUrl: SETTINGS_TAB_IDS.AI_PROVIDERS,
  });

  const DEFAULT_TAB = SETTINGS_TAB_IDS.SETUP;

  function getSettingsTabForField(fieldId) {
    return FIELD_TAB_MAP[fieldId] || null;
  }

  function getSettingsTabMeta(tabId) {
    return TAB_META[tabId] || null;
  }

  function getSettingsPanelId(tabId) {
    var meta = TAB_META[tabId];
    return meta ? meta.panelId : null;
  }

  function getSettingsTabButtonId(tabId) {
    var meta = TAB_META[tabId];
    return meta ? meta.buttonId : null;
  }

  function getSettingsTabOrder() {
    return TAB_ORDER.slice();
  }

  window.JobBoredSettingsTabSchema = {
    SETTINGS_TAB_IDS: SETTINGS_TAB_IDS,
    TAB_META: TAB_META,
    DEFAULT_TAB: DEFAULT_TAB,
    getSettingsTabForField: getSettingsTabForField,
    getSettingsTabMeta: getSettingsTabMeta,
    getSettingsPanelId: getSettingsPanelId,
    getSettingsTabButtonId: getSettingsTabButtonId,
    getSettingsTabOrder: getSettingsTabOrder,
  };
})();
