/* ============================================
   COMMAND CENTER v2 — Discovery Readiness
   Extracted from app.js (discovery-readiness cut).

   Classic-global IIFE under window.JobBoredDiscovery.readiness — NOT an ES module.
   Loaded BEFORE app.js (after discovery-engine-state.js).
   Readiness snapshot cache, fallback views, transport probes, wizard runtime,
   webhook payload browser assembly, and verification helpers.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const readiness = root.readiness || (root.readiness = {});

  function host() {
    return readiness.host || {};
  }

  function h(name) {
    const fn = host()[name];
    return typeof fn === "function" ? fn : () => undefined;
  }

  function cc() {
    return window.JobBoredApp.configCore;
  }

  function es() {
    return window.JobBoredDiscovery.engineState;
  }

function refreshDiscoveryUiState() {
  h("syncDiscoveryButtonState")();
  h("renderDiscoveryEngineStatusUi")();
  if (cc().discoveryWizardRuntime) {
    updateDiscoveryWizardRuntime({
      snapshot: getDiscoveryReadinessSnapshot(),
    });
    void h("renderDiscoverySetupWizard")();
  }
  if (!h("getDashboardDataHydrated")()) return;
  if (document.getElementById("briefInsights")) {
    h("renderPipelineDailyBrief")();
  }
  if (document.getElementById("jobCards")) {
    h("renderPipeline")();
  }
}
function inferLocalWebhookPort(raw) {
  const normalized = h("normalizeDiscoveryLocalWebhookUrl")(raw);
  if (!normalized) return "8644";
  try {
    const url = new URL(normalized);
    if (url.port) return url.port;
    return url.protocol === "https:" ? "443" : "80";
  } catch (_) {
    return "8644";
  }
}

function buildDiscoveryTunnelTargetUrl(localWebhookUrl, tunnelPublicUrl) {
  const local = h("normalizeDiscoveryLocalWebhookUrl")(localWebhookUrl);
  const tunnel = h("normalizeDiscoveryTunnelPublicUrl")(tunnelPublicUrl);
  if (!local || !tunnel) return "";
  try {
    const localUrl = new URL(local);
    const tunnelUrl = new URL(tunnel);
    if (/\/webhooks\/[^/]+/i.test(tunnelUrl.pathname)) {
      tunnelUrl.search = "";
      tunnelUrl.hash = "";
      return tunnelUrl.toString();
    }
    tunnelUrl.pathname = localUrl.pathname || "/";
    tunnelUrl.search = "";
    tunnelUrl.hash = "";
    return tunnelUrl.toString();
  } catch (_) {
    return "";
  }
}

function getDiscoveryLocalWebhookHealthUrl(localWebhookUrl) {
  const local = h("normalizeDiscoveryLocalWebhookUrl")(localWebhookUrl);
  if (!local) return "";
  try {
    const url = new URL(local);
    url.pathname = "/health";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function getCloudflareRelayTargetInfo() {
  const currentWebhookUrl =
    es().getSettingsFieldValue("settingsDiscoveryWebhookUrl").trim() ||
    h("getDiscoveryWebhookUrl")();
  const transportSetup = h("getDiscoveryTransportSetupState")();
  const localTunnelTargetUrl = buildDiscoveryTunnelTargetUrl(
    transportSetup.localWebhookUrl,
    transportSetup.tunnelPublicUrl,
  );
  const managedWebAppUrl =
    h("isAppsScriptPublicAccessReady")(cc().appsScriptDeployStateCache) &&
    cc().appsScriptDeployStateCache &&
    typeof cc().appsScriptDeployStateCache.webAppUrl === "string"
      ? cc().appsScriptDeployStateCache.webAppUrl.trim()
      : "";

  if (h("isLikelyAppsScriptWebAppUrl")(currentWebhookUrl)) {
    return { url: currentWebhookUrl, source: "settings" };
  }
  if (h("isLikelyCloudflareWorkerUrl")(currentWebhookUrl) && localTunnelTargetUrl) {
    return {
      url: localTunnelTargetUrl,
      source: "local_tunnel",
      localWebhookUrl: transportSetup.localWebhookUrl,
      tunnelPublicUrl: transportSetup.tunnelPublicUrl,
    };
  }
  if (currentWebhookUrl && !h("isLikelyCloudflareWorkerUrl")(currentWebhookUrl)) {
    return { url: currentWebhookUrl, source: "settings" };
  }
  if (localTunnelTargetUrl) {
    return {
      url: localTunnelTargetUrl,
      source: "local_tunnel",
      localWebhookUrl: transportSetup.localWebhookUrl,
      tunnelPublicUrl: transportSetup.tunnelPublicUrl,
    };
  }
  if (h("isLikelyAppsScriptWebAppUrl")(managedWebAppUrl)) {
    return { url: managedWebAppUrl, source: "managed" };
  }
  if (currentWebhookUrl) return { url: currentWebhookUrl, source: "settings" };
  if (managedWebAppUrl) return { url: managedWebAppUrl, source: "managed" };
  return { url: "", source: "" };
}

function getDiscoveryWizardRoot() {
  return window.JobBoredDiscoveryWizard || null;
}

function getDiscoveryWizardShellApi() {
  const root = getDiscoveryWizardRoot();
  return root && root.shell ? root.shell : null;
}

function getDiscoveryWizardProbesApi() {
  const root = getDiscoveryWizardRoot();
  return root && root.probes ? root.probes : null;
}

function getDiscoveryWizardLocalApi() {
  const root = getDiscoveryWizardRoot();
  const backup =
    typeof window !== "undefined" ? window.__JobBoredDiscoveryLocalApi : null;
  if (backup && typeof backup.runLocalWizardAction === "function") {
    if (root) {
      root.local = backup;
    }
    return backup;
  }
  if (
    root &&
    root.local &&
    typeof root.local.runLocalWizardAction === "function"
  ) {
    return root.local;
  }
  return null;
}

function getDiscoveryWizardRelayApi() {
  const root = getDiscoveryWizardRoot();
  return root && root.relay ? root.relay : null;
}

function getDiscoveryWizardVerifyApi() {
  const root = getDiscoveryWizardRoot();
  return root && root.verify ? root.verify : null;
}

function mapDiscoveryWizardFlow(rawFlow) {
  const flow = String(rawFlow || "").trim();
  if (flow === "existing_endpoint" || flow === "external_endpoint") {
    return "external_endpoint";
  }
  if (flow === "no_webhook") return "no_webhook";
  if (flow === "stub_only") return "stub_only";
  return "local_agent";
}

function getFallbackAppsScriptState() {
  if (!cc().appsScriptDeployStateCache) return "none";
  if (
    h("isManagedAppsScriptDeployState")(cc().appsScriptDeployStateCache) &&
    h("isAppsScriptPublicAccessReady")(cc().appsScriptDeployStateCache)
  ) {
    return "stub_only";
  }
  return h("isManagedAppsScriptDeployState")(cc().appsScriptDeployStateCache)
    ? "unverified"
    : "none";
}

function classifySavedWebhookKindForFallback(rawUrl) {
  const probes = getDiscoveryWizardProbesApi();
  if (probes && typeof probes.classifySavedWebhookKind === "function") {
    return probes.classifySavedWebhookKind(rawUrl);
  }
  const url = es().normalizeDiscoveryWebhookIdentity(rawUrl);
  if (!url) return "none";
  if (
    h("normalizeDiscoveryLocalWebhookUrl")(url) &&
    /^https?:\/\//i.test(h("normalizeDiscoveryLocalWebhookUrl")(url))
  ) {
    return "local_http";
  }
  if (h("isLikelyAppsScriptWebAppUrl")(url)) return "apps_script_stub";
  if (h("isLikelyCloudflareWorkerUrl")(url)) return "worker";
  return /^https?:\/\//i.test(url) ? "generic_https" : "none";
}

function getDiscoveryLocalEngineKind(snapshot) {
  const state = snapshot && typeof snapshot === "object" ? snapshot : {};
  const explicit = String(state.localEngineKind || "")
    .trim()
    .toLowerCase();
  if (explicit === "browser_use_worker") return "browser_use_worker";
  if (explicit === "hermes") return "hermes";
  if (explicit === "other") return "other";

  const localWebhookUrl = h("normalizeDiscoveryLocalWebhookUrl")(
    state.localWebhookUrl || "",
  );
  if (/\/webhook\/?$/i.test(localWebhookUrl)) return "browser_use_worker";
  if (/\/webhooks\/[^/]+/i.test(localWebhookUrl)) return "hermes";
  return localWebhookUrl ? "other" : "none";
}

function getDiscoveryLocalEngineLabel(snapshot) {
  const kind = getDiscoveryLocalEngineKind(snapshot);
  if (kind === "browser_use_worker") return "Browser-use worker";
  if (kind === "hermes") return "Hermes route";
  if (kind === "other") return "Local discovery service";
  return "";
}

function getDiscoveryLocalEngineSummary(snapshot) {
  const state = snapshot && typeof snapshot === "object" ? snapshot : {};
  const label = getDiscoveryLocalEngineLabel(state);
  if (!label) return "not confirmed";
  if (state.localWebhookUrl) return `${label} (${state.localWebhookUrl})`;
  return label;
}

function getDiscoveryRecoveryCopy(snapshot) {
  const probesApi =
    window.JobBoredDiscoveryWizard && window.JobBoredDiscoveryWizard.probes;
  if (probesApi && typeof probesApi.buildRecoveryCopy === "function") {
    return probesApi.buildRecoveryCopy(snapshot);
  }
  const recovery = String((snapshot && snapshot.localRecoveryState) || "ok");
  const detailMap = {
    needs_full_restart:
      "Your computer restarted, so the local worker and tunnel need to be brought back up.",
    worker_down:
      "The local discovery worker is not responding. It may need to be restarted.",
    tunnel_down:
      "The public ngrok tunnel is not running, so the saved Worker URL cannot reach your local worker right now.",
    tunnel_rotated:
      "ngrok gave your local setup a new public URL, so the relay behind your saved Worker URL needs to be redeployed.",
  };
  const detail =
    detailMap[recovery] ||
    "Part of the local discovery chain is down after a restart.";
  return {
    title:
      recovery === "tunnel_rotated"
        ? "Public tunnel changed"
        : "Local setup needs recovery",
    detail,
    compactDetail: detail,
    actionHint:
      "Click Fix setup to restart what is down and redeploy the relay if needed.",
    detectBody: [detail],
  };
}

function buildFallbackSettingsDiscoveryView(snapshot) {
  const status = es().getEffectiveDiscoveryEngineStatus(snapshot.savedWebhookUrl);
  const kind = String(snapshot.savedWebhookKind || "none");
  const appsScriptState = String(snapshot.appsScriptState || "none");
  const recovery = snapshot.localRecoveryState || "ok";
  const recoveryCopy = getDiscoveryRecoveryCopy(snapshot);
  const hasSavedExternalEndpoint =
    kind === "worker" || kind === "generic_https";
  const stubCurrent =
    status.state === cc().DISCOVERY_ENGINE_STATE_STUB_ONLY ||
    kind === "apps_script_stub";

  if (
    recovery !== "ok" &&
    (status.state === cc().DISCOVERY_ENGINE_STATE_CONNECTED ||
      hasSavedExternalEndpoint)
  ) {
    return {
      tone: "warning",
      title: recoveryCopy.title,
      detail: recoveryCopy.compactDetail,
      chipLabel: "Needs recovery",
      chipTone: "warning",
      runDiscoveryEnabled: false,
      primaryActionLabel: "Fix setup",
      primaryActionHint: recoveryCopy.actionHint,
    };
  }

  if (
    status.state === cc().DISCOVERY_ENGINE_STATE_CONNECTED ||
    status.state === cc().DISCOVERY_ENGINE_STATE_UNVERIFIED ||
    hasSavedExternalEndpoint
  ) {
    const verified = status.state === cc().DISCOVERY_ENGINE_STATE_CONNECTED;
    return {
      tone: verified ? "success" : "warning",
      title: verified ? "Discovery is connected" : "Discovery endpoint saved",
      detail: verified
        ? "Run discovery will POST to the public endpoint already saved in JobBored."
        : "A public webhook is already saved. Test it if you changed the service.",
      chipLabel: verified ? "Connected" : "Ready to test",
      chipTone: verified ? "success" : "warning",
      runDiscoveryEnabled: true,
      primaryActionLabel: "Open discovery setup",
      primaryActionHint:
        "Use the wizard to review or change your discovery path.",
    };
  }

  if (kind === "local_http") {
    const engineLabel = getDiscoveryLocalEngineLabel(snapshot);
    return {
      tone: "info",
      title: engineLabel
        ? `${engineLabel} detected`
        : "Local receiver detected",
      detail: engineLabel
        ? `Complete the local server, tunnel, and relay steps to finish setup for ${engineLabel}.`
        : "Complete the server, tunnel, and relay steps to finish setup.",
      chipLabel: "Local path",
      chipTone: "info",
      runDiscoveryEnabled: false,
      primaryActionLabel: "Open discovery setup",
      primaryActionHint: "Continue the local setup path.",
    };
  }

  if (stubCurrent || appsScriptState === "stub_only") {
    return {
      tone: "warning",
      title: "Apps Script stub wired",
      detail:
        "This path can smoke-test webhook wiring, but it is not your real discovery engine.",
      chipLabel: "Stub only",
      chipTone: "warning",
      runDiscoveryEnabled: false,
      primaryActionLabel: "Open discovery setup",
      primaryActionHint: "Switch to a real webhook if you want Run discovery.",
    };
  }

  return {
    tone: "info",
    title: "No discovery webhook configured",
    detail:
      "Pipeline works without discovery. Use the wizard only if you want automated runs.",
    chipLabel: "No webhook",
    chipTone: "info",
    runDiscoveryEnabled: false,
    primaryActionLabel: "Open discovery setup",
    primaryActionHint:
      "Use the wizard to review or change your discovery path.",
  };
}

function buildFallbackEmptyStateDiscoveryView(snapshot) {
  const status = es().getEffectiveDiscoveryEngineStatus(snapshot.savedWebhookUrl);
  const kind = String(snapshot.savedWebhookKind || "none");
  const appsScriptState = String(snapshot.appsScriptState || "none");
  const recovery = snapshot.localRecoveryState || "ok";
  const recoveryCopy = getDiscoveryRecoveryCopy(snapshot);
  const hasSavedExternalEndpoint =
    kind === "worker" || kind === "generic_https";
  const stubCurrent =
    status.state === cc().DISCOVERY_ENGINE_STATE_STUB_ONLY ||
    kind === "apps_script_stub";

  if (
    recovery !== "ok" &&
    (status.state === cc().DISCOVERY_ENGINE_STATE_CONNECTED ||
      hasSavedExternalEndpoint)
  ) {
    return {
      title: recoveryCopy.title,
      body: `${recoveryCopy.compactDetail} Use Fix setup to recover it.`,
      ctaLabel: "Fix setup",
      ctaAction: "open_setup",
    };
  }

  if (status.state === cc().DISCOVERY_ENGINE_STATE_CONNECTED) {
    return {
      title: "Pipeline is ready",
      body: "No roles yet. When your automation runs, new rows will appear here. You can also run discovery on demand.",
      ctaLabel: "Run discovery now",
      ctaAction: "run_discovery",
    };
  }
  if (
    status.state === cc().DISCOVERY_ENGINE_STATE_UNVERIFIED ||
    hasSavedExternalEndpoint
  ) {
    return {
      title: "Endpoint saved, verification pending",
      body: "A public webhook is already saved, but JobBored has not confirmed the full end-to-end path yet.",
      ctaLabel: "Open discovery setup",
      ctaAction: "open_setup",
    };
  }
  if (kind === "local_http") {
    const engineLabel = getDiscoveryLocalEngineLabel(snapshot);
    return {
      title: engineLabel
        ? `${engineLabel} not finished`
        : "Local discovery path not finished",
      body: engineLabel
        ? `${engineLabel} is known, but the public tunnel or Worker URL still needs to be finished.`
        : "Your local receiver is known, but the public tunnel or Worker URL still needs to be finished.",
      ctaLabel: "Continue setup",
      ctaAction: "open_setup",
    };
  }
  if (stubCurrent || appsScriptState === "stub_only") {
    return {
      title: "Stub-only wiring detected",
      body: "The current webhook confirms wiring only. Connect a real discovery engine before expecting new job leads.",
      ctaLabel: "Connect real discovery",
      ctaAction: "open_setup",
    };
  }
  return {
    title: "Pipeline is empty",
    body: "Pipeline works without discovery, but you can use the wizard if you want Run discovery or guided setup.",
    ctaLabel: "Open discovery setup",
    ctaAction: "open_setup",
  };
}

function buildFallbackReadinessSnapshot() {
  const transport = h("getDiscoveryTransportSetupState")();
  const savedWebhookUrl = es().normalizeDiscoveryWebhookIdentity(
    h("getDiscoveryWebhookUrl")(),
  );
  const savedWebhookKind = classifySavedWebhookKindForFallback(savedWebhookUrl);
  const relayTargetUrl = buildDiscoveryTunnelTargetUrl(
    transport.localWebhookUrl,
    transport.tunnelPublicUrl,
  );
  const engineStatus = es().getEffectiveDiscoveryEngineStatus(savedWebhookUrl);
  const appsScriptState = getFallbackAppsScriptState();
  const hasSavedExternalEndpoint =
    savedWebhookKind === "worker" || savedWebhookKind === "generic_https";
  const hasSavedStubEndpoint = savedWebhookKind === "apps_script_stub";
  const hasLocalPathSignals =
    savedWebhookKind === "local_http" ||
    !!transport.localWebhookUrl ||
    !!transport.tunnelPublicUrl;
  let recommendedFlow = "local_agent";
  let recommendedReason =
    "No public webhook is saved yet, so start with the path you want to use.";
  if (
    hasSavedExternalEndpoint ||
    engineStatus.state === cc().DISCOVERY_ENGINE_STATE_CONNECTED
  ) {
    recommendedFlow = "existing_endpoint";
    recommendedReason =
      savedWebhookKind === "worker"
        ? "A Cloudflare Worker URL is already saved."
        : "A public HTTPS webhook is already saved.";
  } else if (hasLocalPathSignals) {
    recommendedFlow = "local_agent";
    recommendedReason =
      getDiscoveryLocalEngineKind({
        localWebhookUrl: transport.localWebhookUrl || "",
      }) === "hermes"
        ? "A local Hermes route was detected on this machine. It can work, but the browser-use worker is the recommended default."
        : "A local browser-use worker or local discovery path was detected on this machine.";
  } else if (hasSavedStubEndpoint) {
    recommendedFlow = "stub_only";
    recommendedReason =
      "Only the Apps Script stub is saved — good for testing.";
  } else if (appsScriptState === "stub_only") {
    recommendedFlow = "local_agent";
    recommendedReason =
      "An Apps Script stub exists, but it's not your main discovery path.";
  }
  const snapshot = {
    sheetConfigured: !!h("getSHEET_ID")(),
    savedWebhookUrl,
    savedWebhookKind,
    localBootstrapAvailable: false,
    localWebhookUrl: transport.localWebhookUrl || "",
    localWebhookReady: false,
    tunnelPublicUrl: transport.tunnelPublicUrl || "",
    tunnelLive: false,
    tunnelReady: false,
    tunnelStale: false,
    relayTargetUrl,
    relayReady: savedWebhookKind === "worker",
    engineState: engineStatus.state,
    appsScriptState,
    recommendedFlow,
    recommendedReason,
    blockingIssue: !h("getSHEET_ID")()
      ? "missing_sheet"
      : hasSavedStubEndpoint
        ? "stub_only"
        : "",
    localRecoveryState:
      !(hasSavedExternalEndpoint && !h("isLocalDashboardOrigin")()) &&
      (hasLocalPathSignals ||
        (savedWebhookKind === "worker" && h("isLocalDashboardOrigin")()))
        ? "needs_full_restart"
        : "ok",
  };
  return {
    ...snapshot,
    views: {
      settings: buildFallbackSettingsDiscoveryView(snapshot),
      emptyState: buildFallbackEmptyStateDiscoveryView(snapshot),
    },
    wizardState: null,
  };
}

function getDiscoveryReadinessSnapshot() {
  return cc().discoveryReadinessSnapshotCache || buildFallbackReadinessSnapshot();
}

function getDiscoverySettingsView(snapshot) {
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  if (
    state.views &&
    state.views.settings &&
    typeof state.views.settings === "object"
  ) {
    return state.views.settings;
  }
  const probes = getDiscoveryWizardProbesApi();
  if (probes && typeof probes.buildSettingsDiscoveryView === "function") {
    return probes.buildSettingsDiscoveryView(state);
  }
  return buildFallbackSettingsDiscoveryView(state);
}

function getDiscoveryEmptyStateView(snapshot) {
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  if (
    state.views &&
    state.views.emptyState &&
    typeof state.views.emptyState === "object"
  ) {
    return state.views.emptyState;
  }
  const probes = getDiscoveryWizardProbesApi();
  if (probes && typeof probes.buildEmptyStateDiscoveryView === "function") {
    return probes.buildEmptyStateDiscoveryView(state);
  }
  return buildFallbackEmptyStateDiscoveryView(state);
}

async function refreshDiscoveryReadinessSnapshot(options = {}) {
  if (cc().discoveryReadinessSnapshotPromise && !options.force) {
    return cc().discoveryReadinessSnapshotPromise;
  }
  const buildFallback = () => buildFallbackReadinessSnapshot();
  const probes = getDiscoveryWizardProbesApi();
  cc().discoveryReadinessSnapshotPromise = Promise.resolve()
    .then(async () => {
      if (probes && typeof probes.buildReadinessSnapshot === "function") {
        return probes.buildReadinessSnapshot();
      }
      return buildFallback();
    })
    .then((snapshot) => {
      cc().discoveryReadinessSnapshotCache =
        snapshot && typeof snapshot === "object" ? snapshot : buildFallback();
      return cc().discoveryReadinessSnapshotCache;
    })
    .catch((err) => {
      console.warn("[JobBored] discovery readiness snapshot:", err);
      cc().discoveryReadinessSnapshotCache = buildFallback();
      return cc().discoveryReadinessSnapshotCache;
    })
    .finally(() => {
      cc().discoveryReadinessSnapshotPromise = null;
    });
  const next = await cc().discoveryReadinessSnapshotPromise;
  if (options.rerender !== false) {
    refreshDiscoveryUiState();
  }
  return next;
}

function readDiscoveryScheduleStateForPayload(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return {};
    return {
      enabled: parsed.enabled === true,
      hour: Number.isInteger(parsed.hour) ? parsed.hour : undefined,
      minute: Number.isInteger(parsed.minute) ? parsed.minute : undefined,
    };
  } catch (_) {
    return {};
  }
}

function readDiscoveryScheduleContextForPayload() {
  return {
    local: readDiscoveryScheduleStateForPayload("settings_profile_schedule_local"),
    github: readDiscoveryScheduleStateForPayload("settings_profile_schedule_cloud"),
  };
}

async function buildDiscoveryWebhookPayload(sheetIdOverride, options) {
  const payloadOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  const trigger = String(payloadOptions.trigger || "manual").trim() || "manual";
  const resolvedSheetId =
    h("parseGoogleSheetId")(String(sheetIdOverride || "")) || h("getSHEET_ID")() || "";
  let discoveryProfile = {};
  let activeResume = null;
  let preferences = null;
  try {
    const UC = window.CommandCenterUserContent;
    if (UC && typeof UC.openDb === "function") {
      await UC.openDb();
    }
    if (UC) {
      if (typeof UC.getDiscoveryProfile === "function") {
        discoveryProfile = await UC.getDiscoveryProfile();
      }
      if (typeof UC.getActiveResume === "function") {
        activeResume = await UC.getActiveResume();
      }
      if (typeof UC.getPreferences === "function") {
        preferences = await UC.getPreferences();
      }
    }
  } catch (e) {
    console.warn("[JobBored] discovery profile:", e);
  }
  // Hand the user's existing GIS access token to the worker so it can write
  // to Google Sheets without holding any persistent credential of its own.
  // This is the "no hoops" path: if the user is signed in to the dashboard,
  // discovery just works — no service account, no .env wiring, no Hermes
  // archaeology. The worker treats this token as the highest-precedence
  // credential and falls back to its env config if it's absent or stale.
  // We declare the key unconditionally so JSON.stringify drops it when
  // empty (keeps the contract scanner happy and the wire format unchanged).
  const dashboardGoogleAccessToken =
    await getFreshDiscoveryRequestGoogleAccessToken();
  const requestedAt = new Date().toISOString();

  // ====== [discovery-autodetect lane: contract sanitization] ======
  // Per the discovery webhook contract, sourcePreset must either be omitted or
  // be one of the enum values. Fresh greenfield profiles can contain
  // sourcePreset:""; strip that key before the payload reaches the worker.
  if (
    discoveryProfile &&
    typeof discoveryProfile === "object" &&
    Object.prototype.hasOwnProperty.call(discoveryProfile, "sourcePreset")
  ) {
    const sp = discoveryProfile.sourcePreset;
    const trimmed = typeof sp === "string" ? sp.trim() : sp;
    if (trimmed === "" || trimmed == null || typeof trimmed !== "string") {
      const sanitized = { ...discoveryProfile };
      delete sanitized.sourcePreset;
      discoveryProfile = sanitized;
    } else if (trimmed !== sp) {
      discoveryProfile = { ...discoveryProfile, sourcePreset: trimmed };
    }
  }
  // ====== [/discovery-autodetect lane] ======

  // Compose `mergedUserProfile` — the run-time view of the master Fit Profile
  // with per-run drawer overrides applied. Tasks #3 and #6 consume this field;
  // the legacy `discoveryProfile` keeps working in parallel.
  const mergedUserProfile = buildMergedUserProfileForPayload();

  const sharedBuilder = window.JobBoredDiscoveryPayload;
  if (
    sharedBuilder &&
    typeof sharedBuilder.buildDiscoveryWebhookPayload === "function"
  ) {
    const built = sharedBuilder.buildDiscoveryWebhookPayload({
      sheetId: resolvedSheetId,
      discoveryProfile,
      resume: activeResume,
      preferences,
      schedule: readDiscoveryScheduleContextForPayload(),
      requestedAt,
      variationKey: payloadOptions.variationKey || h("generateDiscoveryVariationKey")(),
      trigger,
      googleAccessToken: dashboardGoogleAccessToken || "",
    });
    if (built && typeof built === "object") {
      built.mergedUserProfile = mergedUserProfile;
    }
    return built;
  }

  return {
    event: "command-center.discovery",
    schemaVersion: 1,
    sheetId: resolvedSheetId,
    variationKey: payloadOptions.variationKey || h("generateDiscoveryVariationKey")(),
    requestedAt,
    trigger,
    discoveryProfile,
    mergedUserProfile,
    googleAccessToken: dashboardGoogleAccessToken || undefined,
  };
}

/**
 * Deep-clone the loaded master Fit Profile and apply per-run drawer overrides.
 * Returns null when no master profile is loaded — Task #3/#6 consumers should
 * fall back to `discoveryProfile` in that case.
 */
