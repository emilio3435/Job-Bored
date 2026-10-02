/* ============================================
   COMMAND CENTER v2 — Discovery Status Handoff
   Extracted from app.js (discovery-status-handoff cut).

   Classic-global IIFE under window.JobBoredDiscovery.status — NOT an ES module.
   Loaded BEFORE app.js. Downstream diagnosis, deploy status, pending setup
   handoff, and async run-status polling. Uses runTracker via lazy host.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const status = root.status || (root.status = {});

  function host() {
    return status.host;
  }

  function runTracker() {
    return window.JobBoredDiscovery.runTracker.discoveryRunTracker;
  }

  function configCore() {
    return host().getConfigCore();
  }

function isManagedAppsScriptDeployState(state) {
  return !!(
    state &&
    typeof state === "object" &&
    String(state.managedBy || "") === configCore().APPS_SCRIPT_MANAGED_BY &&
    String(state.scriptId || "").trim()
  );
}

function isAppsScriptPublicAccessReady(state) {
  if (!isManagedAppsScriptDeployState(state)) return false;
  const status = String(state.publicAccessState || "").trim();
  if (!status) {
    return !!String(state.webAppUrl || "").trim();
  }
  return status === configCore().APPS_SCRIPT_PUBLIC_ACCESS_READY;
}

function getAppsScriptEditorUrl(scriptId) {
  const id = String(scriptId || "").trim();
  if (!id) return "";
  return `https://script.google.com/home/projects/${encodeURIComponent(id)}/edit`;
}

function formatAppsScriptWebAppAccessLabel(raw) {
  switch (String(raw || "").trim()) {
    case "ANYONE_ANONYMOUS":
      return "Anyone";
    case "ANYONE":
      return "Anyone with Google account";
    case "DOMAIN":
      return "Anyone in your Google Workspace domain";
    case "MYSELF":
      return "Only me";
    default:
      return raw ? String(raw).trim() : "unknown";
  }
}

function formatAppsScriptExecuteAsLabel(raw) {
  switch (String(raw || "").trim()) {
    case "USER_DEPLOYING":
      return "Me";
    case "USER_ACCESSING":
      return "User accessing the web app";
    default:
      return raw ? String(raw).trim() : "unknown";
  }
}

function buildAppsScriptPublicAccessRemediationStatus(options) {
  const o = options && typeof options === "object" ? options : {};
  const scriptId = String(o.scriptId || "").trim();
  const webAppUrl = String(o.webAppUrl || "").trim();
  const deploymentAccess = String(o.deploymentAccess || "").trim();
  const deploymentExecuteAs = String(o.deploymentExecuteAs || "").trim();
  const failureKind = String(o.failureKind || "").trim();

  const accessLabel = formatAppsScriptWebAppAccessLabel(deploymentAccess);
  const executeAsLabel = formatAppsScriptExecuteAsLabel(deploymentExecuteAs);

  let detail =
    "JobBored needs anonymous access to this web app before it can use the URL or Cloudflare relay.";

  if (deploymentAccess && deploymentAccess !== configCore().APPS_SCRIPT_WEBAPP_ACCESS) {
    detail = `Google has “Who has access” set to ${accessLabel}, not “Anyone.” Change it in Deploy → Manage deployments.`;
  } else if (
    deploymentExecuteAs &&
    deploymentExecuteAs !== configCore().APPS_SCRIPT_WEBAPP_EXECUTE_AS
  ) {
    detail = `Google has “Execute as” set to ${executeAsLabel}, not “Me.” Change it in Deploy → Manage deployments.`;
  } else if (failureKind === "probe") {
    detail =
      "Google says the deployment is public, but an anonymous check still failed. Re-save the deployment or run the script once in the editor and approve access.";
  }

  const steps = [
    "Apps Script → Deploy → Manage deployments → edit the web app: Execute as “Me”, Who has access “Anyone”, then Save.",
    "Click Re-check public access below.",
  ];

  const actions = [];
  const editorUrl = getAppsScriptEditorUrl(scriptId);
  if (editorUrl) {
    actions.push({ label: "Open Apps Script project", href: editorUrl });
  }
  if (webAppUrl) {
    actions.push({
      label: "Open web app URL",
      href: webAppUrl,
      primary: true,
    });
  }

  return {
    tone: "error",
    message: "Web app isn’t publicly reachable yet",
    detail,
    steps,
    actions,
  };
}

function openAppsScriptRemediationFlowInSettings() {
  const details = document.getElementById("settingsAppsScriptDetails");
  if (details) details.open = true;
  const statusCard = document.getElementById("settingsAppsScriptStatus");
  if (statusCard && typeof statusCard.scrollIntoView === "function") {
    statusCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function showAppsScriptPublicAccessRemediationFromState() {
  const state = configCore().appsScriptDeployStateCache;
  if (!isManagedAppsScriptDeployState(state)) return false;
  if (isAppsScriptPublicAccessReady(state)) return false;

  const status = buildAppsScriptPublicAccessRemediationStatus({
    scriptId: state.scriptId,
    webAppUrl: state.webAppUrl,
    deploymentAccess: state.deploymentAccess || state.access,
    deploymentExecuteAs: state.deploymentExecuteAs || state.executeAs,
    failureKind: state.publicAccessIssue,
  });
  setAppsScriptDeployStatus(status.tone, status.message, status.detail, {
    actions: status.actions,
    steps: status.steps,
  });
  openAppsScriptRemediationFlowInSettings();
  return true;
}

/**
 * Hostname of a saved webhook that points at a genuinely remote https
 * endpoint (Tailscale *.ts.net, Cloudflare *.workers.dev, any other
 * non-local https URL). Returns "" for local/ngrok URLs so the tunnel
 * remediation keeps applying to tunnel-style setups.
 */
function getRemoteDiscoveryWebhookHost(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return "";
  let parsed;
  try {
    parsed = new URL(s);
  } catch (_) {
    return "";
  }
  if (parsed.protocol !== "https:") return "";
  const hostname = String(parsed.hostname || "");
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1") {
    return "";
  }
  // An ngrok webhook IS the tunnel — keep the ngrok remediation for it.
  if (isLikelyNgrokUrl(s)) return "";
  return hostname;
}

function getDiscoveryTunnelOrigin(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.host) return "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_) {
    return "";
  }
}

