/* ============================================
   COMMAND CENTER v2 — Discovery settings actions

   Classic-global IIFE under window.JobBoredDiscovery.setupModals — NOT an
   ES module. Loaded BEFORE app.js (after discovery-run-orchestration.js).

   This file used to hold five discovery setup modals: "ways to avoid
   webhooks", the webhook setup guide, "local worker + ngrok", the
   Cloudflare relay wizard, and a Run-discovery help dialog. All five are
   deleted (ONE-FLOW-ONBOARDING-SPEC §7, completing the original discovery
   spec's Phase 3): Beat 5 IS discovery setup, the drawer's Connection
   section is one `Open discovery setup` button, and the ngrok + Cloudflare
   paths live in docs/SELF-HOSTING.md per §11.2.

   What is left never was a modal:
     · testDiscoveryWebhookFromSettings — Settings' Test-webhook diagnostic;
     · handleAppsScriptBrowserCorsFailure — Apps Script CORS remediation,
       called by discovery-run-orchestration.js and discovery-wizard-ui.js;
     · initDiscoverySetupGuide — wires the two buttons that survive.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const setupModals = root.setupModals || (root.setupModals = {});

  function host() {
    return setupModals.host || {};
  }

  function h(name, ...args) {
    const fn = host()[name];
    return typeof fn === "function" ? fn(...args) : undefined;
  }

async function testDiscoveryWebhookFromSettings() {
  const urlEl = document.getElementById("settingsDiscoveryWebhookUrl");
  const secretEl = document.getElementById("settingsDiscoveryWebhookSecret");
  const sheetEl = document.getElementById("settingsSheetId");
  const url = h("normalizeDiscoveryWebhookIdentity", urlEl && urlEl.value.trim());
  const secret = secretEl ? String(secretEl.value || "").trim() : "";
  const sheetRaw = sheetEl && sheetEl.value.trim();
  const sheetId = h("parseGoogleSheetId", sheetRaw || "");
  if (!url) {
    h("showToast", "Paste a discovery webhook URL first", "error");
    return;
  }
  if (!sheetId) {
    h("showToast", "Set a valid Spreadsheet URL or Sheet ID above first", "error");
    return;
  }
  const testBtn = document.getElementById("settingsDiscoveryTestBtn");
  if (testBtn) testBtn.disabled = true;
  try {
    const payload = await h("buildDiscoveryWebhookPayload", sheetId);
    const result = await h("verifyDiscoveryWebhookWithSharedModel", url, payload, {
      context: "test_webhook",
      sheetId,
      secret,
    });
    if (result.ok) {
      const engineState = h("getDiscoveryEngineStateFromVerificationResult", result);
      if (engineState) {
        await h("recordDiscoveryEngineState", url, engineState, "test_webhook");
      }
      await h("refreshDiscoveryReadinessSnapshot", { force: true, rerender: false });
      h("showDiscoveryVerificationToast", result, {
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
      h("showDiscoveryVerificationToast", result, {
        context: "test_webhook",
        endpointUrl: url,
      });
      return;
    }
    h("showDiscoveryVerificationToast", result, {
      context: "test_webhook",
      endpointUrl: url,
    });
  } catch (err) {
    h("showToast", String(err.message || err || "Test failed"), "error");
  } finally {
    if (testBtn) testBtn.disabled = false;
    h("refreshDiscoveryUiState");
  }
}

async function handleAppsScriptBrowserCorsFailure(
  url,
  resultKind = "network_error",
) {
  if (!h("isLikelyAppsScriptWebAppUrl", url)) return false;
  const isNetworkLikeFailure =
    (resultKind === "network_error" &&
      h("isManagedAppsScriptDeployState", h("getConfigCore")().appsScriptDeployStateCache)) ||
    (resultKind === "invalid_endpoint" &&
      h("isManagedAppsScriptDeployState", h("getConfigCore")().appsScriptDeployStateCache));
  if (!isNetworkLikeFailure) return false;
  if (
    h("isManagedAppsScriptDeployState", h("getConfigCore")().appsScriptDeployStateCache) &&
    !h("isAppsScriptPublicAccessReady", h("getConfigCore")().appsScriptDeployStateCache)
  ) {
    if (!h("isSettingsModalOpen")) {
      await h("openCommandCenterSettingsModal");
    }
    h("showAppsScriptPublicAccessRemediationFromState");
    h("showToast",
      "Apps Script is not publicly callable yet. Finish the remediation steps in Settings before using the relay.",
      "error",
      true,
    );
    return true;
  }
  // Apps Script is publicly accessible — treat as stub-only wiring confirmation.
  // The endpoint accepted the request but is not a real discovery engine.
  // Suppress the generic CORS/network error and let the caller treat this as stub_only.
  h("showToast",
    "Apps Script stub received the request. This is wiring-only — the stub does not find real jobs.",
    "warning",
    true,
  );
  return true;
}

function initDiscoverySetupGuide() {
  // One way in (spec §7): the discovery wizard, which Beat 5 also drives.
  document
    .getElementById("settingsDiscoveryOpenSetupBtn")
    ?.addEventListener("click", () => {
      void h("requestDiscoverySetup", {
        entryPoint: "settings",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("settingsDiscoveryTestBtn")
    ?.addEventListener("click", () => {
      void testDiscoveryWebhookFromSettings();
    });
}

  Object.assign(setupModals, {
    testDiscoveryWebhookFromSettings,
    handleAppsScriptBrowserCorsFailure,
    initDiscoverySetupGuide,
  });
})();
