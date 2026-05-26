/**
 * Settings tab metadata and field-to-tab mapping.
 * Consumed by settings-tabs.js (controller) and app.js (validation routing).
 */
(function () {
  "use strict";

  const SETTINGS_TAB_IDS = Object.freeze({
    SETUP: "setup",
    SHEET: "sheet",
    SCRAPING: "scraping",
    ATS_SCORING: "ats_scoring",
    AI_PROVIDERS: "ai_providers",
  });

  const TAB_ORDER = [
    SETTINGS_TAB_IDS.SETUP,
    SETTINGS_TAB_IDS.SHEET,
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
    settingsJbV2Toggle: SETTINGS_TAB_IDS.SETUP,
    settingsJbV2ToggleLabel: SETTINGS_TAB_IDS.SETUP,
    settingsJbV2ToggleHint: SETTINGS_TAB_IDS.SETUP,

    // Sheet
    settingsSheetId: SETTINGS_TAB_IDS.SHEET,
    settingsTitle: SETTINGS_TAB_IDS.SHEET,

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