async function diagnoseDownstreamChain(snapshot) {
  const probes = host().getDiscoveryWizardProbesApi();
  const diagnosis = {
    ran: true,
    timestamp: new Date().toISOString(),
    localServer: { status: "unknown", url: "", healthy: false },
    tunnel: { status: "unknown", url: "", active: false, stale: false },
    relay: { status: "unknown", targetMismatch: false },
    summary: "",
    primaryFix: null,
    redeployCommand: "",
    redeployTargetUrl: "",
  };

  const transport =
    probes && typeof probes.readDiscoveryTransportSetupState === "function"
      ? probes.readDiscoveryTransportSetupState()
      : {};
  const localUrl = snapshot.localWebhookUrl || transport.localWebhookUrl || "";
  diagnosis.localServer.url = localUrl;

  // Honest remediation routing: only setups that actually use a tunnel should
  // ever be told to fix ngrok. "Uses a tunnel" is decided from a real tunnel
  // URL, or from the saved webhook's own kind (getRemoteDiscoveryWebhookHost
  // returns "" for an ngrok webhook, which IS the tunnel) — never from the
  // mere presence of a local webhook URL. scripts/bootstrap-local-discovery.mjs
  // writes localWebhookUrl for EVERY local worker, Tailscale included, so
  // reading it as "there is a tunnel" pointed Tailscale users at an ngrok
  // tunnel they do not have.
  const savedWebhookUrl = String(
    snapshot.savedWebhookUrl || host().getDiscoveryWebhookUrl() || "",
  ).trim();
  const usesTunnelTransport = !!(
    snapshot.tunnelPublicUrl || transport.tunnelPublicUrl
  );
  const remoteWebhookHost = usesTunnelTransport
    ? ""
    : getRemoteDiscoveryWebhookHost(savedWebhookUrl);

  if (localUrl && probes && typeof probes.probeHealthUrl === "function") {
    const healthUrl = probes.buildLocalHealthUrl
      ? probes.buildLocalHealthUrl(localUrl)
      : localUrl.replace(/\/[^/]*$/, "/health");
    diagnosis.localServer.healthy = await probes.probeHealthUrl(healthUrl);
    diagnosis.localServer.status = diagnosis.localServer.healthy
      ? "running"
      : "unreachable";
  } else if (!localUrl) {
    diagnosis.localServer.status = "not_configured";
  }

  if (probes && typeof probes.probeNgrokTunnels === "function") {
    const liveNgrokUrl = await probes.probeNgrokTunnels();
    diagnosis.tunnel.url = liveNgrokUrl;
    diagnosis.tunnel.active = !!liveNgrokUrl;
    if (liveNgrokUrl && snapshot.tunnelPublicUrl) {
      const liveOrigin = getDiscoveryTunnelOrigin(liveNgrokUrl);
      const savedOrigin = getDiscoveryTunnelOrigin(snapshot.tunnelPublicUrl);
      diagnosis.tunnel.stale =
        !liveOrigin || !savedOrigin || liveOrigin !== savedOrigin;
    }
    diagnosis.tunnel.status = liveNgrokUrl
      ? diagnosis.tunnel.stale
        ? "stale_url"
        : "active"
      : "not_running";
  }

  if (
    snapshot.relayTargetUrl &&
    diagnosis.tunnel.active &&
    diagnosis.tunnel.url
  ) {
    const savedTargetOrigin = getDiscoveryTunnelOrigin(
      snapshot.relayTargetUrl,
    );
    const liveOrigin = getDiscoveryTunnelOrigin(diagnosis.tunnel.url);
    if (!savedTargetOrigin || savedTargetOrigin !== liveOrigin) {
      diagnosis.relay.targetMismatch = true;
    }
    diagnosis.relay.status = diagnosis.relay.targetMismatch
      ? "target_stale"
      : "ok";
  }

  if (diagnosis.localServer.status === "unreachable") {
    diagnosis.summary = "Local server is down.";
    diagnosis.primaryFix = {
      id: "diag_fix_local_server",
      label: "Start server",
      detail:
        "Attempts to start the recommended local browser-use worker automatically.",
    };
  } else if (remoteWebhookHost) {
    // A healthy local worker is a different story from a missing one: the
    // hop that is actually broken is the stable transport in front of it
    // (e.g. `tailscale serve`), so say that instead of blaming the worker.
    diagnosis.summary = diagnosis.localServer.healthy
      ? `Your local worker is running, but ${remoteWebhookHost} is not reachable. ` +
        "Check that the stable transport in front of it is up and that the " +
        "saved URL in your connection settings is current, then re-test."
      : `Your discovery worker at ${remoteWebhookHost} is unreachable. ` +
        "Check that the machine running it is awake and that the saved URL " +
        "in your connection settings is current, then re-test.";
    diagnosis.primaryFix = {
      id: "diag_fix_reverify",
      label: "Re-test",
      detail: `Re-run the connection test against ${remoteWebhookHost}.`,
    };
  } else if (diagnosis.tunnel.status === "not_running") {
    diagnosis.summary = "ngrok tunnel is not running.";
    diagnosis.primaryFix = {
      id: "diag_fix_tunnel",
      label: "Fix tunnel",
      detail: "Go to the tunnel step to start ngrok.",
    };
  } else if (diagnosis.tunnel.stale || diagnosis.relay.targetMismatch) {
    const liveRaw = diagnosis.tunnel.url || "";
    const liveNorm = liveRaw.replace(/\/+$/, "") || "unknown";
    const liveOrigin = getDiscoveryTunnelOrigin(liveRaw);
    let oldDisplay = "";
    if (diagnosis.relay.targetMismatch && snapshot.relayTargetUrl) {
      const relayOrig = getDiscoveryTunnelOrigin(snapshot.relayTargetUrl);
      if (relayOrig && liveOrigin && relayOrig !== liveOrigin) {
        oldDisplay = relayOrig;
      }
    }
    if (
      !oldDisplay &&
      diagnosis.tunnel.stale &&
      snapshot.tunnelPublicUrl &&
      liveOrigin
    ) {
      const pubOrig = getDiscoveryTunnelOrigin(snapshot.tunnelPublicUrl);
      if (pubOrig && pubOrig !== liveOrigin) {
        oldDisplay = snapshot.tunnelPublicUrl.replace(/\/+$/, "");
      }
    }
    if (!oldDisplay) {
      oldDisplay =
        snapshot.tunnelPublicUrl ||
        (snapshot.relayTargetUrl
          ? getDiscoveryTunnelOrigin(snapshot.relayTargetUrl)
          : "") ||
        "unknown";
    }
    diagnosis.summary = `ngrok URL changed \u2014 relay needs redeployment.\nOld: ${oldDisplay}\nLive: ${liveNorm}`;
    diagnosis.liveNgrokUrl = liveNorm;
    const onLocalhost =
      typeof window !== "undefined" &&
      window.location &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "[::1]" ||
        window.location.hostname === "::1");
    diagnosis.primaryFix = {
      id: "diag_fix_update_tunnel_and_relay",
      label: onLocalhost
        ? "Auto-fix: redeploy relay & re-test"
        : "Update tunnel & save ngrok, then redeploy",
      detail: onLocalhost
        ? "One click. Calls the local helper to redeploy the relay against the live ngrok URL, then re-runs the test."
        : "Click to save the Live ngrok URL, then run the deploy command shown below from your Job-Bored repo (same Worker name = update in place).",
    };

    if (liveNorm && liveNorm !== "unknown") {
      const relayApi = host().getDiscoveryWizardRelayApi();
      let redeployTarget = host().buildDiscoveryTunnelTargetUrl(
        snapshot.localWebhookUrl,
        liveNorm,
      );
      if (
        !redeployTarget &&
        relayApi &&
        typeof relayApi.buildDownstreamTargetUrl === "function"
      ) {
        const patched = {
          ...snapshot,
          tunnelPublicUrl: liveNorm,
          relayTargetUrl: "",
        };
        redeployTarget = relayApi.buildDownstreamTargetUrl(patched, {}) || "";
      }
      diagnosis.redeployTargetUrl = redeployTarget;
      const workerUrl =
        snapshot.savedWebhookUrl || host().getDiscoveryWebhookUrl() || "";
      const explicitWorker =
        host().inferCloudflareWorkerNameFromOpenWorkerUrl(workerUrl);
      const workerName =
        explicitWorker || host().getSuggestedCloudflareRelayWorkerName(redeployTarget);
      const sheetId = host().getSettingsSheetIdValue() || "";
      if (redeployTarget) {
        diagnosis.redeployCommand = host().buildDiscoveryRelayDeployCommandForTarget(
          redeployTarget,
          {
            origin: host().getDiscoveryRelaySuggestedOrigin(),
            workerName,
            workerUrl,
            sheetId,
          },
        );
      }
    }
  } else if (
    diagnosis.localServer.healthy &&
    diagnosis.tunnel.active &&
    !diagnosis.relay.targetMismatch
  ) {
    diagnosis.summary =
      "Everything looks connected — may have been a temporary issue.";
    diagnosis.primaryFix = {
      id: "diag_fix_reverify",
      label: "Try again",
      detail: "Re-run the test to see if it passes now.",
    };
  } else {
    diagnosis.summary =
      "Couldn't pinpoint the issue. Fix the first red item below.";
  }

  return diagnosis;
}

function setAppsScriptDeployStatus(tone, message, detail) {
  const extra = arguments.length > 3 ? arguments[3] : null;
  const actions = Array.isArray(extra)
    ? extra
    : extra && typeof extra === "object" && Array.isArray(extra.actions)
      ? extra.actions
      : [];
  const steps =
    extra && typeof extra === "object" && Array.isArray(extra.steps)
      ? extra.steps.map((step) => String(step || "").trim()).filter(Boolean)
      : [];
  configCore().appsScriptDeployStatus = {
    tone: tone || "info",
    message: String(message || ""),
    detail: detail ? String(detail) : "",
    steps,
    actions: actions
      .map((action) => ({
        label:
          action && action.label != null ? String(action.label).trim() : "",
        href: action && action.href != null ? String(action.href).trim() : "",
        primary: !!(action && action.primary),
      }))
      .filter((action) => action.label && action.href),
  };
  host().renderAppsScriptDeployUi();
}

function clearAppsScriptDeployStatus() {
  configCore().appsScriptDeployStatus = null;
  host().renderAppsScriptDeployUi();
}

function stripSetupDiscoveryParam() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup") !== "discovery") return;
  params.delete("setup");
  const q = params.toString();
  const path =
    window.location.pathname + (q ? "?" + q : "") + window.location.hash;
  history.replaceState(null, "", path);
}

function focusDiscoveryWebhookFieldInSettings() {
  const Adapters = window.JobBoredSettingsDiscoveryAdapters;
  if (Adapters) {
    Adapters.focusDiscoveryWebhookField();
    return;
  }
  const el = document.getElementById("settingsDiscoveryWebhookUrl");
  if (!el) return;
  el.focus();
  if (typeof el.select === "function") el.select();
}

async function openSettingsForDiscoveryWebhook() {
  return requestDiscoverySetup({
    entryPoint: "settings",
    flow: host().getDiscoveryWizardRecommendedFlow(host().getDiscoveryReadinessSnapshot()),
    allowWhileOnboarding: true,
  });
}

