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
  if (
    !askHostChange({
      action: "Run discovery",
      writesEnv: true,
      restartsWorker: true,
    })
  ) {
    h("showToast", "Discovery setup left unchanged — nothing on this computer was touched.", "info");
    return false;
  }
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


/**
 * UX01 C8 (FD-19): ask before a click changes this computer. Delegates to
 * JobBoredDiscoveryHelpers.confirmHostChange, which names what changes and
 * logs the answer.
 */
function askHostChange(opts) {
  const helpers = typeof window !== "undefined" ? window.JobBoredDiscoveryHelpers : null;
  if (helpers && typeof helpers.confirmHostChange === "function") {
    return helpers.confirmHostChange(opts);
  }
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return !!window.confirm(
      "JobBored will " +
        [
          opts && opts.writesEnv ? "update integrations/browser-use-discovery/.env" : "",
          opts && opts.restartsWorker ? "restart your local discovery worker" : "",
        ]
          .filter(Boolean)
          .join(", and ") +
        " on this computer. Continue?",
    );
  }
  return true;
}

/** Notify automation (Hermes, n8n, etc.) to run another discovery pass (varied query). */
// D3: single-flight. While a dispatch is in flight, or the tracker is still
// watching a run, it answers { ok:false, reason:"run_active", runId }. A run
// the browser can no longer watch (settled) blocks nothing. `options` passes
// through untouched to the payload build. Resolves { ok, reason?, kind?, runId? }.
async function triggerDiscoveryRun(options) {
  const runOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  const runTrigger = String(runOptions.trigger || "manual").trim() || "manual";
  const watching =
    typeof discoveryRunTracker.isActive === "function" && discoveryRunTracker.isActive();
  if (discoveryRunDispatchInFlight || watching) {
    const active =
      typeof discoveryRunTracker.getState === "function" ? discoveryRunTracker.getState() : {};
    if (runTrigger === "manual") {
      h("showToast",
        "A discovery run is already going — follow it in the Discovery drawer or Runs.",
        "info",
      );
    }
    return { ok: false, reason: "run_active", runId: String((active && active.runId) || "") };
  }
  discoveryRunDispatchInFlight = true;
  try {
    return await dispatchDiscoveryRun(runOptions, runTrigger);
  } catch (err) {
    console.error("[JobBored] Discovery webhook:", err);
    h("showToast", String(err && err.message ? err.message : err), "error", true);
    return { ok: false, reason: "error" };
  } finally {
    discoveryRunDispatchInFlight = false;
  }
}

// D3: one dispatch at a time per tab.
let discoveryRunDispatchInFlight = false;

/**
 * D3 across tabs: while this tab's POST was out, another tab may have started
 * a run this tab now follows. Answer run_active and leave that run in place
 * rather than replacing it with this dispatch's run or its unconfirmed marker.
 */
function anotherLiveRunId(runId) {
  const own = String(runId || "");
  const watching =
    typeof discoveryRunTracker.isActive === "function" && discoveryRunTracker.isActive()
      ? String(discoveryRunTracker.getState().runId || "")
      : "";
  if (watching && watching !== own) return watching;
  // Another tab's run may be in localStorage before its channel message
  // reaches this tab, so the stored run counts too (Grok DISCO r2).
  const stored =
    typeof discoveryRunTracker.storedActiveRunId === "function"
      ? discoveryRunTracker.storedActiveRunId()
      : "";
  return stored && stored !== own ? stored : "";
}

function answerRunActive(runTrigger, liveRunId) {
  if (runTrigger === "manual") {
    h("showToast",
      "A discovery run is already going — follow it in the Discovery drawer or Runs.",
      "info",
    );
  }
  return { ok: false, reason: "run_active", runId: liveRunId };
}

// §0.11: the dispatch POST waits a generous minute for the worker to answer.
const DISCOVERY_RUN_DISPATCH_TIMEOUT_MS = 60 * 1000;

/**
 * D16: the identity of a dispatch that timed out — it may have started a
 * run. Re-sending the same requestedAt + variationKey lets the worker answer
 * with that run (LIFECYCLE-1 dedupe) instead of starting a second one.
 */
function getPendingRedeliveryIdentity() {
  if (typeof discoveryRunTracker.getState !== "function") return null;
  const state = discoveryRunTracker.getState();
  if (!state.dispatchUnconfirmed || !state.variationKey || !state.requestedAt) return null;
  if (
    typeof discoveryRunTracker.isPastDeadline === "function" &&
    discoveryRunTracker.isPastDeadline(Date.now())
  ) {
    return null;
  }
  return { variationKey: state.variationKey, requestedAt: state.requestedAt };
}

