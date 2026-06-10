/**
 * Discovery drawer adapters — helpers that open the Discovery side
 * drawer (and activate the right sub-tab) before focusing controls
 * that now live in the Discovery drawer.
 *
 * The drawer is now the single canonical surface for discovery setup,
 * search intent, sources, automation, connection, and history. These
 * adapters keep the existing call-site names intact so app.js does
 * not need rewiring.
 */
(function () {
  "use strict";

  var Schema = window.JobBoredSettingsTabSchema;
  var Tabs = window.JobBoredSettingsTabs;
  var IDS = Schema.SETTINGS_TAB_IDS;

  function openDrawerToSubtab(subtab, focusFieldId) {
    var openFn =
      (typeof window.openDiscoveryDrawer === "function" &&
        window.openDiscoveryDrawer) ||
      null;
    if (openFn) {
      try {
        openFn();
      } catch (_) {
        /* fall through to focusField */
      }
    }
    requestAnimationFrame(function () {
      if (
        subtab &&
        window.JobBoredDiscoveryDrawerSubtabs &&
        typeof window.JobBoredDiscoveryDrawerSubtabs.setActiveSubtab ===
          "function"
      ) {
        window.JobBoredDiscoveryDrawerSubtabs.setActiveSubtab(subtab, {
          silent: true,
        });
      }
      if (focusFieldId) {
        requestAnimationFrame(function () {
          var field = document.getElementById(focusFieldId);
          if (field) {
            field.focus();
            if (
              typeof field.select === "function" &&
              field.tagName === "INPUT"
            ) {
              field.select();
            }
          }
        });
      }
    });
  }

  /**
   * Ensure the Discovery drawer is open. No-op once open.
   * Retained for backwards-compatible callers.
   */
  function ensureDiscoveryTabActive() {
    openDrawerToSubtab(null, null);
  }

  /**
   * Open the drawer to the Connection sub-tab and focus the webhook URL.
   */
  function focusDiscoveryWebhookField() {
    openDrawerToSubtab("connection", "settingsDiscoveryWebhookUrl");
  }

  /**
   * Open the drawer to Connection and expand the Apps Script details.
   */
  function prepareAppsScriptRemediationView() {
    openDrawerToSubtab("connection", null);
    requestAnimationFrame(function () {
      var details = document.getElementById("settingsAppsScriptDetails");
      if (details && !details.open) details.open = true;
    });
  }

  /**
   * After a Cloudflare relay apply, open Connection so the user
   * sees the webhook URL that was just filled in.
   */
  function prepareCloudflareRelayApplyReturn() {
    openDrawerToSubtab("connection", "settingsDiscoveryWebhookUrl");
  }

  /**
   * Switch to the Settings Scraping tab and focus the scraper URL field.
   * Scraping still lives in Settings, so this keeps the Settings router.
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
    // app-compat's openDrawerToSubtab shim reads this — a missing export
    // silently no-ops every Discovery-drawer deep-link.
    openDrawerToSubtab: openDrawerToSubtab,
  };
})();