function buildMergedUserProfileForPayload() {
  const baseProfile = window.JobBoredDiscovery.drawer.getDiscoveryRunProfileState().baseProfile;
  if (!baseProfile) return null;
  const merged = JSON.parse(JSON.stringify(baseProfile));
  const eff = h("getEffectiveFitProfileFields")();
  if (!eff) return merged;
  merged.identity = merged.identity || {};
  merged.hardConstraints = merged.hardConstraints || {};
  if (eff.targetRoles) merged.identity.targetRoles = eff.targetRoles;
  if (eff.targetSeniority)
    merged.identity.targetSeniority = eff.targetSeniority;
  if (eff.workMode) merged.hardConstraints.workMode = eff.workMode;
  if (eff.acceptableLocations)
    merged.hardConstraints.acceptableLocations = eff.acceptableLocations;
  if (eff.wants) merged.wants = eff.wants;
  if (eff.avoids) merged.avoids = eff.avoids;
  return merged;
}

/**
 * Returns the dashboard's current Google access token IFF the user is signed
 * in AND the token has at least 60 seconds of lifetime left. Anything less
 * isn't worth sending — discovery runs typically take 20–60s and a token that
 * expires mid-run will fail at the Sheets write step.
 */
function getDiscoveryRequestGoogleAccessToken() {
  if (!h("getAccessToken")() || typeof h("getAccessToken")() !== "string") return "";
  const trimmed = h("getAccessToken")().trim();
  if (!trimmed) return "";
  if (Number.isFinite(h("getTokenExpiresAt")())) {
    const remainingMs = Number(h("getTokenExpiresAt")()) - Date.now();
    if (remainingMs < 60_000) return "";
  }
  return trimmed;
}

