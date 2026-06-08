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
    if (
      liveNgrokUrl &&
      snapshot.tunnelPublicUrl &&
      liveNgrokUrl !== snapshot.tunnelPublicUrl
    ) {
      diagnosis.tunnel.stale = true;
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
    const savedTarget = snapshot.relayTargetUrl.replace(/\/+$/, "");
    const liveBase = diagnosis.tunnel.url.replace(/\/+$/, "");
    if (!savedTarget.startsWith(liveBase)) {
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
    const tunnelOrigin = (u) => {
      try {
        const s = String(u || "").trim();
        if (!s) return "";
        const parsed = new URL(s);
        return `${parsed.protocol}//${parsed.host}`;
      } catch (_) {
        return String(u || "").replace(/\/+$/, "");
      }
    };
    const liveOrigin = liveRaw ? tunnelOrigin(liveRaw) : "";
    let oldDisplay = "";
    if (diagnosis.relay.targetMismatch && snapshot.relayTargetUrl) {
      const relayOrig = tunnelOrigin(snapshot.relayTargetUrl);
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
      const pubOrig = tunnelOrigin(snapshot.tunnelPublicUrl);
      if (pubOrig && pubOrig !== liveOrigin) {
        oldDisplay = snapshot.tunnelPublicUrl.replace(/\/+$/, "");
      }
    }
    if (!oldDisplay) {
      oldDisplay =
        snapshot.tunnelPublicUrl ||
        (snapshot.relayTargetUrl
          ? tunnelOrigin(snapshot.relayTargetUrl)
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

const PENDING_DISCOVERY_SETUP_KEY = "pendingDiscoverySetup";

function hasPendingDiscoverySetup() {
  try {
    return sessionStorage.getItem(PENDING_DISCOVERY_SETUP_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function queuePendingDiscoverySetup() {
  try {
    sessionStorage.setItem(PENDING_DISCOVERY_SETUP_KEY, "1");
    return true;
  } catch (_) {
    return false;
  }
}

async function resumePendingDiscoverySetupIfNeeded() {
  if (!hasPendingDiscoverySetup()) return false;
  try {
    sessionStorage.removeItem(PENDING_DISCOVERY_SETUP_KEY);
  } catch (_) {
    /* ignore */
  }
  await openSettingsForDiscoveryWebhook();
  return true;
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
  if (
    (host().isOnboardingWizardVisible() || host().isFirstRunWizardVisible()) &&
    !allowWhileOnboarding
  ) {
    queuePendingDiscoverySetup();
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

/**
 * Fetch and process a single status poll for the active run.
 * Returns the parsed status body or null on error.
 * @param {string} webhookUrl
 * @returns {Promise<object|null>}
 */
async function pollRunStatus(webhookUrl) {
  const tracker = runTracker();
  const state = tracker.getState();
  if (!state.runId || !state.statusPath) return null;

  const statusUrl = buildRunStatusUrl(state.statusPath, webhookUrl);
  if (!statusUrl) return null;

  let response;
  try {
    response = await fetch(statusUrl, {
      method: "GET",
      mode: "cors",
      headers: buildDiscoveryStatusPollHeaders(statusUrl),
    });
  } catch (err) {
    tracker.markPollError(
      `Network error fetching status: ${err && err.message ? err.message : String(err)}`,
    );
    return null;
  }

  if (!response.ok) {
    tracker.markPollError(
      `Status endpoint returned HTTP ${response.status}`,
    );
    return null;
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    tracker.markPollError("Status response was not valid JSON");
    return null;
  }

  return data;
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
  if (
    status === "polling_error" &&
    Number((state && state.pollErrorCount) || 0) >= MAX_POLL_ERRORS &&
    String((state && state.runId) || "").trim()
  ) {
    // Status polling died before we saw a terminal payload, but the worker may
    // have finished writing Pipeline rows anyway (common on local/tunnel paths).
    return true;
  }
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
 * If the run status payload surfaces pre-filter rejections from the Fit
 * Profile pipeline, render a one-line banner summarizing what was filtered.
 * Tolerant of the upstream shape — looks at writeResult.rejectionSummary,
 * preFilterSummary, and similar field names so it works regardless of where
 * Task #3 chooses to land the data.
 */
function surfacePreFilterRejectionsFromStatus(statusData) {
  if (!statusData || typeof statusData !== "object") return;
  const summary =
    (statusData.writeResult && statusData.writeResult.rejectionSummary) ||
    statusData.preFilterSummary ||
    statusData.rejectionSummary ||
    null;
  if (!summary) return;

  // Accept either a map (reason → count) or an array of {reason, count}.
  const counts = {};
  if (Array.isArray(summary)) {
    for (const entry of summary) {
      if (!entry || typeof entry !== "object") continue;
      const reason = String(entry.reason || "");
      const count = Number(entry.count) || 1;
      if (reason in PRE_FILTER_REASON_LABELS) {
        counts[reason] = (counts[reason] || 0) + count;
      }
    }
  } else if (typeof summary === "object") {
    for (const [reason, count] of Object.entries(summary)) {
      if (reason in PRE_FILTER_REASON_LABELS) {
        const n = Number(count) || 0;
        if (n > 0) counts[reason] = n;
      }
    }
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
  if (tracker._pollTimer) {
    clearTimeout(tracker._pollTimer);
    tracker._pollTimer = null;
  }

  async function poll() {
    const state = tracker.getState();

    // If we've reached terminal or been cleared, stop
    if (!state.runId || state.status === "idle") {
      return;
    }

    const statusData = await pollRunStatus(pollingWebhookUrl);
    if (statusData) {
      tracker.updateFromStatusResponse(statusData);
      surfacePreFilterRejectionsFromStatus(statusData);
    }

    const updated = tracker.getState();

    if (updated.status === "polling_error") {
      if (updated.pollErrorCount >= MAX_POLL_ERRORS) {
        tracker.markStatusConnectionLost(
          "Lost the status connection after multiple attempts. The discovery run may still be running.",
        );
        await refreshPipelineAfterDiscoveryRun(tracker.getState());
        renderDiscoveryRunStatus();
        return;
      }
      // Exponential-ish back-off: 1s, 2s, 4s
      const backoff = Math.min(4000, 500 * Math.pow(2, updated.pollErrorCount));
      tracker._pollTimer = setTimeout(poll, backoff);
      return;
    }

    if (tracker.isTerminal()) {
      await refreshPipelineAfterDiscoveryRun(updated);
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

/** Stop any active polling loop without clearing run state */
function stopDiscoveryStatusPolling() {
  if (runTracker()._pollTimer) {
    clearTimeout(runTracker()._pollTimer);
    runTracker()._pollTimer = null;
  }
}

function resumeDiscoveryStatusPollingIfNeeded() {
  const state = runTracker().getState();
  if (!state.runId) return;
  if (!state.statusPath) {
    if (state.statusUnavailable && runTracker().isActive()) {
      renderDiscoveryRunStatus();
    }
    return;
  }
  if (state.status === "failed") {
    runTracker().resumeFromStatusPollingFailure();
  }
  const next = runTracker().getState();
  if (!runTracker().isActive()) return;
  renderDiscoveryRunStatus();
  void startDiscoveryStatusPolling(next.webhookUrl || host().getDiscoveryWebhookUrl());
}

/**
 * Render current run status into the discovery status bar (toast area / status chip).
 * Called after every tracker state change so the user sees live progress.
 */
function renderDiscoveryRunStatus() {
  const state = runTracker().getState();
  const openBtn = document.getElementById("discoveryBtn");

  if (state.status === "idle") {
    if (openBtn) {
      openBtn.classList.remove("loading", "run-pending", "run-running", "run-terminal");
      openBtn.removeAttribute("aria-label");
    }
    return;
  }

  // Apply CSS class for visual state on the button
  if (openBtn) {
    openBtn.classList.add("run-" + state.status);
    openBtn.classList.remove("loading");
  }

  // Build status message
  let statusMessage = "";
  let statusTone = "info";

  switch (state.status) {
    case "pending":
      statusMessage = state.statusUnavailable
        ? `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} accepted, but this worker did not return a status URL. Check Pipeline or Runs for the final result.`
        : `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} accepted — checking status…`;
      statusTone = "info";
      break;
    case "running":
      statusMessage = `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} in progress…`;
      statusTone = "info";
      break;
    case "polling_error":
      statusMessage =
        state.pollErrorCount >= MAX_POLL_ERRORS
          ? `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} accepted, but JobBored lost the status connection. The worker may still be running.`
          : `Run ${state.runId ? state.runId.slice(0, 8) + "…" : ""} — retrying status connection…`;
      statusTone = "warning";
      break;
    case "completed":
      statusMessage = "Discovery complete — new roles will appear in your sheet.";
      statusTone = "success";
      break;
    case "empty":
      statusMessage = "Discovery finished — no new roles found this run.";
      statusTone = "info";
      break;
    case "partial":
      statusMessage =
        "Discovery finished with partial results. " +
        (state.errorMessage ? state.errorMessage + ". " : "") +
        "Check the worker logs for details.";
      statusTone = "warning";
      break;
    case "failed":
      statusMessage =
        "Discovery run failed. " +
        (state.errorMessage ? state.errorMessage : "Check the worker logs.");
      statusTone = "error";
      break;
    default:
      statusMessage = "";
  }

  if (openBtn && statusMessage) {
    openBtn.setAttribute("aria-label", statusMessage);
    // Also surface in a toast for non-terminal states
    if (state.status !== "idle") {
      // Use a transient toast (non-blocking) for live updates
      const retryAction =
        state.status === "polling_error" &&
        state.statusPath &&
        state.pollErrorCount >= MAX_POLL_ERRORS
          ? { label: "Retry status", onClick: retryDiscoveryStatusConnection }
          : state.status === "pending" && state.statusUnavailable
            ? {
                label: "Open runs",
                onClick: () => {
                  document.getElementById("runsBtn")?.click();
                },
              }
          : undefined;
      host().showToast(
        statusMessage,
        statusTone,
        (state.status === "polling_error" &&
          state.pollErrorCount >= MAX_POLL_ERRORS) ||
          (state.status === "pending" && state.statusUnavailable),
        retryAction,
      );
    }
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

function runPostAccessBootstrapOnce() {
  if (postAccessBootstrapDone) return postAccessBootstrapPromise;
  postAccessBootstrapDone = true;
  postAccessBootstrapPromise = (async () => {
    const infraHandled = await host().checkInfraSetupGate();
    if (!infraHandled) {
      await host().checkOnboardingGate();
    }
    await handleDiscoverySetupDeepLink();
  })();
  return postAccessBootstrapPromise;
}

function resetPostAccessBootstrap() {
  postAccessBootstrapDone = false;
  postAccessBootstrapPromise = Promise.resolve();
}

  Object.assign(status, {
    PENDING_DISCOVERY_SETUP_KEY: PENDING_DISCOVERY_SETUP_KEY,
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
    hasPendingDiscoverySetup: hasPendingDiscoverySetup,
    queuePendingDiscoverySetup: queuePendingDiscoverySetup,
    resumePendingDiscoverySetupIfNeeded: resumePendingDiscoverySetupIfNeeded,
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
    pollRunStatus: pollRunStatus,
    retryDiscoveryStatusConnection: retryDiscoveryStatusConnection,
    shouldRefreshPipelineAfterDiscoveryRun: shouldRefreshPipelineAfterDiscoveryRun,
    refreshPipelineAfterDiscoveryRun: refreshPipelineAfterDiscoveryRun,
    startDiscoveryStatusPolling: startDiscoveryStatusPolling,
    stopDiscoveryStatusPolling: stopDiscoveryStatusPolling,
    resumeDiscoveryStatusPollingIfNeeded: resumeDiscoveryStatusPollingIfNeeded,
    renderDiscoveryRunStatus: renderDiscoveryRunStatus,
    handleDiscoverySetupDeepLink: handleDiscoverySetupDeepLink,
    runPostAccessBootstrapOnce: runPostAccessBootstrapOnce,
    resetPostAccessBootstrap: resetPostAccessBootstrap,
  });
})();