async function requestDiscoverySetup(options = {}) {
  const {
    stripSetupParam = false,
    allowWhileOnboarding = false,
    ...wizardOptions
  } = options;
  // The one-flow is the onboarding surface (spec §3), and its Beat 5 IS
  // discovery setup — opening the standalone wizard over the flow shell
  // would strand the beat behind it. The two legacy wizards this also used
  // to ask about are deleted (§7).
  // Deferring is the whole answer: the sessionStorage queue this used to
  // write had a writer and no caller for its resumer
  // (ONE-FLOW-ONBOARDING-SPEC §7). Beat 5 IS discovery setup, so there is
  // nothing to resume TO once the flow has the surface.
  if (isOneFlowOpen() && !allowWhileOnboarding) {
    if (stripSetupParam) {
      stripSetupDiscoveryParam();
    }
    return { deferred: true };
  }
  await host().openDiscoverySetupWizard(wizardOptions);
  if (stripSetupParam) {
    stripSetupDiscoveryParam();
  }
  return { deferred: false };
}

// ============================================
// DISCOVERY RUN STATUS POLLING
// ============================================

const MAX_POLL_ERRORS = 3;
const STATUS_POLL_DEBOUNCE_MS = 500;

// D2: the one poll loop this tab runs (see startDiscoveryStatusPolling).
let activePollLoop = null;

// A /runs/:id answer is either transient (worth another poll) or settled
// (the endpoint will never report this run). Burning three retries on a 404
// and then telling the user "the run may still be running" is a false
// statement, so the two cases are separated before any retry is spent.
const TERMINAL_RUN_STATUS_POLL_CODES = [401, 403, 404, 405, 410];

/**
 * Classify a run-status poll response by HTTP status. Only codes we can prove
 * are settled stop the poller; network failures (0 / non-numeric), the
 * transient codes (408/425/429/5xx) and anything unclassified stay retryable.
 * @param {number} status  HTTP status; 0 or non-numeric means a network failure
 * @returns {"ok"|"retryable"|"terminal"}
 */
function classifyRunStatusPollResponse(status) {
  const code = Number(status);
  if (!Number.isFinite(code)) return "retryable";
  if (code >= 200 && code < 300) return "ok";
  if (TERMINAL_RUN_STATUS_POLL_CODES.includes(code)) return "terminal";
  return "retryable";
}

/** Honest, hop-naming copy for a status endpoint that has settled. */
function describeTerminalRunStatusPoll(status) {
  const code = Number(status);
  const tail =
    "Status updates have stopped \u2014 check Runs or your sheet for the outcome.";
  if (code === 401 || code === 403) {
    return `The status endpoint rejected this run's status token (HTTP ${code}). ${tail}`;
  }
  if (code === 404 || code === 410) {
    return `The worker has no record of this run (HTTP ${code}). ${tail}`;
  }
  return `The status endpoint cannot report this run (HTTP ${code}). ${tail}`;
}

/**
 * Build the full status URL from a relative statusPath.
 * Handles explicit statusPath or constructs from runId + base webhook URL.
 * @param {string} statusPath  e.g. "/runs/run_abc" or "/runs/run_abc?worker=local"
 * @param {string} webhookUrl  the configured discovery webhook base URL
 * @returns {string}  fully qualified status fetch URL
 */
function buildRunStatusUrl(statusPath, webhookUrl) {
  const path = String(statusPath || "").trim();
  if (!path) return "";
  try {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }
    const base = new URL(String(webhookUrl || ""));
    if (path.startsWith("/")) {
      return new URL(path, base.origin).toString();
    }
    const baseDir = base.href.endsWith("/")
      ? base.href
      : base.href.replace(/\/[^/]*$/, "/");
    return new URL(path, baseDir).toString();
  } catch (_) {
    return "";
  }
}

function canSynthesizeRunStatusPath(webhookUrl) {
  const normalized = host().normalizeDiscoveryWebhookIdentity(webhookUrl);
  if (!normalized) return false;
  return host().isLocalWebhookCandidateUrl(normalized);
}

function resolveAcceptedRunStatusPath(result, webhookUrl) {
  const explicit = String(
    (result && (result.statusPath || result.status_path)) || "",
  ).trim();
  if (explicit) return explicit;
  const runId = String((result && result.runId) || "").trim();
  if (!runId || !canSynthesizeRunStatusPath(webhookUrl)) return "";
  return "/runs/" + encodeURIComponent(runId);
}

function isLikelyNgrokUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  try {
    const url = new URL(s);
    return /(^|\.)ngrok(?:-free)?\.app$/i.test(url.hostname);
  } catch (_) {
    return /ngrok(?:-free)?\.app/i.test(s);
  }
}

function getDiscoveryStatusPollingWebhookUrl(webhookUrl) {
  const fallback = host().normalizeDiscoveryWebhookIdentity(webhookUrl);
  if (!host().isLocalDashboardOrigin()) return fallback;

  const transport = host().getDiscoveryTransportSetupState();
  const localWebhookUrl = host().normalizeDiscoveryLocalWebhookUrl(
    transport.localWebhookUrl,
  );
  if (!localWebhookUrl) return fallback;

  const localEngineKind = host().getDiscoveryLocalEngineKind({
    localWebhookUrl,
  });
  if (localEngineKind !== "browser_use_worker") return fallback;

  const publicTunnelTarget = host().normalizeDiscoveryWebhookIdentity(
    host().buildDiscoveryTunnelTargetUrl(localWebhookUrl, transport.tunnelPublicUrl),
  );
  if (
    publicTunnelTarget &&
    fallback &&
    fallback !== publicTunnelTarget &&
    !host().isLikelyCloudflareWorkerUrl(fallback)
  ) {
    return fallback;
  }

  return localWebhookUrl;
}

function buildDiscoveryStatusPollHeaders(statusUrl) {
  return {
    Accept: "application/json",
    ...(isLikelyNgrokUrl(statusUrl)
      ? { "ngrok-skip-browser-warning": "true" }
      : {}),
  };
}

/* RUNHIST (2026-09-27): the worker's durable run history. GET /runs lists
   newest-first summaries; GET /runs/:id (via each summary's statusPath)
   carries runStats. Both resolve against the same worker origin the status
   poll uses, and both settle to { ok:false, reason } instead of throwing so
   the Runs view can fall back to the Sheet quietly. */
const RUN_HISTORY_TIMEOUT_MS = 4000;
const RUN_WRITE_TIMEOUT_MS = 120000;

function runHistoryFetchImpl() {
  return window.JobBoredRelayAuth &&
    typeof window.JobBoredRelayAuth.fetch === "function"
    ? window.JobBoredRelayAuth.fetch
    : fetch;
}

function runHistoryWebhookUrl() {
  const configured =
    typeof host().getDiscoveryWebhookUrl === "function"
      ? host().getDiscoveryWebhookUrl()
      : "";
  if (!String(configured || "").trim()) return "";
  return getDiscoveryStatusPollingWebhookUrl(configured) || "";
}