async function getFreshDiscoveryRequestGoogleAccessToken(options = {}) {
  if (options && options.force === true) {
    const refreshed = await h("refreshAccessTokenSilently")().catch(() => false);
    return refreshed ? getDiscoveryRequestGoogleAccessToken() : "";
  }
  const current = getDiscoveryRequestGoogleAccessToken();
  if (current) return current;
  if (!h("getAccessToken")() || !Number.isFinite(h("getTokenExpiresAt")())) return "";
  const remainingMs = Number(h("getTokenExpiresAt")()) - Date.now();
  if (remainingMs >= 60_000) return "";
  const refreshed = await h("refreshAccessTokenSilently")().catch(() => false);
  return refreshed ? getDiscoveryRequestGoogleAccessToken() : "";
}

function showDiscoveryVerificationToast(result, options = {}) {
  if (!result || typeof result !== "object") return;
  const context = String(options.context || "test_webhook").trim();
  const isRun = context === "run_discovery";
  let type = "info";
  let persistent = false;
  if (result.ok) {
    if (result.kind === "stub_only") {
      type = "info";
      persistent = true;
    } else {
      type = "success";
    }
  } else {
    type = "error";
    persistent = true;
  }
  const detail =
    !result.ok && result.detail && result.detail !== result.message
      ? ` ${result.detail}`
      : "";
  const fallback = isRun
    ? "Discovery verification finished."
    : "Webhook verification finished.";

  let action;
  if (!result.ok && result.kind === "auth_required") {
    // The browser-use worker fail-closed because the secret is missing or
    // wrong. The fix is "run bootstrap and reload" — give the user a copy
    // button for the command so they don't have to retype it.
    action = {
      label: "Copy bootstrap command",
      onClick: () => {
        h("copyTextToClipboard")(
          result.suggestedCommand || "npm run discovery:bootstrap-local",
        );
      },
    };
  } else if (!result.ok && h("isLocalDashboardOrigin")()) {
    const hasLocalTunnel = !!h("getDiscoveryTransportSetupState")().tunnelPublicUrl;
    const endpointUrl = options.endpointUrl || "";
    const isTunnelFailure =
      result.layer === "downstream" ||
      (result.kind === "network_error" &&
        h("isLikelyCloudflareWorkerUrl")(endpointUrl)) ||
      (result.kind === "network_error" && hasLocalTunnel) ||
      (/ngrok|tunnel|offline/i.test(result.detail || "") && hasLocalTunnel);
    if (isTunnelFailure) {
      action = {
        label: "Fix tunnel",
        onClick: () => {
          void h("requestDiscoverySetup")({
            entryPoint: "settings",
            flow: "local_agent",
            startStep: "tunnel",
            allowWhileOnboarding: true,
          });
        },
      };
    }
  }

  h("showToast")(
    `${result.message || fallback}${detail}`.trim(),
    type,
    persistent,
    action,
  );
}

