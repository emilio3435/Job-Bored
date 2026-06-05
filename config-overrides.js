/* ============================================
   COMMAND CENTER v2 — Config Overrides
   Extracted from app.js (config-overrides cut).

   Classic-global IIFE under window.JobBoredApp.configOverrides — NOT an ES module.
   Loaded BEFORE app.js. localStorage config overrides, discovery bootstrap
   hydration, and webhook/tunnel URL normalizers.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const configOverrides = root.configOverrides || (root.configOverrides = {});

  function host() {
    return configOverrides.host;
  }

  const COMMAND_CENTER_CONFIG_OVERRIDE_KEY = "command_center_config_overrides";
  const DISCOVERY_TRANSPORT_SETUP_KEY =
    "command_center_discovery_transport_setup";
  const DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH = "discovery-local-bootstrap.json";

  const COMMAND_CENTER_OVERRIDE_KEYS = [
    "sheetId",
    "oauthClientId",
    "title",
    "discoveryWebhookUrl",
    "discoveryWebhookSecret",
    "resumeProvider",
    "resumeGeminiApiKey",
    "resumeGeminiModel",
    "resumeOpenAIApiKey",
    "resumeOpenAIModel",
    "resumeAnthropicApiKey",
    "resumeAnthropicModel",
    "resumeOpenRouterApiKey",
    "resumeOpenRouterModel",
    "resumeOpenRouterBaseUrl",
    "resumeGenerationWebhookUrl",
    "jobPostingScrapeUrl",
    "atsScoringMode",
    "atsScoringServerUrl",
    "atsScoringWebhookUrl",
  ];

  function readStoredConfigOverrides() {
    try {
      const raw = localStorage.getItem(COMMAND_CENTER_CONFIG_OVERRIDE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      console.warn("[JobBored] Stored config overrides:", e);
      return {};
    }
  }

  function applyConfigOverridesToWindowConfig(overrides) {
    if (
      !window.COMMAND_CENTER_CONFIG ||
      typeof window.COMMAND_CENTER_CONFIG !== "object"
    ) {
      window.COMMAND_CENTER_CONFIG = {};
    }
    const base = window.COMMAND_CENTER_CONFIG;
    const src = overrides && typeof overrides === "object" ? overrides : {};
    for (const k of COMMAND_CENTER_OVERRIDE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(src, k) && src[k] != null) {
        base[k] = src[k];
      }
    }
  }

  function writeStoredConfigOverrides(overrides) {
    const next = overrides && typeof overrides === "object" ? overrides : {};
    localStorage.setItem(
      COMMAND_CENTER_CONFIG_OVERRIDE_KEY,
      JSON.stringify(next),
    );
    applyConfigOverridesToWindowConfig(next);
    return next;
  }

  function mergeStoredConfigOverridePatch(patch) {
    const next = {
      ...readStoredConfigOverrides(),
    };
    const src = patch && typeof patch === "object" ? patch : {};
    for (const k of COMMAND_CENTER_OVERRIDE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(src, k) && src[k] != null) {
        next[k] = src[k];
      }
    }
    return writeStoredConfigOverrides(next);
  }

  /** Merge values saved in this browser (localStorage) onto config from config.js. */
  function applyStoredConfigOverrides() {
    applyConfigOverridesToWindowConfig(readStoredConfigOverrides());
  }

  function readDiscoveryTransportSetupState() {
    try {
      const raw = localStorage.getItem(DISCOVERY_TRANSPORT_SETUP_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      console.warn("[JobBored] Discovery transport setup:", e);
      return {};
    }
  }

  function normalizeDiscoveryLocalWebhookUrl(raw) {
    const s = raw != null ? String(raw).trim() : "";
    if (!s) return "";
    try {
      const url = new URL(s);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      url.hash = "";
      url.search = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function normalizeDiscoveryTunnelPublicUrl(raw) {
    const s = raw != null ? String(raw).trim() : "";
    if (!s) return "";
    try {
      const url = new URL(s);
      if (url.protocol !== "https:") return "";
      url.hash = "";
      url.search = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function getDiscoveryTransportSetupState() {
    const raw = readDiscoveryTransportSetupState();
    return {
      localWebhookUrl: normalizeDiscoveryLocalWebhookUrl(raw.localWebhookUrl),
      tunnelPublicUrl: normalizeDiscoveryTunnelPublicUrl(raw.tunnelPublicUrl),
    };
  }

  function writeDiscoveryTransportSetupState(patch) {
    const current = readDiscoveryTransportSetupState();
    const src = patch && typeof patch === "object" ? patch : {};
    const next = {
      ...current,
    };

    if (Object.prototype.hasOwnProperty.call(src, "localWebhookUrl")) {
      next.localWebhookUrl = normalizeDiscoveryLocalWebhookUrl(
        src.localWebhookUrl,
      );
    }
    if (Object.prototype.hasOwnProperty.call(src, "tunnelPublicUrl")) {
      next.tunnelPublicUrl = normalizeDiscoveryTunnelPublicUrl(
        src.tunnelPublicUrl,
      );
    }

    localStorage.setItem(DISCOVERY_TRANSPORT_SETUP_KEY, JSON.stringify(next));
    return getDiscoveryTransportSetupState();
  }

  function isLocalDashboardOrigin() {
    if (typeof window === "undefined" || !window.location) return false;
    const hostName = String(window.location.hostname || "").toLowerCase();
    if (
      hostName === "localhost" ||
      hostName === "127.0.0.1" ||
      hostName === "[::1]" ||
      hostName === "::1"
    ) {
      return true;
    }
    const port = String(window.location.port || "");
    if (port === "8080") return true;
    return false;
  }

  /**
   * If discovery-local-bootstrap.json exposes a webhookSecret AND the user has
   * not already saved one in Settings, merge it into the stored config overrides
   * so verifyDiscoveryEndpoint will send `x-discovery-secret` automatically.
   *
   * This is the load-bearing piece of "super easy onboarding": after running
   * `npm run discovery:bootstrap-local`, the user reloads the dashboard and
   * Run discovery just works — no copy/paste of a hex string anywhere.
   */
  function getBootstrapDiscoveryWebhookSecret(data) {
    if (!data || typeof data !== "object") return "";
    const secret =
      typeof data.webhookSecret === "string" ? data.webhookSecret.trim() : "";
    return secret;
  }

  function isLikelyNgrokWebhookUrl(raw) {
    const s = raw != null ? String(raw).trim() : "";
    if (!s) return false;
    try {
      const url = new URL(s);
      return /(^|\.)ngrok(?:-free)?\.app$/i.test(url.hostname);
    } catch (_) {
      return /\.ngrok(?:-free)?\.app/i.test(s);
    }
  }

  function discoveryUrlOrigin(raw) {
    const normalized = host().normalizeDiscoveryWebhookIdentity(raw);
    if (!normalized) return "";
    try {
      return new URL(normalized).origin;
    } catch (_) {
      return "";
    }
  }

  function sameDiscoveryUrlOrigin(a, b) {
    const left = discoveryUrlOrigin(a);
    const right = discoveryUrlOrigin(b);
    return !!left && !!right && left === right;
  }

  function isBootstrapManagedDiscoveryEndpoint(data, endpointUrl) {
    if (!isLocalDashboardOrigin()) return false;
    const endpoint = host().normalizeDiscoveryWebhookIdentity(
      endpointUrl || host().getDiscoveryWebhookUrl(),
    );
    if (!endpoint) return true;
    if (
      host().isLocalWebhookCandidateUrl(endpoint) ||
      isLikelyNgrokWebhookUrl(endpoint)
    ) {
      return true;
    }

    const source = data && typeof data === "object" ? data : {};
    const localWebhookUrl = normalizeDiscoveryLocalWebhookUrl(
      source.localWebhookUrl,
    );
    const tunnelPublicUrl = normalizeDiscoveryTunnelPublicUrl(
      source.tunnelPublicUrl || source.ngrokPublicUrl,
    );
    const publicTargetUrl =
      host().normalizeDiscoveryWebhookIdentity(source.publicTargetUrl) ||
      host().normalizeDiscoveryWebhookIdentity(
        host().buildDiscoveryTunnelTargetUrl(localWebhookUrl, tunnelPublicUrl),
      );
    const relay =
      source.relay && typeof source.relay === "object" ? source.relay : null;
    const workerUrl = host().normalizeDiscoveryWebhookIdentity(
      relay && typeof relay.workerUrl === "string" ? relay.workerUrl : "",
    );
    const candidates = [localWebhookUrl, publicTargetUrl, workerUrl].filter(
      Boolean,
    );
    if (
      candidates.some(
        (candidate) =>
          host().normalizeDiscoveryWebhookIdentity(candidate) === endpoint ||
          sameDiscoveryUrlOrigin(candidate, endpoint),
      )
    ) {
      return true;
    }

    const workerName =
      typeof source.workerName === "string" ? source.workerName.trim() : "";
    if (
      workerName &&
      host().inferCloudflareWorkerNameFromOpenWorkerUrl(endpoint) === workerName
    ) {
      return true;
    }
    return false;
  }

  function writeDiscoveryWebhookSecretOverride(secret) {
    if (!secret) return false;
    try {
      mergeStoredConfigOverridePatch({ discoveryWebhookSecret: secret });
      const field = document.getElementById("settingsDiscoveryWebhookSecret");
      if (field && typeof field.value === "string") {
        field.value = secret;
      }
      return true;
    } catch (err) {
      console.warn(
        "[JobBored] could not autofill discoveryWebhookSecret from bootstrap:",
        err,
      );
      return false;
    }
  }

  function autofillDiscoveryWebhookSecretFromBootstrap(data, options = {}) {
    const secret = getBootstrapDiscoveryWebhookSecret(data);
    if (!secret) return false;
    const endpointUrl =
      options && typeof options.endpointUrl === "string"
        ? options.endpointUrl
        : host().getDiscoveryWebhookUrl();
    const existing = host().getDiscoveryWebhookSecret();
    if (existing === secret) return true;
    const shouldRefresh =
      !existing || isBootstrapManagedDiscoveryEndpoint(data, endpointUrl);
    if (!shouldRefresh) return false;
    return writeDiscoveryWebhookSecretOverride(secret);
  }

  async function refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(
    endpointUrl,
  ) {
    if (!isLocalDashboardOrigin()) return "";
    try {
      const res = await fetch(DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH, {
        cache: "no-store",
      });
      if (!res.ok) return "";
      const data = await res.json().catch(() => null);
      const secret = getBootstrapDiscoveryWebhookSecret(data);
      if (!secret) return "";
      if (!isBootstrapManagedDiscoveryEndpoint(data, endpointUrl)) return "";
      autofillDiscoveryWebhookSecretFromBootstrap(data, { endpointUrl });
      return host().getDiscoveryWebhookSecret() === secret ? secret : "";
    } catch (_) {
      return "";
    }
  }

  // ====== [discovery-autodetect lane: relay URL auto-fill] ======
  // After scripts/deploy-cloudflare-relay.mjs deploys the Cloudflare Worker
  // it writes a `relay` block into discovery-local-bootstrap.json with the
  // deployed Worker URL. This sibling of the secret autofill copies that URL
  // into the discoveryWebhookUrl config setting so the dashboard's wizard
  // shows it pre-filled. Greenfield user goal: zero copy/paste of the
  // Worker URL anywhere, ever.
  //
  // Same conservative semantics as autofillDiscoveryWebhookSecretFromBootstrap:
  //   - never overwrite a manually-saved value
  //   - silently no-op if the field is missing or empty
  //   - never throws; logs and returns false on failure
  function autofillDiscoveryWebhookUrlFromBootstrap(data) {
    if (!data || typeof data !== "object") return false;
    const relay = data.relay;
    const candidate =
      relay && typeof relay === "object" && typeof relay.workerUrl === "string"
        ? relay.workerUrl.trim()
        : "";
    if (!candidate) return false;
    if (!/^https?:\/\//i.test(candidate)) return false;
    const existing = host().getDiscoveryWebhookUrl();
    if (existing) return false; // never overwrite a manually-saved value
    try {
      mergeStoredConfigOverridePatch({ discoveryWebhookUrl: candidate });
      return true;
    } catch (err) {
      console.warn(
        "[JobBored] could not autofill discoveryWebhookUrl from bootstrap:",
        err,
      );
      return false;
    }
  }
  // ====== [/discovery-autodetect lane] ======

  async function hydrateDiscoveryTransportSetupFromLocalBootstrap() {
    if (!isLocalDashboardOrigin()) return getDiscoveryTransportSetupState();
    try {
      const res = await fetch(DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH, {
        cache: "no-store",
      });
      if (!res.ok) return getDiscoveryTransportSetupState();
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") {
        return getDiscoveryTransportSetupState();
      }
      autofillDiscoveryWebhookSecretFromBootstrap(data, {
        endpointUrl: host().getDiscoveryWebhookUrl(),
      });
      autofillDiscoveryWebhookUrlFromBootstrap(data);
      return writeDiscoveryTransportSetupState({
        localWebhookUrl: data.localWebhookUrl,
        tunnelPublicUrl: data.tunnelPublicUrl || data.ngrokPublicUrl,
      });
    } catch (_) {
      return getDiscoveryTransportSetupState();
    }
  }

  applyStoredConfigOverrides();

  Object.assign(configOverrides, {
    COMMAND_CENTER_CONFIG_OVERRIDE_KEY,
    DISCOVERY_TRANSPORT_SETUP_KEY,
    DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH,
    COMMAND_CENTER_OVERRIDE_KEYS,
    readStoredConfigOverrides,
    applyConfigOverridesToWindowConfig,
    writeStoredConfigOverrides,
    mergeStoredConfigOverridePatch,
    applyStoredConfigOverrides,
    readDiscoveryTransportSetupState,
    normalizeDiscoveryLocalWebhookUrl,
    normalizeDiscoveryTunnelPublicUrl,
    getDiscoveryTransportSetupState,
    writeDiscoveryTransportSetupState,
    isLocalDashboardOrigin,
    getBootstrapDiscoveryWebhookSecret,
    isLikelyNgrokWebhookUrl,
    discoveryUrlOrigin,
    sameDiscoveryUrlOrigin,
    isBootstrapManagedDiscoveryEndpoint,
    writeDiscoveryWebhookSecretOverride,
    autofillDiscoveryWebhookSecretFromBootstrap,
    refreshDiscoveryWebhookSecretFromBootstrapForEndpoint,
    autofillDiscoveryWebhookUrlFromBootstrap,
    hydrateDiscoveryTransportSetupFromLocalBootstrap,
  });
})();
