/**
 * Settings tab metadata and field-to-tab mapping.
 * Consumed by settings-tabs.js (controller) and app.js (validation routing).
 */
(function () {
  "use strict";

  // Setup and Sheet were two tabs asking for two halves of one Google
  // connection, and "AI Providers" was a shelf named after vendors. One
  // "Google" tab and one "AI" tab, each opening with a receipt of what the
  // six beats already collected (GREENFIELD D3).
  const SETTINGS_TAB_IDS = Object.freeze({
    GOOGLE: "google",
    FIT_PROFILE: "fit_profile",
    SCRAPING: "scraping",
    ATS_SCORING: "ats_scoring",
    AI: "ai",
    UPGRADES: "upgrades",
  });

  const TAB_ORDER = [
    SETTINGS_TAB_IDS.GOOGLE,
    SETTINGS_TAB_IDS.AI,
    SETTINGS_TAB_IDS.FIT_PROFILE,
    SETTINGS_TAB_IDS.SCRAPING,
    SETTINGS_TAB_IDS.ATS_SCORING,
    SETTINGS_TAB_IDS.UPGRADES,
  ];

  const TAB_META = Object.freeze({
    [SETTINGS_TAB_IDS.GOOGLE]: {
      id: SETTINGS_TAB_IDS.GOOGLE,
      label: "Google",
      panelId: "settings-panel-google",
      buttonId: "settings-tab-google",
    },
    [SETTINGS_TAB_IDS.FIT_PROFILE]: {
      id: SETTINGS_TAB_IDS.FIT_PROFILE,
      label: "Fit Profile",
      panelId: "settings-panel-fit-profile",
      buttonId: "settings-tab-fit-profile",
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
    [SETTINGS_TAB_IDS.AI]: {
      id: SETTINGS_TAB_IDS.AI,
      label: "AI",
      panelId: "settings-panel-ai",
      buttonId: "settings-tab-ai",
    },
    // The one-flow's power-up shelf (ONE-FLOW-ONBOARDING-SPEC §7): what the
    // retired enhancements wizard used to walk people through, as a page
    // they visit when they want it rather than a track they must finish.
    [SETTINGS_TAB_IDS.UPGRADES]: {
      id: SETTINGS_TAB_IDS.UPGRADES,
      label: "Upgrades",
      panelId: "settings-panel-upgrades",
      buttonId: "settings-tab-upgrades",
    },
  });

  /** Map every known field/control id → tab id */
  const FIELD_TAB_MAP = Object.freeze({
    // Google (the former Setup + Sheet tabs)
    settingsSheetId: SETTINGS_TAB_IDS.GOOGLE,
    settingsTitle: SETTINGS_TAB_IDS.GOOGLE,
    settingsOAuthClientId: SETTINGS_TAB_IDS.GOOGLE,
    settingsOAuthClientIdLabel: SETTINGS_TAB_IDS.GOOGLE,
    profileResetWizardBtn: SETTINGS_TAB_IDS.GOOGLE,
    infraResetWizardBtn: SETTINGS_TAB_IDS.GOOGLE,
    settingsClearConfirmBar: SETTINGS_TAB_IDS.GOOGLE,
    settingsClearBtn: SETTINGS_TAB_IDS.GOOGLE,
    settingsClearConfirmCancel: SETTINGS_TAB_IDS.GOOGLE,
    settingsClearConfirmYes: SETTINGS_TAB_IDS.GOOGLE,
    settingsJbV2Toggle: SETTINGS_TAB_IDS.GOOGLE,
    settingsJbV2ToggleLabel: SETTINGS_TAB_IDS.GOOGLE,
    settingsJbV2ToggleHint: SETTINGS_TAB_IDS.GOOGLE,

    // Fit Profile
    fitProfileOpenWizardBtn: SETTINGS_TAB_IDS.FIT_PROFILE,
    fitProfileEditorContainer: SETTINGS_TAB_IDS.FIT_PROFILE,
    fitProfileSaveBtn: SETTINGS_TAB_IDS.FIT_PROFILE,

    // Profile-driven discovery now lives entirely behind the portfolio /
    // briefcase nav icon. Its IDs (settingsProfile* + schedule controls)
    // intentionally do not appear in FIELD_TAB_MAP so the Settings
    // field-error router cannot try to focus them inside this modal.

    // Scraping
    settingsJobPostingScrapeUrl: SETTINGS_TAB_IDS.SCRAPING,
    openScraperSetupFromSettings: SETTINGS_TAB_IDS.SCRAPING,

    // ATS Scoring
    settingsAtsScoringMode: SETTINGS_TAB_IDS.ATS_SCORING,
    settingsAtsScoringServerUrl: SETTINGS_TAB_IDS.ATS_SCORING,
    settingsAtsScoringWebhookUrl: SETTINGS_TAB_IDS.ATS_SCORING,

    // AI
    settingsResumeProvider: SETTINGS_TAB_IDS.AI,
    settingsPanelGemini: SETTINGS_TAB_IDS.AI,
    settingsResumeGeminiApiKey: SETTINGS_TAB_IDS.AI,
    settingsResumeGeminiModel: SETTINGS_TAB_IDS.AI,
    settingsPanelOpenAI: SETTINGS_TAB_IDS.AI,
    settingsResumeOpenAIApiKey: SETTINGS_TAB_IDS.AI,
    settingsResumeOpenAIModel: SETTINGS_TAB_IDS.AI,
    settingsPanelAnthropic: SETTINGS_TAB_IDS.AI,
    settingsResumeAnthropicApiKey: SETTINGS_TAB_IDS.AI,
    settingsResumeAnthropicModel: SETTINGS_TAB_IDS.AI,
    settingsPanelWebhook: SETTINGS_TAB_IDS.AI,
    settingsResumeGenerationWebhookUrl: SETTINGS_TAB_IDS.AI,
    settingsPanelOpenRouter: SETTINGS_TAB_IDS.AI,
    settingsResumeOpenRouterApiKey: SETTINGS_TAB_IDS.AI,
    settingsResumeOpenRouterModel: SETTINGS_TAB_IDS.AI,
    settingsPanelLocal: SETTINGS_TAB_IDS.AI,
    settingsResumeLocalBaseUrl: SETTINGS_TAB_IDS.AI,
    settingsResumeLocalModel: SETTINGS_TAB_IDS.AI,
    settingsResumeLocalApiKey: SETTINGS_TAB_IDS.AI,
  });

  const DEFAULT_TAB = SETTINGS_TAB_IDS.GOOGLE;

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
    TAB_ORDER: TAB_ORDER,
    TAB_META: TAB_META,
    DEFAULT_TAB: DEFAULT_TAB,
    getSettingsTabForField: getSettingsTabForField,
    getSettingsTabMeta: getSettingsTabMeta,
    getSettingsPanelId: getSettingsPanelId,
    getSettingsTabButtonId: getSettingsTabButtonId,
    getSettingsTabOrder: getSettingsTabOrder,
  };
})();