async function verifyDiscoveryWebhookWithSharedModel(
  url,
  payload,
  options = {},
) {
  const verifyApi = getDiscoveryWizardVerifyApi();
  const initialSecret =
    typeof options.secret === "string" && options.secret.trim()
      ? options.secret.trim()
      : h("getDiscoveryWebhookSecret")();
  if (verifyApi && typeof verifyApi.verifyDiscoveryEndpoint === "function") {
    const runVerification = (secret) =>
      verifyApi.verifyDiscoveryEndpoint(url, {
        payload,
        context: options.context || "test_webhook",
        sheetId: options.sheetId || "",
        timeoutMs: options.timeoutMs || 15000,
        secret,
      });

    const result = await runVerification(initialSecret);
    if (!result || result.ok || result.kind !== "auth_required") {
      return result;
    }

    const refreshedSecret =
      await h("refreshDiscoveryWebhookSecretFromBootstrapForEndpoint")(url);
    if (!refreshedSecret || refreshedSecret === initialSecret) {
      return result;
    }

    return runVerification(refreshedSecret);
  }
  return {
    ok: false,
    kind: "invalid_endpoint",
    engineState: "none",
    httpStatus: 0,
    message: "Discovery verifier is not available.",
    detail: "Reload the page and try again.",
    layer: "browser",
  };
}

