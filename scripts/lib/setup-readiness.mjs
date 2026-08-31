// Isolated F2-C setup/readiness helpers. Pure functions for tests and Node
// installers. Browser fence files mirror the same contracts inline because
// index.html is owned by another lane.

export const SETTINGS_FIELD_IDS = Object.freeze({
  sheetId: "settingsSheetId",
  oauthClientId: "settingsOAuthClientId",
  title: "settingsTitle",
  discoveryWebhookUrl: "settingsDiscoveryWebhookUrl",
  discoveryWebhookSecret: "settingsDiscoveryWebhookSecret",
  jobPostingScrapeUrl: "settingsJobPostingScrapeUrl",
  atsScoringMode: "settingsAtsScoringMode",
  atsScoringServerUrl: "settingsAtsScoringServerUrl",
  atsScoringWebhookUrl: "settingsAtsScoringWebhookUrl",
  resumeGeminiApiKey: "settingsResumeGeminiApiKey",
  resumeGeminiModel: "settingsResumeGeminiModel",
  resumeOpenAIApiKey: "settingsResumeOpenAIApiKey",
  resumeOpenAIModel: "settingsResumeOpenAIModel",
  resumeAnthropicApiKey: "settingsResumeAnthropicApiKey",
  resumeAnthropicModel: "settingsResumeAnthropicModel",
  resumeOpenRouterApiKey: "settingsResumeOpenRouterApiKey",
  resumeOpenRouterModel: "settingsResumeOpenRouterModel",
  resumeLocalBaseUrl: "settingsResumeLocalBaseUrl",
  resumeLocalModel: "settingsResumeLocalModel",
  resumeLocalApiKey: "settingsResumeLocalApiKey",
  resumeGenerationWebhookUrl: "settingsResumeGenerationWebhookUrl",
});

/**
 * F2C-SETUP01-PRESERVE: drop keys whose form fields are absent so a Settings
 * save cannot serialize missing discovery URL/secret as empty.
 */
export function omitAbsentSettingsFields(
  payload,
  { presentIds, fieldIdByKey } = {},
) {
  const ids = presentIds instanceof Set ? presentIds : new Set(presentIds || []);
  const map = fieldIdByKey || SETTINGS_FIELD_IDS;
  const src = payload && typeof payload === "object" ? payload : {};
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    const id = map[key];
    if (id && !ids.has(id)) continue;
    out[key] = value;
  }
  return out;
}

export function isSettingsOwnedField(el, settingsRoot) {
  if (!el) return false;
  if (!settingsRoot || typeof settingsRoot.contains !== "function") return false;
  return settingsRoot.contains(el);
}

/** F2C-SETUP02-BIND: schedule/automation binders must not require a removed run button. */
export function shouldBindAutomationControls({
  runBtnPresent,
  hasScheduleControls,
} = {}) {
  return !!(runBtnPresent || hasScheduleControls);
}

/** F2C-SETUP03-READY: unverified/partial/recovery are never green "ready". */
export function classifyDiscoveryReadiness({
  state,
  recovery,
  kind,
} = {}) {
  if (recovery && recovery !== "ok") {
    return {
      tone: "warning",
      chipLabel: "Needs recovery",
      chipTone: "warning",
      runDiscoveryEnabled: false,
    };
  }
  if (state === "connected") {
    return {
      tone: "success",
      chipLabel: "Connected",
      chipTone: "success",
      runDiscoveryEnabled: true,
    };
  }
  if (
    state === "unverified" ||
    kind === "worker" ||
    kind === "generic_https"
  ) {
    return {
      tone: "warning",
      chipLabel: "Ready to test",
      chipTone: "warning",
      runDiscoveryEnabled: false,
    };
  }
  return {
    tone: "info",
    chipLabel: "No webhook",
    chipTone: "info",
    runDiscoveryEnabled: false,
  };
}

/** F2C-SETUP04-CONSENT: opening setup always renders review; never silent-install. */
export function planDiscoverySetupOpen({ hasKeepAliveConsent } = {}) {
  return {
    renderReview: true,
    silentInstallKeepAlive: false,
    installKeepAlive: hasKeepAliveConsent === true,
  };
}

/** F2C-SETUP07-SHEETONLY: AI/discovery are not hard first-run gates. */
export function firstRunFinishAllowed({ signedIn, sheetConnected } = {}) {
  return !!(signedIn && sheetConnected);
}

/** F2C-SETUP08-BACK: keep any supported provider through rerender/back. */
export function preserveProviderSelection(provider, supported) {
  const value = String(provider || "").toLowerCase();
  const set = supported instanceof Set ? supported : new Set(supported || []);
  return set.has(value) ? value : "";
}

/**
 * F2C-SETUP09-ACTIVE: installed means active backend identity + last success,
 * not file existence.
 */
export function classifyInstallStatus({
  artifactExists,
  backendIdentityMatches,
  lastSuccessAt,
  activationOk,
} = {}) {
  return {
    installed: !!(activationOk && backendIdentityMatches && lastSuccessAt),
    artifactPresent: !!artifactExists,
  };
}

/** F2C-P2-SCOPE: default reset masks config only. */
export function previewDestructiveReset({
  credentialKeys = [],
  includeResumes = false,
  includeDrafts = false,
  includeOAuth = false,
  includeConsent = false,
} = {}) {
  const writes = credentialKeys.map((key) => ({
    store: "config_overrides",
    key,
    value: "",
  }));
  const deletes = [];
  if (includeResumes || includeDrafts) {
    deletes.push({ store: "indexeddb", key: "command-center-user-content" });
  }
  if (includeOAuth) {
    deletes.push({ store: "localStorage", key: "command_center_oauth_session" });
  }
  if (includeConsent) {
    writes.push({
      store: "localStorage",
      key: "command_center_force_consent_prompt",
      value: "1",
    });
  }
  return {
    writes,
    deletes,
    includesResumes: !!includeResumes,
    includesDrafts: !!includeDrafts,
    includesOAuth: !!includeOAuth,
    includesConsent: !!includeConsent,
  };
}

export function requiresExplicitConsent(actionId) {
  return (
    actionId === "keep_alive_not_installed" ||
    actionId === "keep_alive_stale" ||
    actionId === "schedule_install" ||
    actionId === "destructive_reset"
  );
}