async function fetchWorkerJson(path, options) {
  const opts = options || {};
  const webhookUrl = runHistoryWebhookUrl();
  const url = webhookUrl ? buildRunStatusUrl(path, webhookUrl) : "";
  if (!url) return { ok: false, reason: "no_worker" };
  const headers = buildDiscoveryStatusPollHeaders(url);
  if (opts.withSecret) {
    const core = configCore();
    const secret =
      core && typeof core.getDiscoveryWebhookSecret === "function"
        ? core.getDiscoveryWebhookSecret()
        : "";
    if (secret) headers["x-discovery-secret"] = secret;
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : RUN_HISTORY_TIMEOUT_MS);
  let response;
  try {
    response = await runHistoryFetchImpl()(url, {
      method: opts.method || "GET",
      mode: "cors",
      headers,
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    const reason = timedOut ? "timeout" :
      error && error.name === "AbortError" ? "aborted" : "unreachable";
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "unauthorized" };
  }
  if (response.status === 404) return { ok: false, reason: "not_found" };
  if (!response.ok) {
    // D7: a 409 from POST /runs/:id/cancel carries the run's real outcome.
    const body = await response.json().catch(() => null);
    return { ok: false, reason: `http_${response.status}`, body };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch (_) {
    return { ok: false, reason: "invalid" };
  }
}

async function fetchRunHistoryPage(options) {
  const opts = options || {};
  const params = [`limit=${encodeURIComponent(String(opts.limit || 25))}`];
  if (opts.before) params.push(`before=${encodeURIComponent(String(opts.before))}`);
  const res = await fetchWorkerJson(`/runs?${params.join("&")}`, {
    withSecret: true,
    timeoutMs: opts.timeoutMs,
  });
  if (!res.ok) {
    // An older worker has /runs/:id but no list route.
    return { ok: false, reason: res.reason === "not_found" ? "no_history_endpoint" : res.reason };
  }
  const body = res.body;
  if (!body || !Array.isArray(body.runs)) return { ok: false, reason: "invalid" };
  return {
    ok: true,
    runs: body.runs.filter((run) => run && typeof run === "object" && run.runId),
    nextBefore: typeof body.nextBefore === "string" && body.nextBefore ? body.nextBefore : null,
  };
}

async function fetchRunDetail(statusPath, options) {
  const path = String(statusPath || "").trim();
  if (!path) return { ok: false, reason: "no_worker_record" };
  const res = await fetchWorkerJson(path, (options || {}));
  if (!res.ok) {
    return { ok: false, reason: res.reason === "not_found" ? "run_not_found" : res.reason };
  }
  if (!res.body || typeof res.body !== "object") return { ok: false, reason: "invalid" };
  return { ok: true, detail: res.body };
}

async function retryRunWrite(runId, googleAccessToken) {
  const id = String(runId || "").trim();
  if (!id) return { ok: false, reason: "no_worker_record" };
  const body = googleAccessToken ? { googleAccessToken } : {};
  const res = await fetchWorkerJson(`/runs/${encodeURIComponent(id)}/retry-write`, {
    method: "POST", withSecret: true, body, timeoutMs: RUN_WRITE_TIMEOUT_MS,
  });
  if (!res.ok) {
    if (res.reason === "timeout" || res.reason === "aborted") {
      const latest = await fetchRunDetail(`/runs/${encodeURIComponent(id)}`, {
        withSecret: true,
      });
      if (latest.ok && ["completed", "partial"].includes(latest.detail.status)) {
        return { ok: true, run: latest.detail };
      }
      return { ok: false, reason: "status_unknown" };
    }
    return res;
  }
  return res.body && res.body.ok && res.body.run
    ? { ok: true, run: res.body.run }
    : { ok: false, reason: "invalid" };
}

/**
 * D7: stop a run through the worker's POST /runs/:id/cancel. The worker
 * holds the answer for up to 15 s while the run unwinds, so the wait is
 * longer than that. A settled answer (cancelled, or it had already finished)
 * becomes the tracker's terminal state; anything else leaves the run being
 * watched and says why.
 */
const RUN_CANCEL_TIMEOUT_MS = 30000;

async function cancelDiscoveryRun(runId) {
  const tracker = runTracker();
  const id = String(runId || tracker.getState().runId || "").trim();
  if (!id) return { ok: false, reason: "no_run" };
  const res = await fetchWorkerJson(`/runs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    withSecret: true,
    timeoutMs: RUN_CANCEL_TIMEOUT_MS,
  });
  const body = res.body && typeof res.body === "object" ? res.body : {};
  const run = body.run && typeof body.run === "object" ? body.run : null;
  if (run && (res.ok || body.code === "run_already_terminal")) {
    if (tracker.getState().runId === id) {
      stopDiscoveryStatusPolling();
      tracker.updateFromStatusResponse(run);
      await refreshPipelineAfterDiscoveryRun(tracker.getState());
      renderDiscoveryRunStatus();
      if (typeof tracker.acknowledgeTerminalOutcome === "function") {
        tracker.acknowledgeTerminalOutcome();
      }
    }
    return { ok: true, cancelled: !!body.cancelled, run };
  }
  const toast = (message, tone) => {
    if (typeof host().showToast === "function") host().showToast(message, tone);
  };
  if (res.reason === "timeout" || res.reason === "aborted") {
    toast("Discovery is still stopping the run — this page keeps watching it.", "info");
    return { ok: false, reason: "timeout" };
  }
  if (res.reason === "unreachable" || res.reason === "no_worker" || res.reason === "http_503") {
    toast("Couldn't reach discovery to cancel the run. Try again.", "warning");
    return { ok: false, reason: "unreachable" };
  }
  toast(
    "This run can't be cancelled from here — it will finish on its own. Check Runs for the outcome.",
    "warning",
  );
  return { ok: false, reason: "not_cancellable" };
}

/**
 * Fetch and process a single status poll for the active run.
 * Returns the parsed status body or null on error.
 * @param {string} webhookUrl
 * @param {{isCurrent?: () => boolean}} [options]  the calling loop; a loop
 *   that is no longer current never marks the tracker (D2)
 * @returns {Promise<object|null>}
 */
async function pollRunStatus(webhookUrl, options) {
  const tracker = runTracker();
  const isCurrent =
    options && typeof options.isCurrent === "function" ? options.isCurrent : () => true;
  const state = tracker.getState();
  if (!state.runId || !state.statusPath) return null;

  const statusUrl = buildRunStatusUrl(state.statusPath, webhookUrl);
  if (!statusUrl) return null;

  // A run polled through a locked Cloudflare relay needs the per-dashboard
  // bearer (G24); JobBoredRelayAuth.fetch adds it for the relay origin only
  // and retries once after a token rotation. Local worker polls pass through.
  const relayFetch =
    window.JobBoredRelayAuth &&
    typeof window.JobBoredRelayAuth.fetch === "function"
      ? window.JobBoredRelayAuth.fetch
      : fetch;

  // D4: a hung relay must not stall the loop forever. The tracker's poll
  // session aborts this request after the per-poll timeout, and aborts it
  // at once when a new run starts.
  const perPollTimeoutMs =
    Number(window.JobBoredDiscovery.runTracker.DEFAULT_PER_POLL_TIMEOUT_MS) || 8000;
  const pollSignal =
    typeof tracker.createPollSignal === "function"
      ? tracker.createPollSignal(perPollTimeoutMs)
      : null;

  let response;
  try {
    response = await relayFetch(statusUrl, {
      method: "GET",
      mode: "cors",
      headers: buildDiscoveryStatusPollHeaders(statusUrl),
      ...(pollSignal ? { signal: pollSignal.signal } : {}),
    });
  } catch (err) {
    if (!isCurrent()) return null;
    tracker.markPollError(
      err && err.name === "AbortError"
        ? `Status request timed out after ${Math.round(perPollTimeoutMs / 1000)}s`
        : `Network error fetching status: ${err && err.message ? err.message : String(err)}`,
    );
    return null;
  } finally {
    if (pollSignal && typeof pollSignal.done === "function") pollSignal.done();
  }
  if (!isCurrent()) return null;

  if (!response.ok) {
    if (classifyRunStatusPollResponse(response.status) === "terminal") {
      const message = describeTerminalRunStatusPoll(response.status);
      // Older mounts only expose markStatusConnectionLost; the honest copy
      // matters more than which entry point carries it.
      if (typeof tracker.markStatusEndpointTerminal === "function") {
        tracker.markStatusEndpointTerminal(message);
      } else if (typeof tracker.markStatusConnectionLost === "function") {
        tracker.markStatusConnectionLost(message);
      } else if (typeof tracker.markPollError === "function") {
        // Minimal/older tracker mounts may expose only the retryable poll
        // error hook. Keep the poll result contract even when they cannot
        // record this terminal distinction.
        tracker.markPollError(message);
      }
      return null;
    }
    tracker.markPollError(
      `Status endpoint returned HTTP ${response.status}`,
    );
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    if (isCurrent()) tracker.markPollError("Status response was not valid JSON");
    return null;
  }

  return isCurrent() ? data : null;
}

function retryDiscoveryStatusConnection() {
  const state = runTracker().getState();
  if (!state.runId || !state.statusPath) return;
  runTracker().resumeFromPollError();
  renderDiscoveryRunStatus();
  void startDiscoveryStatusPolling(state.webhookUrl || host().getDiscoveryWebhookUrl());
}

function shouldRefreshPipelineAfterDiscoveryRun(state) {
  const status = String((state && state.status) || "").toLowerCase();
  return (
    status === "completed" ||
    status === "partial" ||
    Number((state && state.leadsWritten) || 0) > 0 ||
    // Leads written as UPDATES (appended:0, updated:N) are still lead-bearing —
    // reload even if the run-status poll never landed a terminal state (common
    // on local/tunnel transports), otherwise the board stays stale at 0.
    Number((state && state.leadsUpdated) || 0) > 0
  );
}

// D9: a run the browser can't follow gives no completion signal, so the
// board reloads on a short schedule instead of waiting for its own poll.
const UNWATCHED_RUN_REFRESH_DELAYS_MS = [60 * 1000, 3 * 60 * 1000];

function refreshPipelineAfterUnwatchedRun(options) {
  const load = () => {
    if (typeof host().loadAllData !== "function") return;
    Promise.resolve(host().loadAllData()).catch((err) => {
      console.warn("[JobBored] post-discovery refresh failed:", err);
    });
  };
  if (options && options.immediate) load();
  for (const delay of UNWATCHED_RUN_REFRESH_DELAYS_MS) setTimeout(load, delay);
}

async function refreshPipelineAfterDiscoveryRun(state) {
  if (!shouldRefreshPipelineAfterDiscoveryRun(state)) return false;
  if (typeof host().loadAllData !== "function") return false;
  try {
    await host().loadAllData();
    return true;
  } catch (err) {
    console.warn("[JobBored] post-discovery refresh failed:", err);
    return false;
  }
}

const PRE_FILTER_REASON_LABELS = {
  skip_title_match: "skip-title",
  work_mode_mismatch: "work-mode",
  location_outside_acceptable: "location",
  work_auth_mismatch: "work-auth",
  salary_below_floor: "salary floor",
  salary_missing_but_required: "salary missing",
};

// Tracks the last rejection summary we've toasted so polling doesn't re-fire
// the same banner every tick. Keyed by runId so a new run resets it.
let _lastSurfacedRejectionKey = "";

/**
 * Per-reason rejection counts for one run, summed across the worker's
 * per-source summaries (sources[].rejectionSummary.rejectionReasons). Falls
 * back to runStats.funnel.rejectedTopReasons when no source carries a map.
 * The write result carries no rejection summary, so it is not consulted.
 */
function collectRunRejectionCounts(statusData) {
  const counts = {};
  const add = (reason, value) => {
    const n = Number(value);
    if (!reason || !Number.isFinite(n) || n <= 0) return;
    counts[reason] = (counts[reason] || 0) + n;
  };
  const sources = statusData && Array.isArray(statusData.sources) ? statusData.sources : [];
  for (const source of sources) {
    const reasons =
      source && source.rejectionSummary && source.rejectionSummary.rejectionReasons;
    if (!reasons || typeof reasons !== "object") continue;
    for (const [reason, count] of Object.entries(reasons)) add(reason, count);
  }
  if (Object.keys(counts).length > 0) return counts;
  const top =
    statusData &&
    statusData.runStats &&
    statusData.runStats.funnel &&
    statusData.runStats.funnel.rejectedTopReasons;
  if (Array.isArray(top)) {
    for (const entry of top) {
      if (entry && typeof entry === "object") add(String(entry.reason || ""), entry.count);
    }
  }
  return counts;
}

/**
 * If the run status payload carries pre-filter rejections from the Fit
 * Profile pipeline, render a one-line banner summarizing what was filtered.
 */
function surfacePreFilterRejectionsFromStatus(statusData) {
  if (!statusData || typeof statusData !== "object") return;
  const counts = {};
  for (const [reason, count] of Object.entries(collectRunRejectionCounts(statusData))) {
    if (reason in PRE_FILTER_REASON_LABELS) counts[reason] = count;
  }

  const reasons = Object.keys(counts);
  if (reasons.length === 0) return;

  // Dedupe — only surface once per (runId, shape) combination.
  const runId = String(
    (runTracker().getState() || {}).runId || "",
  );
  const key =
    runId +
    "|" +
    reasons
      .map((r) => `${r}:${counts[r]}`)
      .sort()
      .join(",");
  if (key === _lastSurfacedRejectionKey) return;
  _lastSurfacedRejectionKey = key;

  const total = reasons.reduce((acc, r) => acc + counts[r], 0);
  const parts = reasons
    .map((r) => `${counts[r]} by ${PRE_FILTER_REASON_LABELS[r]}`)
    .join(", ");
  const message = `${total} listings filtered by your Fit Profile: ${parts}`;
  if (typeof host().showToast === "function") {
    host().showToast(message, "info", true);
  } else {
    console.info("[JobBored] " + message);
  }
}

/**
 * Main polling loop — call once after an accepted_async response.
 * Automatically stops when the run reaches a terminal state or polling errors exceed limit.
 *
 * @param {string} webhookUrl  discovery webhook URL (used to resolve relative statusPath)
 */
async function startDiscoveryStatusPolling(webhookUrl) {
  const tracker = runTracker();
  const pollingWebhookUrl = getDiscoveryStatusPollingWebhookUrl(webhookUrl);

  // Cancel any in-flight polling session before starting fresh
  stopDiscoveryStatusPolling();

  // D2: this loop is live only while it is the tab's newest loop and the
  // tracker still holds the run it started on. beginTracking bumps the
  // generation, so a new run retires the old loop at its next await even
  // when that loop's poll was already in flight.
  const started = tracker.getState();
  const loop = {
    runId: String(started.runId || ""),
    generation: Number(started.pollGeneration) || 0,
  };
  activePollLoop = loop;
  // A reload re-polls a lost run once; if it is still unreachable the loss
  // was already shown, so it settles again without a second toast (D6).
  const resumedSettled = typeof tracker.isSettled === "function" && tracker.isSettled();
  const isCurrent = () => {
    if (activePollLoop !== loop) return false;
    const now = tracker.getState();
    return (
      String(now.runId || "") === loop.runId &&
      (Number(now.pollGeneration) || 0) === loop.generation
    );
  };

  async function poll() {
    if (!isCurrent()) return;
    const state = tracker.getState();

    // If we've reached terminal or been cleared, stop
    if (!state.runId || state.status === "idle") {
      return;
    }

    const statusData = await pollRunStatus(pollingWebhookUrl, { isCurrent });
    if (!isCurrent()) return;
    if (statusData) {
      tracker.updateFromStatusResponse(statusData);
      surfacePreFilterRejectionsFromStatus(statusData);
    }
    syncDiscoveryLiveProgress();

    const updated = tracker.getState();

    if (updated.status === "polling_error") {
      if (updated.statusEndpointTerminal) {
        // Settled: the message is already honest, and another poll would
        // only re-earn the same answer.
        renderDiscoveryRunStatus();
        return;
      }
      if (updated.pollErrorCount >= MAX_POLL_ERRORS) {
        tracker.markStatusConnectionLost(
          "Lost the status connection after multiple attempts. The discovery run may still be running.",
        );
        renderDiscoveryRunStatus({ quiet: resumedSettled });
        return;
      }
      // Exponential-ish back-off: 1s, 2s, 4s
      const backoff = Math.min(4000, 500 * Math.pow(2, updated.pollErrorCount));
      tracker._pollTimer = setTimeout(poll, backoff);
      return;
    }

    if (tracker.isTerminal()) {
      await refreshPipelineAfterDiscoveryRun(updated);
      if (!isCurrent()) return;
      renderDiscoveryRunStatus();
      // The user saw the terminal toast live — don't re-toast it on the
      // next reload (resumeDiscoveryStatusPollingIfNeeded checks this).
      if (typeof tracker.acknowledgeTerminalOutcome === "function") {
        tracker.acknowledgeTerminalOutcome();
      }
      return;
    }

    // D4: past maxRunDurationMs + grace and the worker has gone quiet —
    // stop watching and say so. Fresh progress is never cut short (§0.4).
    const nowMs = Date.now();
    if (
      typeof tracker.isPastDeadline === "function" &&
      tracker.isPastDeadline(nowMs) &&
      !tracker.hasFreshProgress(nowMs)
    ) {
      tracker.markDeadlineExceeded();
      renderDiscoveryRunStatus();
      return;
    }

    // Normal: wait pollAfterMs then poll again
    const interval = Number.isFinite(updated.pollAfterMs)
      ? Math.max(STATUS_POLL_DEBOUNCE_MS, updated.pollAfterMs)
      : 2000;
    tracker._pollTimer = setTimeout(poll, interval);
  }

  // Kick off the first poll after the advertised pollAfterMs
  const state = tracker.getState();
  const firstDelay = Math.max(
    STATUS_POLL_DEBOUNCE_MS,
    Number.isFinite(state.pollAfterMs) ? state.pollAfterMs : 2000,
  );
  tracker._pollTimer = setTimeout(poll, firstDelay);
}

/**
 * D5/D6: the user dismisses a run the browser can no longer watch. The
 * worker's run is untouched — only this dashboard forgets it.
 */
function dismissDiscoveryRun() {
  stopDiscoveryStatusPolling();
  runTracker().clear();
  renderDiscoveryRunStatus();
}

/** Stop any active polling loop without clearing run state */
function stopDiscoveryStatusPolling() {
  activePollLoop = null;
  if (runTracker()._pollTimer) {
    clearTimeout(runTracker()._pollTimer);
    runTracker()._pollTimer = null;
  }
}

const TERMINAL_RUN_STATUSES = ["completed", "empty", "partial", "failed", "write_failed"];

/**
 * D15: what a finished run added, worded as "3 new roles · 2 updated" — an
 * updated row is never counted as a new role.
 */
function describeRunYield(state) {
  const written = Math.max(0, Math.floor(Number(state && state.leadsWritten) || 0));
  const updated = Math.max(0, Math.floor(Number(state && state.leadsUpdated) || 0));
  return {
    written,
    updated,
    newRoles: `${written} new ${written === 1 ? "role" : "roles"}`,
    updatedSuffix: updated ? ` · ${updated} updated` : "",
  };
}

/**
 * Surface a persisted terminal run outcome exactly once after a reload —
 * sticky for failed/partial/write_failed (with the stored error), transient for
 * completed/empty — refresh the pipeline for lead-bearing outcomes, then
 * stamp the acknowledged flag so later loads stay quiet. Without this, a
 * user who reloads (or whose tab was closed when the run finished) gets
 * zero feedback even though the outcome is sitting in localStorage.
 */
function surfaceStoredTerminalRunOutcomeOnce(state) {
  if (!state || !TERMINAL_RUN_STATUSES.includes(state.status)) return false;
  if (state.terminalAcknowledged) return false;

  let message = "";
  let tone = "info";
  let sticky = false;
  switch (state.status) {
    case "completed": {
      const runYield = describeRunYield(state);
      message =
        "Last discovery run finished — " +
        (runYield.written ? runYield.newRoles : "no new roles") +
        runYield.updatedSuffix +
        ".";
      tone = "success";
      break;
    }
    case "empty":
      message = "Last discovery run finished — no new roles were found.";
      break;
    case "partial":
      message =
        "Last discovery run finished with partial results." +
        (state.errorMessage ? " " + state.errorMessage : "");
      tone = "warning";
      sticky = true;
      break;
    case "write_failed":
      message = state.errorMessage ||
        "Discovery found roles but couldn't write them. Open Runs and press Retry write.";
      tone = "error";
      sticky = true;
      break;
    case "failed":
      message =
        "Last discovery run failed." +
        (state.errorMessage ? " " + state.errorMessage : "");
      tone = "error";
      sticky = true;
      break;
    default:
      return false;
  }

  if (typeof host().showToast === "function") {
    host().showToast(message, tone, sticky, {
      label: "Open runs",
      onClick: () => {
        document.getElementById("runsBtn")?.click();
      },
    });
  }
  // Lead-bearing outcomes (gated inside the helper) reload the board so the
  // pipeline isn't stale at 0 after a run that finished while we were away.
  void refreshPipelineAfterDiscoveryRun(state);
  const tracker = runTracker();
  if (typeof tracker.acknowledgeTerminalOutcome === "function") {
    tracker.acknowledgeTerminalOutcome();
  }
  return true;
}

function resumeDiscoveryStatusPollingIfNeeded() {
  // Never replay a stale run's status (toast + polling) before the user has
  // signed in — it was leaking onto the login screen. (Absent isSignedIn is
  // treated as "don't gate" to stay defensive.)
  const h = host();
  if (h && typeof h.isSignedIn === "function" && !h.isSignedIn()) return;
  const state = runTracker().getState();
  if (!state.runId) return;
  if (state.status === "failed") {
    runTracker().resumeFromStatusPollingFailure();
  }
  // Terminal and not resumable: show the outcome once instead of bailing
  // silently (completed/empty/partial/failed are all !isActive()).
  const afterResume = runTracker().getState();
  if (TERMINAL_RUN_STATUSES.includes(afterResume.status)) {
    surfaceStoredTerminalRunOutcomeOnce(afterResume);
    return;
  }
  // D5: a run with no status path was surfaced when it started — a reload
  // stays quiet (the drawer card still shows it, with Dismiss).
  if (!state.statusPath) return;
  const next = runTracker().getState();
  // A settled status endpoint stays settled across a reload — re-polling it
  // would only re-earn the same 404/401. So does a run past its deadline.
  if (next.statusEndpointTerminal || next.deadlineExceeded) return;
  if (!["pending", "running", "polling_error"].includes(next.status)) return;
  // D6: a lost connection is not a settled answer, so the reload tries again
  // — quietly, because the loss was already shown when it happened.
  if (runTracker().isActive()) renderDiscoveryRunStatus();
  void startDiscoveryStatusPolling(next.webhookUrl || host().getDiscoveryWebhookUrl());
}

/**
 * Honest run-health: does a run's error text point at an expired/invalid
 * grounded-search key, rather than a clean zero-results run or an unrelated
 * failure? Completion means the pipeline CONNECTED (isDiscoverySetupComplete is
 * never touched here) — this is a separate run-health signal so an expired key
 * surfaces as an actionable "refresh your key" message instead of silent
 * emptiness or a generic "check the worker logs".
 */
function looksLikeExpiredSearchKey(rawText) {
  const text = String(rawText || "");
  if (!text) return false;
  // Dead-link warnings ("broken or expired job page") are per-posting, NOT the
  // grounded-search API key — never cry wolf on those.
  if (/\bjob (page|posting|url|listing)\b/i.test(text)) return false;
  const mentionsSearchKey =
    /gemini api key/i.test(text) ||
    /google_search client/i.test(text) ||
    /grounded[\s-]?search/i.test(text) ||
    /search key/i.test(text);
  if (!mentionsSearchKey) return false;
  return /\b(expired|invalid|revoked|unauthorized|not configured|not valid|unavailable)\b|\b40[13]\b/i.test(
    text,
  );
}

const EXPIRED_SEARCH_KEY_MESSAGE =
  "Discovery is set up, but your grounded-search key looks expired or invalid. " +
  "Refresh it in Settings → AI Providers to start getting results.";

// Every class renderDiscoveryRunStatus() may put on #discoveryBtn — kept in
// one list so stale states are always cleared before the next one applies.
// ("run-terminal" is legacy; removed defensively in case it persisted.)
const RUN_STATUS_BUTTON_CLASSES = [
  "run-pending",
  "run-running",
  "run-polling_error",
  "run-completed",
  "run-empty",
  "run-partial",
  "run-failed",
  "run-write_failed",
  "run-terminal",
];

/**
 * Render current run status into the discovery status bar (toast area / status chip).
 * Called after every tracker state change so the user sees live progress.
 */
function renderDiscoveryRunStatus(options) {
  // quiet: refresh the button and live view without a toast — the outcome
  // was already shown (a reload, or another tab told the user).
  const quiet = !!(options && options.quiet);
  const state = runTracker().getState();
  const openBtn = document.getElementById("discoveryBtn");

  if (state.status === "idle") {
    if (openBtn) {
      openBtn.classList.remove("loading", ...RUN_STATUS_BUTTON_CLASSES);
      openBtn.removeAttribute("aria-label");
    }
    return;
  }

  // Apply CSS class for visual state on the button. Always drop every
  // previously-applied run-* class first — a stale terminal class (e.g.
  // run-failed) must never restyle the button once the status moves on.
  if (openBtn) {
    openBtn.classList.remove(...RUN_STATUS_BUTTON_CLASSES);
    openBtn.classList.add("run-" + state.status);
    openBtn.classList.remove("loading");
  }

  // Build status message
  let statusMessage = "";
  let statusTone = "info";

  // UX01 C9 (FD-11, SS-24): plain words — no run IDs, no "worker logs",
  // Pipeline rather than "sheet", and a count when the run reports one.
  const runYield = describeRunYield(state);
  const why = String(state.errorMessage || "").trim().replace(/[.\s]+$/, "");
  switch (state.status) {
    case "pending":
      statusMessage = state.dispatchUnconfirmed
        ? "Discovery may have started — the worker didn't answer within a minute. Check Runs before you run it again; running it again won't start a duplicate."
        : state.statusUnavailable
          ? "Discovery started. This setup can't send live updates — new roles will land in your Pipeline; check Runs in a few minutes."
          : "Discovery started — searching for new roles…";
      statusTone = "info";
      break;
    case "running":
      statusMessage = "Searching for new roles…";
      statusTone = "info";
      break;
    case "polling_error":
      statusMessage = state.statusEndpointTerminal
        ? "Discovery can't report this run. " +
          (why ? why + ". " : "") +
          "Open Runs for details."
        : state.deadlineExceeded
          ? "Discovery stopped watching this run: it went past its time limit without reporting an end. Check Runs for the outcome."
          : state.pollErrorCount >= MAX_POLL_ERRORS
          ? "Discovery started — we stopped getting updates. The search may still be running; new roles may land in your Pipeline. Check Runs in a few minutes."
          : "Reconnecting to the search…";
      statusTone = "warning";
      break;
    case "completed":
      statusMessage = runYield.written
        ? `Found ${runYield.newRoles}${runYield.updatedSuffix}.`
        : runYield.updated
          ? `No new roles this run${runYield.updatedSuffix}.`
          : "Discovery finished — no new roles this run.";
      statusTone = "success";
      break;
    case "empty":
      statusMessage = "Discovery finished — no new roles found this run.";
      statusTone = "info";
      break;
    case "partial":
      statusMessage =
        "Discovery finished, but some sources didn't answer. " +
        (why ? why + ". " : "") +
        "Open Runs to see which.";
      statusTone = "warning";
      break;
    case "failed":
      // D7: a run the user cancelled ends "failed" with this exact error.
      if (/^cancelled by user\.?$/i.test(String(state.errorMessage || "").trim())) {
        statusMessage = "Discovery run cancelled.";
        statusTone = "info";
        break;
      }
      statusMessage =
        "Discovery didn't finish. " +
        (why ? why + ". " : "") +
        "Open Runs to see why.";
      statusTone = "error";
      break;
    case "write_failed":
      statusMessage = why ||
        "Discovery found roles but couldn't write them. Open Runs and press Retry write.";
      statusTone = "error";
      break;
    default:
      statusMessage = "";
  }

  // Honest run-health override: a terminal run that failed/degraded because the
  // grounded-search key is expired/invalid gets an actionable message + a fix
  // action, instead of silent emptiness or "check the worker logs". We only
  // inspect partial/failed (states that carry an error) — a clean "empty" run
  // keeps "no new roles found" so we never cry wolf on legitimate zero results.
  const expiredSearchKey =
    (state.status === "partial" || state.status === "failed") &&
    looksLikeExpiredSearchKey(state.errorMessage);
  if (expiredSearchKey) {
    statusMessage = EXPIRED_SEARCH_KEY_MESSAGE;
    statusTone = "warning";
  }

  if (openBtn && statusMessage) {
    openBtn.setAttribute("aria-label", statusMessage);
    // Also surface in a toast for non-terminal states
    if (state.status !== "idle" && !quiet) {
      // Use a transient toast (non-blocking) for live updates
      const retryAction = expiredSearchKey
        ? {
            label: "Open settings",
            onClick: () => {
              void openSettingsForDiscoveryWebhook();
            },
          }
        : state.status === "polling_error" &&
            !state.statusEndpointTerminal &&
            !state.deadlineExceeded &&
            state.statusPath &&
            state.pollErrorCount >= MAX_POLL_ERRORS
          ? { label: "Retry status", onClick: retryDiscoveryStatusConnection }
          : (state.status === "pending" && state.statusUnavailable) ||
              (state.status === "polling_error" &&
                (state.statusEndpointTerminal || state.deadlineExceeded)) ||
              state.status === "partial" ||
              state.status === "failed" ||
              state.status === "write_failed"
            ? {
                label: "Open runs",
                onClick: () => {
                  document.getElementById("runsBtn")?.click();
                },
              }
          : state.status === "completed"
            ? { label: "View", onClick: viewFoundRoles }
          : undefined;
      const sticky =
        expiredSearchKey ||
        (state.status === "polling_error" &&
          state.pollErrorCount >= MAX_POLL_ERRORS) ||
        (state.status === "pending" && state.statusUnavailable) ||
        state.status === "write_failed";
      host().showToast(statusMessage, statusTone, sticky, retryAction);
    }
  }
  syncDiscoveryLiveProgress();
}

/**
 * UXD-FE: keep #discoveryBtn honest between toasts. Its label and title carry
 * the live view's one sentence (phase, count, heartbeat); data-run-health
 * lets CSS stop the pulse when the worker has gone quiet for too long.
 * Phase changes and stalls go to the polite live region once each — the
 * sentence itself changes every poll and must never be announced per poll.
 */
let liveProgressAnnounced = { runId: "", phase: "", stalled: false };

function announceLiveProgress(message) {
  const a11y = window.JobBoredA11y;
  if (a11y && a11y.live && typeof a11y.live.announce === "function") {
    a11y.live.announce(message);
  }
}

function syncDiscoveryLiveProgress() {
  const rt = window.JobBoredDiscovery && window.JobBoredDiscovery.runTracker;
  if (!rt || typeof rt.deriveLiveRunView !== "function") return;
  const state = runTracker().getState() || {};
  const view = rt.deriveLiveRunView(state, Date.now());
  const openBtn = document.getElementById("discoveryBtn");
  if (view.mode === "hidden") {
    if (openBtn) {
      openBtn.removeAttribute("data-run-health");
      const idleTitle = openBtn.getAttribute("data-idle-title");
      if (idleTitle !== null) {
        openBtn.setAttribute("title", idleTitle);
        openBtn.removeAttribute("data-idle-title");
      }
    }
    liveProgressAnnounced = { runId: "", phase: "", stalled: false };
    return;
  }
  if (openBtn) {
    openBtn.setAttribute("data-run-health", view.health.key);
    // Legacy runs (no progress object) keep renderDiscoveryRunStatus's
    // label: there is nothing truer to say than it already does.
    if (view.mode === "live") {
      if (openBtn.getAttribute("data-idle-title") === null) {
        openBtn.setAttribute("data-idle-title", openBtn.getAttribute("title") || "");
      }
      openBtn.setAttribute("aria-label", view.summary);
      openBtn.setAttribute("title", view.summary);
    }
  }
  const runId = String(state.runId || "");
  if (liveProgressAnnounced.runId !== runId) {
    liveProgressAnnounced = { runId, phase: "", stalled: false };
  }
  if (view.phaseHeadline && view.phaseKey !== liveProgressAnnounced.phase) {
    liveProgressAnnounced.phase = view.phaseKey;
    announceLiveProgress(
      "Discovery: " + view.phaseHeadline.charAt(0).toLowerCase() + view.phaseHeadline.slice(1) + ".",
    );
  }
  const stalled = view.health.key === "stalled";
  if (stalled !== liveProgressAnnounced.stalled) {
    liveProgressAnnounced.stalled = stalled;
    announceLiveProgress(
      stalled
        ? "Discovery: " + view.health.text.charAt(0).toLowerCase() + view.health.text.slice(1)
        : "Discovery is sending updates again.",
    );
  }
}

/**
 * UX01 C9 (FD-12): "Found N new · View" lands on the Pipeline. The view
 * API shows the board before we scroll to it.
 */
function viewFoundRoles() {
  try {
    document.dispatchEvent(
      new CustomEvent("jb:view:request", { detail: { view: "pipeline", from: "discovery_run" } }),
    );
  } catch (_) {
    /* no CustomEvent: fall through to the scroll */
  }
  const views = window.JobBoredFlowing && window.JobBoredFlowing.views;
  if (views && typeof views.show === "function") {
    views.show("pipeline", { focus: true });
  }
  const board = document.querySelector('[data-region="pipeline"]');
  if (board && typeof board.scrollIntoView === "function") {
    board.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function handleDiscoverySetupDeepLink() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("setup") !== "discovery") return false;
  await requestDiscoverySetup({
    entryPoint: "deep_link",
    stripSetupParam: true,
  });
  return true;
}

// ============================================
// THE ONE-FLOW CUTOVER (ONE-FLOW-ONBOARDING-SPEC §3.3 / §3.4)
//
// This used to be the head of the legacy chain: the first-run infra
// wizard, then the profile onboarding wizard, each owning a screen of
// its own. Both still exist (L7 deletes them); neither is reached from
// boot any more. The controller answers the one question that replaced
// them — should this profile see the flow, and where does it start?
// ============================================

function oneFlow() {
  const ns = window.JobBoredOneFlow;
  return ns && typeof ns.maybeStart === "function" ? ns : null;
}

function userContentStore() {
  return window.CommandCenterUserContent || null;
}

/** True while a beat owns the screen — the flow's own "wizard visible". */
function isOneFlowOpen() {
  const flow = oneFlow();
  return !!(flow && typeof flow.isOpen === "function" && flow.isOpen());
}

/** The sheet a legacy profile already owns — B1's exit condition. */
function hasConfiguredSheet() {
  const h = host();
  if (!h) return false;
  const read = (name) =>
    typeof h[name] === "function" ? String(h[name]() || "").trim() : "";
  return !!(read("getSheetId") || read("getSHEET_ID"));
}

/**
 * "Verified" is not a stored flag anywhere — B2 defines it as a live
 * round trip, so migration has to spend one too. A configured provider
 * whose key has since died therefore lands back on B2, which is exactly
 * the beat that exists to catch it.
 */
async function hasVerifiedProvider() {
  const config = window.COMMAND_CENTER_CONFIG || {};
  if (!String(config.resumeProvider || "").trim()) return false;
  const api = window.CommandCenterResumeGenerate;
  if (!api || typeof api.verifyResumeProviderLive !== "function") return false;
  try {
    const result = await api.verifyResumeProviderLive();
    return !!(result && result.ok);
  } catch (e) {
    return false;
  }
}

/** True when the scorer's profile (`~/.jobbored/profile.json`) exists. */
async function hasServerFitProfile() {
  const api = window.FitProfileForm;
  if (!api || typeof api.fetchProfile !== "function") return false;
  try {
    const data = await api.fetchProfile();
    return !!(data && data.ok !== false && data.profile);
  } catch (e) {
    // A dead profile server is not evidence that the profile is missing;
    // re-asking for work the user may have already done is the one thing
    // §3.3 forbids, so an unreachable server keeps them out of B4.
    return true;
  }
}

/** Legacy remote policy → the work mode B4 edits. Twin of discovery-drawer.js:189. */
function workModeFromRemotePolicy(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return "any";
  if (/remote/.test(v)) return "remote_only";
  if (/hybrid/.test(v)) return "hybrid_ok";
  if (/on[-\s]?site/.test(v)) return "onsite_ok";
  return "any";
}

/** Legacy seniority label → the enum id B4 renders. */
function seniorityFromLabel(raw) {
  const v = String(raw || "").trim().toLowerCase();
  const byLabel = {
    intern: "intern",
    entry: "entry",
    mid: "ic_mid",
    senior: "ic_senior",
    staff: "ic_staff",
    principal: "ic_principal",
    manager: "manager",
    director: "director",
    head: "head",
    vp: "vp",
    "c-level": "c_level",
  };
  return byLabel[v] || "any";
}

function splitList(raw) {
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * The legacy discovery profile, in the shape B4 confirms. Roles and
 * locations the user already typed must never be asked for twice
 * (spec §3.3, "prefilled from the discovery profile") — everything B4
 * needs and the legacy profile never held (strengths, narrative) stays
 * empty, so B4's own validation asks for it once.
 */
function fitDraftFromDiscoveryProfile(profile) {
  const p = profile && typeof profile === "object" ? profile : {};
  const workMode = workModeFromRemotePolicy(p.remotePolicy);
  return {
    version: 1,
    identity: {
      targetRoles: splitList(p.targetRoles),
      targetSeniority: seniorityFromLabel(p.seniority),
      primaryNarrative: "",
    },
    strengths: [],
    hardConstraints: {
      workMode,
      acceptableLocations: splitList(p.locations),
      skipTitles: splitList(p.keywordsExclude),
    },
  };
}

/**
 * Spec §3.3 — where a partially set up legacy profile re-enters the
 * flow. The ladder is read deepest-first: a user who already answered
 * the profile questions does not re-answer the AI key screen to reach
 * the one screen they still owe us. Every rung above B1 presupposes the
 * sheet, so a profile without one starts at B1 regardless.
 *
 * Returns "" for "no opinion" — the controller's own resolver then picks
 * the saved beat, or B1.
 */
async function resolveOneFlowEntryBeat() {
  if (!hasConfiguredSheet()) return "";
  const store = userContentStore();
  const legacyProfileComplete =
    store && typeof store.isOnboardingComplete === "function"
      ? await store.isOnboardingComplete()
      : false;
  if (legacyProfileComplete && !(await hasServerFitProfile())) {
    const flow = oneFlow();
    if (flow && typeof flow.seedRuntime === "function") {
      const profile =
        typeof store.getDiscoveryProfile === "function"
          ? await store.getDiscoveryProfile()
          : null;
      flow.seedRuntime({ profileDraft: fitDraftFromDiscoveryProfile(profile) });
    }
    return "fit";
  }
  if (await hasVerifiedProvider()) {
    // GREENFIELD §4.1 gates Beat 3 on Beat 2. This rung IS Beat 2's exit
    // condition — the configured provider just answered a live check — so
    // the ladder has to SAY so, or the controller reads the skip as an unmet
    // prerequisite and sends a migrated user back to the AI screen.
    seedMigratedBeats(["ai"]);
    return "resume";
  }
  return "ai";
}

/**
 * Tell the controller which rungs this profile has already cleared, through
 * the same §3.3 seed seam that hands B4 its drafted profile. In-memory by
 * contract: the ladder re-derives it on every boot.
 */
function seedMigratedBeats(beatIds) {
  const flow = oneFlow();
  if (!flow || typeof flow.seedRuntime !== "function") return;
  try {
    flow.seedRuntime({ migratedBeats: beatIds });
  } catch (e) {
    console.warn("[JobBored] one-flow: could not seed migrated beats:", e);
  }
}

/**
 * The head of the post-auth chain. Renders the flow only for a profile
 * that still owes setup; a finished legacy profile is recorded as
 * complete inside maybeStart() and never sees a beat (§3.3), with the
 * what's-next banner carrying any remaining nudge.
 */
async function startOneFlowIfNeeded() {
  const flow = oneFlow();
  if (!flow) return false;
  // The S0 invitation card may already have opened the flow before the
  // session finished restoring; boot must not yank it back to an entry beat.
  if (typeof flow.isOpen === "function" && flow.isOpen()) return false;
  let shouldStart = false;
  try {
    shouldStart = await flow.maybeStart();
  } catch (e) {
    console.warn("[JobBored] one-flow: entry decision failed:", e);
    return false;
  }
  if (!shouldStart) return false;
  // A saved beat is a resume (§3.4) and outranks the migration ladder.
  const saved = typeof flow.getState === "function" ? flow.getState().beat : "";
  const target = saved ? "" : await resolveOneFlowEntryBeat();
  await flow.open(target);
  return true;
}

// Deliberately `var`: top-level var in a classic script lands on window, the
// same place the old implicit-global assignments put these flags.
var postAccessBootstrapDone = false;
var postAccessBootstrapPromise = Promise.resolve();

function runPostAccessBootstrapOnce() {
  if (postAccessBootstrapDone) return postAccessBootstrapPromise;
  postAccessBootstrapDone = true;
  postAccessBootstrapPromise = (async () => {
    await startOneFlowIfNeeded();
    await handleDiscoverySetupDeepLink();
    // The bootstrap-time resume runs before the OAuth session restores, so
    // its signed-in gate no-ops it on every reload. Retry now that access
    // is proven — this is what actually surfaces a stored run outcome (or
    // resumes live polling) after a refresh. Idempotent: polling cancels
    // any in-flight timer and terminal toasts acknowledge themselves.
    resumeDiscoveryStatusPollingIfNeeded();
  })();
  return postAccessBootstrapPromise;
}

function resetPostAccessBootstrap() {
  postAccessBootstrapDone = false;
  postAccessBootstrapPromise = Promise.resolve();
}

  Object.assign(status, {
    syncDiscoveryLiveProgress,
    isManagedAppsScriptDeployState: isManagedAppsScriptDeployState,
    isAppsScriptPublicAccessReady: isAppsScriptPublicAccessReady,
    getAppsScriptEditorUrl: getAppsScriptEditorUrl,
    formatAppsScriptWebAppAccessLabel: formatAppsScriptWebAppAccessLabel,
    formatAppsScriptExecuteAsLabel: formatAppsScriptExecuteAsLabel,
    buildAppsScriptPublicAccessRemediationStatus: buildAppsScriptPublicAccessRemediationStatus,
    openAppsScriptRemediationFlowInSettings: openAppsScriptRemediationFlowInSettings,
    showAppsScriptPublicAccessRemediationFromState: showAppsScriptPublicAccessRemediationFromState,
    diagnoseDownstreamChain: diagnoseDownstreamChain,
    setAppsScriptDeployStatus: setAppsScriptDeployStatus,
    clearAppsScriptDeployStatus: clearAppsScriptDeployStatus,
    stripSetupDiscoveryParam: stripSetupDiscoveryParam,
    focusDiscoveryWebhookFieldInSettings: focusDiscoveryWebhookFieldInSettings,
    openSettingsForDiscoveryWebhook: openSettingsForDiscoveryWebhook,
    requestDiscoverySetup: requestDiscoverySetup,
    buildRunStatusUrl: buildRunStatusUrl,
    canSynthesizeRunStatusPath: canSynthesizeRunStatusPath,
    resolveAcceptedRunStatusPath: resolveAcceptedRunStatusPath,
    isLikelyNgrokUrl: isLikelyNgrokUrl,
    getDiscoveryStatusPollingWebhookUrl: getDiscoveryStatusPollingWebhookUrl,
    buildDiscoveryStatusPollHeaders: buildDiscoveryStatusPollHeaders,
    classifyRunStatusPollResponse: classifyRunStatusPollResponse,
    describeTerminalRunStatusPoll: describeTerminalRunStatusPoll,
    pollRunStatus: pollRunStatus,
    fetchRunHistoryPage: fetchRunHistoryPage,
    fetchRunDetail: fetchRunDetail,
    retryRunWrite: retryRunWrite,
    cancelDiscoveryRun: cancelDiscoveryRun,
    collectRunRejectionCounts: collectRunRejectionCounts,
    surfacePreFilterRejectionsFromStatus: surfacePreFilterRejectionsFromStatus,
    retryDiscoveryStatusConnection: retryDiscoveryStatusConnection,
    shouldRefreshPipelineAfterDiscoveryRun: shouldRefreshPipelineAfterDiscoveryRun,
    refreshPipelineAfterDiscoveryRun: refreshPipelineAfterDiscoveryRun,
    refreshPipelineAfterUnwatchedRun: refreshPipelineAfterUnwatchedRun,
    startDiscoveryStatusPolling: startDiscoveryStatusPolling,
    stopDiscoveryStatusPolling: stopDiscoveryStatusPolling,
    dismissDiscoveryRun: dismissDiscoveryRun,
    getRemoteDiscoveryWebhookHost: getRemoteDiscoveryWebhookHost,
    surfaceStoredTerminalRunOutcomeOnce: surfaceStoredTerminalRunOutcomeOnce,
    resumeDiscoveryStatusPollingIfNeeded: resumeDiscoveryStatusPollingIfNeeded,
    renderDiscoveryRunStatus: renderDiscoveryRunStatus,
    looksLikeExpiredSearchKey: looksLikeExpiredSearchKey,
    handleDiscoverySetupDeepLink: handleDiscoverySetupDeepLink,
    resolveOneFlowEntryBeat: resolveOneFlowEntryBeat,
    startOneFlowIfNeeded: startOneFlowIfNeeded,
    runPostAccessBootstrapOnce: runPostAccessBootstrapOnce,
    resetPostAccessBootstrap: resetPostAccessBootstrap,
  });
})();