function getDiscoveryWizardDefaultDrafts(snapshot) {
  const state =
    snapshot && typeof snapshot === "object"
      ? snapshot
      : getDiscoveryReadinessSnapshot();
  return {
    endpointUrl: h("getDiscoveryWebhookUrl")() || state.savedWebhookUrl || "",
    workerUrl: h("isLikelyCloudflareWorkerUrl")(state.savedWebhookUrl)
      ? state.savedWebhookUrl
      : "",
  };
}

function createDiscoveryWizardRuntime(patch = {}) {
  const next = {
    entryPoint: "manual",
    snapshot: getDiscoveryReadinessSnapshot(),
    state: {
      version: 1,
      flow: "local_agent",
      currentStep: "detect",
      completedSteps: [],
      transportMode: "",
      lastProbeAt: "",
      lastVerifiedAt: "",
      result: "none",
      dismissedStubWarning: false,
    },
    activeStepId: "detect",
    drafts: getDiscoveryWizardDefaultDrafts(getDiscoveryReadinessSnapshot()),
    lastLocalResult: null,
    lastRelayResult: null,
    lastRelayModel: null,
    lastVerificationResult: null,
    lastDownstreamDiagnosis: null,
    lastWizardMessage: "",
    lastWizardMessageTone: "info",
    localBootstrapState: null,
    flowProgressCache: {},
    ...patch,
  };
  next.state = {
    ...(next.state || {}),
    flow: mapDiscoveryWizardFlow(next.state && next.state.flow),
  };
  next.activeStepId = next.activeStepId || next.state.currentStep || "detect";
  next.drafts = {
    ...getDiscoveryWizardDefaultDrafts(next.snapshot),
    ...(patch.drafts && typeof patch.drafts === "object" ? patch.drafts : {}),
  };
  return next;
}

