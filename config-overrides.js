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
  const DISCOVERY_WEBHOOK_SECRET_ROUTE = "/__proxy/discovery-webhook-secret";

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
    // Security: both base URLs feed fetch() with the Bearer API key attached;
    // resume-generate.js's assertSafeBaseUrl rejects anything that isn't
    // https:// or http://127.0.0.1|localhost. settings-modal.js validates at
    // write-time; the request-time check is the load-bearing gate.
    "resumeOpenRouterBaseUrl",
    "resumeLocalBaseUrl",
    "resumeLocalModel",
    "resumeLocalApiKey",
    "resumeGenerationWebhookUrl",
    "jobPostingScrapeUrl",
    "atsScoringMode",
    "atsScoringServerUrl",
    "atsScoringWebhookUrl",
  ];

  // Credential + connection keys a "greenfield reset" must neutralize. These
  // are the values that make an install look "configured" and gate the
  // onboarding steps (sheet, sign-in, AI provider, discovery). Structural
  // defaults — resumeProvider, model names, base URLs, atsScoringMode, title —
  // are deliberately NOT here: blanking them would break post-onboarding
  // generation (e.g. an empty model name) without affecting whether onboarding
  // shows. isResumeGenerationConfigured() gates on the API key, not the model,
  // so masking the key alone is enough to re-arm the provider step.
  const GREENFIELD_CREDENTIAL_KEYS = [
    "sheetId",
    "oauthClientId",
    "discoveryWebhookUrl",
    "discoveryWebhookSecret",
    "resumeGeminiApiKey",
    "resumeOpenAIApiKey",
    "resumeAnthropicApiKey",
    "resumeOpenRouterApiKey",
    "resumeLocalApiKey",
    "resumeGenerationWebhookUrl",
    "jobPostingScrapeUrl",
    "atsScoringServerUrl",
    "atsScoringWebhookUrl",
  ];

  /**
   * Empty-string override mask that out-merges config.js bake-ins so the app
   * boots cold-start (login gate in no-oauth mode + first-run wizard) with no
   * saved credentials. Empty strings (not deletes) are required: merely
   * removing overrides lets config.js's values flow back on reload. Connecting
   * a sheet / entering a key later overwrites the mask via
   * mergeStoredConfigOverridePatch.
   */
  function buildGreenfieldOverrideMask() {
    const mask = {};
    for (const k of GREENFIELD_CREDENTIAL_KEYS) mask[k] = "";
    return mask;
  }

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

  /**
   * True when the endpoint is THIS machine's discovery worker — the only
   * endpoint whose secret the local dev server is entitled to hand out.
   *
   * Without this binding the self-heal fetched the local worker's secret on a
   * 401 from ANY non-Cloudflare endpoint — a recycled ngrok host, a dead
   * relay, someone else's n8n or Apps Script receiver — POSTed it there, and
   * overwrote the secret the user had saved for the real endpoint. A 401 is
   * not proof that the responder is ours.
   *
   * A Cloudflare relay is excluded on top: it injects its own DISCOVERY_SECRET
   * upstream, so the browser's copy is not what that worker checks.
   */
  function isThisMachinesWorkerEndpoint(endpoint) {
    const url = String(endpoint || "").trim();
    if (!url) return true; // no endpoint yet — the local worker is the default
    const h = host();
    try {
      if (
        typeof h.isLikelyCloudflareWorkerUrl === "function" &&
        h.isLikelyCloudflareWorkerUrl(url)
      ) {
        return false;
      }
    } catch (_) {
      /* an unclassifiable URL is decided by the checks below */
    }
    try {
      if (
        typeof h.isLocalWebhookCandidateUrl === "function" &&
        h.isLocalWebhookCandidateUrl(url)
      ) {
        return true;
      }
    } catch (_) {
      /* fall through */
    }
    // A tailnet name is this machine published by Tailscale (Beat 5's path).
    try {
      if (/(^|\.)ts\.net$/i.test(new URL(url).hostname)) return true;
    } catch (_) {
      /* not a parseable URL */
    }
    // Anything the transport state recorded as our own local/tunnel endpoint.
    const transport = readDiscoveryTransportSetupState();
    for (const candidate of [
      transport.localWebhookUrl,
      transport.tunnelPublicUrl,
      transport.ngrokPublicUrl,
      transport.publicTargetUrl,
    ]) {
      if (candidate && sameDiscoveryUrlOrigin(candidate, url)) return true;
    }
    return false;
  }

  /**
   * The 401 self-heal. `discovery-local-bootstrap.json` carries the secret,
   * so the static-path guard denies it (#75) — every browser got a 403 and
   * this refresh never refreshed anything (2026-09-02). The dev server
   * resolves the same secret behind the origin-guarded route Beat 5 already
   * uses, so a run that 401s against this machine's worker re-syncs from
   * there and retries. A relay is left alone; a fetch that fails is "".
   */
  async function refreshDiscoveryWebhookSecretFromBootstrapForEndpoint(
    endpointUrl,
  ) {
    if (!isLocalDashboardOrigin()) return "";
    const endpoint = endpointUrl || host().getDiscoveryWebhookUrl();
    // Only this machine's worker gets this machine's secret.
    if (!isThisMachinesWorkerEndpoint(endpoint)) return "";
    try {
      const res = await fetch(DISCOVERY_WEBHOOK_SECRET_ROUTE, {
        cache: "no-store",
      });
      if (!res || !res.ok) return "";
      const data = await res.json().catch(() => null);
      const secret =
        data && data.ok && typeof data.secret === "string"
          ? data.secret.trim()
          : "";
      if (!secret) return "";
      if (host().getDiscoveryWebhookSecret() !== secret) {
        if (!writeDiscoveryWebhookSecretOverride(secret)) return "";
      }
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

  /** The cold-start switch and its two aliases, in one place. */
  const GREENFIELD_URL_PARAMS = ["greenfield", "fresh", "reset"];

  /**
   * Dev/dogfooding greenfield: `?greenfield=1` (aliases ?fresh=1, ?reset=1)
   * forces a cold-start install in ANY browser — incognito, a fresh profile,
   * or one whose config.js bakes in a sheetId / oauthClientId / API keys. The
   * Clear-settings button can only mask localStorage in the browser it runs in;
   * this param works cross-browser because it neutralizes config.js in-session.
   *
   * It clears JobBored's localStorage breadcrumbs, persists the greenfield mask
   * (so reloads within the session stay cold-start without re-adding the param),
   * and best-effort drops the IndexedDB user-content store. Runs BEFORE
   * applyStoredConfigOverrides so the mask is what lands on COMMAND_CENTER_CONFIG.
   *
   * The param is spent once it has been applied: it is stripped from the URL so
   * a refresh mid-setup resumes at the saved beat instead of dropping the
   * IndexedDB store again and landing back on cold start (ONE-FLOW spec §3.4
   * "reopening or refreshing lands on onboardingFlowState.beat"). The persisted
   * mask is what carries the cold start across reloads — the param does not
   * need to, and re-running it costs the user their progress.
   */
  function maybeApplyGreenfieldUrlReset() {
    let on = false;
    try {
      const params = new URLSearchParams(window.location.search);
      on = GREENFIELD_URL_PARAMS.some((param) => params.get(param) === "1");
    } catch (_) {
      return false;
    }
    if (!on) return false;
    try {
      localStorage.removeItem("command_center_oauth_session");
      localStorage.removeItem("command_center_oauth_runtime");
      localStorage.removeItem(DISCOVERY_TRANSPORT_SETUP_KEY);
      localStorage.removeItem("command_center_discovery_run_tracker");
      writeStoredConfigOverrides(buildGreenfieldOverrideMask());
      // Force Google's consent screen on the next sign-in so a lingering grant
      // can't silently re-auth past the greenfield gate.
      localStorage.setItem("command_center_force_consent_prompt", "1");
    } catch (_) {
      // No localStorage (some incognito modes): still neutralize config.js for
      // this session so onboarding shows, even if it can't persist.
      applyConfigOverridesToWindowConfig(buildGreenfieldOverrideMask());
    }
    try {
      if (window.indexedDB && typeof indexedDB.deleteDatabase === "function") {
        indexedDB.deleteDatabase("command-center-user-content");
      }
    } catch (_) {
      /* best-effort — openDb recreates an empty schema */
    }
    try {
      // Clear the session-only "Later" snooze (whats-next-banner.js
      // SESSION_SNOOZE_KEY) so a snoozed setup bar doesn't survive a "fresh"
      // greenfield reset within the same tab.
      sessionStorage.removeItem("jobbored.whatsNext.snoozed");
    } catch (_) {
      /* sessionStorage unavailable → best-effort */
    }
    stripGreenfieldUrlParams();
    return true;
  }

  /**
   * Take greenfield/fresh/reset back out of the address bar, leaving every
   * other param, the path, and the hash alone. replaceState rather than a
   * navigation: the reset has already run in this document, and a reload here
   * would be the very re-reset this is removing.
   */
  function stripGreenfieldUrlParams() {
    try {
      const url = new URL(window.location.href);
      for (const param of GREENFIELD_URL_PARAMS) url.searchParams.delete(param);
      const next = `${url.pathname}${url.search}${url.hash}`;
      if (window.history && typeof window.history.replaceState === "function") {
        window.history.replaceState(null, "", next);
      }
    } catch (e) {
      // No History API (file://, some embedded webviews): the reset still
      // applied — the user just keeps a spent param in the bar.
      console.warn("[JobBored] greenfield URL cleanup:", e);
    }
  }

  maybeApplyGreenfieldUrlReset();
  applyStoredConfigOverrides();

  Object.assign(configOverrides, {
    COMMAND_CENTER_CONFIG_OVERRIDE_KEY,
    DISCOVERY_TRANSPORT_SETUP_KEY,
    DISCOVERY_LOCAL_BOOTSTRAP_STATE_PATH,
    COMMAND_CENTER_OVERRIDE_KEYS,
    GREENFIELD_CREDENTIAL_KEYS,
    previewDestructiveReset() {
      const writes = GREENFIELD_CREDENTIAL_KEYS.map((key) => ({
        store: "config_overrides",
        key,
        value: "",
      }));
      return {
        writes,
        deletes: [],
        includesResumes: false,
        includesDrafts: false,
        includesOAuth: false,
        includesConsent: false,
      };
    },
    buildGreenfieldOverrideMask,
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
