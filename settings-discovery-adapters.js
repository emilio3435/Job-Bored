/**
 * Discovery tab adapters — helpers that activate the Discovery tab
 * before focusing hidden controls. Depends on settings-tabs.js and
 * settings-tab-schema.js being loaded first.
 */
(function () {
  "use strict";

  var Schema = window.JobBoredSettingsTabSchema;
  var Tabs = window.JobBoredSettingsTabs;
  var IDS = Schema.SETTINGS_TAB_IDS;

  /**
   * Ensure the Discovery tab is the active settings tab.
   * No-op if it already is.
   */
  function ensureDiscoveryTabActive() {
    if (Tabs.getActiveSettingsTab() !== IDS.DISCOVERY) {
      Tabs.setActiveSettingsTab(IDS.DISCOVERY, { silent: true });
    }
  }

  /**
   * Switch to Discovery and focus the webhook URL field.
   */
  function focusDiscoveryWebhookField() {
    Tabs.setActiveSettingsTab(IDS.DISCOVERY, {
      silent: true,
      focusField: "settingsDiscoveryWebhookUrl",
    });
  }

  /**
   * Switch to Discovery so the Apps Script remediation UI is visible.
   */
  function prepareAppsScriptRemediationView() {
    ensureDiscoveryTabActive();
    requestAnimationFrame(function () {
      var details = document.getElementById("settingsAppsScriptDetails");
      if (details && !details.open) details.open = true;
    });
  }

  /**
   * After a Cloudflare relay apply, switch to Discovery so the user
   * can see the webhook URL that was just filled in.
   */
  function prepareCloudflareRelayApplyReturn() {
    Tabs.setActiveSettingsTab(IDS.DISCOVERY, {
      silent: true,
      focusField: "settingsDiscoveryWebhookUrl",
    });
  }

  /**
   * Switch to Scraping tab and focus the scraper URL field.
   */
  function focusScraperField() {
    Tabs.setActiveSettingsTab(IDS.SCRAPING, {
      silent: true,
      focusField: "settingsJobPostingScrapeUrl",
    });
  }

  window.JobBoredSettingsDiscoveryAdapters = {
    ensureDiscoveryTabActive: ensureDiscoveryTabActive,
    focusDiscoveryWebhookField: focusDiscoveryWebhookField,
    prepareAppsScriptRemediationView: prepareAppsScriptRemediationView,
    prepareCloudflareRelayApplyReturn: prepareCloudflareRelayApplyReturn,
    focusScraperField: focusScraperField,
  };
})();