function getDiscoveryWizardRuntime() {
  if (!cc().discoveryWizardRuntime) {
    cc().discoveryWizardRuntime = createDiscoveryWizardRuntime();
  }
  return cc().discoveryWizardRuntime;
}

function updateDiscoveryWizardRuntime(patch = {}) {
  const current = getDiscoveryWizardRuntime();
  cc().discoveryWizardRuntime = createDiscoveryWizardRuntime({
    ...current,
    ...patch,
    state: {
      ...(current.state || {}),
      ...(patch.state && typeof patch.state === "object" ? patch.state : {}),
    },
    drafts: {
      ...(current.drafts || {}),
      ...(patch.drafts && typeof patch.drafts === "object" ? patch.drafts : {}),
    },
    flowProgressCache: {
      ...(current.flowProgressCache || {}),
      ...(patch.flowProgressCache && typeof patch.flowProgressCache === "object"
        ? patch.flowProgressCache
        : {}),
    },
  });
  return cc().discoveryWizardRuntime;
}

function clearDiscoveryWizardRuntime() {
  cc().discoveryWizardRuntime = null;
}

function setDiscoveryWizardRuntime(runtime) {
  cc().discoveryWizardRuntime = runtime;
  return cc().discoveryWizardRuntime;
}

/**
 * Resolve the user's local repo root from bootstrap state. Returns "" if
 * unknown — callers should fall back gracefully (e.g. omit the cd prefix).
 */
