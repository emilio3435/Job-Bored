/* ============================================
   COMMAND CENTER v2 — Discovery Run Orchestration
   Extracted from app.js (discovery-run-orchestration cut).

   Classic-global IIFE under window.JobBoredDiscovery.runOrchestration — NOT an ES module.
   Loaded BEFORE app.js (after ingest-url-flow.js).
   Run webhook resolution, local auto-setup, and triggerDiscoveryRun orchestration.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const runOrchestration = root.runOrchestration || (root.runOrchestration = {});

  const statusApi = window.JobBoredDiscovery.status;
  const discoveryRunTracker =
    window.JobBoredDiscovery.runTracker.discoveryRunTracker;

  function host() {
    return runOrchestration.host || {};
  }

  function h(name, ...args) {
    const fn = host()[name];
    return typeof fn === "function" ? fn(...args) : undefined;
  }

function generateDiscoveryVariationKey() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getDiscoveryRunWebhookUrlCandidates(snapshot, runtimeHints) {
  const state = snapshot && typeof snapshot === "object" ? snapshot : {};
  const hints =
    runtimeHints && typeof runtimeHints === "object" ? runtimeHints : null;
  const transport = h("getDiscoveryTransportSetupState");
  const relayInfo = h("getCloudflareRelayTargetInfo");
  const snapshotTunnelTargetUrl = h("buildDiscoveryTunnelTargetUrl",
    state.localWebhookUrl,
    state.tunnelPublicUrl,
  );
  const localTunnelTargetUrl = h("buildDiscoveryTunnelTargetUrl",
    transport.localWebhookUrl,
    transport.tunnelPublicUrl,
  );
  const allowDirectLocal =
    h("isLocalDashboardOrigin") &&
    (state.savedWebhookKind === "local_http" ||
      state.localWebhookReady === true ||
      !!transport.localWebhookUrl ||
      !!(hints && hints.workerUp));
  const candidates = [
    { url: h("getDiscoveryWebhookUrl"), source: "configured" },
    { url: state.savedWebhookUrl, source: "snapshot_saved" },
    { url: snapshotTunnelTargetUrl, source: "snapshot_tunnel_target" },
    { url: state.relayTargetUrl, source: "snapshot_relay_target" },
    { url: relayInfo && relayInfo.url, source: "relay_info" },
    { url: localTunnelTargetUrl, source: "local_tunnel_target" },
    {
      url: allowDirectLocal ? state.localWebhookUrl : "",
      source: "snapshot_local",
    },
    {
      url: allowDirectLocal ? transport.localWebhookUrl : "",
      source: "transport_local",
    },
  ];
  if (hints && hints.localWebhookUrl) {
    candidates.unshift({
      url: hints.localWebhookUrl,
      source: "live_worker",
    });
  }
  if (hints && hints.liveNgrokWebhookUrl) {
    candidates.push({
      url: hints.liveNgrokWebhookUrl,
      source: "live_ngrok",
    });
  }
  return candidates;
}

function isLocalWebhookCandidateUrl(raw) {
  const normalized = h("normalizeDiscoveryWebhookIdentity", raw);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    const host = String(url.hostname || "")
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch (_) {
    return false;
  }
}

function getDiscoveryRunWebhookCandidateProbe(candidate, snapshot, runtimeHints) {
  const src = candidate && typeof candidate === "object" ? candidate : {};
  const hints =
    runtimeHints && typeof runtimeHints === "object" ? runtimeHints : null;
  const url = h("normalizeDiscoveryWebhookIdentity", src.url || candidate);
  if (!url) {
    return { ok: false, url: "", source: src.source || "", score: -1 };
  }

  const verifyApi = h("getDiscoveryWizardVerifyApi");
  if (verifyApi && typeof verifyApi.classifyEndpointInput === "function") {
    const inputProblem = verifyApi.classifyEndpointInput(url);
    if (inputProblem && inputProblem.kind === "invalid_endpoint") {
      return {
        ok: false,
        url,
        source: src.source || "",
        score: -1,
        reason: inputProblem.message || "invalid_endpoint",
      };
    }
  }

  const state = snapshot && typeof snapshot === "object" ? snapshot : {};
  const local = isLocalWebhookCandidateUrl(url);
  const worker = h("isLikelyCloudflareWorkerUrl", url);
  const appsScript = h("isLikelyAppsScriptWebAppUrl", url);
  const hostedHttps = /^https:\/\//i.test(url) && !local;
  const source = String(src.source || "");
  let score = 10;

  if (local && !h("isLocalDashboardOrigin")) {
    return {
      ok: false,
      url,
      source,
      score: -1,
      reason: "local_only_on_hosted_dashboard",
    };
  }

  if (source.includes("local") && local && state.localWebhookReady) score += 90;
  else if (source === "live_worker" && local && hints && hints.workerUp) score += 200;
  else if (source.includes("local") && local) score += 20;
  if (source === "configured") score += 35;
  if (source === "snapshot_saved") score += 25;
  if (source === "live_ngrok" && hints && hints.liveNgrokWebhookUrl) score += 70;
  if (worker) score += h("isLocalDashboardOrigin") ? 45 : 80;
  else if (hostedHttps) score += h("isLocalDashboardOrigin") ? 35 : 65;
  if (source.includes("relay")) score += 20;
  if (source.includes("tunnel")) score += h("isLocalDashboardOrigin") ? 30 : 15;
  if (source === "snapshot_tunnel_target" && state.tunnelLive) score += 45;
  if (appsScript) score -= 20;

  const recovery = String(state.localRecoveryState || "ok");
  if (recovery !== "ok" && (local || source.includes("tunnel"))) {
    score -= 60;
  }
  if (
    state.tunnelLive &&
    state.tunnelPublicUrl &&
    h("isLikelyNgrokWebhookUrl", url) &&
    !h("sameDiscoveryUrlOrigin", url, state.tunnelPublicUrl)
  ) {
    score -= 120;
  }
  if (
    hints &&
    hints.workerUp &&
    h("isLocalDashboardOrigin") &&
    h("isLikelyNgrokWebhookUrl", url) &&
    (source === "configured" || source === "snapshot_saved")
  ) {
    score -= 90;
  }
  if (
    hints &&
    hints.liveNgrokWebhookUrl &&
    h("isLikelyNgrokWebhookUrl", url) &&
    !h("sameDiscoveryUrlOrigin", url, hints.liveNgrokWebhookUrl)
  ) {
    score -= 110;
  }
  if (!h("isLocalDashboardOrigin") && (worker || hostedHttps)) {
    score += 20;
  }

  return { ok: true, url, source, score };
}

async function fetchLocalDiscoveryRuntimeHints() {
  if (!h("isLocalDashboardOrigin")) return null;
  try {
    const resp = await fetch("/__proxy/discovery-state", {
      method: "GET",
      cache: "no-store",
    });
    const state = await resp.json().catch(() => null);
    if (!resp.ok || !state || state.ok !== true) return null;
    const worker = state.worker && typeof state.worker === "object" ? state.worker : {};
    const workerPort = Number.parseInt(String(worker.port || ""), 10);
    const port =
      Number.isInteger(workerPort) && workerPort > 0 && workerPort < 65536
        ? workerPort
        : 8644;
    const workerUp = worker.up === true;
    const liveNgrokUrl =
      state.ngrok && typeof state.ngrok.url === "string"
        ? state.ngrok.url.trim()
        : "";
    const liveNgrokWebhookUrl = liveNgrokUrl
      ? String(liveNgrokUrl).replace(/\/+$/, "") + "/webhook"
      : "";
    return {
      workerUp,
      workerPort: port,
      localWebhookUrl: workerUp ? `http://127.0.0.1:${port}/webhook` : "",
      liveNgrokUrl,
      liveNgrokWebhookUrl,
      recommendation: String(state.recommendation || "").trim(),
    };
  } catch (_) {
    return null;
  }
}

async function scoreDiscoveryRunWebhookCandidates(candidates, snapshot, runtimeHints) {
  const seen = new Set();
  const scored = [];
  for (const candidate of candidates || []) {
    const probe = getDiscoveryRunWebhookCandidateProbe(
      candidate,
      snapshot,
      runtimeHints,
    );
    if (!probe.ok || !probe.url || seen.has(probe.url)) continue;
    seen.add(probe.url);
    scored.push(probe);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

async function resolveDiscoveryRunWebhookUrl() {
  await h("hydrateDiscoveryTransportSetupFromLocalBootstrap");
  let snapshot = h("getDiscoveryReadinessSnapshot");
  try {
    snapshot = await h("refreshDiscoveryReadinessSnapshot", {
      force: true,
      rerender: false,
    });
    if (snapshot && snapshot.tunnelLive && snapshot.tunnelPublicUrl) {
      const transportPatch = { tunnelPublicUrl: snapshot.tunnelPublicUrl };
      if (snapshot.localWebhookUrl) {
        transportPatch.localWebhookUrl = snapshot.localWebhookUrl;
      }
      h("writeDiscoveryTransportSetupState", transportPatch);
    }
  } catch (err) {
    console.warn("[JobBored] discovery run readiness:", err);
  }

  const runtimeHints = await fetchLocalDiscoveryRuntimeHints();
  const scored = await scoreDiscoveryRunWebhookCandidates(
    getDiscoveryRunWebhookUrlCandidates(snapshot, runtimeHints),
    snapshot,
    runtimeHints,
  );
  return scored.length ? scored[0].url : "";
}

async function ensureLocalDiscoveryAutoSetupForRun() {
  if (!h("isLocalDashboardOrigin")) return false;
  let shouldRunSetup = true;
  try {
    const stateResp = await fetch("/__proxy/discovery-state", {
      method: "GET",
      cache: "no-store",
    });
    const state = await stateResp.json().catch(() => null);
    if (
      stateResp.ok &&
      state &&
      state.recommendation === "ready" &&
      (!state.worker || state.worker.originAllowed !== false)
    ) {
      return true;
    }
    shouldRunSetup = !!(
      state &&
      (state.recommendation === "auto_recoverable" ||
        state.recoverableHint === "origin_not_allowed" ||
        (state.worker && state.worker.originAllowed === false))
    );
  } catch (_) {
    shouldRunSetup = true;
  }
  if (!shouldRunSetup) return false;
  h("setDiscoveryWizardMessage",
    "Setting up local discovery from this dev server...",
    "info",
  );
  h("showToast", "Setting up local discovery...", "info");
  try {
    const resp = await fetch("/__proxy/fix-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body || !body.ok) {
      return false;
    }
    await h("hydrateDiscoveryTransportSetupFromLocalBootstrap");
    await h("refreshDiscoveryReadinessSnapshot", {
      force: true,
      rerender: false,
    });
    h("showToast", "Local discovery setup is ready.", "success");
    return true;
  } catch (err) {
    console.warn("[JobBored] local discovery auto setup failed:", err);
    return false;
  }
}

/** Notify automation (Hermes, n8n, etc.) to run another discovery pass (varied query). */
async function triggerDiscoveryRun(options) {
  const runOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  const runTrigger = String(runOptions.trigger || "manual").trim() || "manual";
  if (h("isLocalDashboardOrigin")) {
    await ensureLocalDiscoveryAutoSetupForRun();
    await h("warnDiscoverySourceReadinessBeforeRun");
  }
  let hook = await resolveDiscoveryRunWebhookUrl();
  if (!hook && (await ensureLocalDiscoveryAutoSetupForRun())) {
    await h("warnDiscoverySourceReadinessBeforeRun");
    hook = await resolveDiscoveryRunWebhookUrl();
  }
  if (!hook) {
    void h("requestDiscoverySetup", {
      entryPoint: "run_discovery",
      allowWhileOnboarding: true,
      skipAutodetect: true,
    });
    return { ok: false, reason: "no_url" };
  }
  try {
    const payload = await h("buildDiscoveryWebhookPayload", h("getSHEET_ID"), {
      trigger: runTrigger,
    });
    // Guardrail: verify intent is present before sending webhook request
    const profile = payload && payload.discoveryProfile;
    const targetRoles = (profile && profile.targetRoles || "").trim();
    const keywordsInclude = (profile && profile.keywordsInclude || "").trim();
    if (!targetRoles && !keywordsInclude) {
      h("showToast",
        "Add target roles or keywords to include, or use the AI Suggest tab to generate them.",
        "warning",
        true,
      );
      return { ok: false, reason: "blank_intent" };
    }
    const result = await h("verifyDiscoveryWebhookWithSharedModel", hook, payload, {
      context: "run_discovery",
      sheetId: h("getSHEET_ID") || "",
    });
    if (result.ok) {
      const engineState = h("getDiscoveryEngineStateFromVerificationResult", result);
      if (engineState) {
        await h("recordDiscoveryEngineState", hook, engineState, "run_discovery");
      }
      await h("refreshDiscoveryReadinessSnapshot", { force: true, rerender: false });
      h("showDiscoveryVerificationToast", result, { context: "run_discovery" });

      // Extract run tracking metadata from accepted_async responses and start polling
      if (result.kind === "accepted_async" && result.runId) {
        const webhookUrl = String(hook || "").trim();
        const statusPath = statusApi.resolveAcceptedRunStatusPath(result, webhookUrl);
        discoveryRunTracker.beginTracking({
          runId: result.runId,
          statusPath,
          pollAfterMs: Number.isFinite(result.pollAfterMs) ? result.pollAfterMs : 2000,
          webhookUrl,
          trigger: runTrigger,
          variationKey: payload.variationKey || "",
          requestedAt: payload.requestedAt || "",
          statusUnavailable: !statusPath,
        });
        // Show initial pending feedback immediately
        statusApi.renderDiscoveryRunStatus();
        // Start async polling — will update tracker state on each response
        if (statusPath) {
          void statusApi.startDiscoveryStatusPolling(webhookUrl);
        }
      }

      return { ok: true, kind: result.kind };
    }
    if (
      (result.kind === "network_error" || result.kind === "invalid_endpoint") &&
      (await h("handleAppsScriptBrowserCorsFailure", hook, result.kind))
    ) {
      // Apps Script stub is publicly accessible — CORS blocked the browser from
      // reading the response, but the endpoint did receive the request.
      // Classify as stub_only so the Run discovery path preserves wiring-only
      // semantics and does not report full-connected success.
      result.kind = "stub_only";
      result.engineState = "stub_only";
      h("showDiscoveryVerificationToast", result, {
        context: "run_discovery",
        endpointUrl: hook,
      });
      return { ok: false, kind: "stub_only" };
    }
    h("showDiscoveryVerificationToast", result, {
      context: "run_discovery",
      endpointUrl: hook,
    });
    return { ok: false, reason: result.kind || "http" };
  } catch (err) {
    console.error("[JobBored] Discovery webhook:", err);
    h("showToast", String(err && err.message ? err.message : err), "error", true);
    return { ok: false, reason: "error" };
  }
}

  Object.assign(runOrchestration, {
    generateDiscoveryVariationKey,
    getDiscoveryRunWebhookUrlCandidates,
    isLocalWebhookCandidateUrl,
    getDiscoveryRunWebhookCandidateProbe,
    scoreDiscoveryRunWebhookCandidates,
    resolveDiscoveryRunWebhookUrl,
    ensureLocalDiscoveryAutoSetupForRun,
    triggerDiscoveryRun,
  });

  Object.assign(root, {
    triggerRun: triggerDiscoveryRun,
    triggerScheduledRun(options) {
      return triggerDiscoveryRun(
        Object.assign({}, options || {}, {
          trigger: (options && options.trigger) || "scheduled-browser",
        }),
      );
    },
  });
})();
