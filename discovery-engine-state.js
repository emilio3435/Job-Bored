/* ============================================
   COMMAND CENTER v2 — Discovery Engine State
   Extracted from app.js (discovery-engine-state cut).

   Classic-global IIFE under window.JobBoredDiscovery.engineState — NOT an ES module.
   Loaded BEFORE app.js. Settings field getters, engine-state persistence,
   webhook identity normalization, and effective discovery engine status.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const engineState = root.engineState || (root.engineState = {});

  function host() {
    return engineState.host;
  }

  function configCore() {
    return window.JobBoredApp.configCore;
  }

  function getSettingsFieldValue(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || "") : "";
  }

  function getSettingsSheetIdValue() {
    const el = document.getElementById("settingsSheetId");
    const raw = el
      ? String(el.value || "")
      : String((window.COMMAND_CENTER_CONFIG || {}).sheetId || "");
    return host().parseGoogleSheetId(raw.trim());
  }

  function getSettingsOAuthClientIdValue() {
    const el = document.getElementById("settingsOAuthClientId");
    const raw = el
      ? String(el.value || "")
      : String((window.COMMAND_CENTER_CONFIG || {}).oauthClientId || "");
    const id = raw.trim();
    if (!id || id === "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com") {
      return "";
    }
    return id;
  }

  function hasUnsavedOAuthClientIdChange(candidateId) {
    const nextId =
      candidateId != null
        ? String(candidateId || "").trim()
        : getSettingsOAuthClientIdValue();
    const activeId = String(host().getOAuthClientId() || "").trim();
    return !!nextId && nextId !== activeId;
  }

  function getDiscoveryEngineStateStore() {
    const UC = window.CommandCenterUserContent;
    return UC &&
      typeof UC.getDiscoveryEngineState === "function" &&
      typeof UC.saveDiscoveryEngineState === "function"
      ? UC
      : null;
  }

  function normalizeDiscoveryWebhookIdentity(raw) {
    const s = raw != null ? String(raw).trim() : "";
    if (!s) return "";
    try {
      const url = new URL(s);
      url.hash = "";
      if (url.pathname !== "/") {
        url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      }
      return url.toString();
    } catch (_) {
      return s.replace(/\/+$/, "");
    }
  }

  function getDiscoveryWebhookUrlForSettingsPreview() {
    const field = document.getElementById("settingsDiscoveryWebhookUrl");
    if (field) {
      return String(field.value || "").trim();
    }
    return host().getDiscoveryWebhookUrl();
  }

  function getManagedAppsScriptWebhookIdentity() {
    const core = configCore();
    if (
      !core.appsScriptDeployStateCache ||
      typeof core.appsScriptDeployStateCache.webAppUrl !== "string"
    ) {
      return "";
    }
    return normalizeDiscoveryWebhookIdentity(
      core.appsScriptDeployStateCache.webAppUrl,
    );
  }

  function getSavedDiscoveryEngineStateForUrl(rawUrl) {
    const core = configCore();
    const target = normalizeDiscoveryWebhookIdentity(rawUrl);
    if (!target) return null;
    const saved =
      core.discoveryEngineStateCache &&
      typeof core.discoveryEngineStateCache === "object" &&
      typeof core.discoveryEngineStateCache.state === "string"
        ? core.discoveryEngineStateCache
        : null;
    if (!saved) return null;
    const savedUrl = normalizeDiscoveryWebhookIdentity(saved.webhookUrl);
    if (!savedUrl || savedUrl !== target) return null;
    return saved;
  }

  function getEffectiveDiscoveryEngineStatus(rawUrl) {
    const core = configCore();
    const hook = normalizeDiscoveryWebhookIdentity(rawUrl);
    if (!hook) {
      return {
        state: core.DISCOVERY_ENGINE_STATE_NONE,
        tone: "info",
        label: "No discovery webhook configured",
        detail:
          "Pipeline still works without a webhook. Add a real discovery endpoint only if you want the Run discovery button.",
      };
    }

    const saved = getSavedDiscoveryEngineStateForUrl(hook);
    if (saved && saved.state === core.DISCOVERY_ENGINE_STATE_CONNECTED) {
      return {
        state: core.DISCOVERY_ENGINE_STATE_CONNECTED,
        tone: "success",
        label: "Discovery endpoint connected",
        detail:
          "Run discovery will POST to your endpoint so your automation can add or update Pipeline rows.",
      };
    }

    if (saved && saved.state === core.DISCOVERY_ENGINE_STATE_STUB_ONLY) {
      return {
        state: core.DISCOVERY_ENGINE_STATE_STUB_ONLY,
        tone: "warning",
        label: "Webhook stub connected",
        detail:
          "This endpoint only verifies wiring or appends a [CC test] row. It does not add real job leads.",
      };
    }

    const managedAppsScriptUrl = getManagedAppsScriptWebhookIdentity();
    if (managedAppsScriptUrl && managedAppsScriptUrl === hook) {
      return {
        state: core.DISCOVERY_ENGINE_STATE_STUB_ONLY,
        tone: "warning",
        label: "Managed Apps Script stub connected",
        detail:
          "The dashboard-deployed Apps Script endpoint is a stub for webhook verification only. Connect a real discovery engine before using Run discovery.",
      };
    }

    return {
      state: core.DISCOVERY_ENGINE_STATE_UNVERIFIED,
      tone: "info",
      label: "Custom discovery endpoint configured",
      detail:
        "This app can POST to the URL, but it cannot prove the endpoint writes Pipeline rows yet. Make sure it is a real discovery engine, not the default stub.",
    };
  }

  function buildDiscoveryStatusActions(status) {
    const core = configCore();
    switch (status.state) {
      case core.DISCOVERY_ENGINE_STATE_STUB_ONLY:
        return [
          {
            label: "Open real discovery paths",
            href: "docs/DISCOVERY-PATHS.md",
            primary: true,
          },
          {
            label: "Open agent discovery guide",
            href: "integrations/openclaw-command-center/README.md",
          },
          {
            label: "Apps Script stub walkthrough",
            href: "integrations/apps-script/WALKTHROUGH.md",
          },
        ];
      case core.DISCOVERY_ENGINE_STATE_UNVERIFIED:
        return [
          {
            label: "Open AGENT_CONTRACT",
            href: "AGENT_CONTRACT.md",
            primary: true,
          },
          {
            label: "Open discovery paths",
            href: "docs/DISCOVERY-PATHS.md",
          },
        ];
      case core.DISCOVERY_ENGINE_STATE_CONNECTED:
        return [
          {
            label: "Open AGENT_CONTRACT",
            href: "AGENT_CONTRACT.md",
            primary: true,
          },
          {
            label: "Open discovery paths",
            href: "docs/DISCOVERY-PATHS.md",
          },
        ];
      default:
        return [
          {
            label: "Open discovery paths",
            href: "docs/DISCOVERY-PATHS.md",
            primary: true,
          },
          {
            label: "Open agent discovery guide",
            href: "integrations/openclaw-command-center/README.md",
          },
        ];
    }
  }

  async function saveDiscoveryEngineStatePatch(patch) {
    const core = configCore();
    const store = getDiscoveryEngineStateStore();
    const next =
      patch && typeof patch === "object"
        ? patch
        : { state: core.DISCOVERY_ENGINE_STATE_NONE };
    if (!store) {
      core.discoveryEngineStateCache = next;
      host().refreshDiscoveryUiState();
      void host().refreshDiscoveryReadinessSnapshot({ force: true });
      return next;
    }
    try {
      core.discoveryEngineStateCache = await store.saveDiscoveryEngineState(next);
    } catch (err) {
      console.warn("[JobBored] discovery engine state:", err);
      core.discoveryEngineStateCache = next;
    }
    host().refreshDiscoveryUiState();
    void host().refreshDiscoveryReadinessSnapshot({ force: true });
    return core.discoveryEngineStateCache;
  }

  async function recordDiscoveryEngineState(rawUrl, state, source) {
    const core = configCore();
    const normalizedUrl = normalizeDiscoveryWebhookIdentity(rawUrl);
    if (!normalizedUrl) {
      return saveDiscoveryEngineStatePatch({
        state: core.DISCOVERY_ENGINE_STATE_NONE,
        webhookUrl: "",
        source: source || "",
        lastCheckedAt: new Date().toISOString(),
      });
    }
    return saveDiscoveryEngineStatePatch({
      state,
      webhookUrl: normalizedUrl,
      source: source || "",
      lastCheckedAt: new Date().toISOString(),
    });
  }

  async function preloadDiscoveryEngineState() {
    const core = configCore();
    const store = getDiscoveryEngineStateStore();
    if (!store) return;
    try {
      core.discoveryEngineStateCache = await store.getDiscoveryEngineState();
    } catch (err) {
      console.warn("[JobBored] discovery engine state preload:", err);
    }
  }

  function getDiscoveryEngineStateFromVerificationResult(result) {
    const core = configCore();
    if (!result || result.ok !== true) return "";
    if (result.kind === "stub_only") return core.DISCOVERY_ENGINE_STATE_STUB_ONLY;
    if (result.kind === "accepted_async") {
      return core.DISCOVERY_ENGINE_STATE_UNVERIFIED;
    }
    if (result.kind === "connected_ok") {
      return core.DISCOVERY_ENGINE_STATE_CONNECTED;
    }
    return result.engineState || core.DISCOVERY_ENGINE_STATE_UNVERIFIED;
  }

  Object.assign(engineState, {
    getSettingsFieldValue,
    getSettingsSheetIdValue,
    getSettingsOAuthClientIdValue,
    hasUnsavedOAuthClientIdChange,
    getDiscoveryEngineStateStore,
    normalizeDiscoveryWebhookIdentity,
    getDiscoveryWebhookUrlForSettingsPreview,
    getManagedAppsScriptWebhookIdentity,
    getSavedDiscoveryEngineStateForUrl,
    getEffectiveDiscoveryEngineStatus,
    buildDiscoveryStatusActions,
    saveDiscoveryEngineStatePatch,
    recordDiscoveryEngineState,
    preloadDiscoveryEngineState,
    getDiscoveryEngineStateFromVerificationResult,
  });
})();
