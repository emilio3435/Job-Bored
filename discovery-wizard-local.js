(() => {
  const root =
    window.JobBoredDiscoveryWizard || (window.JobBoredDiscoveryWizard = {});
  const local = root.local || (root.local = {});

  const LOCAL_BOOTSTRAP_STATE_PATH = "discovery-local-bootstrap.json";
  const NGROK_TOKEN_URL =
    "https://dashboard.ngrok.com/get-started/your-authtoken";
  const LOCAL_STEP_IDS = Object.freeze([
    "detect",
    "path_select",
    "bootstrap",
    "local_health",
    "tunnel",
    "relay_deploy",
    "verify",
    "ready",
  ]);
  const LOCAL_ACTION_IDS = Object.freeze([
    "local_bootstrap_refresh",
    "local_health_check",
    "local_tunnel_detect",
    "local_relay_apply",
    "local_verify_end_to_end",
  ]);
  // Shared URL helpers delegate to the canonical implementation in discovery-shared-helpers.js
  const H = window.JobBoredDiscoveryHelpers || {};

  function asString(raw, fallback = "") {
    return typeof H.asString === "function" ? H.asString(raw, fallback) : (raw == null ? "" : String(raw).trim()) || fallback;
  }

  function normalizeUrl(raw) {
    return typeof H.normalizeUrl === "function" ? H.normalizeUrl(raw) : (raw != null ? String(raw).trim() : "");
  }

  function inferPortFromUrl(raw, fallback = "8644") {
    return typeof H.inferPortFromUrl === "function" ? H.inferPortFromUrl(raw, fallback) : (() => {
      const url = normalizeUrl(raw);
      if (!url) return asString(fallback, "8644");
      try {
        const parsed = new URL(url);
        if (parsed.port) return parsed.port;
        return parsed.protocol === "https:" ? "443" : "80";
      } catch (_) {
        return asString(fallback, "8644");
      }
    })();
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

  function buildLocalBootstrapUrl() {
    return LOCAL_BOOTSTRAP_STATE_PATH;
  }

  function cloneList(values) {
    return Array.isArray(values) ? [...values] : [];
  }

  function uniqueList(values) {
    return [
      ...new Set(
        cloneList(values)
          .map((value) => asString(value))
          .filter(Boolean),
      ),
    ];
  }

  function getProbesApi() {
    return root.probes || null;
  }

  function getWizardContract() {
    return root.contract || {};
  }

  function normalizeWizardState(state) {
    const shellApi = root.shell;
    if (shellApi && typeof shellApi.normalizeWizardState === "function") {
      return shellApi.normalizeWizardState(state);
    }
    const raw = state && typeof state === "object" ? state : {};
    const base = getWizardContract().discoverySetupWizardState;
    return {
      ...(typeof base === "object" && base ? base : {}),
      ...raw,
      version: 1,
      flow: asString(raw.flow, "local_agent"),
      currentStep: asString(raw.currentStep, "detect"),
      completedSteps: uniqueList(raw.completedSteps || []),
      transportMode: asString(raw.transportMode),
      lastProbeAt: asString(raw.lastProbeAt),
      lastVerifiedAt: asString(raw.lastVerifiedAt),
      result: asString(raw.result, "none"),
      dismissedStubWarning: !!raw.dismissedStubWarning,
    };
  }

  function defaultRemediations(port) {
    const resolvedPort = asString(port, "8644");
    return {
      noBootstrapFile: `Run \`npm run discovery:bootstrap-local\` to generate the config file.`,
      gatewayNotHealthy:
        "Run `npm run discovery:worker:start-local` to start the recommended local worker. Advanced only: use `hermes gateway run --replace` if you intentionally use the Hermes path.",
      ngrokNotAuthenticated: `Get a token from ${NGROK_TOKEN_URL} and run \`ngrok config add-authtoken <TOKEN>\`.`,
      ngrokNotRunning: `Run \`ngrok http ${resolvedPort}\` to start the tunnel.`,
    };
  }

  function normalizeBootstrapState(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const diagnostics =
      source.diagnostics && typeof source.diagnostics === "object"
        ? source.diagnostics
        : {};
    const wizard =
      source.wizard && typeof source.wizard === "object" ? source.wizard : {};
    const stepIds = uniqueList(wizard.stepIds || LOCAL_STEP_IDS);
    const actionIds = uniqueList(wizard.actionIds || LOCAL_ACTION_IDS);
    const port = asString(
      source.localPort || source.port || diagnostics.localPort,
      "8644",
    );
    const localWebhookUrl =
      normalizeUrl(source.localWebhookUrl) ||
      normalizeUrl(diagnostics.localWebhookUrl);
    const localHealthUrl =
      normalizeUrl(source.localHealthUrl) ||
      normalizeUrl(diagnostics.localHealthUrl);
    const tunnelPublicUrl =
      normalizeUrl(source.tunnelPublicUrl) ||
      normalizeUrl(source.ngrokPublicUrl) ||
      normalizeUrl(diagnostics.tunnelPublicUrl);
    const publicTargetUrl =
      normalizeUrl(source.publicTargetUrl) ||
      normalizeUrl(diagnostics.publicTargetUrl);
    const cloudflareDeployCommand = asString(source.cloudflareDeployCommand);
    const ngrokTokenUrl = asString(source.ngrokTokenUrl, NGROK_TOKEN_URL);
    const status = asString(source.status || diagnostics.status, "ready");
    const ngrokAuthenticated = diagnostics.ngrokAuthenticated !== false;
    const ngrokRunning =
      diagnostics.ngrokRunning !== false && !!tunnelPublicUrl;
    const gatewayHealthy = diagnostics.gatewayHealthy !== false;

    return {
      available: !!(
        source &&
        typeof source === "object" &&
        (localWebhookUrl ||
          localHealthUrl ||
          tunnelPublicUrl ||
          publicTargetUrl)
      ),
      generatedAt: asString(source.generatedAt),
      repoRoot: asString(source.repoRoot),
      routeName: asString(source.routeName),
      localWebhookUrl,
      localHealthUrl,
      localPort: port,
      tunnelPublicUrl,
      ngrokPublicUrl: tunnelPublicUrl,
      publicTargetUrl,
      corsOrigin: asString(source.corsOrigin),
      sheetId: asString(source.sheetId),
      workerName: asString(source.workerName),
      cloudflareDeployCommand,
      ngrokTokenUrl,
      status,
      diagnostics: {
        gatewayHealthy,
        ngrokAuthenticated,
        ngrokRunning,
        ngrokDetected: !!tunnelPublicUrl,
        healthProbeOk: diagnostics.healthProbeOk !== false,
        localBootstrapReadable: diagnostics.localBootstrapReadable !== false,
      },
      wizard: {
        version: 1,
        stepIds,
        actionIds,
        defaultStepId: asString(wizard.defaultStepId, "bootstrap"),
        nextStepId: asString(wizard.nextStepId, "local_health"),
        recommendedStepId: asString(wizard.recommendedStepId, "bootstrap"),
      },
      remediations: {
        ...defaultRemediations(port),
        ...(source.remediations && typeof source.remediations === "object"
          ? Object.fromEntries(
              Object.entries(source.remediations).map(([key, value]) => [
                key,
                asString(value),
              ]),
            )
          : {}),
      },
    };
  }

  async function fetchLocalBootstrapState() {
    try {
      const res = await fetch(buildLocalBootstrapUrl(), {
        cache: "no-store",
      });
      if (!res.ok) {
        return {
          available: false,
          reason: res.status === 404 ? "missing_file" : "bootstrap_unreadable",
          data: null,
          remediations: defaultRemediations("8644"),
        };
      }
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") {
        return {
          available: false,
          reason: "invalid_file",
          data: null,
          remediations: defaultRemediations("8644"),
        };
      }
      const normalized = normalizeBootstrapState(data);
      return {
        available: normalized.available,
        reason: normalized.available ? "ok" : "empty",
        data: normalized,
        remediations: normalized.remediations,
      };
    } catch (_) {
      return {
        available: false,
        reason: "missing_file",
        data: null,
        remediations: defaultRemediations("8644"),
      };
    }
  }

  async function probeNgrokLocalApi() {
    try {
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller
        ? window.setTimeout(() => controller.abort(), 2000)
        : null;
      try {
        const res = await fetch("/__proxy/ngrok-tunnels", {
          cache: "no-store",
          signal: controller ? controller.signal : undefined,
        });
        if (!res.ok) {
          return {
            available: false,
            running: false,
            tunnels: [],
            publicUrl: "",
            reason: "not_running",
          };
        }
        const data = await res.json().catch(() => null);
        const tunnels = Array.isArray(data && data.tunnels) ? data.tunnels : [];
        const publicUrl =
          tunnels
            .map((tunnel) =>
              asString(tunnel && (tunnel.public_url || tunnel.publicUrl || "")),
            )
            .find((url) => /^https:\/\//i.test(url)) || "";
        return {
          available: true,
          running: true,
          tunnels,
          publicUrl: publicUrl.replace(/\/+$/, "/"),
          reason: publicUrl ? "ok" : "running_no_https_url",
        };
      } finally {
        if (timeout != null) window.clearTimeout(timeout);
      }
    } catch (_) {
      return {
        available: false,
        running: false,
        tunnels: [],
        publicUrl: "",
        reason: "not_running",
      };
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

  async function probeLocalHealthUrl(healthUrl) {
    const url = normalizeUrl(healthUrl);
    if (!url) {
      return {
        ok: false,
        status: 0,
        reason: "missing_health_url",
      };
    }

    const fetchUrl = localHealthProxyUrl(url);
    try {
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeout = controller
        ? window.setTimeout(() => controller.abort(), 2500)
        : null;
      try {
        const res = await fetch(fetchUrl, {
          cache: "no-store",
          signal: controller ? controller.signal : undefined,
        });
        const text = await res.text().catch(() => "");
        return {
          ok: res.ok || res.status === 202 || res.status === 204,
          status: res.status,
          body: text,
          reason:
            res.ok || res.status === 202 || res.status === 204
              ? "ok"
              : "bad_status",
        };
      } finally {
        if (timeout != null) window.clearTimeout(timeout);
      }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error && error.message ? error.message : String(error || ""),
        reason: "network_error",
      };
    }
  }

  function buildStepStatePatch(stepId, state, extra = {}) {
    const next = normalizeWizardState(state);
    const completedSteps = uniqueList([
      ...next.completedSteps,
      stepId,
      ...(extra.completedSteps || []),
    ]);
    const result = asString(extra.result || next.result || "none", "none");
    return {
      ...next,
      currentStep: asString(extra.currentStep, stepId),
      completedSteps,
      transportMode: asString(extra.transportMode, next.transportMode),
      lastProbeAt:
        extra.lastProbeAt != null
          ? asString(extra.lastProbeAt)
          : next.lastProbeAt,
      lastVerifiedAt:
        extra.lastVerifiedAt != null
          ? asString(extra.lastVerifiedAt)
          : next.lastVerifiedAt,
      result,
      dismissedStubWarning:
        extra.dismissedStubWarning != null
          ? !!extra.dismissedStubWarning
          : next.dismissedStubWarning,
    };
  }

  function getProbesSnapshotFallback() {
    const probes = getProbesApi();
    if (probes && typeof probes.buildReadinessSnapshot === "function") {
      return probes.buildReadinessSnapshot();
    }
    return Promise.resolve(
      root.contract ? root.contract.readinessSnapshot : {},
    );
  }

  function buildSuccessResult(actionId, stepId, message, detail, extra = {}) {
    return {
      ok: true,
      kind: asString(extra.kind, "connected"),
      layer: "local",
      actionId,
      stepId,
      nextStepId: asString(extra.nextStepId, stepId),
      message,
      detail: asString(detail),
      remediation: null,
      diagnostics: extra.diagnostics || {},
      bootstrap: extra.bootstrap || null,
      wizardStatePatch: extra.wizardStatePatch || null,
      suggestedCommand: asString(extra.suggestedCommand),
      suggestedUrl: asString(extra.suggestedUrl),
    };
  }

  function buildErrorResult(
    actionId,
    stepId,
    kind,
    message,
    detail,
    extra = {},
  ) {
    return {
      ok: false,
      kind,
      layer: "local",
      actionId,
      stepId,
      nextStepId: asString(extra.nextStepId, stepId),
      message,
      detail: asString(detail),
      remediation: asString(extra.remediation),
      diagnostics: extra.diagnostics || {},
      bootstrap: extra.bootstrap || null,
      wizardStatePatch: extra.wizardStatePatch || null,
      suggestedCommand: asString(extra.suggestedCommand),
      suggestedUrl: asString(extra.suggestedUrl),
    };
  }

  function selectTransportMode(snapshot, bootstrap) {
    if (
      snapshot &&
      snapshot.localBootstrapAvailable &&
      snapshot.localWebhookUrl
    ) {
      return "local_agent_worker";
    }
    if (
      bootstrap &&
      bootstrap.available &&
      bootstrap.data &&
      bootstrap.data.localWebhookUrl
    ) {
      return "local_agent_worker";
    }
    return "local_agent";
  }

  async function runLocalWizardAction(actionId, context = {}) {
    const snapshot =
      context.snapshot && typeof context.snapshot === "object"
        ? context.snapshot
        : await getProbesSnapshotFallback();
    const wizardState = normalizeWizardState(
      context.wizardState || context.state,
    );
    const bootstrapState =
      context.bootstrapState && typeof context.bootstrapState === "object"
        ? context.bootstrapState
        : await fetchLocalBootstrapState();
    const bootstrapData =
      bootstrapState &&
      bootstrapState.data &&
      typeof bootstrapState.data === "object"
        ? bootstrapState.data
        : null;
    const bootstrap =
      bootstrapData && bootstrapData.available ? bootstrapData : null;
    const remediations = bootstrap
      ? bootstrap.remediations
      : bootstrapState.remediations ||
        defaultRemediations(
          inferPortFromUrl(
            snapshot.localWebhookUrl ||
              (bootstrapState &&
                bootstrapState.data &&
                bootstrapState.data.localWebhookUrl) ||
              "",
            "8644",
          ),
        );
    const localWebhookUrl = asString(
      bootstrap && bootstrap.localWebhookUrl
        ? bootstrap.localWebhookUrl
        : snapshot.localWebhookUrl,
    );
    const localHealthUrl = asString(
      bootstrap && bootstrap.localHealthUrl
        ? bootstrap.localHealthUrl
        : buildLocalHealthUrl(localWebhookUrl),
    );
    const tunnelPublicUrl = asString(
      bootstrap && bootstrap.tunnelPublicUrl
        ? bootstrap.tunnelPublicUrl
        : snapshot.tunnelPublicUrl,
    );
    const publicTargetUrl = asString(
      bootstrap && bootstrap.publicTargetUrl
        ? bootstrap.publicTargetUrl
        : snapshot.relayTargetUrl,
    );
    const cloudflareDeployCommand = asString(
      bootstrap && bootstrap.cloudflareDeployCommand
        ? bootstrap.cloudflareDeployCommand
        : "",
    );
    const ngrokDetected = !!tunnelPublicUrl;
    const transportMode = selectTransportMode(snapshot, bootstrapState);

    switch (actionId) {
      case "local_bootstrap_refresh": {
        if (!bootstrapState.available) {
          return buildErrorResult(
            actionId,
            "bootstrap",
            "bootstrap_missing",
            "Config file not found.",
            remediations.noBootstrapFile,
            {
              remediation: remediations.noBootstrapFile,
              nextStepId: "bootstrap",
              suggestedCommand: "npm run discovery:bootstrap-local",
              wizardStatePatch: buildStepStatePatch("bootstrap", wizardState, {
                transportMode,
                result: "blocked",
              }),
            },
          );
        }
        return buildSuccessResult(
          actionId,
          "bootstrap",
          "Config loaded.",
          [
            `Server: ${localWebhookUrl || "–"}`,
            `Tunnel: ${tunnelPublicUrl || "–"}`,
            `Target: ${publicTargetUrl || "–"}`,
          ].join(" · "),
          {
            kind: "bootstrap_ready",
            nextStepId: "local_health",
            bootstrap: bootstrapState.data || bootstrapData,
            diagnostics: {
              bootstrapAvailable: true,
              ngrokDetected,
            },
            wizardStatePatch: buildStepStatePatch("bootstrap", wizardState, {
              currentStep: "local_health",
              transportMode,
              result: "unverified",
            }),
            suggestedCommand: cloudflareDeployCommand,
            suggestedUrl: publicTargetUrl,
          },
        );
      }

      case "local_health_check": {
        if (!localHealthUrl || !localWebhookUrl) {
          return buildErrorResult(
            actionId,
            "local_health",
            "bootstrap_missing",
            "Load the config first.",
            remediations.noBootstrapFile,
            {
              remediation: remediations.noBootstrapFile,
              nextStepId: "bootstrap",
              suggestedCommand: "npm run discovery:bootstrap-local",
              wizardStatePatch: buildStepStatePatch(
                "local_health",
                wizardState,
                {
                  result: "blocked",
                },
              ),
            },
          );
        }
        const healthProbe = await probeLocalHealthUrl(localHealthUrl);
        if (healthProbe.ok) {
          return buildSuccessResult(
            actionId,
            "local_health",
            "Server is healthy.",
            `Health check returned ${healthProbe.status}.`,
            {
              kind: "gateway_ready",
              nextStepId: "tunnel",
              diagnostics: {
                healthProbeOk: true,
                status: healthProbe.status,
              },
              wizardStatePatch: buildStepStatePatch(
                "local_health",
                wizardState,
                {
                  currentStep: "tunnel",
                  transportMode,
                  result: "unverified",
                },
              ),
            },
          );
        }
        return buildErrorResult(
          actionId,
          "local_health",
          "gateway_not_healthy",
          "Server not responding.",
          remediations.gatewayNotHealthy,
          {
            remediation: remediations.gatewayNotHealthy,
            nextStepId: "local_health",
            diagnostics: {
              healthProbeOk: false,
              status: healthProbe.status,
              reason: healthProbe.reason,
            },
            wizardStatePatch: buildStepStatePatch("local_health", wizardState, {
              result: "blocked",
            }),
          },
        );
      }

      case "local_tunnel_detect": {
        if (!bootstrapState.available && !snapshot.localBootstrapAvailable) {
          return buildErrorResult(
            actionId,
            "tunnel",
            "bootstrap_missing",
            "Config file not found.",
            remediations.noBootstrapFile,
            {
              remediation: remediations.noBootstrapFile,
              nextStepId: "bootstrap",
              suggestedCommand: "npm run discovery:bootstrap-local",
              wizardStatePatch: buildStepStatePatch("tunnel", wizardState, {
                currentStep: "bootstrap",
                result: "blocked",
              }),
            },
          );
        }
        const ngrokApi = await probeNgrokLocalApi();
        if (ngrokApi.running && ngrokApi.publicUrl && snapshot.tunnelReady) {
          return buildSuccessResult(
            actionId,
            "tunnel",
            "Tunnel detected.",
            ngrokApi.publicUrl,
            {
              kind: "tunnel_ready",
              nextStepId: "relay_deploy",
              diagnostics: {
                ngrokDetected: true,
                apiDetected: true,
              },
              wizardStatePatch: buildStepStatePatch("tunnel", wizardState, {
                currentStep: "relay_deploy",
                transportMode,
                result: "unverified",
              }),
              suggestedUrl: ngrokApi.publicUrl,
            },
          );
        }

        if (
          bootstrapState &&
          bootstrapState.data &&
          bootstrapState.data.diagnostics &&
          bootstrapState.data.diagnostics.ngrokAuthenticated === false
        ) {
          return buildErrorResult(
            actionId,
            "tunnel",
            "ngrok_not_authenticated",
            "ngrok not authenticated.",
            remediations.ngrokNotAuthenticated,
            {
              remediation: remediations.ngrokNotAuthenticated,
              nextStepId: "tunnel",
              wizardStatePatch: buildStepStatePatch("tunnel", wizardState, {
                result: "blocked",
              }),
            },
          );
        }

        if (ngrokApi.running && ngrokApi.publicUrl) {
          return buildSuccessResult(
            actionId,
            "tunnel",
            "Tunnel detected.",
            ngrokApi.publicUrl,
            {
              kind: "tunnel_ready",
              nextStepId: "relay_deploy",
              diagnostics: {
                ngrokDetected: true,
                apiDetected: true,
              },
              wizardStatePatch: buildStepStatePatch("tunnel", wizardState, {
                currentStep: "relay_deploy",
                transportMode,
                result: "unverified",
              }),
              suggestedUrl: ngrokApi.publicUrl,
            },
          );
        }

        return buildErrorResult(
          actionId,
          "tunnel",
          "ngrok_not_running",
          "No tunnel detected.",
          remediations.ngrokNotRunning,
          {
            remediation: remediations.ngrokNotRunning,
            nextStepId: "tunnel",
            suggestedCommand: `ngrok http ${bootstrap && bootstrap.localPort ? bootstrap.localPort : inferPortFromUrl(localWebhookUrl, "8644")}`,
            wizardStatePatch: buildStepStatePatch("tunnel", wizardState, {
              result: "blocked",
            }),
          },
        );
      }

      case "local_relay_apply": {
        if (snapshot.relayReady && publicTargetUrl) {
          return buildSuccessResult(
            actionId,
            "relay_deploy",
            "Relay ready.",
            `Target: ${publicTargetUrl}`,
            {
              kind: "relay_ready",
              nextStepId: "verify",
              bootstrap: bootstrapState.data || bootstrapData,
              diagnostics: {
                relayReady: true,
              },
              wizardStatePatch: buildStepStatePatch(
                "relay_deploy",
                wizardState,
                {
                  currentStep: "verify",
                  transportMode,
                  result: "unverified",
                  lastProbeAt: new Date().toISOString(),
                },
              ),
              suggestedUrl: publicTargetUrl,
              suggestedCommand: cloudflareDeployCommand,
            },
          );
        }

        return buildErrorResult(
          actionId,
          "relay_deploy",
          "relay_missing",
          "Complete the server and tunnel steps first.",
          "The relay needs a working tunnel to forward to.",
          {
            remediation:
              "Finish the server and tunnel steps, then deploy the relay.",
            nextStepId: "relay_deploy",
            suggestedCommand: cloudflareDeployCommand,
            suggestedUrl: publicTargetUrl,
            wizardStatePatch: buildStepStatePatch("relay_deploy", wizardState, {
              result: "blocked",
            }),
          },
        );
      }

      case "local_verify_end_to_end": {
        if (snapshot.relayReady) {
          return buildSuccessResult(
            actionId,
            "verify",
            "Ready to test.",
            "All local steps complete — run the connection test.",
            {
              kind: "ready_for_verify",
              nextStepId: "ready",
              wizardStatePatch: buildStepStatePatch("verify", wizardState, {
                currentStep: "ready",
                transportMode,
                result: "unverified",
                lastProbeAt: new Date().toISOString(),
              }),
              suggestedUrl: publicTargetUrl,
            },
          );
        }

        return buildErrorResult(
          actionId,
          "verify",
          "verify_blocked",
          "Not ready to test yet.",
          "Complete the earlier steps first.",
          {
            remediation: "Complete config, server, tunnel, and relay first.",
            nextStepId: "verify",
            wizardStatePatch: buildStepStatePatch("verify", wizardState, {
              result: "blocked",
            }),
          },
        );
      }

      default:
        return buildErrorResult(
          actionId,
          asString(context.stepId, "bootstrap"),
          "unknown_action",
          `Unknown local action: ${actionId}`,
          "The local worker lane only knows bootstrap, health, tunnel, relay, and verify actions.",
          {
            remediation:
              "The local worker lane only knows bootstrap, health, tunnel, relay, and verify actions.",
          },
        );
    }
  }

  function buildLocalActionCatalog() {
    return {
      local_bootstrap_refresh: {
        stepId: "bootstrap",
        label: "Load config",
        hint: "Read the local config file and auto-fill settings.",
      },
      local_health_check: {
        stepId: "local_health",
        label: "Check health",
        hint: "Check if the local server is running and healthy.",
      },
      local_tunnel_detect: {
        stepId: "tunnel",
        label: "Detect tunnel",
        hint: "Look for a running ngrok tunnel.",
      },
      local_relay_apply: {
        stepId: "relay_deploy",
        label: "Apply relay",
        hint: "Set the relay's downstream target URL.",
      },
      local_verify_end_to_end: {
        stepId: "verify",
        label: "Ready to test",
        hint: "Confirm all local steps are done and move to the test.",
      },
    };
  }

  Object.assign(local, {
    getDefaultLocalActionIds() {
      return Object.freeze([...LOCAL_ACTION_IDS]);
    },
    getLocalStepIds() {
      return Object.freeze([...LOCAL_STEP_IDS]);
    },
    getLocalActionCatalog() {
      return buildLocalActionCatalog();
    },
    normalizeLocalBootstrapState: normalizeBootstrapState,
    getLocalBootstrapState: fetchLocalBootstrapState,
    hydrateLocalBootstrapState: fetchLocalBootstrapState,
    fetchLocalBootstrapState,
    detectNgrokLocalApi: probeNgrokLocalApi,
    probeNgrokLocalApi,
    probeLocalHealthUrl,
    buildLocalBootstrapUrl,
    buildLocalActionCatalog,
    runLocalWizardAction,
  });
  if (typeof window !== "undefined") {
    window.__JobBoredDiscoveryLocalApi = local;
  }
})();
