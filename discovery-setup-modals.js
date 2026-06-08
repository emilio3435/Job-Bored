/* ============================================
   COMMAND CENTER v2 — Discovery Setup Modals
   Extracted from app.js (discovery-setup-modals cut).

   Classic-global IIFE under window.JobBoredDiscovery.setupModals — NOT an ES module.
   Loaded BEFORE app.js (after discovery-run-orchestration.js).
   Settings test webhook, discovery paths/setup guide modals, local tunnel modal,
   Cloudflare relay modal, Apps Script CORS remediation, and setup guide init.
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

function openDiscoveryPathsModal() {
  const m = document.getElementById("discoveryPathsModal");
  if (m) m.style.display = "flex";
  document.getElementById("discoveryPathsDoneBtn")?.focus();
}

function closeDiscoveryPathsModal() {
  const m = document.getElementById("discoveryPathsModal");
  if (m) m.style.display = "none";
}

function openDiscoverySetupGuideModal() {
  const m = document.getElementById("discoverySetupGuideModal");
  if (m) m.style.display = "flex";
  document.getElementById("discoverySetupGuideDoneBtn")?.focus();
}

function closeDiscoverySetupGuideModal() {
  const m = document.getElementById("discoverySetupGuideModal");
  if (m) m.style.display = "none";
}

function renderDiscoveryLocalTunnelSetupUi() {
  const statusCard = document.getElementById("discoveryLocalTunnelStatus");
  const statusTitle = document.getElementById(
    "discoveryLocalTunnelStatusTitle",
  );
  const statusDetail = document.getElementById(
    "discoveryLocalTunnelStatusDetail",
  );
  const localInput = document.getElementById("discoveryLocalWebhookUrl");
  const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
  const healthValue = document.getElementById("discoveryLocalWebhookHealthUrl");
  const tunnelCommand = document.getElementById(
    "discoveryLocalTunnelStartCommand",
  );
  const publicTargetValue = document.getElementById(
    "discoveryLocalTunnelTargetValue",
  );
  const copyHealthBtn = document.getElementById(
    "discoveryLocalTunnelCopyHealthBtn",
  );
  const copyTargetBtn = document.getElementById(
    "discoveryLocalTunnelCopyTargetBtn",
  );
  const copyStartBtn = document.getElementById(
    "discoveryLocalTunnelCopyStartBtn",
  );
  const openRelayBtn = document.getElementById("discoveryLocalTunnelRelayBtn");
  if (
    !statusCard ||
    !statusTitle ||
    !statusDetail ||
    !healthValue ||
    !tunnelCommand ||
    !publicTargetValue
  ) {
    return;
  }

  const localWebhookUrl = h("normalizeDiscoveryLocalWebhookUrl",
    localInput ? localInput.value : "",
  );
  const tunnelPublicUrl = h("normalizeDiscoveryTunnelPublicUrl",
    tunnelInput ? tunnelInput.value : "",
  );
  const publicTargetUrl = h("buildDiscoveryTunnelTargetUrl",
    localWebhookUrl,
    tunnelPublicUrl,
  );
  const healthUrl = h("getDiscoveryLocalWebhookHealthUrl", localWebhookUrl);
  const port = h("inferLocalWebhookPort", localWebhookUrl);

  let tone = "info";
  let title = "Start with your local discovery receiver.";
  let detail =
    "Recommended: use the browser-use worker on this machine. Paste the exact local webhook URL, then start ngrok on the same port and paste the public HTTPS forwarding URL. Advanced only: you can still use a Hermes/OpenClaw route.";

  if (localWebhookUrl && !tunnelPublicUrl) {
    tone = "warning";
    title = "Local receiver saved. Public tunnel still missing.";
    detail = `Your local receiver is on port ${port}. Run ngrok on that port, then paste the https:// forwarding URL here.`;
  } else if (!localWebhookUrl && tunnelPublicUrl) {
    tone = "warning";
    title = "Public tunnel saved. Local receiver path still missing.";
    detail =
      "Paste the exact local webhook URL too, so JobBored can build the public target path for the Cloudflare Worker.";
  } else if (publicTargetUrl) {
    tone = "success";
    title = "Public target ready for the Cloudflare relay.";
    detail =
      "Use the generated target below as TARGET_URL in the Worker helper. Keep Discovery webhook URL pointed at the Worker, not ngrok directly.";
  }

  statusCard.className = `settings-apps-script-status settings-apps-script-status--${tone}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;

  healthValue.textContent =
    healthUrl || "Paste your local webhook URL to generate /health.";
  tunnelCommand.textContent = `ngrok http ${port}`;
  if (copyStartBtn) {
    copyStartBtn.setAttribute("data-copy-text", tunnelCommand.textContent);
  }
  publicTargetValue.textContent =
    publicTargetUrl ||
    "Paste both the local webhook URL and the public ngrok URL to generate the target.";

  if (copyHealthBtn) copyHealthBtn.disabled = !healthUrl;
  if (copyTargetBtn) copyTargetBtn.disabled = !publicTargetUrl;
  if (openRelayBtn) openRelayBtn.disabled = !publicTargetUrl;
}

function populateDiscoveryLocalTunnelModal() {
  const state = h("getDiscoveryTransportSetupState");
  const localInput = document.getElementById("discoveryLocalWebhookUrl");
  const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
  if (localInput) localInput.value = state.localWebhookUrl || "";
  if (tunnelInput) tunnelInput.value = state.tunnelPublicUrl || "";
  renderDiscoveryLocalTunnelSetupUi();
}

async function openDiscoveryLocalTunnelModal() {
  await h("hydrateDiscoveryTransportSetupFromLocalBootstrap");
  populateDiscoveryLocalTunnelModal();
  const modal = document.getElementById("discoveryLocalTunnelModal");
  if (modal) modal.style.display = "flex";
  document.getElementById("discoveryLocalWebhookUrl")?.focus();
  void probeAndShowTunnelStaleBanner();
}

async function probeNgrokFromLocalApi() {
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller
      ? window.setTimeout(() => controller.abort(), 2500)
      : null;
    try {
      const res = await fetch("/__proxy/ngrok-tunnels", {
        cache: "no-store",
        signal: controller ? controller.signal : undefined,
      });
      if (!res.ok) return "";
      const data = await res.json().catch(() => null);
      const tunnels = Array.isArray(data && data.tunnels) ? data.tunnels : [];
      for (const t of tunnels) {
        const url = String(t && (t.public_url || t.publicUrl || "")).trim();
        if (/^https:\/\//i.test(url)) return url.replace(/\/+$/, "");
      }
      const direct = String(
        data && (data.public_url || data.publicUrl || ""),
      ).trim();
      return /^https:\/\//i.test(direct) ? direct.replace(/\/+$/, "") : "";
    } finally {
      if (timeout != null) window.clearTimeout(timeout);
    }
  } catch (_) {
    return "";
  }
}

async function probeAndShowTunnelStaleBanner() {
  const banner = document.getElementById("tunnelStaleBanner");
  if (!banner) return;

  const bannerTitle = document.getElementById("tunnelStaleBannerTitle");
  const bannerDetail = document.getElementById("tunnelStaleBannerDetail");
  const bannerAction = document.getElementById("tunnelStaleBannerAction");
  if (!bannerTitle || !bannerDetail || !bannerAction) return;

  if (!h("isLocalDashboardOrigin")) {
    banner.style.display = "none";
    return;
  }

  const stored = h("getDiscoveryTransportSetupState");
  const storedUrl = (stored.tunnelPublicUrl || "").replace(/\/+$/, "");

  const liveUrl = await probeNgrokFromLocalApi();

  if (!liveUrl && !storedUrl) {
    banner.style.display = "none";
    return;
  }

  if (!liveUrl) {
    banner.style.display = "flex";
    banner.className = "tunnel-stale-banner tunnel-stale-banner--down";
    const port = h("inferLocalWebhookPort", stored.localWebhookUrl);
    bannerTitle.textContent = "No ngrok tunnel detected.";
    bannerDetail.textContent = `Run ngrok http ${port} to restart the public tunnel to your local worker, then click Detect.`;
    bannerAction.style.display = "none";
    return;
  }

  if (storedUrl && liveUrl !== storedUrl) {
    banner.style.display = "flex";
    banner.className = "tunnel-stale-banner";
    bannerTitle.textContent = "Public tunnel changed.";
    bannerDetail.textContent = [
      "ngrok gave your local setup a new public URL.",
      `Previous tunnel: ${storedUrl}`,
      `Current tunnel: ${liveUrl}`,
      "Use the current tunnel URL here, then redeploy the Cloudflare relay. Keep the same Worker URL saved in JobBored.",
    ].join("\n");
    bannerAction.textContent = "Use current URL";
    bannerAction.style.display = "";
    bannerAction.onclick = () => {
      const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
      if (tunnelInput) tunnelInput.value = liveUrl;
      renderDiscoveryLocalTunnelSetupUi();
      saveDiscoveryLocalTunnelSetup(true);
      const relayBtn = document.getElementById("discoveryLocalTunnelRelayBtn");
      if (relayBtn && typeof relayBtn.focus === "function") relayBtn.focus();
      h("showToast",
        "Tunnel URL updated. Redeploy the Cloudflare relay so it points at the new tunnel. Keep the same Worker URL saved in JobBored.",
        "info",
      );
      banner.style.display = "none";
    };
    return;
  }

  banner.style.display = "none";
}

function closeDiscoveryLocalTunnelModal() {
  const modal = document.getElementById("discoveryLocalTunnelModal");
  if (modal) modal.style.display = "none";
}

async function probeTunnelStaleBadge() {
  const badge = document.getElementById("settingsTunnelStaleBadge");
  if (!badge || !h("isLocalDashboardOrigin")) {
    if (badge) badge.style.display = "none";
    return;
  }
  const stored = h("getDiscoveryTransportSetupState");
  if (!stored.tunnelPublicUrl) {
    badge.style.display = "none";
    return;
  }
  const liveUrl = await probeNgrokFromLocalApi();
  const storedNorm = stored.tunnelPublicUrl.replace(/\/+$/, "");
  const stale = !liveUrl || liveUrl !== storedNorm;
  badge.style.display = stale ? "inline-block" : "none";
}

function saveDiscoveryLocalTunnelSetup(openRelayAfterSave) {
  const localInput = document.getElementById("discoveryLocalWebhookUrl");
  const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
  if (!localInput || !tunnelInput) return;

  const localRaw = String(localInput.value || "").trim();
  const tunnelRaw = String(tunnelInput.value || "").trim();
  const localWebhookUrl = h("normalizeDiscoveryLocalWebhookUrl", localRaw);
  const tunnelPublicUrl = h("normalizeDiscoveryTunnelPublicUrl", tunnelRaw);

  if (localRaw && !localWebhookUrl) {
    h("showToast", "Paste a valid http:// or https:// local webhook URL.", "error");
    localInput.focus();
    return;
  }
  if (tunnelRaw && !tunnelPublicUrl) {
    h("showToast", "Paste a valid https:// ngrok forwarding URL.", "error");
    tunnelInput.focus();
    return;
  }

  const previousState = h("getDiscoveryTransportSetupState");
  const tunnelUrlChanged =
    tunnelPublicUrl &&
    previousState.tunnelPublicUrl &&
    tunnelPublicUrl !== previousState.tunnelPublicUrl;

  h("writeDiscoveryTransportSetupState", {
    localWebhookUrl,
    tunnelPublicUrl,
  });
  renderDiscoveryLocalTunnelSetupUi();

  const shouldOpenRelay = openRelayAfterSave || tunnelUrlChanged;

  if (shouldOpenRelay) {
    const publicTargetUrl = h("buildDiscoveryTunnelTargetUrl",
      localWebhookUrl,
      tunnelPublicUrl,
    );
    if (!publicTargetUrl) {
      h("showToast",
        "Paste both the local webhook URL and the ngrok URL first.",
        "error",
      );
      return;
    }
    closeDiscoveryLocalTunnelModal();
    void openCloudflareRelaySetupModal();
    const deployCommand = h("buildDiscoveryRelayDeployCommandForTarget",
      publicTargetUrl,
      {},
    );
    h("showToast",
      tunnelUrlChanged
        ? "ngrok URL updated. Copy the command, paste it into a terminal in the Job-Bored repo, and press Enter."
        : "Local tunnel info saved. Copy the relay command, paste it into a terminal in the Job-Bored repo, and press Enter.",
      tunnelUrlChanged ? "warning" : "success",
      tunnelUrlChanged,
      h("createDiscoveryRelayCopyCommandToastAction", deployCommand),
    );
    return;
  }

  h("showToast", "Local tunnel info saved in this browser.", "success");
}

function populateCloudflareRelaySetupModal() {
  const statusCard = document.getElementById("cloudflareRelayStatus");
  const statusTitle = document.getElementById("cloudflareRelayStatusTitle");
  const statusDetail = document.getElementById("cloudflareRelayStatusDetail");
  const targetValue = document.getElementById("cloudflareRelayTargetValue");
  const agentPrompt = document.getElementById("cloudflareRelayAgentPrompt");
  const deployCommand = document.getElementById("cloudflareRelayDeployCommand");
  const originValue = document.getElementById("cloudflareRelayOriginValue");
  const corsSnippet = document.getElementById("cloudflareRelayCorsSnippet");
  const workerInput = document.getElementById("cloudflareRelayWorkerUrl");
  const copyTargetBtn = document.getElementById("cloudflareRelayCopyTargetBtn");
  const copyPromptBtn = document.getElementById(
    "cloudflareRelayCopyAgentPromptBtn",
  );
  const copyCommandBtn = document.getElementById(
    "cloudflareRelayCopyDeployCommandBtn",
  );
  if (
    !statusCard ||
    !statusTitle ||
    !statusDetail ||
    !targetValue ||
    !agentPrompt ||
    !deployCommand ||
    !originValue ||
    !corsSnippet
  ) {
    return;
  }

  const targetInfo = h("getCloudflareRelayTargetInfo");
  const targetUrl = targetInfo.url;
  const currentWebhookUrl =
    h("getSettingsFieldValue", "settingsDiscoveryWebhookUrl").trim() ||
    h("getDiscoveryWebhookUrl");
  const suggestedOrigin = h("getDiscoveryRelaySuggestedOrigin") || "*";
  const workerName = h("getDiscoveryRelayWorkerName", targetUrl, currentWebhookUrl);
  const sheetId = h("getSettingsSheetIdValue") || "";

  let tone = "info";
  let title = "Fastest path: let your coding agent deploy the relay.";
  let detail =
    "The local helper script handles Wrangler deploy + TARGET_URL secret upload. You only need Cloudflare auth when the agent asks for it.";

  if (!targetUrl) {
    tone = "warning";
    title = "No webhook URL detected yet.";
    detail =
      "Deploy Apps Script first, or paste its /exec URL into Discovery webhook URL.";
  } else if (
    h("isLikelyCloudflareWorkerUrl", currentWebhookUrl) &&
    targetInfo.source === "managed"
  ) {
    title = "Current webhook already looks like a Cloudflare Worker.";
    detail =
      "The target below comes from your managed Apps Script deploy. Use it as TARGET_URL if you are re-creating or rotating the relay.";
  } else if (targetInfo.source === "managed") {
    detail =
      "Using the managed Apps Script deploy URL from this browser as TARGET_URL.";
  } else if (targetInfo.source === "local_tunnel") {
    title = "Using your ngrok tunnel as the relay target.";
    detail =
      "The Worker will forward requests to your tunnel, which reaches your local server.";
  } else if (!h("isLikelyAppsScriptWebAppUrl", targetUrl)) {
    tone = "warning";
    title = "Current webhook URL does not look like Apps Script.";
    detail =
      "You can still use the Worker as a generic relay, but this path is mainly meant for Apps Script /exec CORS failures.";
  }

  statusCard.className = `settings-apps-script-status settings-apps-script-status--${tone}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;

  targetValue.textContent =
    targetUrl || "No Apps Script /exec URL detected yet.";
  if (copyTargetBtn) copyTargetBtn.disabled = !targetUrl;

  const deployCommandText = targetUrl
    ? h("buildDiscoveryRelayDeployCommandForTarget", targetUrl, {
        origin: suggestedOrigin,
        workerName,
        workerUrl: currentWebhookUrl,
        sheetId,
      })
    : "Deploy Apps Script first to generate a one-command Cloudflare relay setup.";
  agentPrompt.textContent = h("buildCloudflareRelayAgentPrompt",
    targetUrl,
    suggestedOrigin,
    workerName,
    sheetId,
  );
  deployCommand.textContent = deployCommandText;
  if (copyPromptBtn) copyPromptBtn.disabled = !targetUrl;
  if (copyCommandBtn) copyCommandBtn.disabled = !targetUrl;

  originValue.textContent = suggestedOrigin;
  corsSnippet.textContent = h("buildCloudflareRelayCorsSnippet", suggestedOrigin);

  if (workerInput) {
    workerInput.value = h("isLikelyCloudflareWorkerUrl", currentWebhookUrl)
      ? currentWebhookUrl
      : "";
  }
}

async function openCloudflareRelaySetupModal() {
  if (h("showAppsScriptPublicAccessRemediationFromState")) {
    h("showToast",
      "Fix Apps Script public access first. Cloudflare relay is not the next step until Google allows anonymous access.",
      "error",
      true,
    );
    return;
  }
  await h("hydrateDiscoveryTransportSetupFromLocalBootstrap");
  populateCloudflareRelaySetupModal();
  const m = document.getElementById("cloudflareRelaySetupModal");
  if (m) m.style.display = "flex";
  const promptBtn = document.getElementById(
    "cloudflareRelayCopyAgentPromptBtn",
  );
  if (promptBtn && !promptBtn.disabled) {
    promptBtn.focus();
    return;
  }
  document.getElementById("cloudflareRelayWorkerUrl")?.focus();
}

function closeCloudflareRelaySetupModal() {
  const m = document.getElementById("cloudflareRelaySetupModal");
  if (m) m.style.display = "none";
}


async function openCloudflareRelaySetupFromAppsScriptFailure() {
  if (!h("isSettingsModalOpen")) {
    await h("openCommandCenterSettingsModal");
  }
  await openCloudflareRelaySetupModal();
}

async function applyCloudflareRelayWorkerUrl(testAfterApply) {
  const input = document.getElementById("cloudflareRelayWorkerUrl");
  const urlField = document.getElementById("settingsDiscoveryWebhookUrl");
  const workerUrl = input ? String(input.value || "").trim() : "";
  if (!input || !urlField) return;

  if (!workerUrl) {
    h("showToast", "Paste your deployed Worker URL first", "error");
    input.focus();
    return;
  }

  let parsed;
  try {
    parsed = new URL(workerUrl);
  } catch (_) {
    h("showToast", "Paste a valid https:// Worker URL", "error");
    input.focus();
    return;
  }

  if (parsed.protocol !== "https:") {
    h("showToast", "Use an https:// Worker URL", "error");
    input.focus();
    return;
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith("/forward")) {
    h("showToast",
      "Use the open Worker URL, not /forward — the dashboard does not send custom auth headers yet.",
      "error",
      true,
    );
    input.focus();
    return;
  }

  const normalizedWorkerUrl = parsed.toString();

  urlField.value = normalizedWorkerUrl;
  h("mergeStoredConfigOverridePatch", {
    discoveryWebhookUrl: normalizedWorkerUrl,
  });
  h("syncDiscoveryButtonState");
  closeCloudflareRelaySetupModal();

  if (testAfterApply) {
    h("showToast", "Worker URL saved. Testing from this browser…", "info");
    await testDiscoveryWebhookFromSettings();
    return;
  }

  h("focusDiscoveryWebhookFieldInSettings");
  h("showToast", "Worker URL saved in this browser.", "success");
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
  document
    .getElementById("settingsDiscoveryGuideBtn")
    ?.addEventListener("click", () => {
      void h("requestDiscoverySetup", {
        entryPoint: "settings",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("settingsDiscoveryLocalSetupBtn")
    ?.addEventListener("click", () => {
      void h("requestDiscoverySetup", {
        entryPoint: "settings",
        flow: "local_agent",
        startStep: "bootstrap",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("settingsDiscoveryRelayBtn")
    ?.addEventListener("click", () => {
      void h("requestDiscoverySetup", {
        entryPoint: "settings",
        flow: "local_agent",
        startStep: "relay_deploy",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("settingsDiscoveryTailscaleBtn")
    ?.addEventListener("click", () => {
      void h("requestDiscoverySetup", {
        entryPoint: "settings",
        flow: "external_endpoint",
        startStep: "existing_endpoint",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("settingsDiscoveryPathsBtn")
    ?.addEventListener("click", () => {
      openDiscoveryPathsModal();
    });
  document
    .getElementById("settingsDiscoveryTestBtn")
    ?.addEventListener("click", () => {
      void testDiscoveryWebhookFromSettings();
    });

  document
    .getElementById("discoveryPathsModalClose")
    ?.addEventListener("click", () => {
      closeDiscoveryPathsModal();
    });
  document
    .getElementById("discoveryPathsDoneBtn")
    ?.addEventListener("click", () => {
      closeDiscoveryPathsModal();
    });
  const pathsOverlay = document.getElementById("discoveryPathsModal");
  if (pathsOverlay) {
    pathsOverlay.addEventListener("click", (e) => {
      if (e.target === pathsOverlay) closeDiscoveryPathsModal();
    });
  }

  document
    .getElementById("discoverySetupGuideModalClose")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
    });
  document
    .getElementById("discoverySetupGuideDoneBtn")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
    });
  document
    .getElementById("discoverySetupGuideLocalBtn")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
      void h("requestDiscoverySetup", {
        entryPoint: "guide",
        flow: "local_agent",
        startStep: "bootstrap",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("discoverySetupGuideRelayBtn")
    ?.addEventListener("click", () => {
      closeDiscoverySetupGuideModal();
      void h("requestDiscoverySetup", {
        entryPoint: "guide",
        flow: "local_agent",
        startStep: "relay_deploy",
        allowWhileOnboarding: true,
      });
    });
  const guideOverlay = document.getElementById("discoverySetupGuideModal");
  if (guideOverlay) {
    guideOverlay.addEventListener("click", (e) => {
      if (e.target === guideOverlay) closeDiscoverySetupGuideModal();
    });
  }

  document
    .getElementById("discoveryLocalTunnelModalClose")
    ?.addEventListener("click", () => {
      closeDiscoveryLocalTunnelModal();
    });
  document
    .getElementById("discoveryLocalTunnelDoneBtn")
    ?.addEventListener("click", () => {
      closeDiscoveryLocalTunnelModal();
    });
  document
    .getElementById("discoveryLocalTunnelSaveBtn")
    ?.addEventListener("click", () => {
      saveDiscoveryLocalTunnelSetup(false);
    });
  document
    .getElementById("discoveryLocalTunnelRelayBtn")
    ?.addEventListener("click", () => {
      saveDiscoveryLocalTunnelSetup(true);
    });
  document
    .getElementById("discoveryLocalTunnelCopyHealthBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("discoveryLocalWebhookHealthUrl");
      if (!text || !text.textContent) return;
      h("copyTextToClipboard", text.textContent);
    });
  document
    .getElementById("discoveryLocalTunnelCopyTargetBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("discoveryLocalTunnelTargetValue");
      if (!text || !text.textContent) return;
      h("copyTextToClipboard", text.textContent);
    });
  document
    .querySelectorAll(
      "#discoveryLocalTunnelModal .btn-copy-scraper[data-copy-text]",
    )
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-copy-text");
        if (text) h("copyTextToClipboard", text);
      });
    });
  document
    .getElementById("discoveryLocalWebhookUrl")
    ?.addEventListener("input", () => {
      renderDiscoveryLocalTunnelSetupUi();
    });
  document
    .getElementById("discoveryTunnelPublicUrl")
    ?.addEventListener("input", () => {
      renderDiscoveryLocalTunnelSetupUi();
    });
  document
    .getElementById("tunnelDetectBtn")
    ?.addEventListener("click", async () => {
      const btn = document.getElementById("tunnelDetectBtn");
      const hint = document.getElementById("tunnelDetectHint");
      const tunnelInput = document.getElementById("discoveryTunnelPublicUrl");
      if (!btn || !tunnelInput) return;

      btn.disabled = true;
      btn.textContent = "Detecting\u2026";
      try {
        const liveUrl = await probeNgrokFromLocalApi();
        if (liveUrl) {
          const oldVal = tunnelInput.value.trim().replace(/\/+$/, "");
          tunnelInput.value = liveUrl;
          renderDiscoveryLocalTunnelSetupUi();
          if (hint) {
            const changed = oldVal && oldVal !== liveUrl;
            hint.innerHTML = changed
              ? "<strong>Updated</strong> \u2014 ngrok URL was refreshed."
              : "<strong>Detected</strong> \u2014 ngrok tunnel found.";
            hint.classList.add("tunnel-detect-hint--updated");
            setTimeout(
              () => hint.classList.remove("tunnel-detect-hint--updated"),
              3000,
            );
          }
        } else {
          const port = h("inferLocalWebhookPort",
            document.getElementById("discoveryLocalWebhookUrl")?.value || "",
          );
          if (hint) {
            hint.innerHTML = `No tunnel found. Run <code class="modal-code">ngrok http ${port}</code> first.`;
          }
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "Detect";
      }
    });
  const localTunnelOverlay = document.getElementById(
    "discoveryLocalTunnelModal",
  );
  if (localTunnelOverlay) {
    localTunnelOverlay.addEventListener("click", (e) => {
      if (e.target === localTunnelOverlay) closeDiscoveryLocalTunnelModal();
    });
  }

  document
    .getElementById("cloudflareRelaySetupModalClose")
    ?.addEventListener("click", () => {
      closeCloudflareRelaySetupModal();
    });
  document
    .getElementById("cloudflareRelaySetupDoneBtn")
    ?.addEventListener("click", () => {
      closeCloudflareRelaySetupModal();
    });
  document
    .getElementById("cloudflareRelayCopyTargetBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayTargetValue");
      if (!text || !text.textContent) return;
      h("copyTextToClipboard", text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyAgentPromptBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayAgentPrompt");
      if (!text || !text.textContent) return;
      h("copyTextToClipboard", text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyDeployCommandBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayDeployCommand");
      if (!text || !text.textContent) return;
      h("copyTextToClipboard", text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyManualCommandsBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayCommandBlock");
      if (!text || !text.textContent) return;
      h("copyTextToClipboard", text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyCorsBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayCorsSnippet");
      if (!text || !text.textContent) return;
      h("copyTextToClipboard", text.textContent);
    });
  document
    .getElementById("cloudflareRelayCopyOriginBtn")
    ?.addEventListener("click", () => {
      const text = document.getElementById("cloudflareRelayOriginValue");
      if (!text || !text.textContent) return;
      h("copyTextToClipboard", text.textContent);
    });
  document
    .getElementById("cloudflareRelayUseBtn")
    ?.addEventListener("click", () => {
      void applyCloudflareRelayWorkerUrl(false);
    });
  document
    .getElementById("cloudflareRelayUseAndTestBtn")
    ?.addEventListener("click", () => {
      void applyCloudflareRelayWorkerUrl(true);
    });
  const relayOverlay = document.getElementById("cloudflareRelaySetupModal");
  if (relayOverlay) {
    relayOverlay.addEventListener("click", (e) => {
      if (e.target === relayOverlay) closeCloudflareRelaySetupModal();
    });
  }

  document
    .querySelectorAll(
      "#discoverySetupGuideModal .btn-copy-scraper[data-copy-text]",
    )
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-copy-text");
        if (text) h("copyTextToClipboard", text);
      });
    });

  document
    .getElementById("discoveryHelpFullGuideBtn")
    ?.addEventListener("click", () => {
      const help = document.getElementById("discoveryHelpModal");
      if (help) help.style.display = "none";
      void h("requestDiscoverySetup", {
        entryPoint: "help",
        allowWhileOnboarding: true,
      });
    });
  document
    .getElementById("discoveryHelpPathsBtn")
    ?.addEventListener("click", () => {
      const help = document.getElementById("discoveryHelpModal");
      if (help) help.style.display = "none";
      openDiscoveryPathsModal();
    });

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const relay = document.getElementById("cloudflareRelaySetupModal");
      if (relay && relay.style.display === "flex") {
        e.preventDefault();
        e.stopPropagation();
        closeCloudflareRelaySetupModal();
        return;
      }
      const guide = document.getElementById("discoverySetupGuideModal");
      if (guide && guide.style.display === "flex") {
        e.preventDefault();
        e.stopPropagation();
        closeDiscoverySetupGuideModal();
        return;
      }
      const localTunnel = document.getElementById("discoveryLocalTunnelModal");
      if (localTunnel && localTunnel.style.display === "flex") {
        e.preventDefault();
        e.stopPropagation();
        closeDiscoveryLocalTunnelModal();
        return;
      }
      const paths = document.getElementById("discoveryPathsModal");
      if (paths && paths.style.display === "flex") {
        e.preventDefault();
        e.stopPropagation();
        closeDiscoveryPathsModal();
      }
    },
    true,
  );
}
  Object.assign(setupModals, {
    testDiscoveryWebhookFromSettings,
    openDiscoveryPathsModal,
    closeDiscoveryPathsModal,
    openDiscoverySetupGuideModal,
    closeDiscoverySetupGuideModal,
    renderDiscoveryLocalTunnelSetupUi,
    populateDiscoveryLocalTunnelModal,
    openDiscoveryLocalTunnelModal,
    probeNgrokFromLocalApi,
    probeAndShowTunnelStaleBanner,
    closeDiscoveryLocalTunnelModal,
    probeTunnelStaleBadge,
    saveDiscoveryLocalTunnelSetup,
    populateCloudflareRelaySetupModal,
    openCloudflareRelaySetupModal,
    closeCloudflareRelaySetupModal,
    openCloudflareRelaySetupFromAppsScriptFailure,
    applyCloudflareRelayWorkerUrl,
    handleAppsScriptBrowserCorsFailure,
    initDiscoverySetupGuide,
  });
})();