/**
 * Build a "cd <repo> && <cmd>" combined command so the user can paste it into
 * any Terminal window — no need to navigate to the repo first. Quotes the
 * path to handle spaces. Returns the bare command if repoRoot is unknown.
 */
/**
 * Trigger a download of a macOS .command script that opens Terminal in the
 * repo and runs the given command. macOS-only delight: double-click and go.
 * On other OSes the file just won't open (Terminal-specific extension).
 */
/**
 * Append a "run-in-terminal" block: combined cd+command with a Copy button
 * AND (on capable browsers) a "Download .command" delight button that opens
 * Terminal in the repo and runs the command on double-click. Includes an
 * inline instruction so users know what to do — addresses the "copy buttons
 * with no context" feedback.
 */
/**
 * Heuristic: classify a suggested URL so we can render a context-rich action
 * instead of a bare "Copy URL". We look at the result.kind first (set by the
 * worker code paths that create these results), then fall back to URL shape.
 */
/**
 * Render a recovery cluster after a failed step action: Try again + Copy AI
 * prompt + Skip. Only appended when the latest result for this step failed.
 * Skip writes the wizard state to "skipped" for the step and advances.
 */
function getDiscoveryWizardStepIds(flow) {
  const normalizedFlow = mapDiscoveryWizardFlow(flow);
  if (normalizedFlow === "external_endpoint") {
    return ["detect", "path_select", "existing_endpoint", "verify", "ready"];
  }
  if (normalizedFlow === "no_webhook") {
    return ["detect", "path_select", "no_webhook", "ready"];
  }
  if (normalizedFlow === "stub_only") {
    return ["detect", "path_select", "stub_only", "ready"];
  }
  const localApi = getDiscoveryWizardLocalApi();
  if (localApi && typeof localApi.getLocalStepIds === "function") {
    return localApi.getLocalStepIds();
  }
  return [
    "detect",
    "path_select",
    "bootstrap",
    "local_health",
    "tunnel",
    "relay_deploy",
    "verify",
    "ready",
  ];
}

