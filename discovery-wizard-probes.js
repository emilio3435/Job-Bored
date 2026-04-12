(() => {
  const root =
    window.JobBoredDiscoveryWizard || (window.JobBoredDiscoveryWizard = {});
  const probes = root.probes || (root.probes = {});

  const CONFIG_OVERRIDE_KEY = "command_center_config_overrides";
  const DISCOVERY_TRANSPORT_SETUP_KEY =
    "command_center_discovery_transport_setup";
  const LOCAL_BOOTSTRAP_STATE_PATH = "discovery-local-bootstrap.json";

  // Simulation override key for deterministic recovery-state testing
  // Value is a JSON object: { workerHealthy: boolean, tunnelUrl: string|null, storedTunnelUrl: string }
  // When present, probe functions return simulated values instead of live data
  const DISCOVERY_LOCAL_SIMULATION_KEY =
    "discovery_local_simulation_override";

  const DISCOVERY_ENGINE_STATE_NONE = "none";
  const DISCOVERY_ENGINE_STATE_STUB_ONLY = "stub_only";
  const DISCOVERY_ENGINE_STATE_UNVERIFIED = "unverified";
  const DISCOVERY_ENGINE_STATE_CONNECTED = "connected";

  const SAVED_WEBHOOK_KIND_NONE = "none";
  const SAVED_WEBHOOK_KIND_APPS_SCRIPT_STUB = "apps_script_stub";
  const SAVED_WEBHOOK_KIND_WORKER = "worker";
  const SAVED_WEBHOOK_KIND_GENERIC_HTTPS = "generic_https";
  const SAVED_WEBHOOK_KIND_LOCAL_HTTP = "local_http";

  const APPS_SCRIPT_MANAGED_BY = "command-center";
  const APPS_SCRIPT_PUBLIC_ACCESS_READY = "ready";
  const APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION = "needs_remediation";
  const LOCAL_ENGINE_NONE = "none";
  const LOCAL_ENGINE_BROWSER_USE = "browser_use_worker";
  const LOCAL_ENGINE_HERMES = "hermes";
  const LOCAL_ENGINE_OTHER = "other";

  const VALID_RESULTS = new Set([
    "none",
    "stub_only",
    "unverified",
    "connected",
  ]);

  function getUserContentApi() {
    return window.CommandCenterUserContent || null;
  }

  function readJsonLocalStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function parseGoogleSheetId(raw) {
    const s = raw != null ? String(raw).trim() : "";
    if (!s) return "";
    const fromPath = s.match(
      /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/|$|\?|#)/,
    );
    if (fromPath && fromPath[1]) return fromPath[1];
    const compact = s.replace(/\s/g, "");
    if (
      /^[a-zA-Z0-9_-]+$/.test(compact) &&
      compact.length >= 10 &&
      compact !== "YOUR_SHEET_ID_HERE"
    ) {
      return compact;
    }
    return "";
  }

  // Shared URL helpers delegate to the canonical implementation in discovery-shared-helpers.js
  const H = window.JobBoredDiscoveryHelpers || {};

  function normalizeUrl(raw) {
    return typeof H.normalizeUrl === "function" ? H.normalizeUrl(raw) : (raw != null ? String(raw).trim() : "");
  }

  function normalizeLocalEngineKind(raw) {
    const value = String(raw || "")
      .trim()
      .toLowerCase();
    if (value === LOCAL_ENGINE_BROWSER_USE) return LOCAL_ENGINE_BROWSER_USE;
    if (value === LOCAL_ENGINE_HERMES) return LOCAL_ENGINE_HERMES;
    if (value === LOCAL_ENGINE_OTHER) return LOCAL_ENGINE_OTHER;
    return LOCAL_ENGINE_NONE;
  }

  function getLocalEngineLabel(kind) {
    if (kind === LOCAL_ENGINE_BROWSER_USE) return "Browser-use worker";
    if (kind === LOCAL_ENGINE_HERMES) return "Hermes route";
    if (kind === LOCAL_ENGINE_OTHER) return "Local discovery service";
    return "";
  }

  function inferLocalEngineKind(metadata, localWebhookUrl) {
    const source = metadata && typeof metadata === "object" ? metadata : {};
    const explicit = normalizeLocalEngineKind(source.engineKind);
    if (explicit !== LOCAL_ENGINE_NONE) return explicit;

    const serviceName = String(
      source.localService || source.serviceName || source.service || "",
    )
      .trim()
      .toLowerCase();
    if (serviceName === "browser-use-discovery-worker") {
      return LOCAL_ENGINE_BROWSER_USE;
    }

    const platform = String(
      source.localPlatform ||
        source.platform ||
        source.mode ||
        source.localMode ||
        "",
    )
      .trim()
      .toLowerCase();
    if (platform === "webhook") return LOCAL_ENGINE_HERMES;

    const webhookUrl = normalizeUrl(localWebhookUrl || source.localWebhookUrl);
    if (/\/webhook\/?$/i.test(webhookUrl)) {
      return LOCAL_ENGINE_BROWSER_USE;
    }
    if (/\/webhooks\/[^/]+/i.test(webhookUrl)) {
      return LOCAL_ENGINE_HERMES;
    }
    return webhookUrl ? LOCAL_ENGINE_OTHER : LOCAL_ENGINE_NONE;
  }

  function isLikelyAppsScriptWebAppUrl(raw) {
    return typeof H.isLikelyAppsScriptWebAppUrl === "function" ? H.isLikelyAppsScriptWebAppUrl(raw) : (() => {
      const s = String(raw || "").trim();
      if (!s) return false;
      try {
        const url = new URL(s);
        return (
          url.protocol === "https:" &&
          /(^|\.)script\.google\.com$/i.test(url.hostname) &&
          /\/macros\/s\/[^/]+\/(?:exec|dev)\/?$/i.test(url.pathname)
        );
      } catch (_) {
        return /https:\/\/script\.google\.com\/macros\/s\/[^/]+\/(?:exec|dev)\/?/i.test(s);
      }
    })();
  }

  function isLikelyCloudflareWorkerUrl(raw) {
    return typeof H.isLikelyCloudflareWorkerUrl === "function" ? H.isLikelyCloudflareWorkerUrl(raw) : (() => {
      const s = String(raw || "").trim();
      if (!s) return false;
      try {
        const url = new URL(s);
        return (
          url.protocol === "https:" &&
          (/\.workers\.dev$/i.test(url.hostname) ||
            /(^|\.)cloudflareworkers\.com$/i.test(url.hostname))
        );
      } catch (_) {
        return /workers\.dev/i.test(s);
      }
    })();
  }

  function isLocalWebhookUrl(raw) {
    return typeof H.isLocalWebhookUrl === "function" ? H.isLocalWebhookUrl(raw) : (() => {
      const s = String(raw || "").trim();
      if (!s) return false;
      try {
        const url = new URL(s);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "::1";
      } catch (_) {
        return false;
      }
    })();
  }

  function classifySavedWebhookKind(rawUrl) {
    return typeof H.classifySavedWebhookKind === "function" ? H.classifySavedWebhookKind(rawUrl) : (() => {
      const url = normalizeUrl(rawUrl);
      if (!url) return SAVED_WEBHOOK_KIND_NONE;
      if (isLocalWebhookUrl(url)) return SAVED_WEBHOOK_KIND_LOCAL_HTTP;
      if (isLikelyAppsScriptWebAppUrl(url)) {
        return SAVED_WEBHOOK_KIND_APPS_SCRIPT_STUB;
      }
      if (isLikelyCloudflareWorkerUrl(url)) return SAVED_WEBHOOK_KIND_WORKER;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          return SAVED_WEBHOOK_KIND_GENERIC_HTTPS;
        }
      } catch (_) {
        // fall through
      }
      return SAVED_WEBHOOK_KIND_NONE;
    })();
  }

  function normalizeDiscoveryEngineState(raw) {
    const value =
      typeof raw === "string"
        ? raw.trim()
        : raw && typeof raw === "object"
          ? String(raw.state || raw.engineState || "").trim()
          : "";
    if (value === DISCOVERY_ENGINE_STATE_STUB_ONLY) return value;
    if (value === DISCOVERY_ENGINE_STATE_UNVERIFIED) return value;
    if (value === DISCOVERY_ENGINE_STATE_CONNECTED) return value;
    return DISCOVERY_ENGINE_STATE_NONE;
  }

  function isManagedAppsScriptDeployState(state) {
    return !!(
      state &&
      typeof state === "object" &&
      String(state.managedBy || "") === APPS_SCRIPT_MANAGED_BY &&
      String(state.scriptId || "").trim()
    );
  }

  function isAppsScriptPublicAccessReady(state) {
    if (!isManagedAppsScriptDeployState(state)) return false;
    const status = String(state.publicAccessState || "").trim();
    if (!status) {
      return !!String(state.webAppUrl || "").trim();
    }
    return status === APPS_SCRIPT_PUBLIC_ACCESS_READY;
  }

  function classifyAppsScriptState(state) {
    if (!isManagedAppsScriptDeployState(state)) return "none";
    if (isAppsScriptPublicAccessReady(state)) return "stub_only";
    if (
      String(state.publicAccessState || "").trim() ===
        APPS_SCRIPT_PUBLIC_ACCESS_NEEDS_REMEDIATION ||
      String(state.webAppUrl || "").trim()
    ) {
      return "unverified";
    }
    return "unverified";
  }

  function normalizeDiscoverySetupWizardState(raw) {
    const source =
      raw && typeof raw === "object"
        ? raw
        : root.contract.discoverySetupWizardState;
    const completedSteps = Array.isArray(source.completedSteps)
      ? [
          ...new Set(
            source.completedSteps
              .map((step) => String(step || "").trim())
              .filter(Boolean),
          ),
        ]
      : [];
    const flow = String(source.flow || "").trim() || "local_agent";
    const currentStep = String(source.currentStep || "").trim() || "detect";
    const transportMode = String(source.transportMode || "").trim();
    const lastProbeAt = String(source.lastProbeAt || "").trim();
    const lastVerifiedAt = String(source.lastVerifiedAt || "").trim();
    const result = String(source.result || "").trim();
    return {
      version:
        Number.isInteger(source.version) && source.version > 0
          ? source.version
          : 1,
      flow,
      currentStep,
      completedSteps,
      transportMode,
      lastProbeAt,
      lastVerifiedAt,
      result: VALID_RESULTS.has(result) ? result : "none",
      dismissedStubWarning: !!source.dismissedStubWarning,
    };
  }

  async function getDiscoverySetupWizardState() {
    const api = getUserContentApi();
    if (api && typeof api.getDiscoverySetupWizardState === "function") {
      return normalizeDiscoverySetupWizardState(
        await api.getDiscoverySetupWizardState(),
      );
    }
    return normalizeDiscoverySetupWizardState();
  }

  async function saveDiscoverySetupWizardState(partial) {
    const api = getUserContentApi();
    if (api && typeof api.saveDiscoverySetupWizardState === "function") {
      return normalizeDiscoverySetupWizardState(
        await api.saveDiscoverySetupWizardState(partial),
      );
    }
    return normalizeDiscoverySetupWizardState({
      ...(await getDiscoverySetupWizardState()),
      ...(partial && typeof partial === "object" ? partial : {}),
    });
  }

  async function clearDiscoverySetupWizardState() {
    const api = getUserContentApi();
    if (api && typeof api.clearDiscoverySetupWizardState === "function") {
      return normalizeDiscoverySetupWizardState(
        await api.clearDiscoverySetupWizardState(),
      );
    }
    return normalizeDiscoverySetupWizardState();
  }

  function getConfigSnapshot() {
    const overrides = readJsonLocalStorage(CONFIG_OVERRIDE_KEY);
    const currentConfig =
      window.COMMAND_CENTER_CONFIG &&
      typeof window.COMMAND_CENTER_CONFIG === "object"
        ? window.COMMAND_CENTER_CONFIG
        : {};
    const sheetId =
      parseGoogleSheetId(currentConfig.sheetId) ||
      parseGoogleSheetId(overrides.sheetId) ||
      "";
    const discoveryWebhookUrl =
      normalizeUrl(currentConfig.discoveryWebhookUrl) ||
      normalizeUrl(overrides.discoveryWebhookUrl) ||
      "";
    return {
      sheetId,
      discoveryWebhookUrl,
    };
  }

  function readDiscoveryTransportSetupState() {
    const raw = readJsonLocalStorage(DISCOVERY_TRANSPORT_SETUP_KEY);
    return {
      localWebhookUrl: normalizeUrl(raw.localWebhookUrl),
      tunnelPublicUrl: normalizeUrl(raw.tunnelPublicUrl),
    };
  }

  function buildLocalHealthUrl(localWebhookUrl) {
    return typeof H.buildLocalHealthUrl === "function" ? H.buildLocalHealthUrl(localWebhookUrl) : (() => {
      const local = normalizeUrl(localWebhookUrl);
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
    })();
  }

  async function readLocalBootstrapState() {
    try {
      const res = await fetch(LOCAL_BOOTSTRAP_STATE_PATH, {
        cache: "no-store",
      });
      if (!res.ok) {
        return { available: false, data: null };
      }
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") {
        return { available: false, data: null };
      }
      return { available: true, data };
    } catch (_) {
      return { available: false, data: null };
    }
  }

  /**
   * Read simulation overrides for deterministic recovery-state testing.
   * When simulation is active, probe functions return simulated values
   * instead of probing live services, enabling testing of blocked states
   * without actually breaking shared infrastructure.
   *
   * Simulation object shape:
   * {
   *   enabled: boolean,          // master switch
   *   workerHealthy: boolean,    // result for probeHealthUrl
   *   tunnelUrl: string|null,   // result for probeNgrokTunnels (null = no tunnel)
   *   storedTunnelUrl: string,   // stored tunnel URL for stale detection
   *   isLocalSetup: boolean,    // whether local setup is detected
   * }
   *
   * Usage in tests:
   *   localStorage.setItem('discovery_local_simulation_override', JSON.stringify({
   *     enabled: true,
   *     workerHealthy: false,
   *     tunnelUrl: null,
   *     storedTunnelUrl: 'https://old.ngrok.io/',
   *     isLocalSetup: true,
   *   }));
   *   // Now buildReadinessSnapshot() will report worker_down state
   */
  function readSimulationOverrides() {
    try {
      const raw = localStorage.getItem(DISCOVERY_LOCAL_SIMULATION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      // Only active if explicitly enabled
      if (parsed.enabled !== true) return null;
      return {
        enabled: true,
        workerHealthy:
          parsed.workerHealthy === true,
        tunnelUrl:
          parsed.tunnelUrl == null ? null : String(parsed.tunnelUrl || ""),
        storedTunnelUrl: String(parsed.storedTunnelUrl || ""),
        isLocalSetup: parsed.isLocalSetup !== false,
      };
    } catch (_) {
      return null;
    }
  }

  function localHealthProxyUrl(healthUrl) {
    return typeof H.localHealthProxyUrl === "function" ? H.localHealthProxyUrl(healthUrl) : (() => {
      try {
        const parsed = new URL(healthUrl);
        const host = parsed.hostname;
        if (
          host === "127.0.0.1" ||
          host === "localhost" ||
          host === "[::1]" ||
          host === "::1"
        ) {
          const port =
            parsed.port || (parsed.protocol === "https:" ? "443" : "80");
          return `/__proxy/local-health?port=${port}`;
        }
      } catch (_) {}
      return healthUrl;
    })();
  }

  async function probeHealthUrl(healthUrl) {
    // Check for simulation override first - enables deterministic testing
    const sim = readSimulationOverrides();
    if (sim) {
      return sim.workerHealthy;
    }
    const url = normalizeUrl(healthUrl);
    if (!url) return false;
    try {
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller
        ? window.setTimeout(() => controller.abort(), 2500)
        : null;
      const res = await fetch(localHealthProxyUrl(url), {
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
      });
      if (timeout != null) window.clearTimeout(timeout);
      return res.ok || res.status === 204 || res.status === 202;
    } catch (_) {
      return false;
    }
  }

  async function probeNgrokTunnels() {
    // Check for simulation override first - enables deterministic testing
    const sim = readSimulationOverrides();
    if (sim) {
      return sim.tunnelUrl != null ? sim.tunnelUrl : "";
    }
    try {
      const res = await fetch("/__proxy/ngrok-tunnels", {
        cache: "no-store",
      });
      if (!res.ok) return "";
      const data = await res.json().catch(() => null);
      const tunnels = Array.isArray(data && data.tunnels) ? data.tunnels : [];
      for (const tunnel of tunnels) {
        const publicUrl =
          String(
            tunnel && (tunnel.public_url || tunnel.publicUrl || ""),
          ).trim() || "";
        if (!publicUrl) continue;
        if (/^https:\/\//i.test(publicUrl))
          return publicUrl.replace(/\/+$/, "/");
      }
      const direct =
        String(data && (data.public_url || data.publicUrl || "")).trim() || "";
      return /^https:\/\//i.test(direct) ? direct.replace(/\/+$/, "/") : "";
    } catch (_) {
      return "";
    }
  }

  function buildRelayTargetUrl(localWebhookUrl, tunnelPublicUrl) {
    const local = normalizeUrl(localWebhookUrl);
    const tunnel = normalizeUrl(tunnelPublicUrl);
    if (!local || !tunnel) return "";
    try {
      const localUrl = new URL(local);
      const tunnelUrl = new URL(tunnel);
      tunnelUrl.pathname = localUrl.pathname || "/";
      tunnelUrl.search = "";
      tunnelUrl.hash = "";
      return tunnelUrl.toString();
    } catch (_) {
      return "";
    }
  }

  function deriveTunnelFields({ liveTunnelUrl, storedTunnelUrl }) {
    const tunnelPublicUrl = liveTunnelUrl || storedTunnelUrl || "";
    const tunnelLive = !!liveTunnelUrl;
    const tunnelReady = tunnelLive;
    const tunnelStale =
      !!storedTunnelUrl && tunnelLive && liveTunnelUrl !== storedTunnelUrl;
    return { tunnelPublicUrl, tunnelLive, tunnelReady, tunnelStale };
  }

  function deriveLocalRecoveryState({
    isLocalSetup,
    localWebhookReady,
    tunnelLive,
    tunnelStale,
  }) {
    if (!isLocalSetup) return "ok";
    if (!localWebhookReady && !tunnelLive) return "needs_full_restart";
    if (!localWebhookReady) return "worker_down";
    if (!tunnelLive) return "tunnel_down";
    if (tunnelStale) return "tunnel_rotated";
    return "ok";
  }

  function buildRecoveryCopy(snapshot) {
    const state = snapshot && typeof snapshot === "object" ? snapshot : {};
    const recovery =
      typeof state.localRecoveryState === "string"
        ? state.localRecoveryState.trim() || "ok"
        : "ok";
    const previousTunnel = normalizeUrl(state.storedTunnelUrl);
    const currentTunnel = normalizeUrl(state.tunnelPublicUrl);
    const fallbackDetail =
      "Part of the local discovery chain is down after a restart.";

    if (recovery === "tunnel_rotated") {
      const detectBody = [
        "ngrok gave your local setup a new public URL.",
        "The saved Worker URL in JobBored can stay the same, but the relay behind it still points at the previous tunnel until you redeploy it.",
      ];
      if (previousTunnel && previousTunnel !== currentTunnel) {
        detectBody.push(`Previous tunnel: ${previousTunnel}`);
      }
      if (currentTunnel) {
        detectBody.push(`Current tunnel: ${currentTunnel}`);
      }
      return {
        title: "Public tunnel changed",
        detail: detectBody.join(" "),
        compactDetail:
          "ngrok gave your local setup a new public URL, so the relay behind your saved Worker URL needs to be redeployed.",
        actionHint:
          "Click Fix setup to redeploy the relay with the current ngrok URL. Keep the same Worker URL saved in JobBored.",
        detectBody,
      };
    }

    const detailMap = {
      needs_full_restart:
        "Your computer restarted, so the local worker and tunnel need to be brought back up.",
      worker_down:
        "The local discovery worker is not responding. It may need to be restarted.",
      tunnel_down:
        "The public ngrok tunnel is not running, so the saved Worker URL cannot reach your local worker right now.",
    };
    const detail = detailMap[recovery] || fallbackDetail;

    return {
      title: "Local setup needs recovery",
      detail,
      compactDetail: detail,
      actionHint:
        "Click Fix setup to restart what is down and redeploy the relay if needed.",
      detectBody: [detail],
    };
  }

  function buildSettingsDiscoveryView(snapshot) {
    const state = snapshot && typeof snapshot === "object" ? snapshot : {};
    const engineState = normalizeDiscoveryEngineState(state.engineState);
    const kind = String(state.savedWebhookKind || SAVED_WEBHOOK_KIND_NONE);
    const appsScriptState = String(state.appsScriptState || "none");
    const recovery = state.localRecoveryState || "ok";
    const recoveryCopy = buildRecoveryCopy(state);
    const hasSavedExternalEndpoint =
      kind === SAVED_WEBHOOK_KIND_WORKER ||
      kind === SAVED_WEBHOOK_KIND_GENERIC_HTTPS;
    const connected = engineState === DISCOVERY_ENGINE_STATE_CONNECTED;
    const pendingExternal =
      engineState === DISCOVERY_ENGINE_STATE_UNVERIFIED ||
      hasSavedExternalEndpoint;
    const stubCurrent =
      engineState === DISCOVERY_ENGINE_STATE_STUB_ONLY ||
      kind === SAVED_WEBHOOK_KIND_APPS_SCRIPT_STUB;

    if (recovery !== "ok" && (connected || pendingExternal)) {
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

    if (connected || pendingExternal) {
      const verified = connected;
      return {
        tone: verified ? "success" : "warning",
        title: verified ? "Discovery is connected" : "Discovery endpoint saved",
        detail: verified
          ? "Run discovery will POST to the public endpoint already saved in JobBored."
          : "A public webhook is already saved. Test it if you changed the downstream service.",
        chipLabel: verified ? "Connected" : "Ready to test",
        chipTone: verified ? "success" : "warning",
        runDiscoveryEnabled: true,
        primaryActionLabel: "Open discovery setup",
        primaryActionHint: "Review the current webhook or switch paths.",
      };
    }

    if (kind === SAVED_WEBHOOK_KIND_LOCAL_HTTP) {
      return {
        tone: "info",
        title: "Local receiver detected",
        detail:
          "Finish the local health, tunnel, and Worker steps to make the browser-facing URL ready.",
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
        primaryActionHint:
          "Switch to a real webhook if you want Run discovery.",
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
        "Choose the path that matches how you want jobs to enter Pipeline.",
    };
  }

  function buildEmptyStateDiscoveryView(snapshot) {
    const state = snapshot && typeof snapshot === "object" ? snapshot : {};
    const engineState = normalizeDiscoveryEngineState(state.engineState);
    const appsScriptState = String(state.appsScriptState || "none");
    const kind = String(state.savedWebhookKind || SAVED_WEBHOOK_KIND_NONE);
    const recovery = state.localRecoveryState || "ok";
    const recoveryCopy = buildRecoveryCopy(state);
    const hasSavedExternalEndpoint =
      kind === SAVED_WEBHOOK_KIND_WORKER ||
      kind === SAVED_WEBHOOK_KIND_GENERIC_HTTPS;
    const stubCurrent =
      engineState === DISCOVERY_ENGINE_STATE_STUB_ONLY ||
      kind === SAVED_WEBHOOK_KIND_APPS_SCRIPT_STUB;

    if (
      recovery !== "ok" &&
      (engineState === DISCOVERY_ENGINE_STATE_CONNECTED ||
        hasSavedExternalEndpoint)
    ) {
      return {
        title: recoveryCopy.title,
        body: `${recoveryCopy.compactDetail} Use Fix setup to recover it.`,
        ctaLabel: "Fix setup",
        ctaAction: "open_setup",
      };
    }

    if (engineState === DISCOVERY_ENGINE_STATE_CONNECTED) {
      return {
        title: "No roles yet",
        body: "When your automation runs, new rows will appear here. You can also run discovery on demand.",
        ctaLabel: "Run discovery now",
        ctaAction: "run_discovery",
      };
    }

    if (
      engineState === DISCOVERY_ENGINE_STATE_UNVERIFIED ||
      hasSavedExternalEndpoint
    ) {
      return {
        title: "Endpoint saved, verification pending",
        body: "A public webhook is already saved, but JobBored has not confirmed the full end-to-end path yet.",
        ctaLabel: "Open discovery setup",
        ctaAction: "open_setup",
      };
    }

    if (kind === SAVED_WEBHOOK_KIND_LOCAL_HTTP) {
      return {
        title: "Local discovery path not finished",
        body: "Your local receiver is known, but the public tunnel or Worker URL still needs to be finished.",
        ctaLabel: "Continue setup",
        ctaAction: "open_setup",
      };
    }

    if (stubCurrent || appsScriptState === "stub_only") {
      return {
        title: "Stub-only wiring detected",
        body: "The current webhook only confirms wiring. Connect a real discovery engine before expecting new job leads.",
        ctaLabel: "Connect real discovery",
        ctaAction: "open_setup",
      };
    }

    return {
      title: "No roles yet",
      body: "Add a discovery webhook in Settings or open the setup wizard to connect automation.",
      ctaLabel: "Open setup wizard",
      ctaAction: "open_setup",
    };
  }

  async function buildReadinessSnapshot() {
    const api = getUserContentApi();
    const [
      engineStateRaw,
      appsScriptDeployState,
      wizardState,
      localBootstrap,
      ngrokUrl,
    ] = await Promise.all([
      api && typeof api.getDiscoveryEngineState === "function"
        ? api.getDiscoveryEngineState().catch(() => null)
        : Promise.resolve(null),
      api && typeof api.getAppsScriptDeployState === "function"
        ? api.getAppsScriptDeployState().catch(() => null)
        : Promise.resolve(null),
      getDiscoverySetupWizardState().catch(() => null),
      readLocalBootstrapState(),
      probeNgrokTunnels(),
    ]);

    const config = getConfigSnapshot();
    const transport = readDiscoveryTransportSetupState();
    const bootstrapData =
      localBootstrap && localBootstrap.available
        ? localBootstrap.data || {}
        : null;

    const savedWebhookUrl =
      normalizeUrl(config.discoveryWebhookUrl) ||
      normalizeUrl((engineStateRaw && engineStateRaw.webhookUrl) || "") ||
      normalizeUrl(
        (appsScriptDeployState && appsScriptDeployState.webAppUrl) || "",
      );

    const savedWebhookKind = classifySavedWebhookKind(savedWebhookUrl);

    const localWebhookUrl =
      normalizeUrl(
        (bootstrapData && bootstrapData.localWebhookUrl) ||
          transport.localWebhookUrl,
      ) || "";
    const localHealthUrl =
      normalizeUrl((bootstrapData && bootstrapData.localHealthUrl) || "") ||
      buildLocalHealthUrl(localWebhookUrl);
    const localWebhookReady = await probeHealthUrl(localHealthUrl);
    const localEngineKind = inferLocalEngineKind(
      bootstrapData && bootstrapData.diagnostics
        ? {
            ...(bootstrapData.diagnostics || {}),
            engineKind:
              bootstrapData.diagnostics.engineKind || bootstrapData.engineKind,
          }
        : bootstrapData,
      localWebhookUrl,
    );
    const localEngineLabel = getLocalEngineLabel(localEngineKind);

    const sim = readSimulationOverrides();
    const liveTunnelUrl = normalizeUrl(ngrokUrl);
    // Use simulated stored tunnel URL when simulation is active
    const storedTunnelUrl = sim
      ? sim.storedTunnelUrl
      : normalizeUrl(
          (bootstrapData &&
            (bootstrapData.tunnelPublicUrl || bootstrapData.ngrokPublicUrl)) ||
            "",
        ) ||
          normalizeUrl(transport.tunnelPublicUrl) ||
          "";
    const { tunnelPublicUrl, tunnelLive, tunnelReady, tunnelStale } =
      deriveTunnelFields({
        liveTunnelUrl,
        storedTunnelUrl,
      });

    const relayTargetUrl =
      normalizeUrl((bootstrapData && bootstrapData.publicTargetUrl) || "") ||
      buildRelayTargetUrl(localWebhookUrl, tunnelPublicUrl) ||
      "";
    const relayReady = !!(relayTargetUrl && localWebhookUrl && tunnelPublicUrl);

    const appsScriptState = classifyAppsScriptState(appsScriptDeployState);
    const hasSavedExternalEndpoint =
      savedWebhookKind === SAVED_WEBHOOK_KIND_WORKER ||
      savedWebhookKind === SAVED_WEBHOOK_KIND_GENERIC_HTTPS;
    const hasSavedStubEndpoint =
      savedWebhookKind === SAVED_WEBHOOK_KIND_APPS_SCRIPT_STUB;
    const hasLocalPathSignals =
      savedWebhookKind === SAVED_WEBHOOK_KIND_LOCAL_HTTP ||
      !!localWebhookUrl ||
      !!tunnelPublicUrl ||
      !!(localBootstrap && localBootstrap.available);

    let engineState = normalizeDiscoveryEngineState(engineStateRaw);
    if (engineState === DISCOVERY_ENGINE_STATE_NONE) {
      if (hasSavedExternalEndpoint) {
        engineState = DISCOVERY_ENGINE_STATE_UNVERIFIED;
      } else if (hasSavedStubEndpoint) {
        engineState = DISCOVERY_ENGINE_STATE_STUB_ONLY;
      } else if (savedWebhookKind !== SAVED_WEBHOOK_KIND_NONE) {
        engineState = DISCOVERY_ENGINE_STATE_UNVERIFIED;
      } else if (appsScriptState === "stub_only") {
        engineState = DISCOVERY_ENGINE_STATE_STUB_ONLY;
      }
    }

    let recommendedFlow = "local_agent";
    let recommendedReason =
      "No public webhook is saved yet, so start by choosing the path you want to use.";
    if (
      hasSavedExternalEndpoint ||
      engineState === DISCOVERY_ENGINE_STATE_CONNECTED
    ) {
      recommendedFlow = "existing_endpoint";
      recommendedReason =
        savedWebhookKind === SAVED_WEBHOOK_KIND_WORKER
          ? "JobBored already has a Cloudflare Worker URL saved as the browser-facing webhook."
          : "JobBored already has a public HTTPS webhook saved.";
    } else if (hasLocalPathSignals) {
      recommendedFlow = "local_agent";
      recommendedReason =
        localEngineKind === LOCAL_ENGINE_BROWSER_USE
          ? "A local browser-use worker was found on this machine, so the local path is the best match."
          : localEngineKind === LOCAL_ENGINE_HERMES
            ? "A local Hermes route was found on this machine. It can work, but the browser-use worker is the recommended default."
            : "Local discovery signals were found on this machine, so the local path is the best match.";
    } else if (hasSavedStubEndpoint) {
      recommendedFlow = "stub_only";
      recommendedReason =
        "The only saved browser-facing webhook is the Apps Script stub, which is fine for smoke tests only.";
    } else if (appsScriptState === "stub_only") {
      recommendedFlow = "local_agent";
      recommendedReason =
        "An Apps Script stub exists, but it is not being treated as your main discovery path.";
    }

    let blockingIssue = "";
    if (!config.sheetId) {
      blockingIssue = "missing_sheet";
    } else if (hasSavedStubEndpoint) {
      blockingIssue = "stub_only";
    } else if (localWebhookUrl && !localWebhookReady) {
      blockingIssue = "local_health_unavailable";
    } else if (localWebhookUrl && localWebhookReady && !tunnelReady) {
      blockingIssue = "ngrok_missing";
    } else if (
      savedWebhookKind === SAVED_WEBHOOK_KIND_LOCAL_HTTP &&
      !relayReady
    ) {
      blockingIssue = "relay_missing";
    }

    const isLocalSetup = sim
      ? sim.isLocalSetup
      : hasLocalPathSignals || savedWebhookKind === SAVED_WEBHOOK_KIND_WORKER;
    const localRecoveryState = deriveLocalRecoveryState({
      isLocalSetup,
      localWebhookReady,
      tunnelLive,
      tunnelStale,
    });

    return {
      sheetConfigured: !!config.sheetId,
      savedWebhookUrl,
      savedWebhookKind,
      localBootstrapAvailable: !!(localBootstrap && localBootstrap.available),
      localWebhookUrl,
      localWebhookReady,
      localEngineKind,
      localEngineLabel,
      tunnelPublicUrl,
      storedTunnelUrl,
      tunnelLive,
      tunnelReady,
      tunnelStale,
      relayTargetUrl,
      relayReady,
      engineState,
      appsScriptState,
      recommendedFlow,
      recommendedReason,
      blockingIssue,
      localRecoveryState,
      views: {
        settings: buildSettingsDiscoveryView({
          engineState,
          appsScriptState,
          savedWebhookKind,
          localEngineKind,
          localEngineLabel,
          localWebhookUrl,
          tunnelPublicUrl,
          storedTunnelUrl,
          localRecoveryState,
        }),
        emptyState: buildEmptyStateDiscoveryView({
          engineState,
          appsScriptState,
          savedWebhookKind,
          localEngineKind,
          localEngineLabel,
          localWebhookUrl,
          tunnelPublicUrl,
          storedTunnelUrl,
          localRecoveryState,
        }),
      },
      wizardState:
        wizardState && typeof wizardState === "object" ? wizardState : null,
    };
  }

  Object.assign(probes, {
    buildReadinessSnapshot,
    classifySavedWebhookKind,
    classifyAppsScriptState,
    normalizeDiscoveryEngineState,
    getDiscoverySetupWizardState,
    saveDiscoverySetupWizardState,
    clearDiscoverySetupWizardState,
    buildSettingsDiscoveryView,
    buildEmptyStateDiscoveryView,
    isLikelyAppsScriptWebAppUrl,
    isLikelyCloudflareWorkerUrl,
    isLocalWebhookUrl,
    deriveTunnelFields,
    deriveLocalRecoveryState,
    buildRecoveryCopy,
    probeHealthUrl,
    probeNgrokTunnels,
    buildLocalHealthUrl,
    readDiscoveryTransportSetupState,
    readSimulationOverrides,
    requestFixSetup,
  });

  async function requestFixSetup() {
    const origin = window.location.origin || "http://localhost:8080";
    const url = `${origin}/__proxy/fix-setup`;
    try {
      const res = await fetch(url, { method: "POST" });
      return await res.json();
    } catch (err) {
      return {
        ok: false,
        phase: "network_error",
        message:
          "Could not reach the local dev server. Make sure `npm start` is running.",
        detail: err && err.message ? err.message : String(err),
      };
    }
  }
})();
