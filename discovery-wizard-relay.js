(() => {
  const root =
    window.JobBoredDiscoveryWizard || (window.JobBoredDiscoveryWizard = {});
  const relay = root.relay || (root.relay = {});

  const DEFAULT_RELAY_ACTION_IDS = Object.freeze([
    "relay_prepare_target",
    "relay_validate_external_endpoint",
    "relay_apply_worker_url",
    "relay_deploy_worker",
    "relay_copy_deploy_command",
    "relay_copy_agent_prompt",
  ]);

  const ENDPOINT_KIND = Object.freeze({
    missing: "missing",
    invalid: "invalid_endpoint",
    localOnly: "local_only",
    workerForward: "worker_forward",
    workerOpen: "worker_open",
    appsScriptStub: "apps_script_stub",
    genericHttps: "generic_https",
  });

  const VERIFICATION_KIND = Object.freeze({
    connected: "connected_ok",
    acceptedAsync: "accepted_async",
    stubOnly: "stub_only",
    accessProtected: "access_protected",
    appsScriptPrivate: "apps_script_private",
    networkError: "network_error",
    invalidEndpoint: "invalid_endpoint",
  });

  const STEP_HINTS = Object.freeze({
    missing_downstream: "Set up a webhook URL first.",
    local_only:
      "Use the Worker URL for the dashboard. The local URL is only the relay target.",
    worker_forward: "Use the root workers.dev URL, not /forward.",
    apps_script_stub: "Stub only — good for testing, not real discovery.",
    generic_https: "Looks like a real HTTPS endpoint.",
    worker_open: "Looks like a Worker URL — ready to save.",
  });

  function getContract() {
    return (
      root.contract || {
        verificationResult: {
          ok: false,
          kind: VERIFICATION_KIND.invalidEndpoint,
          engineState: "none",
          httpStatus: 0,
          message: "",
          detail: "",
          layer: "browser",
        },
      }
    );
  }

  function asString(raw, fallback = "") {
    const s = raw == null ? "" : String(raw).trim();
    return s || fallback;
  }

  function asBoolean(raw) {
    return raw === true || raw === "true" || raw === 1;
  }

  function clone(obj) {
    return obj && typeof obj === "object" ? { ...obj } : {};
  }

  function unique(values) {
    const seen = new Set();
    const out = [];
    for (const value of values || []) {
      const s = asString(value);
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function normalizeUrl(raw) {
    const s = asString(raw);
    if (!s) return "";
    try {
      const url = new URL(s);
      url.hash = "";
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function isLocalHost(hostname) {
    const host = asString(hostname)
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1")
      return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  }

  function isLikelyWorkerUrl(raw) {
    const s = asString(raw);
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
  }

  function isWorkerForwardUrl(raw) {
    const url = normalizeUrl(raw);
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return /\/forward\/?$/i.test(parsed.pathname.replace(/\/+$/, "/"));
    } catch (_) {
      return false;
    }
  }

  function isLikelyAppsScriptWebAppUrl(raw) {
    const s = asString(raw);
    if (!s) return false;
    try {
      const url = new URL(s);
      return (
        url.protocol === "https:" &&
        /(^|\.)script\.google\.com$/i.test(url.hostname) &&
        /\/macros\/s\/[^/]+\/(?:exec|dev)\/?$/i.test(url.pathname)
      );
    } catch (_) {
      return /https:\/\/script\.google\.com\/macros\/s\/[^/]+\/(?:exec|dev)\/?/i.test(
        s,
      );
    }
  }

  function isManagedAppsScriptStub(snapshot) {
    const state = snapshot && typeof snapshot === "object" ? snapshot : {};
    return (
      asString(state.appsScriptState) === "stub_only" ||
      asString(state.savedWebhookKind) === "apps_script_stub" ||
      asString(state.engineState) === "stub_only"
    );
  }

  function normalizeSnapshot(snapshot) {
    const fallback = clone(getContract().readinessSnapshot || {});
    const raw = snapshot && typeof snapshot === "object" ? snapshot : {};
    return {
      ...fallback,
      ...raw,
      sheetConfigured: asBoolean(raw.sheetConfigured),
      savedWebhookUrl: normalizeUrl(raw.savedWebhookUrl),
      savedWebhookKind: asString(
        raw.savedWebhookKind,
        fallback.savedWebhookKind || "none",
      ),
      localBootstrapAvailable: asBoolean(raw.localBootstrapAvailable),
      localWebhookUrl: normalizeUrl(raw.localWebhookUrl),
      localWebhookReady: asBoolean(raw.localWebhookReady),
      tunnelPublicUrl: normalizeUrl(raw.tunnelPublicUrl),
      tunnelReady: asBoolean(raw.tunnelReady),
      relayTargetUrl: normalizeUrl(raw.relayTargetUrl),
      relayReady: asBoolean(raw.relayReady),
      engineState: asString(raw.engineState, fallback.engineState || "none"),
      appsScriptState: asString(
        raw.appsScriptState,
        fallback.appsScriptState || "none",
      ),
      recommendedFlow: asString(
        raw.recommendedFlow,
        fallback.recommendedFlow || "local_agent",
      ),
      blockingIssue: asString(raw.blockingIssue),
    };
  }

  function normalizeWizardState(state) {
    const raw = state && typeof state === "object" ? state : {};
    return {
      ...(root.contract && root.contract.discoverySetupWizardState
        ? clone(root.contract.discoverySetupWizardState)
        : {}),
      ...raw,
      version: 1,
      flow: asString(raw.flow, "local_agent"),
      currentStep: asString(raw.currentStep, "path_select"),
      completedSteps: unique(
        Array.isArray(raw.completedSteps) ? raw.completedSteps : [],
      ),
      transportMode: asString(raw.transportMode),
      lastProbeAt: asString(raw.lastProbeAt),
      lastVerifiedAt: asString(raw.lastVerifiedAt),
      result: asString(raw.result, "none"),
      dismissedStubWarning: asBoolean(raw.dismissedStubWarning),
    };
  }

  function classifySavedWebhookKind(rawUrl) {
    const url = normalizeUrl(rawUrl);
    if (!url) return "none";
    try {
      const parsed = new URL(url);
      if (isLocalHost(parsed.hostname)) return "local_http";
      if (isLikelyWorkerUrl(url)) return "worker";
      if (isLikelyAppsScriptWebAppUrl(url)) return "apps_script_stub";
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return "generic_https";
      }
    } catch (_) {
      // fall through
    }
    return "none";
  }

  function classifyRelayEndpointUrl(rawUrl, snapshot) {
    const state = normalizeSnapshot(snapshot);
    const url = normalizeUrl(rawUrl);

    if (!url) {
      return {
        kind: ENDPOINT_KIND.missing,
        ok: false,
        realReady: false,
        url: "",
        title: "No endpoint selected",
        detail: "Enter a public HTTPS URL or use the wizard to set one up.",
        blockingIssue: "missing_endpoint",
        suggestedStep: STEP_HINTS.missing_downstream,
      };
    }

    try {
      const parsed = new URL(url);
      if (isLocalHost(parsed.hostname)) {
        return {
          kind: ENDPOINT_KIND.localOnly,
          ok: false,
          realReady: false,
          url,
          title: "Local-only URL",
          detail:
            "Localhost URLs won't work — use your Worker URL or another public HTTPS endpoint.",
          blockingIssue: "local_only",
          suggestedStep: STEP_HINTS.local_only,
        };
      }

      if (isLikelyWorkerUrl(url)) {
        if (isWorkerForwardUrl(url)) {
          return {
            kind: ENDPOINT_KIND.workerForward,
            ok: false,
            realReady: false,
            url,
            title: "Worker /forward URL",
            detail: "Use the root workers.dev URL, not /forward.",
            blockingIssue: "worker_forward",
            suggestedStep: STEP_HINTS.worker_forward,
          };
        }
        return {
          kind: ENDPOINT_KIND.workerOpen,
          ok: true,
          realReady: true,
          url,
          title: "Cloudflare Worker URL",
          detail: "This is a Worker URL — save it in Settings.",
          blockingIssue: "",
          suggestedStep: STEP_HINTS.worker_open,
        };
      }

      if (isLikelyAppsScriptWebAppUrl(url)) {
        const stubOnly = isManagedAppsScriptStub(state);
        return {
          kind: ENDPOINT_KIND.appsScriptStub,
          ok: true,
          realReady: !stubOnly,
          url,
          title: stubOnly ? "Apps Script stub only" : "Apps Script web app",
          detail: stubOnly
            ? "Good for testing, but stub-only — not real discovery."
            : "Apps Script web app. Test the webhook to confirm it works.",
          blockingIssue: stubOnly ? "stub_only" : "",
          suggestedStep: STEP_HINTS.appsScriptStub,
        };
      }

      if (parsed.protocol === "https:") {
        return {
          kind: ENDPOINT_KIND.genericHttps,
          ok: true,
          realReady: true,
          url,
          title: "External HTTPS endpoint",
          detail: "HTTPS webhook URL. Run a test to confirm it works.",
          blockingIssue: "",
          suggestedStep: STEP_HINTS.generic_https,
        };
      }
    } catch (_) {
      // fall through
    }

    return {
      kind: ENDPOINT_KIND.invalid,
      ok: false,
      realReady: false,
      url,
      title: "Invalid endpoint",
      detail: "Enter a valid HTTPS URL.",
      blockingIssue: "invalid_endpoint",
      suggestedStep: "Fix the URL format and try again.",
    };
  }

  function findSavedWorkerUrl(snapshot) {
    const state = normalizeSnapshot(snapshot);
    if (isLikelyWorkerUrl(state.savedWebhookUrl)) {
      return state.savedWebhookUrl;
    }
    return "";
  }

  function buildDownstreamTargetUrl(snapshot, overrides) {
    const state = normalizeSnapshot(snapshot);
    const opts = overrides && typeof overrides === "object" ? overrides : {};
    const candidate = normalizeUrl(opts.targetUrl);
    if (candidate) return candidate;

    const directSaved = normalizeUrl(state.savedWebhookUrl);
    const directKind = classifySavedWebhookKind(directSaved);

    const relayTarget = normalizeUrl(state.relayTargetUrl);
    if (relayTarget) {
      const relayKind = classifyRelayEndpointUrl(relayTarget, state).kind;
      if (
        relayKind === ENDPOINT_KIND.genericHttps ||
        relayKind === ENDPOINT_KIND.appsScriptStub
      ) {
        return relayTarget;
      }
    }

    if (state.localWebhookUrl && state.tunnelPublicUrl) {
      try {
        const local = new URL(state.localWebhookUrl);
        const tunnel = new URL(state.tunnelPublicUrl);
        tunnel.pathname = local.pathname || "/";
        tunnel.search = "";
        tunnel.hash = "";
        return tunnel.toString();
      } catch (_) {
        return "";
      }
    }

    if (
      directSaved &&
      (directKind === "generic_https" || directKind === "apps_script_stub")
    ) {
      return directSaved;
    }

    return "";
  }

  function inferWorkerSuffixFromTarget(targetUrl, sheetId) {
    const url = normalizeUrl(targetUrl);
    if (url) {
      try {
        const parsed = new URL(url);
        const pathTail = parsed.pathname.split("/").filter(Boolean).pop();
        if (pathTail) return pathTail.slice(-6).toLowerCase();
        const hostTail = parsed.hostname.replace(/[^a-z0-9]+/gi, "-");
        if (hostTail) return hostTail.slice(-10).toLowerCase();
      } catch (_) {
        // fall through
      }
    }
    const sheetTail = asString(sheetId)
      .replace(/[^a-z0-9]+/gi, "")
      .slice(-6)
      .toLowerCase();
    return sheetTail || "main";
  }

  function sanitizeWorkerName(raw) {
    return asString(raw)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63)
      .replace(/^-+|-+$/g, "");
  }

  function buildSuggestedWorkerName(targetUrl, sheetId, explicitWorkerName) {
    const explicit = sanitizeWorkerName(explicitWorkerName);
    if (explicit) return explicit;
    const suffix = inferWorkerSuffixFromTarget(targetUrl, sheetId);
    return (
      sanitizeWorkerName(`jobbored-discovery-relay-${suffix}`) ||
      "jobbored-discovery-relay"
    );
  }

  function quoteShellArg(raw) {
    return `'${asString(raw).replace(/'/g, `'\"'\"'`)}'`;
  }

  function buildCloudflareRelayDeployCommand(snapshot, options) {
    const state = normalizeSnapshot(snapshot);
    const opts = options && typeof options === "object" ? options : {};
    const targetUrl = buildDownstreamTargetUrl(state, opts);
    const workerName = buildSuggestedWorkerName(
      targetUrl,
      opts.sheetId,
      opts.workerName,
    );
    const origin = asString(opts.corsOrigin || opts.origin || "", "");
    const sheetId = asString(opts.sheetId, "");

    const parts = ["npm run cloudflare-relay:deploy --"];
    if (targetUrl) parts.push(`--target-url ${quoteShellArg(targetUrl)}`);
    if (origin && origin !== "*")
      parts.push(`--cors-origin ${quoteShellArg(origin)}`);
    if (workerName) parts.push(`--worker-name ${quoteShellArg(workerName)}`);
    if (sheetId) parts.push(`--sheet-id ${quoteShellArg(sheetId)}`);
    return parts.join(" ");
  }

  function buildCloudflareRelayAgentPrompt(snapshot, options) {
    const state = normalizeSnapshot(snapshot);
    const opts = options && typeof options === "object" ? options : {};
    const targetUrl = buildDownstreamTargetUrl(state, opts);
    const workerName = buildSuggestedWorkerName(
      targetUrl,
      opts.sheetId,
      opts.workerName,
    );
    const origin = asString(opts.corsOrigin || opts.origin || "", "*") || "*";
    const sheetId = asString(opts.sheetId, "");
    const deployCommand = buildCloudflareRelayDeployCommand(state, opts);
    const verifyLine = sheetId
      ? "5. If the command includes `--sheet-id`, let the helper run webhook verification after deploy."
      : "5. After deploy, paste the Worker URL into Settings -> Discovery webhook URL and run Test webhook.";

    if (!targetUrl) {
      return [
        "We are in the Job-Bored repo.",
        "",
        "Stop: there is no downstream TARGET_URL yet, so there is nothing useful to deploy.",
        "",
        "Ask the user to finish the upstream endpoint first, or connect the local bootstrap so the target can be derived.",
      ].join("\n");
    }

    return [
      "We are in the Job-Bored repo. Set up the Cloudflare Worker relay for discovery.",
      "",
      `Current TARGET_URL: ${targetUrl}`,
      `Suggested worker name: ${workerName}`,
      `Suggested CORS origin: ${origin}`,
      "",
      "Do this:",
      `1. Run this command from the repo root:\n   ${deployCommand}`,
      "2. If Cloudflare auth is missing, let the helper open `wrangler login` or tell me whether I need `CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID`.",
      "3. Return the deployed open `workers.dev` URL only.",
      "4. Do not use `/forward` in the dashboard path, and keep Cloudflare Access disabled on the open `workers.dev` URL.",
      `5. ${verifyLine}`,
      "",
      "If Wrangler stops at a one-time `workers.dev` subdomain prompt, tell me whether I need to answer it in the browser-login path or rerun with an API token.",
    ].join("\n");
  }

  function buildCloudflareAuthRemediation(details) {
    const o = details && typeof details === "object" ? details : {};
    const hasLogin = asBoolean(o.hasLogin);
    const hasApiToken = asBoolean(o.hasApiToken);
    const hasAccountId = asBoolean(o.hasAccountId);
    const needsBrowserLogin = asBoolean(o.needsBrowserLogin);
    const needsSubdomain = asBoolean(o.needsSubdomain);

    if (hasLogin || (hasApiToken && hasAccountId)) {
      return {
        kind: "ready",
        title: "Cloudflare auth is ready",
        detail: "The relay helper can deploy now.",
        steps: [],
        actions: [],
      };
    }

    const steps = [];
    if (!hasApiToken || !hasAccountId) {
      steps.push(
        "For browser login: run `npx wrangler login` in an interactive terminal.",
      );
      steps.push(
        "For non-interactive setup: set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.",
      );
    }
    if (needsBrowserLogin) {
      steps.push("Finish the one-time browser login prompt in the terminal.");
    }
    if (needsSubdomain) {
      steps.push(
        "If Wrangler asks for a workers.dev subdomain, choose one once in the terminal or use an API token so the helper can create one automatically.",
      );
    }

    return {
      kind: "auth_missing",
      title: "Cloudflare auth still needs one step",
      detail:
        "The helper can deploy once Wrangler is logged in or the account token variables are present.",
      steps,
      actions: [
        {
          label: "Open Cloudflare login docs",
          href: "https://developers.cloudflare.com/workers/wrangler/commands/#login",
          primary: true,
        },
      ],
    };
  }

  function buildWorkersSubdomainRemediation(details) {
    const o = details && typeof details === "object" ? details : {};
    const hasSubdomain = asString(o.workersSubdomain);
    const hasApiToken = asBoolean(o.hasApiToken);

    if (hasSubdomain) {
      return {
        kind: "ready",
        title: "workers.dev subdomain is ready",
        detail: `Using ${hasSubdomain}.`,
        steps: [],
      };
    }

    return {
      kind: hasApiToken ? "needs_creation" : "needs_browser_prompt",
      title: "Choose a workers.dev subdomain",
      detail: hasApiToken
        ? "The helper can create or reuse one automatically when an API token is available."
        : "Wrangler may ask you to choose a subdomain once in the terminal.",
      steps: [
        hasApiToken
          ? "Let the helper create or reuse the account subdomain automatically."
          : "If asked, pick a subdomain once in the Wrangler prompt.",
      ],
    };
  }

  function buildWorkerUrlApplyResult(rawWorkerUrl, snapshot, options) {
    const state = normalizeSnapshot(snapshot);
    const opts = options && typeof options === "object" ? options : {};
    const url = normalizeUrl(rawWorkerUrl);
    if (!url) {
      return {
        ok: false,
        actionId: "relay_apply_worker_url",
        kind: VERIFICATION_KIND.invalidEndpoint,
        message: "Paste the open Worker URL first.",
        detail: "The relay wizard needs the browser-facing workers.dev URL.",
        url: "",
        endpoint: classifyRelayEndpointUrl("", state),
        patch: null,
      };
    }

    const endpoint = classifyRelayEndpointUrl(url, state);
    if (endpoint.kind === ENDPOINT_KIND.localOnly) {
      return {
        ok: false,
        actionId: "relay_apply_worker_url",
        kind: VERIFICATION_KIND.invalidEndpoint,
        message: "Use the open workers.dev URL instead of a local URL.",
        detail: endpoint.detail,
        url,
        endpoint,
        patch: null,
      };
    }

    if (endpoint.kind === ENDPOINT_KIND.workerForward) {
      return {
        ok: false,
        actionId: "relay_apply_worker_url",
        kind: VERIFICATION_KIND.invalidEndpoint,
        message: "Use the open Worker URL, not /forward.",
        detail: endpoint.detail,
        url,
        endpoint,
        patch: null,
      };
    }

    if (!isLikelyWorkerUrl(url) || endpoint.kind !== ENDPOINT_KIND.workerOpen) {
      return {
        ok: false,
        actionId: "relay_apply_worker_url",
        kind: VERIFICATION_KIND.invalidEndpoint,
        message: "Paste the open workers.dev URL returned by Wrangler.",
        detail:
          "The dashboard should save the browser-facing Worker URL, not a generic HTTPS endpoint.",
        url,
        endpoint,
        patch: null,
      };
    }

    return {
      ok: true,
      actionId: "relay_apply_worker_url",
      kind: VERIFICATION_KIND.connected,
      message: "Worker URL looks valid.",
      detail:
        "Save this URL in Settings as the browser-facing discovery webhook, then use Test webhook to verify delivery.",
      url,
      endpoint,
      patch: {
        discoveryWebhookUrl: url,
        discoveryWebhookKind: "worker",
        discoveryWebhookSource: opts.source || "cloudflare_worker",
      },
    };
  }

  function buildExternalEndpointValidationResult(rawUrl, snapshot, options) {
    const state = normalizeSnapshot(snapshot);
    const opts = options && typeof options === "object" ? options : {};
    const url = normalizeUrl(rawUrl);
    const endpoint = classifyRelayEndpointUrl(url, state);

    if (endpoint.kind === ENDPOINT_KIND.missing) {
      return {
        ...clone(getContract().verificationResult),
        ok: false,
        kind: VERIFICATION_KIND.invalidEndpoint,
        engineState: state.engineState || "none",
        httpStatus: 0,
        message: "Paste a webhook URL first.",
        detail: "There is nothing to validate yet.",
        layer: "browser",
        endpoint,
      };
    }

    if (
      endpoint.kind === ENDPOINT_KIND.localOnly ||
      endpoint.kind === ENDPOINT_KIND.workerForward ||
      endpoint.kind === ENDPOINT_KIND.invalid
    ) {
      return {
        ...clone(getContract().verificationResult),
        ok: false,
        kind: VERIFICATION_KIND.invalidEndpoint,
        engineState: state.engineState || "none",
        httpStatus: 0,
        message: endpoint.title,
        detail: endpoint.detail,
        layer: "browser",
        endpoint,
      };
    }

    if (endpoint.kind === ENDPOINT_KIND.appsScriptStub) {
      return {
        ...clone(getContract().verificationResult),
        ok: true,
        kind: VERIFICATION_KIND.stubOnly,
        engineState: "stub_only",
        httpStatus: 0,
        message: endpoint.title,
        detail: endpoint.detail,
        layer: "browser",
        endpoint,
      };
    }

    return {
      ...clone(getContract().verificationResult),
      ok: true,
      kind: VERIFICATION_KIND.connected,
      engineState:
        state.engineState === "stub_only" ? "stub_only" : "unverified",
      httpStatus: 0,
      message:
        endpoint.kind === ENDPOINT_KIND.workerOpen
          ? "Worker URL looks valid."
          : "Endpoint looks valid.",
      detail:
        endpoint.kind === ENDPOINT_KIND.workerOpen
          ? "Use Test webhook to confirm the open Worker accepts requests."
          : "Use Test webhook to confirm this HTTPS endpoint is reachable.",
      layer: "browser",
      endpoint,
      validation: opts.validation || "shape_only",
    };
  }

  function buildRelayWizardModel(snapshot, options) {
    const state = normalizeSnapshot(snapshot);
    const opts = options && typeof options === "object" ? options : {};
    const downstreamTargetUrl = buildDownstreamTargetUrl(state, opts);
    const savedEndpointClassification = classifyRelayEndpointUrl(
      state.savedWebhookUrl,
      state,
    );
    const downstreamClassification = classifyRelayEndpointUrl(
      downstreamTargetUrl,
      state,
    );
    const browserWorkerUrl =
      findSavedWorkerUrl(state) || normalizeUrl(opts.workerUrl);
    const browserWorkerClassification = classifyRelayEndpointUrl(
      browserWorkerUrl,
      state,
    );
    const workerName = buildSuggestedWorkerName(
      downstreamTargetUrl,
      opts.sheetId,
      opts.workerName,
    );
    const origin = asString(opts.corsOrigin || opts.origin || "", "");

    const model = {
      snapshot: state,
      savedEndpointClassification,
      downstreamTargetUrl,
      downstreamClassification,
      browserWorkerUrl,
      browserWorkerClassification,
      workerName,
      origin,
      deployCommand: buildCloudflareRelayDeployCommand(state, opts),
      agentPrompt: buildCloudflareRelayAgentPrompt(state, opts),
      authRemediation: buildCloudflareAuthRemediation(opts.auth || {}),
      subdomainRemediation: buildWorkersSubdomainRemediation({
        workersSubdomain: opts.workersSubdomain || "",
        hasApiToken: asBoolean(opts.hasApiToken),
      }),
      actions: unique([
        downstreamTargetUrl ? "relay_deploy_worker" : "",
        browserWorkerUrl ? "relay_apply_worker_url" : "",
        state.savedWebhookUrl ? "relay_validate_external_endpoint" : "",
      ]),
    };

    if (
      state.savedWebhookKind === "apps_script_stub" ||
      state.appsScriptState === "stub_only"
    ) {
      model.stubOnly = true;
    }

    return model;
  }

  function buildRelayActionResult(actionId, context) {
    const input = context && typeof context === "object" ? context : {};
    const snapshot = normalizeSnapshot(
      input.snapshot || input.readinessSnapshot,
    );
    const options =
      input.options && typeof input.options === "object"
        ? input.options
        : input;

    switch (actionId) {
      case "relay_prepare_target":
        return {
          ok: true,
          actionId,
          model: buildRelayWizardModel(snapshot, options),
        };
      case "relay_validate_external_endpoint":
        return {
          ok: true,
          actionId,
          validation: buildExternalEndpointValidationResult(
            input.url || snapshot.savedWebhookUrl,
            snapshot,
            options,
          ),
        };
      case "relay_apply_worker_url":
        return buildWorkerUrlApplyResult(
          input.workerUrl || snapshot.savedWebhookUrl,
          snapshot,
          options,
        );
      case "relay_deploy_worker":
        return {
          ok: true,
          actionId,
          deployment: {
            targetUrl: buildDownstreamTargetUrl(snapshot, options),
            workerName: buildSuggestedWorkerName(
              buildDownstreamTargetUrl(snapshot, options),
              options.sheetId,
              options.workerName,
            ),
            command: buildCloudflareRelayDeployCommand(snapshot, options),
            prompt: buildCloudflareRelayAgentPrompt(snapshot, options),
            authRemediation: buildCloudflareAuthRemediation(options.auth || {}),
            subdomainRemediation: buildWorkersSubdomainRemediation({
              workersSubdomain: options.workersSubdomain || "",
              hasApiToken: asBoolean(options.hasApiToken),
            }),
          },
        };
      case "relay_copy_deploy_command":
        return {
          ok: true,
          actionId,
          text: buildCloudflareRelayDeployCommand(snapshot, options),
        };
      case "relay_copy_agent_prompt":
        return {
          ok: true,
          actionId,
          text: buildCloudflareRelayAgentPrompt(snapshot, options),
        };
      default:
        return {
          ok: false,
          actionId,
          kind: "unsupported_action",
          message: `Unknown relay wizard action: ${actionId}`,
        };
    }
  }

  Object.assign(relay, {
    getDefaultRelayActionIds() {
      return [...DEFAULT_RELAY_ACTION_IDS];
    },
    normalizeRelaySnapshot: normalizeSnapshot,
    normalizeRelayWizardState: normalizeWizardState,
    classifySavedWebhookKind,
    classifyRelayEndpointUrl,
    buildDownstreamTargetUrl,
    buildCloudflareRelayDeployCommand,
    buildCloudflareRelayAgentPrompt,
    buildCloudflareAuthRemediation,
    buildWorkersSubdomainRemediation,
    buildWorkerUrlApplyResult,
    buildExternalEndpointValidationResult,
    buildRelayWizardModel,
    runRelayWizardAction(actionId, context) {
      return Promise.resolve(buildRelayActionResult(actionId, context));
    },
  });
})();