async function dispatchDiscoveryRun(runOptions, runTrigger) {
  if (h("isLocalDashboardOrigin")) {
    await ensureLocalDiscoveryAutoSetupForRun();
    await h("warnDiscoverySourceReadinessBeforeRun");
  }
  // D11: the setup above was this click's one chance to change the computer.
  // Running it again when no endpoint resolved asked permission twice.
  let hook = await resolveDiscoveryRunWebhookUrl();
  if (!hook) {
    void h("requestDiscoverySetup", {
      entryPoint: "run_discovery",
      allowWhileOnboarding: true,
      skipAutodetect: true,
    });
    return { ok: false, reason: "no_url" };
  }
  try {
    // The drawer builds the payload it previewed and hands it back here, so the
    // request the user was shown is the request that ships. Every other caller
    // still builds its own.
    const builtPayload =
      runOptions.payload ||
      (await h("buildDiscoveryWebhookPayload", h("getSHEET_ID"), {
        trigger: runTrigger,
        hunt: runOptions.hunt,
      }));
    const redelivery = getPendingRedeliveryIdentity();
    const payload =
      redelivery && builtPayload ? { ...builtPayload, ...redelivery } : builtPayload;
    // Guardrail: verify intent is present before sending the webhook request.
    // The dashboard resolves intent through the SAME shared helper the worker
    // parser guards with (handle-discovery-webhook.ts), so a run the worker
    // would accept is never blocked here and vice versa: searchPlan.query and
    // master-profile identity roles both count as intent
    // (AGENT_CONTRACT.md rows 118 and 120), not just the top-level fields.
    const effectiveIntent = window.JobBoredEffectiveIntent.buildEffectiveIntent({
      discoveryProfile: payload && payload.discoveryProfile,
      mergedUserProfile: payload && payload.mergedUserProfile,
    });
    if (window.JobBoredEffectiveIntent.isBlankIntent(effectiveIntent)) {
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
      timeoutMs: DISCOVERY_RUN_DISPATCH_TIMEOUT_MS,
    });
    if (result.ok) {
      const engineState = h("getDiscoveryEngineStateFromVerificationResult", result);
      if (engineState) {
        await h("recordDiscoveryEngineState", hook, engineState, "run_discovery");
      }
      await h("refreshDiscoveryReadinessSnapshot", { force: true, rerender: false });
      h("showDiscoveryVerificationToast", result, { context: "run_discovery" });
      // D8: a stub received the request, but it cannot search — no run started.
      if (result.kind === "stub_only") {
        return { ok: false, reason: "stub_only", kind: "stub_only" };
      }

      // Extract run tracking metadata from accepted_async responses and start polling
      if (result.kind === "accepted_async" && result.runId) {
        const liveRunId = anotherLiveRunId(result.runId);
        if (liveRunId) return answerRunActive(runTrigger, liveRunId);
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
        } else {
          refreshBoardAfterUnwatchedRun({ immediate: false });
        }
      } else {
        // D9: a run that finished synchronously, or an async one with no run
        // id to follow — reload the board instead of waiting for its poll.
        refreshBoardAfterUnwatchedRun({ immediate: result.kind !== "accepted_async" });
      }

      return { ok: true, kind: result.kind, runId: String(result.runId || "") };
    }
    if (result.kind === "network_error" && result.timedOut) {
      const liveRunId = anotherLiveRunId("");
      if (liveRunId) return answerRunActive(runTrigger, liveRunId);
      // D16: no answer within the dispatch timeout is not "can't reach" — the
      // worker may have the run. Keep its identity for the next attempt.
      if (typeof discoveryRunTracker.markDispatchUnconfirmed === "function") {
        discoveryRunTracker.markDispatchUnconfirmed({
          webhookUrl: String(hook || "").trim(),
          trigger: runTrigger,
          variationKey: (payload && payload.variationKey) || "",
          requestedAt: (payload && payload.requestedAt) || "",
        });
        statusApi.renderDiscoveryRunStatus();
      }
      return { ok: false, reason: "may_have_started" };
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
      return { ok: false, reason: "stub_only", kind: "stub_only" };
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

function refreshBoardAfterUnwatchedRun(options) {
  if (statusApi && typeof statusApi.refreshPipelineAfterUnwatchedRun === "function") {
    statusApi.refreshPipelineAfterUnwatchedRun(options);
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
    getPendingRedeliveryIdentity,
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