function getDiscoveryWizardStepsBefore(flow, targetStep) {
  const ids = getDiscoveryWizardStepIds(flow);
  const idx = ids.indexOf(targetStep);
  return idx > 0 ? ids.slice(0, idx) : [];
}

async function persistDiscoveryWizardState(patch = {}) {
  const probes = getDiscoveryWizardProbesApi();
  const current = getDiscoveryWizardRuntime();
  const next = {
    ...(current.state || {}),
    ...(patch && typeof patch === "object" ? patch : {}),
    flow: mapDiscoveryWizardFlow(
      patch && Object.prototype.hasOwnProperty.call(patch, "flow")
        ? patch.flow
        : current.state.flow,
    ),
  };
  if (probes && typeof probes.saveDiscoverySetupWizardState === "function") {
    try {
      const saved = await probes.saveDiscoverySetupWizardState(next);
      updateDiscoveryWizardRuntime({ state: saved });
      return saved;
    } catch (err) {
      console.warn("[JobBored] discovery wizard state:", err);
    }
  }
  updateDiscoveryWizardRuntime({ state: next });
  return next;
}
  Object.assign(readiness, {
    refreshDiscoveryUiState,
    inferLocalWebhookPort,
    buildDiscoveryTunnelTargetUrl,
    getDiscoveryLocalWebhookHealthUrl,
    getCloudflareRelayTargetInfo,
    getDiscoveryWizardRoot,
    getDiscoveryWizardShellApi,
    getDiscoveryWizardProbesApi,
    getDiscoveryWizardLocalApi,
    getDiscoveryWizardRelayApi,
    getDiscoveryWizardVerifyApi,
    mapDiscoveryWizardFlow,
    getDiscoveryLocalEngineKind,
    getDiscoveryLocalEngineLabel,
    getDiscoveryLocalEngineSummary,
    getDiscoveryRecoveryCopy,
    getDiscoveryReadinessSnapshot,
    getDiscoverySettingsView,
    getDiscoveryEmptyStateView,
    refreshDiscoveryReadinessSnapshot,
    buildDiscoveryWebhookPayload,
    getDiscoveryRequestGoogleAccessToken,
    getFreshDiscoveryRequestGoogleAccessToken,
    showDiscoveryVerificationToast,
    verifyDiscoveryWebhookWithSharedModel,
    getDiscoveryWizardDefaultDrafts,
    createDiscoveryWizardRuntime,
    getDiscoveryWizardRuntime,
    updateDiscoveryWizardRuntime,
    clearDiscoveryWizardRuntime,
    setDiscoveryWizardRuntime,
    getDiscoveryWizardStepIds,
    getDiscoveryWizardStepsBefore,
    persistDiscoveryWizardState,
  });
})();
